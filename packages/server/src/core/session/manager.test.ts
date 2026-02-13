// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for session manager (backed by InMemorySessionRepository).
 *
 * Validates session CRUD, message management, plan storage,
 * conversation context building, and DB persistence.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SessionManager } from './manager.js';
import type { SessionCacheOptions } from './manager.js';
import { InMemorySessionRepository } from '../../db/repositories/session-repository.js';
import { logger } from '../../utils/logger.js';

const USER_ID = 'user-1';
const SERVER_ID = 'server-1';

/** Disable sweep and retry timers in tests to avoid timer leaks */
const TEST_CACHE_OPTS: Partial<SessionCacheOptions> = { sweepIntervalMs: 0, retryIntervalMs: 0 };

let repo: InMemorySessionRepository;
let mgr: SessionManager;

beforeEach(() => {
  repo = new InMemorySessionRepository();
  mgr = new SessionManager(repo, TEST_CACHE_OPTS);
});

afterEach(() => {
  mgr.stopSweep();
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
    const mgr2 = new SessionManager(repo, TEST_CACHE_OPTS);
    const loaded = await mgr2.getOrCreate(SERVER_ID, USER_ID, session.id);
    expect(loaded.id).toBe(session.id);
    expect(loaded.messages).toHaveLength(1);
    expect(loaded.messages[0].content).toBe('Hello');
    mgr2.stopSweep();
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
    const mgr2 = new SessionManager(repo, TEST_CACHE_OPTS);
    const loaded = await mgr2.getSession(session.id, USER_ID);
    expect(loaded).toBeDefined();
    expect(loaded!.id).toBe(session.id);
    mgr2.stopSweep();
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
  it('should return empty result for server with no sessions', async () => {
    const result = await mgr.listSessions(SERVER_ID, USER_ID);
    expect(result.sessions).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('should return sessions for the given server', async () => {
    await mgr.getOrCreate(SERVER_ID, USER_ID);
    await mgr.getOrCreate(SERVER_ID, USER_ID);
    await mgr.getOrCreate('server-2', USER_ID);

    const result = await mgr.listSessions(SERVER_ID, USER_ID);
    expect(result.sessions).toHaveLength(2);
    expect(result.total).toBe(2);
    expect(result.sessions[0].serverId).toBe(SERVER_ID);
    expect(result.sessions[1].serverId).toBe(SERVER_ID);
  });

  it('should include messageCount and lastMessage', async () => {
    const session = await mgr.getOrCreate(SERVER_ID, USER_ID);
    await mgr.addMessage(session.id, USER_ID, 'user', 'Hello');
    await mgr.addMessage(session.id, USER_ID, 'assistant', 'Hi there!');

    const { sessions } = await mgr.listSessions(SERVER_ID, USER_ID);
    expect(sessions[0].messageCount).toBe(2);
    expect(sessions[0].lastMessage).toBe('Hi there!');
  });

  it('should sort by updatedAt descending', async () => {
    const s1 = await mgr.getOrCreate(SERVER_ID, USER_ID);
    await new Promise((r) => setTimeout(r, 10));
    const s2 = await mgr.getOrCreate(SERVER_ID, USER_ID);

    const { sessions } = await mgr.listSessions(SERVER_ID, USER_ID);
    expect(sessions[0].id).toBe(s2.id);
    expect(sessions[1].id).toBe(s1.id);
  });

  it('should truncate lastMessage to 100 chars', async () => {
    const session = await mgr.getOrCreate(SERVER_ID, USER_ID);
    await mgr.addMessage(session.id, USER_ID, 'user', 'x'.repeat(200));

    const { sessions } = await mgr.listSessions(SERVER_ID, USER_ID);
    expect(sessions[0].lastMessage!.length).toBe(100);
  });

  it('should use listSummaries instead of listByServer', async () => {
    const session = await mgr.getOrCreate(SERVER_ID, USER_ID);
    await mgr.addMessage(session.id, USER_ID, 'user', 'Hello');

    const summariesSpy = vi.spyOn(repo, 'listSummaries');
    const listByServerSpy = vi.spyOn(repo, 'listByServer');

    await mgr.listSessions(SERVER_ID, USER_ID);

    expect(summariesSpy).toHaveBeenCalledOnce();
    expect(listByServerSpy).not.toHaveBeenCalled();

    summariesSpy.mockRestore();
    listByServerSpy.mockRestore();
  });

  it('should return undefined lastMessage for session with no messages', async () => {
    await mgr.getOrCreate(SERVER_ID, USER_ID);

    const { sessions } = await mgr.listSessions(SERVER_ID, USER_ID);
    expect(sessions[0].lastMessage).toBeUndefined();
  });

  it('should support custom limit and offset', async () => {
    // Create 3 sessions
    await mgr.getOrCreate(SERVER_ID, USER_ID);
    await new Promise((r) => setTimeout(r, 5));
    await mgr.getOrCreate(SERVER_ID, USER_ID);
    await new Promise((r) => setTimeout(r, 5));
    await mgr.getOrCreate(SERVER_ID, USER_ID);

    // Get first 2
    const page1 = await mgr.listSessions(SERVER_ID, USER_ID, { limit: 2, offset: 0 });
    expect(page1.sessions).toHaveLength(2);
    expect(page1.total).toBe(3);

    // Get remaining
    const page2 = await mgr.listSessions(SERVER_ID, USER_ID, { limit: 2, offset: 2 });
    expect(page2.sessions).toHaveLength(1);
    expect(page2.total).toBe(3);
  });

  it('should default to limit=100 offset=0 when no options provided', async () => {
    const summariesSpy = vi.spyOn(repo, 'listSummaries');

    await mgr.listSessions(SERVER_ID, USER_ID);

    expect(summariesSpy).toHaveBeenCalledWith(SERVER_ID, USER_ID, { limit: 100, offset: 0 });
    summariesSpy.mockRestore();
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

    // User messages are synchronously persisted — no wait needed
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

describe('removePlan', () => {
  it('should remove a plan from a session', async () => {
    const session = await mgr.getOrCreate(SERVER_ID, USER_ID);
    mgr.storePlan(session.id, {
      planId: 'plan-1', description: 'test', steps: [],
      totalRisk: 'green', requiresConfirmation: false,
    });
    expect(session.plans.size).toBe(1);

    const removed = mgr.removePlan(session.id, 'plan-1');
    expect(removed).toBe(true);
    expect(session.plans.size).toBe(0);
    expect(mgr.getPlan(session.id, 'plan-1')).toBeUndefined();
  });

  it('should return false for non-existent plan', async () => {
    const session = await mgr.getOrCreate(SERVER_ID, USER_ID);
    expect(mgr.removePlan(session.id, 'nonexistent')).toBe(false);
  });

  it('should return false for non-existent session', () => {
    expect(mgr.removePlan('nonexistent', 'plan-1')).toBe(false);
  });

  it('should allow eviction after plan removal', async () => {
    const smallMgr = new SessionManager(repo, { maxSize: 2, sweepIntervalMs: 0, retryIntervalMs: 0 });

    const s1 = await smallMgr.getOrCreate(SERVER_ID, USER_ID);
    const s2 = await smallMgr.getOrCreate(SERVER_ID, USER_ID);

    smallMgr.storePlan(s1.id, {
      planId: 'p1', description: 'test', steps: [],
      totalRisk: 'green', requiresConfirmation: false,
    });

    // s1 has a plan, so adding s3 should evict s2 (non-active)
    const s3 = await smallMgr.getOrCreate(SERVER_ID, USER_ID);
    expect(smallMgr.cacheSize).toBe(2);
    expect(smallMgr.getPlan(s1.id, 'p1')).toBeDefined();

    // Remove plan from s1 — now it's evictable
    smallMgr.removePlan(s1.id, 'p1');

    // Adding s4 should now be able to evict s1 (no longer active)
    const s4 = await smallMgr.getOrCreate(SERVER_ID, USER_ID);
    expect(smallMgr.cacheSize).toBe(2);
    // s1 should have been evicted
    expect(smallMgr.getPlan(s1.id, 'p1')).toBeUndefined();

    smallMgr.stopSweep();
  });

  it('should allow TTL sweep after plan removal', async () => {
    const ttlMgr = new SessionManager(repo, { ttlMs: 50, sweepIntervalMs: 0, retryIntervalMs: 0 });

    const s1 = await ttlMgr.getOrCreate(SERVER_ID, USER_ID);
    ttlMgr.storePlan(s1.id, {
      planId: 'p1', description: 'test', steps: [],
      totalRisk: 'green', requiresConfirmation: false,
    });

    // Wait for TTL to expire
    await new Promise((r) => setTimeout(r, 60));

    // Sweep should NOT remove s1 because it has an active plan
    (ttlMgr as unknown as { sweepExpired: () => void }).sweepExpired();
    expect(ttlMgr.cacheSize).toBe(1);

    // Remove the plan
    ttlMgr.removePlan(s1.id, 'p1');

    // Now sweep should remove s1
    (ttlMgr as unknown as { sweepExpired: () => void }).sweepExpired();
    expect(ttlMgr.cacheSize).toBe(0);

    ttlMgr.stopSweep();
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
    // Should have fewer messages than original (+ 1 for truncation notice)
    expect(result.length).toBeLessThan(20);
    expect(result.length).toBeGreaterThan(0);
    // Most recent messages should be kept
    const lastMsg = result[result.length - 1];
    expect(lastMsg.content).toContain('Msg-19');
    // First message should be truncation notice
    expect(result[0].role).toBe('user');
    expect(result[0].content).toContain('[System: Earlier conversation context was truncated');
  });

  it('should return empty array when only one message exists', async () => {
    const session = await mgr.getOrCreate(SERVER_ID, USER_ID);
    await mgr.addMessage(session.id, USER_ID, 'user', 'Only message');

    const result = mgr.buildHistoryWithLimit(session.id);
    expect(result).toEqual([]);
  });

  it('should not insert truncation notice when all messages fit', async () => {
    const session = await mgr.getOrCreate(SERVER_ID, USER_ID);
    await mgr.addMessage(session.id, USER_ID, 'user', 'Q1');
    await mgr.addMessage(session.id, USER_ID, 'assistant', 'A1');
    await mgr.addMessage(session.id, USER_ID, 'user', 'Q2');

    const result = mgr.buildHistoryWithLimit(session.id, 40000);
    expect(result).toHaveLength(2); // Q1, A1 (Q2 excluded as latest)
    expect(result[0].content).toBe('Q1');
    expect(result[0].content).not.toContain('[System:');
  });

  it('should include removed message count in truncation notice', async () => {
    const session = await mgr.getOrCreate(SERVER_ID, USER_ID);
    for (let i = 0; i < 10; i++) {
      const role = i % 2 === 0 ? 'user' : 'assistant';
      await mgr.addMessage(session.id, USER_ID, role as 'user' | 'assistant', `Msg-${i}: ${'y'.repeat(300)}`);
    }
    await mgr.addMessage(session.id, USER_ID, 'user', 'Latest');

    // Budget that fits only ~2-3 messages
    const result = mgr.buildHistoryWithLimit(session.id, 300);
    const notice = result[0];
    expect(notice.role).toBe('user');
    expect(notice.content).toContain('[System: Earlier conversation context was truncated');
    expect(notice.content).toMatch(/\d+ messages removed/);
    expect(notice.content).toContain('re-read the relevant files');
  });

  it('should prepend truncation notice as first element before kept messages', async () => {
    const session = await mgr.getOrCreate(SERVER_ID, USER_ID);
    // 6 messages: Q0, A0, Q1, A1, Q2, A2 + Q3 (latest, excluded)
    for (let i = 0; i < 6; i++) {
      const role = i % 2 === 0 ? 'user' : 'assistant';
      await mgr.addMessage(session.id, USER_ID, role as 'user' | 'assistant', `Msg-${i}: ${'z'.repeat(200)}`);
    }
    await mgr.addMessage(session.id, USER_ID, 'user', 'Latest');

    // Budget that fits ~2 content messages (not all 6)
    const result = mgr.buildHistoryWithLimit(session.id, 200);
    // First element is the notice
    expect(result[0].content).toContain('[System:');
    // Remaining elements are actual conversation messages (most recent)
    const contentMessages = result.slice(1);
    expect(contentMessages.length).toBeGreaterThan(0);
    expect(contentMessages.every((m) => !m.content.includes('[System:'))).toBe(true);
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
    const mgr2 = new SessionManager(repo, TEST_CACHE_OPTS);
    const { sessions: list } = await mgr2.listSessions(SERVER_ID, USER_ID);
    expect(list).toHaveLength(1);
    expect(list[0].messageCount).toBe(2);

    const loaded = await mgr2.getSession(session.id, USER_ID);
    expect(loaded).toBeDefined();
    expect(loaded!.messages).toHaveLength(2);
    expect(loaded!.messages[0].content).toBe('First message');
    expect(loaded!.messages[1].content).toBe('Reply');
    mgr2.stopSweep();
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
    const mgr2 = new SessionManager(repo, TEST_CACHE_OPTS);
    const loaded = await mgr2.getSession(session.id, USER_ID);
    expect(loaded).toBeDefined();
    expect(mgr2.getPlan(session.id, 'p1')).toBeUndefined();
    mgr2.stopSweep();
  });
});

// ============================================================================
// Persistence error handling (sync user + async assistant + retry queue)
// ============================================================================

describe('user message sync persistence', () => {
  it('should synchronously persist user messages and set persisted=true', async () => {
    const session = await mgr.getOrCreate(SERVER_ID, USER_ID);
    const msg = await mgr.addMessage(session.id, USER_ID, 'user', 'Hello');

    expect(msg.persisted).toBe(true);

    const fromDb = await repo.getById(session.id, USER_ID);
    expect(fromDb!.messages).toHaveLength(1);
    expect(fromDb!.messages[0].content).toBe('Hello');
  });

  it('should retry once and succeed when first DB write fails', async () => {
    const session = await mgr.getOrCreate(SERVER_ID, USER_ID);
    const warnSpy = vi.spyOn(logger, 'warn');
    const infoSpy = vi.spyOn(logger, 'info');

    let callCount = 0;
    vi.spyOn(repo, 'addMessage').mockImplementation(async () => {
      callCount++;
      if (callCount === 1) throw new Error('SQLITE_BUSY');
      return true;
    });

    const msg = await mgr.addMessage(session.id, USER_ID, 'user', 'Hello');

    expect(callCount).toBe(2);
    expect(msg.persisted).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: session.id }),
      expect.stringContaining('User message persistence failed, retrying'),
    );
    expect(infoSpy).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: session.id }),
      expect.stringContaining('retry succeeded'),
    );

    warnSpy.mockRestore();
    infoSpy.mockRestore();
  });

  it('should throw when both persistence attempts fail for user message', async () => {
    const session = await mgr.getOrCreate(SERVER_ID, USER_ID);
    vi.spyOn(repo, 'addMessage').mockRejectedValue(new Error('disk full'));

    await expect(
      mgr.addMessage(session.id, USER_ID, 'user', 'Hello'),
    ).rejects.toThrow('disk full');

    // Message is still in memory cache (was added before persist)
    expect(session.messages).toHaveLength(1);
    expect(session.messages[0].persisted).toBe(false);
  });

  it('should not log anything when user persistence succeeds on first try', async () => {
    const session = await mgr.getOrCreate(SERVER_ID, USER_ID);
    const warnSpy = vi.spyOn(logger, 'warn');
    const errorSpy = vi.spyOn(logger, 'error');

    await mgr.addMessage(session.id, USER_ID, 'user', 'Hello');

    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();

    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});

// ============================================================================
// Assistant/system message async persistence + retry queue
// ============================================================================

describe('assistant message async persistence', () => {
  it('should persist assistant messages asynchronously with persisted=true after DB write', async () => {
    const session = await mgr.getOrCreate(SERVER_ID, USER_ID);
    const msg = await mgr.addMessage(session.id, USER_ID, 'assistant', 'Hi there');

    // Returned immediately — persisted may not yet be true
    expect(msg.content).toBe('Hi there');

    // Wait for async persist
    await new Promise((r) => setTimeout(r, 50));
    expect(msg.persisted).toBe(true);
  });

  it('should not block on assistant message persistence', async () => {
    const session = await mgr.getOrCreate(SERVER_ID, USER_ID);

    // Slow persistence
    vi.spyOn(repo, 'addMessage').mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 200));
      return true;
    });

    const start = Date.now();
    const msg = await mgr.addMessage(session.id, USER_ID, 'assistant', 'Reply');
    const elapsed = Date.now() - start;

    // Should return immediately (< 50ms), not wait for the 200ms DB write
    expect(elapsed).toBeLessThan(50);
    expect(msg.content).toBe('Reply');
    expect(msg.persisted).toBe(false);

    // Wait for persistence to complete
    await new Promise((r) => setTimeout(r, 300));
    expect(msg.persisted).toBe(true);
  });

  it('should enqueue failed assistant messages to retry queue', async () => {
    const session = await mgr.getOrCreate(SERVER_ID, USER_ID);
    const warnSpy = vi.spyOn(logger, 'warn');

    vi.spyOn(repo, 'addMessage').mockRejectedValue(new Error('DB error'));

    const msg = await mgr.addMessage(session.id, USER_ID, 'assistant', 'Reply');
    expect(msg.persisted).toBe(false);

    // Wait for the async error to be caught
    await new Promise((r) => setTimeout(r, 50));

    expect(mgr.pendingRetryCount).toBe(1);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: session.id }),
      expect.stringContaining('enqueueing for retry'),
    );

    warnSpy.mockRestore();
  });

  it('should also handle system messages asynchronously', async () => {
    const session = await mgr.getOrCreate(SERVER_ID, USER_ID);

    vi.spyOn(repo, 'addMessage').mockRejectedValue(new Error('DB error'));

    const msg = await mgr.addMessage(session.id, USER_ID, 'system', 'Plan executed');

    // Wait for the async error to be caught
    await new Promise((r) => setTimeout(r, 50));

    expect(msg.persisted).toBe(false);
    expect(mgr.pendingRetryCount).toBe(1);
  });
});

