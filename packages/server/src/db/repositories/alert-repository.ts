// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Alert repository — data access layer for monitoring alerts.
 *
 * Manages alert lifecycle: creation, resolution tracking,
 * and filtering by type/severity.
 *
 * @module db/repositories/alert-repository
 */

import { randomUUID } from 'node:crypto';
import { eq, and, count, desc } from 'drizzle-orm';

import { getDatabase } from '../connection.js';
import { alerts, servers } from '../schema.js';

import type { DrizzleDB } from '../connection.js';

// ============================================================================
// Types
// ============================================================================

export type AlertType = 'cpu' | 'memory' | 'disk' | 'service' | 'offline';
export type AlertSeverity = 'info' | 'warning' | 'critical';

export interface Alert {
  id: string;
  serverId: string;
  type: AlertType;
  severity: AlertSeverity;
  message: string;
  value: string | null;
  threshold: string | null;
  resolved: boolean;
  resolvedAt: string | null;
  createdAt: string;
}

export interface CreateAlertInput {
  serverId: string;
  userId: string;
  type: AlertType;
  severity: AlertSeverity;
  message: string;
  value?: string;
  threshold?: string;
}

export interface PaginationOptions {
  limit: number;
  offset: number;
}

// ============================================================================
// Repository Interface
// ============================================================================

export interface AlertRepository {
  /** Create a new alert. */
  create(input: CreateAlertInput): Promise<Alert>;

  /** Get alert by ID with user isolation via server ownership. */
  getById(id: string, userId: string): Promise<Alert | null>;

  /** Resolve an alert. */
  resolve(id: string, userId: string): Promise<boolean>;

  /** List unresolved alerts for a user's servers. */
  listUnresolved(
    userId: string,
    pagination: PaginationOptions,
  ): Promise<{ alerts: Alert[]; total: number }>;

  /** List alerts for a server with pagination. */
  listByServer(
    serverId: string,
    userId: string,
    pagination: PaginationOptions,
  ): Promise<{ alerts: Alert[]; total: number }>;

  /** List alerts by type for a user's servers. */
  listByType(
    userId: string,
    type: AlertType,
    pagination: PaginationOptions,
  ): Promise<{ alerts: Alert[]; total: number }>;
}

// ============================================================================
// Drizzle Implementation
// ============================================================================

function toISOString(date: Date | null | undefined): string | null {
  return date ? date.toISOString() : null;
}

export class DrizzleAlertRepository implements AlertRepository {
  constructor(private db: DrizzleDB) {}

  async create(input: CreateAlertInput): Promise<Alert> {
    if (!(await this.verifyServerOwnership(input.serverId, input.userId))) {
      throw new Error('Server not found or access denied');
    }

    const now = new Date();
    const id = randomUUID();

    this.db.insert(alerts).values({
      id,
      serverId: input.serverId,
      type: input.type,
      severity: input.severity,
      message: input.message,
      value: input.value ?? null,
      threshold: input.threshold ?? null,
      resolved: false,
      resolvedAt: null,
      createdAt: now,
    }).run();

    return {
      id,
      serverId: input.serverId,
      type: input.type,
      severity: input.severity,
      message: input.message,
      value: input.value ?? null,
      threshold: input.threshold ?? null,
      resolved: false,
      resolvedAt: null,
      createdAt: now.toISOString(),
    };
  }

  async getById(id: string, userId: string): Promise<Alert | null> {
    const rows = this.db
      .select()
      .from(alerts)
      .where(eq(alerts.id, id))
      .limit(1)
      .all();

    if (!rows[0]) return null;

    if (!(await this.verifyServerOwnership(rows[0].serverId, userId))) {
      return null;
    }

    return this.toAlert(rows[0]);
  }

  async resolve(id: string, userId: string): Promise<boolean> {
    const existing = await this.getById(id, userId);
    if (!existing || existing.resolved) return false;

    this.db
      .update(alerts)
      .set({ resolved: true, resolvedAt: new Date() })
      .where(eq(alerts.id, id))
      .run();

    return true;
  }

