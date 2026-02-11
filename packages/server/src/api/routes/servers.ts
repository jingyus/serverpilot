// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Server management routes.
 *
 * CRUD operations for managed servers, plus profile, metrics,
 * and operation history endpoints.
 *
 * @module api/routes/servers
 */

import { Hono } from 'hono';
import {
  CreateServerBodySchema,
  UpdateServerBodySchema,
  ServerMetricsQuerySchema,
  OperationQuerySchema,
  PaginationQuerySchema,
  AddNoteBodySchema,
  RemoveNoteBodySchema,
  UpdatePreferencesBodySchema,
  SetHistorySummaryBodySchema,
  RecordOperationBodySchema,
} from './schemas.js';
import { validateBody, validateQuery } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveRole, requirePermission } from '../middleware/rbac.js';
import { ApiError } from '../middleware/error-handler.js';
import { getServerRepository } from '../../db/repositories/server-repository.js';
import { getProfileRepository } from '../../db/repositories/profile-repository.js';
import { getMetricsRepository } from '../../db/repositories/metrics-repository.js';
import { getOperationHistoryService } from '../../core/operation/operation-history-service.js';
import { snapshots as snapshotsRouter } from './snapshots.js';
import { logger } from '../../utils/logger.js';
import type {
  CreateServerBody, UpdateServerBody, ServerMetricsQuery, PaginationQuery,
  OperationQuery,
  AddNoteBody, RemoveNoteBody, UpdatePreferencesBody,
  SetHistorySummaryBody, RecordOperationBody,
} from './schemas.js';
import type { ApiEnv } from './types.js';
import type { Server } from '../../db/repositories/server-repository.js';

const servers = new Hono<ApiEnv>();

// All server routes require authentication + role resolution
servers.use('*', requireAuth, resolveRole);

// ============================================================================
// Helpers
// ============================================================================

/** Strip the agent token from the response (only shown on create). */
function toPublicServer(server: Server) {
  const { agentToken: _, ...rest } = server;
  return rest;
}

// ============================================================================
// GET /servers — List all servers for the authenticated user
// ============================================================================

servers.get('/', requirePermission('server:read'), async (c) => {
  const userId = c.get('userId');
  const repo = getServerRepository();

  const list = await repo.findAllByUserId(userId);
  return c.json({ servers: list.map(toPublicServer), total: list.length });
});

// ============================================================================
// POST /servers — Add a new server (generates agent install token)
// ============================================================================

servers.post('/', requirePermission('server:create'), validateBody(CreateServerBodySchema), async (c) => {
  const userId = c.get('userId');
  const body = c.get('validatedBody') as CreateServerBody;
  const repo = getServerRepository();

  const server = await repo.create({
    name: body.name,
    userId,
    tags: body.tags,
  });

  logger.info(
    { operation: 'server_create', serverId: server.id, userId },
    `Server created: ${server.name}`,
  );

  // Return server with install details (agentToken exposed only at creation)
  const host = c.req.header('host') ?? 'localhost:3000';
  const protocol = c.req.header('x-forwarded-proto') ?? 'http';
  const wsUrl = `${protocol === 'https' ? 'wss' : 'ws'}://${host}`;
  const installCommand = `curl -fsSL ${protocol}://${host}/install.sh | bash -s -- --token ${server.agentToken} --server ${wsUrl}`;

  return c.json({
    server: toPublicServer(server),
    token: server.agentToken,
    installCommand,
  }, 201);
});

// ============================================================================
// GET /servers/:id — Get server details
// ============================================================================

servers.get('/:id', requirePermission('server:read'), async (c) => {
  const userId = c.get('userId');
  const { id } = c.req.param();
  const repo = getServerRepository();

  const server = await repo.findById(id, userId);
  if (!server) {
    throw ApiError.notFound('Server');
  }

  return c.json({ server: toPublicServer(server) });
});

// ============================================================================
// PATCH /servers/:id — Update server info
// ============================================================================

