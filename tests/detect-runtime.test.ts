/**
 * Tests for packages/agent/src/detect/runtime.ts
 *
 * Runtime detection module - Node.js and Python version detection,
 * semver parsing, version validation, and detailed runtime info.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { describe, expect, it } from 'vitest';

import {
  detectNodeVersion,
  detectPythonVersion,
  detectRuntimeDetails,
  detectRuntimeVersions,
  isAtLeast,
  isNodeVersionSatisfied,
  parseSemver,
} from '../packages/agent/src/detect/runtime.js';
import type { RuntimeInfo, Semver } from '../packages/agent/src/detect/runtime.js';
import { EnvironmentInfoSchema } from '@aiinstaller/shared';

// ============================================================================
// File Existence
// ============================================================================

describe('detect/runtime.ts - file existence', () => {
  const filePath = path.resolve(__dirname, '../packages/agent/src/detect/runtime.ts');

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

describe('detect/runtime.ts - exports', () => {
  it('should export parseSemver function', () => {
    expect(typeof parseSemver).toBe('function');
  });

  it('should export isAtLeast function', () => {
    expect(typeof isAtLeast).toBe('function');
  });

  it('should export detectNodeVersion function', () => {
    expect(typeof detectNodeVersion).toBe('function');
  });

  it('should export detectPythonVersion function', () => {
    expect(typeof detectPythonVersion).toBe('function');
  });

  it('should export detectRuntimeVersions function', () => {
    expect(typeof detectRuntimeVersions).toBe('function');
  });

  it('should export isNodeVersionSatisfied function', () => {
    expect(typeof isNodeVersionSatisfied).toBe('function');
  });

  it('should export detectRuntimeDetails function', () => {
    expect(typeof detectRuntimeDetails).toBe('function');
  });
});

// ============================================================================
// parseSemver
// ============================================================================

describe('parseSemver()', () => {
  it('should parse a valid semver string', () => {
    const result = parseSemver('22.1.0');
    expect(result).toEqual({ major: 22, minor: 1, patch: 0 });
  });

  it('should parse a version with v prefix', () => {
    const result = parseSemver('v24.1.0');
    expect(result).toEqual({ major: 24, minor: 1, patch: 0 });
  });

  it('should parse a version embedded in text', () => {
    const result = parseSemver('Python 3.12.4');
    expect(result).toEqual({ major: 3, minor: 12, patch: 4 });
  });

  it('should return null for null input', () => {
    expect(parseSemver(null)).toBeNull();
  });

  it('should return null for undefined input', () => {
    expect(parseSemver(undefined)).toBeNull();
  });

  it('should return null for empty string', () => {
    expect(parseSemver('')).toBeNull();
  });

  it('should return null for non-semver string', () => {
    expect(parseSemver('not-a-version')).toBeNull();
  });

  it('should return null for incomplete version', () => {
    expect(parseSemver('22.1')).toBeNull();
  });

  it('should parse version 0.0.0', () => {
    const result = parseSemver('0.0.0');
    expect(result).toEqual({ major: 0, minor: 0, patch: 0 });
  });

  it('should parse the first semver match in a string', () => {
    const result = parseSemver('node v22.1.0 (linux)');
    expect(result).toEqual({ major: 22, minor: 1, patch: 0 });
  });
});

// ============================================================================
// isAtLeast
// ============================================================================

describe('isAtLeast()', () => {
  const min: Semver = { major: 22, minor: 0, patch: 0 };

  it('should return true for exact match', () => {
    expect(isAtLeast({ major: 22, minor: 0, patch: 0 }, min)).toBe(true);
  });

  it('should return true for higher major', () => {
    expect(isAtLeast({ major: 24, minor: 0, patch: 0 }, min)).toBe(true);
  });

  it('should return true for higher minor', () => {
    expect(isAtLeast({ major: 22, minor: 1, patch: 0 }, min)).toBe(true);
  });

  it('should return true for higher patch', () => {
    expect(isAtLeast({ major: 22, minor: 0, patch: 1 }, min)).toBe(true);
  });

  it('should return false for lower major', () => {
    expect(isAtLeast({ major: 20, minor: 0, patch: 0 }, min)).toBe(false);
  });

  it('should return false for lower minor with same major', () => {
    // major matches, minor is 0 which equals min.minor, patch 0 equals min.patch -> true
    // Need a case where minor is actually less:
    // min is 22.0.0, so with major=22 and minor=0, it's equal (true)
    // Let's test with a different minimum
    const min2: Semver = { major: 22, minor: 2, patch: 0 };
    expect(isAtLeast({ major: 22, minor: 1, patch: 0 }, min2)).toBe(false);
  });

  it('should return false for lower patch with same major.minor', () => {
    const min2: Semver = { major: 22, minor: 0, patch: 5 };
    expect(isAtLeast({ major: 22, minor: 0, patch: 3 }, min2)).toBe(false);
  });

  it('should return false for null version', () => {
    expect(isAtLeast(null, min)).toBe(false);
  });
});

// ============================================================================
// detectNodeVersion
// ============================================================================

describe('detectNodeVersion()', () => {
  it('should return a string', () => {
    const result = detectNodeVersion();
    expect(typeof result).toBe('string');
  });

  it('should return the current Node.js version', () => {
    const result = detectNodeVersion();
    expect(result).toBe(process.versions.node);
  });

  it('should return a valid semver format', () => {
    const result = detectNodeVersion();
    expect(result).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('should be parseable by parseSemver', () => {
    const result = detectNodeVersion();
    const parsed = parseSemver(result!);
    expect(parsed).not.toBeNull();
    expect(parsed!.major).toBeGreaterThanOrEqual(1);
  });
});

// ============================================================================
// detectPythonVersion
// ============================================================================

describe('detectPythonVersion()', () => {
  it('should return a string or undefined', () => {
    const result = detectPythonVersion();
    if (result !== undefined) {
      expect(typeof result).toBe('string');
    } else {
      expect(result).toBeUndefined();
    }
  });

  it('should return a valid semver format if python is available', () => {
    const result = detectPythonVersion();
    if (result) {
      expect(result).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });

  it('should be parseable by parseSemver if available', () => {
    const result = detectPythonVersion();
    if (result) {
      const parsed = parseSemver(result);
      expect(parsed).not.toBeNull();
      expect(parsed!.major).toBeGreaterThanOrEqual(2);
    }
  });
});

// ============================================================================
// detectRuntimeVersions
// ============================================================================

describe('detectRuntimeVersions()', () => {
  it('should return an object', () => {
    const result = detectRuntimeVersions();
    expect(typeof result).toBe('object');
    expect(result).not.toBeNull();
  });

  it('should include node version', () => {
    const result = detectRuntimeVersions();
    expect(result.node).toBeDefined();
    expect(typeof result.node).toBe('string');
  });

  it('should return the correct Node.js version', () => {
    const result = detectRuntimeVersions();
    expect(result.node).toBe(process.versions.node);
  });

  it('should have python as optional', () => {
    const result = detectRuntimeVersions();
    // python may or may not be available
    if (result.python !== undefined) {
      expect(typeof result.python).toBe('string');
      expect(result.python).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });

  it('should be compatible with EnvironmentInfo runtime schema', () => {
    const result = detectRuntimeVersions();
    // Only node and python keys are expected
    const keys = Object.keys(result);
    for (const key of keys) {
      expect(['node', 'python']).toContain(key);
    }
  });
});

// ============================================================================
// isNodeVersionSatisfied
// ============================================================================

describe('isNodeVersionSatisfied()', () => {
  it('should return true for the current Node.js version (>= 22)', () => {
    // Current dev environment uses Node 24.x
    const result = isNodeVersionSatisfied();
    expect(result).toBe(true);
  });

  it('should return true for version 22.0.0', () => {
    expect(isNodeVersionSatisfied('22.0.0')).toBe(true);
  });

  it('should return true for version 24.1.0', () => {
    expect(isNodeVersionSatisfied('24.1.0')).toBe(true);
  });

  it('should return false for version 20.0.0', () => {
    expect(isNodeVersionSatisfied('20.0.0')).toBe(false);
  });

  it('should return false for version 18.19.0', () => {
    expect(isNodeVersionSatisfied('18.19.0')).toBe(false);
  });

  it('should return false for null', () => {
    expect(isNodeVersionSatisfied(null)).toBe(false);
  });

  it('should return false for invalid version string', () => {
    expect(isNodeVersionSatisfied('not-a-version')).toBe(false);
  });

  it('should use current process version when no argument', () => {
    const result = isNodeVersionSatisfied();
    const expected = isAtLeast(parseSemver(process.versions.node), { major: 22, minor: 0, patch: 0 });
    expect(result).toBe(expected);
  });
});

// ============================================================================
// detectRuntimeDetails
// ============================================================================

describe('detectRuntimeDetails()', () => {
  it('should return an object with all required fields', () => {
    const result = detectRuntimeDetails();
    expect(result).toHaveProperty('node');
    expect(result).toHaveProperty('nodeExecPath');
    expect(result).toHaveProperty('nodeSatisfies');
    expect(result).toHaveProperty('label');
  });

  it('should have node version matching process.versions.node', () => {
    const result = detectRuntimeDetails();
    expect(result.node).toBe(process.versions.node);
  });

  it('should have nodeExecPath matching process.execPath', () => {
    const result = detectRuntimeDetails();
    expect(result.nodeExecPath).toBe(process.execPath);
  });

  it('should have nodeSatisfies as true for current environment', () => {
    const result = detectRuntimeDetails();
    expect(result.nodeSatisfies).toBe(true);
  });

  it('should have a non-empty label', () => {
    const result = detectRuntimeDetails();
    expect(result.label.length).toBeGreaterThan(0);
  });

  it('should have label containing "Node.js"', () => {
    const result = detectRuntimeDetails();
    expect(result.label).toContain('Node.js');
  });

  it('should have label containing the node version', () => {
    const result = detectRuntimeDetails();
    expect(result.label).toContain(process.versions.node);
  });

  it('should have python as optional string or undefined', () => {
    const result = detectRuntimeDetails();
    if (result.python !== undefined) {
      expect(typeof result.python).toBe('string');
      expect(result.python).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });
});

// ============================================================================
// RuntimeInfo type
// ============================================================================

describe('RuntimeInfo type', () => {
  it('should be compatible with the expected interface shape', () => {
    const info: RuntimeInfo = {
      node: '24.1.0',
      python: '3.12.0',
      nodeExecPath: '/usr/local/bin/node',
      nodeSatisfies: true,
      label: 'Node.js 24.1.0',
    };
    expect(info.node).toBe('24.1.0');
    expect(info.python).toBe('3.12.0');
    expect(info.nodeSatisfies).toBe(true);
  });

  it('should allow optional fields to be undefined', () => {
    const info: RuntimeInfo = {
      node: undefined,
      python: undefined,
      nodeExecPath: '',
      nodeSatisfies: false,
      label: 'Unknown runtime',
    };
    expect(info.node).toBeUndefined();
    expect(info.python).toBeUndefined();
    expect(info.nodeSatisfies).toBe(false);
  });
});

// ============================================================================
// Semver type
// ============================================================================

describe('Semver type', () => {
  it('should be compatible with the expected interface shape', () => {
    const sv: Semver = { major: 22, minor: 1, patch: 0 };
    expect(sv.major).toBe(22);
    expect(sv.minor).toBe(1);
    expect(sv.patch).toBe(0);
  });
});

// ============================================================================
// Schema Compatibility
// ============================================================================

describe('Schema compatibility', () => {
  it('should produce EnvironmentInfo-compatible runtime object', () => {
    const result = detectRuntimeVersions();
    const envInfo = {
      os: { platform: 'darwin', version: '15.5', arch: 'arm64' },
      shell: { type: 'zsh', version: '5.9' },
      runtime: result,
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

describe('detect/runtime.ts - code quality', () => {
  const filePath = path.resolve(__dirname, '../packages/agent/src/detect/runtime.ts');
  const content = readFileSync(filePath, 'utf-8');

  it('should use node:child_process import', () => {
    expect(content).toContain("from 'node:child_process'");
  });

  it('should use node:process import', () => {
    expect(content).toContain("from 'node:process'");
  });

  it('should import EnvironmentInfo type from @aiinstaller/shared', () => {
    expect(content).toContain('@aiinstaller/shared');
    expect(content).toContain('EnvironmentInfo');
  });

  it('should use type import for EnvironmentInfo', () => {
    expect(content).toMatch(/import\s+type\s+/);
  });

  it('should export parseSemver function', () => {
    expect(content).toMatch(/export\s+function\s+parseSemver/);
  });

  it('should export isAtLeast function', () => {
    expect(content).toMatch(/export\s+function\s+isAtLeast/);
  });

  it('should export detectNodeVersion function', () => {
    expect(content).toMatch(/export\s+function\s+detectNodeVersion/);
  });

  it('should export detectPythonVersion function', () => {
    expect(content).toMatch(/export\s+function\s+detectPythonVersion/);
  });

  it('should export detectRuntimeVersions function', () => {
    expect(content).toMatch(/export\s+function\s+detectRuntimeVersions/);
  });

  it('should export isNodeVersionSatisfied function', () => {
    expect(content).toMatch(/export\s+function\s+isNodeVersionSatisfied/);
  });

  it('should export detectRuntimeDetails function', () => {
    expect(content).toMatch(/export\s+function\s+detectRuntimeDetails/);
  });

  it('should export Semver interface', () => {
    expect(content).toMatch(/export\s+interface\s+Semver/);
  });

  it('should export RuntimeInfo interface', () => {
    expect(content).toMatch(/export\s+interface\s+RuntimeInfo/);
  });

  it('should have JSDoc comments for exported functions', () => {
    expect(content).toContain('Parse a version string into a Semver object.');
    expect(content).toContain('Check if a semver version is at least the given minimum.');
    expect(content).toContain('Detect the Node.js version');
    expect(content).toContain('Detect the Python version');
    expect(content).toContain('Detect basic runtime versions');
    expect(content).toContain('Check if the current Node.js version satisfies');
    expect(content).toContain('Detect detailed runtime information');
  });

  it('should use spawnSync with timeout for Python detection', () => {
    expect(content).toContain('spawnSync');
    expect(content).toContain('timeout');
  });

  it('should have a module docblock', () => {
    expect(content).toContain('@module detect/runtime');
  });

  it('should reference openclaw-modules/infra/runtime-guard.ts inspiration', () => {
    expect(content).toContain('runtime-guard');
  });
});
