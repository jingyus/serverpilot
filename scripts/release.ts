#!/usr/bin/env tsx
/**
 * ServerPilot Release Script
 *
 * Manages the full release lifecycle:
 * 1. Validate version and working tree state
 * 2. Update version in all package.json files
 * 3. Append version entry to CHANGELOG.md (from [Unreleased])
 * 4. Create a Git tag
 * 5. Create a GitHub Release (triggers release.yml workflow)
 *
 * Usage:
 *   pnpm release v0.3.0                      # Full release
 *   pnpm release v0.3.0 --dry-run            # Preview without executing
 *   pnpm release v0.3.0 --skip-tag           # Skip git tag creation
 *   pnpm release v0.3.0 --skip-gh-release    # Skip GitHub release
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================================
// Types
// ============================================================================

export interface ReleaseInfo {
  /** Version tag (e.g. "v0.3.0") */
  tag: string;
  /** Version without v prefix (e.g. "0.3.0") */
  version: string;
  /** Release title */
  title: string;
  /** Release notes extracted from CHANGELOG */
  notes: string;
  /** Release date in YYYY-MM-DD format */
  date: string;
}

export interface ReleaseStep {
  name: string;
  status: 'success' | 'skipped' | 'failed';
  message: string;
}

export interface ReleaseResult {
  success: boolean;
  release: ReleaseInfo;
  steps: ReleaseStep[];
  releaseUrl?: string;
}

export interface ReleaseOptions {
  /** Version tag (e.g. "v0.3.0") */
  tag: string;
  /** Dry run mode - preview without executing */
  dryRun: boolean;
  /** Skip git tag creation */
  skipTag: boolean;
  /** Skip GitHub release creation */
  skipGhRelease: boolean;
  /** Project root directory */
  rootDir: string;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_ROOT_DIR = path.resolve(import.meta.dirname, '..');

const CHANGELOG_PATH = 'CHANGELOG.md';

/** All package.json files to update version in */
const PACKAGE_JSON_PATHS = [
  'package.json',
  'packages/server/package.json',
  'packages/agent/package.json',
  'packages/dashboard/package.json',
  'packages/shared/package.json',
];

// ============================================================================
// Version Parsing
// ============================================================================

/**
 * Normalize a version string to ensure it has a "v" prefix.
 */
export function normalizeTag(version: string): string {
  return version.startsWith('v') ? version : `v${version}`;
}

/**
 * Extract the version number without the "v" prefix.
 */
export function extractVersion(tag: string): string {
  return tag.startsWith('v') ? tag.slice(1) : tag;
}

/**
 * Validate a semantic version string (e.g. "0.3.0" or "v0.3.0").
 */
export function isValidSemver(version: string): boolean {
  const v = extractVersion(version);
  return /^\d+\.\d+\.\d+(-[\w.]+)?$/.test(v);
}

// ============================================================================
// CHANGELOG Parsing & Updating
// ============================================================================

/**
 * Extract release notes for a specific version from CHANGELOG.md.
 * Returns the content between the version heading and the next version heading.
 */
export function extractReleaseNotes(changelogContent: string, version: string): string {
  const v = extractVersion(version);
  const lines = changelogContent.split('\n');

  let capturing = false;
  const notes: string[] = [];

  for (const line of lines) {
    // Match the version heading: ## [0.3.0] or ## [0.3.0] - 2026-02-08
    if (line.match(new RegExp(`^## \\[${escapeRegex(v)}\\]`))) {
      capturing = true;
      continue;
    }

    // Stop at the next version heading
    if (capturing && line.match(/^## \[/)) {
      break;
    }

    if (capturing) {
      notes.push(line);
    }
  }

  // Trim leading/trailing empty lines
  while (notes.length > 0 && notes[0].trim() === '') notes.shift();
  while (notes.length > 0 && notes[notes.length - 1].trim() === '') notes.pop();

  return notes.join('\n');
}

/**
 * Extract the release date from CHANGELOG for a given version.
 */
export function extractReleaseDate(changelogContent: string, version: string): string {
  const v = extractVersion(version);
  const lines = changelogContent.split('\n');

  for (const line of lines) {
    const match = line.match(new RegExp(`^## \\[${escapeRegex(v)}\\]\\s*-\\s*(\\d{4}-\\d{2}-\\d{2})`));
    if (match) {
      return match[1];
    }
  }

  // Default to today
  return new Date().toISOString().split('T')[0];
}

/**
 * Stamp the [Unreleased] section in CHANGELOG with the new version and today's date.
 * Moves content from [Unreleased] to a new version heading and adds a fresh [Unreleased] section.
 */
export function stampChangelog(changelogContent: string, version: string): string {
  const v = extractVersion(version);
  const today = new Date().toISOString().split('T')[0];

  // Find the [Unreleased] heading
  const unreleasedRegex = /^## \[Unreleased\]\s*$/m;
  if (!unreleasedRegex.test(changelogContent)) {
    return changelogContent;
  }

  // Replace [Unreleased] heading with new version, and add a fresh [Unreleased] above
  const updated = changelogContent.replace(
    unreleasedRegex,
    `## [Unreleased]\n\n## [${v}] - ${today}`,
  );

  return updated;
}

/**
 * Update the comparison links at the bottom of CHANGELOG.
 * Adds a link for the new version and updates the [Unreleased] link.
 */
export function updateChangelogLinks(
  changelogContent: string,
  version: string,
  repoUrl: string,
): string {
  const v = extractVersion(version);

  // Update [Unreleased] comparison link
  const unreleasedLinkRegex = /^\[Unreleased\]:\s+.+$/m;
  let updated = changelogContent;

  if (unreleasedLinkRegex.test(updated)) {
    updated = updated.replace(
      unreleasedLinkRegex,
      `[Unreleased]: ${repoUrl}/compare/v${v}...HEAD`,
    );
  }

  // Add new version comparison link before the first existing version link (if not already present)
  const versionLinkRegex = new RegExp(`^\\[${escapeRegex(v)}\\]:`, 'm');
  if (!versionLinkRegex.test(updated)) {
    // Find the previous version by looking at existing version links
    const existingLinks = updated.match(/^\[\d+\.\d+\.\d+[^\]]*\]:\s+.+$/gm);
    if (existingLinks && existingLinks.length > 0) {
      // Extract the previous version from the first link
      const prevMatch = existingLinks[0].match(/^\[([^\]]+)\]/);
      const prevVersion = prevMatch ? prevMatch[1] : null;

      if (prevVersion) {
        const newLink = `[${v}]: ${repoUrl}/compare/v${prevVersion}...v${v}`;
        // Insert before the first version link
        updated = updated.replace(existingLinks[0], `${newLink}\n${existingLinks[0]}`);
      }
    }
  }

