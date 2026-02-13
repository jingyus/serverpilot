// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Environment detection module for AI Installer agent.
 *
 * Detects the client's operating system, shell, runtime versions,
 * package managers, network reachability, and permissions.
 * Inspired by openclaw-modules/infra (os-summary, runtime-guard, binaries).
 *
 * @module detect
 */

import { spawnSync } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import os from 'node:os';
import process from 'node:process';
import type { EnvironmentInfo } from '@aiinstaller/shared';
import { detectOpenPorts } from './ports.js';
import { detectServices } from './services.js';

// ============================================================================
// OS Detection (inspired by openclaw-modules/infra/os-summary.ts)
// ============================================================================

/** Detect the operating system platform, version, and architecture. */
export function detectOS(): EnvironmentInfo['os'] {
  const platform = os.platform();
  const arch = os.arch();

  let version = os.release();
  if (platform === 'darwin') {
    try {
      const res = spawnSync('sw_vers', ['-productVersion'], { encoding: 'utf-8', timeout: 5000 });
      const out = typeof res.stdout === 'string' ? res.stdout.trim() : '';
      if (out) version = out;
    } catch {
      // fallback to os.release()
    }
  }

  const normalizedPlatform = (['darwin', 'linux', 'win32'] as const).includes(
    platform as 'darwin' | 'linux' | 'win32',
  )
    ? (platform as 'darwin' | 'linux' | 'win32')
    : 'linux';

  return { platform: normalizedPlatform, version, arch };
}

// ============================================================================
// Shell Detection
// ============================================================================

/** Detect the current shell type and version. */
export function detectShell(): EnvironmentInfo['shell'] {
  const shellPath = process.env.SHELL || '';
  const shellName = shellPath.split('/').pop() || '';

  let type: EnvironmentInfo['shell']['type'] = 'unknown';
  if (shellName === 'zsh') type = 'zsh';
  else if (shellName === 'bash') type = 'bash';
  else if (shellName === 'fish') type = 'fish';
  else if (shellName.includes('powershell') || shellName.includes('pwsh')) type = 'powershell';

  let version = '';
  if (type !== 'unknown') {
    try {
      const res = spawnSync(shellPath || type, ['--version'], {
        encoding: 'utf-8',
        timeout: 5000,
      });
      const output = (res.stdout || res.stderr || '').trim();
      const match = output.match(/(\d+\.\d+(\.\d+)?)/);
      if (match) version = match[1];
    } catch {
      // version remains empty
    }
  }

  return { type, version };
}

// ============================================================================
// Runtime Detection (inspired by openclaw-modules/infra/runtime-guard.ts)
// ============================================================================

/** Detect Node.js and Python runtime versions. */
export function detectRuntime(): EnvironmentInfo['runtime'] {
  const runtime: EnvironmentInfo['runtime'] = {};

  // Node.js version from process.versions
  if (process.versions?.node) {
    runtime.node = process.versions.node;
  }

  // Python version
  try {
    const res = spawnSync('python3', ['--version'], { encoding: 'utf-8', timeout: 5000 });
    const output = (res.stdout || '').trim();
    const match = output.match(/(\d+\.\d+\.\d+)/);
    if (match) {
      runtime.python = match[1];
    }
  } catch {
    // python3 not found, try python
    try {
      const res = spawnSync('python', ['--version'], { encoding: 'utf-8', timeout: 5000 });
      const output = (res.stdout || '').trim();
      const match = output.match(/(\d+\.\d+\.\d+)/);
      if (match) {
        runtime.python = match[1];
      }
    } catch {
      // python not available
    }
  }

  return runtime;
}

// ============================================================================
// Package Manager Detection (inspired by openclaw-modules/infra/binaries.ts)
// ============================================================================

/** Get the version of a binary tool, or undefined if not available. */
function getBinaryVersion(command: string, args: string[] = ['--version']): string | undefined {
  try {
    const res = spawnSync(command, args, { encoding: 'utf-8', timeout: 5000 });
    const output = (res.stdout || res.stderr || '').trim();
    const match = output.match(/(\d+\.\d+\.\d+)/);
    return match ? match[1] : undefined;
  } catch {
    return undefined;
  }
}

/** Detect installed package managers and their versions. */
export function detectPackageManagers(): EnvironmentInfo['packageManagers'] {
  const managers: EnvironmentInfo['packageManagers'] = {};

  const npm = getBinaryVersion('npm');
  if (npm) managers.npm = npm;

  const pnpm = getBinaryVersion('pnpm');
  if (pnpm) managers.pnpm = pnpm;

  const yarn = getBinaryVersion('yarn');
  if (yarn) managers.yarn = yarn;

  if (os.platform() === 'darwin') {
    const brew = getBinaryVersion('brew');
    if (brew) managers.brew = brew;
  }

  if (os.platform() === 'linux') {
    const apt = getBinaryVersion('apt', ['--version']);
    if (apt) managers.apt = apt;
  }

  return managers;
}

// ============================================================================
// Network Detection
// ============================================================================

/** Check if a host is reachable by attempting a DNS lookup or HTTP HEAD request. */
function canAccessHost(host: string): boolean {
  try {
    // Use curl with a short timeout to check connectivity
    const res = spawnSync('curl', ['-sS', '--max-time', '5', '--head', `https://${host}`], {
      encoding: 'utf-8',
      timeout: 10000,
    });
    return res.status === 0;
  } catch {
    return false;
  }
}

/** Detect network reachability to npm registry and GitHub. */
export function detectNetwork(): EnvironmentInfo['network'] {
  return {
    canAccessNpm: canAccessHost('registry.npmjs.org'),
    canAccessGithub: canAccessHost('github.com'),
  };
}

// ============================================================================
// Permissions Detection
// ============================================================================

/** Detect system permissions: sudo availability and writable paths. */
export function detectPermissions(): EnvironmentInfo['permissions'] {
  let hasSudo = false;
  try {
    const res = spawnSync('sudo', ['-n', 'true'], { encoding: 'utf-8', timeout: 5000 });
    hasSudo = res.status === 0;
  } catch {
    // sudo not available
  }

  const pathsToCheck = [
    os.homedir(),
    os.tmpdir(),
    '/usr/local/bin',
    '/usr/local/lib',
  ];

  const canWriteTo: string[] = [];
  for (const p of pathsToCheck) {
    try {
      accessSync(p, constants.W_OK);
      canWriteTo.push(p);
    } catch {
      // not writable
    }
  }

  return { hasSudo, canWriteTo };
}

// ============================================================================
// Main Detection Function
// ============================================================================

/**
 * Detect the full environment information for the current system.
 *
 * Collects OS, shell, runtime, package managers, network, and permissions
 * information into an EnvironmentInfo object compatible with the shared protocol.
 *
 * @returns Complete environment information
 */
export function detectEnvironment(): EnvironmentInfo {
  const services = detectServices();
  const openPorts = detectOpenPorts();
  return {
    os: detectOS(),
    shell: detectShell(),
    runtime: detectRuntime(),
    packageManagers: detectPackageManagers(),
    network: detectNetwork(),
    permissions: detectPermissions(),
    ...(services.length > 0 ? { services } : {}),
    ...(openPorts.length > 0 ? { openPorts } : {}),
  };
}
