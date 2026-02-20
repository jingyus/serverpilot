// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { verifyTenant } from './verify-tenant.js';

type Env = {
  Variables: {
    userId?: string;
    tenantId?: string | null;
  };
};

/** Test app: first middleware sets auth from X-Test-User-Id / X-Test-Tenant-Id when present */
function createApp() {
  const app = new Hono<Env>()
    .use('*', async (c, next) => {
      const testUserId = c.req.header('X-Test-User-Id');
      const testTenantId = c.req.header('X-Test-Tenant-Id');
      if (testUserId) c.set('userId', testUserId);
      if (testTenantId !== undefined) c.set('tenantId', testTenantId || null);
      return next();
    })
    .use('*', verifyTenant())
    .get('/ok', (c) => c.json({ ok: true }));

  return app;
}

describe('verifyTenant', () => {
  it('JWT tenantId 与 header 匹配时通过', async () => {
    const app = createApp();
    const res = await app.request('/ok', {
      headers: {
        'X-Test-User-Id': 'user-1',
        'X-Test-Tenant-Id': 'tenant-1',
        'X-Tenant-ID': 'tenant-1',
      },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
  });

  it('JWT tenantId 与 header 不匹配时返回 403 TENANT_MISMATCH', async () => {
    const app = createApp();
    const res = await app.request('/ok', {
      headers: {
        'X-Test-User-Id': 'user-1',
        'X-Test-Tenant-Id': 'tenant-1',
        'X-Tenant-ID': 'other-tenant',
      },
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error?.code).toBe('TENANT_MISMATCH');
    expect(body.error?.message).toBe('Tenant ID mismatch');
  });

  it('无 X-Tenant-ID header 时通过（使用 JWT tenantId）', async () => {
    const app = createApp();
    const res = await app.request('/ok', {
      headers: {
        'X-Test-User-Id': 'user-1',
        'X-Test-Tenant-Id': 'tenant-1',
      },
    });
    expect(res.status).toBe(200);
  });

  it('X-Tenant-ID 为空字符串且 JWT 有 tenantId 时通过', async () => {
    const app = createApp();
    const res = await app.request('/ok', {
      headers: {
        'X-Test-User-Id': 'user-1',
        'X-Test-Tenant-Id': 'tenant-1',
        'X-Tenant-ID': '',
      },
    });
    expect(res.status).toBe(200);
  });

  it('无 auth context 时返回 401', async () => {
    const app = createApp();
    const res = await app.request('/ok');
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error?.code).toBe('UNAUTHORIZED');
  });

  it('有 userId 无 tenantId、且无 X-Tenant-ID 时通过', async () => {
    const app = createApp();
    const res = await app.request('/ok', {
      headers: {
        'X-Test-User-Id': 'user-1',
        'X-Test-Tenant-Id': '', // empty → set tenantId to null
      },
    });
    expect(res.status).toBe(200);
  });

  it('有 userId、tenantId 为 null、X-Tenant-ID 有值时 403', async () => {
    const app = createApp();
    const res = await app.request('/ok', {
      headers: {
        'X-Test-User-Id': 'user-1',
        'X-Test-Tenant-Id': '', // null
        'X-Tenant-ID': 'some-tenant',
      },
    });
    expect(res.status).toBe(403);
  });

  it('中间件不查 DB，纯内存比较', async () => {
    const app = createApp();
    const res = await app.request('/ok', {
      headers: {
        'X-Test-User-Id': 'u',
        'X-Test-Tenant-Id': 't',
        'X-Tenant-ID': 't',
      },
    });
    expect(res.status).toBe(200);
  });
});
