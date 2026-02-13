// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Docker image integration / consistency tests
 *
 * Validates that Dockerfile, docker-compose.yml, .dockerignore, .env.example,
 * and project configuration files are all coherent with each other.
 * Also verifies that the image would build correctly by checking all referenced
 * files exist and have the expected content.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// ============================================================================
// Helpers
// ============================================================================

const ROOT_DIR = resolve(__dirname, '..', '..', '..', '..');
const SERVER_DIR = resolve(ROOT_DIR, 'packages', 'server');

function readFile(relativePath: string): string {
  return readFileSync(resolve(ROOT_DIR, relativePath), 'utf-8');
}

function fileExists(relativePath: string): boolean {
  return existsSync(resolve(ROOT_DIR, relativePath));
}

let dockerfile: string;
let compose: string;
let buildOverride: string;
let dockerignore: string;
let envExample: string;
let rootPkg: Record<string, unknown>;
let serverPkg: Record<string, unknown>;
let sharedPkg: Record<string, unknown>;

beforeAll(() => {
  dockerfile = readFile('packages/server/Dockerfile');
  compose = readFile('docker-compose.yml');
  buildOverride = readFile('docker-compose.build.yml');
  dockerignore = readFile('.dockerignore');
  envExample = readFile('.env.example');
  rootPkg = JSON.parse(readFile('package.json'));
  serverPkg = JSON.parse(readFile('packages/server/package.json'));
  sharedPkg = JSON.parse(readFile('packages/shared/package.json'));
});

// ============================================================================
// Cross-file consistency: Dockerfile ↔ docker-compose.yml
// ============================================================================

describe('Dockerfile ↔ docker-compose.yml consistency', () => {
  it('build override dockerfile should match Dockerfile location', () => {
    expect(buildOverride).toContain('dockerfile: packages/server/Dockerfile');
    expect(fileExists('packages/server/Dockerfile')).toBe(true);
  });

  it('compose should use pre-built image (no build section)', () => {
    expect(compose).toContain('image: ghcr.io/jingjinbao/serverpilot/server:latest');
  });

  it('exposed port in Dockerfile should match compose port mapping', () => {
    const dockerfilePort = dockerfile.match(/EXPOSE\s+(\d+)/);
    expect(dockerfilePort).not.toBeNull();
    const port = dockerfilePort![1];
    expect(compose).toContain(`:${port}`);
  });

  it('NODE_ENV should be production in both Dockerfile and compose', () => {
    expect(dockerfile).toMatch(/ENV\s+NODE_ENV=production/);
    expect(compose).toContain('NODE_ENV=production');
  });

  it('SERVER_PORT should be consistent between Dockerfile and compose', () => {
    const dockerfilePort = dockerfile.match(/ENV\s+SERVER_PORT=(\d+)/);
    expect(dockerfilePort).not.toBeNull();
    expect(compose).toContain(`SERVER_PORT=${dockerfilePort![1]}`);
  });

  it('SERVER_HOST should be consistent between Dockerfile and compose', () => {
    expect(dockerfile).toMatch(/ENV\s+SERVER_HOST=0\.0\.0\.0/);
    expect(compose).toContain('SERVER_HOST=0.0.0.0');
  });

  it('health check should be defined in both Dockerfile and compose', () => {
    expect(dockerfile).toMatch(/^HEALTHCHECK/m);
    expect(compose).toContain('healthcheck:');
  });

  it('health check should target the same port in both files', () => {
    const dockerfileHC = dockerfile.match(/localhost:(\d+)/);
    const composeHC = compose.match(/localhost:(\d+)/);
    expect(dockerfileHC).not.toBeNull();
    expect(composeHC).not.toBeNull();
    expect(dockerfileHC![1]).toBe(composeHC![1]);
  });
});

// ============================================================================
// Cross-file consistency: docker-compose.yml ↔ .env.example
// ============================================================================

