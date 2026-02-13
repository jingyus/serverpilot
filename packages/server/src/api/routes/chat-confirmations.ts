// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Agentic confirmation state management — tracks pending confirmations
 * and recently-expired entries for the chat confirm endpoint.
 * @module api/routes/chat-confirmations
 */

import { getSessionManager } from "../../core/session/manager.js";
import { logger } from "../../utils/logger.js";
import { hasActiveExecution } from "./chat-execution.js";

/**
 * Tracks pending agentic confirmations: `confirmId → resolve callback`.
 * Used by the agentic engine when a risky command needs user approval.
 */
const pendingConfirmations = new Map<
  string,
  {
    resolve: (approved: boolean) => void;
    timer: ReturnType<typeof setTimeout>;
  }
>();

/** Confirmation timeout for agentic mode (5 minutes). */
export const CONFIRM_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Tracks confirmIds that were recently expired by timeout.
 * When the timeout fires, the confirmId is moved here so the confirm endpoint
 * can distinguish "just expired" from "never existed" — avoiding a confusing
 * 404 when the user clicks approve right at the timeout boundary.
 * Entries auto-clean after RECENTLY_EXPIRED_TTL_MS.
 */
const recentlyExpired = new Set<string>();

/** How long to keep expired confirmIds in the recently-expired set (10 seconds). */
export const RECENTLY_EXPIRED_TTL_MS = 10_000;

/** Get a pending confirmation by ID. */
export function getPendingConfirmation(confirmId: string):
  | {
      resolve: (approved: boolean) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  | undefined {
  return pendingConfirmations.get(confirmId);
}

/** Set a pending confirmation. */
export function setPendingConfirmation(
  confirmId: string,
  resolve: (approved: boolean) => void,
  timer: ReturnType<typeof setTimeout>,
): void {
  pendingConfirmations.set(confirmId, { resolve, timer });
}

/** Delete a pending confirmation. */
export function deletePendingConfirmation(confirmId: string): boolean {
  return pendingConfirmations.delete(confirmId);
}

/** Check if a confirmId is in the recently-expired set. */
export function isRecentlyExpired(confirmId: string): boolean {
  return recentlyExpired.has(confirmId);
}

/** Add a confirmId to the recently-expired set. */
export function addRecentlyExpired(confirmId: string): void {
  recentlyExpired.add(confirmId);
}

/** Schedule removal of a confirmId from the recently-expired set. */
export function scheduleRecentlyExpiredCleanup(confirmId: string): void {
  setTimeout(() => {
    recentlyExpired.delete(confirmId);
  }, RECENTLY_EXPIRED_TTL_MS);
}

/**
 * Clean up all pending confirmations for a given session.
 * Clears timers and resolves promises with `false` so the agentic loop unblocks.
 * Called when the SSE stream ends (normal completion or client disconnect).
 */
export function cleanupSessionConfirmations(sessionId: string): number {
  let cleaned = 0;
  for (const [confirmId, pending] of pendingConfirmations) {
    if (confirmId.startsWith(`${sessionId}:`)) {
      clearTimeout(pending.timer);
      pending.resolve(false);
      pendingConfirmations.delete(confirmId);
      cleaned++;
    }
  }
  if (cleaned > 0) {
    logger.info(
      { operation: "confirm_cleanup", sessionId, cleaned },
      `Cleaned up ${cleaned} pending confirmation(s) for disconnected session`,
    );
  }
  return cleaned;
}

/**
 * Check whether a session has any active work (running plan executions or
 * pending agentic confirmations). Used by the DELETE route to prevent
 * deleting a session with in-flight executions.
 */
export function hasActiveSessionWork(sessionId: string): boolean {
  // Check pending agentic confirmations (keyed as `${sessionId}:${uuid}`)
  for (const confirmId of pendingConfirmations.keys()) {
    if (confirmId.startsWith(`${sessionId}:`)) {
      return true;
    }
  }

  // Check active plan executions — plans are in-memory, tied to the cached session
  const session = getSessionManager().getSessionFromCache(sessionId);
  if (session) {
    for (const planId of session.plans.keys()) {
      if (hasActiveExecution(planId)) {
        return true;
      }
    }
  }

  return false;
}

// ============================================================================
// Test helpers
// ============================================================================

/** @internal Test helper — inject a pending confirmation directly. */
export function _setPendingConfirmation(
  confirmId: string,
  resolve: (approved: boolean) => void,
  timer: ReturnType<typeof setTimeout>,
): void {
  pendingConfirmations.set(confirmId, { resolve, timer });
}

/** @internal Test helper — clear all pending confirmations and recently-expired entries. */
export function _resetPendingConfirmations(): void {
  for (const pending of pendingConfirmations.values()) {
    clearTimeout(pending.timer);
  }
  pendingConfirmations.clear();
  recentlyExpired.clear();
}

/** @internal Test helper — check if a confirmation is pending. */
export function _hasPendingConfirmation(confirmId: string): boolean {
  return pendingConfirmations.has(confirmId);
}

/** @internal Test helper — add a confirmId to the recently-expired set. */
export function _addRecentlyExpired(confirmId: string): void {
  recentlyExpired.add(confirmId);
}

/** @internal Test helper — check if a confirmId is in the recently-expired set. */
export function _hasRecentlyExpired(confirmId: string): boolean {
  return recentlyExpired.has(confirmId);
}
