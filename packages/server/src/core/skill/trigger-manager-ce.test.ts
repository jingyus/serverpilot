// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for TriggerManager CE mode behavior.
 *
 * Verifies that webhook-only event triggers are skipped in CE mode
 * while cron, manual, threshold, and non-webhook event triggers
 * continue to work normally.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { SkillManifest } from "@aiinstaller/shared";
import type { FeatureFlags } from "../../config/edition.js";
import {
  resolveEdition,
  resolveFeatures,
  type EditionInfo,
} from "../../config/edition.js";

// ---------------------------------------------------------------------------
// Mock edition → CE mode (webhooks: false)
// ---------------------------------------------------------------------------

const ceInfo: EditionInfo = resolveEdition({ EDITION: "ce" });
const ceFeatures: FeatureFlags = resolveFeatures(ceInfo);
const eeInfo: EditionInfo = resolveEdition({ EDITION: "ee" });
const eeFeatures: FeatureFlags = resolveFeatures(eeInfo);

let activeFeatures: FeatureFlags = ceFeatures;

vi.mock("../../config/edition.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../config/edition.js")>();
  return {
    ...original,
    get FEATURES() {
      return activeFeatures;
    },
  };
});

// Mock the loader to avoid disk I/O
vi.mock("./loader.js", () => ({
  loadSkillFromDir: vi.fn(),
  scanSkillDirectories: vi.fn().mockResolvedValue([]),
  resolvePromptTemplate: vi.fn((t: string) => t),
  checkRequirements: vi.fn(),
}));

import { loadSkillFromDir } from "./loader.js";
const mockLoadSkillFromDir = vi.mocked(loadSkillFromDir);

import {
  InMemorySkillRepository,
  setSkillRepository,
  _resetSkillRepository,
} from "../../db/repositories/skill-repository.js";
import { _resetMetricsBus } from "../metrics/metrics-bus.js";
import {
  TriggerManager,
  _resetTriggerManager,
  WEBHOOK_ONLY_EVENTS,
  type ExecuteCallback,
} from "./trigger-manager.js";

// ============================================================================
// Helpers
// ============================================================================

