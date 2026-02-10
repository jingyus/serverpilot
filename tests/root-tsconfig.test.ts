import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(__dirname, '..');
const tsconfigPath = resolve(ROOT, 'tsconfig.json');
const tsconfig = JSON.parse(readFileSync(tsconfigPath, 'utf-8'));
const compilerOptions = tsconfig.compilerOptions;

describe('Root tsconfig.json - File existence', () => {
  it('should exist at project root', () => {
    expect(existsSync(tsconfigPath)).toBe(true);
  });

  it('should be valid JSON', () => {
    expect(() => JSON.parse(readFileSync(tsconfigPath, 'utf-8'))).not.toThrow();
  });
});

describe('Root tsconfig.json - compilerOptions', () => {
  it('should have compilerOptions defined', () => {
    expect(tsconfig.compilerOptions).toBeDefined();
  });

  it('should target ES2022', () => {
    expect(compilerOptions.target).toBe('ES2022');
  });

  it('should use NodeNext module system', () => {
    expect(compilerOptions.module).toBe('NodeNext');
  });

  it('should use NodeNext module resolution', () => {
    expect(compilerOptions.moduleResolution).toBe('NodeNext');
  });

  it('should enable strict mode', () => {
    expect(compilerOptions.strict).toBe(true);
  });

  it('should enable esModuleInterop', () => {
    expect(compilerOptions.esModuleInterop).toBe(true);
  });

  it('should enable skipLibCheck', () => {
    expect(compilerOptions.skipLibCheck).toBe(true);
  });

  it('should enforce consistent casing in file names', () => {
    expect(compilerOptions.forceConsistentCasingInFileNames).toBe(true);
  });

  it('should enable resolveJsonModule', () => {
    expect(compilerOptions.resolveJsonModule).toBe(true);
  });

  it('should enable declaration generation', () => {
    expect(compilerOptions.declaration).toBe(true);
  });

  it('should enable source maps', () => {
    expect(compilerOptions.sourceMap).toBe(true);
  });

  it('should set outDir to dist', () => {
    expect(compilerOptions.outDir).toBe('dist');
  });
});

describe('Root tsconfig.json - Workspace paths', () => {
  it('should have baseUrl set to root', () => {
    expect(compilerOptions.baseUrl).toBe('.');
  });

  it('should have paths defined', () => {
    expect(compilerOptions.paths).toBeDefined();
  });

  it('should map @aiinstaller/shared to packages/shared/src', () => {
    expect(compilerOptions.paths['@aiinstaller/shared']).toEqual(['packages/shared/src']);
  });

  it('should map @aiinstaller/server to packages/server/src', () => {
    expect(compilerOptions.paths['@aiinstaller/server']).toEqual(['packages/server/src']);
  });

  it('should map @aiinstaller/agent to packages/agent/src', () => {
    expect(compilerOptions.paths['@aiinstaller/agent']).toEqual(['packages/agent/src']);
  });
});

describe('Root tsconfig.json - Include and Exclude', () => {
  it('should include packages source files', () => {
    expect(tsconfig.include).toBeDefined();
    expect(tsconfig.include).toContain('packages/*/src/**/*.ts');
  });

  it('should exclude node_modules', () => {
    expect(tsconfig.exclude).toBeDefined();
    expect(tsconfig.exclude).toContain('node_modules');
  });

  it('should exclude dist directory', () => {
    expect(tsconfig.exclude).toContain('dist');
  });

  it('should exclude test files', () => {
    expect(tsconfig.exclude).toContain('**/*.test.ts');
  });
});

describe('Root tsconfig.json - Development standard compliance', () => {
  it('should have declarationMap enabled for source navigation', () => {
    expect(compilerOptions.declarationMap).toBe(true);
  });

  it('should align with development standard module config (NodeNext)', () => {
    // 开发标准要求 module: NodeNext, moduleResolution: NodeNext
    expect(compilerOptions.module).toBe('NodeNext');
    expect(compilerOptions.moduleResolution).toBe('NodeNext');
  });

  it('should align with development standard strict mode', () => {
    // 开发标准要求 strict: true
    expect(compilerOptions.strict).toBe(true);
  });
});
