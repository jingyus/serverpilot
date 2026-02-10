/**
 * Fly.io App Initialization Module
 *
 * Initializes a Fly.io application based on fly.toml configuration.
 * Equivalent to running `fly launch` but with validation and dry-run support.
 *
 * Features:
 * - Validates prerequisites (fly CLI, fly.toml, Dockerfile)
 * - Checks Fly.io authentication status
 * - Checks if the app already exists on Fly.io
 * - Initializes the app with `fly launch` (or `fly apps create`)
 * - Supports dry-run mode
 *
 * Usage: npx tsx scripts/fly-app-init.ts [--dry-run]
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT_DIR = path.resolve(import.meta.dirname, '..');

// ============================================================================
// Types
// ============================================================================

export interface FlyAuthStatus {
  authenticated: boolean;
  email?: string;
  error?: string;
}

export interface FlyAppStatus {
  exists: boolean;
  appName?: string;
  hostname?: string;
  error?: string;
}

export interface FlyAppInitResult {
  success: boolean;
  appName: string;
  action: 'created' | 'already-exists' | 'skipped' | 'dry-run';
  message: string;
  hostname?: string;
}

export interface FlyInitPrecheck {
  name: string;
  passed: boolean;
  message: string;
}

// ============================================================================
// Constants
// ============================================================================

export const DEFAULT_APP_NAME = 'aiinstaller-server';
export const DEFAULT_REGION = 'nrt';

// ============================================================================
// Prerequisites
// ============================================================================

/**
 * Check if the Fly CLI is installed.
 */
export function checkFlyCli(): FlyInitPrecheck {
  try {
    const version = execSync('fly version', {
      encoding: 'utf-8',
      stdio: 'pipe',
      timeout: 10000,
    }).trim();
    return { name: 'Fly CLI', passed: true, message: `Installed: ${version}` };
  } catch {
    return {
      name: 'Fly CLI',
      passed: false,
      message: 'Fly CLI not installed. Run: curl -L https://fly.io/install.sh | sh',
    };
  }
}

/**
 * Check if fly.toml exists in the project root.
 */
export function checkFlyTomlExists(): FlyInitPrecheck {
  const flyTomlPath = path.join(ROOT_DIR, 'fly.toml');
  if (fs.existsSync(flyTomlPath)) {
    return { name: 'fly.toml', passed: true, message: 'Configuration file found' };
  }
  return { name: 'fly.toml', passed: false, message: 'fly.toml not found in project root' };
}

/**
 * Check if the Dockerfile exists.
 */
export function checkDockerfileExists(): FlyInitPrecheck {
  const dockerfilePath = path.join(ROOT_DIR, 'packages/server/Dockerfile');
  if (fs.existsSync(dockerfilePath)) {
    return { name: 'Dockerfile', passed: true, message: 'Dockerfile found' };
  }
  return {
    name: 'Dockerfile',
    passed: false,
    message: 'packages/server/Dockerfile not found',
  };
}

/**
 * Parse the app name from fly.toml.
 */
export function getAppNameFromToml(): string | undefined {
  const flyTomlPath = path.join(ROOT_DIR, 'fly.toml');
  if (!fs.existsSync(flyTomlPath)) return undefined;

  const content = fs.readFileSync(flyTomlPath, 'utf-8');
  const match = content.match(/^app\s*=\s*"([^"]+)"/m);
  return match ? match[1] : undefined;
}

/**
 * Parse the primary region from fly.toml.
 */
export function getRegionFromToml(): string | undefined {
  const flyTomlPath = path.join(ROOT_DIR, 'fly.toml');
  if (!fs.existsSync(flyTomlPath)) return undefined;

  const content = fs.readFileSync(flyTomlPath, 'utf-8');
  const match = content.match(/^primary_region\s*=\s*"([^"]+)"/m);
  return match ? match[1] : undefined;
}

/**
 * Run all prerequisite checks.
 */
export function runPrechecks(): FlyInitPrecheck[] {
  return [
    checkFlyCli(),
    checkFlyTomlExists(),
    checkDockerfileExists(),
  ];
}

// ============================================================================
// Authentication
// ============================================================================

/**
 * Check if the user is authenticated with Fly.io.
 */
