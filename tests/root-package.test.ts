import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(__dirname, '..');
const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8'));

describe('Root package.json', () => {
  it('should exist', () => {
    expect(existsSync(resolve(ROOT, 'package.json'))).toBe(true);
  });

  it('should have correct name', () => {
    expect(pkg.name).toBe('aiinstaller');
  });

  it('should be private', () => {
    expect(pkg.private).toBe(true);
  });

  it('should use ESM modules', () => {
    expect(pkg.type).toBe('module');
  });

  it('should have a version', () => {
    expect(pkg.version).toBeDefined();
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe('Workspace configuration', () => {
  it('should have pnpm-workspace.yaml', () => {
    expect(existsSync(resolve(ROOT, 'pnpm-workspace.yaml'))).toBe(true);
  });

  it('pnpm-workspace.yaml should reference packages/*', () => {
    const workspace = readFileSync(resolve(ROOT, 'pnpm-workspace.yaml'), 'utf-8');
    expect(workspace).toContain('packages/*');
  });

  it('should have packages directory with sub-packages', () => {
    expect(existsSync(resolve(ROOT, 'packages/shared'))).toBe(true);
    expect(existsSync(resolve(ROOT, 'packages/server'))).toBe(true);
    expect(existsSync(resolve(ROOT, 'packages/agent'))).toBe(true);
  });
});

describe('Engine requirements', () => {
  it('should require Node.js >= 22.0.0', () => {
    expect(pkg.engines).toBeDefined();
    expect(pkg.engines.node).toBe('>=22.0.0');
  });

  it('should require pnpm >= 9.0.0', () => {
    expect(pkg.engines.pnpm).toBe('>=9.0.0');
  });

  it('should specify packageManager', () => {
    expect(pkg.packageManager).toBeDefined();
    expect(pkg.packageManager).toMatch(/^pnpm@/);
  });
});

describe('Scripts', () => {
  it('should have dev script', () => {
    expect(pkg.scripts.dev).toBeDefined();
  });

  it('should have build script', () => {
    expect(pkg.scripts.build).toBeDefined();
  });

  it('should have test script', () => {
    expect(pkg.scripts.test).toBeDefined();
    expect(pkg.scripts.test).toContain('vitest');
  });

  it('should have lint script', () => {
    expect(pkg.scripts.lint).toBeDefined();
  });

  it('should have format script', () => {
    expect(pkg.scripts.format).toBeDefined();
  });

  it('should have workspace-scoped dev scripts', () => {
    expect(pkg.scripts['dev:server']).toContain('@aiinstaller/server');
    expect(pkg.scripts['dev:agent']).toContain('@aiinstaller/agent');
  });

  it('should have workspace-scoped build scripts', () => {
    expect(pkg.scripts['build:server']).toContain('@aiinstaller/server');
    expect(pkg.scripts['build:agent']).toContain('@aiinstaller/agent');
  });
});

describe('DevDependencies', () => {
  it('should have typescript', () => {
    expect(pkg.devDependencies.typescript).toBeDefined();
  });

  it('should have vitest', () => {
    expect(pkg.devDependencies.vitest).toBeDefined();
  });
});
