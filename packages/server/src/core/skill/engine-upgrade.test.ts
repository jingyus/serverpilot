// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for SkillEngine.upgrade() — version upgrade preserving config & history.
 *
 * Covers:
 * - Local skill hot-reload
 * - Git skill atomic upgrade
 * - Config preservation
 * - Execution history preservation
 * - Trigger pause/resume during upgrade
 * - Error rollback
 * - Authorization
 * - Version change verification
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

// Mock SkillRunner to avoid AI provider dependency
vi.mock('./runner.js', () => ({
  SkillRunner: vi.fn().mockImplementation(() => ({
    run: vi.fn().mockResolvedValue({
      success: true,
      status: 'success',
      stepsExecuted: 1,
      duration: 10,
      output: 'Mock execution complete',
      errors: [],
      toolResults: [],
    }),
  })),
}));

// Mock TriggerManager to verify pause/resume behavior
const mockTriggerManager = {
  start: vi.fn().mockResolvedValue(undefined),
  stop: vi.fn(),
  registerSkill: vi.fn().mockResolvedValue(undefined),
  unregisterSkill: vi.fn(),
  resetFailureCounter: vi.fn(),
  isRunning: vi.fn().mockReturnValue(false),
};

vi.mock('./trigger-manager.js', () => ({
  TriggerManager: vi.fn().mockImplementation(() => mockTriggerManager),
  setTriggerManager: vi.fn(),
  _resetTriggerManager: vi.fn(),
}));

// Mock WebhookDispatcher
vi.mock('../webhook/dispatcher.js', () => ({
  getWebhookDispatcher: vi.fn().mockReturnValue({
    dispatch: vi.fn().mockResolvedValue(undefined),
  }),
}));

// Mock git-utils (getGitRemoteUrl)
vi.mock('./git-utils.js', () => ({
  getGitRemoteUrl: vi.fn().mockResolvedValue(null),
}));

// Mock git-installer (upgradeFromGitUrl)
vi.mock('./git-installer.js', () => ({
  upgradeFromGitUrl: vi.fn().mockResolvedValue({
    skillDir: '/mock/path',
    manifest: {
      kind: 'skill',
      version: '1.0',
      metadata: { name: 'test-skill', displayName: 'Test Skill', version: '2.0.0' },
      triggers: [{ type: 'manual' }],
      tools: ['shell'],
      prompt: 'Upgraded prompt that is long enough to pass the 50 character validation requirement.',
    },
    warnings: [],
  }),
}));

import { getGitRemoteUrl } from './git-utils.js';
import { upgradeFromGitUrl } from './git-installer.js';

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
  vi.mocked(mockTriggerManager.registerSkill).mockClear();
  vi.mocked(mockTriggerManager.unregisterSkill).mockClear();
  vi.mocked(getGitRemoteUrl).mockReset().mockResolvedValue(null);
  vi.mocked(upgradeFromGitUrl).mockReset();

  repo = new InMemorySkillRepository();
  setSkillRepository(repo);

  const serverRepo = new InMemoryServerRepository();
  setServerRepository(serverRepo);

  projectRoot = await createTempDir('engine-upgrade-');
  engine = new SkillEngine(projectRoot, repo);
});

afterEach(async () => {
  _resetSkillEngine();
  _resetSkillRepository();
  _resetServerRepository();
  await cleanupTempDirs();
});

// ============================================================================
// Helper: write a versioned skill.yaml
// ============================================================================

async function writeVersionedSkillYaml(
  dir: string,
  opts: { name?: string; version?: string; displayName?: string } = {},
): Promise<void> {
  const name = opts.name ?? 'test-skill';
  const version = opts.version ?? '1.0.0';
  const displayName = opts.displayName ?? 'Test Skill';
  const yaml = `kind: skill
version: "1.0"

metadata:
  name: ${name}
  displayName: "${displayName}"
  version: "${version}"

triggers:
  - type: manual

tools:
  - shell

prompt: |
  This is a test prompt that must be at least 50 characters long to pass validation rules properly.
`;
  await writeFile(join(dir, 'skill.yaml'), yaml, 'utf-8');
}

