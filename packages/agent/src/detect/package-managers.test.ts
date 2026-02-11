// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect, vi, beforeEach } from 'vitest';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

import {
  getBinaryVersion,
  detectNpm,
  detectPnpm,
  detectYarn,
  detectBrew,
  detectApt,
  detectPackageManagers,
  detectPackageManagerDetails,
} from './package-managers.js';

// ============================================================================
// Mock
// ============================================================================

vi.mock('node:child_process', () => ({
  spawnSync: vi.fn(),
}));

const mockSpawnSync = vi.mocked(spawnSync);

// ============================================================================
// getBinaryVersion
// ============================================================================

describe('getBinaryVersion', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns version string when binary outputs semver', () => {
    mockSpawnSync.mockReturnValueOnce({
      stdout: '10.2.0\n',
      stderr: '',
      status: 0,
      signal: null,
      pid: 1,
      output: [],
    } as any);
    expect(getBinaryVersion('npm')).toBe('10.2.0');
  });

  it('parses version from stderr when stdout is empty', () => {
    mockSpawnSync.mockReturnValueOnce({
      stdout: '',
      stderr: 'pnpm 9.1.0\n',
      status: 0,
      signal: null,
      pid: 1,
      output: [],
    } as any);
    expect(getBinaryVersion('pnpm')).toBe('9.1.0');
  });

  it('returns undefined when binary not found', () => {
    mockSpawnSync.mockImplementationOnce(() => {
      throw new Error('ENOENT');
    });
    expect(getBinaryVersion('nonexistent')).toBeUndefined();
  });

  it('returns undefined when output has no version pattern', () => {
    mockSpawnSync.mockReturnValueOnce({
      stdout: 'no version here',
      stderr: '',
      status: 0,
      signal: null,
      pid: 1,
      output: [],
    } as any);
    expect(getBinaryVersion('something')).toBeUndefined();
  });

  it('uses custom args when provided', () => {
    mockSpawnSync.mockReturnValueOnce({
      stdout: 'apt 2.4.12\n',
      stderr: '',
      status: 0,
      signal: null,
      pid: 1,
      output: [],
    } as any);
    getBinaryVersion('apt', ['--version']);
    expect(mockSpawnSync).toHaveBeenCalledWith('apt', ['--version'], expect.any(Object));
  });

  it('defaults to ["--version"] args', () => {
    mockSpawnSync.mockReturnValueOnce({
      stdout: '10.2.0\n',
      stderr: '',
      status: 0,
      signal: null,
      pid: 1,
      output: [],
    } as any);
    getBinaryVersion('npm');
    expect(mockSpawnSync).toHaveBeenCalledWith('npm', ['--version'], expect.any(Object));
  });
});

// ============================================================================
// Individual manager detectors
// ============================================================================

describe('detectNpm', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('returns npm version when available', () => {
    mockSpawnSync.mockReturnValueOnce({
      stdout: '10.2.0\n',
      stderr: '',
      status: 0,
      signal: null,
      pid: 1,
      output: [],
    } as any);
    expect(detectNpm()).toBe('10.2.0');
  });

  it('returns undefined when npm not found', () => {
    mockSpawnSync.mockImplementationOnce(() => {
      throw new Error('not found');
    });
    expect(detectNpm()).toBeUndefined();
  });
});

describe('detectPnpm', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('returns pnpm version when available', () => {
    mockSpawnSync.mockReturnValueOnce({
      stdout: '9.1.0\n',
      stderr: '',
      status: 0,
      signal: null,
      pid: 1,
      output: [],
    } as any);
    expect(detectPnpm()).toBe('9.1.0');
  });
});

describe('detectYarn', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('returns yarn version when available', () => {
    mockSpawnSync.mockReturnValueOnce({
      stdout: '1.22.19\n',
      stderr: '',
      status: 0,
      signal: null,
      pid: 1,
      output: [],
    } as any);
    expect(detectYarn()).toBe('1.22.19');
  });
});

describe('detectBrew', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('returns undefined on non-darwin', () => {
    if (os.platform() === 'darwin') return;
    expect(detectBrew()).toBeUndefined();
  });

  it('returns brew version on darwin', () => {
    if (os.platform() !== 'darwin') return;
    mockSpawnSync.mockReturnValueOnce({
      stdout: 'Homebrew 4.4.5\n',
      stderr: '',
      status: 0,
      signal: null,
      pid: 1,
      output: [],
    } as any);
    expect(detectBrew()).toBe('4.4.5');
  });
});

describe('detectApt', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('returns undefined on non-linux', () => {
    if (os.platform() === 'linux') return;
    expect(detectApt()).toBeUndefined();
  });
});

// ============================================================================
// detectPackageManagers
// ============================================================================

describe('detectPackageManagers', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('returns an object', () => {
    mockSpawnSync.mockReturnValue({
      stdout: '10.0.0\n',
      stderr: '',
      status: 0,
      signal: null,
      pid: 1,
      output: [],
    } as any);
    const result = detectPackageManagers();
    expect(typeof result).toBe('object');
  });

  it('only includes managers that are available', () => {
    mockSpawnSync.mockImplementation(() => {
      throw new Error('not found');
    });
    const result = detectPackageManagers();
    expect(Object.keys(result).length).toBe(0);
  });
});

// ============================================================================
// detectPackageManagerDetails
// ============================================================================

describe('detectPackageManagerDetails', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('returns label and detected list', () => {
    mockSpawnSync.mockReturnValue({
      stdout: '10.0.0\n',
      stderr: '',
      status: 0,
      signal: null,
      pid: 1,
      output: [],
    } as any);
    const result = detectPackageManagerDetails();
    expect(result).toHaveProperty('label');
    expect(result).toHaveProperty('detected');
    expect(Array.isArray(result.detected)).toBe(true);
  });

  it('label includes manager names and versions', () => {
    mockSpawnSync.mockReturnValue({
      stdout: '10.2.0\n',
      stderr: '',
      status: 0,
      signal: null,
      pid: 1,
      output: [],
    } as any);
    const result = detectPackageManagerDetails();
    if (result.detected.length > 0) {
      expect(result.label).toContain('10.2.0');
    }
  });

  it('returns "None detected" when no managers found', () => {
    mockSpawnSync.mockImplementation(() => {
      throw new Error('not found');
    });
    const result = detectPackageManagerDetails();
    expect(result.label).toBe('None detected');
    expect(result.detected).toHaveLength(0);
  });

  it('detected array contains correct manager names', () => {
    let callCount = 0;
    mockSpawnSync.mockImplementation(() => {
      callCount++;
      // Only npm succeeds (first call)
      if (callCount === 1) {
        return {
          stdout: '10.2.0\n',
          stderr: '',
          status: 0,
          signal: null,
          pid: 1,
          output: [],
        } as any;
      }
      throw new Error('not found');
    });
    const result = detectPackageManagerDetails();
    expect(result.detected).toContain('npm');
    expect(result.npm).toBe('10.2.0');
  });
});
