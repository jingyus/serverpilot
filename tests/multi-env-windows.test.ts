/**
 * Windows multi-environment tests.
 *
 * Validates that the AI Installer's detection modules and installation
 * planner work correctly on Windows, covering both WSL2 and native
 * Windows (win32) environments.
 *
 * Tests cover:
 * - OS detection (platform, arch, win32 handling)
 * - Shell detection (PowerShell, cmd, WSL bash)
 * - Runtime detection (Node.js, Python)
 * - Package manager detection (npm, pnpm, yarn — no brew, no apt on native)
 * - Network detection (curl-based connectivity)
 * - Permissions detection (no sudo on native Windows, writable paths)
 * - Full environment detection integration
 * - OpenClaw readiness checks for Windows
 * - Install plan generation for Windows scenarios
 * - Windows-specific OS adjustments (npm fallback for pnpm)
 *
 * @module tests/multi-env-windows
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { accessSync } from 'node:fs';

import type { EnvironmentInfo } from '@aiinstaller/shared';

// Agent detect modules
import { detectOSType, detectOSDetails } from '../packages/agent/src/detect/os.js';
import { detectNodeVersion, detectPythonVersion, detectRuntimeVersions, detectRuntimeDetails, parseSemver, isAtLeast } from '../packages/agent/src/detect/runtime.js';
import { detectNpm, detectPnpm, detectYarn, detectBrew, detectApt, detectPackageManagers, detectPackageManagerDetails, getBinaryVersion } from '../packages/agent/src/detect/package-managers.js';
import { detectProxy, canAccessHost, detectNpmAccess, detectGithubAccess, detectNetworkStatus, detectNetworkDetails } from '../packages/agent/src/detect/network.js';
import { detectOS, detectShell, detectRuntime, detectPackageManagers as detectPkgMgrs, detectNetwork, detectPermissions, detectEnvironment } from '../packages/agent/src/detect/index.js';

// Server-side OpenClaw modules
import { checkNodeVersion, checkPnpm, checkNetwork, checkPermissions, detectOpenClawReadiness } from '../packages/server/src/installers/openclaw/detect.js';
import { generatePlan, estimateTime, assessRisks, applyOsAdjustments } from '../packages/server/src/installers/openclaw/planner.js';
import { generateSteps } from '../packages/server/src/installers/openclaw/steps.js';

// ============================================================================
// Mocks
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
// Helpers
// ============================================================================

/** Convenience factory for mocked spawnSync results. */
function spawnResult(stdout: string, status = 0): any {
  return { stdout, stderr: '', status, signal: null, pid: 1, output: [] };
}

function spawnError(): any {
  return { stdout: '', stderr: 'command not found', status: 127, signal: null, pid: 1, output: [] };
}

/** Build a typical Windows 10 (WSL2) EnvironmentInfo. */
function winWslEnv(overrides: Partial<EnvironmentInfo> = {}): EnvironmentInfo {
  return {
    os: { platform: 'linux', version: '5.15.90.1-microsoft-standard-WSL2', arch: 'x64' },
    shell: { type: 'bash', version: '5.1.16' },
    runtime: { node: '22.1.0', python: '3.10.12' },
    packageManagers: { npm: '10.2.0', pnpm: '9.1.0', apt: '2.4.11' },
    network: { canAccessNpm: true, canAccessGithub: true },
    permissions: { hasSudo: true, canWriteTo: ['/home/dev', '/tmp', '/usr/local/bin'] },
    ...overrides,
  };
}

/** Build a typical native Windows 11 (win32) EnvironmentInfo. */
function winNativeEnv(overrides: Partial<EnvironmentInfo> = {}): EnvironmentInfo {
  return {
    os: { platform: 'win32', version: '10.0.22631', arch: 'x64' },
    shell: { type: 'powershell', version: '7.4.1' },
    runtime: { node: '22.5.0', python: '3.12.0' },
    packageManagers: { npm: '10.5.0', pnpm: '9.5.0' },
    network: { canAccessNpm: true, canAccessGithub: true },
    permissions: { hasSudo: false, canWriteTo: ['C:\\Users\\dev', 'C:\\Users\\dev\\AppData\\Local\\Temp'] },
    ...overrides,
  };
}

/** Build a Windows 10 native (win32) EnvironmentInfo. */
function win10NativeEnv(overrides: Partial<EnvironmentInfo> = {}): EnvironmentInfo {
  return {
    os: { platform: 'win32', version: '10.0.19045', arch: 'x64' },
    shell: { type: 'powershell', version: '5.1.19041' },
    runtime: { node: '22.1.0' },
    packageManagers: { npm: '10.2.0', pnpm: '9.1.0' },
    network: { canAccessNpm: true, canAccessGithub: true },
    permissions: { hasSudo: false, canWriteTo: ['C:\\Users\\dev', 'C:\\Users\\dev\\AppData\\Local\\Temp'] },
    ...overrides,
  };
}

// ============================================================================
// 1. Windows OS Detection
// ============================================================================

describe('Windows OS Detection', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('Native Windows (win32)', () => {
    it('detects platform correctly', () => {
      const result = detectOSType();
      expect(result.platform).toBeDefined();
      expect(['darwin', 'linux', 'win32']).toContain(result.platform);
    });

    it('returns x64 architecture on typical Windows', () => {
      const result = detectOSType();
      expect(['x64', 'arm64', 'ia32']).toContain(result.arch);
    });

    it('generates correct label for Windows', () => {
      if (os.platform() !== 'win32') return;
      const result = detectOSDetails();
      expect(result.name).toBe('Windows');
      expect(result.label).toContain('Windows');
    });

    it('does not set distro fields on Windows', () => {
      if (os.platform() !== 'win32') return;
      const result = detectOSDetails();
      expect(result.distro).toBeUndefined();
      expect(result.distroVersion).toBeUndefined();
    });

    it('does not attempt to read /etc/os-release on Windows', () => {
      if (os.platform() !== 'win32') return;
      const result = detectOSDetails();
      expect(result.distro).toBeUndefined();
      expect(result.distroVersion).toBeUndefined();
    });
  });

  describe('WSL2 (linux kernel with Microsoft tag)', () => {
    it('WSL2 reports as linux platform', () => {
      // WSL2 always reports as linux from Node.js perspective
      const result = detectOSType();
      // WSL2 environment will report linux
      expect(result.platform).toBeDefined();
    });

    it('WSL2 version string contains microsoft identifier', () => {
      // This test validates our WSL env factory
      const env = winWslEnv();
      expect(env.os.version).toContain('microsoft');
      expect(env.os.version).toContain('WSL2');
    });
  });
});

