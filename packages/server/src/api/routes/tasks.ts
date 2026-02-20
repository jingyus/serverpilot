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

import { Hono } from "hono";
import { z } from "zod";
import { validateBody, validateQuery } from "../middleware/validate.js";
import { requireAuth } from "../middleware/auth.js";
import { resolveRole, requirePermission } from "../middleware/rbac.js";
import { ApiError } from "../middleware/error-handler.js";
import { getTaskRepository } from "../../db/repositories/task-repository.js";
import { getNextRunDate } from "../../core/task/scheduler.js";
import { getTaskExecutor } from "../../core/task/executor.js";
import { getTaskScheduler } from "../../core/task/scheduler.js";
import { logger } from "../../utils/logger.js";
import {
  CreateTaskBodySchema,
  UpdateTaskBodySchema,
  TaskQuerySchema,
} from "./schemas.js";
import type { CreateTaskBody, UpdateTaskBody, TaskQuery } from "./schemas.js";
import type { ApiEnv } from "./types.js";

const tasks = new Hono<ApiEnv>();

// All task routes require authentication
tasks.use("*", requireAuth, resolveRole);

// ============================================================================
// GET /tasks — List scheduled tasks
// ============================================================================

tasks.get(
  "/",
  requirePermission("task:read"),
  validateQuery(TaskQuerySchema),
  async (c) => {
    const userId = c.get("userId");
    const query = c.get("validatedQuery") as TaskQuery;
    const repo = getTaskRepository();

    if (query.serverId) {
      const result = await repo.listByServer(query.serverId, userId, {
        limit: query.limit,
        offset: query.offset,
      });
      return c.json(result);
    }

    if (query.status) {
      const result = await repo.findByStatus(userId, query.status, {
        limit: query.limit,
        offset: query.offset,
      });
      return c.json(result);
    }

    // Default: list all active tasks
    const result = await repo.findByStatus(userId, "active", {
      limit: query.limit,
      offset: query.offset,
    });
    return c.json(result);
  },
);

// ============================================================================
// POST /tasks — Create a scheduled task
// ============================================================================

tasks.post(
  "/",
  requirePermission("task:create"),
  validateBody(CreateTaskBodySchema),
  async (c) => {
    const userId = c.get("userId");
    const body = c.get("validatedBody") as CreateTaskBody;
    const repo = getTaskRepository();

    const nextRun = getNextRunDate(body.cron);
    if (!nextRun) {
      throw ApiError.badRequest(
        "Invalid cron expression — cannot compute next run",
      );
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
        {
          operation: "task_create",
          taskId: task.id,
          serverId: body.serverId,
          userId,
        },
        `Scheduled task created: ${task.name}`,
      );

      return c.json({ task }, 201);
    } catch (error) {
      if (error instanceof Error && error.message.includes("access denied")) {
        throw ApiError.forbidden("Cannot create task for this server");
      }
      throw error;
    }
  },
);

// ============================================================================
// GET /tasks/:id — Get task details
// ============================================================================

tasks.get("/:id", requirePermission("task:read"), async (c) => {
  const userId = c.get("userId");
  const { id } = c.req.param();
  const repo = getTaskRepository();

  const task = await repo.getById(id, userId);
  if (!task) {
    throw ApiError.notFound("Task");
  }

  return c.json({ task });
});

// ============================================================================
// PATCH /tasks/:id — Update a task
// ============================================================================

tasks.patch(
  "/:id",
  requirePermission("task:update"),
  validateBody(UpdateTaskBodySchema),
  async (c) => {
    const userId = c.get("userId");
    const { id } = c.req.param();
    const body = c.get("validatedBody") as UpdateTaskBody;
    const repo = getTaskRepository();

    const task = await repo.update(id, userId, body);
    if (!task) {
      throw ApiError.notFound("Task");
    }

    // If cron expression changed, recalculate nextRun
    if (body.cron) {
      const nextRun = getNextRunDate(body.cron);
      if (nextRun) {
        await repo.updateRunResult(
          id,
          userId,
          task.lastStatus ?? "success",
          nextRun,
        );
      }
    }

    const updated = await repo.getById(id, userId);

    logger.info(
      { operation: "task_update", taskId: id, userId },
      `Scheduled task updated: ${updated?.name}`,
    );

    return c.json({ task: updated });
  },
);

