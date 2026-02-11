// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for validation middleware.
 */

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { z } from 'zod';
import { validateBody, validateQuery } from './validate.js';
import { onError } from './error-handler.js';
import type { ApiEnv } from '../routes/types.js';

function createTestApp() {
  const app = new Hono<ApiEnv>();
  app.onError(onError);
  return app;
}

describe('validateBody', () => {
  const schema = z.object({
    name: z.string().min(1),
    age: z.number().int().positive(),
  });

  it('should pass validated data to handler', async () => {
    const app = createTestApp();
    app.post('/test', validateBody(schema), async (c) => {
      const body = c.get('validatedBody') as z.infer<typeof schema>;
      return c.json({ received: body });
    });

    const res = await app.request('/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Alice', age: 30 }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.received).toEqual({ name: 'Alice', age: 30 });
  });

  it('should strip unknown fields', async () => {
    const app = createTestApp();
    app.post('/test', validateBody(schema), async (c) => {
      const body = c.get('validatedBody') as z.infer<typeof schema>;
      return c.json({ received: body });
    });

    const res = await app.request('/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Alice', age: 30, extra: 'field' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.received).toEqual({ name: 'Alice', age: 30 });
  });

  it('should return 400 for invalid body', async () => {
    const app = createTestApp();
    app.post('/test', validateBody(schema), async (c) => {
      return c.json({ ok: true });
    });

    const res = await app.request('/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '', age: -1 }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details.length).toBeGreaterThan(0);
  });

  it('should return 400 for invalid JSON string', async () => {
    const app = createTestApp();
    app.post('/test', validateBody(schema), async (c) => {
      return c.json({ ok: true });
    });

    const res = await app.request('/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{invalid json}',
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toContain('Invalid JSON');
  });
});

describe('validateQuery', () => {
  const schema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    search: z.string().optional(),
  });

  it('should pass validated query to handler', async () => {
    const app = createTestApp();
    app.get('/test', validateQuery(schema), async (c) => {
      const query = c.get('validatedQuery') as z.infer<typeof schema>;
      return c.json({ received: query });
    });

    const res = await app.request('/test?page=2&search=hello');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.received).toEqual({ page: 2, search: 'hello' });
  });

  it('should apply defaults for missing query params', async () => {
    const app = createTestApp();
    app.get('/test', validateQuery(schema), async (c) => {
      const query = c.get('validatedQuery') as z.infer<typeof schema>;
      return c.json({ received: query });
    });

    const res = await app.request('/test');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.received.page).toBe(1);
  });

  it('should return 400 for invalid query params', async () => {
    const strictSchema = z.object({
      status: z.enum(['active', 'inactive']),
    });

    const app = createTestApp();
    app.get('/test', validateQuery(strictSchema), async (c) => {
      return c.json({ ok: true });
    });

    const res = await app.request('/test?status=invalid');
    expect(res.status).toBe(400);
  });
});
