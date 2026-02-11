// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Runtime version detection module.
 *
 * Detects Node.js and Python runtime versions with detailed information
 * including semver parsing and minimum version validation.
 * Inspired by openclaw-modules/infra/runtime-guard.ts.
 *
 * @module detect/runtime
 */

import { spawnSync } from 'node:child_process';
import process from 'node:process';

import type { EnvironmentInfo } from '@aiinstaller/shared';

/** Parsed semver version. */
export interface Semver {
  major: number;
  minor: number;
  patch: number;
}

/** Detailed runtime information beyond the basic EnvironmentInfo['runtime'] fields. */
export interface RuntimeInfo {
  /** Node.js version string (e.g. "24.1.0"), or undefined if not detected */
  node?: string;
  /** Python version string (e.g. "3.12.0"), or undefined if not detected */
  python?: string;
  /** Node.js executable path */
  nodeExecPath: string;
  /** Whether Node.js version meets the minimum requirement (>= 22.0.0) */
  nodeSatisfies: boolean;
  /** Human-readable runtime label (e.g. "Node.js 24.1.0 (arm64)") */
  label: string;
}

const SEMVER_RE = /(\d+)\.(\d+)\.(\d+)/;

const MIN_NODE: Semver = { major: 22, minor: 0, patch: 0 };

/**
 * Parse a version string into a Semver object.
 *
 * @param version - Version string (e.g. "22.1.0" or "v22.1.0")
 * @returns Parsed semver, or null if the string is not a valid semver
 */
export function parseSemver(version: string | null | undefined): Semver | null {
  if (!version) return null;
  const match = version.match(SEMVER_RE);
  if (!match) return null;
  return {
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    patch: Number.parseInt(match[3], 10),
  };
}

/**
 * Check if a semver version is at least the given minimum.
 *
 * @param version - Version to check
 * @param minimum - Minimum required version
 * @returns true if version >= minimum
 */
export function isAtLeast(version: Semver | null, minimum: Semver): boolean {
  if (!version) return false;
  if (version.major !== minimum.major) return version.major > minimum.major;
  if (version.minor !== minimum.minor) return version.minor > minimum.minor;
  return version.patch >= minimum.patch;
}

/**
 * Detect the Node.js version from the current process.
 *
 * @returns Node.js version string (e.g. "24.1.0"), or undefined if unavailable
 */
export function detectNodeVersion(): string | undefined {
  return process.versions?.node || undefined;
}

/**
 * Detect the Python version by running python3 or python.
 *
 * @returns Python version string (e.g. "3.12.0"), or undefined if unavailable
 */
export function detectPythonVersion(): string | undefined {
  // Try python3 first
  try {
    const res = spawnSync('python3', ['--version'], { encoding: 'utf-8', timeout: 5000 });
    const output = (res.stdout || '').trim();
    const match = output.match(SEMVER_RE);
    if (match) return match[0];
  } catch {
    // python3 not available
  }

  // Fallback to python
  try {
    const res = spawnSync('python', ['--version'], { encoding: 'utf-8', timeout: 5000 });
    const output = (res.stdout || '').trim();
    const match = output.match(SEMVER_RE);
    if (match) return match[0];
  } catch {
    // python not available
  }

  return undefined;
}

/**
 * Detect basic runtime versions compatible with EnvironmentInfo['runtime'].
 *
 * @returns Runtime info with optional node and python version strings
 */
export function detectRuntimeVersions(): EnvironmentInfo['runtime'] {
  const runtime: EnvironmentInfo['runtime'] = {};

  const node = detectNodeVersion();
  if (node) runtime.node = node;

  const python = detectPythonVersion();
  if (python) runtime.python = python;

  return runtime;
}

/**
 * Check if the current Node.js version satisfies the minimum requirement (>= 22.0.0).
 *
 * @param version - Node.js version string to check, defaults to current process version
 * @returns true if version >= 22.0.0
 */
export function isNodeVersionSatisfied(version?: string | null): boolean {
  const v = version === undefined ? (detectNodeVersion() ?? null) : version;
  return isAtLeast(parseSemver(v), MIN_NODE);
}

/**
 * Detect detailed runtime information including exec path, version check, and label.
 *
 * @returns Detailed runtime info
 */
export function detectRuntimeDetails(): RuntimeInfo {
  const node = detectNodeVersion();
  const python = detectPythonVersion();
  const nodeExecPath = process.execPath || '';
  const nodeSatisfies = isAtLeast(parseSemver(node ?? null), MIN_NODE);

  let label = 'Unknown runtime';
  if (node) {
    label = `Node.js ${node}`;
  }

  return {
    node,
    python,
    nodeExecPath,
    nodeSatisfies,
    label,
  };
}
