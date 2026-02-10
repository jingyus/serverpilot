/**
 * Linux multi-environment tests.
 *
 * Validates that the AI Installer's detection modules and installation
 * planner work correctly on Linux, covering Ubuntu 20.04, Ubuntu 22.04,
 * Ubuntu 24.04, and Debian environments.
 *
 * Tests cover:
 * - OS detection (platform, arch, /etc/os-release distro parsing)
 * - Shell detection (bash default, zsh, fish)
 * - Runtime detection (Node.js, Python)
 * - Package manager detection (npm, pnpm, yarn, apt — no brew)
 * - Network detection (curl-based connectivity)
 * - Permissions detection (sudo, writable paths)
 * - Full environment detection integration
 * - OpenClaw readiness checks for Linux
 * - Install plan generation for Linux scenarios
 * - Linux-specific OS adjustments (sudo prefix)
 *
 * @module tests/multi-env-linux
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

/** /etc/os-release content for Ubuntu 20.04 */
const UBUNTU_2004_RELEASE = `NAME="Ubuntu"
VERSION="20.04.6 LTS (Focal Fossa)"
ID=ubuntu
ID_LIKE=debian
VERSION_ID="20.04"
HOME_URL="https://www.ubuntu.com/"
`;

/** /etc/os-release content for Ubuntu 22.04 */
const UBUNTU_2204_RELEASE = `NAME="Ubuntu"
VERSION="22.04.4 LTS (Jammy Jellyfish)"
ID=ubuntu
ID_LIKE=debian
VERSION_ID="22.04"
HOME_URL="https://www.ubuntu.com/"
`;

/** /etc/os-release content for Ubuntu 24.04 */
const UBUNTU_2404_RELEASE = `NAME="Ubuntu"
VERSION="24.04.1 LTS (Noble Numbat)"
ID=ubuntu
ID_LIKE=debian
VERSION_ID="24.04"
HOME_URL="https://www.ubuntu.com/"
`;

/** /etc/os-release content for Debian 12 */
const DEBIAN_12_RELEASE = `NAME="Debian GNU/Linux"
VERSION="12 (bookworm)"
ID=debian
VERSION_ID="12"
HOME_URL="https://www.debian.org/"
`;

/** Build a typical Ubuntu 22.04 x64 EnvironmentInfo. */
function ubuntuEnv(overrides: Partial<EnvironmentInfo> = {}): EnvironmentInfo {
  return {
    os: { platform: 'linux', version: '5.15.0-91-generic', arch: 'x64' },
    shell: { type: 'bash', version: '5.1.16' },
    runtime: { node: '22.1.0', python: '3.10.12' },
    packageManagers: { npm: '10.2.0', pnpm: '9.1.0', apt: '2.4.11' },
    network: { canAccessNpm: true, canAccessGithub: true },
    permissions: { hasSudo: true, canWriteTo: ['/home/dev', '/tmp', '/usr/local/bin'] },
    ...overrides,
  };
}

/** Build a typical Ubuntu 24.04 arm64 EnvironmentInfo. */
function ubuntu24ArmEnv(overrides: Partial<EnvironmentInfo> = {}): EnvironmentInfo {
  return {
    os: { platform: 'linux', version: '6.8.0-31-generic', arch: 'arm64' },
    shell: { type: 'bash', version: '5.2.21' },
    runtime: { node: '24.1.0', python: '3.12.3' },
    packageManagers: { npm: '10.8.0', pnpm: '10.1.0', apt: '2.7.14' },
    network: { canAccessNpm: true, canAccessGithub: true },
    permissions: { hasSudo: true, canWriteTo: ['/home/dev', '/tmp', '/usr/local/bin'] },
    ...overrides,
  };
}

/** Build a typical Debian 12 x64 EnvironmentInfo. */
function debianEnv(overrides: Partial<EnvironmentInfo> = {}): EnvironmentInfo {
  return {
    os: { platform: 'linux', version: '6.1.0-18-amd64', arch: 'x64' },
    shell: { type: 'bash', version: '5.2.15' },
    runtime: { node: '22.5.0', python: '3.11.2' },
    packageManagers: { npm: '10.5.0', pnpm: '9.5.0', apt: '2.6.1' },
    network: { canAccessNpm: true, canAccessGithub: true },
    permissions: { hasSudo: true, canWriteTo: ['/home/dev', '/tmp', '/usr/local/bin'] },
    ...overrides,
  };
}

// ============================================================================
// 1. Linux OS Detection
// ============================================================================

