// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for WebhookDispatcher — signing, retry logic, and delivery.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  signPayload,
  verifySignature,
  computeNextRetry,
  WebhookDispatcher,
  _resetWebhookDispatcher,
} from './dispatcher.js';

import type { WebhookRepository, Webhook, WebhookDelivery, CreateDeliveryInput, DeliveryStatus } from '../../db/repositories/webhook-repository.js';
import type { WebhookEventType } from '../../db/schema.js';

// ============================================================================
// Signing Tests
// ============================================================================

describe('signPayload / verifySignature', () => {
  it('should produce a valid HMAC-SHA256 hex signature', () => {
    const payload = '{"type":"task.completed","data":{}}';
    const secret = 'my-webhook-secret-key';
    const sig = signPayload(payload, secret);

    expect(sig).toMatch(/^[0-9a-f]{64}$/);
  });

  it('should verify a correct signature', () => {
    const payload = '{"test":true}';
    const secret = 'secret123';
    const sig = signPayload(payload, secret);

    expect(verifySignature(payload, secret, sig)).toBe(true);
  });

  it('should reject an incorrect signature', () => {
    const payload = '{"test":true}';
    const secret = 'secret123';
    const sig = signPayload(payload, secret);

    expect(verifySignature(payload, 'wrong-secret', sig)).toBe(false);
    expect(verifySignature('modified-payload', secret, sig)).toBe(false);
    expect(verifySignature(payload, secret, 'deadbeef'.repeat(8))).toBe(false);
  });

  it('should reject signatures of different length', () => {
    expect(verifySignature('payload', 'secret', 'short')).toBe(false);
  });
});

// ============================================================================
// computeNextRetry Tests
// ============================================================================

describe('computeNextRetry', () => {
  it('should return exponential backoff delays', () => {
    const now = Date.now();
    const r0 = computeNextRetry(0, 3);
    expect(r0).not.toBeNull();
    expect(r0!.getTime()).toBeGreaterThanOrEqual(now + 900);

    const r1 = computeNextRetry(1, 3);
    expect(r1).not.toBeNull();
    expect(r1!.getTime()).toBeGreaterThan(r0!.getTime());

    const r2 = computeNextRetry(2, 3);
    expect(r2).not.toBeNull();
    expect(r2!.getTime()).toBeGreaterThan(r1!.getTime());
  });

  it('should return null when max retries exceeded', () => {
    expect(computeNextRetry(3, 3)).toBeNull();
    expect(computeNextRetry(4, 3)).toBeNull();
  });

  it('should return null when maxRetries is 0', () => {
    expect(computeNextRetry(0, 0)).toBeNull();
  });
});

// ============================================================================
// WebhookDispatcher Tests
// ============================================================================

