/**
 * Integration test for metrics reporting flow.
 *
 * Tests the end-to-end flow:
 * 1. Agent collects metrics
 * 2. Agent sends metrics.report via WebSocket
 * 3. Server receives and stores metrics
 * 4. HTTP API returns metrics data
 * 5. Cleanup scheduler prunes old data
 * 6. Tiered aggregation (raw → hourly → daily)
 *
 * @module tests/metrics-flow.test
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { initDatabase, closeDatabase, createTables, getRawDatabase } from '../packages/server/src/db/connection.js';
import { getMetricsRepository, _resetMetricsRepository } from '../packages/server/src/db/repositories/metrics-repository.js';
import { createMessage, MessageType } from '@aiinstaller/shared';
import type { MetricsReportMessage } from '@aiinstaller/shared';
import { handleMetricsReport } from '../packages/server/src/api/handlers.js';
import type { InstallServer } from '../packages/server/src/api/server.js';

// ============================================================================
// Test Setup
// ============================================================================

const TEST_DB_PATH = ':memory:';

beforeAll(() => {
  initDatabase(TEST_DB_PATH);
  createTables();
});

afterAll(() => {
  _resetMetricsRepository();
  closeDatabase();
});

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create test server and user in database.
 */
function setupTestServerAndUser() {
  const db = getRawDatabase();
  const userId = randomUUID();
  const serverId = randomUUID();

  // Insert test user
  db.prepare(
    'INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
  ).run(userId, `test-${randomUUID()}@example.com`, 'hash', Date.now(), Date.now());

  // Insert test server
  db.prepare(
    'INSERT INTO servers (id, name, user_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(serverId, 'Test Server', userId, 'online', Date.now(), Date.now());

  return { userId, serverId };
}

/**
 * Create a mock InstallServer for testing handlers.
 */
function createMockServer(): InstallServer {
  return {
    getClientSessionId: vi.fn(() => null),
    getSession: vi.fn(() => null),
    isClientAuthenticated: vi.fn(() => true),
  } as unknown as InstallServer;
}

/**
 * Insert a raw metric directly into the database at a specific timestamp.
 */
function insertRawMetric(serverId: string, timestamp: Date, cpuUsage = 50) {
  const db = getRawDatabase();
  const id = randomUUID();
  // Drizzle stores timestamps as seconds (mode: 'timestamp'), not milliseconds
  const timestampSeconds = Math.floor(timestamp.getTime() / 1000);
  db.prepare(
    'INSERT INTO metrics (id, server_id, cpu_usage, memory_usage, memory_total, disk_usage, disk_total, network_in, network_out, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    id,
    serverId,
    cpuUsage * 100, // stored as 0-10000
    8 * 1024 * 1024 * 1024,
    16 * 1024 * 1024 * 1024,
    100 * 1024 * 1024 * 1024,
    500 * 1024 * 1024 * 1024,
    1024 * 1024,
    512 * 1024,
    timestampSeconds
  );
  return id;
}

// ============================================================================
// Tests — Basic metrics flow
// ============================================================================

describe('Metrics Reporting Flow', () => {
  it('should store metrics from WebSocket message', async () => {
    const { userId, serverId } = setupTestServerAndUser();
    const metricsRepo = getMetricsRepository();
    const mockServer = createMockServer();

    // Create metrics report message
    const message: MetricsReportMessage = createMessage(MessageType.METRICS_REPORT, {
      serverId,
      cpuUsage: 45.5,
      memoryUsage: 8 * 1024 * 1024 * 1024, // 8 GB
      memoryTotal: 16 * 1024 * 1024 * 1024, // 16 GB
      diskUsage: 100 * 1024 * 1024 * 1024, // 100 GB
      diskTotal: 500 * 1024 * 1024 * 1024, // 500 GB
      networkIn: 1024 * 1024, // 1 MB/s
      networkOut: 512 * 1024, // 512 KB/s
    });

    // Handle metrics report
    const result = await handleMetricsReport(mockServer, 'test-client', message);
    expect(result.success).toBe(true);

    // Verify metrics were stored
    const latest = await metricsRepo.getLatest(serverId, userId);
    expect(latest).not.toBeNull();
    expect(latest?.cpuUsage).toBeCloseTo(45.5, 1);
    expect(latest?.memoryUsage).toBe(8 * 1024 * 1024 * 1024);
    expect(latest?.networkIn).toBe(1024 * 1024);
  });

  it('should query metrics by time range', async () => {
    const { userId, serverId } = setupTestServerAndUser();
    const metricsRepo = getMetricsRepository();

    // Insert multiple metrics at different times
    const now = new Date();
    const timestamps = [
      new Date(now.getTime() - 60 * 60 * 1000), // 1 hour ago
      new Date(now.getTime() - 30 * 60 * 1000), // 30 minutes ago
      new Date(now.getTime() - 5 * 60 * 1000),  // 5 minutes ago
    ];

    for (const timestamp of timestamps) {
      await metricsRepo.record({
        serverId,
        cpuUsage: 50,
        memoryUsage: 8 * 1024 * 1024 * 1024,
        memoryTotal: 16 * 1024 * 1024 * 1024,
        diskUsage: 100 * 1024 * 1024 * 1024,
        diskTotal: 500 * 1024 * 1024 * 1024,
        networkIn: 1024 * 1024,
        networkOut: 512 * 1024,
      });

      // Manually update timestamp (workaround for testing)
      // Drizzle stores timestamps as seconds, not milliseconds
      const db = getRawDatabase();
      db.prepare('UPDATE metrics SET timestamp = ? WHERE server_id = ? ORDER BY timestamp DESC LIMIT 1')
        .run(Math.floor(timestamp.getTime() / 1000), serverId);
    }

    // Query 1h range (should get all 3)
    const metrics1h = await metricsRepo.getByServerAndRange(serverId, userId, '1h');
    expect(metrics1h.length).toBe(3);
  });

  it('should prune old metrics', async () => {
    const { userId, serverId } = setupTestServerAndUser();
    const metricsRepo = getMetricsRepository();

    // Insert old metrics (8 days ago)
    const db = getRawDatabase();
    const oldTimestamp = new Date();
    oldTimestamp.setDate(oldTimestamp.getDate() - 8);

    const oldId = randomUUID();
    db.prepare(
      'INSERT INTO metrics (id, server_id, cpu_usage, memory_usage, memory_total, disk_usage, disk_total, network_in, network_out, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      oldId,
      serverId,
      5000, // 50%
      8 * 1024 * 1024 * 1024,
      16 * 1024 * 1024 * 1024,
      100 * 1024 * 1024 * 1024,
      500 * 1024 * 1024 * 1024,
      1024 * 1024,
      512 * 1024,
      Math.floor(oldTimestamp.getTime() / 1000) // Drizzle stores as seconds
    );

    // Insert recent metrics (1 day ago)
    const recentTimestamp = new Date();
    recentTimestamp.setDate(recentTimestamp.getDate() - 1);

    await metricsRepo.record({
      serverId,
      cpuUsage: 60,
      memoryUsage: 8 * 1024 * 1024 * 1024,
      memoryTotal: 16 * 1024 * 1024 * 1024,
      diskUsage: 100 * 1024 * 1024 * 1024,
      diskTotal: 500 * 1024 * 1024 * 1024,
      networkIn: 1024 * 1024,
      networkOut: 512 * 1024,
    });

    // Prune data older than 7 days
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 7);
    const deletedCount = await metricsRepo.pruneOlderThan(cutoffDate);

    expect(deletedCount).toBeGreaterThan(0);

    // Verify old data was deleted
    const all = await metricsRepo.getByServerAndRange(serverId, userId, '7d');
    expect(all.every((m) => new Date(m.timestamp) > cutoffDate)).toBe(true);
  });

  it('should validate ownership when querying metrics', async () => {
    const { userId, serverId } = setupTestServerAndUser();
    const metricsRepo = getMetricsRepository();

    // Insert metrics
    await metricsRepo.record({
      serverId,
      cpuUsage: 50,
      memoryUsage: 8 * 1024 * 1024 * 1024,
      memoryTotal: 16 * 1024 * 1024 * 1024,
      diskUsage: 100 * 1024 * 1024 * 1024,
      diskTotal: 500 * 1024 * 1024 * 1024,
      networkIn: 1024 * 1024,
      networkOut: 512 * 1024,
    });

    // Try to query with wrong user ID
    const wrongUserId = randomUUID();
    const metrics = await metricsRepo.getByServerAndRange(serverId, wrongUserId, '1h');

    // Should return empty array (no permission)
    expect(metrics).toEqual([]);
  });
});

