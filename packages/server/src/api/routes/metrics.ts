/**
 * Metrics API routes for ServerPilot.
 *
 * Provides endpoints for:
 * - Querying system metrics by time range
 * - Getting latest metrics for a server
 * - Aggregating metrics data (uses pre-computed hourly/daily aggregates)
 *
 * @module api/routes/metrics
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { getMetricsRepository } from '../../db/repositories/metrics-repository.js';
import type { MetricsRange } from '../../db/repositories/metrics-repository.js';
import { requireAuth } from '../middleware/auth.js';
import type { AuthContext } from '../routes/types.js';

// ============================================================================
// Create Metrics Routes
// ============================================================================

const app = new Hono<AuthContext>();

// Apply auth middleware to all routes
app.use('*', requireAuth);

// ============================================================================
// Validation Schemas
// ============================================================================

const GetMetricsQuerySchema = z.object({
  serverId: z.string().min(1),
  range: z.enum(['1h', '24h', '7d']).default('24h'),
});

const GetLatestQuerySchema = z.object({
  serverId: z.string().min(1),
});

// ============================================================================
// Routes
// ============================================================================

/**
 * GET /metrics
 *
 * Get metrics for a server within a specified time range.
 *
 * Query parameters:
 * - serverId: Server ID (required)
 * - range: Time range (1h, 24h, 7d) (default: 24h)
 *
 * Returns array of metric points with timestamps.
 */
app.get('/', async (c) => {
  const userId = c.get('userId');
  const query = c.req.query();

  // Validate query parameters
  const result = GetMetricsQuerySchema.safeParse(query);
  if (!result.success) {
    return c.json({ error: 'Invalid query parameters' }, 400);
  }

  const { serverId, range } = result.data;

  const metricsRepo = getMetricsRepository();
  const metrics = await metricsRepo.getByServerAndRange(
    serverId,
    userId,
    range as MetricsRange
  );

  return c.json({ metrics });
});

/**
 * GET /metrics/latest
 *
 * Get the latest metric point for a server.
 *
 * Query parameters:
 * - serverId: Server ID (required)
 *
 * Returns the most recent metric point or null.
 */
app.get('/latest', async (c) => {
  const userId = c.get('userId');
  const query = c.req.query();

  // Validate query parameters
  const result = GetLatestQuerySchema.safeParse(query);
  if (!result.success) {
    return c.json({ error: 'Invalid query parameters' }, 400);
  }

  const { serverId } = result.data;

  const metricsRepo = getMetricsRepository();
  const latest = await metricsRepo.getLatest(serverId, userId);

  return c.json({ latest });
});

/**
 * GET /metrics/aggregated
 *
 * Get aggregated metrics for a server within a specified time range.
 *
 * For recent data (within raw retention window), aggregates on-the-fly.
 * For older data, returns pre-computed hourly/daily aggregates.
 *
 * Query parameters:
 * - serverId: Server ID (required)
 * - range: Time range (1h, 24h, 7d) (default: 24h)
 *
 * Returns aggregated metric points (avg, min, max per bucket).
 */
app.get('/aggregated', async (c) => {
  const userId = c.get('userId');
  const query = c.req.query();

  // Validate query parameters
  const result = GetMetricsQuerySchema.safeParse(query);
  if (!result.success) {
    return c.json({ error: 'Invalid query parameters' }, 400);
  }

  const { serverId, range } = result.data;

  const metricsRepo = getMetricsRepository();
  const rawMetrics = await metricsRepo.getByServerAndRange(
    serverId,
    userId,
    range as MetricsRange
  );

  // Determine bucket size based on range
  const bucketSize = getBucketSize(range as MetricsRange);

  // Aggregate metrics into buckets
  const aggregated = aggregateMetrics(rawMetrics, bucketSize);

  return c.json({ metrics: aggregated });
});

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get bucket size in milliseconds based on time range.
 *
 * - 1h: 1 minute buckets (60 points)
 * - 24h: 10 minute buckets (144 points)
 * - 7d: 1 hour buckets (168 points)
 */
function getBucketSize(range: MetricsRange): number {
  switch (range) {
    case '1h':
      return 60 * 1000; // 1 minute
    case '24h':
      return 10 * 60 * 1000; // 10 minutes
    case '7d':
      return 60 * 60 * 1000; // 1 hour
  }
}

/**
 * Aggregate metrics into time buckets.
 *
 * Calculates average, min, and max for each metric per bucket.
 */
function aggregateMetrics(
  metrics: Array<{
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
  }>,
  bucketSizeMs: number
): Array<{
  timestamp: string;
  cpuUsage: { avg: number; min: number; max: number };
  memoryUsage: { avg: number; min: number; max: number };
  diskUsage: { avg: number; min: number; max: number };
  networkIn: { avg: number; min: number; max: number };
  networkOut: { avg: number; min: number; max: number };
}> {
  if (metrics.length === 0) {
    return [];
  }

  // Group metrics by bucket
  const buckets = new Map<number, typeof metrics>();

  for (const metric of metrics) {
    const timestamp = new Date(metric.timestamp).getTime();
    const bucketKey = Math.floor(timestamp / bucketSizeMs) * bucketSizeMs;

    if (!buckets.has(bucketKey)) {
      buckets.set(bucketKey, []);
    }
    buckets.get(bucketKey)!.push(metric);
  }

  // Calculate aggregates for each bucket
  const result = Array.from(buckets.entries())
    .sort(([a], [b]) => a - b)
    .map(([bucketKey, bucketMetrics]) => {
      return {
        timestamp: new Date(bucketKey).toISOString(),
        cpuUsage: calculateStats(bucketMetrics.map((m) => m.cpuUsage)),
        memoryUsage: calculateStats(bucketMetrics.map((m) => m.memoryUsage)),
        diskUsage: calculateStats(bucketMetrics.map((m) => m.diskUsage)),
        networkIn: calculateStats(bucketMetrics.map((m) => m.networkIn)),
        networkOut: calculateStats(bucketMetrics.map((m) => m.networkOut)),
      };
    });

  return result;
}

/**
 * Calculate average, min, and max for an array of numbers.
 */
function calculateStats(values: number[]): { avg: number; min: number; max: number } {
  if (values.length === 0) {
    return { avg: 0, min: 0, max: 0 };
  }

  const sum = values.reduce((a, b) => a + b, 0);
  const avg = sum / values.length;
  const min = Math.min(...values);
  const max = Math.max(...values);

  return { avg, min, max };
}

// ============================================================================
// Export
// ============================================================================

export const metricsRoutes = app;