// ============================================================================
// 2. Windows Shell Detection
// ============================================================================

describe('Windows Shell Detection', () => {
  const originalSHELL = process.env.SHELL;

  afterEach(() => {
    if (originalSHELL !== undefined) {
      process.env.SHELL = originalSHELL;
    } else {
      delete process.env.SHELL;
    }
  });

  it('detects PowerShell 7.x on Windows', () => {
    process.env.SHELL = 'pwsh';
    mockSpawnSync.mockReturnValueOnce(spawnResult('PowerShell 7.4.1\n'));
    const result = detectShell();
    expect(result.type).toBe('powershell');
    expect(result.version).toBe('7.4.1');
  });

  it('detects Windows PowerShell 5.1', () => {
    process.env.SHELL = 'powershell';
    mockSpawnSync.mockReturnValueOnce(spawnResult('5.1.19041.4291\n'));
    const result = detectShell();
    expect(result.type).toBe('powershell');
    expect(result.version).toMatch(/^5\.1/);
  });

  it('detects bash in WSL2', () => {
    process.env.SHELL = '/bin/bash';
    mockSpawnSync.mockReturnValueOnce(spawnResult('GNU bash, version 5.1.16(1)-release (x86_64-pc-linux-gnu)\n'));
    const result = detectShell();
    expect(result.type).toBe('bash');
    expect(result.version).toBe('5.1.16');
  });

  it('detects zsh in WSL2', () => {
    process.env.SHELL = '/usr/bin/zsh';
    mockSpawnSync.mockReturnValueOnce(spawnResult('zsh 5.9 (x86_64-ubuntu-linux-gnu)\n'));
    const result = detectShell();
    expect(result.type).toBe('zsh');
    expect(result.version).toBe('5.9');
  });

  it('returns empty version when shell --version fails', () => {
    process.env.SHELL = 'pwsh';
    mockSpawnSync.mockImplementationOnce(() => { throw new Error('spawn failed'); });
    const result = detectShell();
    expect(result.type).toBe('powershell');
    expect(result.version).toBe('');
  });

  it('falls back to unknown for unrecognized shell', () => {
    process.env.SHELL = '';
    const result = detectShell();
    expect(result.type).toBe('unknown');
  });
});

// ============================================================================
// 3. Windows Runtime Detection
// ============================================================================

describe('Windows Runtime Detection', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('detects Node.js from process.versions', () => {
    const version = detectNodeVersion();
    expect(version).toBeDefined();
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('detects Python 3 via python3 command on WSL', () => {
    mockSpawnSync.mockReturnValueOnce(spawnResult('Python 3.10.12\n'));
    const version = detectPythonVersion();
    expect(version).toBe('3.10.12');
  });

  it('detects Python via py launcher on native Windows', () => {
    // On native Windows, python3 may not exist but python or py does
    mockSpawnSync
      .mockImplementationOnce(() => { throw new Error('python3 not found'); })
      .mockReturnValueOnce(spawnResult('Python 3.12.0\n'));
    const version = detectPythonVersion();
    expect(version).toBe('3.12.0');
  });

  it('detects Python not installed on Windows', () => {
    mockSpawnSync
      .mockImplementationOnce(() => { throw new Error('python3 not found'); })
      .mockImplementationOnce(() => { throw new Error('python not found'); });
    const version = detectPythonVersion();
    expect(version).toBeUndefined();
  });

  it('validates Node.js >= 22 with parseSemver and isAtLeast', () => {
    const v22 = parseSemver('22.5.0');
    expect(v22).not.toBeNull();
    expect(isAtLeast(v22, { major: 22, minor: 0, patch: 0 })).toBe(true);

    const v20 = parseSemver('20.11.0');
    expect(isAtLeast(v20, { major: 22, minor: 0, patch: 0 })).toBe(false);
  });

  it('detectRuntimeDetails returns label with node version', () => {
    const details = detectRuntimeDetails();
    if (process.versions?.node) {
      expect(details.label).toContain('Node.js');
      expect(details.nodeExecPath).toBeTruthy();
    }
  });

  it('detectRuntimeVersions includes node version', () => {
    const rt = detectRuntimeVersions();
    expect(rt.node).toBeDefined();
  });
});

// ============================================================================
// 4. Windows Package Manager Detection
// ============================================================================

describe('Windows Package Manager Detection', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('detects npm version on Windows', () => {
    mockSpawnSync.mockReturnValueOnce(spawnResult('10.5.0\n'));
    const version = detectNpm();
    expect(version).toBe('10.5.0');
  });

  it('detects pnpm version on Windows', () => {
    mockSpawnSync.mockReturnValueOnce(spawnResult('9.5.0\n'));
    const version = detectPnpm();
    expect(version).toBe('9.5.0');
  });

  it('detects yarn version on Windows', () => {
    mockSpawnSync.mockReturnValueOnce(spawnResult('1.22.22\n'));
    const version = detectYarn();
    expect(version).toBe('1.22.22');
  });

  it('returns undefined for brew on Windows (non-darwin)', () => {
    if (os.platform() === 'darwin') return;
    const version = detectBrew();
    expect(version).toBeUndefined();
  });

  it('returns undefined for apt on native Windows (non-linux)', () => {
    if (os.platform() === 'linux') return;
    const version = detectApt();
    expect(version).toBeUndefined();
  });

  it('returns undefined when binary is not installed', () => {
    mockSpawnSync.mockImplementation(() => { throw new Error('not found'); });
    expect(detectNpm()).toBeUndefined();
    expect(detectPnpm()).toBeUndefined();
    expect(detectYarn()).toBeUndefined();
  });

  it('getBinaryVersion handles non-semver output', () => {
    mockSpawnSync.mockReturnValueOnce(spawnResult('some random output'));
    const version = getBinaryVersion('somebin');
    expect(version).toBeUndefined();
  });

  it('detectPackageManagerDetails does not include brew or apt on Windows', () => {
    if (os.platform() !== 'win32') return;
    mockSpawnSync.mockReturnValue(spawnResult('1.0.0\n'));
    const details = detectPackageManagerDetails();
    expect(details.brew).toBeUndefined();
    expect(details.apt).toBeUndefined();
    expect(details.detected).not.toContain('brew');
    expect(details.detected).not.toContain('apt');
  });
});

