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

import { randomBytes } from "node:crypto";
import { Hono } from "hono";
import { validateBody, validateQuery } from "../middleware/validate.js";
import { requireAuth } from "../middleware/auth.js";
import { resolveRole, requirePermission } from "../middleware/rbac.js";
import { ApiError } from "../middleware/error-handler.js";
import { getWebhookRepository } from "../../db/repositories/webhook-repository.js";
import { getWebhookDispatcher } from "../../core/webhook/dispatcher.js";
import { logger } from "../../utils/logger.js";
import {
  CreateWebhookBodySchema,
  UpdateWebhookBodySchema,
  WebhookQuerySchema,
  WebhookTestBodySchema,
} from "./schemas.js";
import type {
  CreateWebhookBody,
  UpdateWebhookBody,
  WebhookQuery,
  WebhookTestBody,
} from "./schemas.js";
import type { ApiEnv } from "./types.js";

const webhooksRoute = new Hono<ApiEnv>();

// All webhook routes require authentication
webhooksRoute.use("*", requireAuth, resolveRole);

// ============================================================================
// GET /webhooks — List user's webhooks
// ============================================================================

webhooksRoute.get(
  "/",
  requirePermission("webhook:read"),
  validateQuery(WebhookQuerySchema),
  async (c) => {
    const userId = c.get("userId");
    const query = c.get("validatedQuery") as WebhookQuery;
    const repo = getWebhookRepository();

    const result = await repo.listByUser(userId, {
      limit: query.limit,
      offset: query.offset,
    });

    // Strip secrets from response
    const safeWebhooks = result.webhooks.map((w) => ({
      ...w,
      secret: `${w.secret.substring(0, 4)}${"*".repeat(Math.max(0, w.secret.length - 4))}`,
    }));

    return c.json({ webhooks: safeWebhooks, total: result.total });
  },
);

// ============================================================================
// POST /webhooks — Create a webhook
// ============================================================================

webhooksRoute.post(
  "/",
  requirePermission("webhook:create"),
  validateBody(CreateWebhookBodySchema),
  async (c) => {
    const userId = c.get("userId");
    const body = c.get("validatedBody") as CreateWebhookBody;
    const repo = getWebhookRepository();

    // Generate a random secret if not provided
    const secret = body.secret ?? randomBytes(32).toString("hex");

    const webhook = await repo.create({
      userId,
      name: body.name,
      url: body.url,
      secret,
      events: body.events,
      maxRetries: body.maxRetries,
    });

    logger.info(
      { operation: "webhook_create", webhookId: webhook.id, userId },
      `Webhook created: ${webhook.name}`,
    );

    return c.json({ webhook }, 201);
  },
);

// ============================================================================
// GET /webhooks/:id — Get webhook details
// ============================================================================

webhooksRoute.get("/:id", requirePermission("webhook:read"), async (c) => {
  const userId = c.get("userId");
  const { id } = c.req.param();
  const repo = getWebhookRepository();

  const webhook = await repo.findById(id, userId);
  if (!webhook) {
    throw ApiError.notFound("Webhook");
  }

  return c.json({ webhook });
});

// ============================================================================
// PATCH /webhooks/:id — Update a webhook
// ============================================================================

webhooksRoute.patch(
  "/:id",
  requirePermission("webhook:update"),
  validateBody(UpdateWebhookBodySchema),
  async (c) => {
    const userId = c.get("userId");
    const { id } = c.req.param();
    const body = c.get("validatedBody") as UpdateWebhookBody;
    const repo = getWebhookRepository();

    const webhook = await repo.update(id, userId, body);
    if (!webhook) {
      throw ApiError.notFound("Webhook");
    }

    logger.info(
      { operation: "webhook_update", webhookId: id, userId },
      `Webhook updated: ${webhook.name}`,
    );

    return c.json({ webhook });
  },
);

// ============================================================================
// DELETE /webhooks/:id — Delete a webhook
// ============================================================================

