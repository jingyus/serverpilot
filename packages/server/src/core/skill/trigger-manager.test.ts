// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for TriggerManager — lifecycle, debounce, register/unregister, singleton, error handling, startup loading.
 * Cron/event/threshold tests in trigger-manager-triggers.test.ts.
 * Chain/subscribeToDispatcher tests in trigger-manager-advanced.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { SkillManifest } from "@aiinstaller/shared";
import {
  InMemorySkillRepository,
  setSkillRepository,
  _resetSkillRepository,
} from "../../db/repositories/skill-repository.js";
import { _resetMetricsBus } from "../metrics/metrics-bus.js";
import {
  TriggerManager,
  getTriggerManager,
  setTriggerManager,
  _resetTriggerManager,
  MAX_CONSECUTIVE_FAILURES,
  type ExecuteCallback,
} from "./trigger-manager.js";

// Mock the loader to avoid disk I/O in tests
vi.mock("./loader.js", () => ({
  loadSkillFromDir: vi.fn(),
  scanSkillDirectories: vi.fn().mockResolvedValue([]),
  resolvePromptTemplate: vi.fn((t: string) => t),
  checkRequirements: vi.fn(),
}));

import { loadSkillFromDir } from "./loader.js";
const mockLoadSkillFromDir = vi.mocked(loadSkillFromDir);

// ============================================================================
// Helpers
// ============================================================================

function createMockManifest(
  overrides: {
    triggers?: Array<Record<string, unknown>>;
  } = {},
): SkillManifest {
  return {
    kind: "skill",
    version: "1.0",
    metadata: {
      name: "test-skill",
      displayName: "Test Skill",
      version: "1.0.0",
    },
    triggers: (overrides.triggers ?? [
      { type: "manual" },
    ]) as SkillManifest["triggers"],
    tools: ["shell"],
    constraints: {
      risk_level_max: "yellow",
      timeout: "5m",
      max_steps: 20,
      requires_confirmation: false,
      server_scope: "single",
    },
    prompt:
      "A test prompt that is long enough to pass the 50-character validation requirement for skill manifests.",
  };
}

let executeCallback: ReturnType<typeof vi.fn>;
let manager: TriggerManager;
let repo: InMemorySkillRepository;

beforeEach(() => {
  _resetTriggerManager();
  _resetSkillRepository();
  _resetMetricsBus();

  executeCallback = vi
    .fn<Parameters<ExecuteCallback>, ReturnType<ExecuteCallback>>()
    .mockResolvedValue(undefined);
  repo = new InMemorySkillRepository();
  setSkillRepository(repo);
  mockLoadSkillFromDir.mockReset();

  manager = new TriggerManager(executeCallback, repo);
});

afterEach(() => {
  manager.stop();
  _resetTriggerManager();
  _resetSkillRepository();
  _resetMetricsBus();
});

// ============================================================================
// Lifecycle
// ============================================================================

describe("TriggerManager lifecycle", () => {
  it("should start and stop without error", async () => {
    await manager.start();
    expect(manager.isRunning()).toBe(true);

    manager.stop();
    expect(manager.isRunning()).toBe(false);
  });

  it("should be idempotent on start", async () => {
    await manager.start();
    await manager.start(); // second call should be no-op
    expect(manager.isRunning()).toBe(true);
  });

  it("should be idempotent on stop", async () => {
    await manager.start();
    manager.stop();
    manager.stop(); // second call should be no-op
    expect(manager.isRunning()).toBe(false);
  });

  it("should clear all registrations on stop", async () => {
    await manager.start();

    const manifest = createMockManifest({
      triggers: [
        { type: "cron", schedule: "0 8 * * *" },
        { type: "event", on: "alert.triggered" },
        { type: "threshold", metric: "cpu.usage", operator: "gt", value: 90 },
      ],
    });
    manager.registerTriggersFromManifest("skill-1", "user-1", manifest);

    expect(manager.getCronCount()).toBe(1);
    expect(manager.getEventCount()).toBe(1);
    expect(manager.getThresholdCount()).toBe(1);

    manager.stop();

    expect(manager.getCronCount()).toBe(0);
    expect(manager.getEventCount()).toBe(0);
    expect(manager.getThresholdCount()).toBe(0);
  });
});

