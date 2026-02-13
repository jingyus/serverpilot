// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Skill export/import routes.
 *
 * Split from skills.ts to stay within the 500-line file limit.
 * Merged back into the main skillsRoute via `app.route()`.
 *
 * @module api/routes/skills-archive-routes
 */

import { join } from 'node:path';

import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth.js';
import { resolveRole, requirePermission } from '../middleware/rbac.js';
import { ApiError } from '../middleware/error-handler.js';
import { exportSkill, importSkill } from '../../core/skill/skill-archive.js';
import type { ApiEnv } from './types.js';

/** Default community skill directory (relative to process.cwd()). */
const COMMUNITY_SKILL_DIR = join(process.cwd(), 'skills', 'community');

const skillsArchiveRoute = new Hono<ApiEnv>();

// All archive routes require authentication + role resolution
skillsArchiveRoute.use('*', requireAuth, resolveRole);

// ============================================================================
// GET /skills/:id/export — Export a skill as .tar.gz archive
// ============================================================================

skillsArchiveRoute.get('/:id/export', requirePermission('skill:manage'), async (c) => {
  const skillId = c.req.param('id');

  try {
    const { filename, buffer } = await exportSkill(skillId);

    c.header('Content-Type', 'application/gzip');
    c.header('Content-Disposition', `attachment; filename="${filename}"`);
    c.header('Content-Length', String(buffer.length));

    return c.body(new Uint8Array(buffer));
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes('not found')) {
      throw ApiError.notFound('Skill');
    }
    if (msg.includes('does not exist')) {
      throw ApiError.badRequest(msg);
    }
    throw err;
  }
});

// ============================================================================
// POST /skills/import — Import a skill from .tar.gz archive
// ============================================================================

skillsArchiveRoute.post('/import', requirePermission('skill:manage'), async (c) => {
  const userId = c.get('userId');

  const body = await c.req.parseBody();
  const file = body['file'];

  if (!file || !(file instanceof File)) {
    throw ApiError.badRequest('Missing or invalid file upload. Send a .tar.gz file as "file" field.');
  }

  if (!file.name.endsWith('.tar.gz') && !file.name.endsWith('.tgz')) {
    throw ApiError.badRequest('File must be a .tar.gz or .tgz archive');
  }

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  try {
    const { skill, warnings } = await importSkill(buffer, userId, COMMUNITY_SKILL_DIR);
    return c.json({ skill, warnings }, 201);
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes('already installed')) {
      throw ApiError.badRequest(msg);
    }
    if (msg.includes('does not contain a valid skill') || msg.includes('Security scan failed')) {
      throw ApiError.badRequest(msg);
    }
    if (msg.includes('already exists')) {
      throw ApiError.badRequest(msg);
    }
    throw err;
  }
});

export { skillsArchiveRoute };
