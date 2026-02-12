// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for TriggerManager — cron, event, threshold triggers + debounce + lifecycle.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  TriggerManager,
  getTriggerManager,
  setTriggerManager,
  _resetTriggerManager,
  type ExecuteCallback,
} from './trigger-manager.js';
import {
  InMemorySkillRepository,
  setSkillRepository,
  _resetSkillRepository,
} from '../../db/repositories/skill-repository.js';
import { getMetricsBus, _resetMetricsBus, type MetricEvent } from '../metrics/metrics-bus.js';

import type { SkillManifest } from '@aiinstaller/shared';

// Mock the loader to avoid disk I/O in tests
vi.mock('./loader.js', () => ({
  loadSkillFromDir: vi.fn(),
  scanSkillDirectories: vi.fn().mockResolvedValue([]),
  resolvePromptTemplate: vi.fn((t: string) => t),
  checkRequirements: vi.fn(),
}));

import { loadSkillFromDir } from './loader.js';
const mockLoadSkillFromDir = vi.mocked(loadSkillFromDir);

// ============================================================================
// Helpers
// ============================================================================

function createMockManifest(overrides: {
  triggers?: Array<Record<string, unknown>>;
} = {}): SkillManifest {
  return {
    kind: 'skill',
    version: '1.0',
    metadata: {
      name: 'test-skill',
      displayName: 'Test Skill',
      version: '1.0.0',
    },
    triggers: (overrides.triggers ?? [{ type: 'manual' }]) as SkillManifest['triggers'],
    tools: ['shell'],
    constraints: {
      risk_level_max: 'yellow',
      timeout: '5m',
      max_steps: 20,
      requires_confirmation: false,
      server_scope: 'single',
    },
    prompt: 'A test prompt that is long enough to pass the 50-character validation requirement for skill manifests.',
  };
}

