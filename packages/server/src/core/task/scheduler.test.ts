// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for the TaskScheduler.
 *
 * Validates cron helpers, poll-based task dispatching, nextRun calculation,
 * agent connectivity checks, and lifecycle management.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  TaskScheduler,
  getNextRunDate,
  isValidCron,
  _resetTaskScheduler,
} from './scheduler.js';
import type { TaskRepository, Task } from '../../db/repositories/task-repository.js';
import type { TaskExecutor, ExecutionResult } from './executor.js';
import type { InstallServer } from '../../api/server.js';

// ============================================================================
// Mock Factories
// ============================================================================

function createMockServer(overrides: Partial<InstallServer> = {}): InstallServer {
  return {
    send: vi.fn(),
    broadcast: vi.fn(),
    on: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    getClientCount: vi.fn(() => 1),
    getSessionCount: vi.fn(() => 0),
    isRunning: vi.fn(() => true),
    createSession: vi.fn(),
    getSession: vi.fn(),
    updateSessionStatus: vi.fn(),
    getClientSessionId: vi.fn(),
    isClientAuthenticated: vi.fn(() => true),
    authenticateClient: vi.fn(),
    getClientAuth: vi.fn(),
    getMaxConnections: vi.fn(() => 100),
    getClientsByDeviceId: vi.fn(() => []),
    ...overrides,
  } as unknown as InstallServer;
}

function createMockTaskRepo(overrides: Partial<TaskRepository> = {}): TaskRepository {
  return {
    create: vi.fn(),
    getById: vi.fn(),
    listByServer: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    findByStatus: vi.fn(),
    updateRunResult: vi.fn(async () => true),
    findDueTasks: vi.fn(async () => []),
    ...overrides,
  } as unknown as TaskRepository;
}

