import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { accessSync, constants } from 'node:fs';

import {
  detectOS,
  detectShell,
  detectRuntime,
  detectPackageManagers,
  detectNetwork,
  detectPermissions,
  detectEnvironment,
} from './index.js';

// ============================================================================
// Mock child_process and fs
// ============================================================================

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
  spawnSync: vi.fn(),
}));

vi.mock('node:fs', () => ({
  accessSync: vi.fn(),
  constants: { W_OK: 2 },
}));

const mockSpawnSync = vi.mocked(spawnSync);
const mockAccessSync = vi.mocked(accessSync);

// ============================================================================
// detectOS
// ============================================================================

describe('detectOS', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns platform, version, and arch', () => {
    const result = detectOS();
    expect(result).toHaveProperty('platform');
    expect(result).toHaveProperty('version');
    expect(result).toHaveProperty('arch');
  });

  it('normalizes known platforms', () => {
    const result = detectOS();
    expect(['darwin', 'linux', 'win32']).toContain(result.platform);
  });

  it('returns architecture from os.arch()', () => {
    const result = detectOS();
    expect(result.arch).toBe(os.arch());
  });

  it('uses sw_vers on darwin for version', () => {
    if (os.platform() !== 'darwin') return;
    // On macOS, spawnSync is called with sw_vers
    mockSpawnSync.mockReturnValueOnce({
      stdout: '15.5\n',
      stderr: '',
      status: 0,
      signal: null,
      pid: 1,
      output: ['', '15.5\n', ''],
    } as any);
    const result = detectOS();
    expect(result.version).toBeTruthy();
  });

  it('falls back to os.release() when sw_vers fails', () => {
    if (os.platform() !== 'darwin') return;
    mockSpawnSync.mockImplementationOnce(() => {
      throw new Error('sw_vers not found');
    });
    const result = detectOS();
    expect(result.version).toBeTruthy();
  });
});

// ============================================================================
// detectShell
// ============================================================================

describe('detectShell', () => {
  const originalSHELL = process.env.SHELL;

  afterEach(() => {
    if (originalSHELL !== undefined) {
      process.env.SHELL = originalSHELL;
    } else {
      delete process.env.SHELL;
    }
  });

  it('returns type and version', () => {
    const result = detectShell();
    expect(result).toHaveProperty('type');
    expect(result).toHaveProperty('version');
  });

  it('detects zsh from SHELL env', () => {
    process.env.SHELL = '/bin/zsh';
    mockSpawnSync.mockReturnValueOnce({
      stdout: 'zsh 5.9 (x86_64-apple-darwin24.0)\n',
      stderr: '',
      status: 0,
      signal: null,
      pid: 1,
      output: [],
    } as any);
    const result = detectShell();
    expect(result.type).toBe('zsh');
  });

  it('detects bash from SHELL env', () => {
    process.env.SHELL = '/bin/bash';
    mockSpawnSync.mockReturnValueOnce({
      stdout: 'GNU bash, version 5.2.37\n',
      stderr: '',
      status: 0,
      signal: null,
      pid: 1,
      output: [],
    } as any);
    const result = detectShell();
    expect(result.type).toBe('bash');
  });

  it('detects fish from SHELL env', () => {
    process.env.SHELL = '/usr/bin/fish';
    mockSpawnSync.mockReturnValueOnce({
      stdout: 'fish, version 3.7.0\n',
      stderr: '',
      status: 0,
      signal: null,
      pid: 1,
      output: [],
    } as any);
    const result = detectShell();
    expect(result.type).toBe('fish');
  });

  it('detects powershell from SHELL env', () => {
    process.env.SHELL = '/usr/local/bin/pwsh';
    mockSpawnSync.mockReturnValueOnce({
      stdout: 'PowerShell 7.4.1\n',
      stderr: '',
      status: 0,
      signal: null,
      pid: 1,
      output: [],
    } as any);
    const result = detectShell();
    expect(result.type).toBe('powershell');
  });

  it('returns unknown for empty SHELL', () => {
    process.env.SHELL = '';
    const result = detectShell();
    expect(result.type).toBe('unknown');
  });

  it('parses version from --version output', () => {
    process.env.SHELL = '/bin/zsh';
    mockSpawnSync.mockReturnValueOnce({
      stdout: 'zsh 5.9 (x86_64)\n',
      stderr: '',
      status: 0,
      signal: null,
      pid: 1,
      output: [],
    } as any);
    const result = detectShell();
    expect(result.version).toMatch(/^\d+\.\d+/);
  });

  it('returns empty version when --version fails', () => {
    process.env.SHELL = '/bin/zsh';
    mockSpawnSync.mockImplementationOnce(() => {
      throw new Error('spawn failed');
    });
    const result = detectShell();
    expect(result.version).toBe('');
  });

  it('returns empty version when output has no version number', () => {
    process.env.SHELL = '/bin/bash';
    mockSpawnSync.mockReturnValueOnce({
      stdout: 'some output without version',
      stderr: '',
      status: 0,
      signal: null,
      pid: 1,
      output: [],
    } as any);
    const result = detectShell();
    expect(result.version).toBe('');
  });
});

