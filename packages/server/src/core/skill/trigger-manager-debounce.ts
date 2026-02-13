// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Debounce + circuit-breaker (consecutive-failure tracking) logic
 * extracted from TriggerManager to keep files under the 500-line limit.
 *
 * @module core/skill/trigger-manager-debounce
 */

import { createContextLogger } from "../../utils/logger.js";
import type { SkillRepository } from "../../db/repositories/skill-repository.js";

const logger = createContextLogger({ module: "trigger-manager-debounce" });

/** Minimum interval between automatic triggers for the same skill+server (ms). */
export const DEBOUNCE_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

/** Max consecutive failures before a skill is auto-paused. */
export const MAX_CONSECUTIVE_FAILURES = 5;

export type DebounceKey = string;

interface FailureRecord {
  consecutive: number;
  lastFailure: Date;
}

/**
 * Manages debounce state and consecutive-failure tracking for triggered skills.
 */
export class TriggerDebounce {
  readonly debounceMap: Map<DebounceKey, number> = new Map();
  private failureCounters: Map<string, FailureRecord> = new Map();
  private repo: SkillRepository;
  private onAutoPause: (skillId: string) => void;

  constructor(repo: SkillRepository, onAutoPause: (skillId: string) => void) {
    this.repo = repo;
    this.onAutoPause = onAutoPause;
  }

  /** Check if a skill+server combination is currently debounced. */
  isDebounced(skillId: string, serverId: string): boolean {
    const key: DebounceKey = `${skillId}:${serverId}`;
    const lastRun = this.debounceMap.get(key);
    if (lastRun === undefined) return false;
    return Date.now() - lastRun < DEBOUNCE_INTERVAL_MS;
  }

  /** Record a debounce timestamp for a skill+server combination. */
  recordDebounce(skillId: string, serverId: string): void {
    this.debounceMap.set(`${skillId}:${serverId}`, Date.now());
  }

  /** Clear debounce entries for a specific skill. */
  clearDebounceForSkill(skillId: string): void {
    for (const key of this.debounceMap.keys()) {
      if (key.startsWith(`${skillId}:`)) {
        this.debounceMap.delete(key);
      }
    }
  }

  /** Record a failure and auto-pause the skill if it exceeds the threshold. */
  recordFailure(skillId: string): void {
    const record = this.failureCounters.get(skillId) ?? {
      consecutive: 0,
      lastFailure: new Date(),
    };
    record.consecutive += 1;
    record.lastFailure = new Date();
    this.failureCounters.set(skillId, record);

    if (record.consecutive >= MAX_CONSECUTIVE_FAILURES) {
      logger.warn(
        { skillId, consecutiveFailures: record.consecutive },
        "Skill auto-paused after consecutive failures",
      );
      this.autoPauseSkill(skillId);
    }
  }

  /** Reset the failure counter on successful execution. */
  clearFailure(skillId: string): void {
    this.failureCounters.delete(skillId);
  }

  /** Reset the failure counter for a skill (called on manual re-enable). */
  resetFailureCounter(skillId: string): void {
    this.failureCounters.delete(skillId);
  }

  /** Get the current consecutive failure count for a skill. */
  getFailureCount(skillId: string): number {
    return this.failureCounters.get(skillId)?.consecutive ?? 0;
  }

  /** Clear all state (called on TriggerManager stop). */
  clear(): void {
    this.debounceMap.clear();
    this.failureCounters.clear();
  }

  /** Auto-pause a skill by setting its status to 'error' and notifying the manager. */
  private autoPauseSkill(skillId: string): void {
    this.repo.updateStatus(skillId, "error").catch((err) => {
      logger.error(
        { skillId, error: (err as Error).message },
        "Failed to auto-pause skill",
      );
    });
    this.onAutoPause(skillId);
  }
}
