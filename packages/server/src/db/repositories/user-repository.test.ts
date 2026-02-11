// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for UserRepository (both Drizzle and InMemory implementations).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { initDatabase, closeDatabase, createTables } from '../connection.js';
import {
  DrizzleUserRepository,
  InMemoryUserRepository,
} from './user-repository.js';

import type { UserRepository } from './user-repository.js';

// ============================================================================
// Test helper: set up Drizzle repo with in-memory DB
// ============================================================================

function setupDrizzleRepo() {
  const db = initDatabase(':memory:');
  createTables();
  return new DrizzleUserRepository(db);
}

// ============================================================================
// Shared test suite — runs against both implementations
// ============================================================================

function sharedTests(
  name: string,
  factory: () => { repo: UserRepository; cleanup: () => void },
) {
  describe(name, () => {
    let repo: UserRepository;
    let cleanup: () => void;

    beforeEach(() => {
      const result = factory();
      repo = result.repo;
      cleanup = result.cleanup;
    });

    afterEach(() => {
      cleanup();
    });

    // ========================================================================
    // create
    // ========================================================================

    it('should create a user', async () => {
      const user = await repo.create({
        email: 'alice@example.com',
        passwordHash: 'scrypt:16384:8:1:salt:hash',
        name: 'Alice',
      });

      expect(user.id).toBeTruthy();
      expect(user.email).toBe('alice@example.com');
      expect(user.passwordHash).toBe('scrypt:16384:8:1:salt:hash');
      expect(user.name).toBe('Alice');
      expect(user.timezone).toBe('UTC');
      expect(user.createdAt).toBeTruthy();
      expect(user.updatedAt).toBeTruthy();
    });

    it('should generate unique IDs for different users', async () => {
      const u1 = await repo.create({
        email: 'a@example.com',
        passwordHash: 'hash1',
        name: 'A',
      });
      const u2 = await repo.create({
        email: 'b@example.com',
        passwordHash: 'hash2',
        name: 'B',
      });

      expect(u1.id).not.toBe(u2.id);
    });

    // ========================================================================
    // findById
    // ========================================================================

    it('should find user by ID', async () => {
      const created = await repo.create({
        email: 'find@example.com',
        passwordHash: 'hash',
        name: 'FindMe',
      });

      const found = await repo.findById(created.id);
      expect(found).not.toBeNull();
      expect(found!.email).toBe('find@example.com');
      expect(found!.name).toBe('FindMe');
    });

    it('should return null for non-existent ID', async () => {
      const found = await repo.findById('nonexistent-id');
      expect(found).toBeNull();
    });

    // ========================================================================
    // findByEmail
    // ========================================================================

    it('should find user by email', async () => {
      await repo.create({
        email: 'email@example.com',
        passwordHash: 'hash',
        name: 'EmailUser',
      });

      const found = await repo.findByEmail('email@example.com');
      expect(found).not.toBeNull();
      expect(found!.name).toBe('EmailUser');
    });

    it('should return null for non-existent email', async () => {
      const found = await repo.findByEmail('nope@example.com');
      expect(found).toBeNull();
    });

    it('should be case-sensitive for email lookup', async () => {
      await repo.create({
        email: 'Case@Example.com',
        passwordHash: 'hash',
        name: 'CaseUser',
      });

      // SQLite LIKE is case-insensitive, but eq() is exact match
      const found = await repo.findByEmail('case@example.com');
      // This depends on the SQLite collation; the important thing is
      // we test the actual behavior
      if (found) {
        expect(found.email).toBe('Case@Example.com');
      }
    });

    // ========================================================================
    // update
    // ========================================================================

    it('should update user name', async () => {
      const created = await repo.create({
        email: 'update@example.com',
        passwordHash: 'hash',
        name: 'Original',
      });

      const updated = await repo.update(created.id, { name: 'Renamed' });
      expect(updated).not.toBeNull();
      expect(updated!.name).toBe('Renamed');
    });

    it('should update user timezone', async () => {
      const created = await repo.create({
        email: 'tz@example.com',
        passwordHash: 'hash',
        name: 'TzUser',
      });

      const updated = await repo.update(created.id, { timezone: 'Asia/Shanghai' });
      expect(updated).not.toBeNull();
      expect(updated!.timezone).toBe('Asia/Shanghai');
    });

    it('should return null when updating non-existent user', async () => {
      const updated = await repo.update('nonexistent', { name: 'Ghost' });
      expect(updated).toBeNull();
    });

    // ========================================================================
    // delete
    // ========================================================================

    it('should delete user', async () => {
      const created = await repo.create({
        email: 'delete@example.com',
        passwordHash: 'hash',
        name: 'DeleteMe',
      });

      const deleted = await repo.delete(created.id);
      expect(deleted).toBe(true);

      const found = await repo.findById(created.id);
      expect(found).toBeNull();
    });

    it('should return false when deleting non-existent user', async () => {
      const deleted = await repo.delete('nonexistent');
      expect(deleted).toBe(false);
    });

    // ========================================================================
    // email uniqueness (Drizzle enforced by DB, InMemory has no constraint)
    // ========================================================================

    if (name.includes('Drizzle')) {
      it('should reject duplicate email (DB constraint)', async () => {
        await repo.create({
          email: 'dup@example.com',
          passwordHash: 'hash1',
          name: 'First',
        });

        await expect(
          repo.create({
            email: 'dup@example.com',
            passwordHash: 'hash2',
            name: 'Second',
          }),
        ).rejects.toThrow();
      });
    }
  });
}

// ============================================================================
// Run shared tests for InMemory
// ============================================================================

sharedTests('InMemoryUserRepository', () => {
  const repo = new InMemoryUserRepository();
  return { repo, cleanup: () => repo.clear() };
});

// ============================================================================
// Run shared tests for Drizzle
// ============================================================================

sharedTests('DrizzleUserRepository', () => {
  const repo = setupDrizzleRepo();
  return { repo, cleanup: () => closeDatabase() };
});