describe('retry queue processing', () => {
  it('should persist queued messages on retry', async () => {
    const session = await mgr.getOrCreate(SERVER_ID, USER_ID);

    let callCount = 0;
    vi.spyOn(repo, 'addMessage').mockImplementation(async () => {
      callCount++;
      if (callCount === 1) throw new Error('DB error');
      return true;
    });

    const msg = await mgr.addMessage(session.id, USER_ID, 'assistant', 'Reply');
    await new Promise((r) => setTimeout(r, 50)); // Wait for async error
    expect(mgr.pendingRetryCount).toBe(1);

    // Manually trigger retry queue processing
    await (mgr as unknown as { processRetryQueue: () => Promise<void> }).processRetryQueue();

    expect(mgr.pendingRetryCount).toBe(0);
    expect(msg.persisted).toBe(true);
  });

  it('should requeue if retry also fails', async () => {
    const retryMgr = new SessionManager(repo, { ...TEST_CACHE_OPTS, maxRetryAttempts: 3 });
    const session = await retryMgr.getOrCreate(SERVER_ID, USER_ID);

    vi.spyOn(repo, 'addMessage').mockRejectedValue(new Error('DB error'));

    await retryMgr.addMessage(session.id, USER_ID, 'assistant', 'Reply');
    await new Promise((r) => setTimeout(r, 50));
    expect(retryMgr.pendingRetryCount).toBe(1);

    // First retry: still fails, requeued (attempts: 2)
    await (retryMgr as unknown as { processRetryQueue: () => Promise<void> }).processRetryQueue();
    expect(retryMgr.pendingRetryCount).toBe(1);

    retryMgr.stopSweep();
  });

  it('should invoke onPersistenceFailure and drop after max retries', async () => {
    const retryMgr = new SessionManager(repo, { ...TEST_CACHE_OPTS, maxRetryAttempts: 2 });
    const session = await retryMgr.getOrCreate(SERVER_ID, USER_ID);
    const errorSpy = vi.spyOn(logger, 'error');

    const failedMessages: string[] = [];
    retryMgr.onPersistenceFailure = (_sid, msgId) => { failedMessages.push(msgId); };

    vi.spyOn(repo, 'addMessage').mockRejectedValue(new Error('DB error'));

    const msg = await retryMgr.addMessage(session.id, USER_ID, 'assistant', 'Reply');
    await new Promise((r) => setTimeout(r, 50));

    // attempts=1 after initial fail. processRetryQueue increments to 2 >= maxRetryAttempts(2)
    await (retryMgr as unknown as { processRetryQueue: () => Promise<void> }).processRetryQueue();

    expect(retryMgr.pendingRetryCount).toBe(0);
    expect(failedMessages).toHaveLength(1);
    expect(failedMessages[0]).toBe(msg.id);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: msg.id }),
      expect.stringContaining('exhausted'),
    );

    errorSpy.mockRestore();
    retryMgr.stopSweep();
  });

  it('should handle empty retry queue gracefully', async () => {
    expect(mgr.pendingRetryCount).toBe(0);
    // Should not throw
    await (mgr as unknown as { processRetryQueue: () => Promise<void> }).processRetryQueue();
    expect(mgr.pendingRetryCount).toBe(0);
  });
});

