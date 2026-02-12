// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for session manager (backed by InMemorySessionRepository).
 *
 * Validates session CRUD, message management, plan storage,
 * conversation context building, and DB persistence.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SessionManager } from './manager.js';
import { InMemorySessionRepository } from '../../db/repositories/session-repository.js';

const USER_ID = 'user-1';
const SERVER_ID = 'server-1';

let repo: InMemorySessionRepository;
let mgr: SessionManager;

beforeEach(() => {
  repo = new InMemorySessionRepository();
  mgr = new SessionManager(repo);
});

// ============================================================================
// Session CRUD
// ============================================================================

describe('getOrCreate', () => {
  it('should create a new session when no sessionId provided', async () => {
    const session = await mgr.getOrCreate(SERVER_ID, USER_ID);
    expect(session.id).toBeDefined();
    expect(session.serverId).toBe(SERVER_ID);
    expect(session.messages).toEqual([]);
    expect(session.createdAt).toBeDefined();
  });

  it('should create a new session when sessionId does not exist', async () => {
    const session = await mgr.getOrCreate(SERVER_ID, USER_ID, 'nonexistent-id');
    expect(session.id).not.toBe('nonexistent-id');
    expect(session.serverId).toBe(SERVER_ID);
  });

  it('should return existing session when valid sessionId provided', async () => {
    const created = await mgr.getOrCreate(SERVER_ID, USER_ID);
    const retrieved = await mgr.getOrCreate(SERVER_ID, USER_ID, created.id);
    expect(retrieved.id).toBe(created.id);
  });

  it('should not return session from different server', async () => {
    const created = await mgr.getOrCreate(SERVER_ID, USER_ID);
    const other = await mgr.getOrCreate('server-2', USER_ID, created.id);
    expect(other.id).not.toBe(created.id);
  });

  it('should generate unique session IDs', async () => {
    const s1 = await mgr.getOrCreate(SERVER_ID, USER_ID);
    const s2 = await mgr.getOrCreate(SERVER_ID, USER_ID);
    expect(s1.id).not.toBe(s2.id);
  });

  it('should persist session to repository', async () => {
    const session = await mgr.getOrCreate(SERVER_ID, USER_ID);
    const fromDb = await repo.getById(session.id, USER_ID);
    expect(fromDb).not.toBeNull();
    expect(fromDb!.serverId).toBe(SERVER_ID);
  });

  it('should load session from DB when not in cache', async () => {
    const session = await mgr.getOrCreate(SERVER_ID, USER_ID);
    await mgr.addMessage(session.id, USER_ID, 'user', 'Hello');

    // Create a new manager with the same repo (simulates restart)
    const mgr2 = new SessionManager(repo);
    const loaded = await mgr2.getOrCreate(SERVER_ID, USER_ID, session.id);
    expect(loaded.id).toBe(session.id);
    expect(loaded.messages).toHaveLength(1);
    expect(loaded.messages[0].content).toBe('Hello');
  });
});

describe('getSession', () => {
  it('should return undefined for non-existent session', async () => {
    expect(await mgr.getSession('nonexistent', USER_ID)).toBeUndefined();
  });

  it('should return the created session', async () => {
    const created = await mgr.getOrCreate(SERVER_ID, USER_ID);
    const retrieved = await mgr.getSession(created.id, USER_ID);
    expect(retrieved).toBeDefined();
    expect(retrieved!.id).toBe(created.id);
  });

  it('should load from DB if not cached', async () => {
    const session = await mgr.getOrCreate(SERVER_ID, USER_ID);

    // Create new manager with same repo
    const mgr2 = new SessionManager(repo);
    const loaded = await mgr2.getSession(session.id, USER_ID);
    expect(loaded).toBeDefined();
    expect(loaded!.id).toBe(session.id);
  });
});

