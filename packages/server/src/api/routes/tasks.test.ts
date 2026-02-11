// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for task management routes.
 *
 * Validates CRUD operations, cron expression validation,
 * and manual task execution endpoints.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';

import type { ApiEnv } from './types.js';
import type { TaskRepository, Task } from '../../db/repositories/task-repository.js';
import type { TaskExecutor, ExecutionResult } from '../../core/task/executor.js';
import { onError } from '../middleware/error-handler.js';

// ============================================================================
// Module Mocks — must be before imports of the module under test
// ============================================================================

const mockTaskRepo: TaskRepository = {
  create: vi.fn(),
  getById: vi.fn(),
  listByServer: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  findByStatus: vi.fn(),
  updateRunResult: vi.fn(async () => true),
  findDueTasks: vi.fn(async () => []),
};

const mockExecutor: TaskExecutor = {
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
} as unknown as TaskExecutor;

const mockScheduler = {
  findConnectedAgent: vi.fn(() => 'client-1'),
  getServer: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  isRunning: vi.fn(() => true),
  poll: vi.fn(),
};

vi.mock('../../db/repositories/task-repository.js', () => ({
  getTaskRepository: () => mockTaskRepo,
}));

vi.mock('../../core/task/executor.js', () => ({
  getTaskExecutor: () => mockExecutor,
}));

vi.mock('../../core/task/scheduler.js', async () => {
  const { CronExpressionParser } = await import('cron-parser');
  return {
    getTaskScheduler: () => mockScheduler,
    getNextRunDate: (cronExpr: string, from?: Date) => {
      try {
        const expr = CronExpressionParser.parse(cronExpr, {
          currentDate: from ?? new Date(),
          tz: 'UTC',
        });
        return expr.next().toDate();
      } catch {
        return null;
      }
    },
  };
});

vi.mock('../middleware/auth.js', () => ({
  requireAuth: vi.fn(async (c: { set: (k: string, v: string) => void }, next: () => Promise<void>) => {
    c.set('userId', 'user-1');
    await next();
  }),
}));

vi.mock('../middleware/rbac.js', () => ({
  resolveRole: vi.fn(async (c: Record<string, (k: string, v: string) => void>, next: () => Promise<void>) => {
    c.set('userRole', 'owner');
    await next();
  }),
  requirePermission: vi.fn(() => {
    return async (_c: unknown, next: () => Promise<void>) => {
      await next();
    };
  }),
  requireRole: vi.fn(() => {
    return async (_c: unknown, next: () => Promise<void>) => {
      await next();
    };
  }),
}));

vi.mock('../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Import after mocks
import { tasks } from './tasks.js';

// ============================================================================
// Test App Setup
// ============================================================================

function createTestApp() {
  const app = new Hono<ApiEnv>();
  app.route('/tasks', tasks);
  app.onError(onError);
  return app;
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: '550e8400-e29b-41d4-a716-446655440000',
    serverId: '550e8400-e29b-41d4-a716-446655440001',
    userId: 'user-1',
    name: 'Daily Backup',
    description: 'Backup database every day',
    cron: '0 2 * * *',
    command: 'pg_dump -U postgres mydb > /backup/db.sql',
    status: 'active',
    lastRun: null,
    lastStatus: null,
    nextRun: new Date('2026-02-10T02:00:00Z').toISOString(),
    createdAt: new Date('2026-02-09T00:00:00Z').toISOString(),
    ...overrides,
  };
}

// ============================================================================
// Setup
// ============================================================================

let app: ReturnType<typeof createTestApp>;

beforeEach(() => {
  app = createTestApp();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ============================================================================
// GET /tasks — List tasks
// ============================================================================

describe('GET /tasks', () => {
  it('should list active tasks by default', async () => {
    const taskList = [makeTask()];
    (mockTaskRepo.findByStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
      tasks: taskList,
      total: 1,
    });

    const res = await app.request('/tasks');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tasks).toHaveLength(1);
    expect(body.total).toBe(1);
    expect(mockTaskRepo.findByStatus).toHaveBeenCalledWith(
      'user-1',
      'active',
      expect.objectContaining({ limit: 50, offset: 0 }),
    );
  });

  it('should filter by serverId when provided', async () => {
    (mockTaskRepo.listByServer as ReturnType<typeof vi.fn>).mockResolvedValue({
      tasks: [],
      total: 0,
    });

    const res = await app.request(
      '/tasks?serverId=550e8400-e29b-41d4-a716-446655440001',
    );

    expect(res.status).toBe(200);
    expect(mockTaskRepo.listByServer).toHaveBeenCalledWith(
      '550e8400-e29b-41d4-a716-446655440001',
      'user-1',
      expect.objectContaining({ limit: 50, offset: 0 }),
    );
  });

  it('should filter by status when provided', async () => {
    (mockTaskRepo.findByStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
      tasks: [],
      total: 0,
    });

    const res = await app.request('/tasks?status=paused');

    expect(res.status).toBe(200);
    expect(mockTaskRepo.findByStatus).toHaveBeenCalledWith(
      'user-1',
      'paused',
      expect.any(Object),
    );
  });

  it('should support pagination', async () => {
    (mockTaskRepo.findByStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
      tasks: [],
      total: 100,
    });

    const res = await app.request('/tasks?limit=10&offset=20');

    expect(res.status).toBe(200);
    expect(mockTaskRepo.findByStatus).toHaveBeenCalledWith(
      'user-1',
      'active',
      { limit: 10, offset: 20 },
    );
  });
});

