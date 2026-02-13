// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for TriggerManager — cron, event, and threshold triggers.
 * Split from trigger-manager.test.ts to stay under the 500-line limit.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  TriggerManager,
  _resetTriggerManager,
  type ExecuteCallback,
} from './trigger-manager.js';
import {
  InMemorySkillRepository,
  setSkillRepository,
  _resetSkillRepository,
} from '../../db/repositories/skill-repository.js';
import { getMetricsBus, _resetMetricsBus, type MetricEvent } from '../metrics/metrics-bus.js';
import { compareValue } from './trigger-evaluators.js';

import type { SkillManifest } from '@aiinstaller/shared';

// Mock the loader to avoid disk I/O in tests
vi.mock('./loader.js', () => ({
  loadSkillFromDir: vi.fn(),
  scanSkillDirectories: vi.fn().mockResolvedValue([]),
  resolvePromptTemplate: vi.fn((t: string) => t),
  checkRequirements: vi.fn(),
}));

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

beforeEach(() => {
  _resetTriggerManager();
  _resetSkillRepository();
  _resetMetricsBus();

  executeCallback = vi.fn<Parameters<ExecuteCallback>, ReturnType<ExecuteCallback>>()
    .mockResolvedValue(undefined);
  const repo = new InMemorySkillRepository();
  setSkillRepository(repo);

  manager = new TriggerManager(executeCallback, repo);
});

afterEach(() => {
  manager.stop();
  _resetTriggerManager();
  _resetSkillRepository();
  _resetMetricsBus();
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
