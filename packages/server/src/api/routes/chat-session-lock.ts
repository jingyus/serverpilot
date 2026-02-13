// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Per-session serialization lock — ensures concurrent SSE requests
 * for the same chat session are processed sequentially.
 * @module api/routes/chat-session-lock
 */

import { logger } from "../../utils/logger.js";

/** Lock timeout — prevents deadlocks if a request hangs (30 seconds). */
export const SESSION_LOCK_TIMEOUT_MS = 30_000;

/**
 * Per-session serialization lock. Each entry is a Promise that resolves when
 * the current request for that session finishes its SSE stream.
 */
const sessionLocks = new Map<string, Promise<void>>();

/**
 * Acquire a per-session lock. Returns a `release` function that MUST be
 * called when the request finishes. Same-session requests are serialized;
 * different sessions are unaffected.
 */
export async function acquireSessionLock(
  sessionId: string,
): Promise<() => void> {
  const currentLock = sessionLocks.get(sessionId);
  if (currentLock) {
    let timedOut = false;
    await Promise.race([
      currentLock,
      new Promise<void>((resolve) =>
        setTimeout(() => {
          timedOut = true;
          resolve();
        }, SESSION_LOCK_TIMEOUT_MS),
      ),
    ]);
    if (timedOut) {
      // Previous lock holder hung — clean up the stale entry so future
      // requests don't wait on a Promise that will never resolve.
      sessionLocks.delete(sessionId);
      logger.warn(
        { operation: "session_lock_timeout", sessionId },
        `Session lock timed out after ${SESSION_LOCK_TIMEOUT_MS}ms — forcing acquisition`,
      );
    }
  }

  let releaseFn!: () => void;
  const newLock = new Promise<void>((resolve) => {
    releaseFn = resolve;
  });
  sessionLocks.set(sessionId, newLock);

  let released = false;
  return () => {
    if (released) return;
    released = true;
    // Only delete if the Map still points to OUR lock.
    // Another request may have already replaced it after a timeout.
    if (sessionLocks.get(sessionId) === newLock) {
      sessionLocks.delete(sessionId);
    }
    releaseFn();
  };
}

// ============================================================================
// Test helpers
// ============================================================================

/** @internal Test helper — clear all session locks. */
export function _resetSessionLocks(): void {
  sessionLocks.clear();
}

/** @internal Test helper — check if a session lock exists. */
export function _hasSessionLock(sessionId: string): boolean {
  return sessionLocks.has(sessionId);
}

/** @internal Test helper — get the raw lock Promise for identity checks. */
export function _getSessionLock(sessionId: string): Promise<void> | undefined {
  return sessionLocks.get(sessionId);
}
