/**
 * Tests for TaskRepository (Drizzle implementation).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { initDatabase, closeDatabase } from '../connection.js';
import { createTables } from '../connection.js';
import { DrizzleTaskRepository } from './task-repository.js';

import type { DrizzleDB } from '../connection.js';

let db: DrizzleDB;
let repo: DrizzleTaskRepository;

function seedUser(id: string, email: string) {
  const sqlite = (db as unknown as { session: { client: { exec: (s: string) => void } } })
    .session.client;
  sqlite.exec(
    `INSERT INTO users (id, email, password_hash, created_at, updated_at)
     VALUES ('${id}', '${email}', 'hash', ${Date.now()}, ${Date.now()})`,
  );
}

function seedServer(id: string, userId: string) {
  const sqlite = (db as unknown as { session: { client: { exec: (s: string) => void } } })
    .session.client;
  sqlite.exec(
    `INSERT INTO servers (id, name, user_id, status, tags, created_at, updated_at)
     VALUES ('${id}', 'Server', '${userId}', 'online', '[]', ${Date.now()}, ${Date.now()})`,
  );
}

describe('DrizzleTaskRepository', () => {
  beforeEach(() => {
    db = initDatabase(':memory:');
    createTables();
    repo = new DrizzleTaskRepository(db);

    seedUser('user-1', 'test@example.com');
    seedUser('user-2', 'other@example.com');
    seedServer('srv-1', 'user-1');
    seedServer('srv-2', 'user-2');
  });

  afterEach(() => {
    closeDatabase();
  });

  it('should create a task', async () => {
    const task = await repo.create({
      serverId: 'srv-1',
      userId: 'user-1',
      name: 'Backup DB',
      description: 'Daily database backup',
      cron: '0 2 * * *',
      command: 'pg_dump mydb > backup.sql',
    });

    expect(task.id).toBeTruthy();
    expect(task.name).toBe('Backup DB');
    expect(task.cron).toBe('0 2 * * *');
    expect(task.status).toBe('active');
    expect(task.lastRun).toBeNull();
  });

  it('should throw when creating task for non-owned server', async () => {
    await expect(
      repo.create({
        serverId: 'srv-2',
        userId: 'user-1',
        name: 'Hacked',
        cron: '* * * * *',
        command: 'malicious',
      }),
    ).rejects.toThrow('Server not found or access denied');
  });

  it('should get task by ID', async () => {
    const created = await repo.create({
      serverId: 'srv-1',
      userId: 'user-1',
      name: 'Cleanup',
      cron: '0 3 * * *',
      command: 'rm -f /tmp/old-*',
    });

    const found = await repo.getById(created.id, 'user-1');
    expect(found).not.toBeNull();
    expect(found!.name).toBe('Cleanup');
  });

  it('should deny access to wrong user', async () => {
    const created = await repo.create({
      serverId: 'srv-1',
      userId: 'user-1',
      name: 'Private',
      cron: '0 0 * * *',
      command: 'secret',
    });

    const found = await repo.getById(created.id, 'user-2');
    expect(found).toBeNull();
  });

  it('should list tasks by server', async () => {
    await repo.create({
      serverId: 'srv-1',
      userId: 'user-1',
      name: 'Task 1',
      cron: '* * * * *',
      command: 'cmd1',
    });
    await repo.create({
      serverId: 'srv-1',
      userId: 'user-1',
      name: 'Task 2',
      cron: '*/5 * * * *',
      command: 'cmd2',
    });

    const result = await repo.listByServer('srv-1', 'user-1', {
      limit: 10,
      offset: 0,
    });

    expect(result.total).toBe(2);
    expect(result.tasks).toHaveLength(2);
  });

  it('should update task', async () => {
    const created = await repo.create({
      serverId: 'srv-1',
      userId: 'user-1',
      name: 'Original',
      cron: '* * * * *',
      command: 'old-cmd',
    });

    const updated = await repo.update(created.id, 'user-1', {
      name: 'Updated',
      command: 'new-cmd',
    });

    expect(updated).not.toBeNull();
    expect(updated!.name).toBe('Updated');
    expect(updated!.command).toBe('new-cmd');
  });

  it('should NOT update task for wrong user', async () => {
    const created = await repo.create({
      serverId: 'srv-1',
      userId: 'user-1',
      name: 'Protected',
      cron: '* * * * *',
      command: 'safe',
    });

    const updated = await repo.update(created.id, 'user-2', {
      name: 'Hacked',
    });
    expect(updated).toBeNull();
  });

  it('should soft-delete task', async () => {
    const created = await repo.create({
      serverId: 'srv-1',
      userId: 'user-1',
      name: 'Deletable',
      cron: '* * * * *',
      command: 'cmd',
    });

    const deleted = await repo.delete(created.id, 'user-1');
    expect(deleted).toBe(true);

    const found = await repo.getById(created.id, 'user-1');
    expect(found!.status).toBe('deleted');
  });

  it('should find tasks by status', async () => {
    await repo.create({
      serverId: 'srv-1',
      userId: 'user-1',
      name: 'Active Task',
      cron: '* * * * *',
      command: 'cmd',
    });

    const t = await repo.create({
      serverId: 'srv-1',
      userId: 'user-1',
      name: 'Paused Task',
      cron: '* * * * *',
      command: 'cmd',
    });
    await repo.update(t.id, 'user-1', { status: 'paused' });

    const active = await repo.findByStatus('user-1', 'active', {
      limit: 10,
      offset: 0,
    });
    expect(active.total).toBe(1);
    expect(active.tasks[0].name).toBe('Active Task');

    const paused = await repo.findByStatus('user-1', 'paused', {
      limit: 10,
      offset: 0,
    });
    expect(paused.total).toBe(1);
    expect(paused.tasks[0].name).toBe('Paused Task');
  });

  it('should update run result', async () => {
    const created = await repo.create({
      serverId: 'srv-1',
      userId: 'user-1',
      name: 'Scheduled',
      cron: '0 * * * *',
      command: 'hourly-job',
    });

    const nextRun = new Date(Date.now() + 3600000);
    const result = await repo.updateRunResult(
      created.id,
      'user-1',
      'success',
      nextRun,
    );
    expect(result).toBe(true);

    const found = await repo.getById(created.id, 'user-1');
    expect(found!.lastRun).toBeTruthy();
    expect(found!.lastStatus).toBe('success');
    expect(found!.nextRun).toBeTruthy();
  });
});
