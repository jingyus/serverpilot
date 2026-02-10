#!/usr/bin/env bun
/**
 * Release Publishing Module
 *
 * Manages the full release lifecycle:
 * 1. Create a Git tag for the release version
 * 2. Generate and publish Release Notes from CHANGELOG.md
 * 3. Update the website announcement banner
 *
 * Usage:
 *   bun scripts/release.ts v1.1.0                    # Full release
 *   bun scripts/release.ts v1.1.0 --dry-run          # Preview without executing
 *   bun scripts/release.ts v1.1.0 --skip-tag         # Skip git tag creation
 *   bun scripts/release.ts v1.1.0 --skip-gh-release  # Skip GitHub release
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================================
// Types
// ============================================================================

export interface ReleaseInfo {
  /** Version tag (e.g. "v1.1.0") */
  tag: string;
  /** Version without v prefix (e.g. "1.1.0") */
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
  /** Version tag (e.g. "v1.1.0") */
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
const WEBSITE_CONFIG_PATH = 'packages/website/docs/.vitepress/config.ts';
const WEBSITE_INDEX_PATH = 'packages/website/docs/index.md';

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
 * Validate a semantic version string (e.g. "1.1.0" or "v1.1.0").
 */
export function isValidSemver(version: string): boolean {
  const v = extractVersion(version);
  return /^\d+\.\d+\.\d+(-[\w.]+)?$/.test(v);
}

// ============================================================================
// CHANGELOG Parsing
// ============================================================================

/**
 * Extract release notes for a specific version from CHANGELOG.md.
 * Returns the content between the version heading and the next version heading.
 */
export function extractReleaseNotes(changelogContent: string, version: string): string {
  const v = extractVersion(version);
  const lines = changelogContent.split('\n');

  let capturing = false;
  let notes: string[] = [];

  for (const line of lines) {
    // Match the version heading: ## [1.1.0] or ## [1.1.0] - 2026-02-08
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
    title: `v${version} - AI Installer MVP`,
    notes,
    date,
  };
}

// ============================================================================
// Git Tag
// ============================================================================

/**
 * Check if a git tag already exists.
 */
