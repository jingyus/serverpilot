/**
 * Fly.io Autoscaling Configuration Module
 *
 * Configures automatic scaling for the AI Installer server on Fly.io.
 * Manages machine count and autoscaling parameters.
 *
 * Features:
 * - Get current scale configuration
 * - Set machine count (min instances)
 * - Configure autoscaling (min/max machines)
 * - Supports dry-run mode
 *
 * Usage: npx tsx scripts/fly-autoscale.ts [--dry-run] [--app <name>]
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT_DIR = path.resolve(import.meta.dirname, '..');

// ============================================================================
// Types
// ============================================================================

export interface AutoscaleConfig {
  minMachines: number;
  maxMachines: number;
}

export interface ScaleResult {
  success: boolean;
  appName: string;
  action: 'configured' | 'skipped' | 'dry-run';
  message: string;
  config?: AutoscaleConfig;
}

export interface ScaleInfo {
  appName: string;
  count?: number;
  regions?: string[];
  error?: string;
}

// ============================================================================
// Constants
// ============================================================================

export const DEFAULT_APP_NAME = 'aiinstaller-server';
export const DEFAULT_MIN_MACHINES = 1;
export const DEFAULT_MAX_MACHINES = 3;

// ============================================================================
// Helpers
// ============================================================================

/**
 * Resolve the app name from argument, fly.toml, or default.
 */
export function resolveAppName(appName?: string): string {
  if (appName) return appName;

  const flyTomlPath = path.join(ROOT_DIR, 'fly.toml');
  if (fs.existsSync(flyTomlPath)) {
    const content = fs.readFileSync(flyTomlPath, 'utf-8');
    const match = content.match(/^app\s*=\s*"([^"]+)"/m);
    if (match) return match[1];
  }

  return DEFAULT_APP_NAME;
}

/**
 * Validate autoscale config values.
 */
export function validateConfig(config: AutoscaleConfig): { valid: boolean; error?: string } {
  if (config.minMachines < 0) {
    return { valid: false, error: 'minMachines must be >= 0' };
  }
  if (config.maxMachines < 1) {
    return { valid: false, error: 'maxMachines must be >= 1' };
  }
  if (config.minMachines > config.maxMachines) {
    return { valid: false, error: 'minMachines must be <= maxMachines' };
  }
  if (!Number.isInteger(config.minMachines) || !Number.isInteger(config.maxMachines)) {
    return { valid: false, error: 'Machine counts must be integers' };
  }
  return { valid: true };
}

// ============================================================================
// Command Builders
// ============================================================================

/**
 * Build the `fly scale count` command.
 */
export function buildScaleCountCommand(count: number, appName: string): string {
  return `fly scale count ${count} --app ${appName} --yes`;
}

/**
 * Build the `fly scale show` command.
 */
export function buildScaleShowCommand(appName: string): string {
  return `fly scale show --app ${appName}`;
}

/**
 * Build the command to update fly.toml autoscaling settings.
 * Fly.io v2 (machines) uses fly.toml [http_service] auto_stop_machines and
 * auto_start_machines rather than the deprecated `fly autoscale` command.
 */
export function buildAutoscaleTomlUpdate(config: AutoscaleConfig): {
  autoStopMachines: string;
  autoStartMachines: boolean;
  minMachinesRunning: number;
} {
  return {
    autoStopMachines: config.minMachines > 0 ? 'stop' : 'stop',
    autoStartMachines: true,
    minMachinesRunning: config.minMachines,
  };
}

// ============================================================================
// Scale Operations
// ============================================================================

/**
 * Get the current scale information for the app.
 */
