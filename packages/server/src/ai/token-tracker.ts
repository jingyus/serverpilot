// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Token usage statistics tracker for Anthropic API calls.
 *
 * Tracks input/output token consumption per request, per session, and
 * globally. Provides cost estimation based on model pricing and summary
 * statistics for monitoring and reporting.
 *
 * @module ai/token-tracker
 */

// ============================================================================
// Types
// ============================================================================

/** Token counts from a single API response */
export interface TokenUsage {
  /** Number of input tokens (prompt) */
  inputTokens: number;
  /** Number of output tokens (completion) */
  outputTokens: number;
  /** Number of tokens used for cache creation (if applicable, defaults to 0) */
  cacheCreationInputTokens?: number;
  /** Number of tokens read from cache (if applicable, defaults to 0) */
  cacheReadInputTokens?: number;
}

/** A recorded token usage entry with metadata */
export interface TokenUsageEntry {
  /** Unique request identifier */
  requestId: string;
  /** Session this request belongs to */
  sessionId: string;
  /** Model used for the request */
  model: string;
  /** Token counts */
  usage: TokenUsage;
  /** Estimated cost in USD */
  estimatedCostUsd: number;
  /** Timestamp of the request */
  timestamp: number;
}

/** Aggregated statistics for a set of token usage entries */
export interface TokenUsageStats {
  /** Total number of API requests */
  totalRequests: number;
  /** Total input tokens across all requests */
  totalInputTokens: number;
  /** Total output tokens across all requests */
  totalOutputTokens: number;
  /** Total cache creation tokens */
  totalCacheCreationTokens: number;
  /** Total cache read tokens */
  totalCacheReadTokens: number;
  /** Total estimated cost in USD */
  totalCostUsd: number;
  /** Average input tokens per request */
  avgInputTokens: number;
  /** Average output tokens per request */
  avgOutputTokens: number;
}

/** Pricing per million tokens for a model */
export interface ModelPricing {
  /** Cost per million input tokens in USD */
  inputPerMillion: number;
  /** Cost per million output tokens in USD */
  outputPerMillion: number;
  /** Cost per million cache creation input tokens in USD */
  cacheCreationPerMillion: number;
  /** Cost per million cache read input tokens in USD */
  cacheReadPerMillion: number;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Pricing for supported Anthropic models (per million tokens, in USD).
 * Based on Anthropic's published pricing.
 */
export const MODEL_PRICING: Record<string, ModelPricing> = {
  'claude-sonnet-4-20250514': {
    inputPerMillion: 3,
    outputPerMillion: 15,
    cacheCreationPerMillion: 3.75,
    cacheReadPerMillion: 0.3,
  },
  'claude-haiku-3-5-20241022': {
    inputPerMillion: 0.8,
    outputPerMillion: 4,
    cacheCreationPerMillion: 1,
    cacheReadPerMillion: 0.08,
  },
  'claude-opus-4-20250514': {
    inputPerMillion: 15,
    outputPerMillion: 75,
    cacheCreationPerMillion: 18.75,
    cacheReadPerMillion: 1.5,
  },
};

/** Default pricing used when a model is not found in MODEL_PRICING */
const DEFAULT_PRICING: ModelPricing = {
  inputPerMillion: 3,
  outputPerMillion: 15,
  cacheCreationPerMillion: 3.75,
  cacheReadPerMillion: 0.3,
};

// ============================================================================
// TokenTracker
// ============================================================================

/** Default maximum number of entries before eviction kicks in */
export const DEFAULT_MAX_ENTRIES = 10_000;

/**
 * Tracks and aggregates token usage from Anthropic API calls.
 *
 * Maintains a bounded in-memory history of token usage entries that can be
 * queried per session, per model, or globally. When the entry count exceeds
 * `maxEntries`, the oldest entries are automatically evicted.
 *
 * @example
 * ```ts
 * const tracker = new TokenTracker({ maxEntries: 5000 });
 *
 * tracker.record({
 *   requestId: 'req-1',
 *   sessionId: 'session-1',
 *   model: 'claude-sonnet-4-20250514',
 *   usage: { inputTokens: 500, outputTokens: 200, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
 * });
 *
 * const stats = tracker.getStats();
 * console.log(`Total cost: $${stats.totalCostUsd.toFixed(4)}`);
 * ```
 */
export class TokenTracker {
  private readonly entries: TokenUsageEntry[] = [];
  readonly maxEntries: number;

  constructor(options?: { maxEntries?: number }) {
    this.maxEntries = options?.maxEntries ?? DEFAULT_MAX_ENTRIES;
  }

  /**
   * Record a token usage entry from an API response.
   *
   * Calculates estimated cost based on model pricing and stores
   * the entry for aggregation. Evicts oldest entries when the
   * capacity limit is exceeded.
   *
   * @param params - The usage data to record
   * @returns The created entry with calculated cost
   */
  record(params: {
    requestId: string;
    sessionId: string;
    model: string;
    usage: TokenUsage;
    timestamp?: number;
  }): TokenUsageEntry {
    const estimatedCostUsd = estimateCost(params.model, params.usage);

    const entry: TokenUsageEntry = {
      requestId: params.requestId,
      sessionId: params.sessionId,
      model: params.model,
      usage: params.usage,
      estimatedCostUsd,
      timestamp: params.timestamp ?? Date.now(),
    };

    this.entries.push(entry);
    this.evictIfNeeded();
    return entry;
  }

