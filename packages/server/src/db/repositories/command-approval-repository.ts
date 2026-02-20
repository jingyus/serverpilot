// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Command Approval Repository — data access layer for dangerous command approvals.
 *
 * Manages approval workflow: create → pending → approved/rejected/expired.
 *
 * @module db/repositories/command-approval-repository
 */

import { randomUUID } from "node:crypto";
import { eq, and, desc, lte } from "drizzle-orm";
import { getDatabase } from "../connection.js";
import { commandApprovals } from "../schema.js";
import type { DrizzleDB } from "../connection.js";
import type {
  CommandApprovalRiskLevel,
  CommandApprovalStatus,
  CommandApprovalExecutionContext,
} from "../schema.js";

// ============================================================================
// Types
// ============================================================================

export interface CommandApproval {
  id: string;
  userId: string;
  serverId: string;
  command: string;
  riskLevel: CommandApprovalRiskLevel;
  status: CommandApprovalStatus;
  reason: string | null;
  warnings: string[];
  requestedAt: string;
  expiresAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  executionContext: CommandApprovalExecutionContext | null;
  createdAt: string;
}

export interface CreateCommandApprovalInput {
  userId: string;
  serverId: string;
  command: string;
  riskLevel: CommandApprovalRiskLevel;
  reason?: string;
  warnings?: string[];
  executionContext?: CommandApprovalExecutionContext;
  expiryMinutes?: number; // Default: 5 minutes
}

export interface UpdateCommandApprovalInput {
  status: "approved" | "rejected";
  decidedBy: string;
}

export interface FindApprovalsOptions {
  userId?: string;
  serverId?: string;
  status?: CommandApprovalStatus;
  limit?: number;
}

// ============================================================================
// Repository Interface
// ============================================================================

export interface CommandApprovalRepository {
  create(input: CreateCommandApprovalInput): Promise<CommandApproval>;
  findById(id: string): Promise<CommandApproval | null>;
  findByUser(
    userId: string,
    options?: FindApprovalsOptions,
  ): Promise<CommandApproval[]>;
  findPending(userId: string): Promise<CommandApproval[]>;
  approve(id: string, decidedBy: string): Promise<CommandApproval>;
  reject(id: string, decidedBy: string): Promise<CommandApproval>;
  expireOldApprovals(): Promise<number>;
}

// ============================================================================
// Drizzle Implementation
// ============================================================================

export class DrizzleCommandApprovalRepository implements CommandApprovalRepository {
  constructor(private db: DrizzleDB) {}

  async create(input: CreateCommandApprovalInput): Promise<CommandApproval> {
    const id = randomUUID();
    const now = new Date();
    const expiryMinutes = input.expiryMinutes ?? 5;
    const expiresAt = new Date(now.getTime() + expiryMinutes * 60 * 1000);

    await this.db.insert(commandApprovals).values({
      id,
      userId: input.userId,
      serverId: input.serverId,
      command: input.command,
      riskLevel: input.riskLevel,
      status: "pending",
      reason: input.reason ?? null,
      warnings: input.warnings ?? [],
      requestedAt: now,
      expiresAt,
      executionContext: input.executionContext ?? null,
      createdAt: now,
    });

    return this.findById(id) as Promise<CommandApproval>;
  }

  async findById(id: string): Promise<CommandApproval | null> {
    const rows = await this.db
      .select()
      .from(commandApprovals)
      .where(eq(commandApprovals.id, id))
      .limit(1);

    if (rows.length === 0) return null;

    return this.mapRow(rows[0]);
  }

  async findByUser(
    userId: string,
    options: FindApprovalsOptions = {},
  ): Promise<CommandApproval[]> {
    // Build conditions
    const conditions = [];
    conditions.push(eq(commandApprovals.userId, userId));

    if (options.serverId) {
      conditions.push(eq(commandApprovals.serverId, options.serverId));
    }

    if (options.status) {
      conditions.push(eq(commandApprovals.status, options.status));
    }

    // Build and execute query
    const baseQuery = this.db
      .select()
      .from(commandApprovals)
      .where(and(...conditions))
      .orderBy(desc(commandApprovals.requestedAt));

    const rows = options.limit
      ? await baseQuery.limit(options.limit)
      : await baseQuery;

    return rows.map((r) => this.mapRow(r));
  }

  async findPending(userId: string): Promise<CommandApproval[]> {
    const now = new Date();
    const rows = await this.db
      .select()
      .from(commandApprovals)
      .where(
        and(
          eq(commandApprovals.userId, userId),
          eq(commandApprovals.status, "pending"),
          lte(commandApprovals.expiresAt, now),
        ),
      )
      .orderBy(desc(commandApprovals.requestedAt));

    return rows.map((r) => this.mapRow(r));
  }

  async approve(id: string, decidedBy: string): Promise<CommandApproval> {
    const now = new Date();
    await this.db
      .update(commandApprovals)
      .set({
        status: "approved",
        decidedAt: now,
        decidedBy,
      })
      .where(eq(commandApprovals.id, id));

    return this.findById(id) as Promise<CommandApproval>;
  }

