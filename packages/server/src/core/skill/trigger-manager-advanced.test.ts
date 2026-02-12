// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for TriggerManager — chain triggers and subscribeToDispatcher.
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
import { _resetMetricsBus } from '../metrics/metrics-bus.js';
import {
  WebhookDispatcher,
  _resetWebhookDispatcher,
} from '../webhook/dispatcher.js';

import type { WebhookRepository } from '../../db/repositories/webhook-repository.js';
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

function createMockWebhookRepo(): WebhookRepository {
  return {
    create: vi.fn(),
    findById: vi.fn(),
    findByIdInternal: vi.fn(),
    listByUser: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    findEnabledByEvent: vi.fn().mockResolvedValue([]),
    createDelivery: vi.fn().mockResolvedValue({
      id: 'del-1', webhookId: 'wh-1', eventType: 'task.completed',
      payload: {}, status: 'pending', httpStatus: null, responseBody: null,
      attempts: 0, lastAttemptAt: null, nextRetryAt: null,
      createdAt: new Date().toISOString(),
    }),
    updateDeliveryStatus: vi.fn().mockResolvedValue(true),
    findPendingRetries: vi.fn().mockResolvedValue([]),
    listDeliveries: vi.fn().mockResolvedValue({ deliveries: [], total: 0 }),
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
// WebhookDispatcher → TriggerManager integration (subscribeToDispatcher)
// ============================================================================

describe('TriggerManager subscribeToDispatcher', () => {
  let webhookRepo: WebhookRepository;
  let dispatcher: WebhookDispatcher;

  beforeEach(() => {
    webhookRepo = createMockWebhookRepo();
    dispatcher = new WebhookDispatcher(webhookRepo, { retryIntervalMs: 60_000 });
  });

  afterEach(() => {
    dispatcher.stop();
    _resetWebhookDispatcher();
  });

  it('should trigger skill when dispatcher emits a matching event', async () => {
    const manifest = createMockManifest({
      triggers: [{ type: 'event', on: 'alert.triggered' }],
    });

    manager.registerTriggersFromManifest('skill-1', 'user-1', manifest);
    manager.subscribeToDispatcher(dispatcher);

    await dispatcher.dispatch({
      type: 'alert.triggered',
      userId: 'user-1',
      data: { serverId: 'server-1', severity: 'critical' },
    });

    // Allow async handleEvent promise to settle
    await new Promise((r) => setTimeout(r, 10));

    expect(executeCallback).toHaveBeenCalledWith(
      'skill-1', 'server-1', 'user-1', 'event', undefined,
    );
  });

  it('should not trigger skill for non-matching event type', async () => {
    const manifest = createMockManifest({
      triggers: [{ type: 'event', on: 'alert.triggered' }],
    });

    manager.registerTriggersFromManifest('skill-1', 'user-1', manifest);
    manager.subscribeToDispatcher(dispatcher);

    await dispatcher.dispatch({
      type: 'task.completed',
      userId: 'user-1',
      data: { serverId: 'server-1' },
    });

    await new Promise((r) => setTimeout(r, 10));

    expect(executeCallback).not.toHaveBeenCalled();
  });

  it('should trigger skill even when no webhooks match the event', async () => {
    (webhookRepo.findEnabledByEvent as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const manifest = createMockManifest({
      triggers: [{ type: 'event', on: 'server.offline' }],
    });

    manager.registerTriggersFromManifest('skill-1', 'user-1', manifest);
    manager.subscribeToDispatcher(dispatcher);

    await dispatcher.dispatch({
      type: 'server.offline',
      userId: 'user-1',
      data: { serverId: 'server-1' },
    });

    await new Promise((r) => setTimeout(r, 10));

    expect(executeCallback).toHaveBeenCalledWith(
      'skill-1', 'server-1', 'user-1', 'event', undefined,
    );
  });

  it('should unsubscribe from dispatcher when TriggerManager stops', async () => {
    const manifest = createMockManifest({
      triggers: [{ type: 'event', on: 'alert.triggered' }],
    });

    manager.registerTriggersFromManifest('skill-1', 'user-1', manifest);
    manager.subscribeToDispatcher(dispatcher);

    // First dispatch — should trigger
    await dispatcher.dispatch({
      type: 'alert.triggered',
      userId: 'user-1',
      data: { serverId: 'server-1' },
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(executeCallback).toHaveBeenCalledTimes(1);

    // Stop — should unsubscribe and clear triggers
    manager.stop();
    executeCallback.mockClear();

    // Dispatch again — should NOT trigger (unsubscribed)
    await dispatcher.dispatch({
      type: 'alert.triggered',
      userId: 'user-1',
      data: { serverId: 'server-2' },
    });
    await new Promise((r) => setTimeout(r, 10));

    expect(executeCallback).not.toHaveBeenCalled();
  });

  it('should replace previous subscription when called again', async () => {
    const manifest = createMockManifest({
      triggers: [{ type: 'event', on: 'alert.triggered' }],
    });

    manager.registerTriggersFromManifest('skill-1', 'user-1', manifest);

    // Subscribe twice
    manager.subscribeToDispatcher(dispatcher);
    manager.subscribeToDispatcher(dispatcher);

    await dispatcher.dispatch({
      type: 'alert.triggered',
      userId: 'user-1',
      data: { serverId: 'server-1' },
    });

    await new Promise((r) => setTimeout(r, 10));

    // Should only be called once (not duplicated from double subscription)
    expect(executeCallback).toHaveBeenCalledTimes(1);
  });

  it('should handle multiple event types from dispatcher', async () => {
    const manifest = createMockManifest({
      triggers: [
        { type: 'event', on: 'alert.triggered' },
        { type: 'event', on: 'server.offline' },
      ],
    });

    manager.registerTriggersFromManifest('skill-1', 'user-1', manifest);
    manager.subscribeToDispatcher(dispatcher);

    await dispatcher.dispatch({
      type: 'alert.triggered',
      userId: 'user-1',
      data: { serverId: 'server-1' },
    });

    await dispatcher.dispatch({
      type: 'server.offline',
      userId: 'user-1',
      data: { serverId: 'server-2' },
    });

    await new Promise((r) => setTimeout(r, 10));

    expect(executeCallback).toHaveBeenCalledTimes(2);
    expect(executeCallback).toHaveBeenCalledWith(
      'skill-1', 'server-1', 'user-1', 'event', undefined,
    );
    expect(executeCallback).toHaveBeenCalledWith(
      'skill-1', 'server-2', 'user-1', 'event', undefined,
    );
  });
});
