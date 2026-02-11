// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Alert rule management routes.
 *
 * Provides CRUD operations for alert threshold rules
 * including enable/disable and email recipient configuration.
 *
 * @module api/routes/alert-rules
 */

import { Hono } from 'hono';
import {
  CreateAlertRuleBodySchema,
  UpdateAlertRuleBodySchema,
  AlertRuleQuerySchema,
} from './schemas.js';
import { validateBody, validateQuery } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveRole, requirePermission } from '../middleware/rbac.js';
import { ApiError } from '../middleware/error-handler.js';
import { getAlertRuleRepository } from '../../db/repositories/alert-rule-repository.js';
import { logger } from '../../utils/logger.js';
import type {
  CreateAlertRuleBody,
  UpdateAlertRuleBody,
  AlertRuleQuery,
} from './schemas.js';
import type { ApiEnv } from './types.js';

const alertRules = new Hono<ApiEnv>();

alertRules.use('*', requireAuth, resolveRole);

// ============================================================================
// POST /alert-rules — Create a new alert rule
// ============================================================================

alertRules.post(
  '/',
  requirePermission('alert-rule:create'),
  validateBody(CreateAlertRuleBodySchema),
  async (c) => {
    const userId = c.get('userId');
    const body = c.get('validatedBody') as CreateAlertRuleBody;
    const repo = getAlertRuleRepository();

    try {
      const rule = await repo.create({
        serverId: body.serverId,
        userId,
        name: body.name,
        metricType: body.metricType,
        operator: body.operator,
        threshold: body.threshold,
        severity: body.severity,
        emailRecipients: body.emailRecipients,
        cooldownMinutes: body.cooldownMinutes,
      });

      logger.info(
        { operation: 'alert_rule_create', ruleId: rule.id, userId },
        'Alert rule created',
      );

      return c.json({ rule }, 201);
    } catch (error) {
      if (error instanceof Error && error.message.includes('access denied')) {
        throw ApiError.forbidden('Cannot create alert rule for this server');
      }
      throw error;
    }
  },
);

// ============================================================================
// GET /alert-rules — List alert rules
// ============================================================================

alertRules.get(
  '/',
  requirePermission('alert-rule:read'),
  validateQuery(AlertRuleQuerySchema),
  async (c) => {
    const userId = c.get('userId');
    const query = c.get('validatedQuery') as AlertRuleQuery;
    const repo = getAlertRuleRepository();

    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;

    if (query.serverId) {
      const result = await repo.listByServer(query.serverId, userId, { limit, offset });
      return c.json({ rules: result.rules, total: result.total, limit, offset });
    }

    const result = await repo.listByUser(userId, { limit, offset });
    return c.json({ rules: result.rules, total: result.total, limit, offset });
  },
);

// ============================================================================
// GET /alert-rules/:id — Get alert rule details
// ============================================================================

alertRules.get('/:id', requirePermission('alert-rule:read'), async (c) => {
  const userId = c.get('userId');
  const { id } = c.req.param();
  const repo = getAlertRuleRepository();

  const rule = await repo.getById(id, userId);
  if (!rule) {
    throw ApiError.notFound('Alert rule');
  }

  return c.json({ rule });
});

// ============================================================================
// PATCH /alert-rules/:id — Update alert rule
// ============================================================================

alertRules.patch(
  '/:id',
  requirePermission('alert-rule:update'),
  validateBody(UpdateAlertRuleBodySchema),
  async (c) => {
    const userId = c.get('userId');
    const { id } = c.req.param();
    const body = c.get('validatedBody') as UpdateAlertRuleBody;
    const repo = getAlertRuleRepository();

    const rule = await repo.update(id, userId, body);
    if (!rule) {
      throw ApiError.notFound('Alert rule');
    }

    logger.info(
      { operation: 'alert_rule_update', ruleId: id, userId },
      'Alert rule updated',
    );

    return c.json({ rule });
  },
);

// ============================================================================
// DELETE /alert-rules/:id — Delete alert rule
// ============================================================================

alertRules.delete('/:id', requirePermission('alert-rule:delete'), async (c) => {
  const userId = c.get('userId');
  const { id } = c.req.param();
  const repo = getAlertRuleRepository();

  const success = await repo.delete(id, userId);
  if (!success) {
    throw ApiError.notFound('Alert rule');
  }

  logger.info(
    { operation: 'alert_rule_delete', ruleId: id, userId },
    'Alert rule deleted',
  );

  return c.json({ success: true });
});

export { alertRules };