export function checkFlyAuth(): FlyAuthStatus {
  try {
    const output = execSync('fly auth whoami', {
      encoding: 'utf-8',
      stdio: 'pipe',
      timeout: 15000,
    }).trim();

    if (output) {
      return { authenticated: true, email: output };
    }
    return { authenticated: false, error: 'No user info returned' };
  } catch (err) {
    return {
      authenticated: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ============================================================================
// App Status
// ============================================================================

/**
 * Check if a Fly.io app already exists.
 */
export function checkAppExists(appName: string): FlyAppStatus {
  try {
    const output = execSync(`fly apps list --json`, {
      encoding: 'utf-8',
      stdio: 'pipe',
      timeout: 30000,
    });

    const apps = JSON.parse(output);
    if (!Array.isArray(apps)) {
      return { exists: false, error: 'Unexpected response from fly apps list' };
    }

    const app = apps.find(
      (a: { Name?: string; name?: string }) =>
        (a.Name || a.name) === appName,
    );

    if (app) {
      const hostname = `${appName}.fly.dev`;
      return { exists: true, appName, hostname };
    }

    return { exists: false, appName };
  } catch (err) {
    return {
      exists: false,
      appName,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ============================================================================
// App Initialization
// ============================================================================

/**
 * Build the fly launch command arguments.
 */
export function buildLaunchCommand(appName: string, region: string): string {
  return `fly launch --name ${appName} --region ${region} --no-deploy --copy-config --yes`;
}

/**
 * Build the fly apps create command as a fallback.
 */
export function buildAppsCreateCommand(appName: string): string {
  return `fly apps create ${appName}`;
}

/**
 * Initialize a Fly.io application.
 *
 * @param dryRun - If true, do not actually run fly commands.
 * @param appName - Override the app name (defaults to fly.toml value or DEFAULT_APP_NAME).
 * @param region - Override the region (defaults to fly.toml value or DEFAULT_REGION).
 */
export function initFlyApp(
  dryRun = false,
  appName?: string,
  region?: string,
): FlyAppInitResult {
  const resolvedAppName = appName ?? getAppNameFromToml() ?? DEFAULT_APP_NAME;
  const resolvedRegion = region ?? getRegionFromToml() ?? DEFAULT_REGION;

  // Dry-run mode: skip all actual operations
  if (dryRun) {
    const cmd = buildLaunchCommand(resolvedAppName, resolvedRegion);
    return {
      success: true,
      appName: resolvedAppName,
      action: 'dry-run',
      message: `[dry-run] Would execute: ${cmd}`,
      hostname: `${resolvedAppName}.fly.dev`,
    };
  }

  // Check prerequisites
  const prechecks = runPrechecks();
  const failed = prechecks.filter((c) => !c.passed);
  if (failed.length > 0) {
    const failedNames = failed.map((c) => c.name).join(', ');
    return {
      success: false,
      appName: resolvedAppName,
      action: 'skipped',
      message: `Prerequisites not met: ${failedNames}. ${failed.map((c) => c.message).join('; ')}`,
    };
  }

  // Check authentication
  const auth = checkFlyAuth();
  if (!auth.authenticated) {
    return {
      success: false,
      appName: resolvedAppName,
      action: 'skipped',
      message: `Not authenticated with Fly.io. Run: fly auth login`,
    };
  }

  // Check if app already exists
  const appStatus = checkAppExists(resolvedAppName);
  if (appStatus.exists) {
    return {
      success: true,
      appName: resolvedAppName,
      action: 'already-exists',
      message: `App "${resolvedAppName}" already exists on Fly.io`,
      hostname: appStatus.hostname,
    };
  }

  // Launch the app
  const launchCmd = buildLaunchCommand(resolvedAppName, resolvedRegion);
  try {
    execSync(launchCmd, {
      cwd: ROOT_DIR,
      stdio: 'inherit',
      timeout: 120000,
    });

    return {
      success: true,
      appName: resolvedAppName,
      action: 'created',
      message: `App "${resolvedAppName}" created successfully in region "${resolvedRegion}"`,
      hostname: `${resolvedAppName}.fly.dev`,
    };
  } catch (launchErr) {
    // Fallback: try fly apps create
    try {
      const createCmd = buildAppsCreateCommand(resolvedAppName);
      execSync(createCmd, {
        cwd: ROOT_DIR,
        stdio: 'inherit',
        timeout: 60000,
      });

      return {
        success: true,
        appName: resolvedAppName,
        action: 'created',
        message: `App "${resolvedAppName}" created via fallback (fly apps create)`,
        hostname: `${resolvedAppName}.fly.dev`,
      };
    } catch (createErr) {
      const errMsg = createErr instanceof Error ? createErr.message : String(createErr);
      return {
        success: false,
        appName: resolvedAppName,
        action: 'skipped',
        message: `Failed to initialize app: ${errMsg}`,
      };
    }
  }
}

// ============================================================================
// CLI entry point
// ============================================================================

if (process.argv[1] && import.meta.filename && process.argv[1] === import.meta.filename) {
  console.log('=== Fly.io App Initialization ===\n');

  const dryRun = process.argv.includes('--dry-run');

  // Run prechecks
  console.log('Prerequisites:');
  const prechecks = runPrechecks();
  for (const check of prechecks) {
    const icon = check.passed ? '✅' : '❌';
    console.log(`  ${icon} ${check.name}: ${check.message}`);
  }

  const appName = getAppNameFromToml() ?? DEFAULT_APP_NAME;
  const region = getRegionFromToml() ?? DEFAULT_REGION;
  console.log(`\nApp name: ${appName}`);
  console.log(`Region:   ${region}`);

  if (dryRun) {
    console.log('\n[dry-run] Skipping actual initialization.');
    const cmd = buildLaunchCommand(appName, region);
    console.log(`Would execute: ${cmd}`);
    process.exit(0);
  }

  console.log('\nInitializing...\n');
  const result = initFlyApp(false);

  if (result.success) {
    console.log(`\n✅ ${result.message}`);
    if (result.hostname) {
      console.log(`   Hostname: ${result.hostname}`);
    }
  } else {
    console.error(`\n❌ ${result.message}`);
    process.exit(1);
  }
}