// ============================================================================
// Local skill upgrade (hot-reload from disk)
// ============================================================================

describe('SkillEngine.upgrade — local source', () => {
  it('should upgrade a local skill by re-reading manifest from disk', async () => {
    const skillDir = await createTempDir('skill-');
    await writeVersionedSkillYaml(skillDir, { version: '1.0.0' });

    const skill = await engine.install('user-1', skillDir, 'local');
    expect(skill.version).toBe('1.0.0');

    // Update the skill.yaml on disk to a new version
    await writeVersionedSkillYaml(skillDir, { version: '2.0.0', displayName: 'Updated Skill' });

    const upgraded = await engine.upgrade(skill.id, 'user-1');

    expect(upgraded.version).toBe('2.0.0');
    expect(upgraded.displayName).toBe('Updated Skill');
    expect(upgraded.id).toBe(skill.id); // Same record
    expect(upgraded.source).toBe('local');
  });

  it('should preserve user config after local upgrade', async () => {
    const skillDir = await createTempDir('skill-');
    await writeVersionedSkillYaml(skillDir, { version: '1.0.0' });

    const skill = await engine.install('user-1', skillDir, 'local');
    await engine.configure(skill.id, { apiKey: 'secret-123', threshold: 90 });

    // Update version on disk
    await writeVersionedSkillYaml(skillDir, { version: '1.1.0' });

    const upgraded = await engine.upgrade(skill.id, 'user-1');

    expect(upgraded.version).toBe('1.1.0');
    expect(upgraded.config).toEqual({ apiKey: 'secret-123', threshold: 90 });
  });

  it('should preserve execution history after local upgrade', async () => {
    const skillDir = await createTempDir('skill-');
    await writeVersionedSkillYaml(skillDir, { version: '1.0.0' });

    const skill = await engine.install('user-1', skillDir, 'local');
    await engine.updateStatus(skill.id, 'enabled');

    // Create an execution
    await engine.execute({
      skillId: skill.id,
      serverId: 'server-1',
      userId: 'user-1',
      triggerType: 'manual',
    });

    const execsBefore = await engine.getExecutions(skill.id);
    expect(execsBefore).toHaveLength(1);

    // Upgrade
    await writeVersionedSkillYaml(skillDir, { version: '1.1.0' });
    await engine.upgrade(skill.id, 'user-1');

    // Executions should still be there
    const execsAfter = await engine.getExecutions(skill.id);
    expect(execsAfter).toHaveLength(1);
    expect(execsAfter[0].id).toBe(execsBefore[0].id);
  });

  it('should upgrade official source skills same as local (hot-reload)', async () => {
    const skillDir = await createTempDir('skill-');
    await writeVersionedSkillYaml(skillDir, { name: 'official-skill', version: '1.0.0' });

    const skill = await engine.install('user-1', skillDir, 'official');

    await writeVersionedSkillYaml(skillDir, { name: 'official-skill', version: '2.0.0' });
    const upgraded = await engine.upgrade(skill.id, 'user-1');

    expect(upgraded.version).toBe('2.0.0');
    expect(upgraded.source).toBe('official');
  });

  it('should fail if manifest cannot be loaded from disk', async () => {
    const skillDir = await createTempDir('skill-');
    await writeVersionedSkillYaml(skillDir, { version: '1.0.0' });

    const skill = await engine.install('user-1', skillDir, 'local');

    // Corrupt the skill.yaml
    await writeFile(join(skillDir, 'skill.yaml'), 'invalid: yaml: content', 'utf-8');

    await expect(engine.upgrade(skill.id, 'user-1')).rejects.toThrow();
  });
});

// ============================================================================
// Git (community) skill upgrade
// ============================================================================