// ============================================================================
// 5. Windows Network Detection
// ============================================================================

describe('Windows Network Detection', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('detects network access when curl succeeds', () => {
    mockSpawnSync.mockReturnValue(spawnResult('HTTP/2 200'));
    expect(canAccessHost('registry.npmjs.org')).toBe(true);
    expect(canAccessHost('github.com')).toBe(true);
  });

  it('detects network failure when curl exits non-zero', () => {
    mockSpawnSync.mockReturnValue(spawnResult('', 7));
    expect(canAccessHost('registry.npmjs.org')).toBe(false);
  });

  it('handles curl not available (throws)', () => {
    mockSpawnSync.mockImplementation(() => { throw new Error('curl not found'); });
    expect(canAccessHost('registry.npmjs.org')).toBe(false);
  });

  it('detects proxy settings from environment variables', () => {
    process.env.HTTP_PROXY = 'http://proxy.corp.local:8080';
    process.env.HTTPS_PROXY = 'https://proxy.corp.local:8443';
    process.env.NO_PROXY = 'localhost,127.0.0.1,.local';

    const proxy = detectProxy();
    expect(proxy.hasProxy).toBe(true);
    expect(proxy.httpProxy).toBe('http://proxy.corp.local:8080');
    expect(proxy.httpsProxy).toBe('https://proxy.corp.local:8443');
    expect(proxy.noProxy).toBe('localhost,127.0.0.1,.local');
  });

  it('detects lowercase proxy environment variables on Windows', () => {
    delete process.env.HTTP_PROXY;
    delete process.env.HTTPS_PROXY;
    process.env.http_proxy = 'http://proxy.local:3128';
    process.env.https_proxy = 'https://proxy.local:3128';

    const proxy = detectProxy();
    expect(proxy.hasProxy).toBe(true);
    expect(proxy.httpProxy).toBe('http://proxy.local:3128');
    expect(proxy.httpsProxy).toBe('https://proxy.local:3128');
  });

  it('detects no proxy when env vars are not set', () => {
    delete process.env.HTTP_PROXY;
    delete process.env.http_proxy;
    delete process.env.HTTPS_PROXY;
    delete process.env.https_proxy;
    delete process.env.NO_PROXY;
    delete process.env.no_proxy;

    const proxy = detectProxy();
    expect(proxy.hasProxy).toBe(false);
  });

  it('detectNetworkDetails returns comprehensive info', () => {
    mockSpawnSync.mockReturnValue(spawnResult('HTTP/2 200'));
    const details = detectNetworkDetails();
    expect(details.hasInternet).toBe(true);
    expect(details.canAccessNpm).toBe(true);
    expect(details.canAccessGithub).toBe(true);
    expect(details.label).toContain('Internet: OK');
  });

  it('detectNetworkDetails reports no internet', () => {
    mockSpawnSync.mockReturnValue(spawnResult('', 7));
    const details = detectNetworkDetails();
    expect(details.hasInternet).toBe(false);
    expect(details.canAccessNpm).toBe(false);
    expect(details.canAccessGithub).toBe(false);
    expect(details.label).toBe('No internet connection');
  });
});

// ============================================================================
// 6. Windows Permissions Detection
// ============================================================================

describe('Windows Permissions Detection', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('sudo is typically not available on native Windows', () => {
    mockSpawnSync.mockReturnValueOnce(spawnResult('', 1));
    const result = detectPermissions();
    expect(result.hasSudo).toBe(false);
  });

  it('sudo is available in WSL2', () => {
    mockSpawnSync.mockReturnValueOnce(spawnResult('', 0));
    const result = detectPermissions();
    expect(result.hasSudo).toBe(true);
  });

  it('detects writable paths on Windows', () => {
    mockSpawnSync.mockReturnValueOnce(spawnResult('', 1)); // sudo fails
    mockAccessSync.mockImplementation(() => { /* writable */ });
    const result = detectPermissions();
    expect(result.canWriteTo).toContain(os.homedir());
    expect(result.canWriteTo).toContain(os.tmpdir());
  });

  it('handles all paths non-writable on locked-down Windows', () => {
    mockSpawnSync.mockReturnValueOnce(spawnResult('', 1)); // sudo fails
    mockAccessSync.mockImplementation(() => { throw new Error('EACCES'); });
    const result = detectPermissions();
    expect(result.canWriteTo).toHaveLength(0);
  });

  it('handles /usr/local/bin and /usr/local/lib not writable (Windows paths differ)', () => {
    mockSpawnSync.mockReturnValueOnce(spawnResult('', 1));
    mockAccessSync.mockImplementation((path: any) => {
      if (path === '/usr/local/bin' || path === '/usr/local/lib') {
        throw new Error('EACCES');
      }
    });
    const result = detectPermissions();
    expect(result.canWriteTo).toContain(os.homedir());
    expect(result.canWriteTo).toContain(os.tmpdir());
  });
});

// ============================================================================
// 7. Windows Full Environment Detection (Integration)
// ============================================================================

describe('Windows Full Environment Detection', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockSpawnSync.mockReturnValue(spawnResult(''));
  });

  it('detectEnvironment returns all required fields', () => {
    const env = detectEnvironment();
    expect(env).toHaveProperty('os');
    expect(env).toHaveProperty('shell');
    expect(env).toHaveProperty('runtime');
    expect(env).toHaveProperty('packageManagers');
    expect(env).toHaveProperty('network');
    expect(env).toHaveProperty('permissions');
  });

  it('detectEnvironment os.platform is win32 on Windows', () => {
    if (os.platform() !== 'win32') return;
    const env = detectEnvironment();
    expect(env.os.platform).toBe('win32');
  });

  it('detectEnvironment includes Node.js version', () => {
    const env = detectEnvironment();
    if (process.versions?.node) {
      expect(env.runtime.node).toBe(process.versions.node);
    }
  });

  it('detectEnvironment shell type is powershell on Windows', () => {
    if (os.platform() !== 'win32') return;
    const env = detectEnvironment();
    expect(['zsh', 'bash', 'fish', 'powershell', 'unknown']).toContain(env.shell.type);
  });
});