describe('Linux OS Detection', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('Ubuntu 20.04 (x64)', () => {
    it('detects linux platform', () => {
      const result = detectOSType();
      expect(result.platform).toBeDefined();
      // On any platform, detectOSType should return a normalized platform
      expect(['darwin', 'linux', 'win32']).toContain(result.platform);
    });

    it('parses Ubuntu distro from /etc/os-release', () => {
      mockSpawnSync.mockReturnValueOnce(spawnResult(UBUNTU_2004_RELEASE));
      const result = detectOSDetails();
      if (os.platform() === 'linux') {
        expect(result.distro).toBe('Ubuntu');
        expect(result.distroVersion).toBe('20.04');
      }
    });

    it('generates correct label for Ubuntu 20.04', () => {
      mockSpawnSync.mockReturnValueOnce(spawnResult(UBUNTU_2004_RELEASE));
      const result = detectOSDetails();
      if (os.platform() === 'linux') {
        expect(result.name).toBe('Ubuntu');
        expect(result.label).toContain('Ubuntu');
        expect(result.label).toContain(os.arch());
      }
    });
  });

  describe('Ubuntu 22.04 (x64)', () => {
    it('parses Ubuntu 22.04 distro from /etc/os-release', () => {
      mockSpawnSync.mockReturnValueOnce(spawnResult(UBUNTU_2204_RELEASE));
      const result = detectOSDetails();
      if (os.platform() === 'linux') {
        expect(result.distro).toBe('Ubuntu');
        expect(result.distroVersion).toBe('22.04');
      }
    });

    it('generates label with kernel version', () => {
      mockSpawnSync.mockReturnValueOnce(spawnResult(UBUNTU_2204_RELEASE));
      const result = detectOSDetails();
      if (os.platform() === 'linux') {
        expect(result.label).toContain('Ubuntu');
        expect(result.version).toBeTruthy();
      }
    });
  });

  describe('Ubuntu 24.04 (arm64)', () => {
    it('parses Ubuntu 24.04 distro from /etc/os-release', () => {
      mockSpawnSync.mockReturnValueOnce(spawnResult(UBUNTU_2404_RELEASE));
      const result = detectOSDetails();
      if (os.platform() === 'linux') {
        expect(result.distro).toBe('Ubuntu');
        expect(result.distroVersion).toBe('24.04');
      }
    });
  });

  describe('Debian 12', () => {
    it('parses Debian distro from /etc/os-release', () => {
      mockSpawnSync.mockReturnValueOnce(spawnResult(DEBIAN_12_RELEASE));
      const result = detectOSDetails();
      if (os.platform() === 'linux') {
        expect(result.distro).toBe('Debian GNU/Linux');
        expect(result.distroVersion).toBe('12');
      }
    });

    it('generates correct label for Debian', () => {
      mockSpawnSync.mockReturnValueOnce(spawnResult(DEBIAN_12_RELEASE));
      const result = detectOSDetails();
      if (os.platform() === 'linux') {
        expect(result.name).toBe('Debian GNU/Linux');
        expect(result.label).toContain('Debian');
      }
    });
  });

  describe('/etc/os-release edge cases', () => {
    it('falls back to "Linux" when /etc/os-release is empty', () => {
      mockSpawnSync.mockReturnValueOnce(spawnResult(''));
      const result = detectOSDetails();
      if (os.platform() === 'linux') {
        expect(result.name).toBe('Linux');
        expect(result.distro).toBeUndefined();
        expect(result.distroVersion).toBeUndefined();
      }
    });

    it('falls back to "Linux" when cat /etc/os-release fails', () => {
      mockSpawnSync.mockImplementationOnce(() => { throw new Error('no such file'); });
      const result = detectOSDetails();
      if (os.platform() === 'linux') {
        expect(result.name).toBe('Linux');
        expect(result.distro).toBeUndefined();
      }
    });

    it('handles /etc/os-release with unquoted values', () => {
      const unquoted = `NAME=Ubuntu\nVERSION_ID=22.04\n`;
      mockSpawnSync.mockReturnValueOnce(spawnResult(unquoted));
      const result = detectOSDetails();
      if (os.platform() === 'linux') {
        expect(result.distro).toBe('Ubuntu');
        expect(result.distroVersion).toBe('22.04');
      }
    });

    it('sets distro fields only on linux platform', () => {
      if (os.platform() !== 'linux') {
        // On non-linux, detectOSDetails should not set distro fields
        const result = detectOSDetails();
        expect(result.distro).toBeUndefined();
        expect(result.distroVersion).toBeUndefined();
      }
    });
  });
});

// ============================================================================
// 2. Linux Shell Detection
// ============================================================================