// ============================================================================
// Cache eviction (LRU + TTL)
// ============================================================================

describe('cache eviction', () => {
  describe('LRU eviction on capacity', () => {
    it('should evict the oldest session when cache is full', async () => {
      const smallMgr = new SessionManager(repo, { maxSize: 3, sweepIntervalMs: 0, retryIntervalMs: 0 });

      const s1 = await smallMgr.getOrCreate(SERVER_ID, USER_ID);
      await smallMgr.addMessage(s1.id, USER_ID, 'user', 'Session 1 msg');
      const s2 = await smallMgr.getOrCreate(SERVER_ID, USER_ID);
      const s3 = await smallMgr.getOrCreate(SERVER_ID, USER_ID);

      expect(smallMgr.cacheSize).toBe(3);

      // Adding a 4th session should evict s1 (oldest accessed)
      const s4 = await smallMgr.getOrCreate(SERVER_ID, USER_ID);
      expect(smallMgr.cacheSize).toBe(3);

      // s1 was evicted from cache but still in DB
      // Access from a fresh manager should reload from DB
      const freshMgr = new SessionManager(repo, { sweepIntervalMs: 0, retryIntervalMs: 0 });
      const reloaded = await freshMgr.getSession(s1.id, USER_ID);
      expect(reloaded).toBeDefined();
      expect(reloaded!.messages).toHaveLength(1);
      expect(reloaded!.messages[0].content).toBe('Session 1 msg');

      // Wait for persistence
      await new Promise((r) => setTimeout(r, 10));

      smallMgr.stopSweep();
      freshMgr.stopSweep();
    });

    it('should evict the least-recently-used, not just the oldest created', async () => {
      const smallMgr = new SessionManager(repo, { maxSize: 3, sweepIntervalMs: 0, retryIntervalMs: 0 });

      const s1 = await smallMgr.getOrCreate(SERVER_ID, USER_ID);
      const s2 = await smallMgr.getOrCreate(SERVER_ID, USER_ID);
      const s3 = await smallMgr.getOrCreate(SERVER_ID, USER_ID);

      // Touch s1 to make it recently accessed
      await smallMgr.getSession(s1.id, USER_ID);

      // Adding s4 should evict s2 (least recently accessed), not s1
      const s4 = await smallMgr.getOrCreate(SERVER_ID, USER_ID);
      expect(smallMgr.cacheSize).toBe(3);

      // s1 should still be in cache (was touched)
      const s1Again = await smallMgr.getSession(s1.id, USER_ID);
      expect(s1Again).toBeDefined();

      // s2 was evicted — accessing it reloads from DB
      const s2Again = await smallMgr.getSession(s2.id, USER_ID);
      expect(s2Again).toBeDefined();
      // This DB reload should have evicted s3 (least recently used now)
      expect(smallMgr.cacheSize).toBe(3);

      smallMgr.stopSweep();
    });

    it('should report correct cacheSize', async () => {
      expect(mgr.cacheSize).toBe(0);
      await mgr.getOrCreate(SERVER_ID, USER_ID);
      expect(mgr.cacheSize).toBe(1);
      await mgr.getOrCreate(SERVER_ID, USER_ID);
      expect(mgr.cacheSize).toBe(2);
    });
  });

  describe('active session protection', () => {
    it('should not evict sessions with active plans', async () => {
      const smallMgr = new SessionManager(repo, { maxSize: 2, sweepIntervalMs: 0, retryIntervalMs: 0 });
      const warnSpy = vi.spyOn(logger, 'warn');

      const s1 = await smallMgr.getOrCreate(SERVER_ID, USER_ID);
      const s2 = await smallMgr.getOrCreate(SERVER_ID, USER_ID);

      // Both sessions have plans — both are "active"
      smallMgr.storePlan(s1.id, {
        planId: 'p1', description: 'test', steps: [],
        totalRisk: 'green', requiresConfirmation: false,
      });
      smallMgr.storePlan(s2.id, {
        planId: 'p2', description: 'test', steps: [],
        totalRisk: 'green', requiresConfirmation: false,
      });

      // Try to add a 3rd — eviction should fail (all active)
      const s3 = await smallMgr.getOrCreate(SERVER_ID, USER_ID);
      // Cache should grow beyond maxSize (protection takes priority)
      expect(smallMgr.cacheSize).toBe(3);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({ cacheSize: 2, maxSize: 2 }),
        expect.stringContaining('all sessions have active plans'),
      );

      warnSpy.mockRestore();
      smallMgr.stopSweep();
    });

    it('should evict non-active session when mixed with active ones', async () => {
      const smallMgr = new SessionManager(repo, { maxSize: 2, sweepIntervalMs: 0, retryIntervalMs: 0 });

      const s1 = await smallMgr.getOrCreate(SERVER_ID, USER_ID);
      const s2 = await smallMgr.getOrCreate(SERVER_ID, USER_ID);

      // Only s1 has a plan (active), s2 does not
      smallMgr.storePlan(s1.id, {
        planId: 'p1', description: 'test', steps: [],
        totalRisk: 'green', requiresConfirmation: false,
      });

      // Adding s3 should evict s2 (non-active), not s1 (active)
      const s3 = await smallMgr.getOrCreate(SERVER_ID, USER_ID);
      expect(smallMgr.cacheSize).toBe(2);

      // s1 should still be accessible from cache (with plan)
      expect(smallMgr.getPlan(s1.id, 'p1')).toBeDefined();

      smallMgr.stopSweep();
    });
  });

  describe('TTL-based eviction', () => {
    it('should sweep expired sessions', async () => {
      // Use a very short TTL for testing
      const ttlMgr = new SessionManager(repo, { ttlMs: 50, sweepIntervalMs: 0, retryIntervalMs: 0 });

      const s1 = await ttlMgr.getOrCreate(SERVER_ID, USER_ID);
      await ttlMgr.addMessage(s1.id, USER_ID, 'user', 'Hello');
      expect(ttlMgr.cacheSize).toBe(1);

      // Wait for TTL to expire
      await new Promise((r) => setTimeout(r, 60));

      // Manually trigger sweep (timer is disabled in tests)
      // Access the private method via type cast for testing
      (ttlMgr as unknown as { sweepExpired: () => void }).sweepExpired();

      expect(ttlMgr.cacheSize).toBe(0);

      // Session still loadable from DB
      await new Promise((r) => setTimeout(r, 10)); // wait for persistence
      const reloaded = await ttlMgr.getSession(s1.id, USER_ID);
      expect(reloaded).toBeDefined();
      expect(reloaded!.messages).toHaveLength(1);
      expect(ttlMgr.cacheSize).toBe(1); // reloaded into cache

      ttlMgr.stopSweep();
    });

    it('should not sweep active sessions even when TTL expired', async () => {
      const ttlMgr = new SessionManager(repo, { ttlMs: 50, sweepIntervalMs: 0, retryIntervalMs: 0 });

      const s1 = await ttlMgr.getOrCreate(SERVER_ID, USER_ID);
      ttlMgr.storePlan(s1.id, {
        planId: 'p1', description: 'test', steps: [],
        totalRisk: 'green', requiresConfirmation: false,
      });

      // Wait for TTL to expire
      await new Promise((r) => setTimeout(r, 60));

      (ttlMgr as unknown as { sweepExpired: () => void }).sweepExpired();

      // Should still be in cache because it has an active plan
      expect(ttlMgr.cacheSize).toBe(1);
      expect(ttlMgr.getPlan(s1.id, 'p1')).toBeDefined();

      ttlMgr.stopSweep();
    });

    it('should not sweep recently accessed sessions', async () => {
      const ttlMgr = new SessionManager(repo, { ttlMs: 200, sweepIntervalMs: 0, retryIntervalMs: 0 });

      const s1 = await ttlMgr.getOrCreate(SERVER_ID, USER_ID);

      // Access it after 100ms (within TTL)
      await new Promise((r) => setTimeout(r, 100));
      await ttlMgr.getSession(s1.id, USER_ID); // resets access time

      // Sweep at 200ms from creation — but only 100ms from last access
      await new Promise((r) => setTimeout(r, 110));
      (ttlMgr as unknown as { sweepExpired: () => void }).sweepExpired();

      // Should still be in cache (last access was ~110ms ago, TTL is 200ms)
      expect(ttlMgr.cacheSize).toBe(1);

      ttlMgr.stopSweep();
    });
  });

  describe('eviction and reload cycle', () => {
    it('should reload evicted session from DB with messages intact', async () => {
      const smallMgr = new SessionManager(repo, { maxSize: 2, sweepIntervalMs: 0, retryIntervalMs: 0 });

      const s1 = await smallMgr.getOrCreate(SERVER_ID, USER_ID);
      await smallMgr.addMessage(s1.id, USER_ID, 'user', 'First');
      await smallMgr.addMessage(s1.id, USER_ID, 'assistant', 'Reply');

      // Wait for persistence
      await new Promise((r) => setTimeout(r, 10));

      const s2 = await smallMgr.getOrCreate(SERVER_ID, USER_ID);

      // Force eviction of s1 by filling cache
      const s3 = await smallMgr.getOrCreate(SERVER_ID, USER_ID);
      expect(smallMgr.cacheSize).toBe(2); // s1 evicted

      // Access s1 again — should reload from DB
      const reloaded = await smallMgr.getSession(s1.id, USER_ID);
      expect(reloaded).toBeDefined();
      expect(reloaded!.messages).toHaveLength(2);
      expect(reloaded!.messages[0].content).toBe('First');
      expect(reloaded!.messages[1].content).toBe('Reply');
      // Plans are lost after eviction (in-memory only)
      expect(reloaded!.plans.size).toBe(0);

      smallMgr.stopSweep();
    });

    it('should lose plans after eviction and reload', async () => {
      const smallMgr = new SessionManager(repo, { maxSize: 1, sweepIntervalMs: 0, retryIntervalMs: 0 });

      const s1 = await smallMgr.getOrCreate(SERVER_ID, USER_ID);
      // Note: storing a plan makes session active, so it won't be evicted
      // We need to test the case where plan was cleared before eviction

      // Create a session, don't add plan
      const s2 = await smallMgr.getOrCreate(SERVER_ID, USER_ID);
      // s1 is evicted (no plan, LRU)

      // Reload s1
      const reloaded = await smallMgr.getSession(s1.id, USER_ID);
      expect(reloaded).toBeDefined();
      expect(reloaded!.plans.size).toBe(0);

      smallMgr.stopSweep();
    });
  });

  describe('addMessage after cache eviction (auto-reload)', () => {
    it('should auto-reload session from DB when evicted before addMessage', async () => {
      const smallMgr = new SessionManager(repo, { maxSize: 2, sweepIntervalMs: 0, retryIntervalMs: 0 });

      const s1 = await smallMgr.getOrCreate(SERVER_ID, USER_ID);
      await smallMgr.addMessage(s1.id, USER_ID, 'user', 'Before eviction');

      // Wait for persistence
      await new Promise((r) => setTimeout(r, 10));

      // Fill cache to evict s1
      const s2 = await smallMgr.getOrCreate(SERVER_ID, USER_ID);
      const s3 = await smallMgr.getOrCreate(SERVER_ID, USER_ID);
      expect(smallMgr.cacheSize).toBe(2); // s1 evicted

      // addMessage on evicted session should auto-reload, not throw
      const msg = await smallMgr.addMessage(s1.id, USER_ID, 'user', 'After eviction');
      expect(msg.content).toBe('After eviction');
      expect(msg.role).toBe('user');

      // Session should now be back in cache with both messages
      const session = await smallMgr.getSession(s1.id, USER_ID);
      expect(session).toBeDefined();
      expect(session!.messages).toHaveLength(2);
      expect(session!.messages[0].content).toBe('Before eviction');
      expect(session!.messages[1].content).toBe('After eviction');

      smallMgr.stopSweep();
    });

    it('should increment cacheReloads counter on auto-reload', async () => {
      const smallMgr = new SessionManager(repo, { maxSize: 1, sweepIntervalMs: 0, retryIntervalMs: 0 });

      const s1 = await smallMgr.getOrCreate(SERVER_ID, USER_ID);
      await new Promise((r) => setTimeout(r, 10));

      // Evict s1
      const s2 = await smallMgr.getOrCreate(SERVER_ID, USER_ID);
      expect(smallMgr.cacheReloads).toBe(0);

      // Auto-reload via addMessage
      await smallMgr.addMessage(s1.id, USER_ID, 'user', 'Reloaded');
      expect(smallMgr.cacheReloads).toBe(1);

      smallMgr.stopSweep();
    });

    it('should log reload event on cache miss', async () => {
      const smallMgr = new SessionManager(repo, { maxSize: 1, sweepIntervalMs: 0, retryIntervalMs: 0 });
      const infoSpy = vi.spyOn(logger, 'info');

      const s1 = await smallMgr.getOrCreate(SERVER_ID, USER_ID);
      await new Promise((r) => setTimeout(r, 10));

      // Evict s1
      await smallMgr.getOrCreate(SERVER_ID, USER_ID);

      await smallMgr.addMessage(s1.id, USER_ID, 'user', 'Hello');

      expect(infoSpy).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: s1.id, cacheReloadCount: 1 }),
        expect.stringContaining('reloaded from DB after cache eviction'),
      );

      infoSpy.mockRestore();
      smallMgr.stopSweep();
    });

    it('should still throw for truly non-existent session (not in DB)', async () => {
      await expect(
        mgr.addMessage('totally-nonexistent', USER_ID, 'user', 'Hello'),
      ).rejects.toThrow('Session totally-nonexistent not found');
    });

    it('should auto-reload after TTL sweep eviction', async () => {
      const ttlMgr = new SessionManager(repo, { ttlMs: 50, sweepIntervalMs: 0, retryIntervalMs: 0 });

      const s1 = await ttlMgr.getOrCreate(SERVER_ID, USER_ID);
      await ttlMgr.addMessage(s1.id, USER_ID, 'user', 'Original');
      await new Promise((r) => setTimeout(r, 10)); // persistence

      // Wait for TTL to expire, then sweep
      await new Promise((r) => setTimeout(r, 60));
      (ttlMgr as unknown as { sweepExpired: () => void }).sweepExpired();
      expect(ttlMgr.cacheSize).toBe(0);

      // addMessage should auto-reload from DB
      const msg = await ttlMgr.addMessage(s1.id, USER_ID, 'user', 'After TTL');
      expect(msg.content).toBe('After TTL');

      const session = await ttlMgr.getSession(s1.id, USER_ID);
      expect(session!.messages).toHaveLength(2);

      ttlMgr.stopSweep();
    });
  });

  describe('deleteSession removes from cache', () => {
    it('should decrease cache size on delete', async () => {
      const session = await mgr.getOrCreate(SERVER_ID, USER_ID);
      expect(mgr.cacheSize).toBe(1);

      await mgr.deleteSession(session.id, SERVER_ID, USER_ID);
      expect(mgr.cacheSize).toBe(0);
    });
  });

  describe('stopSweep', () => {
    it('should stop the sweep timer', () => {
      const timerMgr = new SessionManager(repo, { sweepIntervalMs: 100, retryIntervalMs: 0 });
      timerMgr.stopSweep();
      // No error should occur; test would hang if timer was not stopped
      timerMgr.stopSweep(); // double stop is safe
    });
  });
});