  async listUnresolved(
    userId: string,
    pagination: PaginationOptions,
  ): Promise<{ alerts: Alert[]; total: number }> {
    const userServerIds = await this.getUserServerIds(userId);
    if (userServerIds.length === 0) return { alerts: [], total: 0 };

    // Query all unresolved alerts for user's servers
    const allUnresolved: Alert[] = [];
    for (const serverId of userServerIds) {
      const rows = this.db
        .select()
        .from(alerts)
        .where(and(eq(alerts.serverId, serverId), eq(alerts.resolved, false)))
        .orderBy(desc(alerts.createdAt))
        .all();

      allUnresolved.push(...rows.map((row) => this.toAlert(row)));
    }

    // Sort by createdAt descending
    allUnresolved.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    const total = allUnresolved.length;
    const paged = allUnresolved.slice(
      pagination.offset,
      pagination.offset + pagination.limit,
    );

    return { alerts: paged, total };
  }

  async listByServer(
    serverId: string,
    userId: string,
    pagination: PaginationOptions,
  ): Promise<{ alerts: Alert[]; total: number }> {
    if (!(await this.verifyServerOwnership(serverId, userId))) {
      return { alerts: [], total: 0 };
    }

    const totalResult = this.db
      .select({ count: count() })
      .from(alerts)
      .where(eq(alerts.serverId, serverId))
      .all();
    const total = totalResult[0]?.count ?? 0;

    const rows = this.db
      .select()
      .from(alerts)
      .where(eq(alerts.serverId, serverId))
      .orderBy(desc(alerts.createdAt))
      .limit(pagination.limit)
      .offset(pagination.offset)
      .all();

    return {
      alerts: rows.map((row) => this.toAlert(row)),
      total,
    };
  }

  async listByType(
    userId: string,
    type: AlertType,
    pagination: PaginationOptions,
  ): Promise<{ alerts: Alert[]; total: number }> {
    const userServerIds = await this.getUserServerIds(userId);
    if (userServerIds.length === 0) return { alerts: [], total: 0 };

    const allByType: Alert[] = [];
    for (const serverId of userServerIds) {
      const rows = this.db
        .select()
        .from(alerts)
        .where(and(eq(alerts.serverId, serverId), eq(alerts.type, type)))
        .orderBy(desc(alerts.createdAt))
        .all();

      allByType.push(...rows.map((row) => this.toAlert(row)));
    }

    allByType.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    const total = allByType.length;
    const paged = allByType.slice(
      pagination.offset,
      pagination.offset + pagination.limit,
    );

    return { alerts: paged, total };
  }

  private async verifyServerOwnership(
    serverId: string,
    userId: string,
  ): Promise<boolean> {
    const rows = this.db
      .select({ userId: servers.userId })
      .from(servers)
      .where(and(eq(servers.id, serverId), eq(servers.userId, userId)))
      .limit(1)
      .all();

    return rows.length > 0;
  }

  private async getUserServerIds(userId: string): Promise<string[]> {
    const rows = this.db
      .select({ id: servers.id })
      .from(servers)
      .where(eq(servers.userId, userId))
      .all();

    return rows.map((r) => r.id);
  }

  private toAlert(row: typeof alerts.$inferSelect): Alert {
    return {
      id: row.id,
      serverId: row.serverId,
      type: row.type as AlertType,
      severity: row.severity as AlertSeverity,
      message: row.message,
      value: row.value ?? null,
      threshold: row.threshold ?? null,
      resolved: row.resolved,
      resolvedAt: toISOString(row.resolvedAt),
      createdAt: row.createdAt.toISOString(),
    };
  }
}

// ============================================================================
// Singleton
// ============================================================================

let _repository: AlertRepository | null = null;

export function getAlertRepository(): AlertRepository {
  if (!_repository) {
    _repository = new DrizzleAlertRepository(getDatabase());
  }
  return _repository;
}

export function setAlertRepository(repo: AlertRepository): void {
  _repository = repo;
}

export function _resetAlertRepository(): void {
  _repository = null;
}