// ============================================================================
// Tests — Tiered aggregation
// ============================================================================

describe('Metrics Tiered Aggregation', () => {
  it('should aggregate raw metrics into hourly buckets', async () => {
    const { userId, serverId } = setupTestServerAndUser();
    const metricsRepo = getMetricsRepository();

    // Insert 3 raw metrics in the same hour bucket (2 hours ago)
    const baseTime = new Date();
    baseTime.setHours(baseTime.getHours() - 2);
    const hourStart = new Date(
      Math.floor(baseTime.getTime() / (60 * 60 * 1000)) * (60 * 60 * 1000)
    );

    insertRawMetric(serverId, new Date(hourStart.getTime() + 5 * 60 * 1000), 40);
    insertRawMetric(serverId, new Date(hourStart.getTime() + 20 * 60 * 1000), 60);
    insertRawMetric(serverId, new Date(hourStart.getTime() + 40 * 60 * 1000), 80);

    // Aggregate the hour range
    const from = new Date(hourStart.getTime() - 60 * 1000); // slight buffer
    const to = new Date(hourStart.getTime() + 60 * 60 * 1000 + 60 * 1000);
    const inserted = await metricsRepo.aggregateToHourly(from, to);

    expect(inserted).toBe(1);

    // Read back the hourly aggregate
    const hourlyData = await metricsRepo.getHourlyByServerAndRange(
      serverId, userId, from, to
    );

    expect(hourlyData).toHaveLength(1);
    const point = hourlyData[0];
    expect(point.sampleCount).toBe(3);
    // CPU avg: (40+60+80)/3 = 60, but stored as *100 then /100
    expect(point.cpuUsage.avg).toBeCloseTo(60, 0);
    expect(point.cpuUsage.min).toBeCloseTo(40, 0);
    expect(point.cpuUsage.max).toBeCloseTo(80, 0);
  });

  it('should not create duplicate hourly aggregates', async () => {
    const { userId, serverId } = setupTestServerAndUser();
    const metricsRepo = getMetricsRepository();

    const hourStart = new Date();
    hourStart.setHours(hourStart.getHours() - 3);
    const bucketStart = new Date(
      Math.floor(hourStart.getTime() / (60 * 60 * 1000)) * (60 * 60 * 1000)
    );

    insertRawMetric(serverId, new Date(bucketStart.getTime() + 10 * 60 * 1000), 50);

    const from = new Date(bucketStart.getTime() - 60 * 1000);
    const to = new Date(bucketStart.getTime() + 60 * 60 * 1000 + 60 * 1000);

    // Aggregate twice
    const first = await metricsRepo.aggregateToHourly(from, to);
    const second = await metricsRepo.aggregateToHourly(from, to);

    expect(first).toBe(1);
    expect(second).toBe(0); // No new inserts
  });

  it('should aggregate hourly metrics into daily buckets', async () => {
    const { userId, serverId } = setupTestServerAndUser();
    const metricsRepo = getMetricsRepository();

    // Use UTC midnight to match the daily bucket calculation (Math.floor(ts / DAY_MS) * DAY_MS)
    const DAY_MS = 24 * 60 * 60 * 1000;
    const twoDaysAgoMs = Date.now() - 2 * DAY_MS;
    const dayStartUtc = new Date(Math.floor(twoDaysAgoMs / DAY_MS) * DAY_MS);

    // Insert raw metrics across 3 different hours of the same UTC day
    for (let hour = 0; hour < 3; hour++) {
      for (let min = 0; min < 3; min++) {
        const ts = new Date(
          dayStartUtc.getTime() + hour * 60 * 60 * 1000 + min * 10 * 60 * 1000
        );
        insertRawMetric(serverId, ts, 30 + hour * 10 + min * 5);
      }
    }

    // Step 1: Aggregate raw → hourly
    const hourlyFrom = new Date(dayStartUtc.getTime() - 60 * 1000);
    const hourlyTo = new Date(dayStartUtc.getTime() + DAY_MS + 60 * 1000);
    const hourlyInserted = await metricsRepo.aggregateToHourly(hourlyFrom, hourlyTo);
    expect(hourlyInserted).toBe(3); // 3 hour buckets

    // Step 2: Aggregate hourly → daily
    const dailyInserted = await metricsRepo.aggregateToDaily(hourlyFrom, hourlyTo);
    expect(dailyInserted).toBe(1); // 1 day bucket

    // Read back the daily aggregate (range covers the UTC day bucket)
    const dailyData = await metricsRepo.getDailyByServerAndRange(
      serverId, userId, hourlyFrom, hourlyTo
    );

    expect(dailyData).toHaveLength(1);
    expect(dailyData[0].sampleCount).toBe(9); // 3 hours * 3 samples each
  });

  it('should prune hourly aggregates older than retention period', async () => {
    const { userId, serverId } = setupTestServerAndUser();
    const metricsRepo = getMetricsRepository();

    // Insert raw metric 35 days ago
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 35);
    const bucketStart = new Date(
      Math.floor(oldDate.getTime() / (60 * 60 * 1000)) * (60 * 60 * 1000)
    );
    insertRawMetric(serverId, bucketStart, 50);

    // Aggregate to hourly
    const from = new Date(bucketStart.getTime() - 60 * 1000);
    const to = new Date(bucketStart.getTime() + 60 * 60 * 1000 + 60 * 1000);
    await metricsRepo.aggregateToHourly(from, to);

    // Verify it exists
    const before = await metricsRepo.getHourlyByServerAndRange(serverId, userId, from, to);
    expect(before.length).toBe(1);

    // Prune hourly older than 30 days
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    const pruned = await metricsRepo.pruneHourlyOlderThan(cutoff);
    expect(pruned).toBeGreaterThan(0);

    // Verify it was pruned
    const after = await metricsRepo.getHourlyByServerAndRange(serverId, userId, from, to);
    expect(after.length).toBe(0);
  });

  it('should prune daily aggregates older than 1 year', async () => {
    const { userId, serverId } = setupTestServerAndUser();
    const metricsRepo = getMetricsRepository();

    // Insert metric from 400 days ago
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 400);
    const bucketStart = new Date(
      Math.floor(oldDate.getTime() / (60 * 60 * 1000)) * (60 * 60 * 1000)
    );
    insertRawMetric(serverId, bucketStart, 50);

    // Aggregate to hourly, then daily
    const from = new Date(bucketStart.getTime() - 60 * 1000);
    const to = new Date(bucketStart.getTime() + 24 * 60 * 60 * 1000);
    await metricsRepo.aggregateToHourly(from, to);
    await metricsRepo.aggregateToDaily(from, to);

    // Prune daily older than 365 days
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 365);
    const pruned = await metricsRepo.pruneDailyOlderThan(cutoff);
    expect(pruned).toBeGreaterThan(0);
  });
});
