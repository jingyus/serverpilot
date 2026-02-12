// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * GitInstaller — clone community skills from Git HTTPS URLs.
 *
 * Security constraints:
 * - Only HTTPS protocol allowed (reject git://, ssh://, file://)
 * - No executable files from the cloned repo are ever run
 * - skill.yaml is validated against SkillManifestSchema before accepting
 * - Suspicious prompts (injection attempts) are flagged
 * - Failed installs are automatically rolled back (directory deleted)
 *
 * @module core/skill/git-installer
 */

import { exec } from 'node:child_process';
import { join, basename } from 'node:path';
import { access, rm, stat, rename } from 'node:fs/promises';
import { promisify } from 'node:util';

import { createContextLogger } from '../../utils/logger.js';
import { loadSkillFromDir } from './loader.js';
import type { SkillManifest } from '@aiinstaller/shared';

const execAsync = promisify(exec);
const logger = createContextLogger({ module: 'git-installer' });

// ============================================================================
// Constants
// ============================================================================

/** Maximum prompt length before flagging as suspicious (bytes). */
const MAX_PROMPT_LENGTH = 20_000;

/** Maximum allowed risk level — 'critical' triggers a warning. */
const WARN_RISK_LEVELS = new Set(['critical']);

/** Git clone timeout in milliseconds. */
const CLONE_TIMEOUT_MS = 60_000;

// ============================================================================
// Types
// ============================================================================

export interface GitInstallResult {
  /** Absolute path to the cloned skill directory. */
  skillDir: string;
  /** Parsed and validated manifest. */
  manifest: SkillManifest;
  /** Security scan warnings (non-blocking). */
  warnings: string[];
}

export interface SecurityScanResult {
  /** Whether the skill passed security checks. */
  passed: boolean;
  /** Warning messages (informational, non-blocking). */
  warnings: string[];
  /** Blocking errors that prevent installation. */
  errors: string[];
}

// ============================================================================
// URL Validation
// ============================================================================

/**
 * Validate a Git URL — only HTTPS protocol is allowed.
 *
 * @throws Error if the URL is invalid or uses a disallowed protocol
 */
export function validateGitUrl(url: string): void {
  // Must start with https://
  if (!url.startsWith('https://')) {
    throw new Error(
      `Only HTTPS Git URLs are allowed. Got: "${url}". ` +
      'SSH (git@), git://, and file:// protocols are rejected for security.',
    );
  }

  // Basic URL structure validation
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL format: "${url}"`);
  }

  if (parsed.protocol !== 'https:') {
    throw new Error(`Only HTTPS protocol is allowed, got: ${parsed.protocol}`);
  }

  // Must have a path component (repo name)
  if (!parsed.pathname || parsed.pathname === '/') {
    throw new Error('Git URL must include a repository path (e.g., /user/repo.git)');
  }
}

/**
 * Extract repository name from a Git URL.
 *
 * Examples:
 * - `https://github.com/user/my-skill.git` → `my-skill`
 * - `https://github.com/user/my-skill` → `my-skill`
 */
export function extractRepoName(url: string): string {
  const parsed = new URL(url);
  const pathParts = parsed.pathname.split('/').filter(Boolean);

  if (pathParts.length === 0) {
    throw new Error(`Cannot extract repository name from URL: "${url}"`);
  }

  // Take the last path segment and strip .git suffix
  let repoName = pathParts[pathParts.length - 1];
  if (repoName.endsWith('.git')) {
    repoName = repoName.slice(0, -4);
  }

  if (!repoName) {
    throw new Error(`Cannot extract repository name from URL: "${url}"`);
  }

  return repoName;
}

// ============================================================================
// Security Scanning
// ============================================================================

/**
 * Scan a skill manifest for security concerns.
 *
 * Checks:
 * 1. risk_level_max set to 'critical' — warn the user
 * 2. Prompt length exceeding threshold — may indicate injection
 * 3. Prompt content patterns that suggest manipulation
 */
export function scanManifestSecurity(manifest: SkillManifest): SecurityScanResult {
  const warnings: string[] = [];
  const errors: string[] = [];

  // Check risk level
  const riskLevel = manifest.constraints?.risk_level_max;
  if (riskLevel && WARN_RISK_LEVELS.has(riskLevel)) {
    warnings.push(
      `Skill declares risk_level_max="${riskLevel}" — this allows dangerous operations. Review carefully before enabling.`,
    );
  }

  // Check prompt length
  if (manifest.prompt.length > MAX_PROMPT_LENGTH) {
    warnings.push(
      `Skill prompt is unusually large (${manifest.prompt.length} bytes). ` +
      'Large prompts may indicate injection attempts.',
    );
  }

  // Check for suspicious prompt patterns
  const suspiciousPatterns = [
    /ignore\s+(previous|above|all)\s+(instructions?|prompts?)/i,
    /you\s+are\s+now\s+(a|an)\s+/i,
    /forget\s+(everything|all|your)\s+/i,
    /override\s+(your|the|all)\s+(rules?|constraints?|instructions?)/i,
  ];

  for (const pattern of suspiciousPatterns) {
    if (pattern.test(manifest.prompt)) {
      warnings.push(
        `Skill prompt contains suspicious pattern: "${pattern.source}". ` +
        'This may be a prompt injection attempt.',
      );
    }
  }

  return {
    passed: errors.length === 0,
    warnings,
    errors,
  };
}

// ============================================================================
// Git Clone
// ============================================================================

/**
 * Install a community skill from a Git HTTPS URL.
 *
 * Flow:
 * 1. Validate URL (HTTPS only)
 * 2. Clone repository with `git clone --depth 1`
 * 3. Verify skill.yaml exists and passes schema validation
 * 4. Run security scan on the manifest
 * 5. On any failure: delete the cloned directory (rollback)
 *
 * @param gitUrl - HTTPS Git URL to clone
 * @param communityDir - Base directory for community skills (e.g., `skills/community/`)
 * @returns GitInstallResult with the skill directory path and manifest
 * @throws Error if URL is invalid, clone fails, or validation fails
 */
export async function installFromGitUrl(
  gitUrl: string,
  communityDir: string,
): Promise<GitInstallResult> {
  // Step 1: Validate URL
  validateGitUrl(gitUrl);

  // Step 2: Determine target directory
  const repoName = extractRepoName(gitUrl);
  const targetDir = join(communityDir, repoName);

  // Check if directory already exists
  try {
    await access(targetDir);
    throw new Error(
      `Directory already exists: ${targetDir}. ` +
      'Uninstall the existing skill first or choose a different URL.',
    );
  } catch (err) {
    // ENOENT is expected (directory doesn't exist yet)
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      // Re-throw if it's not "file not found" — could be the "already exists" error
      throw err;
    }
  }

  // Step 3: Clone the repository
  logger.info({ gitUrl, targetDir }, 'Cloning community skill');

  try {
    await execAsync(
      `git clone --depth 1 ${escapeShellArg(gitUrl)} ${escapeShellArg(targetDir)}`,
      { timeout: CLONE_TIMEOUT_MS },
    );
  } catch (err) {
    // Ensure cleanup on clone failure
    await safeRemoveDir(targetDir);
    throw new Error(
      `Git clone failed for "${gitUrl}": ${(err as Error).message}`,
    );
  }

  // Step 4: Validate skill.yaml
  let manifest: SkillManifest;
  try {
    manifest = await loadSkillFromDir(targetDir);
  } catch (err) {
    await safeRemoveDir(targetDir);
    throw new Error(
      `Skill validation failed after cloning "${gitUrl}": ${(err as Error).message}`,
    );
  }

  // Step 5: Security scan
  const scanResult = scanManifestSecurity(manifest);
  if (!scanResult.passed) {
    await safeRemoveDir(targetDir);
    throw new Error(
      `Security scan failed for "${gitUrl}": ${scanResult.errors.join('; ')}`,
    );
  }

  if (scanResult.warnings.length > 0) {
    logger.warn(
      { gitUrl, warnings: scanResult.warnings },
      'Community skill installed with security warnings',
    );
  }

  logger.info(
    { gitUrl, targetDir, name: manifest.metadata.name },
    'Community skill cloned and validated',
  );

  return {
    skillDir: targetDir,
    manifest,
    warnings: scanResult.warnings,
  };
}

// ============================================================================
// Git Upgrade (atomic: clone to temp → validate → swap)
// ============================================================================

/**
 * Upgrade an existing community skill from its Git HTTPS URL.
 *
 * Flow:
 * 1. Validate URL (HTTPS only)
 * 2. Clone to a temporary directory alongside the existing one
 * 3. Validate the new skill.yaml against schema
 * 4. Run security scan
 * 5. Atomic swap: rename existing → backup, rename temp → target, remove backup
 * 6. On failure: restore backup, remove temp
 *
 * @param existingDir - Absolute path to the currently installed skill directory
 * @param gitUrl - HTTPS Git URL to clone the new version from
 * @returns GitInstallResult with the skill directory path and updated manifest
 * @throws Error if URL is invalid, clone fails, validation fails, or swap fails
 */
export async function upgradeFromGitUrl(
  existingDir: string,
  gitUrl: string,
): Promise<GitInstallResult> {
  // Step 1: Validate URL
  validateGitUrl(gitUrl);

  // Step 2: Verify the existing directory exists
  try {
    const dirStat = await stat(existingDir);
    if (!dirStat.isDirectory()) {
      throw new Error(`Existing skill path is not a directory: ${existingDir}`);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`Existing skill directory not found: ${existingDir}`);
    }
    throw err;
  }

  const tempDir = existingDir + '.upgrade-tmp';
  const backupDir = existingDir + '.upgrade-backup';

  // Clean up any stale temp/backup dirs from previous failed upgrades
  await safeRemoveDir(tempDir);
  await safeRemoveDir(backupDir);

  // Step 3: Clone to temporary directory
  logger.info({ gitUrl, tempDir }, 'Cloning new version for upgrade');

  try {
    await execAsync(
      `git clone --depth 1 ${escapeShellArg(gitUrl)} ${escapeShellArg(tempDir)}`,
      { timeout: CLONE_TIMEOUT_MS },
    );
  } catch (err) {
    await safeRemoveDir(tempDir);
    throw new Error(
      `Git clone failed during upgrade for "${gitUrl}": ${(err as Error).message}`,
    );
  }

  // Step 4: Validate new skill.yaml
  let manifest: SkillManifest;
  try {
    manifest = await loadSkillFromDir(tempDir);
  } catch (err) {
    await safeRemoveDir(tempDir);
    throw new Error(
      `Skill validation failed during upgrade for "${gitUrl}": ${(err as Error).message}`,
    );
  }

  // Step 5: Security scan
  const scanResult = scanManifestSecurity(manifest);
  if (!scanResult.passed) {
    await safeRemoveDir(tempDir);
    throw new Error(
      `Security scan failed during upgrade for "${gitUrl}": ${scanResult.errors.join('; ')}`,
    );
  }

  // Step 6: Atomic swap — backup old → move new → remove backup
  try {
    await rename(existingDir, backupDir);
    await rename(tempDir, existingDir);
    // Swap succeeded — remove backup
    await safeRemoveDir(backupDir);
  } catch (err) {
    // Swap failed — attempt rollback
    logger.error({ error: (err as Error).message }, 'Atomic swap failed during upgrade, rolling back');
    await restoreBackup(existingDir, backupDir, tempDir);
    throw new Error(
      `Upgrade swap failed for "${gitUrl}": ${(err as Error).message}`,
    );
  }

  if (scanResult.warnings.length > 0) {
    logger.warn(
      { gitUrl, warnings: scanResult.warnings },
      'Community skill upgraded with security warnings',
    );
  }

  logger.info(
    { gitUrl, existingDir, name: manifest.metadata.name, version: manifest.metadata.version },
    'Community skill upgraded successfully',
  );

  return {
    skillDir: existingDir,
    manifest,
    warnings: scanResult.warnings,
  };
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Escape a string for safe use in a shell command argument.
 * Wraps in single quotes and escapes any embedded single quotes.
 */
function escapeShellArg(arg: string): string {
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

/**
 * Safely remove a directory. Does not throw if the directory doesn't exist.
 */
async function safeRemoveDir(dirPath: string): Promise<void> {
  try {
    const dirStat = await stat(dirPath);
    if (dirStat.isDirectory()) {
      await rm(dirPath, { recursive: true, force: true });
      logger.debug({ dirPath }, 'Rolled back cloned directory');
    }
  } catch {
    // Directory doesn't exist or already removed — that's fine
  }
}

/**
 * Restore backup directory after a failed swap during upgrade.
 * Tries to move backup back to target, then cleans up temp.
 */
async function restoreBackup(
  targetDir: string,
  backupDir: string,
  tempDir: string,
): Promise<void> {
  try {
    // If target now exists (partial rename), remove it first
    await safeRemoveDir(targetDir);
    // Restore backup to original location
    const backupStat = await stat(backupDir).catch(() => null);
    if (backupStat?.isDirectory()) {
      await rename(backupDir, targetDir);
      logger.info({ targetDir }, 'Backup restored after failed upgrade');
    }
  } catch (restoreErr) {
    logger.error(
      { error: (restoreErr as Error).message },
      'Failed to restore backup — manual intervention may be needed',
    );
  }
  // Always clean up temp directory
  await safeRemoveDir(tempDir);
}
