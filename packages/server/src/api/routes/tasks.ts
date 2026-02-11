// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Task management routes.
 *
 * CRUD operations for scheduled tasks (cron-based),
 * plus manual task execution.
 *
 * Supports three creation modes:
 * - Manual creation via POST /tasks
 * - AI conversation-driven (chat handler creates tasks)
 * - Cron-driven execution via the TaskScheduler
 *
 * @module api/routes/tasks
 */

import { Hono } from 'hono';
import {
  CreateTaskBodySchema,
  UpdateTaskBodySchema,
  TaskQuerySchema,
} from './schemas.js';
import { validateBody, validateQuery } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { ApiError } from '../middleware/error-handler.js';
import { getTaskRepository } from '../../db/repositories/task-repository.js';
import { getNextRunDate } from '../../core/task/scheduler.js';
import { getTaskExecutor } from '../../core/task/executor.js';
import { getTaskScheduler } from '../../core/task/scheduler.js';
import { logger } from '../../utils/logger.js';
import type { CreateTaskBody, UpdateTaskBody, TaskQuery } from './schemas.js';
import type { ApiEnv } from './types.js';

const tasks = new Hono<ApiEnv>();

// All task routes require authentication
tasks.use('*', requireAuth);

// ============================================================================
// GET /tasks — List scheduled tasks
// ============================================================================

tasks.get('/', validateQuery(TaskQuerySchema), async (c) => {
  const userId = c.get('userId');
  const query = c.get('validatedQuery') as TaskQuery;
  const repo = getTaskRepository();

  if (query.serverId) {
    const result = await repo.listByServer(
      query.serverId,
      userId,
      { limit: query.limit, offset: query.offset },
    );
    return c.json(result);
  }

  if (query.status) {
    const result = await repo.findByStatus(
      userId,
      query.status,
      { limit: query.limit, offset: query.offset },
    );
    return c.json(result);
  }

  // Default: list all active tasks
  const result = await repo.findByStatus(
    userId,
    'active',
    { limit: query.limit, offset: query.offset },
  );
  return c.json(result);
});

// ============================================================================
// POST /tasks — Create a scheduled task
// ============================================================================

tasks.post('/', validateBody(CreateTaskBodySchema), async (c) => {
  const userId = c.get('userId');
  const body = c.get('validatedBody') as CreateTaskBody;
  const repo = getTaskRepository();

  const nextRun = getNextRunDate(body.cron);
  if (!nextRun) {
    throw ApiError.badRequest('Invalid cron expression — cannot compute next run');
  }

  try {
    const task = await repo.create({
      serverId: body.serverId,
      userId,
      name: body.name,
      cron: body.cron,
      command: body.command,
      description: body.description,
      nextRun,
    });

    logger.info(
      { operation: 'task_create', taskId: task.id, serverId: body.serverId, userId },
      `Scheduled task created: ${task.name}`,
    );

    return c.json({ task }, 201);
  } catch (error) {
    if (error instanceof Error && error.message.includes('access denied')) {
      throw ApiError.forbidden('Cannot create task for this server');
    }
    throw error;
  }
});

// ============================================================================
// GET /tasks/:id — Get task details
// ============================================================================

tasks.get('/:id', async (c) => {
  const userId = c.get('userId');
  const { id } = c.req.param();
  const repo = getTaskRepository();

  const task = await repo.getById(id, userId);
  if (!task) {
    throw ApiError.notFound('Task');
  }

  return c.json({ task });
});

// ============================================================================
// PATCH /tasks/:id — Update a task
// ============================================================================

tasks.patch('/:id', validateBody(UpdateTaskBodySchema), async (c) => {
  const userId = c.get('userId');
  const { id } = c.req.param();
  const body = c.get('validatedBody') as UpdateTaskBody;
  const repo = getTaskRepository();

  const task = await repo.update(id, userId, body);
  if (!task) {
    throw ApiError.notFound('Task');
  }

  // If cron expression changed, recalculate nextRun
  if (body.cron) {
    const nextRun = getNextRunDate(body.cron);
    if (nextRun) {
      await repo.updateRunResult(id, userId, task.lastStatus ?? 'success', nextRun);
    }
  }

  const updated = await repo.getById(id, userId);

  logger.info(
    { operation: 'task_update', taskId: id, userId },
    `Scheduled task updated: ${updated?.name}`,
  );

  return c.json({ task: updated });
});

// ============================================================================
// DELETE /tasks/:id — Soft-delete a task
// ============================================================================

tasks.delete('/:id', async (c) => {
  const userId = c.get('userId');
  const { id } = c.req.param();
  const repo = getTaskRepository();

  const deleted = await repo.delete(id, userId);
  if (!deleted) {
    throw ApiError.notFound('Task');
  }

  logger.info(
    { operation: 'task_delete', taskId: id, userId },
    'Scheduled task deleted',
  );

  return c.json({ success: true });
});

// ============================================================================
// POST /tasks/:id/run — Execute task immediately
// ============================================================================

tasks.post('/:id/run', async (c) => {
  const userId = c.get('userId');
  const { id } = c.req.param();
  const repo = getTaskRepository();

  const task = await repo.getById(id, userId);
  if (!task) {
    throw ApiError.notFound('Task');
  }

  // Find connected agent for the server
  const scheduler = getTaskScheduler();
  const clientId = scheduler.findConnectedAgent(task.serverId);
  if (!clientId) {
    throw ApiError.serverOffline();
  }

  const executor = getTaskExecutor();

  logger.info(
    { operation: 'task_run', taskId: id, userId, command: task.command },
    `Manual task execution: ${task.name}`,
  );

  const result = await executor.executeCommand({
    serverId: task.serverId,
    userId,
    clientId,
    command: task.command,
    description: `Manual run: ${task.name}`,
    riskLevel: 'green',
    type: 'execute',
    taskId: task.id,
    timeoutMs: 60_000,
  });

  // Update run result and recalculate nextRun
  const nextRun = getNextRunDate(task.cron);
  await repo.updateRunResult(
    id,
    userId,
    result.success ? 'success' : 'failed',
    nextRun,
  );

  return c.json({
    success: result.success,
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    duration: result.duration,
  });
});

export { tasks };
