// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Skill management routes.
 *
 * CRUD operations for installed skills, configuration, discovery,
 * and health checks. Execution and archive routes are split into
 * separate modules and composed via `app.route()`.
 *
 * @module api/routes/skills
 */

import { join } from 'node:path';

import { Hono } from 'hono';
import {
  InstallSkillBodySchema,
  ConfigureSkillBodySchema,
  UpdateSkillStatusBodySchema,
} from './schemas.js';
import { validateBody } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveRole, requirePermission } from '../middleware/rbac.js';
import { ApiError } from '../middleware/error-handler.js';
import { getSkillEngine } from '../../core/skill/engine.js';
import { getSkillRepository } from '../../db/repositories/skill-repository.js';
import { installFromGitUrl } from '../../core/skill/git-installer.js';
import { skillsExecutionRoute } from './skills-execution.js';
import { skillsArchiveRoute } from './skills-archive-routes.js';
import type {
  InstallSkillBody,
  ConfigureSkillBody,
  UpdateSkillStatusBody,
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
  const skills = await engine.listInstalledWithInputs(userId);
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
// GET /skills/stats — Aggregated execution analytics
// ============================================================================

skillsRoute.get('/stats', requirePermission('skill:view'), async (c) => {
  const userId = c.get('userId');
  const fromParam = c.req.query('from');
  const toParam = c.req.query('to');
  const from = fromParam ? new Date(fromParam) : undefined;
  const to = toParam ? new Date(toParam) : undefined;

  const repo = getSkillRepository();
  const stats = await repo.getStats(userId, from, to);
  return c.json({ stats });
});

// ============================================================================
// GET /skills/health — Health check for all installed skills
// ============================================================================

skillsRoute.get('/health', requirePermission('skill:manage'), async (c) => {
  const engine = getSkillEngine();
  const report = await engine.healthCheck();
  return c.json({ report });
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
// PUT /skills/:id/upgrade — Upgrade a skill (preserve config + history)
// ============================================================================

skillsRoute.put('/:id/upgrade', requirePermission('skill:manage'), async (c) => {
  const skillId = c.req.param('id');
  const userId = c.get('userId');
  const engine = getSkillEngine();

  try {
    const skill = await engine.upgrade(skillId, userId);
    return c.json({ skill });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes('not found')) {
      throw ApiError.notFound('Skill');
    }
    if (msg.includes('Not authorized')) {
      throw ApiError.forbidden(msg);
    }
    if (msg.includes('Git clone failed') || msg.includes('validation failed') || msg.includes('Cannot determine')) {
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
// Compose sub-routes: execution + archive
// ============================================================================

skillsRoute.route('/', skillsExecutionRoute);
skillsRoute.route('/', skillsArchiveRoute);

export { skillsRoute };