  return updated;
}

/**
 * Build a ReleaseInfo object from CHANGELOG content and version tag.
 */
export function buildReleaseInfo(changelogContent: string, tag: string): ReleaseInfo {
  const version = extractVersion(tag);
  const normalizedTag = normalizeTag(tag);
  const notes = extractReleaseNotes(changelogContent, version);
  const date = extractReleaseDate(changelogContent, version);

  return {
    tag: normalizedTag,
    version,
    title: `ServerPilot v${version}`,
    notes,
    date,
  };
}

// ============================================================================
// Version Bumping
// ============================================================================

/**
 * Update the version field in a package.json file content.
 */
export function updatePackageVersion(packageJsonContent: string, version: string): string {
  const v = extractVersion(version);
  return packageJsonContent.replace(
    /"version":\s*"[^"]*"/,
    `"version": "${v}"`,
  );
}

/**
 * Read and update all package.json files to the new version.
 * Returns the list of files that were updated.
 */
export function bumpVersions(version: string, rootDir: string, dryRun: boolean): string[] {
  const v = extractVersion(version);
  const updated: string[] = [];

  for (const relPath of PACKAGE_JSON_PATHS) {
    const absPath = path.join(rootDir, relPath);
    if (!fs.existsSync(absPath)) continue;

    const content = fs.readFileSync(absPath, 'utf-8');
    const newContent = updatePackageVersion(content, v);

    if (content !== newContent) {
      if (!dryRun) {
        fs.writeFileSync(absPath, newContent, 'utf-8');
      }
      updated.push(relPath);
    }
  }

  return updated;
}

// ============================================================================
// Git Operations
// ============================================================================

/**
 * Check if a git tag already exists.
 */
export function tagExists(tag: string, rootDir: string = DEFAULT_ROOT_DIR): boolean {
  try {
    const output = execSync(`git tag -l "${tag}"`, { cwd: rootDir, stdio: 'pipe', encoding: 'utf-8' }).trim();
    return output === tag;
  } catch {
    return false;
  }
}

/**
 * Create an annotated git tag.
 */
export function createTag(tag: string, message: string, rootDir: string = DEFAULT_ROOT_DIR): void {
  execSync(`git tag -a "${tag}" -m "${message}"`, { cwd: rootDir, stdio: 'pipe' });
}

/**
 * Check if git working tree is clean (no uncommitted changes).
 */
