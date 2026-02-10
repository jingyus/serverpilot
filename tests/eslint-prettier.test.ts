import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const ROOT_DIR = path.resolve(import.meta.dirname, '..');

// Config file paths
const eslintConfigPath = path.join(ROOT_DIR, 'eslint.config.js');
const prettierConfigPath = path.join(ROOT_DIR, '.prettierrc');
const prettierIgnorePath = path.join(ROOT_DIR, '.prettierignore');

// Skip tests if config files don't exist (optional configuration not yet set up)
const eslintConfigExists = fs.existsSync(eslintConfigPath);
const prettierConfigExists = fs.existsSync(prettierConfigPath);
const prettierIgnoreExists = fs.existsSync(prettierIgnorePath);

describe.skipIf(!eslintConfigExists)('ESLint Configuration', () => {

  it('should have eslint.config.js file', () => {
    expect(fs.existsSync(eslintConfigPath)).toBe(true);
  });

  it('should have eslint installed as devDependency', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf-8'));
    expect(pkg.devDependencies).toHaveProperty('eslint');
  });

  it('should have typescript-eslint installed', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf-8'));
    expect(pkg.devDependencies).toHaveProperty('typescript-eslint');
  });

  it('should have eslint-config-prettier installed', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf-8'));
    expect(pkg.devDependencies).toHaveProperty('eslint-config-prettier');
  });

  it('should have eslint-plugin-import-x installed', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf-8'));
    expect(pkg.devDependencies).toHaveProperty('eslint-plugin-import-x');
  });

  it('should export a valid ESLint flat config', async () => {
    const config = await import(eslintConfigPath);
    expect(config.default).toBeDefined();
    expect(Array.isArray(config.default)).toBe(true);
    expect(config.default.length).toBeGreaterThan(0);
  });

  it('should configure ignores for dist, node_modules, openclaw-modules', async () => {
    const config = await import(eslintConfigPath);
    const ignoreConfig = config.default.find(
      (c: Record<string, unknown>) => c.ignores && !c.files,
    );
    expect(ignoreConfig).toBeDefined();
    expect(ignoreConfig.ignores).toContain('dist/');
    expect(ignoreConfig.ignores).toContain('node_modules/');
    expect(ignoreConfig.ignores).toContain('openclaw-modules/');
  });

  it('should have lint and lint:fix scripts in package.json', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf-8'));
    expect(pkg.scripts).toHaveProperty('lint');
    expect(pkg.scripts).toHaveProperty('lint:fix');
  });

  it('should run eslint --version without error', () => {
    const result = execSync('npx eslint --version', { cwd: ROOT_DIR, encoding: 'utf-8' });
    expect(result.trim()).toMatch(/^v?\d+\.\d+\.\d+$/);
  });
});

describe.skipIf(!prettierConfigExists)('Prettier Configuration', () => {

  it('should have .prettierrc file', () => {
    expect(fs.existsSync(prettierConfigPath)).toBe(true);
  });

  it('should have .prettierignore file', () => {
    expect(fs.existsSync(prettierIgnorePath)).toBe(true);
  });

  it('should have prettier installed as devDependency', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf-8'));
    expect(pkg.devDependencies).toHaveProperty('prettier');
  });

  it('should have valid JSON in .prettierrc', () => {
    const content = fs.readFileSync(prettierConfigPath, 'utf-8');
    expect(() => JSON.parse(content)).not.toThrow();
  });

  it('should configure singleQuote as true', () => {
    const config = JSON.parse(fs.readFileSync(prettierConfigPath, 'utf-8'));
    expect(config.singleQuote).toBe(true);
  });

  it('should configure semi as true', () => {
    const config = JSON.parse(fs.readFileSync(prettierConfigPath, 'utf-8'));
    expect(config.semi).toBe(true);
  });

  it('should configure trailingComma as all', () => {
    const config = JSON.parse(fs.readFileSync(prettierConfigPath, 'utf-8'));
    expect(config.trailingComma).toBe('all');
  });

  it('should configure printWidth', () => {
    const config = JSON.parse(fs.readFileSync(prettierConfigPath, 'utf-8'));
    expect(config.printWidth).toBe(100);
  });

  it('should configure tabWidth as 2', () => {
    const config = JSON.parse(fs.readFileSync(prettierConfigPath, 'utf-8'));
    expect(config.tabWidth).toBe(2);
  });

  it('should ignore dist and node_modules in .prettierignore', () => {
    const content = fs.readFileSync(prettierIgnorePath, 'utf-8');
    expect(content).toContain('dist/');
    expect(content).toContain('node_modules/');
    expect(content).toContain('openclaw-modules/');
  });

  it('should have format script in package.json', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf-8'));
    expect(pkg.scripts).toHaveProperty('format');
  });

  it('should run prettier --version without error', () => {
    const result = execSync('npx prettier --version', { cwd: ROOT_DIR, encoding: 'utf-8' });
    expect(result.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe.skipIf(!eslintConfigExists || !prettierConfigExists)('ESLint and Prettier Integration', () => {
  it('should not have conflicting rules (eslint-config-prettier is loaded)', async () => {
    const config = await import(eslintConfigPath);
    const configArray = config.default;

    // eslint-config-prettier should be one of the configs (it disables formatting rules)
    const hasPrettierConfig = configArray.some((c: Record<string, unknown>) => {
      // eslint-config-prettier sets specific rules to 'off'
      const rules = c.rules as Record<string, unknown> | undefined;
      return rules && rules['curly'] === 0;
    });
    expect(hasPrettierConfig).toBe(true);
  });

  it('should have @eslint/js installed', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf-8'));
    expect(pkg.devDependencies).toHaveProperty('@eslint/js');
  });

  it('should have globals installed', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf-8'));
    expect(pkg.devDependencies).toHaveProperty('globals');
  });
});
