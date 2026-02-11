// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for ServerRepository (both Drizzle and InMemory implementations).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { initDatabase, closeDatabase } from '../connection.js';
import { createTables } from '../connection.js';
import {
  DrizzleServerRepository,
  InMemoryServerRepository,
} from './server-repository.js';

import type { ServerRepository } from './server-repository.js';

// ============================================================================
// Test helper: seed a user so FK constraints pass
// ============================================================================

function setupDrizzleRepo() {
  const db = initDatabase(':memory:');
  createTables();

  const sqlite = (db as unknown as { session: { client: { exec: (s: string) => void } } })
    .session.client;
  sqlite.exec(
    `INSERT INTO users (id, email, password_hash, created_at, updated_at)
     VALUES ('user-1', 'test@example.com', 'hash123', ${Date.now()}, ${Date.now()})`,
  );
  sqlite.exec(
    `INSERT INTO users (id, email, password_hash, created_at, updated_at)
     VALUES ('user-2', 'other@example.com', 'hash456', ${Date.now()}, ${Date.now()})`,
  );

  return new DrizzleServerRepository(db);
}

// ============================================================================
// Shared test suite — runs against both implementations
// ============================================================================

function sharedTests(
  name: string,
  factory: () => { repo: ServerRepository; cleanup: () => void },
) {
  describe(name, () => {
    let repo: ServerRepository;
    let cleanup: () => void;

    beforeEach(() => {
      const result = factory();
      repo = result.repo;
      cleanup = result.cleanup;
    });

    afterEach(() => {
      cleanup();
    });

    it('should create a server', async () => {
      const server = await repo.create({
        name: 'test-server',
        userId: 'user-1',
        tags: ['web', 'prod'],
      });

      expect(server.id).toBeTruthy();
      expect(server.name).toBe('test-server');
      expect(server.userId).toBe('user-1');
      expect(server.status).toBe('offline');
      expect(server.tags).toEqual(['web', 'prod']);
      expect(server.createdAt).toBeTruthy();
    });

    it('should create server with default empty tags', async () => {
      const server = await repo.create({
        name: 'no-tags',
        userId: 'user-1',
      });

      expect(server.tags).toEqual([]);
    });

    it('should find server by ID with correct user', async () => {
      const created = await repo.create({
        name: 'find-me',
        userId: 'user-1',
      });

      const found = await repo.findById(created.id, 'user-1');
      expect(found).not.toBeNull();
      expect(found!.name).toBe('find-me');
    });

    it('should NOT find server for wrong user (isolation)', async () => {
      const created = await repo.create({
        name: 'private',
        userId: 'user-1',
      });

      const found = await repo.findById(created.id, 'user-2');
      expect(found).toBeNull();
    });

    it('should return null for non-existent server', async () => {
      const found = await repo.findById('nonexistent', 'user-1');
      expect(found).toBeNull();
    });

    it('should find all servers by user ID', async () => {
      await repo.create({ name: 'srv-1', userId: 'user-1' });
      await repo.create({ name: 'srv-2', userId: 'user-1' });
      await repo.create({ name: 'srv-3', userId: 'user-2' });

      const user1Servers = await repo.findAllByUserId('user-1');
      expect(user1Servers).toHaveLength(2);

      const user2Servers = await repo.findAllByUserId('user-2');
      expect(user2Servers).toHaveLength(1);
    });

    it('should update server name', async () => {
      const created = await repo.create({
        name: 'original',
        userId: 'user-1',
      });

      const updated = await repo.update(created.id, 'user-1', {
        name: 'renamed',
      });

      expect(updated).not.toBeNull();
      expect(updated!.name).toBe('renamed');
    });

    it('should update server tags', async () => {
      const created = await repo.create({
        name: 'tagged',
        userId: 'user-1',
        tags: ['old'],
      });

      const updated = await repo.update(created.id, 'user-1', {
        tags: ['new', 'tags'],
      });

      expect(updated!.tags).toEqual(['new', 'tags']);
    });

    it('should NOT update server for wrong user', async () => {
      const created = await repo.create({
        name: 'protected',
        userId: 'user-1',
      });

      const updated = await repo.update(created.id, 'user-2', {
        name: 'hacked',
      });
      expect(updated).toBeNull();
    });

    it('should delete server', async () => {
      const created = await repo.create({
        name: 'deletable',
        userId: 'user-1',
      });

      const deleted = await repo.delete(created.id, 'user-1');
      expect(deleted).toBe(true);

      const found = await repo.findById(created.id, 'user-1');
      expect(found).toBeNull();
    });

    it('should NOT delete server for wrong user', async () => {
      const created = await repo.create({
        name: 'protected',
        userId: 'user-1',
      });

      const deleted = await repo.delete(created.id, 'user-2');
      expect(deleted).toBe(false);

      const found = await repo.findById(created.id, 'user-1');
      expect(found).not.toBeNull();
    });

    it('should get profile for server', async () => {
      const created = await repo.create({
        name: 'profiled',
        userId: 'user-1',
      });

      const profile = await repo.getProfile(created.id, 'user-1');
      expect(profile).not.toBeNull();
      expect(profile!.serverId).toBe(created.id);
      expect(profile!.software).toEqual([]);
      expect(profile!.services).toEqual([]);
    });

    it('should NOT get profile for wrong user', async () => {
      const created = await repo.create({
        name: 'private-profile',
        userId: 'user-1',
      });

      const profile = await repo.getProfile(created.id, 'user-2');
      expect(profile).toBeNull();
    });

    it('should get operations with pagination', async () => {
      const created = await repo.create({
        name: 'operated',
        userId: 'user-1',
      });

      const result = await repo.getOperations(created.id, 'user-1', {
        limit: 10,
        offset: 0,
      });

      expect(result.operations).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('should return empty operations for wrong user', async () => {
      const created = await repo.create({
        name: 'operated',
        userId: 'user-1',
      });

      const result = await repo.getOperations(created.id, 'user-2', {
        limit: 10,
        offset: 0,
      });

      expect(result.operations).toEqual([]);
      expect(result.total).toBe(0);
    });

    // ================================================================
    // Group support
    // ================================================================

    it('should create server with group', async () => {
      const server = await repo.create({
        name: 'grouped',
        userId: 'user-1',
        group: 'production',
      });

      expect(server.group).toBe('production');
    });

    it('should create server with null group by default', async () => {
      const server = await repo.create({
        name: 'no-group',
        userId: 'user-1',
      });

      expect(server.group).toBeNull();
    });

    it('should update server group', async () => {
      const created = await repo.create({
        name: 'to-group',
        userId: 'user-1',
      });

      const updated = await repo.update(created.id, 'user-1', {
        group: 'staging',
      });

      expect(updated!.group).toBe('staging');
    });

    it('should clear server group with null', async () => {
      const created = await repo.create({
        name: 'grouped',
        userId: 'user-1',
        group: 'production',
      });

      const updated = await repo.update(created.id, 'user-1', {
        group: null,
      });

      expect(updated!.group).toBeNull();
    });

    // ================================================================
    // Filtering
    // ================================================================

    it('should filter servers by group', async () => {
      await repo.create({ name: 'srv-a', userId: 'user-1', group: 'prod' });
      await repo.create({ name: 'srv-b', userId: 'user-1', group: 'staging' });
      await repo.create({ name: 'srv-c', userId: 'user-1' });

      const prodServers = await repo.findAllByUserId('user-1', { group: 'prod' });
      expect(prodServers).toHaveLength(1);
      expect(prodServers[0].name).toBe('srv-a');
    });

    it('should filter servers by tag', async () => {
      await repo.create({ name: 'srv-a', userId: 'user-1', tags: ['web', 'prod'] });
      await repo.create({ name: 'srv-b', userId: 'user-1', tags: ['db', 'prod'] });
      await repo.create({ name: 'srv-c', userId: 'user-1', tags: ['web'] });

      const webServers = await repo.findAllByUserId('user-1', { tag: 'web' });
      expect(webServers).toHaveLength(2);
      expect(webServers.map((s) => s.name).sort()).toEqual(['srv-a', 'srv-c']);
    });

    it('should filter by both group and tag', async () => {
      await repo.create({ name: 'srv-a', userId: 'user-1', group: 'prod', tags: ['web'] });
      await repo.create({ name: 'srv-b', userId: 'user-1', group: 'prod', tags: ['db'] });
      await repo.create({ name: 'srv-c', userId: 'user-1', group: 'staging', tags: ['web'] });

      const result = await repo.findAllByUserId('user-1', { group: 'prod', tag: 'web' });
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('srv-a');
    });

    it('should return all servers when no filters', async () => {
      await repo.create({ name: 'srv-a', userId: 'user-1', group: 'prod', tags: ['web'] });
      await repo.create({ name: 'srv-b', userId: 'user-1' });

      const all = await repo.findAllByUserId('user-1');
      expect(all).toHaveLength(2);
    });

    it('should filter tags case-insensitively', async () => {
      await repo.create({ name: 'srv-a', userId: 'user-1', tags: ['Production'] });

      const result = await repo.findAllByUserId('user-1', { tag: 'production' });
      expect(result).toHaveLength(1);
    });

    // ================================================================
    // updateStatus
    // ================================================================

    it('should update server status to online', async () => {
      const created = await repo.create({ name: 'status-test', userId: 'user-1' });
      expect(created.status).toBe('offline');

      const updated = await repo.updateStatus(created.id, 'online');
      expect(updated).toBe(true);

      const found = await repo.findById(created.id, 'user-1');
      expect(found!.status).toBe('online');
    });

    it('should update server status to offline', async () => {
      const created = await repo.create({ name: 'status-test', userId: 'user-1' });
      await repo.updateStatus(created.id, 'online');

      const updated = await repo.updateStatus(created.id, 'offline');
      expect(updated).toBe(true);

      const found = await repo.findById(created.id, 'user-1');
      expect(found!.status).toBe('offline');
    });

    it('should return false when updating status for non-existent server', async () => {
      const updated = await repo.updateStatus('non-existent', 'online');
      expect(updated).toBe(false);
    });
  });
}

// ============================================================================
// Run shared tests for InMemory
// ============================================================================

sharedTests('InMemoryServerRepository', () => {
  const repo = new InMemoryServerRepository();
  return { repo, cleanup: () => repo.clear() };
});

// ============================================================================
// Run shared tests for Drizzle
// ============================================================================

sharedTests('DrizzleServerRepository', () => {
  const repo = setupDrizzleRepo();
  return { repo, cleanup: () => closeDatabase() };
});
