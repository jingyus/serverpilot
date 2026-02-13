// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Package manager detection module.
 *
 * Detects installed package managers (npm, pnpm, yarn, brew, apt)
 * and their versions. Inspired by openclaw-modules/infra/binaries.ts.
 *
 * @module detect/package-managers
 */

import { spawnSync } from 'node:child_process';
import os from 'node:os';
import type { EnvironmentInfo } from '@aiinstaller/shared';

/** Detailed package manager information beyond the basic EnvironmentInfo['packageManagers'] fields. */
export interface PackageManagerInfo {
  /** npm version string, or undefined if not installed */
  npm?: string;
  /** pnpm version string, or undefined if not installed */
  pnpm?: string;
  /** yarn version string, or undefined if not installed */
  yarn?: string;
  /** brew version string, or undefined if not installed (macOS only) */
  brew?: string;
  /** apt version string, or undefined if not installed (Linux only) */
  apt?: string;
  /** Human-readable label listing all detected managers */
  label: string;
  /** List of detected package manager names */
  detected: string[];
}

const SEMVER_RE = /(\d+\.\d+\.\d+)/;

/**
 * Get the version of a binary tool by running it with a version flag.
 *
 * Uses spawnSync with a 5-second timeout. Returns undefined if the
 * binary is not available or the version string cannot be parsed.
 *
 * @param command - Binary command name (e.g. "npm", "pnpm")
 * @param args - Arguments to pass (default: ["--version"])
 * @returns Version string (e.g. "10.2.0"), or undefined if unavailable
 */
export function getBinaryVersion(command: string, args: string[] = ['--version']): string | undefined {
  try {
    const res = spawnSync(command, args, { encoding: 'utf-8', timeout: 5000 });
    const output = (res.stdout || res.stderr || '').trim();
    const match = output.match(SEMVER_RE);
    return match ? match[1] : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Detect the npm version.
 *
 * @returns npm version string, or undefined if not installed
 */
export function detectNpm(): string | undefined {
  return getBinaryVersion('npm');
}

/**
 * Detect the pnpm version.
 *
 * @returns pnpm version string, or undefined if not installed
 */
export function detectPnpm(): string | undefined {
  return getBinaryVersion('pnpm');
}

/**
 * Detect the yarn version.
 *
 * @returns yarn version string, or undefined if not installed
 */
export function detectYarn(): string | undefined {
  return getBinaryVersion('yarn');
}

/**
 * Detect the Homebrew version (macOS only).
 *
 * Only checks for brew on macOS (darwin). Returns undefined on other platforms.
 *
 * @returns brew version string, or undefined if not installed or not macOS
 */
export function detectBrew(): string | undefined {
  if (os.platform() !== 'darwin') return undefined;
  return getBinaryVersion('brew');
}

/**
 * Detect the apt version (Linux only).
 *
 * Only checks for apt on Linux. Returns undefined on other platforms.
 *
 * @returns apt version string, or undefined if not installed or not Linux
 */
export function detectApt(): string | undefined {
  if (os.platform() !== 'linux') return undefined;
  return getBinaryVersion('apt', ['--version']);
}

/**
 * Detect installed package managers compatible with EnvironmentInfo['packageManagers'].
 *
 * Checks for npm, pnpm, yarn, brew (macOS), and apt (Linux).
 * Only includes entries for managers that are actually installed.
 *
 * @returns Package managers object with optional version strings
 */
export function detectPackageManagers(): EnvironmentInfo['packageManagers'] {
  const managers: EnvironmentInfo['packageManagers'] = {};

  const npm = detectNpm();
  if (npm) managers.npm = npm;

  const pnpm = detectPnpm();
  if (pnpm) managers.pnpm = pnpm;

  const yarn = detectYarn();
  if (yarn) managers.yarn = yarn;

  const brew = detectBrew();
  if (brew) managers.brew = brew;

  const apt = detectApt();
  if (apt) managers.apt = apt;

  return managers;
}

/**
 * Build a human-readable label from detected package managers.
 *
 * @param managers - Package managers object from detectPackageManagers
 * @returns Label string (e.g. "npm 10.2.0, pnpm 9.1.0") or "None detected"
 */
function buildLabel(managers: EnvironmentInfo['packageManagers']): string {
  const parts: string[] = [];
  if (managers.npm) parts.push(`npm ${managers.npm}`);
  if (managers.pnpm) parts.push(`pnpm ${managers.pnpm}`);
  if (managers.yarn) parts.push(`yarn ${managers.yarn}`);
  if (managers.brew) parts.push(`brew ${managers.brew}`);
  if (managers.apt) parts.push(`apt ${managers.apt}`);
  return parts.length > 0 ? parts.join(', ') : 'None detected';
}

/**
 * Detect detailed package manager information including label and detected list.
 *
 * @returns Detailed package manager info
 */
export function detectPackageManagerDetails(): PackageManagerInfo {
  const managers = detectPackageManagers();
  const detected: string[] = [];

  if (managers.npm) detected.push('npm');
  if (managers.pnpm) detected.push('pnpm');
  if (managers.yarn) detected.push('yarn');
  if (managers.brew) detected.push('brew');
  if (managers.apt) detected.push('apt');

  return {
    ...managers,
    label: buildLabel(managers),
    detected,
  };
}
