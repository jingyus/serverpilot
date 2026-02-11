// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Metrics cleanup and aggregation scheduler.
 *
 * Periodically aggregates and prunes metrics data based on retention policies:
 * - Raw data: 7 days (aggregated to hourly before pruning)
 * - Hourly aggregates: 30 days (aggregated to daily before pruning)
 * - Daily aggregates: 1 year
 *
 * @module core/metrics-cleanup-scheduler
 */

import { getMetricsRepository } from '../db/repositories/metrics-repository.js';
import { createContextLogger } from '../utils/logger.js';

const logger = createContextLogger({ component: 'metrics-cleanup' });

// ============================================================================
// Configuration
// ============================================================================

/** Retention period for raw metrics data (days). */
const RAW_DATA_RETENTION_DAYS = 7;

/** Retention period for hourly aggregated data (days). */
const HOURLY_DATA_RETENTION_DAYS = 30;

/** Retention period for daily aggregated data (days). */
const DAILY_DATA_RETENTION_DAYS = 365;

/** Cleanup interval: every 6 hours. */
const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;

// ============================================================================
// Scheduler
// ============================================================================

let cleanupTimer: ReturnType<typeof setInterval> | null = null;
let isRunning = false;

/**
 * Start the metrics cleanup scheduler.
 *
 * Runs cleanup immediately and then periodically based on CLEANUP_INTERVAL_MS.
 */
export function startMetricsCleanupScheduler(): void {
  if (isRunning) {
    logger.warn('Metrics cleanup scheduler is already running');
    return;
  }

  logger.info(
    {
      rawRetentionDays: RAW_DATA_RETENTION_DAYS,
      hourlyRetentionDays: HOURLY_DATA_RETENTION_DAYS,
      dailyRetentionDays: DAILY_DATA_RETENTION_DAYS,
      intervalHours: CLEANUP_INTERVAL_MS / (60 * 60 * 1000),
    },
    'Starting metrics cleanup scheduler'
  );

  isRunning = true;

  // Run cleanup immediately on start
  runCleanup().catch((err) => {
    logger.error({ err }, 'Failed to run initial metrics cleanup');
  });

  // Schedule periodic cleanup
  cleanupTimer = setInterval(() => {
    runCleanup().catch((err) => {
      logger.error({ err }, 'Failed to run scheduled metrics cleanup');
    });
  }, CLEANUP_INTERVAL_MS);
}

/**
 * Stop the metrics cleanup scheduler.
 */
export function stopMetricsCleanupScheduler(): void {
  if (!isRunning) {
    logger.warn('Metrics cleanup scheduler is not running');
    return;
  }

  logger.info('Stopping metrics cleanup scheduler');

  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }

  isRunning = false;
}

/**
 * Check if the scheduler is currently running.
 */
export function isMetricsCleanupSchedulerRunning(): boolean {
  return isRunning;
}

/**
 * Run the full metrics cleanup pipeline:
 * 1. Aggregate raw data → hourly (for data older than 7 days)
 * 2. Aggregate hourly data → daily (for data older than 30 days)
 * 3. Prune raw data older than 7 days
 * 4. Prune hourly data older than 30 days
 * 5. Prune daily data older than 1 year
 */
async function runCleanup(): Promise<void> {
  const startTime = Date.now();

  logger.info('Running metrics cleanup task');

  try {
    const metricsRepo = getMetricsRepository();

    const now = new Date();

    // Step 1: Aggregate raw → hourly (for data about to be pruned)
    const rawCutoff = new Date(now);
    rawCutoff.setDate(rawCutoff.getDate() - RAW_DATA_RETENTION_DAYS);
    const hourlyAggStart = new Date(rawCutoff);
    hourlyAggStart.setDate(hourlyAggStart.getDate() - 1); // 1 day buffer

    const hourlyInserted = await metricsRepo.aggregateToHourly(hourlyAggStart, rawCutoff);

    // Step 2: Aggregate hourly → daily (for data about to be pruned)
    const hourlyCutoff = new Date(now);
    hourlyCutoff.setDate(hourlyCutoff.getDate() - HOURLY_DATA_RETENTION_DAYS);
    const dailyAggStart = new Date(hourlyCutoff);
    dailyAggStart.setDate(dailyAggStart.getDate() - 1);

    const dailyInserted = await metricsRepo.aggregateToDaily(dailyAggStart, hourlyCutoff);

    // Step 3: Prune raw data
    const rawDeleted = await metricsRepo.pruneOlderThan(rawCutoff);

    // Step 4: Prune hourly data
    const hourlyDeleted = await metricsRepo.pruneHourlyOlderThan(hourlyCutoff);

    // Step 5: Prune daily data
    const dailyCutoff = new Date(now);
    dailyCutoff.setDate(dailyCutoff.getDate() - DAILY_DATA_RETENTION_DAYS);
    const dailyDeleted = await metricsRepo.pruneDailyOlderThan(dailyCutoff);

    const duration = Date.now() - startTime;

    logger.info(
      {
        hourlyInserted,
        dailyInserted,
        rawDeleted,
        hourlyDeleted,
        dailyDeleted,
        durationMs: duration,
      },
      'Metrics cleanup task completed'
    );
  } catch (err) {
    const duration = Date.now() - startTime;

    logger.error(
      {
        err,
        durationMs: duration,
      },
      'Metrics cleanup task failed'
    );

    throw err;
  }
}

/**
 * Manually trigger metrics cleanup (for testing or admin operations).
 *
 * @returns Summary of cleanup actions
 */
export async function triggerMetricsCleanup(): Promise<{
  rawDeleted: number;
  hourlyInserted: number;
  hourlyDeleted: number;
  dailyInserted: number;
  dailyDeleted: number;
}> {
  logger.info('Manual metrics cleanup triggered');

  const metricsRepo = getMetricsRepository();
  const now = new Date();

  const rawCutoff = new Date(now);
  rawCutoff.setDate(rawCutoff.getDate() - RAW_DATA_RETENTION_DAYS);
  const hourlyAggStart = new Date(rawCutoff);
  hourlyAggStart.setDate(hourlyAggStart.getDate() - 1);

  const hourlyInserted = await metricsRepo.aggregateToHourly(hourlyAggStart, rawCutoff);

  const hourlyCutoff = new Date(now);
  hourlyCutoff.setDate(hourlyCutoff.getDate() - HOURLY_DATA_RETENTION_DAYS);
  const dailyAggStart = new Date(hourlyCutoff);
  dailyAggStart.setDate(dailyAggStart.getDate() - 1);

  const dailyInserted = await metricsRepo.aggregateToDaily(dailyAggStart, hourlyCutoff);

  const rawDeleted = await metricsRepo.pruneOlderThan(rawCutoff);
  const hourlyDeleted = await metricsRepo.pruneHourlyOlderThan(hourlyCutoff);

  const dailyCutoff = new Date(now);
  dailyCutoff.setDate(dailyCutoff.getDate() - DAILY_DATA_RETENTION_DAYS);
  const dailyDeleted = await metricsRepo.pruneDailyOlderThan(dailyCutoff);

  logger.info(
    { rawDeleted, hourlyInserted, hourlyDeleted, dailyInserted, dailyDeleted },
    'Manual metrics cleanup completed'
  );

  return { rawDeleted, hourlyInserted, hourlyDeleted, dailyInserted, dailyDeleted };
}
