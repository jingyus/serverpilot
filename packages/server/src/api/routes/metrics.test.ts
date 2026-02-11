// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for metrics API routes.
 *
 * Validates query parameter validation, metric retrieval,
 * aggregation logic, and helper function correctness.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';

import type { AuthContext } from './types.js';
import type { MetricPoint } from '../../db/repositories/metrics-repository.js';

// ============================================================================
// Module Mocks — must be before imports of the module under test
// ============================================================================

const mockMetricsRepo = {
  record: vi.fn(),
  getByServerAndRange: vi.fn(),
  getLatest: vi.fn(),
  pruneOlderThan: vi.fn(),
  aggregateToHourly: vi.fn(),
  aggregateToDaily: vi.fn(),
  pruneHourlyOlderThan: vi.fn(),
  pruneDailyOlderThan: vi.fn(),
  getHourlyByServerAndRange: vi.fn(),
  getDailyByServerAndRange: vi.fn(),
};

vi.mock('../../db/repositories/metrics-repository.js', () => ({
  getMetricsRepository: () => mockMetricsRepo,
}));

vi.mock('../middleware/auth.js', () => ({
  requireAuth: vi.fn(async (c: { set: (k: string, v: string) => void }, next: () => Promise<void>) => {
    c.set('userId', 'user-1');
    await next();
  }),
}));

vi.mock('../middleware/rbac.js', () => ({
  resolveRole: vi.fn(async (c: Record<string, (k: string, v: string) => void>, next: () => Promise<void>) => {
    c.set('userRole', 'owner');
    await next();
  }),
  requirePermission: vi.fn(() => {
    return async (_c: unknown, next: () => Promise<void>) => {
      await next();
    };
  }),
}));

vi.mock('../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Import after mocks
import { metricsRoutes, getBucketSize, aggregateMetrics, calculateStats } from './metrics.js';

// ============================================================================
// Test App Setup
// ============================================================================

function createTestApp() {
  const app = new Hono<AuthContext>();
  app.route('/metrics', metricsRoutes);
  return app;
}

function makeMetric(overrides: Partial<MetricPoint> = {}): MetricPoint {
  return {
    id: 'metric-1',
    serverId: 'server-1',
    cpuUsage: 45.5,
    memoryUsage: 2048,
    memoryTotal: 8192,
    diskUsage: 50000,
    diskTotal: 100000,
    networkIn: 1024,
    networkOut: 2048,
    timestamp: '2026-02-10T12:00:00.000Z',
    ...overrides,
  };
}

// ============================================================================
// Setup
// ============================================================================

let app: ReturnType<typeof createTestApp>;

beforeEach(() => {
  app = createTestApp();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ============================================================================
// GET /metrics — Get metrics by server and range
// ============================================================================

describe('GET /metrics', () => {
  it('should return metrics for valid serverId and range', async () => {
    const metrics = [makeMetric(), makeMetric({ id: 'metric-2', cpuUsage: 60 })];
    mockMetricsRepo.getByServerAndRange.mockResolvedValue(metrics);

    const res = await app.request('/metrics?serverId=server-1&range=24h');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.metrics).toHaveLength(2);
    expect(body.metrics[0].cpuUsage).toBe(45.5);
    expect(body.metrics[1].cpuUsage).toBe(60);
    expect(mockMetricsRepo.getByServerAndRange).toHaveBeenCalledWith(
      'server-1',
      'user-1',
      '24h',
    );
  });

  it('should use default range of 24h when range is omitted', async () => {
    mockMetricsRepo.getByServerAndRange.mockResolvedValue([]);

    const res = await app.request('/metrics?serverId=server-1');

    expect(res.status).toBe(200);
    expect(mockMetricsRepo.getByServerAndRange).toHaveBeenCalledWith(
      'server-1',
      'user-1',
      '24h',
    );
  });

  it('should return 400 when serverId is missing', async () => {
    const res = await app.request('/metrics');

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Invalid query parameters');
  });

  it('should return 400 for invalid range value', async () => {
    const res = await app.request('/metrics?serverId=server-1&range=30d');

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Invalid query parameters');
  });

  it('should accept 1h range', async () => {
    mockMetricsRepo.getByServerAndRange.mockResolvedValue([]);

    const res = await app.request('/metrics?serverId=server-1&range=1h');

    expect(res.status).toBe(200);
    expect(mockMetricsRepo.getByServerAndRange).toHaveBeenCalledWith(
      'server-1',
      'user-1',
      '1h',
    );
  });

  it('should accept 7d range', async () => {
    mockMetricsRepo.getByServerAndRange.mockResolvedValue([]);

    const res = await app.request('/metrics?serverId=server-1&range=7d');

    expect(res.status).toBe(200);
    expect(mockMetricsRepo.getByServerAndRange).toHaveBeenCalledWith(
      'server-1',
      'user-1',
      '7d',
    );
  });

  it('should return empty array when no metrics exist', async () => {
    mockMetricsRepo.getByServerAndRange.mockResolvedValue([]);

    const res = await app.request('/metrics?serverId=server-1&range=24h');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.metrics).toEqual([]);
  });
});

// ============================================================================
// GET /metrics/latest — Get latest metric
// ============================================================================

describe('GET /metrics/latest', () => {
  it('should return the latest metric for a server', async () => {
    const latest = makeMetric({ cpuUsage: 72.3 });
    mockMetricsRepo.getLatest.mockResolvedValue(latest);

    const res = await app.request('/metrics/latest?serverId=server-1');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.latest).toBeTruthy();
    expect(body.latest.cpuUsage).toBe(72.3);
    expect(body.latest.serverId).toBe('server-1');
    expect(mockMetricsRepo.getLatest).toHaveBeenCalledWith('server-1', 'user-1');
  });

  it('should return null when no metrics exist', async () => {
    mockMetricsRepo.getLatest.mockResolvedValue(null);

    const res = await app.request('/metrics/latest?serverId=server-1');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.latest).toBeNull();
  });

  it('should return 400 when serverId is missing', async () => {
    const res = await app.request('/metrics/latest');

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Invalid query parameters');
  });

  it('should return 400 when serverId is empty string', async () => {
    const res = await app.request('/metrics/latest?serverId=');

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Invalid query parameters');
  });
});

