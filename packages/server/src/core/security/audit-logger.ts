// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Centralized security audit logger — records all command validation events.
 *
 * Persists audit log entries to the database and provides query APIs
 * for filtering by server, time range, risk level, and action.
 *
 * @module core/security/audit-logger
 */

import { randomUUID } from 'node:crypto';
import { eq, and, desc, gte, lte, count } from 'drizzle-orm';

import { getDatabase } from '../../db/connection.js';
import { auditLogs, servers } from '../../db/schema.js';
import { createContextLogger } from '../../utils/logger.js';
import type { ValidationResult, ValidationAction } from './command-validator.js';
import type { DrizzleDB } from '../../db/connection.js';
import type { RiskLevel } from '@aiinstaller/shared';

// ============================================================================
// Types
// ============================================================================

export type ExecutionResultStatus = 'success' | 'failed' | 'timeout' | 'pending' | 'skipped';

export interface AuditLogEntry {
  id: string;
  serverId: string;
  userId: string;
  sessionId: string | null;
  command: string;
  riskLevel: string;
  reason: string;
  matchedPattern: string | null;
  action: ValidationAction;
  auditWarnings: string[];
  auditBlockers: string[];
  executionResult: ExecutionResultStatus | null;
  operationId: string | null;
  createdAt: string;
}

export interface CreateAuditLogInput {
  serverId: string;
  userId: string;
  sessionId?: string;
  command: string;
  validation: ValidationResult;
  operationId?: string;
}

export interface AuditLogFilter {
  serverId?: string;
  riskLevel?: RiskLevel;
  action?: ValidationAction;
  startDate?: string;
  endDate?: string;
}

export interface AuditLogPagination {
  limit: number;
  offset: number;
}

// ============================================================================
// Audit Logger
// ============================================================================

export interface AuditLogger {
  /** Record a command validation event. */
  log(input: CreateAuditLogInput): Promise<AuditLogEntry>;

  /** Update the execution result for an audit log entry. */
  updateExecutionResult(id: string, result: ExecutionResultStatus, operationId?: string): Promise<boolean>;

  /** Query audit logs with filtering and pagination. */
  query(
    userId: string,
    filter: AuditLogFilter,
    pagination: AuditLogPagination,
  ): Promise<{ logs: AuditLogEntry[]; total: number }>;

  /** Query all matching audit logs (no pagination) for export. */
  queryAll(userId: string, filter: AuditLogFilter): Promise<AuditLogEntry[]>;
}

export class DrizzleAuditLogger implements AuditLogger {
  constructor(private db: DrizzleDB) {}

  async log(input: CreateAuditLogInput): Promise<AuditLogEntry> {
    const id = randomUUID();
    const now = new Date();
    const { validation } = input;

    const logger = createContextLogger({
      serverId: input.serverId,
      userId: input.userId,
    });

    logger.info({
      command: input.command,
      riskLevel: validation.classification.riskLevel,
      action: validation.action,
      warnings: validation.audit.warnings.length,
      blockers: validation.audit.blockers.length,
    }, `Security audit: ${validation.action} [${validation.classification.riskLevel}]`);

    this.db.insert(auditLogs).values({
      id,
      serverId: input.serverId,
      userId: input.userId,
      sessionId: input.sessionId ?? null,
      command: input.command,
      riskLevel: validation.classification.riskLevel,
      reason: validation.classification.reason,
      matchedPattern: validation.classification.matchedPattern ?? null,
      action: validation.action,
      auditWarnings: validation.audit.warnings,
      auditBlockers: validation.audit.blockers,
      executionResult: validation.action === 'blocked' ? 'skipped' : 'pending',
      operationId: input.operationId ?? null,
      createdAt: now,
    }).run();

    return {
      id,
      serverId: input.serverId,
      userId: input.userId,
      sessionId: input.sessionId ?? null,
      command: input.command,
      riskLevel: validation.classification.riskLevel,
      reason: validation.classification.reason,
      matchedPattern: validation.classification.matchedPattern ?? null,
      action: validation.action,
      auditWarnings: validation.audit.warnings,
      auditBlockers: validation.audit.blockers,
      executionResult: validation.action === 'blocked' ? 'skipped' : 'pending',
      operationId: input.operationId ?? null,
      createdAt: now.toISOString(),
    };
  }

  async updateExecutionResult(
    id: string,
    result: ExecutionResultStatus,
    operationId?: string,
  ): Promise<boolean> {
    const updates: Record<string, unknown> = { executionResult: result };
    if (operationId) updates['operationId'] = operationId;

    this.db
      .update(auditLogs)
      .set(updates)
      .where(eq(auditLogs.id, id))
      .run();

    return true;
  }

  async query(
    userId: string,
    filter: AuditLogFilter,
    pagination: AuditLogPagination,
  ): Promise<{ logs: AuditLogEntry[]; total: number }> {
    const conditions = this.buildConditions(userId, filter);

    const totalResult = this.db
      .select({ count: count() })
      .from(auditLogs)
      .where(and(...conditions))
      .all();
    const total = totalResult[0]?.count ?? 0;

    const rows = this.db
      .select()
      .from(auditLogs)
      .where(and(...conditions))
      .orderBy(desc(auditLogs.createdAt))
      .limit(pagination.limit)
      .offset(pagination.offset)
      .all();

    return {
      logs: rows.map((row) => this.toEntry(row)),
      total,
    };
  }

  async queryAll(userId: string, filter: AuditLogFilter): Promise<AuditLogEntry[]> {
    const conditions = this.buildConditions(userId, filter);

    const rows = this.db
      .select()
      .from(auditLogs)
      .where(and(...conditions))
      .orderBy(desc(auditLogs.createdAt))
      .all();

    return rows.map((row) => this.toEntry(row));
  }

  private buildConditions(userId: string, filter: AuditLogFilter) {
    const conditions = [eq(auditLogs.userId, userId)];

    if (filter.serverId) {
      conditions.push(eq(auditLogs.serverId, filter.serverId));
    }
    if (filter.riskLevel) {
      conditions.push(eq(auditLogs.riskLevel, filter.riskLevel));
    }
    if (filter.action) {
      conditions.push(eq(auditLogs.action, filter.action));
    }
    if (filter.startDate) {
      conditions.push(gte(auditLogs.createdAt, new Date(filter.startDate)));
    }
    if (filter.endDate) {
      conditions.push(lte(auditLogs.createdAt, new Date(filter.endDate)));
    }

    return conditions;
  }

  private toEntry(row: typeof auditLogs.$inferSelect): AuditLogEntry {
    return {
      id: row.id,
      serverId: row.serverId,
      userId: row.userId,
      sessionId: row.sessionId ?? null,
      command: row.command,
      riskLevel: row.riskLevel,
      reason: row.reason,
      matchedPattern: row.matchedPattern ?? null,
      action: row.action as ValidationAction,
      auditWarnings: (row.auditWarnings ?? []) as string[],
      auditBlockers: (row.auditBlockers ?? []) as string[],
      executionResult: row.executionResult as ExecutionResultStatus | null,
      operationId: row.operationId ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }
}

// ============================================================================
// Singleton
// ============================================================================

let _instance: AuditLogger | null = null;

export function getAuditLogger(): AuditLogger {
  if (!_instance) {
    _instance = new DrizzleAuditLogger(getDatabase());
  }
  return _instance;
}

export function setAuditLogger(logger: AuditLogger): void {
  _instance = logger;
}

export function _resetAuditLogger(): void {
  _instance = null;
}
