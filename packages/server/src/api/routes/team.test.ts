// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for team invitation and member management routes.
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
import {
  InMemoryInvitationRepository,
  setInvitationRepository,
  _resetInvitationRepository,
} from '../../db/repositories/invitation-repository.js';
import type { ApiEnv } from './types.js';

// ============================================================================
// Module Mocks
// ============================================================================

let activeUserId = 'owner-1';
let activeTenantId: string | null = 'tenant-1';

vi.mock('../middleware/auth.js', () => ({
  requireAuth: vi.fn(async (c: Record<string, (k: string, v: string | null) => void>, next: () => Promise<void>) => {
    c.set('userId', activeUserId);
    await next();
  }),
  generateTokens: vi.fn(async () => ({
    accessToken: 'mock-access-token',
    refreshToken: 'mock-refresh-token',
  })),
}));

vi.mock('../middleware/tenant.js', () => ({
  requireTenant: vi.fn(async (c: Record<string, (k: string, v: string | null) => void>, next: () => Promise<void>) => {
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

vi.mock('../../utils/password.js', () => ({
  hashPassword: vi.fn(async (pw: string) => `hashed:${pw}`),
  verifyPassword: vi.fn(async () => true),
}));

// Import after mocks
import { teamRoute } from './team.js';

// ============================================================================
// Helpers
// ============================================================================

const mockRbacRepo = new InMemoryRbacRepository();
const mockUserRepo = new InMemoryUserRepository();
const mockInvRepo = new InMemoryInvitationRepository();

function createTestApp() {
  const app = new Hono<ApiEnv>();
  app.onError(onError);
  app.route('/team', teamRoute);
  return app;
}

function seedUser(id: string, email: string, name: string, role: 'owner' | 'admin' | 'member', tenantId: string | null = 'tenant-1') {
  const user = {
    id,
    email,
    passwordHash: 'hash',
    name,
    timezone: 'UTC',
    tenantId,
    role: role as 'owner' | 'admin' | 'member',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  (mockUserRepo as InMemoryUserRepository)['users'].set(id, user);
  return user;
}

// ============================================================================
// Setup
// ============================================================================

beforeEach(() => {
  _resetRbacRepository();
  _resetUserRepository();
  _resetInvitationRepository();
  mockRbacRepo.clear();
  mockUserRepo.clear();
  mockInvRepo.clear();
  setRbacRepository(mockRbacRepo);
  setUserRepository(mockUserRepo);
  setInvitationRepository(mockInvRepo);

  activeUserId = 'owner-1';
  activeTenantId = 'tenant-1';

  // Seed test users
  seedUser('owner-1', 'owner@test.com', 'Owner', 'owner');
  seedUser('admin-1', 'admin@test.com', 'Admin', 'admin');
  seedUser('member-1', 'member@test.com', 'Member', 'member');

  // Set up RBAC
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
// POST /team/invite — Create invitation
// ============================================================================

describe('POST /team/invite', () => {
  it('should create invitation as owner', async () => {
    activeUserId = 'owner-1';
    const app = createTestApp();
    const res = await app.request('/team/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'new@test.com', role: 'member' }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.invitation.email).toBe('new@test.com');
    expect(body.invitation.role).toBe('member');
    expect(body.invitation.status).toBe('pending');
    expect(body.invitation.token).toBeTruthy();
  });

  it('should create invitation as admin', async () => {
    activeUserId = 'admin-1';
    const app = createTestApp();
    const res = await app.request('/team/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'new@test.com', role: 'admin' }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.invitation.role).toBe('admin');
  });

  it('should deny invitation from member', async () => {
    activeUserId = 'member-1';
    const app = createTestApp();
    const res = await app.request('/team/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'new@test.com', role: 'member' }),
    });

    expect(res.status).toBe(403);
  });

  it('should reject inviting yourself', async () => {
    activeUserId = 'owner-1';
    const app = createTestApp();
    const res = await app.request('/team/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'owner@test.com', role: 'member' }),
    });

    expect(res.status).toBe(400);
  });

  it('should reject if user already in team', async () => {
    activeUserId = 'owner-1';
    const app = createTestApp();
    const res = await app.request('/team/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'member@test.com', role: 'member' }),
    });

    expect(res.status).toBe(400);
  });

  it('should reject duplicate pending invitation', async () => {
    activeUserId = 'owner-1';
    const app = createTestApp();

    // First invitation
    await app.request('/team/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'dup@test.com', role: 'member' }),
    });

    // Duplicate
    const res = await app.request('/team/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'dup@test.com', role: 'member' }),
    });

    expect(res.status).toBe(400);
  });

  it('should reject invalid email', async () => {
    activeUserId = 'owner-1';
    const app = createTestApp();
    const res = await app.request('/team/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'not-an-email', role: 'member' }),
    });

    expect(res.status).toBe(400);
  });

  it('should reject when no tenant', async () => {
    activeUserId = 'owner-1';
    activeTenantId = null;
    const app = createTestApp();
    const res = await app.request('/team/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'new@test.com', role: 'member' }),
    });

    expect(res.status).toBe(400);
  });
});

// ============================================================================
// GET /team/invitations — List invitations
// ============================================================================

describe('GET /team/invitations', () => {
  it('should list invitations for owner', async () => {
    activeUserId = 'owner-1';
    const app = createTestApp();

    // Create an invitation first
    await app.request('/team/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'new1@test.com', role: 'member' }),
    });

    const res = await app.request('/team/invitations');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.invitations).toHaveLength(1);
    expect(body.total).toBe(1);
  });

  it('should list invitations for member (read permission)', async () => {
    activeUserId = 'owner-1';
    const app = createTestApp();

    await app.request('/team/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'new2@test.com', role: 'member' }),
    });

    activeUserId = 'member-1';
    const res = await app.request('/team/invitations');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.invitations).toHaveLength(1);
  });

  it('should return empty when no tenant', async () => {
    activeTenantId = null;
    const app = createTestApp();
    const res = await app.request('/team/invitations');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.invitations).toHaveLength(0);
  });
});

