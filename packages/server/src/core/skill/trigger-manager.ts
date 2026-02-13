// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * TriggerManager — manages automatic trigger scheduling for skills.
 *
 * Supports cron (via cron-parser), event (system events), and threshold
 * (metric-based) triggers. Integrates with MetricsBus for threshold
 * monitoring and exposes `handleEvent()` for event-driven triggers.
 *
 * Debounce/failure-tracking in `trigger-manager-debounce.ts`.
 * Cron scheduling in `trigger-manager-cron.ts`.
 *
 * @module core/skill/trigger-manager
 */

import type { SkillManifest, SkillTrigger } from "@aiinstaller/shared";
import { createContextLogger } from "../../utils/logger.js";
import { getMetricsBus, type MetricEvent } from "../metrics/metrics-bus.js";
import {
  getSkillRepository,
  type SkillRepository,
} from "../../db/repositories/skill-repository.js";
import type {
  WebhookDispatcher,
  DispatchedEvent,
} from "../webhook/dispatcher.js";
import { loadSkillFromDir } from "./loader.js";
import {
  checkThresholdTrigger,
  type ThresholdRegistration,
} from "./trigger-evaluators.js";
import { TriggerDebounce } from "./trigger-manager-debounce.js";
import { TriggerCron, CRON_POLL_INTERVAL_MS } from "./trigger-manager-cron.js";
import type { InstalledSkill, ChainContext } from "./types.js";

// Re-export so existing consumers don't need to change their imports
export { MAX_CONSECUTIVE_FAILURES } from "./trigger-manager-debounce.js";

const logger = createContextLogger({ module: "trigger-manager" });

interface EventRegistration {
  skillId: string;
  userId: string;
  eventType: string;
  filter?: Record<string, unknown>;
}

/** Callback to execute a skill (injected by SkillEngine). */
export type ExecuteCallback = (
  skillId: string,
  serverId: string,
  userId: string,
  triggerType: "cron" | "event" | "threshold",
  chainContext?: ChainContext,
) => Promise<void>;

export class TriggerManager {
  private cron: TriggerCron = new TriggerCron();
  private eventTriggers: Map<string, EventRegistration[]> = new Map();
  private thresholdTriggers: Map<string, ThresholdRegistration[]> = new Map();
  private debounce: TriggerDebounce;
  private cronTimer: ReturnType<typeof setInterval> | null = null;
  private metricsUnsubscribe: (() => void) | null = null;
  private dispatcherUnsubscribe: (() => void) | null = null;
  private running = false;
  private executeCallback: ExecuteCallback;
  private repo: SkillRepository;

  constructor(executeCallback: ExecuteCallback, repo?: SkillRepository) {
    this.executeCallback = executeCallback;
    this.repo = repo ?? getSkillRepository();
    this.debounce = new TriggerDebounce(this.repo, (skillId) =>
      this.unregisterSkill(skillId),
    );
  }

  // --- Lifecycle ---

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    await this.loadEnabledSkills();

    this.cronTimer = setInterval(() => {
      this.pollCronJobs().catch((err) =>
        logger.error({ error: (err as Error).message }, "Cron poll error"),
      );
    }, CRON_POLL_INTERVAL_MS);

    this.metricsUnsubscribe = getMetricsBus().subscribeAll((metric) =>
      this.evaluateThresholds(metric),
    );

