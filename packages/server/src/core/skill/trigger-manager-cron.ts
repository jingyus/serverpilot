// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Cron scheduling logic extracted from TriggerManager to keep files
 * under the 500-line limit.
 *
 * @module core/skill/trigger-manager-cron
 */

import { CronExpressionParser } from "cron-parser";
import { createContextLogger } from "../../utils/logger.js";

const logger = createContextLogger({ module: "trigger-manager-cron" });

/** Cron poll interval — check which cron jobs are due. */
export const CRON_POLL_INTERVAL_MS = 60_000; // 1 minute

export interface CronRegistration {
  skillId: string;
  userId: string;
  schedule: string;
  nextRunAt: Date;
}

/**
 * Manages cron job registrations and polling for the TriggerManager.
 */
export class TriggerCron {
  readonly cronJobs: Map<string, CronRegistration> = new Map();

  /** Register a cron trigger for a skill. Returns false if the expression is invalid. */
  register(skillId: string, userId: string, schedule: string): boolean {
    const nextRunAt = this.computeNextRun(schedule);
    if (!nextRunAt) {
      logger.warn({ skillId, schedule }, "Invalid cron expression, skipping");
      return false;
    }
    this.cronJobs.set(skillId, { skillId, userId, schedule, nextRunAt });
    logger.debug({ skillId, schedule, nextRunAt }, "Cron trigger registered");
    return true;
  }

  /** Unregister a cron job for a skill. */
  unregister(skillId: string): void {
    this.cronJobs.delete(skillId);
  }

  /** Clear all cron jobs. */
  clear(): void {
    this.cronJobs.clear();
  }

  /** Number of registered cron jobs. */
  get size(): number {
    return this.cronJobs.size;
  }

  /**
   * Poll all cron jobs and invoke the callback for each that is due.
   * Returns the list of (skillId, userId) pairs that were due.
   */
  pollDueJobs(): Array<{ skillId: string; userId: string }> {
    const now = Date.now();
    const dueJobs: Array<{ skillId: string; userId: string }> = [];

    for (const [skillId, job] of this.cronJobs.entries()) {
      if (job.nextRunAt.getTime() <= now) {
        const nextRunAt = this.computeNextRun(job.schedule);
        if (nextRunAt) {
          job.nextRunAt = nextRunAt;
        } else {
          this.cronJobs.delete(skillId);
          continue;
        }
        dueJobs.push({ skillId, userId: job.userId });
      }
    }

    return dueJobs;
  }

  /** Compute the next run date for a cron expression. Returns null if invalid. */
  private computeNextRun(schedule: string): Date | null {
    try {
      const expr = CronExpressionParser.parse(schedule, {
        currentDate: new Date(),
        tz: "UTC",
      });
      return expr.next().toDate();
    } catch {
      return null;
    }
  }
}