describe('docker-compose.yml ↔ .env.example consistency', () => {
  it('all compose env vars with defaults should have matching .env.example entries', () => {
    // Extract variable names from compose that use ${VAR:-default} pattern
    const composeVars = compose.matchAll(/\$\{(\w+):-/g);
    for (const match of composeVars) {
      const varName = match[1];
      expect(envExample, `${varName} should be documented in .env.example`).toContain(varName);
    }
  });

  it('ANTHROPIC_API_KEY should be in both compose and .env.example', () => {
    expect(compose).toContain('ANTHROPIC_API_KEY');
    expect(envExample).toContain('ANTHROPIC_API_KEY');
  });

  it('AI_MODEL default should be consistent', () => {
    const composeModel = compose.match(/AI_MODEL=\$\{AI_MODEL:-([^}]+)\}/);
    const envModel = envExample.match(/AI_MODEL=(.+)/);
    expect(composeModel).not.toBeNull();
    expect(envModel).not.toBeNull();
    expect(composeModel![1]).toBe(envModel![1]);
  });

  it('WS_HEARTBEAT_INTERVAL_MS default should be consistent', () => {
    const composeVal = compose.match(/WS_HEARTBEAT_INTERVAL_MS=\$\{WS_HEARTBEAT_INTERVAL_MS:-(\d+)\}/);
    const envVal = envExample.match(/WS_HEARTBEAT_INTERVAL_MS=(\d+)/);
    expect(composeVal).not.toBeNull();
    expect(envVal).not.toBeNull();
    expect(composeVal![1]).toBe(envVal![1]);
  });

  it('WS_CONNECTION_TIMEOUT_MS default should be consistent', () => {
    const composeVal = compose.match(/WS_CONNECTION_TIMEOUT_MS=\$\{WS_CONNECTION_TIMEOUT_MS:-(\d+)\}/);
    const envVal = envExample.match(/WS_CONNECTION_TIMEOUT_MS=(\d+)/);
    expect(composeVal).not.toBeNull();
    expect(envVal).not.toBeNull();
    expect(composeVal![1]).toBe(envVal![1]);
  });
});

// ============================================================================
// Cross-file consistency: Dockerfile ↔ project config
// ============================================================================

describe('Dockerfile ↔ project configuration consistency', () => {
  it('Node.js version in Dockerfile should match engines requirement', () => {
    // Dockerfile uses node:22-alpine
    const nodeVersion = dockerfile.match(/FROM\s+node:(\d+)-alpine/);
    expect(nodeVersion).not.toBeNull();
    const majorVersion = parseInt(nodeVersion![1], 10);

    // package.json requires >=22.0.0
    const engines = serverPkg.engines as Record<string, string>;
    const requiredVersion = engines.node.match(/>=(\d+)/);
    expect(requiredVersion).not.toBeNull();
    expect(majorVersion).toBeGreaterThanOrEqual(parseInt(requiredVersion![1], 10));
  });

  it('pnpm version in Dockerfile should match packageManager field', () => {
    const dockerPnpm = dockerfile.match(/corepack prepare pnpm@([\d.]+)/);
    const pkgPnpm = (rootPkg.packageManager as string).match(/pnpm@([\d.]+)/);
    expect(dockerPnpm).not.toBeNull();
    expect(pkgPnpm).not.toBeNull();
    expect(dockerPnpm![1]).toBe(pkgPnpm![1]);
  });

  it('CMD entry point should match server package main field', () => {
    const cmdMatch = dockerfile.match(/CMD\s+\["node",\s+"([^"]+)"\]/);
    expect(cmdMatch).not.toBeNull();
    // CMD uses packages/server/dist/index.js, package.json main is dist/index.js
    expect(cmdMatch![1]).toBe('packages/server/dist/index.js');
    expect(serverPkg.main).toBe('dist/index.js');
  });

  it('LABEL version should match package.json version', () => {
    const labelVersion = dockerfile.match(/LABEL\s+version="([^"]+)"/);
    expect(labelVersion).not.toBeNull();
    expect(labelVersion![1]).toBe(serverPkg.version);
  });
});

// ============================================================================
// Build prerequisites: all referenced files exist
// ============================================================================

describe('Docker build prerequisites', () => {
  it('pnpm-workspace.yaml should exist', () => {
    expect(fileExists('pnpm-workspace.yaml')).toBe(true);
  });

  it('pnpm-lock.yaml should exist', () => {
    expect(fileExists('pnpm-lock.yaml')).toBe(true);
  });

  it('root package.json should exist', () => {
    expect(fileExists('package.json')).toBe(true);
  });

  it('root tsconfig.json should exist', () => {
    expect(fileExists('tsconfig.json')).toBe(true);
  });

  it('packages/shared/package.json should exist', () => {
    expect(fileExists('packages/shared/package.json')).toBe(true);
  });

  it('packages/server/package.json should exist', () => {
    expect(fileExists('packages/server/package.json')).toBe(true);
  });

  it('knowledge-base/ directory should exist', () => {
    expect(fileExists('knowledge-base')).toBe(true);
  });

  it('server source directory should exist', () => {
    expect(fileExists('packages/server/src')).toBe(true);
  });

  it('shared source directory should exist', () => {
    expect(fileExists('packages/shared/src')).toBe(true);
  });
});

// ============================================================================
// .dockerignore correctness
// ============================================================================

describe('.dockerignore completeness', () => {
  it('should not exclude files required by the build', () => {
    // These files are COPY'd in the Dockerfile and must NOT be in .dockerignore
    const requiredFiles = [
      'pnpm-workspace.yaml',
      'pnpm-lock.yaml',
      'tsconfig.json',
    ];
    const ignoreLines = dockerignore.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));

    for (const file of requiredFiles) {
      // Check that the file is not directly listed as an ignore pattern
      const directlyIgnored = ignoreLines.some((line) => line === file);
      expect(directlyIgnored, `${file} should NOT be in .dockerignore (needed for build)`).toBe(false);
    }
  });

  it('should exclude openclaw-modules (not needed in image)', () => {
    expect(dockerignore).toContain('openclaw-modules');
  });

  it('should exclude .github directory', () => {
    expect(dockerignore).toContain('.github');
  });

  it('should exclude coverage output', () => {
    expect(dockerignore).toContain('coverage');
  });

  it('should exclude log files', () => {
    expect(dockerignore).toMatch(/\*\.log/);
  });
});

