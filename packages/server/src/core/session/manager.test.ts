// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for session manager.
 *
 * Validates session CRUD, message management, plan storage,
 * and conversation context building.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SessionManager } from './manager.js';

let mgr: SessionManager;

beforeEach(() => {
  mgr = new SessionManager();
});

// ============================================================================
// Session CRUD
// ============================================================================

describe('getOrCreate', () => {
  it('should create a new session when no sessionId provided', () => {
    const session = mgr.getOrCreate('server-1');
    expect(session.id).toBeDefined();
    expect(session.serverId).toBe('server-1');
    expect(session.messages).toEqual([]);
    expect(session.createdAt).toBeDefined();
  });

  it('should create a new session when sessionId does not exist', () => {
    const session = mgr.getOrCreate('server-1', 'nonexistent-id');
    expect(session.id).not.toBe('nonexistent-id');
    expect(session.serverId).toBe('server-1');
  });

  it('should return existing session when valid sessionId provided', () => {
    const created = mgr.getOrCreate('server-1');
    const retrieved = mgr.getOrCreate('server-1', created.id);
    expect(retrieved.id).toBe(created.id);
  });

  it('should not return session from different server', () => {
    const created = mgr.getOrCreate('server-1');
    const other = mgr.getOrCreate('server-2', created.id);
    expect(other.id).not.toBe(created.id);
  });

  it('should generate unique session IDs', () => {
    const s1 = mgr.getOrCreate('server-1');
    const s2 = mgr.getOrCreate('server-1');
    expect(s1.id).not.toBe(s2.id);
  });
});

describe('getSession', () => {
  it('should return undefined for non-existent session', () => {
    expect(mgr.getSession('nonexistent')).toBeUndefined();
  });

  it('should return the created session', () => {
    const created = mgr.getOrCreate('server-1');
    const retrieved = mgr.getSession(created.id);
    expect(retrieved).toBeDefined();
    expect(retrieved!.id).toBe(created.id);
  });
});

describe('deleteSession', () => {
  it('should delete an existing session', () => {
    const session = mgr.getOrCreate('server-1');
    expect(mgr.deleteSession(session.id, 'server-1')).toBe(true);
    expect(mgr.getSession(session.id)).toBeUndefined();
  });

  it('should return false for non-existent session', () => {
    expect(mgr.deleteSession('nonexistent', 'server-1')).toBe(false);
  });

  it('should return false for wrong serverId', () => {
    const session = mgr.getOrCreate('server-1');
    expect(mgr.deleteSession(session.id, 'server-2')).toBe(false);
    expect(mgr.getSession(session.id)).toBeDefined();
  });
});

describe('listSessions', () => {
  it('should return empty array for server with no sessions', () => {
    expect(mgr.listSessions('server-1')).toEqual([]);
  });

  it('should return sessions for the given server', () => {
    mgr.getOrCreate('server-1');
    mgr.getOrCreate('server-1');
    mgr.getOrCreate('server-2');

    const list = mgr.listSessions('server-1');
    expect(list).toHaveLength(2);
    expect(list[0].serverId).toBe('server-1');
    expect(list[1].serverId).toBe('server-1');
  });

  it('should include messageCount and lastMessage', () => {
    const session = mgr.getOrCreate('server-1');
    mgr.addMessage(session.id, 'user', 'Hello');
    mgr.addMessage(session.id, 'assistant', 'Hi there!');

    const list = mgr.listSessions('server-1');
    expect(list[0].messageCount).toBe(2);
    expect(list[0].lastMessage).toBe('Hi there!');
  });

  it('should sort by updatedAt descending', async () => {
    const s1 = mgr.getOrCreate('server-1');
    await new Promise((r) => setTimeout(r, 10));
    const s2 = mgr.getOrCreate('server-1');

    const list = mgr.listSessions('server-1');
    expect(list[0].id).toBe(s2.id);
    expect(list[1].id).toBe(s1.id);
  });

  it('should truncate lastMessage to 100 chars', () => {
    const session = mgr.getOrCreate('server-1');
    mgr.addMessage(session.id, 'user', 'x'.repeat(200));

    const list = mgr.listSessions('server-1');
    expect(list[0].lastMessage!.length).toBe(100);
  });
});

// ============================================================================
// Messages
// ============================================================================

describe('addMessage', () => {
  it('should add a message to a session', () => {
    const session = mgr.getOrCreate('server-1');
    const msg = mgr.addMessage(session.id, 'user', 'Hello');

    expect(msg.id).toBeDefined();
    expect(msg.role).toBe('user');
    expect(msg.content).toBe('Hello');
    expect(msg.timestamp).toBeDefined();
  });

  it('should throw for non-existent session', () => {
    expect(() => mgr.addMessage('nonexistent', 'user', 'Hello')).toThrow();
  });

  it('should update session updatedAt', async () => {
    const session = mgr.getOrCreate('server-1');
    const before = session.updatedAt;
    await new Promise((r) => setTimeout(r, 10));
    mgr.addMessage(session.id, 'user', 'Hello');
    expect(session.updatedAt).not.toBe(before);
  });

  it('should support all message roles', () => {
    const session = mgr.getOrCreate('server-1');
    const user = mgr.addMessage(session.id, 'user', 'q');
    const assistant = mgr.addMessage(session.id, 'assistant', 'a');
    const system = mgr.addMessage(session.id, 'system', 's');

    expect(user.role).toBe('user');
    expect(assistant.role).toBe('assistant');
    expect(system.role).toBe('system');
    expect(session.messages).toHaveLength(3);
  });
});

// ============================================================================
// Plans
// ============================================================================

describe('storePlan / getPlan', () => {
  it('should store and retrieve a plan', () => {
    const session = mgr.getOrCreate('server-1');
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

  it('should return undefined for non-existent plan', () => {
    const session = mgr.getOrCreate('server-1');
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
  it('should return empty string for session with no messages', () => {
    const session = mgr.getOrCreate('server-1');
    expect(mgr.buildContext(session.id)).toBe('');
  });

  it('should return empty string for non-existent session', () => {
    expect(mgr.buildContext('nonexistent')).toBe('');
  });

  it('should format messages as role: content', () => {
    const session = mgr.getOrCreate('server-1');
    mgr.addMessage(session.id, 'user', 'Install Redis');
    mgr.addMessage(session.id, 'assistant', 'I will help you install Redis.');

    const context = mgr.buildContext(session.id);
    expect(context).toContain('user: Install Redis');
    expect(context).toContain('assistant: I will help you install Redis.');
  });
});
