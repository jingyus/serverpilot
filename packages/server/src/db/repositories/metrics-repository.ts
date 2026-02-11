// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Metrics repository — data access layer for time-series monitoring data.
 *
 * Stores and queries CPU, memory, disk, and network metrics
 * with time-range filtering, aggregation, and automatic data pruning.
 *
 * Supports three tiers of data:
 * - Raw data: per-minute samples, retained 7 days
 * - Hourly aggregates: avg/min/max per hour, retained 30 days
 * - Daily aggregates: avg/min/max per day, retained 1 year
 *
 * @module db/repositories/metrics-repository
 */

import { randomUUID } from 'node:crypto';
import { eq, and, gte, lt, desc, count } from 'drizzle-orm';

import { getDatabase } from '../connection.js';
import { metrics, metricsHourly, metricsDaily, servers } from '../schema.js';

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

export interface AggregatedMetricPoint {
  serverId: string;
  cpuUsage: { avg: number; min: number; max: number };
  memoryUsage: { avg: number; min: number; max: number };
  memoryTotal: number;
  diskUsage: { avg: number; min: number; max: number };
  diskTotal: number;
  networkIn: { avg: number; max: number };
  networkOut: { avg: number; max: number };
  sampleCount: number;
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

  /** Aggregate raw metrics into hourly buckets for a time range. */
  aggregateToHourly(from: Date, to: Date): Promise<number>;

  /** Aggregate hourly metrics into daily buckets for a time range. */
  aggregateToDaily(from: Date, to: Date): Promise<number>;

  /** Prune hourly aggregates older than given date. */
  pruneHourlyOlderThan(before: Date): Promise<number>;

  /** Prune daily aggregates older than given date. */
  pruneDailyOlderThan(before: Date): Promise<number>;

  /** Get hourly aggregated metrics for a server within a time range. */
  getHourlyByServerAndRange(
    serverId: string,
    userId: string,
    from: Date,
    to: Date,
  ): Promise<AggregatedMetricPoint[]>;

  /** Get daily aggregated metrics for a server within a time range. */
  getDailyByServerAndRange(
    serverId: string,
    userId: string,
    from: Date,
    to: Date,
  ): Promise<AggregatedMetricPoint[]>;
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

  async aggregateToHourly(from: Date, to: Date): Promise<number> {
    const rows = this.db
      .select()
      .from(metrics)
      .where(and(gte(metrics.timestamp, from), lt(metrics.timestamp, to)))
      .orderBy(metrics.timestamp)
      .all();

    if (rows.length === 0) return 0;

    // Group by (serverId, hourBucket)
    const HOUR_MS = 60 * 60 * 1000;
    const buckets = new Map<string, typeof rows>();

    for (const row of rows) {
      const ts = row.timestamp.getTime();
      const bucketTime = Math.floor(ts / HOUR_MS) * HOUR_MS;
      const key = `${row.serverId}:${bucketTime}`;
      if (!buckets.has(key)) {
        buckets.set(key, []);
      }
      buckets.get(key)!.push(row);
    }

    let inserted = 0;
    for (const [key, bucketRows] of buckets) {
      const [serverId, bucketTimeStr] = key.split(':');
      const bucketTime = new Date(Number(bucketTimeStr));

      // Check if this bucket already exists
      const existing = this.db
        .select({ count: count() })
        .from(metricsHourly)
        .where(
          and(
            eq(metricsHourly.serverId, serverId),
            eq(metricsHourly.bucketTime, bucketTime),
          ),
        )
        .all();

      if ((existing[0]?.count ?? 0) > 0) continue;

      const agg = this.computeAggregate(bucketRows);

      this.db.insert(metricsHourly).values({
        id: randomUUID(),
        serverId,
        cpuAvg: agg.cpuAvg,
        cpuMin: agg.cpuMin,
        cpuMax: agg.cpuMax,
        memoryAvg: agg.memoryAvg,
        memoryMin: agg.memoryMin,
        memoryMax: agg.memoryMax,
        memoryTotal: agg.memoryTotal,
        diskAvg: agg.diskAvg,
        diskMin: agg.diskMin,
        diskMax: agg.diskMax,
        diskTotal: agg.diskTotal,
        networkInAvg: agg.networkInAvg,
        networkInMax: agg.networkInMax,
        networkOutAvg: agg.networkOutAvg,
        networkOutMax: agg.networkOutMax,
        sampleCount: bucketRows.length,
        bucketTime,
      }).run();

      inserted++;
    }

    return inserted;
  }