export function isWorkingTreeClean(rootDir: string = DEFAULT_ROOT_DIR): boolean {
  try {
    const output = execSync('git status --porcelain', { cwd: rootDir, stdio: 'pipe', encoding: 'utf-8' }).trim();
    return output === '';
  } catch {
    return false;
  }
}

/**
 * Get the repository URL from git remote.
 */
export function getRepoUrl(rootDir: string = DEFAULT_ROOT_DIR): string {
  try {
    const remote = execSync('git remote get-url origin', { cwd: rootDir, stdio: 'pipe', encoding: 'utf-8' }).trim();
    // Convert SSH URL to HTTPS
    return remote
      .replace(/^git@github\.com:/, 'https://github.com/')
      .replace(/\.git$/, '');
  } catch {
    return 'https://github.com/jingjinbao/ServerPilot';
  }
}

// ============================================================================
// License Verification
// ============================================================================

/** Expected license mapping for Open Core model */
export const EXPECTED_LICENSES: Record<string, string> = {
  'packages/agent/package.json': 'Apache-2.0',
  'packages/server/package.json': 'AGPL-3.0',
  'packages/dashboard/package.json': 'AGPL-3.0',
  'packages/shared/package.json': 'MIT',
};

/**
 * Verify that all packages have the correct license in their package.json.
 */
export function verifyLicenses(rootDir: string): { valid: boolean; issues: string[] } {
  const issues: string[] = [];

  for (const [relPath, expectedLicense] of Object.entries(EXPECTED_LICENSES)) {
    const absPath = path.join(rootDir, relPath);
    if (!fs.existsSync(absPath)) {
      issues.push(`${relPath}: file not found`);
      continue;
    }

    const content = JSON.parse(fs.readFileSync(absPath, 'utf-8'));
    if (content.license !== expectedLicense) {
      issues.push(`${relPath}: expected "${expectedLicense}", found "${content.license}"`);
    }
  }

  // Check LICENSE files exist
  const licenseFiles = [
    'packages/agent/LICENSE',
    'packages/server/LICENSE',
    'packages/dashboard/LICENSE',
    'packages/shared/LICENSE',
  ];

  for (const relPath of licenseFiles) {
    if (!fs.existsSync(path.join(rootDir, relPath))) {
      issues.push(`${relPath}: LICENSE file not found`);
    }
  }

  return { valid: issues.length === 0, issues };
}

// ============================================================================
// Release Execution
// ============================================================================

/**
 * Execute the full release process.
 */
