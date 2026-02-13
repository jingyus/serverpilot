// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for SkillEngine — execution cancellation.
 *
 * Verifies that running executions can be cancelled via engine.cancel(),
 * the runner respects the external abort signal, and the DB/SSE state
 * is updated correctly.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { SkillEngine, _resetSkillEngine } from './engine.js';
import {
  InMemorySkillRepository,
  setSkillRepository,
  _resetSkillRepository,
} from '../../db/repositories/skill-repository.js';
import {
  InMemoryServerRepository,
  setServerRepository,
  _resetServerRepository,
} from '../../db/repositories/server-repository.js';
import { getSkillEventBus, _resetSkillEventBus } from './skill-event-bus.js';
import type { SkillEvent } from './skill-event-bus.js';
import { SkillRunner } from './runner.js';
import {
  createTempDir,
  cleanupTempDirs,
  writeSkillYaml,
} from './engine-test-utils.js';

// ============================================================================
// Mocks
// ============================================================================

// Mock SkillRunner — will be configured per test
vi.mock('./runner.js', () => ({
  SkillRunner: vi.fn().mockImplementation(() => ({
    run: vi.fn().mockResolvedValue({
      success: true,
      status: 'success',
      stepsExecuted: 0,
      duration: 10,
      output: 'Mock execution complete',
      errors: [],
      toolResults: [],
    }),
  })),
}));

vi.mock('./trigger-manager.js', () => {
  const mockManager = {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
    registerSkill: vi.fn().mockResolvedValue(undefined),
    unregisterSkill: vi.fn(),
    isRunning: vi.fn().mockReturnValue(false),
  };
  return {
    TriggerManager: vi.fn().mockImplementation(() => mockManager),
    setTriggerManager: vi.fn(),
    _resetTriggerManager: vi.fn(),
  };
});

vi.mock('../webhook/dispatcher.js', () => ({
  getWebhookDispatcher: vi.fn().mockReturnValue({
    dispatch: vi.fn().mockResolvedValue(undefined),
  }),
}));

// ============================================================================
// Setup / Teardown
// ============================================================================

let repo: InMemorySkillRepository;
let engine: SkillEngine;
let projectRoot: string;

beforeEach(async () => {
  _resetSkillEngine();
  _resetSkillRepository();
  _resetServerRepository();
  _resetSkillEventBus();

  // Reset SkillRunner mock to default behavior
  vi.mocked(SkillRunner).mockImplementation(() => ({
    run: vi.fn().mockResolvedValue({
      success: true,
      status: 'success',
      stepsExecuted: 0,
      duration: 10,
      output: 'Mock execution complete',
      errors: [],
      toolResults: [],
    }),
  }) as unknown as SkillRunner);

  repo = new InMemorySkillRepository();
  setSkillRepository(repo);

  const serverRepo = new InMemoryServerRepository();
  setServerRepository(serverRepo);

  projectRoot = await createTempDir('engine-cancel-');
  engine = new SkillEngine(projectRoot, repo);
});

afterEach(async () => {
  _resetSkillEngine();
  _resetSkillRepository();
  _resetServerRepository();
  _resetSkillEventBus();
  await cleanupTempDirs();
});

// ============================================================================
// Helper — install and enable a skill
// ============================================================================

async function installEnabledSkill(): Promise<string> {
  const skillDir = await createTempDir('skill-');
  await writeSkillYaml(skillDir);
  const skill = await engine.install('user-1', skillDir, 'local');
  await engine.updateStatus(skill.id, 'enabled');
  return skill.id;
}

// ============================================================================
// Tests
// ============================================================================