// ============================================================================
// GET /metrics/aggregated — Get aggregated metrics
// ============================================================================

describe('GET /metrics/aggregated', () => {
  it('should return aggregated metrics for valid params', async () => {
    const baseTime = new Date('2026-02-10T12:00:00.000Z').getTime();
    const rawMetrics = [
      makeMetric({ timestamp: new Date(baseTime).toISOString(), cpuUsage: 40 }),
      makeMetric({ id: 'metric-2', timestamp: new Date(baseTime + 60000).toISOString(), cpuUsage: 60 }),
    ];
    mockMetricsRepo.getByServerAndRange.mockResolvedValue(rawMetrics);

    const res = await app.request('/metrics/aggregated?serverId=server-1&range=24h');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.metrics).toBeDefined();
    expect(Array.isArray(body.metrics)).toBe(true);
    expect(mockMetricsRepo.getByServerAndRange).toHaveBeenCalledWith(
      'server-1',
      'user-1',
      '24h',
    );
  });

  it('should return empty array when no metrics exist', async () => {
    mockMetricsRepo.getByServerAndRange.mockResolvedValue([]);

    const res = await app.request('/metrics/aggregated?serverId=server-1&range=1h');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.metrics).toEqual([]);
  });

  it('should return 400 when serverId is missing', async () => {
    const res = await app.request('/metrics/aggregated');

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Invalid query parameters');
  });

  it('should aggregate multiple metrics into the same bucket', async () => {
    // Use a base time aligned to a 10-minute boundary for 24h range
    const bucketBase = new Date('2026-02-10T12:00:00.000Z').getTime();
    const rawMetrics = [
      makeMetric({
        id: 'metric-1',
        timestamp: new Date(bucketBase + 0).toISOString(),
        cpuUsage: 20,
        memoryUsage: 1000,
        diskUsage: 40000,
        networkIn: 500,
        networkOut: 800,
      }),
      makeMetric({
        id: 'metric-2',
        timestamp: new Date(bucketBase + 60000).toISOString(), // +1 min, same 10-min bucket
        cpuUsage: 80,
        memoryUsage: 3000,
        diskUsage: 60000,
        networkIn: 1500,
        networkOut: 2400,
      }),
    ];
    mockMetricsRepo.getByServerAndRange.mockResolvedValue(rawMetrics);

    const res = await app.request('/metrics/aggregated?serverId=server-1&range=24h');

    expect(res.status).toBe(200);
    const body = await res.json();

    // Both metrics should be in the same bucket (within same 10 minute window)
    expect(body.metrics).toHaveLength(1);
    const bucket = body.metrics[0];

    // CPU: avg of 20, 80 = 50; min=20, max=80
    expect(bucket.cpuUsage.avg).toBe(50);
    expect(bucket.cpuUsage.min).toBe(20);
    expect(bucket.cpuUsage.max).toBe(80);

    // Memory: avg of 1000, 3000 = 2000; min=1000, max=3000
    expect(bucket.memoryUsage.avg).toBe(2000);
    expect(bucket.memoryUsage.min).toBe(1000);
    expect(bucket.memoryUsage.max).toBe(3000);

    // Network In: avg of 500, 1500 = 1000; min=500, max=1500
    expect(bucket.networkIn.avg).toBe(1000);
    expect(bucket.networkIn.min).toBe(500);
    expect(bucket.networkIn.max).toBe(1500);
  });

  it('should split metrics across multiple buckets', async () => {
    // Use 1h range which has 1-minute buckets (60000ms)
    const baseTime = new Date('2026-02-10T12:00:00.000Z').getTime();
    const rawMetrics = [
      makeMetric({
        id: 'metric-1',
        timestamp: new Date(baseTime).toISOString(), // bucket 1
        cpuUsage: 30,
      }),
      makeMetric({
        id: 'metric-2',
        timestamp: new Date(baseTime + 60000).toISOString(), // bucket 2 (1 min later)
        cpuUsage: 70,
      }),
      makeMetric({
        id: 'metric-3',
        timestamp: new Date(baseTime + 120000).toISOString(), // bucket 3 (2 min later)
        cpuUsage: 50,
      }),
    ];
    mockMetricsRepo.getByServerAndRange.mockResolvedValue(rawMetrics);

    const res = await app.request('/metrics/aggregated?serverId=server-1&range=1h');

    expect(res.status).toBe(200);
    const body = await res.json();

    // Each metric falls into a separate 1-minute bucket
    expect(body.metrics).toHaveLength(3);

    // Buckets should be sorted by timestamp
    expect(body.metrics[0].cpuUsage.avg).toBe(30);
    expect(body.metrics[1].cpuUsage.avg).toBe(70);
    expect(body.metrics[2].cpuUsage.avg).toBe(50);

    // Single-metric buckets: avg = min = max
    expect(body.metrics[0].cpuUsage.min).toBe(30);
    expect(body.metrics[0].cpuUsage.max).toBe(30);
  });

  it('should use correct bucket size for 7d range', async () => {
    // 7d range uses 1-hour buckets (3600000ms)
    const baseTime = new Date('2026-02-10T12:00:00.000Z').getTime();
    const rawMetrics = [
      makeMetric({
        id: 'metric-1',
        timestamp: new Date(baseTime).toISOString(),
        cpuUsage: 40,
      }),
      makeMetric({
        id: 'metric-2',
        timestamp: new Date(baseTime + 30 * 60 * 1000).toISOString(), // +30 min, same hour bucket
        cpuUsage: 60,
      }),
      makeMetric({
        id: 'metric-3',
        timestamp: new Date(baseTime + 60 * 60 * 1000).toISOString(), // +1 hour, next bucket
        cpuUsage: 80,
      }),
    ];
    mockMetricsRepo.getByServerAndRange.mockResolvedValue(rawMetrics);

    const res = await app.request('/metrics/aggregated?serverId=server-1&range=7d');

    expect(res.status).toBe(200);
    const body = await res.json();

    // First two metrics are in the same hour bucket, third is in the next
    expect(body.metrics).toHaveLength(2);
    expect(body.metrics[0].cpuUsage.avg).toBe(50); // avg(40, 60)
    expect(body.metrics[1].cpuUsage.avg).toBe(80); // single metric
  });
});

