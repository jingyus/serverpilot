/**
 * Tests for MetricsRepository (Drizzle implementation).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { initDatabase, closeDatabase, createTables } from '../connection.js';
import { DrizzleMetricsRepository } from './metrics-repository.js';

import type { DrizzleDB } from '../connection.js';

let db: DrizzleDB;
let repo: DrizzleMetricsRepository;

function seedUser(id: string, email: string) {
  const sqlite = (db as unknown as { session: { client: { exec: (s: string) => void } } })
    .session.client;
  sqlite.exec(
    `INSERT INTO users (id, email, password_hash, created_at, updated_at)
     VALUES ('${id}', '${email}', 'hash', ${Date.now()}, ${Date.now()})`,
  );
}

function seedServer(id: string, userId: string) {
  const sqlite = (db as unknown as { session: { client: { exec: (s: string) => void } } })
    .session.client;
  sqlite.exec(
    `INSERT INTO servers (id, name, user_id, status, tags, created_at, updated_at)
     VALUES ('${id}', 'Server', '${userId}', 'online', '[]', ${Date.now()}, ${Date.now()})`,
  );
}

describe('DrizzleMetricsRepository', () => {
  beforeEach(() => {
    db = initDatabase(':memory:');
    createTables();
    repo = new DrizzleMetricsRepository(db);

    seedUser('user-1', 'test@example.com');
    seedUser('user-2', 'other@example.com');
    seedServer('srv-1', 'user-1');
    seedServer('srv-2', 'user-2');
  });

  afterEach(() => {
    closeDatabase();
  });

  it('should record a metric point', async () => {
    const metric = await repo.record({
      serverId: 'srv-1',
      cpuUsage: 45.5,
      memoryUsage: 1024 * 1024 * 512,
      memoryTotal: 1024 * 1024 * 1024,
      diskUsage: 1024 * 1024 * 1024 * 50,
      diskTotal: 1024 * 1024 * 1024 * 100,
      networkIn: 1024 * 100,
      networkOut: 1024 * 50,
    });

    expect(metric.id).toBeTruthy();
    expect(metric.serverId).toBe('srv-1');
    expect(metric.cpuUsage).toBeCloseTo(45.5, 1);
    expect(metric.memoryUsage).toBe(1024 * 1024 * 512);
    expect(metric.timestamp).toBeTruthy();
  });

  it('should get metrics by server and range', async () => {
    // Record a few metrics
    await repo.record({
      serverId: 'srv-1',
      cpuUsage: 30,
      memoryUsage: 100,
      memoryTotal: 1000,
      diskUsage: 500,
      diskTotal: 1000,
      networkIn: 100,
      networkOut: 50,
    });

    await repo.record({
      serverId: 'srv-1',
      cpuUsage: 50,
      memoryUsage: 200,
      memoryTotal: 1000,
      diskUsage: 600,
      diskTotal: 1000,
      networkIn: 200,
      networkOut: 100,
    });

    const result = await repo.getByServerAndRange('srv-1', 'user-1', '1h');

    expect(result).toHaveLength(2);
    expect(result[0].cpuUsage).toBeCloseTo(30, 0);
    expect(result[1].cpuUsage).toBeCloseTo(50, 0);
  });

  it('should enforce user isolation on getByServerAndRange', async () => {
    await repo.record({
      serverId: 'srv-1',
      cpuUsage: 45,
      memoryUsage: 100,
      memoryTotal: 1000,
      diskUsage: 500,
      diskTotal: 1000,
      networkIn: 100,
      networkOut: 50,
    });

    // user-2 should not see srv-1 metrics
    const result = await repo.getByServerAndRange('srv-1', 'user-2', '1h');
    expect(result).toHaveLength(0);
  });

  it('should get latest metric for a server', async () => {
    await repo.record({
      serverId: 'srv-1',
      cpuUsage: 30,
      memoryUsage: 100,
      memoryTotal: 1000,
      diskUsage: 500,
      diskTotal: 1000,
      networkIn: 100,
      networkOut: 50,
    });

    // Small delay to ensure different timestamp
    await new Promise((r) => setTimeout(r, 10));

    await repo.record({
      serverId: 'srv-1',
      cpuUsage: 80,
      memoryUsage: 800,
      memoryTotal: 1000,
      diskUsage: 900,
      diskTotal: 1000,
      networkIn: 500,
      networkOut: 300,
    });

    const latest = await repo.getLatest('srv-1', 'user-1');
    expect(latest).not.toBeNull();
    expect(latest!.cpuUsage).toBeCloseTo(80, 0);
  });

  it('should return null for getLatest with wrong user', async () => {
    await repo.record({
      serverId: 'srv-1',
      cpuUsage: 30,
      memoryUsage: 100,
      memoryTotal: 1000,
      diskUsage: 500,
      diskTotal: 1000,
      networkIn: 100,
      networkOut: 50,
    });

    const result = await repo.getLatest('srv-1', 'user-2');
    expect(result).toBeNull();
  });

  it('should return null for getLatest when no metrics exist', async () => {
    const result = await repo.getLatest('srv-1', 'user-1');
    expect(result).toBeNull();
  });

  it('should filter metrics by time range', async () => {
    // Insert a metric with an old timestamp manually
    const sqlite = (db as unknown as { session: { client: { exec: (s: string) => void } } })
      .session.client;
    const twoHoursAgo = Math.floor((Date.now() - 2 * 60 * 60 * 1000) / 1000);
    sqlite.exec(
      `INSERT INTO metrics (id, server_id, cpu_usage, memory_usage, memory_total, disk_usage, disk_total, network_in, network_out, timestamp)
       VALUES ('old-metric', 'srv-1', 5000, 100, 1000, 500, 1000, 100, 50, ${twoHoursAgo})`,
    );

    // Insert a recent metric
    await repo.record({
      serverId: 'srv-1',
      cpuUsage: 60,
      memoryUsage: 300,
      memoryTotal: 1000,
      diskUsage: 700,
      diskTotal: 1000,
      networkIn: 200,
      networkOut: 100,
    });

    // 1h range should only include the recent metric
    const oneHour = await repo.getByServerAndRange('srv-1', 'user-1', '1h');
    expect(oneHour).toHaveLength(1);
    expect(oneHour[0].cpuUsage).toBeCloseTo(60, 0);

    // 24h range should include both
    const oneDay = await repo.getByServerAndRange('srv-1', 'user-1', '24h');
    expect(oneDay).toHaveLength(2);
  });

  it('should prune old metrics', async () => {
    // Insert old metrics
    const sqlite = (db as unknown as { session: { client: { exec: (s: string) => void } } })
      .session.client;
    const tenDaysAgo = Math.floor((Date.now() - 10 * 24 * 60 * 60 * 1000) / 1000);
    sqlite.exec(
      `INSERT INTO metrics (id, server_id, cpu_usage, memory_usage, memory_total, disk_usage, disk_total, network_in, network_out, timestamp)
       VALUES ('old-1', 'srv-1', 5000, 100, 1000, 500, 1000, 100, 50, ${tenDaysAgo})`,
    );
    sqlite.exec(
      `INSERT INTO metrics (id, server_id, cpu_usage, memory_usage, memory_total, disk_usage, disk_total, network_in, network_out, timestamp)
       VALUES ('old-2', 'srv-1', 6000, 200, 1000, 600, 1000, 200, 100, ${tenDaysAgo})`,
    );

    // Record a recent metric
    await repo.record({
      serverId: 'srv-1',
      cpuUsage: 70,
      memoryUsage: 400,
      memoryTotal: 1000,
      diskUsage: 800,
      diskTotal: 1000,
      networkIn: 300,
      networkOut: 150,
    });

    // Prune anything older than 7 days
    const pruned = await repo.pruneOlderThan(
      new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
    );
    expect(pruned).toBe(2);

    // Verify only recent metric remains
    const remaining = await repo.getByServerAndRange('srv-1', 'user-1', '7d');
    expect(remaining).toHaveLength(1);
  });

  it('should return metrics ordered by timestamp ascending', async () => {
    await repo.record({
      serverId: 'srv-1',
      cpuUsage: 10,
      memoryUsage: 100,
      memoryTotal: 1000,
      diskUsage: 100,
      diskTotal: 1000,
      networkIn: 50,
      networkOut: 25,
    });

    await new Promise((r) => setTimeout(r, 10));

    await repo.record({
      serverId: 'srv-1',
      cpuUsage: 90,
      memoryUsage: 900,
      memoryTotal: 1000,
      diskUsage: 900,
      diskTotal: 1000,
      networkIn: 500,
      networkOut: 250,
    });

    const result = await repo.getByServerAndRange('srv-1', 'user-1', '1h');
    expect(result).toHaveLength(2);
    // Should be ordered ascending by timestamp
    const t0 = new Date(result[0].timestamp).getTime();
    const t1 = new Date(result[1].timestamp).getTime();
    expect(t0).toBeLessThanOrEqual(t1);
    expect(result[0].cpuUsage).toBeCloseTo(10, 0);
    expect(result[1].cpuUsage).toBeCloseTo(90, 0);
  });

  it('should correctly convert cpuUsage with decimal precision', async () => {
    const metric = await repo.record({
      serverId: 'srv-1',
      cpuUsage: 45.67,
      memoryUsage: 100,
      memoryTotal: 1000,
      diskUsage: 500,
      diskTotal: 1000,
      networkIn: 100,
      networkOut: 50,
    });

    expect(metric.cpuUsage).toBeCloseTo(45.67, 1);

    // Verify roundtrip through database
    const fromDb = await repo.getLatest('srv-1', 'user-1');
    expect(fromDb!.cpuUsage).toBeCloseTo(45.67, 1);
  });
});
