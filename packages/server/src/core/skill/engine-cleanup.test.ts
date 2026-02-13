// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for engine-cleanup — periodic cleanup of old execution records
 * and expired pending confirmations.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  cleanupOldExecutions,
  startCleanupTimers,
  EXECUTION_RETENTION_DAYS,
  CONFIRMATION_CLEANUP_INTERVAL_MS,
  EXECUTION_CLEANUP_INTERVAL_MS,
} from './engine-cleanup.js';
import type { SkillRepository } from '../../db/repositories/skill-repository.js';

// ============================================================================
// Helpers
// ============================================================================

function createMockRepo(deleteResult = 0): SkillRepository {
  return {
    deleteExecutionsBefore: vi.fn().mockResolvedValue(deleteResult),
  } as unknown as SkillRepository;
}

// ============================================================================
// Setup / Teardown
// ============================================================================

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ============================================================================
// Constants
// ============================================================================

describe('cleanup constants', () => {
  it('EXECUTION_RETENTION_DAYS should be 90', () => {
    expect(EXECUTION_RETENTION_DAYS).toBe(90);
  });

  it('CONFIRMATION_CLEANUP_INTERVAL_MS should be 10 minutes', () => {
    expect(CONFIRMATION_CLEANUP_INTERVAL_MS).toBe(10 * 60 * 1000);
  });

  it('EXECUTION_CLEANUP_INTERVAL_MS should be 24 hours', () => {
    expect(EXECUTION_CLEANUP_INTERVAL_MS).toBe(24 * 60 * 60 * 1000);
  });
});

// ============================================================================
// cleanupOldExecutions
// ============================================================================

describe('cleanupOldExecutions', () => {
  it('should call deleteExecutionsBefore with correct cutoff date', async () => {
    const now = new Date('2026-06-15T12:00:00Z');
    vi.setSystemTime(now);

    const repo = createMockRepo(0);
    await cleanupOldExecutions(repo);

    const expectedCutoff = new Date(
      now.getTime() - EXECUTION_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    );
    expect(repo.deleteExecutionsBefore).toHaveBeenCalledTimes(1);
    const actualCutoff = vi.mocked(repo.deleteExecutionsBefore).mock.calls[0][0];
    expect(actualCutoff.getTime()).toBe(expectedCutoff.getTime());
  });

  it('should return 0 when no records are expired', async () => {
    const repo = createMockRepo(0);
    const result = await cleanupOldExecutions(repo);
    expect(result).toBe(0);
  });

  it('should return the count of deleted records', async () => {
    const repo = createMockRepo(42);
    const result = await cleanupOldExecutions(repo);
    expect(result).toBe(42);
  });

  it('should log when records are deleted', async () => {
    const repo = createMockRepo(5);
    // No assertion on logger; just verify it doesn't throw
    const result = await cleanupOldExecutions(repo);
    expect(result).toBe(5);
  });
});

// ============================================================================
// startCleanupTimers
// ============================================================================

