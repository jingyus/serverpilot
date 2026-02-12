// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for SkillConfirmationManager — confirmation flow extracted from engine.
 *
 * Tests the pending confirmation lifecycle: create, confirm, reject, list, expire.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'node:path';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';

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
import { getWebhookDispatcher } from '../webhook/dispatcher.js';

// Mock SkillRunner to avoid AI provider dependency
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

// Mock TriggerManager to isolate from trigger logic
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

// Mock WebhookDispatcher
vi.mock('../webhook/dispatcher.js', () => ({
  getWebhookDispatcher: vi.fn().mockReturnValue({
    dispatch: vi.fn().mockResolvedValue(undefined),
  }),
}));

// ============================================================================
// Helpers
// ============================================================================

let tempDirs: string[] = [];

async function createTempDir(prefix = 'confirm-test-'): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

/** Write a skill.yaml with requires_confirmation: true */
async function writeConfirmationSkillYaml(dir: string, name = 'confirm-skill'): Promise<void> {
  const yaml = `kind: skill
version: "1.0"

metadata:
  name: ${name}
  displayName: "Confirmation Skill"
  version: "1.0.0"

triggers:
  - type: manual
  - type: cron
    schedule: "0 * * * *"

tools:
  - shell

constraints:
  requires_confirmation: true
  risk_level_max: red

prompt: |
  This is a confirmation-required skill prompt that exceeds the minimum 50-character validation requirement for testing.
`;
  await writeFile(join(dir, 'skill.yaml'), yaml, 'utf-8');
}

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

  projectRoot = await createTempDir('confirm-root-');
  engine = new SkillEngine(projectRoot, repo);
});

