// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for skill execution log persistence.
 *
 * Covers: schema (via createTables), repository appendLog/getLogs,
 * event bus DB persistence hook, and InMemory implementation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { initDatabase, closeDatabase, createTables } from '../../db/connection.js';
import {
  DrizzleSkillRepository,
  InMemorySkillRepository,
} from '../../db/repositories/skill-repository.js';
import {
  getSkillEventBus,
  _resetSkillEventBus,
} from './skill-event-bus.js';

import type { DrizzleDB } from '../../db/connection.js';
import type { SkillLogEventType } from '../../db/schema.js';
import type {
  SkillStepEvent,
  SkillLogEvent,
  SkillErrorEvent,
  SkillCompletedEvent,
} from './skill-event-bus.js';

// ============================================================================
// Helpers
// ============================================================================

function seedUser(db: DrizzleDB, id: string, email: string): void {
  const sqlite = (db as unknown as { session: { client: { exec: (s: string) => void } } })
    .session.client;
  sqlite.exec(
    `INSERT INTO users (id, email, password_hash, created_at, updated_at)
     VALUES ('${id}', '${email}', 'hash', ${Date.now()}, ${Date.now()})`,
  );
}

function seedServer(db: DrizzleDB, id: string, userId: string): void {
  const sqlite = (db as unknown as { session: { client: { exec: (s: string) => void } } })
    .session.client;
  sqlite.exec(
    `INSERT INTO servers (id, name, user_id, created_at, updated_at)
     VALUES ('${id}', 'test-server', '${userId}', ${Date.now()}, ${Date.now()})`,
  );
}

// ============================================================================
// DrizzleSkillRepository — appendLog / getLogs
// ============================================================================

describe('DrizzleSkillRepository execution logs', () => {
  let db: DrizzleDB;
  let repo: DrizzleSkillRepository;
  let executionId: string;

  beforeEach(async () => {
    db = initDatabase(':memory:');
    createTables();
    repo = new DrizzleSkillRepository(db);
    seedUser(db, 'user-1', 'test@test.com');
    seedServer(db, 'server-1', 'user-1');

    const skill = await repo.install({
      userId: 'user-1',
      name: 'log-test-skill',
      version: '1.0.0',
      source: 'local',
      skillPath: '/skills/test',
    });
    const execution = await repo.createExecution({
      skillId: skill.id,
      serverId: 'server-1',
      userId: 'user-1',
      triggerType: 'manual',
    });
    executionId = execution.id;
  });

  afterEach(() => {
    closeDatabase();
  });

  it('should return empty logs for a new execution', async () => {
    const logs = await repo.getLogs(executionId);
    expect(logs).toEqual([]);
  });

  it('should persist and retrieve a step log entry', async () => {
    await repo.appendLog(executionId, 'step', {
      tool: 'shell',
      phase: 'complete',
      success: true,
      duration: 150,
    });

    const logs = await repo.getLogs(executionId);
    expect(logs).toHaveLength(1);
    expect(logs[0].executionId).toBe(executionId);
    expect(logs[0].eventType).toBe('step');
    expect(logs[0].data).toMatchObject({ tool: 'shell', success: true });
    expect(logs[0].id).toBeDefined();
    expect(logs[0].createdAt).toBeDefined();
  });

  it('should persist multiple log entries in order', async () => {
    await repo.appendLog(executionId, 'log', { text: 'Starting...' });
    await repo.appendLog(executionId, 'step', { tool: 'shell', phase: 'start' });
    await repo.appendLog(executionId, 'step', { tool: 'shell', phase: 'complete', success: true });
    await repo.appendLog(executionId, 'completed', { status: 'success', stepsExecuted: 1 });

    const logs = await repo.getLogs(executionId);
    expect(logs).toHaveLength(4);
    expect(logs[0].eventType).toBe('log');
    expect(logs[1].eventType).toBe('step');
    expect(logs[2].eventType).toBe('step');
    expect(logs[3].eventType).toBe('completed');
  });

  it('should persist error log entries', async () => {
    await repo.appendLog(executionId, 'error', { message: 'Connection refused' });

    const logs = await repo.getLogs(executionId);
    expect(logs).toHaveLength(1);
    expect(logs[0].eventType).toBe('error');
    expect(logs[0].data).toEqual({ message: 'Connection refused' });
  });

  it('should isolate logs per execution', async () => {
    // Create a second execution
    const skill2 = await repo.install({
      userId: 'user-1',
      name: 'other-skill',
      version: '1.0.0',
      source: 'local',
      skillPath: '/skills/other',
    });
    const exec2 = await repo.createExecution({
      skillId: skill2.id,
      serverId: 'server-1',
      userId: 'user-1',
      triggerType: 'manual',
    });

    await repo.appendLog(executionId, 'log', { text: 'exec1' });
    await repo.appendLog(exec2.id, 'log', { text: 'exec2' });

    const logs1 = await repo.getLogs(executionId);
    const logs2 = await repo.getLogs(exec2.id);

    expect(logs1).toHaveLength(1);
    expect(logs1[0].data).toEqual({ text: 'exec1' });
    expect(logs2).toHaveLength(1);
    expect(logs2[0].data).toEqual({ text: 'exec2' });
  });

  it('should cascade delete logs when execution is deleted', async () => {
    await repo.appendLog(executionId, 'log', { text: 'will be deleted' });
    await repo.appendLog(executionId, 'step', { tool: 'shell', phase: 'start' });

    // Complete the execution so it can be cleaned up
    await repo.completeExecution(executionId, 'success', null, 1, 500);

    // Delete executions before a future cutoff
    const deleted = await repo.deleteExecutionsBefore(new Date(Date.now() + 60000));
    expect(deleted).toBe(1);

    // Logs should be cascade-deleted by SQLite FK
    const logs = await repo.getLogs(executionId);
    expect(logs).toEqual([]);
  });
});

