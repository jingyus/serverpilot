// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * CostTracker — real-time AI cost aggregation for the Usage dashboard.
 *
 * Provides:
 * - Monthly cost totals per user
 * - Daily cost trends (with zero-fill for missing days)
 * - Model usage distribution (call counts + cost ratios)
 * - Monthly token aggregates (input / output)
 *
 * Works alongside AIQuotaManager; uses the same `ai_usage` table but
 * provides richer analytical queries for dashboard display.
 *
 * @module cloud/ai/cost-tracker
 */

import type { ModelName } from './types.js';

// ---------------------------------------------------------------------------
// Data-access interface (injected at construction)
// ---------------------------------------------------------------------------

/** A single day's cost aggregate. */
export interface DailyCostEntry {
  /** ISO date string (YYYY-MM-DD). */
  date: string;
  /** Total cost in USD for this day. */
  cost: number;
}

/** Model usage distribution entry. */
export interface ModelDistributionEntry {
  /** The model identifier. */
  model: ModelName;
  /** Number of API calls using this model. */
  callCount: number;
  /** Total cost in USD for this model. */
  totalCost: number;
  /** Percentage of total cost (0–100). */
  costPercent: number;
}

/** Aggregated token usage for a period. */
export interface TokenUsage {
  /** Total input tokens consumed. */
  inputTokens: number;
  /** Total output tokens generated. */
  outputTokens: number;
}

/** Raw per-model aggregate returned by the data-access layer. */
export interface ModelAggregateRow {
  model: ModelName;
  callCount: number;
  totalCost: number;
}

/** Raw per-day aggregate returned by the data-access layer. */
export interface DailyCostRow {
  date: string; // YYYY-MM-DD
  cost: number;
}

/** Minimal data-access layer the CostTracker needs. */
export interface CostTrackerDataAccess {
  /** Sum `cost` for a user between `since` and `until`. */
  getTotalCost(userId: string, since: Date, until: Date): Promise<number>;

  /** Return per-day cost aggregates for a user in the given range. */
  getDailyCosts(userId: string, since: Date, until: Date): Promise<DailyCostRow[]>;

  /** Return per-model aggregates (call count + total cost) for a user in the given range. */
  getModelAggregates(userId: string, since: Date, until: Date): Promise<ModelAggregateRow[]>;

  /** Sum input_tokens and output_tokens for a user in the given range. */
  getTokenTotals(userId: string, since: Date, until: Date): Promise<TokenUsage>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Return the first millisecond of the current UTC month. */
function startOfMonth(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** Return the first millisecond of the next UTC month. */
function endOfMonth(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

/** Format a Date as YYYY-MM-DD in UTC. */
function formatDateUTC(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Fill missing days with cost = 0 in a date range.
 * `rows` must have `date` in YYYY-MM-DD format.
 */
export function fillMissingDays(
  rows: DailyCostRow[],
  since: Date,
  until: Date,
): DailyCostEntry[] {
  const costMap = new Map<string, number>();
  for (const row of rows) {
    costMap.set(row.date, row.cost);
  }

  const result: DailyCostEntry[] = [];
  const cursor = new Date(Date.UTC(
    since.getUTCFullYear(),
    since.getUTCMonth(),
    since.getUTCDate(),
  ));
  const end = until.getTime();

  while (cursor.getTime() < end) {
    const key = formatDateUTC(cursor);
    result.push({ date: key, cost: costMap.get(key) ?? 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return result;
}

// ---------------------------------------------------------------------------
// CostTracker
// ---------------------------------------------------------------------------

export class CostTracker {
  private readonly data: CostTrackerDataAccess;

  constructor(data: CostTrackerDataAccess) {
    this.data = data;
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Get the total AI cost for a user in the current billing month.
   *
   * Precision: 6 decimal places (matches `ai_usage.cost` numeric(10,6)).
   */
  async getMonthlyCost(userId: string): Promise<number> {
    const now = new Date();
    return this.data.getTotalCost(userId, startOfMonth(now), endOfMonth(now));
  }

  /**
   * Get per-day cost entries for the last `days` days (default 30).
   *
   * Missing days are filled with `cost: 0`.
   */
  async getDailyCosts(userId: string, days: number = 30): Promise<DailyCostEntry[]> {
    const now = new Date();
    const until = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + 1, // include today (exclusive upper bound)
    ));
    const since = new Date(until);
    since.setUTCDate(since.getUTCDate() - days);

    const rows = await this.data.getDailyCosts(userId, since, until);
    return fillMissingDays(rows, since, until);
  }

  /**
   * Get model usage distribution for the current billing month.
   *
   * Returns per-model call counts, total costs, and cost percentages.
   * The `costPercent` values sum to 100 (or 0 if no usage).
   */
  async getModelDistribution(userId: string): Promise<ModelDistributionEntry[]> {
    const now = new Date();
    const aggregates = await this.data.getModelAggregates(
      userId,
      startOfMonth(now),
      endOfMonth(now),
    );

    const grandTotal = aggregates.reduce((sum, a) => sum + a.totalCost, 0);

    return aggregates.map((a) => ({
      model: a.model,
      callCount: a.callCount,
      totalCost: a.totalCost,
      costPercent: grandTotal > 0
        ? Math.round((a.totalCost / grandTotal) * 10000) / 100
        : 0,
    }));
  }

  /**
   * Get aggregated input/output token counts for the current billing month.
   */
  async getMonthlyTokens(userId: string): Promise<TokenUsage> {
    const now = new Date();
    return this.data.getTokenTotals(userId, startOfMonth(now), endOfMonth(now));
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let instance: CostTracker | null = null;

/** Get the singleton CostTracker. */
export function getCostTracker(): CostTracker {
  if (!instance) {
    throw new Error('CostTracker not initialized — call setCostTracker() first');
  }
  return instance;
}

/** Set the singleton CostTracker instance. */
export function setCostTracker(tracker: CostTracker): void {
  instance = tracker;
}

/** Reset the singleton (for testing). */
export function _resetCostTracker(): void {
  instance = null;
}
