// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for OperationHistoryService.
 *
 * Validates audit trail recording, profile sync, status transitions,
 * filtering, and statistics aggregation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { initDatabase, closeDatabase, createTables } from '../../db/connection.js';
import { DrizzleOperationRepository } from '../../db/repositories/operation-repository.js';
import { DrizzleProfileRepository } from '../../db/repositories/profile-repository.js';
import { OperationHistoryService } from './operation-history-service.js';

import type { DrizzleDB } from '../../db/connection.js';

let db: DrizzleDB;
let operationRepo: DrizzleOperationRepository;
let profileRepo: DrizzleProfileRepository;
let service: OperationHistoryService;

function exec(sql: string) {
  const sqlite = (db as unknown as { session: { client: { exec: (s: string) => void } } })
    .session.client;
  sqlite.exec(sql);
}

function seedUser(id: string, email: string) {
  exec(
    `INSERT INTO users (id, email, password_hash, created_at, updated_at)
     VALUES ('${id}', '${email}', 'hash', ${Date.now()}, ${Date.now()})`,
  );
}

function seedServer(id: string, userId: string, name: string) {
  exec(
    `INSERT INTO servers (id, name, user_id, status, tags, created_at, updated_at)
     VALUES ('${id}', '${name}', '${userId}', 'online', '[]', ${Date.now()}, ${Date.now()})`,
  );
}

function seedProfile(serverId: string) {
  const id = `prof-${serverId}`;
  exec(
    `INSERT INTO profiles (id, server_id, operation_history, updated_at)
     VALUES ('${id}', '${serverId}', '[]', ${Date.now()})`,
  );
}

