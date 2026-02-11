// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Webhook repository — data access layer for webhook endpoints and delivery logs.
 *
 * Manages webhook CRUD, delivery tracking, and retry scheduling.
 *
 * @module db/repositories/webhook-repository
 */

import { randomUUID } from 'node:crypto';
import { eq, and, desc, lte, count } from 'drizzle-orm';

import { getDatabase } from '../connection.js';
import { webhooks, webhookDeliveries } from '../schema.js';

import type { DrizzleDB } from '../connection.js';
import type { WebhookEventType } from '../schema.js';

// ============================================================================
// Types
// ============================================================================

export type DeliveryStatus = 'pending' | 'success' | 'failed';

export interface Webhook {
  id: string;
  userId: string;
  tenantId: string | null;
  name: string;
  url: string;
  secret: string;
  events: WebhookEventType[];
  enabled: boolean;
  maxRetries: number;
  createdAt: string;
  updatedAt: string;
}

export interface WebhookDelivery {
  id: string;
  webhookId: string;
  eventType: string;
  payload: Record<string, unknown>;
  status: DeliveryStatus;
  httpStatus: number | null;
  responseBody: string | null;
  attempts: number;
  lastAttemptAt: string | null;
  nextRetryAt: string | null;
  createdAt: string;
}

export interface CreateWebhookInput {
  userId: string;
  tenantId?: string | null;
  name: string;
  url: string;
  secret: string;
  events: WebhookEventType[];
  maxRetries?: number;
}

export interface UpdateWebhookInput {
  name?: string;
  url?: string;
  secret?: string;
  events?: WebhookEventType[];
  enabled?: boolean;
  maxRetries?: number;
}

export interface CreateDeliveryInput {
  webhookId: string;
  eventType: string;
  payload: Record<string, unknown>;
  nextRetryAt?: Date;
}

export interface PaginationOptions {
  limit: number;
  offset: number;
}

// ============================================================================
// Interface
// ============================================================================

export interface WebhookRepository {
  create(input: CreateWebhookInput): Promise<Webhook>;
  findById(id: string, userId: string): Promise<Webhook | null>;
  listByUser(userId: string, pagination: PaginationOptions): Promise<{ webhooks: Webhook[]; total: number }>;
  update(id: string, userId: string, input: UpdateWebhookInput): Promise<Webhook | null>;
  delete(id: string, userId: string): Promise<boolean>;
  findEnabledByEvent(eventType: WebhookEventType, userId: string): Promise<Webhook[]>;
  /** Find a webhook by ID without user isolation (for internal retry processing). */
  findByIdInternal(id: string): Promise<Webhook | null>;

  createDelivery(input: CreateDeliveryInput): Promise<WebhookDelivery>;
  updateDeliveryStatus(id: string, status: DeliveryStatus, httpStatus: number | null, responseBody: string | null, nextRetryAt: Date | null): Promise<boolean>;
  findPendingRetries(now: Date): Promise<WebhookDelivery[]>;
  listDeliveries(webhookId: string, userId: string, pagination: PaginationOptions): Promise<{ deliveries: WebhookDelivery[]; total: number }>;
}

// ============================================================================
// Drizzle Implementation
// ============================================================================

export class DrizzleWebhookRepository implements WebhookRepository {
  constructor(private db: DrizzleDB) {}

