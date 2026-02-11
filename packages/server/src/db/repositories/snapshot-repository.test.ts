// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for SnapshotRepository (Drizzle implementation).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { initDatabase, closeDatabase } from '../connection.js';
import { createTables } from '../connection.js';
import { DrizzleSnapshotRepository } from './snapshot-repository.js';

import type { DrizzleDB } from '../connection.js';

let db: DrizzleDB;
let repo: DrizzleSnapshotRepository;

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

describe('DrizzleSnapshotRepository', () => {
  beforeEach(() => {
    db = initDatabase(':memory:');
    createTables();
    repo = new DrizzleSnapshotRepository(db);

    seedUser('user-1', 'test@example.com');
    seedUser('user-2', 'other@example.com');
    seedServer('srv-1', 'user-1');
    seedServer('srv-2', 'user-2');
  });

  afterEach(() => {
    closeDatabase();
  });

  it('should create a snapshot', async () => {
    const snap = await repo.create({
      serverId: 'srv-1',
      userId: 'user-1',
      operationId: 'op-1',
      files: [
        { path: '/etc/nginx/nginx.conf', content: 'worker...', mode: 0o644, owner: 'root' },
      ],
      configs: [
        { type: 'nginx', path: '/etc/nginx/nginx.conf', content: 'worker...' },
      ],
    });

    expect(snap.id).toBeTruthy();
    expect(snap.files).toHaveLength(1);
    expect(snap.configs).toHaveLength(1);
    expect(snap.operationId).toBe('op-1');
  });

  it('should create snapshot with expiration', async () => {
    const expiresAt = new Date(Date.now() + 86400000); // 24h from now
    const snap = await repo.create({
      serverId: 'srv-1',
      userId: 'user-1',
      files: [],
      configs: [],
      expiresAt,
    });

    expect(snap.expiresAt).toBeTruthy();
  });

  it('should throw when creating snapshot for non-owned server', async () => {
    await expect(
      repo.create({
        serverId: 'srv-2',
        userId: 'user-1',
        files: [],
        configs: [],
      }),
    ).rejects.toThrow('Server not found or access denied');
  });

  it('should get snapshot by ID', async () => {
    const created = await repo.create({
      serverId: 'srv-1',
      userId: 'user-1',
      files: [{ path: '/a', content: 'b', mode: 0o644, owner: 'root' }],
      configs: [],
    });

    const found = await repo.getById(created.id, 'user-1');
    expect(found).not.toBeNull();
    expect(found!.files).toHaveLength(1);
  });

  it('should deny snapshot access to wrong user', async () => {
    const created = await repo.create({
      serverId: 'srv-1',
      userId: 'user-1',
      files: [],
      configs: [],
    });

    const found = await repo.getById(created.id, 'user-2');
    expect(found).toBeNull();
  });

  it('should list snapshots by server', async () => {
    await repo.create({
      serverId: 'srv-1',
      userId: 'user-1',
      files: [],
      configs: [],
    });
    await repo.create({
      serverId: 'srv-1',
      userId: 'user-1',
      files: [],
      configs: [],
    });

    const result = await repo.listByServer('srv-1', 'user-1', {
      limit: 10,
      offset: 0,
    });

    expect(result.total).toBe(2);
    expect(result.snapshots).toHaveLength(2);
  });

  it('should list snapshots by operation', async () => {
    await repo.create({
      serverId: 'srv-1',
      userId: 'user-1',
      operationId: 'op-42',
      files: [],
      configs: [],
    });

    const result = await repo.listByOperation('op-42', 'user-1');
    expect(result).toHaveLength(1);
    expect(result[0].operationId).toBe('op-42');
  });

  it('should delete a snapshot', async () => {
    const created = await repo.create({
      serverId: 'srv-1',
      userId: 'user-1',
      files: [],
      configs: [],
    });

    const deleted = await repo.delete(created.id, 'user-1');
    expect(deleted).toBe(true);

    const found = await repo.getById(created.id, 'user-1');
    expect(found).toBeNull();
  });

  it('should NOT delete snapshot for wrong user', async () => {
    const created = await repo.create({
      serverId: 'srv-1',
      userId: 'user-1',
      files: [],
      configs: [],
    });

    const deleted = await repo.delete(created.id, 'user-2');
    expect(deleted).toBe(false);
  });

  it('should get expired snapshots', async () => {
    const pastDate = new Date(Date.now() - 1000);
    await repo.create({
      serverId: 'srv-1',
      userId: 'user-1',
      files: [],
      configs: [],
      expiresAt: pastDate,
    });

    const expired = await repo.getExpired();
    expect(expired).toHaveLength(1);
  });

  it('should delete expired snapshots', async () => {
    const pastDate = new Date(Date.now() - 1000);
    await repo.create({
      serverId: 'srv-1',
      userId: 'user-1',
      files: [],
      configs: [],
      expiresAt: pastDate,
    });
    // Non-expired
    await repo.create({
      serverId: 'srv-1',
      userId: 'user-1',
      files: [],
      configs: [],
      expiresAt: new Date(Date.now() + 86400000),
    });

    const count = await repo.deleteExpired();
    expect(count).toBe(1);

    // Verify non-expired still exists
    const remaining = await repo.listByServer('srv-1', 'user-1', {
      limit: 10,
      offset: 0,
    });
    expect(remaining.total).toBe(1);
  });
});
