// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for auto-tenant provisioning in single-tenant mode.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { initDatabase, closeDatabase, createTables } from '../db/connection.js';
import {
  DrizzleUserRepository,
  _resetUserRepository,
} from '../db/repositories/user-repository.js';
import {
  DrizzleTenantRepository,
  setTenantRepository,
  getTenantRepository,
  _resetTenantRepository,
} from '../db/repositories/tenant-repository.js';
import { ensureDefaultTenant, isCloudMode } from './auto-tenant.js';
import type { DrizzleDB } from '../db/connection.js';

describe('auto-tenant provisioning', () => {
  let db: DrizzleDB;
  let userRepo: DrizzleUserRepository;
  let tenantRepo: DrizzleTenantRepository;

  beforeEach(() => {
    db = initDatabase(':memory:');
    createTables(db);
    userRepo = new DrizzleUserRepository(db);
    tenantRepo = new DrizzleTenantRepository(db);
    setTenantRepository(tenantRepo);
    // Ensure CLOUD_MODE is not set
    delete process.env.CLOUD_MODE;
  });

  afterEach(() => {
    _resetUserRepository();
    _resetTenantRepository();
    closeDatabase();
    delete process.env.CLOUD_MODE;
  });

  describe('isCloudMode', () => {
    it('should return false by default', () => {
      expect(isCloudMode()).toBe(false);
    });

    it('should return true when CLOUD_MODE=true', () => {
      process.env.CLOUD_MODE = 'true';
      expect(isCloudMode()).toBe(true);
    });

    it('should return false for other values', () => {
      process.env.CLOUD_MODE = 'false';
      expect(isCloudMode()).toBe(false);
    });
  });

  describe('ensureDefaultTenant', () => {
    it('should create a default tenant for a new user in single-tenant mode', async () => {
      const user = await userRepo.create({
        email: 'alice@example.com',
        passwordHash: 'hash',
        name: 'Alice',
      });

      const tenantId = await ensureDefaultTenant(user.id, user.email);

      expect(tenantId).toBeTruthy();

      // Verify tenant was created
      const tenant = await tenantRepo.findById(tenantId!);
      expect(tenant).not.toBeNull();
      expect(tenant!.ownerId).toBe(user.id);
      expect(tenant!.name).toBe("alice's workspace");
      expect(tenant!.plan).toBe('free');
    });

    it('should assign user to the created tenant', async () => {
      const user = await userRepo.create({
        email: 'bob@example.com',
        passwordHash: 'hash',
        name: 'Bob',
      });

      const tenantId = await ensureDefaultTenant(user.id, user.email);

      // Verify user now has tenant_id set
      const updatedUser = await userRepo.findById(user.id);
      expect(updatedUser).not.toBeNull();
      expect(updatedUser!.tenantId).toBe(tenantId);
    });

    it('should return existing tenant if user already has one', async () => {
      const user = await userRepo.create({
        email: 'carol@example.com',
        passwordHash: 'hash',
        name: 'Carol',
      });

      // Create tenant for user first
      const tenant = await tenantRepo.migrateUserToTenant(user.id);

      // ensureDefaultTenant should return existing tenant
      const tenantId = await ensureDefaultTenant(user.id, user.email);
      expect(tenantId).toBe(tenant.id);
    });

    it('should be a no-op in CLOUD_MODE', async () => {
      process.env.CLOUD_MODE = 'true';

      const user = await userRepo.create({
        email: 'dave@example.com',
        passwordHash: 'hash',
        name: 'Dave',
      });

      const tenantId = await ensureDefaultTenant(user.id, user.email);
      expect(tenantId).toBeNull();

      // Verify no tenant was created
      const tenant = await tenantRepo.findByOwnerId(user.id);
      expect(tenant).toBeNull();
    });

    it('should handle errors gracefully and return null', async () => {
      // Use an invalid userId that doesn't exist in the DB
      // migrateUserToTenant will throw
      const tenantId = await ensureDefaultTenant('non-existent-user', 'bad@example.com');
      expect(tenantId).toBeNull();
    });
  });
});