servers.patch('/:id', requirePermission('server:update'), validateBody(UpdateServerBodySchema), async (c) => {
  const userId = c.get('userId');
  const { id } = c.req.param();
  const body = c.get('validatedBody') as UpdateServerBody;
  const repo = getServerRepository();

  const server = await repo.update(id, userId, {
    name: body.name,
    tags: body.tags,
  });

  if (!server) {
    throw ApiError.notFound('Server');
  }

  logger.info(
    { operation: 'server_update', serverId: id, userId },
    `Server updated: ${server.name}`,
  );

  return c.json({ server: toPublicServer(server) });
});

// ============================================================================
// DELETE /servers/:id — Delete a server
// ============================================================================

servers.delete('/:id', requirePermission('server:delete'), async (c) => {
  const userId = c.get('userId');
  const { id } = c.req.param();
  const repo = getServerRepository();

  const deleted = await repo.delete(id, userId);
  if (!deleted) {
    throw ApiError.notFound('Server');
  }

  logger.info(
    { operation: 'server_delete', serverId: id, userId },
    'Server deleted',
  );

  return c.json({ success: true });
});

// ============================================================================
// GET /servers/:id/profile — Get server profile
// ============================================================================

servers.get('/:id/profile', requirePermission('server:read'), async (c) => {
  const userId = c.get('userId');
  const { id } = c.req.param();
  const repo = getServerRepository();

  const profile = await repo.getProfile(id, userId);
  if (!profile) {
    throw ApiError.notFound('Server');
  }

  return c.json({ profile });
});

// ============================================================================
// GET /servers/:id/metrics — Get monitoring metrics
// ============================================================================

servers.get('/:id/metrics', requirePermission('server:read'), validateQuery(ServerMetricsQuerySchema), async (c) => {
  const userId = c.get('userId');
  const { id } = c.req.param();
  const query = c.get('validatedQuery') as ServerMetricsQuery;
  const repo = getServerRepository();
  const metricsRepo = getMetricsRepository();

  // Verify server exists and belongs to user
  const server = await repo.findById(id, userId);
  if (!server) {
    throw ApiError.notFound('Server');
  }

  const metricsData = await metricsRepo.getByServerAndRange(id, userId, query.range);

  return c.json({ metrics: metricsData, range: query.range });
});

// ============================================================================
// GET /servers/:id/operations — Get operation records
// ============================================================================

servers.get('/:id/operations', requirePermission('operation:read'), validateQuery(OperationQuerySchema), async (c) => {
  const userId = c.get('userId');
  const { id } = c.req.param();
  const query = c.get('validatedQuery') as OperationQuery;
  const service = getOperationHistoryService();

  const result = await service.listOperations(
    userId,
    {
      serverId: id,
      type: query.type,
      status: query.status,
      riskLevel: query.riskLevel,
      search: query.search,
      startDate: query.startDate,
      endDate: query.endDate,
    },
    { limit: query.limit, offset: query.offset },
  );

  return c.json(result);
});

// ============================================================================
// POST /servers/:id/profile/notes — Add a note
// ============================================================================

servers.post('/:id/profile/notes', requirePermission('server:update'), validateBody(AddNoteBodySchema), async (c) => {
  const userId = c.get('userId');
  const { id } = c.req.param();
  const body = c.get('validatedBody') as AddNoteBody;
  const profileRepo = getProfileRepository();

  const result = await profileRepo.addNote(id, userId, body.note);
  if (!result) {
    throw ApiError.notFound('Server');
  }

  logger.info(
    { operation: 'profile_add_note', serverId: id, userId },
    'Note added to server profile',
  );

  return c.json({ success: true });
});

// ============================================================================
// DELETE /servers/:id/profile/notes — Remove a note by index
// ============================================================================

servers.delete('/:id/profile/notes', requirePermission('server:update'), validateBody(RemoveNoteBodySchema), async (c) => {
  const userId = c.get('userId');
  const { id } = c.req.param();
  const body = c.get('validatedBody') as RemoveNoteBody;
  const profileRepo = getProfileRepository();

  const result = await profileRepo.removeNote(id, userId, body.index);
  if (!result) {
    throw ApiError.notFound('Server or note index');
  }

  logger.info(
    { operation: 'profile_remove_note', serverId: id, userId, noteIndex: body.index },
    'Note removed from server profile',
  );

  return c.json({ success: true });
});

