import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(__dirname, '..');
const AGENT_DIR = resolve(ROOT, 'packages/agent');
const tsconfigPath = resolve(AGENT_DIR, 'tsconfig.json');
const tsconfig = JSON.parse(readFileSync(tsconfigPath, 'utf-8'));
const rootTsconfig = JSON.parse(readFileSync(resolve(ROOT, 'tsconfig.json'), 'utf-8'));

describe('packages/agent/tsconfig.json - File existence', () => {
  it('should exist', () => {
    expect(existsSync(tsconfigPath)).toBe(true);
  });

  it('should be valid JSON', () => {
    expect(() => JSON.parse(readFileSync(tsconfigPath, 'utf-8'))).not.toThrow();
  });
});

describe('packages/agent/tsconfig.json - Extends root config', () => {
  it('should extend root tsconfig.json', () => {
    expect(tsconfig.extends).toBeDefined();
    expect(tsconfig.extends).toBe('../../tsconfig.json');
  });

  it('should point to an existing root tsconfig', () => {
    const resolvedPath = resolve(AGENT_DIR, tsconfig.extends);
    expect(existsSync(resolvedPath)).toBe(true);
  });
});

describe('packages/agent/tsconfig.json - compilerOptions', () => {
  it('should have compilerOptions defined', () => {
    expect(tsconfig.compilerOptions).toBeDefined();
  });

  it('should set outDir to dist', () => {
    expect(tsconfig.compilerOptions.outDir).toBe('dist');
  });

  it('should set rootDir to src', () => {
    expect(tsconfig.compilerOptions.rootDir).toBe('src');
  });
});

describe('packages/agent/tsconfig.json - Inherited settings from root', () => {
  it('root should have target ES2022', () => {
    expect(rootTsconfig.compilerOptions.target).toBe('ES2022');
  });

  it('root should have module NodeNext', () => {
    expect(rootTsconfig.compilerOptions.module).toBe('NodeNext');
  });

  it('root should have moduleResolution NodeNext', () => {
    expect(rootTsconfig.compilerOptions.moduleResolution).toBe('NodeNext');
  });

  it('root should have strict mode enabled', () => {
    expect(rootTsconfig.compilerOptions.strict).toBe(true);
  });

  it('root should have esModuleInterop enabled', () => {
    expect(rootTsconfig.compilerOptions.esModuleInterop).toBe(true);
  });

  it('root should have skipLibCheck enabled', () => {
    expect(rootTsconfig.compilerOptions.skipLibCheck).toBe(true);
  });

  it('root should have forceConsistentCasingInFileNames enabled', () => {
    expect(rootTsconfig.compilerOptions.forceConsistentCasingInFileNames).toBe(true);
  });

  it('root should have resolveJsonModule enabled', () => {
    expect(rootTsconfig.compilerOptions.resolveJsonModule).toBe(true);
  });

  it('root should have declaration enabled', () => {
    expect(rootTsconfig.compilerOptions.declaration).toBe(true);
  });

  it('root should have declarationMap enabled', () => {
    expect(rootTsconfig.compilerOptions.declarationMap).toBe(true);
  });

  it('root should have sourceMap enabled', () => {
    expect(rootTsconfig.compilerOptions.sourceMap).toBe(true);
  });
});

describe('packages/agent/tsconfig.json - Include and Exclude', () => {
  it('should include src/**/*.ts', () => {
    expect(tsconfig.include).toBeDefined();
    expect(tsconfig.include).toContain('src/**/*.ts');
  });

  it('should exclude node_modules', () => {
    expect(tsconfig.exclude).toBeDefined();
    expect(tsconfig.exclude).toContain('node_modules');
  });

  it('should exclude dist', () => {
    expect(tsconfig.exclude).toContain('dist');
  });

  it('should exclude test files', () => {
    expect(tsconfig.exclude).toContain('**/*.test.ts');
  });
});

describe('packages/agent/tsconfig.json - Development standards compliance', () => {
  it('should follow the development standard tsconfig pattern', () => {
    expect(tsconfig.extends).toBeDefined();
    expect(tsconfig.compilerOptions.outDir).toBe('dist');
    expect(tsconfig.compilerOptions.rootDir).toBe('src');
    expect(tsconfig.include).toContain('src/**/*.ts');
  });

  it('should not override strict mode (inherit from root)', () => {
    expect(tsconfig.compilerOptions.strict).toBeUndefined();
  });

  it('should not override module setting (inherit from root)', () => {
    expect(tsconfig.compilerOptions.module).toBeUndefined();
  });

  it('should not override moduleResolution (inherit from root)', () => {
    expect(tsconfig.compilerOptions.moduleResolution).toBeUndefined();
  });

  it('should be compatible with package.json build script', () => {
    const pkg = JSON.parse(readFileSync(resolve(AGENT_DIR, 'package.json'), 'utf-8'));
    expect(pkg.scripts.build).toContain('tsc');
    expect(pkg.main).toContain(tsconfig.compilerOptions.outDir);
  });

  it('should be compatible with package.json types entry', () => {
    const pkg = JSON.parse(readFileSync(resolve(AGENT_DIR, 'package.json'), 'utf-8'));
    expect(pkg.types).toContain(tsconfig.compilerOptions.outDir);
  });
});

