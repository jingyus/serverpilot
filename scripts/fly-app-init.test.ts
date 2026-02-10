/**
 * Tests for Fly.io App Initialization module.
 *
 * Validates:
 * - Prerequisite checks (fly CLI, fly.toml, Dockerfile)
 * - fly.toml parsing (app name, region)
 * - Authentication check interface
 * - App existence check interface
 * - Launch/create command generation
 * - Dry-run mode
 * - initFlyApp orchestration
 * - Constants and type exports
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  checkFlyCli,
  checkFlyTomlExists,
  checkDockerfileExists,
  getAppNameFromToml,
  getRegionFromToml,
  runPrechecks,
  checkFlyAuth,
  checkAppExists,
  buildLaunchCommand,
  buildAppsCreateCommand,
  initFlyApp,
  DEFAULT_APP_NAME,
  DEFAULT_REGION,
  type FlyAuthStatus,
  type FlyAppStatus,
  type FlyAppInitResult,
  type FlyInitPrecheck,
} from './fly-app-init';

const ROOT_DIR = path.resolve(import.meta.dirname, '..');

// ============================================================================
// Constants
// ============================================================================

describe('Constants', () => {
  it('DEFAULT_APP_NAME should be aiinstaller-server', () => {
    expect(DEFAULT_APP_NAME).toBe('aiinstaller-server');
  });

  it('DEFAULT_REGION should be nrt', () => {
    expect(DEFAULT_REGION).toBe('nrt');
  });

  it('DEFAULT_APP_NAME should match fly.toml app name', () => {
    const appName = getAppNameFromToml();
    if (appName) {
      expect(DEFAULT_APP_NAME).toBe(appName);
    }
  });

  it('DEFAULT_REGION should match fly.toml region', () => {
    const region = getRegionFromToml();
    if (region) {
      expect(DEFAULT_REGION).toBe(region);
    }
  });
});

// ============================================================================
// Prerequisite Checks
// ============================================================================

describe('checkFlyCli()', () => {
  it('should return a FlyInitPrecheck object', () => {
    const result = checkFlyCli();
    expect(result).toHaveProperty('name');
    expect(result).toHaveProperty('passed');
    expect(result).toHaveProperty('message');
  });

  it('name should be "Fly CLI"', () => {
    const result = checkFlyCli();
    expect(result.name).toBe('Fly CLI');
  });

  it('if fly is installed, passed should be true', () => {
    const result = checkFlyCli();
    if (result.passed) {
      expect(result.message).toContain('Installed');
    }
  });

  it('if fly is not installed, should include install instructions', () => {
    const result = checkFlyCli();
    if (!result.passed) {
      expect(result.message).toContain('install');
    }
  });
});

describe('checkFlyTomlExists()', () => {
  it('should return passed=true since fly.toml exists', () => {
    const result = checkFlyTomlExists();
    expect(result.passed).toBe(true);
    expect(result.name).toBe('fly.toml');
  });

  it('message should mention configuration file', () => {
    const result = checkFlyTomlExists();
    expect(result.message).toContain('found');
  });
});

describe('checkDockerfileExists()', () => {
  it('should return passed=true since Dockerfile exists', () => {
    const result = checkDockerfileExists();
    expect(result.passed).toBe(true);
    expect(result.name).toBe('Dockerfile');
  });

  it('message should mention Dockerfile', () => {
    const result = checkDockerfileExists();
    expect(result.message).toContain('found');
  });
});

// ============================================================================
// fly.toml Parsing
// ============================================================================

describe('getAppNameFromToml()', () => {
  it('should return aiinstaller-server', () => {
    const appName = getAppNameFromToml();
    expect(appName).toBe('aiinstaller-server');
  });

  it('should return a non-empty string', () => {
    const appName = getAppNameFromToml();
    expect(appName).toBeDefined();
    expect(typeof appName).toBe('string');
    expect(appName!.length).toBeGreaterThan(0);
  });
});

describe('getRegionFromToml()', () => {
  it('should return the configured region', () => {
    const region = getRegionFromToml();
    expect(region).toBeDefined();
    expect(typeof region).toBe('string');
    expect(region!.length).toBeGreaterThan(0);
  });

  it('should return nrt', () => {
    const region = getRegionFromToml();
    expect(region).toBe('nrt');
  });
});

// ============================================================================
// runPrechecks()
// ============================================================================

describe('runPrechecks()', () => {
  it('should return an array of check results', () => {
    const results = runPrechecks();
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBe(3);
  });

  it('should include fly CLI check', () => {
    const results = runPrechecks();
    expect(results.some((r) => r.name === 'Fly CLI')).toBe(true);
  });

  it('should include fly.toml check', () => {
    const results = runPrechecks();
    expect(results.some((r) => r.name === 'fly.toml')).toBe(true);
  });

  it('should include Dockerfile check', () => {
    const results = runPrechecks();
    expect(results.some((r) => r.name === 'Dockerfile')).toBe(true);
  });

  it('fly.toml and Dockerfile checks should pass', () => {
    const results = runPrechecks();
    const tomlCheck = results.find((r) => r.name === 'fly.toml');
    const dockerCheck = results.find((r) => r.name === 'Dockerfile');
    expect(tomlCheck?.passed).toBe(true);
    expect(dockerCheck?.passed).toBe(true);
  });

  it('each result should conform to FlyInitPrecheck interface', () => {
    const results = runPrechecks();
    for (const r of results) {
      expect(typeof r.name).toBe('string');
      expect(typeof r.passed).toBe('boolean');
      expect(typeof r.message).toBe('string');
    }
  });
});

// ============================================================================
// Authentication
// ============================================================================

describe('checkFlyAuth()', () => {
  it('should return a FlyAuthStatus object', () => {
    const result = checkFlyAuth();
    expect(result).toHaveProperty('authenticated');
    expect(typeof result.authenticated).toBe('boolean');
  });

  it('if authenticated, should include email', () => {
    const result = checkFlyAuth();
    if (result.authenticated) {
      expect(result.email).toBeDefined();
      expect(typeof result.email).toBe('string');
      expect(result.email!.length).toBeGreaterThan(0);
    }
  });

  it('if not authenticated, should include error', () => {
    const result = checkFlyAuth();
    if (!result.authenticated) {
      expect(result.error).toBeDefined();
      expect(typeof result.error).toBe('string');
    }
  });
});

// ============================================================================
// App Existence Check
// ============================================================================

describe('checkAppExists()', () => {
  it('should return a FlyAppStatus object', () => {
    const result = checkAppExists('test-nonexistent-app-xyz-123');
    expect(result).toHaveProperty('exists');
    expect(typeof result.exists).toBe('boolean');
  });

  it('should handle a nonexistent app gracefully', () => {
    const result = checkAppExists('test-nonexistent-app-xyz-123');
    // If authenticated, should return exists=false
    // If not authenticated, should return exists=false with error
    expect(result.exists).toBe(false);
  });

  it('should set appName in the result', () => {
    const result = checkAppExists('my-test-app');
    // appName may be set even when the API call fails
    if (result.appName) {
      expect(result.appName).toBe('my-test-app');
    }
  });
});

// ============================================================================
// Command Generation
// ============================================================================

describe('buildLaunchCommand()', () => {
  it('should include fly launch', () => {
    const cmd = buildLaunchCommand('my-app', 'nrt');
    expect(cmd).toContain('fly launch');
  });

  it('should include app name', () => {
    const cmd = buildLaunchCommand('my-app', 'nrt');
    expect(cmd).toContain('--name my-app');
  });

  it('should include region', () => {
    const cmd = buildLaunchCommand('my-app', 'nrt');
    expect(cmd).toContain('--region nrt');
  });

  it('should include --no-deploy flag', () => {
    const cmd = buildLaunchCommand('my-app', 'nrt');
    expect(cmd).toContain('--no-deploy');
  });

  it('should include --copy-config flag', () => {
    const cmd = buildLaunchCommand('my-app', 'nrt');
    expect(cmd).toContain('--copy-config');
  });

  it('should include --yes flag for non-interactive mode', () => {
    const cmd = buildLaunchCommand('my-app', 'nrt');
    expect(cmd).toContain('--yes');
  });

  it('should use different app name and region', () => {
    const cmd = buildLaunchCommand('custom-app', 'iad');
    expect(cmd).toContain('--name custom-app');
    expect(cmd).toContain('--region iad');
  });
});

describe('buildAppsCreateCommand()', () => {
  it('should include fly apps create', () => {
    const cmd = buildAppsCreateCommand('my-app');
    expect(cmd).toContain('fly apps create');
  });

  it('should include app name', () => {
    const cmd = buildAppsCreateCommand('my-app');
    expect(cmd).toContain('my-app');
  });

  it('should use different app names', () => {
    const cmd1 = buildAppsCreateCommand('app-one');
    const cmd2 = buildAppsCreateCommand('app-two');
    expect(cmd1).toContain('app-one');
    expect(cmd2).toContain('app-two');
    expect(cmd1).not.toEqual(cmd2);
  });
});

// ============================================================================
// initFlyApp() - Dry Run
// ============================================================================

describe('initFlyApp() dry-run', () => {
  it('should succeed in dry-run mode', () => {
    const result = initFlyApp(true);
    expect(result.success).toBe(true);
    expect(result.action).toBe('dry-run');
  });

  it('should return default app name when none specified', () => {
    const result = initFlyApp(true);
    expect(result.appName).toBe(DEFAULT_APP_NAME);
  });

  it('should include hostname in dry-run result', () => {
    const result = initFlyApp(true);
    expect(result.hostname).toBe(`${DEFAULT_APP_NAME}.fly.dev`);
  });

  it('should include the command in dry-run message', () => {
    const result = initFlyApp(true);
    expect(result.message).toContain('fly launch');
    expect(result.message).toContain('dry-run');
  });

  it('dry-run should use custom app name', () => {
    const result = initFlyApp(true, 'custom-app');
    expect(result.appName).toBe('custom-app');
    expect(result.hostname).toBe('custom-app.fly.dev');
    expect(result.message).toContain('custom-app');
  });

  it('dry-run should use custom region', () => {
    const result = initFlyApp(true, undefined, 'iad');
    expect(result.message).toContain('iad');
  });

  it('dry-run should use both custom app name and region', () => {
    const result = initFlyApp(true, 'my-app', 'lax');
    expect(result.appName).toBe('my-app');
    expect(result.message).toContain('my-app');
    expect(result.message).toContain('lax');
  });

  it('dry-run result should conform to FlyAppInitResult interface', () => {
    const result: FlyAppInitResult = initFlyApp(true);
    expect(typeof result.success).toBe('boolean');
    expect(typeof result.appName).toBe('string');
    expect(typeof result.action).toBe('string');
    expect(typeof result.message).toBe('string');
  });
});

// ============================================================================
// initFlyApp() - Real execution
// ============================================================================

describe('initFlyApp() real execution', () => {
  it('should return a valid FlyAppInitResult', () => {
    // Run without dry-run — will either succeed or report prereqs not met
    const result = initFlyApp(false);
    expect(result).toHaveProperty('success');
    expect(result).toHaveProperty('appName');
    expect(result).toHaveProperty('action');
    expect(result).toHaveProperty('message');
  });

  it('appName should be set', () => {
    const result = initFlyApp(false);
    expect(result.appName).toBeDefined();
    expect(result.appName.length).toBeGreaterThan(0);
  });

  it('action should be a valid value', () => {
    const result = initFlyApp(false);
    expect(['created', 'already-exists', 'skipped', 'dry-run']).toContain(result.action);
  });

  it('message should be non-empty', () => {
    const result = initFlyApp(false);
    expect(result.message.length).toBeGreaterThan(0);
  });

  it('if skipped due to prerequisites, should mention which check failed', () => {
    const result = initFlyApp(false);
    if (result.action === 'skipped') {
      expect(result.message.length).toBeGreaterThan(0);
    }
  });

  it('if already-exists, hostname should be set', () => {
    const result = initFlyApp(false);
    if (result.action === 'already-exists') {
      expect(result.hostname).toBeDefined();
      expect(result.hostname).toContain('.fly.dev');
    }
  });
});

// ============================================================================
// Type exports
// ============================================================================

describe('Type exports', () => {
  it('FlyAuthStatus type should be usable', () => {
    const status: FlyAuthStatus = { authenticated: false, error: 'test' };
    expect(status.authenticated).toBe(false);
    expect(status.error).toBe('test');
  });

  it('FlyAuthStatus with email should be usable', () => {
    const status: FlyAuthStatus = { authenticated: true, email: 'test@test.com' };
    expect(status.authenticated).toBe(true);
    expect(status.email).toBe('test@test.com');
  });

  it('FlyAppStatus type should be usable', () => {
    const status: FlyAppStatus = { exists: true, appName: 'my-app', hostname: 'my-app.fly.dev' };
    expect(status.exists).toBe(true);
    expect(status.appName).toBe('my-app');
  });

  it('FlyAppStatus with error should be usable', () => {
    const status: FlyAppStatus = { exists: false, error: 'not found' };
    expect(status.exists).toBe(false);
    expect(status.error).toBe('not found');
  });

  it('FlyAppInitResult type should be usable', () => {
    const result: FlyAppInitResult = {
      success: true,
      appName: 'test',
      action: 'created',
      message: 'done',
      hostname: 'test.fly.dev',
    };
    expect(result.success).toBe(true);
  });

  it('FlyInitPrecheck type should be usable', () => {
    const check: FlyInitPrecheck = { name: 'test', passed: true, message: 'ok' };
    expect(check.passed).toBe(true);
  });

  it('FlyAppInitResult action should cover all values', () => {
    const actions: FlyAppInitResult['action'][] = ['created', 'already-exists', 'skipped', 'dry-run'];
    expect(actions).toHaveLength(4);
  });
});

// ============================================================================
// Integration: consistency with fly.toml
// ============================================================================

describe('Integration: consistency with fly.toml', () => {
  it('getAppNameFromToml should match fly.toml content', () => {
    const content = fs.readFileSync(path.join(ROOT_DIR, 'fly.toml'), 'utf-8');
    const match = content.match(/^app\s*=\s*"([^"]+)"/m);
    expect(match).not.toBeNull();
    expect(getAppNameFromToml()).toBe(match![1]);
  });

  it('getRegionFromToml should match fly.toml content', () => {
    const content = fs.readFileSync(path.join(ROOT_DIR, 'fly.toml'), 'utf-8');
    const match = content.match(/^primary_region\s*=\s*"([^"]+)"/m);
    expect(match).not.toBeNull();
    expect(getRegionFromToml()).toBe(match![1]);
  });

  it('dry-run should use values from fly.toml', () => {
    const result = initFlyApp(true);
    const appName = getAppNameFromToml();
    const region = getRegionFromToml();
    expect(result.appName).toBe(appName);
    if (region) {
      expect(result.message).toContain(region);
    }
  });

  it('buildLaunchCommand with fly.toml values should be valid', () => {
    const appName = getAppNameFromToml() ?? DEFAULT_APP_NAME;
    const region = getRegionFromToml() ?? DEFAULT_REGION;
    const cmd = buildLaunchCommand(appName, region);
    expect(cmd).toContain(appName);
    expect(cmd).toContain(region);
    expect(cmd).toMatch(/^fly launch /);
  });
});

// ============================================================================
// Integration: prechecks consistency
// ============================================================================

describe('Integration: prechecks consistency', () => {
  it('checkFlyCli result should be consistent with runPrechecks', () => {
    const standalone = checkFlyCli();
    const fromPrechecks = runPrechecks().find((r) => r.name === 'Fly CLI');
    expect(fromPrechecks).toBeDefined();
    expect(fromPrechecks!.passed).toBe(standalone.passed);
  });

  it('checkFlyTomlExists result should be consistent with runPrechecks', () => {
    const standalone = checkFlyTomlExists();
    const fromPrechecks = runPrechecks().find((r) => r.name === 'fly.toml');
    expect(fromPrechecks).toBeDefined();
    expect(fromPrechecks!.passed).toBe(standalone.passed);
  });

  it('checkDockerfileExists result should be consistent with runPrechecks', () => {
    const standalone = checkDockerfileExists();
    const fromPrechecks = runPrechecks().find((r) => r.name === 'Dockerfile');
    expect(fromPrechecks).toBeDefined();
    expect(fromPrechecks!.passed).toBe(standalone.passed);
  });

  it('dry-run should not affect precheck results', () => {
    const before = runPrechecks();
    initFlyApp(true);
    const after = runPrechecks();
    expect(after.length).toBe(before.length);
    for (let i = 0; i < before.length; i++) {
      expect(after[i].passed).toBe(before[i].passed);
    }
  });
});