  async aggregateToDaily(from: Date, to: Date): Promise<number> {
    const rows = this.db
      .select()
      .from(metricsHourly)
      .where(and(gte(metricsHourly.bucketTime, from), lt(metricsHourly.bucketTime, to)))
      .orderBy(metricsHourly.bucketTime)
      .all();

    if (rows.length === 0) return 0;

    const DAY_MS = 24 * 60 * 60 * 1000;
    const buckets = new Map<string, typeof rows>();

    for (const row of rows) {
      const ts = row.bucketTime.getTime();
      const bucketTime = Math.floor(ts / DAY_MS) * DAY_MS;
      const key = `${row.serverId}:${bucketTime}`;
      if (!buckets.has(key)) {
        buckets.set(key, []);
      }
      buckets.get(key)!.push(row);
    }

    let inserted = 0;
    for (const [key, bucketRows] of buckets) {
      const [serverId, bucketTimeStr] = key.split(':');
      const bucketTime = new Date(Number(bucketTimeStr));

      const existing = this.db
        .select({ count: count() })
        .from(metricsDaily)
        .where(
          and(
            eq(metricsDaily.serverId, serverId),
            eq(metricsDaily.bucketTime, bucketTime),
          ),
        )
        .all();

      if ((existing[0]?.count ?? 0) > 0) continue;

      const totalSamples = bucketRows.reduce((s, r) => s + r.sampleCount, 0);
      const agg = this.computeHourlyAggregate(bucketRows);

      this.db.insert(metricsDaily).values({
        id: randomUUID(),
        serverId,
        cpuAvg: agg.cpuAvg,
        cpuMin: agg.cpuMin,
        cpuMax: agg.cpuMax,
        memoryAvg: agg.memoryAvg,
        memoryMin: agg.memoryMin,
        memoryMax: agg.memoryMax,
        memoryTotal: agg.memoryTotal,
        diskAvg: agg.diskAvg,
        diskMin: agg.diskMin,
        diskMax: agg.diskMax,
        diskTotal: agg.diskTotal,
        networkInAvg: agg.networkInAvg,
        networkInMax: agg.networkInMax,
        networkOutAvg: agg.networkOutAvg,
        networkOutMax: agg.networkOutMax,
        sampleCount: totalSamples,
        bucketTime,
      }).run();

      inserted++;
    }

    return inserted;
  }

  async pruneHourlyOlderThan(before: Date): Promise<number> {
    const countResult = this.db
      .select({ count: count() })
      .from(metricsHourly)
      .where(lt(metricsHourly.bucketTime, before))
      .all();
    const toDelete = countResult[0]?.count ?? 0;

    if (toDelete > 0) {
      this.db.delete(metricsHourly).where(lt(metricsHourly.bucketTime, before)).run();
    }

    return toDelete;
  }

  async pruneDailyOlderThan(before: Date): Promise<number> {
    const countResult = this.db
      .select({ count: count() })
      .from(metricsDaily)
      .where(lt(metricsDaily.bucketTime, before))
      .all();
    const toDelete = countResult[0]?.count ?? 0;

    if (toDelete > 0) {
      this.db.delete(metricsDaily).where(lt(metricsDaily.bucketTime, before)).run();
    }

    return toDelete;
  }

  async getHourlyByServerAndRange(
    serverId: string,
    userId: string,
    from: Date,
    to: Date,
  ): Promise<AggregatedMetricPoint[]> {
    if (!(await this.verifyServerOwnership(serverId, userId))) {
      return [];
    }

    const rows = this.db
      .select()
      .from(metricsHourly)
      .where(
        and(
          eq(metricsHourly.serverId, serverId),
          gte(metricsHourly.bucketTime, from),
          lt(metricsHourly.bucketTime, to),
        ),
      )
      .orderBy(metricsHourly.bucketTime)
      .all();

    return rows.map((row) => this.toAggregatedPoint(row));
  }

