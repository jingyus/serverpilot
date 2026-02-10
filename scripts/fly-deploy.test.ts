/**
 * Tests for Fly.io Deployment Module.
 *
 * Validates:
 * - Constants and defaults
 * - App name resolution
 * - Pre-deploy check functions
 * - Command building
 * - Dry-run deployment
 * - Real deployment orchestration
 * - Type exports
 * - Integration with fly.toml and other modules
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_APP_NAME,
  DEFAULT_DEPLOY_TIMEOUT,
  resolveAppName,
  checkFlyCli,
  checkFlyToml,
  checkDockerfile,
  checkFlyAuth,
  checkAppExists,
  runPreDeployChecks,
  buildDeployCommand,
  buildStatusCommand,
  deployToFly,
} from './fly-deploy';
import type {
  DeployPrecheck,
  FlyDeployResult,
  FlyStatusInfo,
} from './fly-deploy';

const ROOT_DIR = path.resolve(import.meta.dirname, '..');

// ============================================================================
// Constants
// ============================================================================

describe('Constants', () => {
  it('DEFAULT_APP_NAME should be aiinstaller-server', () => {
    expect(DEFAULT_APP_NAME).toBe('aiinstaller-server');
  });

  it('DEFAULT_DEPLOY_TIMEOUT should be 5 minutes', () => {
    expect(DEFAULT_DEPLOY_TIMEOUT).toBe(300000);
  });

  it('DEFAULT_DEPLOY_TIMEOUT should be a positive number', () => {
    expect(DEFAULT_DEPLOY_TIMEOUT).toBeGreaterThan(0);
  });
});

// ============================================================================
// resolveAppName
// ============================================================================

describe('resolveAppName()', () => {
  it('should return explicit app name when provided', () => {
    expect(resolveAppName('my-custom-app')).toBe('my-custom-app');
  });

  it('should read from fly.toml when no argument', () => {
    const result = resolveAppName();
    expect(result).toBe('aiinstaller-server');
  });

  it('should return a non-empty string', () => {
    expect(resolveAppName().length).toBeGreaterThan(0);
  });

  it('should match fly.toml app name', () => {
    const flyToml = fs.readFileSync(path.join(ROOT_DIR, 'fly.toml'), 'utf-8');
    const match = flyToml.match(/^app\s*=\s*"([^"]+)"/m);
    expect(match).not.toBeNull();
    expect(resolveAppName()).toBe(match![1]);
  });
});

// ============================================================================
// Pre-deploy Checks
// ============================================================================

describe('checkFlyCli()', () => {
  it('should return a DeployPrecheck object', () => {
    const result = checkFlyCli();
    expect(result).toHaveProperty('name');
    expect(result).toHaveProperty('passed');
    expect(result).toHaveProperty('message');
  });

  it('name should be "Fly CLI"', () => {
    expect(checkFlyCli().name).toBe('Fly CLI');
  });

  it('if installed, message should contain version info', () => {
    const result = checkFlyCli();
    if (result.passed) {
      expect(result.message).toContain('Installed');
    }
  });

  it('if not installed, should include install instructions', () => {
    const result = checkFlyCli();
    if (!result.passed) {
      expect(result.message).toContain('install');
    }
  });
});

describe('checkFlyToml()', () => {
  it('should return passed=true since fly.toml exists', () => {
    const result = checkFlyToml();
    expect(result.passed).toBe(true);
    expect(result.name).toBe('fly.toml');
  });

  it('message should indicate file found', () => {
    const result = checkFlyToml();
    expect(result.message).toContain('found');
  });
});

describe('checkDockerfile()', () => {
  it('should return passed=true since Dockerfile exists', () => {
    const result = checkDockerfile();
    expect(result.passed).toBe(true);
    expect(result.name).toBe('Dockerfile');
  });

  it('message should indicate Dockerfile found', () => {
    const result = checkDockerfile();
    expect(result.message).toContain('found');
  });
});

describe('checkFlyAuth()', () => {
  it('should return a DeployPrecheck object', () => {
    const result = checkFlyAuth();
    expect(result).toHaveProperty('name');
    expect(result).toHaveProperty('passed');
    expect(result).toHaveProperty('message');
  });

  it('name should be "Fly Auth"', () => {
    expect(checkFlyAuth().name).toBe('Fly Auth');
  });

  it('if authenticated, should mention user info', () => {
    const result = checkFlyAuth();
    if (result.passed) {
      expect(result.message).toContain('Authenticated');
    }
  });

  it('if not authenticated, should include login instructions', () => {
    const result = checkFlyAuth();
    if (!result.passed) {
      expect(result.message).toContain('login');
    }
  });
});

describe('checkAppExists()', () => {
  it('should return a DeployPrecheck for a known app', () => {
    const result = checkAppExists('aiinstaller-server');
    expect(result).toHaveProperty('name');
    expect(result).toHaveProperty('passed');
    expect(result).toHaveProperty('message');
    expect(result.name).toBe('App Exists');
  });

  it('should handle nonexistent app gracefully', () => {
    const result = checkAppExists('nonexistent-app-xyz-999');
    expect(typeof result.passed).toBe('boolean');
    expect(result.message.length).toBeGreaterThan(0);
  });
});

describe('runPreDeployChecks()', () => {
  it('should return 5 checks', () => {
    const checks = runPreDeployChecks('aiinstaller-server');
    expect(checks).toHaveLength(5);
  });

  it('should include all required check types', () => {
    const checks = runPreDeployChecks('aiinstaller-server');
    const names = checks.map((c) => c.name);
    expect(names).toContain('Fly CLI');
    expect(names).toContain('fly.toml');
    expect(names).toContain('Dockerfile');
    expect(names).toContain('Fly Auth');
    expect(names).toContain('App Exists');
  });

  it('fly.toml and Dockerfile checks should pass', () => {
    const checks = runPreDeployChecks('aiinstaller-server');
    const toml = checks.find((c) => c.name === 'fly.toml');
    const docker = checks.find((c) => c.name === 'Dockerfile');
    expect(toml?.passed).toBe(true);
    expect(docker?.passed).toBe(true);
  });

  it('each check should conform to DeployPrecheck interface', () => {
    const checks = runPreDeployChecks('aiinstaller-server');
    for (const check of checks) {
      expect(typeof check.name).toBe('string');
      expect(typeof check.passed).toBe('boolean');
      expect(typeof check.message).toBe('string');
    }
  });
});

// ============================================================================
// Command Building
// ============================================================================

describe('buildDeployCommand()', () => {
  it('should include fly deploy', () => {
    const cmd = buildDeployCommand('my-app');
    expect(cmd).toContain('fly deploy');
  });

  it('should include --app flag', () => {
    const cmd = buildDeployCommand('my-app');
    expect(cmd).toContain('--app my-app');
  });

  it('should use different app names', () => {
    const cmd1 = buildDeployCommand('app-one');
    const cmd2 = buildDeployCommand('app-two');
    expect(cmd1).toContain('app-one');
    expect(cmd2).toContain('app-two');
    expect(cmd1).not.toEqual(cmd2);
  });
});

describe('buildStatusCommand()', () => {
  it('should include fly status', () => {
    const cmd = buildStatusCommand('my-app');
    expect(cmd).toContain('fly status');
  });

  it('should include --app flag', () => {
    const cmd = buildStatusCommand('my-app');
    expect(cmd).toContain('--app my-app');
  });
});

// ============================================================================
// deployToFly() - Dry Run
// ============================================================================

describe('deployToFly() dry-run', () => {
  it('should succeed in dry-run mode', () => {
    const result = deployToFly(true);
    expect(result.success).toBe(true);
    expect(result.action).toBe('dry-run');
  });

  it('should use default app name', () => {
    const result = deployToFly(true);
    expect(result.appName).toBe(DEFAULT_APP_NAME);
  });

  it('should include hostname', () => {
    const result = deployToFly(true);
    expect(result.hostname).toBe(`${DEFAULT_APP_NAME}.fly.dev`);
  });

  it('should mention fly deploy in message', () => {
    const result = deployToFly(true);
    expect(result.message).toContain('fly deploy');
    expect(result.message).toContain('dry-run');
  });

  it('should use custom app name', () => {
    const result = deployToFly(true, 'custom-app');
    expect(result.appName).toBe('custom-app');
    expect(result.hostname).toBe('custom-app.fly.dev');
  });

  it('dry-run result should conform to FlyDeployResult interface', () => {
    const result: FlyDeployResult = deployToFly(true);
    expect(typeof result.success).toBe('boolean');
    expect(typeof result.appName).toBe('string');
    expect(typeof result.action).toBe('string');
    expect(typeof result.message).toBe('string');
  });
});

// ============================================================================
// deployToFly() - Real execution
// ============================================================================

describe('deployToFly() real execution', () => {
  it('should return a valid FlyDeployResult', () => {
    const result = deployToFly(false);
    expect(result).toHaveProperty('success');
    expect(result).toHaveProperty('appName');
    expect(result).toHaveProperty('action');
    expect(result).toHaveProperty('message');
  });

  it('appName should be set', () => {
    const result = deployToFly(false);
    expect(result.appName.length).toBeGreaterThan(0);
  });

  it('action should be a valid value', () => {
    const result = deployToFly(false);
    expect(['deployed', 'skipped', 'dry-run']).toContain(result.action);
  });

  it('message should be non-empty', () => {
    const result = deployToFly(false);
    expect(result.message.length).toBeGreaterThan(0);
  });

  it('if skipped, should explain why', () => {
    const result = deployToFly(false);
    if (result.action === 'skipped') {
      expect(result.message.length).toBeGreaterThan(10);
    }
  });
});

// ============================================================================
// Type exports
// ============================================================================

describe('Type exports', () => {
  it('DeployPrecheck type should be usable', () => {
    const check: DeployPrecheck = { name: 'test', passed: true, message: 'ok' };
    expect(check.passed).toBe(true);
  });

  it('FlyDeployResult type should be usable', () => {
    const result: FlyDeployResult = {
      success: true,
      appName: 'test',
      action: 'deployed',
      message: 'done',
      hostname: 'test.fly.dev',
    };
    expect(result.success).toBe(true);
    expect(result.action).toBe('deployed');
  });

  it('FlyDeployResult action should cover all values', () => {
    const actions: FlyDeployResult['action'][] = ['deployed', 'skipped', 'dry-run'];
    expect(actions).toHaveLength(3);
  });

  it('FlyStatusInfo type should be usable', () => {
    const info: FlyStatusInfo = {
      appName: 'test',
      status: 'running',
      hostname: 'test.fly.dev',
      version: '1',
      machines: 2,
    };
    expect(info.appName).toBe('test');
    expect(info.machines).toBe(2);
  });
});

// ============================================================================
// Integration: consistency
// ============================================================================

describe('Integration: consistency with fly.toml', () => {
  it('resolveAppName should match fly.toml', () => {
    const content = fs.readFileSync(path.join(ROOT_DIR, 'fly.toml'), 'utf-8');
    const match = content.match(/^app\s*=\s*"([^"]+)"/m);
    expect(match).not.toBeNull();
    expect(resolveAppName()).toBe(match![1]);
  });

  it('buildDeployCommand with resolved name should be valid', () => {
    const appName = resolveAppName();
    const cmd = buildDeployCommand(appName);
    expect(cmd).toMatch(/^fly deploy --app \S+$/);
  });

  it('dry-run should not modify any files', () => {
    const tomlBefore = fs.readFileSync(path.join(ROOT_DIR, 'fly.toml'), 'utf-8');
    deployToFly(true);
    const tomlAfter = fs.readFileSync(path.join(ROOT_DIR, 'fly.toml'), 'utf-8');
    expect(tomlAfter).toBe(tomlBefore);
  });
});

describe('Integration: consistency with deployment docs', () => {
  it('deployment docs should mention fly deploy', () => {
    const deployDoc = fs.readFileSync(
      path.join(ROOT_DIR, 'docs/deployment.md'),
      'utf-8',
    );
    expect(deployDoc).toContain('fly deploy');
  });

  it('deployment docs should mention fly status', () => {
    const deployDoc = fs.readFileSync(
      path.join(ROOT_DIR, 'docs/deployment.md'),
      'utf-8',
    );
    expect(deployDoc).toContain('fly status');
  });

  it('deployment docs should mention fly logs', () => {
    const deployDoc = fs.readFileSync(
      path.join(ROOT_DIR, 'docs/deployment.md'),
      'utf-8',
    );
    expect(deployDoc).toContain('fly logs');
  });
});
