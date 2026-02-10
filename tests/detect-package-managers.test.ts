/**
 * Tests for packages/agent/src/detect/package-managers.ts
 *
 * Package manager detection module - npm, pnpm, yarn, brew, apt
 * version detection and detailed info.
 */

import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  detectApt,
  detectBrew,
  detectNpm,
  detectPackageManagerDetails,
  detectPackageManagers,
  detectPnpm,
  detectYarn,
  getBinaryVersion,
} from '../packages/agent/src/detect/package-managers.js';
import type { PackageManagerInfo } from '../packages/agent/src/detect/package-managers.js';
import { EnvironmentInfoSchema } from '@aiinstaller/shared';

// ============================================================================
// File Existence
// ============================================================================

describe('detect/package-managers.ts - file existence', () => {
  const filePath = path.resolve(__dirname, '../packages/agent/src/detect/package-managers.ts');

  it('should exist', () => {
    expect(existsSync(filePath)).toBe(true);
  });

  it('should not be empty', () => {
    const content = readFileSync(filePath, 'utf-8');
    expect(content.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// Exports
// ============================================================================

describe('detect/package-managers.ts - exports', () => {
  it('should export getBinaryVersion function', () => {
    expect(typeof getBinaryVersion).toBe('function');
  });

  it('should export detectNpm function', () => {
    expect(typeof detectNpm).toBe('function');
  });

  it('should export detectPnpm function', () => {
    expect(typeof detectPnpm).toBe('function');
  });

  it('should export detectYarn function', () => {
    expect(typeof detectYarn).toBe('function');
  });

  it('should export detectBrew function', () => {
    expect(typeof detectBrew).toBe('function');
  });

  it('should export detectApt function', () => {
    expect(typeof detectApt).toBe('function');
  });

  it('should export detectPackageManagers function', () => {
    expect(typeof detectPackageManagers).toBe('function');
  });

  it('should export detectPackageManagerDetails function', () => {
    expect(typeof detectPackageManagerDetails).toBe('function');
  });
});

// ============================================================================
// getBinaryVersion
// ============================================================================

describe('getBinaryVersion()', () => {
  it('should return a version string for an existing binary', () => {
    // node is always available in test environment
    const result = getBinaryVersion('node');
    expect(result).toBeDefined();
    expect(typeof result).toBe('string');
    expect(result).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('should return undefined for a non-existent binary', () => {
    const result = getBinaryVersion('__nonexistent_binary_xyz__');
    expect(result).toBeUndefined();
  });

  it('should accept custom args', () => {
    const result = getBinaryVersion('node', ['--version']);
    expect(result).toBeDefined();
    expect(result).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('should handle binaries that output non-semver text', () => {
    // 'echo' outputs whatever is passed, not a semver
    const result = getBinaryVersion('echo', ['hello']);
    expect(result).toBeUndefined();
  });
});

// ============================================================================
// detectNpm
// ============================================================================

describe('detectNpm()', () => {
  it('should return a string or undefined', () => {
    const result = detectNpm();
    if (result !== undefined) {
      expect(typeof result).toBe('string');
    } else {
      expect(result).toBeUndefined();
    }
  });

  it('should return a valid semver format if npm is available', () => {
    const result = detectNpm();
    if (result) {
      expect(result).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });
});

// ============================================================================
// detectPnpm
// ============================================================================

describe('detectPnpm()', () => {
  it('should return a string or undefined', () => {
    const result = detectPnpm();
    if (result !== undefined) {
      expect(typeof result).toBe('string');
    } else {
      expect(result).toBeUndefined();
    }
  });

  it('should return a valid semver format if pnpm is available', () => {
    const result = detectPnpm();
    if (result) {
      expect(result).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });

  it('should detect pnpm in current dev environment', () => {
    // pnpm is the project's package manager, so it should be available
    const result = detectPnpm();
    expect(result).toBeDefined();
    expect(typeof result).toBe('string');
  });
});

// ============================================================================
// detectYarn
// ============================================================================

describe('detectYarn()', () => {
  it('should return a string or undefined', () => {
    const result = detectYarn();
    if (result !== undefined) {
      expect(typeof result).toBe('string');
    } else {
      expect(result).toBeUndefined();
    }
  });

  it('should return a valid semver format if yarn is available', () => {
    const result = detectYarn();
    if (result) {
      expect(result).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });
});

// ============================================================================
// detectBrew
// ============================================================================

describe('detectBrew()', () => {
  it('should return a string or undefined', () => {
    const result = detectBrew();
    if (result !== undefined) {
      expect(typeof result).toBe('string');
    } else {
      expect(result).toBeUndefined();
    }
  });

  it('should return a valid semver format if brew is available', () => {
    const result = detectBrew();
    if (result) {
      expect(result).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });

  it('should return undefined on non-darwin platforms', () => {
    if (os.platform() !== 'darwin') {
      expect(detectBrew()).toBeUndefined();
    }
  });

  it('should only attempt detection on macOS', () => {
    const result = detectBrew();
    if (os.platform() === 'darwin') {
      // On macOS, it may or may not be installed
      if (result !== undefined) {
        expect(typeof result).toBe('string');
      }
    } else {
      expect(result).toBeUndefined();
    }
  });
});

// ============================================================================
// detectApt
// ============================================================================

describe('detectApt()', () => {
  it('should return a string or undefined', () => {
    const result = detectApt();
    if (result !== undefined) {
      expect(typeof result).toBe('string');
    } else {
      expect(result).toBeUndefined();
    }
  });

  it('should return a valid semver format if apt is available', () => {
    const result = detectApt();
    if (result) {
      expect(result).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });

  it('should return undefined on non-linux platforms', () => {
    if (os.platform() !== 'linux') {
      expect(detectApt()).toBeUndefined();
    }
  });

  it('should only attempt detection on Linux', () => {
    const result = detectApt();
    if (os.platform() === 'linux') {
      // On Linux, apt may or may not be installed
      if (result !== undefined) {
        expect(typeof result).toBe('string');
      }
    } else {
      expect(result).toBeUndefined();
    }
  });
});

// ============================================================================
// detectPackageManagers
// ============================================================================

describe('detectPackageManagers()', () => {
  it('should return an object', () => {
    const result = detectPackageManagers();
    expect(typeof result).toBe('object');
    expect(result).not.toBeNull();
  });

  it('should only contain valid keys', () => {
    const result = detectPackageManagers();
    const validKeys = ['npm', 'pnpm', 'yarn', 'brew', 'apt'];
    for (const key of Object.keys(result)) {
      expect(validKeys).toContain(key);
    }
  });

  it('should have string values for all present keys', () => {
    const result = detectPackageManagers();
    for (const value of Object.values(result)) {
      expect(typeof value).toBe('string');
      expect((value as string).length).toBeGreaterThan(0);
    }
  });

  it('should have semver format values for all present keys', () => {
    const result = detectPackageManagers();
    for (const value of Object.values(result)) {
      expect(value).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });

  it('should detect at least one package manager in dev environment', () => {
    const result = detectPackageManagers();
    expect(Object.keys(result).length).toBeGreaterThanOrEqual(1);
  });

  it('should detect pnpm in current dev environment', () => {
    const result = detectPackageManagers();
    expect(result.pnpm).toBeDefined();
  });

  it('should not include brew on non-darwin platforms', () => {
    if (os.platform() !== 'darwin') {
      const result = detectPackageManagers();
      expect(result.brew).toBeUndefined();
    }
  });

  it('should not include apt on non-linux platforms', () => {
    if (os.platform() !== 'linux') {
      const result = detectPackageManagers();
      expect(result.apt).toBeUndefined();
    }
  });
});

// ============================================================================
// detectPackageManagerDetails
// ============================================================================

describe('detectPackageManagerDetails()', () => {
  it('should return an object with all required fields', () => {
    const result = detectPackageManagerDetails();
    expect(result).toHaveProperty('label');
    expect(result).toHaveProperty('detected');
  });

  it('should have a non-empty label', () => {
    const result = detectPackageManagerDetails();
    expect(typeof result.label).toBe('string');
    expect(result.label.length).toBeGreaterThan(0);
  });

  it('should have detected as an array', () => {
    const result = detectPackageManagerDetails();
    expect(Array.isArray(result.detected)).toBe(true);
  });

  it('should have detected array with at least one entry in dev environment', () => {
    const result = detectPackageManagerDetails();
    expect(result.detected.length).toBeGreaterThanOrEqual(1);
  });

  it('should have detected array containing pnpm in dev environment', () => {
    const result = detectPackageManagerDetails();
    expect(result.detected).toContain('pnpm');
  });

  it('should include detected manager names in the label', () => {
    const result = detectPackageManagerDetails();
    for (const name of result.detected) {
      expect(result.label).toContain(name);
    }
  });

  it('should have label containing version numbers for detected managers', () => {
    const result = detectPackageManagerDetails();
    if (result.pnpm) {
      expect(result.label).toContain(`pnpm ${result.pnpm}`);
    }
    if (result.npm) {
      expect(result.label).toContain(`npm ${result.npm}`);
    }
  });

  it('should have consistent detected list with present version keys', () => {
    const result = detectPackageManagerDetails();
    const versionKeys = ['npm', 'pnpm', 'yarn', 'brew', 'apt'].filter(
      (k) => result[k as keyof PackageManagerInfo] !== undefined
        && k !== 'label' && k !== 'detected',
    );
    expect(result.detected.sort()).toEqual(versionKeys.sort());
  });

  it('should return "None detected" label when no managers found', () => {
    // This tests the edge case of the label builder
    // We can't directly test this without mocking, but we can verify the label format
    const result = detectPackageManagerDetails();
    if (result.detected.length === 0) {
      expect(result.label).toBe('None detected');
    } else {
      expect(result.label).not.toBe('None detected');
    }
  });
});

// ============================================================================
// PackageManagerInfo type
// ============================================================================

describe('PackageManagerInfo type', () => {
  it('should be compatible with the expected interface shape', () => {
    const info: PackageManagerInfo = {
      npm: '10.2.0',
      pnpm: '9.1.0',
      yarn: '1.22.19',
      label: 'npm 10.2.0, pnpm 9.1.0, yarn 1.22.19',
      detected: ['npm', 'pnpm', 'yarn'],
    };
    expect(info.npm).toBe('10.2.0');
    expect(info.pnpm).toBe('9.1.0');
    expect(info.detected).toHaveLength(3);
  });

  it('should allow optional fields to be undefined', () => {
    const info: PackageManagerInfo = {
      npm: undefined,
      pnpm: undefined,
      yarn: undefined,
      brew: undefined,
      apt: undefined,
      label: 'None detected',
      detected: [],
    };
    expect(info.npm).toBeUndefined();
    expect(info.pnpm).toBeUndefined();
    expect(info.detected).toHaveLength(0);
  });

  it('should support macOS-specific brew field', () => {
    const info: PackageManagerInfo = {
      npm: '10.2.0',
      brew: '4.3.0',
      label: 'npm 10.2.0, brew 4.3.0',
      detected: ['npm', 'brew'],
    };
    expect(info.brew).toBe('4.3.0');
    expect(info.detected).toContain('brew');
  });

  it('should support Linux-specific apt field', () => {
    const info: PackageManagerInfo = {
      npm: '10.2.0',
      apt: '2.6.1',
      label: 'npm 10.2.0, apt 2.6.1',
      detected: ['npm', 'apt'],
    };
    expect(info.apt).toBe('2.6.1');
    expect(info.detected).toContain('apt');
  });
});

// ============================================================================
// Schema Compatibility
// ============================================================================

describe('Schema compatibility', () => {
  it('should produce EnvironmentInfo-compatible packageManagers object', () => {
    const result = detectPackageManagers();
    const envInfo = {
      os: { platform: 'darwin', version: '15.5', arch: 'arm64' },
      shell: { type: 'zsh', version: '5.9' },
      runtime: {},
      packageManagers: result,
      network: { canAccessNpm: true, canAccessGithub: true },
      permissions: { hasSudo: false, canWriteTo: [] },
    };
    expect(() => EnvironmentInfoSchema.parse(envInfo)).not.toThrow();
  });

  it('should produce valid schema with empty package managers', () => {
    const envInfo = {
      os: { platform: 'darwin', version: '15.5', arch: 'arm64' },
      shell: { type: 'zsh', version: '5.9' },
      runtime: {},
      packageManagers: {},
      network: { canAccessNpm: true, canAccessGithub: true },
      permissions: { hasSudo: false, canWriteTo: [] },
    };
    expect(() => EnvironmentInfoSchema.parse(envInfo)).not.toThrow();
  });
});

// ============================================================================
// Code Quality
// ============================================================================

describe('detect/package-managers.ts - code quality', () => {
  const filePath = path.resolve(__dirname, '../packages/agent/src/detect/package-managers.ts');
  const content = readFileSync(filePath, 'utf-8');

  it('should use node:child_process import', () => {
    expect(content).toContain("from 'node:child_process'");
  });

  it('should use node:os import', () => {
    expect(content).toContain("from 'node:os'");
  });

  it('should import EnvironmentInfo type from @aiinstaller/shared', () => {
    expect(content).toContain('@aiinstaller/shared');
    expect(content).toContain('EnvironmentInfo');
  });

  it('should use type import for EnvironmentInfo', () => {
    expect(content).toMatch(/import\s+type\s+/);
  });

  it('should export getBinaryVersion function', () => {
    expect(content).toMatch(/export\s+function\s+getBinaryVersion/);
  });

  it('should export detectNpm function', () => {
    expect(content).toMatch(/export\s+function\s+detectNpm/);
  });

  it('should export detectPnpm function', () => {
    expect(content).toMatch(/export\s+function\s+detectPnpm/);
  });

  it('should export detectYarn function', () => {
    expect(content).toMatch(/export\s+function\s+detectYarn/);
  });

  it('should export detectBrew function', () => {
    expect(content).toMatch(/export\s+function\s+detectBrew/);
  });

  it('should export detectApt function', () => {
    expect(content).toMatch(/export\s+function\s+detectApt/);
  });

  it('should export detectPackageManagers function', () => {
    expect(content).toMatch(/export\s+function\s+detectPackageManagers/);
  });

  it('should export detectPackageManagerDetails function', () => {
    expect(content).toMatch(/export\s+function\s+detectPackageManagerDetails/);
  });

  it('should export PackageManagerInfo interface', () => {
    expect(content).toMatch(/export\s+interface\s+PackageManagerInfo/);
  });

  it('should have JSDoc comments for exported functions', () => {
    expect(content).toContain('Get the version of a binary tool');
    expect(content).toContain('Detect the npm version.');
    expect(content).toContain('Detect the pnpm version.');
    expect(content).toContain('Detect the yarn version.');
    expect(content).toContain('Detect the Homebrew version');
    expect(content).toContain('Detect the apt version');
    expect(content).toContain('Detect installed package managers');
    expect(content).toContain('Detect detailed package manager information');
  });

  it('should use spawnSync with timeout', () => {
    expect(content).toContain('spawnSync');
    expect(content).toContain('timeout');
  });

  it('should have a module docblock', () => {
    expect(content).toContain('@module detect/package-managers');
  });

  it('should reference openclaw-modules/infra/binaries.ts inspiration', () => {
    expect(content).toContain('binaries');
  });

  it('should check os.platform() for platform-specific managers', () => {
    expect(content).toContain("os.platform()");
    expect(content).toContain("'darwin'");
    expect(content).toContain("'linux'");
  });
});