// ============================================================================
// POST /tasks — Create task
// ============================================================================

describe('POST /tasks', () => {
  it('should create a task with valid input', async () => {
    const newTask = makeTask();
    (mockTaskRepo.create as ReturnType<typeof vi.fn>).mockResolvedValue(newTask);

    const res = await app.request('/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        serverId: '550e8400-e29b-41d4-a716-446655440001',
        name: 'Daily Backup',
        cron: '0 2 * * *',
        command: 'pg_dump -U postgres mydb > /backup/db.sql',
        description: 'Backup database every day',
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.task.name).toBe('Daily Backup');
    expect(mockTaskRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        name: 'Daily Backup',
        cron: '0 2 * * *',
        nextRun: expect.any(Date),
      }),
    );
  });

  it('should reject invalid cron expression', async () => {
    const res = await app.request('/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        serverId: '550e8400-e29b-41d4-a716-446655440001',
        name: 'Bad Task',
        cron: 'invalid cron',
        command: 'echo test',
      }),
    });

    expect(res.status).toBe(400);
  });

  it('should reject missing required fields', async () => {
    const res = await app.request('/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Missing Server',
        cron: '0 2 * * *',
        command: 'echo test',
      }),
    });

    expect(res.status).toBe(400);
  });

  it('should return 403 when server access is denied', async () => {
    (mockTaskRepo.create as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Server not found or access denied'),
    );

    const res = await app.request('/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        serverId: '550e8400-e29b-41d4-a716-446655440001',
        name: 'Test',
        cron: '0 2 * * *',
        command: 'echo test',
      }),
    });

    expect(res.status).toBe(403);
  });
});

// ============================================================================
// GET /tasks/:id — Get task details
// ============================================================================

describe('GET /tasks/:id', () => {
  it('should return task by ID', async () => {
    const task = makeTask();
    (mockTaskRepo.getById as ReturnType<typeof vi.fn>).mockResolvedValue(task);

    const res = await app.request('/tasks/550e8400-e29b-41d4-a716-446655440000');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.task.id).toBe('550e8400-e29b-41d4-a716-446655440000');
    expect(mockTaskRepo.getById).toHaveBeenCalledWith(
      '550e8400-e29b-41d4-a716-446655440000',
      'user-1',
    );
  });

  it('should return 404 for non-existent task', async () => {
    (mockTaskRepo.getById as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const res = await app.request('/tasks/550e8400-e29b-41d4-a716-446655440099');

    expect(res.status).toBe(404);
  });
});

// ============================================================================
// PATCH /tasks/:id — Update task
// ============================================================================

describe('PATCH /tasks/:id', () => {
  it('should update task name', async () => {
    const task = makeTask();
    const updated = makeTask({ name: 'Weekly Backup' });
    (mockTaskRepo.update as ReturnType<typeof vi.fn>).mockResolvedValue(task);
    (mockTaskRepo.getById as ReturnType<typeof vi.fn>).mockResolvedValue(updated);

    const res = await app.request('/tasks/550e8400-e29b-41d4-a716-446655440000', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Weekly Backup' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.task.name).toBe('Weekly Backup');
  });

  it('should recalculate nextRun when cron is updated', async () => {
    const task = makeTask();
    (mockTaskRepo.update as ReturnType<typeof vi.fn>).mockResolvedValue(task);
    (mockTaskRepo.getById as ReturnType<typeof vi.fn>).mockResolvedValue(task);

    const res = await app.request('/tasks/550e8400-e29b-41d4-a716-446655440000', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cron: '0 4 * * *' }),
    });

    expect(res.status).toBe(200);
    expect(mockTaskRepo.updateRunResult).toHaveBeenCalledWith(
      '550e8400-e29b-41d4-a716-446655440000',
      'user-1',
      expect.any(String),
      expect.any(Date),
    );
  });

  it('should return 404 for non-existent task', async () => {
    (mockTaskRepo.update as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const res = await app.request('/tasks/550e8400-e29b-41d4-a716-446655440099', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Updated' }),
    });

    expect(res.status).toBe(404);
  });

  it('should update task status to paused', async () => {
    const task = makeTask({ status: 'paused' });
    (mockTaskRepo.update as ReturnType<typeof vi.fn>).mockResolvedValue(task);
    (mockTaskRepo.getById as ReturnType<typeof vi.fn>).mockResolvedValue(task);

    const res = await app.request('/tasks/550e8400-e29b-41d4-a716-446655440000', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'paused' }),
    });

    expect(res.status).toBe(200);
    expect(mockTaskRepo.update).toHaveBeenCalledWith(
      '550e8400-e29b-41d4-a716-446655440000',
      'user-1',
      expect.objectContaining({ status: 'paused' }),
    );
  });
});

