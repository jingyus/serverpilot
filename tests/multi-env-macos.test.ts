/**
 * macOS multi-environment tests.
 *
 * Validates that the AI Installer's detection modules and installation
 * planner work correctly on macOS, covering both Intel (x64) and
 * Apple Silicon (arm64) environments.
 *
 * Tests cover:
 * - OS detection (sw_vers, platform, arch)
 * - Shell detection (zsh default, bash)
 * - Runtime detection (Node.js, Python via Homebrew / Xcode)
 * - Package manager detection (npm, pnpm, yarn, brew)
 * - Network detection (curl-based connectivity)
 * - Permissions detection (sudo, writable paths)
 * - Full environment detection integration
 * - OpenClaw readiness checks for macOS
 * - Install plan generation for macOS scenarios
 *
 * @module tests/multi-env-macos
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { accessSync } from 'node:fs';

import type { EnvironmentInfo } from '@aiinstaller/shared';

// Agent detect modules
import { detectOSType, detectOSDetails } from '../packages/agent/src/detect/os.js';
import { detectNodeVersion, detectPythonVersion, detectRuntimeVersions, detectRuntimeDetails, parseSemver, isAtLeast } from '../packages/agent/src/detect/runtime.js';
import { detectNpm, detectPnpm, detectYarn, detectBrew, detectPackageManagers, detectPackageManagerDetails, getBinaryVersion } from '../packages/agent/src/detect/package-managers.js';
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

/** Build a typical macOS Intel EnvironmentInfo. */
function macIntelEnv(overrides: Partial<EnvironmentInfo> = {}): EnvironmentInfo {
  return {
    os: { platform: 'darwin', version: '14.5', arch: 'x64' },
    shell: { type: 'zsh', version: '5.9' },
    runtime: { node: '22.1.0', python: '3.12.0' },
    packageManagers: { npm: '10.2.0', pnpm: '9.1.0', brew: '4.3.0' },
    network: { canAccessNpm: true, canAccessGithub: true },
    permissions: { hasSudo: true, canWriteTo: ['/Users/dev', '/tmp', '/usr/local/bin'] },
    ...overrides,
  };
}

/** Build a typical macOS Apple Silicon EnvironmentInfo. */
function macArmEnv(overrides: Partial<EnvironmentInfo> = {}): EnvironmentInfo {
  return {
    os: { platform: 'darwin', version: '15.5', arch: 'arm64' },
    shell: { type: 'zsh', version: '5.9' },
    runtime: { node: '24.1.0', python: '3.13.0' },
    packageManagers: { npm: '10.8.0', pnpm: '10.1.0', brew: '4.5.0' },
    network: { canAccessNpm: true, canAccessGithub: true },
    permissions: { hasSudo: true, canWriteTo: ['/Users/dev', '/tmp', '/opt/homebrew/bin'] },
    ...overrides,
  };
}

// ============================================================================
// 1. macOS OS Detection
// ============================================================================

