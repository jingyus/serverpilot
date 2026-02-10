/**
 * Tests for packages/server/Dockerfile
 *
 * Validates the Dockerfile structure, best practices, and configuration:
 * - Multi-stage build structure
 * - Base image and Node.js version
 * - Security (non-root user)
 * - Required build stages
 * - Environment variables and exposed ports
 * - Health check configuration
 * - .dockerignore coverage
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// ============================================================================
// Helpers
// ============================================================================

const ROOT_DIR = resolve(__dirname, '..', '..', '..', '..');
const SERVER_DIR = resolve(ROOT_DIR, 'packages', 'server');
const DOCKERFILE_PATH = resolve(SERVER_DIR, 'Dockerfile');
const DOCKERIGNORE_PATH = resolve(ROOT_DIR, '.dockerignore');

let dockerfileContent: string;
let dockerignoreContent: string;

beforeAll(() => {
  dockerfileContent = readFileSync(DOCKERFILE_PATH, 'utf-8');
  dockerignoreContent = readFileSync(DOCKERIGNORE_PATH, 'utf-8');
});

// ============================================================================
// Dockerfile existence
// ============================================================================

describe('Dockerfile existence', () => {
  it('should have a Dockerfile in packages/server/', () => {
    expect(existsSync(DOCKERFILE_PATH)).toBe(true);
  });

  it('should have a .dockerignore in the project root', () => {
    expect(existsSync(DOCKERIGNORE_PATH)).toBe(true);
  });
});

// ============================================================================
// Multi-stage build
// ============================================================================

describe('multi-stage build', () => {
  it('should use multi-stage build with at least 3 stages', () => {
    const fromStatements = dockerfileContent.match(/^FROM\s+/gm);
    expect(fromStatements).not.toBeNull();
    expect(fromStatements!.length).toBeGreaterThanOrEqual(3);
  });

  it('should have a deps stage for dependency installation', () => {
    expect(dockerfileContent).toMatch(/FROM\s+node:22-alpine\s+AS\s+deps/);
  });

  it('should have a build stage for TypeScript compilation', () => {
    expect(dockerfileContent).toMatch(/FROM\s+node:22-alpine\s+AS\s+build/);
  });

  it('should have a runtime stage for production', () => {
    expect(dockerfileContent).toMatch(/FROM\s+node:22-alpine\s+AS\s+runtime/);
  });
});

// ============================================================================
// Base image
// ============================================================================

describe('base image', () => {
  it('should use node:22-alpine as base image', () => {
    expect(dockerfileContent).toContain('FROM node:22-alpine');
  });

  it('should use alpine variant for minimal image size', () => {
    const fromLines = dockerfileContent.match(/^FROM\s+\S+/gm) || [];
    for (const line of fromLines) {
      expect(line).toContain('alpine');
    }
  });
});

// ============================================================================
// pnpm setup
// ============================================================================

describe('pnpm setup', () => {
  it('should enable corepack for pnpm', () => {
    expect(dockerfileContent).toContain('corepack enable');
  });

  it('should prepare the correct pnpm version', () => {
    expect(dockerfileContent).toMatch(/corepack prepare pnpm@[\d.]+ --activate/);
  });

  it('should use --frozen-lockfile for reproducible installs', () => {
    expect(dockerfileContent).toContain('--frozen-lockfile');
  });
});

// ============================================================================
// Workspace handling
// ============================================================================

describe('workspace handling', () => {
  it('should copy pnpm-workspace.yaml', () => {
    expect(dockerfileContent).toContain('pnpm-workspace.yaml');
  });

  it('should copy root package.json', () => {
    expect(dockerfileContent).toMatch(/COPY.*package\.json/);
  });

  it('should copy pnpm-lock.yaml for lockfile', () => {
    expect(dockerfileContent).toContain('pnpm-lock.yaml');
  });

  it('should copy shared package.json', () => {
    expect(dockerfileContent).toContain('packages/shared/package.json');
  });

  it('should copy server package.json', () => {
    expect(dockerfileContent).toContain('packages/server/package.json');
  });
});

// ============================================================================
// Build process
// ============================================================================

describe('build process', () => {
  it('should build shared package before server', () => {
    const buildLine = dockerfileContent.match(
      /pnpm\s+--filter\s+@aiinstaller\/shared\s+build.*pnpm\s+--filter\s+@aiinstaller\/server\s+build/s,
    );
    expect(buildLine).not.toBeNull();
  });

  it('should copy shared source code in build stage', () => {
    expect(dockerfileContent).toMatch(/COPY\s+packages\/shared\/\s+packages\/shared\//);
  });

  it('should copy server source code in build stage', () => {
    expect(dockerfileContent).toMatch(/COPY\s+packages\/server\/\s+packages\/server\//);
  });
});

// ============================================================================
// Security
// ============================================================================

describe('security', () => {
  it('should create a non-root user', () => {
    expect(dockerfileContent).toMatch(/adduser.*aiinstaller/);
  });

  it('should create a non-root group', () => {
    expect(dockerfileContent).toMatch(/addgroup.*aiinstaller/);
  });

  it('should switch to non-root user with USER directive', () => {
    expect(dockerfileContent).toMatch(/^USER\s+aiinstaller/m);
  });

  it('should set NODE_ENV to production', () => {
    expect(dockerfileContent).toMatch(/ENV\s+NODE_ENV=production/);
  });
});

// ============================================================================
// Runtime configuration
// ============================================================================

describe('runtime configuration', () => {
  it('should expose port 3000', () => {
    expect(dockerfileContent).toMatch(/EXPOSE\s+3000/);
  });

  it('should set default SERVER_PORT to 3000', () => {
    expect(dockerfileContent).toMatch(/ENV\s+SERVER_PORT=3000/);
  });

  it('should set default SERVER_HOST to 0.0.0.0', () => {
    expect(dockerfileContent).toMatch(/ENV\s+SERVER_HOST=0\.0\.0\.0/);
  });

  it('should set default LOG_LEVEL', () => {
    expect(dockerfileContent).toMatch(/ENV\s+LOG_LEVEL=\w+/);
  });

  it('should use correct CMD to start the server', () => {
    expect(dockerfileContent).toMatch(/CMD\s+\["node",\s+"packages\/server\/dist\/index\.js"\]/);
  });
});

// ============================================================================
// Health check
// ============================================================================

describe('health check', () => {
  it('should include a HEALTHCHECK directive', () => {
    expect(dockerfileContent).toMatch(/^HEALTHCHECK/m);
  });

  it('should set a health check interval', () => {
    expect(dockerfileContent).toMatch(/--interval=\d+s/);
  });

  it('should set a health check timeout', () => {
    expect(dockerfileContent).toMatch(/--timeout=\d+s/);
  });

  it('should set a start period for health check', () => {
    expect(dockerfileContent).toMatch(/--start-period=\d+s/);
  });
});

// ============================================================================
// Labels
// ============================================================================

describe('image metadata', () => {
  it('should have a maintainer label', () => {
    expect(dockerfileContent).toMatch(/LABEL\s+maintainer=/);
  });

  it('should have a description label', () => {
    expect(dockerfileContent).toMatch(/LABEL\s+description=/);
  });

  it('should have a version label', () => {
    expect(dockerfileContent).toMatch(/LABEL\s+version=/);
  });
});

// ============================================================================
// .dockerignore
// ============================================================================

describe('.dockerignore', () => {
  it('should exclude node_modules', () => {
    expect(dockerignoreContent).toContain('node_modules');
  });

  it('should exclude dist directories', () => {
    expect(dockerignoreContent).toMatch(/dist/);
  });

  it('should exclude .git directory', () => {
    expect(dockerignoreContent).toContain('.git');
  });

  it('should exclude .env files', () => {
    expect(dockerignoreContent).toContain('.env');
  });

  it('should exclude test files', () => {
    expect(dockerignoreContent).toMatch(/\*\.test\.ts/);
  });

  it('should exclude IDE directories', () => {
    expect(dockerignoreContent).toMatch(/\.vscode/);
  });

  it('should exclude documentation markdown files', () => {
    expect(dockerignoreContent).toMatch(/\*\.md/);
  });
});
