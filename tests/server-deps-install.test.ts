import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';

const ROOT = resolve(__dirname, '..');
const SERVER_DIR = resolve(ROOT, 'packages/server');
const pkg = JSON.parse(readFileSync(resolve(SERVER_DIR, 'package.json'), 'utf-8'));

// Create a require function that resolves from packages/server context
const serverRequire = createRequire(resolve(SERVER_DIR, 'package.json'));

describe('Server dependencies - package.json declarations', () => {
  it('should have @anthropic-ai/sdk in dependencies', () => {
    expect(pkg.dependencies['@anthropic-ai/sdk']).toBeDefined();
  });

  it('should have ws in dependencies', () => {
    expect(pkg.dependencies.ws).toBeDefined();
  });

  it('should have hono in dependencies', () => {
    expect(pkg.dependencies.hono).toBeDefined();
  });

  it('should have zod in dependencies', () => {
    expect(pkg.dependencies.zod).toBeDefined();
  });

  it('should have dotenv in dependencies', () => {
    expect(pkg.dependencies.dotenv).toBeDefined();
  });

  it('should have @aiinstaller/shared as workspace dependency', () => {
    expect(pkg.dependencies['@aiinstaller/shared']).toBe('workspace:*');
  });

  it('should have @types/ws in devDependencies', () => {
    expect(pkg.devDependencies['@types/ws']).toBeDefined();
  });

  it('should have typescript in devDependencies', () => {
    expect(pkg.devDependencies.typescript).toBeDefined();
  });

  it('should have vitest in devDependencies', () => {
    expect(pkg.devDependencies.vitest).toBeDefined();
  });
});

describe('Server dependencies - Installation verification', () => {
  const nodeModules = resolve(SERVER_DIR, 'node_modules');

  it('should have node_modules directory', () => {
    expect(existsSync(nodeModules)).toBe(true);
  });

  it('should have @anthropic-ai/sdk installed', () => {
    expect(existsSync(resolve(nodeModules, '@anthropic-ai/sdk'))).toBe(true);
  });

  it('should have ws installed', () => {
    expect(existsSync(resolve(nodeModules, 'ws'))).toBe(true);
  });

  it('should have hono installed', () => {
    expect(existsSync(resolve(nodeModules, 'hono'))).toBe(true);
  });

  it('should have zod installed', () => {
    expect(existsSync(resolve(nodeModules, 'zod'))).toBe(true);
  });

  it('should have dotenv installed', () => {
    expect(existsSync(resolve(nodeModules, 'dotenv'))).toBe(true);
  });

  it('should have @types/ws installed', () => {
    expect(existsSync(resolve(nodeModules, '@types/ws'))).toBe(true);
  });

  it('should have @aiinstaller/shared linked from workspace', () => {
    expect(existsSync(resolve(nodeModules, '@aiinstaller/shared'))).toBe(true);
  });
});

describe('Server dependencies - Version verification', () => {
  it('should have @anthropic-ai/sdk version matching ^0.x', () => {
    const depPkg = JSON.parse(
      readFileSync(resolve(SERVER_DIR, 'node_modules/@anthropic-ai/sdk/package.json'), 'utf-8'),
    );
    expect(depPkg.name).toBe('@anthropic-ai/sdk');
    expect(depPkg.version).toMatch(/^0\./);
  });

  it('should have ws version matching ^8.x', () => {
    const depPkg = JSON.parse(
      readFileSync(resolve(SERVER_DIR, 'node_modules/ws/package.json'), 'utf-8'),
    );
    expect(depPkg.name).toBe('ws');
    expect(depPkg.version).toMatch(/^8\./);
  });

  it('should have hono version matching ^4.x', () => {
    const depPkg = JSON.parse(
      readFileSync(resolve(SERVER_DIR, 'node_modules/hono/package.json'), 'utf-8'),
    );
    expect(depPkg.name).toBe('hono');
    expect(depPkg.version).toMatch(/^4\./);
  });

  it('should have zod version matching ^3.x', () => {
    const depPkg = JSON.parse(
      readFileSync(resolve(SERVER_DIR, 'node_modules/zod/package.json'), 'utf-8'),
    );
    expect(depPkg.name).toBe('zod');
    expect(depPkg.version).toMatch(/^3\./);
  });

  it('should have dotenv version matching ^16.x', () => {
    const depPkg = JSON.parse(
      readFileSync(resolve(SERVER_DIR, 'node_modules/dotenv/package.json'), 'utf-8'),
    );
    expect(depPkg.name).toBe('dotenv');
    expect(depPkg.version).toMatch(/^16\./);
  });
});

