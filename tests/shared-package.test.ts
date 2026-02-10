import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(__dirname, '..');
const SHARED_DIR = resolve(ROOT, 'packages/shared');
const pkg = JSON.parse(readFileSync(resolve(SHARED_DIR, 'package.json'), 'utf-8'));

describe('packages/shared/package.json - Basic fields', () => {
  it('should exist', () => {
    expect(existsSync(resolve(SHARED_DIR, 'package.json'))).toBe(true);
  });

  it('should have correct name @aiinstaller/shared', () => {
    expect(pkg.name).toBe('@aiinstaller/shared');
  });

  it('should have a valid version', () => {
    expect(pkg.version).toBeDefined();
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('should be private', () => {
    expect(pkg.private).toBe(true);
  });

  it('should use ESM modules', () => {
    expect(pkg.type).toBe('module');
  });

  it('should have a description', () => {
    expect(pkg.description).toBeDefined();
    expect(typeof pkg.description).toBe('string');
    expect(pkg.description.length).toBeGreaterThan(0);
  });
});

describe('packages/shared/package.json - Entry points', () => {
  it('should have main pointing to dist/index.js', () => {
    expect(pkg.main).toBe('dist/index.js');
  });

  it('should have types pointing to dist/index.d.ts', () => {
    expect(pkg.types).toBe('dist/index.d.ts');
  });

  it('should have exports field', () => {
    expect(pkg.exports).toBeDefined();
    expect(pkg.exports['.']).toBeDefined();
  });

  it('should have import and types in exports', () => {
    expect(pkg.exports['.'].import).toBe('./dist/index.js');
    expect(pkg.exports['.'].types).toBe('./dist/index.d.ts');
  });
});

describe('packages/shared/package.json - Scripts', () => {
  it('should have build script using tsc', () => {
    expect(pkg.scripts.build).toBeDefined();
    expect(pkg.scripts.build).toContain('tsc');
  });

  it('should have dev script with watch mode', () => {
    expect(pkg.scripts.dev).toBeDefined();
    expect(pkg.scripts.dev).toContain('--watch');
  });

  it('should have test script', () => {
    expect(pkg.scripts.test).toBeDefined();
    expect(pkg.scripts.test).toContain('vitest');
  });

  it('should have typecheck script', () => {
    expect(pkg.scripts.typecheck).toBeDefined();
    expect(pkg.scripts.typecheck).toContain('tsc');
    expect(pkg.scripts.typecheck).toContain('--noEmit');
  });

  it('should have clean script', () => {
    expect(pkg.scripts.clean).toBeDefined();
    expect(pkg.scripts.clean).toContain('dist');
  });
});

describe('packages/shared/package.json - Dependencies', () => {
  it('should have zod as dependency', () => {
    expect(pkg.dependencies).toBeDefined();
    expect(pkg.dependencies.zod).toBeDefined();
    expect(pkg.dependencies.zod).toMatch(/^\^3\./);
  });

  it('should have typescript as devDependency', () => {
    expect(pkg.devDependencies).toBeDefined();
    expect(pkg.devDependencies.typescript).toBeDefined();
  });

  it('should have vitest as devDependency', () => {
    expect(pkg.devDependencies.vitest).toBeDefined();
  });
});

describe('packages/shared/package.json - Engine requirements', () => {
  it('should require Node.js >= 22.0.0', () => {
    expect(pkg.engines).toBeDefined();
    expect(pkg.engines.node).toBe('>=22.0.0');
  });
});

describe('packages/shared - Directory structure', () => {
  it('should have src directory', () => {
    expect(existsSync(resolve(SHARED_DIR, 'src'))).toBe(true);
  });

  it('should have src/index.ts entry point', () => {
    expect(existsSync(resolve(SHARED_DIR, 'src/index.ts'))).toBe(true);
  });

  it('should have tsconfig.json', () => {
    expect(existsSync(resolve(SHARED_DIR, 'tsconfig.json'))).toBe(true);
  });
});

describe('packages/shared/tsconfig.json - Configuration', () => {
  const tsconfig = JSON.parse(readFileSync(resolve(SHARED_DIR, 'tsconfig.json'), 'utf-8'));

  it('should extend root tsconfig', () => {
    expect(tsconfig.extends).toBeDefined();
    expect(tsconfig.extends).toContain('../../tsconfig.json');
  });

  it('should have outDir set to dist', () => {
    expect(tsconfig.compilerOptions.outDir).toBe('dist');
  });

  it('should have rootDir set to src', () => {
    expect(tsconfig.compilerOptions.rootDir).toBe('src');
  });

  it('should include src/**/*.ts', () => {
    expect(tsconfig.include).toBeDefined();
    expect(tsconfig.include).toContain('src/**/*.ts');
  });

  it('should exclude node_modules and dist', () => {
    expect(tsconfig.exclude).toBeDefined();
    expect(tsconfig.exclude).toContain('node_modules');
    expect(tsconfig.exclude).toContain('dist');
  });
});

describe('packages/shared - Workspace integration', () => {
  const rootPkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8'));
  const rootTsconfig = JSON.parse(readFileSync(resolve(ROOT, 'tsconfig.json'), 'utf-8'));
  const workspaceYaml = readFileSync(resolve(ROOT, 'pnpm-workspace.yaml'), 'utf-8');

  it('should be included in pnpm workspace', () => {
    expect(workspaceYaml).toContain('packages/*');
  });

  it('should be referenced in root tsconfig paths', () => {
    expect(rootTsconfig.compilerOptions.paths['@aiinstaller/shared']).toBeDefined();
  });

  it('should have consistent package name with root workspace filter', () => {
    const devServerScript = rootPkg.scripts['dev:server'] || '';
    const devAgentScript = rootPkg.scripts['dev:agent'] || '';
    expect(devServerScript).toContain('@aiinstaller/');
    expect(devAgentScript).toContain('@aiinstaller/');
  });
});