describe('SkillEngine.upgrade — community (git) source', () => {
  it('should upgrade a community skill via git clone + atomic swap', async () => {
    const skillDir = await createTempDir('skill-');
    await writeVersionedSkillYaml(skillDir, { version: '1.0.0' });

    const skill = await engine.install('user-1', skillDir, 'community');

    // Mock git remote URL and upgrade
    vi.mocked(getGitRemoteUrl).mockResolvedValue('https://github.com/user/test-skill.git');
    vi.mocked(upgradeFromGitUrl).mockResolvedValue({
      skillDir: skill.skillPath,
      manifest: {
        kind: 'skill',
        version: '1.0',
        metadata: { name: 'test-skill', displayName: 'Test Skill v2', version: '2.0.0' },
        triggers: [{ type: 'manual' }],
        tools: ['shell'],
        prompt: 'Upgraded prompt that is long enough to pass the 50 character validation requirement.',
      },
      warnings: [],
    });

    const upgraded = await engine.upgrade(skill.id, 'user-1');

    expect(upgraded.version).toBe('2.0.0');
    expect(upgraded.displayName).toBe('Test Skill v2');
    expect(vi.mocked(upgradeFromGitUrl)).toHaveBeenCalledWith(
      skill.skillPath,
      'https://github.com/user/test-skill.git',
    );
  });

  it('should preserve config after community upgrade', async () => {
    const skillDir = await createTempDir('skill-');
    await writeVersionedSkillYaml(skillDir, { version: '1.0.0' });

    const skill = await engine.install('user-1', skillDir, 'community');
    await engine.configure(skill.id, { webhook_url: 'https://example.com' });

    vi.mocked(getGitRemoteUrl).mockResolvedValue('https://github.com/user/test-skill.git');
    vi.mocked(upgradeFromGitUrl).mockResolvedValue({
      skillDir: skill.skillPath,
      manifest: {
        kind: 'skill',
        version: '1.0',
        metadata: { name: 'test-skill', displayName: 'Test Skill', version: '2.0.0' },
        triggers: [{ type: 'manual' }],
        tools: ['shell'],
        prompt: 'Upgraded prompt that is long enough to pass the 50 character validation requirement.',
      },
      warnings: [],
    });

    const upgraded = await engine.upgrade(skill.id, 'user-1');

    expect(upgraded.version).toBe('2.0.0');
    expect(upgraded.config).toEqual({ webhook_url: 'https://example.com' });
  });

  it('should fail if git remote URL cannot be determined', async () => {
    const skillDir = await createTempDir('skill-');
    await writeVersionedSkillYaml(skillDir, { version: '1.0.0' });

    const skill = await engine.install('user-1', skillDir, 'community');

    vi.mocked(getGitRemoteUrl).mockResolvedValue(null);

    await expect(engine.upgrade(skill.id, 'user-1')).rejects.toThrow(
      /Cannot determine git remote URL/,
    );
  });

  it('should fail if upgradeFromGitUrl throws (e.g. clone failure)', async () => {
    const skillDir = await createTempDir('skill-');
    await writeVersionedSkillYaml(skillDir, { version: '1.0.0' });

    const skill = await engine.install('user-1', skillDir, 'community');

    vi.mocked(getGitRemoteUrl).mockResolvedValue('https://github.com/user/test-skill.git');
    vi.mocked(upgradeFromGitUrl).mockRejectedValue(
      new Error('Git clone failed during upgrade for "https://github.com/user/test-skill.git": timeout'),
    );

    await expect(engine.upgrade(skill.id, 'user-1')).rejects.toThrow(
      /Git clone failed during upgrade/,
    );
  });
});

// ============================================================================
// Trigger management during upgrade
// ============================================================================

