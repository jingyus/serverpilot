// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Shared test utilities for SkillEngine tests.
 *
 * Provides common mock setup, helpers, and YAML generators used across
 * engine.test.ts, engine-execute.test.ts, engine-webhook.test.ts, and engine-queries.test.ts.
 */

import { join } from 'node:path';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';

// ============================================================================
// Temp directory management
// ============================================================================

let tempDirs: string[] = [];

export async function createTempDir(prefix = 'engine-test-'): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

export async function cleanupTempDirs(): Promise<void> {
  for (const dir of tempDirs) {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
  tempDirs = [];
}

// ============================================================================
// YAML generators
// ============================================================================

/** Write a minimal valid skill.yaml to a directory. */
export async function writeSkillYaml(
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
export async function writeTemplatedSkillYaml(dir: string): Promise<void> {
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

/** Write a skill.yaml with requires constraints (os, commands, agent). */
export async function writeRequiresSkillYaml(
  dir: string,
  opts: {
    name?: string;
    os?: string[];
    commands?: string[];
    agent?: string;
  } = {},
): Promise<void> {
  const name = opts.name ?? 'requires-skill';
  const requiresLines: string[] = [];
  if (opts.os) {
    requiresLines.push(`  os: [${opts.os.join(', ')}]`);
  }
  if (opts.commands) {
    requiresLines.push(`  commands: [${opts.commands.join(', ')}]`);
  }
  if (opts.agent) {
    requiresLines.push(`  agent: "${opts.agent}"`);
  }

  const requiresBlock = requiresLines.length > 0
    ? `\nrequires:\n${requiresLines.join('\n')}\n`
    : '';

  const yaml = `kind: skill
version: "1.0"

metadata:
  name: ${name}
  displayName: "Requires Skill"
  version: "1.0.0"

triggers:
  - type: manual

tools:
  - shell
${requiresBlock}
prompt: |
  This skill has requirements. It must be at least 50 characters long to pass validation.
`;
  await writeFile(join(dir, 'skill.yaml'), yaml, 'utf-8');
}

/** Write a skill.yaml with server_scope: all or tagged. */
export async function writeBatchSkillYaml(
  dir: string,
  opts: { name?: string; scope?: 'all' | 'tagged' } = {},
): Promise<void> {
  const name = opts.name ?? 'batch-skill';
  const scope = opts.scope ?? 'all';
  const tagsBlock = scope === 'tagged' ? '\n  server_tags:\n    - production' : '';
  const yaml = `kind: skill
version: "1.0"

metadata:
  name: ${name}
  displayName: "Batch Skill"
  version: "1.0.0"

triggers:
  - type: manual

tools:
  - shell

constraints:
  server_scope: ${scope}${tagsBlock}

prompt: |
  Run a batch check across all servers. This prompt is long enough to pass the minimum 50 chars requirement.
`;
  await writeFile(join(dir, 'skill.yaml'), yaml, 'utf-8');
}
