// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for member management routes.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import { onError } from '../middleware/error-handler.js';
import {
  InMemoryRbacRepository,
  setRbacRepository,
  _resetRbacRepository,
} from '../../db/repositories/rbac-repository.js';
import {
  InMemoryUserRepository,
  setUserRepository,
  _resetUserRepository,
} from '../../db/repositories/user-repository.js';
import type { ApiEnv } from './types.js';

// ============================================================================
// Module Mocks — must be before imports of module under test
// ============================================================================

/** Currently active userId, changed per test. */
let activeUserId = 'owner-1';
let activeTenantId: string | null = 'tenant-1';

vi.mock('../middleware/auth.js', () => ({
  requireAuth: vi.fn(async (c: Record<string, (k: string, v: string | null) => void>, next: () => Promise<void>) => {
    c.set('userId', activeUserId);
    c.set('tenantId', activeTenantId);
    await next();
  }),
}));

vi.mock('../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Import after mocks
import { membersRoute } from './members.js';

// ============================================================================
// Helpers
// ============================================================================

const mockRbacRepo = new InMemoryRbacRepository();
const mockUserRepo = new InMemoryUserRepository();

function createTestApp() {
  const app = new Hono<ApiEnv>();
  app.onError(onError);
  app.route('/members', membersRoute);
  return app;
}

// ============================================================================
// Setup
// ============================================================================

beforeEach(async () => {
  _resetRbacRepository();
  _resetUserRepository();
  mockRbacRepo.clear();
  mockUserRepo.clear();
  setRbacRepository(mockRbacRepo);
  setUserRepository(mockUserRepo);

  // Reset default active user
  activeUserId = 'owner-1';
  activeTenantId = 'tenant-1';

  // Seed test users with predictable IDs
  const owner = await mockUserRepo.create({
    email: 'owner@test.com',
    passwordHash: 'hash',
    name: 'Owner',
  });
  const ownerUser = await mockUserRepo.findByEmail('owner@test.com');
  if (ownerUser) {
    ownerUser.id = 'owner-1';
    ownerUser.tenantId = 'tenant-1';
    ownerUser.role = 'owner';
    (mockUserRepo as InMemoryUserRepository)['users'].delete(owner.id);
    (mockUserRepo as InMemoryUserRepository)['users'].set('owner-1', ownerUser);
  }

  const admin = await mockUserRepo.create({
    email: 'admin@test.com',
    passwordHash: 'hash',
    name: 'Admin',
  });
  const adminUser = await mockUserRepo.findByEmail('admin@test.com');
  if (adminUser) {
    adminUser.id = 'admin-1';
    adminUser.tenantId = 'tenant-1';
    adminUser.role = 'admin';
    (mockUserRepo as InMemoryUserRepository)['users'].delete(admin.id);
    (mockUserRepo as InMemoryUserRepository)['users'].set('admin-1', adminUser);
  }

  const member = await mockUserRepo.create({
    email: 'member@test.com',
    passwordHash: 'hash',
    name: 'Member',
  });
  const memberUser = await mockUserRepo.findByEmail('member@test.com');
  if (memberUser) {
    memberUser.id = 'member-1';
    memberUser.tenantId = 'tenant-1';
    memberUser.role = 'member';
    (mockUserRepo as InMemoryUserRepository)['users'].delete(member.id);
    (mockUserRepo as InMemoryUserRepository)['users'].set('member-1', memberUser);
  }

  // Set up RBAC data
  mockRbacRepo.setRole('owner-1', 'owner');
  mockRbacRepo.setRole('admin-1', 'admin');
  mockRbacRepo.setRole('member-1', 'member');
  mockRbacRepo.setTenantOwner('tenant-1', 'owner-1');
  mockRbacRepo.setTenantMembers('tenant-1', [
    { id: 'owner-1', email: 'owner@test.com', name: 'Owner', role: 'owner', createdAt: new Date().toISOString() },
    { id: 'admin-1', email: 'admin@test.com', name: 'Admin', role: 'admin', createdAt: new Date().toISOString() },
    { id: 'member-1', email: 'member@test.com', name: 'Member', role: 'member', createdAt: new Date().toISOString() },
  ]);
});

// ============================================================================
// GET /members
// ============================================================================

describe('GET /members', () => {
  it('should list tenant members for owner', async () => {
    activeUserId = 'owner-1';
    const app = createTestApp();
    const res = await app.request('/members');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.members).toHaveLength(3);
    expect(body.total).toBe(3);
  });

  it('should list tenant members for member (read-only)', async () => {
    activeUserId = 'member-1';
    const app = createTestApp();
    const res = await app.request('/members');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.members).toHaveLength(3);
  });

  it('should return empty list when no tenant', async () => {
    activeUserId = 'owner-1';
    activeTenantId = null;
    const app = createTestApp();
    const res = await app.request('/members');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.members).toHaveLength(0);
  });
});

