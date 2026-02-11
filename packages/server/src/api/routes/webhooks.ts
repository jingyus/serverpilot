// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Webhook management routes.
 *
 * CRUD operations for webhook endpoints, delivery log inspection,
 * and test delivery triggering.
 *
 * @module api/routes/webhooks
 */

import { randomBytes } from 'node:crypto';
import { Hono } from 'hono';
import {
  CreateWebhookBodySchema,
  UpdateWebhookBodySchema,
  WebhookQuerySchema,
  WebhookTestBodySchema,
} from './schemas.js';
import { validateBody, validateQuery } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { ApiError } from '../middleware/error-handler.js';
import { getWebhookRepository } from '../../db/repositories/webhook-repository.js';
import { getWebhookDispatcher } from '../../core/webhook/dispatcher.js';
import { logger } from '../../utils/logger.js';
import type { CreateWebhookBody, UpdateWebhookBody, WebhookQuery, WebhookTestBody } from './schemas.js';
import type { ApiEnv } from './types.js';

const webhooksRoute = new Hono<ApiEnv>();

// All webhook routes require authentication
webhooksRoute.use('*', requireAuth);

// ============================================================================
// GET /webhooks — List user's webhooks
// ============================================================================

webhooksRoute.get('/', validateQuery(WebhookQuerySchema), async (c) => {
  const userId = c.get('userId');
  const query = c.get('validatedQuery') as WebhookQuery;
  const repo = getWebhookRepository();

  const result = await repo.listByUser(userId, {
    limit: query.limit,
    offset: query.offset,
  });

  // Strip secrets from response
  const safeWebhooks = result.webhooks.map((w) => ({
    ...w,
    secret: `${w.secret.substring(0, 4)}${'*'.repeat(Math.max(0, w.secret.length - 4))}`,
  }));

  return c.json({ webhooks: safeWebhooks, total: result.total });
});

// ============================================================================
// POST /webhooks — Create a webhook
// ============================================================================

webhooksRoute.post('/', validateBody(CreateWebhookBodySchema), async (c) => {
  const userId = c.get('userId');
  const body = c.get('validatedBody') as CreateWebhookBody;
  const repo = getWebhookRepository();

  // Generate a random secret if not provided
  const secret = body.secret ?? randomBytes(32).toString('hex');

  const webhook = await repo.create({
    userId,
    name: body.name,
    url: body.url,
    secret,
    events: body.events,
    maxRetries: body.maxRetries,
  });

  logger.info(
    { operation: 'webhook_create', webhookId: webhook.id, userId },
    `Webhook created: ${webhook.name}`,
  );

  return c.json({ webhook }, 201);
});

// ============================================================================
// GET /webhooks/:id — Get webhook details
// ============================================================================

webhooksRoute.get('/:id', async (c) => {
  const userId = c.get('userId');
  const { id } = c.req.param();
  const repo = getWebhookRepository();

  const webhook = await repo.findById(id, userId);
  if (!webhook) {
    throw ApiError.notFound('Webhook');
  }

  return c.json({ webhook });
});

// ============================================================================
// PATCH /webhooks/:id — Update a webhook
// ============================================================================

webhooksRoute.patch('/:id', validateBody(UpdateWebhookBodySchema), async (c) => {
  const userId = c.get('userId');
  const { id } = c.req.param();
  const body = c.get('validatedBody') as UpdateWebhookBody;
  const repo = getWebhookRepository();

  const webhook = await repo.update(id, userId, body);
  if (!webhook) {
    throw ApiError.notFound('Webhook');
  }

  logger.info(
    { operation: 'webhook_update', webhookId: id, userId },
    `Webhook updated: ${webhook.name}`,
  );

  return c.json({ webhook });
});

// ============================================================================
// DELETE /webhooks/:id — Delete a webhook
// ============================================================================

webhooksRoute.delete('/:id', async (c) => {
  const userId = c.get('userId');
  const { id } = c.req.param();
  const repo = getWebhookRepository();

  const deleted = await repo.delete(id, userId);
  if (!deleted) {
    throw ApiError.notFound('Webhook');
  }

  logger.info(
    { operation: 'webhook_delete', webhookId: id, userId },
    'Webhook deleted',
  );

  return c.json({ success: true });
});

// ============================================================================
// POST /webhooks/:id/test — Send a test event
// ============================================================================

webhooksRoute.post('/:id/test', validateBody(WebhookTestBodySchema), async (c) => {
  const userId = c.get('userId');
  const { id } = c.req.param();
  const body = c.get('validatedBody') as WebhookTestBody;
  const repo = getWebhookRepository();

  const webhook = await repo.findById(id, userId);
  if (!webhook) {
    throw ApiError.notFound('Webhook');
  }

  const dispatcher = getWebhookDispatcher();
  await dispatcher.dispatch({
    type: body.eventType,
    userId,
    data: {
      test: true,
      message: 'This is a test webhook delivery from ServerPilot',
      timestamp: new Date().toISOString(),
    },
  });

  return c.json({ success: true, message: 'Test event dispatched' });
});

// ============================================================================
// GET /webhooks/:id/deliveries — List delivery history
// ============================================================================

webhooksRoute.get('/:id/deliveries', validateQuery(WebhookQuerySchema), async (c) => {
  const userId = c.get('userId');
  const { id } = c.req.param();
  const query = c.get('validatedQuery') as WebhookQuery;
  const repo = getWebhookRepository();

  const result = await repo.listDeliveries(id, userId, {
    limit: query.limit,
    offset: query.offset,
  });

  return c.json(result);
});

export { webhooksRoute };
