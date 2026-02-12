// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for session manager (backed by InMemorySessionRepository).
 *
 * Validates session CRUD, message management, plan storage,
 * conversation context building, and DB persistence.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SessionManager } from './manager.js';
import { InMemorySessionRepository } from '../../db/repositories/session-repository.js';
import { logger } from '../../utils/logger.js';

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
// Context Window Management
// ============================================================================

describe('buildContextWithLimit', () => {
  it('should return empty string for empty session', async () => {
    const session = await mgr.getOrCreate(SERVER_ID, USER_ID);
    expect(mgr.buildContextWithLimit(session.id)).toBe('');
  });

  it('should return empty string for non-existent session', () => {
    expect(mgr.buildContextWithLimit('nonexistent')).toBe('');
  });

  it('should return full context when within token limit', async () => {
    const session = await mgr.getOrCreate(SERVER_ID, USER_ID);
    await mgr.addMessage(session.id, USER_ID, 'user', 'Hello');
    await mgr.addMessage(session.id, USER_ID, 'assistant', 'Hi there');

    const result = mgr.buildContextWithLimit(session.id, 8000);
    expect(result).toContain('user: Hello');
    expect(result).toContain('assistant: Hi there');
    expect(result).not.toContain('[Earlier conversation summarized');
  });

  it('should truncate old messages when exceeding token limit', async () => {
    const session = await mgr.getOrCreate(SERVER_ID, USER_ID);
    // Each message ~250 chars = ~63 tokens. With 10 messages = ~630 tokens
    for (let i = 0; i < 10; i++) {
      const role = i % 2 === 0 ? 'user' : 'assistant';
      await mgr.addMessage(session.id, USER_ID, role as 'user' | 'assistant', `Message ${i}: ${'x'.repeat(200)}`);
    }

    // Set a very low limit (200 tokens = ~800 chars) to force truncation
    const result = mgr.buildContextWithLimit(session.id, 200);
    expect(result).toContain('[Earlier conversation summarized');
    // Should contain the most recent messages
    expect(result).toContain('Message 9');
    // Should not contain the oldest messages
    expect(result).not.toContain('Message 0');
  });

  it('should keep most recent messages when truncating', async () => {
    const session = await mgr.getOrCreate(SERVER_ID, USER_ID);
    for (let i = 0; i < 20; i++) {
      const role = i % 2 === 0 ? 'user' : 'assistant';
      await mgr.addMessage(session.id, USER_ID, role as 'user' | 'assistant', `Msg-${i}: ${'a'.repeat(100)}`);
    }

    // Limit to ~500 tokens (about 4-5 messages)
    const result = mgr.buildContextWithLimit(session.id, 500);
    expect(result).toContain('[Earlier conversation summarized');
    // Most recent should be present
    expect(result).toContain('Msg-19');
    expect(result).toContain('Msg-18');
  });

  it('should use default maxTokens of 8000', async () => {
    const session = await mgr.getOrCreate(SERVER_ID, USER_ID);
    await mgr.addMessage(session.id, USER_ID, 'user', 'Short message');
    // Default should not truncate short conversations
    const result = mgr.buildContextWithLimit(session.id);
    expect(result).toContain('user: Short message');
    expect(result).not.toContain('[Earlier conversation summarized');
  });
});