describe('SkillEngine.cancel', () => {
  it('should abort a running execution via cancel()', async () => {
    const skillId = await installEnabledSkill();

    // Make runner.run() hang until signal is aborted
    const MockRunner = vi.mocked(SkillRunner);
    MockRunner.mockImplementation(() => ({
      run: vi.fn().mockImplementation(async (params: { signal?: AbortSignal }) => {
        // Wait for abort signal
        await new Promise<void>((resolve) => {
          if (params.signal?.aborted) {
            resolve();
            return;
          }
          params.signal?.addEventListener('abort', () => resolve(), { once: true });
        });
        return {
          success: false,
          status: 'cancelled',
          stepsExecuted: 1,
          duration: 50,
          output: 'Execution cancelled',
          errors: ['Execution cancelled by user'],
          toolResults: [],
        };
      }),
    }) as unknown as SkillRunner);

    // Start execution (will hang)
    const executePromise = engine.execute({
      skillId,
      serverId: 'server-1',
      userId: 'user-1',
      triggerType: 'manual',
    });

    // Wait a tick for execution to register
    await new Promise((r) => setTimeout(r, 10));

    // Should be running
    const runningIds = engine.getRunningExecutionIds();
    expect(runningIds).toHaveLength(1);

    // Cancel it
    await engine.cancel(runningIds[0]);

    // Wait for execution to complete
    const result = await executePromise;
    expect(result.status).toBe('cancelled');
    expect(result.errors).toContain('Execution cancelled by user');
  });

  it('should remove execution from runningExecutions map after completion', async () => {
    const skillId = await installEnabledSkill();

    await engine.execute({
      skillId,
      serverId: 'server-1',
      userId: 'user-1',
      triggerType: 'manual',
    });

    expect(engine.getRunningExecutionIds()).toHaveLength(0);
  });

  it('should throw when cancelling a non-existent execution', async () => {
    await expect(engine.cancel('non-existent-id')).rejects.toThrow(
      /Execution not found or not running/,
    );
  });

  it('should publish SSE error event on cancel', async () => {
    const skillId = await installEnabledSkill();
    const bus = getSkillEventBus();
    const events: SkillEvent[] = [];

    // Make runner.run() hang
    const MockRunner = vi.mocked(SkillRunner);
    MockRunner.mockImplementation(() => ({
      run: vi.fn().mockImplementation(async (params: { signal?: AbortSignal }) => {
        await new Promise<void>((resolve) => {
          if (params.signal?.aborted) { resolve(); return; }
          params.signal?.addEventListener('abort', () => resolve(), { once: true });
        });
        return {
          success: false, status: 'cancelled', stepsExecuted: 0,
          duration: 5, output: '', errors: ['Execution cancelled by user'], toolResults: [],
        };
      }),
    }) as unknown as SkillRunner);

    const executePromise = engine.execute({
      skillId, serverId: 'server-1', userId: 'user-1', triggerType: 'manual',
    });

    await new Promise((r) => setTimeout(r, 10));
    const execId = engine.getRunningExecutionIds()[0];

    // Subscribe to events for this execution
    bus.subscribe(execId, (event) => events.push(event));

    await engine.cancel(execId);
    await executePromise;

    // Should have received error events (one from engine.cancel, one from runner)
    const errorEvents = events.filter((e) => e.type === 'error');
    expect(errorEvents.length).toBeGreaterThanOrEqual(1);
    expect(errorEvents[0].type).toBe('error');
    if (errorEvents[0].type === 'error') {
      expect(errorEvents[0].message).toBe('Execution cancelled by user');
    }
  });

  it('should update DB status to cancelled', async () => {
    const skillId = await installEnabledSkill();

    // Make runner.run() hang
    const MockRunner = vi.mocked(SkillRunner);
    MockRunner.mockImplementation(() => ({
      run: vi.fn().mockImplementation(async (params: { signal?: AbortSignal }) => {
        await new Promise<void>((resolve) => {
          if (params.signal?.aborted) { resolve(); return; }
          params.signal?.addEventListener('abort', () => resolve(), { once: true });
        });
        return {
          success: false, status: 'cancelled', stepsExecuted: 2,
          duration: 100, output: 'partial output', errors: ['Execution cancelled by user'], toolResults: [],
        };
      }),
    }) as unknown as SkillRunner);

    const executePromise = engine.execute({
      skillId, serverId: 'server-1', userId: 'user-1', triggerType: 'manual',
    });

    await new Promise((r) => setTimeout(r, 10));
    const execId = engine.getRunningExecutionIds()[0];
    await engine.cancel(execId);
    const result = await executePromise;

    // Check DB record
    const execution = await engine.getExecution(result.executionId);
    expect(execution).toBeDefined();
    expect(execution!.status).toBe('cancelled');
    expect(execution!.completedAt).toBeDefined();
  });

  it('should pass signal to SkillRunner.run()', async () => {
    const skillId = await installEnabledSkill();

    let receivedSignal: AbortSignal | undefined;
    const MockRunner = vi.mocked(SkillRunner);
    MockRunner.mockImplementation(() => ({
      run: vi.fn().mockImplementation(async (params: { signal?: AbortSignal }) => {
        receivedSignal = params.signal;
        return {
          success: true, status: 'success', stepsExecuted: 0,
          duration: 5, output: 'done', errors: [], toolResults: [],
        };
      }),
    }) as unknown as SkillRunner);

    await engine.execute({
      skillId, serverId: 'server-1', userId: 'user-1', triggerType: 'manual',
    });

    expect(receivedSignal).toBeDefined();
    expect(receivedSignal).toBeInstanceOf(AbortSignal);
  });

  it('should report isExecutionRunning correctly during execution', async () => {
    const skillId = await installEnabledSkill();

    let capturedExecId = '';
    const MockRunner = vi.mocked(SkillRunner);
    MockRunner.mockImplementation(() => ({
      run: vi.fn().mockImplementation(async (params: { executionId: string; signal?: AbortSignal }) => {
        capturedExecId = params.executionId;
        // Verify it's in the running map during execution
        expect(engine.isExecutionRunning(params.executionId)).toBe(true);
        return {
          success: true, status: 'success', stepsExecuted: 0,
          duration: 5, output: 'done', errors: [], toolResults: [],
        };
      }),
    }) as unknown as SkillRunner);

    await engine.execute({
      skillId, serverId: 'server-1', userId: 'user-1', triggerType: 'manual',
    });

    // After completion, should no longer be running
    expect(engine.isExecutionRunning(capturedExecId)).toBe(false);
  });

  it('should clean up runningExecutions even when execution throws', async () => {
    const skillId = await installEnabledSkill();

    const MockRunner = vi.mocked(SkillRunner);
    MockRunner.mockImplementation(() => ({
      run: vi.fn().mockRejectedValue(new Error('AI provider error')),
    }) as unknown as SkillRunner);

    const result = await engine.execute({
      skillId, serverId: 'server-1', userId: 'user-1', triggerType: 'manual',
    });

    expect(result.status).toBe('failed');
    expect(engine.getRunningExecutionIds()).toHaveLength(0);
  });

  it('should handle cancel when execution completes before abort takes effect', async () => {
    const skillId = await installEnabledSkill();

    // Runner resolves immediately (fast execution)
    // Default mock already returns immediately

    const result = await engine.execute({
      skillId, serverId: 'server-1', userId: 'user-1', triggerType: 'manual',
    });

    // After completion, cancel should fail since it's no longer in the map
    expect(result.status).toBe('success');
    await expect(engine.cancel(result.executionId)).rejects.toThrow(
      /Execution not found or not running/,
    );
  });
});