// ============================================================================
// Debounce
// ============================================================================

describe("TriggerManager debounce", () => {
  it("should debounce same skill+server within 5 minutes", async () => {
    const manifest = createMockManifest({
      triggers: [{ type: "event", on: "alert.triggered" }],
    });

    manager.registerTriggersFromManifest("skill-1", "user-1", manifest);

    // First event triggers
    await manager.handleEvent("alert.triggered", { serverId: "server-1" });
    expect(executeCallback).toHaveBeenCalledTimes(1);

    // Second event within debounce window — should be suppressed
    await manager.handleEvent("alert.triggered", { serverId: "server-1" });
    expect(executeCallback).toHaveBeenCalledTimes(1);
  });

  it("should allow same skill on different servers", async () => {
    const manifest = createMockManifest({
      triggers: [{ type: "event", on: "alert.triggered" }],
    });

    manager.registerTriggersFromManifest("skill-1", "user-1", manifest);

    await manager.handleEvent("alert.triggered", { serverId: "server-1" });
    await manager.handleEvent("alert.triggered", { serverId: "server-2" });

    expect(executeCallback).toHaveBeenCalledTimes(2);
  });

  it("should allow triggering after debounce expires", async () => {
    const manifest = createMockManifest({
      triggers: [{ type: "event", on: "alert.triggered" }],
    });

    manager.registerTriggersFromManifest("skill-1", "user-1", manifest);

    // First event
    await manager.handleEvent("alert.triggered", { serverId: "server-1" });
    expect(executeCallback).toHaveBeenCalledTimes(1);

    // Manually expire debounce (set timestamp to 6 minutes ago)
    const debounceMap = (
      manager as unknown as { debounce: { debounceMap: Map<string, number> } }
    ).debounce.debounceMap;
    debounceMap.set("skill-1:server-1", Date.now() - 6 * 60 * 1000);

    // Second event after debounce window
    await manager.handleEvent("alert.triggered", { serverId: "server-1" });
    expect(executeCallback).toHaveBeenCalledTimes(2);
  });

  it("should clear debounce entries when unregistering skill", () => {
    const manifest = createMockManifest({
      triggers: [{ type: "event", on: "alert.triggered" }],
    });

    manager.registerTriggersFromManifest("skill-1", "user-1", manifest);

    // Record debounce manually
    const debounceMap = (
      manager as unknown as { debounce: { debounceMap: Map<string, number> } }
    ).debounce.debounceMap;
    debounceMap.set("skill-1:server-1", Date.now());
    debounceMap.set("skill-1:server-2", Date.now());
    debounceMap.set("skill-2:server-1", Date.now()); // different skill, should remain

    manager.unregisterSkill("skill-1");

    expect(debounceMap.has("skill-1:server-1")).toBe(false);
    expect(debounceMap.has("skill-1:server-2")).toBe(false);
    expect(debounceMap.has("skill-2:server-1")).toBe(true);
  });
});

// ============================================================================
// Registration / Unregistration
// ============================================================================