// ============================================================================
// getBucketSize() — Helper function
// ============================================================================

describe('getBucketSize', () => {
  it('should return 60000ms (1 minute) for 1h range', () => {
    expect(getBucketSize('1h')).toBe(60 * 1000);
  });

  it('should return 600000ms (10 minutes) for 24h range', () => {
    expect(getBucketSize('24h')).toBe(10 * 60 * 1000);
  });

  it('should return 3600000ms (1 hour) for 7d range', () => {
    expect(getBucketSize('7d')).toBe(60 * 60 * 1000);
  });
});

// ============================================================================
// calculateStats() — Helper function
// ============================================================================

describe('calculateStats', () => {
  it('should calculate avg, min, max for an array of values', () => {
    const result = calculateStats([10, 20, 30, 40, 50]);
    expect(result.avg).toBe(30);
    expect(result.min).toBe(10);
    expect(result.max).toBe(50);
  });

  it('should return zeros for empty array', () => {
    const result = calculateStats([]);
    expect(result.avg).toBe(0);
    expect(result.min).toBe(0);
    expect(result.max).toBe(0);
  });

  it('should handle a single value', () => {
    const result = calculateStats([42]);
    expect(result.avg).toBe(42);
    expect(result.min).toBe(42);
    expect(result.max).toBe(42);
  });

  it('should handle identical values', () => {
    const result = calculateStats([5, 5, 5]);
    expect(result.avg).toBe(5);
    expect(result.min).toBe(5);
    expect(result.max).toBe(5);
  });

  it('should handle decimal values', () => {
    const result = calculateStats([1.5, 2.5, 3.5]);
    expect(result.avg).toBe(2.5);
    expect(result.min).toBe(1.5);
    expect(result.max).toBe(3.5);
  });
});

