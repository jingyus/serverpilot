/**
 * CDN Configuration Module
 *
 * Manages CDN configuration for distributing client binaries and install scripts.
 * Generates asset manifests, cache headers, and upload instructions.
 *
 * Features:
 * - Generate asset manifest for CDN upload
 * - Define cache policies for different file types
 * - Validate binary artifacts exist
 * - Generate upload instructions for Cloudflare/AWS CloudFront
 * - Supports dry-run mode
 *
 * Usage: npx tsx scripts/cdn-config.ts [--dry-run] [--provider cloudflare|aws]
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const ROOT_DIR = path.resolve(import.meta.dirname, '..');

// ============================================================================
// Types
// ============================================================================

export type CdnProvider = 'cloudflare' | 'aws';

export interface CdnAsset {
  filename: string;
  localPath: string;
  remotePath: string;
  contentType: string;
  cacheControl: string;
  exists: boolean;
  size?: number;
  checksum?: string;
}

export interface CdnConfig {
  provider: CdnProvider;
  baseUrl: string;
  version: string;
  assets: CdnAsset[];
}

export interface CdnUploadResult {
  success: boolean;
  action: 'uploaded' | 'skipped' | 'dry-run';
  message: string;
  config?: CdnConfig;
  missingAssets?: string[];
}

export interface CachePolicy {
  contentType: string;
  cacheControl: string;
}

// ============================================================================
// Constants
// ============================================================================

export const DEFAULT_PROVIDER: CdnProvider = 'cloudflare';
export const DEFAULT_BASE_URL = 'https://get.aiinstaller.dev';
export const BINARY_DIR = 'packages/agent/dist/bin';
export const INSTALL_SCRIPT_PATH = 'install.sh';

/** Binary targets to distribute */
export const BINARY_TARGETS = [
  'install-agent-darwin-arm64',
  'install-agent-darwin-x64',
  'install-agent-linux-x64',
  'install-agent-linux-arm64',
] as const;

// ============================================================================
// Cache Policies
// ============================================================================

/**
 * Cache policies for different asset types.
 */
export const CACHE_POLICIES: Record<string, CachePolicy> = {
  binary: {
    contentType: 'application/octet-stream',
    cacheControl: 'public, max-age=31536000, immutable',
  },
  script: {
    contentType: 'text/plain; charset=utf-8',
    cacheControl: 'public, max-age=300',
  },
  checksum: {
    contentType: 'text/plain; charset=utf-8',
    cacheControl: 'no-cache, no-store, must-revalidate',
  },
};

/**
 * Get the cache policy for a given filename.
 */
export function getCachePolicy(filename: string): CachePolicy {
  if (filename === 'checksums.txt') return CACHE_POLICIES.checksum;
  if (filename.endsWith('.sh')) return CACHE_POLICIES.script;
  return CACHE_POLICIES.binary;
}

// ============================================================================
// Asset Management
// ============================================================================

/**
 * Read the project version from package.json.
 */
export function getProjectVersion(): string {
  const pkgPath = path.join(ROOT_DIR, 'package.json');
  if (!fs.existsSync(pkgPath)) return '0.0.0';

  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  return pkg.version || '0.0.0';
}

/**
 * Get the SHA256 checksum of a file.
 */
export function getFileChecksum(filePath: string): string | undefined {
  if (!fs.existsSync(filePath)) return undefined;

  try {
    const output = execSync(`shasum -a 256 "${filePath}"`, {
      encoding: 'utf-8',
      stdio: 'pipe',
      timeout: 10000,
    }).trim();
    return output.split(/\s+/)[0];
  } catch {
    return undefined;
  }
}

/**
 * Build the list of CDN assets to upload.
 */
export function buildAssetList(version: string): CdnAsset[] {
  const assets: CdnAsset[] = [];

  // Binary files
  for (const target of BINARY_TARGETS) {
    const localPath = path.join(ROOT_DIR, BINARY_DIR, target);
    const exists = fs.existsSync(localPath);
    const policy = getCachePolicy(target);

    assets.push({
      filename: target,
      localPath,
      remotePath: `/v${version}/${target}`,
      contentType: policy.contentType,
      cacheControl: policy.cacheControl,
      exists,
      size: exists ? fs.statSync(localPath).size : undefined,
      checksum: exists ? getFileChecksum(localPath) : undefined,
    });
  }

  // Install script
  const installScriptPath = path.join(ROOT_DIR, INSTALL_SCRIPT_PATH);
  const installExists = fs.existsSync(installScriptPath);
  const scriptPolicy = getCachePolicy('install.sh');

  assets.push({
    filename: 'install.sh',
    localPath: installScriptPath,
    remotePath: '/install.sh',
    contentType: scriptPolicy.contentType,
    cacheControl: scriptPolicy.cacheControl,
    exists: installExists,
    size: installExists ? fs.statSync(installScriptPath).size : undefined,
  });

  // Checksums file
  const checksumsPath = path.join(ROOT_DIR, BINARY_DIR, 'checksums.txt');
  const checksumExists = fs.existsSync(checksumsPath);
  const checksumPolicy = getCachePolicy('checksums.txt');

  assets.push({
    filename: 'checksums.txt',
    localPath: checksumsPath,
    remotePath: `/v${version}/checksums.txt`,
    contentType: checksumPolicy.contentType,
    cacheControl: checksumPolicy.cacheControl,
    exists: checksumExists,
    size: checksumExists ? fs.statSync(checksumsPath).size : undefined,
  });

  return assets;
}

