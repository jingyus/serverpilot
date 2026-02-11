// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Alert rule repository — data access layer for alert threshold rules.
 *
 * Manages alert rule CRUD operations with user isolation
 * via server ownership verification.
 *
 * @module db/repositories/alert-rule-repository
 */

import { randomUUID } from 'node:crypto';
import { eq, and, count, desc } from 'drizzle-orm';

import { getDatabase } from '../connection.js';
import { alertRules, servers } from '../schema.js';

import type { DrizzleDB } from '../connection.js';

// ============================================================================
// Types
// ============================================================================

export type MetricType = 'cpu' | 'memory' | 'disk';
export type ComparisonOperator = 'gt' | 'lt' | 'gte' | 'lte';
export type RuleSeverity = 'info' | 'warning' | 'critical';

export interface AlertRule {
  id: string;
  serverId: string;
  userId: string;
  name: string;
  metricType: MetricType;
  operator: ComparisonOperator;
  threshold: number;
  severity: RuleSeverity;
  enabled: boolean;
  emailRecipients: string[];
  cooldownMinutes: number;
  lastTriggeredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAlertRuleInput {
  serverId: string;
  userId: string;
  name: string;
  metricType: MetricType;
  operator: ComparisonOperator;
  threshold: number;
  severity: RuleSeverity;
  emailRecipients?: string[];
  cooldownMinutes?: number;
}

export interface UpdateAlertRuleInput {
  name?: string;
  metricType?: MetricType;
  operator?: ComparisonOperator;
  threshold?: number;
  severity?: RuleSeverity;
  enabled?: boolean;
  emailRecipients?: string[];
  cooldownMinutes?: number;
}

export interface PaginationOptions {
  limit: number;
  offset: number;
}

// ============================================================================
// Repository Interface
// ============================================================================

export interface AlertRuleRepository {
  /** Create a new alert rule. */
  create(input: CreateAlertRuleInput): Promise<AlertRule>;

  /** Get an alert rule by ID with user isolation. */
  getById(id: string, userId: string): Promise<AlertRule | null>;

  /** Update an alert rule. */
  update(id: string, userId: string, input: UpdateAlertRuleInput): Promise<AlertRule | null>;

  /** Delete an alert rule. */
  delete(id: string, userId: string): Promise<boolean>;

  /** List alert rules for a specific server. */
  listByServer(
    serverId: string,
    userId: string,
    pagination: PaginationOptions,
  ): Promise<{ rules: AlertRule[]; total: number }>;

  /** List all alert rules for a user. */
  listByUser(
    userId: string,
    pagination: PaginationOptions,
  ): Promise<{ rules: AlertRule[]; total: number }>;

  /** List all enabled rules (for evaluation engine). */
  listEnabled(): Promise<AlertRule[]>;

  /** Update the lastTriggeredAt timestamp for a rule. */
  updateLastTriggered(id: string): Promise<void>;
}

// ============================================================================
// Drizzle Implementation
// ============================================================================

function toISOString(date: Date | null | undefined): string | null {
  return date ? date.toISOString() : null;
}

export class DrizzleAlertRuleRepository implements AlertRuleRepository {
  constructor(private db: DrizzleDB) {}

