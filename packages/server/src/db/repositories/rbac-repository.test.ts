// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for RBAC repository (DrizzleRbacRepository + InMemoryRbacRepository).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  DrizzleRbacRepository,
  InMemoryRbacRepository,
} from './rbac-repository.js';
import { initDatabase, closeDatabase, createTables, getDatabase } from '../connection.js';
import { users, tenants } from '../schema.js';

// ============================================================================
// Drizzle Implementation Tests
// ============================================================================

describe('DrizzleRbacRepository', () => {
  let repo: DrizzleRbacRepository;
  const testTenantId = randomUUID();
  const testOwnerId = randomUUID();
  const testAdminId = randomUUID();
  const testMemberId = randomUUID();

  beforeEach(() => {
    initDatabase(':memory:');
    createTables();
    const db = getDatabase();
    repo = new DrizzleRbacRepository(db);

    // Seed test data
    const now = new Date();

    // Create tenant
    db.insert(tenants).values({
      id: testTenantId,
      name: 'Test Org',
      slug: 'test-org',
      ownerId: testOwnerId,
      plan: 'free',
      maxServers: 5,
      maxUsers: 10,
      createdAt: now,
      updatedAt: now,
    }).run();

    // Create owner user
    db.insert(users).values({
      id: testOwnerId,
      email: 'owner@test.com',
      passwordHash: 'hash',
      name: 'Owner',
      tenantId: testTenantId,
      role: 'owner',
      createdAt: now,
      updatedAt: now,
    }).run();

    // Create admin user
    db.insert(users).values({
      id: testAdminId,
      email: 'admin@test.com',
      passwordHash: 'hash',
      name: 'Admin',
      tenantId: testTenantId,
      role: 'admin',
      createdAt: now,
      updatedAt: now,
    }).run();

    // Create member user
    db.insert(users).values({
      id: testMemberId,
      email: 'member@test.com',
      passwordHash: 'hash',
      name: 'Member',
      tenantId: testTenantId,
      role: 'member',
      createdAt: now,
      updatedAt: now,
    }).run();
  });

  afterEach(() => {
    closeDatabase();
  });

  describe('getUserRole', () => {
    it('should return owner role for tenant owner', async () => {
      const role = await repo.getUserRole(testOwnerId);
      expect(role).toBe('owner');
    });

    it('should return admin role for admin user', async () => {
      const role = await repo.getUserRole(testAdminId);
      expect(role).toBe('admin');
    });

    it('should return member role for regular user', async () => {
      const role = await repo.getUserRole(testMemberId);
      expect(role).toBe('member');
    });

    it('should return member for non-existent user', async () => {
      const role = await repo.getUserRole('non-existent-id');
      expect(role).toBe('member');
    });
  });

  describe('updateUserRole', () => {
    it('should update member to admin', async () => {
      const success = await repo.updateUserRole({
        userId: testMemberId,
        tenantId: testTenantId,
        role: 'admin',
      });
      expect(success).toBe(true);

      const role = await repo.getUserRole(testMemberId);
      expect(role).toBe('admin');
    });

    it('should update admin to member', async () => {
      const success = await repo.updateUserRole({
        userId: testAdminId,
        tenantId: testTenantId,
        role: 'member',
      });
      expect(success).toBe(true);

      const role = await repo.getUserRole(testAdminId);
      expect(role).toBe('member');
    });

    it('should fail for user not in tenant', async () => {
      const success = await repo.updateUserRole({
        userId: testMemberId,
        tenantId: 'different-tenant',
        role: 'admin',
      });
      expect(success).toBe(false);
    });

    it('should fail for non-existent user', async () => {
      const success = await repo.updateUserRole({
        userId: 'non-existent',
        tenantId: testTenantId,
        role: 'admin',
      });
      expect(success).toBe(false);
    });
  });

  describe('listTenantMembers', () => {
    it('should list all members of a tenant', async () => {
      const members = await repo.listTenantMembers(testTenantId);
      expect(members).toHaveLength(3);
    });

    it('should include correct role for each member', async () => {
      const members = await repo.listTenantMembers(testTenantId);
      const owner = members.find((m) => m.id === testOwnerId);
      const admin = members.find((m) => m.id === testAdminId);
      const member = members.find((m) => m.id === testMemberId);

      expect(owner?.role).toBe('owner');
      expect(admin?.role).toBe('admin');
      expect(member?.role).toBe('member');
    });

    it('should include email and name', async () => {
      const members = await repo.listTenantMembers(testTenantId);
      const owner = members.find((m) => m.id === testOwnerId);

      expect(owner?.email).toBe('owner@test.com');
      expect(owner?.name).toBe('Owner');
    });

    it('should return empty array for non-existent tenant', async () => {
      const members = await repo.listTenantMembers('non-existent');
      expect(members).toHaveLength(0);
    });
  });

  describe('isTenantOwner', () => {
    it('should return true for actual owner', async () => {
      const isOwner = await repo.isTenantOwner(testOwnerId, testTenantId);
      expect(isOwner).toBe(true);
    });

    it('should return false for non-owner', async () => {
      const isOwner = await repo.isTenantOwner(testAdminId, testTenantId);
      expect(isOwner).toBe(false);
    });

    it('should return false for non-existent tenant', async () => {
      const isOwner = await repo.isTenantOwner(testOwnerId, 'non-existent');
      expect(isOwner).toBe(false);
    });
  });
});

// ============================================================================
// In-Memory Implementation Tests
// ============================================================================

describe('InMemoryRbacRepository', () => {
  let repo: InMemoryRbacRepository;

  beforeEach(() => {
    repo = new InMemoryRbacRepository();
  });

  describe('getUserRole', () => {
    it('should return member by default', async () => {
      const role = await repo.getUserRole('unknown');
      expect(role).toBe('member');
    });

    it('should return set role', async () => {
      repo.setRole('user-1', 'admin');
      const role = await repo.getUserRole('user-1');
      expect(role).toBe('admin');
    });
  });

  describe('updateUserRole', () => {
    it('should update role', async () => {
      repo.setRole('user-1', 'member');
      await repo.updateUserRole({
        userId: 'user-1',
        tenantId: 'tenant-1',
        role: 'admin',
      });
      const role = await repo.getUserRole('user-1');
      expect(role).toBe('admin');
    });
  });

  describe('listTenantMembers', () => {
    it('should return empty for unknown tenant', async () => {
      const members = await repo.listTenantMembers('unknown');
      expect(members).toHaveLength(0);
    });

    it('should return set members', async () => {
      repo.setTenantMembers('tenant-1', [
        { id: 'u1', email: 'a@b.com', name: 'A', role: 'owner', createdAt: new Date().toISOString() },
        { id: 'u2', email: 'b@b.com', name: 'B', role: 'member', createdAt: new Date().toISOString() },
      ]);
      const members = await repo.listTenantMembers('tenant-1');
      expect(members).toHaveLength(2);
    });
  });

  describe('isTenantOwner', () => {
    it('should return false by default', async () => {
      expect(await repo.isTenantOwner('u1', 't1')).toBe(false);
    });

    it('should return true after setting owner', async () => {
      repo.setTenantOwner('t1', 'u1');
      expect(await repo.isTenantOwner('u1', 't1')).toBe(true);
    });
  });

  describe('clear', () => {
    it('should clear all data', async () => {
      repo.setRole('u1', 'admin');
      repo.setTenantOwner('t1', 'u1');
      repo.clear();
      expect(await repo.getUserRole('u1')).toBe('member');
      expect(await repo.isTenantOwner('u1', 't1')).toBe(false);
    });
  });
});
