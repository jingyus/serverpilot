/**
 * GitHub Releases Integration Module
 *
 * Generates download links pointing to GitHub Releases.
 * Detects the user's platform and recommends the appropriate binary.
 *
 * Features:
 * - Generate download URLs for all supported platforms
 * - Auto-detect platform from user agent or OS info
 * - Recommend the best binary for the detected platform
 * - Generate release page URLs
 * - Support for latest and specific version releases
 */

// ============================================================================
// Types
// ============================================================================

export type Platform = 'darwin' | 'linux' | 'win';
export type Architecture = 'arm64' | 'x64';

export interface BinaryAsset {
  /** Display name for the platform */
  platformName: string;
  /** Display name for the architecture */
  archName: string;
  /** Binary filename on GitHub Releases */
  filename: string;
  /** Full download URL */
  downloadUrl: string;
  /** Platform identifier */
  platform: Platform;
  /** Architecture identifier */
  arch: Architecture;
}

export interface PlatformRecommendation {
  /** The recommended binary asset */
  recommended: BinaryAsset;
  /** All available assets for the detected platform */
  platformAssets: BinaryAsset[];
  /** All available assets */
  allAssets: BinaryAsset[];
  /** Detected platform */
  detectedPlatform: Platform;
  /** Detected architecture */
  detectedArch: Architecture;
}

export interface ReleaseConfig {
  /** GitHub repository owner */
  owner: string;
  /** GitHub repository name */
  repo: string;
  /** Binary name prefix */
  binaryPrefix: string;
}

// ============================================================================
// Constants
// ============================================================================

export const DEFAULT_RELEASE_CONFIG: ReleaseConfig = {
  owner: 'serverpilot',
  repo: 'serverpilot',
  binaryPrefix: 'install-agent',
};

export const GITHUB_RELEASES_BASE = 'https://github.com';

/** All supported binary targets */
export const SUPPORTED_TARGETS: Array<{ platform: Platform; arch: Architecture }> = [
  { platform: 'darwin', arch: 'arm64' },
  { platform: 'darwin', arch: 'x64' },
  { platform: 'linux', arch: 'x64' },
  { platform: 'linux', arch: 'arm64' },
  { platform: 'win', arch: 'x64' },
];

/** Platform display names */
export const PLATFORM_NAMES: Record<Platform, string> = {
  darwin: 'macOS',
  linux: 'Linux',
  win: 'Windows',
};

/** Architecture display names */
export const ARCH_NAMES: Record<Architecture, string> = {
  arm64: 'Apple Silicon (M1/M2/M3/M4)',
  x64: 'Intel / AMD (x86_64)',
};

// ============================================================================
// URL Generation
// ============================================================================

/**
 * Get the binary filename for a given platform and architecture.
 */
export function getBinaryFilename(
  platform: Platform,
  arch: Architecture,
  prefix: string = DEFAULT_RELEASE_CONFIG.binaryPrefix,
): string {
  const suffix = platform === 'win' ? '.exe' : '';
  return `${prefix}-${platform}-${arch}${suffix}`;
}

/**
 * Get the GitHub Releases page URL for a repository.
 */
export function getReleasesPageUrl(config: ReleaseConfig = DEFAULT_RELEASE_CONFIG): string {
  return `${GITHUB_RELEASES_BASE}/${config.owner}/${config.repo}/releases`;
}

/**
 * Get the download URL for the latest release of a specific binary.
 */
export function getLatestDownloadUrl(
  filename: string,
  config: ReleaseConfig = DEFAULT_RELEASE_CONFIG,
): string {
  return `${GITHUB_RELEASES_BASE}/${config.owner}/${config.repo}/releases/latest/download/${filename}`;
}

/**
 * Get the download URL for a specific version release.
 */
export function getVersionDownloadUrl(
  filename: string,
  version: string,
  config: ReleaseConfig = DEFAULT_RELEASE_CONFIG,
): string {
  const tag = version.startsWith('v') ? version : `v${version}`;
  return `${GITHUB_RELEASES_BASE}/${config.owner}/${config.repo}/releases/download/${tag}/${filename}`;
}

// ============================================================================
// Asset Generation
// ============================================================================

/**
 * Build the list of all available binary assets with download URLs.
 */
export function buildAssetList(config: ReleaseConfig = DEFAULT_RELEASE_CONFIG): BinaryAsset[] {
  return SUPPORTED_TARGETS.map(({ platform, arch }) => {
    const filename = getBinaryFilename(platform, arch, config.binaryPrefix);
    return {
      platformName: PLATFORM_NAMES[platform],
      archName: ARCH_NAMES[arch],
      filename,
      downloadUrl: getLatestDownloadUrl(filename, config),
      platform,
      arch,
    };
  });
}

