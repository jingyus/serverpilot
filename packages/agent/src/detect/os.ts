// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Operating system detection module.
 *
 * Provides detailed OS type, version, and architecture detection.
 * Inspired by openclaw-modules/infra/os-summary.ts.
 *
 * @module detect/os
 */

import { spawnSync } from 'node:child_process';
import os from 'node:os';

import type { EnvironmentInfo } from '@aiinstaller/shared';

/** Detailed OS information beyond the basic EnvironmentInfo['os'] fields. */
export interface OSInfo {
  /** Normalized platform: darwin, linux, or win32 */
  platform: 'darwin' | 'linux' | 'win32';
  /** OS version string (e.g. "15.5" on macOS, "6.5.0-44-generic" on Linux) */
  version: string;
  /** CPU architecture (e.g. "arm64", "x64") */
  arch: string;
  /** Human-readable label (e.g. "macOS 15.5 (arm64)") */
  label: string;
  /** OS name (e.g. "macOS", "Ubuntu", "Windows") */
  name: string;
  /** Linux distribution name, if applicable */
  distro?: string;
  /** Linux distribution version, if applicable */
  distroVersion?: string;
}

/**
 * Safely trim a value, returning empty string for non-strings.
 */
function safeTrim(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Get the macOS product version using sw_vers.
 * Falls back to os.release() if sw_vers is unavailable.
 */
function getMacOSVersion(): string {
  try {
    const res = spawnSync('sw_vers', ['-productVersion'], { encoding: 'utf-8', timeout: 5000 });
    const out = safeTrim(res.stdout);
    if (out) return out;
  } catch {
    // fallback below
  }
  return os.release();
}

/**
 * Get Linux distribution info from /etc/os-release.
 * Returns name and version, or undefined values if unavailable.
 */
function getLinuxDistro(): { distro?: string; distroVersion?: string } {
  try {
    const res = spawnSync('cat', ['/etc/os-release'], { encoding: 'utf-8', timeout: 5000 });
    const content = safeTrim(res.stdout);
    if (!content) return {};

    const nameMatch = content.match(/^NAME="?([^"\n]+)"?/m);
    const versionMatch = content.match(/^VERSION_ID="?([^"\n]+)"?/m);

    return {
      distro: nameMatch ? nameMatch[1] : undefined,
      distroVersion: versionMatch ? versionMatch[1] : undefined,
    };
  } catch {
    return {};
  }
}

/**
 * Detect the operating system type and version.
 *
 * Returns the normalized platform (darwin/linux/win32), the OS version string,
 * and the CPU architecture.
 *
 * @returns Basic OS info compatible with EnvironmentInfo['os']
 */
export function detectOSType(): EnvironmentInfo['os'] {
  const platform = os.platform();
  const arch = os.arch();

  let version = os.release();
  if (platform === 'darwin') {
    version = getMacOSVersion();
  }

  const normalizedPlatform = (['darwin', 'linux', 'win32'] as const).includes(
    platform as 'darwin' | 'linux' | 'win32',
  )
    ? (platform as 'darwin' | 'linux' | 'win32')
    : 'linux';

  return { platform: normalizedPlatform, version, arch };
}

/**
 * Detect the CPU architecture.
 *
 * @returns Architecture string (e.g. "arm64", "x64")
 */
export function detectArch(): string {
  return os.arch();
}

/**
 * Build a human-readable OS name from the platform.
 */
function getOSName(platform: string, distro?: string): string {
  if (platform === 'darwin') return 'macOS';
  if (platform === 'win32') return 'Windows';
  if (distro) return distro;
  return 'Linux';
}

/**
 * Build a human-readable label for the OS.
 */
function buildOSLabel(name: string, version: string, arch: string): string {
  return `${name} ${version} (${arch})`;
}

/**
 * Detect detailed OS information including name, label, and Linux distro.
 *
 * @returns Detailed OS information
 */
export function detectOSDetails(): OSInfo {
  const { platform, version, arch } = detectOSType();

  let distro: string | undefined;
  let distroVersion: string | undefined;

  if (platform === 'linux') {
    const info = getLinuxDistro();
    distro = info.distro;
    distroVersion = info.distroVersion;
  }

  const name = getOSName(platform, distro);
  const label = buildOSLabel(name, version, arch);

  return {
    platform,
    version,
    arch,
    label,
    name,
    distro,
    distroVersion,
  };
}
