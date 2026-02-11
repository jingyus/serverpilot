// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';

import {
  detectProxy,
  canAccessHost,
  detectNpmAccess,
  detectGithubAccess,
  detectInternetConnection,
  detectNetworkStatus,
  detectNetworkDetails,
} from './network.js';
import type { ProxySettings, NetworkInfo } from './network.js';

// ============================================================================
// Mock
// ============================================================================

vi.mock('node:child_process', () => ({
  spawnSync: vi.fn(),
}));

const mockSpawnSync = vi.mocked(spawnSync);

// ============================================================================
// detectProxy
// ============================================================================

describe('detectProxy', () => {
  const envBackup: Record<string, string | undefined> = {};
  const proxyVars = ['HTTP_PROXY', 'http_proxy', 'HTTPS_PROXY', 'https_proxy', 'NO_PROXY', 'no_proxy'];

  beforeEach(() => {
    for (const v of proxyVars) {
      envBackup[v] = process.env[v];
      delete process.env[v];
    }
  });

  afterEach(() => {
    for (const v of proxyVars) {
      if (envBackup[v] !== undefined) {
        process.env[v] = envBackup[v];
      } else {
        delete process.env[v];
      }
    }
  });

  it('returns hasProxy: false when no proxy vars set', () => {
    const result = detectProxy();
    expect(result.hasProxy).toBe(false);
    expect(result.httpProxy).toBeUndefined();
    expect(result.httpsProxy).toBeUndefined();
    expect(result.noProxy).toBeUndefined();
  });

  it('detects HTTP_PROXY', () => {
    process.env.HTTP_PROXY = 'http://proxy:8080';
    const result = detectProxy();
    expect(result.hasProxy).toBe(true);
    expect(result.httpProxy).toBe('http://proxy:8080');
  });

  it('detects http_proxy (lowercase)', () => {
    process.env.http_proxy = 'http://proxy:8080';
    const result = detectProxy();
    expect(result.hasProxy).toBe(true);
    expect(result.httpProxy).toBe('http://proxy:8080');
  });

  it('detects HTTPS_PROXY', () => {
    process.env.HTTPS_PROXY = 'https://proxy:8443';
    const result = detectProxy();
    expect(result.hasProxy).toBe(true);
    expect(result.httpsProxy).toBe('https://proxy:8443');
  });

  it('detects https_proxy (lowercase)', () => {
    process.env.https_proxy = 'https://proxy:8443';
    const result = detectProxy();
    expect(result.hasProxy).toBe(true);
    expect(result.httpsProxy).toBe('https://proxy:8443');
  });

  it('detects NO_PROXY', () => {
    process.env.HTTP_PROXY = 'http://proxy:8080';
    process.env.NO_PROXY = 'localhost,127.0.0.1';
    const result = detectProxy();
    expect(result.noProxy).toBe('localhost,127.0.0.1');
  });

  it('prefers uppercase over lowercase', () => {
    process.env.HTTP_PROXY = 'http://upper:8080';
    process.env.http_proxy = 'http://lower:8080';
    const result = detectProxy();
    expect(result.httpProxy).toBe('http://upper:8080');
  });
});

// ============================================================================
// canAccessHost
// ============================================================================

describe('canAccessHost', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns true when curl succeeds (status 0)', () => {
    mockSpawnSync.mockReturnValueOnce({
      stdout: 'HTTP/2 200',
      stderr: '',
      status: 0,
      signal: null,
      pid: 1,
      output: [],
    } as any);
    expect(canAccessHost('example.com')).toBe(true);
  });

  it('returns false when curl fails (non-zero status)', () => {
    mockSpawnSync.mockReturnValueOnce({
      stdout: '',
      stderr: 'Could not resolve host',
      status: 6,
      signal: null,
      pid: 1,
      output: [],
    } as any);
    expect(canAccessHost('nonexistent.example')).toBe(false);
  });

  it('returns false when curl throws', () => {
    mockSpawnSync.mockImplementationOnce(() => {
      throw new Error('curl not found');
    });
    expect(canAccessHost('example.com')).toBe(false);
  });

  it('calls curl with correct arguments', () => {
    mockSpawnSync.mockReturnValueOnce({
      stdout: '',
      stderr: '',
      status: 0,
      signal: null,
      pid: 1,
      output: [],
    } as any);
    canAccessHost('registry.npmjs.org', 10);
    expect(mockSpawnSync).toHaveBeenCalledWith(
      'curl',
      ['-sS', '--max-time', '10', '--head', 'https://registry.npmjs.org'],
      expect.objectContaining({ encoding: 'utf-8' }),
    );
  });

  it('uses default timeout of 5 seconds', () => {
    mockSpawnSync.mockReturnValueOnce({
      stdout: '',
      stderr: '',
      status: 0,
      signal: null,
      pid: 1,
      output: [],
    } as any);
    canAccessHost('example.com');
    expect(mockSpawnSync).toHaveBeenCalledWith(
      'curl',
      ['-sS', '--max-time', '5', '--head', 'https://example.com'],
      expect.any(Object),
    );
  });
});

// ============================================================================
// Convenience functions
// ============================================================================

