/**
 * Operation repository — data access layer for command execution records.
 *
 * Provides full audit trail for operations including status tracking,
 * risk level classification, duration measurement, filtering, search,
 * and statistics for complete operation traceability.
 *
 * @module db/repositories/operation-repository
 */

import { randomUUID } from 'node:crypto';
import { eq, and, count, desc, gte, lte, like, sql } from 'drizzle-orm';

import { getDatabase } from '../connection.js';
import { operations, servers } from '../schema.js';

import type { DrizzleDB } from '../connection.js';

// ============================================================================
// Types
// ============================================================================

export type OperationType = 'install' | 'config' | 'restart' | 'execute' | 'backup';
export type OperationStatus = 'pending' | 'running' | 'success' | 'failed' | 'rolled_back';
export type RiskLevel = 'green' | 'yellow' | 'red' | 'critical';

export interface OperationRecord {
  id: string;
  serverId: string;
  sessionId: string | null;
  userId: string;
  type: OperationType;
  description: string;
  commands: string[];
  output: string | null;
  status: OperationStatus;
  riskLevel: RiskLevel;
  snapshotId: string | null;
  duration: number | null;
  inputTokens: number;
  outputTokens: number;
  createdAt: string;
  completedAt: string | null;
}

export interface CreateOperationInput {
  serverId: string;
  userId: string;
  sessionId?: string;
  type: OperationType;
  description: string;
  commands: string[];
  riskLevel: RiskLevel;
  snapshotId?: string;
  inputTokens?: number;
  outputTokens?: number;
}

export interface PaginationOptions {
  limit: number;
  offset: number;
}

/** Filter criteria for querying operations. */
export interface OperationFilter {
  serverId?: string;
  type?: OperationType;
  status?: OperationStatus;
  riskLevel?: RiskLevel;
  search?: string;
  startDate?: string;
  endDate?: string;
}

/** Aggregated statistics for operation history. */
export interface OperationStats {
  total: number;
  byStatus: Record<OperationStatus, number>;
  byType: Record<OperationType, number>;
  byRiskLevel: Record<RiskLevel, number>;
  avgDuration: number | null;
  successRate: number;
}

// ============================================================================
// Repository Interface
// ============================================================================

export interface OperationRepository {
  /** Create a new operation record. */
  create(input: CreateOperationInput): Promise<OperationRecord>;

  /** Get operation by ID with user isolation. */
  getById(id: string, userId: string): Promise<OperationRecord | null>;

  /** List operations for a server with pagination. */
  listByServer(
    serverId: string,
    userId: string,
    pagination: PaginationOptions,
  ): Promise<{ operations: OperationRecord[]; total: number }>;

  /** List operations by status. */
  listByStatus(
    userId: string,
    status: OperationStatus,
    pagination: PaginationOptions,
  ): Promise<{ operations: OperationRecord[]; total: number }>;

  /** List operations with advanced filtering. */
  listWithFilter(
    userId: string,
    filter: OperationFilter,
    pagination: PaginationOptions,
  ): Promise<{ operations: OperationRecord[]; total: number }>;

  /** Get aggregated statistics for a user's operations. */
  getStats(userId: string, serverId?: string): Promise<OperationStats>;

  /** Mark operation as running. */
  markRunning(id: string, userId: string): Promise<boolean>;

  /** Mark operation as complete with output and duration. */
  markComplete(
    id: string,
    userId: string,
    output: string,
    status: 'success' | 'failed' | 'rolled_back',
    duration: number,
  ): Promise<boolean>;

  /** Update operation output (for streaming output). */
  updateOutput(id: string, userId: string, output: string): Promise<boolean>;

  /** Update operation token usage. */
  updateTokenUsage(
    id: string,
    userId: string,
    inputTokens: number,
    outputTokens: number,
  ): Promise<boolean>;
}

// ============================================================================
// Drizzle Implementation
// ============================================================================

function toISOString(date: Date | null | undefined): string | null {
  return date ? date.toISOString() : null;
}

export class DrizzleOperationRepository implements OperationRepository {
  constructor(private db: DrizzleDB) {}

  async create(input: CreateOperationInput): Promise<OperationRecord> {
    if (!(await this.verifyServerOwnership(input.serverId, input.userId))) {
      throw new Error('Server not found or access denied');
    }

    const now = new Date();
    const id = randomUUID();

    this.db.insert(operations).values({
      id,
      serverId: input.serverId,
      sessionId: input.sessionId ?? null,
      userId: input.userId,
      type: input.type,
      description: input.description,
      commands: input.commands,
      output: null,
      status: 'pending',
      riskLevel: input.riskLevel,
      snapshotId: input.snapshotId ?? null,
      duration: null,
      inputTokens: input.inputTokens ?? 0,
      outputTokens: input.outputTokens ?? 0,
      createdAt: now,
      completedAt: null,
    }).run();

    return {
      id,
      serverId: input.serverId,
      sessionId: input.sessionId ?? null,
      userId: input.userId,
      type: input.type,
      description: input.description,
      commands: input.commands,
      output: null,
      status: 'pending',
      riskLevel: input.riskLevel,
      snapshotId: input.snapshotId ?? null,
      duration: null,
      inputTokens: input.inputTokens ?? 0,
      outputTokens: input.outputTokens ?? 0,
      createdAt: now.toISOString(),
      completedAt: null,
    };
  }