  async reject(id: string, decidedBy: string): Promise<CommandApproval> {
    const now = new Date();
    await this.db
      .update(commandApprovals)
      .set({
        status: "rejected",
        decidedAt: now,
        decidedBy,
      })
      .where(eq(commandApprovals.id, id));

    return this.findById(id) as Promise<CommandApproval>;
  }

  async expireOldApprovals(): Promise<number> {
    const now = new Date();
    const result = await this.db
      .update(commandApprovals)
      .set({ status: "expired" })
      .where(
        and(
          eq(commandApprovals.status, "pending"),
          lte(commandApprovals.expiresAt, now),
        ),
      );

    // Drizzle returns { changes: number } for SQLite updates
    return (result as unknown as { changes: number }).changes ?? 0;
  }

  private mapRow(row: typeof commandApprovals.$inferSelect): CommandApproval {
    return {
      id: row.id,
      userId: row.userId,
      serverId: row.serverId,
      command: row.command,
      riskLevel: row.riskLevel as CommandApprovalRiskLevel,
      status: row.status as CommandApprovalStatus,
      reason: row.reason,
      warnings: (row.warnings as string[]) ?? [],
      requestedAt: row.requestedAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      decidedAt: row.decidedAt?.toISOString() ?? null,
      decidedBy: row.decidedBy,
      executionContext:
        row.executionContext as CommandApprovalExecutionContext | null,
      createdAt: row.createdAt.toISOString(),
    };
  }
}

// ============================================================================
// InMemory Implementation (for testing)
// ============================================================================

export class InMemoryCommandApprovalRepository implements CommandApprovalRepository {
  private approvals = new Map<string, CommandApproval>();

  async create(input: CreateCommandApprovalInput): Promise<CommandApproval> {
    const id = randomUUID();
    const now = new Date();
    const expiryMinutes = input.expiryMinutes ?? 5;
    const expiresAt = new Date(now.getTime() + expiryMinutes * 60 * 1000);

    const approval: CommandApproval = {
      id,
      userId: input.userId,
      serverId: input.serverId,
      command: input.command,
      riskLevel: input.riskLevel,
      status: "pending",
      reason: input.reason ?? null,
      warnings: input.warnings ?? [],
      requestedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      decidedAt: null,
      decidedBy: null,
      executionContext: input.executionContext ?? null,
      createdAt: now.toISOString(),
    };

    this.approvals.set(id, approval);
    return approval;
  }

  async findById(id: string): Promise<CommandApproval | null> {
    return this.approvals.get(id) ?? null;
  }

  async findByUser(
    userId: string,
    options: FindApprovalsOptions = {},
  ): Promise<CommandApproval[]> {
    let results = Array.from(this.approvals.values()).filter(
      (a) => a.userId === userId,
    );

    if (options.serverId) {
      results = results.filter((a) => a.serverId === options.serverId);
    }

    if (options.status) {
      results = results.filter((a) => a.status === options.status);
    }

    // Sort by requestedAt descending
    results.sort(
      (a, b) =>
        new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime(),
    );

    if (options.limit) {
      results = results.slice(0, options.limit);
    }

    return results;
  }

  async findPending(userId: string): Promise<CommandApproval[]> {
    const now = new Date();
    return Array.from(this.approvals.values())
      .filter(
        (a) =>
          a.userId === userId &&
          a.status === "pending" &&
          new Date(a.expiresAt).getTime() > now.getTime(),
      )
      .sort(
        (a, b) =>
          new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime(),
      );
  }

  async approve(id: string, decidedBy: string): Promise<CommandApproval> {
    const approval = this.approvals.get(id);
    if (!approval) throw new Error("Approval not found");

    const updated: CommandApproval = {
      ...approval,
      status: "approved",
      decidedAt: new Date().toISOString(),
      decidedBy,
    };

    this.approvals.set(id, updated);
    return updated;
  }

  async reject(id: string, decidedBy: string): Promise<CommandApproval> {
    const approval = this.approvals.get(id);
    if (!approval) throw new Error("Approval not found");

    const updated: CommandApproval = {
      ...approval,
      status: "rejected",
      decidedAt: new Date().toISOString(),
      decidedBy,
    };

    this.approvals.set(id, updated);
    return updated;
  }

  async expireOldApprovals(): Promise<number> {
    const now = new Date();
    let expiredCount = 0;

    for (const [id, approval] of this.approvals.entries()) {
      if (
        approval.status === "pending" &&
        new Date(approval.expiresAt).getTime() <= now.getTime()
      ) {
        this.approvals.set(id, { ...approval, status: "expired" });
        expiredCount++;
      }
    }

    return expiredCount;
  }

  // Test helpers
  _reset(): void {
    this.approvals.clear();
  }

  _getAll(): CommandApproval[] {
    return Array.from(this.approvals.values());
  }
}

// ============================================================================
// Singleton
// ============================================================================

let repositoryInstance: CommandApprovalRepository | null = null;

export function getCommandApprovalRepository(): CommandApprovalRepository {
  if (!repositoryInstance) {
    repositoryInstance = new DrizzleCommandApprovalRepository(getDatabase());
  }
  return repositoryInstance;
}

export function setCommandApprovalRepository(
  repo: CommandApprovalRepository,
): void {
  repositoryInstance = repo;
}

export function _resetCommandApprovalRepository(): void {
  repositoryInstance = null;
}
