// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/* eslint-disable @typescript-eslint/no-explicit-any -- mock type coercion in tests */
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { detectOSType, detectArch, detectOSDetails } from './os.js';

// ============================================================================
// Mock
// ============================================================================

vi.mock('node:child_process', () => ({
  spawnSync: vi.fn(),
}));

const mockSpawnSync = vi.mocked(spawnSync);

// ============================================================================
// detectOSType
// ============================================================================

describe('detectOSType', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns platform, version, and arch', () => {
    const result = detectOSType();
    expect(result).toHaveProperty('platform');
    expect(result).toHaveProperty('version');
    expect(result).toHaveProperty('arch');
  });

  it('normalizes platform to darwin, linux, or win32', () => {
    const result = detectOSType();
    expect(['darwin', 'linux', 'win32']).toContain(result.platform);
  });

  it('returns current architecture', () => {
    const result = detectOSType();
    expect(result.arch).toBe(os.arch());
  });

  it('uses sw_vers on darwin', () => {
    if (os.platform() !== 'darwin') return;
    mockSpawnSync.mockReturnValueOnce({
      stdout: '15.5\n',
      stderr: '',
      status: 0,
      signal: null,
      pid: 1,
      output: [],
    } as any);
    const result = detectOSType();
    expect(result.version).toBeTruthy();
  });

  it('falls back to os.release when sw_vers fails', () => {
    if (os.platform() !== 'darwin') return;
    mockSpawnSync.mockImplementationOnce(() => {
      throw new Error('sw_vers not found');
    });
    const result = detectOSType();
    expect(result.version).toBe(os.release());
  });

  it('falls back to os.release when sw_vers returns empty', () => {
    if (os.platform() !== 'darwin') return;
    mockSpawnSync.mockReturnValueOnce({
      stdout: '',
      stderr: '',
      status: 1,
      signal: null,
      pid: 1,
      output: [],
    } as any);
    const result = detectOSType();
    expect(result.version).toBe(os.release());
  });
});

// ============================================================================
// detectArch
// ============================================================================

describe('detectArch', () => {
  it('returns current CPU architecture', () => {
    const result = detectArch();
    expect(result).toBe(os.arch());
  });

  it('is a non-empty string', () => {
    const result = detectArch();
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// detectOSDetails
// ============================================================================

describe('detectOSDetails', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns all OSInfo fields', () => {
    const result = detectOSDetails();
    expect(result).toHaveProperty('platform');
    expect(result).toHaveProperty('version');
    expect(result).toHaveProperty('arch');
    expect(result).toHaveProperty('label');
    expect(result).toHaveProperty('name');
  });

  it('generates a human-readable label', () => {
    const result = detectOSDetails();
    expect(result.label).toContain(result.arch);
    expect(result.label).toContain(result.version);
  });

  it('sets name to macOS on darwin', () => {
    if (os.platform() !== 'darwin') return;
    mockSpawnSync.mockReturnValue({
      stdout: '15.5\n',
      stderr: '',
      status: 0,
      signal: null,
      pid: 1,
      output: [],
    } as any);
    const result = detectOSDetails();
    expect(result.name).toBe('macOS');
  });

  it('reads linux distro from /etc/os-release', () => {
    if (os.platform() !== 'linux') return;
    mockSpawnSync.mockImplementation((cmd: any, args: any) => {
      if (cmd === 'cat' && args?.[0] === '/etc/os-release') {
        return {
          stdout: 'NAME="Ubuntu"\nVERSION_ID="22.04"\n',
          stderr: '',
          status: 0,
          signal: null,
          pid: 1,
          output: [],
        } as any;
      }
      return { stdout: '', stderr: '', status: 1, signal: null, pid: 1, output: [] } as any;
    });
    const result = detectOSDetails();
    expect(result.distro).toBe('Ubuntu');
    expect(result.distroVersion).toBe('22.04');
  });

  it('does not set distro on non-linux', () => {
    if (os.platform() === 'linux') return;
    const result = detectOSDetails();
    expect(result.distro).toBeUndefined();
    expect(result.distroVersion).toBeUndefined();
  });
});
