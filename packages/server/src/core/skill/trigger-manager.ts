// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * TriggerManager — manages automatic trigger scheduling for skills.
 *
 * Supports cron (via cron-parser), event (system events), and threshold
 * (metric-based) triggers. Integrates with MetricsBus for threshold
 * monitoring and exposes `handleEvent()` for event-driven triggers.
 *
 * @module core/skill/trigger-manager
 */

import { CronExpressionParser } from 'cron-parser';

import { createContextLogger } from '../../utils/logger.js';
import { getMetricsBus, type MetricEvent } from '../metrics/metrics-bus.js';
import {
  getSkillRepository,
  type SkillRepository,
} from '../../db/repositories/skill-repository.js';
import { loadSkillFromDir } from './loader.js';

import type { SkillManifest, SkillTrigger } from '@aiinstaller/shared';
import type { InstalledSkill, ChainContext } from './types.js';

const logger = createContextLogger({ module: 'trigger-manager' });

/** Minimum interval between automatic triggers for the same skill+server (ms). */
const DEBOUNCE_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

/** Cron poll interval — check which cron jobs are due. */
const CRON_POLL_INTERVAL_MS = 60_000; // 1 minute

interface CronRegistration {
  skillId: string;
  userId: string;
  schedule: string;
  nextRunAt: Date;
}

interface EventRegistration {
  skillId: string;
  userId: string;
  eventType: string;
  filter?: Record<string, unknown>;
}

interface ThresholdRegistration {
  skillId: string;
  userId: string;
  metric: string;
  operator: string;
  value: number;
}

type DebounceKey = string;

/** Callback to execute a skill (injected by SkillEngine). */
export type ExecuteCallback = (
  skillId: string,
  serverId: string,
  userId: string,
  triggerType: 'cron' | 'event' | 'threshold',
  chainContext?: ChainContext,
) => Promise<void>;

export class TriggerManager {
  private cronJobs: Map<string, CronRegistration> = new Map();
  private eventTriggers: Map<string, EventRegistration[]> = new Map();
  private thresholdTriggers: Map<string, ThresholdRegistration[]> = new Map();
  private debounceMap: Map<DebounceKey, number> = new Map();
  private cronTimer: ReturnType<typeof setInterval> | null = null;
  private metricsUnsubscribe: (() => void) | null = null;
  private running = false;
  private executeCallback: ExecuteCallback;
  private repo: SkillRepository;

  constructor(executeCallback: ExecuteCallback, repo?: SkillRepository) {
    this.executeCallback = executeCallback;
    this.repo = repo ?? getSkillRepository();
  }

  // --- Lifecycle ---

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    await this.loadEnabledSkills();

    this.cronTimer = setInterval(() => {
      this.pollCronJobs().catch((err) =>
        logger.error({ error: (err as Error).message }, 'Cron poll error'),
      );
    }, CRON_POLL_INTERVAL_MS);

    this.metricsUnsubscribe = getMetricsBus().subscribeAll(
      (metric) => this.evaluateThresholds(metric),
    );

