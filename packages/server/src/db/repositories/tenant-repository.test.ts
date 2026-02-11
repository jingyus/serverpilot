// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initDatabase, closeDatabase, createTables } from '../connection.js';
import {
  DrizzleTenantRepository,
  _resetTenantRepository,
} from './tenant-repository.js';
import { DrizzleUserRepository, _resetUserRepository } from './user-repository.js';
import { DrizzleServerRepository, _resetServerRepository } from './server-repository.js';
import type { DrizzleDB } from '../connection.js';

describe('TenantRepository', () => {
  let db: DrizzleDB;
  let tenantRepo: DrizzleTenantRepository;
  let userRepo: DrizzleUserRepository;

  beforeEach(() => {
    db = initDatabase(':memory:');
    createTables(db);
    tenantRepo = new DrizzleTenantRepository(db);
    userRepo = new DrizzleUserRepository(db);
  });

  afterEach(() => {
    _resetTenantRepository();
    _resetUserRepository();
    _resetServerRepository();
    closeDatabase();
  });

  describe('create', () => {
    it('should create a tenant with default values', async () => {
      const tenant = await tenantRepo.create({
        name: 'Test Workspace',
        slug: 'test-workspace',
        ownerId: 'user-1',
      });

      expect(tenant.id).toBeDefined();
      expect(tenant.name).toBe('Test Workspace');
      expect(tenant.slug).toBe('test-workspace');
      expect(tenant.ownerId).toBe('user-1');
      expect(tenant.plan).toBe('free');
      expect(tenant.maxServers).toBe(5);
      expect(tenant.maxUsers).toBe(1);
    });

    it('should create a tenant with custom plan', async () => {
      const tenant = await tenantRepo.create({
        name: 'Pro Workspace',
        slug: 'pro-workspace',
        ownerId: 'user-1',
        plan: 'pro',
        maxServers: 50,
        maxUsers: 10,
      });

      expect(tenant.plan).toBe('pro');
      expect(tenant.maxServers).toBe(50);
      expect(tenant.maxUsers).toBe(10);
    });

    it('should enforce unique slug constraint', async () => {
      await tenantRepo.create({
        name: 'Workspace 1',
        slug: 'same-slug',
        ownerId: 'user-1',
      });

      await expect(
        tenantRepo.create({
          name: 'Workspace 2',
          slug: 'same-slug',
          ownerId: 'user-2',
        }),
      ).rejects.toThrow();
    });
  });

  describe('findById', () => {
    it('should find an existing tenant', async () => {
      const created = await tenantRepo.create({
        name: 'My Workspace',
        slug: 'my-workspace',
        ownerId: 'user-1',
      });

      const found = await tenantRepo.findById(created.id);
      expect(found).not.toBeNull();
      expect(found!.name).toBe('My Workspace');
    });

    it('should return null for non-existent tenant', async () => {
      const found = await tenantRepo.findById('non-existent');
      expect(found).toBeNull();
    });
  });

  describe('findBySlug', () => {
    it('should find tenant by slug', async () => {
      await tenantRepo.create({
        name: 'Test',
        slug: 'test-slug',
        ownerId: 'user-1',
      });

      const found = await tenantRepo.findBySlug('test-slug');
      expect(found).not.toBeNull();
      expect(found!.name).toBe('Test');
    });
  });

  describe('findByOwnerId', () => {
    it('should find tenant by owner', async () => {
      await tenantRepo.create({
        name: 'Owner Test',
        slug: 'owner-test',
        ownerId: 'user-owner',
      });

      const found = await tenantRepo.findByOwnerId('user-owner');
      expect(found).not.toBeNull();
      expect(found!.ownerId).toBe('user-owner');
    });
  });

  describe('update', () => {
    it('should update tenant properties', async () => {
      const created = await tenantRepo.create({
        name: 'Original',
        slug: 'original',
        ownerId: 'user-1',
      });

      const updated = await tenantRepo.update(created.id, {
        name: 'Updated',
        plan: 'enterprise',
        maxServers: 100,
      });

      expect(updated).not.toBeNull();
      expect(updated!.name).toBe('Updated');
      expect(updated!.plan).toBe('enterprise');
      expect(updated!.maxServers).toBe(100);
    });

    it('should return null for non-existent tenant', async () => {
      const updated = await tenantRepo.update('non-existent', { name: 'X' });
      expect(updated).toBeNull();
    });
  });

  describe('delete', () => {
    it('should delete an existing tenant', async () => {
      const created = await tenantRepo.create({
        name: 'To Delete',
        slug: 'to-delete',
        ownerId: 'user-1',
      });

      const deleted = await tenantRepo.delete(created.id);
      expect(deleted).toBe(true);

      const found = await tenantRepo.findById(created.id);
      expect(found).toBeNull();
    });

    it('should return false for non-existent tenant', async () => {
      const deleted = await tenantRepo.delete('non-existent');
      expect(deleted).toBe(false);
    });
  });

  describe('migrateUserToTenant', () => {
    it('should create a default tenant and assign user data', async () => {
      // Create a user first
      const user = await userRepo.create({
        email: 'test@example.com',
        passwordHash: 'hash',
        name: 'Test User',
      });

      // Create a server for this user
      const serverRepo = new DrizzleServerRepository(db);
      const server = await serverRepo.create({
        name: 'Test Server',
        userId: user.id,
      });

      // Migrate user to tenant
      const tenant = await tenantRepo.migrateUserToTenant(user.id);

      expect(tenant.ownerId).toBe(user.id);
      expect(tenant.plan).toBe('free');

      // Verify user now has tenantId
      const updatedUser = await userRepo.findById(user.id);
      expect(updatedUser!.tenantId).toBe(tenant.id);

      // Verify server now has tenantId
      const updatedServer = await serverRepo.findById(server.id, user.id);
      expect(updatedServer!.tenantId).toBe(tenant.id);
    });

    it('should return existing tenant if user already has one', async () => {
      const user = await userRepo.create({
        email: 'existing@example.com',
        passwordHash: 'hash',
        name: 'Existing User',
      });

      const tenant1 = await tenantRepo.migrateUserToTenant(user.id);
      const tenant2 = await tenantRepo.migrateUserToTenant(user.id);

      expect(tenant1.id).toBe(tenant2.id);
    });

    it('should throw for non-existent user', async () => {
      await expect(
        tenantRepo.migrateUserToTenant('non-existent'),
      ).rejects.toThrow('User non-existent not found');
    });
  });
});

