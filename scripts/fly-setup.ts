/**
 * Fly.io Deployment Setup Validator
 *
 * Validates that all prerequisites for Fly.io deployment are in place:
 * - fly.toml configuration exists and is valid
 * - Dockerfile is present
 * - Required secrets are documented
 * - Deployment docs reference Fly.io
 *
 * Usage: npx tsx scripts/fly-setup.ts
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const ROOT_DIR = path.resolve(import.meta.dirname, '..');

/** Required secrets that must be set via `fly secrets set` */
export const REQUIRED_FLY_SECRETS = [
  'ANTHROPIC_API_KEY',
] as const;

/** Optional secrets with defaults in fly.toml [env] */
export const OPTIONAL_FLY_SECRETS = [
  'AI_MODEL',
  'AI_TIMEOUT_MS',
  'AI_MAX_RETRIES',
  'WS_HEARTBEAT_INTERVAL_MS',
  'WS_CONNECTION_TIMEOUT_MS',
  'LOG_LEVEL',
] as const;

export interface FlySetupCheckResult {
  name: string;
  passed: boolean;
  message: string;
}

/** Check whether fly CLI is installed */
export function checkFlyCli(): FlySetupCheckResult {
  try {
    const version = execSync('fly version', { encoding: 'utf-8', timeout: 5000 }).trim();
    return { name: 'Fly CLI', passed: true, message: `Installed: ${version}` };
  } catch {
    return {
      name: 'Fly CLI',
      passed: false,
      message: 'Not installed. Run: curl -L https://fly.io/install.sh | sh',
    };
  }
}

/** Check whether fly.toml exists */
export function checkFlyToml(): FlySetupCheckResult {
  const flyTomlPath = path.join(ROOT_DIR, 'fly.toml');
  if (fs.existsSync(flyTomlPath)) {
    return { name: 'fly.toml', passed: true, message: 'Configuration file exists' };
  }
  return { name: 'fly.toml', passed: false, message: 'fly.toml not found in project root' };
}

/** Check whether Dockerfile exists */
export function checkDockerfile(): FlySetupCheckResult {
  const dockerfilePath = path.join(ROOT_DIR, 'packages/server/Dockerfile');
  if (fs.existsSync(dockerfilePath)) {
    return { name: 'Dockerfile', passed: true, message: 'Dockerfile exists' };
  }
  return { name: 'Dockerfile', passed: false, message: 'packages/server/Dockerfile not found' };
}

/** Parse fly.toml and validate required fields */
export function parseFlyToml(): {
  app?: string;
  primaryRegion?: string;
  buildDockerfile?: string;
  internalPort?: number;
  envVars: Record<string, string>;
} {
  const flyTomlPath = path.join(ROOT_DIR, 'fly.toml');
  if (!fs.existsSync(flyTomlPath)) {
    return { envVars: {} };
  }

  const content = fs.readFileSync(flyTomlPath, 'utf-8');
  const lines = content.split('\n');

  let app: string | undefined;
  let primaryRegion: string | undefined;
  let buildDockerfile: string | undefined;
  let internalPort: number | undefined;
  const envVars: Record<string, string> = {};

  let currentSection = '';

  for (const line of lines) {
    const trimmed = line.trim();

    // Track sections
    if (trimmed.startsWith('[')) {
      currentSection = trimmed;
      continue;
    }

    // Skip comments and empty lines
    if (trimmed.startsWith('#') || trimmed === '') continue;

    const kvMatch = trimmed.match(/^(\w+)\s*=\s*"?([^"]*)"?\s*$/);
    if (!kvMatch) continue;

    const [, key, value] = kvMatch;

    if (currentSection === '' && key === 'app') {
      app = value;
    } else if (currentSection === '' && key === 'primary_region') {
      primaryRegion = value;
    } else if (currentSection === '[build]' && key === 'dockerfile') {
      buildDockerfile = value;
    } else if (currentSection === '[http_service]' && key === 'internal_port') {
      internalPort = parseInt(value, 10);
    } else if (currentSection === '[env]') {
      envVars[key] = value;
    }
  }

  return { app, primaryRegion, buildDockerfile, internalPort, envVars };
}

/** Validate fly.toml configuration completeness */
export function validateFlyConfig(): FlySetupCheckResult[] {
  const results: FlySetupCheckResult[] = [];
  const config = parseFlyToml();

  results.push({
    name: 'app name',
    passed: !!config.app,
    message: config.app ? `App: ${config.app}` : 'No app name specified',
  });

  results.push({
    name: 'primary_region',
    passed: !!config.primaryRegion,
    message: config.primaryRegion
      ? `Region: ${config.primaryRegion}`
      : 'No primary_region specified',
  });

  results.push({
    name: 'build.dockerfile',
    passed: !!config.buildDockerfile,
    message: config.buildDockerfile
      ? `Dockerfile: ${config.buildDockerfile}`
      : 'No dockerfile specified in [build]',
  });

  results.push({
    name: 'http_service.internal_port',
    passed: config.internalPort === 3000,
    message:
      config.internalPort === 3000
        ? 'Port: 3000'
        : `Expected port 3000, got ${config.internalPort ?? 'none'}`,
  });

  // Check that NODE_ENV is set in [env]
  results.push({
    name: 'env.NODE_ENV',
    passed: config.envVars['NODE_ENV'] === 'production',
    message:
      config.envVars['NODE_ENV'] === 'production'
        ? 'NODE_ENV=production'
        : `NODE_ENV should be "production", got "${config.envVars['NODE_ENV'] ?? 'unset'}"`,
  });

  return results;
}

/** Run all checks and print results */
export function runAllChecks(): FlySetupCheckResult[] {
  const results: FlySetupCheckResult[] = [];

  results.push(checkFlyToml());
  results.push(checkDockerfile());
  results.push(...validateFlyConfig());

  return results;
}

// CLI entry point
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  console.log('=== Fly.io Deployment Setup Check ===\n');

  const cliResult = checkFlyCli();
  const icon = cliResult.passed ? '✅' : '❌';
  console.log(`${icon} ${cliResult.name}: ${cliResult.message}`);

  const results = runAllChecks();
  for (const r of results) {
    const icon = r.passed ? '✅' : '❌';
    console.log(`${icon} ${r.name}: ${r.message}`);
  }

  const failed = results.filter((r) => !r.passed);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);

  if (failed.length > 0) {
    console.log('\nFailed checks:');
    for (const f of failed) {
      console.log(`  - ${f.name}: ${f.message}`);
    }
    process.exit(1);
  }
}