// ============================================================================
// detectRuntime
// ============================================================================

describe('detectRuntime', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns object with optional node and python', () => {
    const result = detectRuntime();
    expect(result).toHaveProperty('node');
    expect(typeof result).toBe('object');
  });

  it('includes Node.js version from process.versions', () => {
    const result = detectRuntime();
    if (process.versions?.node) {
      expect(result.node).toBe(process.versions.node);
    }
  });

  it('detects python3 version', () => {
    mockSpawnSync.mockReturnValueOnce({
      stdout: 'Python 3.12.0\n',
      stderr: '',
      status: 0,
      signal: null,
      pid: 1,
      output: [],
    } as any);
    const result = detectRuntime();
    expect(result.python).toBe('3.12.0');
  });

  it('falls back to python when python3 fails', () => {
    mockSpawnSync
      .mockImplementationOnce(() => {
        throw new Error('python3 not found');
      })
      .mockReturnValueOnce({
        stdout: 'Python 3.11.5\n',
        stderr: '',
        status: 0,
        signal: null,
        pid: 1,
        output: [],
      } as any);
    const result = detectRuntime();
    expect(result.python).toBe('3.11.5');
  });

  it('returns undefined python when both python3 and python fail', () => {
    mockSpawnSync
      .mockImplementationOnce(() => {
        throw new Error('python3 not found');
      })
      .mockImplementationOnce(() => {
        throw new Error('python not found');
      });
    const result = detectRuntime();
    expect(result.python).toBeUndefined();
  });

  it('returns undefined python when output has no version pattern', () => {
    mockSpawnSync.mockReturnValueOnce({
      stdout: 'no version here',
      stderr: '',
      status: 0,
      signal: null,
      pid: 1,
      output: [],
    } as any);
    const result = detectRuntime();
    expect(result.python).toBeUndefined();
  });
});

// ============================================================================
// detectPackageManagers
// ============================================================================

describe('detectPackageManagers', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns an object with optional package manager versions', () => {
    mockSpawnSync.mockReturnValue({
      stdout: '10.2.0\n',
      stderr: '',
      status: 0,
      signal: null,
      pid: 1,
      output: [],
    } as any);
    const result = detectPackageManagers();
    expect(typeof result).toBe('object');
  });

  it('detects npm version', () => {
    mockSpawnSync.mockReturnValue({
      stdout: '10.2.0\n',
      stderr: '',
      status: 0,
      signal: null,
      pid: 1,
      output: [],
    } as any);
    const result = detectPackageManagers();
    expect(result.npm).toBe('10.2.0');
  });

  it('detects pnpm version', () => {
    // npm call then pnpm call
    mockSpawnSync
      .mockReturnValueOnce({ stdout: '10.2.0\n', stderr: '', status: 0, signal: null, pid: 1, output: [] } as any)
      .mockReturnValueOnce({ stdout: '9.1.0\n', stderr: '', status: 0, signal: null, pid: 1, output: [] } as any)
      .mockReturnValue({ stdout: '', stderr: '', status: 1, signal: null, pid: 1, output: [] } as any);
    const result = detectPackageManagers();
    expect(result.pnpm).toBe('9.1.0');
  });

  it('returns undefined for unavailable managers', () => {
    mockSpawnSync.mockImplementation(() => {
      throw new Error('not found');
    });
    const result = detectPackageManagers();
    expect(result.npm).toBeUndefined();
    expect(result.pnpm).toBeUndefined();
    expect(result.yarn).toBeUndefined();
  });

  it('only checks brew on darwin', () => {
    mockSpawnSync.mockReturnValue({
      stdout: '4.2.0\n',
      stderr: '',
      status: 0,
      signal: null,
      pid: 1,
      output: [],
    } as any);
    const result = detectPackageManagers();
    if (os.platform() === 'darwin') {
      expect(result.brew).toBeDefined();
    } else {
      expect(result.brew).toBeUndefined();
    }
  });

  it('only checks apt on linux', () => {
    mockSpawnSync.mockReturnValue({
      stdout: '2.4.12\n',
      stderr: '',
      status: 0,
      signal: null,
      pid: 1,
      output: [],
    } as any);
    const result = detectPackageManagers();
    if (os.platform() === 'linux') {
      expect(result.apt).toBeDefined();
    } else {
      expect(result.apt).toBeUndefined();
    }
  });
});

// ============================================================================
// detectNetwork
// ============================================================================

