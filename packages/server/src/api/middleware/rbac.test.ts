// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for RBAC middleware: resolveRole, requireRole, requirePermission.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { resolveRole, requireRole, requirePermission } from './rbac.js';
import { onError } from './error-handler.js';
import {
  InMemoryRbacRepository,
  setRbacRepository,
  _resetRbacRepository,
} from '../../db/repositories/rbac-repository.js';
import type { ApiEnv } from '../routes/types.js';

// ============================================================================
// Helpers
// ============================================================================

const mockRbacRepo = new InMemoryRbacRepository();

function createTestApp() {
  const app = new Hono<ApiEnv>();
  app.onError(onError);
  return app;
}

function setUserContext(app: Hono<ApiEnv>) {
  app.use('*', async (c, next) => {
    c.set('userId', 'test-user-1');
    await next();
  });
}

// ============================================================================
// Setup
// ============================================================================

beforeEach(() => {
  _resetRbacRepository();
  mockRbacRepo.clear();
  setRbacRepository(mockRbacRepo);
});

// ============================================================================
// resolveRole
// ============================================================================

describe('resolveRole', () => {
  it('should set userRole from repository', async () => {
    mockRbacRepo.setRole('test-user-1', 'admin');
    const app = createTestApp();
    setUserContext(app);
    app.get('/test', resolveRole, (c) => {
      return c.json({ role: c.get('userRole') });
    });

    const res = await app.request('/test');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.role).toBe('admin');
  });

  it('should default to member if no role set', async () => {
    const app = createTestApp();
    setUserContext(app);
    app.get('/test', resolveRole, (c) => {
      return c.json({ role: c.get('userRole') });
    });

    const res = await app.request('/test');
    const body = await res.json();
    expect(body.role).toBe('member');
  });

  it('should resolve owner role', async () => {
    mockRbacRepo.setRole('test-user-1', 'owner');
    const app = createTestApp();
    setUserContext(app);
    app.get('/test', resolveRole, (c) => {
      return c.json({ role: c.get('userRole') });
    });

    const res = await app.request('/test');
    const body = await res.json();
    expect(body.role).toBe('owner');
  });
});

// ============================================================================
// requireRole
// ============================================================================

describe('requireRole', () => {
  it('should allow owner when minRole is member', async () => {
    mockRbacRepo.setRole('test-user-1', 'owner');
    const app = createTestApp();
    setUserContext(app);
    app.get('/test', resolveRole, requireRole('member'), (c) => {
      return c.json({ ok: true });
    });

    const res = await app.request('/test');
    expect(res.status).toBe(200);
  });

  it('should allow admin when minRole is admin', async () => {
    mockRbacRepo.setRole('test-user-1', 'admin');
    const app = createTestApp();
    setUserContext(app);
    app.get('/test', resolveRole, requireRole('admin'), (c) => {
      return c.json({ ok: true });
    });

    const res = await app.request('/test');
    expect(res.status).toBe(200);
  });

  it('should deny member when minRole is admin', async () => {
    mockRbacRepo.setRole('test-user-1', 'member');
    const app = createTestApp();
    setUserContext(app);
    app.get('/test', resolveRole, requireRole('admin'), (c) => {
      return c.json({ ok: true });
    });

    const res = await app.request('/test');
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.message).toContain('admin');
  });

  it('should deny admin when minRole is owner', async () => {
    mockRbacRepo.setRole('test-user-1', 'admin');
    const app = createTestApp();
    setUserContext(app);
    app.get('/test', resolveRole, requireRole('owner'), (c) => {
      return c.json({ ok: true });
    });

    const res = await app.request('/test');
    expect(res.status).toBe(403);
  });

  it('should deny if role not resolved', async () => {
    const app = createTestApp();
    setUserContext(app);
    // Intentionally skip resolveRole
    app.get('/test', requireRole('member'), (c) => {
      return c.json({ ok: true });
    });

    const res = await app.request('/test');
    expect(res.status).toBe(403);
  });
});

// ============================================================================
// requirePermission
// ============================================================================

describe('requirePermission', () => {
  it('should allow admin to create servers', async () => {
    mockRbacRepo.setRole('test-user-1', 'admin');
    const app = createTestApp();
    setUserContext(app);
    app.post('/servers', resolveRole, requirePermission('server:create'), (c) => {
      return c.json({ ok: true });
    });

    const res = await app.request('/servers', { method: 'POST' });
    expect(res.status).toBe(200);
  });

  it('should deny member from creating servers', async () => {
    mockRbacRepo.setRole('test-user-1', 'member');
    const app = createTestApp();
    setUserContext(app);
    app.post('/servers', resolveRole, requirePermission('server:create'), (c) => {
      return c.json({ ok: true });
    });

    const res = await app.request('/servers', { method: 'POST' });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.message).toContain('server:create');
  });

  it('should allow member to read servers', async () => {
    mockRbacRepo.setRole('test-user-1', 'member');
    const app = createTestApp();
    setUserContext(app);
    app.get('/servers', resolveRole, requirePermission('server:read'), (c) => {
      return c.json({ ok: true });
    });

    const res = await app.request('/servers');
    expect(res.status).toBe(200);
  });

  it('should allow owner to update roles', async () => {
    mockRbacRepo.setRole('test-user-1', 'owner');
    const app = createTestApp();
    setUserContext(app);
    app.patch('/members/:id/role', resolveRole, requirePermission('member:update-role'), (c) => {
      return c.json({ ok: true });
    });

    const res = await app.request('/members/u1/role', { method: 'PATCH' });
    expect(res.status).toBe(200);
  });

  it('should deny admin from updating roles', async () => {
    mockRbacRepo.setRole('test-user-1', 'admin');
    const app = createTestApp();
    setUserContext(app);
    app.patch('/members/:id/role', resolveRole, requirePermission('member:update-role'), (c) => {
      return c.json({ ok: true });
    });

    const res = await app.request('/members/u1/role', { method: 'PATCH' });
    expect(res.status).toBe(403);
  });

  it('should deny if role not resolved', async () => {
    const app = createTestApp();
    setUserContext(app);
    app.get('/test', requirePermission('server:read'), (c) => {
      return c.json({ ok: true });
    });

    const res = await app.request('/test');
    expect(res.status).toBe(403);
  });

  it('should allow owner to delete webhooks', async () => {
    mockRbacRepo.setRole('test-user-1', 'owner');
    const app = createTestApp();
    setUserContext(app);
    app.delete('/webhooks/:id', resolveRole, requirePermission('webhook:delete'), (c) => {
      return c.json({ ok: true });
    });

    const res = await app.request('/webhooks/w1', { method: 'DELETE' });
    expect(res.status).toBe(200);
  });

  it('should deny member from deleting webhooks', async () => {
    mockRbacRepo.setRole('test-user-1', 'member');
    const app = createTestApp();
    setUserContext(app);
    app.delete('/webhooks/:id', resolveRole, requirePermission('webhook:delete'), (c) => {
      return c.json({ ok: true });
    });

    const res = await app.request('/webhooks/w1', { method: 'DELETE' });
    expect(res.status).toBe(403);
  });
});