describe('deleteSession', () => {
  it('should delete an existing session', async () => {
    const session = await mgr.getOrCreate(SERVER_ID, USER_ID);
    expect(await mgr.deleteSession(session.id, SERVER_ID, USER_ID)).toBe(true);
    expect(await mgr.getSession(session.id, USER_ID)).toBeUndefined();
  });

  it('should return false for non-existent session', async () => {
    expect(await mgr.deleteSession('nonexistent', SERVER_ID, USER_ID)).toBe(false);
  });

  it('should return false for wrong serverId', async () => {
    const session = await mgr.getOrCreate(SERVER_ID, USER_ID);
    expect(await mgr.deleteSession(session.id, 'server-2', USER_ID)).toBe(false);
    expect(await mgr.getSession(session.id, USER_ID)).toBeDefined();
  });

  it('should delete from DB as well', async () => {
    const session = await mgr.getOrCreate(SERVER_ID, USER_ID);
    await mgr.deleteSession(session.id, SERVER_ID, USER_ID);
    const fromDb = await repo.getById(session.id, USER_ID);
    expect(fromDb).toBeNull();
  });
});

describe('listSessions', () => {
  it('should return empty array for server with no sessions', async () => {
    expect(await mgr.listSessions(SERVER_ID, USER_ID)).toEqual([]);
  });

  it('should return sessions for the given server', async () => {
    await mgr.getOrCreate(SERVER_ID, USER_ID);
    await mgr.getOrCreate(SERVER_ID, USER_ID);
    await mgr.getOrCreate('server-2', USER_ID);

    const list = await mgr.listSessions(SERVER_ID, USER_ID);
    expect(list).toHaveLength(2);
    expect(list[0].serverId).toBe(SERVER_ID);
    expect(list[1].serverId).toBe(SERVER_ID);
  });

  it('should include messageCount and lastMessage', async () => {
    const session = await mgr.getOrCreate(SERVER_ID, USER_ID);
    await mgr.addMessage(session.id, USER_ID, 'user', 'Hello');
    await mgr.addMessage(session.id, USER_ID, 'assistant', 'Hi there!');

    const list = await mgr.listSessions(SERVER_ID, USER_ID);
    expect(list[0].messageCount).toBe(2);
    expect(list[0].lastMessage).toBe('Hi there!');
  });

  it('should sort by updatedAt descending', async () => {
    const s1 = await mgr.getOrCreate(SERVER_ID, USER_ID);
    await new Promise((r) => setTimeout(r, 10));
    const s2 = await mgr.getOrCreate(SERVER_ID, USER_ID);

    const list = await mgr.listSessions(SERVER_ID, USER_ID);
    expect(list[0].id).toBe(s2.id);
    expect(list[1].id).toBe(s1.id);
  });

  it('should truncate lastMessage to 100 chars', async () => {
    const session = await mgr.getOrCreate(SERVER_ID, USER_ID);
    await mgr.addMessage(session.id, USER_ID, 'user', 'x'.repeat(200));

    const list = await mgr.listSessions(SERVER_ID, USER_ID);
    expect(list[0].lastMessage!.length).toBe(100);
  });
});

// ============================================================================
// Messages
// ============================================================================

describe('addMessage', () => {
  it('should add a message to a session', async () => {
    const session = await mgr.getOrCreate(SERVER_ID, USER_ID);
    const msg = await mgr.addMessage(session.id, USER_ID, 'user', 'Hello');

    expect(msg.id).toBeDefined();
    expect(msg.role).toBe('user');
    expect(msg.content).toBe('Hello');
    expect(msg.timestamp).toBeDefined();
  });

  it('should throw for non-existent session', async () => {
    await expect(
      mgr.addMessage('nonexistent', USER_ID, 'user', 'Hello'),
    ).rejects.toThrow();
  });

  it('should update session updatedAt', async () => {
    const session = await mgr.getOrCreate(SERVER_ID, USER_ID);
    const before = session.updatedAt;
    await new Promise((r) => setTimeout(r, 10));
    await mgr.addMessage(session.id, USER_ID, 'user', 'Hello');
    expect(session.updatedAt).not.toBe(before);
  });

  it('should support all message roles', async () => {
    const session = await mgr.getOrCreate(SERVER_ID, USER_ID);
    const user = await mgr.addMessage(session.id, USER_ID, 'user', 'q');
    const assistant = await mgr.addMessage(session.id, USER_ID, 'assistant', 'a');
    const system = await mgr.addMessage(session.id, USER_ID, 'system', 's');

    expect(user.role).toBe('user');
    expect(assistant.role).toBe('assistant');
    expect(system.role).toBe('system');
    expect(session.messages).toHaveLength(3);
  });

  it('should persist messages to repository', async () => {
    const session = await mgr.getOrCreate(SERVER_ID, USER_ID);
    await mgr.addMessage(session.id, USER_ID, 'user', 'Hello DB');

    // Wait for fire-and-forget promise to settle
    await new Promise((r) => setTimeout(r, 10));

    const fromDb = await repo.getById(session.id, USER_ID);
    expect(fromDb!.messages).toHaveLength(1);
    expect(fromDb!.messages[0].content).toBe('Hello DB');
  });
});