describe('detectNetwork', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns object with canAccessNpm and canAccessGithub', () => {
    mockSpawnSync.mockReturnValue({
      stdout: '',
      stderr: '',
      status: 0,
      signal: null,
      pid: 1,
      output: [],
    } as any);
    const result = detectNetwork();
    expect(result).toHaveProperty('canAccessNpm');
    expect(result).toHaveProperty('canAccessGithub');
    expect(typeof result.canAccessNpm).toBe('boolean');
    expect(typeof result.canAccessGithub).toBe('boolean');
  });

  it('returns true when curl succeeds', () => {
    mockSpawnSync.mockReturnValue({
      stdout: 'HTTP/2 200',
      stderr: '',
      status: 0,
      signal: null,
      pid: 1,
      output: [],
    } as any);
    const result = detectNetwork();
    expect(result.canAccessNpm).toBe(true);
    expect(result.canAccessGithub).toBe(true);
  });

  it('returns false when curl fails', () => {
    mockSpawnSync.mockReturnValue({
      stdout: '',
      stderr: 'connection refused',
      status: 7,
      signal: null,
      pid: 1,
      output: [],
    } as any);
    const result = detectNetwork();
    expect(result.canAccessNpm).toBe(false);
    expect(result.canAccessGithub).toBe(false);
  });

  it('returns false when curl throws', () => {
    mockSpawnSync.mockImplementation(() => {
      throw new Error('curl not found');
    });
    const result = detectNetwork();
    expect(result.canAccessNpm).toBe(false);
    expect(result.canAccessGithub).toBe(false);
  });
});

// ============================================================================
// detectPermissions
// ============================================================================

describe('detectPermissions', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns hasSudo and canWriteTo', () => {
    mockSpawnSync.mockReturnValue({
      stdout: '',
      stderr: '',
      status: 1,
      signal: null,
      pid: 1,
      output: [],
    } as any);
    const result = detectPermissions();
    expect(result).toHaveProperty('hasSudo');
    expect(result).toHaveProperty('canWriteTo');
    expect(typeof result.hasSudo).toBe('boolean');
    expect(Array.isArray(result.canWriteTo)).toBe(true);
  });

  it('detects sudo availability when sudo -n true succeeds', () => {
    mockSpawnSync.mockReturnValueOnce({
      stdout: '',
      stderr: '',
      status: 0,
      signal: null,
      pid: 1,
      output: [],
    } as any);
    const result = detectPermissions();
    expect(result.hasSudo).toBe(true);
  });

  it('detects no sudo when sudo -n true fails', () => {
    mockSpawnSync.mockReturnValueOnce({
      stdout: '',
      stderr: 'a password is required',
      status: 1,
      signal: null,
      pid: 1,
      output: [],
    } as any);
    const result = detectPermissions();
    expect(result.hasSudo).toBe(false);
  });

  it('detects no sudo when sudo throws', () => {
    mockSpawnSync.mockImplementationOnce(() => {
      throw new Error('sudo not found');
    });
    const result = detectPermissions();
    expect(result.hasSudo).toBe(false);
  });

  it('includes writable paths', () => {
    mockSpawnSync.mockReturnValueOnce({
      stdout: '',
      stderr: '',
      status: 1,
      signal: null,
      pid: 1,
      output: [],
    } as any);
    mockAccessSync.mockImplementation(() => {
      // all paths writable
    });
    const result = detectPermissions();
    expect(result.canWriteTo.length).toBeGreaterThan(0);
    expect(result.canWriteTo).toContain(os.homedir());
  });

  it('excludes non-writable paths', () => {
    mockSpawnSync.mockReturnValueOnce({
      stdout: '',
      stderr: '',
      status: 1,
      signal: null,
      pid: 1,
      output: [],
    } as any);
    mockAccessSync.mockImplementation(() => {
      throw new Error('EACCES');
    });
    const result = detectPermissions();
    expect(result.canWriteTo).toHaveLength(0);
  });
});

// ============================================================================
// detectEnvironment
// ============================================================================

describe('detectEnvironment', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Default mocks so detectEnvironment doesn't fail
    mockSpawnSync.mockReturnValue({
      stdout: '',
      stderr: '',
      status: 0,
      signal: null,
      pid: 1,
      output: [],
    } as any);
  });

  it('returns complete EnvironmentInfo structure', () => {
    const result = detectEnvironment();
    expect(result).toHaveProperty('os');
    expect(result).toHaveProperty('shell');
    expect(result).toHaveProperty('runtime');
    expect(result).toHaveProperty('packageManagers');
    expect(result).toHaveProperty('network');
    expect(result).toHaveProperty('permissions');
  });

  it('os has required fields', () => {
    const result = detectEnvironment();
    expect(result.os).toHaveProperty('platform');
    expect(result.os).toHaveProperty('version');
    expect(result.os).toHaveProperty('arch');
  });

  it('shell has required fields', () => {
    const result = detectEnvironment();
    expect(result.shell).toHaveProperty('type');
    expect(result.shell).toHaveProperty('version');
  });

  it('network has required booleans', () => {
    const result = detectEnvironment();
    expect(typeof result.network.canAccessNpm).toBe('boolean');
    expect(typeof result.network.canAccessGithub).toBe('boolean');
  });

  it('permissions has required fields', () => {
    const result = detectEnvironment();
    expect(typeof result.permissions.hasSudo).toBe('boolean');
    expect(Array.isArray(result.permissions.canWriteTo)).toBe(true);
  });
});