// ============================================================================
// Image size optimization
// ============================================================================

describe('image size optimization', () => {
  it('should use alpine variant for small base image', () => {
    const fromStatements = dockerfile.match(/^FROM\s+\S+/gm) || [];
    for (const stmt of fromStatements) {
      expect(stmt).toContain('alpine');
    }
  });

  it('should prune devDependencies after build', () => {
    // Build stage should prune devDependencies to keep only production deps
    const buildStageMatch = dockerfile.match(/AS\s+build[\s\S]*?(?=FROM|$)/);
    expect(buildStageMatch).not.toBeNull();
    expect(buildStageMatch![0]).toContain('prune --prod');
  });

  it('should only copy dist output to runtime stage (not source)', () => {
    const runtimeStage = dockerfile.match(/AS\s+runtime[\s\S]*/);
    expect(runtimeStage).not.toBeNull();
    const runtimeContent = runtimeStage![0];
    // Should copy dist directories
    expect(runtimeContent).toContain('/dist');
    // Should NOT copy full src directories in the runtime stage
    // (db/migrations are an exception — Drizzle needs SQL migration files at runtime)
    const srcCopies = runtimeContent.match(/COPY.*packages\/server\/src/g) || [];
    const nonMigrationSrcCopies = srcCopies.filter((c) => !c.includes('migrations'));
    expect(nonMigrationSrcCopies).toHaveLength(0);
    expect(runtimeContent).not.toMatch(/COPY.*packages\/shared\/src/);
  });

  it('should not copy devDependencies to runtime stage', () => {
    const runtimeStage = dockerfile.match(/AS\s+runtime[\s\S]*/);
    expect(runtimeStage).not.toBeNull();
    // Should copy node_modules from build stage (which pruned devDeps)
    expect(runtimeStage![0]).toContain('--from=build');
  });
});

// ============================================================================
// Security hardening
// ============================================================================

describe('security hardening', () => {
  it('should not run as root in production', () => {
    const runtimeStage = dockerfile.match(/AS\s+runtime[\s\S]*/);
    expect(runtimeStage).not.toBeNull();
    expect(runtimeStage![0]).toMatch(/^USER\s+\S+/m);
  });

  it('should set file ownership to non-root user', () => {
    expect(dockerfile).toMatch(/chown.*serverpilot/);
  });

  it('should use specific user/group IDs', () => {
    expect(dockerfile).toMatch(/addgroup\s+-g\s+\d+/);
    expect(dockerfile).toMatch(/adduser\s+-S\s+\w+\s+-u\s+\d+/);
  });

  it('.dockerignore should exclude .env files to prevent secret leaks', () => {
    expect(dockerignore).toContain('.env');
  });
});

// ============================================================================
// Container runtime readiness
// ============================================================================

describe('container runtime readiness', () => {
  it('should set WORKDIR to /app', () => {
    expect(dockerfile).toMatch(/WORKDIR\s+\/app/);
  });

  it('should bind to 0.0.0.0 (not localhost) for container networking', () => {
    expect(dockerfile).toMatch(/SERVER_HOST=0\.0\.0\.0/);
  });

  it('compose restart policy should handle crashes', () => {
    expect(compose).toMatch(/restart:\s*(unless-stopped|always|on-failure)/);
  });

  it('health check should use a reasonable interval', () => {
    const intervalMatch = dockerfile.match(/--interval=(\d+)s/);
    expect(intervalMatch).not.toBeNull();
    const interval = parseInt(intervalMatch![1], 10);
    // Between 10 and 120 seconds is reasonable
    expect(interval).toBeGreaterThanOrEqual(10);
    expect(interval).toBeLessThanOrEqual(120);
  });

  it('health check should use a reasonable timeout', () => {
    const timeoutMatch = dockerfile.match(/--timeout=(\d+)s/);
    expect(timeoutMatch).not.toBeNull();
    const timeout = parseInt(timeoutMatch![1], 10);
    expect(timeout).toBeGreaterThanOrEqual(3);
    expect(timeout).toBeLessThanOrEqual(30);
  });

  it('health check should have a start period for container init', () => {
    const startMatch = dockerfile.match(/--start-period=(\d+)s/);
    expect(startMatch).not.toBeNull();
    const startPeriod = parseInt(startMatch![1], 10);
    expect(startPeriod).toBeGreaterThanOrEqual(5);
  });
});