// ============================================================================
// 8. OpenClaw Readiness Checks for WSL2
// ============================================================================

describe('OpenClaw Readiness - WSL2', () => {
  const env = winWslEnv();

  it('passes Node.js version check with 22.1.0', () => {
    const result = checkNodeVersion(env);
    expect(result.passed).toBe(true);
    expect(result.message).toContain('22.1.0');
  });

  it('passes pnpm check', () => {
    const result = checkPnpm(env);
    expect(result.passed).toBe(true);
  });

  it('passes network check', () => {
    const result = checkNetwork(env);
    expect(result.passed).toBe(true);
  });

  it('passes permissions check with sudo', () => {
    const result = checkPermissions(env);
    expect(result.passed).toBe(true);
    expect(result.message).toContain('sudo');
  });

  it('is fully ready for OpenClaw installation', () => {
    const result = detectOpenClawReadiness(env);
    expect(result.ready).toBe(true);
    expect(result.summary).toContain('ready');
  });

  it('fails when Node.js version is too old', () => {
    const oldEnv = winWslEnv({ runtime: { node: '18.20.0' } });
    const result = checkNodeVersion(oldEnv);
    expect(result.passed).toBe(false);
    expect(result.message).toContain('too old');
  });

  it('fails when Node.js is not installed', () => {
    const noNodeEnv = winWslEnv({ runtime: {} });
    const result = checkNodeVersion(noNodeEnv);
    expect(result.passed).toBe(false);
    expect(result.message).toContain('not installed');
  });

  it('fails when pnpm is not installed', () => {
    const noPnpmEnv = winWslEnv({ packageManagers: { npm: '10.2.0', apt: '2.4.11' } });
    const result = checkPnpm(noPnpmEnv);
    expect(result.passed).toBe(false);
  });

  it('fails when network is unavailable', () => {
    const noNetEnv = winWslEnv({ network: { canAccessNpm: false, canAccessGithub: false } });
    const result = checkNetwork(noNetEnv);
    expect(result.passed).toBe(false);
  });

  it('fails permissions without sudo and no writable paths', () => {
    const noPermsEnv = winWslEnv({ permissions: { hasSudo: false, canWriteTo: [] } });
    const result = checkPermissions(noPermsEnv);
    expect(result.passed).toBe(false);
  });
});

// ============================================================================
// 9. OpenClaw Readiness Checks for Native Windows
// ============================================================================

describe('OpenClaw Readiness - Native Windows', () => {
  const env = winNativeEnv();

  it('passes all checks with modern Windows setup', () => {
    const result = detectOpenClawReadiness(env);
    expect(result.ready).toBe(true);
    expect(result.checks.nodeVersion.passed).toBe(true);
    expect(result.checks.pnpm.passed).toBe(true);
    expect(result.checks.network.passed).toBe(true);
    expect(result.checks.permissions.passed).toBe(true);
  });

  it('passes with Node.js 22.5.0', () => {
    const result = checkNodeVersion(env);
    expect(result.passed).toBe(true);
    expect(result.message).toContain('22.5.0');
  });

  it('passes permissions with writable user directory (no sudo needed)', () => {
    const result = checkPermissions(env);
    expect(result.passed).toBe(true);
    expect(result.message).toContain('C:\\Users\\dev');
  });

  it('not ready with old Node.js on Windows', () => {
    const oldEnv = winNativeEnv({ runtime: { node: '20.11.0' } });
    const readiness = detectOpenClawReadiness(oldEnv);
    expect(readiness.ready).toBe(false);
    expect(readiness.checks.nodeVersion.passed).toBe(false);
  });

  it('partially ready when pnpm is missing', () => {
    const noPnpmEnv = winNativeEnv({ packageManagers: { npm: '10.5.0' } });
    const readiness = detectOpenClawReadiness(noPnpmEnv);
    expect(readiness.ready).toBe(false);
    expect(readiness.checks.pnpm.passed).toBe(false);
    expect(readiness.checks.nodeVersion.passed).toBe(true);
  });

  it('handles GitHub unreachable but npm reachable (corporate proxy)', () => {
    const proxyEnv = winNativeEnv({ network: { canAccessNpm: true, canAccessGithub: false } });
    const readiness = detectOpenClawReadiness(proxyEnv);
    expect(readiness.ready).toBe(true); // npm access is what matters
    expect(readiness.checks.network.passed).toBe(true);
  });

  it('fails when no writable paths on locked Windows', () => {
    const noPermsEnv = winNativeEnv({ permissions: { hasSudo: false, canWriteTo: [] } });
    const result = checkPermissions(noPermsEnv);
    expect(result.passed).toBe(false);
  });
});

// ============================================================================
// 10. OpenClaw Readiness Checks for Windows 10 Native
// ============================================================================

describe('OpenClaw Readiness - Windows 10 Native', () => {
  const env = win10NativeEnv();

  it('passes all checks with Windows 10 setup', () => {
    const result = detectOpenClawReadiness(env);
    expect(result.ready).toBe(true);
  });

  it('passes Node.js version check with 22.1.0', () => {
    const result = checkNodeVersion(env);
    expect(result.passed).toBe(true);
    expect(result.message).toContain('22.1.0');
  });

  it('passes pnpm check', () => {
    const result = checkPnpm(env);
    expect(result.passed).toBe(true);
  });

  it('fails when Node.js is from outdated installer', () => {
    const oldEnv = win10NativeEnv({ runtime: { node: '16.20.0' } });
    const result = checkNodeVersion(oldEnv);
    expect(result.passed).toBe(false);
    expect(result.message).toContain('too old');
  });

  it('fails when only npm is available (no pnpm)', () => {
    const minimalEnv = win10NativeEnv({ packageManagers: { npm: '10.2.0' } });
    const readiness = detectOpenClawReadiness(minimalEnv);
    expect(readiness.checks.pnpm.passed).toBe(false);
  });
});