describe('macOS OS Detection', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('Intel (x64)', () => {
    it('detects macOS version via sw_vers for Intel', () => {
      if (os.platform() !== 'darwin') return;
      mockSpawnSync.mockReturnValueOnce(spawnResult('14.5\n'));
      const result = detectOSType();
      expect(result.platform).toBe('darwin');
      expect(result.version).toBeTruthy();
    });

    it('returns x64 architecture for Intel Macs', () => {
      if (os.platform() !== 'darwin' || os.arch() !== 'x64') return;
      const result = detectOSType();
      expect(result.arch).toBe('x64');
    });

    it('generates correct label for Intel macOS', () => {
      if (os.platform() !== 'darwin') return;
      mockSpawnSync.mockReturnValueOnce(spawnResult('14.5\n'));
      const result = detectOSDetails();
      expect(result.name).toBe('macOS');
      expect(result.label).toContain('macOS');
    });
  });

  describe('Apple Silicon (arm64)', () => {
    it('detects macOS version via sw_vers for Apple Silicon', () => {
      if (os.platform() !== 'darwin') return;
      mockSpawnSync.mockReturnValueOnce(spawnResult('15.5\n'));
      const result = detectOSType();
      expect(result.platform).toBe('darwin');
      expect(result.version).toBeTruthy();
    });

    it('returns arm64 architecture for Apple Silicon Macs', () => {
      if (os.platform() !== 'darwin' || os.arch() !== 'arm64') return;
      const result = detectOSType();
      expect(result.arch).toBe('arm64');
    });

    it('generates correct label for Apple Silicon macOS', () => {
      if (os.platform() !== 'darwin') return;
      mockSpawnSync.mockReturnValueOnce(spawnResult('15.5\n'));
      const result = detectOSDetails();
      expect(result.name).toBe('macOS');
      expect(result.label).toContain('macOS');
      expect(result.label).toContain('15.5');
    });
  });

  describe('sw_vers edge cases', () => {
    it('falls back to os.release when sw_vers returns empty', () => {
      if (os.platform() !== 'darwin') return;
      mockSpawnSync.mockReturnValueOnce(spawnResult(''));
      const result = detectOSType();
      expect(result.version).toBe(os.release());
    });

    it('falls back to os.release when sw_vers throws', () => {
      if (os.platform() !== 'darwin') return;
      mockSpawnSync.mockImplementationOnce(() => { throw new Error('sw_vers not found'); });
      const result = detectOSType();
      expect(result.version).toBe(os.release());
    });

    it('falls back to os.release when sw_vers returns non-zero exit', () => {
      if (os.platform() !== 'darwin') return;
      mockSpawnSync.mockReturnValueOnce(spawnResult('', 1));
      const result = detectOSType();
      expect(result.version).toBe(os.release());
    });

    it('handles macOS Sonoma version (14.x)', () => {
      if (os.platform() !== 'darwin') return;
      mockSpawnSync.mockReturnValueOnce(spawnResult('14.7.2\n'));
      const result = detectOSType();
      expect(result.version).toBe('14.7.2');
    });

    it('handles macOS Sequoia version (15.x)', () => {
      if (os.platform() !== 'darwin') return;
      mockSpawnSync.mockReturnValueOnce(spawnResult('15.5\n'));
      const result = detectOSType();
      expect(result.version).toBe('15.5');
    });

    it('does not set distro fields on macOS', () => {
      if (os.platform() !== 'darwin') return;
      mockSpawnSync.mockReturnValueOnce(spawnResult('15.5\n'));
      const result = detectOSDetails();
      expect(result.distro).toBeUndefined();
      expect(result.distroVersion).toBeUndefined();
    });
  });
});

// ============================================================================
// 2. macOS Shell Detection
// ============================================================================

describe('macOS Shell Detection', () => {
  const originalSHELL = process.env.SHELL;

  afterEach(() => {
    if (originalSHELL !== undefined) {
      process.env.SHELL = originalSHELL;
    } else {
      delete process.env.SHELL;
    }
  });

  it('detects zsh as default macOS shell', () => {
    process.env.SHELL = '/bin/zsh';
    mockSpawnSync.mockReturnValueOnce(spawnResult('zsh 5.9 (x86_64-apple-darwin24.0)\n'));
    const result = detectShell();
    expect(result.type).toBe('zsh');
    expect(result.version).toBe('5.9');
  });

  it('detects zsh with arm64 tag in version output', () => {
    process.env.SHELL = '/bin/zsh';
    mockSpawnSync.mockReturnValueOnce(spawnResult('zsh 5.9 (arm64-apple-darwin24.0)\n'));
    const result = detectShell();
    expect(result.type).toBe('zsh');
    expect(result.version).toBe('5.9');
  });

  it('detects bash installed via Homebrew on macOS', () => {
    process.env.SHELL = '/opt/homebrew/bin/bash';
    mockSpawnSync.mockReturnValueOnce(spawnResult('GNU bash, version 5.2.37(1)-release (aarch64-apple-darwin24.0)\n'));
    const result = detectShell();
    expect(result.type).toBe('bash');
    expect(result.version).toMatch(/^5\.2/);
  });

  it('detects system bash on macOS', () => {
    process.env.SHELL = '/bin/bash';
    mockSpawnSync.mockReturnValueOnce(spawnResult('GNU bash, version 3.2.57(1)-release (x86_64-apple-darwin24)\n'));
    const result = detectShell();
    expect(result.type).toBe('bash');
    expect(result.version).toMatch(/^3\.2/);
  });

  it('detects fish shell on macOS', () => {
    process.env.SHELL = '/opt/homebrew/bin/fish';
    mockSpawnSync.mockReturnValueOnce(spawnResult('fish, version 3.7.0\n'));
    const result = detectShell();
    expect(result.type).toBe('fish');
    expect(result.version).toBe('3.7.0');
  });

  it('returns empty version when shell --version fails', () => {
    process.env.SHELL = '/bin/zsh';
    mockSpawnSync.mockImplementationOnce(() => { throw new Error('spawn failed'); });
    const result = detectShell();
    expect(result.type).toBe('zsh');
    expect(result.version).toBe('');
  });
});

