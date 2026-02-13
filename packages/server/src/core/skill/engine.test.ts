// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for SkillEngine — lifecycle, install, uninstall, configure, and status transitions.
 *
 * Execute / webhook / query tests are in separate files:
 * - engine-execute.test.ts  (execute, template injection, batch execution)
 * - engine-webhook.test.ts  (webhook dispatch, chain context)
 * - engine-queries.test.ts  (queries, singleton, listAvailable, full lifecycle)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';

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
// Lifecycle: start / stop
// ============================================================================

describe('SkillEngine lifecycle', () => {
  it('should start and stop without error', async () => {
    await engine.start();
    await engine.start(); // idempotent
    engine.stop();
    engine.stop(); // idempotent
  });

  it('should start confirmation cleanup timer on start and clear on stop', async () => {
    vi.useFakeTimers();
    try {
      const expireSpy = vi.spyOn(engine, 'expirePendingConfirmations').mockResolvedValue(0);

      await engine.start();

      // Timer should not have fired yet
      expect(expireSpy).not.toHaveBeenCalled();

      // Advance 10 minutes — timer should fire once
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
      expect(expireSpy).toHaveBeenCalledTimes(1);

      // Advance another 10 minutes — fires again
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
      expect(expireSpy).toHaveBeenCalledTimes(2);

      engine.stop();

      // After stop, advancing time should not trigger more calls
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
      expect(expireSpy).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('should log expired count when confirmations are cleaned up', async () => {
    vi.useFakeTimers();
    try {
      const expireSpy = vi.spyOn(engine, 'expirePendingConfirmations').mockResolvedValue(3);

      await engine.start();

      // Advance to trigger cleanup — should resolve without error
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
      expect(expireSpy).toHaveBeenCalledTimes(1);

      engine.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('should handle errors in confirmation cleanup gracefully', async () => {
    vi.useFakeTimers();
    try {
      const expireSpy = vi.spyOn(engine, 'expirePendingConfirmations')
        .mockRejectedValue(new Error('DB connection lost'));

      await engine.start();

      // Advance timer — error should be caught, not thrown
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
      expect(expireSpy).toHaveBeenCalledTimes(1);

      // Engine should still be running — next interval still fires
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
      expect(expireSpy).toHaveBeenCalledTimes(2);

      engine.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});

// ============================================================================
// Install
// ============================================================================

describe('SkillEngine.install', () => {
  it('should install a valid skill from disk', async () => {
    const skillDir = await createTempDir('skill-');
    await writeSkillYaml(skillDir);

    const skill = await engine.install('user-1', skillDir, 'local');

    expect(skill.id).toBeDefined();
    expect(skill.name).toBe('test-skill');
    expect(skill.displayName).toBe('Test Skill');
    expect(skill.version).toBe('1.0.0');
    expect(skill.source).toBe('local');
    expect(skill.status).toBe('installed');
    expect(skill.userId).toBe('user-1');
    expect(skill.config).toBeNull();
  });

  it('should reject duplicate installation (same user + name)', async () => {
    const skillDir = await createTempDir('skill-');
    await writeSkillYaml(skillDir);

    await engine.install('user-1', skillDir, 'local');

    await expect(engine.install('user-1', skillDir, 'local')).rejects.toThrow(
      /already installed/,
    );
  });

  it('should allow same skill name for different users', async () => {
    const skillDir = await createTempDir('skill-');
    await writeSkillYaml(skillDir);

    const s1 = await engine.install('user-1', skillDir, 'local');
    const s2 = await engine.install('user-2', skillDir, 'local');

    expect(s1.userId).toBe('user-1');
    expect(s2.userId).toBe('user-2');
    expect(s1.id).not.toBe(s2.id);
  });

  it('should reject installation from invalid directory (no skill.yaml)', async () => {
    const emptyDir = await createTempDir('empty-');

    await expect(engine.install('user-1', emptyDir, 'local')).rejects.toThrow(
      /skill\.yaml not found/,
    );
  });

  it('should reject installation with invalid YAML schema', async () => {
    const badDir = await createTempDir('bad-');
    await writeFile(join(badDir, 'skill.yaml'), 'kind: invalid\nversion: "1.0"\n', 'utf-8');

    await expect(engine.install('user-1', badDir, 'local')).rejects.toThrow(
      /validation failed/i,
    );
  });

  it('should install with official source type', async () => {
    const skillDir = await createTempDir('skill-');
    await writeSkillYaml(skillDir, { name: 'official-skill' });

    const skill = await engine.install('user-1', skillDir, 'official');

    expect(skill.source).toBe('official');
  });

  it('should install with community source type', async () => {
    const skillDir = await createTempDir('skill-');
    await writeSkillYaml(skillDir, { name: 'community-skill' });

    const skill = await engine.install('user-1', skillDir, 'community');

    expect(skill.source).toBe('community');
  });
});

// ============================================================================
// Uninstall
// ============================================================================

describe('SkillEngine.uninstall', () => {
  it('should uninstall an existing skill', async () => {
    const skillDir = await createTempDir('skill-');
    await writeSkillYaml(skillDir);

    const skill = await engine.install('user-1', skillDir, 'local');
    await engine.uninstall(skill.id);

    const found = await engine.getInstalled(skill.id);
    expect(found).toBeNull();
  });

  it('should throw when uninstalling a non-existent skill', async () => {
    await expect(engine.uninstall('non-existent-id')).rejects.toThrow(
      /Skill not found/,
    );
  });

  it('should also remove executions when skill is uninstalled', async () => {
    const skillDir = await createTempDir('skill-');
    await writeSkillYaml(skillDir);

    const skill = await engine.install('user-1', skillDir, 'local');
    await engine.updateStatus(skill.id, 'enabled');
    await engine.execute({
      skillId: skill.id,
      serverId: 'server-1',
      userId: 'user-1',
      triggerType: 'manual',
    });

    const execsBefore = await engine.getExecutions(skill.id);
    expect(execsBefore).toHaveLength(1);

    await engine.uninstall(skill.id);

    const execsAfter = await engine.getExecutions(skill.id);
    expect(execsAfter).toHaveLength(0);
  });
});

// ============================================================================
// Configure
// ============================================================================

describe('SkillEngine.configure', () => {
  it('should update config on an installed skill', async () => {
    const skillDir = await createTempDir('skill-');
    await writeSkillYaml(skillDir);

    const skill = await engine.install('user-1', skillDir, 'local');
    await engine.configure(skill.id, { key: 'value', count: 42 });

    const updated = await engine.getInstalled(skill.id);
    expect(updated!.config).toEqual({ key: 'value', count: 42 });
  });

  it('should auto-transition from installed → configured on first config', async () => {
    const skillDir = await createTempDir('skill-');
    await writeSkillYaml(skillDir);

    const skill = await engine.install('user-1', skillDir, 'local');
    expect(skill.status).toBe('installed');

    await engine.configure(skill.id, { key: 'value' });

    const updated = await engine.getInstalled(skill.id);
    expect(updated!.status).toBe('configured');
  });

  it('should not change status if already beyond installed', async () => {
    const skillDir = await createTempDir('skill-');
    await writeSkillYaml(skillDir);

    const skill = await engine.install('user-1', skillDir, 'local');
    await engine.updateStatus(skill.id, 'enabled');

    await engine.configure(skill.id, { key: 'new-value' });

    const updated = await engine.getInstalled(skill.id);
    expect(updated!.status).toBe('enabled');
    expect(updated!.config).toEqual({ key: 'new-value' });
  });

  it('should throw when configuring a non-existent skill', async () => {
    await expect(
      engine.configure('non-existent-id', { key: 'val' }),
    ).rejects.toThrow(/Skill not found/);
  });
});

// ============================================================================
// Status Transitions
// ============================================================================

describe('SkillEngine.updateStatus', () => {
  it('should allow installed → enabled', async () => {
    const skillDir = await createTempDir('skill-');
    await writeSkillYaml(skillDir);

    const skill = await engine.install('user-1', skillDir, 'local');
    await engine.updateStatus(skill.id, 'enabled');

    const updated = await engine.getInstalled(skill.id);
    expect(updated!.status).toBe('enabled');
  });

  it('should allow enabled → paused → enabled cycle', async () => {
    const skillDir = await createTempDir('skill-');
    await writeSkillYaml(skillDir);

    const skill = await engine.install('user-1', skillDir, 'local');
    await engine.updateStatus(skill.id, 'enabled');
    await engine.updateStatus(skill.id, 'paused');

    let updated = await engine.getInstalled(skill.id);
    expect(updated!.status).toBe('paused');

    await engine.updateStatus(skill.id, 'enabled');
    updated = await engine.getInstalled(skill.id);
    expect(updated!.status).toBe('enabled');
  });

  it('should allow error → installed recovery', async () => {
    const skillDir = await createTempDir('skill-');
    await writeSkillYaml(skillDir);

    const skill = await engine.install('user-1', skillDir, 'local');
    await engine.updateStatus(skill.id, 'error');

    let updated = await engine.getInstalled(skill.id);
    expect(updated!.status).toBe('error');

    await engine.updateStatus(skill.id, 'installed');
    updated = await engine.getInstalled(skill.id);
    expect(updated!.status).toBe('installed');
  });

  it('should reject invalid transition installed → paused', async () => {
    const skillDir = await createTempDir('skill-');
    await writeSkillYaml(skillDir);

    const skill = await engine.install('user-1', skillDir, 'local');

    await expect(engine.updateStatus(skill.id, 'paused')).rejects.toThrow(
      /Invalid status transition: installed → paused/,
    );
  });

  it('should reject transition to same status (enabled → enabled)', async () => {
    const skillDir = await createTempDir('skill-');
    await writeSkillYaml(skillDir);

    const skill = await engine.install('user-1', skillDir, 'local');
    await engine.updateStatus(skill.id, 'enabled');

    await expect(engine.updateStatus(skill.id, 'enabled')).rejects.toThrow(
      /Invalid status transition/,
    );
  });

  it('should throw when updating status of non-existent skill', async () => {
    await expect(engine.updateStatus('non-existent', 'enabled')).rejects.toThrow(
      /Skill not found/,
    );
  });
});

// ============================================================================
// Execution Cleanup
// ============================================================================

describe('SkillEngine.cleanupOldExecutions', () => {
  it('should delete old completed executions via cleanupOldExecutions', async () => {
    const skillDir = await createTempDir('skill-');
    await writeSkillYaml(skillDir);
    const skill = await engine.install('user-1', skillDir, 'local');
    await engine.updateStatus(skill.id, 'enabled');

    // Execute the skill to create an execution record
    await engine.execute({
      skillId: skill.id, serverId: 'server-1', userId: 'user-1', triggerType: 'manual',
    });

    const before = await engine.getExecutions(skill.id);
    expect(before).toHaveLength(1);

    // Mock deleteExecutionsBefore to simulate deletion
    const deleteSpy = vi.spyOn(repo, 'deleteExecutionsBefore').mockResolvedValue(1);

    const deleted = await engine.cleanupOldExecutions();
    expect(deleted).toBe(1);
    expect(deleteSpy).toHaveBeenCalledTimes(1);

    // Verify the cutoff is approximately 90 days ago
    const cutoffArg = deleteSpy.mock.calls[0][0];
    const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;
    const diff = Math.abs(Date.now() - ninetyDaysMs - cutoffArg.getTime());
    expect(diff).toBeLessThan(5000); // within 5 seconds
  });

  it('should return 0 when no old executions exist', async () => {
    const deleted = await engine.cleanupOldExecutions();
    expect(deleted).toBe(0);
  });

  it('should start execution cleanup timer on start and clear on stop', async () => {
    vi.useFakeTimers();
    try {
      const cleanupSpy = vi.spyOn(engine, 'cleanupOldExecutions').mockResolvedValue(0);

      await engine.start();

      // Initial cleanup fires immediately on start
      expect(cleanupSpy).toHaveBeenCalledTimes(1);

      // Advance 24 hours — timer should fire again
      await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
      expect(cleanupSpy).toHaveBeenCalledTimes(2);

      engine.stop();

      // After stop, no more calls
      await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
      expect(cleanupSpy).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