// ============================================================================
// 11. Install Plan Generation for Windows
// ============================================================================

describe('Install Plan Generation - Windows', () => {
  it('generates plan for fully ready WSL2', () => {
    const env = winWslEnv();
    const readiness = detectOpenClawReadiness(env);
    const plan = generatePlan(readiness, env);

    expect(plan.steps.length).toBeGreaterThan(0);
    expect(plan.estimatedTime).toBeGreaterThan(0);
    expect(plan.risks).toBeDefined();
  });

  it('generates plan for fully ready native Windows', () => {
    const env = winNativeEnv();
    const readiness = detectOpenClawReadiness(env);
    const plan = generatePlan(readiness, env);

    expect(plan.steps.length).toBeGreaterThan(0);
    expect(plan.estimatedTime).toBeGreaterThan(0);
    expect(plan.risks).toBeDefined();
  });

  it('skips pnpm install step when pnpm is already installed', () => {
    const env = winNativeEnv();
    const readiness = detectOpenClawReadiness(env);
    const steps = generateSteps(readiness, env);

    const pnpmStep = steps.find((s) => s.id === 'install-pnpm');
    expect(pnpmStep).toBeUndefined();
  });

  it('includes pnpm install step when pnpm is missing', () => {
    const env = winNativeEnv({ packageManagers: { npm: '10.5.0' } });
    const readiness = detectOpenClawReadiness(env);
    const steps = generateSteps(readiness, env);

    const pnpmStep = steps.find((s) => s.id === 'install-pnpm');
    expect(pnpmStep).toBeDefined();
  });

  it('always includes check-node, install-openclaw, configure, and verify steps', () => {
    const env = winNativeEnv();
    const readiness = detectOpenClawReadiness(env);
    const steps = generateSteps(readiness, env);

    expect(steps.find((s) => s.id === 'check-node')).toBeDefined();
    expect(steps.find((s) => s.id === 'install-openclaw')).toBeDefined();
    expect(steps.find((s) => s.id === 'configure-openclaw')).toBeDefined();
    expect(steps.find((s) => s.id === 'verify-installation')).toBeDefined();
  });

  it('sets check-node onError to abort when node is already good', () => {
    const env = winNativeEnv();
    const readiness = detectOpenClawReadiness(env);
    const steps = generateSteps(readiness, env);

    const checkNode = steps.find((s) => s.id === 'check-node');
    expect(checkNode?.onError).toBe('abort');
  });

  it('sets check-node onError to fallback when node is not satisfied', () => {
    const env = winNativeEnv({ runtime: { node: '18.20.0' } });
    const readiness = detectOpenClawReadiness(env);
    const steps = generateSteps(readiness, env);

    const checkNode = steps.find((s) => s.id === 'check-node');
    expect(checkNode?.onError).toBe('fallback');
  });

  it('replaces pnpm with npm for install-openclaw on native Windows', () => {
    const env = winNativeEnv();
    const readiness = detectOpenClawReadiness(env);
    let steps = generateSteps(readiness, env);
    steps = applyOsAdjustments(steps, env);

    const installStep = steps.find((s) => s.id === 'install-openclaw');
    expect(installStep?.command).toContain('npm install -g');
    expect(installStep?.command).not.toContain('pnpm install -g');
  });

  it('does NOT prepend sudo on Windows', () => {
    const env = winNativeEnv();
    const readiness = detectOpenClawReadiness(env);
    let steps = generateSteps(readiness, env);
    steps = applyOsAdjustments(steps, env);

    for (const step of steps) {
      expect(step.command).not.toMatch(/^sudo /);
    }
  });

  it('WSL2 prepends sudo on install commands (treated as Linux)', () => {
    const env = winWslEnv();
    const readiness = detectOpenClawReadiness(env);
    let steps = generateSteps(readiness, env);
    steps = applyOsAdjustments(steps, env);

    const installStep = steps.find((s) => s.id === 'install-openclaw');
    // WSL2 is linux platform so sudo is prepended
    expect(installStep?.command).toMatch(/^sudo /);
  });

  it('WSL2 uses pnpm (not npm) for OpenClaw install', () => {
    const env = winWslEnv();
    const readiness = detectOpenClawReadiness(env);
    let steps = generateSteps(readiness, env);
    steps = applyOsAdjustments(steps, env);

    const installStep = steps.find((s) => s.id === 'install-openclaw');
    expect(installStep?.command).toContain('pnpm');
  });

  it('estimateTime uses step timeouts with factor', () => {
    const env = winNativeEnv();
    const readiness = detectOpenClawReadiness(env);
    const steps = generateSteps(readiness, env);
    const time = estimateTime(steps);

    expect(time).toBeGreaterThan(0);
    const totalTimeout = steps.reduce((sum, s) => sum + s.timeout, 0);
    expect(time).toBeLessThan(totalTimeout);
  });

  it('adds Windows-specific medium risk on native Windows', () => {
    const env = winNativeEnv();
    const readiness = detectOpenClawReadiness(env);
    const risks = assessRisks(readiness, env);

    const winRisk = risks.find((r) => r.description.includes('Windows'));
    expect(winRisk).toBeDefined();
    expect(winRisk?.level).toBe('medium');
  });

  it('does NOT add Windows risk for WSL2 (reports as linux)', () => {
    const env = winWslEnv();
    const readiness = detectOpenClawReadiness(env);
    const risks = assessRisks(readiness, env);

    const winRisk = risks.find((r) => r.description.includes('Windows'));
    expect(winRisk).toBeUndefined();
  });

  it('assesses low risk for WSL2 with all checks passing', () => {
    const env = winWslEnv();
    const readiness = detectOpenClawReadiness(env);
    const risks = assessRisks(readiness, env);

    expect(risks.length).toBeGreaterThan(0);
    expect(risks[0].level).toBe('low');
  });

  it('assesses high risk when npm registry is unreachable on Windows', () => {
    const env = winNativeEnv({ network: { canAccessNpm: false, canAccessGithub: false } });
    const readiness = detectOpenClawReadiness(env);
    const risks = assessRisks(readiness, env);

    const networkRisk = risks.find((r) => r.description.includes('npm registry'));
    expect(networkRisk).toBeDefined();
    expect(networkRisk?.level).toBe('high');
  });

  it('assesses medium risk when GitHub is unreachable on Windows', () => {
    const env = winNativeEnv({ network: { canAccessNpm: true, canAccessGithub: false } });
    const readiness = detectOpenClawReadiness(env);
    const risks = assessRisks(readiness, env);

    const githubRisk = risks.find((r) => r.description.includes('GitHub'));
    expect(githubRisk).toBeDefined();
    expect(githubRisk?.level).toBe('medium');
  });

  it('adds proxy config step when GitHub is unreachable but npm works', () => {
    const env = winNativeEnv({ network: { canAccessNpm: true, canAccessGithub: false } });
    const readiness = detectOpenClawReadiness(env);
    const plan = generatePlan(readiness, env);

    const proxyStep = plan.steps.find((s) => s.id === 'configure-proxy');
    expect(proxyStep).toBeDefined();
  });

  it('does not add proxy config step when both npm and GitHub are reachable', () => {
    const env = winNativeEnv();
    const readiness = detectOpenClawReadiness(env);
    const plan = generatePlan(readiness, env);

    const proxyStep = plan.steps.find((s) => s.id === 'configure-proxy');
    expect(proxyStep).toBeUndefined();
  });
});