// ============================================================================
// PATCH /servers/:id/profile/preferences — Update preferences
// ============================================================================

servers.patch('/:id/profile/preferences', requirePermission('server:update'), validateBody(UpdatePreferencesBodySchema), async (c) => {
  const userId = c.get('userId');
  const { id } = c.req.param();
  const body = c.get('validatedBody') as UpdatePreferencesBody;
  const profileRepo = getProfileRepository();

  const result = await profileRepo.updatePreferences(id, userId, body);
  if (!result) {
    throw ApiError.notFound('Server');
  }

  logger.info(
    { operation: 'profile_update_preferences', serverId: id, userId },
    'Server profile preferences updated',
  );

  const profile = await profileRepo.getByServerId(id, userId);
  return c.json({ preferences: profile?.preferences ?? null });
});

// ============================================================================
// POST /servers/:id/profile/history — Record an operation in history
// ============================================================================

servers.post('/:id/profile/history', requirePermission('server:update'), validateBody(RecordOperationBodySchema), async (c) => {
  const userId = c.get('userId');
  const { id } = c.req.param();
  const body = c.get('validatedBody') as RecordOperationBody;
  const profileRepo = getProfileRepository();

  const timestamp = new Date().toISOString();
  const entry = `[${timestamp}] ${body.summary}`;

  const result = await profileRepo.addOperationHistory(id, userId, entry);
  if (!result) {
    throw ApiError.notFound('Server');
  }

  logger.info(
    { operation: 'profile_record_history', serverId: id, userId },
    `Operation recorded: ${body.summary}`,
  );

  return c.json({ success: true });
});

// ============================================================================
// GET /servers/:id/profile/history — Get operation history
// ============================================================================

servers.get('/:id/profile/history', requirePermission('server:read'), validateQuery(PaginationQuerySchema), async (c) => {
  const userId = c.get('userId');
  const { id } = c.req.param();
  const query = c.get('validatedQuery') as PaginationQuery;
  const profileRepo = getProfileRepository();

  const history = await profileRepo.getOperationHistory(id, userId);
  const total = history.length;
  const paginated = history.slice(query.offset, query.offset + query.limit);

  return c.json({ history: paginated, total });
});

// ============================================================================
// PUT /servers/:id/profile/summary — Set history summary (after summarization)
// ============================================================================

servers.put('/:id/profile/summary', requirePermission('server:update'), validateBody(SetHistorySummaryBodySchema), async (c) => {
  const userId = c.get('userId');
  const { id } = c.req.param();
  const body = c.get('validatedBody') as SetHistorySummaryBody;
  const profileRepo = getProfileRepository();

  const result = await profileRepo.setHistorySummary(id, userId, body.summary);
  if (!result) {
    throw ApiError.notFound('Server');
  }

  // Trim old history entries, keeping only recent ones
  await profileRepo.trimOperationHistory(id, userId, body.keepRecentCount);

  logger.info(
    { operation: 'profile_set_summary', serverId: id, userId },
    'History summary set and old entries trimmed',
  );

  return c.json({ success: true });
});

// ============================================================================
// GET /servers/:id/profile/summary — Get history summary
// ============================================================================

servers.get('/:id/profile/summary', requirePermission('server:read'), async (c) => {
  const userId = c.get('userId');
  const { id } = c.req.param();
  const profileRepo = getProfileRepository();

  const profile = await profileRepo.getByServerId(id, userId);
  if (!profile) {
    throw ApiError.notFound('Server');
  }

  return c.json({ summary: profile.historySummary });
});

// ============================================================================
// Snapshot sub-routes: /servers/:serverId/snapshots/*
// ============================================================================

servers.route('/:serverId/snapshots', snapshotsRouter);

export { servers };