  async getById(id: string, userId: string): Promise<OperationRecord | null> {
    const rows = this.db
      .select()
      .from(operations)
      .where(and(eq(operations.id, id), eq(operations.userId, userId)))
      .limit(1)
      .all();

    return rows[0] ? this.toRecord(rows[0]) : null;
  }

  async listByServer(
    serverId: string,
    userId: string,
    pagination: PaginationOptions,
  ): Promise<{ operations: OperationRecord[]; total: number }> {
    if (!(await this.verifyServerOwnership(serverId, userId))) {
      return { operations: [], total: 0 };
    }

    const totalResult = this.db
      .select({ count: count() })
      .from(operations)
      .where(eq(operations.serverId, serverId))
      .all();
    const total = totalResult[0]?.count ?? 0;

    const rows = this.db
      .select()
      .from(operations)
      .where(eq(operations.serverId, serverId))
      .orderBy(desc(operations.createdAt))
      .limit(pagination.limit)
      .offset(pagination.offset)
      .all();

    return {
      operations: rows.map((row) => this.toRecord(row)),
      total,
    };
  }

  async listByStatus(
    userId: string,
    status: OperationStatus,
    pagination: PaginationOptions,
  ): Promise<{ operations: OperationRecord[]; total: number }> {
    const totalResult = this.db
      .select({ count: count() })
      .from(operations)
      .where(and(eq(operations.userId, userId), eq(operations.status, status)))
      .all();
    const total = totalResult[0]?.count ?? 0;

    const rows = this.db
      .select()
      .from(operations)
      .where(and(eq(operations.userId, userId), eq(operations.status, status)))
      .orderBy(desc(operations.createdAt))
      .limit(pagination.limit)
      .offset(pagination.offset)
      .all();

    return {
      operations: rows.map((row) => this.toRecord(row)),
      total,
    };
  }

  async markRunning(id: string, userId: string): Promise<boolean> {
    const existing = await this.getById(id, userId);
    if (!existing || existing.status !== 'pending') return false;

    this.db
      .update(operations)
      .set({ status: 'running' as const })
      .where(and(eq(operations.id, id), eq(operations.userId, userId)))
      .run();

    return true;
  }

  async markComplete(
    id: string,
    userId: string,
    output: string,
    status: 'success' | 'failed' | 'rolled_back',
    duration: number,
  ): Promise<boolean> {
    const existing = await this.getById(id, userId);
    if (!existing) return false;

    this.db
      .update(operations)
      .set({
        status,
        output,
        duration,
        completedAt: new Date(),
      })
      .where(and(eq(operations.id, id), eq(operations.userId, userId)))
      .run();

    return true;
  }

  async listWithFilter(
    userId: string,
    filter: OperationFilter,
    pagination: PaginationOptions,
  ): Promise<{ operations: OperationRecord[]; total: number }> {
    const conditions = this.buildFilterConditions(userId, filter);

    const totalResult = this.db
      .select({ count: count() })
      .from(operations)
      .where(and(...conditions))
      .all();
    const total = totalResult[0]?.count ?? 0;

    const rows = this.db
      .select()
      .from(operations)
      .where(and(...conditions))
      .orderBy(desc(operations.createdAt))
      .limit(pagination.limit)
      .offset(pagination.offset)
      .all();

    return {
      operations: rows.map((row) => this.toRecord(row)),
      total,
    };
  }