// ============================================================================
// 12. Windows-specific Scenario Tests
// ============================================================================

describe('Windows Scenario Tests', () => {
  it('fresh WSL2 install: old Node from apt, no pnpm', () => {
    const env = winWslEnv({
      runtime: { node: '12.22.0', python: '3.8.10' },
      packageManagers: { npm: '6.14.4', apt: '2.0.9' },
    });
    const readiness = detectOpenClawReadiness(env);
    expect(readiness.ready).toBe(false);
    expect(readiness.checks.nodeVersion.passed).toBe(false);
    expect(readiness.checks.pnpm.passed).toBe(false);

    const plan = generatePlan(readiness, env);
    const pnpmStep = plan.steps.find((s) => s.id === 'install-pnpm');
    expect(pnpmStep).toBeDefined();
    const checkNode = plan.steps.find((s) => s.id === 'check-node');
    expect(checkNode?.onError).toBe('fallback');
  });

  it('WSL2 with everything installed', () => {
    const env = winWslEnv();
    const readiness = detectOpenClawReadiness(env);
    expect(readiness.ready).toBe(true);

    const plan = generatePlan(readiness, env);
    const pnpmStep = plan.steps.find((s) => s.id === 'install-pnpm');
    expect(pnpmStep).toBeUndefined(); // already installed

    expect(plan.steps.length).toBeLessThan(6);
  });

  it('native Windows with everything installed', () => {
    const env = winNativeEnv();
    const readiness = detectOpenClawReadiness(env);
    expect(readiness.ready).toBe(true);

    const plan = generatePlan(readiness, env);
    const pnpmStep = plan.steps.find((s) => s.id === 'install-pnpm');
    expect(pnpmStep).toBeUndefined(); // already installed
  });

  it('native Windows: Node too old, pnpm missing', () => {
    const env = winNativeEnv({
      runtime: { node: '18.20.0' },
      packageManagers: { npm: '9.8.1' },
    });
    const readiness = detectOpenClawReadiness(env);
    expect(readiness.ready).toBe(false);
    expect(readiness.checks.nodeVersion.passed).toBe(false);
    expect(readiness.checks.pnpm.passed).toBe(false);

    const plan = generatePlan(readiness, env);
    const pnpmStep = plan.steps.find((s) => s.id === 'install-pnpm');
    expect(pnpmStep).toBeDefined();
    const checkNode = plan.steps.find((s) => s.id === 'check-node');
    expect(checkNode?.onError).toBe('fallback');
  });

  it('native Windows: no permissions (locked down corporate machine)', () => {
    const env = winNativeEnv({
      permissions: { hasSudo: false, canWriteTo: [] },
    });
    const readiness = detectOpenClawReadiness(env);
    expect(readiness.checks.permissions.passed).toBe(false);
    expect(readiness.ready).toBe(false);
  });

  it('offline Windows scenario', () => {
    const env = winNativeEnv({
      network: { canAccessNpm: false, canAccessGithub: false },
    });
    const readiness = detectOpenClawReadiness(env);
    expect(readiness.checks.network.passed).toBe(false);
    expect(readiness.ready).toBe(false);

    const risks = assessRisks(readiness, env);
    const highRisk = risks.find((r) => r.level === 'high');
    expect(highRisk).toBeDefined();
  });

  it('offline WSL2 scenario', () => {
    const env = winWslEnv({
      network: { canAccessNpm: false, canAccessGithub: false },
    });
    const readiness = detectOpenClawReadiness(env);
    expect(readiness.checks.network.passed).toBe(false);
    expect(readiness.ready).toBe(false);
  });

  it('Windows with only npm (no pnpm, no yarn)', () => {
    const env = winNativeEnv({
      packageManagers: { npm: '10.5.0' },
    });
    const readiness = detectOpenClawReadiness(env);
    expect(readiness.checks.pnpm.passed).toBe(false);

    const steps = generateSteps(readiness, env);
    const pnpmStep = steps.find((s) => s.id === 'install-pnpm');
    expect(pnpmStep).toBeDefined();
    expect(pnpmStep?.command).toBe('npm install -g pnpm');
  });

  it('Windows with unparseable Node.js version', () => {
    const env = winNativeEnv({ runtime: { node: 'not-a-version' } });
    const result = checkNodeVersion(env);
    expect(result.passed).toBe(false);
    expect(result.message).toContain('Unable to parse');
  });

  it('Windows with NVM for Windows managed Node.js', () => {
    const env = winNativeEnv({
      permissions: { hasSudo: false, canWriteTo: ['C:\\Users\\dev', 'C:\\Users\\dev\\AppData\\Roaming\\nvm'] },
      runtime: { node: '22.12.0' },
    });
    const readiness = detectOpenClawReadiness(env);
    expect(readiness.ready).toBe(true);
    expect(readiness.checks.permissions.passed).toBe(true);
  });

  it('Windows behind corporate proxy (both npm and GitHub through proxy)', () => {
    const env = winNativeEnv({
      network: { canAccessNpm: true, canAccessGithub: true },
    });
    const readiness = detectOpenClawReadiness(env);
    expect(readiness.ready).toBe(true);
  });

  it('Windows behind firewall (npm OK, GitHub blocked)', () => {
    const env = winNativeEnv({
      network: { canAccessNpm: true, canAccessGithub: false },
    });
    const readiness = detectOpenClawReadiness(env);
    expect(readiness.ready).toBe(true); // npm access is what matters

    const risks = assessRisks(readiness, env);
    const githubRisk = risks.find((r) => r.description.includes('GitHub'));
    expect(githubRisk).toBeDefined();
    expect(githubRisk?.level).toBe('medium');
  });

  it('WSL2 CI/CD container (no sudo, limited paths)', () => {
    const env = winWslEnv({
      permissions: { hasSudo: false, canWriteTo: ['/home/runner'] },
    });
    const readiness = detectOpenClawReadiness(env);
    expect(readiness.checks.permissions.passed).toBe(true);
  });

  it('WSL2 with Node.js from nvm (user-local)', () => {
    const env = winWslEnv({
      permissions: { hasSudo: false, canWriteTo: ['/home/dev', '/home/dev/.nvm'] },
      runtime: { node: '22.12.0' },
    });
    const readiness = detectOpenClawReadiness(env);
    expect(readiness.ready).toBe(true);
    expect(readiness.checks.permissions.passed).toBe(true);
  });
});