function createMockWebhook(overrides: Partial<Webhook> = {}): Webhook {
  return {
    id: 'wh-1',
    userId: 'user-1',
    tenantId: null,
    name: 'Test Hook',
    url: 'https://example.com/webhook',
    secret: 'test-secret-at-least-16',
    events: ['task.completed'] as WebhookEventType[],
    enabled: true,
    maxRetries: 3,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function createMockDelivery(overrides: Partial<WebhookDelivery> = {}): WebhookDelivery {
  return {
    id: 'del-1',
    webhookId: 'wh-1',
    eventType: 'task.completed',
    payload: { type: 'task.completed', data: {} },
    status: 'pending' as DeliveryStatus,
    httpStatus: null,
    responseBody: null,
    attempts: 0,
    lastAttemptAt: null,
    nextRetryAt: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function createMockRepo(): WebhookRepository {
  return {
    create: vi.fn(),
    findById: vi.fn(),
    findByIdInternal: vi.fn(),
    listByUser: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    findEnabledByEvent: vi.fn().mockResolvedValue([]),
    createDelivery: vi.fn().mockImplementation(async (input: CreateDeliveryInput) => createMockDelivery({ webhookId: input.webhookId, eventType: input.eventType, payload: input.payload })),
    updateDeliveryStatus: vi.fn().mockResolvedValue(true),
    findPendingRetries: vi.fn().mockResolvedValue([]),
    listDeliveries: vi.fn().mockResolvedValue({ deliveries: [], total: 0 }),
  };
}

describe('WebhookDispatcher', () => {
  let repo: ReturnType<typeof createMockRepo>;
  let dispatcher: WebhookDispatcher;

  beforeEach(() => {
    repo = createMockRepo();
    dispatcher = new WebhookDispatcher(repo, { retryIntervalMs: 60_000, requestTimeoutMs: 5_000 });
  });

  afterEach(() => {
    dispatcher.stop();
    _resetWebhookDispatcher();
  });

  it('should skip dispatch when no matching webhooks', async () => {
    (repo.findEnabledByEvent as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    await dispatcher.dispatch({
      type: 'task.completed',
      userId: 'user-1',
      data: { taskId: 'task-1' },
    });

    expect(repo.findEnabledByEvent).toHaveBeenCalledWith('task.completed', 'user-1');
    expect(repo.createDelivery).not.toHaveBeenCalled();
  });

  it('should create delivery and attempt HTTP request on dispatch', async () => {
    const hook = createMockWebhook();
    (repo.findEnabledByEvent as ReturnType<typeof vi.fn>).mockResolvedValue([hook]);

    // Mock fetch to return success
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('OK', { status: 200 }),
    );

    await dispatcher.dispatch({
      type: 'task.completed',
      userId: 'user-1',
      data: { taskId: 'task-1' },
    });

    expect(repo.createDelivery).toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://example.com/webhook',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'User-Agent': 'ServerPilot-Webhook/1.0',
        }),
      }),
    );

    // Should mark as success
    expect(repo.updateDeliveryStatus).toHaveBeenCalledWith(
      expect.any(String), 'success', 200, 'OK', null,
    );

    fetchSpy.mockRestore();
  });

  it('should include HMAC signature in headers', async () => {
    const hook = createMockWebhook({ secret: 'my-webhook-signing-secret' });
    (repo.findEnabledByEvent as ReturnType<typeof vi.fn>).mockResolvedValue([hook]);

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('OK', { status: 200 }),
    );

    await dispatcher.dispatch({
      type: 'task.completed',
      userId: 'user-1',
      data: {},
    });

    const callArgs = fetchSpy.mock.calls[0];
    const headers = (callArgs[1] as RequestInit).headers as Record<string, string>;
    expect(headers['X-Webhook-Signature']).toMatch(/^sha256=[0-9a-f]{64}$/);

    fetchSpy.mockRestore();
  });

  it('should schedule retry on HTTP failure', async () => {
    const hook = createMockWebhook();
    (repo.findEnabledByEvent as ReturnType<typeof vi.fn>).mockResolvedValue([hook]);
    (repo.listDeliveries as ReturnType<typeof vi.fn>).mockResolvedValue({
      deliveries: [createMockDelivery({ attempts: 0 })],
      total: 1,
    });

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Internal Server Error', { status: 500 }),
    );

    await dispatcher.dispatch({
      type: 'task.completed',
      userId: 'user-1',
      data: {},
    });

    // Should schedule retry (status = 'pending') not mark as success
    expect(repo.updateDeliveryStatus).toHaveBeenCalledWith(
      expect.any(String), 'pending', 500, 'Internal Server Error', expect.any(Date),
    );

    fetchSpy.mockRestore();
  });

  it('should mark delivery as failed after max retries', async () => {
    const hook = createMockWebhook({ maxRetries: 1 });
    (repo.findEnabledByEvent as ReturnType<typeof vi.fn>).mockResolvedValue([hook]);
    (repo.listDeliveries as ReturnType<typeof vi.fn>).mockResolvedValue({
      deliveries: [createMockDelivery({ attempts: 1 })],
      total: 1,
    });

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Bad Gateway', { status: 502 }),
    );

    await dispatcher.dispatch({
      type: 'task.completed',
      userId: 'user-1',
      data: {},
    });

    // Should mark as permanently failed (no more retries)
    expect(repo.updateDeliveryStatus).toHaveBeenCalledWith(
      expect.any(String), 'failed', 502, 'Bad Gateway', null,
    );

    fetchSpy.mockRestore();
  });

  it('should handle fetch network errors gracefully', async () => {
    const hook = createMockWebhook();
    (repo.findEnabledByEvent as ReturnType<typeof vi.fn>).mockResolvedValue([hook]);
    (repo.listDeliveries as ReturnType<typeof vi.fn>).mockResolvedValue({
      deliveries: [createMockDelivery({ attempts: 0 })],
      total: 1,
    });

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      new Error('ECONNREFUSED'),
    );

    await dispatcher.dispatch({
      type: 'task.completed',
      userId: 'user-1',
      data: {},
    });

    // Should schedule retry with error message
    expect(repo.updateDeliveryStatus).toHaveBeenCalledWith(
      expect.any(String), 'pending', null, 'ECONNREFUSED', expect.any(Date),
    );

    fetchSpy.mockRestore();
  });

  it('should process pending retries', async () => {
    const hook = createMockWebhook();
    const delivery = createMockDelivery({
      id: 'del-retry',
      webhookId: hook.id,
      payload: { type: 'task.completed', data: { retry: true } },
      nextRetryAt: new Date(Date.now() - 1000).toISOString(),
    });

    (repo.findPendingRetries as ReturnType<typeof vi.fn>).mockResolvedValue([delivery]);
    (repo.findByIdInternal as ReturnType<typeof vi.fn>).mockResolvedValue(hook);
    (repo.listDeliveries as ReturnType<typeof vi.fn>).mockResolvedValue({
      deliveries: [{ ...delivery, attempts: 1 }],
      total: 1,
    });

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('OK', { status: 200 }),
    );

    await dispatcher.processRetries();

    expect(repo.findPendingRetries).toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalled();
    expect(repo.updateDeliveryStatus).toHaveBeenCalledWith(
      'del-retry', 'success', 200, 'OK', null,
    );

    fetchSpy.mockRestore();
  });

  it('should mark delivery as failed when webhook is deleted during retry', async () => {
    const delivery = createMockDelivery({
      id: 'del-orphan',
      webhookId: 'deleted-wh',
    });

    (repo.findPendingRetries as ReturnType<typeof vi.fn>).mockResolvedValue([delivery]);
    (repo.findByIdInternal as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    await dispatcher.processRetries();

    expect(repo.updateDeliveryStatus).toHaveBeenCalledWith(
      'del-orphan', 'failed', null, 'Webhook no longer exists', null,
    );
  });

  it('should start and stop the retry timer', () => {
    dispatcher.start();
    // Starting again should be a no-op
    dispatcher.start();

    dispatcher.stop();
    // Stopping again should be a no-op
    dispatcher.stop();
  });
});
