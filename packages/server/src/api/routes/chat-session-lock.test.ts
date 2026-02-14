// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Unit tests for chat-session-lock module.
 * Tests per-session serialization lock in isolation.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  SESSION_LOCK_TIMEOUT_MS,
  acquireSessionLock,
  _resetSessionLocks,
  _hasSessionLock,
  _getSessionLock,
} from "./chat-session-lock.js";

describe("chat-session-lock", () => {
  beforeEach(() => {
    _resetSessionLocks();
  });

  describe("constants", () => {
    it("SESSION_LOCK_TIMEOUT_MS should be 30 seconds", () => {
      expect(SESSION_LOCK_TIMEOUT_MS).toBe(30_000);
    });
  });

  describe("acquireSessionLock", () => {
    it("should acquire lock and track it", async () => {
      const release = await acquireSessionLock("s1");
      expect(_hasSessionLock("s1")).toBe(true);
      release();
    });

    it("should clean up lock on release", async () => {
      const release = await acquireSessionLock("s1");
      release();
      expect(_hasSessionLock("s1")).toBe(false);
    });

    it("should be idempotent — double release is safe", async () => {
      const release = await acquireSessionLock("s1");
      release();
      release(); // should not throw
      expect(_hasSessionLock("s1")).toBe(false);
    });

    it("should serialize same-session requests", async () => {
      const order: number[] = [];

      const release1 = await acquireSessionLock("s1");
      order.push(1);

      // Second acquire should block until release1
      const acquire2 = acquireSessionLock("s1").then((release) => {
        order.push(2);
        release();
      });

      // Give the event loop a tick — acquire2 should still be waiting
      await new Promise((r) => setTimeout(r, 10));
      expect(order).toEqual([1]);

      release1();
      await acquire2;
      expect(order).toEqual([1, 2]);
    });

    it("should not block different sessions", async () => {
      const release1 = await acquireSessionLock("s1");
      const release2 = await acquireSessionLock("s2");

      expect(_hasSessionLock("s1")).toBe(true);
      expect(_hasSessionLock("s2")).toBe(true);

      release1();
      release2();
    });

    it("should not delete another request lock on release after timeout", async () => {
      vi.useFakeTimers();

      // Acquire lock A (simulates a hung request — never released)
      const releaseA = await acquireSessionLock("s1");
      const lockA = _getSessionLock("s1");

      // Acquire lock B — will wait then timeout on A
      let releaseB: (() => void) | undefined;
      const acquireB = acquireSessionLock("s1").then((r) => {
        releaseB = r;
      });

      // Advance past timeout so B acquires
      await vi.advanceTimersByTimeAsync(SESSION_LOCK_TIMEOUT_MS + 100);
      await acquireB;

      const lockB = _getSessionLock("s1");
      expect(lockB).not.toBe(lockA);

      // A releases late — should NOT delete B's lock
      releaseA();
      expect(_hasSessionLock("s1")).toBe(true);
      expect(_getSessionLock("s1")).toBe(lockB);

      releaseB!();
      vi.useRealTimers();
    });
  });

  describe("test helpers", () => {
    it("_resetSessionLocks should clear all locks", async () => {
      await acquireSessionLock("s1");
      await acquireSessionLock("s2");
      _resetSessionLocks();
      expect(_hasSessionLock("s1")).toBe(false);
      expect(_hasSessionLock("s2")).toBe(false);
    });

    it("_getSessionLock should return the lock Promise", async () => {
      const release = await acquireSessionLock("s1");
      const lock = _getSessionLock("s1");
      expect(lock).toBeInstanceOf(Promise);
      release();
    });

    it("_getSessionLock should return undefined for unknown session", () => {
      expect(_getSessionLock("unknown")).toBeUndefined();
    });
  });
});
