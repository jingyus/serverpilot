/**
 * Tests for packages/agent/src/detect/os.ts
 *
 * OS detection module - platform, version, architecture, and detailed OS info.
 */

import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { detectArch, detectOSDetails, detectOSType } from '../packages/agent/src/detect/os.js';
import type { OSInfo } from '../packages/agent/src/detect/os.js';

// ============================================================================
// File Existence
// ============================================================================

describe('detect/os.ts - file existence', () => {
  const filePath = path.resolve(__dirname, '../packages/agent/src/detect/os.ts');

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

describe('detect/os.ts - exports', () => {
  it('should export detectOSType function', () => {
    expect(typeof detectOSType).toBe('function');
  });

  it('should export detectArch function', () => {
    expect(typeof detectArch).toBe('function');
  });

  it('should export detectOSDetails function', () => {
    expect(typeof detectOSDetails).toBe('function');
  });
});

// ============================================================================
// detectOSType
// ============================================================================

describe('detectOSType()', () => {
  it('should return an object with platform, version, and arch', () => {
    const result = detectOSType();
    expect(result).toHaveProperty('platform');
    expect(result).toHaveProperty('version');
    expect(result).toHaveProperty('arch');
  });

  it('should return a valid platform enum value', () => {
    const result = detectOSType();
    expect(['darwin', 'linux', 'win32']).toContain(result.platform);
  });

  it('should return a non-empty version string', () => {
    const result = detectOSType();
    expect(typeof result.version).toBe('string');
    expect(result.version.length).toBeGreaterThan(0);
  });

  it('should return a non-empty arch string', () => {
    const result = detectOSType();
    expect(typeof result.arch).toBe('string');
    expect(result.arch.length).toBeGreaterThan(0);
  });

  it('should match the current os.platform()', () => {
    const result = detectOSType();
    const currentPlatform = os.platform();
    if (['darwin', 'linux', 'win32'].includes(currentPlatform)) {
      expect(result.platform).toBe(currentPlatform);
    }
  });

  it('should match the current os.arch()', () => {
    const result = detectOSType();
    expect(result.arch).toBe(os.arch());
  });

  it('should return a macOS product version on darwin', () => {
    const result = detectOSType();
    if (result.platform === 'darwin') {
      // macOS versions look like "15.5" or "14.2.1", not kernel versions like "24.6.0"
      expect(result.version).toMatch(/^\d+\.\d+/);
    }
  });

  it('should be compatible with EnvironmentInfo os schema', () => {
    const result = detectOSType();
    // Verify structure matches EnvironmentInfo['os']
    expect(typeof result.platform).toBe('string');
    expect(typeof result.version).toBe('string');
    expect(typeof result.arch).toBe('string');
    expect(Object.keys(result).sort()).toEqual(['arch', 'platform', 'version']);
  });
});

// ============================================================================
// detectArch
// ============================================================================

describe('detectArch()', () => {
  it('should return a non-empty string', () => {
    const result = detectArch();
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('should match os.arch()', () => {
    expect(detectArch()).toBe(os.arch());
  });

  it('should return a known architecture value', () => {
    const knownArchs = ['arm64', 'x64', 'arm', 'ia32', 'x32', 'ppc64', 's390x', 'mips', 'mipsel'];
    expect(knownArchs).toContain(detectArch());
  });
});

// ============================================================================
// detectOSDetails
// ============================================================================

describe('detectOSDetails()', () => {
  it('should return an object with all required fields', () => {
    const result = detectOSDetails();
    expect(result).toHaveProperty('platform');
    expect(result).toHaveProperty('version');
    expect(result).toHaveProperty('arch');
    expect(result).toHaveProperty('label');
    expect(result).toHaveProperty('name');
  });

  it('should return a valid platform enum value', () => {
    const result = detectOSDetails();
    expect(['darwin', 'linux', 'win32']).toContain(result.platform);
  });

  it('should return a non-empty version string', () => {
    const result = detectOSDetails();
    expect(result.version.length).toBeGreaterThan(0);
  });

  it('should return a non-empty arch string', () => {
    const result = detectOSDetails();
    expect(result.arch.length).toBeGreaterThan(0);
  });

  it('should return a non-empty label string', () => {
    const result = detectOSDetails();
    expect(result.label.length).toBeGreaterThan(0);
  });

  it('should return a non-empty name string', () => {
    const result = detectOSDetails();
    expect(result.name.length).toBeGreaterThan(0);
  });

  it('should have label that contains the name', () => {
    const result = detectOSDetails();
    expect(result.label).toContain(result.name);
  });

  it('should have label that contains the version', () => {
    const result = detectOSDetails();
    expect(result.label).toContain(result.version);
  });

  it('should have label that contains the arch', () => {
    const result = detectOSDetails();
    expect(result.label).toContain(result.arch);
  });

  it('should have label in format "name version (arch)"', () => {
    const result = detectOSDetails();
    const expected = `${result.name} ${result.version} (${result.arch})`;
    expect(result.label).toBe(expected);
  });

  it('should return "macOS" as name on darwin', () => {
    const result = detectOSDetails();
    if (result.platform === 'darwin') {
      expect(result.name).toBe('macOS');
    }
  });

  it('should return "Windows" as name on win32', () => {
    const result = detectOSDetails();
    if (result.platform === 'win32') {
      expect(result.name).toBe('Windows');
    }
  });

  it('should not have distro/distroVersion on macOS', () => {
    const result = detectOSDetails();
    if (result.platform === 'darwin') {
      expect(result.distro).toBeUndefined();
      expect(result.distroVersion).toBeUndefined();
    }
  });

  it('should have consistent platform with detectOSType()', () => {
    const osType = detectOSType();
    const osDetails = detectOSDetails();
    expect(osDetails.platform).toBe(osType.platform);
    expect(osDetails.version).toBe(osType.version);
    expect(osDetails.arch).toBe(osType.arch);
  });

  it('should have consistent arch with detectArch()', () => {
    const result = detectOSDetails();
    expect(result.arch).toBe(detectArch());
  });
});

// ============================================================================
// OSInfo type
// ============================================================================

describe('OSInfo type', () => {
  it('should be compatible with the expected interface shape', () => {
    const info: OSInfo = {
      platform: 'darwin',
      version: '15.5',
      arch: 'arm64',
      label: 'macOS 15.5 (arm64)',
      name: 'macOS',
    };
    expect(info.platform).toBe('darwin');
    expect(info.name).toBe('macOS');
  });

  it('should support optional distro fields', () => {
    const info: OSInfo = {
      platform: 'linux',
      version: '6.5.0',
      arch: 'x64',
      label: 'Ubuntu 6.5.0 (x64)',
      name: 'Ubuntu',
      distro: 'Ubuntu',
      distroVersion: '22.04',
    };
    expect(info.distro).toBe('Ubuntu');
    expect(info.distroVersion).toBe('22.04');
  });

  it('should allow distro fields to be undefined', () => {
    const info: OSInfo = {
      platform: 'darwin',
      version: '15.0',
      arch: 'arm64',
      label: 'macOS 15.0 (arm64)',
      name: 'macOS',
      distro: undefined,
      distroVersion: undefined,
    };
    expect(info.distro).toBeUndefined();
    expect(info.distroVersion).toBeUndefined();
  });
});

// ============================================================================
// Code Quality
// ============================================================================

describe('detect/os.ts - code quality', () => {
  const filePath = path.resolve(__dirname, '../packages/agent/src/detect/os.ts');
  const content = readFileSync(filePath, 'utf-8');

  it('should use node:os import', () => {
    expect(content).toContain("from 'node:os'");
  });

  it('should use node:child_process import', () => {
    expect(content).toContain("from 'node:child_process'");
  });

  it('should import EnvironmentInfo type from @aiinstaller/shared', () => {
    expect(content).toContain('@aiinstaller/shared');
    expect(content).toContain('EnvironmentInfo');
  });

  it('should use type import for EnvironmentInfo', () => {
    expect(content).toMatch(/import\s+type\s+/);
  });

  it('should export detectOSType function', () => {
    expect(content).toMatch(/export\s+function\s+detectOSType/);
  });

  it('should export detectArch function', () => {
    expect(content).toMatch(/export\s+function\s+detectArch/);
  });

  it('should export detectOSDetails function', () => {
    expect(content).toMatch(/export\s+function\s+detectOSDetails/);
  });

  it('should export OSInfo interface', () => {
    expect(content).toMatch(/export\s+interface\s+OSInfo/);
  });

  it('should have JSDoc comments for exported functions', () => {
    expect(content).toContain('Detect the operating system type and version.');
    expect(content).toContain('Detect the CPU architecture.');
    expect(content).toContain('Detect detailed OS information');
  });

  it('should use spawnSync with timeout', () => {
    expect(content).toContain('spawnSync');
    expect(content).toContain('timeout');
  });

  it('should have a module docblock', () => {
    expect(content).toContain('@module detect/os');
  });
});