function createMetricEvent(overrides: Partial<MetricEvent> = {}): MetricEvent {
  return {
    id: 'metric-1',
    serverId: 'server-1',
    cpuUsage: 50,
    memoryUsage: 4_000_000_000,
    memoryTotal: 8_000_000_000,
    diskUsage: 100_000_000_000,
    diskTotal: 500_000_000_000,
    networkIn: 1000,
    networkOut: 2000,
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

let executeCallback: ReturnType<typeof vi.fn>;
let manager: TriggerManager;
let repo: InMemorySkillRepository;

beforeEach(() => {
  _resetTriggerManager();
  _resetSkillRepository();
  _resetMetricsBus();

  executeCallback = vi.fn<Parameters<ExecuteCallback>, ReturnType<ExecuteCallback>>()
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

describe('TriggerManager lifecycle', () => {
  it('should start and stop without error', async () => {
    await manager.start();
    expect(manager.isRunning()).toBe(true);

    manager.stop();
    expect(manager.isRunning()).toBe(false);
  });

  it('should be idempotent on start', async () => {
    await manager.start();
    await manager.start(); // second call should be no-op
    expect(manager.isRunning()).toBe(true);
  });

  it('should be idempotent on stop', async () => {
    await manager.start();
    manager.stop();
    manager.stop(); // second call should be no-op
    expect(manager.isRunning()).toBe(false);
  });

  it('should clear all registrations on stop', async () => {
    await manager.start();

    const manifest = createMockManifest({
      triggers: [
        { type: 'cron', schedule: '0 8 * * *' },
        { type: 'event', on: 'alert.triggered' },
        { type: 'threshold', metric: 'cpu.usage', operator: 'gt', value: 90 },
      ],
    });
    manager.registerTriggersFromManifest('skill-1', 'user-1', manifest);

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
// Cron Triggers
// ============================================================================

describe('TriggerManager cron triggers', () => {
  it('should register a valid cron trigger', () => {
    const manifest = createMockManifest({
      triggers: [{ type: 'cron', schedule: '0 8 * * *' }],
    });

    manager.registerTriggersFromManifest('skill-1', 'user-1', manifest);

    expect(manager.getCronCount()).toBe(1);
  });

  it('should skip invalid cron expression', () => {
    const manifest = createMockManifest({
      triggers: [{ type: 'cron', schedule: 'not-a-cron' }],
    });

    manager.registerTriggersFromManifest('skill-1', 'user-1', manifest);

    expect(manager.getCronCount()).toBe(0);
  });

  it('should execute cron job when poll detects due time', async () => {
    const manifest = createMockManifest({
      triggers: [{ type: 'cron', schedule: '* * * * *' }], // every minute
    });

    manager.registerTriggersFromManifest('skill-1', 'user-1', manifest);

    // Manually set next run time to the past to trigger
    const cronJobs = (manager as unknown as { cronJobs: Map<string, { nextRunAt: Date }> }).cronJobs;
    const job = cronJobs.get('skill-1')!;
    job.nextRunAt = new Date(Date.now() - 1000);

    await manager.pollCronJobs();

    expect(executeCallback).toHaveBeenCalledWith('skill-1', 'cron-trigger', 'user-1', 'cron', undefined);
  });

  it('should not execute cron job before next run time', async () => {
    const manifest = createMockManifest({
      triggers: [{ type: 'cron', schedule: '0 0 1 1 *' }], // once a year
    });

    manager.registerTriggersFromManifest('skill-1', 'user-1', manifest);

    await manager.pollCronJobs();

    expect(executeCallback).not.toHaveBeenCalled();
  });

  it('should advance next run time after execution', async () => {
    const manifest = createMockManifest({
      triggers: [{ type: 'cron', schedule: '* * * * *' }],
    });

    manager.registerTriggersFromManifest('skill-1', 'user-1', manifest);

    const cronJobs = (manager as unknown as { cronJobs: Map<string, { nextRunAt: Date }> }).cronJobs;
    const job = cronJobs.get('skill-1')!;
    job.nextRunAt = new Date(Date.now() - 1000);
    const oldNextRun = job.nextRunAt;

    await manager.pollCronJobs();

    expect(job.nextRunAt.getTime()).toBeGreaterThan(oldNextRun.getTime());
  });
});

// ============================================================================
// Event Triggers
// ============================================================================

describe('TriggerManager event triggers', () => {
  it('should register an event trigger', () => {
    const manifest = createMockManifest({
      triggers: [{ type: 'event', on: 'alert.triggered' }],
    });

    manager.registerTriggersFromManifest('skill-1', 'user-1', manifest);

    expect(manager.getEventCount()).toBe(1);
  });

  it('should trigger execution on matching event', async () => {
    const manifest = createMockManifest({
      triggers: [{ type: 'event', on: 'server.offline' }],
    });

    manager.registerTriggersFromManifest('skill-1', 'user-1', manifest);

    await manager.handleEvent('server.offline', { serverId: 'server-1' });

    expect(executeCallback).toHaveBeenCalledWith('skill-1', 'server-1', 'user-1', 'event', undefined);
  });

  it('should not trigger on non-matching event', async () => {
    const manifest = createMockManifest({
      triggers: [{ type: 'event', on: 'server.offline' }],
    });

    manager.registerTriggersFromManifest('skill-1', 'user-1', manifest);

    await manager.handleEvent('task.completed', { serverId: 'server-1' });

    expect(executeCallback).not.toHaveBeenCalled();
  });

  it('should match event filter', async () => {
    const manifest = createMockManifest({
      triggers: [{
        type: 'event',
        on: 'alert.triggered',
        filter: { severity: 'critical' },
      }],
    });

    manager.registerTriggersFromManifest('skill-1', 'user-1', manifest);

    // Should match
    await manager.handleEvent('alert.triggered', {
      serverId: 'server-1',
      severity: 'critical',
    });
    expect(executeCallback).toHaveBeenCalledTimes(1);

    // Reset debounce for re-test
    const debounceMap = (manager as unknown as { debounceMap: Map<string, number> }).debounceMap;
    debounceMap.clear();

    // Should not match (different severity)
    await manager.handleEvent('alert.triggered', {
      serverId: 'server-1',
      severity: 'warning',
    });
    expect(executeCallback).toHaveBeenCalledTimes(1); // still 1
  });

  it('should trigger multiple skills on same event type', async () => {
    const manifest1 = createMockManifest({
      triggers: [{ type: 'event', on: 'task.completed' }],
    });
    const manifest2 = createMockManifest({
      triggers: [{ type: 'event', on: 'task.completed' }],
    });

    manager.registerTriggersFromManifest('skill-1', 'user-1', manifest1);
    manager.registerTriggersFromManifest('skill-2', 'user-2', manifest2);

    await manager.handleEvent('task.completed', { serverId: 'server-1' });

    expect(executeCallback).toHaveBeenCalledTimes(2);
  });

  it('should not duplicate event registration for same skill', () => {
    const manifest = createMockManifest({
      triggers: [{ type: 'event', on: 'server.offline' }],
    });

    manager.registerTriggersFromManifest('skill-1', 'user-1', manifest);
    manager.registerTriggersFromManifest('skill-1', 'user-1', manifest);

    expect(manager.getEventCount()).toBe(1);
  });

  it('should use "unknown" serverId when not provided in event data', async () => {
    const manifest = createMockManifest({
      triggers: [{ type: 'event', on: 'alert.triggered' }],
    });

    manager.registerTriggersFromManifest('skill-1', 'user-1', manifest);

    await manager.handleEvent('alert.triggered', {});

    expect(executeCallback).toHaveBeenCalledWith('skill-1', 'unknown', 'user-1', 'event', undefined);
  });
});

// ============================================================================
// Threshold Triggers
// ============================================================================

describe('TriggerManager threshold triggers', () => {
  it('should register a threshold trigger', () => {
    const manifest = createMockManifest({
      triggers: [{ type: 'threshold', metric: 'cpu.usage', operator: 'gt', value: 90 }],
    });

    manager.registerTriggersFromManifest('skill-1', 'user-1', manifest);

    expect(manager.getThresholdCount()).toBe(1);
  });

  it('should trigger when cpu threshold is exceeded via MetricsBus', async () => {
    await manager.start();

    const manifest = createMockManifest({
      triggers: [{ type: 'threshold', metric: 'cpu.usage', operator: 'gt', value: 90 }],
    });

    manager.registerTriggersFromManifest('skill-1', 'user-1', manifest);

    // Publish metric that exceeds threshold
    const metric = createMetricEvent({ cpuUsage: 95 });
    getMetricsBus().publish('server-1', metric);

    // Allow microtask queue to flush
    await new Promise((r) => setTimeout(r, 10));

    expect(executeCallback).toHaveBeenCalledWith('skill-1', 'server-1', 'user-1', 'threshold', undefined);
  });

  it('should not trigger when threshold is not exceeded', async () => {
    await manager.start();

    const manifest = createMockManifest({
      triggers: [{ type: 'threshold', metric: 'cpu.usage', operator: 'gt', value: 90 }],
    });

    manager.registerTriggersFromManifest('skill-1', 'user-1', manifest);

    // Publish metric below threshold
    const metric = createMetricEvent({ cpuUsage: 50 });
    getMetricsBus().publish('server-1', metric);

    await new Promise((r) => setTimeout(r, 10));

    expect(executeCallback).not.toHaveBeenCalled();
  });

  it('should evaluate memory.usage_percent correctly', async () => {
    await manager.start();

    const manifest = createMockManifest({
      triggers: [{
        type: 'threshold',
        metric: 'memory.usage_percent',
        operator: 'gte',
        value: 80,
      }],
    });

    manager.registerTriggersFromManifest('skill-1', 'user-1', manifest);

    // 7GB used / 8GB total = 87.5%
    const metric = createMetricEvent({
      memoryUsage: 7_000_000_000,
      memoryTotal: 8_000_000_000,
    });
    getMetricsBus().publish('server-1', metric);

    await new Promise((r) => setTimeout(r, 10));

    expect(executeCallback).toHaveBeenCalledTimes(1);
  });

  it('should evaluate disk.usage_percent correctly', async () => {
    await manager.start();

    const manifest = createMockManifest({
      triggers: [{
        type: 'threshold',
        metric: 'disk.usage_percent',
        operator: 'lt',
        value: 10,
      }],
    });

    manager.registerTriggersFromManifest('skill-1', 'user-1', manifest);

    // 20GB / 500GB = 4%
    const metric = createMetricEvent({
      diskUsage: 20_000_000_000,
      diskTotal: 500_000_000_000,
    });
    getMetricsBus().publish('server-1', metric);

    await new Promise((r) => setTimeout(r, 10));

    expect(executeCallback).toHaveBeenCalledTimes(1);
  });

  it('should support all comparison operators', () => {
    const compareValue = (manager as unknown as {
      compareValue: (current: number, op: string, threshold: number) => boolean;
    }).compareValue.bind(manager);

    expect(compareValue(95, 'gt', 90)).toBe(true);
    expect(compareValue(90, 'gt', 90)).toBe(false);
    expect(compareValue(90, 'gte', 90)).toBe(true);
    expect(compareValue(89, 'gte', 90)).toBe(false);
    expect(compareValue(5, 'lt', 10)).toBe(true);
    expect(compareValue(10, 'lt', 10)).toBe(false);
    expect(compareValue(10, 'lte', 10)).toBe(true);
    expect(compareValue(11, 'lte', 10)).toBe(false);
    expect(compareValue(50, 'eq', 50)).toBe(true);
    expect(compareValue(51, 'eq', 50)).toBe(false);
    expect(compareValue(51, 'neq', 50)).toBe(true);
    expect(compareValue(50, 'neq', 50)).toBe(false);
    expect(compareValue(50, 'invalid', 50)).toBe(false);
  });
});

// ============================================================================
// Debounce
// ============================================================================

describe('TriggerManager debounce', () => {
  it('should debounce same skill+server within 5 minutes', async () => {
    const manifest = createMockManifest({
      triggers: [{ type: 'event', on: 'alert.triggered' }],
    });

    manager.registerTriggersFromManifest('skill-1', 'user-1', manifest);

    // First event triggers
    await manager.handleEvent('alert.triggered', { serverId: 'server-1' });
    expect(executeCallback).toHaveBeenCalledTimes(1);

    // Second event within debounce window — should be suppressed
    await manager.handleEvent('alert.triggered', { serverId: 'server-1' });
    expect(executeCallback).toHaveBeenCalledTimes(1);
  });

  it('should allow same skill on different servers', async () => {
    const manifest = createMockManifest({
      triggers: [{ type: 'event', on: 'alert.triggered' }],
    });

    manager.registerTriggersFromManifest('skill-1', 'user-1', manifest);

    await manager.handleEvent('alert.triggered', { serverId: 'server-1' });
    await manager.handleEvent('alert.triggered', { serverId: 'server-2' });

    expect(executeCallback).toHaveBeenCalledTimes(2);
  });

  it('should allow triggering after debounce expires', async () => {
    const manifest = createMockManifest({
      triggers: [{ type: 'event', on: 'alert.triggered' }],
    });

    manager.registerTriggersFromManifest('skill-1', 'user-1', manifest);

    // First event
    await manager.handleEvent('alert.triggered', { serverId: 'server-1' });
    expect(executeCallback).toHaveBeenCalledTimes(1);

    // Manually expire debounce (set timestamp to 6 minutes ago)
    const debounceMap = (manager as unknown as { debounceMap: Map<string, number> }).debounceMap;
    debounceMap.set('skill-1:server-1', Date.now() - 6 * 60 * 1000);

    // Second event after debounce window
    await manager.handleEvent('alert.triggered', { serverId: 'server-1' });
    expect(executeCallback).toHaveBeenCalledTimes(2);
  });

  it('should clear debounce entries when unregistering skill', () => {
    const manifest = createMockManifest({
      triggers: [{ type: 'event', on: 'alert.triggered' }],
    });

    manager.registerTriggersFromManifest('skill-1', 'user-1', manifest);

    // Record debounce manually
    const debounceMap = (manager as unknown as { debounceMap: Map<string, number> }).debounceMap;
    debounceMap.set('skill-1:server-1', Date.now());
    debounceMap.set('skill-1:server-2', Date.now());
    debounceMap.set('skill-2:server-1', Date.now()); // different skill, should remain

    manager.unregisterSkill('skill-1');

    expect(debounceMap.has('skill-1:server-1')).toBe(false);
    expect(debounceMap.has('skill-1:server-2')).toBe(false);
    expect(debounceMap.has('skill-2:server-1')).toBe(true);
  });
});

// ============================================================================
// Registration / Unregistration
// ============================================================================

describe('TriggerManager register/unregister', () => {
  it('should register multiple trigger types from one manifest', () => {
    const manifest = createMockManifest({
      triggers: [
        { type: 'manual' },
        { type: 'cron', schedule: '0 * * * *' },
        { type: 'event', on: 'server.offline' },
        { type: 'threshold', metric: 'cpu.usage', operator: 'gt', value: 90 },
      ],
    });

    manager.registerTriggersFromManifest('skill-1', 'user-1', manifest);

    expect(manager.getCronCount()).toBe(1);
    expect(manager.getEventCount()).toBe(1);
    expect(manager.getThresholdCount()).toBe(1);
  });

  it('should unregister all triggers for a skill', () => {
    const manifest = createMockManifest({
      triggers: [
        { type: 'cron', schedule: '0 * * * *' },
        { type: 'event', on: 'server.offline' },
        { type: 'threshold', metric: 'cpu.usage', operator: 'gt', value: 90 },
      ],
    });

    manager.registerTriggersFromManifest('skill-1', 'user-1', manifest);
    expect(manager.getCronCount()).toBe(1);

    manager.unregisterSkill('skill-1');

    expect(manager.getCronCount()).toBe(0);
    expect(manager.getEventCount()).toBe(0);
    expect(manager.getThresholdCount()).toBe(0);
  });

  it('should only unregister the target skill, not others', () => {
    const manifest1 = createMockManifest({
      triggers: [
        { type: 'cron', schedule: '0 * * * *' },
        { type: 'event', on: 'server.offline' },
      ],
    });
    const manifest2 = createMockManifest({
      triggers: [
        { type: 'cron', schedule: '*/5 * * * *' },
        { type: 'event', on: 'server.offline' },
      ],
    });

    manager.registerTriggersFromManifest('skill-1', 'user-1', manifest1);
    manager.registerTriggersFromManifest('skill-2', 'user-1', manifest2);

    expect(manager.getCronCount()).toBe(2);
    expect(manager.getEventCount()).toBe(2);

    manager.unregisterSkill('skill-1');

    expect(manager.getCronCount()).toBe(1);
    expect(manager.getEventCount()).toBe(1);
  });

  it('should handle manual trigger type (no-op)', () => {
    const manifest = createMockManifest({
      triggers: [{ type: 'manual' }],
    });

    manager.registerTriggersFromManifest('skill-1', 'user-1', manifest);

    expect(manager.getCronCount()).toBe(0);
    expect(manager.getEventCount()).toBe(0);
    expect(manager.getThresholdCount()).toBe(0);
  });
});

// ============================================================================
// Singleton
// ============================================================================

describe('TriggerManager singleton', () => {
  it('should throw when accessed before initialization', () => {
    _resetTriggerManager();
    expect(() => getTriggerManager()).toThrow(/not initialized/);
  });

  it('should return the set instance', () => {
    const mgr = new TriggerManager(executeCallback, repo);
    setTriggerManager(mgr);

    expect(getTriggerManager()).toBe(mgr);

    _resetTriggerManager();
  });

  it('should stop the instance on reset', async () => {
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

describe('TriggerManager error handling', () => {
  it('should not throw when execute callback fails', async () => {
    executeCallback.mockRejectedValueOnce(new Error('Execution failed'));

    const manifest = createMockManifest({
      triggers: [{ type: 'event', on: 'alert.triggered' }],
    });

    manager.registerTriggersFromManifest('skill-1', 'user-1', manifest);

    // Should not throw — error is caught internally
    await manager.handleEvent('alert.triggered', { serverId: 'server-1' });

    // Allow promise to settle
    await new Promise((r) => setTimeout(r, 10));

    expect(executeCallback).toHaveBeenCalledTimes(1);
  });

  it('should handle empty event trigger map gracefully', async () => {
    // No triggers registered
    await manager.handleEvent('alert.triggered', { serverId: 'server-1' });

    expect(executeCallback).not.toHaveBeenCalled();
  });

  it('should handle cron poll with no jobs gracefully', async () => {
    await manager.pollCronJobs();
    expect(executeCallback).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Chain Triggers (skill.completed event-driven)
// ============================================================================

describe('TriggerManager chain triggers', () => {
  it('should trigger Skill B when Skill A completes (skill.completed event)', async () => {
    const manifestB = createMockManifest({
      triggers: [{ type: 'event', on: 'skill.completed' }],
    });

    manager.registerTriggersFromManifest('skill-b', 'user-1', manifestB);

    await manager.handleEvent('skill.completed', {
      serverId: 'server-1',
      skillId: 'skill-a',
      skillName: 'skill-a',
      executionId: 'exec-1',
      chainContext: { depth: 1, trail: ['skill-a'] },
    });

    expect(executeCallback).toHaveBeenCalledWith(
      'skill-b', 'server-1', 'user-1', 'event',
      { depth: 1, trail: ['skill-a'] },
    );
  });

  it('should filter by source_skill — match', async () => {
    const manifest = createMockManifest({
      triggers: [{
        type: 'event',
        on: 'skill.completed',
        filter: { source_skill: 'log-auditor' },
      }],
    });

    manager.registerTriggersFromManifest('skill-reporter', 'user-1', manifest);

    await manager.handleEvent('skill.completed', {
      serverId: 'server-1',
      skillId: 'skill-log-auditor-id',
      skillName: 'log-auditor',
      executionId: 'exec-1',
      chainContext: { depth: 1, trail: ['skill-log-auditor-id'] },
    });

    expect(executeCallback).toHaveBeenCalledTimes(1);
    expect(executeCallback).toHaveBeenCalledWith(
      'skill-reporter', 'server-1', 'user-1', 'event',
      { depth: 1, trail: ['skill-log-auditor-id'] },
    );
  });

  it('should filter by source_skill — no match', async () => {
    const manifest = createMockManifest({
      triggers: [{
        type: 'event',
        on: 'skill.completed',
        filter: { source_skill: 'log-auditor' },
      }],
    });

    manager.registerTriggersFromManifest('skill-reporter', 'user-1', manifest);

    await manager.handleEvent('skill.completed', {
      serverId: 'server-1',
      skillId: 'skill-backup-id',
      skillName: 'backup-cleaner',
      executionId: 'exec-2',
      chainContext: { depth: 1, trail: ['skill-backup-id'] },
    });

    expect(executeCallback).not.toHaveBeenCalled();
  });

  it('should pass chain context through to execute callback', async () => {
    const manifest = createMockManifest({
      triggers: [{ type: 'event', on: 'skill.completed' }],
    });

    manager.registerTriggersFromManifest('skill-c', 'user-1', manifest);

    const chainCtx = { depth: 3, trail: ['skill-a', 'skill-b', 'skill-x'] };

    await manager.handleEvent('skill.completed', {
      serverId: 'server-1',
      skillId: 'skill-x',
      skillName: 'skill-x',
      executionId: 'exec-chain',
      chainContext: chainCtx,
    });

    expect(executeCallback).toHaveBeenCalledWith(
      'skill-c', 'server-1', 'user-1', 'event', chainCtx,
    );
  });

  it('should not trigger skill.completed listener on skill.failed event', async () => {
    const manifest = createMockManifest({
      triggers: [{ type: 'event', on: 'skill.completed' }],
    });

    manager.registerTriggersFromManifest('skill-fallback', 'user-1', manifest);

    await manager.handleEvent('skill.failed', {
      serverId: 'server-1',
      skillId: 'skill-a',
      skillName: 'skill-a',
      executionId: 'exec-fail',
      chainContext: { depth: 1, trail: ['skill-a'] },
    });

    expect(executeCallback).not.toHaveBeenCalled();
  });

  it('should handle skill.completed events without chain context', async () => {
    const manifest = createMockManifest({
      triggers: [{ type: 'event', on: 'skill.completed' }],
    });

    manager.registerTriggersFromManifest('skill-b', 'user-1', manifest);

    await manager.handleEvent('skill.completed', {
      serverId: 'server-1',
      skillId: 'skill-a',
      skillName: 'skill-a',
      executionId: 'exec-no-chain',
    });

    expect(executeCallback).toHaveBeenCalledWith(
      'skill-b', 'server-1', 'user-1', 'event', undefined,
    );
  });

  it('should trigger multiple skills on the same skill.completed event', async () => {
    const manifestB = createMockManifest({
      triggers: [{ type: 'event', on: 'skill.completed' }],
    });
    const manifestC = createMockManifest({
      triggers: [{ type: 'event', on: 'skill.completed' }],
    });

    manager.registerTriggersFromManifest('skill-b', 'user-1', manifestB);
    manager.registerTriggersFromManifest('skill-c', 'user-2', manifestC);

    await manager.handleEvent('skill.completed', {
      serverId: 'server-1',
      skillId: 'skill-a',
      skillName: 'skill-a',
      executionId: 'exec-multi',
      chainContext: { depth: 1, trail: ['skill-a'] },
    });

    expect(executeCallback).toHaveBeenCalledTimes(2);
  });

  it('should debounce chain triggers for same skill+server', async () => {
    const manifest = createMockManifest({
      triggers: [{ type: 'event', on: 'skill.completed' }],
    });

    manager.registerTriggersFromManifest('skill-b', 'user-1', manifest);

    await manager.handleEvent('skill.completed', {
      serverId: 'server-1',
      skillId: 'skill-a',
      skillName: 'skill-a',
      executionId: 'exec-1',
      chainContext: { depth: 1, trail: ['skill-a'] },
    });

    await manager.handleEvent('skill.completed', {
      serverId: 'server-1',
      skillId: 'skill-a',
      skillName: 'skill-a',
      executionId: 'exec-2',
      chainContext: { depth: 1, trail: ['skill-a'] },
    });

    expect(executeCallback).toHaveBeenCalledTimes(1);
  });
});

// ============================================================================
// Startup Loading — findAllEnabled integration
// ============================================================================

describe('TriggerManager startup loading', () => {
  it('should load enabled skills from repo on start and register their triggers', async () => {
    const skill = await repo.install({
      userId: 'user-1',
      name: 'cron-backup',
      version: '1.0.0',
      source: 'local',
      skillPath: '/skills/cron-backup',
    });
    await repo.updateStatus(skill.id, 'enabled');

    const manifest = createMockManifest({
      triggers: [{ type: 'cron', schedule: '0 2 * * *' }],
    });
    mockLoadSkillFromDir.mockResolvedValueOnce(manifest);

    await manager.start();

    expect(mockLoadSkillFromDir).toHaveBeenCalledWith('/skills/cron-backup');
    expect(manager.getCronCount()).toBe(1);
  });

  it('should not register triggers for non-enabled skills', async () => {
    // installed (not enabled)
    await repo.install({
      userId: 'user-1',
      name: 'not-enabled',
      version: '1.0.0',
      source: 'local',
      skillPath: '/skills/not-enabled',
    });

    await manager.start();

    expect(mockLoadSkillFromDir).not.toHaveBeenCalled();
    expect(manager.getCronCount()).toBe(0);
    expect(manager.getEventCount()).toBe(0);
    expect(manager.getThresholdCount()).toBe(0);
  });

  it('should load multiple enabled skills on start', async () => {
    const s1 = await repo.install({
      userId: 'user-1',
      name: 'skill-cron',
      version: '1.0.0',
      source: 'local',
      skillPath: '/skills/cron',
    });
    const s2 = await repo.install({
      userId: 'user-2',
      name: 'skill-event',
      version: '1.0.0',
      source: 'local',
      skillPath: '/skills/event',
    });
    await repo.updateStatus(s1.id, 'enabled');
    await repo.updateStatus(s2.id, 'enabled');

    const cronManifest = createMockManifest({
      triggers: [{ type: 'cron', schedule: '*/10 * * * *' }],
    });
    const eventManifest = createMockManifest({
      triggers: [{ type: 'event', on: 'server.offline' }],
    });

    mockLoadSkillFromDir
      .mockResolvedValueOnce(cronManifest)
      .mockResolvedValueOnce(eventManifest);

    await manager.start();

    expect(manager.getCronCount()).toBe(1);
    expect(manager.getEventCount()).toBe(1);
  });

  it('should gracefully handle manifest load failure for individual skills', async () => {
    const s1 = await repo.install({
      userId: 'user-1',
      name: 'broken-skill',
      version: '1.0.0',
      source: 'local',
      skillPath: '/skills/broken',
    });
    const s2 = await repo.install({
      userId: 'user-1',
      name: 'good-skill',
      version: '1.0.0',
      source: 'local',
      skillPath: '/skills/good',
    });
    await repo.updateStatus(s1.id, 'enabled');
    await repo.updateStatus(s2.id, 'enabled');

    const goodManifest = createMockManifest({
      triggers: [{ type: 'threshold', metric: 'cpu.usage', operator: 'gt', value: 80 }],
    });

    // First skill fails to load, second succeeds
    mockLoadSkillFromDir
      .mockRejectedValueOnce(new Error('Manifest not found'))
      .mockResolvedValueOnce(goodManifest);

    await manager.start();

    // The good skill should still be registered
    expect(manager.getThresholdCount()).toBe(1);
  });
});
