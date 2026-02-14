// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * SQLite database automatic maintenance.
 *
 * Periodically performs WAL checkpoint and PRAGMA optimize to keep
 * the database healthy for long-running self-hosted deployments.
 * Also exposes a manual VACUUM trigger for admin use.
 *
 * @module db/maintenance
 */

import { createContextLogger } from "../utils/logger.js";
import { getRawDatabase } from "./connection.js";

const logger = createContextLogger({ component: "db-maintenance" });

// ============================================================================
// Configuration
// ============================================================================

/** WAL checkpoint interval: every 24 hours. */
const WAL_CHECKPOINT_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** PRAGMA optimize interval: every 7 days. */
const PRAGMA_OPTIMIZE_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

// ============================================================================
// Types
// ============================================================================

export interface MaintenanceStatus {
  /** Whether the scheduler is running */
  running: boolean;
  /** Last WAL checkpoint time (ISO string) */
  lastWalCheckpoint: string | null;
  /** Last PRAGMA optimize time (ISO string) */
  lastPragmaOptimize: string | null;
  /** Database file size in bytes */
  dbSizeBytes: number;
  /** WAL file size in bytes */
  walSizeBytes: number;
}

export interface VacuumResult {
  /** Database file size before VACUUM (bytes) */
  sizeBefore: number;
  /** Database file size after VACUUM (bytes) */
  sizeAfter: number;
  /** Duration of VACUUM operation (ms) */
  durationMs: number;
}

// ============================================================================
// Singleton State
// ============================================================================

let _walTimer: ReturnType<typeof setInterval> | null = null;
let _optimizeTimer: ReturnType<typeof setInterval> | null = null;
let _running = false;
let _lastWalCheckpoint: Date | null = null;
let _lastPragmaOptimize: Date | null = null;

// ============================================================================
// Internal Helpers
// ============================================================================

function getDbFileSize(): number {
  try {
    const sqlite = getRawDatabase();
    const row = sqlite.pragma("page_count") as Array<{ page_count: number }>;
    const pageSize = sqlite.pragma("page_size") as Array<{ page_size: number }>;
    if (row.length > 0 && pageSize.length > 0) {
      return row[0].page_count * pageSize[0].page_size;
    }
  } catch {
    // fallback
  }
  return 0;
}

function getWalFileSize(): number {
  try {
    const sqlite = getRawDatabase();
    // wal_checkpoint returns [busy, log, checkpointed]
    const result = sqlite.pragma("wal_checkpoint(PASSIVE)") as Array<{
      busy: number;
      log: number;
      checkpointed: number;
    }>;
    if (result.length > 0) {
      // log = total pages in WAL
      const pageSize = sqlite.pragma("page_size") as Array<{
        page_size: number;
      }>;
      if (pageSize.length > 0) {
        return result[0].log * pageSize[0].page_size;
      }
    }
  } catch {
    // WAL info not available
  }
  return 0;
}

// ============================================================================
// Maintenance Operations
// ============================================================================

/**
 * Execute a WAL checkpoint (TRUNCATE mode).
 * Moves all WAL content back into the main database file and truncates WAL.
 */
export function runWalCheckpoint(): void {
  try {
    const sqlite = getRawDatabase();
    const result = sqlite.pragma("wal_checkpoint(TRUNCATE)") as Array<{
      busy: number;
      log: number;
      checkpointed: number;
    }>;
    _lastWalCheckpoint = new Date();

    const info = result[0] ?? { busy: 0, log: 0, checkpointed: 0 };
    logger.info(
      {
        busy: info.busy,
        walPages: info.log,
        checkpointedPages: info.checkpointed,
      },
      "WAL checkpoint completed",
    );
  } catch (err) {
    logger.error({ err }, "WAL checkpoint failed");
  }
}

/**
 * Execute PRAGMA optimize to update query planner statistics.
 */
export function runPragmaOptimize(): void {
  try {
    const sqlite = getRawDatabase();
    sqlite.pragma("optimize");
    _lastPragmaOptimize = new Date();
    logger.info("PRAGMA optimize completed");
  } catch (err) {
    logger.error({ err }, "PRAGMA optimize failed");
  }
}

/**
 * Execute a full VACUUM to rebuild the database and reclaim space.
 * This is a heavyweight operation — should only be triggered manually.
 */
export function runVacuum(): VacuumResult {
  const sqlite = getRawDatabase();
  const sizeBefore = getDbFileSize();
  const start = Date.now();

  sqlite.exec("VACUUM");

  const durationMs = Date.now() - start;
  const sizeAfter = getDbFileSize();

  logger.info(
    {
      sizeBefore,
      sizeAfter,
      freedBytes: sizeBefore - sizeAfter,
      durationMs,
    },
    "VACUUM completed",
  );

  return { sizeBefore, sizeAfter, durationMs };
}

// ============================================================================
// Scheduler
// ============================================================================

/**
 * Start the database maintenance scheduler.
 *
 * - WAL checkpoint every 24 hours
 * - PRAGMA optimize every 7 days
 * - Logs database size on startup
 */
export function startDbMaintenance(): void {
  if (_running) {
    logger.warn("Database maintenance scheduler is already running");
    return;
  }

  _running = true;

  // Log initial database size
  const dbSize = getDbFileSize();
  const walSize = getWalFileSize();
  logger.info(
    {
      dbSizeBytes: dbSize,
      dbSizeMB: +(dbSize / (1024 * 1024)).toFixed(2),
      walSizeBytes: walSize,
      walSizeMB: +(walSize / (1024 * 1024)).toFixed(2),
    },
    "Database maintenance scheduler started",
  );

  // Schedule WAL checkpoint
  _walTimer = setInterval(() => {
    runWalCheckpoint();
  }, WAL_CHECKPOINT_INTERVAL_MS);
  _walTimer.unref();

  // Schedule PRAGMA optimize
  _optimizeTimer = setInterval(() => {
    runPragmaOptimize();
  }, PRAGMA_OPTIMIZE_INTERVAL_MS);
  _optimizeTimer.unref();
}

/**
 * Stop the database maintenance scheduler.
 */
export function stopDbMaintenance(): void {
  if (!_running) {
    return;
  }

  if (_walTimer) {
    clearInterval(_walTimer);
    _walTimer = null;
  }
  if (_optimizeTimer) {
    clearInterval(_optimizeTimer);
    _optimizeTimer = null;
  }

  _running = false;
  logger.info("Database maintenance scheduler stopped");
}

/**
 * Check whether the maintenance scheduler is running.
 */
export function isDbMaintenanceRunning(): boolean {
  return _running;
}

/**
 * Get current maintenance status.
 */
export function getMaintenanceStatus(): MaintenanceStatus {
  return {
    running: _running,
    lastWalCheckpoint: _lastWalCheckpoint?.toISOString() ?? null,
    lastPragmaOptimize: _lastPragmaOptimize?.toISOString() ?? null,
    dbSizeBytes: getDbFileSize(),
    walSizeBytes: getWalFileSize(),
  };
}

/**
 * Reset all module state (for testing).
 */
export function _resetDbMaintenance(): void {
  stopDbMaintenance();
  _lastWalCheckpoint = null;
  _lastPragmaOptimize = null;
}
