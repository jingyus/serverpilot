/**
 * Fly.io Secrets (Environment Variables) Configuration Module
 *
 * Manages Fly.io application secrets via `fly secrets set/list/unset`.
 * Secrets are used for sensitive configuration like API keys that should
 * not be stored in fly.toml (which is committed to git).
 *
 * Features:
 * - List current secrets on the Fly.io app
 * - Set required and optional secrets
 * - Validate that all required secrets are configured
 * - Supports dry-run mode
 * - Reads defaults from .env.example
 *
 * Usage: npx tsx scripts/fly-secrets.ts [--dry-run] [--app <name>]
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT_DIR = path.resolve(import.meta.dirname, '..');

// ============================================================================
// Types
// ============================================================================

export interface FlySecretEntry {
  name: string;
  digest: string;
  createdAt: string;
}

export interface FlySecretsListResult {
  success: boolean;
  secrets: FlySecretEntry[];
  error?: string;
}

export interface FlySecretSetResult {
  success: boolean;
  name: string;
  action: 'set' | 'skipped' | 'dry-run';
  message: string;
}

export interface FlySecretsValidation {
  valid: boolean;
  missing: string[];
  present: string[];
  results: FlySecretSetResult[];
}

// ============================================================================
// Constants
// ============================================================================

/** Required secrets that must be set for the app to function */
export const REQUIRED_SECRETS = ['ANTHROPIC_API_KEY'] as const;

/** Optional secrets that can override defaults from fly.toml [env] */
export const OPTIONAL_SECRETS = [
  'AI_MODEL',
  'AI_TIMEOUT_MS',
  'AI_MAX_RETRIES',
  'WS_HEARTBEAT_INTERVAL_MS',
  'WS_CONNECTION_TIMEOUT_MS',
  'LOG_LEVEL',
] as const;

/** All known secrets (required + optional) */
export const ALL_SECRETS = [...REQUIRED_SECRETS, ...OPTIONAL_SECRETS] as const;

// ============================================================================
// Helpers
// ============================================================================

/**
 * Resolve the app name: explicit argument → fly.toml → default.
 */
export function resolveAppName(appName?: string): string {
  if (appName) return appName;

  const flyTomlPath = path.join(ROOT_DIR, 'fly.toml');
  if (fs.existsSync(flyTomlPath)) {
    const content = fs.readFileSync(flyTomlPath, 'utf-8');
    const match = content.match(/^app\s*=\s*"([^"]+)"/m);
    if (match) return match[1];
  }

  return 'aiinstaller-server';
}

/**
 * Parse .env.example to extract variable descriptions and default values.
 */
export function parseEnvExample(): Map<string, { description: string; defaultValue: string }> {
  const envExamplePath = path.join(ROOT_DIR, '.env.example');
  const result = new Map<string, { description: string; defaultValue: string }>();

  if (!fs.existsSync(envExamplePath)) return result;

  const content = fs.readFileSync(envExamplePath, 'utf-8');
  const lines = content.split('\n');
  let lastComment = '';

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith('#') && !trimmed.startsWith('# ---') && !trimmed.startsWith('# ===')) {
      lastComment = trimmed.replace(/^#\s*/, '');
      continue;
    }

    const kvMatch = trimmed.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (kvMatch) {
      const [, key, value] = kvMatch;
      result.set(key, { description: lastComment, defaultValue: value });
      lastComment = '';
    } else {
      lastComment = '';
    }
  }

  return result;
}

/**
 * Build the `fly secrets set` command for a single key-value pair.
 */
export function buildSetCommand(name: string, value: string, appName: string): string {
  return `fly secrets set ${name}=${value} --app ${appName}`;
}

/**
 * Build the `fly secrets unset` command for a single key.
 */
export function buildUnsetCommand(name: string, appName: string): string {
  return `fly secrets unset ${name} --app ${appName}`;
}

/**
 * Build the `fly secrets list` command.
 */
export function buildListCommand(appName: string): string {
  return `fly secrets list --app ${appName}`;
}

// ============================================================================
// Core Operations
// ============================================================================

/**
 * List current secrets set on the Fly.io app.
 */