  async create(input: CreateWebhookInput): Promise<Webhook> {
    const now = new Date();
    const id = randomUUID();

    this.db.insert(webhooks).values({
      id,
      userId: input.userId,
      tenantId: input.tenantId ?? null,
      name: input.name,
      url: input.url,
      secret: input.secret,
      events: input.events,
      enabled: true,
      maxRetries: input.maxRetries ?? 3,
      createdAt: now,
      updatedAt: now,
    }).run();

    return {
      id,
      userId: input.userId,
      tenantId: input.tenantId ?? null,
      name: input.name,
      url: input.url,
      secret: input.secret,
      events: input.events,
      enabled: true,
      maxRetries: input.maxRetries ?? 3,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
  }

  async findById(id: string, userId: string): Promise<Webhook | null> {
    const rows = this.db
      .select()
      .from(webhooks)
      .where(and(eq(webhooks.id, id), eq(webhooks.userId, userId)))
      .limit(1)
      .all();

    return rows[0] ? this.toWebhook(rows[0]) : null;
  }

  async listByUser(userId: string, pagination: PaginationOptions): Promise<{ webhooks: Webhook[]; total: number }> {
    const rows = this.db
      .select()
      .from(webhooks)
      .where(eq(webhooks.userId, userId))
      .orderBy(desc(webhooks.createdAt))
      .limit(pagination.limit)
      .offset(pagination.offset)
      .all();

    const totalRows = this.db
      .select({ count: count() })
      .from(webhooks)
      .where(eq(webhooks.userId, userId))
      .all();

    return {
      webhooks: rows.map((r) => this.toWebhook(r)),
      total: totalRows[0]?.count ?? 0,
    };
  }

  async update(id: string, userId: string, input: UpdateWebhookInput): Promise<Webhook | null> {
    const existing = await this.findById(id, userId);
    if (!existing) return null;

    const now = new Date();
    const values: Record<string, unknown> = { updatedAt: now };

    if (input.name !== undefined) values.name = input.name;
    if (input.url !== undefined) values.url = input.url;
    if (input.secret !== undefined) values.secret = input.secret;
    if (input.events !== undefined) values.events = input.events;
    if (input.enabled !== undefined) values.enabled = input.enabled;
    if (input.maxRetries !== undefined) values.maxRetries = input.maxRetries;

    this.db
      .update(webhooks)
      .set(values)
      .where(and(eq(webhooks.id, id), eq(webhooks.userId, userId)))
      .run();

    return this.findById(id, userId);
  }

  async delete(id: string, userId: string): Promise<boolean> {
    const result = this.db
      .delete(webhooks)
      .where(and(eq(webhooks.id, id), eq(webhooks.userId, userId)))
      .run();

    return result.changes > 0;
  }

  async findByIdInternal(id: string): Promise<Webhook | null> {
    const rows = this.db
      .select()
      .from(webhooks)
      .where(eq(webhooks.id, id))
      .limit(1)
      .all();

    return rows[0] ? this.toWebhook(rows[0]) : null;
  }

  async findEnabledByEvent(eventType: WebhookEventType, userId: string): Promise<Webhook[]> {
    const rows = this.db
      .select()
      .from(webhooks)
      .where(and(eq(webhooks.userId, userId), eq(webhooks.enabled, true)))
      .all();

    // Filter in JS since SQLite doesn't support JSON array contains
    return rows
      .map((r) => this.toWebhook(r))
      .filter((w) => w.events.includes(eventType));
  }

  async createDelivery(input: CreateDeliveryInput): Promise<WebhookDelivery> {
    const now = new Date();
    const id = randomUUID();

    this.db.insert(webhookDeliveries).values({
      id,
      webhookId: input.webhookId,
      eventType: input.eventType,
      payload: input.payload,
      status: 'pending',
      httpStatus: null,
      responseBody: null,
      attempts: 0,
      lastAttemptAt: null,
      nextRetryAt: input.nextRetryAt ?? null,
      createdAt: now,
    }).run();

    return {
      id,
      webhookId: input.webhookId,
      eventType: input.eventType,
      payload: input.payload,
      status: 'pending',
      httpStatus: null,
      responseBody: null,
      attempts: 0,
      lastAttemptAt: null,
      nextRetryAt: input.nextRetryAt?.toISOString() ?? null,
      createdAt: now.toISOString(),
    };
  }

  async updateDeliveryStatus(
    id: string,
    status: DeliveryStatus,
    httpStatus: number | null,
    responseBody: string | null,
    nextRetryAt: Date | null,
  ): Promise<boolean> {
    const existing = this.db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.id, id))
      .limit(1)
      .all();

    if (existing.length === 0) return false;

    const current = existing[0];

    this.db
      .update(webhookDeliveries)
      .set({
        status,
        httpStatus,
        responseBody: responseBody?.substring(0, 4096) ?? null,
        attempts: (current.attempts ?? 0) + 1,
        lastAttemptAt: new Date(),
        nextRetryAt,
      })
      .where(eq(webhookDeliveries.id, id))
      .run();

    return true;
  }

  async findPendingRetries(now: Date): Promise<WebhookDelivery[]> {
    const rows = this.db
      .select()
      .from(webhookDeliveries)
      .where(and(
        eq(webhookDeliveries.status, 'pending'),
        lte(webhookDeliveries.nextRetryAt, now),
      ))
      .orderBy(webhookDeliveries.nextRetryAt)
      .limit(50)
      .all();

    return rows.map((r) => this.toDelivery(r));
  }

  async listDeliveries(webhookId: string, userId: string, pagination: PaginationOptions): Promise<{ deliveries: WebhookDelivery[]; total: number }> {
    // Verify webhook ownership
    const webhook = await this.findById(webhookId, userId);
    if (!webhook) return { deliveries: [], total: 0 };

    const rows = this.db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.webhookId, webhookId))
      .orderBy(desc(webhookDeliveries.createdAt))
      .limit(pagination.limit)
      .offset(pagination.offset)
      .all();

    const totalRows = this.db
      .select({ count: count() })
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.webhookId, webhookId))
      .all();

    return {
      deliveries: rows.map((r) => this.toDelivery(r)),
      total: totalRows[0]?.count ?? 0,
    };
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  private toWebhook(row: typeof webhooks.$inferSelect): Webhook {
    return {
      id: row.id,
      userId: row.userId,
      tenantId: row.tenantId,
      name: row.name,
      url: row.url,
      secret: row.secret,
      events: row.events,
      enabled: row.enabled,
      maxRetries: row.maxRetries,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toDelivery(row: typeof webhookDeliveries.$inferSelect): WebhookDelivery {
    return {
      id: row.id,
      webhookId: row.webhookId,
      eventType: row.eventType,
      payload: row.payload,
      status: row.status as DeliveryStatus,
      httpStatus: row.httpStatus,
      responseBody: row.responseBody,
      attempts: row.attempts,
      lastAttemptAt: row.lastAttemptAt?.toISOString() ?? null,
      nextRetryAt: row.nextRetryAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }
}

// ============================================================================
// Singleton
// ============================================================================

let _webhookRepository: WebhookRepository | null = null;

export function getWebhookRepository(): WebhookRepository {
  if (!_webhookRepository) {
    _webhookRepository = new DrizzleWebhookRepository(getDatabase());
  }
  return _webhookRepository;
}

export function setWebhookRepository(repo: WebhookRepository): void {
  _webhookRepository = repo;
}

export function _resetWebhookRepository(): void {
  _webhookRepository = null;
}