// ============================================================================
// aggregateMetrics() — Helper function
// ============================================================================

describe('aggregateMetrics', () => {
  it('should return empty array for empty input', () => {
    const result = aggregateMetrics([], 60000);
    expect(result).toEqual([]);
  });

  it('should aggregate single metric into one bucket', () => {
    const metric = makeMetric({ timestamp: '2026-02-10T12:00:30.000Z' });
    const result = aggregateMetrics([metric], 60000); // 1 minute buckets

    expect(result).toHaveLength(1);
    expect(result[0].cpuUsage.avg).toBe(45.5);
    expect(result[0].cpuUsage.min).toBe(45.5);
    expect(result[0].cpuUsage.max).toBe(45.5);
  });

  it('should group metrics by bucket boundary', () => {
    const baseTime = new Date('2026-02-10T12:00:00.000Z').getTime();
    const metricsData = [
      makeMetric({
        id: 'm1',
        timestamp: new Date(baseTime + 10000).toISOString(),
        cpuUsage: 20,
        memoryUsage: 1000,
        diskUsage: 30000,
        networkIn: 500,
        networkOut: 700,
      }),
      makeMetric({
        id: 'm2',
        timestamp: new Date(baseTime + 30000).toISOString(), // Same minute bucket
        cpuUsage: 80,
        memoryUsage: 3000,
        diskUsage: 70000,
        networkIn: 1500,
        networkOut: 2100,
      }),
      makeMetric({
        id: 'm3',
        timestamp: new Date(baseTime + 60000 + 10000).toISOString(), // Next minute bucket
        cpuUsage: 50,
        memoryUsage: 2000,
        diskUsage: 50000,
        networkIn: 1000,
        networkOut: 1400,
      }),
    ];

    const result = aggregateMetrics(metricsData, 60000);

    expect(result).toHaveLength(2);

    // First bucket: avg(20, 80) = 50
    expect(result[0].cpuUsage.avg).toBe(50);
    expect(result[0].cpuUsage.min).toBe(20);
    expect(result[0].cpuUsage.max).toBe(80);
    expect(result[0].memoryUsage.avg).toBe(2000);
    expect(result[0].diskUsage.avg).toBe(50000);
    expect(result[0].networkIn.avg).toBe(1000);
    expect(result[0].networkOut.avg).toBe(1400);

    // Second bucket: single metric
    expect(result[1].cpuUsage.avg).toBe(50);
    expect(result[1].cpuUsage.min).toBe(50);
    expect(result[1].cpuUsage.max).toBe(50);
  });

  it('should sort buckets by timestamp ascending', () => {
    const baseTime = new Date('2026-02-10T12:00:00.000Z').getTime();
    // Provide metrics in reverse order
    const metricsData = [
      makeMetric({
        id: 'm2',
        timestamp: new Date(baseTime + 120000).toISOString(),
        cpuUsage: 80,
      }),
      makeMetric({
        id: 'm1',
        timestamp: new Date(baseTime).toISOString(),
        cpuUsage: 20,
      }),
    ];

    const result = aggregateMetrics(metricsData, 60000);

    expect(result).toHaveLength(2);
    // Should be sorted ascending by bucket timestamp
    const t0 = new Date(result[0].timestamp).getTime();
    const t1 = new Date(result[1].timestamp).getTime();
    expect(t0).toBeLessThan(t1);
    expect(result[0].cpuUsage.avg).toBe(20);
    expect(result[1].cpuUsage.avg).toBe(80);
  });

  it('should produce correct bucket timestamps aligned to bucket boundaries', () => {
    const metric = makeMetric({
      timestamp: '2026-02-10T12:05:30.000Z', // 30 seconds past the 5-minute mark
    });
    const tenMinBucket = 10 * 60 * 1000; // 10 minutes

    const result = aggregateMetrics([metric], tenMinBucket);

    expect(result).toHaveLength(1);
    // Bucket should be floored to nearest 10-minute boundary: 12:00:00
    const bucketTime = new Date(result[0].timestamp).getTime();
    expect(bucketTime % tenMinBucket).toBe(0);
    expect(new Date(bucketTime).toISOString()).toBe('2026-02-10T12:00:00.000Z');
  });
});
