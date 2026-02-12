// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * SkillLoader — YAML parsing, schema validation, and prompt template engine.
 *
 * Responsibilities:
 * - Load and parse skill.yaml files from disk
 * - Validate against SkillManifestSchema (shared single source of truth)
 * - Scan directories for available skills
 * - Resolve prompt template variables ({{input.*}}, {{server.*}}, etc.)
 * - Check skill requirements against server profile
 *
 * @module core/skill/loader
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import yaml from 'js-yaml';
import {
  validateSkillManifest,
  type SkillManifest,
} from '@aiinstaller/shared';

import { createContextLogger } from '../../utils/logger.js';
import type { ServerProfile, OsInfo } from '../../db/repositories/server-repository.js';

const logger = createContextLogger({ module: 'skill-loader' });

// ============================================================================
// Types
// ============================================================================

/** Template variables available for prompt resolution */
export interface TemplateVars {
  input?: Record<string, unknown>;
  server?: {
    name?: string;
    os?: string;
    ip?: string;
  };
  skill?: {
    last_run?: string;
    last_result?: string;
  };
  now?: string;
  env?: Record<string, string>;
}

/** Result of scanning a skill directory */
export interface ScannedSkill {
  manifest: SkillManifest;
  dirPath: string;
  source: 'official' | 'community' | 'local';
}

/** Result of checking skill requirements */
export interface RequirementCheckResult {
  satisfied: boolean;
  missing: string[];
  warnings: string[];
}

// ============================================================================
// Loader Functions
// ============================================================================

/**
 * Load and validate a skill manifest from a directory.
 *
 * Reads `skill.yaml` from the given directory, parses the YAML,
 * and validates against SkillManifestSchema.
 *
 * @throws Error if file not found, YAML is invalid, or schema validation fails
 */
export async function loadSkillFromDir(dirPath: string): Promise<SkillManifest> {
  const yamlPath = join(dirPath, 'skill.yaml');

  let content: string;
  try {
    content = await readFile(yamlPath, 'utf-8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      throw new Error(`skill.yaml not found in ${dirPath}`);
    }
    throw new Error(`Failed to read ${yamlPath}: ${(err as Error).message}`);
  }

  let parsed: unknown;
  try {
    parsed = yaml.load(content);
  } catch (err) {
    throw new Error(`Invalid YAML in ${yamlPath}: ${(err as Error).message}`);
  }

  if (parsed === null || parsed === undefined || typeof parsed !== 'object') {
    throw new Error(`skill.yaml in ${dirPath} is empty or not an object`);
  }

  const result = validateSkillManifest(parsed);
  if (!result.success) {
    const errorList = result.errors?.join('; ') ?? 'Unknown validation error';
    throw new Error(`Skill validation failed in ${dirPath}: ${errorList}`);
  }

  logger.debug({ name: result.data!.metadata.name, dirPath }, 'Loaded skill manifest');
  return result.data!;
}

/**
 * Scan one or more base directories for skill subdirectories.
 *
 * Each base path is scanned for immediate subdirectories containing
 * a `skill.yaml` file. Invalid skills are skipped with a warning log.
 *
 * Source classification:
 * - Paths containing `/official/` → 'official'
 * - Paths containing `/community/` → 'community'
 * - Everything else → 'local'
 */
export async function scanSkillDirectories(basePaths: string[]): Promise<ScannedSkill[]> {
  const results: ScannedSkill[] = [];

  for (const basePath of basePaths) {
    const resolvedBase = resolve(basePath);

    let entries: string[];
    try {
      entries = await readdir(resolvedBase);
    } catch {
      logger.warn({ basePath: resolvedBase }, 'Skill directory not accessible, skipping');
      continue;
    }

    for (const entry of entries) {
      const entryPath = join(resolvedBase, entry);

      try {
        const entryStat = await stat(entryPath);
        if (!entryStat.isDirectory()) continue;

        const manifest = await loadSkillFromDir(entryPath);
        const source = classifySource(resolvedBase);

        results.push({ manifest, dirPath: entryPath, source });
      } catch (err) {
        logger.warn({ entry, basePath: resolvedBase, error: (err as Error).message },
          'Skipping invalid skill directory');
      }
    }
  }

  logger.info({ count: results.length, basePaths }, 'Skill directory scan complete');
  return results;
}

// ============================================================================
// Template Engine
// ============================================================================

/**
 * Resolve template variables in a prompt string.
 *
 * Replaces `{{input.name}}`, `{{server.os}}`, `{{skill.last_run}}`,
 * `{{now}}`, and `{{env.VAR}}` with values from the provided vars.
 *
 * Undefined variables are left as-is (e.g. `{{input.missing}}` stays).
 */
export function resolvePromptTemplate(prompt: string, vars: TemplateVars): string {
  return prompt.replace(/\{\{([^}]+)\}\}/g, (_match, expression: string) => {
    const trimmed = expression.trim();
    const value = resolveVariable(trimmed, vars);
    if (value === undefined) {
      return `{{${trimmed}}}`;
    }
    if (typeof value === 'object') {
      return JSON.stringify(value);
    }
    return String(value);
  });
}

/**
 * Resolve a single dot-separated variable path against the template vars.
 */