  async create(input: CreateAlertRuleInput): Promise<AlertRule> {
    if (!(await this.verifyServerOwnership(input.serverId, input.userId))) {
      throw new Error('Server not found or access denied');
    }

    const now = new Date();
    const id = randomUUID();

    this.db.insert(alertRules).values({
      id,
      serverId: input.serverId,
      userId: input.userId,
      name: input.name,
      metricType: input.metricType,
      operator: input.operator,
      threshold: input.threshold,
      severity: input.severity,
      enabled: true,
      emailRecipients: input.emailRecipients ?? [],
      cooldownMinutes: input.cooldownMinutes ?? 30,
      lastTriggeredAt: null,
      createdAt: now,
      updatedAt: now,
    }).run();

    return {
      id,
      serverId: input.serverId,
      userId: input.userId,
      name: input.name,
      metricType: input.metricType,
      operator: input.operator,
      threshold: input.threshold,
      severity: input.severity,
      enabled: true,
      emailRecipients: input.emailRecipients ?? [],
      cooldownMinutes: input.cooldownMinutes ?? 30,
      lastTriggeredAt: null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
  }

  async getById(id: string, userId: string): Promise<AlertRule | null> {
    const rows = this.db
      .select()
      .from(alertRules)
      .where(and(eq(alertRules.id, id), eq(alertRules.userId, userId)))
      .limit(1)
      .all();

    return rows[0] ? this.toAlertRule(rows[0]) : null;
  }

  async update(
    id: string,
    userId: string,
    input: UpdateAlertRuleInput,
  ): Promise<AlertRule | null> {
    const existing = await this.getById(id, userId);
    if (!existing) return null;

    const now = new Date();
    const updates: Record<string, unknown> = { updatedAt: now };

    if (input.name !== undefined) updates.name = input.name;
    if (input.metricType !== undefined) updates.metricType = input.metricType;
    if (input.operator !== undefined) updates.operator = input.operator;
    if (input.threshold !== undefined) updates.threshold = input.threshold;
    if (input.severity !== undefined) updates.severity = input.severity;
    if (input.enabled !== undefined) updates.enabled = input.enabled;
    if (input.emailRecipients !== undefined) updates.emailRecipients = input.emailRecipients;
    if (input.cooldownMinutes !== undefined) updates.cooldownMinutes = input.cooldownMinutes;

    this.db
      .update(alertRules)
      .set(updates)
      .where(eq(alertRules.id, id))
      .run();

    return this.getById(id, userId);
  }

  async delete(id: string, userId: string): Promise<boolean> {
    const existing = await this.getById(id, userId);
    if (!existing) return false;

    this.db.delete(alertRules).where(eq(alertRules.id, id)).run();
    return true;
  }

  async listByServer(
    serverId: string,
    userId: string,
    pagination: PaginationOptions,
  ): Promise<{ rules: AlertRule[]; total: number }> {
    if (!(await this.verifyServerOwnership(serverId, userId))) {
      return { rules: [], total: 0 };
    }

    const totalResult = this.db
      .select({ count: count() })
      .from(alertRules)
      .where(and(eq(alertRules.serverId, serverId), eq(alertRules.userId, userId)))
      .all();
    const total = totalResult[0]?.count ?? 0;

    const rows = this.db
      .select()
      .from(alertRules)
      .where(and(eq(alertRules.serverId, serverId), eq(alertRules.userId, userId)))
      .orderBy(desc(alertRules.createdAt))
      .limit(pagination.limit)
      .offset(pagination.offset)
      .all();

    return {
      rules: rows.map((row) => this.toAlertRule(row)),
      total,
    };
  }

  async listByUser(
    userId: string,
    pagination: PaginationOptions,
  ): Promise<{ rules: AlertRule[]; total: number }> {
    const totalResult = this.db
      .select({ count: count() })
      .from(alertRules)
      .where(eq(alertRules.userId, userId))
      .all();
    const total = totalResult[0]?.count ?? 0;

    const rows = this.db
      .select()
      .from(alertRules)
      .where(eq(alertRules.userId, userId))
      .orderBy(desc(alertRules.createdAt))
      .limit(pagination.limit)
      .offset(pagination.offset)
      .all();

    return {
      rules: rows.map((row) => this.toAlertRule(row)),
      total,
    };
  }

  async listEnabled(): Promise<AlertRule[]> {
    const rows = this.db
      .select()
      .from(alertRules)
      .where(eq(alertRules.enabled, true))
      .all();

    return rows.map((row) => this.toAlertRule(row));
  }

  async updateLastTriggered(id: string): Promise<void> {
    this.db
      .update(alertRules)
      .set({ lastTriggeredAt: new Date() })
      .where(eq(alertRules.id, id))
      .run();
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

  private toAlertRule(row: typeof alertRules.$inferSelect): AlertRule {
    return {
      id: row.id,
      serverId: row.serverId,
      userId: row.userId,
      name: row.name,
      metricType: row.metricType as MetricType,
      operator: row.operator as ComparisonOperator,
      threshold: row.threshold,
      severity: row.severity as RuleSeverity,
      enabled: row.enabled,
      emailRecipients: (row.emailRecipients ?? []) as string[],
      cooldownMinutes: row.cooldownMinutes,
      lastTriggeredAt: toISOString(row.lastTriggeredAt),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

// ============================================================================
// Singleton
// ============================================================================

let _repository: AlertRuleRepository | null = null;

export function getAlertRuleRepository(): AlertRuleRepository {
  if (!_repository) {
    _repository = new DrizzleAlertRuleRepository(getDatabase());
  }
  return _repository;
}

export function setAlertRuleRepository(repo: AlertRuleRepository): void {
  _repository = repo;
}

export function _resetAlertRuleRepository(): void {
  _repository = null;
}