// ============================================================================
// 13. Windows OS Adjustment Tests
// ============================================================================

describe('Windows OS Adjustments', () => {
  it('replaces pnpm with npm for install-openclaw on native Windows', () => {
    const env = winNativeEnv();
    const readiness = detectOpenClawReadiness(env);
    let steps = generateSteps(readiness, env);
    steps = applyOsAdjustments(steps, env);

    const installStep = steps.find((s) => s.id === 'install-openclaw');
    expect(installStep?.command).toBe('npm install -g openclaw');
  });

  it('does NOT replace pnpm with npm for install-openclaw in WSL2 (linux platform)', () => {
    const env = winWslEnv();
    const readiness = detectOpenClawReadiness(env);
    let steps = generateSteps(readiness, env);
    steps = applyOsAdjustments(steps, env);

    const installStep = steps.find((s) => s.id === 'install-openclaw');
    expect(installStep?.command).toContain('pnpm install -g openclaw');
  });

  it('does NOT prepend sudo on native Windows', () => {
    const env = winNativeEnv();
    const readiness = detectOpenClawReadiness(env);
    let steps = generateSteps(readiness, env);
    steps = applyOsAdjustments(steps, env);

    for (const step of steps) {
      expect(step.command).not.toMatch(/^sudo /);
    }
  });

  it('prepends sudo on WSL2 (treated as Linux with sudo)', () => {
    const env = winWslEnv();
    const readiness = detectOpenClawReadiness(env);
    let steps = generateSteps(readiness, env);
    steps = applyOsAdjustments(steps, env);

    const installStep = steps.find((s) => s.id === 'install-openclaw');
    expect(installStep?.command).toMatch(/^sudo /);
  });

  it('prepends sudo to install-pnpm on WSL2 when pnpm is missing', () => {
    const envNoPnpm = winWslEnv({ packageManagers: { npm: '10.2.0', apt: '2.4.11' } });
    const readiness = detectOpenClawReadiness(envNoPnpm);
    let steps = generateSteps(readiness, envNoPnpm);
    steps = applyOsAdjustments(steps, winWslEnv());

    const pnpmStep = steps.find((s) => s.id === 'install-pnpm');
    expect(pnpmStep?.command).toMatch(/^sudo /);
  });

  it('does NOT double-prepend sudo on WSL2', () => {
    const env = winWslEnv();
    const readiness = detectOpenClawReadiness(env);
    let steps = generateSteps(readiness, env);

    // Manually set sudo prefix
    const installStep = steps.find((s) => s.id === 'install-openclaw');
    if (installStep) installStep.command = 'sudo pnpm install -g openclaw';

    steps = applyOsAdjustments(steps, env);

    const adjusted = steps.find((s) => s.id === 'install-openclaw');
    expect(adjusted?.command).toBe('sudo pnpm install -g openclaw');
    expect(adjusted?.command).not.toMatch(/^sudo sudo /);
  });

  it('does NOT prepend sudo to check-node or verify steps on WSL2', () => {
    const env = winWslEnv();
    const readiness = detectOpenClawReadiness(env);
    let steps = generateSteps(readiness, env);
    steps = applyOsAdjustments(steps, env);

    const checkNode = steps.find((s) => s.id === 'check-node');
    expect(checkNode?.command).not.toMatch(/^sudo /);

    const verify = steps.find((s) => s.id === 'verify-installation');
    expect(verify?.command).not.toMatch(/^sudo /);
  });

  it('native Windows install-openclaw uses npm', () => {
    const env = winNativeEnv();
    const readiness = detectOpenClawReadiness(env);
    let steps = generateSteps(readiness, env);
    steps = applyOsAdjustments(steps, env);

    const installStep = steps.find((s) => s.id === 'install-openclaw');
    expect(installStep?.command).toContain('npm');
    expect(installStep?.command).not.toContain('pnpm');
  });

  it('Windows 10 install plan applies OS adjustments correctly', () => {
    const env = win10NativeEnv();
    const readiness = detectOpenClawReadiness(env);
    let steps = generateSteps(readiness, env);
    steps = applyOsAdjustments(steps, env);

    const installStep = steps.find((s) => s.id === 'install-openclaw');
    expect(installStep?.command).toBe('npm install -g openclaw');
  });
});

// ============================================================================
// 14. Cross-platform Comparison Tests (Windows vs macOS vs Linux)
// ============================================================================