export function tagExists(tag: string, rootDir: string = DEFAULT_ROOT_DIR): boolean {
  try {
    execSync(`git tag -l "${tag}"`, { cwd: rootDir, stdio: 'pipe', encoding: 'utf-8' });
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

// ============================================================================
// Website Announcement
// ============================================================================

/**
 * Generate the VitePress announcement bar configuration snippet.
 */
export function generateAnnouncementConfig(release: ReleaseInfo): string {
  return `\n    announcement: {\n      content: 'v${release.version} \u5df2\u53d1\u5e03\uff01AI \u667a\u80fd\u5b89\u88c5\u8ba1\u5212 + \u9519\u8bef\u8bca\u65ad\u4fee\u590d <a href="/download">\u7acb\u5373\u4e0b\u8f7d</a>',\n      link: '/download'\n    },`;
}

/**
 * Update VitePress config.ts to include an announcement banner.
 * Inserts the announcement config into the themeConfig section.
 */
export function updateWebsiteAnnouncement(
  configContent: string,
  release: ReleaseInfo,
): string {
  // Check if announcement already exists
  if (configContent.includes('announcement:')) {
    // Replace existing announcement
    const updated = configContent.replace(
      /\n\s*announcement:\s*\{[^}]*\},?/,
      generateAnnouncementConfig(release),
    );
    return updated;
  }

  // Insert announcement after themeConfig: {
  const insertPoint = 'themeConfig: {';
  const idx = configContent.indexOf(insertPoint);
  if (idx === -1) {
    return configContent;
  }

  const insertPos = idx + insertPoint.length;
  return configContent.slice(0, insertPos) +
    generateAnnouncementConfig(release) +
    configContent.slice(insertPos);
}

/**
 * Generate the release announcement badge for the homepage hero section.
 */
export function generateHeroAnnouncement(release: ReleaseInfo): string {
  return `  tagline: v${release.version} \u5df2\u53d1\u5e03 - \u8ba9\u8f6f\u4ef6\u5b89\u88c5\u53d8\u5f97\u7b80\u5355\u3001\u667a\u80fd\u3001\u53ef\u9760`;
}

/**
 * Update the homepage tagline to reflect the new release.
 */
export function updateHomepageTagline(
  indexContent: string,
  release: ReleaseInfo,
): string {
  return indexContent.replace(
    /^\s*tagline:.*$/m,
    generateHeroAnnouncement(release),
  );
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

  // Validate version
  if (!isValidSemver(tag)) {
    return {
      success: false,
      release: { tag: normalizedTag, version: extractVersion(tag), title: '', notes: '', date: '' },
      steps: [{ name: 'Validate version', status: 'failed', message: `Invalid semver: ${tag}` }],
    };
  }

  // Read CHANGELOG
  const changelogPath = path.join(rootDir, CHANGELOG_PATH);
  if (!fs.existsSync(changelogPath)) {
    return {
      success: false,
      release: { tag: normalizedTag, version: extractVersion(tag), title: '', notes: '', date: '' },
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

  // Step 1: Create git tag
  if (skipTag) {
    steps.push({ name: 'Create git tag', status: 'skipped', message: 'Skipped by --skip-tag' });
  } else if (dryRun) {
    steps.push({ name: 'Create git tag', status: 'skipped', message: `[dry-run] Would create tag ${normalizedTag}` });
  } else {
    if (tagExists(normalizedTag, rootDir)) {
      steps.push({ name: 'Create git tag', status: 'skipped', message: `Tag ${normalizedTag} already exists` });
    } else {
      try {
        createTag(normalizedTag, `Release ${release.version}`, rootDir);
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

  // Step 2: Create GitHub Release
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

  // Step 3: Update website announcement
  const configPath = path.join(rootDir, WEBSITE_CONFIG_PATH);
  if (!fs.existsSync(configPath)) {
    steps.push({ name: 'Update website announcement', status: 'skipped', message: 'VitePress config not found' });
  } else if (dryRun) {
    steps.push({
      name: 'Update website announcement',
      status: 'skipped',
      message: `[dry-run] Would add announcement banner for v${release.version}`,
    });
  } else {
    try {
      const configContent = fs.readFileSync(configPath, 'utf-8');
      const updatedConfig = updateWebsiteAnnouncement(configContent, release);
      fs.writeFileSync(configPath, updatedConfig, 'utf-8');
      steps.push({ name: 'Update website announcement', status: 'success', message: 'Announcement banner added to VitePress config' });
    } catch (err) {
      steps.push({
        name: 'Update website announcement',
        status: 'failed',
        message: `Failed to update config: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  // Step 4: Update homepage tagline
  const indexPath = path.join(rootDir, WEBSITE_INDEX_PATH);
  if (!fs.existsSync(indexPath)) {
    steps.push({ name: 'Update homepage tagline', status: 'skipped', message: 'Homepage index.md not found' });
  } else if (dryRun) {
    steps.push({
      name: 'Update homepage tagline',
      status: 'skipped',
      message: `[dry-run] Would update tagline to include v${release.version}`,
    });
  } else {
    try {
      const indexContent = fs.readFileSync(indexPath, 'utf-8');
      const updatedIndex = updateHomepageTagline(indexContent, release);
      fs.writeFileSync(indexPath, updatedIndex, 'utf-8');
      steps.push({ name: 'Update homepage tagline', status: 'success', message: 'Homepage tagline updated' });
    } catch (err) {
      steps.push({
        name: 'Update homepage tagline',
        status: 'failed',
        message: `Failed to update homepage: ${err instanceof Error ? err.message : String(err)}`,
      });
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
    throw new Error('Version tag is required. Usage: bun scripts/release.ts v1.1.0');
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
  console.log('AI Installer - Release Publisher');
  console.log('================================\n');

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
