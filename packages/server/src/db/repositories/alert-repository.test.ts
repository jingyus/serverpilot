/**
 * Tests for AlertRepository (Drizzle implementation).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { initDatabase, closeDatabase } from '../connection.js';
import { createTables } from '../connection.js';
import { DrizzleAlertRepository } from './alert-repository.js';

import type { DrizzleDB } from '../connection.js';

let db: DrizzleDB;
let repo: DrizzleAlertRepository;

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

describe('DrizzleAlertRepository', () => {
  beforeEach(() => {
    db = initDatabase(':memory:');
    createTables();
    repo = new DrizzleAlertRepository(db);

    seedUser('user-1', 'test@example.com');
    seedUser('user-2', 'other@example.com');
    seedServer('srv-1', 'user-1');
    seedServer('srv-2', 'user-2');
  });

  afterEach(() => {
    closeDatabase();
  });

  it('should create an alert', async () => {
    const alert = await repo.create({
      serverId: 'srv-1',
      userId: 'user-1',
      type: 'cpu',
      severity: 'warning',
      message: 'CPU usage above 80%',
      value: '85%',
      threshold: '80%',
    });

    expect(alert.id).toBeTruthy();
    expect(alert.type).toBe('cpu');
    expect(alert.severity).toBe('warning');
    expect(alert.resolved).toBe(false);
  });

  it('should throw when creating alert for non-owned server', async () => {
    await expect(
      repo.create({
        serverId: 'srv-2',
        userId: 'user-1',
        type: 'cpu',
        severity: 'critical',
        message: 'Hack',
      }),
    ).rejects.toThrow('Server not found or access denied');
  });

  it('should get alert by ID with user isolation', async () => {
    const created = await repo.create({
      serverId: 'srv-1',
      userId: 'user-1',
      type: 'memory',
      severity: 'critical',
      message: 'OOM',
    });

    const found = await repo.getById(created.id, 'user-1');
    expect(found).not.toBeNull();
    expect(found!.type).toBe('memory');

    const notFound = await repo.getById(created.id, 'user-2');
    expect(notFound).toBeNull();
  });

  it('should resolve an alert', async () => {
    const created = await repo.create({
      serverId: 'srv-1',
      userId: 'user-1',
      type: 'disk',
      severity: 'warning',
      message: 'Disk 90%',
    });

    const resolved = await repo.resolve(created.id, 'user-1');
    expect(resolved).toBe(true);

    const found = await repo.getById(created.id, 'user-1');
    expect(found!.resolved).toBe(true);
    expect(found!.resolvedAt).toBeTruthy();
  });

  it('should NOT resolve already-resolved alert', async () => {
    const created = await repo.create({
      serverId: 'srv-1',
      userId: 'user-1',
      type: 'service',
      severity: 'critical',
      message: 'nginx down',
    });

    await repo.resolve(created.id, 'user-1');
    const result = await repo.resolve(created.id, 'user-1');
    expect(result).toBe(false);
  });

  it('should list unresolved alerts', async () => {
    await repo.create({
      serverId: 'srv-1',
      userId: 'user-1',
      type: 'cpu',
      severity: 'warning',
      message: 'CPU high',
    });

    const resolved = await repo.create({
      serverId: 'srv-1',
      userId: 'user-1',
      type: 'memory',
      severity: 'info',
      message: 'Memory normal',
    });
    await repo.resolve(resolved.id, 'user-1');

    const result = await repo.listUnresolved('user-1', {
      limit: 10,
      offset: 0,
    });

    expect(result.total).toBe(1);
    expect(result.alerts[0].type).toBe('cpu');
  });

  it('should list alerts by server', async () => {
    await repo.create({
      serverId: 'srv-1',
      userId: 'user-1',
      type: 'cpu',
      severity: 'warning',
      message: 'CPU high',
    });
    await repo.create({
      serverId: 'srv-1',
      userId: 'user-1',
      type: 'disk',
      severity: 'critical',
      message: 'Disk full',
    });

    const result = await repo.listByServer('srv-1', 'user-1', {
      limit: 10,
      offset: 0,
    });

    expect(result.total).toBe(2);
    expect(result.alerts).toHaveLength(2);
  });

  it('should deny listing alerts for wrong user', async () => {
    await repo.create({
      serverId: 'srv-1',
      userId: 'user-1',
      type: 'offline',
      severity: 'critical',
      message: 'Server offline',
    });

    const result = await repo.listByServer('srv-1', 'user-2', {
      limit: 10,
      offset: 0,
    });

    expect(result.alerts).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('should list alerts by type', async () => {
    await repo.create({
      serverId: 'srv-1',
      userId: 'user-1',
      type: 'cpu',
      severity: 'warning',
      message: 'CPU alert 1',
    });
    await repo.create({
      serverId: 'srv-1',
      userId: 'user-1',
      type: 'memory',
      severity: 'critical',
      message: 'Memory alert',
    });
    await repo.create({
      serverId: 'srv-1',
      userId: 'user-1',
      type: 'cpu',
      severity: 'critical',
      message: 'CPU alert 2',
    });

    const cpuAlerts = await repo.listByType('user-1', 'cpu', {
      limit: 10,
      offset: 0,
    });

    expect(cpuAlerts.total).toBe(2);
    expect(cpuAlerts.alerts.every((a) => a.type === 'cpu')).toBe(true);
  });
});
