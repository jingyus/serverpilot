// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for webhook management routes.
 *
 * Validates CRUD operations, test delivery, and delivery log endpoints.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';

import type { ApiEnv } from './types.js';
import type { WebhookRepository, Webhook, WebhookDelivery } from '../../db/repositories/webhook-repository.js';
import { onError } from '../middleware/error-handler.js';

// ============================================================================
// Module Mocks
// ============================================================================

const mockWebhookRepo: WebhookRepository = {
  create: vi.fn(),
  findById: vi.fn(),
  findByIdInternal: vi.fn(),
  listByUser: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  findEnabledByEvent: vi.fn(async () => []),
  createDelivery: vi.fn(),
  updateDeliveryStatus: vi.fn(async () => true),
  findPendingRetries: vi.fn(async () => []),
  listDeliveries: vi.fn(async () => ({ deliveries: [], total: 0 })),
};

const mockDispatcher = {
  dispatch: vi.fn(async () => {}),
  start: vi.fn(),
  stop: vi.fn(),
  processRetries: vi.fn(),
  attemptDelivery: vi.fn(),
};

vi.mock('../../db/repositories/webhook-repository.js', () => ({
  getWebhookRepository: () => mockWebhookRepo,
}));

vi.mock('../../core/webhook/dispatcher.js', () => ({
  getWebhookDispatcher: () => mockDispatcher,
}));

vi.mock('../middleware/auth.js', () => ({
  requireAuth: vi.fn(async (c: { set: (k: string, v: string) => void }, next: () => Promise<void>) => {
    c.set('userId', 'user-1');
    await next();
  }),
}));

vi.mock('../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Import after mocks
import { webhooksRoute } from './webhooks.js';

// ============================================================================
// Test App Setup
// ============================================================================

function createTestApp() {
  const app = new Hono<ApiEnv>();
  app.route('/webhooks', webhooksRoute);
  app.onError(onError);
  return app;
}

function makeWebhook(overrides: Partial<Webhook> = {}): Webhook {
  return {
    id: '550e8400-e29b-41d4-a716-446655440000',
    userId: 'user-1',
    tenantId: null,
    name: 'Test Webhook',
    url: 'https://example.com/webhook',
    secret: 'my-very-long-secret-key-for-testing',
    events: ['task.completed', 'alert.triggered'],
    enabled: true,
    maxRetries: 3,
    createdAt: '2026-02-09T00:00:00.000Z',
    updatedAt: '2026-02-09T00:00:00.000Z',
    ...overrides,
  };
}

function makeDelivery(overrides: Partial<WebhookDelivery> = {}): WebhookDelivery {
  return {
    id: 'del-1',
    webhookId: '550e8400-e29b-41d4-a716-446655440000',
    eventType: 'task.completed',
    payload: { type: 'task.completed', data: {} },
    status: 'success',
    httpStatus: 200,
    responseBody: 'OK',
    attempts: 1,
    lastAttemptAt: '2026-02-09T00:01:00.000Z',
    nextRetryAt: null,
    createdAt: '2026-02-09T00:00:00.000Z',
    ...overrides,
  };
}

// ============================================================================
// Setup
// ============================================================================

let app: ReturnType<typeof createTestApp>;

beforeEach(() => {
  app = createTestApp();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ============================================================================
// GET /webhooks — List webhooks
// ============================================================================

describe('GET /webhooks', () => {
  it('should list webhooks with masked secrets', async () => {
    (mockWebhookRepo.listByUser as ReturnType<typeof vi.fn>).mockResolvedValue({
      webhooks: [makeWebhook()],
      total: 1,
    });

    const res = await app.request('/webhooks');
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.total).toBe(1);
    expect(body.webhooks).toHaveLength(1);
    // Secret should be masked
    expect(body.webhooks[0].secret).toMatch(/^my-v\*+$/);
    expect(body.webhooks[0].secret).not.toBe('my-very-long-secret-key-for-testing');
  });
});

// ============================================================================
// POST /webhooks — Create webhook
// ============================================================================

describe('POST /webhooks', () => {
  it('should create a webhook', async () => {
    const webhook = makeWebhook();
    (mockWebhookRepo.create as ReturnType<typeof vi.fn>).mockResolvedValue(webhook);

    const res = await app.request('/webhooks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Test Webhook',
        url: 'https://example.com/webhook',
        events: ['task.completed', 'alert.triggered'],
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.webhook.name).toBe('Test Webhook');
    expect(mockWebhookRepo.create).toHaveBeenCalled();
  });

  it('should auto-generate a secret if not provided', async () => {
    const webhook = makeWebhook();
    (mockWebhookRepo.create as ReturnType<typeof vi.fn>).mockResolvedValue(webhook);

    await app.request('/webhooks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'No Secret',
        url: 'https://example.com/webhook',
        events: ['task.completed'],
      }),
    });

    const createCall = (mockWebhookRepo.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(createCall.secret).toBeTruthy();
    expect(createCall.secret.length).toBeGreaterThanOrEqual(16);
  });

  it('should reject invalid URL', async () => {
    const res = await app.request('/webhooks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Bad URL',
        url: 'not-a-url',
        events: ['task.completed'],
      }),
    });

    expect(res.status).toBe(400);
  });

  it('should reject empty events array', async () => {
    const res = await app.request('/webhooks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'No Events',
        url: 'https://example.com/webhook',
        events: [],
      }),
    });

    expect(res.status).toBe(400);
  });

  it('should reject invalid event type', async () => {
    const res = await app.request('/webhooks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Bad Event',
        url: 'https://example.com/webhook',
        events: ['invalid.event'],
      }),
    });

    expect(res.status).toBe(400);
  });
});

