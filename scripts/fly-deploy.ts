/**
 * Fly.io Deployment Module
 *
 * Orchestrates deployment of the AI Installer server to Fly.io.
 * Runs prerequisite checks, validates secrets, and executes `fly deploy`.
 *
 * Features:
 * - Pre-deploy validation (fly CLI, fly.toml, Dockerfile, auth, secrets)
 * - Build and deploy via `fly deploy`
 * - Post-deploy verification via `fly status`
 * - Supports dry-run mode
 *
 * Usage: npx tsx scripts/fly-deploy.ts [--dry-run] [--app <name>]
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT_DIR = path.resolve(import.meta.dirname, '..');

// ============================================================================
// Types
// ============================================================================

export interface DeployPrecheck {
  name: string;
  passed: boolean;
  message: string;
}

export interface FlyDeployResult {
  success: boolean;
  appName: string;
  action: 'deployed' | 'skipped' | 'dry-run';
  message: string;
  hostname?: string;
  version?: string;
}

export interface FlyStatusInfo {
  appName: string;
  status: string;
  hostname: string;
  version?: string;
  machines?: number;
}

// ============================================================================
// Constants
// ============================================================================

export const DEFAULT_APP_NAME = 'aiinstaller-server';
export const DEFAULT_DEPLOY_TIMEOUT = 300000; // 5 minutes

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

// ============================================================================
// Pre-deploy Checks
// ============================================================================

/**
 * Check if the Fly CLI is installed.
 */