    logger.info(
      {
        cronCount: this.cronJobs.size,
        eventCount: this.eventTriggers.size,
        thresholdCount: this.thresholdTriggers.size,
      },
      'TriggerManager started',
    );
  }

  stop(): void {
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

    this.cronJobs.clear();
    this.eventTriggers.clear();
    this.thresholdTriggers.clear();
    this.debounceMap.clear();
    logger.info('TriggerManager stopped');
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
        'Failed to load manifest for trigger registration',
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
    this.cronJobs.delete(skillId);

    for (const [eventType, registrations] of this.eventTriggers.entries()) {
      const filtered = registrations.filter((r) => r.skillId !== skillId);
      if (filtered.length === 0) {
        this.eventTriggers.delete(eventType);
      } else {
        this.eventTriggers.set(eventType, filtered);
      }
    }

    this.thresholdTriggers.delete(skillId);

    for (const key of this.debounceMap.keys()) {
      if (key.startsWith(`${skillId}:`)) {
        this.debounceMap.delete(key);
      }
    }
    logger.debug({ skillId }, 'All triggers unregistered for skill');
  }

  // --- Event handling ---

  /**
   * Handle a system event and trigger matching skills.
   * Called from external modules when events like `alert.triggered` occur.
   *
   * For `skill.completed` / `skill.failed` events, chain context is
   * extracted from `data.chainContext` to support cycle detection.
   */
  async handleEvent(
    eventType: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    const registrations = this.eventTriggers.get(eventType);
    if (!registrations || registrations.length === 0) return;

    const serverId = (data['serverId'] as string) ?? 'unknown';
    const chainContext = data['chainContext'] as ChainContext | undefined;

    for (const reg of registrations) {
      // For skill.completed / skill.failed, resolve source_skill filter
      const filterData = this.buildFilterData(eventType, data);

      if (this.matchesFilter(reg.filter, filterData) && !this.isDebounced(reg.skillId, serverId)) {
        this.recordDebounce(reg.skillId, serverId);
        this.safeExecute(reg.skillId, serverId, reg.userId, 'event', chainContext);
      }
    }
  }

  // --- Cron polling ---

  /** Check all cron jobs and execute any that are due. */
  async pollCronJobs(): Promise<void> {
    const now = Date.now();

    for (const [skillId, job] of this.cronJobs.entries()) {
      if (job.nextRunAt.getTime() <= now) {
        const nextRunAt = this.computeNextRun(job.schedule);
        if (nextRunAt) {
          job.nextRunAt = nextRunAt;
        } else {
          this.cronJobs.delete(skillId);
          continue;
        }

        const serverId = 'cron-trigger';
        if (!this.isDebounced(skillId, serverId)) {
          this.recordDebounce(skillId, serverId);
          this.safeExecute(skillId, serverId, job.userId, 'cron');
        }
      }
    }
  }

  // --- Threshold evaluation ---

  private evaluateThresholds(metric: MetricEvent): void {
    for (const [skillId, registrations] of this.thresholdTriggers.entries()) {
      for (const reg of registrations) {
        const currentValue = this.extractMetricValue(reg.metric, metric);
        if (currentValue === null) continue;

        if (this.compareValue(currentValue, reg.operator, reg.value)) {
          if (!this.isDebounced(skillId, metric.serverId)) {
            this.recordDebounce(skillId, metric.serverId);
            this.safeExecute(skillId, metric.serverId, reg.userId, 'threshold');
          }
        }
      }
    }
  }

  private extractMetricValue(metricName: string, event: MetricEvent): number | null {
    switch (metricName) {
      case 'cpu.usage': return event.cpuUsage;
      case 'memory.usage_percent':
        return event.memoryTotal > 0 ? (event.memoryUsage / event.memoryTotal) * 100 : null;
      case 'disk.usage_percent':
        return event.diskTotal > 0 ? (event.diskUsage / event.diskTotal) * 100 : null;
      case 'network.rx_bytes': return event.networkIn;
      case 'network.tx_bytes': return event.networkOut;
      default: return null;
    }
  }

  private compareValue(current: number, operator: string, threshold: number): boolean {
    switch (operator) {
      case 'gt': return current > threshold;
      case 'gte': return current >= threshold;
      case 'lt': return current < threshold;
      case 'lte': return current <= threshold;
      case 'eq': return current === threshold;
      case 'neq': return current !== threshold;
      default: return false;
    }
  }

  // --- Debounce ---

  private isDebounced(skillId: string, serverId: string): boolean {
    const key: DebounceKey = `${skillId}:${serverId}`;
    const lastRun = this.debounceMap.get(key);
    if (lastRun === undefined) return false;
    return Date.now() - lastRun < DEBOUNCE_INTERVAL_MS;
  }

  private recordDebounce(skillId: string, serverId: string): void {
    this.debounceMap.set(`${skillId}:${serverId}`, Date.now());
  }

  // --- Helpers ---

  private registerTrigger(skillId: string, userId: string, trigger: SkillTrigger): void {
    switch (trigger.type) {
      case 'cron':
        this.registerCron(skillId, userId, trigger.schedule);
        break;
      case 'event':
        this.registerEvent(skillId, userId, trigger.on, trigger.filter);
        break;
      case 'threshold':
        this.registerThreshold(skillId, userId, trigger.metric, trigger.operator, trigger.value);
        break;
      case 'manual':
        break; // handled by SkillEngine.execute()
    }
  }

  private registerCron(skillId: string, userId: string, schedule: string): void {
    const nextRunAt = this.computeNextRun(schedule);
    if (!nextRunAt) {
      logger.warn({ skillId, schedule }, 'Invalid cron expression, skipping');
      return;
    }
    this.cronJobs.set(skillId, { skillId, userId, schedule, nextRunAt });
    logger.debug({ skillId, schedule, nextRunAt }, 'Cron trigger registered');
  }

  private registerEvent(
    skillId: string, userId: string, eventType: string, filter?: Record<string, unknown>,
  ): void {
    const existing = this.eventTriggers.get(eventType) ?? [];
    if (!existing.some((r) => r.skillId === skillId)) {
      existing.push({ skillId, userId, eventType, filter });
      this.eventTriggers.set(eventType, existing);
    }
    logger.debug({ skillId, eventType }, 'Event trigger registered');
  }

  private registerThreshold(
    skillId: string, userId: string, metric: string, operator: string, value: number,
  ): void {
    const existing = this.thresholdTriggers.get(skillId) ?? [];
    existing.push({ skillId, userId, metric, operator, value });
    this.thresholdTriggers.set(skillId, existing);
    logger.debug({ skillId, metric, operator, value }, 'Threshold trigger registered');
  }

  private safeExecute(
    skillId: string, serverId: string, userId: string,
    triggerType: 'cron' | 'event' | 'threshold',
    chainContext?: ChainContext,
  ): void {
    this.executeCallback(skillId, serverId, userId, triggerType, chainContext).catch((err) => {
      logger.error(
        { skillId, serverId, triggerType, error: (err as Error).message },
        'Triggered skill execution failed',
      );
    });
  }

  /**
   * Build normalized filter data from event data.
   * For skill.completed / skill.failed, maps `skillName` → `source_skill`.
   */
  private buildFilterData(
    eventType: string,
    data: Record<string, unknown>,
  ): Record<string, unknown> {
    if (eventType === 'skill.completed' || eventType === 'skill.failed') {
      return {
        ...data,
        source_skill: data['skillName'] as string,
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

  private computeNextRun(schedule: string): Date | null {
    try {
      const expr = CronExpressionParser.parse(schedule, {
        currentDate: new Date(),
        tz: 'UTC',
      });
      return expr.next().toDate();
    } catch {
      return null;
    }
  }

  private async loadEnabledSkills(): Promise<void> {
    const allSkills = await this.findAllEnabledSkills();
    for (const skill of allSkills) {
      try {
        await this.registerSkill(skill);
      } catch (err) {
        logger.warn(
          { skillId: skill.id, error: (err as Error).message },
          'Failed to register triggers for skill during startup',
        );
      }
    }
  }

  private async findAllEnabledSkills(): Promise<InstalledSkill[]> {
    const repo = this.repo as unknown as Record<string, unknown>;
    if (typeof repo['findAllEnabled'] === 'function') {
      return (repo['findAllEnabled'] as () => Promise<InstalledSkill[]>)();
    }
    logger.debug('No findAllEnabled on repo — skills registered on status change only');
    return [];
  }

  // --- Introspection (for testing) ---

  getCronCount(): number { return this.cronJobs.size; }

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

  isRunning(): boolean { return this.running; }
}

// Singleton
let _instance: TriggerManager | null = null;

export function getTriggerManager(): TriggerManager {
  if (!_instance) {
    throw new Error('TriggerManager not initialized — call setTriggerManager() first');
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
