// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Operation history routes.
 *
 * Full audit trail API: list, filter, search, statistics,
 * and operation lifecycle management.
 *
 * @module api/routes/operations
 */

import { Hono } from 'hono';
import {
  OperationQuerySchema,
  OperationStatsQuerySchema,
  CreateOperationBodySchema,
  UpdateOperationStatusBodySchema,
} from './schemas.js';
import { validateBody, validateQuery } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { ApiError } from '../middleware/error-handler.js';
import { getOperationHistoryService } from '../../core/operation/operation-history-service.js';
import { logger } from '../../utils/logger.js';
import type {
  OperationQuery,
  OperationStatsQuery,
  CreateOperationBody,
  UpdateOperationStatusBody,
} from './schemas.js';
import type { ApiEnv } from './types.js';

const operations = new Hono<ApiEnv>();

// All operation routes require authentication
operations.use('*', requireAuth);

// ============================================================================
// GET /operations — List operations with filtering
// ============================================================================

operations.get('/', validateQuery(OperationQuerySchema), async (c) => {
  const userId = c.get('userId');
  const query = c.get('validatedQuery') as OperationQuery;
  const service = getOperationHistoryService();

  const result = await service.listOperations(
    userId,
    {
      serverId: query.serverId,
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
// GET /operations/stats — Get operation statistics
// ============================================================================

operations.get('/stats', validateQuery(OperationStatsQuerySchema), async (c) => {
  const userId = c.get('userId');
  const query = c.get('validatedQuery') as OperationStatsQuery;
  const service = getOperationHistoryService();

  const stats = await service.getStats(userId, query.serverId);
  return c.json({ stats });
});

// ============================================================================
// GET /operations/:id — Get operation by ID
// ============================================================================

operations.get('/:id', async (c) => {
  const userId = c.get('userId');
  const { id } = c.req.param();
  const service = getOperationHistoryService();

  const operation = await service.getById(id, userId);
  if (!operation) {
    throw ApiError.notFound('Operation');
  }

  return c.json({ operation });
});

// ============================================================================
// POST /operations — Create a new operation record
// ============================================================================

operations.post('/', validateBody(CreateOperationBodySchema), async (c) => {
  const userId = c.get('userId');
  const body = c.get('validatedBody') as CreateOperationBody;
  const service = getOperationHistoryService();

  const operation = await service.recordOperation({
    serverId: body.serverId,
    userId,
    sessionId: body.sessionId,
    type: body.type,
    description: body.description,
    commands: body.commands,
    riskLevel: body.riskLevel,
    snapshotId: body.snapshotId,
  });

  logger.info(
    { operation: 'operation_create', operationId: operation.id, userId },
    `Operation created: ${body.description}`,
  );

  return c.json({ operation }, 201);
});

// ============================================================================
// PATCH /operations/:id/status — Update operation status
// ============================================================================

operations.patch('/:id/status', validateBody(UpdateOperationStatusBodySchema), async (c) => {
  const userId = c.get('userId');
  const { id } = c.req.param();
  const body = c.get('validatedBody') as UpdateOperationStatusBody;
  const service = getOperationHistoryService();

  // Verify operation exists
  const existing = await service.getById(id, userId);
  if (!existing) {
    throw ApiError.notFound('Operation');
  }

  let result: boolean;

  if (body.status === 'running') {
    result = await service.markRunning(id, userId);
  } else {
    result = await service.markComplete(
      id,
      userId,
      body.output ?? '',
      body.status,
      body.duration ?? 0,
    );
  }

  if (!result) {
    throw ApiError.badRequest('Cannot transition to requested status from current state');
  }

  const updated = await service.getById(id, userId);
  return c.json({ operation: updated });
});

export { operations };