// ============================================================================
// DELETE /team/invitations/:id — Cancel invitation
// ============================================================================

describe('DELETE /team/invitations/:id', () => {
  it('should cancel pending invitation', async () => {
    activeUserId = 'owner-1';
    const app = createTestApp();

    const createRes = await app.request('/team/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'cancel@test.com', role: 'member' }),
    });
    const created = await createRes.json();

    const res = await app.request(`/team/invitations/${created.invitation.id}`, {
      method: 'DELETE',
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it('should deny cancellation from member', async () => {
    activeUserId = 'owner-1';
    const app = createTestApp();

    const createRes = await app.request('/team/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'cancel2@test.com', role: 'member' }),
    });
    const created = await createRes.json();

    activeUserId = 'member-1';
    const res = await app.request(`/team/invitations/${created.invitation.id}`, {
      method: 'DELETE',
    });

    expect(res.status).toBe(403);
  });

  it('should return 404 for non-existent invitation', async () => {
    activeUserId = 'owner-1';
    const app = createTestApp();
    const res = await app.request('/team/invitations/non-existent', {
      method: 'DELETE',
    });

    expect(res.status).toBe(404);
  });
});

// ============================================================================
// GET /team/invite/:token — Get invitation details (public)
// ============================================================================

describe('GET /team/invite/:token', () => {
  it('should return invitation details for valid token', async () => {
    activeUserId = 'owner-1';
    const app = createTestApp();

    const createRes = await app.request('/team/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'view@test.com', role: 'member' }),
    });
    const created = await createRes.json();

    const res = await app.request(`/team/invite/${created.invitation.token}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.invitation.email).toBe('view@test.com');
    expect(body.invitation.role).toBe('member');
    // Token should not be in the response
    expect(body.invitation.token).toBeUndefined();
  });

  it('should return 404 for invalid token', async () => {
    const app = createTestApp();
    const res = await app.request('/team/invite/bad-token');
    expect(res.status).toBe(404);
  });
});

// ============================================================================
// POST /team/invite/:token/accept — Accept invitation
// ============================================================================

describe('POST /team/invite/:token/accept', () => {
  it('should accept invitation for new user', async () => {
    activeUserId = 'owner-1';
    const app = createTestApp();

    const createRes = await app.request('/team/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'accept@test.com', role: 'member' }),
    });
    const created = await createRes.json();

    const res = await app.request(`/team/invite/${created.invitation.token}/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'New User', password: 'password123' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.email).toBe('accept@test.com');
    expect(body.accessToken).toBe('mock-access-token');
    expect(body.refreshToken).toBe('mock-refresh-token');
  });

  it('should reject already accepted invitation', async () => {
    activeUserId = 'owner-1';
    const app = createTestApp();

    const createRes = await app.request('/team/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'accepted@test.com', role: 'member' }),
    });
    const created = await createRes.json();

    // Accept first time
    await app.request(`/team/invite/${created.invitation.token}/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'User', password: 'password123' }),
    });

    // Try to accept again
    const res = await app.request(`/team/invite/${created.invitation.token}/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'User', password: 'password123' }),
    });

    expect(res.status).toBe(400);
  });

  it('should reject with invalid token', async () => {
    const app = createTestApp();
    const res = await app.request('/team/invite/bad-token/accept', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'User', password: 'password123' }),
    });

    expect(res.status).toBe(404);
  });

  it('should reject with short password', async () => {
    activeUserId = 'owner-1';
    const app = createTestApp();

    const createRes = await app.request('/team/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'short@test.com', role: 'member' }),
    });
    const created = await createRes.json();

    const res = await app.request(`/team/invite/${created.invitation.token}/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'User', password: 'short' }),
    });

    expect(res.status).toBe(400);
  });
});

// ============================================================================
// GET /team/members — List members
// ============================================================================

describe('GET /team/members', () => {
  it('should list members', async () => {
    activeUserId = 'owner-1';
    const app = createTestApp();
    const res = await app.request('/team/members');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.members).toHaveLength(3);
    expect(body.total).toBe(3);
  });

  it('should allow member to list (read permission)', async () => {
    activeUserId = 'member-1';
    const app = createTestApp();
    const res = await app.request('/team/members');

    expect(res.status).toBe(200);
  });
});

// ============================================================================
// PUT /team/members/:id/role — Update member role
// ============================================================================

describe('PUT /team/members/:id/role', () => {
  it('should allow owner to change role', async () => {
    activeUserId = 'owner-1';
    const app = createTestApp();
    const res = await app.request('/team/members/member-1/role', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'admin' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.role).toBe('admin');
  });

  it('should deny admin from updating roles', async () => {
    activeUserId = 'admin-1';
    const app = createTestApp();
    const res = await app.request('/team/members/member-1/role', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'admin' }),
    });

    expect(res.status).toBe(403);
  });

  it('should prevent changing own role', async () => {
    activeUserId = 'owner-1';
    const app = createTestApp();
    const res = await app.request('/team/members/owner-1/role', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'admin' }),
    });

    expect(res.status).toBe(400);
  });

  it('should reject invalid role', async () => {
    activeUserId = 'owner-1';
    const app = createTestApp();
    const res = await app.request('/team/members/member-1/role', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'superadmin' }),
    });

    expect(res.status).toBe(400);
  });
});

// ============================================================================
// DELETE /team/members/:id — Remove member
// ============================================================================

describe('DELETE /team/members/:id', () => {
  it('should allow admin to remove member', async () => {
    activeUserId = 'admin-1';
    const app = createTestApp();
    const res = await app.request('/team/members/member-1', {
      method: 'DELETE',
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it('should deny member from removing', async () => {
    activeUserId = 'member-1';
    const app = createTestApp();
    const res = await app.request('/team/members/admin-1', {
      method: 'DELETE',
    });

    expect(res.status).toBe(403);
  });

  it('should prevent self-removal', async () => {
    activeUserId = 'admin-1';
    const app = createTestApp();
    const res = await app.request('/team/members/admin-1', {
      method: 'DELETE',
    });

    expect(res.status).toBe(400);
  });

  it('should prevent removing owner', async () => {
    activeUserId = 'admin-1';
    const app = createTestApp();
    const res = await app.request('/team/members/owner-1', {
      method: 'DELETE',
    });

    expect(res.status).toBe(403);
  });
});