describe('startCleanupTimers', () => {
  it('should fire initial execution cleanup immediately', async () => {
    const repo = createMockRepo(0);
    const expireFn = vi.fn().mockResolvedValue(0);
    const cleanupFn = vi.fn().mockResolvedValue(0);

    const { dispose } = startCleanupTimers(repo, expireFn, cleanupFn);

    // flush initial fire-and-forget microtask
    await vi.advanceTimersByTimeAsync(0);

    expect(cleanupFn).toHaveBeenCalledTimes(1);
    dispose();
  });

  it('should call expirePendingConfirmations on confirmation interval', async () => {
    const repo = createMockRepo(0);
    const expireFn = vi.fn().mockResolvedValue(0);
    const cleanupFn = vi.fn().mockResolvedValue(0);

    const { dispose } = startCleanupTimers(repo, expireFn, cleanupFn);

    // Flush the initial fire-and-forget
    await vi.advanceTimersByTimeAsync(0);

    // Advance to first confirmation interval
    await vi.advanceTimersByTimeAsync(CONFIRMATION_CLEANUP_INTERVAL_MS);
    expect(expireFn).toHaveBeenCalledTimes(1);

    // Advance another interval
    await vi.advanceTimersByTimeAsync(CONFIRMATION_CLEANUP_INTERVAL_MS);
    expect(expireFn).toHaveBeenCalledTimes(2);

    dispose();
  });

  it('should call execution cleanup on execution interval', async () => {
    const repo = createMockRepo(0);
    const expireFn = vi.fn().mockResolvedValue(0);
    const cleanupFn = vi.fn().mockResolvedValue(0);

    const { dispose } = startCleanupTimers(repo, expireFn, cleanupFn);

    // Flush initial
    await vi.advanceTimersByTimeAsync(0);
    expect(cleanupFn).toHaveBeenCalledTimes(1); // initial fire-and-forget

    // Advance to first execution cleanup interval
    await vi.advanceTimersByTimeAsync(EXECUTION_CLEANUP_INTERVAL_MS);
    expect(cleanupFn).toHaveBeenCalledTimes(2); // initial + first interval

    dispose();
  });

  it('should use default cleanupOldExecutions when no custom function provided', async () => {
    const repo = createMockRepo(3);
    const expireFn = vi.fn().mockResolvedValue(0);

    const { dispose } = startCleanupTimers(repo, expireFn);

    // Flush initial fire-and-forget (calls the default cleanupOldExecutions → repo.deleteExecutionsBefore)
    await vi.advanceTimersByTimeAsync(0);

    expect(repo.deleteExecutionsBefore).toHaveBeenCalledTimes(1);
    dispose();
  });

  it('should stop timers after dispose()', async () => {
    const repo = createMockRepo(0);
    const expireFn = vi.fn().mockResolvedValue(0);
    const cleanupFn = vi.fn().mockResolvedValue(0);

    const { dispose } = startCleanupTimers(repo, expireFn, cleanupFn);

    // Flush initial
    await vi.advanceTimersByTimeAsync(0);
    expect(cleanupFn).toHaveBeenCalledTimes(1);

    // Dispose
    dispose();

    // Advance past both intervals — no additional calls
    await vi.advanceTimersByTimeAsync(EXECUTION_CLEANUP_INTERVAL_MS + CONFIRMATION_CLEANUP_INTERVAL_MS);
    expect(cleanupFn).toHaveBeenCalledTimes(1); // still 1
    expect(expireFn).toHaveBeenCalledTimes(0); // still 0
  });

  it('should not throw when expirePendingConfirmations rejects', async () => {
    const repo = createMockRepo(0);
    const expireFn = vi.fn().mockRejectedValue(new Error('DB error'));
    const cleanupFn = vi.fn().mockResolvedValue(0);

    const { dispose } = startCleanupTimers(repo, expireFn, cleanupFn);

    // Advance to trigger expireFn
    await vi.advanceTimersByTimeAsync(CONFIRMATION_CLEANUP_INTERVAL_MS);

    // Should not throw — error is caught internally
    expect(expireFn).toHaveBeenCalledTimes(1);
    dispose();
  });

  it('should not throw when execution cleanup rejects', async () => {
    const repo = createMockRepo(0);
    const expireFn = vi.fn().mockResolvedValue(0);
    const cleanupFn = vi.fn().mockRejectedValue(new Error('Cleanup failed'));

    const { dispose } = startCleanupTimers(repo, expireFn, cleanupFn);

    // Initial fire-and-forget should not throw
    await vi.advanceTimersByTimeAsync(0);

    // Interval cleanup should also not throw
    await vi.advanceTimersByTimeAsync(EXECUTION_CLEANUP_INTERVAL_MS);

    expect(cleanupFn).toHaveBeenCalledTimes(2); // initial + interval
    dispose();
  });

  it('should call dispose() multiple times safely', async () => {
    const repo = createMockRepo(0);
    const expireFn = vi.fn().mockResolvedValue(0);
    const cleanupFn = vi.fn().mockResolvedValue(0);

    const { dispose } = startCleanupTimers(repo, expireFn, cleanupFn);
    await vi.advanceTimersByTimeAsync(0);

    // Double dispose should not throw
    dispose();
    dispose();

    // Timers should still be stopped
    await vi.advanceTimersByTimeAsync(EXECUTION_CLEANUP_INTERVAL_MS);
    expect(cleanupFn).toHaveBeenCalledTimes(1); // only the initial
  });
});