// ============================================================================
// InMemorySkillRepository — appendLog / getLogs
// ============================================================================

describe('InMemorySkillRepository execution logs', () => {
  let repo: InMemorySkillRepository;
  let executionId: string;

  beforeEach(async () => {
    repo = new InMemorySkillRepository();
    const skill = await repo.install({
      userId: 'user-1',
      name: 'test-skill',
      version: '1.0.0',
      source: 'local',
      skillPath: '/skills/test',
    });
    const execution = await repo.createExecution({
      skillId: skill.id,
      serverId: 'server-1',
      userId: 'user-1',
      triggerType: 'manual',
    });
    executionId = execution.id;
  });

  it('should persist and retrieve logs', async () => {
    await repo.appendLog(executionId, 'log', { text: 'hello' });
    await repo.appendLog(executionId, 'step', { tool: 'shell', phase: 'start' });

    const logs = await repo.getLogs(executionId);
    expect(logs).toHaveLength(2);
    expect(logs[0].eventType).toBe('log');
    expect(logs[1].eventType).toBe('step');
  });

  it('should clean up logs on deleteExecutionsBefore', async () => {
    await repo.appendLog(executionId, 'log', { text: 'will be cleaned' });
    await repo.completeExecution(executionId, 'success', null, 1, 100);

    await repo.deleteExecutionsBefore(new Date(Date.now() + 60000));
    const logs = await repo.getLogs(executionId);
    expect(logs).toEqual([]);
  });

  it('should clean up logs on uninstall', async () => {
    await repo.appendLog(executionId, 'log', { text: 'pre-uninstall' });
    const execution = await repo.findExecutionById(executionId);
    await repo.uninstall(execution!.skillId);

    const logs = await repo.getLogs(executionId);
    expect(logs).toEqual([]);
  });
});

// ============================================================================
// SkillEventBus — DB persistence integration
// ============================================================================

