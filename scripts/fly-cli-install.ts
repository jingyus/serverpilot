/**
 * Fly CLI Installation Module
 *
 * Detects, installs, and verifies the Fly.io CLI (flyctl).
 *
 * Supported platforms:
 *   - macOS (via Homebrew or curl installer)
 *   - Linux (via curl installer)
 *
 * Usage: npx tsx scripts/fly-cli-install.ts
 */

import { execSync } from 'node:child_process';

// ============================================================================
// Types
// ============================================================================

export interface FlyCliStatus {
  installed: boolean;
  version?: string;
  path?: string;
}

export interface FlyCliInstallResult {
  success: boolean;
  method: InstallMethod;
  version?: string;
  error?: string;
}

export type InstallMethod = 'already-installed' | 'homebrew' | 'curl-installer' | 'skipped';

export type Platform = 'darwin' | 'linux' | 'unsupported';

// ============================================================================
// Constants
// ============================================================================

export const FLY_INSTALL_SCRIPT_URL = 'https://fly.io/install.sh';

export const FLY_CLI_NAMES = ['flyctl', 'fly'] as const;

// ============================================================================
// Detection
// ============================================================================

/**
 * Detect the current platform suitable for Fly CLI installation.
 */
export function detectPlatform(): Platform {
  switch (process.platform) {
    case 'darwin':
      return 'darwin';
    case 'linux':
      return 'linux';
    default:
      return 'unsupported';
  }
}

/**
 * Check if a command exists in PATH.
 */
export function commandExists(cmd: string): boolean {
  try {
    execSync(`command -v ${cmd}`, { encoding: 'utf-8', stdio: 'pipe', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the installed version of the Fly CLI.
 */
export function getFlyVersion(): string | undefined {
  for (const name of FLY_CLI_NAMES) {
    try {
      const output = execSync(`${name} version`, {
        encoding: 'utf-8',
        stdio: 'pipe',
        timeout: 10000,
      }).trim();
      return output;
    } catch {
      // Try next name
    }
  }
  return undefined;
}

/**
 * Get the path to the installed Fly CLI binary.
 */
export function getFlyPath(): string | undefined {
  for (const name of FLY_CLI_NAMES) {
    try {
      const p = execSync(`command -v ${name}`, {
        encoding: 'utf-8',
        stdio: 'pipe',
        timeout: 5000,
      }).trim();
      if (p) return p;
    } catch {
      // Try next name
    }
  }
  return undefined;
}

/**
 * Check the current status of the Fly CLI installation.
 */
export function checkFlyCliStatus(): FlyCliStatus {
  const version = getFlyVersion();
  if (version) {
    return {
      installed: true,
      version,
      path: getFlyPath(),
    };
  }
  return { installed: false };
}

// ============================================================================
// Installation
// ============================================================================

/**
 * Check if Homebrew is available (macOS).
 */
export function hasHomebrew(): boolean {
  return commandExists('brew');
}

/**
 * Build the installation command for the given method.
 */
export function getInstallCommand(method: InstallMethod): string {
  switch (method) {
    case 'homebrew':
      return 'brew install flyctl';
    case 'curl-installer':
      return `curl -L ${FLY_INSTALL_SCRIPT_URL} | sh`;
    default:
      return '';
  }
}

/**
 * Determine the best installation method for the current platform.
 */
export function chooseInstallMethod(platform: Platform): InstallMethod {
  if (platform === 'unsupported') {
    return 'skipped';
  }
  if (platform === 'darwin' && hasHomebrew()) {
    return 'homebrew';
  }
  return 'curl-installer';
}

/**
 * Execute the Fly CLI installation.
 *
 * @param method - Installation method to use. Auto-detected if not provided.
 * @param dryRun - If true, do not actually run the installation command.
 */
export function installFlyCli(
  method?: InstallMethod,
  dryRun = false,
): FlyCliInstallResult {
  // Check if already installed
  const status = checkFlyCliStatus();
  if (status.installed) {
    return {
      success: true,
      method: 'already-installed',
      version: status.version,
    };
  }

  const platform = detectPlatform();
  if (platform === 'unsupported') {
    return {
      success: false,
      method: 'skipped',
      error: `Unsupported platform: ${process.platform}. Fly CLI supports macOS and Linux.`,
    };
  }

  const chosenMethod = method ?? chooseInstallMethod(platform);
  const command = getInstallCommand(chosenMethod);

  if (!command) {
    return {
      success: false,
      method: chosenMethod,
      error: `No install command for method: ${chosenMethod}`,
    };
  }

  if (dryRun) {
    return {
      success: true,
      method: chosenMethod,
      version: '[dry-run]',
    };
  }

  try {
    execSync(command, {
      stdio: 'inherit',
      timeout: 120000,
      env: {
        ...process.env,
        // Ensure ~/.fly/bin is in PATH for post-install verification
        PATH: `${process.env.HOME}/.fly/bin:${process.env.PATH}`,
      },
    });

    // Verify installation
    const postStatus = checkFlyCliStatus();
    if (postStatus.installed) {
      return {
        success: true,
        method: chosenMethod,
        version: postStatus.version,
      };
    }

    return {
      success: false,
      method: chosenMethod,
      error: 'Installation command succeeded but fly CLI not found in PATH. You may need to add ~/.fly/bin to your PATH.',
    };
  } catch (err) {
    return {
      success: false,
      method: chosenMethod,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ============================================================================
// CLI entry point
// ============================================================================

if (process.argv[1] && import.meta.filename && process.argv[1] === import.meta.filename) {
  console.log('=== Fly CLI Installation ===\n');

  const dryRun = process.argv.includes('--dry-run');

  const status = checkFlyCliStatus();
  if (status.installed) {
    console.log(`Fly CLI is already installed.`);
    console.log(`  Version: ${status.version}`);
    console.log(`  Path:    ${status.path}`);
    process.exit(0);
  }

  console.log('Fly CLI is not installed. Installing...\n');

  const platform = detectPlatform();
  const method = chooseInstallMethod(platform);
  console.log(`Platform: ${platform}`);
  console.log(`Method:   ${method}`);
  console.log(`Command:  ${getInstallCommand(method)}`);

  if (dryRun) {
    console.log('\n[dry-run] Skipping actual installation.');
    process.exit(0);
  }

  console.log('');
  const result = installFlyCli(method);

  if (result.success) {
    console.log(`\n✅ Fly CLI installed successfully.`);
    console.log(`   Version: ${result.version}`);
  } else {
    console.error(`\n❌ Installation failed: ${result.error}`);
    process.exit(1);
  }
}