describe('OperationHistoryService', () => {
  beforeEach(() => {
    db = initDatabase(':memory:');
    createTables();
    operationRepo = new DrizzleOperationRepository(db);
    profileRepo = new DrizzleProfileRepository(db);
    service = new OperationHistoryService(operationRepo, profileRepo);

    seedUser('user-1', 'test@example.com');
    seedServer('srv-1', 'user-1', 'Server 1');
    seedProfile('srv-1');
  });

  afterEach(() => {
    closeDatabase();
  });

  // --------------------------------------------------------------------------
  // recordOperation
  // --------------------------------------------------------------------------

  describe('recordOperation', () => {
    it('should create an operation record', async () => {
      const record = await service.recordOperation({
        serverId: 'srv-1',
        userId: 'user-1',
        type: 'install',
        description: 'Install nginx',
        commands: ['apt install nginx'],
        riskLevel: 'yellow',
      });

      expect(record.id).toBeTruthy();
      expect(record.serverId).toBe('srv-1');
      expect(record.type).toBe('install');
      expect(record.status).toBe('pending');
      expect(record.riskLevel).toBe('yellow');
    });

    it('should sync to profile history by default', async () => {
      await service.recordOperation({
        serverId: 'srv-1',
        userId: 'user-1',
        type: 'install',
        description: 'Install Redis',
        commands: ['apt install redis-server'],
        riskLevel: 'yellow',
      });

      const history = await profileRepo.getOperationHistory('srv-1', 'user-1');
      expect(history).toHaveLength(1);
      expect(history[0]).toContain('INSTALL');
      expect(history[0]).toContain('Install Redis');
      expect(history[0]).toContain('yellow');
    });

    it('should skip profile sync when disabled', async () => {
      await service.recordOperation(
        {
          serverId: 'srv-1',
          userId: 'user-1',
          type: 'execute',
          description: 'Run diagnostic',
          commands: ['uptime'],
          riskLevel: 'green',
        },
        { syncToProfile: false },
      );

      const history = await profileRepo.getOperationHistory('srv-1', 'user-1');
      expect(history).toHaveLength(0);
    });

    it('should not fail if profile sync fails', async () => {
      // Create operation for a server without a profile
      seedServer('srv-no-profile', 'user-1', 'No Profile');

      const record = await service.recordOperation({
        serverId: 'srv-no-profile',
        userId: 'user-1',
        type: 'execute',
        description: 'Test operation',
        commands: ['ls'],
        riskLevel: 'green',
      });

      // Operation should still be created successfully
      expect(record.id).toBeTruthy();
    });
  });

  // --------------------------------------------------------------------------
  // markRunning
  // --------------------------------------------------------------------------

  describe('markRunning', () => {
    it('should mark operation as running', async () => {
      const record = await service.recordOperation({
        serverId: 'srv-1',
        userId: 'user-1',
        type: 'restart',
        description: 'Restart nginx',
        commands: ['systemctl restart nginx'],
        riskLevel: 'yellow',
      });

      const result = await service.markRunning(record.id, 'user-1');
      expect(result).toBe(true);

      const updated = await service.getById(record.id, 'user-1');
      expect(updated!.status).toBe('running');
    });

    it('should return false for already running operation', async () => {
      const record = await service.recordOperation({
        serverId: 'srv-1',
        userId: 'user-1',
        type: 'execute',
        description: 'Run cmd',
        commands: ['ls'],
        riskLevel: 'green',
      });

      await service.markRunning(record.id, 'user-1');
      const result = await service.markRunning(record.id, 'user-1');
      expect(result).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // markComplete
  // --------------------------------------------------------------------------

  describe('markComplete', () => {
    it('should mark operation as success and sync to profile', async () => {
      const record = await service.recordOperation({
        serverId: 'srv-1',
        userId: 'user-1',
        type: 'install',
        description: 'Install nginx',
        commands: ['apt install nginx'],
        riskLevel: 'yellow',
      });

      const result = await service.markComplete(
        record.id, 'user-1', 'Installation successful', 'success', 1500,
      );
      expect(result).toBe(true);

      const updated = await service.getById(record.id, 'user-1');
      expect(updated!.status).toBe('success');
      expect(updated!.output).toBe('Installation successful');
      expect(updated!.duration).toBe(1500);

      // Profile should have both creation and completion entries
      const history = await profileRepo.getOperationHistory('srv-1', 'user-1');
      expect(history).toHaveLength(2);
      expect(history[1]).toContain('COMPLETED SUCCESS');
    });

    it('should mark operation as failed', async () => {
      const record = await service.recordOperation({
        serverId: 'srv-1',
        userId: 'user-1',
        type: 'config',
        description: 'Configure SSL',
        commands: ['certbot --nginx'],
        riskLevel: 'red',
      });

      await service.markComplete(
        record.id, 'user-1', 'Certificate error', 'failed', 5000,
      );

      const updated = await service.getById(record.id, 'user-1');
      expect(updated!.status).toBe('failed');

      const history = await profileRepo.getOperationHistory('srv-1', 'user-1');
      expect(history.some((h) => h.includes('COMPLETED FAILED'))).toBe(true);
    });

    it('should mark operation as rolled_back', async () => {
      const record = await service.recordOperation({
        serverId: 'srv-1',
        userId: 'user-1',
        type: 'config',
        description: 'Modify config',
        commands: ['sed -i ...'],
        riskLevel: 'red',
      });

      await service.markComplete(
        record.id, 'user-1', 'Rolled back due to errors', 'rolled_back', 2000,
      );

      const updated = await service.getById(record.id, 'user-1');
      expect(updated!.status).toBe('rolled_back');
    });
  });

  // --------------------------------------------------------------------------
  // listOperations
  // --------------------------------------------------------------------------

  describe('listOperations', () => {
    it('should list operations with filtering', async () => {
      await service.recordOperation({
        serverId: 'srv-1', userId: 'user-1', type: 'install',
        description: 'Install nginx', commands: ['apt install nginx'], riskLevel: 'yellow',
      });
      await service.recordOperation({
        serverId: 'srv-1', userId: 'user-1', type: 'config',
        description: 'Configure nginx', commands: ['vim /etc/nginx/nginx.conf'], riskLevel: 'red',
      });

      const all = await service.listOperations('user-1', {}, { limit: 50, offset: 0 });
      expect(all.total).toBe(2);

      const installs = await service.listOperations(
        'user-1', { type: 'install' }, { limit: 50, offset: 0 },
      );
      expect(installs.total).toBe(1);
      expect(installs.operations[0].type).toBe('install');
    });

    it('should search operations by description', async () => {
      await service.recordOperation({
        serverId: 'srv-1', userId: 'user-1', type: 'install',
        description: 'Install nginx web server', commands: ['apt install nginx'], riskLevel: 'yellow',
      });
      await service.recordOperation({
        serverId: 'srv-1', userId: 'user-1', type: 'install',
        description: 'Install Redis cache', commands: ['apt install redis'], riskLevel: 'yellow',
      });

      const results = await service.listOperations(
        'user-1', { search: 'Redis' }, { limit: 50, offset: 0 },
      );
      expect(results.total).toBe(1);
      expect(results.operations[0].description).toContain('Redis');
    });
  });

  // --------------------------------------------------------------------------
  // getStats
  // --------------------------------------------------------------------------

  describe('getStats', () => {
    it('should return aggregated statistics', async () => {
      const op1 = await service.recordOperation({
        serverId: 'srv-1', userId: 'user-1', type: 'install',
        description: 'Install A', commands: ['cmd1'], riskLevel: 'yellow',
      });
      const op2 = await service.recordOperation({
        serverId: 'srv-1', userId: 'user-1', type: 'config',
        description: 'Config B', commands: ['cmd2'], riskLevel: 'red',
      });

      await service.markComplete(op1.id, 'user-1', 'ok', 'success', 100);
      await service.markComplete(op2.id, 'user-1', 'err', 'failed', 200);

      const stats = await service.getStats('user-1');

      expect(stats.total).toBe(2);
      expect(stats.byStatus.success).toBe(1);
      expect(stats.byStatus.failed).toBe(1);
      expect(stats.successRate).toBe(50);
      expect(stats.avgDuration).toBe(150);
    });

    it('should filter stats by server', async () => {
      seedServer('srv-2', 'user-1', 'Server 2');

      await service.recordOperation({
        serverId: 'srv-1', userId: 'user-1', type: 'install',
        description: 'Op A', commands: ['cmd'], riskLevel: 'green',
      });
      await service.recordOperation({
        serverId: 'srv-2', userId: 'user-1', type: 'backup',
        description: 'Op B', commands: ['cmd'], riskLevel: 'green',
      });

      const statsAll = await service.getStats('user-1');
      expect(statsAll.total).toBe(2);

      const statsSrv1 = await service.getStats('user-1', 'srv-1');
      expect(statsSrv1.total).toBe(1);
      expect(statsSrv1.byType.install).toBe(1);
    });
  });
});
