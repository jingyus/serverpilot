// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for docker-compose.yml
 *
 * Validates the docker-compose configuration:
 * - File existence and YAML structure
 * - Service definition (server)
 * - Build context and Dockerfile reference
 * - Port mapping
 * - Environment variable configuration
 * - Volume mounts
 * - Health check configuration
 * - Restart policy
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// ============================================================================
// Helpers
// ============================================================================

const ROOT_DIR = resolve(__dirname, '..', '..', '..', '..');
const COMPOSE_PATH = resolve(ROOT_DIR, 'docker-compose.yml');
const BUILD_OVERRIDE_PATH = resolve(ROOT_DIR, 'docker-compose.build.yml');

let composeContent: string;
let buildOverrideContent: string;

beforeAll(() => {
  composeContent = readFileSync(COMPOSE_PATH, 'utf-8');
  buildOverrideContent = readFileSync(BUILD_OVERRIDE_PATH, 'utf-8');
});

// ============================================================================
// File existence
// ============================================================================

describe('docker-compose.yml existence', () => {
  it('should exist in project root', () => {
    expect(existsSync(COMPOSE_PATH)).toBe(true);
  });

  it('should not be empty', () => {
    expect(composeContent.trim().length).toBeGreaterThan(0);
  });
});

// ============================================================================
// Service definition
// ============================================================================

describe('server service', () => {
  it('should define a services section', () => {
    expect(composeContent).toMatch(/^services:/m);
  });

  it('should define a server service', () => {
    expect(composeContent).toMatch(/^\s+server:/m);
  });

  it('should set a container name', () => {
    expect(composeContent).toMatch(/container_name:\s*serverpilot-server/);
  });
});

// ============================================================================
// Image configuration (pre-built images, no build section)
// ============================================================================

describe('image configuration', () => {
  it('should use pre-built server image (no build section)', () => {
    expect(composeContent).toMatch(/image:\s*ghcr\.io\/jingjinbao\/serverpilot\/server:latest/);
    expect(composeContent).not.toMatch(/^\s+build:/m);
  });
});

// ============================================================================
// Build override configuration (docker-compose.build.yml)
// ============================================================================

describe('build override configuration', () => {
  it('should have build override file', () => {
    expect(existsSync(BUILD_OVERRIDE_PATH)).toBe(true);
  });

  it('should specify build context in override', () => {
    expect(buildOverrideContent).toMatch(/context:\s*\./);
  });

  it('should reference the server Dockerfile in override', () => {
    expect(buildOverrideContent).toMatch(/dockerfile:\s*packages\/server\/Dockerfile/);
  });
});

// ============================================================================
// Port mapping
// ============================================================================

describe('port mapping', () => {
  it('should expose dashboard port', () => {
    expect(composeContent).toMatch(/ports:/);
    expect(composeContent).toMatch(/DASHBOARD_PORT/);
  });

  it('should allow configurable dashboard host port', () => {
    expect(composeContent).toMatch(/\$\{DASHBOARD_PORT:-3001\}:80/);
  });
});

// ============================================================================
// Environment variables
// ============================================================================

describe('environment variables', () => {
  it('should set NODE_ENV to production', () => {
    expect(composeContent).toMatch(/NODE_ENV=production/);
  });

  it('should configure ANTHROPIC_API_KEY', () => {
    expect(composeContent).toMatch(/ANTHROPIC_API_KEY/);
  });

  it('should configure AI_MODEL with default', () => {
    expect(composeContent).toMatch(/AI_MODEL/);
  });

  it('should configure SERVER_PORT', () => {
    expect(composeContent).toMatch(/SERVER_PORT=3000/);
  });

  it('should configure SERVER_HOST to 0.0.0.0', () => {
    expect(composeContent).toMatch(/SERVER_HOST=0\.0\.0\.0/);
  });

  it('should configure LOG_LEVEL with default', () => {
    expect(composeContent).toMatch(/LOG_LEVEL/);
  });

  it('should configure WS_HEARTBEAT_INTERVAL_MS', () => {
    expect(composeContent).toMatch(/WS_HEARTBEAT_INTERVAL_MS/);
  });

  it('should configure WS_CONNECTION_TIMEOUT_MS', () => {
    expect(composeContent).toMatch(/WS_CONNECTION_TIMEOUT_MS/);
  });

  it('should configure KNOWLEDGE_BASE_DIR', () => {
    expect(composeContent).toMatch(/KNOWLEDGE_BASE_DIR/);
  });
});

// ============================================================================
// Volumes
// ============================================================================

describe('volumes', () => {
  it('should define a server-data volume for SQLite persistence', () => {
    expect(composeContent).toMatch(/^volumes:/m);
    expect(composeContent).toMatch(/server-data:/);
  });

  it('should mount server-data volume to /data', () => {
    expect(composeContent).toMatch(/server-data:\/data/);
  });
});

// ============================================================================
// Health check
// ============================================================================

describe('health check', () => {
  it('should define a healthcheck', () => {
    expect(composeContent).toMatch(/healthcheck:/);
  });

  it('should set health check interval', () => {
    expect(composeContent).toMatch(/interval:\s*\d+s/);
  });

  it('should set health check timeout', () => {
    expect(composeContent).toMatch(/timeout:\s*\d+s/);
  });

  it('should set health check start_period', () => {
    expect(composeContent).toMatch(/start_period:\s*\d+s/);
  });

  it('should set health check retries', () => {
    expect(composeContent).toMatch(/retries:\s*\d+/);
  });
});

// ============================================================================
// Restart policy
// ============================================================================

describe('restart policy', () => {
  it('should set restart policy to unless-stopped', () => {
    expect(composeContent).toMatch(/restart:\s*unless-stopped/);
  });
});