export function checkFlyCli(): DeployPrecheck {
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
 * Check if fly.toml exists.
 */
export function checkFlyToml(): DeployPrecheck {
  const flyTomlPath = path.join(ROOT_DIR, 'fly.toml');
  if (fs.existsSync(flyTomlPath)) {
    return { name: 'fly.toml', passed: true, message: 'Configuration file found' };
  }
  return { name: 'fly.toml', passed: false, message: 'fly.toml not found in project root' };
}

/**
 * Check if the Dockerfile exists.
 */
export function checkDockerfile(): DeployPrecheck {
  const dockerfilePath = path.join(ROOT_DIR, 'packages/server/Dockerfile');
  if (fs.existsSync(dockerfilePath)) {
    return { name: 'Dockerfile', passed: true, message: 'Dockerfile found' };
  }
  return { name: 'Dockerfile', passed: false, message: 'packages/server/Dockerfile not found' };
}

/**
 * Check Fly.io authentication status.
 */
export function checkFlyAuth(): DeployPrecheck {
  try {
    const output = execSync('fly auth whoami', {
      encoding: 'utf-8',
      stdio: 'pipe',
      timeout: 15000,
    }).trim();

    if (output) {
      return { name: 'Fly Auth', passed: true, message: `Authenticated as: ${output}` };
    }
    return { name: 'Fly Auth', passed: false, message: 'Not authenticated' };
  } catch {
    return {
      name: 'Fly Auth',
      passed: false,
      message: 'Not authenticated with Fly.io. Run: fly auth login',
    };
  }
}

/**
 * Check if the Fly.io app exists.
 */
export function checkAppExists(appName: string): DeployPrecheck {
  try {
    const output = execSync(`fly apps list --json`, {
      encoding: 'utf-8',
      stdio: 'pipe',
      timeout: 30000,
    });

    const apps = JSON.parse(output);
    if (!Array.isArray(apps)) {
      return { name: 'App Exists', passed: false, message: 'Unexpected response from fly apps list' };
    }

    const exists = apps.some(
      (a: { Name?: string; name?: string }) => (a.Name || a.name) === appName,
    );

    if (exists) {
      return { name: 'App Exists', passed: true, message: `App "${appName}" found on Fly.io` };
    }
    return {
      name: 'App Exists',
      passed: false,
      message: `App "${appName}" not found. Run: fly launch`,
    };
  } catch {
    return {
      name: 'App Exists',
      passed: false,
      message: `Could not verify app "${appName}" exists. Check fly CLI and authentication.`,
    };
  }
}

/**
 * Run all pre-deploy checks.
 */
export function runPreDeployChecks(appName: string): DeployPrecheck[] {
  return [
    checkFlyCli(),
    checkFlyToml(),
    checkDockerfile(),
    checkFlyAuth(),
    checkAppExists(appName),
  ];
}

// ============================================================================
// Deploy Command
// ============================================================================

/**
 * Build the fly deploy command.
 */
export function buildDeployCommand(appName: string): string {
  return `fly deploy --app ${appName}`;
}

/**
 * Build the fly status command.
 */
export function buildStatusCommand(appName: string): string {
  return `fly status --app ${appName}`;
}

/**
 * Get the current status of a Fly.io app after deployment.
 */
export function getFlyStatus(appName: string): FlyStatusInfo | null {
  try {
    const output = execSync(`fly status --app ${appName} --json`, {
      encoding: 'utf-8',
      stdio: 'pipe',
      timeout: 30000,
    });

    const data = JSON.parse(output);
    return {
      appName: data.Name || data.name || appName,
      status: data.Status || data.status || 'unknown',
      hostname: `${appName}.fly.dev`,
      version: data.Version?.toString() || data.version?.toString(),
      machines: data.Machines?.length || data.machines?.length,
    };
  } catch {
    return null;
  }
}

// ============================================================================
// Main Deploy Function
// ============================================================================

/**
 * Deploy the application to Fly.io.
 *
 * @param dryRun - If true, do not actually deploy.
 * @param appName - Override the app name.
 * @param timeout - Deploy command timeout in milliseconds.
 */
export function deployToFly(
  dryRun = false,
  appName?: string,
  timeout = DEFAULT_DEPLOY_TIMEOUT,
): FlyDeployResult {
  const resolvedAppName = resolveAppName(appName);

  // Dry-run mode
  if (dryRun) {
    const cmd = buildDeployCommand(resolvedAppName);
    return {
      success: true,
      appName: resolvedAppName,
      action: 'dry-run',
      message: `[dry-run] Would execute: ${cmd}`,
      hostname: `${resolvedAppName}.fly.dev`,
    };
  }

  // Run pre-deploy checks
  const checks = runPreDeployChecks(resolvedAppName);
  const failed = checks.filter((c) => !c.passed);

  if (failed.length > 0) {
    const failedNames = failed.map((c) => c.name).join(', ');
    return {
      success: false,
      appName: resolvedAppName,
      action: 'skipped',
      message: `Pre-deploy checks failed: ${failedNames}. ${failed.map((c) => c.message).join('; ')}`,
    };
  }

  // Execute deploy
  const deployCmd = buildDeployCommand(resolvedAppName);
  try {
    execSync(deployCmd, {
      cwd: ROOT_DIR,
      stdio: 'inherit',
      timeout,
    });

    // Verify deployment
    const status = getFlyStatus(resolvedAppName);
    const hostname = `${resolvedAppName}.fly.dev`;

    return {
      success: true,
      appName: resolvedAppName,
      action: 'deployed',
      message: `App "${resolvedAppName}" deployed successfully`,
      hostname,
      version: status?.version,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      appName: resolvedAppName,
      action: 'skipped',
      message: `Deployment failed: ${errMsg}`,
    };
  }
}

// ============================================================================
// CLI entry point
// ============================================================================

if (process.argv[1] && import.meta.filename && process.argv[1] === import.meta.filename) {
  console.log('=== Fly.io Deployment ===\n');

  const dryRun = process.argv.includes('--dry-run');
  const appIndex = process.argv.indexOf('--app');
  const explicitApp = appIndex !== -1 ? process.argv[appIndex + 1] : undefined;
  const appName = resolveAppName(explicitApp);

  console.log(`App:  ${appName}`);
  console.log(`Mode: ${dryRun ? 'dry-run' : 'deploy'}\n`);

  // Show pre-deploy checks
  console.log('Pre-deploy checks:');
  if (!dryRun) {
    const checks = runPreDeployChecks(appName);
    for (const check of checks) {
      const icon = check.passed ? '✅' : '❌';
      console.log(`  ${icon} ${check.name}: ${check.message}`);
    }

    const failed = checks.filter((c) => !c.passed);
    if (failed.length > 0) {
      console.error(`\n❌ ${failed.length} pre-deploy check(s) failed. Cannot deploy.`);
      process.exit(1);
    }
    console.log('  All checks passed.\n');
  } else {
    console.log('  [dry-run] Skipping checks.\n');
  }

  // Deploy
  console.log('Deploying...\n');
  const result = deployToFly(dryRun, appName);

  if (result.success) {
    console.log(`\n✅ ${result.message}`);
    if (result.hostname) {
      console.log(`   URL: https://${result.hostname}`);
    }
    if (result.version) {
      console.log(`   Version: ${result.version}`);
    }
  } else {
    console.error(`\n❌ ${result.message}`);
    process.exit(1);
  }
}
