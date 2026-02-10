/**
 * Snapshot repository — data access layer for pre/post-operation backups.
 *
 * Manages file and config snapshots with expiration-based cleanup.
 *
 * @module db/repositories/snapshot-repository
 */

import { randomUUID } from 'node:crypto';
import { eq, and, count, desc, lt } from 'drizzle-orm';

import { getDatabase } from '../connection.js';
import { snapshots, servers } from '../schema.js';

import type { DrizzleDB } from '../connection.js';
import type { SnapshotFile, SnapshotConfig } from '../schema.js';

// ============================================================================
// Types
// ============================================================================

export interface Snapshot {
  id: string;
  serverId: string;
  operationId: string | null;
  files: SnapshotFile[];
  configs: SnapshotConfig[];
  createdAt: string;
  expiresAt: string | null;
}

export interface CreateSnapshotInput {
  serverId: string;
  userId: string;
  operationId?: string;
  files: SnapshotFile[];
  configs: SnapshotConfig[];
  expiresAt?: Date;
}

export interface PaginationOptions {
  limit: number;
  offset: number;
}

// ============================================================================
// Repository Interface
// ============================================================================

export interface SnapshotRepository {
  /** Create a new snapshot. */
  create(input: CreateSnapshotInput): Promise<Snapshot>;

  /** Get snapshot by ID with user isolation via server ownership. */
  getById(id: string, userId: string): Promise<Snapshot | null>;

  /** List snapshots for a server with pagination. */
  listByServer(
    serverId: string,
    userId: string,
    pagination: PaginationOptions,
  ): Promise<{ snapshots: Snapshot[]; total: number }>;

  /** List snapshots associated with an operation. */
  listByOperation(operationId: string, userId: string): Promise<Snapshot[]>;

  /** Delete a snapshot. */
  delete(id: string, userId: string): Promise<boolean>;

  /** Get all expired snapshots for cleanup. */
  getExpired(): Promise<Snapshot[]>;

  /** Delete all expired snapshots and return count removed. */
  deleteExpired(): Promise<number>;
}

// ============================================================================
// Drizzle Implementation
// ============================================================================

function toISOString(date: Date | null | undefined): string | null {
  return date ? date.toISOString() : null;
}

export class DrizzleSnapshotRepository implements SnapshotRepository {
  constructor(private db: DrizzleDB) {}

  async create(input: CreateSnapshotInput): Promise<Snapshot> {
    if (!(await this.verifyServerOwnership(input.serverId, input.userId))) {
      throw new Error('Server not found or access denied');
    }

    const now = new Date();
    const id = randomUUID();

    this.db.insert(snapshots).values({
      id,
      serverId: input.serverId,
      operationId: input.operationId ?? null,
      files: input.files,
      configs: input.configs,
      createdAt: now,
      expiresAt: input.expiresAt ?? null,
    }).run();

    return {
      id,
      serverId: input.serverId,
      operationId: input.operationId ?? null,
      files: input.files,
      configs: input.configs,
      createdAt: now.toISOString(),
      expiresAt: toISOString(input.expiresAt ?? null),
    };
  }

  async getById(id: string, userId: string): Promise<Snapshot | null> {
    const rows = this.db
      .select()
      .from(snapshots)
      .where(eq(snapshots.id, id))
      .limit(1)
      .all();

    if (!rows[0]) return null;

    // Verify user owns the server
    if (!(await this.verifyServerOwnership(rows[0].serverId, userId))) {
      return null;
    }

    return this.toSnapshot(rows[0]);
  }

  async listByServer(
    serverId: string,
    userId: string,
    pagination: PaginationOptions,
  ): Promise<{ snapshots: Snapshot[]; total: number }> {
    if (!(await this.verifyServerOwnership(serverId, userId))) {
      return { snapshots: [], total: 0 };
    }

    const totalResult = this.db
      .select({ count: count() })
      .from(snapshots)
      .where(eq(snapshots.serverId, serverId))
      .all();
    const total = totalResult[0]?.count ?? 0;

    const rows = this.db
      .select()
      .from(snapshots)
      .where(eq(snapshots.serverId, serverId))
      .orderBy(desc(snapshots.createdAt))
      .limit(pagination.limit)
      .offset(pagination.offset)
      .all();

    return {
      snapshots: rows.map((row) => this.toSnapshot(row)),
      total,
    };
  }

  async listByOperation(
    operationId: string,
    userId: string,
  ): Promise<Snapshot[]> {
    const rows = this.db
      .select()
      .from(snapshots)
      .where(eq(snapshots.operationId, operationId))
      .all();

    // Filter by user ownership
    const results: Snapshot[] = [];
    for (const row of rows) {
      if (await this.verifyServerOwnership(row.serverId, userId)) {
        results.push(this.toSnapshot(row));
      }
    }
    return results;
  }

  async delete(id: string, userId: string): Promise<boolean> {
    const existing = await this.getById(id, userId);
    if (!existing) return false;

    this.db
      .delete(snapshots)
      .where(eq(snapshots.id, id))
      .run();

    return true;
  }

  async getExpired(): Promise<Snapshot[]> {
    const now = new Date();
    const rows = this.db
      .select()
      .from(snapshots)
      .where(lt(snapshots.expiresAt, now))
      .all();

    return rows.map((row) => this.toSnapshot(row));
  }

  async deleteExpired(): Promise<number> {
    const now = new Date();
    const expired = this.db
      .select({ id: snapshots.id })
      .from(snapshots)
      .where(lt(snapshots.expiresAt, now))
      .all();

    if (expired.length === 0) return 0;

    for (const row of expired) {
      this.db.delete(snapshots).where(eq(snapshots.id, row.id)).run();
    }

    return expired.length;
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

  private toSnapshot(row: typeof snapshots.$inferSelect): Snapshot {
    return {
      id: row.id,
      serverId: row.serverId,
      operationId: row.operationId ?? null,
      files: (row.files ?? []) as SnapshotFile[],
      configs: (row.configs ?? []) as SnapshotConfig[],
      createdAt: row.createdAt.toISOString(),
      expiresAt: toISOString(row.expiresAt),
    };
  }
}

// ============================================================================
// Singleton
// ============================================================================

let _repository: SnapshotRepository | null = null;

export function getSnapshotRepository(): SnapshotRepository {
  if (!_repository) {
    _repository = new DrizzleSnapshotRepository(getDatabase());
  }
  return _repository;
}

export function setSnapshotRepository(repo: SnapshotRepository): void {
  _repository = repo;
}

export function _resetSnapshotRepository(): void {
  _repository = null;
}
