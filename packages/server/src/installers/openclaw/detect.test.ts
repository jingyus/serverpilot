/**
 * Tests for OpenClaw server-side environment detection module.
 */

import { describe, it, expect } from 'vitest';
import type { EnvironmentInfo } from '@aiinstaller/shared';
import {
  MIN_NODE_MAJOR,
  MIN_NODE_VERSION,
  parseMajor,
  checkNodeVersion,
  checkPnpm,
  checkNetwork,
  checkPermissions,
  detectOpenClawReadiness,
} from './detect.js';

// ============================================================================
// Helpers
// ============================================================================

/** Create a base EnvironmentInfo where all checks would pass. */
function createPassingEnv(overrides?: Partial<EnvironmentInfo>): EnvironmentInfo {
  return {
    os: { platform: 'darwin', version: '24.0.0', arch: 'arm64' },
    shell: { type: 'zsh', version: '5.9' },
    runtime: { node: '22.1.0' },
    packageManagers: { pnpm: '9.1.0', npm: '10.2.0' },
    network: { canAccessNpm: true, canAccessGithub: true },
    permissions: { hasSudo: true, canWriteTo: ['/usr/local'] },
    ...overrides,
  };
}

/** Create a base EnvironmentInfo where all checks would fail. */
function createFailingEnv(): EnvironmentInfo {
  return {
    os: { platform: 'linux', version: '5.15.0', arch: 'x64' },
    shell: { type: 'bash', version: '5.0' },
    runtime: {},
    packageManagers: {},
    network: { canAccessNpm: false, canAccessGithub: false },
    permissions: { hasSudo: false, canWriteTo: [] },
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('detect (OpenClaw server-side)', () => {
  // --------------------------------------------------------------------------
  // Constants
  // --------------------------------------------------------------------------

  describe('constants', () => {
    it('should require Node.js >= 22', () => {
      expect(MIN_NODE_MAJOR).toBe(22);
    });

    it('should have a human-readable MIN_NODE_VERSION', () => {
      expect(MIN_NODE_VERSION).toBe('22.0.0');
    });
  });

  // --------------------------------------------------------------------------
  // parseMajor
  // --------------------------------------------------------------------------

  describe('parseMajor', () => {
    it('should parse plain version string', () => {
      expect(parseMajor('22.1.0')).toBe(22);
    });

    it('should parse version with v prefix', () => {
      expect(parseMajor('v22.1.0')).toBe(22);
    });

    it('should parse version 0.x.x', () => {
      expect(parseMajor('0.12.3')).toBe(0);
    });

    it('should parse large major versions', () => {
      expect(parseMajor('100.0.0')).toBe(100);
    });

    it('should return null for undefined', () => {
      expect(parseMajor(undefined)).toBeNull();
    });

    it('should return null for null', () => {
      expect(parseMajor(null)).toBeNull();
    });

    it('should return null for empty string', () => {
      expect(parseMajor('')).toBeNull();
    });

    it('should return null for non-semver string', () => {
      expect(parseMajor('not-a-version')).toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // checkNodeVersion
  // --------------------------------------------------------------------------

  describe('checkNodeVersion', () => {
    it('should pass for Node.js 22.x', () => {
      const env = createPassingEnv({ runtime: { node: '22.0.0' } });
      const result = checkNodeVersion(env);
      expect(result.passed).toBe(true);
      expect(result.message).toContain('22.0.0');
    });

    it('should pass for Node.js 24.x', () => {
      const env = createPassingEnv({ runtime: { node: '24.1.0' } });
      const result = checkNodeVersion(env);
      expect(result.passed).toBe(true);
    });

    it('should fail for Node.js 20.x', () => {
      const env = createPassingEnv({ runtime: { node: '20.10.0' } });
      const result = checkNodeVersion(env);
      expect(result.passed).toBe(false);
      expect(result.message).toContain('too old');
      expect(result.message).toContain('20.10.0');
    });

    it('should fail for Node.js 18.x', () => {
      const env = createPassingEnv({ runtime: { node: '18.19.0' } });
      const result = checkNodeVersion(env);
      expect(result.passed).toBe(false);
    });

    it('should fail when Node.js is not installed', () => {
      const env = createPassingEnv({ runtime: {} });
      const result = checkNodeVersion(env);
      expect(result.passed).toBe(false);
      expect(result.message).toContain('not installed');
    });

    it('should fail for unparseable version string', () => {
      const env = createPassingEnv({ runtime: { node: 'abc' } });
      const result = checkNodeVersion(env);
      expect(result.passed).toBe(false);
      expect(result.message).toContain('Unable to parse');
    });

    it('should pass for exact minimum version 22.0.0', () => {
      const env = createPassingEnv({ runtime: { node: '22.0.0' } });
      const result = checkNodeVersion(env);
      expect(result.passed).toBe(true);
    });

    it('should fail for Node.js 21.x', () => {
      const env = createPassingEnv({ runtime: { node: '21.7.0' } });
      const result = checkNodeVersion(env);
      expect(result.passed).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // checkPnpm
  // --------------------------------------------------------------------------

  describe('checkPnpm', () => {
    it('should pass when pnpm is installed', () => {
      const env = createPassingEnv({ packageManagers: { pnpm: '9.1.0' } });
      const result = checkPnpm(env);
      expect(result.passed).toBe(true);
      expect(result.message).toContain('9.1.0');
    });

    it('should pass for any pnpm version', () => {
      const env = createPassingEnv({ packageManagers: { pnpm: '7.0.0' } });
      const result = checkPnpm(env);
      expect(result.passed).toBe(true);
    });

    it('should fail when pnpm is not installed', () => {
      const env = createPassingEnv({ packageManagers: { npm: '10.0.0' } });
      const result = checkPnpm(env);
      expect(result.passed).toBe(false);
      expect(result.message).toContain('not installed');
    });

    it('should fail when packageManagers is empty', () => {
      const env = createPassingEnv({ packageManagers: {} });
      const result = checkPnpm(env);
      expect(result.passed).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // checkNetwork
  // --------------------------------------------------------------------------

  describe('checkNetwork', () => {
    it('should pass when npm registry is reachable', () => {
      const env = createPassingEnv({
        network: { canAccessNpm: true, canAccessGithub: true },
      });
      const result = checkNetwork(env);
      expect(result.passed).toBe(true);
      expect(result.message).toContain('reachable');
    });

    it('should pass when only npm is reachable (github not required)', () => {
      const env = createPassingEnv({
        network: { canAccessNpm: true, canAccessGithub: false },
      });
      const result = checkNetwork(env);
      expect(result.passed).toBe(true);
    });

    it('should fail when npm registry is unreachable', () => {
      const env = createPassingEnv({
        network: { canAccessNpm: false, canAccessGithub: true },
      });
      const result = checkNetwork(env);
      expect(result.passed).toBe(false);
      expect(result.message).toContain('Cannot reach');
    });

    it('should fail when both npm and github are unreachable', () => {
      const env = createPassingEnv({
        network: { canAccessNpm: false, canAccessGithub: false },
      });
      const result = checkNetwork(env);
      expect(result.passed).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // checkPermissions
  // --------------------------------------------------------------------------

  describe('checkPermissions', () => {
    it('should pass with sudo access', () => {
      const env = createPassingEnv({
        permissions: { hasSudo: true, canWriteTo: [] },
      });
      const result = checkPermissions(env);
      expect(result.passed).toBe(true);
      expect(result.message).toContain('sudo');
    });

    it('should pass with writable directories (no sudo)', () => {
      const env = createPassingEnv({
        permissions: { hasSudo: false, canWriteTo: ['/home/user/.local'] },
      });
      const result = checkPermissions(env);
      expect(result.passed).toBe(true);
      expect(result.message).toContain('/home/user/.local');
    });

    it('should pass with both sudo and writable directories', () => {
      const env = createPassingEnv({
        permissions: { hasSudo: true, canWriteTo: ['/usr/local'] },
      });
      const result = checkPermissions(env);
      expect(result.passed).toBe(true);
    });

    it('should fail with no sudo and no writable directories', () => {
      const env = createPassingEnv({
        permissions: { hasSudo: false, canWriteTo: [] },
      });
      const result = checkPermissions(env);
      expect(result.passed).toBe(false);
      expect(result.message).toContain('Insufficient permissions');
    });

    it('should list multiple writable directories', () => {
      const env = createPassingEnv({
        permissions: { hasSudo: false, canWriteTo: ['/home/user/.local', '/opt/node'] },
      });
      const result = checkPermissions(env);
      expect(result.passed).toBe(true);
      expect(result.message).toContain('/home/user/.local');
      expect(result.message).toContain('/opt/node');
    });
  });

  // --------------------------------------------------------------------------
  // detectOpenClawReadiness
  // --------------------------------------------------------------------------

  describe('detectOpenClawReadiness', () => {
    it('should return ready when all checks pass', () => {
      const env = createPassingEnv();
      const result = detectOpenClawReadiness(env);
      expect(result.ready).toBe(true);
      expect(result.checks.nodeVersion.passed).toBe(true);
      expect(result.checks.pnpm.passed).toBe(true);
      expect(result.checks.network.passed).toBe(true);
      expect(result.checks.permissions.passed).toBe(true);
      expect(result.summary).toContain('ready');
      expect(result.summary).toContain('4/4');
    });

    it('should return not ready when all checks fail', () => {
      const env = createFailingEnv();
      const result = detectOpenClawReadiness(env);
      expect(result.ready).toBe(false);
      expect(result.checks.nodeVersion.passed).toBe(false);
      expect(result.checks.pnpm.passed).toBe(false);
      expect(result.checks.network.passed).toBe(false);
      expect(result.checks.permissions.passed).toBe(false);
      expect(result.summary).toContain('not ready');
      expect(result.summary).toContain('4');
    });

    it('should return not ready when only one check fails (node)', () => {
      const env = createPassingEnv({ runtime: { node: '18.0.0' } });
      const result = detectOpenClawReadiness(env);
      expect(result.ready).toBe(false);
      expect(result.checks.nodeVersion.passed).toBe(false);
      expect(result.checks.pnpm.passed).toBe(true);
      expect(result.checks.network.passed).toBe(true);
      expect(result.checks.permissions.passed).toBe(true);
      expect(result.summary).toContain('1 check(s) failed');
    });

    it('should return not ready when only pnpm is missing', () => {
      const env = createPassingEnv({ packageManagers: { npm: '10.0.0' } });
      const result = detectOpenClawReadiness(env);
      expect(result.ready).toBe(false);
      expect(result.checks.pnpm.passed).toBe(false);
    });

    it('should return not ready when network is down', () => {
      const env = createPassingEnv({
        network: { canAccessNpm: false, canAccessGithub: false },
      });
      const result = detectOpenClawReadiness(env);
      expect(result.ready).toBe(false);
      expect(result.checks.network.passed).toBe(false);
    });

    it('should return not ready when permissions are insufficient', () => {
      const env = createPassingEnv({
        permissions: { hasSudo: false, canWriteTo: [] },
      });
      const result = detectOpenClawReadiness(env);
      expect(result.ready).toBe(false);
      expect(result.checks.permissions.passed).toBe(false);
    });

    it('should count multiple failures correctly', () => {
      const env = createPassingEnv({
        runtime: {},
        packageManagers: {},
      });
      const result = detectOpenClawReadiness(env);
      expect(result.ready).toBe(false);
      expect(result.summary).toContain('2 check(s) failed');
    });

    it('should work with a Linux environment', () => {
      const env: EnvironmentInfo = {
        os: { platform: 'linux', version: '5.15.0', arch: 'x64' },
        shell: { type: 'bash', version: '5.1' },
        runtime: { node: '22.5.0' },
        packageManagers: { pnpm: '9.0.0', npm: '10.0.0', apt: '2.4.0' },
        network: { canAccessNpm: true, canAccessGithub: true },
        permissions: { hasSudo: true, canWriteTo: ['/usr/local'] },
      };
      const result = detectOpenClawReadiness(env);
      expect(result.ready).toBe(true);
    });

    it('should work with a minimal passing Windows/WSL environment', () => {
      const env: EnvironmentInfo = {
        os: { platform: 'linux', version: '5.10.0', arch: 'x64' },
        shell: { type: 'bash', version: '5.0' },
        runtime: { node: '22.0.0' },
        packageManagers: { pnpm: '8.0.0' },
        network: { canAccessNpm: true, canAccessGithub: false },
        permissions: { hasSudo: false, canWriteTo: ['/home/user/.local/bin'] },
      };
      const result = detectOpenClawReadiness(env);
      expect(result.ready).toBe(true);
    });
  });
});