// ============================================================================
// DELETE /tasks/:id — Soft-delete task
// ============================================================================

describe('DELETE /tasks/:id', () => {
  it('should soft-delete a task', async () => {
    (mockTaskRepo.delete as ReturnType<typeof vi.fn>).mockResolvedValue(true);

    const res = await app.request('/tasks/550e8400-e29b-41d4-a716-446655440000', {
      method: 'DELETE',
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it('should return 404 for non-existent task', async () => {
    (mockTaskRepo.delete as ReturnType<typeof vi.fn>).mockResolvedValue(false);

    const res = await app.request('/tasks/550e8400-e29b-41d4-a716-446655440099', {
      method: 'DELETE',
    });

    expect(res.status).toBe(404);
  });
});

// ============================================================================
// POST /tasks/:id/run — Execute task immediately
// ============================================================================

describe('POST /tasks/:id/run', () => {
  it('should execute task immediately when agent is connected', async () => {
    const task = makeTask();
    (mockTaskRepo.getById as ReturnType<typeof vi.fn>).mockResolvedValue(task);
    mockScheduler.findConnectedAgent.mockReturnValue('client-1');

    const res = await app.request('/tasks/550e8400-e29b-41d4-a716-446655440000/run', {
      method: 'POST',
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.exitCode).toBe(0);
    expect(body.stdout).toBe('ok');

    expect(mockExecutor.executeCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        serverId: '550e8400-e29b-41d4-a716-446655440001',
        userId: 'user-1',
        clientId: 'client-1',
        taskId: '550e8400-e29b-41d4-a716-446655440000',
      }),
    );
  });

  it('should return 503 when server is offline', async () => {
    const task = makeTask();
    (mockTaskRepo.getById as ReturnType<typeof vi.fn>).mockResolvedValue(task);
    mockScheduler.findConnectedAgent.mockReturnValue(null);

    const res = await app.request('/tasks/550e8400-e29b-41d4-a716-446655440000/run', {
      method: 'POST',
    });

    expect(res.status).toBe(503);
  });

  it('should return 404 for non-existent task', async () => {
    (mockTaskRepo.getById as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const res = await app.request('/tasks/550e8400-e29b-41d4-a716-446655440099/run', {
      method: 'POST',
    });

    expect(res.status).toBe(404);
  });

  it('should update run result after execution', async () => {
    const task = makeTask();
    (mockTaskRepo.getById as ReturnType<typeof vi.fn>).mockResolvedValue(task);
    mockScheduler.findConnectedAgent.mockReturnValue('client-1');

    await app.request('/tasks/550e8400-e29b-41d4-a716-446655440000/run', {
      method: 'POST',
    });

    expect(mockTaskRepo.updateRunResult).toHaveBeenCalledWith(
      '550e8400-e29b-41d4-a716-446655440000',
      'user-1',
      'success',
      expect.any(Date),
    );
  });

  it('should mark as failed when execution fails', async () => {
    const task = makeTask();
    (mockTaskRepo.getById as ReturnType<typeof vi.fn>).mockResolvedValue(task);
    mockScheduler.findConnectedAgent.mockReturnValue('client-1');
    (mockExecutor.executeCommand as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: false,
      executionId: 'exec-1',
      operationId: 'op-1',
      exitCode: 1,
      stdout: '',
      stderr: 'command failed',
      duration: 50,
      timedOut: false,
    });

    const res = await app.request('/tasks/550e8400-e29b-41d4-a716-446655440000/run', {
      method: 'POST',
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(false);

    expect(mockTaskRepo.updateRunResult).toHaveBeenCalledWith(
      '550e8400-e29b-41d4-a716-446655440000',
      'user-1',
      'failed',
      expect.any(Date),
    );
  });
});
