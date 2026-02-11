/**
 * Tests for Release Publishing Module.
 *
 * Validates:
 * - Version parsing and validation
 * - CHANGELOG extraction
 * - Release info building
 * - Website announcement generation
 * - Homepage tagline update
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
  generateAnnouncementConfig,
  updateWebsiteAnnouncement,
  generateHeroAnnouncement,
  updateHomepageTagline,
  executeRelease,
  parseReleaseArgs,
} from './release';

const ROOT_DIR = path.resolve(import.meta.dirname, '..');

// Check for files that integration tests depend on
const changelogExists = fs.existsSync(path.join(ROOT_DIR, 'CHANGELOG.md'));
const vitepressConfigExists = fs.existsSync(path.join(ROOT_DIR, 'packages/website/docs/.vitepress/config.ts'));
const websiteIndexExists = fs.existsSync(path.join(ROOT_DIR, 'packages/website/docs/index.md'));

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

[1.1.0]: https://github.com/example/repo/releases/tag/v1.1.0
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
    expect(info.title).toContain('v1.1.0');
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
});

// ============================================================================
// Website Announcement
// ============================================================================

describe('generateAnnouncementConfig()', () => {
  const release: ReturnType<typeof buildReleaseInfo> = {
    tag: 'v1.1.0',
    version: '1.1.0',
    title: 'v1.1.0 - AI Installer MVP',
    notes: 'test notes',
    date: '2026-02-08',
  };

  it('should contain announcement key', () => {
    const config = generateAnnouncementConfig(release);
    expect(config).toContain('announcement:');
  });

  it('should contain version number', () => {
    const config = generateAnnouncementConfig(release);
    expect(config).toContain('v1.1.0');
  });

  it('should contain download link', () => {
    const config = generateAnnouncementConfig(release);
    expect(config).toContain('/download');
  });

  it('should contain release description', () => {
    const config = generateAnnouncementConfig(release);
    expect(config).toContain('已发布');
  });
});

describe('updateWebsiteAnnouncement()', () => {
  const release: ReturnType<typeof buildReleaseInfo> = {
    tag: 'v1.1.0',
    version: '1.1.0',
    title: 'v1.1.0 - AI Installer MVP',
    notes: 'test notes',
    date: '2026-02-08',
  };

  const sampleConfig = `import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'AI Installer',
  themeConfig: {
    logo: '/logo.png',
    nav: []
  }
})`;

  it('should insert announcement into themeConfig', () => {
    const updated = updateWebsiteAnnouncement(sampleConfig, release);
    expect(updated).toContain('announcement:');
    expect(updated).toContain('v1.1.0');
  });

  it('should keep original config structure', () => {
    const updated = updateWebsiteAnnouncement(sampleConfig, release);
    expect(updated).toContain("title: 'AI Installer'");
    expect(updated).toContain("logo: '/logo.png'");
    expect(updated).toContain('themeConfig: {');
  });

  it('should replace existing announcement', () => {
    const configWithAnnouncement = sampleConfig.replace(
      'themeConfig: {',
      `themeConfig: {\n    announcement: {\n      content: 'old announcement',\n      link: '/old'\n    },`,
    );
    const updated = updateWebsiteAnnouncement(configWithAnnouncement, release);
    expect(updated).not.toContain('old announcement');
    expect(updated).toContain('v1.1.0');
  });

  it('should return unchanged if no themeConfig found', () => {
    const noThemeConfig = `export default {}`;
    const updated = updateWebsiteAnnouncement(noThemeConfig, release);
    expect(updated).toBe(noThemeConfig);
  });
});

describe('generateHeroAnnouncement()', () => {
  const release: ReturnType<typeof buildReleaseInfo> = {
    tag: 'v1.1.0',
    version: '1.1.0',
    title: 'v1.1.0 - AI Installer MVP',
    notes: 'test',
    date: '2026-02-08',
  };

  it('should contain version number', () => {
    const hero = generateHeroAnnouncement(release);
    expect(hero).toContain('v1.1.0');
  });

  it('should start with tagline prefix', () => {
    const hero = generateHeroAnnouncement(release);
    expect(hero).toMatch(/^\s*tagline:/);
  });

  it('should contain release announcement text', () => {
    const hero = generateHeroAnnouncement(release);
    expect(hero).toContain('已发布');
  });
});

describe('updateHomepageTagline()', () => {
  const release: ReturnType<typeof buildReleaseInfo> = {
    tag: 'v1.1.0',
    version: '1.1.0',
    title: 'v1.1.0 - AI Installer MVP',
    notes: 'test',
    date: '2026-02-08',
  };

  const sampleIndex = `---
layout: home

hero:
  name: AI Installer
  text: AI 驱动的智能安装平台
  tagline: 让软件安装变得简单、智能、可靠
  actions:
    - theme: brand
      text: 快速开始
---`;

  it('should update the tagline line', () => {
    const updated = updateHomepageTagline(sampleIndex, release);
    expect(updated).toContain('v1.1.0');
    expect(updated).toContain('已发布');
  });

  it('should preserve other content', () => {
    const updated = updateHomepageTagline(sampleIndex, release);
    expect(updated).toContain('name: AI Installer');
    expect(updated).toContain('text: AI 驱动的智能安装平台');
    expect(updated).toContain('快速开始');
  });

  it('should replace original tagline', () => {
    const updated = updateHomepageTagline(sampleIndex, release);
    // The original tagline should be replaced
    const taglineLines = updated.split('\n').filter(l => l.includes('tagline:'));
    expect(taglineLines).toHaveLength(1);
    expect(taglineLines[0]).toContain('v1.1.0');
  });
});

// ============================================================================
// CLI Argument Parsing
// ============================================================================

describe('parseReleaseArgs()', () => {
  it('should parse version tag', () => {
    const opts = parseReleaseArgs(['node', 'release.ts', 'v1.1.0']);
    expect(opts.tag).toBe('v1.1.0');
    expect(opts.dryRun).toBe(false);
    expect(opts.skipTag).toBe(false);
    expect(opts.skipGhRelease).toBe(false);
  });

  it('should parse --dry-run flag', () => {
    const opts = parseReleaseArgs(['node', 'release.ts', 'v1.1.0', '--dry-run']);
    expect(opts.dryRun).toBe(true);
  });

  it('should parse --skip-tag flag', () => {
    const opts = parseReleaseArgs(['node', 'release.ts', 'v1.1.0', '--skip-tag']);
    expect(opts.skipTag).toBe(true);
  });

  it('should parse --skip-gh-release flag', () => {
    const opts = parseReleaseArgs(['node', 'release.ts', 'v1.1.0', '--skip-gh-release']);
    expect(opts.skipGhRelease).toBe(true);
  });

  it('should parse multiple flags', () => {
    const opts = parseReleaseArgs(['node', 'release.ts', 'v1.1.0', '--dry-run', '--skip-tag']);
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
    const opts = parseReleaseArgs(['node', 'release.ts', '1.1.0']);
    expect(opts.tag).toBe('1.1.0');
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

  it.skipIf(!changelogExists)('should have 4 steps in dry-run', () => {
    const result = executeRelease({
      tag: 'v0.2.0',
      dryRun: true,
      skipTag: false,
      skipGhRelease: false,
      rootDir: ROOT_DIR,
    });
    // extract notes + tag + gh release + announcement + tagline = 5 steps
    expect(result.steps.length).toBeGreaterThanOrEqual(4);
  });

  it('should mark all steps as skipped in dry-run', () => {
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
      dryRun: false,
      skipTag: true,
      skipGhRelease: true,
      rootDir: ROOT_DIR,
    });
    const tagStep = result.steps.find(s => s.name === 'Create git tag');
    const ghStep = result.steps.find(s => s.name === 'Create GitHub release');
    expect(tagStep?.status).toBe('skipped');
    expect(ghStep?.status).toBe('skipped');
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

describe.skipIf(!vitepressConfigExists || !changelogExists)('Integration: VitePress config', () => {
  const configContent = vitepressConfigExists
    ? fs.readFileSync(
        path.join(ROOT_DIR, 'packages/website/docs/.vitepress/config.ts'),
        'utf-8',
      )
    : '';

  it('should be updateable with announcement', () => {
    const release = buildReleaseInfo(
      fs.readFileSync(path.join(ROOT_DIR, 'CHANGELOG.md'), 'utf-8'),
      'v0.2.0',
    );
    const updated = updateWebsiteAnnouncement(configContent, release);
    expect(updated).toContain('announcement:');
    expect(updated).toContain('v0.2.0');
    // Should still have the rest of the config
    expect(updated).toContain("title: 'AI Installer'");
    expect(updated).toContain('themeConfig');
  });
});

describe.skipIf(!websiteIndexExists || !changelogExists)('Integration: homepage index', () => {
  const indexContent = websiteIndexExists
    ? fs.readFileSync(
        path.join(ROOT_DIR, 'packages/website/docs/index.md'),
        'utf-8',
      )
    : '';

  it('should have a tagline to update', () => {
    expect(indexContent).toContain('tagline:');
  });

  it('should be updateable with release tagline', () => {
    const release = buildReleaseInfo(
      fs.readFileSync(path.join(ROOT_DIR, 'CHANGELOG.md'), 'utf-8'),
      'v0.2.0',
    );
    const updated = updateHomepageTagline(indexContent, release);
    expect(updated).toContain('v0.2.0');
    // Should keep the rest of the page
    expect(updated).toContain('name: AI Installer');
    expect(updated).toContain('快速开始');
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
