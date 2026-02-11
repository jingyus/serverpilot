// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Agent management routes.
 *
 * Provides version checking and update metadata for the agent.
 * The agent uses this endpoint to check for updates and download new versions.
 *
 * @module api/routes/agent
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { validateQuery } from '../middleware/validate.js';
import type { ApiEnv } from './types.js';

const agent = new Hono<ApiEnv>();

// ============================================================================
// Version configuration (in production, this would come from a database/config)
// ============================================================================

/**
 * Current latest agent version info.
 * In production, this should be sourced from:
 * - A database table tracking releases
 * - GitHub releases API
 * - S3/CDN metadata
 */
const LATEST_VERSION = '0.1.0';

interface PlatformBinary {
  url: string;
  sha256: string;
  size: number;
}

interface VersionInfo {
  version: string;
  releaseDate: string;
  releaseNotes: string;
  minVersion: string;
  binaries: {
    'darwin-x64'?: PlatformBinary;
    'darwin-arm64'?: PlatformBinary;
    'linux-x64'?: PlatformBinary;
    'linux-arm64'?: PlatformBinary;
    'win32-x64'?: PlatformBinary;
  };
}

/**
 * Get version info. In production, fetch from release database.
 */
function getVersionInfo(): VersionInfo {
  // Base URL for agent binaries (configurable via env)
  const baseUrl = process.env.AGENT_BINARY_BASE_URL || 'https://releases.serverpilot.ai/agent';

  return {
    version: LATEST_VERSION,
    releaseDate: '2025-01-15T00:00:00Z',
    releaseNotes: 'Initial release with environment detection, installation planning, and command execution.',
    minVersion: '0.1.0', // Minimum supported version (force update if below)
    binaries: {
      'darwin-x64': {
        url: `${baseUrl}/v${LATEST_VERSION}/ai-installer-darwin-x64`,
        sha256: '', // Would be populated by release build
        size: 0,
      },
      'darwin-arm64': {
        url: `${baseUrl}/v${LATEST_VERSION}/ai-installer-darwin-arm64`,
        sha256: '',
        size: 0,
      },
      'linux-x64': {
        url: `${baseUrl}/v${LATEST_VERSION}/ai-installer-linux-x64`,
        sha256: '',
        size: 0,
      },
      'linux-arm64': {
        url: `${baseUrl}/v${LATEST_VERSION}/ai-installer-linux-arm64`,
        sha256: '',
        size: 0,
      },
      'win32-x64': {
        url: `${baseUrl}/v${LATEST_VERSION}/ai-installer-win32-x64.exe`,
        sha256: '',
        size: 0,
      },
    },
  };
}

// ============================================================================
// Query schema
// ============================================================================

const VersionQuerySchema = z.object({
  current: z.string().optional(),
  platform: z.enum(['darwin', 'linux', 'win32']).optional(),
  arch: z.enum(['x64', 'arm64']).optional(),
});

// ============================================================================
// GET /agent/version — Check for agent updates
// ============================================================================

/**
 * Returns latest agent version info and download URLs.
 *
 * Query params:
 * - current: Current agent version (for comparison)
 * - platform: Target platform (darwin, linux, win32)
 * - arch: Target architecture (x64, arm64)
 *
 * Response:
 * - latest: Latest version string
 * - current: Client's current version (echoed back)
 * - updateAvailable: Whether an update is available
 * - forceUpdate: Whether update is mandatory (current < minVersion)
 * - releaseDate: Release timestamp
 * - releaseNotes: Release notes text
 * - downloadUrl: Platform-specific binary URL (if platform/arch provided)
 * - sha256: Binary checksum for verification
 */
agent.get('/version', validateQuery(VersionQuerySchema), async (c) => {
  const query = c.get('validatedQuery') as z.infer<typeof VersionQuerySchema>;
  const versionInfo = getVersionInfo();

  const current = query.current || '0.0.0';
  const updateAvailable = compareVersions(versionInfo.version, current) > 0;
  const forceUpdate = compareVersions(versionInfo.minVersion, current) > 0;

  // Get platform-specific binary info
  let downloadUrl: string | undefined;
  let sha256: string | undefined;
  let size: number | undefined;

  if (query.platform && query.arch) {
    const key = `${query.platform}-${query.arch}` as keyof typeof versionInfo.binaries;
    const binary = versionInfo.binaries[key];
    if (binary) {
      downloadUrl = binary.url;
      sha256 = binary.sha256;
      size = binary.size;
    }
  }

  return c.json({
    latest: versionInfo.version,
    current,
    updateAvailable,
    forceUpdate,
    releaseDate: versionInfo.releaseDate,
    releaseNotes: versionInfo.releaseNotes,
    downloadUrl,
    sha256,
    size,
  });
});

// ============================================================================
// GET /agent/binaries — List all available binaries
// ============================================================================

agent.get('/binaries', async (c) => {
  const versionInfo = getVersionInfo();

  return c.json({
    version: versionInfo.version,
    binaries: versionInfo.binaries,
  });
});

// ============================================================================
// Helpers
// ============================================================================

/**
 * Compare two semantic version strings.
 *
 * @returns positive if a > b, negative if a < b, 0 if equal
 */
function compareVersions(a: string, b: string): number {
  const aParts = a.split('.').map(Number);
  const bParts = b.split('.').map(Number);

  for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
    const aVal = aParts[i] || 0;
    const bVal = bParts[i] || 0;
    if (aVal !== bVal) {
      return aVal - bVal;
    }
  }

  return 0;
}

export { agent };
