// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Webhook dispatcher — delivers webhook payloads to registered endpoints.
 *
 * Handles HMAC-SHA256 signing, HTTP delivery, exponential backoff retry,
 * and delivery status tracking.
 *
 * @module core/webhook/dispatcher
 */

import { createHmac, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { logger } from '../../utils/logger.js';
import { getWebhookRepository } from '../../db/repositories/webhook-repository.js';

import type { WebhookEventType } from '../../db/schema.js';
import type { Webhook, WebhookRepository } from '../../db/repositories/webhook-repository.js';

// ============================================================================
// Types
// ============================================================================

export interface WebhookEvent {
  type: WebhookEventType;
  userId: string;
  data: Record<string, unknown>;
}

/** Payload emitted after a successful dispatch (for subscribers like TriggerManager). */
export interface DispatchedEvent {
  type: string;
  data: Record<string, unknown>;
}

export interface WebhookDispatcherOptions {
  /** Interval (ms) between retry sweeps. Default 30_000 */
  retryIntervalMs?: number;
  /** HTTP request timeout (ms). Default 10_000 */
  requestTimeoutMs?: number;
}

// ============================================================================
// Signing
// ============================================================================

/**
 * Generate HMAC-SHA256 signature for a webhook payload.
 */
export function signPayload(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * Verify HMAC-SHA256 signature of a webhook payload.
 */
export function verifySignature(payload: string, secret: string, signature: string): boolean {
  const expected = signPayload(payload, secret);
  // Constant-time comparison
  if (expected.length !== signature.length) return false;
  let result = 0;
  for (let i = 0; i < expected.length; i++) {
    result |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return result === 0;
}

// ============================================================================
// Retry helpers
// ============================================================================

/** Compute next retry time with exponential backoff (1s, 4s, 9s, ...) */
export function computeNextRetry(attempt: number, maxRetries: number): Date | null {
  if (attempt >= maxRetries) return null;
  const delayMs = Math.pow(attempt + 1, 2) * 1000;
  return new Date(Date.now() + delayMs);
}

// ============================================================================
// Dispatcher
// ============================================================================

export class WebhookDispatcher {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private processing = false;
  private retryIntervalMs: number;
  private requestTimeoutMs: number;
  private emitter = new EventEmitter();

  constructor(
    private repo: WebhookRepository,
    options: WebhookDispatcherOptions = {},
  ) {
    this.retryIntervalMs = options.retryIntervalMs ?? 30_000;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 10_000;
  }

  /** Start the retry sweep timer. */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.timer = setInterval(() => this.processRetries(), this.retryIntervalMs);
    logger.info({ operation: 'webhook_dispatcher_start' }, 'Webhook dispatcher started');
  }

  /** Stop the retry sweep timer. */
  stop(): void {
    if (!this.running) return;
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.emitter.removeAllListeners();
    logger.info({ operation: 'webhook_dispatcher_stop' }, 'Webhook dispatcher stopped');
  }

  /**
   * Register a listener for dispatched events.
   * Called after `dispatch()` completes for each event, allowing external
   * modules (e.g. TriggerManager) to react to system events without coupling.
   */
  onDispatched(listener: (event: DispatchedEvent) => void): () => void {
    this.emitter.on('dispatched', listener);
    return () => { this.emitter.off('dispatched', listener); };
  }

  /**
   * Dispatch a webhook event to all matching endpoints.
   *
   * For each registered webhook that subscribes to this event type,
   * creates a delivery record and attempts immediate delivery.
   */
  async dispatch(event: WebhookEvent): Promise<void> {
    const hooks = await this.repo.findEnabledByEvent(event.type, event.userId);

    if (hooks.length > 0) {
      logger.info(
        { operation: 'webhook_dispatch', eventType: event.type, hookCount: hooks.length },
        `Dispatching ${event.type} to ${hooks.length} webhook(s)`,
      );

      await Promise.allSettled(
        hooks.map((hook) => this.deliverToWebhook(hook, event)),
      );
    }

    // Always notify subscribers (e.g. TriggerManager) regardless of webhook matches
    this.emitter.emit('dispatched', { type: event.type, data: event.data });
  }

  /**
   * Deliver to a single webhook endpoint. On failure, schedule retry.
   */
  private async deliverToWebhook(hook: Webhook, event: WebhookEvent): Promise<void> {
    const payload: Record<string, unknown> = {
      id: randomUUID(),
      type: event.type,
      timestamp: new Date().toISOString(),
      data: event.data,
    };

    const delivery = await this.repo.createDelivery({
      webhookId: hook.id,
      eventType: event.type,
      payload,
      nextRetryAt: new Date(), // ready for immediate attempt
    });

    await this.attemptDelivery(delivery.id, hook, payload);
  }

  /**
   * Attempt HTTP delivery of a payload to a webhook URL.
   */
  async attemptDelivery(
    deliveryId: string,
    hook: Webhook,
    payload: Record<string, unknown>,
  ): Promise<boolean> {
    const body = JSON.stringify(payload);
    const signature = signPayload(body, hook.secret);

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);

      const response = await fetch(hook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': `sha256=${signature}`,
          'X-Webhook-Event': payload.type as string,
          'X-Webhook-Delivery': deliveryId,
          'User-Agent': 'ServerPilot-Webhook/1.0',
        },
        body,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      const responseBody = await response.text().catch(() => '');
      const isSuccess = response.status >= 200 && response.status < 300;

      if (isSuccess) {
        await this.repo.updateDeliveryStatus(deliveryId, 'success', response.status, responseBody, null);
        logger.info(
          { operation: 'webhook_delivered', deliveryId, webhookId: hook.id, status: response.status },
          'Webhook delivered successfully',
        );
        return true;
      }

      // Failed - schedule retry
      await this.scheduleRetry(deliveryId, hook, response.status, responseBody);
      return false;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.warn(
        { operation: 'webhook_delivery_error', deliveryId, webhookId: hook.id, error: message },
        `Webhook delivery failed: ${message}`,
      );
      await this.scheduleRetry(deliveryId, hook, null, message);
      return false;
    }
  }

  /**
   * Schedule a retry or mark as permanently failed.
   */
  private async scheduleRetry(
    deliveryId: string,
    hook: Webhook,
    httpStatus: number | null,
    responseBody: string | null,
  ): Promise<void> {
    // Get current delivery to check attempt count
    const deliveries = await this.repo.listDeliveries(hook.id, hook.userId, { limit: 100, offset: 0 });
    const delivery = deliveries.deliveries.find((d) => d.id === deliveryId);
    const currentAttempt = delivery?.attempts ?? 0;

    const nextRetry = computeNextRetry(currentAttempt + 1, hook.maxRetries);

    if (nextRetry) {
      await this.repo.updateDeliveryStatus(deliveryId, 'pending', httpStatus, responseBody, nextRetry);
      logger.info(
        { operation: 'webhook_retry_scheduled', deliveryId, nextRetry: nextRetry.toISOString() },
        `Webhook retry scheduled for ${nextRetry.toISOString()}`,
      );
    } else {
      await this.repo.updateDeliveryStatus(deliveryId, 'failed', httpStatus, responseBody, null);
      logger.warn(
        { operation: 'webhook_delivery_failed', deliveryId, webhookId: hook.id },
        'Webhook delivery permanently failed after max retries',
      );
    }
  }

  /**
   * Process pending retries — called periodically by the timer.
   */
  async processRetries(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    try {
      const pendingDeliveries = await this.repo.findPendingRetries(new Date());
      if (pendingDeliveries.length === 0) return;

      logger.info(
        { operation: 'webhook_retry_sweep', count: pendingDeliveries.length },
        `Processing ${pendingDeliveries.length} pending webhook deliveries`,
      );

      for (const delivery of pendingDeliveries) {
        // Look up the webhook to get the secret and URL
        // We need to find it across all users, so we search by webhook ID
        const hook = await this.findWebhookById(delivery.webhookId);
        if (!hook) {
          // Webhook deleted — mark delivery as failed
          await this.repo.updateDeliveryStatus(delivery.id, 'failed', null, 'Webhook no longer exists', null);
          continue;
        }

        await this.attemptDelivery(delivery.id, hook, delivery.payload);
      }
    } catch (error) {
      logger.error(
        { operation: 'webhook_retry_error', error: (error as Error).message },
        'Error processing webhook retries',
      );
    } finally {
      this.processing = false;
    }
  }

  /**
   * Find a webhook by ID without user isolation (for retry processing).
   */
  private async findWebhookById(webhookId: string): Promise<Webhook | null> {
    return this.repo.findByIdInternal(webhookId);
  }
}

// ============================================================================
// Singleton
// ============================================================================

let _dispatcher: WebhookDispatcher | null = null;

export function getWebhookDispatcher(): WebhookDispatcher {
  if (!_dispatcher) {
    _dispatcher = new WebhookDispatcher(getWebhookRepository());
  }
  return _dispatcher;
}

export function setWebhookDispatcher(d: WebhookDispatcher): void {
  _dispatcher = d;
}

export function _resetWebhookDispatcher(): void {
  _dispatcher = null;
}
