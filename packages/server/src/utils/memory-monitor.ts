// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Memory monitor for the AI Installer server.
 *
 * Periodically samples process memory usage and provides stats to ensure
 * the server stays within the 500MB memory budget.
 *
 * @module utils/memory-monitor
 */

// ============================================================================
// Types
// ============================================================================

/** A single memory snapshot */
export interface MemorySnapshot {
  /** Heap memory used in MB */
  heapUsedMB: number;
  /** Heap total allocated in MB */
  heapTotalMB: number;
  /** Resident set size in MB */
  rssMB: number;
  /** External memory (C++ objects bound to JS) in MB */
  externalMB: number;
  /** Timestamp of the snapshot */
  timestamp: number;
}

/** Aggregated memory statistics */
export interface MemoryStats {
  /** Current memory snapshot */
  current: MemorySnapshot;
  /** Peak RSS observed since monitoring started */
  peakRssMB: number;
  /** Peak heap used observed since monitoring started */
  peakHeapUsedMB: number;
  /** Whether current RSS is within the threshold */
  withinThreshold: boolean;
  /** The configured threshold in MB */
  thresholdMB: number;
  /** Number of snapshots recorded */
  snapshotCount: number;
  /** Average RSS across all snapshots */
  avgRssMB: number;
}

/** Configuration for the memory monitor */
export interface MemoryMonitorOptions {
  /** Memory threshold in MB (default: 500) */
  thresholdMB?: number;
  /** Sampling interval in milliseconds (default: 30000) */
  intervalMs?: number;
  /** Maximum number of snapshots to retain (default: 100) */
  maxSnapshots?: number;
}

// ============================================================================
// MemoryMonitor
// ============================================================================

/**
 * Monitors process memory usage and enforces a threshold.
 *
 * @example
 * ```ts
 * const monitor = new MemoryMonitor({ thresholdMB: 500 });
 * monitor.start();
 *
 * const stats = monitor.getStats();
 * console.log(`RSS: ${stats.current.rssMB}MB, within limit: ${stats.withinThreshold}`);
 *
 * monitor.stop();
 * ```
 */
export class MemoryMonitor {
  private snapshots: MemorySnapshot[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private peakRssMB = 0;
  private peakHeapUsedMB = 0;

  private readonly thresholdMB: number;
  private readonly intervalMs: number;
  private readonly maxSnapshots: number;

  constructor(options: MemoryMonitorOptions = {}) {
    this.thresholdMB = options.thresholdMB ?? 500;
    this.intervalMs = options.intervalMs ?? 30000;
    this.maxSnapshots = options.maxSnapshots ?? 100;
  }

  /**
   * Start periodic memory sampling.
   */
  start(): void {
    if (this.timer) return;

    // Take an initial snapshot
    this.takeSnapshot();

    this.timer = setInterval(() => {
      this.takeSnapshot();
    }, this.intervalMs);

    // Don't prevent process exit
    if (this.timer.unref) {
      this.timer.unref();
    }
  }

  /**
   * Stop periodic memory sampling.
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Whether the monitor is currently running.
   */
  isRunning(): boolean {
    return this.timer !== null;
  }

  /**
   * Take a memory snapshot immediately.
   *
   * @returns The captured snapshot
   */
  takeSnapshot(): MemorySnapshot {
    const mem = process.memoryUsage();
    const snapshot: MemorySnapshot = {
      heapUsedMB: toMB(mem.heapUsed),
      heapTotalMB: toMB(mem.heapTotal),
      rssMB: toMB(mem.rss),
      externalMB: toMB(mem.external),
      timestamp: Date.now(),
    };

    if (snapshot.rssMB > this.peakRssMB) {
      this.peakRssMB = snapshot.rssMB;
    }
    if (snapshot.heapUsedMB > this.peakHeapUsedMB) {
      this.peakHeapUsedMB = snapshot.heapUsedMB;
    }

    this.snapshots.push(snapshot);

    // Evict oldest snapshots if over limit
    if (this.snapshots.length > this.maxSnapshots) {
      this.snapshots = this.snapshots.slice(this.snapshots.length - this.maxSnapshots);
    }

    return snapshot;
  }

  /**
   * Get current memory statistics.
   */
  getStats(): MemoryStats {
    const current = this.snapshots.length > 0
      ? this.snapshots[this.snapshots.length - 1]
      : this.takeSnapshot();

    const avgRssMB = this.snapshots.length > 0
      ? this.snapshots.reduce((sum, s) => sum + s.rssMB, 0) / this.snapshots.length
      : current.rssMB;

    return {
      current,
      peakRssMB: this.peakRssMB,
      peakHeapUsedMB: this.peakHeapUsedMB,
      withinThreshold: current.rssMB < this.thresholdMB,
      thresholdMB: this.thresholdMB,
      snapshotCount: this.snapshots.length,
      avgRssMB: Math.round(avgRssMB * 100) / 100,
    };
  }

  /**
   * Check if current memory usage is within the configured threshold.
   */
  isWithinThreshold(): boolean {
    const snapshot = this.takeSnapshot();
    return snapshot.rssMB < this.thresholdMB;
  }

  /**
   * Get all recorded snapshots (copy).
   */
  getSnapshots(): MemorySnapshot[] {
    return [...this.snapshots];
  }

  /**
   * Clear all recorded snapshots and reset peaks.
   */
  reset(): void {
    this.snapshots = [];
    this.peakRssMB = 0;
    this.peakHeapUsedMB = 0;
  }

  /**
   * Get the configured threshold in MB.
   */
  getThresholdMB(): number {
    return this.thresholdMB;
  }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Convert bytes to megabytes, rounded to 2 decimal places.
 */
function toMB(bytes: number): number {
  return Math.round((bytes / (1024 * 1024)) * 100) / 100;
}

// ============================================================================
// Singleton
// ============================================================================

/** Global memory monitor instance */
let globalMonitor: MemoryMonitor | null = null;

/**
 * Get or create the global memory monitor.
 *
 * @param options - Options for the monitor (only used on first creation)
 */
export function getMemoryMonitor(options?: MemoryMonitorOptions): MemoryMonitor {
  if (!globalMonitor) {
    globalMonitor = new MemoryMonitor(options);
  }
  return globalMonitor;
}

/**
 * Reset the global memory monitor (mainly for testing).
 */
export function resetMemoryMonitor(): void {
  if (globalMonitor) {
    globalMonitor.stop();
  }
  globalMonitor = null;
}