describe('detectNpmAccess', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('checks registry.npmjs.org', () => {
    mockSpawnSync.mockReturnValueOnce({
      stdout: '',
      stderr: '',
      status: 0,
      signal: null,
      pid: 1,
      output: [],
    } as any);
    const result = detectNpmAccess();
    expect(typeof result).toBe('boolean');
    expect(mockSpawnSync).toHaveBeenCalledWith(
      'curl',
      expect.arrayContaining(['https://registry.npmjs.org']),
      expect.any(Object),
    );
  });
});

describe('detectGithubAccess', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('checks github.com', () => {
    mockSpawnSync.mockReturnValueOnce({
      stdout: '',
      stderr: '',
      status: 0,
      signal: null,
      pid: 1,
      output: [],
    } as any);
    const result = detectGithubAccess();
    expect(typeof result).toBe('boolean');
    expect(mockSpawnSync).toHaveBeenCalledWith(
      'curl',
      expect.arrayContaining(['https://github.com']),
      expect.any(Object),
    );
  });
});

describe('detectInternetConnection', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('checks dns.google with 3-second timeout', () => {
    mockSpawnSync.mockReturnValueOnce({
      stdout: '',
      stderr: '',
      status: 0,
      signal: null,
      pid: 1,
      output: [],
    } as any);
    const result = detectInternetConnection();
    expect(typeof result).toBe('boolean');
    expect(mockSpawnSync).toHaveBeenCalledWith(
      'curl',
      expect.arrayContaining(['--max-time', '3', 'https://dns.google']),
      expect.any(Object),
    );
  });
});

// ============================================================================
// detectNetworkStatus
// ============================================================================

describe('detectNetworkStatus', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('returns canAccessNpm and canAccessGithub', () => {
    mockSpawnSync.mockReturnValue({
      stdout: '',
      stderr: '',
      status: 0,
      signal: null,
      pid: 1,
      output: [],
    } as any);
    const result = detectNetworkStatus();
    expect(result).toHaveProperty('canAccessNpm');
    expect(result).toHaveProperty('canAccessGithub');
  });
});

// ============================================================================
// detectNetworkDetails
// ============================================================================

describe('detectNetworkDetails', () => {
  const envBackup: Record<string, string | undefined> = {};

  beforeEach(() => {
    vi.restoreAllMocks();
    for (const v of ['HTTP_PROXY', 'http_proxy', 'HTTPS_PROXY', 'https_proxy', 'NO_PROXY', 'no_proxy']) {
      envBackup[v] = process.env[v];
      delete process.env[v];
    }
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(envBackup)) {
      if (v !== undefined) {
        process.env[k] = v;
      } else {
        delete process.env[k];
      }
    }
  });

  it('returns all NetworkInfo fields', () => {
    mockSpawnSync.mockReturnValue({
      stdout: '',
      stderr: '',
      status: 0,
      signal: null,
      pid: 1,
      output: [],
    } as any);
    const result = detectNetworkDetails();
    expect(result).toHaveProperty('canAccessNpm');
    expect(result).toHaveProperty('canAccessGithub');
    expect(result).toHaveProperty('hasInternet');
    expect(result).toHaveProperty('proxy');
    expect(result).toHaveProperty('label');
  });

  it('label contains "Internet: OK" when connected', () => {
    mockSpawnSync.mockReturnValue({
      stdout: '',
      stderr: '',
      status: 0,
      signal: null,
      pid: 1,
      output: [],
    } as any);
    const result = detectNetworkDetails();
    expect(result.label).toContain('Internet: OK');
  });

  it('label says "No internet connection" when offline', () => {
    mockSpawnSync.mockReturnValue({
      stdout: '',
      stderr: 'connection refused',
      status: 7,
      signal: null,
      pid: 1,
      output: [],
    } as any);
    const result = detectNetworkDetails();
    expect(result.label).toBe('No internet connection');
    expect(result.hasInternet).toBe(false);
  });

  it('skips npm/github checks when no internet', () => {
    mockSpawnSync.mockReturnValue({
      stdout: '',
      stderr: '',
      status: 7,
      signal: null,
      pid: 1,
      output: [],
    } as any);
    const result = detectNetworkDetails();
    expect(result.canAccessNpm).toBe(false);
    expect(result.canAccessGithub).toBe(false);
  });

  it('label mentions proxy when configured', () => {
    process.env.HTTP_PROXY = 'http://proxy:8080';
    mockSpawnSync.mockReturnValue({
      stdout: '',
      stderr: '',
      status: 0,
      signal: null,
      pid: 1,
      output: [],
    } as any);
    const result = detectNetworkDetails();
    expect(result.label).toContain('Proxy: configured');
    expect(result.proxy.hasProxy).toBe(true);
  });

  it('label shows npm status', () => {
    // First call: internet check (dns.google) succeeds
    // Second call: npm check succeeds
    // Third call: github check fails
    let callCount = 0;
    mockSpawnSync.mockImplementation(() => {
      callCount++;
      if (callCount <= 2) {
        return { stdout: '', stderr: '', status: 0, signal: null, pid: 1, output: [] } as any;
      }
      return { stdout: '', stderr: '', status: 7, signal: null, pid: 1, output: [] } as any;
    });
    const result = detectNetworkDetails();
    expect(result.label).toContain('npm: OK');
    expect(result.label).toContain('GitHub: unreachable');
  });
});