describe("TriggerManager register/unregister", () => {
  it("should register multiple trigger types from one manifest", () => {
    const manifest = createMockManifest({
      triggers: [
        { type: "manual" },
        { type: "cron", schedule: "0 * * * *" },
        { type: "event", on: "server.offline" },
        { type: "threshold", metric: "cpu.usage", operator: "gt", value: 90 },
      ],
    });

    manager.registerTriggersFromManifest("skill-1", "user-1", manifest);

    expect(manager.getCronCount()).toBe(1);
    expect(manager.getEventCount()).toBe(1);
    expect(manager.getThresholdCount()).toBe(1);
  });

  it("should unregister all triggers for a skill", () => {
    const manifest = createMockManifest({
      triggers: [
        { type: "cron", schedule: "0 * * * *" },
        { type: "event", on: "server.offline" },
        { type: "threshold", metric: "cpu.usage", operator: "gt", value: 90 },
      ],
    });

    manager.registerTriggersFromManifest("skill-1", "user-1", manifest);
    expect(manager.getCronCount()).toBe(1);

    manager.unregisterSkill("skill-1");

    expect(manager.getCronCount()).toBe(0);
    expect(manager.getEventCount()).toBe(0);
    expect(manager.getThresholdCount()).toBe(0);
  });

  it("should only unregister the target skill, not others", () => {
    const manifest1 = createMockManifest({
      triggers: [
        { type: "cron", schedule: "0 * * * *" },
        { type: "event", on: "server.offline" },
      ],
    });
    const manifest2 = createMockManifest({
      triggers: [
        { type: "cron", schedule: "*/5 * * * *" },
        { type: "event", on: "server.offline" },
      ],
    });

    manager.registerTriggersFromManifest("skill-1", "user-1", manifest1);
    manager.registerTriggersFromManifest("skill-2", "user-1", manifest2);

    expect(manager.getCronCount()).toBe(2);
    expect(manager.getEventCount()).toBe(2);

    manager.unregisterSkill("skill-1");

    expect(manager.getCronCount()).toBe(1);
    expect(manager.getEventCount()).toBe(1);
  });

  it("should handle manual trigger type (no-op)", () => {
    const manifest = createMockManifest({
      triggers: [{ type: "manual" }],
    });

    manager.registerTriggersFromManifest("skill-1", "user-1", manifest);

    expect(manager.getCronCount()).toBe(0);
    expect(manager.getEventCount()).toBe(0);
    expect(manager.getThresholdCount()).toBe(0);
  });
});

// ============================================================================
// Singleton
// ============================================================================

describe("TriggerManager singleton", () => {
  it("should throw when accessed before initialization", () => {
    _resetTriggerManager();
    expect(() => getTriggerManager()).toThrow(/not initialized/);
  });

  it("should return the set instance", () => {
    const mgr = new TriggerManager(executeCallback, repo);
    setTriggerManager(mgr);

    expect(getTriggerManager()).toBe(mgr);

    _resetTriggerManager();
  });

  it("should stop the instance on reset", async () => {
    const mgr = new TriggerManager(executeCallback, repo);
    await mgr.start();
    setTriggerManager(mgr);

    expect(mgr.isRunning()).toBe(true);

    _resetTriggerManager();

    expect(mgr.isRunning()).toBe(false);
  });
});

// ============================================================================
// Error handling
// ============================================================================

