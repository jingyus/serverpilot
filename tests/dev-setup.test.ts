import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, accessSync, constants } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '..');

describe('dev-setup.sh', () => {
  const scriptPath = resolve(ROOT, 'scripts/dev-setup.sh');

  it('exists and is readable', () => {
    expect(existsSync(scriptPath)).toBe(true);
    const content = readFileSync(scriptPath, 'utf-8');
    expect(content.length).toBeGreaterThan(0);
  });

  it('is executable', () => {
    expect(() => accessSync(scriptPath, constants.X_OK)).not.toThrow();
  });

  it('has proper shebang', () => {
    const content = readFileSync(scriptPath, 'utf-8');
    expect(content.startsWith('#!/usr/bin/env bash')).toBe(true);
  });

  it('checks Node.js version >= 22', () => {
    const content = readFileSync(scriptPath, 'utf-8');
    expect(content).toContain('22.0.0');
    expect(content).toContain('node');
  });

  it('checks pnpm version >= 9', () => {
    const content = readFileSync(scriptPath, 'utf-8');
    expect(content).toContain('9.0.0');
    expect(content).toContain('pnpm');
  });

  it('creates .env.local from .env.example', () => {
    const content = readFileSync(scriptPath, 'utf-8');
    expect(content).toContain('.env.local');
    expect(content).toContain('.env.example');
  });

  it('prompts AI provider configuration', () => {
    const content = readFileSync(scriptPath, 'utf-8');
    expect(content).toContain('AI_PROVIDER');
    expect(content).toContain('ANTHROPIC_API_KEY');
    expect(content).toContain('OPENAI_API_KEY');
    expect(content).toContain('DEEPSEEK_API_KEY');
  });

  it('creates data directory', () => {
    const content = readFileSync(scriptPath, 'utf-8');
    expect(content).toContain('mkdir');
    expect(content).toContain('data');
  });

  it('installs dependencies with pnpm', () => {
    const content = readFileSync(scriptPath, 'utf-8');
    expect(content).toContain('pnpm install');
  });

  it('builds shared package', () => {
    const content = readFileSync(scriptPath, 'utf-8');
    expect(content).toContain('@aiinstaller/shared');
    expect(content).toContain('build');
  });

  it('uses set -euo pipefail for safety', () => {
    const content = readFileSync(scriptPath, 'utf-8');
    expect(content).toContain('set -euo pipefail');
  });

  it('provides friendly error messages for missing tools', () => {
    const content = readFileSync(scriptPath, 'utf-8');
    // Check for install instructions
    expect(content).toContain('nodejs.org');
    expect(content).toContain('corepack');
  });
});

describe('Development configuration', () => {
  describe('package.json dev scripts', () => {
    it('root dev script builds shared first then runs parallel', () => {
      const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8'));
      const devScript = pkg.scripts.dev as string;
      expect(devScript).toContain('@aiinstaller/shared');
      expect(devScript).toContain('build');
      expect(devScript).toContain('--parallel');
    });

    it('server dev script uses tsx watch for hot-reload', () => {
      const pkg = JSON.parse(readFileSync(resolve(ROOT, 'packages/server/package.json'), 'utf-8'));
      expect(pkg.scripts.dev).toBe('tsx watch src/index.ts');
    });

    it('dashboard dev script uses vite', () => {
      const pkg = JSON.parse(readFileSync(resolve(ROOT, 'packages/dashboard/package.json'), 'utf-8'));
      expect(pkg.scripts.dev).toBe('vite');
    });

    it('shared dev script uses tsc --watch', () => {
      const pkg = JSON.parse(readFileSync(resolve(ROOT, 'packages/shared/package.json'), 'utf-8'));
      expect(pkg.scripts.dev).toBe('tsc --watch');
    });

    it('root has individual dev scripts for each package', () => {
      const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8'));
      expect(pkg.scripts['dev:server']).toContain('@aiinstaller/server');
      expect(pkg.scripts['dev:dashboard']).toContain('@aiinstaller/dashboard');
      expect(pkg.scripts['dev:agent']).toContain('@aiinstaller/agent');
    });
  });

  describe('Vite proxy configuration', () => {
    it('vite.config.ts exists', () => {
      expect(existsSync(resolve(ROOT, 'packages/dashboard/vite.config.ts'))).toBe(true);
    });

    it('proxies /api to server port 3000', () => {
      const content = readFileSync(resolve(ROOT, 'packages/dashboard/vite.config.ts'), 'utf-8');
      expect(content).toContain("'/api'");
      expect(content).toContain('localhost:3000');
    });

    it('proxies /ws to WebSocket on port 3000', () => {
      const content = readFileSync(resolve(ROOT, 'packages/dashboard/vite.config.ts'), 'utf-8');
      expect(content).toContain("'/ws'");
      expect(content).toContain('ws://localhost:3000');
      expect(content).toContain('ws: true');
    });

    it('dashboard runs on port 5173', () => {
      const content = readFileSync(resolve(ROOT, 'packages/dashboard/vite.config.ts'), 'utf-8');
      expect(content).toContain('port: 5173');
    });
  });

  describe('Server config supports .env.local', () => {
    it('server index.ts loads .env.local with priority', () => {
      const content = readFileSync(resolve(ROOT, 'packages/server/src/index.ts'), 'utf-8');
      expect(content).toContain('.env.local');
      // .env.local should be loaded before .env (higher priority)
      const envLocalIdx = content.indexOf('.env.local');
      const configCallIdx = content.indexOf("config()", envLocalIdx);
      expect(envLocalIdx).toBeLessThan(configCallIdx);
    });
  });

  describe('.env.example', () => {
    it('exists and contains required variables', () => {
      const content = readFileSync(resolve(ROOT, '.env.example'), 'utf-8');
      expect(content).toContain('JWT_SECRET');
      expect(content).toContain('AI_PROVIDER');
      expect(content).toContain('ANTHROPIC_API_KEY');
      expect(content).toContain('DATABASE_PATH');
      expect(content).toContain('SERVER_PORT');
      expect(content).toContain('SERVER_HOST');
    });
  });

  describe('Engine requirements', () => {
    it('root package.json requires Node >= 22', () => {
      const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8'));
      expect(pkg.engines.node).toBe('>=22.0.0');
    });

    it('root package.json requires pnpm >= 9', () => {
      const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8'));
      expect(pkg.engines.pnpm).toBe('>=9.0.0');
    });
  });
});
