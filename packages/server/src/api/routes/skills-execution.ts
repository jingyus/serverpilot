// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Skill execution routes — execute, dry-run, cancel, confirm, reject, SSE stream.
 *
 * Split from skills.ts to stay within the 500-line file limit.
 * Merged back into the main skillsRoute via `app.route()`.
 *
 * @module api/routes/skills-execution
 */

import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import {
  ExecuteSkillBodySchema,
  DryRunSkillBodySchema,
  SkillExecutionQuerySchema,
} from './schemas.js';
import { validateBody, validateQuery } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveRole, requirePermission } from '../middleware/rbac.js';
import { ApiError } from '../middleware/error-handler.js';
import { getSkillEngine } from '../../core/skill/engine.js';
import { getSkillRepository } from '../../db/repositories/skill-repository.js';
import { getSkillEventBus } from '../../core/skill/skill-event-bus.js';
import type {
  ExecuteSkillBody,
  DryRunSkillBody,
  SkillExecutionQuery,
} from './schemas.js';
import type { ApiEnv } from './types.js';

const skillsExecutionRoute = new Hono<ApiEnv>();

// All execution routes require authentication + role resolution
skillsExecutionRoute.use('*', requireAuth, resolveRole);

// ============================================================================
// POST /skills/:id/execute — Manually execute a skill
// ============================================================================

skillsExecutionRoute.post('/:id/execute', requirePermission('skill:execute'), validateBody(ExecuteSkillBodySchema), async (c) => {
  const skillId = c.req.param('id');
  const userId = c.get('userId');
  const body = c.get('validatedBody') as ExecuteSkillBody;
  const engine = getSkillEngine();

  try {
    const result = await engine.execute({
      skillId,
      serverId: body.serverId,
      userId,
      triggerType: 'manual',
      config: body.config,
      dryRun: body.dryRun,
    });
    return c.json({ execution: result, ...(body.dryRun ? { dryRun: true } : {}) });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes('not found')) {
      throw ApiError.notFound('Skill');
    }
    if (msg.includes('not enabled')) {
      throw ApiError.badRequest(msg);
    }
    throw err;
  }
});

// ============================================================================
// POST /skills/:id/dry-run — Preview execution plan without side effects
// ============================================================================

skillsExecutionRoute.post('/:id/dry-run', requirePermission('skill:execute'), validateBody(DryRunSkillBodySchema), async (c) => {
  const skillId = c.req.param('id');
  const userId = c.get('userId');
  const body = c.get('validatedBody') as DryRunSkillBody;
  const engine = getSkillEngine();

  try {
    const result = await engine.execute({
      skillId,
      serverId: body.serverId,
      userId,
      triggerType: 'manual',
      config: body.config,
      dryRun: true,
    });
    return c.json({ execution: result, dryRun: true });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes('not found')) {
      throw ApiError.notFound('Skill');
    }
    if (msg.includes('not enabled')) {
      throw ApiError.badRequest(msg);
    }
    throw err;
  }
});

// ============================================================================
// GET /skills/:id/executions — Execution history for a skill
// ============================================================================

skillsExecutionRoute.get('/:id/executions', requirePermission('skill:view'), validateQuery(SkillExecutionQuerySchema), async (c) => {
  const skillId = c.req.param('id');
  const query = c.get('validatedQuery') as SkillExecutionQuery;
  const engine = getSkillEngine();

  // Verify skill exists
  const skill = await engine.getInstalled(skillId);
  if (!skill) {
    throw ApiError.notFound('Skill');
  }

  const executions = await engine.getExecutions(skillId, query.limit);
  return c.json({ executions });
});

// ============================================================================
// GET /skills/:id/executions/:eid — Single execution detail
// ============================================================================

skillsExecutionRoute.get('/:id/executions/:eid', requirePermission('skill:view'), async (c) => {
  const executionId = c.req.param('eid');
  const engine = getSkillEngine();
  const repo = getSkillRepository();

  const execution = await engine.getExecution(executionId);
  if (!execution) {
    throw ApiError.notFound('Execution');
  }

  const logs = await repo.getLogs(executionId);
  return c.json({ execution, logs });
});

// ============================================================================
// GET /skills/pending-confirmations — List pending confirmation executions
// ============================================================================

skillsExecutionRoute.get('/pending-confirmations', requirePermission('skill:execute'), async (c) => {
  const userId = c.get('userId');
  const engine = getSkillEngine();
  const executions = await engine.listPendingConfirmations(userId);
  return c.json({ executions });
});

// ============================================================================
// POST /skills/executions/:eid/confirm — Confirm a pending execution
// ============================================================================

skillsExecutionRoute.post('/executions/:eid/confirm', requirePermission('skill:execute'), async (c) => {
  const executionId = c.req.param('eid');
  const userId = c.get('userId');
  const engine = getSkillEngine();
  try {
    const result = await engine.confirmExecution(executionId, userId);
    return c.json({ execution: result });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes('not found')) {
      throw ApiError.notFound('Execution');
    }
    if (msg.includes('not pending confirmation') || msg.includes('has expired')) {
      throw ApiError.badRequest(msg);
    }
    throw err;
  }
});

// ============================================================================
// POST /skills/executions/:eid/reject — Reject a pending execution
// ============================================================================

skillsExecutionRoute.post('/executions/:eid/reject', requirePermission('skill:execute'), async (c) => {
  const executionId = c.req.param('eid');
  const userId = c.get('userId');
  const engine = getSkillEngine();
  try {
    await engine.rejectExecution(executionId, userId);
    return c.json({ success: true });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes('not found')) {
      throw ApiError.notFound('Execution');
    }
    if (msg.includes('not pending confirmation')) {
      throw ApiError.badRequest(msg);
    }
    throw err;
  }
});

// ============================================================================
// POST /skills/executions/:eid/cancel — Cancel a running execution
// ============================================================================

skillsExecutionRoute.post('/executions/:eid/cancel', requirePermission('skill:execute'), async (c) => {
  const executionId = c.req.param('eid');
  const engine = getSkillEngine();
  try {
    await engine.cancel(executionId);
    return c.json({ success: true });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes('not found or not running')) {
      throw ApiError.badRequest(msg);
    }
    throw err;
  }
});

// ============================================================================
// GET /skills/executions/:eid/stream — SSE execution progress stream
// ============================================================================

skillsExecutionRoute.get('/executions/:eid/stream', requirePermission('skill:view'), async (c) => {
  const executionId = c.req.param('eid');
  const engine = getSkillEngine();

  // Verify execution exists
  const execution = await engine.getExecution(executionId);
  if (!execution) {
    throw ApiError.notFound('Execution');
  }

  return streamSSE(c, async (stream) => {
    let unsubscribe: (() => void) | null = null;

    stream.onAbort(() => {
      unsubscribe?.();
    });

    const bus = getSkillEventBus();
    unsubscribe = bus.subscribe(executionId, async (event) => {
      try {
        await stream.writeSSE({
          event: event.type,
          data: JSON.stringify(event),
        });

        // Auto-close stream when execution finishes
        if (event.type === 'completed' || event.type === 'error') {
          unsubscribe?.();
        }
      } catch {
        // Client disconnected — cleanup handled by onAbort
      }
    });

    // Send initial connected event
    await stream.writeSSE({
      event: 'connected',
      data: JSON.stringify({ executionId }),
    });

    // Keep connection open until client disconnects or execution completes
    await new Promise<void>((resolve) => {
      stream.onAbort(() => resolve());
    });
  });
});

export { skillsExecutionRoute };