export function getScaleInfo(appName: string): ScaleInfo {
  try {
    const output = execSync(`fly scale show --app ${appName}`, {
      encoding: 'utf-8',
      stdio: 'pipe',
      timeout: 30000,
    });

    // Parse basic info from text output
    const countMatch = output.match(/Count:\s*(\d+)/i) ||
      output.match(/(\d+)\s+machine/i);
    const count = countMatch ? parseInt(countMatch[1], 10) : undefined;

    return { appName, count };
  } catch (err) {
    return {
      appName,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Set the machine count for the app.
 */
export function setMachineCount(
  count: number,
  appName: string,
  dryRun = false,
): ScaleResult {
  if (count < 0 || !Number.isInteger(count)) {
    return {
      success: false,
      appName,
      action: 'skipped',
      message: 'Machine count must be a non-negative integer',
    };
  }

  if (dryRun) {
    const cmd = buildScaleCountCommand(count, appName);
    return {
      success: true,
      appName,
      action: 'dry-run',
      message: `[dry-run] Would execute: ${cmd}`,
    };
  }

  try {
    const cmd = buildScaleCountCommand(count, appName);
    execSync(cmd, {
      encoding: 'utf-8',
      stdio: 'pipe',
      timeout: 60000,
    });

    return {
      success: true,
      appName,
      action: 'configured',
      message: `Machine count set to ${count}`,
    };
  } catch (err) {
    return {
      success: false,
      appName,
      action: 'skipped',
      message: `Failed to set machine count: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Configure autoscaling by updating fly.toml and optionally deploying.
 * Fly.io v2 uses fly.toml settings for autoscaling rather than a separate API.
 */
export function configureAutoscale(
  config: AutoscaleConfig,
  appName: string,
  dryRun = false,
): ScaleResult {
  // Validate config
  const validation = validateConfig(config);
  if (!validation.valid) {
    return {
      success: false,
      appName,
      action: 'skipped',
      message: `Invalid config: ${validation.error}`,
    };
  }

  const resolvedName = resolveAppName(appName);

  if (dryRun) {
    const tomlSettings = buildAutoscaleTomlUpdate(config);
    return {
      success: true,
      appName: resolvedName,
      action: 'dry-run',
      message: `[dry-run] Would update fly.toml: min_machines_running=${tomlSettings.minMachinesRunning}, auto_stop_machines="${tomlSettings.autoStopMachines}", auto_start_machines=${tomlSettings.autoStartMachines}`,
      config,
    };
  }

  // Update fly.toml with autoscale settings
  const flyTomlPath = path.join(ROOT_DIR, 'fly.toml');
  if (!fs.existsSync(flyTomlPath)) {
    return {
      success: false,
      appName: resolvedName,
      action: 'skipped',
      message: 'fly.toml not found. Cannot configure autoscaling.',
    };
  }

  try {
    let content = fs.readFileSync(flyTomlPath, 'utf-8');

    // Update min_machines_running
    content = content.replace(
      /min_machines_running\s*=\s*\d+/,
      `min_machines_running = ${config.minMachines}`,
    );

    fs.writeFileSync(flyTomlPath, content, 'utf-8');

    // Set machine count via fly scale
    const scaleResult = setMachineCount(config.maxMachines, resolvedName, false);

    if (!scaleResult.success) {
      return {
        success: false,
        appName: resolvedName,
        action: 'skipped',
        message: `fly.toml updated but failed to scale: ${scaleResult.message}`,
        config,
      };
    }

    return {
      success: true,
      appName: resolvedName,
      action: 'configured',
      message: `Autoscaling configured: min=${config.minMachines}, max=${config.maxMachines}`,
      config,
    };
  } catch (err) {
    return {
      success: false,
      appName: resolvedName,
      action: 'skipped',
      message: `Failed to configure autoscaling: ${err instanceof Error ? err.message : String(err)}`,
      config,
    };
  }
}

/**
 * Get the default autoscale configuration.
 */
export function getDefaultConfig(): AutoscaleConfig {
  return {
    minMachines: DEFAULT_MIN_MACHINES,
    maxMachines: DEFAULT_MAX_MACHINES,
  };
}

/**
 * Read autoscale settings from fly.toml.
 */
export function readAutoscaleFromToml(): AutoscaleConfig | null {
  const flyTomlPath = path.join(ROOT_DIR, 'fly.toml');
  if (!fs.existsSync(flyTomlPath)) return null;

  const content = fs.readFileSync(flyTomlPath, 'utf-8');

  const minMatch = content.match(/min_machines_running\s*=\s*(\d+)/);
  const minMachines = minMatch ? parseInt(minMatch[1], 10) : DEFAULT_MIN_MACHINES;

  return {
    minMachines,
    maxMachines: DEFAULT_MAX_MACHINES,
  };
}

// ============================================================================
// CLI entry point
// ============================================================================

if (process.argv[1] && import.meta.filename && process.argv[1] === import.meta.filename) {
  console.log('=== Fly.io Autoscaling Configuration ===\n');

  const dryRun = process.argv.includes('--dry-run');
  const appIndex = process.argv.indexOf('--app');
  const explicitApp = appIndex !== -1 ? process.argv[appIndex + 1] : undefined;
  const appName = resolveAppName(explicitApp);

  console.log(`App:  ${appName}`);
  console.log(`Mode: ${dryRun ? 'dry-run' : 'configure'}\n`);

  // Show current fly.toml settings
  const tomlConfig = readAutoscaleFromToml();
  if (tomlConfig) {
    console.log('Current fly.toml settings:');
    console.log(`  min_machines_running: ${tomlConfig.minMachines}`);
    console.log('');
  }

  // Configure
  const config = getDefaultConfig();
  console.log(`Target config: min=${config.minMachines}, max=${config.maxMachines}\n`);

  const result = configureAutoscale(config, appName, dryRun);

  if (result.success) {
    console.log(`✅ ${result.message}`);
  } else {
    console.error(`❌ ${result.message}`);
    process.exit(1);
  }
}
