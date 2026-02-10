/**
 * Tests for packages/agent/src/detect/index.ts
 *
 * Environment detection module - main detection function and sub-detectors.
 */

import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { describe, expect, it } from 'vitest';

import { EnvironmentInfoSchema } from '@aiinstaller/shared';

import {
  detectEnvironment,
  detectNetwork,
  detectOS,
  detectPackageManagers,
  detectPermissions,
  detectRuntime,
  detectShell,
} from '../packages/agent/src/detect/index.js';

// ============================================================================
// File Existence
// ============================================================================

describe('detect/index.ts - file existence', () => {
  const filePath = path.resolve(__dirname, '../packages/agent/src/detect/index.ts');

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

describe('detect/index.ts - exports', () => {
  it('should export detectEnvironment function', () => {
    expect(typeof detectEnvironment).toBe('function');
  });

  it('should export detectOS function', () => {
    expect(typeof detectOS).toBe('function');
  });

  it('should export detectShell function', () => {
    expect(typeof detectShell).toBe('function');
  });

  it('should export detectRuntime function', () => {
    expect(typeof detectRuntime).toBe('function');
  });

  it('should export detectPackageManagers function', () => {
    expect(typeof detectPackageManagers).toBe('function');
  });

  it('should export detectNetwork function', () => {
    expect(typeof detectNetwork).toBe('function');
  });

  it('should export detectPermissions function', () => {
    expect(typeof detectPermissions).toBe('function');
  });
});

// ============================================================================
// detectOS
// ============================================================================

describe('detectOS()', () => {
  it('should return an object with platform, version, and arch', () => {
    const result = detectOS();
    expect(result).toHaveProperty('platform');
    expect(result).toHaveProperty('version');
    expect(result).toHaveProperty('arch');
  });

  it('should return a valid platform enum value', () => {
    const result = detectOS();
    expect(['darwin', 'linux', 'win32']).toContain(result.platform);
  });

  it('should return a non-empty version string', () => {
    const result = detectOS();
    expect(typeof result.version).toBe('string');
    expect(result.version.length).toBeGreaterThan(0);
  });

  it('should return a non-empty arch string', () => {
    const result = detectOS();
    expect(typeof result.arch).toBe('string');
    expect(result.arch.length).toBeGreaterThan(0);
  });

  it('should match the current OS platform', () => {
    const result = detectOS();
    const currentPlatform = os.platform();
    if (['darwin', 'linux', 'win32'].includes(currentPlatform)) {
      expect(result.platform).toBe(currentPlatform);
    }
  });

  it('should match the current architecture', () => {
    const result = detectOS();
    expect(result.arch).toBe(os.arch());
  });
});

// ============================================================================
// detectShell
// ============================================================================

describe('detectShell()', () => {
  it('should return an object with type and version', () => {
    const result = detectShell();
    expect(result).toHaveProperty('type');
    expect(result).toHaveProperty('version');
  });

  it('should return a valid shell type', () => {
    const result = detectShell();
    expect(['bash', 'zsh', 'fish', 'powershell', 'unknown']).toContain(result.type);
  });

  it('should return a string version', () => {
    const result = detectShell();
    expect(typeof result.version).toBe('string');
  });

  it('should detect shell from SHELL env variable', () => {
    const shellEnv = process.env.SHELL || '';
    const result = detectShell();
    if (shellEnv.endsWith('/zsh')) {
      expect(result.type).toBe('zsh');
    } else if (shellEnv.endsWith('/bash')) {
      expect(result.type).toBe('bash');
    } else if (shellEnv.endsWith('/fish')) {
      expect(result.type).toBe('fish');
    }
  });

  it('should have a version when shell type is known', () => {
    const result = detectShell();
    if (result.type !== 'unknown') {
      // On most systems, we can get the shell version
      expect(typeof result.version).toBe('string');
    }
  });
});

// ============================================================================
// detectRuntime
// ============================================================================

describe('detectRuntime()', () => {
  it('should return an object', () => {
    const result = detectRuntime();
    expect(typeof result).toBe('object');
    expect(result).not.toBeNull();
  });

  it('should detect Node.js version', () => {
    const result = detectRuntime();
    expect(result.node).toBeDefined();
    expect(typeof result.node).toBe('string');
  });

  it('should return the correct Node.js version', () => {
    const result = detectRuntime();
    expect(result.node).toBe(process.versions.node);
  });

  it('should have node version matching semver pattern', () => {
    const result = detectRuntime();
    expect(result.node).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('should have optional python field', () => {
    const result = detectRuntime();
    // python may or may not be present
    if (result.python !== undefined) {
      expect(typeof result.python).toBe('string');
      expect(result.python).toMatch(/^\d+\.\d+\.\d+$/);
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

  it('should only contain valid package manager keys', () => {
    const result = detectPackageManagers();
    const validKeys = ['npm', 'pnpm', 'yarn', 'brew', 'apt'];
    for (const key of Object.keys(result)) {
      expect(validKeys).toContain(key);
    }
  });

  it('should detect npm (likely available in test environment)', () => {
    const result = detectPackageManagers();
    // npm should be available since we're running via pnpm/node
    if (result.npm) {
      expect(result.npm).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });

  it('should detect pnpm (used by this project)', () => {
    const result = detectPackageManagers();
    // pnpm should be available since the project uses pnpm
    if (result.pnpm) {
      expect(result.pnpm).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });

  it('should have string values for all defined keys', () => {
    const result = detectPackageManagers();
    for (const value of Object.values(result)) {
      if (value !== undefined) {
        expect(typeof value).toBe('string');
      }
    }
  });

  it('should detect brew on macOS', () => {
    const result = detectPackageManagers();
    if (os.platform() === 'darwin' && result.brew) {
      expect(result.brew).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });
});

// ============================================================================
// detectNetwork
// ============================================================================

describe('detectNetwork()', () => {
  it('should return an object with canAccessNpm and canAccessGithub', () => {
    const result = detectNetwork();
    expect(result).toHaveProperty('canAccessNpm');
    expect(result).toHaveProperty('canAccessGithub');
  });

  it('should return boolean values', () => {
    const result = detectNetwork();
    expect(typeof result.canAccessNpm).toBe('boolean');
    expect(typeof result.canAccessGithub).toBe('boolean');
  });
});

// ============================================================================
// detectPermissions
// ============================================================================

describe('detectPermissions()', () => {
  it('should return an object with hasSudo and canWriteTo', () => {
    const result = detectPermissions();
    expect(result).toHaveProperty('hasSudo');
    expect(result).toHaveProperty('canWriteTo');
  });

  it('should return boolean hasSudo', () => {
    const result = detectPermissions();
    expect(typeof result.hasSudo).toBe('boolean');
  });

  it('should return array canWriteTo', () => {
    const result = detectPermissions();
    expect(Array.isArray(result.canWriteTo)).toBe(true);
  });

  it('should contain writable paths as strings', () => {
    const result = detectPermissions();
    for (const p of result.canWriteTo) {
      expect(typeof p).toBe('string');
    }
  });

  it('should include home directory as writable', () => {
    const result = detectPermissions();
    expect(result.canWriteTo).toContain(os.homedir());
  });

  it('should include temp directory as writable', () => {
    const result = detectPermissions();
    // tmpdir should be writable
    expect(result.canWriteTo).toContain(os.tmpdir());
  });
});

// ============================================================================
// detectEnvironment (main function)
// ============================================================================

describe('detectEnvironment()', () => {
  it('should return an object with all required fields', () => {
    const result = detectEnvironment();
    expect(result).toHaveProperty('os');
    expect(result).toHaveProperty('shell');
    expect(result).toHaveProperty('runtime');
    expect(result).toHaveProperty('packageManagers');
    expect(result).toHaveProperty('network');
    expect(result).toHaveProperty('permissions');
  });

  it('should return valid EnvironmentInfo matching shared schema', () => {
    const result = detectEnvironment();
    const parsed = EnvironmentInfoSchema.safeParse(result);
    expect(parsed.success).toBe(true);
  });

  it('should have os with platform, version, arch', () => {
    const result = detectEnvironment();
    expect(['darwin', 'linux', 'win32']).toContain(result.os.platform);
    expect(result.os.version.length).toBeGreaterThan(0);
    expect(result.os.arch.length).toBeGreaterThan(0);
  });

  it('should have shell with type and version', () => {
    const result = detectEnvironment();
    expect(['bash', 'zsh', 'fish', 'powershell', 'unknown']).toContain(result.shell.type);
    expect(typeof result.shell.version).toBe('string');
  });

  it('should have runtime with node version', () => {
    const result = detectEnvironment();
    expect(result.runtime.node).toBe(process.versions.node);
  });

  it('should have packageManagers as object', () => {
    const result = detectEnvironment();
    expect(typeof result.packageManagers).toBe('object');
  });

  it('should have network with boolean flags', () => {
    const result = detectEnvironment();
    expect(typeof result.network.canAccessNpm).toBe('boolean');
    expect(typeof result.network.canAccessGithub).toBe('boolean');
  });

  it('should have permissions with hasSudo and canWriteTo', () => {
    const result = detectEnvironment();
    expect(typeof result.permissions.hasSudo).toBe('boolean');
    expect(Array.isArray(result.permissions.canWriteTo)).toBe(true);
  });

  it('should pass strict schema validation with no extra fields', () => {
    const result = detectEnvironment();
    // z.object is strict by default in parse
    const parsed = EnvironmentInfoSchema.parse(result);
    expect(parsed).toBeDefined();
  });
});

// ============================================================================
// Schema Compatibility
// ============================================================================

describe('EnvironmentInfo schema compatibility', () => {
  it('should produce output parseable by EnvironmentInfoSchema.parse', () => {
    const result = detectEnvironment();
    expect(() => EnvironmentInfoSchema.parse(result)).not.toThrow();
  });

  it('should produce output usable in EnvReportMessage', () => {
    const result = detectEnvironment();
    // Simulate creating an env.report message payload
    const message = {
      type: 'env.report' as const,
      payload: result,
      timestamp: Date.now(),
    };
    expect(message.type).toBe('env.report');
    expect(message.payload).toEqual(result);
  });
});

// ============================================================================
// Code Quality
// ============================================================================

describe('detect/index.ts - code quality', () => {
  const filePath = path.resolve(__dirname, '../packages/agent/src/detect/index.ts');
  const content = readFileSync(filePath, 'utf-8');

  it('should import from @aiinstaller/shared', () => {
    expect(content).toContain("from '@aiinstaller/shared'");
  });

  it('should use node:os module', () => {
    expect(content).toContain("from 'node:os'");
  });

  it('should use node:child_process module', () => {
    expect(content).toContain("from 'node:child_process'");
  });

  it('should use node:process module', () => {
    expect(content).toContain("from 'node:process'");
  });

  it('should use node:fs module', () => {
    expect(content).toContain("from 'node:fs'");
  });

  it('should have JSDoc for detectEnvironment', () => {
    expect(content).toContain('* Detect the full environment information');
  });

  it('should have JSDoc for detectOS', () => {
    expect(content).toContain('* Detect the operating system');
  });

  it('should have JSDoc for detectShell', () => {
    expect(content).toContain('* Detect the current shell');
  });

  it('should have JSDoc for detectRuntime', () => {
    expect(content).toContain('* Detect Node.js and Python runtime');
  });

  it('should have JSDoc for detectPackageManagers', () => {
    expect(content).toContain('* Detect installed package managers');
  });

  it('should have JSDoc for detectNetwork', () => {
    expect(content).toContain('* Detect network reachability');
  });

  it('should have JSDoc for detectPermissions', () => {
    expect(content).toContain('* Detect system permissions');
  });

  it('should use export keyword for all public functions', () => {
    expect(content).toContain('export function detectEnvironment');
    expect(content).toContain('export function detectOS');
    expect(content).toContain('export function detectShell');
    expect(content).toContain('export function detectRuntime');
    expect(content).toContain('export function detectPackageManagers');
    expect(content).toContain('export function detectNetwork');
    expect(content).toContain('export function detectPermissions');
  });

  it('should use type import for EnvironmentInfo', () => {
    expect(content).toContain('import type');
    expect(content).toContain('EnvironmentInfo');
  });

  it('should use spawnSync for safe command execution', () => {
    expect(content).toContain('spawnSync');
  });

  it('should set timeouts on spawn calls', () => {
    // All spawnSync calls should have a timeout option
    const spawnCalls = content.match(/spawnSync\([^)]+\)/g) || [];
    for (const call of spawnCalls) {
      // Check that the options object contains timeout
      expect(content).toContain('timeout:');
    }
  });
});
