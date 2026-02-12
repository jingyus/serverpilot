// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for SkillEngine — lifecycle management, execution, and queries.
 *
 * Uses InMemorySkillRepository and temp directories with valid skill.yaml files.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';

import { SkillEngine, _resetSkillEngine } from './engine.js';
import {
  InMemorySkillRepository,
  setSkillRepository,
  _resetSkillRepository,
} from '../../db/repositories/skill-repository.js';
import type { SkillRunParams } from './types.js';

// ============================================================================
// Helpers
// ============================================================================

let tempDirs: string[] = [];

async function createTempDir(prefix = 'engine-test-'): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

/** Write a minimal valid skill.yaml to a directory. */
async function writeSkillYaml(
  dir: string,
  overrides: { name?: string; prompt?: string; triggers?: string; tools?: string } = {},
): Promise<void> {
  const name = overrides.name ?? 'test-skill';
  const prompt =
    overrides.prompt ??
    'This is a test prompt that must be at least 50 characters long to pass validation rules properly.';
  const triggers = overrides.triggers ?? '  - type: manual';
  const tools = overrides.tools ?? '  - shell';

  const yaml = `kind: skill
version: "1.0"

metadata:
  name: ${name}
  displayName: "Test Skill"
  version: "1.0.0"

triggers:
${triggers}

tools:
${tools}

prompt: |
  ${prompt}
`;
  await writeFile(join(dir, 'skill.yaml'), yaml, 'utf-8');
}

/** Write a skill.yaml that uses template variables. */
async function writeTemplatedSkillYaml(dir: string): Promise<void> {
  const yaml = `kind: skill
version: "1.0"

metadata:
  name: templated-skill
  displayName: "Templated Skill"
  version: "1.0.0"

triggers:
  - type: manual

tools:
  - shell

inputs:
  - name: target_dir
    type: string
    required: false
    default: "/var/log"
    description: "Target directory to check"

prompt: |
  Analyze the directory {{input.target_dir}} on server {{server.name}}.
  Current time: {{now}}. Last run: {{skill.last_run}}.
  This prompt is long enough to meet the minimum 50-character validation requirement.
`;
  await writeFile(join(dir, 'skill.yaml'), yaml, 'utf-8');
}

let repo: InMemorySkillRepository;
let engine: SkillEngine;
let projectRoot: string;

beforeEach(async () => {
  _resetSkillEngine();
  _resetSkillRepository();

  repo = new InMemorySkillRepository();
  setSkillRepository(repo);

  projectRoot = await createTempDir('engine-root-');
  engine = new SkillEngine(projectRoot, repo);
});