function resolveVariable(path: string, vars: TemplateVars): unknown {
  // Special case: {{now}} is a top-level key
  if (path === 'now') {
    return vars.now ?? new Date().toISOString();
  }

  const parts = path.split('.');
  if (parts.length < 2) return undefined;

  const [namespace, ...rest] = parts;
  const key = rest.join('.');

  switch (namespace) {
    case 'input':
      return vars.input?.[key];
    case 'server':
      return vars.server?.[key as keyof NonNullable<TemplateVars['server']>];
    case 'skill':
      return vars.skill?.[key as keyof NonNullable<TemplateVars['skill']>];
    case 'env':
      return vars.env?.[key];
    default:
      return undefined;
  }
}

// ============================================================================
// Requirements Checker
// ============================================================================

/**
 * Check whether a skill's requirements are met by the target server.
 *
 * Checks:
 * - OS compatibility (if `requires.os` is specified)
 * - Command dependencies (if `requires.commands` is specified)
 * - Agent version (if `requires.agent` is specified)
 *
 * When `agentVersion` is not provided but `requires.agent` is specified,
 * the check degrades to a warning (not a blocking error).
 *
 * @returns RequirementCheckResult with `satisfied` flag, unmet requirements, and warnings
 */
export function checkRequirements(
  requires: SkillManifest['requires'],
  serverProfile?: ServerProfile | null,
  agentVersion?: string | null,
): RequirementCheckResult {
  const missing: string[] = [];
  const warnings: string[] = [];

  if (!requires) {
    return { satisfied: true, missing: [], warnings: [] };
  }

  // OS check
  if (requires.os && requires.os.length > 0) {
    if (!serverProfile?.osInfo) {
      missing.push(`OS check required (${requires.os.join('/')}) but server profile unavailable`);
    } else {
      const platform = normalizePlatform(serverProfile.osInfo);
      if (!requires.os.includes(platform as 'linux' | 'darwin' | 'windows')) {
        missing.push(`OS '${platform}' not in supported list: ${requires.os.join(', ')}`);
      }
    }
  }

  // Command dependencies check
  if (requires.commands && requires.commands.length > 0) {
    if (!serverProfile?.software) {
      missing.push(`Command check required (${requires.commands.join(', ')}) but server profile unavailable`);
    } else {
      const availableCommands = new Set(
        serverProfile.software.map((s) => s.name.toLowerCase()),
      );
      for (const cmd of requires.commands) {
        if (!availableCommands.has(cmd.toLowerCase())) {
          missing.push(`Required command '${cmd}' not found on server`);
        }
      }
    }
  }

  // Agent version check
  if (requires.agent) {
    if (!agentVersion) {
      logger.warn({ constraint: requires.agent }, 'Agent version required but not reported — degrading to warning');
      warnings.push(`Agent version constraint '${requires.agent}' cannot be verified (agent did not report version)`);
    } else {
      const constraint = requires.agent;
      if (!satisfiesSemverRange(agentVersion, constraint)) {
        missing.push(`Agent version '${agentVersion}' does not satisfy constraint '${constraint}'`);
      }
    }
  }

  return {
    satisfied: missing.length === 0,
    missing,
    warnings,
  };
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Compare two semver version strings (e.g. "1.2.3" vs "1.3.0").
 *
 * @returns positive if a > b, negative if a < b, 0 if equal
 */
function compareVersions(a: string, b: string): number {
  const aParts = a.split('.').map(Number);
  const bParts = b.split('.').map(Number);

  for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
    const aVal = aParts[i] || 0;
    const bVal = bParts[i] || 0;
    if (aVal !== bVal) {
      return aVal - bVal;
    }
  }
  return 0;
}

/**
 * Check if a version string satisfies a semver range constraint.
 *
 * Supported formats:
 * - ">=1.0.0" — greater than or equal
 * - ">1.0.0"  — strictly greater than
 * - "<=1.0.0" — less than or equal
 * - "<1.0.0"  — strictly less than
 * - "=1.0.0"  — exact match
 * - "1.0.0"   — exact match (no operator)
 *
 * Returns false if version or constraint is not a valid format.
 */
export function satisfiesSemverRange(version: string, constraint: string): boolean {
  const match = constraint.match(/^(>=|>|<=|<|=)?(\d+(?:\.\d+)*)$/);
  if (!match) {
    logger.warn({ version, constraint }, 'Invalid semver constraint format');
    return false;
  }

  const versionMatch = version.match(/^\d+(?:\.\d+)*$/);
  if (!versionMatch) {
    logger.warn({ version }, 'Invalid version format');
    return false;
  }

  const operator = match[1] || '=';
  const target = match[2];
  const cmp = compareVersions(version, target);

  switch (operator) {
    case '>=': return cmp >= 0;
    case '>':  return cmp > 0;
    case '<=': return cmp <= 0;
    case '<':  return cmp < 0;
    case '=':  return cmp === 0;
    default:   return false;
  }
}

/**
 * Normalize the server OS platform string to match skill requirements format.
 */
function normalizePlatform(osInfo: OsInfo): string {
  const p = osInfo.platform.toLowerCase();
  if (p.includes('linux') || p.includes('ubuntu') || p.includes('centos') || p.includes('debian')) {
    return 'linux';
  }
  if (p.includes('darwin') || p.includes('macos') || p.includes('mac')) {
    return 'darwin';
  }
  if (p.includes('win') || p.includes('windows')) {
    return 'windows';
  }
  return p;
}

/**
 * Classify a skill source based on its base directory path.
 */
function classifySource(basePath: string): 'official' | 'community' | 'local' {
  if (basePath.includes('/official') || basePath.includes('\\official')) {
    return 'official';
  }
  if (basePath.includes('/community') || basePath.includes('\\community')) {
    return 'community';
  }
  return 'local';
}