/**
 * Build asset list for a specific version.
 */
export function buildVersionAssetList(
  version: string,
  config: ReleaseConfig = DEFAULT_RELEASE_CONFIG,
): BinaryAsset[] {
  return SUPPORTED_TARGETS.map(({ platform, arch }) => {
    const filename = getBinaryFilename(platform, arch, config.binaryPrefix);
    return {
      platformName: PLATFORM_NAMES[platform],
      archName: ARCH_NAMES[arch],
      filename,
      downloadUrl: getVersionDownloadUrl(filename, version, config),
      platform,
      arch,
    };
  });
}

// ============================================================================
// Platform Detection
// ============================================================================

/**
 * Detect platform from a user agent string (browser-side detection).
 */
export function detectPlatformFromUserAgent(userAgent: string): { platform: Platform; arch: Architecture } {
  const ua = userAgent.toLowerCase();

  let platform: Platform = 'linux';
  if (ua.includes('mac') || ua.includes('darwin')) {
    platform = 'darwin';
  } else if (ua.includes('win')) {
    platform = 'win';
  }

  let arch: Architecture = 'x64';
  if (platform === 'darwin' && (ua.includes('arm64') || ua.includes('aarch64') || !ua.includes('intel'))) {
    // Default macOS to arm64 since most modern Macs are Apple Silicon
    arch = 'arm64';
  } else if (ua.includes('arm64') || ua.includes('aarch64')) {
    arch = 'arm64';
  }

  return { platform, arch };
}

/**
 * Detect platform from Node.js process info (server-side / CLI detection).
 */
export function detectPlatformFromOS(
  osPlatform: string,
  osArch: string,
): { platform: Platform; arch: Architecture } {
  let platform: Platform = 'linux';
  if (osPlatform === 'darwin') {
    platform = 'darwin';
  } else if (osPlatform === 'win32') {
    platform = 'win';
  }

  const arch: Architecture = osArch === 'arm64' ? 'arm64' : 'x64';

  return { platform, arch };
}

// ============================================================================
// Platform Recommendation
// ============================================================================

/**
 * Get a platform recommendation based on detected platform and architecture.
 */
export function getRecommendation(
  platform: Platform,
  arch: Architecture,
  config: ReleaseConfig = DEFAULT_RELEASE_CONFIG,
): PlatformRecommendation {
  const allAssets = buildAssetList(config);

  const platformAssets = allAssets.filter((a) => a.platform === platform);

  const recommended =
    platformAssets.find((a) => a.arch === arch) ||
    platformAssets[0] ||
    allAssets[0];

  return {
    recommended,
    platformAssets,
    allAssets,
    detectedPlatform: platform,
    detectedArch: arch,
  };
}

/**
 * Get a recommendation from a user agent string.
 */
export function getRecommendationFromUserAgent(
  userAgent: string,
  config: ReleaseConfig = DEFAULT_RELEASE_CONFIG,
): PlatformRecommendation {
  const { platform, arch } = detectPlatformFromUserAgent(userAgent);
  return getRecommendation(platform, arch, config);
}

/**
 * Get a recommendation from Node.js OS info.
 */
export function getRecommendationFromOS(
  osPlatform: string,
  osArch: string,
  config: ReleaseConfig = DEFAULT_RELEASE_CONFIG,
): PlatformRecommendation {
  const { platform, arch } = detectPlatformFromOS(osPlatform, osArch);
  return getRecommendation(platform, arch, config);
}

// ============================================================================
// Markdown Generation (for VitePress download page)
// ============================================================================

/**
 * Generate markdown download links for a specific platform.
 */
export function generatePlatformMarkdown(
  platform: Platform,
  config: ReleaseConfig = DEFAULT_RELEASE_CONFIG,
): string {
  const assets = buildAssetList(config).filter((a) => a.platform === platform);
  const lines: string[] = [];

  lines.push(`### ${PLATFORM_NAMES[platform]}`);
  lines.push('');

  for (const asset of assets) {
    lines.push(`- [${asset.platformName} (${asset.archName})](${asset.downloadUrl})`);
  }

  return lines.join('\n');
}

/**
 * Generate the complete download section markdown for all platforms.
 */
export function generateAllPlatformsMarkdown(
  config: ReleaseConfig = DEFAULT_RELEASE_CONFIG,
): string {
  const sections: string[] = [];

  for (const platform of ['darwin', 'linux', 'win'] as Platform[]) {
    sections.push(generatePlatformMarkdown(platform, config));
  }

  sections.push('');
  sections.push(`查看所有历史版本：[GitHub Releases](${getReleasesPageUrl(config)})`);

  return sections.join('\n\n');
}