describe('Server dependencies - Module resolvability', () => {
  it('should resolve @anthropic-ai/sdk', () => {
    const resolved = serverRequire.resolve('@anthropic-ai/sdk');
    expect(resolved).toBeDefined();
    expect(typeof resolved).toBe('string');
  });

  it('should resolve ws', () => {
    const resolved = serverRequire.resolve('ws');
    expect(resolved).toBeDefined();
    expect(typeof resolved).toBe('string');
  });

  it('should resolve hono', () => {
    const resolved = serverRequire.resolve('hono');
    expect(resolved).toBeDefined();
    expect(typeof resolved).toBe('string');
  });

  it('should resolve zod', () => {
    const resolved = serverRequire.resolve('zod');
    expect(resolved).toBeDefined();
    expect(typeof resolved).toBe('string');
  });

  it('should resolve dotenv', () => {
    const resolved = serverRequire.resolve('dotenv');
    expect(resolved).toBeDefined();
    expect(typeof resolved).toBe('string');
  });
});

describe('Server dependencies - Module importability', () => {
  it('should import @anthropic-ai/sdk', async () => {
    const sdk = await import(serverRequire.resolve('@anthropic-ai/sdk'));
    expect(sdk).toBeDefined();
  });

  it('should have Anthropic class from @anthropic-ai/sdk', async () => {
    const sdk = await import(serverRequire.resolve('@anthropic-ai/sdk'));
    expect(sdk.default || sdk.Anthropic).toBeDefined();
  });

  it('should import ws', async () => {
    const ws = await import(serverRequire.resolve('ws'));
    expect(ws).toBeDefined();
  });

  it('should have WebSocketServer from ws', async () => {
    const ws = await import(serverRequire.resolve('ws'));
    expect(ws.WebSocketServer || ws.default?.Server).toBeDefined();
  });

  it('should import hono', async () => {
    const hono = await import(serverRequire.resolve('hono'));
    expect(hono).toBeDefined();
  });

  it('should have Hono class from hono', async () => {
    const hono = await import(serverRequire.resolve('hono'));
    expect(hono.Hono).toBeDefined();
  });

  it('should import zod', async () => {
    const zod = await import(serverRequire.resolve('zod'));
    expect(zod).toBeDefined();
  });

  it('should have z object from zod', async () => {
    const { z } = await import(serverRequire.resolve('zod'));
    expect(z).toBeDefined();
    expect(typeof z.string).toBe('function');
    expect(typeof z.object).toBe('function');
  });

  it('should import dotenv', async () => {
    const dotenv = await import(serverRequire.resolve('dotenv'));
    expect(dotenv).toBeDefined();
  });

  it('should have config function from dotenv', async () => {
    const dotenv = await import(serverRequire.resolve('dotenv'));
    expect(typeof (dotenv.config || dotenv.default?.config)).toBe('function');
  });
});

describe('Server dependencies - Functional verification', () => {
  it('should create a Hono app instance', async () => {
    const { Hono } = await import(serverRequire.resolve('hono'));
    const app = new Hono();
    expect(app).toBeDefined();
    expect(typeof app.get).toBe('function');
    expect(typeof app.post).toBe('function');
  });

  it('should create a zod schema and validate', async () => {
    const { z } = await import(serverRequire.resolve('zod'));
    const schema = z.object({
      host: z.string(),
      port: z.number(),
    });
    const result = schema.parse({ host: 'localhost', port: 3000 });
    expect(result).toEqual({ host: 'localhost', port: 3000 });
  });

  it('should parse dotenv config format', async () => {
    const dotenv = await import(serverRequire.resolve('dotenv'));
    const parseFunc = dotenv.parse || dotenv.default?.parse;
    expect(typeof parseFunc).toBe('function');
    const result = parseFunc('FOO=bar\nBAZ=qux');
    expect(result).toEqual({ FOO: 'bar', BAZ: 'qux' });
  });

  it('should create WebSocketServer class (without starting)', async () => {
    const ws = await import(serverRequire.resolve('ws'));
    const WSS = ws.WebSocketServer || ws.default?.Server;
    expect(WSS).toBeDefined();
    expect(typeof WSS).toBe('function');
  });
});

describe('Server dependencies - Workspace integration', () => {
  it('should have @aiinstaller/shared linked in node_modules', () => {
    const sharedDir = resolve(SERVER_DIR, 'node_modules/@aiinstaller/shared');
    expect(existsSync(sharedDir)).toBe(true);
  });

  it('should have @aiinstaller/shared package.json with correct name', () => {
    const sharedPkg = JSON.parse(
      readFileSync(
        resolve(SERVER_DIR, 'node_modules/@aiinstaller/shared/package.json'),
        'utf-8',
      ),
    );
    expect(sharedPkg.name).toBe('@aiinstaller/shared');
  });

  it('should have @aiinstaller/shared source files available via workspace link', () => {
    const sharedSrc = resolve(SERVER_DIR, 'node_modules/@aiinstaller/shared/src/index.ts');
    expect(existsSync(sharedSrc)).toBe(true);
  });
});