// ============================================================================
// Plans (in-memory only)
// ============================================================================

describe('storePlan / getPlan', () => {
  it('should store and retrieve a plan', async () => {
    const session = await mgr.getOrCreate(SERVER_ID, USER_ID);
    const plan = {
      planId: 'plan-1',
      description: 'Install Redis',
      steps: [{
        id: 'step-1',
        description: 'apt update',
        command: 'apt update',
        riskLevel: 'green',
        timeout: 30000,
        canRollback: false,
      }],
      totalRisk: 'yellow',
      requiresConfirmation: true,
    };

    mgr.storePlan(session.id, plan);
    const retrieved = mgr.getPlan(session.id, 'plan-1');
    expect(retrieved).toEqual(plan);
  });

  it('should return undefined for non-existent plan', async () => {
    const session = await mgr.getOrCreate(SERVER_ID, USER_ID);
    expect(mgr.getPlan(session.id, 'nonexistent')).toBeUndefined();
  });

  it('should return undefined for non-existent session', () => {
    expect(mgr.getPlan('nonexistent', 'plan-1')).toBeUndefined();
  });

  it('should throw when storing plan for non-existent session', () => {
    expect(() => mgr.storePlan('nonexistent', {
      planId: 'p1',
      description: 'test',
      steps: [],
      totalRisk: 'green',
      requiresConfirmation: false,
    })).toThrow();
  });
});

// ============================================================================
// Context Building
// ============================================================================

describe('buildContext', () => {
  it('should return empty string for session with no messages', async () => {
    const session = await mgr.getOrCreate(SERVER_ID, USER_ID);
    expect(mgr.buildContext(session.id)).toBe('');
  });

  it('should return empty string for non-existent session', () => {
    expect(mgr.buildContext('nonexistent')).toBe('');
  });

  it('should format messages as role: content', async () => {
    const session = await mgr.getOrCreate(SERVER_ID, USER_ID);
    await mgr.addMessage(session.id, USER_ID, 'user', 'Install Redis');
    await mgr.addMessage(session.id, USER_ID, 'assistant', 'I will help you install Redis.');

    const context = mgr.buildContext(session.id);
    expect(context).toContain('user: Install Redis');
    expect(context).toContain('assistant: I will help you install Redis.');
  });
});

// ============================================================================
// Persistence across restarts
// ============================================================================

describe('persistence', () => {
  it('should survive manager restart', async () => {
    const session = await mgr.getOrCreate(SERVER_ID, USER_ID);
    await mgr.addMessage(session.id, USER_ID, 'user', 'First message');
    await mgr.addMessage(session.id, USER_ID, 'assistant', 'Reply');

    // Wait for persistence
    await new Promise((r) => setTimeout(r, 10));

    // Simulate restart: new manager, same repo
    const mgr2 = new SessionManager(repo);
    const list = await mgr2.listSessions(SERVER_ID, USER_ID);
    expect(list).toHaveLength(1);
    expect(list[0].messageCount).toBe(2);

    const loaded = await mgr2.getSession(session.id, USER_ID);
    expect(loaded).toBeDefined();
    expect(loaded!.messages).toHaveLength(2);
    expect(loaded!.messages[0].content).toBe('First message');
    expect(loaded!.messages[1].content).toBe('Reply');
  });

  it('should not lose data when plan is in-memory only', async () => {
    const session = await mgr.getOrCreate(SERVER_ID, USER_ID);
    mgr.storePlan(session.id, {
      planId: 'p1',
      description: 'test',
      steps: [],
      totalRisk: 'green',
      requiresConfirmation: false,
    });

    // After restart, plan is gone but session persists
    const mgr2 = new SessionManager(repo);
    const loaded = await mgr2.getSession(session.id, USER_ID);
    expect(loaded).toBeDefined();
    expect(mgr2.getPlan(session.id, 'p1')).toBeUndefined();
  });
});
