// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for SkillEngine — webhook dispatch and chain context.
 *
 * Split from engine.test.ts to stay within the 800-line file limit.
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
import { SkillRunner } from './runner.js';
import { getWebhookDispatcher } from '../webhook/dispatcher.js';
import {
  createTempDir,
  cleanupTempDirs,
  writeSkillYaml,
} from './engine-test-utils.js';

// Mock SkillRunner to avoid AI provider dependency in engine tests
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

// Mock TriggerManager to isolate engine tests from trigger logic
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

// Mock WebhookDispatcher to verify dispatch calls without real HTTP delivery
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
  vi.mocked(getWebhookDispatcher().dispatch).mockClear();

  repo = new InMemorySkillRepository();
  setSkillRepository(repo);

  const serverRepo = new InMemoryServerRepository();
  setServerRepository(serverRepo);

  projectRoot = await createTempDir('engine-root-');
  engine = new SkillEngine(projectRoot, repo);
});

afterEach(async () => {
  _resetSkillEngine();
  _resetSkillRepository();
  _resetServerRepository();
  await cleanupTempDirs();
});

// ============================================================================
// Webhook Dispatch — skill.completed / skill.failed events
// ============================================================================

describe('SkillEngine webhook dispatch', () => {
  it('should dispatch skill.completed webhook on successful execution', async () => {
    const skillDir = await createTempDir('skill-');
    await writeSkillYaml(skillDir);

    const skill = await engine.install('user-1', skillDir, 'local');
    await engine.updateStatus(skill.id, 'enabled');

    const result = await engine.execute({
      skillId: skill.id,
      serverId: 'server-1',
      userId: 'user-1',
      triggerType: 'manual',
    });

    expect(result.status).toBe('success');
    expect(vi.mocked(getWebhookDispatcher().dispatch)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(getWebhookDispatcher().dispatch)).toHaveBeenCalledWith({
      type: 'skill.completed',
      userId: 'user-1',
      data: expect.objectContaining({
        serverId: 'server-1',
        skillId: skill.id,
        skillName: 'test-skill',
        executionId: result.executionId,
        status: 'success',
      }),
    });
  });

  it('should dispatch skill.failed webhook when runner returns failure', async () => {
    const skillDir = await createTempDir('skill-');
    await writeSkillYaml(skillDir);

    const skill = await engine.install('user-1', skillDir, 'local');
    await engine.updateStatus(skill.id, 'enabled');

    // Override SkillRunner mock to return failure
    vi.mocked(SkillRunner).mockImplementationOnce(() => ({
      run: vi.fn().mockResolvedValue({
        success: false,
        status: 'failed',
        stepsExecuted: 1,
        duration: 5,
        output: '',
        errors: ['Command failed'],
        toolResults: [],
      }),
    }) as unknown as SkillRunner);

    const result = await engine.execute({
      skillId: skill.id,
      serverId: 'server-1',
      userId: 'user-1',
      triggerType: 'manual',
    });

    expect(result.status).toBe('failed');
    expect(vi.mocked(getWebhookDispatcher().dispatch)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(getWebhookDispatcher().dispatch)).toHaveBeenCalledWith({
      type: 'skill.failed',
      userId: 'user-1',
      data: expect.objectContaining({
        serverId: 'server-1',
        skillId: skill.id,
        skillName: 'test-skill',
        executionId: result.executionId,
        status: 'failed',
      }),
    });
  });

  it('should dispatch skill.failed webhook when runner throws an exception', async () => {
    const skillDir = await createTempDir('skill-');
    await writeSkillYaml(skillDir);

    const skill = await engine.install('user-1', skillDir, 'local');
    await engine.updateStatus(skill.id, 'enabled');

    // Override SkillRunner mock to throw an error
    vi.mocked(SkillRunner).mockImplementationOnce(() => ({
      run: vi.fn().mockRejectedValue(new Error('AI provider unavailable')),
    }) as unknown as SkillRunner);

    const result = await engine.execute({
      skillId: skill.id,
      serverId: 'server-1',
      userId: 'user-1',
      triggerType: 'manual',
    });

    expect(result.status).toBe('failed');
    expect(result.errors).toContain('AI provider unavailable');
    expect(vi.mocked(getWebhookDispatcher().dispatch)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(getWebhookDispatcher().dispatch)).toHaveBeenCalledWith({
      type: 'skill.failed',
      userId: 'user-1',
      data: expect.objectContaining({
        serverId: 'server-1',
        skillId: skill.id,
        skillName: 'test-skill',
        status: 'failed',
        error: 'AI provider unavailable',
      }),
    });
  });
});

// ============================================================================
// Chain Context — Cycle Detection & Depth Limits
// ============================================================================

describe('SkillEngine chain context', () => {
  it('should reject execution when chain depth exceeds limit', async () => {
    const skillDir = await createTempDir('skill-');
    await writeSkillYaml(skillDir);

    const skill = await engine.install('user-1', skillDir, 'local');
    await engine.updateStatus(skill.id, 'enabled');

    await expect(
      engine.execute({
        skillId: skill.id,
        serverId: 'server-1',
        userId: 'user-1',
        triggerType: 'event',
        chainContext: {
          depth: 5,
          trail: ['a', 'b', 'c', 'd', 'e'],
        },
      }),
    ).rejects.toThrow(/Chain depth limit exceeded/);
  });

  it('should reject execution when circular chain is detected', async () => {
    const skillDir = await createTempDir('skill-');
    await writeSkillYaml(skillDir);

    const skill = await engine.install('user-1', skillDir, 'local');
    await engine.updateStatus(skill.id, 'enabled');

    await expect(
      engine.execute({
        skillId: skill.id,
        serverId: 'server-1',
        userId: 'user-1',
        triggerType: 'event',
        chainContext: {
          depth: 2,
          trail: ['other-skill', skill.id],
        },
      }),
    ).rejects.toThrow(/Circular chain detected/);
  });

  it('should allow execution at chain depth below limit', async () => {
    const skillDir = await createTempDir('skill-');
    await writeSkillYaml(skillDir);

    const skill = await engine.install('user-1', skillDir, 'local');
    await engine.updateStatus(skill.id, 'enabled');

    const result = await engine.execute({
      skillId: skill.id,
      serverId: 'server-1',
      userId: 'user-1',
      triggerType: 'event',
      chainContext: {
        depth: 4,
        trail: ['a', 'b', 'c', 'd'],
      },
    });

    expect(result.status).toBe('success');
  });

  it('should execute normally without chain context (manual trigger)', async () => {
    const skillDir = await createTempDir('skill-');
    await writeSkillYaml(skillDir);

    const skill = await engine.install('user-1', skillDir, 'local');
    await engine.updateStatus(skill.id, 'enabled');

    const result = await engine.execute({
      skillId: skill.id,
      serverId: 'server-1',
      userId: 'user-1',
      triggerType: 'manual',
    });

    expect(result.status).toBe('success');
  });
});