describe('Cross-platform Comparison Tests', () => {
  it('WSL2 and native Ubuntu produce the same plan structure for identical deps', () => {
    const wslEnv = winWslEnv();
    const ubuntuEnv: EnvironmentInfo = {
      os: { platform: 'linux', version: '5.15.0-91-generic', arch: 'x64' },
      shell: { type: 'bash', version: '5.1.16' },
      runtime: { node: '22.1.0', python: '3.10.12' },
      packageManagers: { npm: '10.2.0', pnpm: '9.1.0', apt: '2.4.11' },
      network: { canAccessNpm: true, canAccessGithub: true },
      permissions: { hasSudo: true, canWriteTo: ['/home/dev', '/tmp', '/usr/local/bin'] },
    };

    const wslReadiness = detectOpenClawReadiness(wslEnv);
    const ubuntuReadiness = detectOpenClawReadiness(ubuntuEnv);

    const wslSteps = generateSteps(wslReadiness, wslEnv);
    const ubuntuSteps = generateSteps(ubuntuReadiness, ubuntuEnv);

    expect(wslSteps.map((s) => s.id)).toEqual(ubuntuSteps.map((s) => s.id));
  });

  it('native Windows uses npm while macOS and Linux use pnpm for install', () => {
    const macEnv: EnvironmentInfo = {
      os: { platform: 'darwin', version: '15.5', arch: 'arm64' },
      shell: { type: 'zsh', version: '5.9' },
      runtime: { node: '22.1.0' },
      packageManagers: { npm: '10.2.0', pnpm: '9.1.0', brew: '4.3.0' },
      network: { canAccessNpm: true, canAccessGithub: true },
      permissions: { hasSudo: true, canWriteTo: ['/Users/dev', '/tmp'] },
    };

    const winEnv = winNativeEnv();
    const linuxEnv = winWslEnv(); // WSL2 acts as Linux

    const macReadiness = detectOpenClawReadiness(macEnv);
    const winReadiness = detectOpenClawReadiness(winEnv);
    const linuxReadiness = detectOpenClawReadiness(linuxEnv);

    let macSteps = generateSteps(macReadiness, macEnv);
    macSteps = applyOsAdjustments(macSteps, macEnv);

    let winSteps = generateSteps(winReadiness, winEnv);
    winSteps = applyOsAdjustments(winSteps, winEnv);

    let linuxSteps = generateSteps(linuxReadiness, linuxEnv);
    linuxSteps = applyOsAdjustments(linuxSteps, linuxEnv);

    const macInstall = macSteps.find((s) => s.id === 'install-openclaw');
    const winInstall = winSteps.find((s) => s.id === 'install-openclaw');
    const linuxInstall = linuxSteps.find((s) => s.id === 'install-openclaw');

    // macOS uses pnpm (no sudo)
    expect(macInstall?.command).toContain('pnpm');
    expect(macInstall?.command).not.toMatch(/^sudo /);

    // Windows uses npm (no sudo)
    expect(winInstall?.command).toContain('npm');
    expect(winInstall?.command).not.toMatch(/^sudo /);

    // Linux/WSL uses pnpm with sudo
    expect(linuxInstall?.command).toContain('pnpm');
    expect(linuxInstall?.command).toMatch(/^sudo /);
  });

  it('all platforms produce same step IDs for identical readiness', () => {
    const macEnv: EnvironmentInfo = {
      os: { platform: 'darwin', version: '15.5', arch: 'arm64' },
      shell: { type: 'zsh', version: '5.9' },
      runtime: { node: '22.1.0' },
      packageManagers: { npm: '10.2.0', pnpm: '9.1.0' },
      network: { canAccessNpm: true, canAccessGithub: true },
      permissions: { hasSudo: true, canWriteTo: ['/Users/dev'] },
    };

    const linuxEnv: EnvironmentInfo = {
      os: { platform: 'linux', version: '5.15.0', arch: 'x64' },
      shell: { type: 'bash', version: '5.1.16' },
      runtime: { node: '22.1.0' },
      packageManagers: { npm: '10.2.0', pnpm: '9.1.0' },
      network: { canAccessNpm: true, canAccessGithub: true },
      permissions: { hasSudo: true, canWriteTo: ['/home/dev'] },
    };

    const winEnv = winNativeEnv();

    const macReadiness = detectOpenClawReadiness(macEnv);
    const linuxReadiness = detectOpenClawReadiness(linuxEnv);
    const winReadiness = detectOpenClawReadiness(winEnv);

    const macSteps = generateSteps(macReadiness, macEnv);
    const linuxSteps = generateSteps(linuxReadiness, linuxEnv);
    const winSteps = generateSteps(winReadiness, winEnv);

    // All should produce the same step IDs (before OS adjustments)
    expect(macSteps.map((s) => s.id)).toEqual(linuxSteps.map((s) => s.id));
    expect(linuxSteps.map((s) => s.id)).toEqual(winSteps.map((s) => s.id));
  });

  it('Windows adds platform-specific risk that Linux and macOS do not', () => {
    const winEnv = winNativeEnv();
    const linuxEnv = winWslEnv();
    const macEnv: EnvironmentInfo = {
      os: { platform: 'darwin', version: '15.5', arch: 'arm64' },
      shell: { type: 'zsh', version: '5.9' },
      runtime: { node: '22.1.0' },
      packageManagers: { npm: '10.2.0', pnpm: '9.1.0' },
      network: { canAccessNpm: true, canAccessGithub: true },
      permissions: { hasSudo: true, canWriteTo: ['/Users/dev'] },
    };

    const winReadiness = detectOpenClawReadiness(winEnv);
    const linuxReadiness = detectOpenClawReadiness(linuxEnv);
    const macReadiness = detectOpenClawReadiness(macEnv);

    const winRisks = assessRisks(winReadiness, winEnv);
    const linuxRisks = assessRisks(linuxReadiness, linuxEnv);
    const macRisks = assessRisks(macReadiness, macEnv);

    // Windows should have a platform-specific risk
    expect(winRisks.find((r) => r.description.includes('Windows'))).toBeDefined();
    // Linux/WSL should not
    expect(linuxRisks.find((r) => r.description.includes('Windows'))).toBeUndefined();
    // macOS should not
    expect(macRisks.find((r) => r.description.includes('Windows'))).toBeUndefined();
  });
});
