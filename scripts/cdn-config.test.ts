/**
 * Tests for CDN Configuration Module.
 *
 * Validates:
 * - Constants and defaults
 * - Cache policies
 * - Asset list building
 * - Checksum generation
 * - CDN config building
 * - Asset validation
 * - Upload instructions
 * - Dry-run mode
 * - Type exports
 * - Integration with project structure
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_PROVIDER,
  DEFAULT_BASE_URL,
  BINARY_DIR,
  INSTALL_SCRIPT_PATH,
  BINARY_TARGETS,
  CACHE_POLICIES,
  getCachePolicy,
  getProjectVersion,
  buildAssetList,
  generateChecksums,
  buildCdnConfig,
  validateAssets,
  generateUploadInstructions,
  configureCdn,
} from './cdn-config';
import type {
  CdnProvider,
  CdnAsset,
  CdnConfig,
  CdnUploadResult,
  CachePolicy,
} from './cdn-config';

const ROOT_DIR = path.resolve(import.meta.dirname, '..');

// ============================================================================
// Constants
// ============================================================================

describe('Constants', () => {
  it('DEFAULT_PROVIDER should be cloudflare', () => {
    expect(DEFAULT_PROVIDER).toBe('cloudflare');
  });

  it('DEFAULT_BASE_URL should be a valid URL', () => {
    expect(DEFAULT_BASE_URL).toMatch(/^https:\/\//);
  });

  it('BINARY_DIR should point to agent dist/bin', () => {
    expect(BINARY_DIR).toContain('packages/agent');
    expect(BINARY_DIR).toContain('dist/bin');
  });

  it('INSTALL_SCRIPT_PATH should be install.sh', () => {
    expect(INSTALL_SCRIPT_PATH).toBe('install.sh');
  });

  it('BINARY_TARGETS should have 4 targets', () => {
    expect(BINARY_TARGETS).toHaveLength(4);
  });

  it('BINARY_TARGETS should cover darwin and linux', () => {
    const targets = [...BINARY_TARGETS];
    expect(targets.some((t) => t.includes('darwin-arm64'))).toBe(true);
    expect(targets.some((t) => t.includes('darwin-x64'))).toBe(true);
    expect(targets.some((t) => t.includes('linux-x64'))).toBe(true);
    expect(targets.some((t) => t.includes('linux-arm64'))).toBe(true);
  });
});

// ============================================================================
// Cache Policies
// ============================================================================

describe('CACHE_POLICIES', () => {
  it('should have binary policy', () => {
    expect(CACHE_POLICIES.binary).toBeDefined();
    expect(CACHE_POLICIES.binary.contentType).toBe('application/octet-stream');
    expect(CACHE_POLICIES.binary.cacheControl).toContain('max-age=31536000');
  });

  it('should have script policy with short cache', () => {
    expect(CACHE_POLICIES.script).toBeDefined();
    expect(CACHE_POLICIES.script.cacheControl).toContain('max-age=300');
  });

  it('should have checksum policy with no cache', () => {
    expect(CACHE_POLICIES.checksum).toBeDefined();
    expect(CACHE_POLICIES.checksum.cacheControl).toContain('no-cache');
  });
});

describe('getCachePolicy()', () => {
  it('should return binary policy for binary files', () => {
    const policy = getCachePolicy('install-agent-darwin-arm64');
    expect(policy.contentType).toBe('application/octet-stream');
  });

  it('should return script policy for .sh files', () => {
    const policy = getCachePolicy('install.sh');
    expect(policy.cacheControl).toContain('max-age=300');
  });

  it('should return checksum policy for checksums.txt', () => {
    const policy = getCachePolicy('checksums.txt');
    expect(policy.cacheControl).toContain('no-cache');
  });

  it('should return binary policy as default', () => {
    const policy = getCachePolicy('unknown-file');
    expect(policy.contentType).toBe('application/octet-stream');
  });
});

// ============================================================================
// getProjectVersion
// ============================================================================

describe('getProjectVersion()', () => {
  it('should return a version string', () => {
    const version = getProjectVersion();
    expect(typeof version).toBe('string');
    expect(version.length).toBeGreaterThan(0);
  });

  it('should match semver pattern', () => {
    const version = getProjectVersion();
    expect(version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('should match package.json version', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf-8'));
    if (pkg.version) {
      expect(getProjectVersion()).toBe(pkg.version);
    }
  });
});

// ============================================================================
// buildAssetList
// ============================================================================

describe('buildAssetList()', () => {
  it('should return assets for all targets + install.sh + checksums', () => {
    const assets = buildAssetList('0.1.0');
    // 4 binaries + install.sh + checksums.txt = 6
    expect(assets.length).toBe(6);
  });

  it('should include install.sh', () => {
    const assets = buildAssetList('0.1.0');
    const installScript = assets.find((a) => a.filename === 'install.sh');
    expect(installScript).toBeDefined();
  });

  it('should include checksums.txt', () => {
    const assets = buildAssetList('0.1.0');
    const checksums = assets.find((a) => a.filename === 'checksums.txt');
    expect(checksums).toBeDefined();
  });

  it('install.sh should exist', () => {
    const assets = buildAssetList('0.1.0');
    const installScript = assets.find((a) => a.filename === 'install.sh');
    expect(installScript?.exists).toBe(true);
  });

  it('binary remote paths should include version', () => {
    const assets = buildAssetList('1.2.3');
    const binaries = assets.filter((a) => a.filename.startsWith('install-agent-'));
    for (const b of binaries) {
      expect(b.remotePath).toContain('/v1.2.3/');
    }
  });

  it('each asset should have contentType and cacheControl', () => {
    const assets = buildAssetList('0.1.0');
    for (const asset of assets) {
      expect(asset.contentType.length).toBeGreaterThan(0);
      expect(asset.cacheControl.length).toBeGreaterThan(0);
    }
  });

  it('existing assets should have size > 0', () => {
    const assets = buildAssetList('0.1.0');
    for (const asset of assets) {
      if (asset.exists) {
        expect(asset.size).toBeDefined();
        expect(asset.size!).toBeGreaterThan(0);
      }
    }
  });
});

// ============================================================================
// generateChecksums
// ============================================================================

describe('generateChecksums()', () => {
  it('should return empty for assets without checksums', () => {
    const assets: CdnAsset[] = [
      {
        filename: 'test',
        localPath: '/tmp/test',
        remotePath: '/test',
        contentType: 'text/plain',
        cacheControl: 'no-cache',
        exists: false,
      },
    ];
    const result = generateChecksums(assets);
    expect(result.trim()).toBe('');
  });

  it('should format checksums correctly', () => {
    const assets: CdnAsset[] = [
      {
        filename: 'install-agent-darwin-arm64',
        localPath: '/tmp/test',
        remotePath: '/v1/test',
        contentType: 'application/octet-stream',
        cacheControl: 'public',
        exists: true,
        checksum: 'abc123',
      },
    ];
    const result = generateChecksums(assets);
    expect(result).toContain('abc123  install-agent-darwin-arm64');
  });

  it('should exclude install.sh and checksums.txt', () => {
    const assets: CdnAsset[] = [
      {
        filename: 'install.sh',
        localPath: '/tmp/test',
        remotePath: '/install.sh',
        contentType: 'text/plain',
        cacheControl: 'public',
        exists: true,
        checksum: 'aaa',
      },
      {
        filename: 'checksums.txt',
        localPath: '/tmp/test',
        remotePath: '/checksums.txt',
        contentType: 'text/plain',
        cacheControl: 'no-cache',
        exists: true,
        checksum: 'bbb',
      },
    ];
    const result = generateChecksums(assets);
    expect(result.trim()).toBe('');
  });
});

// ============================================================================
// buildCdnConfig
// ============================================================================

describe('buildCdnConfig()', () => {
  it('should use default provider', () => {
    const config = buildCdnConfig();
    expect(config.provider).toBe('cloudflare');
  });

  it('should use specified provider', () => {
    const config = buildCdnConfig('aws');
    expect(config.provider).toBe('aws');
  });

  it('should include version', () => {
    const config = buildCdnConfig();
    expect(config.version.length).toBeGreaterThan(0);
  });

  it('should include assets', () => {
    const config = buildCdnConfig();
    expect(config.assets.length).toBeGreaterThan(0);
  });

  it('should use default base URL', () => {
    const config = buildCdnConfig();
    expect(config.baseUrl).toBe(DEFAULT_BASE_URL);
  });

  it('should use custom base URL', () => {
    const config = buildCdnConfig('cloudflare', 'https://custom.example.com');
    expect(config.baseUrl).toBe('https://custom.example.com');
  });
});

// ============================================================================
// validateAssets
// ============================================================================

describe('validateAssets()', () => {
  it('should report missing binaries', () => {
    const config = buildCdnConfig();
    const validation = validateAssets(config);
    // Binaries might not exist in dev, but install.sh should
    expect(typeof validation.valid).toBe('boolean');
    expect(Array.isArray(validation.missing)).toBe(true);
  });

  it('should return valid=true when all assets exist', () => {
    const config: CdnConfig = {
      provider: 'cloudflare',
      baseUrl: 'https://test.com',
      version: '1.0.0',
      assets: [
        {
          filename: 'test',
          localPath: '/tmp/test',
          remotePath: '/test',
          contentType: 'text/plain',
          cacheControl: 'no-cache',
          exists: true,
        },
      ],
    };
    const validation = validateAssets(config);
    expect(validation.valid).toBe(true);
    expect(validation.missing).toHaveLength(0);
  });

  it('should return missing filenames', () => {
    const config: CdnConfig = {
      provider: 'cloudflare',
      baseUrl: 'https://test.com',
      version: '1.0.0',
      assets: [
        {
          filename: 'missing-file',
          localPath: '/tmp/missing',
          remotePath: '/missing',
          contentType: 'text/plain',
          cacheControl: 'no-cache',
          exists: false,
        },
      ],
    };
    const validation = validateAssets(config);
    expect(validation.valid).toBe(false);
    expect(validation.missing).toContain('missing-file');
  });
});

// ============================================================================
// generateUploadInstructions
// ============================================================================

describe('generateUploadInstructions()', () => {
  it('should generate cloudflare instructions', () => {
    const config: CdnConfig = {
      provider: 'cloudflare',
      baseUrl: 'https://test.com',
      version: '1.0.0',
      assets: [
        {
          filename: 'test',
          localPath: '/tmp/test',
          remotePath: '/test',
          contentType: 'text/plain',
          cacheControl: 'no-cache',
          exists: true,
        },
      ],
    };
    const instructions = generateUploadInstructions(config);
    expect(instructions.length).toBeGreaterThan(0);
    expect(instructions.some((i) => i.includes('wrangler'))).toBe(true);
  });

  it('should generate aws instructions', () => {
    const config: CdnConfig = {
      provider: 'aws',
      baseUrl: 'https://test.com',
      version: '1.0.0',
      assets: [
        {
          filename: 'test',
          localPath: '/tmp/test',
          remotePath: '/test',
          contentType: 'text/plain',
          cacheControl: 'no-cache',
          exists: true,
        },
      ],
    };
    const instructions = generateUploadInstructions(config);
    expect(instructions.length).toBeGreaterThan(0);
    expect(instructions.some((i) => i.includes('aws s3'))).toBe(true);
  });

  it('should skip non-existent assets', () => {
    const config: CdnConfig = {
      provider: 'cloudflare',
      baseUrl: 'https://test.com',
      version: '1.0.0',
      assets: [
        {
          filename: 'missing',
          localPath: '/tmp/missing',
          remotePath: '/missing',
          contentType: 'text/plain',
          cacheControl: 'no-cache',
          exists: false,
        },
      ],
    };
    const instructions = generateUploadInstructions(config);
    // Only the header comment, no upload commands
    expect(instructions.filter((i) => !i.startsWith('#'))).toHaveLength(0);
  });
});

// ============================================================================
// configureCdn (dry-run)
// ============================================================================

describe('configureCdn() dry-run', () => {
  it('should succeed in dry-run mode', () => {
    const result = configureCdn('cloudflare', true);
    expect(result.success).toBe(true);
    expect(result.action).toBe('dry-run');
  });

  it('should include config', () => {
    const result = configureCdn('cloudflare', true);
    expect(result.config).toBeDefined();
    expect(result.config!.provider).toBe('cloudflare');
  });

  it('should report missing assets', () => {
    const result = configureCdn('cloudflare', true);
    expect(result.missingAssets).toBeDefined();
    expect(Array.isArray(result.missingAssets)).toBe(true);
  });

  it('should work with aws provider', () => {
    const result = configureCdn('aws', true);
    expect(result.success).toBe(true);
    expect(result.config!.provider).toBe('aws');
  });

  it('message should mention dry-run', () => {
    const result = configureCdn('cloudflare', true);
    expect(result.message).toContain('dry-run');
  });
});

// ============================================================================
// Type exports
// ============================================================================

describe('Type exports', () => {
  it('CdnProvider should accept valid values', () => {
    const providers: CdnProvider[] = ['cloudflare', 'aws'];
    expect(providers).toHaveLength(2);
  });

  it('CdnAsset type should be usable', () => {
    const asset: CdnAsset = {
      filename: 'test',
      localPath: '/tmp/test',
      remotePath: '/test',
      contentType: 'text/plain',
      cacheControl: 'no-cache',
      exists: true,
      size: 100,
      checksum: 'abc',
    };
    expect(asset.filename).toBe('test');
    expect(asset.size).toBe(100);
  });

  it('CdnUploadResult type should be usable', () => {
    const result: CdnUploadResult = {
      success: true,
      action: 'uploaded',
      message: 'done',
    };
    expect(result.success).toBe(true);
  });

  it('CachePolicy type should be usable', () => {
    const policy: CachePolicy = {
      contentType: 'text/plain',
      cacheControl: 'no-cache',
    };
    expect(policy.contentType).toBe('text/plain');
  });
});

// ============================================================================
// Integration
// ============================================================================

describe('Integration: project structure', () => {
  it('install.sh should exist', () => {
    const exists = fs.existsSync(path.join(ROOT_DIR, INSTALL_SCRIPT_PATH));
    expect(exists).toBe(true);
  });

  it('deployment docs should mention CDN', () => {
    const deployDoc = fs.readFileSync(
      path.join(ROOT_DIR, 'docs/deployment.md'),
      'utf-8',
    );
    expect(deployDoc.toLowerCase()).toContain('cdn');
  });

  it('deployment docs should mention binary targets', () => {
    const deployDoc = fs.readFileSync(
      path.join(ROOT_DIR, 'docs/deployment.md'),
      'utf-8',
    );
    expect(deployDoc).toContain('darwin-arm64');
    expect(deployDoc).toContain('linux-x64');
  });
});