export function listSecrets(appName: string): FlySecretsListResult {
  try {
    const output = execSync(`fly secrets list --app ${appName} --json`, {
      encoding: 'utf-8',
      stdio: 'pipe',
      timeout: 30000,
    });

    const parsed = JSON.parse(output);
    if (!Array.isArray(parsed)) {
      return { success: false, secrets: [], error: 'Unexpected response format' };
    }

    const secrets: FlySecretEntry[] = parsed.map((entry: Record<string, string>) => ({
      name: entry.Name || entry.name || '',
      digest: entry.Digest || entry.digest || '',
      createdAt: entry.CreatedAt || entry.createdAt || '',
    }));

    return { success: true, secrets };
  } catch (err) {
    return {
      success: false,
      secrets: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Set a single secret on the Fly.io app.
 */
export function setSecret(
  name: string,
  value: string,
  appName: string,
  dryRun = false,
): FlySecretSetResult {
  if (!name || !value) {
    return {
      success: false,
      name,
      action: 'skipped',
      message: 'Name and value are required',
    };
  }

  if (dryRun) {
    return {
      success: true,
      name,
      action: 'dry-run',
      message: `[dry-run] Would set secret: ${name}`,
    };
  }

  try {
    execSync(`fly secrets set ${name}=${value} --app ${appName}`, {
      encoding: 'utf-8',
      stdio: 'pipe',
      timeout: 30000,
    });

    return {
      success: true,
      name,
      action: 'set',
      message: `Secret "${name}" set successfully`,
    };
  } catch (err) {
    return {
      success: false,
      name,
      action: 'skipped',
      message: `Failed to set secret "${name}": ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Set multiple secrets at once (more efficient, single deploy cycle).
 */
export function setMultipleSecrets(
  secrets: Record<string, string>,
  appName: string,
  dryRun = false,
): FlySecretSetResult[] {
  const entries = Object.entries(secrets).filter(([, v]) => v);

  if (entries.length === 0) {
    return [];
  }

  if (dryRun) {
    return entries.map(([name]) => ({
      success: true,
      name,
      action: 'dry-run' as const,
      message: `[dry-run] Would set secret: ${name}`,
    }));
  }

  // Build a single `fly secrets set K1=V1 K2=V2 ...` command for efficiency
  const pairs = entries.map(([k, v]) => `${k}=${v}`).join(' ');
  try {
    execSync(`fly secrets set ${pairs} --app ${appName}`, {
      encoding: 'utf-8',
      stdio: 'pipe',
      timeout: 60000,
    });

    return entries.map(([name]) => ({
      success: true,
      name,
      action: 'set' as const,
      message: `Secret "${name}" set successfully`,
    }));
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return entries.map(([name]) => ({
      success: false,
      name,
      action: 'skipped' as const,
      message: `Failed to set secret "${name}": ${errMsg}`,
    }));
  }
}

/**
 * Validate that all required secrets are set on the Fly.io app.
 */
export function validateSecrets(appName: string, dryRun = false): FlySecretsValidation {
  if (dryRun) {
    return {
      valid: false,
      missing: [...REQUIRED_SECRETS],
      present: [],
      results: REQUIRED_SECRETS.map((name) => ({
        success: true,
        name,
        action: 'dry-run' as const,
        message: `[dry-run] Would check secret: ${name}`,
      })),
    };
  }

  const listResult = listSecrets(appName);
  if (!listResult.success) {
    return {
      valid: false,
      missing: [...REQUIRED_SECRETS],
      present: [],
      results: [{
        success: false,
        name: 'secrets-list',
        action: 'skipped',
        message: `Failed to list secrets: ${listResult.error}`,
      }],
    };
  }

  const secretNames = new Set(listResult.secrets.map((s) => s.name));
  const missing: string[] = [];
  const present: string[] = [];
  const results: FlySecretSetResult[] = [];

  for (const name of REQUIRED_SECRETS) {
    if (secretNames.has(name)) {
      present.push(name);
      results.push({
        success: true,
        name,
        action: 'skipped',
        message: `Secret "${name}" is already set`,
      });
    } else {
      missing.push(name);
      results.push({
        success: false,
        name,
        action: 'skipped',
        message: `Required secret "${name}" is not set. Run: fly secrets set ${name}=<value> --app ${appName}`,
      });
    }
  }

  return {
    valid: missing.length === 0,
    missing,
    present,
    results,
  };
}

/**
 * Get a summary of which secrets are set and which are missing.
 */
export function getSecretsSummary(appName: string): {
  required: { name: string; isSet: boolean }[];
  optional: { name: string; isSet: boolean }[];
} {
  const listResult = listSecrets(appName);
  const secretNames = new Set(
    listResult.success ? listResult.secrets.map((s) => s.name) : [],
  );

  return {
    required: REQUIRED_SECRETS.map((name) => ({
      name,
      isSet: secretNames.has(name),
    })),
    optional: OPTIONAL_SECRETS.map((name) => ({
      name,
      isSet: secretNames.has(name),
    })),
  };
}

// ============================================================================
// CLI entry point
// ============================================================================

if (process.argv[1] && import.meta.filename && process.argv[1] === import.meta.filename) {
  const dryRun = process.argv.includes('--dry-run');
  const appIndex = process.argv.indexOf('--app');
  const explicitApp = appIndex !== -1 ? process.argv[appIndex + 1] : undefined;
  const appName = resolveAppName(explicitApp);

  console.log('=== Fly.io Secrets Configuration ===\n');
  console.log(`App: ${appName}`);

  if (dryRun) {
    console.log('Mode: dry-run\n');
  }

  // Show .env.example info
  const envInfo = parseEnvExample();
  console.log('\nRequired secrets:');
  for (const name of REQUIRED_SECRETS) {
    const info = envInfo.get(name);
    const desc = info ? ` — ${info.description}` : '';
    console.log(`  - ${name}${desc}`);
  }

  console.log('\nOptional secrets (have defaults in fly.toml):');
  for (const name of OPTIONAL_SECRETS) {
    const info = envInfo.get(name);
    const defaultVal = info ? ` (default: ${info.defaultValue})` : '';
    console.log(`  - ${name}${defaultVal}`);
  }

  if (!dryRun) {
    console.log('\nValidating current secrets...');
    const validation = validateSecrets(appName);

    for (const r of validation.results) {
      const icon = r.success ? '✅' : '❌';
      console.log(`  ${icon} ${r.name}: ${r.message}`);
    }

    if (validation.valid) {
      console.log('\n✅ All required secrets are configured.');
    } else {
      console.log(`\n❌ Missing ${validation.missing.length} required secret(s):`);
      for (const name of validation.missing) {
        console.log(`   fly secrets set ${name}=<value> --app ${appName}`);
      }
      process.exit(1);
    }
  } else {
    console.log('\n[dry-run] Skipping validation. Commands to set secrets:');
    for (const name of REQUIRED_SECRETS) {
      console.log(`  fly secrets set ${name}=<value> --app ${appName}`);
    }
  }
}