export function executeRelease(options: ReleaseOptions): ReleaseResult {
  const steps: ReleaseStep[] = [];
  const { tag, dryRun, skipTag, skipGhRelease, rootDir } = options;
  const normalizedTag = normalizeTag(tag);
  const version = extractVersion(tag);

  // Validate version
  if (!isValidSemver(tag)) {
    return {
      success: false,
      release: { tag: normalizedTag, version, title: '', notes: '', date: '' },
      steps: [{ name: 'Validate version', status: 'failed', message: `Invalid semver: ${tag}` }],
    };
  }

  // Read CHANGELOG
  const changelogPath = path.join(rootDir, CHANGELOG_PATH);
  if (!fs.existsSync(changelogPath)) {
    return {
      success: false,
      release: { tag: normalizedTag, version, title: '', notes: '', date: '' },
      steps: [{ name: 'Read CHANGELOG', status: 'failed', message: 'CHANGELOG.md not found' }],
    };
  }

  const changelogContent = fs.readFileSync(changelogPath, 'utf-8');
  const release = buildReleaseInfo(changelogContent, tag);

  if (!release.notes) {
    steps.push({
      name: 'Extract release notes',
      status: 'failed',
      message: `No release notes found for version ${release.version} in CHANGELOG.md`,
    });
    return { success: false, release, steps };
  }

  steps.push({
    name: 'Extract release notes',
    status: 'success',
    message: `Extracted ${release.notes.split('\n').length} lines of release notes`,
  });

  // Step 1: Verify licenses
  const licenseCheck = verifyLicenses(rootDir);
  if (!licenseCheck.valid) {
    steps.push({
      name: 'Verify licenses',
      status: 'failed',
      message: `License issues: ${licenseCheck.issues.join('; ')}`,
    });
    return { success: false, release, steps };
  }
  steps.push({
    name: 'Verify licenses',
    status: 'success',
    message: 'All package licenses verified (Agent: Apache-2.0, Server/Dashboard: AGPL-3.0, Shared: MIT)',
  });

  // Step 2: Bump versions in package.json files
  if (dryRun) {
    steps.push({
      name: 'Bump versions',
      status: 'skipped',
      message: `[dry-run] Would update version to ${version} in ${PACKAGE_JSON_PATHS.length} package.json files`,
    });
  } else {
    const updated = bumpVersions(version, rootDir, false);
    steps.push({
      name: 'Bump versions',
      status: 'success',
      message: `Updated version to ${version} in ${updated.length} files: ${updated.join(', ')}`,
    });
  }

  // Step 3: Create git tag
  if (skipTag) {
    steps.push({ name: 'Create git tag', status: 'skipped', message: 'Skipped by --skip-tag' });
  } else if (dryRun) {
    steps.push({ name: 'Create git tag', status: 'skipped', message: `[dry-run] Would create tag ${normalizedTag}` });
  } else {
    if (tagExists(normalizedTag, rootDir)) {
      steps.push({ name: 'Create git tag', status: 'skipped', message: `Tag ${normalizedTag} already exists` });
    } else {
      try {
        createTag(normalizedTag, `Release ${version}`, rootDir);
        steps.push({ name: 'Create git tag', status: 'success', message: `Created tag ${normalizedTag}` });
      } catch (err) {
        steps.push({
          name: 'Create git tag',
          status: 'failed',
          message: `Failed to create tag: ${err instanceof Error ? err.message : String(err)}`,
        });
        return { success: false, release, steps };
      }
    }
  }

  // Step 4: Create GitHub Release
  let releaseUrl: string | undefined;
  if (skipGhRelease) {
    steps.push({ name: 'Create GitHub release', status: 'skipped', message: 'Skipped by --skip-gh-release' });
  } else if (dryRun) {
    steps.push({
      name: 'Create GitHub release',
      status: 'skipped',
      message: `[dry-run] Would create release ${normalizedTag} with title "${release.title}"`,
    });
  } else {
    try {
      const ghArgs = [
        'gh', 'release', 'create', normalizedTag,
        '--title', JSON.stringify(release.title),
        '--notes', JSON.stringify(release.notes),
      ];
      const output = execSync(ghArgs.join(' '), {
        cwd: rootDir,
        encoding: 'utf-8',
        stdio: 'pipe',
      }).trim();
      releaseUrl = output;
      steps.push({ name: 'Create GitHub release', status: 'success', message: `Release created: ${output}` });
    } catch (err) {
      steps.push({
        name: 'Create GitHub release',
        status: 'failed',
        message: `Failed to create release: ${err instanceof Error ? err.message : String(err)}`,
      });
      return { success: false, release, steps };
    }
  }

  const allSuccess = steps.every(s => s.status !== 'failed');

  return {
    success: allSuccess,
    release,
    steps,
    releaseUrl,
  };
}

// ============================================================================
// CLI Argument Parsing
// ============================================================================

/**
 * Parse CLI arguments for the release script.
 */
export function parseReleaseArgs(argv: string[]): ReleaseOptions {
  const args = argv.slice(2);

  let tag = '';
  let dryRun = false;
  let skipTag = false;
  let skipGhRelease = false;

  for (const arg of args) {
    if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--skip-tag') {
      skipTag = true;
    } else if (arg === '--skip-gh-release') {
      skipGhRelease = true;
    } else if (!arg.startsWith('-')) {
      tag = arg;
    }
  }

  if (!tag) {
    throw new Error('Version tag is required. Usage: pnpm release v0.3.0');
  }

  return {
    tag,
    dryRun,
    skipTag,
    skipGhRelease,
    rootDir: DEFAULT_ROOT_DIR,
  };
}

// ============================================================================
// Utility
// ============================================================================

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ============================================================================
// CLI Entry Point
// ============================================================================

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (isMain) {
  console.log('ServerPilot - Release Publisher');
  console.log('===============================\n');

  try {
    const options = parseReleaseArgs(process.argv);
    console.log(`Tag:              ${normalizeTag(options.tag)}`);
    console.log(`Dry run:          ${options.dryRun}`);
    console.log(`Skip tag:         ${options.skipTag}`);
    console.log(`Skip GH release:  ${options.skipGhRelease}`);
    console.log('');

    const result = executeRelease(options);

    console.log('Steps:');
    for (const step of result.steps) {
      const icon = step.status === 'success' ? '\u2713' : step.status === 'skipped' ? '-' : '\u2717';
      console.log(`  ${icon} ${step.name}: ${step.message}`);
    }

    if (result.success) {
      console.log(`\n\u2713 Release ${result.release.tag} completed successfully!`);
      if (result.releaseUrl) {
        console.log(`  URL: ${result.releaseUrl}`);
      }
    } else {
      console.error(`\n\u2717 Release failed.`);
      process.exit(1);
    }
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
