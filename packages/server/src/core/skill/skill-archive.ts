// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * SkillArchive — export/import skills as .tar.gz archives.
 *
 * Export: reads an installed skill directory → creates a .tar.gz buffer
 * Import: extracts a .tar.gz buffer → validates manifest → installs via engine
 *
 * @module core/skill/skill-archive
 */

import { exec, spawn } from 'node:child_process';
import { join, basename, resolve, normalize } from 'node:path';
import { access, mkdir, rm, readdir, stat, rename } from 'node:fs/promises';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';

import { createContextLogger } from '../../utils/logger.js';
import { loadSkillFromDir } from './loader.js';
import { scanManifestSecurity } from './git-installer.js';
import { getSkillRepository } from '../../db/repositories/skill-repository.js';
import { getSkillEngine } from './engine.js';
import type { InstalledSkill } from './types.js';

const execAsync = promisify(exec);
const logger = createContextLogger({ module: 'skill-archive' });

// ============================================================================
// Constants
// ============================================================================

/** Patterns excluded from the archive. */
const EXCLUDE_PATTERNS = [
  '.git',
  'node_modules',
  '.DS_Store',
  '.env',
  '.env.*',
  '*.test.ts',
  '*.test.js',
  '*.spec.ts',
  '*.spec.js',
  'dist',
  '*.log',
];

/** Tar command timeout in milliseconds. */
const TAR_TIMEOUT_MS = 30_000;

// ============================================================================
// Types
// ============================================================================

export interface ExportResult {
  /** Generated filename: `{name}-{version}.tar.gz`. */
  filename: string;
  /** The tar.gz archive as a Buffer. */
  buffer: Buffer;
}

export interface ImportResult {
  /** The newly installed skill record. */
  skill: InstalledSkill;
  /** Security scan warnings (non-blocking). */
  warnings: string[];
}

// ============================================================================
// Export
// ============================================================================

/**
 * Export an installed skill as a .tar.gz archive.
 *
 * @param skillId — the installed skill's database ID
 * @returns filename and buffer of the archive
 */
export async function exportSkill(skillId: string): Promise<ExportResult> {
  const repo = getSkillRepository();
  const skill = await repo.findById(skillId);
  if (!skill) {
    throw new Error(`Skill not found: ${skillId}`);
  }

  // Verify skill directory exists
  try {
    await access(skill.skillPath);
  } catch {
    throw new Error(`Skill directory does not exist: ${skill.skillPath}`);
  }

  // Validate manifest is still valid before export
  const manifest = await loadSkillFromDir(skill.skillPath);

  const filename = `${manifest.metadata.name}-${manifest.metadata.version}.tar.gz`;

  // Build tar exclude flags
  const excludeFlags = EXCLUDE_PATTERNS
    .map((p) => `--exclude='${p}'`)
    .join(' ');

  // Create tar.gz from skill directory
  // Use `-C parentDir dirName` to get a clean relative path in the archive
  const parentDir = join(skill.skillPath, '..');
  const dirName = basename(skill.skillPath);

  const { stdout } = await execAsync(
    `tar czf - ${excludeFlags} -C '${parentDir}' '${dirName}'`,
    { encoding: 'buffer', timeout: TAR_TIMEOUT_MS, maxBuffer: 50 * 1024 * 1024 },
  );

  logger.info(
    { skillId, name: manifest.metadata.name, size: stdout.length },
    'Skill exported as archive',
  );

  return { filename, buffer: stdout };
}

// ============================================================================
// Import
// ============================================================================

/**
 * Import a skill from a .tar.gz archive buffer.
 *
 * Flow:
 * 1. Extract to a temporary directory
 * 2. Locate and validate skill.yaml manifest
 * 3. Run security scan
 * 4. Move to `skills/community/{name}/`
 * 5. Install via SkillEngine
 *
 * @param buffer — the .tar.gz archive content
 * @param userId — the user performing the import
 * @param communityDir — target directory for community skills
 * @returns the installed skill and any security warnings
 */
export async function importSkill(
  buffer: Buffer,
  userId: string,
  communityDir: string,
): Promise<ImportResult> {
  // Create a temp extraction directory
  const tempId = randomUUID().slice(0, 8);
  const tempDir = join(communityDir, `.import-temp-${tempId}`);

  try {
    await mkdir(tempDir, { recursive: true });

    // Extract tar.gz to temp directory using spawn to pipe buffer via stdin
    await extractTarGz(buffer, tempDir);

    // Find the skill root — could be extracted as a subdirectory
    const skillRoot = await findSkillRoot(tempDir);

    // Validate manifest
    const manifest = await loadSkillFromDir(skillRoot);

    // Security scan
    const scanResult = scanManifestSecurity(manifest);
    if (!scanResult.passed) {
      throw new Error(
        `Security scan failed for imported skill: ${scanResult.errors.join('; ')}`,
      );
    }

    // Check for duplicate
    const repo = getSkillRepository();
    const existing = await repo.findByName(userId, manifest.metadata.name);
    if (existing) {
      throw new Error(
        `Skill '${manifest.metadata.name}' is already installed (id=${existing.id})`,
      );
    }

    // Move to final destination
    const finalDir = join(communityDir, manifest.metadata.name);
    try {
      await access(finalDir);
      throw new Error(
        `Target directory already exists: ${finalDir}`,
      );
    } catch (err) {
      // Directory should NOT exist — this is the expected path
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw err;
      }
    }

    // Ensure community dir exists
    await mkdir(communityDir, { recursive: true });

    // Move skill root to final location
    await rename(skillRoot, finalDir);

    // Install via engine
    const engine = getSkillEngine();
    const skill = await engine.install(userId, finalDir, 'community');

    // Cleanup temp dir (may still have empty dirs after mv)
    await safeRemoveDir(tempDir);

    logger.info(
      { userId, name: manifest.metadata.name, version: manifest.metadata.version },
      'Skill imported from archive',
    );

    return { skill, warnings: scanResult.warnings };
  } catch (err) {
    // Rollback: remove temp directory on failure
    await safeRemoveDir(tempDir);
    throw err;
  }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Validate that all archive entry paths are safely contained within targetDir.
 *
 * Rejects archives containing:
 * - Path traversal (`../`) components
 * - Absolute paths (`/etc/passwd`)
 * - Entries that resolve outside the target directory
 *
 * @throws Error if any entry escapes the target directory
 */