describe('Linux Shell Detection', () => {
  const originalSHELL = process.env.SHELL;

  afterEach(() => {
    if (originalSHELL !== undefined) {
      process.env.SHELL = originalSHELL;
    } else {
      delete process.env.SHELL;
    }
  });

  it('detects bash as default Linux shell', () => {
    process.env.SHELL = '/bin/bash';
    mockSpawnSync.mockReturnValueOnce(spawnResult('GNU bash, version 5.1.16(1)-release (x86_64-pc-linux-gnu)\n'));
    const result = detectShell();
    expect(result.type).toBe('bash');
    expect(result.version).toBe('5.1.16');
  });

  it('detects bash 5.2 on Ubuntu 24.04', () => {
    process.env.SHELL = '/bin/bash';
    mockSpawnSync.mockReturnValueOnce(spawnResult('GNU bash, version 5.2.21(1)-release (aarch64-unknown-linux-gnu)\n'));
    const result = detectShell();
    expect(result.type).toBe('bash');
    expect(result.version).toMatch(/^5\.2/);
  });

  it('detects zsh installed on Linux', () => {
    process.env.SHELL = '/usr/bin/zsh';
    mockSpawnSync.mockReturnValueOnce(spawnResult('zsh 5.9 (x86_64-ubuntu-linux-gnu)\n'));
    const result = detectShell();
    expect(result.type).toBe('zsh');
    expect(result.version).toBe('5.9');
  });

  it('detects fish shell on Linux', () => {
    process.env.SHELL = '/usr/bin/fish';
    mockSpawnSync.mockReturnValueOnce(spawnResult('fish, version 3.6.1\n'));
    const result = detectShell();
    expect(result.type).toBe('fish');
    expect(result.version).toBe('3.6.1');
  });

  it('detects bash on Debian', () => {
    process.env.SHELL = '/bin/bash';
    mockSpawnSync.mockReturnValueOnce(spawnResult('GNU bash, version 5.2.15(1)-release (x86_64-pc-linux-gnu)\n'));
    const result = detectShell();
    expect(result.type).toBe('bash');
    expect(result.version).toBe('5.2.15');
  });

  it('returns empty version when shell --version fails', () => {
    process.env.SHELL = '/bin/bash';
    mockSpawnSync.mockImplementationOnce(() => { throw new Error('spawn failed'); });
    const result = detectShell();
    expect(result.type).toBe('bash');
    expect(result.version).toBe('');
  });
});

// ============================================================================
// 3. Linux Runtime Detection
// ============================================================================

