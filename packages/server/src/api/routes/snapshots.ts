// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Snapshot management routes with one-click rollback.
 *
 * Provides CRUD for snapshots plus the rollback endpoint
 * that restores files on the agent from snapshot data.
 *
 * @module api/routes/snapshots
 */

import { Hono } from 'hono';
import { z } from 'zod';

import { PaginationQuerySchema } from './schemas.js';
import { validateBody, validateQuery } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveRole, requirePermission } from '../middleware/rbac.js';
import { ApiError, ErrorCode } from '../middleware/error-handler.js';
import { getSnapshotRepository } from '../../db/repositories/snapshot-repository.js';
import { getRollbackService } from '../../core/rollback/rollback-service.js';
import { logger } from '../../utils/logger.js';
import type { PaginationQuery } from './schemas.js';
import type { ApiEnv } from './types.js';

const snapshots = new Hono<ApiEnv>();

// All snapshot routes require authentication
snapshots.use('*', requireAuth, resolveRole);

// ============================================================================
// Validation Schemas
// ============================================================================

const RollbackBodySchema = z.object({
  /** WebSocket client ID of the connected agent */
  clientId: z.string().min(1, 'Client ID is required'),
  /** Reason for the rollback */
  reason: z.string().min(1).max(500).default('User-initiated rollback'),
  /** Timeout in milliseconds */
  timeoutMs: z.number().int().positive().max(120_000).optional(),
});

type RollbackBody = z.infer<typeof RollbackBodySchema>;

// ============================================================================
// GET /servers/:serverId/snapshots — List snapshots for a server
// ============================================================================

snapshots.get('/', requirePermission('snapshot:read'), validateQuery(PaginationQuerySchema), async (c) => {
  const userId = c.get('userId');
  const serverId = c.req.param('serverId');
  const query = c.get('validatedQuery') as PaginationQuery;
  const repo = getSnapshotRepository();

  const result = await repo.listByServer(serverId, userId, {
    limit: query.limit,
    offset: query.offset,
  });

  return c.json(result);
});

// ============================================================================
// GET /servers/:serverId/snapshots/:snapshotId — Get snapshot details
// ============================================================================

snapshots.get('/:snapshotId', requirePermission('snapshot:read'), async (c) => {
  const userId = c.get('userId');
  const { snapshotId } = c.req.param();
  const repo = getSnapshotRepository();

  const snapshot = await repo.getById(snapshotId, userId);
  if (!snapshot) {
    throw ApiError.notFound('Snapshot');
  }

  return c.json({ snapshot });
});

// ============================================================================
// DELETE /servers/:serverId/snapshots/:snapshotId — Delete a snapshot
// ============================================================================

snapshots.delete('/:snapshotId', requirePermission('snapshot:create'), async (c) => {
  const userId = c.get('userId');
  const { snapshotId } = c.req.param();
  const repo = getSnapshotRepository();

  const deleted = await repo.delete(snapshotId, userId);
  if (!deleted) {
    throw ApiError.notFound('Snapshot');
  }

  logger.info(
    { operation: 'snapshot_delete', snapshotId, userId },
    'Snapshot deleted',
  );

  return c.json({ success: true });
});

// ============================================================================
// POST /servers/:serverId/snapshots/:snapshotId/rollback — One-click rollback
// ============================================================================

snapshots.post(
  '/:snapshotId/rollback',
  requirePermission('snapshot:create'),
  validateBody(RollbackBodySchema),
  async (c) => {
    const userId = c.get('userId');
    const { snapshotId } = c.req.param();
    const body = c.get('validatedBody') as RollbackBody;

    logger.info(
      { operation: 'rollback_initiate', snapshotId, userId, clientId: body.clientId },
      'Rollback initiated',
    );

    const rollbackService = getRollbackService();
    const result = await rollbackService.rollback({
      snapshotId,
      userId,
      clientId: body.clientId,
      reason: body.reason,
      timeoutMs: body.timeoutMs ?? 30_000,
    });

    if (!result.success) {
      logger.warn(
        { operation: 'rollback_failed', snapshotId, error: result.error },
        'Rollback failed',
      );

      if (result.error === 'Snapshot not found or access denied') {
        throw ApiError.notFound('Snapshot');
      }
      throw new ApiError(502, ErrorCode.INTERNAL_ERROR, result.error ?? 'Rollback failed');
    }

    logger.info(
      {
        operation: 'rollback_success',
        snapshotId,
        restoredCount: result.restoredCount,
        operationId: result.operationId,
      },
      'Rollback completed successfully',
    );

    return c.json({
      success: true,
      snapshotId: result.snapshotId,
      restoredCount: result.restoredCount,
      failedCount: result.failedCount,
      fileResults: result.fileResults,
      operationId: result.operationId,
    });
  },
);

export { snapshots };