describe('SkillEventBus log persistence', () => {
  beforeEach(() => {
    _resetSkillEventBus();
  });

  it('should call persistFn on publish with event type and data', async () => {
    const bus = getSkillEventBus();
    const persistFn = vi.fn().mockResolvedValue(undefined);
    bus.setPersistFn(persistFn);

    const event: SkillLogEvent = {
      type: 'log',
      executionId: 'exec-1',
      timestamp: '2026-02-13T00:00:00.000Z',
      text: 'checking system...',
    };
    bus.publish('exec-1', event);

    // persistFn is called async, wait for microtask
    await vi.waitFor(() => expect(persistFn).toHaveBeenCalledTimes(1));

    expect(persistFn).toHaveBeenCalledWith(
      'exec-1',
      'log',
      expect.objectContaining({ text: 'checking system...' }),
    );
  });

  it('should call persistFn for step events with correct data', async () => {
    const bus = getSkillEventBus();
    const persistFn = vi.fn().mockResolvedValue(undefined);
    bus.setPersistFn(persistFn);

    const event: SkillStepEvent = {
      type: 'step',
      executionId: 'exec-1',
      timestamp: '2026-02-13T00:00:00.000Z',
      tool: 'shell',
      phase: 'complete',
      success: true,
      duration: 200,
    };
    bus.publish('exec-1', event);

    await vi.waitFor(() => expect(persistFn).toHaveBeenCalledTimes(1));

    const [eid, eventType, data] = persistFn.mock.calls[0] as [string, SkillLogEventType, Record<string, unknown>];
    expect(eid).toBe('exec-1');
    expect(eventType).toBe('step');
    expect(data).toMatchObject({ tool: 'shell', phase: 'complete', success: true });
    // The 'type' field should NOT be in data (it's extracted as eventType)
    expect(data).not.toHaveProperty('type');
  });

  it('should not block SSE delivery when persistFn throws', async () => {
    const bus = getSkillEventBus();
    const persistFn = vi.fn().mockRejectedValue(new Error('DB down'));
    bus.setPersistFn(persistFn);

    const received: SkillLogEvent[] = [];
    bus.subscribe('exec-1', (e) => received.push(e as SkillLogEvent));

    bus.publish('exec-1', {
      type: 'log',
      executionId: 'exec-1',
      timestamp: '2026-02-13T00:00:00.000Z',
      text: 'should still arrive',
    });

    // SSE subscriber should still receive the event
    expect(received).toHaveLength(1);
    expect(received[0].text).toBe('should still arrive');

    // persistFn was called but its failure was swallowed
    await vi.waitFor(() => expect(persistFn).toHaveBeenCalledTimes(1));
  });

  it('should not call persistFn when not set', () => {
    const bus = getSkillEventBus();
    // No persistFn set — should not throw
    expect(() => {
      bus.publish('exec-1', {
        type: 'error',
        executionId: 'exec-1',
        timestamp: '2026-02-13T00:00:00.000Z',
        message: 'oops',
      });
    }).not.toThrow();
  });

  it('should persist completed events', async () => {
    const bus = getSkillEventBus();
    const persistFn = vi.fn().mockResolvedValue(undefined);
    bus.setPersistFn(persistFn);

    const event: SkillCompletedEvent = {
      type: 'completed',
      executionId: 'exec-1',
      timestamp: '2026-02-13T00:00:00.000Z',
      status: 'success',
      stepsExecuted: 3,
      duration: 5000,
      output: 'All done',
    };
    bus.publish('exec-1', event);

    await vi.waitFor(() => expect(persistFn).toHaveBeenCalledTimes(1));
    expect(persistFn).toHaveBeenCalledWith('exec-1', 'completed', expect.objectContaining({
      status: 'success',
      stepsExecuted: 3,
    }));
  });

  it('should allow clearing persistFn with null', async () => {
    const bus = getSkillEventBus();
    const persistFn = vi.fn().mockResolvedValue(undefined);
    bus.setPersistFn(persistFn);

    bus.publish('exec-1', {
      type: 'log',
      executionId: 'exec-1',
      timestamp: '2026-02-13T00:00:00.000Z',
      text: 'first',
    });
    await vi.waitFor(() => expect(persistFn).toHaveBeenCalledTimes(1));

    bus.setPersistFn(null);

    bus.publish('exec-1', {
      type: 'log',
      executionId: 'exec-1',
      timestamp: '2026-02-13T00:00:01.000Z',
      text: 'second',
    });

    // Should still be 1 call — second publish had no persistFn
    expect(persistFn).toHaveBeenCalledTimes(1);
  });
});