describe('SkillEngine.upgrade — trigger management', () => {
  it('should pause and re-register triggers for enabled skills', async () => {
    const skillDir = await createTempDir('skill-');
    await writeVersionedSkillYaml(skillDir, { version: '1.0.0' });

    const skill = await engine.install('user-1', skillDir, 'local');
    await engine.start();
    await engine.updateStatus(skill.id, 'enabled');

    // Clear mocks after setup
    vi.mocked(mockTriggerManager.unregisterSkill).mockClear();
    vi.mocked(mockTriggerManager.registerSkill).mockClear();

    await writeVersionedSkillYaml(skillDir, { version: '1.1.0' });
    await engine.upgrade(skill.id, 'user-1');

    // Triggers should have been paused and re-registered
    expect(mockTriggerManager.unregisterSkill).toHaveBeenCalledWith(skill.id);
    expect(mockTriggerManager.registerSkill).toHaveBeenCalledTimes(1);

    engine.stop();
  });

  it('should re-register triggers even if upgrade fails (for enabled skills)', async () => {
    const skillDir = await createTempDir('skill-');
    await writeVersionedSkillYaml(skillDir, { version: '1.0.0' });

    const skill = await engine.install('user-1', skillDir, 'local');
    await engine.start();
    await engine.updateStatus(skill.id, 'enabled');

    vi.mocked(mockTriggerManager.unregisterSkill).mockClear();
    vi.mocked(mockTriggerManager.registerSkill).mockClear();

    // Corrupt the yaml so upgrade fails
    await writeFile(join(skillDir, 'skill.yaml'), 'corrupt yaml', 'utf-8');

    await expect(engine.upgrade(skill.id, 'user-1')).rejects.toThrow();

    // Triggers should have been re-registered despite failure
    expect(mockTriggerManager.unregisterSkill).toHaveBeenCalledWith(skill.id);
    expect(mockTriggerManager.registerSkill).toHaveBeenCalledTimes(1);

    engine.stop();
  });

  it('should not touch triggers for non-enabled skills', async () => {
    const skillDir = await createTempDir('skill-');
    await writeVersionedSkillYaml(skillDir, { version: '1.0.0' });

    const skill = await engine.install('user-1', skillDir, 'local');
    await engine.start();
    // Skill stays in 'installed' status — not enabled

    vi.mocked(mockTriggerManager.unregisterSkill).mockClear();
    vi.mocked(mockTriggerManager.registerSkill).mockClear();

    await writeVersionedSkillYaml(skillDir, { version: '1.1.0' });
    await engine.upgrade(skill.id, 'user-1');

    expect(mockTriggerManager.unregisterSkill).not.toHaveBeenCalled();
    expect(mockTriggerManager.registerSkill).not.toHaveBeenCalled();

    engine.stop();
  });
});

// ============================================================================
// Error & authorization
// ============================================================================

describe('SkillEngine.upgrade — error handling', () => {
  it('should throw if skill does not exist', async () => {
    await expect(engine.upgrade('nonexistent', 'user-1')).rejects.toThrow(
      /Skill not found/,
    );
  });

  it('should throw if userId does not own the skill', async () => {
    const skillDir = await createTempDir('skill-');
    await writeVersionedSkillYaml(skillDir, { version: '1.0.0' });

    const skill = await engine.install('user-1', skillDir, 'local');

    await expect(engine.upgrade(skill.id, 'user-2')).rejects.toThrow(
      /Not authorized/,
    );
  });

  it('should update manifestInputs when new version adds inputs', async () => {
    const skillDir = await createTempDir('skill-');
    await writeVersionedSkillYaml(skillDir, { version: '1.0.0' });

    const skill = await engine.install('user-1', skillDir, 'local');
    expect(skill.manifestInputs).toBeNull();

    // Write new version with inputs
    const yamlWithInputs = `kind: skill
version: "1.0"

metadata:
  name: test-skill
  displayName: "Test Skill"
  version: "2.0.0"

triggers:
  - type: manual

tools:
  - shell

inputs:
  - name: target_path
    type: string
    required: true
    description: "Path to analyze"

prompt: |
  Analyze the target {{input.target_path}}. This prompt is long enough to pass the 50 character validation.
`;
    await writeFile(join(skillDir, 'skill.yaml'), yamlWithInputs, 'utf-8');

    const upgraded = await engine.upgrade(skill.id, 'user-1');

    expect(upgraded.version).toBe('2.0.0');
    expect(upgraded.manifestInputs).toBeDefined();
    expect(upgraded.manifestInputs).toHaveLength(1);
    expect((upgraded.manifestInputs as Array<{ name: string }>)[0].name).toBe('target_path');
  });
});
