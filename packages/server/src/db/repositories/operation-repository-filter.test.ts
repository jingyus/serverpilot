/**
 * Tests for OperationRepository filtering, search, and statistics.
 *
 * Validates listWithFilter and getStats methods added for
 * the operation history feature (full audit trail).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { initDatabase, closeDatabase, createTables } from '../connection.js';
import { DrizzleOperationRepository } from './operation-repository.js';

import type { DrizzleDB } from '../connection.js';

let db: DrizzleDB;
let repo: DrizzleOperationRepository;

function seedUser(id: string, email: string) {
  const sqlite = (db as unknown as { session: { client: { exec: (s: string) => void } } })
    .session.client;
  sqlite.exec(
    `INSERT INTO users (id, email, password_hash, created_at, updated_at)
     VALUES ('${id}', '${email}', 'hash', ${Date.now()}, ${Date.now()})`,
  );
}

function seedServer(id: string, userId: string, name: string) {
  const sqlite = (db as unknown as { session: { client: { exec: (s: string) => void } } })
    .session.client;
  sqlite.exec(
    `INSERT INTO servers (id, name, user_id, status, tags, created_at, updated_at)
     VALUES ('${id}', '${name}', '${userId}', 'online', '[]', ${Date.now()}, ${Date.now()})`,
  );
}

describe('DrizzleOperationRepository — filtering & statistics', () => {
  beforeEach(async () => {
    db = initDatabase(':memory:');
    createTables();
    repo = new DrizzleOperationRepository(db);

    seedUser('user-1', 'test@example.com');
    seedServer('srv-1', 'user-1', 'Server 1');
    seedServer('srv-2', 'user-1', 'Server 2');

    // Seed diverse operations
    await repo.create({
      serverId: 'srv-1', userId: 'user-1', type: 'install',
      description: 'Install nginx', commands: ['apt install nginx'], riskLevel: 'yellow',
    });
    await repo.create({
      serverId: 'srv-1', userId: 'user-1', type: 'config',
      description: 'Configure nginx SSL', commands: ['vim /etc/nginx/nginx.conf'], riskLevel: 'red',
    });
    await repo.create({
      serverId: 'srv-1', userId: 'user-1', type: 'restart',
      description: 'Restart nginx service', commands: ['systemctl restart nginx'], riskLevel: 'yellow',
    });
    await repo.create({
      serverId: 'srv-2', userId: 'user-1', type: 'install',
      description: 'Install Redis', commands: ['apt install redis-server'], riskLevel: 'yellow',
    });
    await repo.create({
      serverId: 'srv-1', userId: 'user-1', type: 'backup',
      description: 'Backup database', commands: ['pg_dump mydb > backup.sql'], riskLevel: 'green',
    });
  });

  afterEach(() => {
    closeDatabase();
  });

  // --------------------------------------------------------------------------
  // listWithFilter
  // --------------------------------------------------------------------------

  describe('listWithFilter', () => {
    it('should list all operations for user without filters', async () => {
      const result = await repo.listWithFilter('user-1', {}, { limit: 50, offset: 0 });
      expect(result.total).toBe(5);
      expect(result.operations).toHaveLength(5);
    });

    it('should filter by serverId', async () => {
      const result = await repo.listWithFilter(
        'user-1', { serverId: 'srv-1' }, { limit: 50, offset: 0 },
      );
      expect(result.total).toBe(4);
      expect(result.operations.every((op) => op.serverId === 'srv-1')).toBe(true);
    });

    it('should filter by type', async () => {
      const result = await repo.listWithFilter(
        'user-1', { type: 'install' }, { limit: 50, offset: 0 },
      );
      expect(result.total).toBe(2);
      expect(result.operations.every((op) => op.type === 'install')).toBe(true);
    });

    it('should filter by status', async () => {
      const result = await repo.listWithFilter(
        'user-1', { status: 'pending' }, { limit: 50, offset: 0 },
      );
      expect(result.total).toBe(5);
    });

    it('should filter by riskLevel', async () => {
      const result = await repo.listWithFilter(
        'user-1', { riskLevel: 'yellow' }, { limit: 50, offset: 0 },
      );
      expect(result.total).toBe(3);
      expect(result.operations.every((op) => op.riskLevel === 'yellow')).toBe(true);
    });

    it('should search by description', async () => {
      const result = await repo.listWithFilter(
        'user-1', { search: 'nginx' }, { limit: 50, offset: 0 },
      );
      expect(result.total).toBe(3);
      expect(result.operations.every((op) => op.description.toLowerCase().includes('nginx'))).toBe(true);
    });

    it('should combine multiple filters', async () => {
      const result = await repo.listWithFilter(
        'user-1',
        { serverId: 'srv-1', type: 'install', riskLevel: 'yellow' },
        { limit: 50, offset: 0 },
      );
      expect(result.total).toBe(1);
      expect(result.operations[0].description).toBe('Install nginx');
    });

    it('should paginate results', async () => {
      const page1 = await repo.listWithFilter(
        'user-1', {}, { limit: 2, offset: 0 },
      );
      expect(page1.total).toBe(5);
      expect(page1.operations).toHaveLength(2);

      const page2 = await repo.listWithFilter(
        'user-1', {}, { limit: 2, offset: 2 },
      );
      expect(page2.operations).toHaveLength(2);

      const page3 = await repo.listWithFilter(
        'user-1', {}, { limit: 2, offset: 4 },
      );
      expect(page3.operations).toHaveLength(1);
    });

    it('should order results by createdAt desc', async () => {
      const result = await repo.listWithFilter(
        'user-1', {}, { limit: 50, offset: 0 },
      );
      for (let i = 1; i < result.operations.length; i++) {
        const prev = new Date(result.operations[i - 1].createdAt).getTime();
        const curr = new Date(result.operations[i].createdAt).getTime();
        expect(prev).toBeGreaterThanOrEqual(curr);
      }
    });

    it('should return empty for non-matching filter', async () => {
      const result = await repo.listWithFilter(
        'user-1', { type: 'execute' }, { limit: 50, offset: 0 },
      );
      expect(result.total).toBe(0);
      expect(result.operations).toEqual([]);
    });

    it('should enforce user isolation', async () => {
      seedUser('user-2', 'other@example.com');
      const result = await repo.listWithFilter(
        'user-2', {}, { limit: 50, offset: 0 },
      );
      expect(result.total).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // getStats
  // --------------------------------------------------------------------------

  describe('getStats', () => {
    it('should return stats for all operations', async () => {
      const stats = await repo.getStats('user-1');

      expect(stats.total).toBe(5);
      expect(stats.byStatus.pending).toBe(5);
      expect(stats.byType.install).toBe(2);
      expect(stats.byType.config).toBe(1);
      expect(stats.byType.restart).toBe(1);
      expect(stats.byType.backup).toBe(1);
      expect(stats.byRiskLevel.yellow).toBe(3);
      expect(stats.byRiskLevel.red).toBe(1);
      expect(stats.byRiskLevel.green).toBe(1);
    });

    it('should filter stats by serverId', async () => {
      const stats = await repo.getStats('user-1', 'srv-2');

      expect(stats.total).toBe(1);
      expect(stats.byType.install).toBe(1);
      expect(stats.byRiskLevel.yellow).toBe(1);
    });

    it('should calculate success rate after completions', async () => {
      const ops = await repo.listWithFilter('user-1', {}, { limit: 50, offset: 0 });

      // Complete first two as success, third as failed
      await repo.markComplete(ops.operations[0].id, 'user-1', 'done', 'success', 100);
      await repo.markComplete(ops.operations[1].id, 'user-1', 'done', 'success', 200);
      await repo.markComplete(ops.operations[2].id, 'user-1', 'error', 'failed', 50);

      const stats = await repo.getStats('user-1');

      expect(stats.byStatus.success).toBe(2);
      expect(stats.byStatus.failed).toBe(1);
      expect(stats.successRate).toBeCloseTo(66.67, 1);
    });

    it('should calculate average duration', async () => {
      const ops = await repo.listWithFilter('user-1', {}, { limit: 50, offset: 0 });

      await repo.markComplete(ops.operations[0].id, 'user-1', '', 'success', 100);
      await repo.markComplete(ops.operations[1].id, 'user-1', '', 'success', 300);

      const stats = await repo.getStats('user-1');

      expect(stats.avgDuration).toBe(200);
    });

    it('should return zero stats for empty results', async () => {
      seedUser('user-empty', 'empty@example.com');
      const stats = await repo.getStats('user-empty');

      expect(stats.total).toBe(0);
      expect(stats.successRate).toBe(0);
      expect(stats.avgDuration).toBeNull();
      expect(stats.byStatus.pending).toBe(0);
    });

    it('should enforce user isolation in stats', async () => {
      seedUser('user-other', 'other2@example.com');
      const stats = await repo.getStats('user-other');
      expect(stats.total).toBe(0);
    });
  });
});
