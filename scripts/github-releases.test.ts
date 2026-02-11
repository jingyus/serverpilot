/**
 * Tests for GitHub Releases Integration Module.
 *
 * Validates:
 * - Constants and defaults
 * - Binary filename generation
 * - URL generation (latest, versioned, releases page)
 * - Asset list building
 * - Platform detection (user agent, OS)
 * - Platform recommendation
 * - Markdown generation
 * - Download page content integration
 * - Type exports
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_RELEASE_CONFIG,
  GITHUB_RELEASES_BASE,
  SUPPORTED_TARGETS,
  PLATFORM_NAMES,
  ARCH_NAMES,
  getBinaryFilename,
  getReleasesPageUrl,
  getLatestDownloadUrl,
  getVersionDownloadUrl,
  buildAssetList,
  buildVersionAssetList,
  detectPlatformFromUserAgent,
  detectPlatformFromOS,
  getRecommendation,
  getRecommendationFromUserAgent,
  getRecommendationFromOS,
  generatePlatformMarkdown,
  generateAllPlatformsMarkdown,
} from './github-releases';
import type {
  Platform,
  Architecture,
  BinaryAsset,
  PlatformRecommendation,
  ReleaseConfig,
} from './github-releases';

const ROOT_DIR = path.resolve(import.meta.dirname, '..');

// Check for files that integration tests depend on
const downloadPageExists = fs.existsSync(path.join(ROOT_DIR, 'packages/website/docs/download.md'));
const gettingStartedExists = fs.existsSync(path.join(ROOT_DIR, 'packages/website/docs/guide/getting-started.md'));
const vitepressConfigExists = fs.existsSync(path.join(ROOT_DIR, 'packages/website/docs/.vitepress/config.ts'));

// ============================================================================
// Constants
// ============================================================================

describe('Constants', () => {
  it('DEFAULT_RELEASE_CONFIG should have owner and repo', () => {
    expect(DEFAULT_RELEASE_CONFIG.owner).toBe('serverpilot');
    expect(DEFAULT_RELEASE_CONFIG.repo).toBe('serverpilot');
    expect(DEFAULT_RELEASE_CONFIG.binaryPrefix).toBe('install-agent');
  });

  it('GITHUB_RELEASES_BASE should be GitHub URL', () => {
    expect(GITHUB_RELEASES_BASE).toBe('https://github.com');
  });

  it('SUPPORTED_TARGETS should have 5 targets', () => {
    expect(SUPPORTED_TARGETS).toHaveLength(5);
  });

  it('SUPPORTED_TARGETS should cover all platforms', () => {
    const platforms = SUPPORTED_TARGETS.map((t) => t.platform);
    expect(platforms).toContain('darwin');
    expect(platforms).toContain('linux');
    expect(platforms).toContain('win');
  });

  it('SUPPORTED_TARGETS should cover arm64 and x64', () => {
    const archs = SUPPORTED_TARGETS.map((t) => t.arch);
    expect(archs).toContain('arm64');
    expect(archs).toContain('x64');
  });

  it('PLATFORM_NAMES should have all platforms', () => {
    expect(PLATFORM_NAMES.darwin).toBe('macOS');
    expect(PLATFORM_NAMES.linux).toBe('Linux');
    expect(PLATFORM_NAMES.win).toBe('Windows');
  });

  it('ARCH_NAMES should have all architectures', () => {
    expect(ARCH_NAMES.arm64).toContain('Apple Silicon');
    expect(ARCH_NAMES.x64).toContain('x86_64');
  });
});

// ============================================================================
// getBinaryFilename
// ============================================================================

describe('getBinaryFilename()', () => {
  it('should generate macOS arm64 filename', () => {
    expect(getBinaryFilename('darwin', 'arm64')).toBe('install-agent-darwin-arm64');
  });

  it('should generate macOS x64 filename', () => {
    expect(getBinaryFilename('darwin', 'x64')).toBe('install-agent-darwin-x64');
  });

  it('should generate Linux x64 filename', () => {
    expect(getBinaryFilename('linux', 'x64')).toBe('install-agent-linux-x64');
  });

  it('should generate Linux arm64 filename', () => {
    expect(getBinaryFilename('linux', 'arm64')).toBe('install-agent-linux-arm64');
  });

  it('should generate Windows filename with .exe', () => {
    expect(getBinaryFilename('win', 'x64')).toBe('install-agent-win-x64.exe');
  });

  it('should use custom prefix', () => {
    expect(getBinaryFilename('darwin', 'arm64', 'myapp')).toBe('myapp-darwin-arm64');
  });

  it('should not add .exe for non-windows', () => {
    const filename = getBinaryFilename('linux', 'x64');
    expect(filename).not.toContain('.exe');
  });
});

// ============================================================================
// URL Generation
// ============================================================================

describe('getReleasesPageUrl()', () => {
  it('should return correct URL with default config', () => {
    const url = getReleasesPageUrl();
    expect(url).toBe('https://github.com/serverpilot/serverpilot/releases');
  });

  it('should use custom config', () => {
    const url = getReleasesPageUrl({ owner: 'myorg', repo: 'myrepo', binaryPrefix: 'x' });
    expect(url).toBe('https://github.com/myorg/myrepo/releases');
  });
});

describe('getLatestDownloadUrl()', () => {
  it('should return correct latest download URL', () => {
    const url = getLatestDownloadUrl('install-agent-darwin-arm64');
    expect(url).toBe(
      'https://github.com/serverpilot/serverpilot/releases/latest/download/install-agent-darwin-arm64',
    );
  });

  it('should work with custom config', () => {
    const url = getLatestDownloadUrl('test-file', {
      owner: 'org',
      repo: 'repo',
      binaryPrefix: 'test',
    });
    expect(url).toBe('https://github.com/org/repo/releases/latest/download/test-file');
  });
});

describe('getVersionDownloadUrl()', () => {
  it('should return correct versioned URL with v prefix', () => {
    const url = getVersionDownloadUrl('install-agent-darwin-arm64', 'v1.0.0');
    expect(url).toBe(
      'https://github.com/serverpilot/serverpilot/releases/download/v1.0.0/install-agent-darwin-arm64',
    );
  });

  it('should auto-add v prefix if missing', () => {
    const url = getVersionDownloadUrl('install-agent-darwin-arm64', '1.0.0');
    expect(url).toBe(
      'https://github.com/serverpilot/serverpilot/releases/download/v1.0.0/install-agent-darwin-arm64',
    );
  });

  it('should not double v prefix', () => {
    const url = getVersionDownloadUrl('install-agent-darwin-arm64', 'v2.0.0');
    expect(url).toContain('/v2.0.0/');
    expect(url).not.toContain('/vv2.0.0/');
  });
});

// ============================================================================
// Asset List Building
// ============================================================================

describe('buildAssetList()', () => {
  it('should return 5 assets (all supported targets)', () => {
    const assets = buildAssetList();
    expect(assets).toHaveLength(5);
  });

  it('should include macOS arm64 asset', () => {
    const assets = buildAssetList();
    const macArm = assets.find((a) => a.platform === 'darwin' && a.arch === 'arm64');
    expect(macArm).toBeDefined();
    expect(macArm!.platformName).toBe('macOS');
    expect(macArm!.filename).toBe('install-agent-darwin-arm64');
  });

  it('should include Windows x64 asset', () => {
    const assets = buildAssetList();
    const win = assets.find((a) => a.platform === 'win');
    expect(win).toBeDefined();
    expect(win!.filename).toContain('.exe');
  });

  it('all assets should have valid download URLs', () => {
    const assets = buildAssetList();
    for (const asset of assets) {
      expect(asset.downloadUrl).toContain('https://github.com/');
      expect(asset.downloadUrl).toContain('/releases/latest/download/');
      expect(asset.downloadUrl).toContain(asset.filename);
    }
  });

  it('all assets should have platform and arch names', () => {
    const assets = buildAssetList();
    for (const asset of assets) {
      expect(asset.platformName.length).toBeGreaterThan(0);
      expect(asset.archName.length).toBeGreaterThan(0);
    }
  });
});

describe('buildVersionAssetList()', () => {
  it('should return assets with versioned URLs', () => {
    const assets = buildVersionAssetList('1.2.3');
    expect(assets).toHaveLength(5);
    for (const asset of assets) {
      expect(asset.downloadUrl).toContain('/v1.2.3/');
      expect(asset.downloadUrl).not.toContain('/latest/');
    }
  });

  it('should handle v-prefixed version', () => {
    const assets = buildVersionAssetList('v2.0.0');
    for (const asset of assets) {
      expect(asset.downloadUrl).toContain('/v2.0.0/');
    }
  });
});

// ============================================================================
// Platform Detection - User Agent
// ============================================================================

describe('detectPlatformFromUserAgent()', () => {
  it('should detect macOS from Safari user agent', () => {
    const ua =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';
    const result = detectPlatformFromUserAgent(ua);
    expect(result.platform).toBe('darwin');
  });

  it('should default macOS to arm64', () => {
    const ua = 'Mozilla/5.0 (Macintosh; Mac OS X 10_15_7)';
    const result = detectPlatformFromUserAgent(ua);
    expect(result.platform).toBe('darwin');
    expect(result.arch).toBe('arm64');
  });

  it('should detect Windows', () => {
    const ua =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
    const result = detectPlatformFromUserAgent(ua);
    expect(result.platform).toBe('win');
    expect(result.arch).toBe('x64');
  });

  it('should detect Linux', () => {
    const ua = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36';
    const result = detectPlatformFromUserAgent(ua);
    expect(result.platform).toBe('linux');
    expect(result.arch).toBe('x64');
  });

  it('should detect Linux ARM64', () => {
    const ua = 'Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36';
    const result = detectPlatformFromUserAgent(ua);
    expect(result.platform).toBe('linux');
    expect(result.arch).toBe('arm64');
  });

  it('should default to linux x64 for unknown UA', () => {
    const result = detectPlatformFromUserAgent('Unknown Browser');
    expect(result.platform).toBe('linux');
    expect(result.arch).toBe('x64');
  });
});

// ============================================================================
// Platform Detection - OS Info
// ============================================================================

describe('detectPlatformFromOS()', () => {
  it('should detect macOS', () => {
    const result = detectPlatformFromOS('darwin', 'arm64');
    expect(result.platform).toBe('darwin');
    expect(result.arch).toBe('arm64');
  });

  it('should detect Windows', () => {
    const result = detectPlatformFromOS('win32', 'x64');
    expect(result.platform).toBe('win');
    expect(result.arch).toBe('x64');
  });

  it('should detect Linux x64', () => {
    const result = detectPlatformFromOS('linux', 'x64');
    expect(result.platform).toBe('linux');
    expect(result.arch).toBe('x64');
  });

  it('should detect Linux arm64', () => {
    const result = detectPlatformFromOS('linux', 'arm64');
    expect(result.platform).toBe('linux');
    expect(result.arch).toBe('arm64');
  });

  it('should default unknown platform to linux', () => {
    const result = detectPlatformFromOS('freebsd', 'x64');
    expect(result.platform).toBe('linux');
  });

  it('should default unknown arch to x64', () => {
    const result = detectPlatformFromOS('linux', 'ia32');
    expect(result.arch).toBe('x64');
  });
});

// ============================================================================
// Platform Recommendation
// ============================================================================

describe('getRecommendation()', () => {
  it('should recommend macOS arm64 for darwin/arm64', () => {
    const rec = getRecommendation('darwin', 'arm64');
    expect(rec.recommended.platform).toBe('darwin');
    expect(rec.recommended.arch).toBe('arm64');
    expect(rec.detectedPlatform).toBe('darwin');
    expect(rec.detectedArch).toBe('arm64');
  });

  it('should return platform assets for the detected platform', () => {
    const rec = getRecommendation('linux', 'x64');
    expect(rec.platformAssets.length).toBeGreaterThan(0);
    for (const a of rec.platformAssets) {
      expect(a.platform).toBe('linux');
    }
  });

  it('should return all assets', () => {
    const rec = getRecommendation('darwin', 'arm64');
    expect(rec.allAssets).toHaveLength(5);
  });

  it('should include recommended in platformAssets', () => {
    const rec = getRecommendation('darwin', 'x64');
    expect(rec.platformAssets.some((a) => a.arch === 'x64')).toBe(true);
  });

  it('should work with Windows', () => {
    const rec = getRecommendation('win', 'x64');
    expect(rec.recommended.platform).toBe('win');
    expect(rec.recommended.filename).toContain('.exe');
  });
});

describe('getRecommendationFromUserAgent()', () => {
  it('should recommend macOS binary for Safari user agent', () => {
    const ua = 'Mozilla/5.0 (Macintosh; Mac OS X 10_15_7)';
    const rec = getRecommendationFromUserAgent(ua);
    expect(rec.recommended.platform).toBe('darwin');
  });

  it('should recommend Windows binary for Edge user agent', () => {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Edg/91.0';
    const rec = getRecommendationFromUserAgent(ua);
    expect(rec.recommended.platform).toBe('win');
  });
});

describe('getRecommendationFromOS()', () => {
  it('should recommend based on process platform', () => {
    const rec = getRecommendationFromOS('darwin', 'arm64');
    expect(rec.recommended.platform).toBe('darwin');
    expect(rec.recommended.arch).toBe('arm64');
  });

  it('should recommend linux for linux platform', () => {
    const rec = getRecommendationFromOS('linux', 'x64');
    expect(rec.recommended.platform).toBe('linux');
    expect(rec.recommended.arch).toBe('x64');
  });
});

// ============================================================================
// Markdown Generation
// ============================================================================

describe('generatePlatformMarkdown()', () => {
  it('should generate macOS section with header', () => {
    const md = generatePlatformMarkdown('darwin');
    expect(md).toContain('### macOS');
  });

  it('should include download links', () => {
    const md = generatePlatformMarkdown('darwin');
    expect(md).toContain('https://github.com/');
    expect(md).toContain('/releases/latest/download/');
  });

  it('should include both architectures for macOS', () => {
    const md = generatePlatformMarkdown('darwin');
    expect(md).toContain('arm64');
    expect(md).toContain('x64');
  });

  it('should generate Linux section', () => {
    const md = generatePlatformMarkdown('linux');
    expect(md).toContain('### Linux');
  });

  it('should generate Windows section', () => {
    const md = generatePlatformMarkdown('win');
    expect(md).toContain('### Windows');
    expect(md).toContain('.exe');
  });
});

describe('generateAllPlatformsMarkdown()', () => {
  it('should include all platforms', () => {
    const md = generateAllPlatformsMarkdown();
    expect(md).toContain('### macOS');
    expect(md).toContain('### Linux');
    expect(md).toContain('### Windows');
  });

  it('should include releases page link', () => {
    const md = generateAllPlatformsMarkdown();
    expect(md).toContain('GitHub Releases');
    expect(md).toContain('/releases');
  });

  it('should include all binary download links', () => {
    const md = generateAllPlatformsMarkdown();
    expect(md).toContain('install-agent-darwin-arm64');
    expect(md).toContain('install-agent-darwin-x64');
    expect(md).toContain('install-agent-linux-x64');
    expect(md).toContain('install-agent-linux-arm64');
    expect(md).toContain('install-agent-win-x64.exe');
  });
});

// ============================================================================
// Type Exports
// ============================================================================

describe('Type exports', () => {
  it('Platform type should accept valid values', () => {
    const platforms: Platform[] = ['darwin', 'linux', 'win'];
    expect(platforms).toHaveLength(3);
  });

  it('Architecture type should accept valid values', () => {
    const archs: Architecture[] = ['arm64', 'x64'];
    expect(archs).toHaveLength(2);
  });

  it('BinaryAsset type should be usable', () => {
    const asset: BinaryAsset = {
      platformName: 'macOS',
      archName: 'Apple Silicon',
      filename: 'test-darwin-arm64',
      downloadUrl: 'https://example.com/test',
      platform: 'darwin',
      arch: 'arm64',
    };
    expect(asset.platformName).toBe('macOS');
  });

  it('PlatformRecommendation type should be usable', () => {
    const rec: PlatformRecommendation = {
      recommended: {
        platformName: 'macOS',
        archName: 'Apple Silicon',
        filename: 'test',
        downloadUrl: 'https://example.com',
        platform: 'darwin',
        arch: 'arm64',
      },
      platformAssets: [],
      allAssets: [],
      detectedPlatform: 'darwin',
      detectedArch: 'arm64',
    };
    expect(rec.detectedPlatform).toBe('darwin');
  });

  it('ReleaseConfig type should be usable', () => {
    const config: ReleaseConfig = {
      owner: 'test',
      repo: 'test',
      binaryPrefix: 'test',
    };
    expect(config.owner).toBe('test');
  });
});

// ============================================================================
// Integration: Download Page Content
// ============================================================================

describe.skipIf(!downloadPageExists)('Integration: download page', () => {
  const downloadPage = downloadPageExists
    ? fs.readFileSync(
        path.join(ROOT_DIR, 'packages/website/docs/download.md'),
        'utf-8',
      )
    : '';

  it('should contain GitHub Releases download links', () => {
    expect(downloadPage).toContain('github.com/serverpilot/serverpilot/releases');
  });

  it('should not contain placeholder username', () => {
    expect(downloadPage).not.toContain('yourusername');
  });

  it('should have download links for all platforms', () => {
    expect(downloadPage).toContain('install-agent-darwin-arm64');
    expect(downloadPage).toContain('install-agent-darwin-x64');
    expect(downloadPage).toContain('install-agent-linux-x64');
    expect(downloadPage).toContain('install-agent-linux-arm64');
    expect(downloadPage).toContain('install-agent-win-x64.exe');
  });

  it('should have latest download URLs', () => {
    expect(downloadPage).toContain('/releases/latest/download/');
  });

  it('should have platform auto-detection script', () => {
    expect(downloadPage).toContain('detectPlatform');
    expect(downloadPage).toContain('navigator.userAgent');
  });

  it('should have recommended download section', () => {
    expect(downloadPage).toContain('recommended-download');
    expect(downloadPage).toContain('recommended-link');
  });

  it('should have version history link', () => {
    expect(downloadPage).toContain('GitHub Releases');
    expect(downloadPage).toContain('/releases)');
  });
});

describe.skipIf(!gettingStartedExists)('Integration: getting-started page', () => {
  const gettingStarted = gettingStartedExists
    ? fs.readFileSync(
        path.join(ROOT_DIR, 'packages/website/docs/guide/getting-started.md'),
        'utf-8',
      )
    : '';

  it('should not contain placeholder username', () => {
    expect(gettingStarted).not.toContain('yourusername');
  });

  it('should contain correct GitHub Releases links', () => {
    expect(gettingStarted).toContain('github.com/serverpilot/serverpilot/releases');
  });
});

describe.skipIf(!vitepressConfigExists)('Integration: VitePress config', () => {
  const config = vitepressConfigExists
    ? fs.readFileSync(
        path.join(ROOT_DIR, 'packages/website/docs/.vitepress/config.ts'),
        'utf-8',
      )
    : '';

  it('should not contain placeholder username', () => {
    expect(config).not.toContain('yourusername');
  });

  it('should have correct GitHub link', () => {
    expect(config).toContain('github.com/serverpilot/serverpilot');
  });
});
