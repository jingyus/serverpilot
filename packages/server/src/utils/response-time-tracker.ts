/**
 * Response time tracker for AI operations.
 *
 * Tracks response times for AI operations and computes percentile metrics
 * (P50, P90, P95, P99) to validate performance requirements.
 *
 * The MVP performance requirement is: AI response time < 10 seconds for 90% of requests.
 *
 * @module utils/response-time-tracker
 */

// ============================================================================
// Types
// ============================================================================

/** A recorded response time entry */
export interface ResponseTimeEntry {
  /** The AI operation type (e.g., 'planGeneration', 'errorDiagnosis', 'envAnalysis') */
  operation: string;
  /** Response time in milliseconds */
  durationMs: number;
  /** Whether the response was served from rule library / fallback (fast path) */
  fromCache: boolean;
  /** Timestamp when the operation completed */
  timestamp: number;
}

/** Aggregated response time statistics */
export interface ResponseTimeStats {
  /** Total number of recorded entries */
  count: number;
  /** Minimum response time in ms */
  min: number;
  /** Maximum response time in ms */
  max: number;
  /** Average response time in ms */
  avg: number;
  /** Median (P50) response time in ms */
  p50: number;
  /** 90th percentile response time in ms */
  p90: number;
  /** 95th percentile response time in ms */
  p95: number;
  /** 99th percentile response time in ms */
  p99: number;
  /** Whether P90 meets the < 10s SLA */
  meetsP90SLA: boolean;
}

// ============================================================================
// ResponseTimeTracker
// ============================================================================

/**
 * Tracks and analyzes AI operation response times.
 *
 * Maintains a sliding window of response time entries and provides
 * percentile-based statistics for monitoring SLA compliance.
 *
 * @example
 * ```ts
 * const tracker = new ResponseTimeTracker();
 *
 * const end = tracker.startTimer('planGeneration');
 * const result = await generatePlan();
 * end({ fromCache: false });
 *
 * const stats = tracker.getStats();
 * console.log(`P90: ${stats.p90}ms, meets SLA: ${stats.meetsP90SLA}`);
 * ```
 */
export class ResponseTimeTracker {
  private entries: ResponseTimeEntry[] = [];
  private readonly maxEntries: number;
  private readonly slaThresholdMs: number;

  /**
   * @param maxEntries - Maximum number of entries to retain (sliding window). Default: 1000
   * @param slaThresholdMs - SLA threshold in milliseconds for P90. Default: 10000 (10 seconds)
   */
  constructor(maxEntries = 1000, slaThresholdMs = 10000) {
    this.maxEntries = maxEntries;
    this.slaThresholdMs = slaThresholdMs;
  }

  /**
   * Start a timer for an operation. Returns a function to call when the operation completes.
   *
   * @param operation - The operation name (e.g., 'planGeneration')
   * @returns A function to call on completion with optional metadata
   */
  startTimer(operation: string): (opts?: { fromCache?: boolean }) => ResponseTimeEntry {
    const startTime = Date.now();

    return (opts?: { fromCache?: boolean }): ResponseTimeEntry => {
      const durationMs = Date.now() - startTime;
      const entry: ResponseTimeEntry = {
        operation,
        durationMs,
        fromCache: opts?.fromCache ?? false,
        timestamp: Date.now(),
      };
      this.record(entry);
      return entry;
    };
  }

  /**
   * Record a response time entry directly.
   *
   * @param entry - The response time entry to record
   */
  record(entry: ResponseTimeEntry): void {
    this.entries.push(entry);

    // Evict oldest entries if over limit
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(this.entries.length - this.maxEntries);
    }
  }

  /**
   * Get aggregated statistics for all recorded entries.
   *
   * @param operation - Optional filter by operation type
   * @returns Response time statistics including percentiles
   */
  getStats(operation?: string): ResponseTimeStats {
    let data = this.entries;
    if (operation) {
      data = data.filter((e) => e.operation === operation);
    }

    if (data.length === 0) {
      return {
        count: 0,
        min: 0,
        max: 0,
        avg: 0,
        p50: 0,
        p90: 0,
        p95: 0,
        p99: 0,
        meetsP90SLA: true,
      };
    }

    const durations = data.map((e) => e.durationMs).sort((a, b) => a - b);

    const sum = durations.reduce((acc, d) => acc + d, 0);
    const avg = sum / durations.length;

    return {
      count: durations.length,
      min: durations[0],
      max: durations[durations.length - 1],
      avg: Math.round(avg),
      p50: percentile(durations, 50),
      p90: percentile(durations, 90),
      p95: percentile(durations, 95),
      p99: percentile(durations, 99),
      meetsP90SLA: percentile(durations, 90) < this.slaThresholdMs,
    };
  }

  /**
   * Check if the current P90 meets the SLA threshold.
   *
   * @param operation - Optional filter by operation type
   * @returns True if P90 response time is below the SLA threshold
   */
  meetsP90SLA(operation?: string): boolean {
    return this.getStats(operation).meetsP90SLA;
  }

  /**
   * Get the total number of recorded entries.
   */
  getEntryCount(): number {
    return this.entries.length;
  }

  /**
   * Get all recorded entries (copy).
   *
   * @param operation - Optional filter by operation type
   */
  getEntries(operation?: string): ResponseTimeEntry[] {
    if (operation) {
      return this.entries.filter((e) => e.operation === operation);
    }
    return [...this.entries];
  }

  /**
   * Clear all recorded entries.
   */
  clear(): void {
    this.entries = [];
  }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Compute a percentile value from a sorted array of numbers.
 *
 * Uses the nearest-rank method.
 *
 * @param sortedValues - Sorted array of numbers (ascending)
 * @param p - Percentile to compute (0-100)
 * @returns The percentile value
 */
export function percentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return 0;
  if (sortedValues.length === 1) return sortedValues[0];

  const index = Math.ceil((p / 100) * sortedValues.length) - 1;
  return sortedValues[Math.max(0, Math.min(index, sortedValues.length - 1))];
}

// ============================================================================
// Singleton
// ============================================================================

/** Global response time tracker instance */
let globalTracker: ResponseTimeTracker | null = null;

/**
 * Get or create the global response time tracker.
 */
export function getResponseTimeTracker(): ResponseTimeTracker {
  if (!globalTracker) {
    globalTracker = new ResponseTimeTracker();
  }
  return globalTracker;
}

/**
 * Reset the global tracker (mainly for testing).
 */
export function resetResponseTimeTracker(): void {
  globalTracker = null;
}
