// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for SkillLoader — YAML parsing, schema validation, template engine,
 * directory scanning, and requirements checking.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';

import {
  loadSkillFromDir,
  scanSkillDirectories,
  resolvePromptTemplate,
  checkRequirements,
  type TemplateVars,
} from './loader.js';

import type { SkillManifest } from '@aiinstaller/shared';
import type { ServerProfile, OsInfo, Software } from '../../db/repositories/server-repository.js';

// ============================================================================
// Helpers
// ============================================================================

let tempDirs: string[] = [];

async function createTempDir(prefix = 'skill-test-'): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

/** Write a minimal valid skill.yaml to a directory */
async function writeSkillYaml(dir: string, content: string): Promise<void> {
  await writeFile(join(dir, 'skill.yaml'), content, 'utf-8');
}

const MINIMAL_SKILL_YAML = `
kind: skill
version: "1.0"

metadata:
  name: test-skill
  displayName: "Test Skill"
  version: "1.0.0"

triggers:
  - type: manual

tools:
  - shell

prompt: |
  This is a test prompt that must be at least 50 characters long to pass validation.
`;

function makeServerProfile(overrides?: Partial<{
  osInfo: OsInfo | null;
  software: Software[];
}>): ServerProfile {
  return {
    serverId: 'srv-1',
    osInfo: overrides?.osInfo ?? {
      platform: 'linux',
      arch: 'x86_64',
      version: 'Ubuntu 22.04',
      kernel: '5.15.0-generic',
      hostname: 'test-server',
      uptime: 86400,
    },
    software: overrides?.software ?? [],
    services: [],
    updatedAt: new Date().toISOString(),
  };
}

// ============================================================================
// Setup / Teardown
// ============================================================================

