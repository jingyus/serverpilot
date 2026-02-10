/**
 * Tests for OperationRepository (Drizzle implementation).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { initDatabase, closeDatabase } from '../connection.js';
import { createTables } from '../connection.js';
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

describe('DrizzleOperationRepository', () => {
  beforeEach(() => {
    db = initDatabase(':memory:');
    createTables();
    repo = new DrizzleOperationRepository(db);

    seedUser('user-1', 'test@example.com');
    seedUser('user-2', 'other@example.com');
    seedServer('srv-1', 'user-1', 'Server 1');
    seedServer('srv-2', 'user-2', 'Server 2');
  });

  afterEach(() => {
    closeDatabase();
  });

  it('should create an operation', async () => {
    const op = await repo.create({
      serverId: 'srv-1',
      userId: 'user-1',
      type: 'install',
      description: 'Install nginx',
      commands: ['apt install nginx'],
      riskLevel: 'yellow',
    });

    expect(op.id).toBeTruthy();
    expect(op.serverId).toBe('srv-1');
    expect(op.type).toBe('install');
    expect(op.status).toBe('pending');
    expect(op.commands).toEqual(['apt install nginx']);
  });

  it('should throw when creating operation for non-owned server', async () => {
    await expect(
      repo.create({
        serverId: 'srv-2',
        userId: 'user-1',
        type: 'execute',
        description: 'Hacking',
        commands: ['rm -rf /'],
        riskLevel: 'critical',
      }),
    ).rejects.toThrow('Server not found or access denied');
  });

  it('should get operation by ID with user isolation', async () => {
    const created = await repo.create({
      serverId: 'srv-1',
      userId: 'user-1',
      type: 'config',
      description: 'Configure nginx',
      commands: ['vim /etc/nginx/nginx.conf'],
      riskLevel: 'green',
    });

    const found = await repo.getById(created.id, 'user-1');
    expect(found).not.toBeNull();
    expect(found!.description).toBe('Configure nginx');

    const notFound = await repo.getById(created.id, 'user-2');
    expect(notFound).toBeNull();
  });

  it('should list operations by server with pagination', async () => {
    for (let i = 0; i < 5; i++) {
      await repo.create({
        serverId: 'srv-1',
        userId: 'user-1',
        type: 'execute',
        description: `Op ${i}`,
        commands: [`cmd-${i}`],
        riskLevel: 'green',
      });
    }

    const page1 = await repo.listByServer('srv-1', 'user-1', {
      limit: 2,
      offset: 0,
    });
    expect(page1.total).toBe(5);
    expect(page1.operations).toHaveLength(2);

    const page2 = await repo.listByServer('srv-1', 'user-1', {
      limit: 2,
      offset: 2,
    });
    expect(page2.operations).toHaveLength(2);
  });

  it('should deny listing operations for wrong user', async () => {
    await repo.create({
      serverId: 'srv-1',
      userId: 'user-1',
      type: 'backup',
      description: 'Backup DB',
      commands: ['pg_dump'],
      riskLevel: 'green',
    });

    const result = await repo.listByServer('srv-1', 'user-2', {
      limit: 10,
      offset: 0,
    });
    expect(result.operations).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('should list operations by status', async () => {
    const op = await repo.create({
      serverId: 'srv-1',
      userId: 'user-1',
      type: 'install',
      description: 'Install redis',
      commands: ['apt install redis'],
      riskLevel: 'yellow',
    });

    const pending = await repo.listByStatus('user-1', 'pending', {
      limit: 10,
      offset: 0,
    });
    expect(pending.total).toBe(1);
    expect(pending.operations[0].id).toBe(op.id);
  });

  it('should mark operation as running', async () => {
    const op = await repo.create({
      serverId: 'srv-1',
      userId: 'user-1',
      type: 'restart',
      description: 'Restart nginx',
      commands: ['systemctl restart nginx'],
      riskLevel: 'yellow',
    });

    const result = await repo.markRunning(op.id, 'user-1');
    expect(result).toBe(true);

    const found = await repo.getById(op.id, 'user-1');
    expect(found!.status).toBe('running');
  });

  it('should NOT mark non-pending operation as running', async () => {
    const op = await repo.create({
      serverId: 'srv-1',
      userId: 'user-1',
      type: 'execute',
      description: 'Run cmd',
      commands: ['ls'],
      riskLevel: 'green',
    });

    await repo.markRunning(op.id, 'user-1');
    // Already running, should not re-mark
    const result = await repo.markRunning(op.id, 'user-1');
    expect(result).toBe(false);
  });

  it('should mark operation as complete', async () => {
    const op = await repo.create({
      serverId: 'srv-1',
      userId: 'user-1',
      type: 'install',
      description: 'Install node',
      commands: ['nvm install 22'],
      riskLevel: 'green',
    });

    const completed = await repo.markComplete(
      op.id,
      'user-1',
      'Installation successful',
      'success',
      1500,
    );
    expect(completed).toBe(true);

    const found = await repo.getById(op.id, 'user-1');
    expect(found!.status).toBe('success');
    expect(found!.output).toBe('Installation successful');
    expect(found!.duration).toBe(1500);
    expect(found!.completedAt).toBeTruthy();
  });

  it('should update operation output', async () => {
    const op = await repo.create({
      serverId: 'srv-1',
      userId: 'user-1',
      type: 'execute',
      description: 'Long running',
      commands: ['make build'],
      riskLevel: 'green',
    });

    await repo.updateOutput(op.id, 'user-1', 'Step 1 done...');
    const found = await repo.getById(op.id, 'user-1');
    expect(found!.output).toBe('Step 1 done...');
  });

  it('should NOT update output for wrong user', async () => {
    const op = await repo.create({
      serverId: 'srv-1',
      userId: 'user-1',
      type: 'execute',
      description: 'Private',
      commands: ['private-cmd'],
      riskLevel: 'green',
    });

    const result = await repo.updateOutput(op.id, 'user-2', 'hacked');
    expect(result).toBe(false);
  });
});
