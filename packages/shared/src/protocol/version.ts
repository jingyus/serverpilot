// SPDX-License-Identifier: MIT
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Protocol version management for Agent/Server compatibility.
 *
 * Defines the protocol version constant and compatibility checking logic.
 * Both the server (via @aiinstaller/shared) and agent (via protocol-lite.ts)
 * must stay in sync on the major version number.
 *
 * Version rules (semver):
 * - Major: breaking changes — MUST match exactly
 * - Minor: backward-compatible additions — server >= agent is OK
 * - Patch: bug fixes — always compatible
 *
 * @module protocol/version
 */

/** Current protocol version (semver) */
export const PROTOCOL_VERSION = '1.0.0';

/** Parsed semver components */
export interface SemVer {
  major: number;
  minor: number;
  patch: number;
}

/** Result of a version compatibility check */
export interface VersionCheckResult {
  /** Whether the versions are compatible */
  compatible: boolean;
  /** Severity level of the mismatch */
  severity: 'ok' | 'warn' | 'error';
  /** Human-readable message */
  message: string;
}

/**
 * Parse a semver string into its components.
 *
 * @param version - Version string (e.g. "1.2.3")
 * @returns Parsed components, or null if invalid
 */
export function parseSemVer(version: string): SemVer | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) return null;
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
  };
}

/**
 * Check protocol version compatibility between agent and server.
 *
 * Rules:
 * - Missing version (undefined) → treated as "0.x" legacy agent, warn only
 * - Major version mismatch → incompatible (error)
 * - Agent minor > server minor → incompatible (agent too new)
 * - Agent minor <= server minor → compatible
 * - Invalid version format → warn only
 *
 * @param agentVersion - Protocol version reported by the agent (may be undefined for legacy agents)
 * @param serverVersion - Protocol version of the server (defaults to PROTOCOL_VERSION)
 * @returns Compatibility check result
 */
export function checkVersionCompatibility(
  agentVersion: string | undefined,
  serverVersion: string = PROTOCOL_VERSION,
): VersionCheckResult {
  // Legacy agent without version — warn but allow
  if (!agentVersion) {
    return {
      compatible: true,
      severity: 'warn',
      message:
        'Agent did not report protocol version (legacy agent). Please upgrade to the latest agent version.',
    };
  }

  const agent = parseSemVer(agentVersion);
  const server = parseSemVer(serverVersion);

  // Invalid format — warn but allow
  if (!agent) {
    return {
      compatible: true,
      severity: 'warn',
      message: `Agent reported invalid protocol version "${agentVersion}". Expected format: "X.Y.Z".`,
    };
  }

  if (!server) {
    // Server version should always be valid; this is a programming error
    return {
      compatible: true,
      severity: 'warn',
      message: `Server has invalid protocol version "${serverVersion}". This is a server configuration error.`,
    };
  }

  // Major version mismatch → incompatible
  if (agent.major !== server.major) {
    const direction = agent.major > server.major ? 'newer' : 'older';
    return {
      compatible: false,
      severity: 'error',
      message:
        `Protocol version mismatch: agent v${agentVersion} is ${direction} than server v${serverVersion}. ` +
        `Major version must match. Please ${direction === 'newer' ? 'upgrade the server' : 'upgrade the agent'}.`,
    };
  }

  // Agent minor > server minor → agent is too new for this server
  if (agent.minor > server.minor) {
    return {
      compatible: false,
      severity: 'error',
      message:
        `Agent protocol v${agentVersion} uses features not supported by server v${serverVersion}. ` +
        `Please upgrade the server or downgrade the agent.`,
    };
  }

  // Compatible — exact match or agent minor <= server minor
  if (agent.minor === server.minor && agent.patch === server.patch) {
    return {
      compatible: true,
      severity: 'ok',
      message: `Protocol versions match: v${agentVersion}.`,
    };
  }

  return {
    compatible: true,
    severity: 'ok',
    message: `Protocol versions compatible: agent v${agentVersion}, server v${serverVersion}.`,
  };
}
