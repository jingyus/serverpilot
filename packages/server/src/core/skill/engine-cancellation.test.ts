// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for RunningExecutionTracker — basic operations, skill-server mutex,
 * SkillAlreadyRunningError, and cancelExecution.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  RunningExecutionTracker,
  SkillAlreadyRunningError,
  cancelExecution,
} from "./engine-cancellation.js";

vi.mock("../../utils/logger.js", () => {
  const l = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { logger: l, createContextLogger: () => ({ ...l }) };
});
vi.mock("./skill-event-bus.js", () => ({
  getSkillEventBus: () => ({
    publish: vi.fn(),
    subscribe: vi.fn(() => vi.fn()),
    listenerCount: vi.fn(() => 0),
    removeAll: vi.fn(),
  }),
}));

let tracker: RunningExecutionTracker;

beforeEach(() => {
  tracker = new RunningExecutionTracker();
});

// ============================================================================
// Basic execution tracking (existing functionality)
// ============================================================================

describe("RunningExecutionTracker — basic tracking", () => {
  it("should set and get an AbortController", () => {
    const controller = new AbortController();
    tracker.set("exec-1", controller);
    expect(tracker.has("exec-1")).toBe(true);
    expect(tracker.get("exec-1")).toBe(controller);
  });

  it("should delete a tracked execution", () => {
    tracker.set("exec-1", new AbortController());
    tracker.delete("exec-1");
    expect(tracker.has("exec-1")).toBe(false);
  });

  it("should list all running execution IDs", () => {
    tracker.set("exec-1", new AbortController());
    tracker.set("exec-2", new AbortController());
    expect(tracker.keys()).toEqual(
      expect.arrayContaining(["exec-1", "exec-2"]),
    );
    expect(tracker.keys()).toHaveLength(2);
  });
});

// ============================================================================
// Skill-server concurrency mutex
// ============================================================================

describe("RunningExecutionTracker — skill-server mutex", () => {
  it("should acquire a lock for skill+server combination", () => {
    tracker.acquireSkillServerLock("skill-1", "server-1", "exec-1");
    expect(tracker.isSkillRunningOnServer("skill-1", "server-1")).toBe(true);
    expect(tracker.getSkillServerExecutionId("skill-1", "server-1")).toBe(
      "exec-1",
    );
  });

  it("should throw SkillAlreadyRunningError when same skill+server is already locked", () => {
    tracker.acquireSkillServerLock("skill-1", "server-1", "exec-1");

    expect(() => {
      tracker.acquireSkillServerLock("skill-1", "server-1", "exec-2");
    }).toThrow(SkillAlreadyRunningError);

    try {
      tracker.acquireSkillServerLock("skill-1", "server-1", "exec-2");
    } catch (err) {
      const e = err as SkillAlreadyRunningError;
      expect(e.skillId).toBe("skill-1");
      expect(e.serverId).toBe("server-1");
      expect(e.existingExecutionId).toBe("exec-1");
      expect(e.name).toBe("SkillAlreadyRunningError");
      expect(e.message).toContain("already running");
    }
  });

  it("should allow same skill on different servers", () => {
    tracker.acquireSkillServerLock("skill-1", "server-1", "exec-1");
    // Should not throw
    tracker.acquireSkillServerLock("skill-1", "server-2", "exec-2");

    expect(tracker.isSkillRunningOnServer("skill-1", "server-1")).toBe(true);
    expect(tracker.isSkillRunningOnServer("skill-1", "server-2")).toBe(true);
  });

  it("should allow different skills on the same server", () => {
    tracker.acquireSkillServerLock("skill-1", "server-1", "exec-1");
    // Should not throw
    tracker.acquireSkillServerLock("skill-2", "server-1", "exec-2");

    expect(tracker.isSkillRunningOnServer("skill-1", "server-1")).toBe(true);
    expect(tracker.isSkillRunningOnServer("skill-2", "server-1")).toBe(true);
  });

  it("should release the lock after completion", () => {
    tracker.acquireSkillServerLock("skill-1", "server-1", "exec-1");
    tracker.releaseSkillServerLock("skill-1", "server-1");

    expect(tracker.isSkillRunningOnServer("skill-1", "server-1")).toBe(false);
    expect(
      tracker.getSkillServerExecutionId("skill-1", "server-1"),
    ).toBeUndefined();
  });

  it("should allow re-acquiring a lock after release", () => {
    tracker.acquireSkillServerLock("skill-1", "server-1", "exec-1");
    tracker.releaseSkillServerLock("skill-1", "server-1");

    // Should not throw
    tracker.acquireSkillServerLock("skill-1", "server-1", "exec-2");
    expect(tracker.getSkillServerExecutionId("skill-1", "server-1")).toBe(
      "exec-2",
    );
  });

  it("should report false for non-locked skill+server", () => {
    expect(tracker.isSkillRunningOnServer("skill-1", "server-1")).toBe(false);
    expect(
      tracker.getSkillServerExecutionId("skill-1", "server-1"),
    ).toBeUndefined();
  });

  it("should handle releasing a non-existent lock gracefully", () => {
    // Should not throw
    tracker.releaseSkillServerLock("skill-1", "server-1");
    expect(tracker.isSkillRunningOnServer("skill-1", "server-1")).toBe(false);
  });

  it("should isolate locks correctly for multiple skill+server combinations", () => {
    tracker.acquireSkillServerLock("skill-1", "server-1", "exec-1");
    tracker.acquireSkillServerLock("skill-2", "server-2", "exec-2");
    tracker.acquireSkillServerLock("skill-1", "server-2", "exec-3");

    // Release one, others remain
    tracker.releaseSkillServerLock("skill-1", "server-1");

    expect(tracker.isSkillRunningOnServer("skill-1", "server-1")).toBe(false);
    expect(tracker.isSkillRunningOnServer("skill-2", "server-2")).toBe(true);
    expect(tracker.isSkillRunningOnServer("skill-1", "server-2")).toBe(true);
  });
});

// ============================================================================
// SkillAlreadyRunningError
// ============================================================================

describe("SkillAlreadyRunningError", () => {
  it("should have correct properties", () => {
    const err = new SkillAlreadyRunningError("skill-a", "server-b", "exec-c");
    expect(err.name).toBe("SkillAlreadyRunningError");
    expect(err.skillId).toBe("skill-a");
    expect(err.serverId).toBe("server-b");
    expect(err.existingExecutionId).toBe("exec-c");
    expect(err.message).toContain("skill-a");
    expect(err.message).toContain("server-b");
    expect(err.message).toContain("exec-c");
  });

  it("should be an instance of Error", () => {
    const err = new SkillAlreadyRunningError("s1", "s2", "e1");
    expect(err instanceof Error).toBe(true);
    expect(err instanceof SkillAlreadyRunningError).toBe(true);
  });
});

// ============================================================================
// cancelExecution + lock interaction
// ============================================================================

describe("cancelExecution", () => {
  it("should abort a running execution", () => {
    const controller = new AbortController();
    tracker.set("exec-1", controller);

    cancelExecution(tracker, "exec-1");
    expect(controller.signal.aborted).toBe(true);
  });

  it("should throw if execution is not found", () => {
    expect(() => cancelExecution(tracker, "nonexistent")).toThrow(
      "Execution not found or not running",
    );
  });
});
