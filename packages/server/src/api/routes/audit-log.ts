// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Audit log routes — query security audit trail.
 *
 * Provides GET /audit-log for querying command validation history
 * with filtering by server, time range, risk level, and action.
 *
 * @module api/routes/audit-log
 */

import { Hono } from 'hono';
import { z } from 'zod';

import { requireAuth } from '../middleware/auth.js';
import { resolveRole, requirePermission } from '../middleware/rbac.js';
import { getAuditLogger } from '../../core/security/audit-logger.js';
import type { ApiEnv } from './types.js';
import type { RiskLevel } from '@aiinstaller/shared';
import type { ValidationAction } from '../../core/security/command-validator.js';

const auditLog = new Hono<ApiEnv>();

auditLog.use('*', requireAuth, resolveRole);

// ============================================================================
// Query Schema
// ============================================================================

const AuditLogQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  serverId: z.string().optional(),
  riskLevel: z.enum(['green', 'yellow', 'red', 'critical', 'forbidden']).optional(),
  action: z.enum(['allowed', 'blocked', 'requires_confirmation']).optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
});

// ============================================================================
// GET /audit-log — Query audit logs
// ============================================================================

auditLog.get('/', requirePermission('audit-log:read'), async (c) => {
  const userId = c.get('userId');
  const rawQuery = c.req.query();
  const query = AuditLogQuerySchema.parse(rawQuery);

  const logger = getAuditLogger();
  const result = await logger.query(
    userId,
    {
      serverId: query.serverId,
      riskLevel: query.riskLevel as RiskLevel | undefined,
      action: query.action as ValidationAction | undefined,
      startDate: query.startDate,
      endDate: query.endDate,
    },
    {
      limit: query.limit,
      offset: query.offset,
    },
  );

  return c.json({
    logs: result.logs,
    total: result.total,
    limit: query.limit,
    offset: query.offset,
  });
});

export { auditLog };