webhooksRoute.delete("/:id", requirePermission("webhook:delete"), async (c) => {
  const userId = c.get("userId");
  const { id } = c.req.param();
  const repo = getWebhookRepository();

  const deleted = await repo.delete(id, userId);
  if (!deleted) {
    throw ApiError.notFound("Webhook");
  }

  logger.info(
    { operation: "webhook_delete", webhookId: id, userId },
    "Webhook deleted",
  );

  return c.json({ success: true });
});

// ============================================================================
// POST /webhooks/:id/test — Send a test event
// ============================================================================

webhooksRoute.post(
  "/:id/test",
  requirePermission("webhook:update"),
  validateBody(WebhookTestBodySchema),
  async (c) => {
    const userId = c.get("userId");
    const { id } = c.req.param();
    const body = c.get("validatedBody") as WebhookTestBody;
    const repo = getWebhookRepository();

    const webhook = await repo.findById(id, userId);
    if (!webhook) {
      throw ApiError.notFound("Webhook");
    }

    const dispatcher = getWebhookDispatcher();
    await dispatcher.dispatch({
      type: body.eventType,
      userId,
      data: {
        test: true,
        message: "This is a test webhook delivery from ServerPilot",
        timestamp: new Date().toISOString(),
      },
    });

    return c.json({ success: true, message: "Test event dispatched" });
  },
);

// ============================================================================
// GET /webhooks/deliveries — List all deliveries across all webhooks
// ============================================================================

webhooksRoute.get(
  "/deliveries",
  requirePermission("webhook:read"),
  validateQuery(WebhookQuerySchema),
  async (c) => {
    const userId = c.get("userId");
    const query = c.get("validatedQuery") as WebhookQuery;
    const repo = getWebhookRepository();

    try {
      // Get all user's webhooks first
      const webhooks = await repo.listByUser(userId, {
        limit: 1000,
        offset: 0,
      });

      if (webhooks.webhooks.length === 0) {
        return c.json({ deliveries: [], total: 0 });
      }

      // Fetch deliveries for all webhooks and merge (with error handling per webhook)
      const deliveryPromises = webhooks.webhooks.map((webhook) =>
        repo
          .listDeliveries(webhook.id, userId, {
            limit: query.limit ?? 50,
            offset: 0,
          })
          .catch((err) => {
            logger.warn(
              { webhookId: webhook.id, error: err },
              "Failed to fetch deliveries for webhook",
            );
            return { deliveries: [], total: 0 };
          }),
      );

      const results = await Promise.all(deliveryPromises);

      // Merge and sort all deliveries by createdAt (newest first)
      const allDeliveries = results.flatMap((r) => r.deliveries);
      allDeliveries.sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );

      // Apply pagination to merged results
      const offset = query.offset ?? 0;
      const limit = query.limit ?? 50;
      const paginatedDeliveries = allDeliveries.slice(offset, offset + limit);

      return c.json({
        deliveries: paginatedDeliveries,
        total: allDeliveries.length,
      });
    } catch (err) {
      logger.error(
        { userId, error: err },
        "Failed to fetch webhook deliveries",
      );
      // Return empty result instead of error to prevent frontend infinite loops
      return c.json({ deliveries: [], total: 0 });
    }
  },
);

// ============================================================================
// GET /webhooks/:id/deliveries — List delivery history for a specific webhook
// ============================================================================

webhooksRoute.get(
  "/:id/deliveries",
  requirePermission("webhook:read"),
  validateQuery(WebhookQuerySchema),
  async (c) => {
    const userId = c.get("userId");
    const { id } = c.req.param();
    const query = c.get("validatedQuery") as WebhookQuery;
    const repo = getWebhookRepository();

    const result = await repo.listDeliveries(id, userId, {
      limit: query.limit,
      offset: query.offset,
    });

    return c.json(result);
  },
);

export { webhooksRoute };