describe('Linux Runtime Detection', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('detects Node.js from process.versions', () => {
    const version = detectNodeVersion();
    expect(version).toBeDefined();
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('detects Python 3 via python3 command on Linux', () => {
    mockSpawnSync.mockReturnValueOnce(spawnResult('Python 3.10.12\n'));
    const version = detectPythonVersion();
    expect(version).toBe('3.10.12');
  });

  it('detects Python on Ubuntu 20.04 (python3 from apt)', () => {
    mockSpawnSync.mockReturnValueOnce(spawnResult('Python 3.8.10\n'));
    const version = detectPythonVersion();
    expect(version).toBe('3.8.10');
  });

  it('detects Python on Ubuntu 24.04', () => {
    mockSpawnSync.mockReturnValueOnce(spawnResult('Python 3.12.3\n'));
    const version = detectPythonVersion();
    expect(version).toBe('3.12.3');
  });

  it('detects Python on Debian 12', () => {
    mockSpawnSync.mockReturnValueOnce(spawnResult('Python 3.11.2\n'));
    const version = detectPythonVersion();
    expect(version).toBe('3.11.2');
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

    const v20 = parseSemver('20.11.0');
    expect(isAtLeast(v20, { major: 22, minor: 0, patch: 0 })).toBe(false);

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
// 4. Linux Package Manager Detection
// ============================================================================

describe('Linux Package Manager Detection', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('detects npm version on Linux', () => {
    mockSpawnSync.mockReturnValueOnce(spawnResult('10.2.0\n'));
    const version = detectNpm();
    expect(version).toBe('10.2.0');
  });

  it('detects pnpm version on Linux', () => {
    mockSpawnSync.mockReturnValueOnce(spawnResult('9.1.0\n'));
    const version = detectPnpm();
    expect(version).toBe('9.1.0');
  });

  it('detects yarn version on Linux', () => {
    mockSpawnSync.mockReturnValueOnce(spawnResult('1.22.22\n'));
    const version = detectYarn();
    expect(version).toBe('1.22.22');
  });

  it('detects apt on Linux', () => {
    if (os.platform() !== 'linux') return;
    mockSpawnSync.mockReturnValueOnce(spawnResult('apt 2.4.11 (amd64)\n'));
    const version = detectApt();
    expect(version).toBe('2.4.11');
  });

  it('returns undefined for apt on non-linux', () => {
    if (os.platform() === 'linux') return;
    const version = detectApt();
    expect(version).toBeUndefined();
  });

  it('returns undefined for brew on Linux', () => {
    if (os.platform() !== 'linux') return;
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

  it('detectPackageManagerDetails includes apt on Linux', () => {
    if (os.platform() !== 'linux') return;
    mockSpawnSync.mockReturnValue(spawnResult('2.4.11\n'));
    const details = detectPackageManagerDetails();
    expect(details.apt).toBeDefined();
    expect(details.detected).toContain('apt');
    expect(details.label).toContain('apt');
  });

  it('detectPackageManagerDetails does not include brew on Linux', () => {
    if (os.platform() !== 'linux') return;
    mockSpawnSync.mockReturnValue(spawnResult('1.0.0\n'));
    const details = detectPackageManagerDetails();
    expect(details.brew).toBeUndefined();
    expect(details.detected).not.toContain('brew');
  });
});

// ============================================================================
// 5. Linux Network Detection
// ============================================================================

describe('Linux Network Detection', () => {
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
    process.env.HTTP_PROXY = 'http://proxy.corp.local:3128';
    process.env.HTTPS_PROXY = 'https://proxy.corp.local:3128';
    process.env.NO_PROXY = 'localhost,127.0.0.1,.local';

    const proxy = detectProxy();
    expect(proxy.hasProxy).toBe(true);
    expect(proxy.httpProxy).toBe('http://proxy.corp.local:3128');
    expect(proxy.httpsProxy).toBe('https://proxy.corp.local:3128');
    expect(proxy.noProxy).toBe('localhost,127.0.0.1,.local');
  });

  it('detects lowercase proxy environment variables', () => {
    delete process.env.HTTP_PROXY;
    delete process.env.HTTPS_PROXY;
    process.env.http_proxy = 'http://proxy.local:8080';
    process.env.https_proxy = 'https://proxy.local:8443';

    const proxy = detectProxy();
    expect(proxy.hasProxy).toBe(true);
    expect(proxy.httpProxy).toBe('http://proxy.local:8080');
    expect(proxy.httpsProxy).toBe('https://proxy.local:8443');
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
// 6. Linux Permissions Detection
// ============================================================================

describe('Linux Permissions Detection', () => {
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

  it('detects writable Linux paths including home and tmp', () => {
    mockSpawnSync.mockReturnValueOnce(spawnResult('', 0)); // sudo
    mockAccessSync.mockImplementation(() => { /* writable */ });
    const result = detectPermissions();
    expect(result.canWriteTo).toContain(os.homedir());
    expect(result.canWriteTo).toContain(os.tmpdir());
  });

  it('handles /usr/local/bin not writable on restricted Linux', () => {
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

  it('handles all paths non-writable (Docker/container without root)', () => {
    mockSpawnSync.mockReturnValueOnce(spawnResult('', 1)); // sudo fails
    mockAccessSync.mockImplementation(() => { throw new Error('EACCES'); });
    const result = detectPermissions();
    expect(result.canWriteTo).toHaveLength(0);
  });

  it('detects sudo available in typical Linux server setup', () => {
    mockSpawnSync.mockReturnValueOnce(spawnResult('', 0)); // sudo -n true
    mockAccessSync.mockImplementation(() => { /* all writable */ });
    const result = detectPermissions();
    expect(result.hasSudo).toBe(true);
    expect(result.canWriteTo.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// 7. Linux Full Environment Detection (Integration)
// ============================================================================

describe('Linux Full Environment Detection', () => {
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

  it('detectEnvironment os.platform is linux on Linux', () => {
    if (os.platform() !== 'linux') return;
    const env = detectEnvironment();
    expect(env.os.platform).toBe('linux');
  });

  it('detectEnvironment includes Node.js version', () => {
    const env = detectEnvironment();
    if (process.versions?.node) {
      expect(env.runtime.node).toBe(process.versions.node);
    }
  });

  it('detectEnvironment shell type is bash on typical Linux', () => {
    if (os.platform() !== 'linux') return;
    const env = detectEnvironment();
    expect(['zsh', 'bash', 'fish', 'powershell', 'unknown']).toContain(env.shell.type);
  });
});

// ============================================================================
// 8. OpenClaw Readiness Checks for Ubuntu 22.04
// ============================================================================

describe('OpenClaw Readiness - Ubuntu 22.04', () => {
  const env = ubuntuEnv();

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
    const oldEnv = ubuntuEnv({ runtime: { node: '18.20.0' } });
    const result = checkNodeVersion(oldEnv);
    expect(result.passed).toBe(false);
    expect(result.message).toContain('too old');
  });

  it('fails when Node.js is not installed', () => {
    const noNodeEnv = ubuntuEnv({ runtime: {} });
    const result = checkNodeVersion(noNodeEnv);
    expect(result.passed).toBe(false);
    expect(result.message).toContain('not installed');
  });

  it('fails when pnpm is not installed', () => {
    const noPnpmEnv = ubuntuEnv({ packageManagers: { npm: '10.2.0', apt: '2.4.11' } });
    const result = checkPnpm(noPnpmEnv);
    expect(result.passed).toBe(false);
  });

  it('fails when network is unavailable', () => {
    const noNetEnv = ubuntuEnv({ network: { canAccessNpm: false, canAccessGithub: false } });
    const result = checkNetwork(noNetEnv);
    expect(result.passed).toBe(false);
  });

  it('fails permissions without sudo and no writable paths', () => {
    const noPermsEnv = ubuntuEnv({ permissions: { hasSudo: false, canWriteTo: [] } });
    const result = checkPermissions(noPermsEnv);
    expect(result.passed).toBe(false);
  });
});

// ============================================================================
// 9. OpenClaw Readiness Checks for Ubuntu 24.04 (arm64)
// ============================================================================

describe('OpenClaw Readiness - Ubuntu 24.04 arm64', () => {
  const env = ubuntu24ArmEnv();

  it('passes all checks with modern Ubuntu 24.04 setup', () => {
    const result = detectOpenClawReadiness(env);
    expect(result.ready).toBe(true);
    expect(result.checks.nodeVersion.passed).toBe(true);
    expect(result.checks.pnpm.passed).toBe(true);
    expect(result.checks.network.passed).toBe(true);
    expect(result.checks.permissions.passed).toBe(true);
  });

  it('passes with Node.js 24.x', () => {
    const result = checkNodeVersion(env);
    expect(result.passed).toBe(true);
    expect(result.message).toContain('24.1.0');
  });

  it('passes permissions with writable /usr/local/bin', () => {
    const noSudoEnv = ubuntu24ArmEnv({ permissions: { hasSudo: false, canWriteTo: ['/usr/local/bin'] } });
    const result = checkPermissions(noSudoEnv);
    expect(result.passed).toBe(true);
    expect(result.message).toContain('/usr/local/bin');
  });

  it('not ready with old Node.js on Ubuntu 24.04', () => {
    const oldEnv = ubuntu24ArmEnv({ runtime: { node: '20.11.0' } });
    const readiness = detectOpenClawReadiness(oldEnv);
    expect(readiness.ready).toBe(false);
    expect(readiness.checks.nodeVersion.passed).toBe(false);
  });

  it('partially ready when pnpm is missing', () => {
    const noPnpmEnv = ubuntu24ArmEnv({ packageManagers: { npm: '10.8.0', apt: '2.7.14' } });
    const readiness = detectOpenClawReadiness(noPnpmEnv);
    expect(readiness.ready).toBe(false);
    expect(readiness.checks.pnpm.passed).toBe(false);
    expect(readiness.checks.nodeVersion.passed).toBe(true);
  });

  it('handles GitHub unreachable but npm reachable (corporate proxy)', () => {
    const proxyEnv = ubuntu24ArmEnv({ network: { canAccessNpm: true, canAccessGithub: false } });
    const readiness = detectOpenClawReadiness(proxyEnv);
    expect(readiness.ready).toBe(true); // npm access is what matters
    expect(readiness.checks.network.passed).toBe(true);
  });
});

// ============================================================================
// 10. OpenClaw Readiness Checks for Debian 12
// ============================================================================

describe('OpenClaw Readiness - Debian 12', () => {
  const env = debianEnv();

  it('passes all checks with Debian 12 setup', () => {
    const result = detectOpenClawReadiness(env);
    expect(result.ready).toBe(true);
  });

  it('passes Node.js version check with 22.5.0', () => {
    const result = checkNodeVersion(env);
    expect(result.passed).toBe(true);
    expect(result.message).toContain('22.5.0');
  });

  it('passes pnpm check', () => {
    const result = checkPnpm(env);
    expect(result.passed).toBe(true);
  });

  it('fails when Node.js is from Debian default repos (too old)', () => {
    const oldDebianEnv = debianEnv({ runtime: { node: '18.19.0' } });
    const result = checkNodeVersion(oldDebianEnv);
    expect(result.passed).toBe(false);
    expect(result.message).toContain('too old');
  });

  it('fails when only apt is available (no npm/pnpm)', () => {
    const minimalEnv = debianEnv({ packageManagers: { apt: '2.6.1' } });
    const readiness = detectOpenClawReadiness(minimalEnv);
    expect(readiness.checks.pnpm.passed).toBe(false);
  });
});

// ============================================================================
// 11. Install Plan Generation for Linux
// ============================================================================

describe('Install Plan Generation - Linux', () => {
  it('generates plan for fully ready Ubuntu', () => {
    const env = ubuntuEnv();
    const readiness = detectOpenClawReadiness(env);
    const plan = generatePlan(readiness, env);

    expect(plan.steps.length).toBeGreaterThan(0);
    expect(plan.estimatedTime).toBeGreaterThan(0);
    expect(plan.risks).toBeDefined();
  });

  it('skips pnpm install step when pnpm is already installed', () => {
    const env = ubuntuEnv();
    const readiness = detectOpenClawReadiness(env);
    const steps = generateSteps(readiness, env);

    const pnpmStep = steps.find((s) => s.id === 'install-pnpm');
    expect(pnpmStep).toBeUndefined();
  });

  it('includes pnpm install step when pnpm is missing', () => {
    const env = ubuntuEnv({ packageManagers: { npm: '10.2.0', apt: '2.4.11' } });
    const readiness = detectOpenClawReadiness(env);
    const steps = generateSteps(readiness, env);

    const pnpmStep = steps.find((s) => s.id === 'install-pnpm');
    expect(pnpmStep).toBeDefined();
  });

  it('always includes check-node, install-openclaw, configure, and verify steps', () => {
    const env = ubuntuEnv();
    const readiness = detectOpenClawReadiness(env);
    const steps = generateSteps(readiness, env);

    expect(steps.find((s) => s.id === 'check-node')).toBeDefined();
    expect(steps.find((s) => s.id === 'install-openclaw')).toBeDefined();
    expect(steps.find((s) => s.id === 'configure-openclaw')).toBeDefined();
    expect(steps.find((s) => s.id === 'verify-installation')).toBeDefined();
  });

  it('sets check-node onError to abort when node is already good', () => {
    const env = ubuntuEnv();
    const readiness = detectOpenClawReadiness(env);
    const steps = generateSteps(readiness, env);

    const checkNode = steps.find((s) => s.id === 'check-node');
    expect(checkNode?.onError).toBe('abort');
  });

  it('sets check-node onError to fallback when node is not satisfied', () => {
    const env = ubuntuEnv({ runtime: { node: '18.20.0' } });
    const readiness = detectOpenClawReadiness(env);
    const steps = generateSteps(readiness, env);

    const checkNode = steps.find((s) => s.id === 'check-node');
    expect(checkNode?.onError).toBe('fallback');
  });

  it('prepends sudo on Linux for install commands when sudo is available', () => {
    const env = ubuntuEnv({ permissions: { hasSudo: true, canWriteTo: ['/home/dev', '/tmp'] } });
    const readiness = detectOpenClawReadiness(env);
    let steps = generateSteps(readiness, env);
    steps = applyOsAdjustments(steps, env);

    const installStep = steps.find((s) => s.id === 'install-openclaw');
    expect(installStep?.command).toMatch(/^sudo /);
  });

  it('does NOT prepend sudo on Linux when hasSudo is false but paths are writable', () => {
    const env = ubuntuEnv({ permissions: { hasSudo: false, canWriteTo: ['/home/dev', '/tmp'] } });
    const readiness = detectOpenClawReadiness(env);
    let steps = generateSteps(readiness, env);
    steps = applyOsAdjustments(steps, env);

    const installStep = steps.find((s) => s.id === 'install-openclaw');
    expect(installStep?.command).not.toMatch(/^sudo /);
  });

  it('uses pnpm (not npm) for OpenClaw install on Linux', () => {
    const env = ubuntuEnv();
    const readiness = detectOpenClawReadiness(env);
    let steps = generateSteps(readiness, env);
    steps = applyOsAdjustments(steps, env);

    const installStep = steps.find((s) => s.id === 'install-openclaw');
    expect(installStep?.command).toContain('pnpm');
  });

  it('generates plan for Ubuntu 24.04 arm64', () => {
    const env = ubuntu24ArmEnv();
    const readiness = detectOpenClawReadiness(env);
    const plan = generatePlan(readiness, env);

    expect(plan.steps.length).toBeGreaterThan(0);
    expect(plan.estimatedTime).toBeGreaterThan(0);
  });

  it('generates plan for Debian 12', () => {
    const env = debianEnv();
    const readiness = detectOpenClawReadiness(env);
    const plan = generatePlan(readiness, env);

    expect(plan.steps.length).toBeGreaterThan(0);
    expect(plan.estimatedTime).toBeGreaterThan(0);
  });

  it('estimateTime uses step timeouts with factor', () => {
    const env = ubuntuEnv();
    const readiness = detectOpenClawReadiness(env);
    const steps = generateSteps(readiness, env);
    const time = estimateTime(steps);

    expect(time).toBeGreaterThan(0);
    const totalTimeout = steps.reduce((sum, s) => sum + s.timeout, 0);
    expect(time).toBeLessThan(totalTimeout);
  });

  it('assesses low risk for a fully ready Linux environment', () => {
    const env = ubuntuEnv();
    const readiness = detectOpenClawReadiness(env);
    const risks = assessRisks(readiness, env);

    expect(risks.length).toBeGreaterThan(0);
    expect(risks[0].level).toBe('low');
  });

  it('assesses medium risk when GitHub is unreachable', () => {
    const env = ubuntuEnv({ network: { canAccessNpm: true, canAccessGithub: false } });
    const readiness = detectOpenClawReadiness(env);
    const risks = assessRisks(readiness, env);

    const githubRisk = risks.find((r) => r.description.includes('GitHub'));
    expect(githubRisk).toBeDefined();
    expect(githubRisk?.level).toBe('medium');
  });

  it('assesses high risk when npm registry is unreachable', () => {
    const env = ubuntuEnv({ network: { canAccessNpm: false, canAccessGithub: false } });
    const readiness = detectOpenClawReadiness(env);
    const risks = assessRisks(readiness, env);

    const networkRisk = risks.find((r) => r.description.includes('npm registry'));
    expect(networkRisk).toBeDefined();
    expect(networkRisk?.level).toBe('high');
  });

  it('adds proxy config step when GitHub is unreachable but npm works', () => {
    const env = ubuntuEnv({ network: { canAccessNpm: true, canAccessGithub: false } });
    const readiness = detectOpenClawReadiness(env);
    const plan = generatePlan(readiness, env);

    const proxyStep = plan.steps.find((s) => s.id === 'configure-proxy');
    expect(proxyStep).toBeDefined();
  });

  it('does not add proxy config step when both npm and GitHub are reachable', () => {
    const env = ubuntuEnv();
    const readiness = detectOpenClawReadiness(env);
    const plan = generatePlan(readiness, env);

    const proxyStep = plan.steps.find((s) => s.id === 'configure-proxy');
    expect(proxyStep).toBeUndefined();
  });
});

// ============================================================================
// 12. Linux-specific Scenario Tests
// ============================================================================

describe('Linux Scenario Tests', () => {
  it('fresh Ubuntu 20.04: old Node from apt, no pnpm', () => {
    const env = ubuntuEnv({
      os: { platform: 'linux', version: '5.4.0-42-generic', arch: 'x64' },
      runtime: { node: '10.19.0', python: '3.8.10' },
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

  it('Ubuntu 22.04 server with everything installed', () => {
    const env = ubuntuEnv();
    const readiness = detectOpenClawReadiness(env);
    expect(readiness.ready).toBe(true);

    const plan = generatePlan(readiness, env);
    const pnpmStep = plan.steps.find((s) => s.id === 'install-pnpm');
    expect(pnpmStep).toBeUndefined(); // already installed

    expect(plan.steps.length).toBeLessThan(6);
  });

  it('Ubuntu 24.04 CI/CD container (no sudo, limited paths)', () => {
    const env = ubuntu24ArmEnv({
      permissions: { hasSudo: false, canWriteTo: ['/home/runner'] },
    });
    const readiness = detectOpenClawReadiness(env);
    // Still passes because there is at least one writable path
    expect(readiness.checks.permissions.passed).toBe(true);
  });

  it('Docker container with no sudo and no writable paths', () => {
    const env = ubuntuEnv({
      permissions: { hasSudo: false, canWriteTo: [] },
    });
    const readiness = detectOpenClawReadiness(env);
    expect(readiness.checks.permissions.passed).toBe(false);
    expect(readiness.ready).toBe(false);
  });

  it('Debian minimal install: no Node, no npm, no pnpm', () => {
    const env = debianEnv({
      runtime: {},
      packageManagers: { apt: '2.6.1' },
    });
    const readiness = detectOpenClawReadiness(env);
    expect(readiness.ready).toBe(false);
    expect(readiness.checks.nodeVersion.passed).toBe(false);
    expect(readiness.checks.pnpm.passed).toBe(false);

    const plan = generatePlan(readiness, env);
    expect(plan.steps.find((s) => s.id === 'install-pnpm')).toBeDefined();
    expect(plan.steps.find((s) => s.id === 'check-node')?.onError).toBe('fallback');
  });

  it('offline Linux scenario', () => {
    const env = ubuntuEnv({
      network: { canAccessNpm: false, canAccessGithub: false },
    });
    const readiness = detectOpenClawReadiness(env);
    expect(readiness.checks.network.passed).toBe(false);
    expect(readiness.ready).toBe(false);

    const risks = assessRisks(readiness, env);
    const highRisk = risks.find((r) => r.level === 'high');
    expect(highRisk).toBeDefined();
  });

  it('Linux with only npm (no pnpm, no yarn)', () => {
    const env = ubuntuEnv({
      packageManagers: { npm: '10.2.0', apt: '2.4.11' },
    });
    const readiness = detectOpenClawReadiness(env);
    expect(readiness.checks.pnpm.passed).toBe(false);

    const steps = generateSteps(readiness, env);
    const pnpmStep = steps.find((s) => s.id === 'install-pnpm');
    expect(pnpmStep).toBeDefined();
    expect(pnpmStep?.command).toBe('npm install -g pnpm');
  });

  it('Linux with unparseable Node.js version', () => {
    const env = ubuntuEnv({ runtime: { node: 'not-a-version' } });
    const result = checkNodeVersion(env);
    expect(result.passed).toBe(false);
    expect(result.message).toContain('Unable to parse');
  });

  it('Linux with NVM-managed Node.js (user-local)', () => {
    const env = ubuntuEnv({
      permissions: { hasSudo: false, canWriteTo: ['/home/dev', '/home/dev/.nvm'] },
      runtime: { node: '22.12.0' },
    });
    const readiness = detectOpenClawReadiness(env);
    expect(readiness.ready).toBe(true);
    expect(readiness.checks.permissions.passed).toBe(true);
  });

  it('Ubuntu with corporate proxy (both npm and GitHub through proxy)', () => {
    const env = ubuntuEnv({
      network: { canAccessNpm: true, canAccessGithub: true },
    });
    const readiness = detectOpenClawReadiness(env);
    expect(readiness.ready).toBe(true);

    const risks = assessRisks(readiness, env);
    expect(risks[0].level).toBe('low');
  });

  it('Linux server behind firewall (npm OK, GitHub blocked)', () => {
    const env = debianEnv({
      network: { canAccessNpm: true, canAccessGithub: false },
    });
    const readiness = detectOpenClawReadiness(env);
    expect(readiness.ready).toBe(true); // npm access is what matters

    const risks = assessRisks(readiness, env);
    const githubRisk = risks.find((r) => r.description.includes('GitHub'));
    expect(githubRisk).toBeDefined();
    expect(githubRisk?.level).toBe('medium');
  });
});

// ============================================================================
// 13. Linux OS Adjustment Tests
// ============================================================================

describe('Linux OS Adjustments', () => {
  it('prepends sudo to install-pnpm on Linux with sudo', () => {
    const env = ubuntuEnv();
    const readiness = detectOpenClawReadiness(env);
    // Force pnpm not installed to get install-pnpm step
    const envNoPnpm = ubuntuEnv({ packageManagers: { npm: '10.2.0', apt: '2.4.11' } });
    const readinessNoPnpm = detectOpenClawReadiness(envNoPnpm);
    let steps = generateSteps(readinessNoPnpm, envNoPnpm);
    steps = applyOsAdjustments(steps, env);

    const pnpmStep = steps.find((s) => s.id === 'install-pnpm');
    expect(pnpmStep?.command).toMatch(/^sudo /);
  });

  it('prepends sudo to install-openclaw on Linux with sudo', () => {
    const env = ubuntuEnv();
    const readiness = detectOpenClawReadiness(env);
    let steps = generateSteps(readiness, env);
    steps = applyOsAdjustments(steps, env);

    const installStep = steps.find((s) => s.id === 'install-openclaw');
    expect(installStep?.command).toMatch(/^sudo /);
  });

  it('does NOT double-prepend sudo if already present', () => {
    const env = ubuntuEnv();
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

  it('does NOT prepend sudo to check-node or verify steps', () => {
    const env = ubuntuEnv();
    const readiness = detectOpenClawReadiness(env);
    let steps = generateSteps(readiness, env);
    steps = applyOsAdjustments(steps, env);

    const checkNode = steps.find((s) => s.id === 'check-node');
    expect(checkNode?.command).not.toMatch(/^sudo /);

    const verify = steps.find((s) => s.id === 'verify-installation');
    expect(verify?.command).not.toMatch(/^sudo /);
  });

  it('plan for Debian 12 uses pnpm (not npm) for install', () => {
    const env = debianEnv();
    const readiness = detectOpenClawReadiness(env);
    let steps = generateSteps(readiness, env);
    steps = applyOsAdjustments(steps, env);

    const installStep = steps.find((s) => s.id === 'install-openclaw');
    expect(installStep?.command).toContain('pnpm');
  });

  it('plan for Ubuntu 24.04 arm64 applies sudo correctly', () => {
    const env = ubuntu24ArmEnv();
    const readiness = detectOpenClawReadiness(env);
    let steps = generateSteps(readiness, env);
    steps = applyOsAdjustments(steps, env);

    const installStep = steps.find((s) => s.id === 'install-openclaw');
    expect(installStep?.command).toMatch(/^sudo /);
    expect(installStep?.command).toContain('pnpm install -g openclaw');
  });
});

// ============================================================================
// 14. Cross-distro Comparison Tests
// ============================================================================

describe('Cross-distro Comparison Tests', () => {
  it('Ubuntu 20.04 and 22.04 produce the same plan structure for identical deps', () => {
    const env2004 = ubuntuEnv({
      os: { platform: 'linux', version: '5.4.0-42-generic', arch: 'x64' },
    });
    const env2204 = ubuntuEnv();

    const readiness2004 = detectOpenClawReadiness(env2004);
    const readiness2204 = detectOpenClawReadiness(env2204);

    const steps2004 = generateSteps(readiness2004, env2004);
    const steps2204 = generateSteps(readiness2204, env2204);

    expect(steps2004.map((s) => s.id)).toEqual(steps2204.map((s) => s.id));
  });

  it('Ubuntu and Debian produce the same plan for identical deps', () => {
    const envUbuntu = ubuntuEnv();
    const envDebian = debianEnv();

    const readinessU = detectOpenClawReadiness(envUbuntu);
    const readinessD = detectOpenClawReadiness(envDebian);

    const stepsU = generateSteps(readinessU, envUbuntu);
    const stepsD = generateSteps(readinessD, envDebian);

    expect(stepsU.map((s) => s.id)).toEqual(stepsD.map((s) => s.id));
  });

  it('Ubuntu 24.04 arm64 and x64 produce same step IDs', () => {
    const envArm = ubuntu24ArmEnv();
    const envX64 = ubuntu24ArmEnv({
      os: { platform: 'linux', version: '6.8.0-31-generic', arch: 'x64' },
    });

    const readinessArm = detectOpenClawReadiness(envArm);
    const readinessX64 = detectOpenClawReadiness(envX64);

    const stepsArm = generateSteps(readinessArm, envArm);
    const stepsX64 = generateSteps(readinessX64, envX64);

    expect(stepsArm.map((s) => s.id)).toEqual(stepsX64.map((s) => s.id));
  });

  it('all Linux distros get sudo prefix, macOS does not', () => {
    const macEnv: EnvironmentInfo = {
      os: { platform: 'darwin', version: '15.5', arch: 'arm64' },
      shell: { type: 'zsh', version: '5.9' },
      runtime: { node: '22.1.0' },
      packageManagers: { npm: '10.2.0', pnpm: '9.1.0', brew: '4.3.0' },
      network: { canAccessNpm: true, canAccessGithub: true },
      permissions: { hasSudo: true, canWriteTo: ['/Users/dev', '/tmp'] },
    };

    const linuxEnv = ubuntuEnv();

    const macReadiness = detectOpenClawReadiness(macEnv);
    const linuxReadiness = detectOpenClawReadiness(linuxEnv);

    let macSteps = generateSteps(macReadiness, macEnv);
    macSteps = applyOsAdjustments(macSteps, macEnv);

    let linuxSteps = generateSteps(linuxReadiness, linuxEnv);
    linuxSteps = applyOsAdjustments(linuxSteps, linuxEnv);

    const macInstall = macSteps.find((s) => s.id === 'install-openclaw');
    const linuxInstall = linuxSteps.find((s) => s.id === 'install-openclaw');

    expect(macInstall?.command).not.toMatch(/^sudo /);
    expect(linuxInstall?.command).toMatch(/^sudo /);
  });
});
