// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { initDatabase, closeDatabase, createTables } from '../../db/connection.js';
import { DrizzleUserRepository, _resetUserRepository } from '../../db/repositories/user-repository.js';
import { DrizzleTenantRepository, _resetTenantRepository } from '../../db/repositories/tenant-repository.js';
import { requireTenant } from './tenant.js';
import type { ApiEnv } from '../routes/types.js';
import type { DrizzleDB } from '../../db/connection.js';

describe('requireTenant middleware', () => {
  let db: DrizzleDB;
  let userRepo: DrizzleUserRepository;
  let tenantRepo: DrizzleTenantRepository;

  beforeEach(() => {
    db = initDatabase(':memory:');
    createTables(db);
    userRepo = new DrizzleUserRepository(db);
    tenantRepo = new DrizzleTenantRepository(db);
  });

  afterEach(() => {
    _resetUserRepository();
    _resetTenantRepository();
    closeDatabase();
  });

  function createTestApp() {
    const app = new Hono<ApiEnv>();
    // Simulate requireAuth by setting userId
    app.use('/test/*', async (c, next) => {
      const userId = c.req.header('X-User-Id');
      if (userId) {
        c.set('userId', userId);
      }
      await next();
    });
    app.use('/test/*', requireTenant);
    app.get('/test/tenant', (c) => {
      const tenantId = c.get('tenantId');
      return c.json({ tenantId });
    });
    return app;
  }

  it('should set tenantId when user belongs to a tenant', async () => {
    const user = await userRepo.create({
      email: 'tenant-user@test.com',
      passwordHash: 'hash',
      name: 'Test',
    });

    // Migrate user to tenant (creates a default tenant and assigns it)
    const tenant = await tenantRepo.migrateUserToTenant(user.id);

    const app = createTestApp();
    const res = await app.request('/test/tenant', {
      headers: { 'X-User-Id': user.id },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tenantId).toBe(tenant.id);
  });

  it('should set tenantId to null for users without tenant (community edition)', async () => {
    const user = await userRepo.create({
      email: 'no-tenant@test.com',
      passwordHash: 'hash',
      name: 'Community User',
    });

    const app = createTestApp();
    const res = await app.request('/test/tenant', {
      headers: { 'X-User-Id': user.id },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tenantId).toBeNull();
  });

  it('should set tenantId to null for non-existent user', async () => {
    const app = createTestApp();
    const res = await app.request('/test/tenant', {
      headers: { 'X-User-Id': 'non-existent-user' },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tenantId).toBeNull();
  });
});
