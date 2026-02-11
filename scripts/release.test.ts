/**
 * Tests for ServerPilot Release Script.
 *
 * Validates:
 * - Version parsing and validation
 * - CHANGELOG extraction and stamping
 * - Release info building
 * - Version bumping in package.json
 * - License verification
 * - CHANGELOG link updating
 * - CLI argument parsing
 * - Full release execution (dry-run)
 * - Integration with actual project files
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  normalizeTag,
  extractVersion,
  isValidSemver,
  extractReleaseNotes,
  extractReleaseDate,
  buildReleaseInfo,
  stampChangelog,
  updateChangelogLinks,
  updatePackageVersion,
  verifyLicenses,
  executeRelease,
  parseReleaseArgs,
  EXPECTED_LICENSES,
} from './release';

const ROOT_DIR = path.resolve(import.meta.dirname, '..');

// Check for files that integration tests depend on
const changelogExists = fs.existsSync(path.join(ROOT_DIR, 'CHANGELOG.md'));

// ============================================================================
// Version Parsing
// ============================================================================

describe('normalizeTag()', () => {
  it('should add v prefix if missing', () => {
    expect(normalizeTag('1.1.0')).toBe('v1.1.0');
  });

  it('should not double the v prefix', () => {
    expect(normalizeTag('v1.1.0')).toBe('v1.1.0');
  });

  it('should handle prerelease versions', () => {
    expect(normalizeTag('1.0.0-beta.1')).toBe('v1.0.0-beta.1');
  });
});

describe('extractVersion()', () => {
  it('should remove v prefix', () => {
    expect(extractVersion('v1.1.0')).toBe('1.1.0');
  });

  it('should return as-is if no v prefix', () => {
    expect(extractVersion('1.1.0')).toBe('1.1.0');
  });

  it('should handle prerelease', () => {
    expect(extractVersion('v2.0.0-rc.1')).toBe('2.0.0-rc.1');
  });
});

describe('isValidSemver()', () => {
  it('should accept valid semver with v prefix', () => {
    expect(isValidSemver('v1.1.0')).toBe(true);
  });

  it('should accept valid semver without v prefix', () => {
    expect(isValidSemver('1.1.0')).toBe(true);
  });

  it('should accept prerelease versions', () => {
    expect(isValidSemver('1.0.0-beta.1')).toBe(true);
  });

  it('should reject invalid versions', () => {
    expect(isValidSemver('abc')).toBe(false);
    expect(isValidSemver('1.2')).toBe(false);
    expect(isValidSemver('')).toBe(false);
  });

  it('should accept major.minor.patch format', () => {
    expect(isValidSemver('0.0.1')).toBe(true);
    expect(isValidSemver('10.20.30')).toBe(true);
  });
});

// ============================================================================
// CHANGELOG Parsing
// ============================================================================

const SAMPLE_CHANGELOG = `# Changelog

## [Unreleased]

### Planned
- Future feature

## [1.1.0] - 2026-02-08

### Added

- AI install plan generation
- Error diagnosis and repair

### Changed

- Upgraded to WSS

## [1.0.0] - 2026-02-07

### Added

- Basic C/S architecture
- WebSocket communication

[Unreleased]: https://github.com/example/repo/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/example/repo/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/example/repo/releases/tag/v1.0.0
`;

describe('extractReleaseNotes()', () => {
  it('should extract notes for version 1.1.0', () => {
    const notes = extractReleaseNotes(SAMPLE_CHANGELOG, '1.1.0');
    expect(notes).toContain('### Added');
    expect(notes).toContain('AI install plan generation');
    expect(notes).toContain('### Changed');
    expect(notes).toContain('Upgraded to WSS');
  });

  it('should extract notes for version 1.0.0', () => {
    const notes = extractReleaseNotes(SAMPLE_CHANGELOG, '1.0.0');
    expect(notes).toContain('### Added');
    expect(notes).toContain('Basic C/S architecture');
    expect(notes).not.toContain('AI install plan generation');
  });

  it('should handle v prefix', () => {
    const notes = extractReleaseNotes(SAMPLE_CHANGELOG, 'v1.1.0');
    expect(notes).toContain('AI install plan generation');
  });

  it('should return empty string for non-existent version', () => {
    const notes = extractReleaseNotes(SAMPLE_CHANGELOG, '9.9.9');
    expect(notes).toBe('');
  });

  it('should not include content from other versions', () => {
    const notes = extractReleaseNotes(SAMPLE_CHANGELOG, '1.1.0');
    expect(notes).not.toContain('Basic C/S architecture');
    expect(notes).not.toContain('WebSocket communication');
  });

  it('should trim leading/trailing empty lines', () => {
    const notes = extractReleaseNotes(SAMPLE_CHANGELOG, '1.1.0');
    expect(notes).not.toMatch(/^\s*\n/);
    expect(notes).not.toMatch(/\n\s*$/);
  });
});

describe('extractReleaseDate()', () => {
  it('should extract date for version 1.1.0', () => {
    const date = extractReleaseDate(SAMPLE_CHANGELOG, '1.1.0');
    expect(date).toBe('2026-02-08');
  });

  it('should extract date for version 1.0.0', () => {
    const date = extractReleaseDate(SAMPLE_CHANGELOG, '1.0.0');
    expect(date).toBe('2026-02-07');
  });

  it('should return today for non-existent version', () => {
    const date = extractReleaseDate(SAMPLE_CHANGELOG, '9.9.9');
    expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('should handle v prefix', () => {
    const date = extractReleaseDate(SAMPLE_CHANGELOG, 'v1.1.0');
    expect(date).toBe('2026-02-08');
  });
});

describe('buildReleaseInfo()', () => {
  it('should build complete release info', () => {
    const info = buildReleaseInfo(SAMPLE_CHANGELOG, 'v1.1.0');
    expect(info.tag).toBe('v1.1.0');
    expect(info.version).toBe('1.1.0');
    expect(info.title).toBe('ServerPilot v1.1.0');
    expect(info.notes).toContain('AI install plan generation');
    expect(info.date).toBe('2026-02-08');
  });

  it('should normalize tag', () => {
    const info = buildReleaseInfo(SAMPLE_CHANGELOG, '1.1.0');
    expect(info.tag).toBe('v1.1.0');
  });

  it('should have non-empty notes for existing version', () => {
    const info = buildReleaseInfo(SAMPLE_CHANGELOG, '1.0.0');
    expect(info.notes.length).toBeGreaterThan(0);
  });

  it('should have empty notes for non-existent version', () => {
    const info = buildReleaseInfo(SAMPLE_CHANGELOG, '9.9.9');
    expect(info.notes).toBe('');
  });

  it('should use ServerPilot in title', () => {
    const info = buildReleaseInfo(SAMPLE_CHANGELOG, 'v0.3.0');
    expect(info.title).toBe('ServerPilot v0.3.0');
  });
});

// ============================================================================
// CHANGELOG Stamping
// ============================================================================

describe('stampChangelog()', () => {
  it('should stamp [Unreleased] with new version and date', () => {
    const stamped = stampChangelog(SAMPLE_CHANGELOG, '2.0.0');
    expect(stamped).toContain('## [Unreleased]');
    expect(stamped).toContain('## [2.0.0] -');
    // The new [Unreleased] should be above the stamped version
    const unreleasedIdx = stamped.indexOf('## [Unreleased]');
    const stampedIdx = stamped.indexOf('## [2.0.0]');
    expect(unreleasedIdx).toBeLessThan(stampedIdx);
  });

  it('should keep the original content under the new version heading', () => {
    const stamped = stampChangelog(SAMPLE_CHANGELOG, '2.0.0');
    // The "Future feature" content was under [Unreleased], now should be under [2.0.0]
    const versionIdx = stamped.indexOf('## [2.0.0]');
    const nextVersionIdx = stamped.indexOf('## [1.1.0]');
    const betweenContent = stamped.slice(versionIdx, nextVersionIdx);
    expect(betweenContent).toContain('Future feature');
  });

  it('should return unchanged if no [Unreleased] section', () => {
    const noUnreleased = '# Changelog\n\n## [1.0.0] - 2026-01-01\n\n- stuff';
    const result = stampChangelog(noUnreleased, '2.0.0');
    expect(result).toBe(noUnreleased);
  });

  it('should use today\'s date', () => {
    const today = new Date().toISOString().split('T')[0];
    const stamped = stampChangelog(SAMPLE_CHANGELOG, '2.0.0');
    expect(stamped).toContain(`## [2.0.0] - ${today}`);
  });
});

// ============================================================================
// CHANGELOG Link Updating
// ============================================================================

describe('updateChangelogLinks()', () => {
  const repoUrl = 'https://github.com/example/repo';

  it('should update [Unreleased] comparison link', () => {
    const updated = updateChangelogLinks(SAMPLE_CHANGELOG, '2.0.0', repoUrl);
    expect(updated).toContain('[Unreleased]: https://github.com/example/repo/compare/v2.0.0...HEAD');
  });

  it('should add new version comparison link', () => {
    const updated = updateChangelogLinks(SAMPLE_CHANGELOG, '2.0.0', repoUrl);
    expect(updated).toContain('[2.0.0]: https://github.com/example/repo/compare/v1.1.0...v2.0.0');
  });

  it('should not duplicate existing version link', () => {
    const updated = updateChangelogLinks(SAMPLE_CHANGELOG, '1.1.0', repoUrl);
    // Should not add a duplicate [1.1.0] link since it already exists
    const matches = updated.match(/\[1\.1\.0\]:/g);
    expect(matches?.length).toBe(1);
  });
});

// ============================================================================
// Version Bumping
// ============================================================================

describe('updatePackageVersion()', () => {
  it('should update version field', () => {
    const input = '{\n  "name": "test",\n  "version": "0.1.0"\n}';
    const output = updatePackageVersion(input, '0.3.0');
    expect(output).toContain('"version": "0.3.0"');
    expect(output).toContain('"name": "test"');
  });

  it('should handle v prefix in version', () => {
    const input = '{\n  "name": "test",\n  "version": "0.1.0"\n}';
    const output = updatePackageVersion(input, 'v0.3.0');
    expect(output).toContain('"version": "0.3.0"');
  });

  it('should not change if version is same', () => {
    const input = '{\n  "name": "test",\n  "version": "0.3.0"\n}';
    const output = updatePackageVersion(input, '0.3.0');
    expect(output).toBe(input);
  });
});

// ============================================================================
// License Verification
// ============================================================================

describe('verifyLicenses()', () => {
  it('should pass for the real project directory', () => {
    const result = verifyLicenses(ROOT_DIR);
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('should fail for non-existent directory', () => {
    const result = verifyLicenses('/nonexistent/path');
    expect(result.valid).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it('should have correct expected licenses', () => {
    expect(EXPECTED_LICENSES['packages/agent/package.json']).toBe('Apache-2.0');
    expect(EXPECTED_LICENSES['packages/server/package.json']).toBe('AGPL-3.0');
    expect(EXPECTED_LICENSES['packages/dashboard/package.json']).toBe('AGPL-3.0');
    expect(EXPECTED_LICENSES['packages/shared/package.json']).toBe('MIT');
  });
});

// ============================================================================
// CLI Argument Parsing
// ============================================================================

describe('parseReleaseArgs()', () => {
  it('should parse version tag', () => {
    const opts = parseReleaseArgs(['node', 'release.ts', 'v0.3.0']);
    expect(opts.tag).toBe('v0.3.0');
    expect(opts.dryRun).toBe(false);
    expect(opts.skipTag).toBe(false);
    expect(opts.skipGhRelease).toBe(false);
  });

  it('should parse --dry-run flag', () => {
    const opts = parseReleaseArgs(['node', 'release.ts', 'v0.3.0', '--dry-run']);
    expect(opts.dryRun).toBe(true);
  });

  it('should parse --skip-tag flag', () => {
    const opts = parseReleaseArgs(['node', 'release.ts', 'v0.3.0', '--skip-tag']);
    expect(opts.skipTag).toBe(true);
  });

  it('should parse --skip-gh-release flag', () => {
    const opts = parseReleaseArgs(['node', 'release.ts', 'v0.3.0', '--skip-gh-release']);
    expect(opts.skipGhRelease).toBe(true);
  });

  it('should parse multiple flags', () => {
    const opts = parseReleaseArgs(['node', 'release.ts', 'v0.3.0', '--dry-run', '--skip-tag']);
    expect(opts.dryRun).toBe(true);
    expect(opts.skipTag).toBe(true);
  });

  it('should throw if no version tag provided', () => {
    expect(() => parseReleaseArgs(['node', 'release.ts'])).toThrow('Version tag is required');
  });

  it('should throw if only flags provided', () => {
    expect(() => parseReleaseArgs(['node', 'release.ts', '--dry-run'])).toThrow('Version tag is required');
  });

  it('should accept version without v prefix', () => {
    const opts = parseReleaseArgs(['node', 'release.ts', '0.3.0']);
    expect(opts.tag).toBe('0.3.0');
  });

  it('should show pnpm release in error message', () => {
    expect(() => parseReleaseArgs(['node', 'release.ts'])).toThrow('pnpm release');
  });
});

// ============================================================================
// Release Execution (dry-run)
// ============================================================================

describe('executeRelease()', () => {
  it('should fail with invalid semver', () => {
    const result = executeRelease({
      tag: 'invalid',
      dryRun: true,
      skipTag: false,
      skipGhRelease: false,
      rootDir: ROOT_DIR,
    });
    expect(result.success).toBe(false);
    expect(result.steps[0].status).toBe('failed');
    expect(result.steps[0].message).toContain('Invalid semver');
  });

  it.skipIf(!changelogExists)('should succeed in dry-run mode with real CHANGELOG', () => {
    const result = executeRelease({
      tag: 'v0.2.0',
      dryRun: true,
      skipTag: false,
      skipGhRelease: false,
      rootDir: ROOT_DIR,
    });
    expect(result.success).toBe(true);
    expect(result.release.tag).toBe('v0.2.0');
    expect(result.release.version).toBe('0.2.0');
    expect(result.release.notes.length).toBeGreaterThan(0);
  });

  it.skipIf(!changelogExists)('should include license verification step', () => {
    const result = executeRelease({
      tag: 'v0.2.0',
      dryRun: true,
      skipTag: false,
      skipGhRelease: false,
      rootDir: ROOT_DIR,
    });
    const licenseStep = result.steps.find(s => s.name === 'Verify licenses');
    expect(licenseStep).toBeDefined();
    expect(licenseStep?.status).toBe('success');
    expect(licenseStep?.message).toContain('Apache-2.0');
    expect(licenseStep?.message).toContain('AGPL-3.0');
  });

  it.skipIf(!changelogExists)('should include version bump step in dry-run', () => {
    const result = executeRelease({
      tag: 'v0.2.0',
      dryRun: true,
      skipTag: false,
      skipGhRelease: false,
      rootDir: ROOT_DIR,
    });
    const bumpStep = result.steps.find(s => s.name === 'Bump versions');
    expect(bumpStep).toBeDefined();
    expect(bumpStep?.status).toBe('skipped');
    expect(bumpStep?.message).toContain('[dry-run]');
  });

  it.skipIf(!changelogExists)('should have at least 5 steps in dry-run', () => {
    const result = executeRelease({
      tag: 'v0.2.0',
      dryRun: true,
      skipTag: false,
      skipGhRelease: false,
      rootDir: ROOT_DIR,
    });
    // extract notes + verify licenses + bump versions + tag + gh release = 5 steps
    expect(result.steps.length).toBeGreaterThanOrEqual(5);
  });

  it('should mark all steps as non-failed in dry-run', () => {
    const result = executeRelease({
      tag: 'v0.2.0',
      dryRun: true,
      skipTag: false,
      skipGhRelease: false,
      rootDir: ROOT_DIR,
    });
    // First step (extract) is success, rest are skipped
    const nonExtractSteps = result.steps.slice(1);
    for (const step of nonExtractSteps) {
      expect(step.status).not.toBe('failed');
    }
  });

  it('should fail if CHANGELOG not found', () => {
    const result = executeRelease({
      tag: 'v1.1.0',
      dryRun: true,
      skipTag: false,
      skipGhRelease: false,
      rootDir: '/nonexistent/path',
    });
    expect(result.success).toBe(false);
    expect(result.steps[0].message).toContain('CHANGELOG.md not found');
  });

  it.skipIf(!changelogExists)('should fail for version not in CHANGELOG', () => {
    const result = executeRelease({
      tag: 'v99.99.99',
      dryRun: true,
      skipTag: false,
      skipGhRelease: false,
      rootDir: ROOT_DIR,
    });
    expect(result.success).toBe(false);
    expect(result.steps[0].message).toContain('No release notes found');
  });

  it.skipIf(!changelogExists)('should handle skip flags', () => {
    const result = executeRelease({
      tag: 'v0.2.0',
      dryRun: true,
      skipTag: true,
      skipGhRelease: true,
      rootDir: ROOT_DIR,
    });
    const tagStep = result.steps.find(s => s.name === 'Create git tag');
    const ghStep = result.steps.find(s => s.name === 'Create GitHub release');
    expect(tagStep?.status).toBe('skipped');
    expect(ghStep?.status).toBe('skipped');
  });

  it.skipIf(!changelogExists)('should use ServerPilot in release title', () => {
    const result = executeRelease({
      tag: 'v0.2.0',
      dryRun: true,
      skipTag: false,
      skipGhRelease: false,
      rootDir: ROOT_DIR,
    });
    expect(result.release.title).toBe('ServerPilot v0.2.0');
  });
});

// ============================================================================
// Integration: Actual Project Files
// ============================================================================

describe.skipIf(!changelogExists)('Integration: project CHANGELOG', () => {
  const changelog = changelogExists
    ? fs.readFileSync(path.join(ROOT_DIR, 'CHANGELOG.md'), 'utf-8')
    : '';

  it('should contain version 0.2.0', () => {
    expect(changelog).toContain('[0.2.0]');
  });

  it('should contain version 0.1.0', () => {
    expect(changelog).toContain('[0.1.0]');
  });

  it('should extract non-empty notes for v0.2.0', () => {
    const notes = extractReleaseNotes(changelog, '0.2.0');
    expect(notes.length).toBeGreaterThan(0);
    expect(notes).toContain('Added');
  });

  it('should extract correct date for v0.2.0', () => {
    const date = extractReleaseDate(changelog, '0.2.0');
    expect(date).toBe('2026-02-11');
  });
});

describe('Integration: project licenses', () => {
  it('should have correct license in agent package.json', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'packages/agent/package.json'), 'utf-8'));
    expect(pkg.license).toBe('Apache-2.0');
  });

  it('should have correct license in server package.json', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'packages/server/package.json'), 'utf-8'));
    expect(pkg.license).toBe('AGPL-3.0');
  });

  it('should have correct license in dashboard package.json', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'packages/dashboard/package.json'), 'utf-8'));
    expect(pkg.license).toBe('AGPL-3.0');
  });

  it('should have correct license in shared package.json', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'packages/shared/package.json'), 'utf-8'));
    expect(pkg.license).toBe('MIT');
  });

  it('should have LICENSE files in all packages', () => {
    expect(fs.existsSync(path.join(ROOT_DIR, 'packages/agent/LICENSE'))).toBe(true);
    expect(fs.existsSync(path.join(ROOT_DIR, 'packages/server/LICENSE'))).toBe(true);
    expect(fs.existsSync(path.join(ROOT_DIR, 'packages/dashboard/LICENSE'))).toBe(true);
    expect(fs.existsSync(path.join(ROOT_DIR, 'packages/shared/LICENSE'))).toBe(true);
  });

  it('should have Apache 2.0 in agent LICENSE', () => {
    const content = fs.readFileSync(path.join(ROOT_DIR, 'packages/agent/LICENSE'), 'utf-8');
    expect(content).toContain('Apache License');
    expect(content).toContain('Version 2.0');
  });

  it('should have AGPL 3.0 in server LICENSE', () => {
    const content = fs.readFileSync(path.join(ROOT_DIR, 'packages/server/LICENSE'), 'utf-8');
    expect(content).toContain('GNU AFFERO GENERAL PUBLIC LICENSE');
    expect(content).toContain('Version 3');
  });
});

describe.skipIf(!changelogExists)('Integration: full dry-run release of v0.2.0', () => {
  it('should produce a valid release result', () => {
    const result = executeRelease({
      tag: 'v0.2.0',
      dryRun: true,
      skipTag: false,
      skipGhRelease: false,
      rootDir: ROOT_DIR,
    });

    expect(result.success).toBe(true);
    expect(result.release.tag).toBe('v0.2.0');
    expect(result.release.version).toBe('0.2.0');
    expect(result.release.date).toBe('2026-02-11');
    expect(result.release.notes).toContain('AI');
    expect(result.steps.every(s => s.status !== 'failed')).toBe(true);
  });
});
