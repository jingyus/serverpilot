// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Alert management routes.
 *
 * Provides read access to system alerts and the ability
 * to mark them as resolved.
 *
 * @module api/routes/alerts
 */

import { Hono } from 'hono';
import { AlertQuerySchema, PaginationQuerySchema } from './schemas.js';
import { validateQuery } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { ApiError } from '../middleware/error-handler.js';
import { getAlertRepository } from '../../db/repositories/alert-repository.js';
import { logger } from '../../utils/logger.js';
import type { AlertQuery, PaginationQuery } from './schemas.js';
import type { ApiEnv } from './types.js';

const alerts = new Hono<ApiEnv>();

// All alert routes require authentication
alerts.use('*', requireAuth);

// ============================================================================
// GET /alerts — List alerts
// ============================================================================

alerts.get(
  '/',
  validateQuery(AlertQuerySchema),
  async (c) => {
    const userId = c.get('userId');
    const query = c.get('validatedQuery') as AlertQuery & PaginationQuery;
    const repo = getAlertRepository();

    const limit = query.limit ?? 20;
    const offset = query.offset ?? 0;

    if (query.serverId) {
      // List alerts for a specific server
      const result = await repo.listByServer(query.serverId, userId, { limit, offset });

      return c.json({
        alerts: result.alerts,
        total: result.total,
        limit,
        offset,
      });
    } else if (query.resolved === false) {
      // List unresolved alerts across all servers
      const result = await repo.listUnresolved(userId, { limit, offset });

      return c.json({
        alerts: result.alerts,
        total: result.total,
        limit,
        offset,
      });
    } else {
      // Default: list unresolved alerts
      const result = await repo.listUnresolved(userId, { limit, offset });

      return c.json({
        alerts: result.alerts,
        total: result.total,
        limit,
        offset,
      });
    }
  },
);

// ============================================================================
// GET /alerts/:id — Get alert details
// ============================================================================

alerts.get('/:id', async (c) => {
  const userId = c.get('userId');
  const { id } = c.req.param();
  const repo = getAlertRepository();

  const alert = await repo.getById(id, userId);
  if (!alert) {
    throw ApiError.notFound('Alert');
  }

  return c.json({ alert });
});

// ============================================================================
// PATCH /alerts/:id/resolve — Mark alert as resolved
// ============================================================================

alerts.patch('/:id/resolve', async (c) => {
  const userId = c.get('userId');
  const { id } = c.req.param();
  const repo = getAlertRepository();

  const success = await repo.resolve(id, userId);
  if (!success) {
    throw ApiError.notFound('Alert');
  }

  const alert = await repo.getById(id, userId);

  logger.info(
    { operation: 'alert_resolve', alertId: id, userId },
    `Alert resolved`,
  );

  return c.json({ success: true, alert });
});

export { alerts };