  /**
   * Get all recorded entries.
   */
  getEntries(): readonly TokenUsageEntry[] {
    return this.entries;
  }

  /**
   * Get entries filtered by session ID.
   */
  getEntriesBySession(sessionId: string): TokenUsageEntry[] {
    return this.entries.filter((e) => e.sessionId === sessionId);
  }

  /**
   * Get entries filtered by model.
   */
  getEntriesByModel(model: string): TokenUsageEntry[] {
    return this.entries.filter((e) => e.model === model);
  }

  /**
   * Get aggregated statistics across all recorded entries.
   */
  getStats(): TokenUsageStats {
    return aggregateStats(this.entries);
  }

  /**
   * Get aggregated statistics for a specific session.
   */
  getSessionStats(sessionId: string): TokenUsageStats {
    return aggregateStats(this.getEntriesBySession(sessionId));
  }

  /**
   * Get aggregated statistics grouped by model.
   */
  getStatsByModel(): Record<string, TokenUsageStats> {
    const models = new Set(this.entries.map((e) => e.model));
    const result: Record<string, TokenUsageStats> = {};

    for (const model of models) {
      result[model] = aggregateStats(this.getEntriesByModel(model));
    }

    return result;
  }

  /**
   * Remove entries older than the given age in milliseconds.
   *
   * @param olderThanMs - Remove entries whose timestamp is older than `Date.now() - olderThanMs`
   * @returns Number of entries removed
   */
  prune(olderThanMs: number): number {
    const cutoff = Date.now() - olderThanMs;
    const before = this.entries.length;
    let writeIdx = 0;

    for (let i = 0; i < this.entries.length; i++) {
      if (this.entries[i].timestamp >= cutoff) {
        this.entries[writeIdx++] = this.entries[i];
      }
    }

    this.entries.length = writeIdx;
    return before - writeIdx;
  }

  /**
   * Get the total number of recorded entries.
   */
  get size(): number {
    return this.entries.length;
  }

  /**
   * Clear all recorded entries.
   */
  reset(): void {
    this.entries.length = 0;
  }

  /** Evict oldest entries when capacity is exceeded */
  private evictIfNeeded(): void {
    if (this.entries.length > this.maxEntries) {
      const overflow = this.entries.length - this.maxEntries;
      this.entries.splice(0, overflow);
    }
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Estimate the cost of a single API call based on token usage and model pricing.
 *
 * @param model - The model identifier
 * @param usage - Token counts from the response
 * @returns Estimated cost in USD
 */
export function estimateCost(model: string, usage: TokenUsage): number {
  const pricing = getPricing(model);

  const inputCost = (usage.inputTokens / 1_000_000) * pricing.inputPerMillion;
  const outputCost = (usage.outputTokens / 1_000_000) * pricing.outputPerMillion;
  const cacheCreationCost =
    ((usage.cacheCreationInputTokens ?? 0) / 1_000_000) * pricing.cacheCreationPerMillion;
  const cacheReadCost =
    ((usage.cacheReadInputTokens ?? 0) / 1_000_000) * pricing.cacheReadPerMillion;

  return inputCost + outputCost + cacheCreationCost + cacheReadCost;
}

/**
 * Get pricing for a model. Falls back to default pricing for unknown models.
 *
 * @param model - The model identifier
 * @returns Pricing per million tokens
 */
export function getPricing(model: string): ModelPricing {
  return MODEL_PRICING[model] ?? DEFAULT_PRICING;
}

/**
 * Convert an Anthropic API response's usage field to our TokenUsage format.
 *
 * The Anthropic SDK returns usage with snake_case keys and nullable cache
 * fields. This normalizes them to our camelCase format with zero defaults.
 *
 * @param apiUsage - The usage object from an Anthropic Message response
 * @returns Normalized token usage
 */
export function fromApiUsage(apiUsage: {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}): TokenUsage {
  return {
    inputTokens: apiUsage.input_tokens,
    outputTokens: apiUsage.output_tokens,
    cacheCreationInputTokens: apiUsage.cache_creation_input_tokens ?? 0,
    cacheReadInputTokens: apiUsage.cache_read_input_tokens ?? 0,
  };
}

/**
 * Aggregate statistics from a list of token usage entries.
 *
 * @param entries - The entries to aggregate
 * @returns Aggregated statistics
 */
export function aggregateStats(entries: readonly TokenUsageEntry[]): TokenUsageStats {
  if (entries.length === 0) {
    return {
      totalRequests: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCacheCreationTokens: 0,
      totalCacheReadTokens: 0,
      totalCostUsd: 0,
      avgInputTokens: 0,
      avgOutputTokens: 0,
    };
  }

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCacheCreationTokens = 0;
  let totalCacheReadTokens = 0;
  let totalCostUsd = 0;

  for (const entry of entries) {
    totalInputTokens += entry.usage.inputTokens;
    totalOutputTokens += entry.usage.outputTokens;
    totalCacheCreationTokens += entry.usage.cacheCreationInputTokens ?? 0;
    totalCacheReadTokens += entry.usage.cacheReadInputTokens ?? 0;
    totalCostUsd += entry.estimatedCostUsd;
  }

  return {
    totalRequests: entries.length,
    totalInputTokens,
    totalOutputTokens,
    totalCacheCreationTokens,
    totalCacheReadTokens,
    totalCostUsd,
    avgInputTokens: totalInputTokens / entries.length,
    avgOutputTokens: totalOutputTokens / entries.length,
  };
}