afterEach(async () => {
  _resetSkillEngine();
  _resetSkillRepository();
  _resetServerRepository();

  for (const dir of tempDirs) {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
  tempDirs = [];
});

// ============================================================================
// Confirmation Flow
// ============================================================================

describe('SkillEngine confirmation flow', () => {
  it('should return pending_confirmation when auto-triggered with requires_confirmation=true', async () => {
    const skillDir = await createTempDir('confirm-skill-');
    await writeConfirmationSkillYaml(skillDir);

    const skill = await engine.install('user-1', skillDir, 'local');
    await engine.updateStatus(skill.id, 'enabled');

    const result = await engine.execute({
      skillId: skill.id,
      serverId: 'server-1',
      userId: 'user-1',
      triggerType: 'cron',
    });

    expect(result.status).toBe('pending_confirmation');
    expect(result.executionId).toBeDefined();
    expect(result.stepsExecuted).toBe(0);
    expect(result.errors).toEqual([]);
  });

  it('should execute immediately for manual trigger even with requires_confirmation=true', async () => {
    const skillDir = await createTempDir('confirm-skill-');
    await writeConfirmationSkillYaml(skillDir);

    const skill = await engine.install('user-1', skillDir, 'local');
    await engine.updateStatus(skill.id, 'enabled');

    const result = await engine.execute({
      skillId: skill.id,
      serverId: 'server-1',
      userId: 'user-1',
      triggerType: 'manual',
    });

    expect(result.status).toBe('success');
    expect(result.stepsExecuted).toBe(0);
  });

  it('should confirm a pending execution and run it', async () => {
    const skillDir = await createTempDir('confirm-skill-');
    await writeConfirmationSkillYaml(skillDir);

    const skill = await engine.install('user-1', skillDir, 'local');
    await engine.updateStatus(skill.id, 'enabled');

    const pendingResult = await engine.execute({
      skillId: skill.id,
      serverId: 'server-1',
      userId: 'user-1',
      triggerType: 'event',
    });
    expect(pendingResult.status).toBe('pending_confirmation');

    const confirmedResult = await engine.confirmExecution(pendingResult.executionId, 'user-1');
    expect(confirmedResult.status).toBe('success');
    expect(confirmedResult.executionId).toBe(pendingResult.executionId);
  });

  it('should reject a pending execution', async () => {
    const skillDir = await createTempDir('confirm-skill-');
    await writeConfirmationSkillYaml(skillDir);

    const skill = await engine.install('user-1', skillDir, 'local');
    await engine.updateStatus(skill.id, 'enabled');

    const pendingResult = await engine.execute({
      skillId: skill.id,
      serverId: 'server-1',
      userId: 'user-1',
      triggerType: 'threshold',
    });

    await engine.rejectExecution(pendingResult.executionId, 'user-1');

    const exec = await engine.getExecution(pendingResult.executionId);
    expect(exec!.status).toBe('cancelled');
    expect(exec!.result).toEqual({ reason: 'rejected' });
  });

  it('should throw when confirming a non-existent execution', async () => {
    await expect(
      engine.confirmExecution('non-existent', 'user-1'),
    ).rejects.toThrow(/Execution not found/);
  });

  it('should throw when confirming an already-completed execution', async () => {
    const skillDir = await createTempDir('confirm-skill-');
    await writeConfirmationSkillYaml(skillDir);

    const skill = await engine.install('user-1', skillDir, 'local');
    await engine.updateStatus(skill.id, 'enabled');

    const result = await engine.execute({
      skillId: skill.id,
      serverId: 'server-1',
      userId: 'user-1',
      triggerType: 'manual',
    });

    await expect(
      engine.confirmExecution(result.executionId, 'user-1'),
    ).rejects.toThrow(/not pending confirmation/);
  });

  it('should throw when rejecting a non-pending execution', async () => {
    const skillDir = await createTempDir('confirm-skill-');
    await writeConfirmationSkillYaml(skillDir);

    const skill = await engine.install('user-1', skillDir, 'local');
    await engine.updateStatus(skill.id, 'enabled');

    const result = await engine.execute({
      skillId: skill.id,
      serverId: 'server-1',
      userId: 'user-1',
      triggerType: 'manual',
    });

    await expect(
      engine.rejectExecution(result.executionId, 'user-1'),
    ).rejects.toThrow(/not pending confirmation/);
  });

  it('should list pending confirmations for a user', async () => {
    const skillDir = await createTempDir('confirm-skill-');
    await writeConfirmationSkillYaml(skillDir);

    const skill = await engine.install('user-1', skillDir, 'local');
    await engine.updateStatus(skill.id, 'enabled');

    await engine.execute({
      skillId: skill.id, serverId: 'server-1', userId: 'user-1', triggerType: 'cron',
    });
    await engine.execute({
      skillId: skill.id, serverId: 'server-2', userId: 'user-1', triggerType: 'event',
    });

    const pending = await engine.listPendingConfirmations('user-1');
    expect(pending).toHaveLength(2);
    expect(pending.every((e) => e.status === 'pending_confirmation')).toBe(true);
  });

  it('should expire pending confirmations after TTL', async () => {
    const skillDir = await createTempDir('confirm-skill-');
    await writeConfirmationSkillYaml(skillDir);

    const skill = await engine.install('user-1', skillDir, 'local');
    await engine.updateStatus(skill.id, 'enabled');

    await engine.execute({
      skillId: skill.id, serverId: 'server-1', userId: 'user-1', triggerType: 'cron',
    });

    const pending = await engine.listPendingConfirmations('user-1');
    expect(pending).toHaveLength(1);

    const exec = pending[0];
    // Force startedAt to be 31min ago for expiry test
    const rawExec = await repo.findExecutionById(exec.id);
    (rawExec as { startedAt: string }).startedAt = new Date(Date.now() - 31 * 60 * 1000).toISOString();

    const expired = await engine.expirePendingConfirmations();
    expect(expired).toBe(1);

    const after = await engine.listPendingConfirmations('user-1');
    expect(after).toHaveLength(0);
  });

  it('should not expire recent pending confirmations', async () => {
    const skillDir = await createTempDir('confirm-skill-');
    await writeConfirmationSkillYaml(skillDir);

    const skill = await engine.install('user-1', skillDir, 'local');
    await engine.updateStatus(skill.id, 'enabled');

    await engine.execute({
      skillId: skill.id, serverId: 'server-1', userId: 'user-1', triggerType: 'cron',
    });

    const expired = await engine.expirePendingConfirmations();
    expect(expired).toBe(0);

    const pending = await engine.listPendingConfirmations('user-1');
    expect(pending).toHaveLength(1);
  });
});