// ============================================================================
// GET /webhooks/:id — Get webhook details
// ============================================================================

describe('GET /webhooks/:id', () => {
  it('should return webhook details', async () => {
    const webhook = makeWebhook();
    (mockWebhookRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(webhook);

    const res = await app.request('/webhooks/550e8400-e29b-41d4-a716-446655440000');
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.webhook.name).toBe('Test Webhook');
  });

  it('should return 404 for non-existent webhook', async () => {
    (mockWebhookRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const res = await app.request('/webhooks/non-existent-id');
    expect(res.status).toBe(404);
  });
});

// ============================================================================
// PATCH /webhooks/:id — Update webhook
// ============================================================================

describe('PATCH /webhooks/:id', () => {
  it('should update a webhook', async () => {
    const updated = makeWebhook({ name: 'Updated Webhook', enabled: false });
    (mockWebhookRepo.update as ReturnType<typeof vi.fn>).mockResolvedValue(updated);

    const res = await app.request('/webhooks/550e8400-e29b-41d4-a716-446655440000', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Updated Webhook', enabled: false }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.webhook.name).toBe('Updated Webhook');
    expect(body.webhook.enabled).toBe(false);
  });

  it('should return 404 when webhook not found', async () => {
    (mockWebhookRepo.update as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const res = await app.request('/webhooks/missing', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Updated' }),
    });

    expect(res.status).toBe(404);
  });
});

// ============================================================================
// DELETE /webhooks/:id — Delete webhook
// ============================================================================

describe('DELETE /webhooks/:id', () => {
  it('should delete a webhook', async () => {
    (mockWebhookRepo.delete as ReturnType<typeof vi.fn>).mockResolvedValue(true);

    const res = await app.request('/webhooks/550e8400-e29b-41d4-a716-446655440000', {
      method: 'DELETE',
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it('should return 404 when webhook not found', async () => {
    (mockWebhookRepo.delete as ReturnType<typeof vi.fn>).mockResolvedValue(false);

    const res = await app.request('/webhooks/missing', { method: 'DELETE' });
    expect(res.status).toBe(404);
  });
});

// ============================================================================
// POST /webhooks/:id/test — Test delivery
// ============================================================================

describe('POST /webhooks/:id/test', () => {
  it('should dispatch a test event', async () => {
    const webhook = makeWebhook();
    (mockWebhookRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(webhook);

    const res = await app.request('/webhooks/550e8400-e29b-41d4-a716-446655440000/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventType: 'task.completed' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(mockDispatcher.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: 'task.completed',
      userId: 'user-1',
      data: expect.objectContaining({ test: true }),
    }));
  });

  it('should return 404 for non-existent webhook', async () => {
    (mockWebhookRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const res = await app.request('/webhooks/missing/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventType: 'task.completed' }),
    });

    expect(res.status).toBe(404);
  });
});

// ============================================================================
// GET /webhooks/:id/deliveries — Delivery log
// ============================================================================

describe('GET /webhooks/:id/deliveries', () => {
  it('should list deliveries for a webhook', async () => {
    (mockWebhookRepo.listDeliveries as ReturnType<typeof vi.fn>).mockResolvedValue({
      deliveries: [makeDelivery()],
      total: 1,
    });

    const res = await app.request('/webhooks/550e8400-e29b-41d4-a716-446655440000/deliveries');
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.total).toBe(1);
    expect(body.deliveries).toHaveLength(1);
    expect(body.deliveries[0].status).toBe('success');
  });
});
