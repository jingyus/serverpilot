// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { spawnSync } from 'node:child_process';

import {
  parseSemver,
  isAtLeast,
  detectNodeVersion,
  detectPythonVersion,
  detectRuntimeVersions,
  isNodeVersionSatisfied,
  detectRuntimeDetails,
} from './runtime.js';
import type { Semver } from './runtime.js';

// ============================================================================
// Mock
// ============================================================================

vi.mock('node:child_process', () => ({
  spawnSync: vi.fn(),
}));

const mockSpawnSync = vi.mocked(spawnSync);

// ============================================================================
// parseSemver
// ============================================================================

describe('parseSemver', () => {
  it('parses a valid semver string', () => {
    expect(parseSemver('22.1.0')).toEqual({ major: 22, minor: 1, patch: 0 });
  });

  it('parses a version with v prefix', () => {
    expect(parseSemver('v22.1.0')).toEqual({ major: 22, minor: 1, patch: 0 });
  });

  it('parses version embedded in text', () => {
    expect(parseSemver('Node.js v22.3.1')).toEqual({ major: 22, minor: 3, patch: 1 });
  });

  it('returns null for null input', () => {
    expect(parseSemver(null)).toBeNull();
  });

  it('returns null for undefined input', () => {
    expect(parseSemver(undefined)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseSemver('')).toBeNull();
  });

  it('returns null for string without version', () => {
    expect(parseSemver('no version here')).toBeNull();
  });

  it('parses first match when multiple versions present', () => {
    expect(parseSemver('v1.2.3 and v4.5.6')).toEqual({ major: 1, minor: 2, patch: 3 });
  });
});

// ============================================================================
// isAtLeast
// ============================================================================

describe('isAtLeast', () => {
  const min: Semver = { major: 22, minor: 0, patch: 0 };

  it('returns true when version equals minimum', () => {
    expect(isAtLeast({ major: 22, minor: 0, patch: 0 }, min)).toBe(true);
  });

  it('returns true when major is greater', () => {
    expect(isAtLeast({ major: 23, minor: 0, patch: 0 }, min)).toBe(true);
  });

  it('returns true when minor is greater', () => {
    expect(isAtLeast({ major: 22, minor: 1, patch: 0 }, min)).toBe(true);
  });

  it('returns true when patch is greater', () => {
    expect(isAtLeast({ major: 22, minor: 0, patch: 1 }, min)).toBe(true);
  });

  it('returns false when major is less', () => {
    expect(isAtLeast({ major: 21, minor: 9, patch: 9 }, min)).toBe(false);
  });

  it('returns false for null version', () => {
    expect(isAtLeast(null, min)).toBe(false);
  });
});

// ============================================================================
// detectNodeVersion
// ============================================================================

describe('detectNodeVersion', () => {
  it('returns the current Node.js version', () => {
    const version = detectNodeVersion();
    expect(version).toBeDefined();
    expect(version).toBe(process.versions.node);
  });

  it('returns a valid semver string', () => {
    const version = detectNodeVersion();
    expect(parseSemver(version!)).not.toBeNull();
  });
});

// ============================================================================
// detectPythonVersion
// ============================================================================

describe('detectPythonVersion', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
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
    expect(detectPythonVersion()).toBe('3.12.0');
  });

  it('falls back to python when python3 not available', () => {
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
    expect(detectPythonVersion()).toBe('3.11.5');
  });

  it('returns undefined when neither python3 nor python available', () => {
    mockSpawnSync.mockImplementation(() => {
      throw new Error('not found');
    });
    expect(detectPythonVersion()).toBeUndefined();
  });

  it('returns undefined when output has no version pattern', () => {
    mockSpawnSync.mockReturnValueOnce({
      stdout: 'something without a version\n',
      stderr: '',
      status: 0,
      signal: null,
      pid: 1,
      output: [],
    } as any);
    expect(detectPythonVersion()).toBeUndefined();
  });
});

// ============================================================================
// detectRuntimeVersions
// ============================================================================

describe('detectRuntimeVersions', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns object with node version', () => {
    const result = detectRuntimeVersions();
    expect(result.node).toBe(process.versions.node);
  });

  it('includes python when available', () => {
    mockSpawnSync.mockReturnValueOnce({
      stdout: 'Python 3.12.0\n',
      stderr: '',
      status: 0,
      signal: null,
      pid: 1,
      output: [],
    } as any);
    const result = detectRuntimeVersions();
    expect(result.python).toBe('3.12.0');
  });
});

// ============================================================================
// isNodeVersionSatisfied
// ============================================================================

describe('isNodeVersionSatisfied', () => {
  it('returns true for the current Node.js version (>= 22)', () => {
    // This project requires Node >= 22
    expect(isNodeVersionSatisfied()).toBe(true);
  });

  it('returns true for version 22.0.0', () => {
    expect(isNodeVersionSatisfied('22.0.0')).toBe(true);
  });

  it('returns true for version 24.1.0', () => {
    expect(isNodeVersionSatisfied('24.1.0')).toBe(true);
  });

  it('returns false for version 20.0.0', () => {
    expect(isNodeVersionSatisfied('20.0.0')).toBe(false);
  });

  it('returns false for version 18.19.0', () => {
    expect(isNodeVersionSatisfied('18.19.0')).toBe(false);
  });

  it('returns false for null', () => {
    expect(isNodeVersionSatisfied(null)).toBe(false);
  });
});

// ============================================================================
// detectRuntimeDetails
// ============================================================================

describe('detectRuntimeDetails', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns all RuntimeInfo fields', () => {
    const result = detectRuntimeDetails();
    expect(result).toHaveProperty('nodeExecPath');
    expect(result).toHaveProperty('nodeSatisfies');
    expect(result).toHaveProperty('label');
  });

  it('includes Node.js version', () => {
    const result = detectRuntimeDetails();
    expect(result.node).toBe(process.versions.node);
  });

  it('sets nodeSatisfies based on current version', () => {
    const result = detectRuntimeDetails();
    expect(result.nodeSatisfies).toBe(true);
  });

  it('generates a label with Node.js version', () => {
    const result = detectRuntimeDetails();
    expect(result.label).toContain('Node.js');
    expect(result.label).toContain(process.versions.node);
  });

  it('returns nodeExecPath from process.execPath', () => {
    const result = detectRuntimeDetails();
    expect(result.nodeExecPath).toBe(process.execPath);
  });
});