  async getStats(userId: string, serverId?: string): Promise<OperationStats> {
    const conditions = serverId
      ? [eq(operations.userId, userId), eq(operations.serverId, serverId)]
      : [eq(operations.userId, userId)];

    // Total count
    const totalResult = this.db
      .select({ count: count() })
      .from(operations)
      .where(and(...conditions))
      .all();
    const total = totalResult[0]?.count ?? 0;

    if (total === 0) {
      return {
        total: 0,
        byStatus: { pending: 0, running: 0, success: 0, failed: 0, rolled_back: 0 },
        byType: { install: 0, config: 0, restart: 0, execute: 0, backup: 0 },
        byRiskLevel: { green: 0, yellow: 0, red: 0, critical: 0 },
        avgDuration: null,
        successRate: 0,
      };
    }

    // Count by status
    const statusRows = this.db
      .select({ status: operations.status, count: count() })
      .from(operations)
      .where(and(...conditions))
      .groupBy(operations.status)
      .all();

    const byStatus: Record<OperationStatus, number> = {
      pending: 0, running: 0, success: 0, failed: 0, rolled_back: 0,
    };
    for (const row of statusRows) {
      byStatus[row.status as OperationStatus] = row.count;
    }

    // Count by type
    const typeRows = this.db
      .select({ type: operations.type, count: count() })
      .from(operations)
      .where(and(...conditions))
      .groupBy(operations.type)
      .all();

    const byType: Record<OperationType, number> = {
      install: 0, config: 0, restart: 0, execute: 0, backup: 0,
    };
    for (const row of typeRows) {
      byType[row.type as OperationType] = row.count;
    }

    // Count by risk level
    const riskRows = this.db
      .select({ riskLevel: operations.riskLevel, count: count() })
      .from(operations)
      .where(and(...conditions))
      .groupBy(operations.riskLevel)
      .all();

    const byRiskLevel: Record<RiskLevel, number> = {
      green: 0, yellow: 0, red: 0, critical: 0,
    };
    for (const row of riskRows) {
      byRiskLevel[row.riskLevel as RiskLevel] = row.count;
    }

    // Average duration (only completed operations)
    const durationResult = this.db
      .select({ avg: sql<number>`avg(${operations.duration})` })
      .from(operations)
      .where(and(
        ...conditions,
        sql`${operations.duration} IS NOT NULL`,
      ))
      .all();
    const avgDuration = durationResult[0]?.avg ?? null;

    // Success rate
    const completed = byStatus.success + byStatus.failed + byStatus.rolled_back;
    const successRate = completed > 0
      ? Math.round((byStatus.success / completed) * 10000) / 100
      : 0;

    return { total, byStatus, byType, byRiskLevel, avgDuration, successRate };
  }

  async updateOutput(
    id: string,
    userId: string,
    output: string,
  ): Promise<boolean> {
    const existing = await this.getById(id, userId);
    if (!existing) return false;

    this.db
      .update(operations)
      .set({ output })
      .where(and(eq(operations.id, id), eq(operations.userId, userId)))
      .run();

    return true;
  }

  async updateTokenUsage(
    id: string,
    userId: string,
    inputTokens: number,
    outputTokens: number,
  ): Promise<boolean> {
    const existing = await this.getById(id, userId);
    if (!existing) return false;

    this.db
      .update(operations)
      .set({ inputTokens, outputTokens })
      .where(and(eq(operations.id, id), eq(operations.userId, userId)))
      .run();

    return true;
  }

  private buildFilterConditions(userId: string, filter: OperationFilter) {
    const conditions = [eq(operations.userId, userId)];

    if (filter.serverId) {
      conditions.push(eq(operations.serverId, filter.serverId));
    }
    if (filter.type) {
      conditions.push(eq(operations.type, filter.type));
    }
    if (filter.status) {
      conditions.push(eq(operations.status, filter.status));
    }
    if (filter.riskLevel) {
      conditions.push(eq(operations.riskLevel, filter.riskLevel));
    }
    if (filter.search) {
      conditions.push(like(operations.description, `%${filter.search}%`));
    }
    if (filter.startDate) {
      conditions.push(gte(operations.createdAt, new Date(filter.startDate)));
    }
    if (filter.endDate) {
      conditions.push(lte(operations.createdAt, new Date(filter.endDate)));
    }

    return conditions;
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

  private toRecord(row: typeof operations.$inferSelect): OperationRecord {
    return {
      id: row.id,
      serverId: row.serverId,
      sessionId: row.sessionId ?? null,
      userId: row.userId,
      type: row.type as OperationType,
      description: row.description,
      commands: (row.commands ?? []) as string[],
      output: row.output ?? null,
      status: row.status as OperationStatus,
      riskLevel: row.riskLevel as RiskLevel,
      snapshotId: row.snapshotId ?? null,
      duration: row.duration ?? null,
      inputTokens: row.inputTokens ?? 0,
      outputTokens: row.outputTokens ?? 0,
      createdAt: row.createdAt.toISOString(),
      completedAt: toISOString(row.completedAt),
    };
  }
}

// ============================================================================
// Singleton
// ============================================================================

let _repository: OperationRepository | null = null;

export function getOperationRepository(): OperationRepository {
  if (!_repository) {
    _repository = new DrizzleOperationRepository(getDatabase());
  }
  return _repository;
}

export function setOperationRepository(repo: OperationRepository): void {
  _repository = repo;
}

export function _resetOperationRepository(): void {
  _repository = null;
}