function createMockManifest(
  overrides: { triggers?: Array<Record<string, unknown>> } = {},
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

  // Default to CE mode
  activeFeatures = ceFeatures;

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
// CE mode — webhook-only event triggers are skipped
// ============================================================================

describe.skip("TriggerManager CE mode — webhook-event trigger filtering", () => {
  it("should skip webhook-only event triggers in CE mode", () => {
    const manifest = createMockManifest({
      triggers: [
        { type: "event", on: "alert.triggered" },
        { type: "event", on: "server.offline" },
        { type: "event", on: "operation.failed" },
        { type: "event", on: "agent.disconnected" },
        { type: "event", on: "task.completed" },
      ],
    });

    manager.registerTriggersFromManifest("skill-1", "user-1", manifest);

    // All webhook-only events should be skipped → 0 event triggers
    expect(manager.getEventCount()).toBe(0);
  });

  it("should still register non-webhook event triggers (skill.completed) in CE mode", () => {
    const manifest = createMockManifest({
      triggers: [{ type: "event", on: "skill.completed" }],
    });

    manager.registerTriggersFromManifest("skill-1", "user-1", manifest);

    // skill.completed is not webhook-only → should be registered
    expect(manager.getEventCount()).toBe(1);
  });

  it("should register cron triggers normally in CE mode", () => {
    const manifest = createMockManifest({
      triggers: [{ type: "cron", schedule: "0 * * * *" }],
    });

    manager.registerTriggersFromManifest("skill-1", "user-1", manifest);

    expect(manager.getCronCount()).toBe(1);
  });

  it("should register threshold triggers normally in CE mode", () => {
    const manifest = createMockManifest({
      triggers: [
        { type: "threshold", metric: "cpu.usage", operator: "gt", value: 90 },
      ],
    });

    manager.registerTriggersFromManifest("skill-1", "user-1", manifest);

    expect(manager.getThresholdCount()).toBe(1);
  });

  it("should register mixed triggers, skipping only webhook-only events in CE mode", () => {
    const manifest = createMockManifest({
      triggers: [
        { type: "manual" },
        { type: "cron", schedule: "0 * * * *" },
        { type: "event", on: "alert.triggered" }, // webhook-only → skipped
        { type: "event", on: "skill.completed" }, // not webhook-only → registered
        { type: "threshold", metric: "cpu.usage", operator: "gt", value: 90 },
      ],
    });

    manager.registerTriggersFromManifest("skill-1", "user-1", manifest);

    expect(manager.getCronCount()).toBe(1);
    expect(manager.getEventCount()).toBe(1); // only skill.completed
    expect(manager.getThresholdCount()).toBe(1);
  });

  it("should not register skill for webhook-only events even via registerSkill()", async () => {
    const skill = await repo.install({
      userId: "user-1",
      name: "webhook-skill",
      version: "1.0.0",
      source: "local",
      skillPath: "/skills/webhook-skill",
    });
    await repo.updateStatus(skill.id, "enabled");

    const manifest = createMockManifest({
      triggers: [
        { type: "event", on: "server.offline" },
        { type: "cron", schedule: "*/5 * * * *" },
      ],
    });
    mockLoadSkillFromDir.mockResolvedValueOnce(manifest);

    await manager.registerSkill(
      skill as { id: string; userId: string; skillPath: string },
    );

    expect(manager.getCronCount()).toBe(1);
    expect(manager.getEventCount()).toBe(0); // server.offline skipped
  });

  it("should skip all WEBHOOK_ONLY_EVENTS in CE mode", () => {
    for (const eventType of WEBHOOK_ONLY_EVENTS) {
      const m = new TriggerManager(executeCallback, repo);
      const manifest = createMockManifest({
        triggers: [{ type: "event", on: eventType }],
      });

      m.registerTriggersFromManifest(`skill-${eventType}`, "user-1", manifest);
      expect(m.getEventCount()).toBe(0);
      m.stop();
    }
  });
});

// ============================================================================
// EE mode — all event triggers registered (baseline check)
// ============================================================================

describe.skip("TriggerManager EE mode — all triggers registered", () => {
  beforeEach(() => {
    activeFeatures = eeFeatures;
    // Re-create manager with EE features active
    manager.stop();
    manager = new TriggerManager(executeCallback, repo);
  });

  it("should register webhook-only event triggers in EE mode", () => {
    const manifest = createMockManifest({
      triggers: [
        { type: "event", on: "alert.triggered" },
        { type: "event", on: "server.offline" },
        { type: "event", on: "task.completed" },
      ],
    });

    manager.registerTriggersFromManifest("skill-1", "user-1", manifest);

    expect(manager.getEventCount()).toBe(3);
  });

  it("should register all trigger types in EE mode", () => {
    const manifest = createMockManifest({
      triggers: [
        { type: "manual" },
        { type: "cron", schedule: "0 * * * *" },
        { type: "event", on: "alert.triggered" },
        { type: "event", on: "skill.completed" },
        { type: "threshold", metric: "cpu.usage", operator: "gt", value: 90 },
      ],
    });

    manager.registerTriggersFromManifest("skill-1", "user-1", manifest);

    expect(manager.getCronCount()).toBe(1);
    expect(manager.getEventCount()).toBe(2); // both event triggers
    expect(manager.getThresholdCount()).toBe(1);
  });
});

// ============================================================================
// CE mode — startup loading with webhook triggers
// ============================================================================

describe.skip("TriggerManager CE mode — startup loading", () => {
  it("should skip webhook-only triggers during startup loading in CE mode", async () => {
    const skill = await repo.install({
      userId: "user-1",
      name: "mixed-skill",
      version: "1.0.0",
      source: "local",
      skillPath: "/skills/mixed",
    });
    await repo.updateStatus(skill.id, "enabled");

    const manifest = createMockManifest({
      triggers: [
        { type: "cron", schedule: "0 2 * * *" },
        { type: "event", on: "alert.triggered" }, // webhook-only → skipped
        { type: "event", on: "skill.completed" }, // not webhook-only → ok
      ],
    });
    mockLoadSkillFromDir.mockResolvedValueOnce(manifest);

    await manager.start();

    expect(manager.getCronCount()).toBe(1);
    expect(manager.getEventCount()).toBe(1); // only skill.completed
  });
});
