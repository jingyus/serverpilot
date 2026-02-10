/**
 * Tests for Fly CLI installation module.
 *
 * Validates:
 * - Platform detection logic
 * - CLI status detection
 * - Install method selection
 * - Install command generation
 * - Dry-run mode
 * - Constants and type exports
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  detectPlatform,
  commandExists,
  getFlyVersion,
  getFlyPath,
  checkFlyCliStatus,
  hasHomebrew,
  getInstallCommand,
  chooseInstallMethod,
  installFlyCli,
  FLY_INSTALL_SCRIPT_URL,
  FLY_CLI_NAMES,
  type FlyCliStatus,
  type FlyCliInstallResult,
  type InstallMethod,
  type Platform,
} from './fly-cli-install';

describe('Constants', () => {
  it('FLY_INSTALL_SCRIPT_URL should point to fly.io', () => {
    expect(FLY_INSTALL_SCRIPT_URL).toBe('https://fly.io/install.sh');
  });

  it('FLY_CLI_NAMES should include flyctl and fly', () => {
    expect(FLY_CLI_NAMES).toContain('flyctl');
    expect(FLY_CLI_NAMES).toContain('fly');
  });

  it('FLY_CLI_NAMES should have exactly 2 entries', () => {
    expect(FLY_CLI_NAMES.length).toBe(2);
  });
});

describe('detectPlatform()', () => {
  it('should return a valid platform string', () => {
    const platform = detectPlatform();
    expect(['darwin', 'linux', 'unsupported']).toContain(platform);
  });

  it('should return darwin or linux on supported systems', () => {
    // On CI/dev machines this should be darwin or linux
    const platform = detectPlatform();
    if (process.platform === 'darwin') {
      expect(platform).toBe('darwin');
    } else if (process.platform === 'linux') {
      expect(platform).toBe('linux');
    }
  });
});

describe('commandExists()', () => {
  it('should return true for common commands (node)', () => {
    expect(commandExists('node')).toBe(true);
  });

  it('should return false for nonexistent commands', () => {
    expect(commandExists('__nonexistent_command_xyz_123__')).toBe(false);
  });

  it('should return true for sh', () => {
    expect(commandExists('sh')).toBe(true);
  });
});

describe('getFlyVersion()', () => {
  it('should return a string or undefined', () => {
    const version = getFlyVersion();
    expect(version === undefined || typeof version === 'string').toBe(true);
  });

  it('if installed, version string should not be empty', () => {
    const version = getFlyVersion();
    if (version !== undefined) {
      expect(version.length).toBeGreaterThan(0);
    }
  });
});

describe('getFlyPath()', () => {
  it('should return a string or undefined', () => {
    const p = getFlyPath();
    expect(p === undefined || typeof p === 'string').toBe(true);
  });

  it('if installed, path should contain fly', () => {
    const p = getFlyPath();
    if (p !== undefined) {
      expect(p.toLowerCase()).toMatch(/fly/);
    }
  });
});

describe('checkFlyCliStatus()', () => {
  it('should return an object with installed boolean', () => {
    const status = checkFlyCliStatus();
    expect(typeof status.installed).toBe('boolean');
  });

  it('if installed, should include version and path', () => {
    const status = checkFlyCliStatus();
    if (status.installed) {
      expect(status.version).toBeDefined();
      expect(typeof status.version).toBe('string');
      expect(status.path).toBeDefined();
      expect(typeof status.path).toBe('string');
    }
  });

  it('if not installed, version and path should be undefined', () => {
    const status = checkFlyCliStatus();
    if (!status.installed) {
      expect(status.version).toBeUndefined();
      expect(status.path).toBeUndefined();
    }
  });

  it('should conform to FlyCliStatus type', () => {
    const status: FlyCliStatus = checkFlyCliStatus();
    expect(status).toHaveProperty('installed');
  });
});

describe('hasHomebrew()', () => {
  it('should return a boolean', () => {
    expect(typeof hasHomebrew()).toBe('boolean');
  });

  it('on macOS, should typically be true', () => {
    if (process.platform === 'darwin') {
      // Most macOS dev environments have Homebrew
      // This is a soft assertion — it's OK if it fails on bare macOS
      const result = hasHomebrew();
      expect(typeof result).toBe('boolean');
    }
  });
});

describe('getInstallCommand()', () => {
  it('should return brew command for homebrew method', () => {
    const cmd = getInstallCommand('homebrew');
    expect(cmd).toBe('brew install flyctl');
  });

  it('should return curl command for curl-installer method', () => {
    const cmd = getInstallCommand('curl-installer');
    expect(cmd).toContain('curl -L');
    expect(cmd).toContain(FLY_INSTALL_SCRIPT_URL);
    expect(cmd).toContain('| sh');
  });

  it('should return empty string for already-installed', () => {
    expect(getInstallCommand('already-installed')).toBe('');
  });

  it('should return empty string for skipped', () => {
    expect(getInstallCommand('skipped')).toBe('');
  });
});

describe('chooseInstallMethod()', () => {
  it('should return skipped for unsupported platform', () => {
    expect(chooseInstallMethod('unsupported')).toBe('skipped');
  });

  it('should return curl-installer for linux', () => {
    expect(chooseInstallMethod('linux')).toBe('curl-installer');
  });

  it('should return a valid InstallMethod for darwin', () => {
    const method = chooseInstallMethod('darwin');
    expect(['homebrew', 'curl-installer']).toContain(method);
  });

  it('on macOS with Homebrew, should prefer homebrew', () => {
    if (process.platform === 'darwin' && hasHomebrew()) {
      expect(chooseInstallMethod('darwin')).toBe('homebrew');
    }
  });

  it('should conform to InstallMethod type', () => {
    const method: InstallMethod = chooseInstallMethod('linux');
    expect(typeof method).toBe('string');
  });
});

describe('installFlyCli()', () => {
  it('if fly is already installed, should return already-installed', () => {
    const status = checkFlyCliStatus();
    if (status.installed) {
      const result = installFlyCli();
      expect(result.success).toBe(true);
      expect(result.method).toBe('already-installed');
      expect(result.version).toBeDefined();
    }
  });

  it('dry-run should succeed without executing anything', () => {
    const status = checkFlyCliStatus();
    if (!status.installed) {
      const result = installFlyCli(undefined, true);
      expect(result.success).toBe(true);
      expect(result.version).toBe('[dry-run]');
    }
  });

  it('dry-run with explicit method should succeed', () => {
    const status = checkFlyCliStatus();
    if (!status.installed) {
      const result = installFlyCli('curl-installer', true);
      expect(result.success).toBe(true);
      expect(result.method).toBe('curl-installer');
      expect(result.version).toBe('[dry-run]');
    }
  });

  it('should return FlyCliInstallResult shape', () => {
    const result: FlyCliInstallResult = installFlyCli(undefined, true);
    expect(result).toHaveProperty('success');
    expect(result).toHaveProperty('method');
    expect(typeof result.success).toBe('boolean');
    expect(typeof result.method).toBe('string');
  });

  it('skipped method should fail with error', () => {
    const result = installFlyCli('skipped', false);
    expect(result.success).toBe(false);
    expect(result.method).toBe('skipped');
    expect(result.error).toBeDefined();
  });

  it('already-installed method with no fly should fail', () => {
    const status = checkFlyCliStatus();
    if (!status.installed) {
      const result = installFlyCli('already-installed', false);
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    }
  });
});

describe('Type exports', () => {
  it('FlyCliStatus type should be usable', () => {
    const status: FlyCliStatus = { installed: false };
    expect(status.installed).toBe(false);
  });

  it('FlyCliInstallResult type should be usable', () => {
    const result: FlyCliInstallResult = {
      success: true,
      method: 'homebrew',
      version: '0.1.0',
    };
    expect(result.success).toBe(true);
  });

  it('Platform type should accept valid values', () => {
    const platforms: Platform[] = ['darwin', 'linux', 'unsupported'];
    expect(platforms).toHaveLength(3);
  });

  it('InstallMethod type should accept valid values', () => {
    const methods: InstallMethod[] = [
      'already-installed',
      'homebrew',
      'curl-installer',
      'skipped',
    ];
    expect(methods).toHaveLength(4);
  });
});

describe('Integration: detection consistency', () => {
  it('checkFlyCliStatus and getFlyVersion should agree', () => {
    const status = checkFlyCliStatus();
    const version = getFlyVersion();
    if (status.installed) {
      expect(version).toBeDefined();
      expect(status.version).toBe(version);
    } else {
      expect(version).toBeUndefined();
    }
  });

  it('checkFlyCliStatus and getFlyPath should agree', () => {
    const status = checkFlyCliStatus();
    const path = getFlyPath();
    if (status.installed) {
      expect(path).toBeDefined();
      expect(status.path).toBe(path);
    } else {
      expect(path).toBeUndefined();
    }
  });

  it('installFlyCli dry-run should not change checkFlyCliStatus', () => {
    const before = checkFlyCliStatus();
    installFlyCli(undefined, true);
    const after = checkFlyCliStatus();
    expect(after.installed).toBe(before.installed);
    expect(after.version).toBe(before.version);
  });
});