describe("TriggerManager error handling", () => {
  it("should not throw when execute callback fails", async () => {
    executeCallback.mockRejectedValueOnce(new Error("Execution failed"));

    const manifest = createMockManifest({
      triggers: [{ type: "event", on: "alert.triggered" }],
    });

    manager.registerTriggersFromManifest("skill-1", "user-1", manifest);

    // Should not throw — error is caught internally
    await manager.handleEvent("alert.triggered", { serverId: "server-1" });

    // Allow promise to settle
    await new Promise((r) => setTimeout(r, 10));

    expect(executeCallback).toHaveBeenCalledTimes(1);
  });

  it("should handle empty event trigger map gracefully", async () => {
    // No triggers registered
    await manager.handleEvent("alert.triggered", { serverId: "server-1" });

    expect(executeCallback).not.toHaveBeenCalled();
  });

  it("should handle cron poll with no jobs gracefully", async () => {
    await manager.pollCronJobs();
    expect(executeCallback).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Startup Loading — findAllEnabled integration
// ============================================================================

describe("TriggerManager startup loading", () => {
  it("should load enabled skills from repo on start and register their triggers", async () => {
    const skill = await repo.install({
      userId: "user-1",
      name: "cron-backup",
      version: "1.0.0",
      source: "local",
      skillPath: "/skills/cron-backup",
    });
    await repo.updateStatus(skill.id, "enabled");

    const manifest = createMockManifest({
      triggers: [{ type: "cron", schedule: "0 2 * * *" }],
    });
    mockLoadSkillFromDir.mockResolvedValueOnce(manifest);

    await manager.start();

    expect(mockLoadSkillFromDir).toHaveBeenCalledWith("/skills/cron-backup");
    expect(manager.getCronCount()).toBe(1);
  });

  it("should not register triggers for non-enabled skills", async () => {
    await repo.install({
      userId: "user-1",
      name: "not-enabled",
      version: "1.0.0",
      source: "local",
      skillPath: "/skills/not-enabled",
    });

    await manager.start();

    expect(mockLoadSkillFromDir).not.toHaveBeenCalled();
    expect(manager.getCronCount()).toBe(0);
    expect(manager.getEventCount()).toBe(0);
    expect(manager.getThresholdCount()).toBe(0);
  });

  it("should load multiple enabled skills on start", async () => {
    const s1 = await repo.install({
      userId: "user-1",
      name: "skill-cron",
      version: "1.0.0",
      source: "local",
      skillPath: "/skills/cron",
    });
    const s2 = await repo.install({
      userId: "user-2",
      name: "skill-event",
      version: "1.0.0",
      source: "local",
      skillPath: "/skills/event",
    });
    await repo.updateStatus(s1.id, "enabled");
    await repo.updateStatus(s2.id, "enabled");

    const cronManifest = createMockManifest({
      triggers: [{ type: "cron", schedule: "*/10 * * * *" }],
    });
    const eventManifest = createMockManifest({
      triggers: [{ type: "event", on: "server.offline" }],
    });

    mockLoadSkillFromDir
      .mockResolvedValueOnce(cronManifest)
      .mockResolvedValueOnce(eventManifest);

    await manager.start();

    expect(manager.getCronCount()).toBe(1);
    expect(manager.getEventCount()).toBe(1);
  });

  it("should gracefully handle manifest load failure for individual skills", async () => {
    const s1 = await repo.install({
      userId: "user-1",
      name: "broken-skill",
      version: "1.0.0",
      source: "local",
      skillPath: "/skills/broken",
    });
    const s2 = await repo.install({
      userId: "user-1",
      name: "good-skill",
      version: "1.0.0",
      source: "local",
      skillPath: "/skills/good",
    });
    await repo.updateStatus(s1.id, "enabled");
    await repo.updateStatus(s2.id, "enabled");

    const goodManifest = createMockManifest({
      triggers: [
        { type: "threshold", metric: "cpu.usage", operator: "gt", value: 80 },
      ],
    });

    mockLoadSkillFromDir
      .mockRejectedValueOnce(new Error("Manifest not found"))
      .mockResolvedValueOnce(goodManifest);

    await manager.start();

    expect(manager.getThresholdCount()).toBe(1);
  });
});

// ============================================================================
// Circuit Breaker — failure tracking & auto-pause
// ============================================================================

describe("TriggerManager circuit breaker", () => {
  it("should increment failure counter on execution failure", async () => {
    executeCallback.mockRejectedValue(new Error("fail"));

    const manifest = createMockManifest({
      triggers: [{ type: "event", on: "alert.triggered" }],
    });
    manager.registerTriggersFromManifest("skill-1", "user-1", manifest);

    await manager.handleEvent("alert.triggered", { serverId: "server-1" });
    await vi.waitFor(() => expect(manager.getFailureCount("skill-1")).toBe(1));
  });

  it("should reset failure counter on successful execution", async () => {
    // First fail, then succeed
    executeCallback
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValueOnce(undefined);

    const manifest = createMockManifest({
      triggers: [{ type: "event", on: "alert.triggered" }],
    });
    manager.registerTriggersFromManifest("skill-1", "user-1", manifest);

    // Trigger first event (fail)
    await manager.handleEvent("alert.triggered", { serverId: "server-1" });
    await vi.waitFor(() => expect(manager.getFailureCount("skill-1")).toBe(1));

    // Expire debounce so second event can fire
    const debounceMap = (
      manager as unknown as { debounce: { debounceMap: Map<string, number> } }
    ).debounce.debounceMap;
    debounceMap.set("skill-1:server-1", Date.now() - 6 * 60 * 1000);

    // Trigger second event (success)
    await manager.handleEvent("alert.triggered", { serverId: "server-1" });
    await vi.waitFor(() => expect(manager.getFailureCount("skill-1")).toBe(0));
  });

  it("should auto-pause skill after MAX_CONSECUTIVE_FAILURES", async () => {
    executeCallback.mockRejectedValue(new Error("fail"));

    const skill = await repo.install({
      userId: "user-1",
      name: "flaky-skill",
      version: "1.0.0",
      source: "local",
      skillPath: "/skills/flaky",
    });
    await repo.updateStatus(skill.id, "enabled");

    const manifest = createMockManifest({
      triggers: [{ type: "event", on: "alert.triggered" }],
    });
    manager.registerTriggersFromManifest(skill.id, "user-1", manifest);

    // Trigger MAX_CONSECUTIVE_FAILURES times (expire debounce between calls)
    const debounceMap = (
      manager as unknown as { debounce: { debounceMap: Map<string, number> } }
    ).debounce.debounceMap;
    for (let i = 0; i < MAX_CONSECUTIVE_FAILURES; i++) {
      debounceMap.delete(`${skill.id}:server-1`);
      await manager.handleEvent("alert.triggered", { serverId: "server-1" });
    }

    // Wait for async operations to complete
    await vi.waitFor(async () => {
      const updated = await repo.findById(skill.id);
      expect(updated?.status).toBe("error");
    });
  });

  it("should unregister triggers after auto-pause", async () => {
    executeCallback.mockRejectedValue(new Error("fail"));

    const skill = await repo.install({
      userId: "user-1",
      name: "auto-pause-skill",
      version: "1.0.0",
      source: "local",
      skillPath: "/skills/auto-pause",
    });
    await repo.updateStatus(skill.id, "enabled");

    const manifest = createMockManifest({
      triggers: [
        { type: "event", on: "alert.triggered" },
        { type: "cron", schedule: "0 * * * *" },
      ],
    });
    manager.registerTriggersFromManifest(skill.id, "user-1", manifest);
    expect(manager.getCronCount()).toBe(1);
    expect(manager.getEventCount()).toBe(1);

    // Trigger enough failures to trip the breaker
    const debounceMap = (
      manager as unknown as { debounce: { debounceMap: Map<string, number> } }
    ).debounce.debounceMap;
    for (let i = 0; i < MAX_CONSECUTIVE_FAILURES; i++) {
      debounceMap.delete(`${skill.id}:server-1`);
      await manager.handleEvent("alert.triggered", { serverId: "server-1" });
    }

    await vi.waitFor(() => {
      expect(manager.getCronCount()).toBe(0);
      expect(manager.getEventCount()).toBe(0);
    });
  });

  it("should not auto-pause before reaching MAX_CONSECUTIVE_FAILURES", async () => {
    executeCallback.mockRejectedValue(new Error("fail"));

    const skill = await repo.install({
      userId: "user-1",
      name: "mostly-okay",
      version: "1.0.0",
      source: "local",
      skillPath: "/skills/mostly-okay",
    });
    await repo.updateStatus(skill.id, "enabled");

    const manifest = createMockManifest({
      triggers: [{ type: "event", on: "alert.triggered" }],
    });
    manager.registerTriggersFromManifest(skill.id, "user-1", manifest);

    // Trigger one less than the threshold
    const debounceMap = (
      manager as unknown as { debounce: { debounceMap: Map<string, number> } }
    ).debounce.debounceMap;
    for (let i = 0; i < MAX_CONSECUTIVE_FAILURES - 1; i++) {
      debounceMap.delete(`${skill.id}:server-1`);
      await manager.handleEvent("alert.triggered", { serverId: "server-1" });
    }

    await new Promise((r) => setTimeout(r, 50));

    const updated = await repo.findById(skill.id);
    expect(updated?.status).toBe("enabled");
    expect(manager.getFailureCount(skill.id)).toBe(
      MAX_CONSECUTIVE_FAILURES - 1,
    );
  });

  it("should reset failure counter via resetFailureCounter()", async () => {
    executeCallback.mockRejectedValue(new Error("fail"));

    const manifest = createMockManifest({
      triggers: [{ type: "event", on: "alert.triggered" }],
    });
    manager.registerTriggersFromManifest("skill-1", "user-1", manifest);

    const debounceMap = (
      manager as unknown as { debounce: { debounceMap: Map<string, number> } }
    ).debounce.debounceMap;
    for (let i = 0; i < 3; i++) {
      debounceMap.delete("skill-1:server-1");
      await manager.handleEvent("alert.triggered", { serverId: "server-1" });
    }

    await vi.waitFor(() => expect(manager.getFailureCount("skill-1")).toBe(3));

    manager.resetFailureCounter("skill-1");
    expect(manager.getFailureCount("skill-1")).toBe(0);
  });

  it("should return 0 for failure count of unknown skill", () => {
    expect(manager.getFailureCount("nonexistent")).toBe(0);
  });

  it("should clear failure counters on stop", async () => {
    executeCallback.mockRejectedValue(new Error("fail"));

    const manifest = createMockManifest({
      triggers: [{ type: "event", on: "alert.triggered" }],
    });
    manager.registerTriggersFromManifest("skill-1", "user-1", manifest);

    await manager.handleEvent("alert.triggered", { serverId: "server-1" });
    await vi.waitFor(() => expect(manager.getFailureCount("skill-1")).toBe(1));

    await manager.start();
    manager.stop();

    expect(manager.getFailureCount("skill-1")).toBe(0);
  });

  it("should track failures independently per skill", async () => {
    executeCallback.mockRejectedValue(new Error("fail"));

    const manifest1 = createMockManifest({
      triggers: [{ type: "event", on: "alert.triggered" }],
    });
    const manifest2 = createMockManifest({
      triggers: [{ type: "event", on: "alert.triggered" }],
    });

    manager.registerTriggersFromManifest("skill-1", "user-1", manifest1);
    manager.registerTriggersFromManifest("skill-2", "user-1", manifest2);

    await manager.handleEvent("alert.triggered", { serverId: "server-1" });

    await vi.waitFor(() => {
      expect(manager.getFailureCount("skill-1")).toBe(1);
      expect(manager.getFailureCount("skill-2")).toBe(1);
    });

    // Reset only skill-1
    manager.resetFailureCounter("skill-1");
    expect(manager.getFailureCount("skill-1")).toBe(0);
    expect(manager.getFailureCount("skill-2")).toBe(1);
  });

  it("should clear failure counter on unregisterSkill", async () => {
    executeCallback.mockRejectedValue(new Error("fail"));

    const manifest = createMockManifest({
      triggers: [{ type: "event", on: "alert.triggered" }],
    });
    manager.registerTriggersFromManifest("skill-1", "user-1", manifest);

    await manager.handleEvent("alert.triggered", { serverId: "server-1" });
    await vi.waitFor(() => expect(manager.getFailureCount("skill-1")).toBe(1));

    manager.unregisterSkill("skill-1");
    expect(manager.getFailureCount("skill-1")).toBe(0);
  });
});