afterEach(async () => {
  for (const dir of tempDirs) {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
  tempDirs = [];
});

// ============================================================================
// loadSkillFromDir Tests
// ============================================================================

describe('loadSkillFromDir', () => {
  it('should load a valid minimal skill.yaml', async () => {
    const dir = await createTempDir();
    await writeSkillYaml(dir, MINIMAL_SKILL_YAML);

    const manifest = await loadSkillFromDir(dir);

    expect(manifest.kind).toBe('skill');
    expect(manifest.version).toBe('1.0');
    expect(manifest.metadata.name).toBe('test-skill');
    expect(manifest.metadata.displayName).toBe('Test Skill');
    expect(manifest.metadata.version).toBe('1.0.0');
    expect(manifest.triggers).toHaveLength(1);
    expect(manifest.triggers[0].type).toBe('manual');
    expect(manifest.tools).toContain('shell');
    expect(manifest.prompt.length).toBeGreaterThan(50);
  });

  it('should load official log-auditor skill from disk', async () => {
    const officialDir = join(process.cwd(), 'skills/official/log-auditor');
    const manifest = await loadSkillFromDir(officialDir);

    expect(manifest.metadata.name).toBe('log-auditor');
    expect(manifest.metadata.displayName).toBe('智能日志审查');
    expect(manifest.triggers.length).toBeGreaterThanOrEqual(1);
    expect(manifest.tools).toContain('shell');
    expect(manifest.tools).toContain('read_file');
  });

  it('should load official intrusion-detector skill from disk', async () => {
    const officialDir = join(process.cwd(), 'skills/official/intrusion-detector');
    const manifest = await loadSkillFromDir(officialDir);

    expect(manifest.metadata.name).toBe('intrusion-detector');
    expect(manifest.requires?.commands).toContain('ss');
  });

  it('should load official auto-backup skill from disk', async () => {
    const officialDir = join(process.cwd(), 'skills/official/auto-backup');
    const manifest = await loadSkillFromDir(officialDir);

    expect(manifest.metadata.name).toBe('auto-backup');
    expect(manifest.constraints.risk_level_max).toBe('red');
    expect(manifest.requires?.os).toContain('linux');
    expect(manifest.requires?.os).toContain('darwin');
  });

  it('should throw if directory has no skill.yaml', async () => {
    const dir = await createTempDir();

    await expect(loadSkillFromDir(dir)).rejects.toThrow('skill.yaml not found');
  });

  it('should throw on invalid YAML syntax', async () => {
    const dir = await createTempDir();
    await writeSkillYaml(dir, '{{invalid yaml: [unclosed');

    await expect(loadSkillFromDir(dir)).rejects.toThrow('Invalid YAML');
  });

  it('should throw on empty YAML file', async () => {
    const dir = await createTempDir();
    await writeSkillYaml(dir, '');

    await expect(loadSkillFromDir(dir)).rejects.toThrow('empty or not an object');
  });

  it('should throw on YAML with only scalar value', async () => {
    const dir = await createTempDir();
    await writeSkillYaml(dir, 'just a string');

    await expect(loadSkillFromDir(dir)).rejects.toThrow('empty or not an object');
  });

  it('should throw when kind is missing', async () => {
    const dir = await createTempDir();
    await writeSkillYaml(dir, `
version: "1.0"
metadata:
  name: test-skill
  displayName: "Test"
  version: "1.0.0"
triggers:
  - type: manual
tools:
  - shell
prompt: |
  This is a test prompt that must be at least 50 characters long to pass validation.
`);

    await expect(loadSkillFromDir(dir)).rejects.toThrow('Skill validation failed');
  });

  it('should throw when version is wrong', async () => {
    const dir = await createTempDir();
    await writeSkillYaml(dir, `
kind: skill
version: "2.0"
metadata:
  name: test-skill
  displayName: "Test"
  version: "1.0.0"
triggers:
  - type: manual
tools:
  - shell
prompt: |
  This is a test prompt that must be at least 50 characters long to pass validation.
`);

    await expect(loadSkillFromDir(dir)).rejects.toThrow('Skill validation failed');
  });

  it('should throw when prompt is too short', async () => {
    const dir = await createTempDir();
    await writeSkillYaml(dir, `
kind: skill
version: "1.0"
metadata:
  name: test-skill
  displayName: "Test"
  version: "1.0.0"
triggers:
  - type: manual
tools:
  - shell
prompt: "too short"
`);

    await expect(loadSkillFromDir(dir)).rejects.toThrow('Skill validation failed');
  });

  it('should throw when no triggers are specified', async () => {
    const dir = await createTempDir();
    await writeSkillYaml(dir, `
kind: skill
version: "1.0"
metadata:
  name: test-skill
  displayName: "Test"
  version: "1.0.0"
triggers: []
tools:
  - shell
prompt: |
  This is a test prompt that must be at least 50 characters long to pass validation.
`);

    await expect(loadSkillFromDir(dir)).rejects.toThrow('Skill validation failed');
  });

  it('should apply default constraints when not specified', async () => {
    const dir = await createTempDir();
    await writeSkillYaml(dir, MINIMAL_SKILL_YAML);

    const manifest = await loadSkillFromDir(dir);

    expect(manifest.constraints.risk_level_max).toBe('yellow');
    expect(manifest.constraints.timeout).toBe('5m');
    expect(manifest.constraints.max_steps).toBe(20);
    expect(manifest.constraints.requires_confirmation).toBe(false);
    expect(manifest.constraints.server_scope).toBe('single');
  });

  it('should parse skill with all trigger types', async () => {
    const dir = await createTempDir();
    await writeSkillYaml(dir, `
kind: skill
version: "1.0"
metadata:
  name: multi-trigger
  displayName: "Multi Trigger Test"
  version: "1.0.0"
triggers:
  - type: manual
  - type: cron
    schedule: "0 8 * * *"
  - type: event
    on: alert.triggered
  - type: threshold
    metric: cpu.usage
    operator: gte
    value: 90
tools:
  - shell
  - notify
prompt: |
  This is a test prompt that must be at least 50 characters long to pass validation.
`);

    const manifest = await loadSkillFromDir(dir);

    expect(manifest.triggers).toHaveLength(4);
    expect(manifest.triggers.map(t => t.type)).toEqual([
      'manual', 'cron', 'event', 'threshold',
    ]);
  });
});

// ============================================================================
// resolvePromptTemplate Tests
// ============================================================================

describe('resolvePromptTemplate', () => {
  it('should replace {{input.*}} variables', () => {
    const prompt = 'Backup to {{input.backup_dir}} with {{input.retention_days}} days retention.';
    const vars: TemplateVars = {
      input: { backup_dir: '/var/backups', retention_days: 30 },
    };

    const result = resolvePromptTemplate(prompt, vars);

    expect(result).toBe('Backup to /var/backups with 30 days retention.');
  });

  it('should replace {{server.*}} variables', () => {
    const prompt = 'Server: {{server.name}} ({{server.os}}) at {{server.ip}}';
    const vars: TemplateVars = {
      server: { name: 'prod-web-01', os: 'Ubuntu 22.04', ip: '10.0.0.1' },
    };

    const result = resolvePromptTemplate(prompt, vars);

    expect(result).toBe('Server: prod-web-01 (Ubuntu 22.04) at 10.0.0.1');
  });

  it('should replace {{skill.*}} variables', () => {
    const prompt = 'Last run: {{skill.last_run}}, result: {{skill.last_result}}';
    const vars: TemplateVars = {
      skill: { last_run: '2026-01-15T08:00:00Z', last_result: '3 warnings found' },
    };

    const result = resolvePromptTemplate(prompt, vars);

    expect(result).toBe('Last run: 2026-01-15T08:00:00Z, result: 3 warnings found');
  });

  it('should replace {{now}} with provided value', () => {
    const prompt = 'Current time: {{now}}';
    const vars: TemplateVars = { now: '2026-02-12T10:00:00Z' };

    const result = resolvePromptTemplate(prompt, vars);

    expect(result).toBe('Current time: 2026-02-12T10:00:00Z');
  });

  it('should replace {{now}} with ISO string when not provided', () => {
    const prompt = 'Current time: {{now}}';
    const vars: TemplateVars = {};

    const result = resolvePromptTemplate(prompt, vars);

    expect(result).toMatch(/^Current time: \d{4}-\d{2}-\d{2}T/);
  });

  it('should replace {{env.*}} variables', () => {
    const prompt = 'API key: {{env.API_KEY}}';
    const vars: TemplateVars = { env: { API_KEY: 'sk-test-123' } };

    const result = resolvePromptTemplate(prompt, vars);

    expect(result).toBe('API key: sk-test-123');
  });

  it('should preserve undefined variables as-is', () => {
    const prompt = 'Known: {{input.known}}, Unknown: {{input.unknown}}';
    const vars: TemplateVars = { input: { known: 'value' } };

    const result = resolvePromptTemplate(prompt, vars);

    expect(result).toBe('Known: value, Unknown: {{input.unknown}}');
  });

  it('should preserve unknown namespace variables as-is', () => {
    const prompt = 'Value: {{custom.key}}';
    const vars: TemplateVars = {};

    const result = resolvePromptTemplate(prompt, vars);

    expect(result).toBe('Value: {{custom.key}}');
  });

  it('should handle array values by JSON stringifying', () => {
    const prompt = 'Sources: {{input.log_sources}}';
    const vars: TemplateVars = {
      input: { log_sources: ['/var/log/syslog', '/var/log/auth.log'] },
    };

    const result = resolvePromptTemplate(prompt, vars);

    expect(result).toBe('Sources: ["/var/log/syslog","/var/log/auth.log"]');
  });

  it('should handle boolean values', () => {
    const prompt = 'Check ports: {{input.check_ports}}';
    const vars: TemplateVars = { input: { check_ports: true } };

    const result = resolvePromptTemplate(prompt, vars);

    expect(result).toBe('Check ports: true');
  });

  it('should handle prompts with no template variables', () => {
    const prompt = 'Just a plain prompt with no variables.';
    const result = resolvePromptTemplate(prompt, {});

    expect(result).toBe('Just a plain prompt with no variables.');
  });

  it('should handle whitespace inside braces', () => {
    const prompt = 'Value: {{ input.name }}';
    const vars: TemplateVars = { input: { name: 'hello' } };

    const result = resolvePromptTemplate(prompt, vars);

    expect(result).toBe('Value: hello');
  });
});

// ============================================================================
// checkRequirements Tests
// ============================================================================

describe('checkRequirements', () => {
  it('should return satisfied when no requirements specified', () => {
    const result = checkRequirements(undefined);

    expect(result.satisfied).toBe(true);
    expect(result.missing).toHaveLength(0);
  });

  it('should return satisfied when empty requirements', () => {
    const result = checkRequirements({});

    expect(result.satisfied).toBe(true);
    expect(result.missing).toHaveLength(0);
  });

  it('should pass OS check when platform matches (linux)', () => {
    const profile = makeServerProfile({
      osInfo: { platform: 'linux', arch: 'x86_64', version: 'Ubuntu 22.04', kernel: '5.15', hostname: 'test', uptime: 100 },
    });

    const result = checkRequirements({ os: ['linux'] }, profile);

    expect(result.satisfied).toBe(true);
  });

  it('should pass OS check when platform matches (darwin)', () => {
    const profile = makeServerProfile({
      osInfo: { platform: 'darwin', arch: 'arm64', version: 'macOS 14.0', kernel: '23.0', hostname: 'mac', uptime: 100 },
    });

    const result = checkRequirements({ os: ['linux', 'darwin'] }, profile);

    expect(result.satisfied).toBe(true);
  });

  it('should fail OS check when platform does not match', () => {
    const profile = makeServerProfile({
      osInfo: { platform: 'windows', arch: 'x86_64', version: 'Windows 11', kernel: '10.0', hostname: 'win', uptime: 100 },
    });

    const result = checkRequirements({ os: ['linux'] }, profile);

    expect(result.satisfied).toBe(false);
    expect(result.missing[0]).toContain('not in supported list');
  });

  it('should fail OS check when profile unavailable', () => {
    const result = checkRequirements({ os: ['linux'] }, null);

    expect(result.satisfied).toBe(false);
    expect(result.missing[0]).toContain('server profile unavailable');
  });

  it('should normalize platform names (Ubuntu → linux)', () => {
    const profile = makeServerProfile({
      osInfo: { platform: 'Ubuntu', arch: 'x86_64', version: '22.04', kernel: '5.15', hostname: 'srv', uptime: 100 },
    });

    const result = checkRequirements({ os: ['linux'] }, profile);

    expect(result.satisfied).toBe(true);
  });

  it('should pass command check when commands are available', () => {
    const profile = makeServerProfile({
      software: [
        { name: 'tar', version: '1.34', ports: [] },
        { name: 'ss', version: '5.0', ports: [] },
      ],
    });

    const result = checkRequirements({ commands: ['tar', 'ss'] }, profile);

    expect(result.satisfied).toBe(true);
  });

  it('should fail command check when a command is missing', () => {
    const profile = makeServerProfile({
      software: [{ name: 'tar', version: '1.34', ports: [] }],
    });

    const result = checkRequirements({ commands: ['tar', 'zstd'] }, profile);

    expect(result.satisfied).toBe(false);
    expect(result.missing).toHaveLength(1);
    expect(result.missing[0]).toContain("'zstd'");
  });

  it('should fail command check when profile unavailable', () => {
    const result = checkRequirements({ commands: ['tar'] }, null);

    expect(result.satisfied).toBe(false);
    expect(result.missing[0]).toContain('server profile unavailable');
  });

  it('should accumulate multiple failures', () => {
    const profile = makeServerProfile({
      osInfo: { platform: 'windows', arch: 'x86_64', version: 'Win 11', kernel: '10.0', hostname: 'w', uptime: 100 },
      software: [],
    });

    const result = checkRequirements({
      os: ['linux'],
      commands: ['tar', 'ss'],
    }, profile);

    expect(result.satisfied).toBe(false);
    expect(result.missing.length).toBeGreaterThanOrEqual(3); // OS + 2 commands
  });

  it('should handle case-insensitive command matching', () => {
    const profile = makeServerProfile({
      software: [{ name: 'TAR', version: '1.0', ports: [] }],
    });

    const result = checkRequirements({ commands: ['tar'] }, profile);

    expect(result.satisfied).toBe(true);
  });
});

// ============================================================================
// scanSkillDirectories Tests
// ============================================================================

describe('scanSkillDirectories', () => {
  it('should scan official skill directories', async () => {
    const officialPath = join(process.cwd(), 'skills/official');
    const results = await scanSkillDirectories([officialPath]);

    expect(results.length).toBeGreaterThanOrEqual(3);
    const names = results.map(r => r.manifest.metadata.name);
    expect(names).toContain('log-auditor');
    expect(names).toContain('intrusion-detector');
    expect(names).toContain('auto-backup');
    results.forEach(r => expect(r.source).toBe('official'));
  });

  it('should return empty array for empty directory', async () => {
    const emptyDir = await createTempDir();
    const results = await scanSkillDirectories([emptyDir]);

    expect(results).toEqual([]);
  });

  it('should return empty array for non-existent directory', async () => {
    const results = await scanSkillDirectories(['/nonexistent/path/12345']);

    expect(results).toEqual([]);
  });

  it('should skip non-directory entries', async () => {
    const baseDir = await createTempDir();
    await writeFile(join(baseDir, 'not-a-dir.txt'), 'hello', 'utf-8');

    const skillDir = join(baseDir, 'valid-skill');
    await mkdir(skillDir);
    await writeSkillYaml(skillDir, MINIMAL_SKILL_YAML);

    const results = await scanSkillDirectories([baseDir]);

    expect(results).toHaveLength(1);
    expect(results[0].manifest.metadata.name).toBe('test-skill');
  });

  it('should skip invalid skill directories with warning', async () => {
    const baseDir = await createTempDir();

    // Valid skill
    const validDir = join(baseDir, 'valid-skill');
    await mkdir(validDir);
    await writeSkillYaml(validDir, MINIMAL_SKILL_YAML);

    // Invalid skill (empty dir, no skill.yaml)
    const invalidDir = join(baseDir, 'invalid-skill');
    await mkdir(invalidDir);

    const results = await scanSkillDirectories([baseDir]);

    expect(results).toHaveLength(1);
    expect(results[0].manifest.metadata.name).toBe('test-skill');
  });

  it('should scan multiple base paths', async () => {
    const dir1 = await createTempDir();
    const dir2 = await createTempDir();

    const skill1 = join(dir1, 'skill-a');
    await mkdir(skill1);
    await writeSkillYaml(skill1, MINIMAL_SKILL_YAML.replace('test-skill', 'skill-aa'));

    const skill2 = join(dir2, 'skill-b');
    await mkdir(skill2);
    await writeSkillYaml(skill2, MINIMAL_SKILL_YAML.replace('test-skill', 'skill-bb'));

    const results = await scanSkillDirectories([dir1, dir2]);

    expect(results).toHaveLength(2);
    const names = results.map(r => r.manifest.metadata.name);
    expect(names).toContain('skill-aa');
    expect(names).toContain('skill-bb');
  });

  it('should classify community source correctly', async () => {
    const communityBase = await createTempDir('community-');
    // We need a path containing 'community' — create inside temp
    const communityPath = join(communityBase, 'community');
    await mkdir(communityPath);
    const skillDir = join(communityPath, 'my-skill');
    await mkdir(skillDir);
    await writeSkillYaml(skillDir, MINIMAL_SKILL_YAML);

    const results = await scanSkillDirectories([communityPath]);

    expect(results).toHaveLength(1);
    expect(results[0].source).toBe('community');
  });

  it('should classify local source for arbitrary paths', async () => {
    const localDir = await createTempDir('my-skills-');
    const skillDir = join(localDir, 'my-skill');
    await mkdir(skillDir);
    await writeSkillYaml(skillDir, MINIMAL_SKILL_YAML);

    const results = await scanSkillDirectories([localDir]);

    expect(results).toHaveLength(1);
    expect(results[0].source).toBe('local');
  });

  it('should include dirPath in scanned results', async () => {
    const baseDir = await createTempDir();
    const skillDir = join(baseDir, 'my-skill');
    await mkdir(skillDir);
    await writeSkillYaml(skillDir, MINIMAL_SKILL_YAML);

    const results = await scanSkillDirectories([baseDir]);

    expect(results[0].dirPath).toBe(skillDir);
  });
});