afterEach(async () => {
  _resetSkillEngine();
  _resetSkillRepository();

  for (const dir of tempDirs) {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
  tempDirs = [];
});

// ============================================================================
// Lifecycle: start / stop
// ============================================================================

describe('SkillEngine lifecycle', () => {
  it('should start and stop without error', () => {
    engine.start();
    engine.start(); // idempotent
    engine.stop();
    engine.stop(); // idempotent
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
    // Enable it first so we can execute
    await engine.updateStatus(skill.id, 'enabled');
    await engine.execute({
      skillId: skill.id,
      serverId: 'server-1',
      userId: 'user-1',
      triggerType: 'manual',
    });

    // Verify execution exists
    const execsBefore = await engine.getExecutions(skill.id);
    expect(execsBefore).toHaveLength(1);

    // Uninstall — InMemorySkillRepository cascades execution deletion
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
// Execute
// ============================================================================

describe('SkillEngine.execute', () => {
  it('should execute an enabled skill successfully (Phase 1 stub)', async () => {
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

    expect(result.executionId).toBeDefined();
    expect(result.status).toBe('success');
    expect(result.stepsExecuted).toBe(0); // Phase 1 stub
    expect(result.duration).toBeGreaterThanOrEqual(0);
    expect(result.errors).toEqual([]);
    expect(result.result).toBeDefined();
    expect(result.result!['phase']).toContain('AI Runner pending');
  });

  it('should resolve template variables in the prompt', async () => {
    const skillDir = await createTempDir('skill-');
    await writeTemplatedSkillYaml(skillDir);

    const skill = await engine.install('user-1', skillDir, 'local');
    await engine.updateStatus(skill.id, 'enabled');

    const result = await engine.execute({
      skillId: skill.id,
      serverId: 'server-1',
      userId: 'user-1',
      triggerType: 'manual',
      config: { target_dir: '/opt/logs' },
    });

    expect(result.status).toBe('success');
    const resolvedPrompt = result.result!['resolvedPrompt'] as string;
    expect(resolvedPrompt).toContain('/opt/logs');
    // {{server.name}} should remain unresolved since no server context provided
    expect(resolvedPrompt).toContain('{{server.name}}');
  });

  it('should merge runtime config with stored config', async () => {
    const skillDir = await createTempDir('skill-');
    await writeTemplatedSkillYaml(skillDir);

    const skill = await engine.install('user-1', skillDir, 'local');
    await engine.configure(skill.id, { target_dir: '/var/log/stored' });
    await engine.updateStatus(skill.id, 'enabled');

    // Runtime config overrides stored config
    const result = await engine.execute({
      skillId: skill.id,
      serverId: 'server-1',
      userId: 'user-1',
      triggerType: 'manual',
      config: { target_dir: '/var/log/runtime' },
    });

    const resolvedPrompt = result.result!['resolvedPrompt'] as string;
    expect(resolvedPrompt).toContain('/var/log/runtime');
  });

  it('should use stored config when no runtime config provided', async () => {
    const skillDir = await createTempDir('skill-');
    await writeTemplatedSkillYaml(skillDir);

    const skill = await engine.install('user-1', skillDir, 'local');
    await engine.configure(skill.id, { target_dir: '/var/log/stored' });
    await engine.updateStatus(skill.id, 'enabled');

    const result = await engine.execute({
      skillId: skill.id,
      serverId: 'server-1',
      userId: 'user-1',
      triggerType: 'manual',
    });

    const resolvedPrompt = result.result!['resolvedPrompt'] as string;
    expect(resolvedPrompt).toContain('/var/log/stored');
  });

  it('should reject execution of a non-enabled skill', async () => {
    const skillDir = await createTempDir('skill-');
    await writeSkillYaml(skillDir);

    const skill = await engine.install('user-1', skillDir, 'local');
    // Status is 'installed', not 'enabled'

    await expect(
      engine.execute({
        skillId: skill.id,
        serverId: 'server-1',
        userId: 'user-1',
        triggerType: 'manual',
      }),
    ).rejects.toThrow(/not enabled/);
  });

  it('should reject execution of a paused skill', async () => {
    const skillDir = await createTempDir('skill-');
    await writeSkillYaml(skillDir);

    const skill = await engine.install('user-1', skillDir, 'local');
    await engine.updateStatus(skill.id, 'enabled');
    await engine.updateStatus(skill.id, 'paused');

    await expect(
      engine.execute({
        skillId: skill.id,
        serverId: 'server-1',
        userId: 'user-1',
        triggerType: 'manual',
      }),
    ).rejects.toThrow(/not enabled/);
  });

  it('should reject execution of a non-existent skill', async () => {
    await expect(
      engine.execute({
        skillId: 'non-existent',
        serverId: 'server-1',
        userId: 'user-1',
        triggerType: 'manual',
      }),
    ).rejects.toThrow(/Skill not found/);
  });

  it('should set skill to error state if manifest fails to load', async () => {
    const skillDir = await createTempDir('skill-');
    await writeSkillYaml(skillDir);

    const skill = await engine.install('user-1', skillDir, 'local');
    await engine.updateStatus(skill.id, 'enabled');

    // Delete the skill.yaml after installation to simulate disk failure
    const { rm: rmFile } = await import('node:fs/promises');
    await rmFile(join(skillDir, 'skill.yaml'));

    await expect(
      engine.execute({
        skillId: skill.id,
        serverId: 'server-1',
        userId: 'user-1',
        triggerType: 'manual',
      }),
    ).rejects.toThrow(/Failed to load skill manifest/);

    // Skill should be set to error status
    const updated = await engine.getInstalled(skill.id);
    expect(updated!.status).toBe('error');
  });

  it('should record execution with correct metadata', async () => {
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

    // Check execution record in repository
    const execs = await engine.getExecutions(skill.id);
    expect(execs).toHaveLength(1);
    expect(execs[0].id).toBe(result.executionId);
    expect(execs[0].skillId).toBe(skill.id);
    expect(execs[0].serverId).toBe('server-1');
    expect(execs[0].userId).toBe('user-1');
    expect(execs[0].triggerType).toBe('manual');
    expect(execs[0].status).toBe('success');
    expect(execs[0].completedAt).toBeDefined();
    expect(execs[0].stepsExecuted).toBe(0);
    expect(execs[0].duration).toBeGreaterThanOrEqual(0);
  });

  it('should include manifest metadata in execution result', async () => {
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

    const manifest = result.result!['manifest'] as Record<string, unknown>;
    expect(manifest['name']).toBe('test-skill');
    expect(manifest['version']).toBe('1.0.0');
    expect(manifest['tools']).toEqual(['shell']);
  });
});

// ============================================================================
// Queries
// ============================================================================

describe('SkillEngine queries', () => {
  it('listInstalled should return all skills for a user', async () => {
    const dir1 = await createTempDir('skill-1-');
    await writeSkillYaml(dir1, { name: 'skill-one' });
    const dir2 = await createTempDir('skill-2-');
    await writeSkillYaml(dir2, { name: 'skill-two' });

    await engine.install('user-1', dir1, 'local');
    await engine.install('user-1', dir2, 'local');

    const skills = await engine.listInstalled('user-1');
    expect(skills).toHaveLength(2);

    const names = skills.map((s) => s.name);
    expect(names).toContain('skill-one');
    expect(names).toContain('skill-two');
  });

  it('listInstalled should return empty for user with no skills', async () => {
    const skills = await engine.listInstalled('user-no-skills');
    expect(skills).toHaveLength(0);
  });

  it('listInstalled should not leak skills between users', async () => {
    const dir1 = await createTempDir('skill-');
    await writeSkillYaml(dir1, { name: 'user1-skill' });

    await engine.install('user-1', dir1, 'local');

    const user2Skills = await engine.listInstalled('user-2');
    expect(user2Skills).toHaveLength(0);
  });

  it('getInstalled should return a single skill by ID', async () => {
    const skillDir = await createTempDir('skill-');
    await writeSkillYaml(skillDir);

    const skill = await engine.install('user-1', skillDir, 'local');
    const found = await engine.getInstalled(skill.id);

    expect(found).toBeDefined();
    expect(found!.id).toBe(skill.id);
    expect(found!.name).toBe('test-skill');
  });

  it('getInstalled should return null for non-existent ID', async () => {
    const found = await engine.getInstalled('non-existent');
    expect(found).toBeNull();
  });

  it('getExecutions should return execution history for a skill', async () => {
    const skillDir = await createTempDir('skill-');
    await writeSkillYaml(skillDir);

    const skill = await engine.install('user-1', skillDir, 'local');
    await engine.updateStatus(skill.id, 'enabled');

    // Execute twice
    await engine.execute({
      skillId: skill.id,
      serverId: 'server-1',
      userId: 'user-1',
      triggerType: 'manual',
    });
    await engine.execute({
      skillId: skill.id,
      serverId: 'server-2',
      userId: 'user-1',
      triggerType: 'manual',
    });

    const execs = await engine.getExecutions(skill.id);
    expect(execs).toHaveLength(2);
  });

  it('getExecutions should respect limit parameter', async () => {
    const skillDir = await createTempDir('skill-');
    await writeSkillYaml(skillDir);

    const skill = await engine.install('user-1', skillDir, 'local');
    await engine.updateStatus(skill.id, 'enabled');

    // Execute 5 times
    for (let i = 0; i < 5; i++) {
      await engine.execute({
        skillId: skill.id,
        serverId: `server-${i}`,
        userId: 'user-1',
        triggerType: 'manual',
      });
    }

    const execs = await engine.getExecutions(skill.id, 3);
    expect(execs).toHaveLength(3);
  });

  it('getExecution should return a single execution by ID', async () => {
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

    const exec = await engine.getExecution(result.executionId);
    expect(exec).toBeDefined();
    expect(exec!.id).toBe(result.executionId);
    expect(exec!.status).toBe('success');
  });

  it('getExecution should return null for non-existent execution', async () => {
    const exec = await engine.getExecution('non-existent');
    expect(exec).toBeNull();
  });
});

// ============================================================================
// Singleton Pattern
// ============================================================================

describe('SkillEngine singleton', () => {
  it('getSkillEngine should create and return a singleton', async () => {
    const { getSkillEngine } = await import('./engine.js');

    _resetSkillEngine();
    const e1 = getSkillEngine(projectRoot);
    const e2 = getSkillEngine(); // should return same instance
    expect(e1).toBe(e2);
    _resetSkillEngine();
  });

  it('getSkillEngine should throw if called without projectRoot on first call', async () => {
    const { getSkillEngine } = await import('./engine.js');

    _resetSkillEngine();
    expect(() => getSkillEngine()).toThrow(/not initialized/);
    _resetSkillEngine();
  });

  it('setSkillEngine should override the singleton', async () => {
    const { getSkillEngine, setSkillEngine } = await import('./engine.js');

    _resetSkillEngine();
    const custom = new SkillEngine(projectRoot, repo);
    setSkillEngine(custom);
    expect(getSkillEngine()).toBe(custom);
    _resetSkillEngine();
  });

  it('_resetSkillEngine should clear the singleton', async () => {
    const { getSkillEngine } = await import('./engine.js');

    _resetSkillEngine();
    getSkillEngine(projectRoot);
    _resetSkillEngine();
    expect(() => getSkillEngine()).toThrow(/not initialized/);
  });
});

// ============================================================================
// listAvailable (directory scan integration)
// ============================================================================

describe('SkillEngine.listAvailable', () => {
  it('should scan skill directories and mark installed skills', async () => {
    // Create project structure with skills/official/
    const officialDir = join(projectRoot, 'skills', 'official');
    await mkdir(officialDir, { recursive: true });

    // Create two skill subdirectories
    const skillA = join(officialDir, 'skill-a');
    const skillB = join(officialDir, 'skill-b');
    await mkdir(skillA);
    await mkdir(skillB);
    await writeSkillYaml(skillA, { name: 'skill-a' });
    await writeSkillYaml(skillB, { name: 'skill-b' });

    // Install skill-a
    await engine.install('user-1', skillA, 'official');

    const available = await engine.listAvailable('user-1');
    expect(available.length).toBeGreaterThanOrEqual(2);

    const a = available.find((s) => s.manifest.metadata.name === 'skill-a');
    const b = available.find((s) => s.manifest.metadata.name === 'skill-b');

    expect(a).toBeDefined();
    expect(a!.installed).toBe(true);
    expect(a!.source).toBe('official');

    expect(b).toBeDefined();
    expect(b!.installed).toBe(false);
  });

  it('should return empty array when no skill directories exist', async () => {
    // projectRoot has no skills/ directory
    const available = await engine.listAvailable('user-1');
    expect(available).toEqual([]);
  });
});

// ============================================================================
// Full Lifecycle Integration
// ============================================================================

describe('SkillEngine full lifecycle', () => {
  it('should support install → configure → enable → execute → pause → enable → execute → uninstall', async () => {
    const skillDir = await createTempDir('lifecycle-');
    await writeSkillYaml(skillDir, { name: 'lifecycle-skill' });

    // Install
    const skill = await engine.install('user-1', skillDir, 'local');
    expect(skill.status).toBe('installed');

    // Configure
    await engine.configure(skill.id, { key: 'val' });
    let updated = await engine.getInstalled(skill.id);
    expect(updated!.status).toBe('configured');

    // Enable
    await engine.updateStatus(skill.id, 'enabled');
    updated = await engine.getInstalled(skill.id);
    expect(updated!.status).toBe('enabled');

    // Execute #1
    const result1 = await engine.execute({
      skillId: skill.id,
      serverId: 'server-1',
      userId: 'user-1',
      triggerType: 'manual',
    });
    expect(result1.status).toBe('success');

    // Pause
    await engine.updateStatus(skill.id, 'paused');

    // Cannot execute while paused
    await expect(
      engine.execute({
        skillId: skill.id,
        serverId: 'server-1',
        userId: 'user-1',
        triggerType: 'manual',
      }),
    ).rejects.toThrow(/not enabled/);

    // Re-enable
    await engine.updateStatus(skill.id, 'enabled');

    // Execute #2
    const result2 = await engine.execute({
      skillId: skill.id,
      serverId: 'server-1',
      userId: 'user-1',
      triggerType: 'manual',
    });
    expect(result2.status).toBe('success');

    // Verify 2 executions recorded
    const execs = await engine.getExecutions(skill.id);
    expect(execs).toHaveLength(2);

    // Uninstall
    await engine.uninstall(skill.id);
    expect(await engine.getInstalled(skill.id)).toBeNull();
    expect(await engine.getExecutions(skill.id)).toHaveLength(0);
  });
});