describe('packages/agent/tsconfig.json - Source directory', () => {
  it('should have src directory existing', () => {
    expect(existsSync(resolve(AGENT_DIR, 'src'))).toBe(true);
  });

  it('should have src/index.ts entry point', () => {
    expect(existsSync(resolve(AGENT_DIR, 'src/index.ts'))).toBe(true);
  });

  it('should have src/detect directory for environment detection', () => {
    expect(existsSync(resolve(AGENT_DIR, 'src/detect'))).toBe(true);
  });

  it('should have src/execute directory for command execution', () => {
    expect(existsSync(resolve(AGENT_DIR, 'src/execute'))).toBe(true);
  });

  it('should have src/ui directory for terminal UI', () => {
    expect(existsSync(resolve(AGENT_DIR, 'src/ui'))).toBe(true);
  });
});

describe('packages/agent/tsconfig.json - Consistency with shared and server packages', () => {
  it('should use the same extends pattern as shared tsconfig', () => {
    const sharedTsconfig = JSON.parse(
      readFileSync(resolve(ROOT, 'packages/shared/tsconfig.json'), 'utf-8')
    );
    expect(tsconfig.extends).toBe(sharedTsconfig.extends);
  });

  it('should use the same extends pattern as server tsconfig', () => {
    const serverTsconfig = JSON.parse(
      readFileSync(resolve(ROOT, 'packages/server/tsconfig.json'), 'utf-8')
    );
    expect(tsconfig.extends).toBe(serverTsconfig.extends);
  });

  it('should use the same outDir as shared tsconfig', () => {
    const sharedTsconfig = JSON.parse(
      readFileSync(resolve(ROOT, 'packages/shared/tsconfig.json'), 'utf-8')
    );
    expect(tsconfig.compilerOptions.outDir).toBe(sharedTsconfig.compilerOptions.outDir);
  });

  it('should use the same rootDir as shared tsconfig', () => {
    const sharedTsconfig = JSON.parse(
      readFileSync(resolve(ROOT, 'packages/shared/tsconfig.json'), 'utf-8')
    );
    expect(tsconfig.compilerOptions.rootDir).toBe(sharedTsconfig.compilerOptions.rootDir);
  });

  it('should use the same include pattern as shared tsconfig', () => {
    const sharedTsconfig = JSON.parse(
      readFileSync(resolve(ROOT, 'packages/shared/tsconfig.json'), 'utf-8')
    );
    expect(tsconfig.include).toEqual(sharedTsconfig.include);
  });

  it('should use the same exclude pattern as shared tsconfig', () => {
    const sharedTsconfig = JSON.parse(
      readFileSync(resolve(ROOT, 'packages/shared/tsconfig.json'), 'utf-8')
    );
    expect(tsconfig.exclude).toEqual(sharedTsconfig.exclude);
  });
});

describe('packages/agent/tsconfig.json - Workspace integration', () => {
  it('should be listed in root tsconfig paths as @aiinstaller/agent', () => {
    expect(rootTsconfig.compilerOptions.paths).toBeDefined();
    expect(rootTsconfig.compilerOptions.paths['@aiinstaller/agent']).toBeDefined();
    expect(rootTsconfig.compilerOptions.paths['@aiinstaller/agent']).toContain(
      'packages/agent/src'
    );
  });

  it('should be part of pnpm workspace', () => {
    const workspaceFile = resolve(ROOT, 'pnpm-workspace.yaml');
    expect(existsSync(workspaceFile)).toBe(true);
    const content = readFileSync(workspaceFile, 'utf-8');
    expect(content).toContain('packages/');
  });

  it('should have vitest alias configured in root vitest.config.ts', () => {
    const vitestConfig = readFileSync(resolve(ROOT, 'vitest.config.ts'), 'utf-8');
    expect(vitestConfig).toContain('@aiinstaller/agent');
    expect(vitestConfig).toContain('packages/agent/src/index.ts');
  });
});
