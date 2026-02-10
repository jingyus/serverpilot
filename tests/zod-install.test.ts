import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';

const ROOT = resolve(__dirname, '..');
const SHARED_DIR = resolve(ROOT, 'packages/shared');
const pkg = JSON.parse(readFileSync(resolve(SHARED_DIR, 'package.json'), 'utf-8'));

// Create a require function that resolves from packages/shared context
const sharedRequire = createRequire(resolve(SHARED_DIR, 'package.json'));
const zodPath = sharedRequire.resolve('zod');

describe('zod dependency - package.json declaration', () => {
  it('should have zod in dependencies', () => {
    expect(pkg.dependencies).toBeDefined();
    expect(pkg.dependencies.zod).toBeDefined();
  });

  it('should require zod ^3.x', () => {
    expect(pkg.dependencies.zod).toMatch(/^\^3\./);
  });

  it('should not have zod in devDependencies', () => {
    if (pkg.devDependencies) {
      expect(pkg.devDependencies.zod).toBeUndefined();
    }
  });
});

describe('zod dependency - Installation verification', () => {
  const zodDir = resolve(SHARED_DIR, 'node_modules/zod');

  it('should have zod installed in node_modules', () => {
    expect(existsSync(zodDir)).toBe(true);
  });

  it('should have zod package.json', () => {
    expect(existsSync(resolve(zodDir, 'package.json'))).toBe(true);
  });

  it('should have installed zod version matching ^3.x', () => {
    const zodPkg = JSON.parse(readFileSync(resolve(zodDir, 'package.json'), 'utf-8'));
    expect(zodPkg.version).toMatch(/^3\./);
  });

  it('should have zod name in its package.json', () => {
    const zodPkg = JSON.parse(readFileSync(resolve(zodDir, 'package.json'), 'utf-8'));
    expect(zodPkg.name).toBe('zod');
  });
});

describe('zod dependency - Module importability', () => {
  it('should be resolvable from packages/shared', () => {
    expect(zodPath).toBeDefined();
    expect(typeof zodPath).toBe('string');
  });

  it('should be importable', async () => {
    const zod = await import(zodPath);
    expect(zod).toBeDefined();
  });

  it('should export z object', async () => {
    const { z } = await import(zodPath);
    expect(z).toBeDefined();
  });

  it('should have z.string() schema creator', async () => {
    const { z } = await import(zodPath);
    expect(typeof z.string).toBe('function');
  });

  it('should have z.number() schema creator', async () => {
    const { z } = await import(zodPath);
    expect(typeof z.number).toBe('function');
  });

  it('should have z.object() schema creator', async () => {
    const { z } = await import(zodPath);
    expect(typeof z.object).toBe('function');
  });

  it('should have z.array() schema creator', async () => {
    const { z } = await import(zodPath);
    expect(typeof z.array).toBe('function');
  });

  it('should have z.enum() schema creator', async () => {
    const { z } = await import(zodPath);
    expect(typeof z.enum).toBe('function');
  });

  it('should have z.union() schema creator', async () => {
    const { z } = await import(zodPath);
    expect(typeof z.union).toBe('function');
  });
});

describe('zod dependency - Basic functionality', () => {
  it('should validate a string schema', async () => {
    const { z } = await import(zodPath);
    const schema = z.string();
    expect(schema.parse('hello')).toBe('hello');
  });

  it('should reject invalid string input', async () => {
    const { z } = await import(zodPath);
    const schema = z.string();
    expect(() => schema.parse(123)).toThrow();
  });

  it('should validate a number schema', async () => {
    const { z } = await import(zodPath);
    const schema = z.number();
    expect(schema.parse(42)).toBe(42);
  });

  it('should validate an object schema', async () => {
    const { z } = await import(zodPath);
    const schema = z.object({
      name: z.string(),
      age: z.number(),
    });
    const result = schema.parse({ name: 'test', age: 25 });
    expect(result).toEqual({ name: 'test', age: 25 });
  });

  it('should reject invalid object input', async () => {
    const { z } = await import(zodPath);
    const schema = z.object({
      name: z.string(),
      age: z.number(),
    });
    expect(() => schema.parse({ name: 123, age: 'invalid' })).toThrow();
  });

  it('should support optional fields', async () => {
    const { z } = await import(zodPath);
    const schema = z.object({
      name: z.string(),
      email: z.string().optional(),
    });
    const result = schema.parse({ name: 'test' });
    expect(result).toEqual({ name: 'test' });
  });

  it('should support enum schemas', async () => {
    const { z } = await import(zodPath);
    const schema = z.enum(['success', 'error', 'pending']);
    expect(schema.parse('success')).toBe('success');
    expect(() => schema.parse('invalid')).toThrow();
  });

  it('should support array schemas', async () => {
    const { z } = await import(zodPath);
    const schema = z.array(z.string());
    expect(schema.parse(['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
    expect(() => schema.parse([1, 2, 3])).toThrow();
  });

  it('should support safeParse for non-throwing validation', async () => {
    const { z } = await import(zodPath);
    const schema = z.string();
    const success = schema.safeParse('hello');
    expect(success.success).toBe(true);
    if (success.success) {
      expect(success.data).toBe('hello');
    }

    const failure = schema.safeParse(123);
    expect(failure.success).toBe(false);
  });

  it('should support type inference with z.infer', async () => {
    const { z } = await import(zodPath);
    const schema = z.object({
      id: z.string(),
      type: z.enum(['create', 'update', 'delete']),
      payload: z.record(z.unknown()),
    });
    type SchemaType = z.infer<typeof schema>;
    const data: SchemaType = {
      id: '123',
      type: 'create',
      payload: { key: 'value' },
    };
    expect(schema.parse(data)).toEqual(data);
  });
});

describe('zod dependency - Protocol-relevant features', () => {
  it('should support discriminated unions (for message types)', async () => {
    const { z } = await import(zodPath);
    const messageSchema = z.discriminatedUnion('type', [
      z.object({ type: z.literal('request'), url: z.string() }),
      z.object({ type: z.literal('response'), status: z.number() }),
    ]);
    expect(messageSchema.parse({ type: 'request', url: '/api' })).toEqual({
      type: 'request',
      url: '/api',
    });
    expect(messageSchema.parse({ type: 'response', status: 200 })).toEqual({
      type: 'response',
      status: 200,
    });
  });

  it('should support nested object schemas', async () => {
    const { z } = await import(zodPath);
    const envInfoSchema = z.object({
      os: z.object({
        platform: z.string(),
        version: z.string(),
        arch: z.string(),
      }),
      runtime: z.object({
        nodeVersion: z.string(),
        npmVersion: z.string().optional(),
      }),
    });
    const data = {
      os: { platform: 'darwin', version: '24.0.0', arch: 'arm64' },
      runtime: { nodeVersion: 'v22.0.0' },
    };
    expect(envInfoSchema.parse(data)).toEqual(data);
  });

  it('should support z.record for dynamic keys', async () => {
    const { z } = await import(zodPath);
    const schema = z.record(z.string(), z.boolean());
    expect(schema.parse({ npm: true, pnpm: true, yarn: false })).toEqual({
      npm: true,
      pnpm: true,
      yarn: false,
    });
  });
});
