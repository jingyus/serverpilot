// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Automatic session cleanup — removes expired sessions and cascaded messages.
 *
 * Sessions older than `SESSION_RETENTION_DAYS` (default: 90) that have not
 * been updated are periodically deleted. The `session_messages` table uses
 * `ON DELETE CASCADE` on `session_id`, so associated rows are automatically
 * removed by SQLite.
 *
 * Runs every 24 hours via `setInterval`. The timer is `.unref()`-ed so it
 * does not prevent graceful process exit.
 *
 * @module core/session/session-cleanup
 */

import { lt } from "drizzle-orm";
import { getDatabase } from "../../db/connection.js";
import { sessions } from "../../db/schema.js";
import { createContextLogger } from "../../utils/logger.js";
import type { DrizzleDB } from "../../db/connection.js";

const logger = createContextLogger({ component: "session-cleanup" });

// ============================================================================
// Configuration
// ============================================================================

/** Default retention period: 90 days. */
const DEFAULT_RETENTION_DAYS = 90;

/** Cleanup interval: every 24 hours. */
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Read retention days from environment. */
export function getRetentionDays(): number {
  const envValue = process.env["SESSION_RETENTION_DAYS"];
  if (!envValue) return DEFAULT_RETENTION_DAYS;

  const parsed = parseInt(envValue, 10);
  if (Number.isNaN(parsed) || parsed < 1) {
    logger.warn(
      { envValue },
      "Invalid SESSION_RETENTION_DAYS value, using default",
    );
    return DEFAULT_RETENTION_DAYS;
  }
  return parsed;
}

// ============================================================================
// Types
// ============================================================================

export interface CleanupResult {
  /** Number of sessions deleted. */
  deletedCount: number;
  /** The cutoff date used (ISO string). */
  cutoffDate: string;
  /** Duration of the cleanup operation (ms). */
  durationMs: number;
}

export interface SessionCleanupStatus {
  /** Whether the scheduler is running. */
  running: boolean;
  /** Retention period in days. */
  retentionDays: number;
  /** Last cleanup time (ISO string), or null if never run. */
  lastCleanupAt: string | null;
  /** Result of last cleanup, or null if never run. */
  lastResult: CleanupResult | null;
}

// ============================================================================
// Singleton State
// ============================================================================

let _timer: ReturnType<typeof setInterval> | null = null;
let _running = false;
let _lastCleanupAt: Date | null = null;
let _lastResult: CleanupResult | null = null;

// ============================================================================
// Core Logic
// ============================================================================

/**
 * Count sessions that would be deleted (dry-run).
 * Used for pre-cleanup logging.
 */
export function countExpiredSessions(db: DrizzleDB, cutoff: Date): number {
  const rows = db
    .select({ id: sessions.id })
    .from(sessions)
    .where(lt(sessions.updatedAt, cutoff))
    .all();
  return rows.length;
}

/**
 * Delete sessions older than the cutoff date.
 * Returns the number of deleted sessions.
 *
 * Session messages are cascade-deleted by SQLite FK constraint.
 */
export function deleteExpiredSessions(db: DrizzleDB, cutoff: Date): number {
  const result = db
    .delete(sessions)
    .where(lt(sessions.updatedAt, cutoff))
    .run();
  return result.changes;
}

/**
 * Run a single cleanup cycle.
 *
 * 1. Compute cutoff date from retention days
 * 2. Count expired sessions (dry-run log)
 * 3. Delete expired sessions
 * 4. Log results
 */
export function runCleanup(db?: DrizzleDB): CleanupResult {
  const effectiveDb = db ?? getDatabase();
  const retentionDays = getRetentionDays();
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

  // Dry-run: count before deleting
  const candidateCount = countExpiredSessions(effectiveDb, cutoff);

  logger.info(
    {
      retentionDays,
      cutoffDate: cutoff.toISOString(),
      candidateCount,
    },
    `Session cleanup: ${candidateCount} session(s) eligible for deletion`,
  );

  if (candidateCount === 0) {
    const result: CleanupResult = {
      deletedCount: 0,
      cutoffDate: cutoff.toISOString(),
      durationMs: 0,
    };
    _lastCleanupAt = new Date();
    _lastResult = result;
    return result;
  }

  const start = Date.now();
  const deletedCount = deleteExpiredSessions(effectiveDb, cutoff);
  const durationMs = Date.now() - start;

  logger.info(
    {
      deletedCount,
      cutoffDate: cutoff.toISOString(),
      durationMs,
    },
    `Session cleanup completed: deleted ${deletedCount} session(s)`,
  );

  const result: CleanupResult = {
    deletedCount,
    cutoffDate: cutoff.toISOString(),
    durationMs,
  };
  _lastCleanupAt = new Date();
  _lastResult = result;
  return result;
}

// ============================================================================
// Scheduler
// ============================================================================

/**
 * Start the session cleanup scheduler.
 * Runs cleanup every 24 hours. Idempotent — calling twice is a no-op.
 */
export function startSessionCleanup(): void {
  if (_running) {
    logger.warn("Session cleanup scheduler is already running");
    return;
  }

  _running = true;

  const retentionDays = getRetentionDays();
  logger.info(
    { retentionDays, intervalMs: CLEANUP_INTERVAL_MS },
    "Session cleanup scheduler started",
  );

  _timer = setInterval(() => {
    try {
      runCleanup();
    } catch (err) {
      logger.error({ err }, "Session cleanup failed");
    }
  }, CLEANUP_INTERVAL_MS);
  _timer.unref();
}

/**
 * Stop the session cleanup scheduler.
 */
export function stopSessionCleanup(): void {
  if (!_running) return;

  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }

  _running = false;
  logger.info("Session cleanup scheduler stopped");
}

/**
 * Check whether the cleanup scheduler is running.
 */
export function isSessionCleanupRunning(): boolean {
  return _running;
}

/**
 * Get current cleanup status.
 */
export function getSessionCleanupStatus(): SessionCleanupStatus {
  return {
    running: _running,
    retentionDays: getRetentionDays(),
    lastCleanupAt: _lastCleanupAt?.toISOString() ?? null,
    lastResult: _lastResult,
  };
}

/**
 * Reset all module state (for testing).
 */
export function _resetSessionCleanup(): void {
  stopSessionCleanup();
  _lastCleanupAt = null;
  _lastResult = null;
}
