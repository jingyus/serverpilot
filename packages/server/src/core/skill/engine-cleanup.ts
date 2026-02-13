// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Execution cleanup helpers — extracted from engine.ts.
 *
 * Handles periodic cleanup of old execution records and expired
 * pending confirmations.
 *
 * @module core/skill/engine-cleanup
 */

import { createContextLogger } from '../../utils/logger.js';
import type { SkillRepository } from '../../db/repositories/skill-repository.js';

const logger = createContextLogger({ module: 'skill-engine-cleanup' });

/** How often to sweep for expired pending confirmations. */
export const CONFIRMATION_CLEANUP_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

/** How often to sweep for old execution records. */
export const EXECUTION_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

/** How many days of execution history to retain. */
export const EXECUTION_RETENTION_DAYS = 90;

/** Delete execution records older than the retention period. */
export async function cleanupOldExecutions(repo: SkillRepository): Promise<number> {
  const cutoff = new Date(Date.now() - EXECUTION_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const deleted = await repo.deleteExecutionsBefore(cutoff);
  if (deleted > 0) {
    logger.info(
      { deletedCount: deleted, retentionDays: EXECUTION_RETENTION_DAYS },
      'Old executions cleaned up',
    );
  }
  return deleted;
}

/**
 * Start periodic cleanup timers.
 * Returns a dispose function that clears all timers.
 */
export function startCleanupTimers(
  repo: SkillRepository,
  expirePendingConfirmations: () => Promise<number>,
  cleanupExecutions?: () => Promise<number>,
): { dispose: () => void } {
  const doCleanupExecutions = cleanupExecutions ?? (() => cleanupOldExecutions(repo));

  const confirmationTimer = setInterval(() => {
    expirePendingConfirmations().then((c) => {
      if (c > 0) logger.info({ expiredCount: c }, 'Expired pending confirmations cleaned up');
    }).catch((err) => {
      logger.error({ error: (err as Error).message }, 'Failed to expire pending confirmations');
    });
  }, CONFIRMATION_CLEANUP_INTERVAL_MS);
  confirmationTimer.unref();

  const executionTimer = setInterval(() => {
    doCleanupExecutions().catch((err) => {
      logger.error({ error: (err as Error).message }, 'Failed to clean up old executions');
    });
  }, EXECUTION_CLEANUP_INTERVAL_MS);
  executionTimer.unref();

  // Initial cleanup (fire-and-forget)
  doCleanupExecutions().catch(() => {});

  return {
    dispose() {
      clearInterval(confirmationTimer);
      clearInterval(executionTimer);
    },
  };
}
