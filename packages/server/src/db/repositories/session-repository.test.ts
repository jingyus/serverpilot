/**
 * Tests for SessionRepository (Drizzle implementation).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { initDatabase, closeDatabase } from '../connection.js';
import { createTables } from '../connection.js';
import { DrizzleSessionRepository } from './session-repository.js';

import type { DrizzleDB } from '../connection.js';
import type { SessionMessage, SessionContext } from '../schema.js';

let db: DrizzleDB;
let repo: DrizzleSessionRepository;

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

describe('DrizzleSessionRepository', () => {
  beforeEach(() => {
    db = initDatabase(':memory:');
    createTables();
    repo = new DrizzleSessionRepository(db);

    seedUser('user-1', 'test@example.com');
    seedUser('user-2', 'other@example.com');
    seedServer('srv-1', 'user-1');
    seedServer('srv-2', 'user-2');
  });

  afterEach(() => {
    closeDatabase();
  });

  it('should create a session', async () => {
    const session = await repo.create({
      userId: 'user-1',
      serverId: 'srv-1',
    });

    expect(session.id).toBeTruthy();
    expect(session.userId).toBe('user-1');
    expect(session.serverId).toBe('srv-1');
    expect(session.messages).toEqual([]);
    expect(session.context).toBeNull();
  });

  it('should create session with context', async () => {
    const context: SessionContext = {
      serverId: 'srv-1',
      profileSnapshot: '{}',
      tokenCount: 0,
      summarized: false,
    };

    const session = await repo.create({
      userId: 'user-1',
      serverId: 'srv-1',
      context,
    });

    expect(session.context).toEqual(context);
  });

  it('should throw when creating session for non-owned server', async () => {
    await expect(
      repo.create({ userId: 'user-1', serverId: 'srv-2' }),
    ).rejects.toThrow('Server not found or access denied');
  });

  it('should get session by ID', async () => {
    const created = await repo.create({
      userId: 'user-1',
      serverId: 'srv-1',
    });

    const found = await repo.getById(created.id, 'user-1');
    expect(found).not.toBeNull();
    expect(found!.id).toBe(created.id);
  });

  it('should deny session access to wrong user', async () => {
    const created = await repo.create({
      userId: 'user-1',
      serverId: 'srv-1',
    });

    const found = await repo.getById(created.id, 'user-2');
    expect(found).toBeNull();
  });

  it('should list sessions by server', async () => {
    await repo.create({ userId: 'user-1', serverId: 'srv-1' });
    await repo.create({ userId: 'user-1', serverId: 'srv-1' });

    const result = await repo.listByServer('srv-1', 'user-1', {
      limit: 10,
      offset: 0,
    });

    expect(result.total).toBe(2);
    expect(result.sessions).toHaveLength(2);
  });

  it('should paginate sessions', async () => {
    for (let i = 0; i < 5; i++) {
      await repo.create({ userId: 'user-1', serverId: 'srv-1' });
    }

    const page1 = await repo.listByServer('srv-1', 'user-1', {
      limit: 2,
      offset: 0,
    });
    expect(page1.total).toBe(5);
    expect(page1.sessions).toHaveLength(2);
  });

  it('should add a message', async () => {
    const session = await repo.create({
      userId: 'user-1',
      serverId: 'srv-1',
    });

    const message: SessionMessage = {
      id: 'msg-1',
      role: 'user',
      content: 'Install nginx please',
      timestamp: Date.now(),
    };

    const result = await repo.addMessage(session.id, 'user-1', message);
    expect(result).toBe(true);

    const updated = await repo.getById(session.id, 'user-1');
    expect(updated!.messages).toHaveLength(1);
    expect(updated!.messages[0].content).toBe('Install nginx please');
  });

  it('should add multiple messages', async () => {
    const session = await repo.create({
      userId: 'user-1',
      serverId: 'srv-1',
    });

    await repo.addMessage(session.id, 'user-1', {
      id: 'msg-1',
      role: 'user',
      content: 'Hello',
      timestamp: Date.now(),
    });

    await repo.addMessage(session.id, 'user-1', {
      id: 'msg-2',
      role: 'assistant',
      content: 'Hi, how can I help?',
      timestamp: Date.now(),
    });

    const updated = await repo.getById(session.id, 'user-1');
    expect(updated!.messages).toHaveLength(2);
  });

  it('should NOT add message for wrong user', async () => {
    const session = await repo.create({
      userId: 'user-1',
      serverId: 'srv-1',
    });

    const result = await repo.addMessage(session.id, 'user-2', {
      id: 'msg-1',
      role: 'user',
      content: 'Hacked',
      timestamp: Date.now(),
    });
    expect(result).toBe(false);
  });

  it('should update context', async () => {
    const session = await repo.create({
      userId: 'user-1',
      serverId: 'srv-1',
    });

    const context: SessionContext = {
      serverId: 'srv-1',
      profileSnapshot: '{"os":"linux"}',
      tokenCount: 500,
      summarized: false,
    };

    const result = await repo.updateContext(session.id, 'user-1', context);
    expect(result).toBe(true);

    const updated = await repo.getById(session.id, 'user-1');
    expect(updated!.context).toEqual(context);
  });

  it('should delete a session', async () => {
    const session = await repo.create({
      userId: 'user-1',
      serverId: 'srv-1',
    });

    const deleted = await repo.delete(session.id, 'user-1');
    expect(deleted).toBe(true);

    const found = await repo.getById(session.id, 'user-1');
    expect(found).toBeNull();
  });

  it('should NOT delete session for wrong user', async () => {
    const session = await repo.create({
      userId: 'user-1',
      serverId: 'srv-1',
    });

    const deleted = await repo.delete(session.id, 'user-2');
    expect(deleted).toBe(false);
  });
});