// ============================================================================
// DELETE /tasks/:id — Soft-delete a task
// ============================================================================

tasks.delete("/:id", requirePermission("task:delete"), async (c) => {
  const userId = c.get("userId");
  const { id } = c.req.param();
  const repo = getTaskRepository();

  const deleted = await repo.delete(id, userId);
  if (!deleted) {
    throw ApiError.notFound("Task");
  }

  logger.info(
    { operation: "task_delete", taskId: id, userId },
    "Scheduled task deleted",
  );

  return c.json({ success: true });
});

// ============================================================================
// POST /tasks/:id/run — Execute task immediately
// ============================================================================

tasks.post("/:id/run", requirePermission("task:update"), async (c) => {
  const userId = c.get("userId");
  const { id } = c.req.param();
  const repo = getTaskRepository();

  const task = await repo.getById(id, userId);
  if (!task) {
    throw ApiError.notFound("Task");
  }

  // Find connected agent for the server
  const scheduler = getTaskScheduler();
  const clientId = scheduler.findConnectedAgent(task.serverId);
  if (!clientId) {
    throw ApiError.serverOffline();
  }

  const executor = getTaskExecutor();

  logger.info(
    { operation: "task_run", taskId: id, userId, command: task.command },
    `Manual task execution: ${task.name}`,
  );

  const result = await executor.executeCommand({
    serverId: task.serverId,
    userId,
    clientId,
    command: task.command,
    description: `Manual run: ${task.name}`,
    riskLevel: "green",
    type: "execute",
    taskId: task.id,
    timeoutMs: 60_000,
  });

  // Update run result and recalculate nextRun
  const nextRun = getNextRunDate(task.cron);
  await repo.updateRunResult(
    id,
    userId,
    result.success ? "success" : "failed",
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

// ============================================================================
// GET /tasks/templates — List available task templates (Skills)
// ============================================================================

tasks.get("/templates", requirePermission("task:read"), async (c) => {
  const { getSkillRegistry } = await import("../../skills/skill-registry.js");
  const registry = getSkillRegistry();
  const templates = registry.list();

  // Return templates without function references
  const templatesData = templates.map((t) => ({
    name: t.name,
    description: t.description,
    defaultSchedule: t.defaultSchedule,
    executionMode: t.executionMode,
    configSchema: t.configSchema,
  }));

  return c.json({ templates: templatesData });
});

// ============================================================================
// POST /tasks/from-template — Create task from Skill template
// ============================================================================

const CreateFromTemplateBodySchema = z.object({
  skillName: z.string().min(1),
  taskName: z.string().min(1).optional(),
  serverId: z.string().uuid(),
  config: z.record(z.unknown()),
  schedule: z.string().optional(),
});

tasks.post(
  "/from-template",
  requirePermission("task:create"),
  validateBody(CreateFromTemplateBodySchema),
  async (c) => {
    const userId = c.get("userId");
    const body = c.get("validatedBody") as z.infer<
      typeof CreateFromTemplateBodySchema
    >;

    try {
      const { createTaskFromSkill } =
        await import("../../skills/skill-task-converter.js");
      const task = await createTaskFromSkill({
        skillName: body.skillName,
        taskName: body.taskName,
        serverId: body.serverId,
        userId,
        config: body.config,
        schedule: body.schedule,
      });

      logger.info(
        {
          operation: "task_from_template",
          taskId: task.id,
          userId,
          skillName: body.skillName,
        },
        `Task created from template: ${body.skillName}`,
      );

      return c.json({ task }, 201);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Failed to create task from template";
      throw ApiError.badRequest(message);
    }
  },
);

export { tasks };
