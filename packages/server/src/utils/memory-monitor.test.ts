// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for the MemoryMonitor module.
 *
 * Validates memory tracking, threshold enforcement, snapshot management,
 * and the 500MB server memory budget requirement.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  MemoryMonitor,
  getMemoryMonitor,
  resetMemoryMonitor,
} from './memory-monitor.js';

afterEach(() => {
  resetMemoryMonitor();
});

// ============================================================================
// MemoryMonitor class
// ============================================================================

describe('MemoryMonitor', () => {
  it('should create with default options', () => {
    const monitor = new MemoryMonitor();
    expect(monitor.getThresholdMB()).toBe(500);
    expect(monitor.isRunning()).toBe(false);
  });

  it('should create with custom options', () => {
    const monitor = new MemoryMonitor({
      thresholdMB: 256,
      intervalMs: 5000,
      maxSnapshots: 50,
    });
    expect(monitor.getThresholdMB()).toBe(256);
  });

  it('should take a memory snapshot', () => {
    const monitor = new MemoryMonitor();
    const snapshot = monitor.takeSnapshot();

    expect(snapshot.heapUsedMB).toBeGreaterThan(0);
    expect(snapshot.heapTotalMB).toBeGreaterThan(0);
    expect(snapshot.rssMB).toBeGreaterThan(0);
    expect(snapshot.externalMB).toBeGreaterThanOrEqual(0);
    expect(snapshot.timestamp).toBeGreaterThan(0);
  });

  it('should record multiple snapshots', () => {
    const monitor = new MemoryMonitor();
    monitor.takeSnapshot();
    monitor.takeSnapshot();
    monitor.takeSnapshot();

    const snapshots = monitor.getSnapshots();
    expect(snapshots.length).toBe(3);
  });

  it('should evict old snapshots when maxSnapshots is exceeded', () => {
    const monitor = new MemoryMonitor({ maxSnapshots: 3 });

    for (let i = 0; i < 5; i++) {
      monitor.takeSnapshot();
    }

    const snapshots = monitor.getSnapshots();
    expect(snapshots.length).toBe(3);
  });

  it('should track peak RSS', () => {
    const monitor = new MemoryMonitor();
    monitor.takeSnapshot();

    const stats = monitor.getStats();
    expect(stats.peakRssMB).toBeGreaterThan(0);
    expect(stats.peakRssMB).toBeGreaterThanOrEqual(stats.current.rssMB);
  });

  it('should track peak heap used', () => {
    const monitor = new MemoryMonitor();
    monitor.takeSnapshot();

    const stats = monitor.getStats();
    expect(stats.peakHeapUsedMB).toBeGreaterThan(0);
    expect(stats.peakHeapUsedMB).toBeGreaterThanOrEqual(stats.current.heapUsedMB);
  });

  it('should report memory within threshold for normal usage', () => {
    const monitor = new MemoryMonitor({ thresholdMB: 500 });
    expect(monitor.isWithinThreshold()).toBe(true);
  });

  it('should detect when memory exceeds threshold', () => {
    // Set a very low threshold that will always be exceeded
    const monitor = new MemoryMonitor({ thresholdMB: 1 });
    expect(monitor.isWithinThreshold()).toBe(false);
  });

  it('should return correct stats', () => {
    const monitor = new MemoryMonitor({ thresholdMB: 500 });
    monitor.takeSnapshot();
    monitor.takeSnapshot();

    const stats = monitor.getStats();
    expect(stats.snapshotCount).toBe(2);
    expect(stats.thresholdMB).toBe(500);
    expect(stats.withinThreshold).toBe(true);
    expect(stats.avgRssMB).toBeGreaterThan(0);
    expect(stats.current.rssMB).toBeGreaterThan(0);
  });

  it('should take initial snapshot when getStats is called with no snapshots', () => {
    const monitor = new MemoryMonitor();
    const stats = monitor.getStats();

    expect(stats.snapshotCount).toBe(1);
    expect(stats.current.rssMB).toBeGreaterThan(0);
  });

  it('should compute average RSS across snapshots', () => {
    const monitor = new MemoryMonitor();
    monitor.takeSnapshot();
    monitor.takeSnapshot();
    monitor.takeSnapshot();

    const stats = monitor.getStats();
    // Average should be between min and max possible
    expect(stats.avgRssMB).toBeGreaterThan(0);
  });

  it('should reset all state', () => {
    const monitor = new MemoryMonitor();
    monitor.takeSnapshot();
    monitor.takeSnapshot();

    monitor.reset();

    const snapshots = monitor.getSnapshots();
    expect(snapshots.length).toBe(0);

    const stats = monitor.getStats();
    expect(stats.peakRssMB).toBeGreaterThan(0); // getStats takes a new snapshot
    expect(stats.snapshotCount).toBe(1);
  });

  it('should return a copy of snapshots', () => {
    const monitor = new MemoryMonitor();
    monitor.takeSnapshot();

    const snapshots1 = monitor.getSnapshots();
    const snapshots2 = monitor.getSnapshots();

    expect(snapshots1).not.toBe(snapshots2);
    expect(snapshots1).toEqual(snapshots2);
  });

  // --------------------------------------------------------------------------
  // Start / Stop
  // --------------------------------------------------------------------------

  it('should start and stop periodic sampling', async () => {
    const monitor = new MemoryMonitor({ intervalMs: 50 });

    expect(monitor.isRunning()).toBe(false);

    monitor.start();
    expect(monitor.isRunning()).toBe(true);
    // Initial snapshot should be taken
    expect(monitor.getSnapshots().length).toBeGreaterThanOrEqual(1);

    // Wait for at least one interval
    await new Promise((r) => setTimeout(r, 120));

    expect(monitor.getSnapshots().length).toBeGreaterThanOrEqual(2);

    monitor.stop();
    expect(monitor.isRunning()).toBe(false);
  });

  it('should not start twice', () => {
    const monitor = new MemoryMonitor({ intervalMs: 60000 });
    monitor.start();
    monitor.start(); // Should be a no-op

    expect(monitor.isRunning()).toBe(true);
    monitor.stop();
  });

  it('should handle stop when not started', () => {
    const monitor = new MemoryMonitor();
    monitor.stop(); // Should not throw
    expect(monitor.isRunning()).toBe(false);
  });

  // --------------------------------------------------------------------------
  // 500MB threshold validation
  // --------------------------------------------------------------------------

  it('should enforce 500MB threshold by default', () => {
    const monitor = new MemoryMonitor();
    const stats = monitor.getStats();

    expect(stats.thresholdMB).toBe(500);
    expect(stats.withinThreshold).toBe(true);
    expect(stats.current.rssMB).toBeLessThan(500);
  });

  it('should report current RSS well below 500MB for a test process', () => {
    const monitor = new MemoryMonitor();
    const snapshot = monitor.takeSnapshot();

    // A vitest process should be well under 500MB
    expect(snapshot.rssMB).toBeLessThan(500);
    expect(snapshot.heapUsedMB).toBeLessThan(500);
  });

  it('should validate server memory budget after allocations', () => {
    const monitor = new MemoryMonitor({ thresholdMB: 500 });

    // Allocate some memory to simulate server activity
    const buffers: Buffer[] = [];
    for (let i = 0; i < 10; i++) {
      buffers.push(Buffer.alloc(1024 * 1024)); // 1MB each = 10MB total
    }

    const stats = monitor.getStats();
    expect(stats.withinThreshold).toBe(true);
    expect(stats.current.rssMB).toBeLessThan(500);

    // Cleanup
    buffers.length = 0;
  });
});

// ============================================================================
// Singleton
// ============================================================================

describe('getMemoryMonitor / resetMemoryMonitor', () => {
  it('should return the same instance on multiple calls', () => {
    const m1 = getMemoryMonitor();
    const m2 = getMemoryMonitor();
    expect(m1).toBe(m2);
  });

  it('should create new instance after reset', () => {
    const m1 = getMemoryMonitor();
    resetMemoryMonitor();
    const m2 = getMemoryMonitor();
    expect(m1).not.toBe(m2);
  });

  it('should accept options on first creation', () => {
    const monitor = getMemoryMonitor({ thresholdMB: 256 });
    expect(monitor.getThresholdMB()).toBe(256);
  });

  it('should stop running monitor on reset', () => {
    const monitor = getMemoryMonitor({ intervalMs: 60000 });
    monitor.start();
    expect(monitor.isRunning()).toBe(true);

    resetMemoryMonitor();
    expect(monitor.isRunning()).toBe(false);
  });
});
