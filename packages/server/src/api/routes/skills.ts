// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Skill management routes.
 *
 * CRUD operations for installed skills, configuration, execution,
 * and discovery of available skills.
 *
 * @module api/routes/skills
 */

import { join } from 'node:path';

import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import {
  InstallSkillBodySchema,
  ConfigureSkillBodySchema,
  UpdateSkillStatusBodySchema,
  ExecuteSkillBodySchema,
  SkillExecutionQuerySchema,
} from './schemas.js';
import { validateBody, validateQuery } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveRole, requirePermission } from '../middleware/rbac.js';
import { ApiError } from '../middleware/error-handler.js';
import { getSkillEngine } from '../../core/skill/engine.js';
import { getSkillEventBus } from '../../core/skill/skill-event-bus.js';
import { installFromGitUrl } from '../../core/skill/git-installer.js';
import type {
  InstallSkillBody,
  ConfigureSkillBody,
  UpdateSkillStatusBody,
  ExecuteSkillBody,
  SkillExecutionQuery,
} from './schemas.js';
import type { ApiEnv } from './types.js';

/** Default community skill directory (relative to process.cwd()). */
const COMMUNITY_SKILL_DIR = join(process.cwd(), 'skills', 'community');

const skillsRoute = new Hono<ApiEnv>();

// All skill routes require authentication + role resolution
skillsRoute.use('*', requireAuth, resolveRole);

// ============================================================================
// GET /skills — List installed skills
// ============================================================================

skillsRoute.get('/', requirePermission('skill:view'), async (c) => {
  const userId = c.get('userId');
  const engine = getSkillEngine();
  const skills = await engine.listInstalled(userId);
  return c.json({ skills });
});

// ============================================================================
// GET /skills/available — List available skills for installation
// ============================================================================

skillsRoute.get('/available', requirePermission('skill:view'), async (c) => {
  const userId = c.get('userId');
  const engine = getSkillEngine();
  const available = await engine.listAvailable(userId);
  return c.json({ skills: available });
});

// ============================================================================
// POST /skills/install — Install a skill
// ============================================================================

skillsRoute.post('/install', requirePermission('skill:manage'), validateBody(InstallSkillBodySchema), async (c) => {
  const userId = c.get('userId');
  const body = c.get('validatedBody') as InstallSkillBody;
  const engine = getSkillEngine();

  try {
    let skillDir: string;
    let source = body.source;
    let warnings: string[] = [];

    if (body.gitUrl) {
      // Clone from Git URL → install as community skill
      const gitResult = await installFromGitUrl(body.gitUrl, COMMUNITY_SKILL_DIR);
      skillDir = gitResult.skillDir;
      source = 'community';
      warnings = gitResult.warnings;
    } else {
      skillDir = body.skillDir!;
    }

    const skill = await engine.install(userId, skillDir, source);
    return c.json({ skill, warnings }, 201);
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes('already installed')) {
      throw ApiError.badRequest(msg);
    }
    if (msg.includes('Only HTTPS') || msg.includes('Invalid URL') || msg.includes('Git clone failed')) {
      throw ApiError.badRequest(msg);
    }
    throw err;
  }
});

// ============================================================================
// DELETE /skills/:id — Uninstall a skill
// ============================================================================

skillsRoute.delete('/:id', requirePermission('skill:manage'), async (c) => {
  const skillId = c.req.param('id');
  const engine = getSkillEngine();

  try {
    await engine.uninstall(skillId);
    return c.json({ success: true });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes('not found')) {
      throw ApiError.notFound('Skill');
    }
    throw err;
  }
});

// ============================================================================
// PUT /skills/:id/config — Configure skill inputs
// ============================================================================

skillsRoute.put('/:id/config', requirePermission('skill:manage'), validateBody(ConfigureSkillBodySchema), async (c) => {
  const skillId = c.req.param('id');
  const body = c.get('validatedBody') as ConfigureSkillBody;
  const engine = getSkillEngine();

  try {
    await engine.configure(skillId, body.config);
    return c.json({ success: true });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes('not found')) {
      throw ApiError.notFound('Skill');
    }
    throw err;
  }
});

// ============================================================================
// PUT /skills/:id/status — Enable / pause a skill
// ============================================================================

skillsRoute.put('/:id/status', requirePermission('skill:manage'), validateBody(UpdateSkillStatusBodySchema), async (c) => {
  const skillId = c.req.param('id');
  const body = c.get('validatedBody') as UpdateSkillStatusBody;
  const engine = getSkillEngine();

  try {
    await engine.updateStatus(skillId, body.status);
    return c.json({ success: true });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes('not found')) {
      throw ApiError.notFound('Skill');
    }
    if (msg.includes('Invalid status transition')) {
      throw ApiError.badRequest(msg);
    }
    throw err;
  }
});

// ============================================================================
// POST /skills/:id/execute — Manually execute a skill
// ============================================================================

skillsRoute.post('/:id/execute', requirePermission('skill:execute'), validateBody(ExecuteSkillBodySchema), async (c) => {
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
    });
    return c.json({ execution: result });
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

skillsRoute.get('/:id/executions', requirePermission('skill:view'), validateQuery(SkillExecutionQuerySchema), async (c) => {
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

skillsRoute.get('/:id/executions/:eid', requirePermission('skill:view'), async (c) => {
  const executionId = c.req.param('eid');
  const engine = getSkillEngine();

  const execution = await engine.getExecution(executionId);
  if (!execution) {
    throw ApiError.notFound('Execution');
  }

  return c.json({ execution });
});

// ============================================================================
// GET /skills/executions/:eid/stream — SSE execution progress stream
// ============================================================================

skillsRoute.get('/executions/:eid/stream', requirePermission('skill:view'), async (c) => {
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

export { skillsRoute };
