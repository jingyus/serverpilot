/**
 * OpenClaw environment detection module (server-side).
 *
 * Analyzes the EnvironmentInfo reported by the agent to determine
 * whether the target machine is ready for OpenClaw installation.
 * Each check function returns a result object with pass/fail status
 * and a human-readable message.
 *
 * @module installers/openclaw/detect
 */

import type { EnvironmentInfo } from '@aiinstaller/shared';

// ============================================================================
// Constants
// ============================================================================

/** Minimum Node.js major version required by OpenClaw */
export const MIN_NODE_MAJOR = 22;

/** Minimum Node.js version as a display string */
export const MIN_NODE_VERSION = '22.0.0';

// ============================================================================
// Types
// ============================================================================

/** Result of a single environment check. */
export interface CheckResult {
  /** Whether the check passed */
  passed: boolean;
  /** Human-readable message describing the result */
  message: string;
}

/** Aggregated result of all OpenClaw environment checks. */
export interface DetectResult {
  /** Whether all checks passed */
  ready: boolean;
  /** Individual check results keyed by check name */
  checks: {
    nodeVersion: CheckResult;
    pnpm: CheckResult;
    network: CheckResult;
    permissions: CheckResult;
  };
  /** Summary message */
  summary: string;
}

// ============================================================================
// Semver helper
// ============================================================================

const SEMVER_RE = /^v?(\d+)\.(\d+)\.(\d+)/;

/**
 * Parse a version string and return the major version number.
 *
 * @param version - Version string (e.g. "22.1.0" or "v22.1.0")
 * @returns Major version number, or null if unparseable
 */
export function parseMajor(version: string | undefined | null): number | null {
  if (!version) return null;
  const match = version.match(SEMVER_RE);
  if (!match) return null;
  return Number.parseInt(match[1], 10);
}

// ============================================================================
// Individual checks
// ============================================================================

/**
 * Check if Node.js version meets the minimum requirement (>= 22.0.0).
 *
 * @param env - Environment info reported by the agent
 * @returns Check result with pass/fail and message
 */
export function checkNodeVersion(env: EnvironmentInfo): CheckResult {
  const version = env.runtime.node;

  if (!version) {
    return {
      passed: false,
      message: 'Node.js is not installed. Required: >= ' + MIN_NODE_VERSION,
    };
  }

  const major = parseMajor(version);
  if (major === null) {
    return {
      passed: false,
      message: `Unable to parse Node.js version "${version}". Required: >= ${MIN_NODE_VERSION}`,
    };
  }

  if (major < MIN_NODE_MAJOR) {
    return {
      passed: false,
      message: `Node.js ${version} is too old. Required: >= ${MIN_NODE_VERSION}, found: ${version}`,
    };
  }

  return {
    passed: true,
    message: `Node.js ${version} meets the requirement (>= ${MIN_NODE_VERSION})`,
  };
}

/**
 * Check if pnpm is installed.
 *
 * @param env - Environment info reported by the agent
 * @returns Check result with pass/fail and message
 */
export function checkPnpm(env: EnvironmentInfo): CheckResult {
  const version = env.packageManagers.pnpm;

  if (!version) {
    return {
      passed: false,
      message: 'pnpm is not installed. It will need to be installed before OpenClaw.',
    };
  }

  return {
    passed: true,
    message: `pnpm ${version} is installed`,
  };
}

/**
 * Check if the network can reach the npm registry.
 *
 * @param env - Environment info reported by the agent
 * @returns Check result with pass/fail and message
 */
export function checkNetwork(env: EnvironmentInfo): CheckResult {
  if (!env.network.canAccessNpm) {
    return {
      passed: false,
      message: 'Cannot reach the npm registry. Check your network or proxy settings.',
    };
  }

  return {
    passed: true,
    message: 'npm registry is reachable',
  };
}

/**
 * Check if the user has sufficient permissions for global installs.
 *
 * We consider permissions adequate if the user either has sudo access
 * or can write to at least one directory (indicating a non-root writable prefix).
 *
 * @param env - Environment info reported by the agent
 * @returns Check result with pass/fail and message
 */
export function checkPermissions(env: EnvironmentInfo): CheckResult {
  const { hasSudo, canWriteTo } = env.permissions;

  if (!hasSudo && canWriteTo.length === 0) {
    return {
      passed: false,
      message: 'Insufficient permissions. No sudo access and no writable install directories found.',
    };
  }

  if (hasSudo) {
    return {
      passed: true,
      message: 'sudo access is available for global installs',
    };
  }

  return {
    passed: true,
    message: `User can write to: ${canWriteTo.join(', ')}`,
  };
}

// ============================================================================
// Aggregated detection
// ============================================================================

/**
 * Run all OpenClaw environment checks against the reported environment.
 *
 * @param env - Environment info reported by the agent
 * @returns Aggregated detection result with individual check details
 */
export function detectOpenClawReadiness(env: EnvironmentInfo): DetectResult {
  const checks = {
    nodeVersion: checkNodeVersion(env),
    pnpm: checkPnpm(env),
    network: checkNetwork(env),
    permissions: checkPermissions(env),
  };

  const all = Object.values(checks);
  const passed = all.filter((c) => c.passed).length;
  const failed = all.filter((c) => !c.passed).length;
  const ready = failed === 0;

  let summary: string;
  if (ready) {
    summary = `Environment is ready for OpenClaw installation (${passed}/${all.length} checks passed)`;
  } else {
    summary = `Environment is not ready: ${failed} check(s) failed out of ${all.length}`;
  }

  return { ready, checks, summary };
}