export function validateArchivePaths(entries: string[], targetDir: string): void {
  const resolvedTarget = resolve(targetDir);

  for (const entry of entries) {
    // Strip trailing slashes for directory entries
    const cleaned = entry.replace(/\/+$/, '');
    if (cleaned.length === 0) continue;

    // Reject absolute paths
    if (cleaned.startsWith('/')) {
      throw new Error(
        `Archive path traversal detected: absolute path '${entry}'`,
      );
    }

    // Reject entries containing .. components
    const normalized = normalize(cleaned);
    if (normalized.startsWith('..') || normalized.includes('/..') || normalized.includes('\\..')) {
      throw new Error(
        `Archive path traversal detected: '${entry}' escapes target directory`,
      );
    }

    // Final check: resolved path must be under targetDir
    const resolvedEntry = resolve(resolvedTarget, cleaned);
    if (!resolvedEntry.startsWith(resolvedTarget + '/') && resolvedEntry !== resolvedTarget) {
      throw new Error(
        `Archive path traversal detected: '${entry}' resolves outside target directory`,
      );
    }
  }
}

/**
 * List entries in a tar.gz archive by piping the buffer to `tar -tzf -`.
 */
function listArchiveEntries(buffer: Buffer): Promise<string[]> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('tar', ['-tzf', '-'], { stdio: ['pipe', 'pipe', 'pipe'] });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('tar listing timed out'));
    }, TAR_TIMEOUT_MS);

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        const entries = stdout.split('\n').filter((line) => line.length > 0);
        resolvePromise(entries);
      } else {
        reject(new Error(`tar listing failed (exit ${code}): ${stderr.trim()}`));
      }
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.stdin.write(buffer);
    child.stdin.end();
  });
}

/**
 * Extract a tar.gz buffer to a target directory.
 *
 * Security: pre-scans archive entries for path traversal before extracting.
 * Uses `--no-same-owner --no-same-permissions` to prevent privilege escalation.
 */
async function extractTarGz(buffer: Buffer, cwd: string): Promise<void> {
  // Pre-scan: list entries and validate paths
  const entries = await listArchiveEntries(buffer);
  validateArchivePaths(entries, cwd);

  // Extract with security flags
  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      'tar',
      ['xzf', '-', '--no-same-owner', '--no-same-permissions'],
      { cwd, stdio: ['pipe', 'ignore', 'pipe'] },
    );

    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('tar extraction timed out'));
    }, TAR_TIMEOUT_MS);

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolvePromise();
      } else {
        reject(new Error(`tar extraction failed (exit ${code}): ${stderr.trim()}`));
      }
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.stdin.write(buffer);
    child.stdin.end();
  });
}

/**
 * Find the skill root directory after extraction.
 * The archive may contain files directly, inside a single subdirectory,
 * or up to 2 levels deep (e.g. wrapper-dir/skill-name/skill.yaml).
 */
async function findSkillRoot(extractDir: string, depth = 0): Promise<string> {
  if (depth > 2) {
    throw new Error(
      'Imported archive does not contain a valid skill: no skill.yaml found',
    );
  }

  // Check if skill.yaml is directly in this directory
  try {
    await access(join(extractDir, 'skill.yaml'));
    return extractDir;
  } catch {
    // Not directly here — look in subdirectories
  }

  const entries = await readdir(extractDir);
  // Filter out hidden files and __MACOSX
  const dirs = [];
  for (const entry of entries) {
    if (entry.startsWith('.') || entry === '__MACOSX') continue;
    const entryStat = await stat(join(extractDir, entry));
    if (entryStat.isDirectory()) {
      dirs.push(entry);
    }
  }

  // If exactly one subdirectory, recurse into it
  if (dirs.length === 1) {
    return findSkillRoot(join(extractDir, dirs[0]), depth + 1);
  }

  throw new Error(
    'Imported archive does not contain a valid skill: no skill.yaml found',
  );
}

/** Safely remove a directory, ignoring errors. */
async function safeRemoveDir(dir: string): Promise<void> {
  try {
    await rm(dir, { recursive: true, force: true });
  } catch {
    logger.warn({ dir }, 'Failed to cleanup directory');
  }
}
