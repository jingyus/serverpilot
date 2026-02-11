// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for invitation repository (Drizzle + InMemory implementations).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  DrizzleInvitationRepository,
  InMemoryInvitationRepository,
} from './invitation-repository.js';
import { initDatabase, closeDatabase, createTables, getDatabase } from '../connection.js';
import { users, tenants } from '../schema.js';

// ============================================================================
// Drizzle Implementation Tests
// ============================================================================

describe('DrizzleInvitationRepository', () => {
  let repo: DrizzleInvitationRepository;
  const testTenantId = randomUUID();
  const testOwnerId = randomUUID();

  beforeEach(() => {
    initDatabase(':memory:');
    createTables();
    const db = getDatabase();
    repo = new DrizzleInvitationRepository(db);

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
  });

  afterEach(() => {
    closeDatabase();
  });

  describe('create', () => {
    it('should create an invitation with default 7-day expiry', async () => {
      const inv = await repo.create({
        tenantId: testTenantId,
        email: 'new@test.com',
        role: 'member',
        invitedBy: testOwnerId,
      });

      expect(inv.id).toBeTruthy();
      expect(inv.email).toBe('new@test.com');
      expect(inv.role).toBe('member');
      expect(inv.status).toBe('pending');
      expect(inv.token).toBeTruthy();
      expect(inv.token.length).toBe(64); // 32 bytes hex

      const expiresAt = new Date(inv.expiresAt);
      const now = Date.now();
      const diffDays = (expiresAt.getTime() - now) / (1000 * 60 * 60 * 24);
      expect(diffDays).toBeGreaterThan(6.9);
      expect(diffDays).toBeLessThan(7.1);
    });

    it('should create invitation with custom expiry', async () => {
      const inv = await repo.create({
        tenantId: testTenantId,
        email: 'new@test.com',
        role: 'admin',
        invitedBy: testOwnerId,
        expiresInDays: 3,
      });

      const expiresAt = new Date(inv.expiresAt);
      const now = Date.now();
      const diffDays = (expiresAt.getTime() - now) / (1000 * 60 * 60 * 24);
      expect(diffDays).toBeGreaterThan(2.9);
      expect(diffDays).toBeLessThan(3.1);
    });
  });

  describe('findById', () => {
    it('should find existing invitation', async () => {
      const created = await repo.create({
        tenantId: testTenantId,
        email: 'find@test.com',
        role: 'member',
        invitedBy: testOwnerId,
      });

      const found = await repo.findById(created.id);
      expect(found).not.toBeNull();
      expect(found!.email).toBe('find@test.com');
    });

    it('should return null for non-existent id', async () => {
      const found = await repo.findById('non-existent');
      expect(found).toBeNull();
    });
  });

  describe('findByToken', () => {
    it('should find invitation by token', async () => {
      const created = await repo.create({
        tenantId: testTenantId,
        email: 'token@test.com',
        role: 'member',
        invitedBy: testOwnerId,
      });

      const found = await repo.findByToken(created.token);
      expect(found).not.toBeNull();
      expect(found!.email).toBe('token@test.com');
    });

    it('should return null for non-existent token', async () => {
      const found = await repo.findByToken('bad-token');
      expect(found).toBeNull();
    });
  });

  describe('findByTenant', () => {
    it('should return all invitations for tenant', async () => {
      await repo.create({ tenantId: testTenantId, email: 'a@test.com', role: 'member', invitedBy: testOwnerId });
      await repo.create({ tenantId: testTenantId, email: 'b@test.com', role: 'admin', invitedBy: testOwnerId });

      const all = await repo.findByTenant(testTenantId);
      expect(all).toHaveLength(2);
    });

    it('should return empty for non-existent tenant', async () => {
      const all = await repo.findByTenant('non-existent');
      expect(all).toHaveLength(0);
    });
  });

  describe('findPendingByEmail', () => {
    it('should find pending invitation by email and tenant', async () => {
      await repo.create({ tenantId: testTenantId, email: 'pending@test.com', role: 'member', invitedBy: testOwnerId });

      const found = await repo.findPendingByEmail('pending@test.com', testTenantId);
      expect(found).not.toBeNull();
      expect(found!.status).toBe('pending');
    });

    it('should not find cancelled invitation', async () => {
      const inv = await repo.create({ tenantId: testTenantId, email: 'cancel@test.com', role: 'member', invitedBy: testOwnerId });
      await repo.updateStatus(inv.id, 'cancelled');

      const found = await repo.findPendingByEmail('cancel@test.com', testTenantId);
      expect(found).toBeNull();
    });
  });

  describe('updateStatus', () => {
    it('should update status', async () => {
      const inv = await repo.create({ tenantId: testTenantId, email: 'status@test.com', role: 'member', invitedBy: testOwnerId });

      const success = await repo.updateStatus(inv.id, 'cancelled');
      expect(success).toBe(true);

      const found = await repo.findById(inv.id);
      expect(found!.status).toBe('cancelled');
    });

    it('should return false for non-existent id', async () => {
      const success = await repo.updateStatus('non-existent', 'cancelled');
      expect(success).toBe(false);
    });
  });

  describe('markAccepted', () => {
    it('should mark invitation as accepted with timestamp', async () => {
      const inv = await repo.create({ tenantId: testTenantId, email: 'accept@test.com', role: 'member', invitedBy: testOwnerId });

      const success = await repo.markAccepted(inv.id);
      expect(success).toBe(true);

      const found = await repo.findById(inv.id);
      expect(found!.status).toBe('accepted');
      expect(found!.acceptedAt).not.toBeNull();
    });

    it('should return false for non-existent id', async () => {
      const success = await repo.markAccepted('non-existent');
      expect(success).toBe(false);
    });
  });

  describe('delete', () => {
    it('should delete invitation', async () => {
      const inv = await repo.create({ tenantId: testTenantId, email: 'del@test.com', role: 'member', invitedBy: testOwnerId });

      const success = await repo.delete(inv.id);
      expect(success).toBe(true);

      const found = await repo.findById(inv.id);
      expect(found).toBeNull();
    });

    it('should return false for non-existent id', async () => {
      const success = await repo.delete('non-existent');
      expect(success).toBe(false);
    });
  });
});

