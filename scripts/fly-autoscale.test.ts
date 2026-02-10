/**
 * Tests for Fly.io Autoscaling Configuration Module.
 *
 * Validates:
 * - Constants and defaults
 * - Config validation
 * - App name resolution
 * - Command building
 * - Dry-run operations
 * - fly.toml autoscale reading
 * - Type exports
 * - Integration with fly.toml
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_APP_NAME,
  DEFAULT_MIN_MACHINES,
  DEFAULT_MAX_MACHINES,
  resolveAppName,
  validateConfig,
  buildScaleCountCommand,
  buildScaleShowCommand,
  buildAutoscaleTomlUpdate,
  setMachineCount,
  configureAutoscale,
  getDefaultConfig,
  readAutoscaleFromToml,
} from './fly-autoscale';
import type {
  AutoscaleConfig,
  ScaleResult,
  ScaleInfo,
} from './fly-autoscale';

const ROOT_DIR = path.resolve(import.meta.dirname, '..');

// ============================================================================
// Constants
// ============================================================================

describe('Constants', () => {
  it('DEFAULT_APP_NAME should be aiinstaller-server', () => {
    expect(DEFAULT_APP_NAME).toBe('aiinstaller-server');
  });

  it('DEFAULT_MIN_MACHINES should be 1', () => {
    expect(DEFAULT_MIN_MACHINES).toBe(1);
  });

  it('DEFAULT_MAX_MACHINES should be >= DEFAULT_MIN_MACHINES', () => {
    expect(DEFAULT_MAX_MACHINES).toBeGreaterThanOrEqual(DEFAULT_MIN_MACHINES);
  });

  it('defaults should be positive integers', () => {
    expect(Number.isInteger(DEFAULT_MIN_MACHINES)).toBe(true);
    expect(Number.isInteger(DEFAULT_MAX_MACHINES)).toBe(true);
    expect(DEFAULT_MIN_MACHINES).toBeGreaterThanOrEqual(0);
    expect(DEFAULT_MAX_MACHINES).toBeGreaterThanOrEqual(1);
  });
});

// ============================================================================
// resolveAppName
// ============================================================================

describe('resolveAppName()', () => {
  it('should return explicit app name', () => {
    expect(resolveAppName('my-app')).toBe('my-app');
  });

  it('should read from fly.toml', () => {
    expect(resolveAppName()).toBe('aiinstaller-server');
  });

  it('should return non-empty string', () => {
    expect(resolveAppName().length).toBeGreaterThan(0);
  });
});

// ============================================================================
// validateConfig
// ============================================================================

describe('validateConfig()', () => {
  it('should validate a correct config', () => {
    const result = validateConfig({ minMachines: 1, maxMachines: 3 });
    expect(result.valid).toBe(true);
  });

  it('should reject negative minMachines', () => {
    const result = validateConfig({ minMachines: -1, maxMachines: 3 });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('minMachines');
  });

  it('should reject maxMachines < 1', () => {
    const result = validateConfig({ minMachines: 0, maxMachines: 0 });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('maxMachines');
  });

  it('should reject min > max', () => {
    const result = validateConfig({ minMachines: 5, maxMachines: 3 });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('minMachines');
  });

  it('should reject non-integer values', () => {
    const result = validateConfig({ minMachines: 1.5, maxMachines: 3 });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('integer');
  });

  it('should accept min=0, max=1', () => {
    const result = validateConfig({ minMachines: 0, maxMachines: 1 });
    expect(result.valid).toBe(true);
  });

  it('should accept min=max', () => {
    const result = validateConfig({ minMachines: 2, maxMachines: 2 });
    expect(result.valid).toBe(true);
  });
});

// ============================================================================
// Command Building
// ============================================================================

describe('buildScaleCountCommand()', () => {
  it('should include fly scale count', () => {
    const cmd = buildScaleCountCommand(2, 'my-app');
    expect(cmd).toContain('fly scale count');
  });

  it('should include the count', () => {
    const cmd = buildScaleCountCommand(3, 'my-app');
    expect(cmd).toContain('3');
  });

  it('should include --app flag', () => {
    const cmd = buildScaleCountCommand(2, 'my-app');
    expect(cmd).toContain('--app my-app');
  });

  it('should include --yes flag', () => {
    const cmd = buildScaleCountCommand(2, 'my-app');
    expect(cmd).toContain('--yes');
  });

  it('should handle different counts', () => {
    const cmd1 = buildScaleCountCommand(1, 'app');
    const cmd2 = buildScaleCountCommand(5, 'app');
    expect(cmd1).toContain('1');
    expect(cmd2).toContain('5');
  });
});

describe('buildScaleShowCommand()', () => {
  it('should include fly scale show', () => {
    const cmd = buildScaleShowCommand('my-app');
    expect(cmd).toContain('fly scale show');
  });

  it('should include --app flag', () => {
    const cmd = buildScaleShowCommand('my-app');
    expect(cmd).toContain('--app my-app');
  });
});

describe('buildAutoscaleTomlUpdate()', () => {
  it('should return autoStartMachines=true', () => {
    const update = buildAutoscaleTomlUpdate({ minMachines: 1, maxMachines: 3 });
    expect(update.autoStartMachines).toBe(true);
  });

  it('should set minMachinesRunning from config', () => {
    const update = buildAutoscaleTomlUpdate({ minMachines: 2, maxMachines: 5 });
    expect(update.minMachinesRunning).toBe(2);
  });

  it('should set autoStopMachines to "stop"', () => {
    const update = buildAutoscaleTomlUpdate({ minMachines: 1, maxMachines: 3 });
    expect(update.autoStopMachines).toBe('stop');
  });
});

// ============================================================================
// setMachineCount (dry-run)
// ============================================================================

describe('setMachineCount() dry-run', () => {
  it('should succeed in dry-run mode', () => {
    const result = setMachineCount(2, 'app', true);
    expect(result.success).toBe(true);
    expect(result.action).toBe('dry-run');
  });

  it('should include the command in message', () => {
    const result = setMachineCount(3, 'my-app', true);
    expect(result.message).toContain('fly scale count');
  });

  it('should reject negative count', () => {
    const result = setMachineCount(-1, 'app', true);
    expect(result.success).toBe(false);
    expect(result.action).toBe('skipped');
  });

  it('should reject non-integer count', () => {
    const result = setMachineCount(1.5, 'app', true);
    expect(result.success).toBe(false);
  });

  it('should accept count=0', () => {
    const result = setMachineCount(0, 'app', true);
    expect(result.success).toBe(true);
  });
});

// ============================================================================
// configureAutoscale (dry-run)
// ============================================================================

describe('configureAutoscale() dry-run', () => {
  it('should succeed in dry-run mode', () => {
    const config: AutoscaleConfig = { minMachines: 1, maxMachines: 3 };
    const result = configureAutoscale(config, 'app', true);
    expect(result.success).toBe(true);
    expect(result.action).toBe('dry-run');
  });

  it('should include config values in message', () => {
    const config: AutoscaleConfig = { minMachines: 2, maxMachines: 5 };
    const result = configureAutoscale(config, 'app', true);
    expect(result.message).toContain('min_machines_running');
  });

  it('should return config in result', () => {
    const config: AutoscaleConfig = { minMachines: 1, maxMachines: 3 };
    const result = configureAutoscale(config, 'app', true);
    expect(result.config).toEqual(config);
  });

  it('should reject invalid config', () => {
    const config: AutoscaleConfig = { minMachines: 5, maxMachines: 2 };
    const result = configureAutoscale(config, 'app', true);
    expect(result.success).toBe(false);
    expect(result.action).toBe('skipped');
  });

  it('should reject negative minMachines', () => {
    const config: AutoscaleConfig = { minMachines: -1, maxMachines: 3 };
    const result = configureAutoscale(config, 'app', true);
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// getDefaultConfig
// ============================================================================

describe('getDefaultConfig()', () => {
  it('should return a valid config', () => {
    const config = getDefaultConfig();
    expect(config.minMachines).toBe(DEFAULT_MIN_MACHINES);
    expect(config.maxMachines).toBe(DEFAULT_MAX_MACHINES);
  });

  it('should pass validation', () => {
    const config = getDefaultConfig();
    const validation = validateConfig(config);
    expect(validation.valid).toBe(true);
  });
});

// ============================================================================
// readAutoscaleFromToml
// ============================================================================

describe('readAutoscaleFromToml()', () => {
  it('should return config from fly.toml', () => {
    const config = readAutoscaleFromToml();
    expect(config).not.toBeNull();
  });

  it('should include minMachines', () => {
    const config = readAutoscaleFromToml();
    if (config) {
      expect(typeof config.minMachines).toBe('number');
      expect(config.minMachines).toBeGreaterThanOrEqual(0);
    }
  });

  it('should be consistent with fly.toml content', () => {
    const config = readAutoscaleFromToml();
    if (config) {
      const flyToml = fs.readFileSync(path.join(ROOT_DIR, 'fly.toml'), 'utf-8');
      const match = flyToml.match(/min_machines_running\s*=\s*(\d+)/);
      if (match) {
        expect(config.minMachines).toBe(parseInt(match[1], 10));
      }
    }
  });
});

// ============================================================================
// Type exports
// ============================================================================

describe('Type exports', () => {
  it('AutoscaleConfig type should be usable', () => {
    const config: AutoscaleConfig = { minMachines: 1, maxMachines: 5 };
    expect(config.minMachines).toBe(1);
    expect(config.maxMachines).toBe(5);
  });

  it('ScaleResult type should be usable', () => {
    const result: ScaleResult = {
      success: true,
      appName: 'test',
      action: 'configured',
      message: 'done',
      config: { minMachines: 1, maxMachines: 3 },
    };
    expect(result.success).toBe(true);
    expect(result.config?.minMachines).toBe(1);
  });

  it('ScaleResult action should cover all values', () => {
    const actions: ScaleResult['action'][] = ['configured', 'skipped', 'dry-run'];
    expect(actions).toHaveLength(3);
  });

  it('ScaleInfo type should be usable', () => {
    const info: ScaleInfo = { appName: 'test', count: 2, regions: ['nrt'] };
    expect(info.appName).toBe('test');
    expect(info.count).toBe(2);
  });
});

// ============================================================================
// Integration
// ============================================================================

describe('Integration: fly.toml consistency', () => {
  it('fly.toml should contain min_machines_running', () => {
    const flyToml = fs.readFileSync(path.join(ROOT_DIR, 'fly.toml'), 'utf-8');
    expect(flyToml).toContain('min_machines_running');
  });

  it('fly.toml should contain auto_start_machines', () => {
    const flyToml = fs.readFileSync(path.join(ROOT_DIR, 'fly.toml'), 'utf-8');
    expect(flyToml).toContain('auto_start_machines');
  });

  it('fly.toml should contain auto_stop_machines', () => {
    const flyToml = fs.readFileSync(path.join(ROOT_DIR, 'fly.toml'), 'utf-8');
    expect(flyToml).toContain('auto_stop_machines');
  });

  it('deployment docs should mention scale', () => {
    const deployDoc = fs.readFileSync(
      path.join(ROOT_DIR, 'docs/deployment.md'),
      'utf-8',
    );
    expect(deployDoc).toContain('scale');
  });

  it('dry-run should not modify fly.toml', () => {
    const before = fs.readFileSync(path.join(ROOT_DIR, 'fly.toml'), 'utf-8');
    configureAutoscale({ minMachines: 1, maxMachines: 3 }, 'app', true);
    const after = fs.readFileSync(path.join(ROOT_DIR, 'fly.toml'), 'utf-8');
    expect(after).toBe(before);
  });
});