describe('buildHistoryWithLimit', () => {
  it('should return empty array for empty session', async () => {
    const session = await mgr.getOrCreate(SERVER_ID, USER_ID);
    expect(mgr.buildHistoryWithLimit(session.id)).toEqual([]);
  });

  it('should return empty array for non-existent session', () => {
    expect(mgr.buildHistoryWithLimit('nonexistent')).toEqual([]);
  });

  it('should exclude the last message (current user message)', async () => {
    const session = await mgr.getOrCreate(SERVER_ID, USER_ID);
    await mgr.addMessage(session.id, USER_ID, 'user', 'First');
    await mgr.addMessage(session.id, USER_ID, 'assistant', 'Reply');
    await mgr.addMessage(session.id, USER_ID, 'user', 'Current question');

    const result = mgr.buildHistoryWithLimit(session.id);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ role: 'user', content: 'First' });
    expect(result[1]).toEqual({ role: 'assistant', content: 'Reply' });
  });

  it('should exclude system messages', async () => {
    const session = await mgr.getOrCreate(SERVER_ID, USER_ID);
    await mgr.addMessage(session.id, USER_ID, 'user', 'Question');
    await mgr.addMessage(session.id, USER_ID, 'system', 'System note');
    await mgr.addMessage(session.id, USER_ID, 'assistant', 'Answer');
    await mgr.addMessage(session.id, USER_ID, 'user', 'Follow up');

    const result = mgr.buildHistoryWithLimit(session.id);
    expect(result).toHaveLength(2);
    expect(result.every((m) => m.role !== 'system')).toBe(true);
  });

  it('should return all history when within token limit', async () => {
    const session = await mgr.getOrCreate(SERVER_ID, USER_ID);
    await mgr.addMessage(session.id, USER_ID, 'user', 'Q1');
    await mgr.addMessage(session.id, USER_ID, 'assistant', 'A1');
    await mgr.addMessage(session.id, USER_ID, 'user', 'Q2');
    await mgr.addMessage(session.id, USER_ID, 'assistant', 'A2');
    await mgr.addMessage(session.id, USER_ID, 'user', 'Q3');

    const result = mgr.buildHistoryWithLimit(session.id, 40000);
    expect(result).toHaveLength(4); // Q1, A1, Q2, A2 (Q3 excluded as latest)
  });

  it('should trim old messages when exceeding token limit', async () => {
    const session = await mgr.getOrCreate(SERVER_ID, USER_ID);
    // Create a long conversation
    for (let i = 0; i < 20; i++) {
      const role = i % 2 === 0 ? 'user' : 'assistant';
      await mgr.addMessage(session.id, USER_ID, role as 'user' | 'assistant', `Msg-${i}: ${'x'.repeat(200)}`);
    }
    // Add one more user message (this is the "current" one, will be excluded)
    await mgr.addMessage(session.id, USER_ID, 'user', 'Current');

    // Very small budget forces truncation
    const result = mgr.buildHistoryWithLimit(session.id, 200);
    // Should have fewer messages than original
    expect(result.length).toBeLessThan(20);
    expect(result.length).toBeGreaterThan(0);
    // Most recent messages should be kept
    const lastMsg = result[result.length - 1];
    expect(lastMsg.content).toContain('Msg-19');
  });

  it('should return empty array when only one message exists', async () => {
    const session = await mgr.getOrCreate(SERVER_ID, USER_ID);
    await mgr.addMessage(session.id, USER_ID, 'user', 'Only message');

    const result = mgr.buildHistoryWithLimit(session.id);
    expect(result).toEqual([]);
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

// ============================================================================
// Persistence error handling (retry + logging)
// ============================================================================

describe('addMessage persistence error handling', () => {
  it('should log warning and retry when DB write fails once then succeeds', async () => {
    const session = await mgr.getOrCreate(SERVER_ID, USER_ID);
    const warnSpy = vi.spyOn(logger, 'warn');
    const infoSpy = vi.spyOn(logger, 'info');
    const errorSpy = vi.spyOn(logger, 'error');

    let callCount = 0;
    vi.spyOn(repo, 'addMessage').mockImplementation(async () => {
      callCount++;
      if (callCount === 1) throw new Error('SQLITE_BUSY');
      return true;
    });

    await mgr.addMessage(session.id, USER_ID, 'user', 'Hello');

    // Wait for the async persist (first call + 500ms delay + retry)
    await new Promise((r) => setTimeout(r, 700));

    expect(callCount).toBe(2);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: session.id }),
      expect.stringContaining('retrying'),
    );
    expect(infoSpy).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: session.id }),
      expect.stringContaining('retry succeeded'),
    );
    expect(errorSpy).not.toHaveBeenCalled();

    warnSpy.mockRestore();
    infoSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('should log error when DB write fails on both attempts', async () => {
    const session = await mgr.getOrCreate(SERVER_ID, USER_ID);
    const warnSpy = vi.spyOn(logger, 'warn');
    const errorSpy = vi.spyOn(logger, 'error');

    vi.spyOn(repo, 'addMessage').mockRejectedValue(new Error('disk full'));

    await mgr.addMessage(session.id, USER_ID, 'user', 'Hello');

    // Wait for the async persist (first call + 500ms delay + retry)
    await new Promise((r) => setTimeout(r, 700));

    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: session.id }),
      expect.stringContaining('retrying'),
    );
    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: session.id }),
      expect.stringContaining('failed after retry'),
    );

    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('should still return message even when persistence fails', async () => {
    const session = await mgr.getOrCreate(SERVER_ID, USER_ID);
    vi.spyOn(repo, 'addMessage').mockRejectedValue(new Error('DB error'));

    const msg = await mgr.addMessage(session.id, USER_ID, 'user', 'Hello');

    // Message returned immediately (not blocked by persistence)
    expect(msg.content).toBe('Hello');
    expect(msg.role).toBe('user');
    expect(msg.id).toBeDefined();

    // Message is in the in-memory cache
    expect(session.messages).toHaveLength(1);
    expect(session.messages[0].content).toBe('Hello');

    // Wait for async persist to complete
    await new Promise((r) => setTimeout(r, 700));
  });

  it('should not log anything when persistence succeeds on first try', async () => {
    const session = await mgr.getOrCreate(SERVER_ID, USER_ID);
    const warnSpy = vi.spyOn(logger, 'warn');
    const errorSpy = vi.spyOn(logger, 'error');

    // repo.addMessage works normally (InMemorySessionRepository)
    await mgr.addMessage(session.id, USER_ID, 'user', 'Hello');

    // Wait for async persist
    await new Promise((r) => setTimeout(r, 50));

    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();

    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('should not block SSE response while retrying', async () => {
    const session = await mgr.getOrCreate(SERVER_ID, USER_ID);

    let callCount = 0;
    vi.spyOn(repo, 'addMessage').mockImplementation(async () => {
      callCount++;
      if (callCount === 1) throw new Error('SQLITE_BUSY');
      return true;
    });

    const start = Date.now();
    const msg = await mgr.addMessage(session.id, USER_ID, 'user', 'Hello');
    const elapsed = Date.now() - start;

    // addMessage should return immediately (< 50ms), not wait 500ms for retry
    expect(elapsed).toBeLessThan(50);
    expect(msg.content).toBe('Hello');

    // Retry is still pending at this point
    expect(callCount).toBe(1);

    // Wait for retry to complete
    await new Promise((r) => setTimeout(r, 700));
    expect(callCount).toBe(2);
  });
});
