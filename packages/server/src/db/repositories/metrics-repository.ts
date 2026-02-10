/**
 * Metrics repository — data access layer for time-series monitoring data.
 *
 * Stores and queries CPU, memory, disk, and network metrics
 * with time-range filtering and automatic data pruning.
 *
 * @module db/repositories/metrics-repository
 */

import { randomUUID } from 'node:crypto';
import { eq, and, gte, lt, desc, count } from 'drizzle-orm';

import { getDatabase } from '../connection.js';
import { metrics, servers } from '../schema.js';

import type { DrizzleDB } from '../connection.js';

// ============================================================================
// Types
// ============================================================================

export interface MetricPoint {
  id: string;
  serverId: string;
  cpuUsage: number;
  memoryUsage: number;
  memoryTotal: number;
  diskUsage: number;
  diskTotal: number;
  networkIn: number;
  networkOut: number;
  timestamp: string;
}

export interface CreateMetricInput {
  serverId: string;
  cpuUsage: number;
  memoryUsage: number;
  memoryTotal: number;
  diskUsage: number;
  diskTotal: number;
  networkIn: number;
  networkOut: number;
}

export type MetricsRange = '1h' | '24h' | '7d';

const RANGE_MS: Record<MetricsRange, number> = {
  '1h': 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
};

// ============================================================================
// Repository Interface
// ============================================================================

export interface MetricsRepository {
  /** Record a new metric point. */
  record(input: CreateMetricInput): Promise<MetricPoint>;

  /** Get metrics for a server within a time range. */
  getByServerAndRange(
    serverId: string,
    userId: string,
    range: MetricsRange,
  ): Promise<MetricPoint[]>;

  /** Get the latest metric point for a server. */
  getLatest(serverId: string, userId: string): Promise<MetricPoint | null>;

  /** Delete metrics older than given date. */
  pruneOlderThan(before: Date): Promise<number>;
}

// ============================================================================
// Drizzle Implementation
// ============================================================================

export class DrizzleMetricsRepository implements MetricsRepository {
  constructor(private db: DrizzleDB) {}

  async record(input: CreateMetricInput): Promise<MetricPoint> {
    const now = new Date();
    const id = randomUUID();

    this.db.insert(metrics).values({
      id,
      serverId: input.serverId,
      cpuUsage: Math.round(input.cpuUsage * 100), // Store as 0-10000
      memoryUsage: input.memoryUsage,
      memoryTotal: input.memoryTotal,
      diskUsage: input.diskUsage,
      diskTotal: input.diskTotal,
      networkIn: input.networkIn,
      networkOut: input.networkOut,
      timestamp: now,
    }).run();

    return {
      id,
      serverId: input.serverId,
      cpuUsage: input.cpuUsage,
      memoryUsage: input.memoryUsage,
      memoryTotal: input.memoryTotal,
      diskUsage: input.diskUsage,
      diskTotal: input.diskTotal,
      networkIn: input.networkIn,
      networkOut: input.networkOut,
      timestamp: now.toISOString(),
    };
  }

  async getByServerAndRange(
    serverId: string,
    userId: string,
    range: MetricsRange,
  ): Promise<MetricPoint[]> {
    if (!(await this.verifyServerOwnership(serverId, userId))) {
      return [];
    }

    const cutoff = new Date(Date.now() - RANGE_MS[range]);

    const rows = this.db
      .select()
      .from(metrics)
      .where(
        and(
          eq(metrics.serverId, serverId),
          gte(metrics.timestamp, cutoff),
        ),
      )
      .orderBy(metrics.timestamp)
      .all();

    return rows.map((row) => this.toMetricPoint(row));
  }

  async getLatest(
    serverId: string,
    userId: string,
  ): Promise<MetricPoint | null> {
    if (!(await this.verifyServerOwnership(serverId, userId))) {
      return null;
    }

    const rows = this.db
      .select()
      .from(metrics)
      .where(eq(metrics.serverId, serverId))
      .orderBy(desc(metrics.timestamp))
      .limit(1)
      .all();

    return rows[0] ? this.toMetricPoint(rows[0]) : null;
  }

  async pruneOlderThan(before: Date): Promise<number> {
    // Count before deleting since drizzle .run() doesn't return changes for delete
    const countResult = this.db
      .select({ count: count() })
      .from(metrics)
      .where(lt(metrics.timestamp, before))
      .all();
    const toDelete = countResult[0]?.count ?? 0;

    if (toDelete > 0) {
      this.db.delete(metrics).where(lt(metrics.timestamp, before)).run();
    }

    return toDelete;
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

  private toMetricPoint(row: typeof metrics.$inferSelect): MetricPoint {
    return {
      id: row.id,
      serverId: row.serverId,
      cpuUsage: row.cpuUsage / 100, // Convert back to 0-100 percentage
      memoryUsage: row.memoryUsage,
      memoryTotal: row.memoryTotal,
      diskUsage: row.diskUsage,
      diskTotal: row.diskTotal,
      networkIn: row.networkIn,
      networkOut: row.networkOut,
      timestamp: row.timestamp.toISOString(),
    };
  }
}

// ============================================================================
// Singleton
// ============================================================================

let _repository: MetricsRepository | null = null;

export function getMetricsRepository(): MetricsRepository {
  if (!_repository) {
    _repository = new DrizzleMetricsRepository(getDatabase());
  }
  return _repository;
}

export function setMetricsRepository(repo: MetricsRepository): void {
  _repository = repo;
}

export function _resetMetricsRepository(): void {
  _repository = null;
}