  async getDailyByServerAndRange(
    serverId: string,
    userId: string,
    from: Date,
    to: Date,
  ): Promise<AggregatedMetricPoint[]> {
    if (!(await this.verifyServerOwnership(serverId, userId))) {
      return [];
    }

    const rows = this.db
      .select()
      .from(metricsDaily)
      .where(
        and(
          eq(metricsDaily.serverId, serverId),
          gte(metricsDaily.bucketTime, from),
          lt(metricsDaily.bucketTime, to),
        ),
      )
      .orderBy(metricsDaily.bucketTime)
      .all();

    return rows.map((row) => this.toAggregatedPoint(row));
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

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

  private toAggregatedPoint(
    row: typeof metricsHourly.$inferSelect | typeof metricsDaily.$inferSelect,
  ): AggregatedMetricPoint {
    return {
      serverId: row.serverId,
      cpuUsage: {
        avg: row.cpuAvg / 100,
        min: row.cpuMin / 100,
        max: row.cpuMax / 100,
      },
      memoryUsage: {
        avg: row.memoryAvg,
        min: row.memoryMin,
        max: row.memoryMax,
      },
      memoryTotal: row.memoryTotal,
      diskUsage: {
        avg: row.diskAvg,
        min: row.diskMin,
        max: row.diskMax,
      },
      diskTotal: row.diskTotal,
      networkIn: { avg: row.networkInAvg, max: row.networkInMax },
      networkOut: { avg: row.networkOutAvg, max: row.networkOutMax },
      sampleCount: row.sampleCount,
      timestamp: row.bucketTime.toISOString(),
    };
  }

  /** Compute aggregate stats from raw metric rows. */
  private computeAggregate(rows: (typeof metrics.$inferSelect)[]) {
    const cpuValues = rows.map((r) => r.cpuUsage);
    const memValues = rows.map((r) => r.memoryUsage);
    const diskValues = rows.map((r) => r.diskUsage);
    const netInValues = rows.map((r) => r.networkIn);
    const netOutValues = rows.map((r) => r.networkOut);

    return {
      cpuAvg: Math.round(cpuValues.reduce((a, b) => a + b, 0) / cpuValues.length),
      cpuMin: Math.min(...cpuValues),
      cpuMax: Math.max(...cpuValues),
      memoryAvg: Math.round(memValues.reduce((a, b) => a + b, 0) / memValues.length),
      memoryMin: Math.min(...memValues),
      memoryMax: Math.max(...memValues),
      memoryTotal: rows[rows.length - 1].memoryTotal,
      diskAvg: Math.round(diskValues.reduce((a, b) => a + b, 0) / diskValues.length),
      diskMin: Math.min(...diskValues),
      diskMax: Math.max(...diskValues),
      diskTotal: rows[rows.length - 1].diskTotal,
      networkInAvg: Math.round(netInValues.reduce((a, b) => a + b, 0) / netInValues.length),
      networkInMax: Math.max(...netInValues),
      networkOutAvg: Math.round(netOutValues.reduce((a, b) => a + b, 0) / netOutValues.length),
      networkOutMax: Math.max(...netOutValues),
    };
  }

  /** Compute aggregate stats from hourly aggregate rows. */
  private computeHourlyAggregate(rows: (typeof metricsHourly.$inferSelect)[]) {
    const totalWeight = rows.reduce((s, r) => s + r.sampleCount, 0);

    // Weighted average for avg fields
    const cpuAvg = Math.round(
      rows.reduce((s, r) => s + r.cpuAvg * r.sampleCount, 0) / totalWeight,
    );
    const memoryAvg = Math.round(
      rows.reduce((s, r) => s + r.memoryAvg * r.sampleCount, 0) / totalWeight,
    );
    const diskAvg = Math.round(
      rows.reduce((s, r) => s + r.diskAvg * r.sampleCount, 0) / totalWeight,
    );
    const networkInAvg = Math.round(
      rows.reduce((s, r) => s + r.networkInAvg * r.sampleCount, 0) / totalWeight,
    );
    const networkOutAvg = Math.round(
      rows.reduce((s, r) => s + r.networkOutAvg * r.sampleCount, 0) / totalWeight,
    );

    return {
      cpuAvg,
      cpuMin: Math.min(...rows.map((r) => r.cpuMin)),
      cpuMax: Math.max(...rows.map((r) => r.cpuMax)),
      memoryAvg,
      memoryMin: Math.min(...rows.map((r) => r.memoryMin)),
      memoryMax: Math.max(...rows.map((r) => r.memoryMax)),
      memoryTotal: rows[rows.length - 1].memoryTotal,
      diskAvg,
      diskMin: Math.min(...rows.map((r) => r.diskMin)),
      diskMax: Math.max(...rows.map((r) => r.diskMax)),
      diskTotal: rows[rows.length - 1].diskTotal,
      networkInAvg,
      networkInMax: Math.max(...rows.map((r) => r.networkInMax)),
      networkOutAvg,
      networkOutMax: Math.max(...rows.map((r) => r.networkOutMax)),
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
