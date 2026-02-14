// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Unit tests for chat-confirmations module.
 * Tests confirmation state management in isolation.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

vi.mock("../../core/session/manager.js", () => ({
  getSessionManager: vi.fn(() => ({
    getSessionFromCache: vi.fn(() => null),
  })),
}));
vi.mock("./chat-execution.js", () => ({
  hasActiveExecution: vi.fn(() => false),
}));

import { getSessionManager } from "../../core/session/manager.js";
import {
  CONFIRM_TIMEOUT_MS,
  RECENTLY_EXPIRED_TTL_MS,
  setPendingConfirmation,
  getPendingConfirmation,
  deletePendingConfirmation,
  isRecentlyExpired,
  addRecentlyExpired,
  scheduleRecentlyExpiredCleanup,
  cleanupSessionConfirmations,
  hasActiveSessionWork,
  safeWriteSSE,
  createConfirmation,
  _resetPendingConfirmations,
  _setPendingConfirmation,
  _hasPendingConfirmation,
  _addRecentlyExpired,
  _hasRecentlyExpired,
} from "./chat-confirmations.js";
import { hasActiveExecution } from "./chat-execution.js";

describe("chat-confirmations", () => {
  beforeEach(() => {
    _resetPendingConfirmations();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("constants", () => {
    it("CONFIRM_TIMEOUT_MS should be 5 minutes", () => {
      expect(CONFIRM_TIMEOUT_MS).toBe(5 * 60 * 1000);
    });

    it("RECENTLY_EXPIRED_TTL_MS should be 10 seconds", () => {
      expect(RECENTLY_EXPIRED_TTL_MS).toBe(10_000);
    });
  });

  describe("setPendingConfirmation / getPendingConfirmation / deletePendingConfirmation", () => {
    it("should store and retrieve a pending confirmation", () => {
      const resolve = vi.fn();
      const timer = setTimeout(() => {}, 1000);
      setPendingConfirmation("s1:c1", resolve, timer);

      const pending = getPendingConfirmation("s1:c1");
      expect(pending).toBeDefined();
      expect(pending!.resolve).toBe(resolve);
      expect(pending!.timer).toBe(timer);
      clearTimeout(timer);
    });

    it("should return undefined for nonexistent confirmation", () => {
      expect(getPendingConfirmation("nonexistent")).toBeUndefined();
    });

    it("should delete a pending confirmation", () => {
      const resolve = vi.fn();
      const timer = setTimeout(() => {}, 1000);
      setPendingConfirmation("s1:c1", resolve, timer);

      deletePendingConfirmation("s1:c1");
      expect(getPendingConfirmation("s1:c1")).toBeUndefined();
      clearTimeout(timer);
    });
  });

  describe("isRecentlyExpired / addRecentlyExpired", () => {
    it("should track recently expired confirmIds", () => {
      expect(isRecentlyExpired("s1:c1")).toBe(false);
      addRecentlyExpired("s1:c1");
      expect(isRecentlyExpired("s1:c1")).toBe(true);
    });
  });

  describe("scheduleRecentlyExpiredCleanup", () => {
    it("should remove entry after RECENTLY_EXPIRED_TTL_MS", () => {
      addRecentlyExpired("s1:c1");
      scheduleRecentlyExpiredCleanup("s1:c1");

      expect(isRecentlyExpired("s1:c1")).toBe(true);
      vi.advanceTimersByTime(RECENTLY_EXPIRED_TTL_MS);
      expect(isRecentlyExpired("s1:c1")).toBe(false);
    });

    it("should not remove other entries", () => {
      addRecentlyExpired("s1:c1");
      addRecentlyExpired("s1:c2");
      scheduleRecentlyExpiredCleanup("s1:c1");

      vi.advanceTimersByTime(RECENTLY_EXPIRED_TTL_MS);
      expect(isRecentlyExpired("s1:c1")).toBe(false);
      expect(isRecentlyExpired("s1:c2")).toBe(true);
    });
  });

  describe("cleanupSessionConfirmations", () => {
    it("should clean up all confirmations for a session", () => {
      const resolve1 = vi.fn();
      const resolve2 = vi.fn();
      const timer1 = setTimeout(() => {}, 1000);
      const timer2 = setTimeout(() => {}, 1000);
      setPendingConfirmation("session-a:c1", resolve1, timer1);
      setPendingConfirmation("session-a:c2", resolve2, timer2);

      const cleaned = cleanupSessionConfirmations("session-a");
      expect(cleaned).toBe(2);
      expect(resolve1).toHaveBeenCalledWith(false);
      expect(resolve2).toHaveBeenCalledWith(false);
      expect(getPendingConfirmation("session-a:c1")).toBeUndefined();
      expect(getPendingConfirmation("session-a:c2")).toBeUndefined();
    });

    it("should not affect other sessions", () => {
      const resolveA = vi.fn();
      const resolveB = vi.fn();
      const timerA = setTimeout(() => {}, 1000);
      const timerB = setTimeout(() => {}, 1000);
      setPendingConfirmation("session-a:c1", resolveA, timerA);
      setPendingConfirmation("session-b:c1", resolveB, timerB);

      cleanupSessionConfirmations("session-a");
      expect(resolveA).toHaveBeenCalledWith(false);
      expect(resolveB).not.toHaveBeenCalled();
      expect(getPendingConfirmation("session-b:c1")).toBeDefined();
      clearTimeout(timerB);
    });

    it("should return 0 when no confirmations exist", () => {
      expect(cleanupSessionConfirmations("nonexistent")).toBe(0);
    });
  });

  describe("hasActiveSessionWork", () => {
    it("should return true when pending confirmations exist for session", () => {
      const timer = setTimeout(() => {}, 1000);
      setPendingConfirmation("session-x:c1", vi.fn(), timer);

      expect(hasActiveSessionWork("session-x")).toBe(true);
      clearTimeout(timer);
    });

    it("should return false when no work exists", () => {
      expect(hasActiveSessionWork("session-x")).toBe(false);
    });

    it("should check active plan executions when session is in cache", () => {
      const mockSession = {
        plans: new Map([["plan-1", {}]]),
      };
      vi.mocked(getSessionManager).mockReturnValue({
        getSessionFromCache: vi.fn(() => mockSession),
      } as ReturnType<typeof getSessionManager>);
      vi.mocked(hasActiveExecution).mockReturnValue(true);

      expect(hasActiveSessionWork("session-y")).toBe(true);
      expect(hasActiveExecution).toHaveBeenCalledWith("plan-1");
    });
  });

  describe("test helpers", () => {
    it("_setPendingConfirmation should inject a confirmation", () => {
      const resolve = vi.fn();
      const timer = setTimeout(() => {}, 1000);
      _setPendingConfirmation("test:1", resolve, timer);
      expect(_hasPendingConfirmation("test:1")).toBe(true);
      clearTimeout(timer);
    });

    it("_resetPendingConfirmations should clear all state", () => {
      const timer = setTimeout(() => {}, 1000);
      _setPendingConfirmation("test:1", vi.fn(), timer);
      _addRecentlyExpired("test:2");

      _resetPendingConfirmations();
      expect(_hasPendingConfirmation("test:1")).toBe(false);
      expect(_hasRecentlyExpired("test:2")).toBe(false);
    });
  });

  describe("createConfirmation", () => {
    it("should create a pending confirmation and return confirmId", () => {
      const { confirmId } = createConfirmation("session-x:uuid-1");
      expect(confirmId).toBe("session-x:uuid-1");
      expect(_hasPendingConfirmation("session-x:uuid-1")).toBe(true);
    });

    it("should resolve false on timeout", async () => {
      const { approved } = createConfirmation("session-x:uuid-2");
      vi.advanceTimersByTime(5 * 60 * 1000);
      const result = await approved;
      expect(result).toBe(false);
      expect(_hasPendingConfirmation("session-x:uuid-2")).toBe(false);
    });

    it("should track expired confirmId after timeout", async () => {
      const { approved } = createConfirmation("session-x:uuid-3");
      vi.advanceTimersByTime(5 * 60 * 1000);
      await approved;
      expect(_hasRecentlyExpired("session-x:uuid-3")).toBe(true);
    });
  });

  describe("safeWriteSSE", () => {
    it("should return true when writeSSE succeeds", async () => {
      const mockStream = { writeSSE: vi.fn().mockResolvedValue(undefined) };
      const result = await safeWriteSSE(
        mockStream as never,
        "message",
        JSON.stringify({ content: "hello" }),
      );
      expect(result).toBe(true);
      expect(mockStream.writeSSE).toHaveBeenCalledWith({
        event: "message",
        data: JSON.stringify({ content: "hello" }),
      });
    });

    it("should return false and not throw when writeSSE fails", async () => {
      const mockStream = {
        writeSSE: vi.fn().mockRejectedValue(new Error("stream closed")),
      };
      const result = await safeWriteSSE(
        mockStream as never,
        "complete",
        JSON.stringify({ success: false }),
      );
      expect(result).toBe(false);
    });

    it("should handle non-Error throw values", async () => {
      const mockStream = {
        writeSSE: vi.fn().mockRejectedValue("string error"),
      };
      const result = await safeWriteSSE(mockStream as never, "complete", "{}");
      expect(result).toBe(false);
    });
  });
});