describe('Multi-tenant data isolation', () => {
  let db: DrizzleDB;
  let tenantRepo: DrizzleTenantRepository;
  let userRepo: DrizzleUserRepository;
  let serverRepo: DrizzleServerRepository;

  beforeEach(() => {
    db = initDatabase(':memory:');
    createTables(db);
    tenantRepo = new DrizzleTenantRepository(db);
    userRepo = new DrizzleUserRepository(db);
    serverRepo = new DrizzleServerRepository(db);
  });

  afterEach(() => {
    _resetTenantRepository();
    _resetUserRepository();
    _resetServerRepository();
    closeDatabase();
  });

  it('should isolate servers between tenants via userId', async () => {
    // Create two users (simulating two tenants)
    const user1 = await userRepo.create({
      email: 'user1@tenant1.com',
      passwordHash: 'hash1',
      name: 'User 1',
    });
    const user2 = await userRepo.create({
      email: 'user2@tenant2.com',
      passwordHash: 'hash2',
      name: 'User 2',
    });

    // Create tenants
    const tenant1 = await tenantRepo.create({
      name: 'Tenant 1',
      slug: 'tenant-1',
      ownerId: user1.id,
    });
    const tenant2 = await tenantRepo.create({
      name: 'Tenant 2',
      slug: 'tenant-2',
      ownerId: user2.id,
    });

    // Create servers for each tenant
    const server1 = await serverRepo.create({
      name: 'Server A',
      userId: user1.id,
      tenantId: tenant1.id,
    });
    const server2 = await serverRepo.create({
      name: 'Server B',
      userId: user2.id,
      tenantId: tenant2.id,
    });

    // User 1 can only see their own servers
    const user1Servers = await serverRepo.findAllByUserId(user1.id);
    expect(user1Servers).toHaveLength(1);
    expect(user1Servers[0].name).toBe('Server A');
    expect(user1Servers[0].tenantId).toBe(tenant1.id);

    // User 2 can only see their own servers
    const user2Servers = await serverRepo.findAllByUserId(user2.id);
    expect(user2Servers).toHaveLength(1);
    expect(user2Servers[0].name).toBe('Server B');
    expect(user2Servers[0].tenantId).toBe(tenant2.id);

    // Cross-tenant access should fail
    const crossAccess = await serverRepo.findById(server1.id, user2.id);
    expect(crossAccess).toBeNull();

    const crossAccess2 = await serverRepo.findById(server2.id, user1.id);
    expect(crossAccess2).toBeNull();
  });

  it('should work with null tenantId (community edition compatibility)', async () => {
    const user = await userRepo.create({
      email: 'community@example.com',
      passwordHash: 'hash',
      name: 'Community User',
    });

    // Create server without tenantId (community edition)
    const server = await serverRepo.create({
      name: 'Community Server',
      userId: user.id,
    });

    expect(server.tenantId).toBeNull();

    // Should still be findable
    const found = await serverRepo.findById(server.id, user.id);
    expect(found).not.toBeNull();
    expect(found!.tenantId).toBeNull();
  });

  it('should prevent cross-tenant server deletion', async () => {
    const user1 = await userRepo.create({
      email: 'u1@t1.com',
      passwordHash: 'h',
      name: 'U1',
    });
    const user2 = await userRepo.create({
      email: 'u2@t2.com',
      passwordHash: 'h',
      name: 'U2',
    });

    const tenant = await tenantRepo.create({
      name: 'Tenant 1',
      slug: 'tenant-del-1',
      ownerId: user1.id,
    });

    const server = await serverRepo.create({
      name: 'Protected Server',
      userId: user1.id,
      tenantId: tenant.id,
    });

    // User 2 should not be able to delete user 1's server
    const deleted = await serverRepo.delete(server.id, user2.id);
    expect(deleted).toBe(false);

    // Server should still exist
    const found = await serverRepo.findById(server.id, user1.id);
    expect(found).not.toBeNull();
  });

  it('should prevent cross-tenant server updates', async () => {
    const user1 = await userRepo.create({
      email: 'u1@cross.com',
      passwordHash: 'h',
      name: 'U1',
    });
    const user2 = await userRepo.create({
      email: 'u2@cross.com',
      passwordHash: 'h',
      name: 'U2',
    });

    const server = await serverRepo.create({
      name: 'Original Name',
      userId: user1.id,
    });

    // User 2 should not be able to update user 1's server
    const updated = await serverRepo.update(server.id, user2.id, {
      name: 'Hacked Name',
    });
    expect(updated).toBeNull();

    // Server name should be unchanged
    const found = await serverRepo.findById(server.id, user1.id);
    expect(found!.name).toBe('Original Name');
  });
});