function createMockExecutor(overrides: Partial<TaskExecutor> = {}): TaskExecutor {
  return {
    executeCommand: vi.fn(async (): Promise<ExecutionResult> => ({
      success: true,
      executionId: 'exec-1',
      operationId: 'op-1',
      exitCode: 0,
      stdout: 'ok',
      stderr: '',
      duration: 100,
      timedOut: false,
    })),
    executePlan: vi.fn(),
    handleStepComplete: vi.fn(),
    handleStepOutput: vi.fn(),
    cancelExecution: vi.fn(),
    setProgressCallback: vi.fn(),
    setSnapshotService: vi.fn(),
    getActiveCount: vi.fn(() => 0),
    getExecution: vi.fn(),
    shutdown: vi.fn(),
    ...overrides,
  } as unknown as TaskExecutor;
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    serverId: 'srv-1',
    userId: 'user-1',
    name: 'Test Backup',
    description: 'Daily backup',
    cron: '0 2 * * *',
    command: 'tar -czf /backup/daily.tar.gz /data',
    status: 'active',
    lastRun: null,
    lastStatus: null,
    nextRun: new Date(Date.now() - 60_000).toISOString(), // past due
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

// ============================================================================
// Setup
// ============================================================================

let server: InstallServer;
let taskRepo: TaskRepository;
let executor: TaskExecutor;
let scheduler: TaskScheduler;

beforeEach(() => {
  server = createMockServer();
  taskRepo = createMockTaskRepo();
  executor = createMockExecutor();
  scheduler = new TaskScheduler(server, taskRepo, executor, { pollIntervalMs: 60_000 });
});

afterEach(() => {
  scheduler.stop();
  _resetTaskScheduler();
});

// ============================================================================
// Cron Helpers
// ============================================================================

describe('getNextRunDate', () => {
  it('should return next run date for a valid cron expression', () => {
    const next = getNextRunDate('0 2 * * *');
    expect(next).toBeInstanceOf(Date);
    expect(next!.getUTCHours()).toBe(2);
    expect(next!.getUTCMinutes()).toBe(0);
  });

  it('should compute relative to the given from date', () => {
    const from = new Date('2026-01-15T00:00:00Z');
    const next = getNextRunDate('0 12 * * *', from);
    expect(next).toBeInstanceOf(Date);
    expect(next!.toISOString()).toBe('2026-01-15T12:00:00.000Z');
  });

  it('should return next occurrence when from is past the target time today', () => {
    const from = new Date('2026-01-15T15:00:00Z');
    const next = getNextRunDate('0 12 * * *', from);
    expect(next).toBeInstanceOf(Date);
    // Should be tomorrow at 12:00 UTC
    expect(next!.toISOString()).toBe('2026-01-16T12:00:00.000Z');
  });

  it('should handle every-minute cron', () => {
    const from = new Date('2026-01-15T10:30:00Z');
    const next = getNextRunDate('* * * * *', from);
    expect(next).toBeInstanceOf(Date);
    expect(next!.toISOString()).toBe('2026-01-15T10:31:00.000Z');
  });

  it('should handle every-5-minutes cron', () => {
    const from = new Date('2026-01-15T10:32:00Z');
    const next = getNextRunDate('*/5 * * * *', from);
    expect(next).toBeInstanceOf(Date);
    expect(next!.toISOString()).toBe('2026-01-15T10:35:00.000Z');
  });

  it('should return null for an invalid cron expression', () => {
    const next = getNextRunDate('invalid cron');
    expect(next).toBeNull();
  });

  it('should return null for garbage input', () => {
    const next = getNextRunDate('not a cron at all xyz');
    expect(next).toBeNull();
  });
});

describe('isValidCron', () => {
  it('should accept standard 5-field cron', () => {
    expect(isValidCron('0 2 * * *')).toBe(true);
    expect(isValidCron('*/5 * * * *')).toBe(true);
    expect(isValidCron('0 0 1 * *')).toBe(true);
    expect(isValidCron('30 4 * * 1-5')).toBe(true);
  });

  it('should reject invalid cron expressions', () => {
    expect(isValidCron('invalid')).toBe(false);
    expect(isValidCron('not a cron at all xyz')).toBe(false);
  });
});

// ============================================================================
// TaskScheduler Lifecycle
// ============================================================================

describe('TaskScheduler lifecycle', () => {
  it('should start and stop', () => {
    expect(scheduler.isRunning()).toBe(false);
    scheduler.start();
    expect(scheduler.isRunning()).toBe(true);
    scheduler.stop();
    expect(scheduler.isRunning()).toBe(false);
  });

  it('should be idempotent on double start', () => {
    scheduler.start();
    scheduler.start(); // No error
    expect(scheduler.isRunning()).toBe(true);
  });

  it('should be idempotent on double stop', () => {
    scheduler.start();
    scheduler.stop();
    scheduler.stop(); // No error
    expect(scheduler.isRunning()).toBe(false);
  });
});

// ============================================================================
// Poll Behavior
// ============================================================================

describe('poll', () => {
  it('should query for due tasks', async () => {
    await scheduler.poll();
    expect(taskRepo.findDueTasks).toHaveBeenCalledWith(expect.any(Date));
  });

  it('should not overlap polls', async () => {
    // Make findDueTasks slow
    let resolveDelayed: () => void;
    const delayed = new Promise<Task[]>((r) => {
      resolveDelayed = () => r([]);
    });
    (taskRepo.findDueTasks as ReturnType<typeof vi.fn>).mockReturnValue(delayed);

    const poll1 = scheduler.poll();
    const poll2 = scheduler.poll(); // Should skip

    resolveDelayed!();
    await poll1;
    await poll2;

    // findDueTasks should only be called once (second poll was skipped)
    expect(taskRepo.findDueTasks).toHaveBeenCalledTimes(1);
  });

  it('should handle errors during poll gracefully', async () => {
    (taskRepo.findDueTasks as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('DB connection lost'),
    );

    // Should not throw
    await scheduler.poll();
  });

  it('should execute due tasks', async () => {
    const task = makeTask();
    (taskRepo.findDueTasks as ReturnType<typeof vi.fn>).mockResolvedValue([task]);
    (server.getClientsByDeviceId as ReturnType<typeof vi.fn>).mockReturnValue(['client-1']);

    await scheduler.poll();

    expect(executor.executeCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        serverId: 'srv-1',
        userId: 'user-1',
        clientId: 'client-1',
        command: 'tar -czf /backup/daily.tar.gz /data',
        taskId: 'task-1',
      }),
    );
  });

  it('should update run result and nextRun after successful execution', async () => {
    const task = makeTask();
    (taskRepo.findDueTasks as ReturnType<typeof vi.fn>).mockResolvedValue([task]);
    (server.getClientsByDeviceId as ReturnType<typeof vi.fn>).mockReturnValue(['client-1']);

    await scheduler.poll();

    expect(taskRepo.updateRunResult).toHaveBeenCalledWith(
      'task-1',
      'user-1',
      'success',
      expect.any(Date), // nextRun
    );
  });

  it('should mark task as failed when executor returns failure', async () => {
    const task = makeTask();
    (taskRepo.findDueTasks as ReturnType<typeof vi.fn>).mockResolvedValue([task]);
    (server.getClientsByDeviceId as ReturnType<typeof vi.fn>).mockReturnValue(['client-1']);
    (executor.executeCommand as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: false,
      executionId: 'exec-1',
      operationId: 'op-1',
      exitCode: 1,
      stdout: '',
      stderr: 'error',
      duration: 50,
      timedOut: false,
    });

    await scheduler.poll();

    expect(taskRepo.updateRunResult).toHaveBeenCalledWith(
      'task-1',
      'user-1',
      'failed',
      expect.any(Date),
    );
  });

  it('should skip task when no agent is connected', async () => {
    const task = makeTask();
    (taskRepo.findDueTasks as ReturnType<typeof vi.fn>).mockResolvedValue([task]);
    (server.getClientsByDeviceId as ReturnType<typeof vi.fn>).mockReturnValue([]);

    await scheduler.poll();

    // Should NOT dispatch command
    expect(executor.executeCommand).not.toHaveBeenCalled();

    // Should still update nextRun (mark as failed)
    expect(taskRepo.updateRunResult).toHaveBeenCalledWith(
      'task-1',
      'user-1',
      'failed',
      expect.any(Date),
    );
  });

  it('should handle executor throwing an error', async () => {
    const task = makeTask();
    (taskRepo.findDueTasks as ReturnType<typeof vi.fn>).mockResolvedValue([task]);
    (server.getClientsByDeviceId as ReturnType<typeof vi.fn>).mockReturnValue(['client-1']);
    (executor.executeCommand as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Executor crashed'),
    );

    // Should not throw
    await scheduler.poll();

    // Should still update nextRun
    expect(taskRepo.updateRunResult).toHaveBeenCalledWith(
      'task-1',
      'user-1',
      'failed',
      expect.any(Date),
    );
  });

  it('should execute multiple due tasks', async () => {
    const tasks = [
      makeTask({ id: 'task-1', command: 'backup-db' }),
      makeTask({ id: 'task-2', command: 'rotate-logs' }),
    ];
    (taskRepo.findDueTasks as ReturnType<typeof vi.fn>).mockResolvedValue(tasks);
    (server.getClientsByDeviceId as ReturnType<typeof vi.fn>).mockReturnValue(['client-1']);

    await scheduler.poll();

    expect(executor.executeCommand).toHaveBeenCalledTimes(2);
    expect(executor.executeCommand).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'backup-db', taskId: 'task-1' }),
    );
    expect(executor.executeCommand).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'rotate-logs', taskId: 'task-2' }),
    );
  });
});

// ============================================================================
// findConnectedAgent
// ============================================================================

describe('findConnectedAgent', () => {
  it('should return client ID when agent is connected', () => {
    (server.getClientsByDeviceId as ReturnType<typeof vi.fn>).mockReturnValue(['client-abc']);
    const clientId = scheduler.findConnectedAgent('srv-1');
    expect(clientId).toBe('client-abc');
  });

  it('should return null when no agent is connected', () => {
    (server.getClientsByDeviceId as ReturnType<typeof vi.fn>).mockReturnValue([]);
    const clientId = scheduler.findConnectedAgent('srv-1');
    expect(clientId).toBeNull();
  });

  it('should return first client when multiple agents are connected', () => {
    (server.getClientsByDeviceId as ReturnType<typeof vi.fn>).mockReturnValue([
      'client-1',
      'client-2',
    ]);
    const clientId = scheduler.findConnectedAgent('srv-1');
    expect(clientId).toBe('client-1');
  });
});

// ============================================================================
// getServer
// ============================================================================

describe('getServer', () => {
  it('should return the WebSocket server reference', () => {
    expect(scheduler.getServer()).toBe(server);
  });
});
