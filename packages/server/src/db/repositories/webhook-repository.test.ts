// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for WebhookRepository (Drizzle implementation).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { initDatabase, closeDatabase, createTables } from '../connection.js';
import { DrizzleWebhookRepository } from './webhook-repository.js';

import type { DrizzleDB } from '../connection.js';

let db: DrizzleDB;
let repo: DrizzleWebhookRepository;

function seedUser(id: string, email: string) {
  const sqlite = (db as unknown as { session: { client: { exec: (s: string) => void } } })
    .session.client;
  sqlite.exec(
    `INSERT INTO users (id, email, password_hash, created_at, updated_at)
     VALUES ('${id}', '${email}', 'hash', ${Date.now()}, ${Date.now()})`,
  );
}

describe('DrizzleWebhookRepository', () => {
  beforeEach(() => {
    db = initDatabase(':memory:');
    createTables();
    repo = new DrizzleWebhookRepository(db);
    seedUser('user-1', 'test@example.com');
    seedUser('user-2', 'other@example.com');
  });

  afterEach(() => {
    closeDatabase();
  });

  // ==========================================================================
  // Webhook CRUD
  // ==========================================================================

  it('should create a webhook', async () => {
    const webhook = await repo.create({
      userId: 'user-1',
      name: 'My Webhook',
      url: 'https://example.com/webhook',
      secret: 'test-secret-at-least-16',
      events: ['task.completed', 'alert.triggered'],
    });

    expect(webhook.id).toBeTruthy();
    expect(webhook.name).toBe('My Webhook');
    expect(webhook.url).toBe('https://example.com/webhook');
    expect(webhook.secret).toBe('test-secret-at-least-16');
    expect(webhook.events).toEqual(['task.completed', 'alert.triggered']);
    expect(webhook.enabled).toBe(true);
    expect(webhook.maxRetries).toBe(3);
    expect(webhook.userId).toBe('user-1');
  });

  it('should find webhook by id with user isolation', async () => {
    const created = await repo.create({
      userId: 'user-1',
      name: 'Hook 1',
      url: 'https://example.com/hook1',
      secret: 'secret1234567890ab',
      events: ['task.completed'],
    });

    // Owner can see it
    const found = await repo.findById(created.id, 'user-1');
    expect(found).toBeTruthy();
    expect(found!.name).toBe('Hook 1');

    // Other user cannot
    const notFound = await repo.findById(created.id, 'user-2');
    expect(notFound).toBeNull();
  });

  it('should find webhook by id without user isolation (internal)', async () => {
    const created = await repo.create({
      userId: 'user-1',
      name: 'Internal Hook',
      url: 'https://example.com/internal',
      secret: 'secret1234567890ab',
      events: ['server.offline'],
    });

    const found = await repo.findByIdInternal(created.id);
    expect(found).toBeTruthy();
    expect(found!.name).toBe('Internal Hook');
  });

  it('should list webhooks by user', async () => {
    await repo.create({ userId: 'user-1', name: 'Hook A', url: 'https://a.com', secret: 'secret1234567890ab', events: ['task.completed'] });
    await repo.create({ userId: 'user-1', name: 'Hook B', url: 'https://b.com', secret: 'secret1234567890ab', events: ['alert.triggered'] });
    await repo.create({ userId: 'user-2', name: 'Hook C', url: 'https://c.com', secret: 'secret1234567890ab', events: ['server.offline'] });

    const result = await repo.listByUser('user-1', { limit: 50, offset: 0 });
    expect(result.total).toBe(2);
    expect(result.webhooks).toHaveLength(2);
  });

  it('should update a webhook', async () => {
    const created = await repo.create({
      userId: 'user-1',
      name: 'Original',
      url: 'https://original.com',
      secret: 'secret1234567890ab',
      events: ['task.completed'],
    });

    const updated = await repo.update(created.id, 'user-1', {
      name: 'Updated',
      url: 'https://updated.com',
      enabled: false,
      events: ['alert.triggered', 'server.offline'],
    });

    expect(updated).toBeTruthy();
    expect(updated!.name).toBe('Updated');
    expect(updated!.url).toBe('https://updated.com');
    expect(updated!.enabled).toBe(false);
    expect(updated!.events).toEqual(['alert.triggered', 'server.offline']);
  });

  it('should not update webhook for wrong user', async () => {
    const created = await repo.create({
      userId: 'user-1',
      name: 'Hook',
      url: 'https://example.com',
      secret: 'secret1234567890ab',
      events: ['task.completed'],
    });

    const result = await repo.update(created.id, 'user-2', { name: 'Hacked' });
    expect(result).toBeNull();
  });

  it('should delete a webhook', async () => {
    const created = await repo.create({
      userId: 'user-1',
      name: 'To Delete',
      url: 'https://example.com',
      secret: 'secret1234567890ab',
      events: ['task.completed'],
    });

    const deleted = await repo.delete(created.id, 'user-1');
    expect(deleted).toBe(true);

    const found = await repo.findById(created.id, 'user-1');
    expect(found).toBeNull();
  });

  it('should not delete webhook for wrong user', async () => {
    const created = await repo.create({
      userId: 'user-1',
      name: 'Protected',
      url: 'https://example.com',
      secret: 'secret1234567890ab',
      events: ['task.completed'],
    });

    const deleted = await repo.delete(created.id, 'user-2');
    expect(deleted).toBe(false);
  });

  it('should find enabled webhooks by event type', async () => {
    await repo.create({ userId: 'user-1', name: 'A', url: 'https://a.com', secret: 'secret1234567890ab', events: ['task.completed', 'alert.triggered'] });
    await repo.create({ userId: 'user-1', name: 'B', url: 'https://b.com', secret: 'secret1234567890ab', events: ['server.offline'] });
    const hook3 = await repo.create({ userId: 'user-1', name: 'C', url: 'https://c.com', secret: 'secret1234567890ab', events: ['task.completed'] });

    // Disable one
    await repo.update(hook3.id, 'user-1', { enabled: false });

    const found = await repo.findEnabledByEvent('task.completed', 'user-1');
    expect(found).toHaveLength(1);
    expect(found[0].name).toBe('A');
  });

  // ==========================================================================
  // Delivery tracking
  // ==========================================================================

  it('should create and track a delivery', async () => {
    const hook = await repo.create({
      userId: 'user-1',
      name: 'Delivery Hook',
      url: 'https://example.com',
      secret: 'secret1234567890ab',
      events: ['task.completed'],
    });

    const delivery = await repo.createDelivery({
      webhookId: hook.id,
      eventType: 'task.completed',
      payload: { test: true },
    });

    expect(delivery.id).toBeTruthy();
    expect(delivery.status).toBe('pending');
    expect(delivery.attempts).toBe(0);
    expect(delivery.payload).toEqual({ test: true });
  });

  it('should update delivery status', async () => {
    const hook = await repo.create({
      userId: 'user-1',
      name: 'Status Hook',
      url: 'https://example.com',
      secret: 'secret1234567890ab',
      events: ['task.completed'],
    });

    const delivery = await repo.createDelivery({
      webhookId: hook.id,
      eventType: 'task.completed',
      payload: { data: 'test' },
    });

    const updated = await repo.updateDeliveryStatus(
      delivery.id, 'success', 200, '{"ok":true}', null,
    );
    expect(updated).toBe(true);
  });

  it('should find pending retries', async () => {
    const hook = await repo.create({
      userId: 'user-1',
      name: 'Retry Hook',
      url: 'https://example.com',
      secret: 'secret1234567890ab',
      events: ['task.completed'],
    });

    // Create a delivery with nextRetryAt in the past
    await repo.createDelivery({
      webhookId: hook.id,
      eventType: 'task.completed',
      payload: { retry: true },
      nextRetryAt: new Date(Date.now() - 1000),
    });

    // Create one with future retry
    await repo.createDelivery({
      webhookId: hook.id,
      eventType: 'alert.triggered',
      payload: { retry: false },
      nextRetryAt: new Date(Date.now() + 60_000),
    });

    const pending = await repo.findPendingRetries(new Date());
    expect(pending).toHaveLength(1);
    expect(pending[0].payload).toEqual({ retry: true });
  });

  it('should list deliveries for a webhook', async () => {
    const hook = await repo.create({
      userId: 'user-1',
      name: 'List Hook',
      url: 'https://example.com',
      secret: 'secret1234567890ab',
      events: ['task.completed'],
    });

    await repo.createDelivery({ webhookId: hook.id, eventType: 'task.completed', payload: { n: 1 } });
    await repo.createDelivery({ webhookId: hook.id, eventType: 'task.completed', payload: { n: 2 } });
    await repo.createDelivery({ webhookId: hook.id, eventType: 'task.completed', payload: { n: 3 } });

    const result = await repo.listDeliveries(hook.id, 'user-1', { limit: 10, offset: 0 });
    expect(result.total).toBe(3);
    expect(result.deliveries).toHaveLength(3);

    // Wrong user gets empty
    const empty = await repo.listDeliveries(hook.id, 'user-2', { limit: 10, offset: 0 });
    expect(empty.total).toBe(0);
  });

  it('should cascade delete deliveries when webhook is deleted', async () => {
    const hook = await repo.create({
      userId: 'user-1',
      name: 'Cascade Hook',
      url: 'https://example.com',
      secret: 'secret1234567890ab',
      events: ['task.completed'],
    });

    await repo.createDelivery({ webhookId: hook.id, eventType: 'task.completed', payload: {} });
    await repo.createDelivery({ webhookId: hook.id, eventType: 'task.completed', payload: {} });

    await repo.delete(hook.id, 'user-1');

    // Deliveries should be gone too
    const result = await repo.listDeliveries(hook.id, 'user-1', { limit: 10, offset: 0 });
    expect(result.total).toBe(0);
  });
});