    logger.info(
      {
        cronCount: this.cron.size,
        eventCount: this.eventTriggers.size,
        thresholdCount: this.thresholdTriggers.size,
      },
      "TriggerManager started",
    );
  }

  stop(): void {
    // Always unsubscribe from dispatcher (can be set without start())
    if (this.dispatcherUnsubscribe) {
      this.dispatcherUnsubscribe();
      this.dispatcherUnsubscribe = null;
    }

    if (!this.running) return;
    this.running = false;

    if (this.cronTimer) {
      clearInterval(this.cronTimer);
      this.cronTimer = null;
    }
    if (this.metricsUnsubscribe) {
      this.metricsUnsubscribe();
      this.metricsUnsubscribe = null;
    }

    this.cron.clear();
    this.eventTriggers.clear();
    this.thresholdTriggers.clear();
    this.debounce.clear();
    logger.info("TriggerManager stopped");
  }

  /**
   * Subscribe to a WebhookDispatcher so that system events (e.g. `alert.triggered`,
   * `server.offline`) automatically trigger matching event-based skills.
   */
  subscribeToDispatcher(dispatcher: WebhookDispatcher): void {
    if (this.dispatcherUnsubscribe) {
      this.dispatcherUnsubscribe();
    }
    this.dispatcherUnsubscribe = dispatcher.onDispatched(
      (event: DispatchedEvent) => {
        this.handleEvent(event.type, event.data).catch((err) => {
          logger.error(
            { eventType: event.type, error: (err as Error).message },
            "Failed to handle dispatched webhook event in TriggerManager",
          );
        });
      },
    );
    logger.info("TriggerManager subscribed to WebhookDispatcher events");
  }

  // --- Registration ---

  /** Register all triggers for a skill by loading its manifest from disk. */
  async registerSkill(skill: InstalledSkill): Promise<void> {
    let manifest: SkillManifest;
    try {
      manifest = await loadSkillFromDir(skill.skillPath);
    } catch (err) {
      logger.warn(
        { skillId: skill.id, error: (err as Error).message },
        "Failed to load manifest for trigger registration",
      );
      return;
    }
    this.registerTriggersFromManifest(skill.id, skill.userId, manifest);
  }

  /** Register triggers from a manifest (pure, no disk I/O — for testing). */
  registerTriggersFromManifest(
    skillId: string,
    userId: string,
    manifest: SkillManifest,
  ): void {
    for (const trigger of manifest.triggers) {
      this.registerTrigger(skillId, userId, trigger);
    }
  }

  /** Unregister all triggers for a skill. */
  unregisterSkill(skillId: string): void {
    this.cron.unregister(skillId);

    for (const [eventType, registrations] of this.eventTriggers.entries()) {
      const filtered = registrations.filter((r) => r.skillId !== skillId);
      if (filtered.length === 0) {
        this.eventTriggers.delete(eventType);
      } else {
        this.eventTriggers.set(eventType, filtered);
      }
    }

    this.thresholdTriggers.delete(skillId);
    this.debounce.clearDebounceForSkill(skillId);
    this.debounce.clearFailure(skillId);
    logger.debug({ skillId }, "All triggers unregistered for skill");
  }

  // --- Event handling ---

  /**
   * Handle a system event and trigger matching skills.
   * For `skill.completed` / `skill.failed` events, chain context is
   * extracted from `data.chainContext` to support cycle detection.
   */
  async handleEvent(
    eventType: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    const registrations = this.eventTriggers.get(eventType);
    if (!registrations || registrations.length === 0) return;

    const serverId = (data["serverId"] as string) ?? "unknown";
    const chainContext = data["chainContext"] as ChainContext | undefined;

    for (const reg of registrations) {
      const filterData = this.buildFilterData(eventType, data);

      if (
        this.matchesFilter(reg.filter, filterData) &&
        !this.debounce.isDebounced(reg.skillId, serverId)
      ) {
        this.debounce.recordDebounce(reg.skillId, serverId);
        this.safeExecute(
          reg.skillId,
          serverId,
          reg.userId,
          "event",
          chainContext,
        );
      }
    }
  }

  // --- Cron polling ---

  /** Check all cron jobs and execute any that are due. */
  async pollCronJobs(): Promise<void> {
    const dueJobs = this.cron.pollDueJobs();
    const serverId = "cron-trigger";

    for (const { skillId, userId } of dueJobs) {
      if (!this.debounce.isDebounced(skillId, serverId)) {
        this.debounce.recordDebounce(skillId, serverId);
        this.safeExecute(skillId, serverId, userId, "cron");
      }
    }
  }

  // --- Threshold evaluation ---

  private evaluateThresholds(metric: MetricEvent): void {
    for (const [skillId, registrations] of this.thresholdTriggers.entries()) {
      for (const reg of registrations) {
        if (checkThresholdTrigger(reg, metric)) {
          if (!this.debounce.isDebounced(skillId, metric.serverId)) {
            this.debounce.recordDebounce(skillId, metric.serverId);
            this.safeExecute(skillId, metric.serverId, reg.userId, "threshold");
          }
        }
      }
    }
  }

  // --- Helpers ---

  private registerTrigger(
    skillId: string,
    userId: string,
    trigger: SkillTrigger,
  ): void {
    switch (trigger.type) {
      case "cron":
        this.cron.register(skillId, userId, trigger.schedule);
        break;
      case "event":
        this.registerEvent(skillId, userId, trigger.on, trigger.filter);
        break;
      case "threshold":
        this.registerThreshold(
          skillId,
          userId,
          trigger.metric,
          trigger.operator,
          trigger.value,
        );
        break;
      case "manual":
        break; // handled by SkillEngine.execute()
    }
  }

  private registerEvent(
    skillId: string,
    userId: string,
    eventType: string,
    filter?: Record<string, unknown>,
  ): void {
    const existing = this.eventTriggers.get(eventType) ?? [];
    if (!existing.some((r) => r.skillId === skillId)) {
      existing.push({ skillId, userId, eventType, filter });
      this.eventTriggers.set(eventType, existing);
    }
    logger.debug({ skillId, eventType }, "Event trigger registered");
  }

  private registerThreshold(
    skillId: string,
    userId: string,
    metric: string,
    operator: string,
    value: number,
  ): void {
    const existing = this.thresholdTriggers.get(skillId) ?? [];
    existing.push({ skillId, userId, metric, operator, value });
    this.thresholdTriggers.set(skillId, existing);
    logger.debug(
      { skillId, metric, operator, value },
      "Threshold trigger registered",
    );
  }

  private safeExecute(
    skillId: string,
    serverId: string,
    userId: string,
    triggerType: "cron" | "event" | "threshold",
    chainContext?: ChainContext,
  ): void {
    this.executeCallback(skillId, serverId, userId, triggerType, chainContext)
      .then(() => {
        this.debounce.clearFailure(skillId);
      })
      .catch((err) => {
        logger.error(
          { skillId, serverId, triggerType, error: (err as Error).message },
          "Triggered skill execution failed",
        );
        this.debounce.recordFailure(skillId);
      });
  }

  /** Reset the failure counter for a skill (called on manual re-enable). */
  resetFailureCounter(skillId: string): void {
    this.debounce.resetFailureCounter(skillId);
  }

  /** Get the current consecutive failure count for a skill (for testing/introspection). */
  getFailureCount(skillId: string): number {
    return this.debounce.getFailureCount(skillId);
  }

  private buildFilterData(
    eventType: string,
    data: Record<string, unknown>,
  ): Record<string, unknown> {
    if (eventType === "skill.completed" || eventType === "skill.failed") {
      return {
        ...data,
        source_skill: data["skillName"] as string,
      };
    }
    return data;
  }

  private matchesFilter(
    filter: Record<string, unknown> | undefined,
    data: Record<string, unknown>,
  ): boolean {
    if (!filter) return true;
    for (const [key, val] of Object.entries(filter)) {
      if (data[key] !== val) return false;
    }
    return true;
  }

  private async loadEnabledSkills(): Promise<void> {
    const allSkills = await this.repo.findAllEnabled();
    for (const skill of allSkills) {
      try {
        await this.registerSkill(skill);
      } catch (err) {
        logger.warn(
          { skillId: skill.id, error: (err as Error).message },
          "Failed to register triggers for skill during startup",
        );
      }
    }
  }

  // --- Introspection (for testing) ---

  getCronCount(): number {
    return this.cron.size;
  }

  getEventCount(): number {
    let count = 0;
    for (const regs of this.eventTriggers.values()) count += regs.length;
    return count;
  }

  getThresholdCount(): number {
    let count = 0;
    for (const regs of this.thresholdTriggers.values()) count += regs.length;
    return count;
  }

  isRunning(): boolean {
    return this.running;
  }
}

// Singleton
let _instance: TriggerManager | null = null;

export function getTriggerManager(): TriggerManager {
  if (!_instance) {
    throw new Error(
      "TriggerManager not initialized — call setTriggerManager() first",
    );
  }
  return _instance;
}

export function setTriggerManager(manager: TriggerManager): void {
  _instance = manager;
}

export function _resetTriggerManager(): void {
  if (_instance) _instance.stop();
  _instance = null;
}