// ============================================================================
// In-Memory Implementation Tests
// ============================================================================

describe('InMemoryInvitationRepository', () => {
  let repo: InMemoryInvitationRepository;

  beforeEach(() => {
    repo = new InMemoryInvitationRepository();
  });

  it('should create and find invitation', async () => {
    const inv = await repo.create({
      tenantId: 'tenant-1',
      email: 'test@test.com',
      role: 'member',
      invitedBy: 'user-1',
    });

    const found = await repo.findById(inv.id);
    expect(found).not.toBeNull();
    expect(found!.email).toBe('test@test.com');
  });

  it('should find by token', async () => {
    const inv = await repo.create({
      tenantId: 'tenant-1',
      email: 'token@test.com',
      role: 'admin',
      invitedBy: 'user-1',
    });

    const found = await repo.findByToken(inv.token);
    expect(found).not.toBeNull();
    expect(found!.role).toBe('admin');
  });

  it('should list by tenant', async () => {
    await repo.create({ tenantId: 'tenant-1', email: 'a@t.com', role: 'member', invitedBy: 'u1' });
    await repo.create({ tenantId: 'tenant-1', email: 'b@t.com', role: 'member', invitedBy: 'u1' });
    await repo.create({ tenantId: 'tenant-2', email: 'c@t.com', role: 'member', invitedBy: 'u2' });

    const t1 = await repo.findByTenant('tenant-1');
    expect(t1).toHaveLength(2);

    const t2 = await repo.findByTenant('tenant-2');
    expect(t2).toHaveLength(1);
  });

  it('should find pending by email', async () => {
    await repo.create({ tenantId: 'tenant-1', email: 'dup@t.com', role: 'member', invitedBy: 'u1' });

    const found = await repo.findPendingByEmail('dup@t.com', 'tenant-1');
    expect(found).not.toBeNull();

    const notFound = await repo.findPendingByEmail('dup@t.com', 'tenant-2');
    expect(notFound).toBeNull();
  });

  it('should update status', async () => {
    const inv = await repo.create({ tenantId: 't1', email: 'a@t.com', role: 'member', invitedBy: 'u1' });

    await repo.updateStatus(inv.id, 'cancelled');
    const found = await repo.findById(inv.id);
    expect(found!.status).toBe('cancelled');
  });

  it('should mark accepted', async () => {
    const inv = await repo.create({ tenantId: 't1', email: 'a@t.com', role: 'member', invitedBy: 'u1' });

    await repo.markAccepted(inv.id);
    const found = await repo.findById(inv.id);
    expect(found!.status).toBe('accepted');
    expect(found!.acceptedAt).not.toBeNull();
  });

  it('should delete invitation', async () => {
    const inv = await repo.create({ tenantId: 't1', email: 'a@t.com', role: 'member', invitedBy: 'u1' });
    const success = await repo.delete(inv.id);
    expect(success).toBe(true);

    const found = await repo.findById(inv.id);
    expect(found).toBeNull();
  });

  it('should clear all invitations', async () => {
    await repo.create({ tenantId: 't1', email: 'a@t.com', role: 'member', invitedBy: 'u1' });
    await repo.create({ tenantId: 't1', email: 'b@t.com', role: 'member', invitedBy: 'u1' });

    repo.clear();
    const all = await repo.findByTenant('t1');
    expect(all).toHaveLength(0);
  });
});