// ============================================================================
// PATCH /members/:userId/role
// ============================================================================

describe('PATCH /members/:userId/role', () => {
  it('should allow owner to change member to admin', async () => {
    activeUserId = 'owner-1';
    const app = createTestApp();
    const res = await app.request('/members/member-1/role', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'admin' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.role).toBe('admin');
  });

  it('should deny admin from changing roles', async () => {
    activeUserId = 'admin-1';
    const app = createTestApp();
    const res = await app.request('/members/member-1/role', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'admin' }),
    });

    expect(res.status).toBe(403);
  });

  it('should deny member from changing roles', async () => {
    activeUserId = 'member-1';
    const app = createTestApp();
    const res = await app.request('/members/admin-1/role', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'member' }),
    });

    expect(res.status).toBe(403);
  });

  it('should prevent changing own role', async () => {
    activeUserId = 'owner-1';
    const app = createTestApp();
    const res = await app.request('/members/owner-1/role', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'admin' }),
    });

    expect(res.status).toBe(400);
  });

  it('should prevent changing owner role', async () => {
    activeUserId = 'owner-1';
    const app = createTestApp();

    // Create another user with owner role
    const otherOwner = await mockUserRepo.create({
      email: 'other-owner@test.com',
      passwordHash: 'hash',
      name: 'Other',
    });
    const user = await mockUserRepo.findByEmail('other-owner@test.com');
    if (user) {
      user.id = 'other-owner';
      user.tenantId = 'tenant-1';
      user.role = 'owner';
      (mockUserRepo as InMemoryUserRepository)['users'].delete(otherOwner.id);
      (mockUserRepo as InMemoryUserRepository)['users'].set('other-owner', user);
    }

    const res = await app.request('/members/other-owner/role', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'admin' }),
    });

    expect(res.status).toBe(403);
  });

  it('should reject invalid role', async () => {
    activeUserId = 'owner-1';
    const app = createTestApp();
    const res = await app.request('/members/member-1/role', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'superadmin' }),
    });

    expect(res.status).toBe(400);
  });

  it('should return 404 for non-existent user', async () => {
    activeUserId = 'owner-1';
    const app = createTestApp();
    const res = await app.request('/members/non-existent/role', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'admin' }),
    });

    expect(res.status).toBe(404);
  });
});

// ============================================================================
// DELETE /members/:userId
// ============================================================================

describe('DELETE /members/:userId', () => {
  it('should allow admin to remove member', async () => {
    activeUserId = 'admin-1';
    const app = createTestApp();
    const res = await app.request('/members/member-1', {
      method: 'DELETE',
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it('should deny member from removing others', async () => {
    activeUserId = 'member-1';
    const app = createTestApp();
    const res = await app.request('/members/admin-1', {
      method: 'DELETE',
    });

    expect(res.status).toBe(403);
  });

  it('should prevent self-removal', async () => {
    activeUserId = 'admin-1';
    const app = createTestApp();
    const res = await app.request('/members/admin-1', {
      method: 'DELETE',
    });

    expect(res.status).toBe(400);
  });

  it('should prevent removing owner', async () => {
    activeUserId = 'admin-1';
    const app = createTestApp();
    const res = await app.request('/members/owner-1', {
      method: 'DELETE',
    });

    expect(res.status).toBe(403);
  });

  it('should deny admin from removing another admin', async () => {
    const admin2 = await mockUserRepo.create({
      email: 'admin2@test.com',
      passwordHash: 'hash',
      name: 'Admin 2',
    });
    const user = await mockUserRepo.findByEmail('admin2@test.com');
    if (user) {
      user.id = 'admin-2';
      user.tenantId = 'tenant-1';
      user.role = 'admin';
      (mockUserRepo as InMemoryUserRepository)['users'].delete(admin2.id);
      (mockUserRepo as InMemoryUserRepository)['users'].set('admin-2', user);
    }
    mockRbacRepo.setRole('admin-2', 'admin');

    activeUserId = 'admin-1';
    const app = createTestApp();
    const res = await app.request('/members/admin-2', {
      method: 'DELETE',
    });

    expect(res.status).toBe(403);
  });

  it('should allow owner to remove admin', async () => {
    activeUserId = 'owner-1';
    const app = createTestApp();
    const res = await app.request('/members/admin-1', {
      method: 'DELETE',
    });

    expect(res.status).toBe(200);
  });
});
