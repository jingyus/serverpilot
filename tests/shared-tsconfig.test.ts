import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(__dirname, '..');
const SHARED_DIR = resolve(ROOT, 'packages/shared');
const tsconfigPath = resolve(SHARED_DIR, 'tsconfig.json');
const tsconfig = JSON.parse(readFileSync(tsconfigPath, 'utf-8'));
const rootTsconfig = JSON.parse(readFileSync(resolve(ROOT, 'tsconfig.json'), 'utf-8'));

describe('packages/shared/tsconfig.json - File existence', () => {
  it('should exist', () => {
    expect(existsSync(tsconfigPath)).toBe(true);
  });

  it('should be valid JSON', () => {
    expect(() => JSON.parse(readFileSync(tsconfigPath, 'utf-8'))).not.toThrow();
  });
});

describe('packages/shared/tsconfig.json - Extends root config', () => {
  it('should extend root tsconfig.json', () => {
    expect(tsconfig.extends).toBeDefined();
    expect(tsconfig.extends).toBe('../../tsconfig.json');
  });

  it('should point to an existing root tsconfig', () => {
    const resolvedPath = resolve(SHARED_DIR, tsconfig.extends);
    expect(existsSync(resolvedPath)).toBe(true);
  });
});

describe('packages/shared/tsconfig.json - compilerOptions', () => {
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

describe('packages/shared/tsconfig.json - Inherited settings from root', () => {
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

describe('packages/shared/tsconfig.json - Include and Exclude', () => {
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

describe('packages/shared/tsconfig.json - Development standards compliance', () => {
  it('should follow the development standard tsconfig pattern', () => {
    // Per docs/开发标准.md section 3.1, shared package tsconfig should:
    // - extend root config
    // - set outDir and rootDir
    // - include src files
    // - exclude non-source files
    expect(tsconfig.extends).toBeDefined();
    expect(tsconfig.compilerOptions.outDir).toBe('dist');
    expect(tsconfig.compilerOptions.rootDir).toBe('src');
    expect(tsconfig.include).toContain('src/**/*.ts');
  });

  it('should not override strict mode (inherit from root)', () => {
    // shared tsconfig should not set strict=false, inheriting true from root
    expect(tsconfig.compilerOptions.strict).toBeUndefined();
  });

  it('should not override module setting (inherit from root)', () => {
    expect(tsconfig.compilerOptions.module).toBeUndefined();
  });

  it('should not override moduleResolution (inherit from root)', () => {
    expect(tsconfig.compilerOptions.moduleResolution).toBeUndefined();
  });

  it('should be compatible with package.json build script', () => {
    const pkg = JSON.parse(readFileSync(resolve(SHARED_DIR, 'package.json'), 'utf-8'));
    // build script uses tsc, which reads tsconfig.json
    expect(pkg.scripts.build).toContain('tsc');
    // outDir should match package.json main entry directory
    expect(pkg.main).toContain(tsconfig.compilerOptions.outDir);
  });

  it('should be compatible with package.json types entry', () => {
    const pkg = JSON.parse(readFileSync(resolve(SHARED_DIR, 'package.json'), 'utf-8'));
    // types should point to dist directory (same as outDir)
    expect(pkg.types).toContain(tsconfig.compilerOptions.outDir);
  });
});

describe('packages/shared/tsconfig.json - Source directory', () => {
  it('should have src directory existing', () => {
    expect(existsSync(resolve(SHARED_DIR, 'src'))).toBe(true);
  });

  it('should have src/index.ts entry point', () => {
    expect(existsSync(resolve(SHARED_DIR, 'src/index.ts'))).toBe(true);
  });
});