// ============================================================================
// 3. macOS Runtime Detection
// ============================================================================

describe('macOS Runtime Detection', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('detects Node.js from process.versions', () => {
    const version = detectNodeVersion();
    expect(version).toBeDefined();
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('detects Python 3 via python3 command', () => {
    mockSpawnSync.mockReturnValueOnce(spawnResult('Python 3.13.0\n'));
    const version = detectPythonVersion();
    expect(version).toBe('3.13.0');
  });

  it('detects Python from Xcode Command Line Tools', () => {
    mockSpawnSync.mockReturnValueOnce(spawnResult('Python 3.9.6\n'));
    const version = detectPythonVersion();
    expect(version).toBe('3.9.6');
  });

  it('detects Python installed via Homebrew', () => {
    mockSpawnSync.mockReturnValueOnce(spawnResult('Python 3.12.8\n'));
    const version = detectPythonVersion();
    expect(version).toBe('3.12.8');
  });

  it('falls back to python when python3 is not available', () => {
    mockSpawnSync
      .mockImplementationOnce(() => { throw new Error('python3 not found'); })
      .mockReturnValueOnce(spawnResult('Python 2.7.18\n'));
    const version = detectPythonVersion();
    expect(version).toBe('2.7.18');
  });

  it('validates Node.js >= 22 with parseSemver and isAtLeast', () => {
    const v22 = parseSemver('22.1.0');
    expect(v22).not.toBeNull();
    expect(isAtLeast(v22, { major: 22, minor: 0, patch: 0 })).toBe(true);

    const v24 = parseSemver('24.1.0');
    expect(isAtLeast(v24, { major: 22, minor: 0, patch: 0 })).toBe(true);

    const v18 = parseSemver('18.20.0');
    expect(isAtLeast(v18, { major: 22, minor: 0, patch: 0 })).toBe(false);
  });

  it('detectRuntimeDetails returns label with node version', () => {
    const details = detectRuntimeDetails();
    if (process.versions?.node) {
      expect(details.label).toContain('Node.js');
      expect(details.nodeExecPath).toBeTruthy();
    }
  });
});

// ============================================================================
// 4. macOS Package Manager Detection
// ============================================================================

describe('macOS Package Manager Detection', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('detects npm version on macOS', () => {
    mockSpawnSync.mockReturnValueOnce(spawnResult('10.8.0\n'));
    const version = detectNpm();
    expect(version).toBe('10.8.0');
  });

  it('detects pnpm version on macOS', () => {
    mockSpawnSync.mockReturnValueOnce(spawnResult('10.1.0\n'));
    const version = detectPnpm();
    expect(version).toBe('10.1.0');
  });

  it('detects yarn version on macOS', () => {
    mockSpawnSync.mockReturnValueOnce(spawnResult('1.22.22\n'));
    const version = detectYarn();
    expect(version).toBe('1.22.22');
  });

  it('detects Homebrew on macOS', () => {
    if (os.platform() !== 'darwin') return;
    mockSpawnSync.mockReturnValueOnce(spawnResult('Homebrew 4.5.0\n'));
    const version = detectBrew();
    expect(version).toBe('4.5.0');
  });

  it('returns undefined for Homebrew on non-darwin', () => {
    if (os.platform() === 'darwin') return;
    const version = detectBrew();
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

  it('detectPackageManagerDetails includes brew on macOS', () => {
    if (os.platform() !== 'darwin') return;
    mockSpawnSync.mockReturnValue(spawnResult('4.3.0\n'));
    const details = detectPackageManagerDetails();
    expect(details.brew).toBeDefined();
    expect(details.detected).toContain('brew');
    expect(details.label).toContain('brew');
  });

  it('detectPackageManagerDetails does not include apt on macOS', () => {
    if (os.platform() !== 'darwin') return;
    mockSpawnSync.mockReturnValue(spawnResult('1.0.0\n'));
    const details = detectPackageManagerDetails();
    expect(details.apt).toBeUndefined();
    expect(details.detected).not.toContain('apt');
  });
});

// ============================================================================
// 5. macOS Network Detection
// ============================================================================

describe('macOS Network Detection', () => {
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
    process.env.HTTP_PROXY = 'http://proxy.local:8080';
    process.env.HTTPS_PROXY = 'https://proxy.local:8443';
    process.env.NO_PROXY = 'localhost,127.0.0.1';

    const proxy = detectProxy();
    expect(proxy.hasProxy).toBe(true);
    expect(proxy.httpProxy).toBe('http://proxy.local:8080');
    expect(proxy.httpsProxy).toBe('https://proxy.local:8443');
    expect(proxy.noProxy).toBe('localhost,127.0.0.1');
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
// 6. macOS Permissions Detection
// ============================================================================

describe('macOS Permissions Detection', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('detects sudo when sudo -n true succeeds', () => {
    mockSpawnSync.mockReturnValueOnce(spawnResult('', 0));
    const result = detectPermissions();
    expect(result.hasSudo).toBe(true);
  });

  it('detects no sudo when password is required', () => {
    mockSpawnSync.mockReturnValueOnce(spawnResult('', 1));
    const result = detectPermissions();
    expect(result.hasSudo).toBe(false);
  });

  it('detects writable macOS paths including home and tmp', () => {
    mockSpawnSync.mockReturnValueOnce(spawnResult('', 1)); // sudo
    mockAccessSync.mockImplementation(() => { /* writable */ });
    const result = detectPermissions();
    expect(result.canWriteTo).toContain(os.homedir());
    expect(result.canWriteTo).toContain(os.tmpdir());
  });

  it('handles /usr/local/bin not writable (common on macOS SIP)', () => {
    mockSpawnSync.mockReturnValueOnce(spawnResult('', 1)); // sudo fails
    mockAccessSync.mockImplementation((path: any) => {
      if (path === '/usr/local/bin' || path === '/usr/local/lib') {
        throw new Error('EACCES');
      }
    });
    const result = detectPermissions();
    expect(result.canWriteTo).toContain(os.homedir());
    expect(result.canWriteTo).toContain(os.tmpdir());
    expect(result.canWriteTo).not.toContain('/usr/local/bin');
  });

  it('handles all paths non-writable', () => {
    mockSpawnSync.mockReturnValueOnce(spawnResult('', 1)); // sudo fails
    mockAccessSync.mockImplementation(() => { throw new Error('EACCES'); });
    const result = detectPermissions();
    expect(result.canWriteTo).toHaveLength(0);
  });
});

// ============================================================================
// 7. macOS Full Environment Detection (Integration)
// ============================================================================

describe('macOS Full Environment Detection', () => {
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

  it('detectEnvironment os.platform is darwin on macOS', () => {
    if (os.platform() !== 'darwin') return;
    const env = detectEnvironment();
    expect(env.os.platform).toBe('darwin');
  });

  it('detectEnvironment includes Node.js version', () => {
    const env = detectEnvironment();
    if (process.versions?.node) {
      expect(env.runtime.node).toBe(process.versions.node);
    }
  });

  it('detectEnvironment shell type is zsh or bash on macOS', () => {
    if (os.platform() !== 'darwin') return;
    const env = detectEnvironment();
    expect(['zsh', 'bash', 'fish', 'powershell', 'unknown']).toContain(env.shell.type);
  });
});

// ============================================================================
// 8. OpenClaw Readiness Checks for macOS Intel
// ============================================================================

describe('OpenClaw Readiness - macOS Intel', () => {
  const env = macIntelEnv();

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

  it('fails when Node.js version is too old on Intel Mac', () => {
    const oldEnv = macIntelEnv({ runtime: { node: '18.20.0' } });
    const result = checkNodeVersion(oldEnv);
    expect(result.passed).toBe(false);
    expect(result.message).toContain('too old');
  });

  it('fails when Node.js is not installed', () => {
    const noNodeEnv = macIntelEnv({ runtime: {} });
    const result = checkNodeVersion(noNodeEnv);
    expect(result.passed).toBe(false);
    expect(result.message).toContain('not installed');
  });

  it('fails when pnpm is not installed on Intel Mac', () => {
    const noPnpmEnv = macIntelEnv({ packageManagers: { npm: '10.2.0', brew: '4.3.0' } });
    const result = checkPnpm(noPnpmEnv);
    expect(result.passed).toBe(false);
  });

  it('fails when network is unavailable on Intel Mac', () => {
    const noNetEnv = macIntelEnv({ network: { canAccessNpm: false, canAccessGithub: false } });
    const result = checkNetwork(noNetEnv);
    expect(result.passed).toBe(false);
  });

  it('fails permissions without sudo and no writable paths', () => {
    const noPermsEnv = macIntelEnv({ permissions: { hasSudo: false, canWriteTo: [] } });
    const result = checkPermissions(noPermsEnv);
    expect(result.passed).toBe(false);
  });
});

// ============================================================================
// 9. OpenClaw Readiness Checks for macOS Apple Silicon
// ============================================================================

describe('OpenClaw Readiness - macOS Apple Silicon', () => {
  const env = macArmEnv();

  it('passes all checks with modern Apple Silicon setup', () => {
    const result = detectOpenClawReadiness(env);
    expect(result.ready).toBe(true);
    expect(result.checks.nodeVersion.passed).toBe(true);
    expect(result.checks.pnpm.passed).toBe(true);
    expect(result.checks.network.passed).toBe(true);
    expect(result.checks.permissions.passed).toBe(true);
  });

  it('passes with Node.js 24.x on Apple Silicon', () => {
    const result = checkNodeVersion(env);
    expect(result.passed).toBe(true);
    expect(result.message).toContain('24.1.0');
  });

  it('handles Homebrew paths on Apple Silicon (/opt/homebrew)', () => {
    const result = checkPermissions(env);
    expect(result.passed).toBe(true);
  });

  it('passes permissions with writable /opt/homebrew/bin', () => {
    const armNoSudo = macArmEnv({ permissions: { hasSudo: false, canWriteTo: ['/opt/homebrew/bin'] } });
    const result = checkPermissions(armNoSudo);
    expect(result.passed).toBe(true);
    expect(result.message).toContain('/opt/homebrew/bin');
  });

  it('not ready with old Node.js on Apple Silicon', () => {
    const oldEnv = macArmEnv({ runtime: { node: '20.11.0' } });
    const readiness = detectOpenClawReadiness(oldEnv);
    expect(readiness.ready).toBe(false);
    expect(readiness.checks.nodeVersion.passed).toBe(false);
  });

  it('partially ready when pnpm is missing', () => {
    const noPnpmEnv = macArmEnv({ packageManagers: { npm: '10.8.0', brew: '4.5.0' } });
    const readiness = detectOpenClawReadiness(noPnpmEnv);
    expect(readiness.ready).toBe(false);
    expect(readiness.checks.pnpm.passed).toBe(false);
    expect(readiness.checks.nodeVersion.passed).toBe(true);
  });

  it('handles GitHub unreachable but npm reachable (corporate proxy)', () => {
    const proxyEnv = macArmEnv({ network: { canAccessNpm: true, canAccessGithub: false } });
    const readiness = detectOpenClawReadiness(proxyEnv);
    expect(readiness.ready).toBe(true); // npm access is what matters
    expect(readiness.checks.network.passed).toBe(true);
  });
});

// ============================================================================
// 10. Install Plan Generation for macOS
// ============================================================================

describe('Install Plan Generation - macOS', () => {
  it('generates plan for fully ready Intel Mac', () => {
    const env = macIntelEnv();
    const readiness = detectOpenClawReadiness(env);
    const plan = generatePlan(readiness, env);

    expect(plan.steps.length).toBeGreaterThan(0);
    expect(plan.estimatedTime).toBeGreaterThan(0);
    expect(plan.risks).toBeDefined();
  });

  it('skips pnpm install step when pnpm is already installed', () => {
    const env = macIntelEnv();
    const readiness = detectOpenClawReadiness(env);
    const steps = generateSteps(readiness, env);

    const pnpmStep = steps.find((s) => s.id === 'install-pnpm');
    expect(pnpmStep).toBeUndefined();
  });

  it('includes pnpm install step when pnpm is missing', () => {
    const env = macIntelEnv({ packageManagers: { npm: '10.2.0', brew: '4.3.0' } });
    const readiness = detectOpenClawReadiness(env);
    const steps = generateSteps(readiness, env);

    const pnpmStep = steps.find((s) => s.id === 'install-pnpm');
    expect(pnpmStep).toBeDefined();
  });

  it('always includes check-node, install-openclaw, configure, and verify steps', () => {
    const env = macIntelEnv();
    const readiness = detectOpenClawReadiness(env);
    const steps = generateSteps(readiness, env);

    expect(steps.find((s) => s.id === 'check-node')).toBeDefined();
    expect(steps.find((s) => s.id === 'install-openclaw')).toBeDefined();
    expect(steps.find((s) => s.id === 'configure-openclaw')).toBeDefined();
    expect(steps.find((s) => s.id === 'verify-installation')).toBeDefined();
  });

  it('sets check-node onError to abort when node is already good', () => {
    const env = macIntelEnv();
    const readiness = detectOpenClawReadiness(env);
    const steps = generateSteps(readiness, env);

    const checkNode = steps.find((s) => s.id === 'check-node');
    expect(checkNode?.onError).toBe('abort');
  });

  it('sets check-node onError to fallback when node is not satisfied', () => {
    const env = macIntelEnv({ runtime: { node: '18.20.0' } });
    const readiness = detectOpenClawReadiness(env);
    const steps = generateSteps(readiness, env);

    const checkNode = steps.find((s) => s.id === 'check-node');
    expect(checkNode?.onError).toBe('fallback');
  });

  it('does NOT prepend sudo on macOS (unlike Linux)', () => {
    const env = macIntelEnv();
    const readiness = detectOpenClawReadiness(env);
    let steps = generateSteps(readiness, env);
    steps = applyOsAdjustments(steps, env);

    for (const step of steps) {
      expect(step.command).not.toMatch(/^sudo /);
    }
  });

  it('does NOT replace pnpm with npm on macOS (unlike Windows)', () => {
    const env = macIntelEnv();
    const readiness = detectOpenClawReadiness(env);
    let steps = generateSteps(readiness, env);
    steps = applyOsAdjustments(steps, env);

    const installStep = steps.find((s) => s.id === 'install-openclaw');
    expect(installStep?.command).toContain('pnpm');
    expect(installStep?.command).not.toMatch(/^npm /);
  });

  it('generates plan for Apple Silicon Mac', () => {
    const env = macArmEnv();
    const readiness = detectOpenClawReadiness(env);
    const plan = generatePlan(readiness, env);

    expect(plan.steps.length).toBeGreaterThan(0);
    expect(plan.estimatedTime).toBeGreaterThan(0);
  });

  it('estimateTime uses step timeouts with factor', () => {
    const env = macArmEnv();
    const readiness = detectOpenClawReadiness(env);
    const steps = generateSteps(readiness, env);
    const time = estimateTime(steps);

    expect(time).toBeGreaterThan(0);
    // Should be less than sum of all timeouts
    const totalTimeout = steps.reduce((sum, s) => sum + s.timeout, 0);
    expect(time).toBeLessThan(totalTimeout);
  });

  it('assesses low risk for a fully ready macOS environment', () => {
    const env = macArmEnv();
    const readiness = detectOpenClawReadiness(env);
    const risks = assessRisks(readiness, env);

    expect(risks.length).toBeGreaterThan(0);
    expect(risks[0].level).toBe('low');
  });

  it('assesses medium risk when GitHub is unreachable', () => {
    const env = macArmEnv({ network: { canAccessNpm: true, canAccessGithub: false } });
    const readiness = detectOpenClawReadiness(env);
    const risks = assessRisks(readiness, env);

    const githubRisk = risks.find((r) => r.description.includes('GitHub'));
    expect(githubRisk).toBeDefined();
    expect(githubRisk?.level).toBe('medium');
  });

  it('assesses high risk when npm registry is unreachable', () => {
    const env = macIntelEnv({ network: { canAccessNpm: false, canAccessGithub: false } });
    const readiness = detectOpenClawReadiness(env);
    const risks = assessRisks(readiness, env);

    const networkRisk = risks.find((r) => r.description.includes('npm registry'));
    expect(networkRisk).toBeDefined();
    expect(networkRisk?.level).toBe('high');
  });

  it('adds proxy config step when GitHub is unreachable but npm works', () => {
    const env = macArmEnv({ network: { canAccessNpm: true, canAccessGithub: false } });
    const readiness = detectOpenClawReadiness(env);
    const plan = generatePlan(readiness, env);

    const proxyStep = plan.steps.find((s) => s.id === 'configure-proxy');
    expect(proxyStep).toBeDefined();
  });

  it('does not add proxy config step when both npm and GitHub are reachable', () => {
    const env = macArmEnv();
    const readiness = detectOpenClawReadiness(env);
    const plan = generatePlan(readiness, env);

    const proxyStep = plan.steps.find((s) => s.id === 'configure-proxy');
    expect(proxyStep).toBeUndefined();
  });
});

// ============================================================================
// 11. macOS-specific Scenario Tests
// ============================================================================

describe('macOS Scenario Tests', () => {
  it('fresh macOS install: no pnpm, no Node >= 22', () => {
    const env = macIntelEnv({
      runtime: { node: '18.20.0' },
      packageManagers: { npm: '9.8.1', brew: '4.3.0' },
    });
    const readiness = detectOpenClawReadiness(env);
    expect(readiness.ready).toBe(false);

    const plan = generatePlan(readiness, env);
    const pnpmStep = plan.steps.find((s) => s.id === 'install-pnpm');
    expect(pnpmStep).toBeDefined();
    const checkNode = plan.steps.find((s) => s.id === 'check-node');
    expect(checkNode?.onError).toBe('fallback');
  });

  it('developer Mac with everything installed', () => {
    const env = macArmEnv();
    const readiness = detectOpenClawReadiness(env);
    expect(readiness.ready).toBe(true);

    const plan = generatePlan(readiness, env);
    const pnpmStep = plan.steps.find((s) => s.id === 'install-pnpm');
    expect(pnpmStep).toBeUndefined(); // already installed

    // Should have fewer steps
    expect(plan.steps.length).toBeLessThan(6);
  });

  it('restricted macOS without sudo and limited write access', () => {
    const env = macArmEnv({
      permissions: { hasSudo: false, canWriteTo: ['/Users/dev'] },
    });
    const readiness = detectOpenClawReadiness(env);
    // Still passes because there is at least one writable path
    expect(readiness.checks.permissions.passed).toBe(true);
  });

  it('completely restricted macOS (no sudo, no writable paths)', () => {
    const env = macIntelEnv({
      permissions: { hasSudo: false, canWriteTo: [] },
    });
    const readiness = detectOpenClawReadiness(env);
    expect(readiness.checks.permissions.passed).toBe(false);
    expect(readiness.ready).toBe(false);
  });

  it('offline macOS scenario', () => {
    const env = macArmEnv({
      network: { canAccessNpm: false, canAccessGithub: false },
    });
    const readiness = detectOpenClawReadiness(env);
    expect(readiness.checks.network.passed).toBe(false);
    expect(readiness.ready).toBe(false);

    const risks = assessRisks(readiness, env);
    const highRisk = risks.find((r) => r.level === 'high');
    expect(highRisk).toBeDefined();
  });

  it('macOS with only npm (no pnpm, no yarn)', () => {
    const env = macIntelEnv({
      packageManagers: { npm: '10.2.0', brew: '4.3.0' },
    });
    const readiness = detectOpenClawReadiness(env);
    expect(readiness.checks.pnpm.passed).toBe(false);

    const steps = generateSteps(readiness, env);
    const pnpmStep = steps.find((s) => s.id === 'install-pnpm');
    expect(pnpmStep).toBeDefined();
    expect(pnpmStep?.command).toBe('npm install -g pnpm');
  });

  it('macOS with unparseable Node.js version', () => {
    const env = macIntelEnv({ runtime: { node: 'not-a-version' } });
    const result = checkNodeVersion(env);
    expect(result.passed).toBe(false);
    expect(result.message).toContain('Unable to parse');
  });
});