/**
 * Generate a checksums.txt file for all binary assets.
 */
export function generateChecksums(assets: CdnAsset[]): string {
  const lines: string[] = [];

  for (const asset of assets) {
    if (asset.checksum && asset.filename !== 'checksums.txt' && asset.filename !== 'install.sh') {
      lines.push(`${asset.checksum}  ${asset.filename}`);
    }
  }

  return lines.join('\n') + '\n';
}

// ============================================================================
// CDN Config Generation
// ============================================================================

/**
 * Build the full CDN configuration.
 */
export function buildCdnConfig(
  provider: CdnProvider = DEFAULT_PROVIDER,
  baseUrl: string = DEFAULT_BASE_URL,
): CdnConfig {
  const version = getProjectVersion();
  const assets = buildAssetList(version);

  return {
    provider,
    baseUrl,
    version,
    assets,
  };
}

/**
 * Validate that all required assets exist.
 */
export function validateAssets(config: CdnConfig): { valid: boolean; missing: string[] } {
  const missing = config.assets
    .filter((a) => !a.exists)
    .map((a) => a.filename);

  return { valid: missing.length === 0, missing };
}

/**
 * Generate upload instructions for the chosen CDN provider.
 */
export function generateUploadInstructions(config: CdnConfig): string[] {
  const instructions: string[] = [];

  if (config.provider === 'cloudflare') {
    instructions.push('# Upload to Cloudflare R2 / Pages');
    for (const asset of config.assets) {
      if (asset.exists) {
        instructions.push(
          `wrangler r2 object put aiinstaller${asset.remotePath} --file "${asset.localPath}" --content-type "${asset.contentType}" --cache-control "${asset.cacheControl}"`,
        );
      }
    }
  } else if (config.provider === 'aws') {
    instructions.push('# Upload to AWS CloudFront / S3');
    for (const asset of config.assets) {
      if (asset.exists) {
        instructions.push(
          `aws s3 cp "${asset.localPath}" s3://aiinstaller-cdn${asset.remotePath} --content-type "${asset.contentType}" --cache-control "${asset.cacheControl}"`,
        );
      }
    }
  }

  return instructions;
}

/**
 * Configure CDN with validation and upload instructions.
 */
export function configureCdn(
  provider: CdnProvider = DEFAULT_PROVIDER,
  dryRun = false,
): CdnUploadResult {
  const config = buildCdnConfig(provider);
  const validation = validateAssets(config);

  if (dryRun) {
    const instructions = generateUploadInstructions(config);
    return {
      success: true,
      action: 'dry-run',
      message: `[dry-run] Would upload ${config.assets.filter((a) => a.exists).length} assets to ${provider}. Missing: ${validation.missing.length} assets.`,
      config,
      missingAssets: validation.missing,
    };
  }

  if (!validation.valid) {
    return {
      success: false,
      action: 'skipped',
      message: `Missing assets: ${validation.missing.join(', ')}. Build binaries first with: bun scripts/build-binary.ts --all`,
      config,
      missingAssets: validation.missing,
    };
  }

  // In a real implementation, this would call the CDN provider APIs.
  // For now, return instructions for manual upload.
  const instructions = generateUploadInstructions(config);
  return {
    success: true,
    action: 'uploaded',
    message: `CDN config generated for ${provider}. ${instructions.length} upload commands prepared.`,
    config,
  };
}

// ============================================================================
// CLI entry point
// ============================================================================

if (process.argv[1] && import.meta.filename && process.argv[1] === import.meta.filename) {
  console.log('=== CDN Configuration ===\n');

  const dryRun = process.argv.includes('--dry-run');
  const providerIndex = process.argv.indexOf('--provider');
  const provider = (
    providerIndex !== -1 ? process.argv[providerIndex + 1] : DEFAULT_PROVIDER
  ) as CdnProvider;

  const config = buildCdnConfig(provider);
  console.log(`Provider: ${config.provider}`);
  console.log(`Base URL: ${config.baseUrl}`);
  console.log(`Version:  ${config.version}\n`);

  console.log('Assets:');
  for (const asset of config.assets) {
    const icon = asset.exists ? '✅' : '❌';
    const size = asset.size ? ` (${(asset.size / 1024).toFixed(1)} KB)` : '';
    console.log(`  ${icon} ${asset.filename}${size} → ${asset.remotePath}`);
    console.log(`     Cache: ${asset.cacheControl}`);
  }

  const validation = validateAssets(config);
  if (!validation.valid) {
    console.log(`\n❌ Missing ${validation.missing.length} asset(s):`);
    for (const m of validation.missing) {
      console.log(`   - ${m}`);
    }
  }

  if (dryRun || validation.valid) {
    console.log('\nUpload commands:');
    const instructions = generateUploadInstructions(config);
    for (const cmd of instructions) {
      console.log(`  ${cmd}`);
    }
  }

  if (!validation.valid && !dryRun) {
    console.log('\nBuild binaries first: bun scripts/build-binary.ts --all');
    process.exit(1);
  }
}
