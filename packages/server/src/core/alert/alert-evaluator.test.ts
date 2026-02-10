/**
 * Tests for AlertEvaluator service.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { initDatabase, closeDatabase, createTables } from '../../db/connection.js';
import { DrizzleAlertRuleRepository } from '../../db/repositories/alert-rule-repository.js';
import { DrizzleAlertRepository } from '../../db/repositories/alert-repository.js';
import { DrizzleMetricsRepository } from '../../db/repositories/metrics-repository.js';
import { AlertEvaluator } from './alert-evaluator.js';

import type { DrizzleDB } from '../../db/connection.js';
import type { EmailNotifier } from './email-notifier.js';

let db: DrizzleDB;
let ruleRepo: DrizzleAlertRuleRepository;
let alertRepo: DrizzleAlertRepository;
let metricsRepo: DrizzleMetricsRepository;
let evaluator: AlertEvaluator;
let mockEmailNotifier: EmailNotifier;

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

describe('AlertEvaluator', () => {
  beforeEach(() => {
    db = initDatabase(':memory:');
    createTables();

    ruleRepo = new DrizzleAlertRuleRepository(db);
    alertRepo = new DrizzleAlertRepository(db);
    metricsRepo = new DrizzleMetricsRepository(db);
    mockEmailNotifier = {
      sendAlertNotification: vi.fn().mockResolvedValue(true),
    };

    evaluator = new AlertEvaluator(
      ruleRepo,
      alertRepo,
      metricsRepo,
      mockEmailNotifier,
    );

    seedUser('user-1', 'test@example.com');
    seedServer('srv-1', 'user-1');
  });

  afterEach(() => {
    evaluator.stop();
    closeDatabase();
  });

  // ==========================================================================
  // Metric extraction
  // ==========================================================================

  it('should extract CPU usage value', () => {
    const metric = {
      id: 'm1', serverId: 'srv-1',
      cpuUsage: 85, memoryUsage: 500, memoryTotal: 1000,
      diskUsage: 200, diskTotal: 500, networkIn: 0, networkOut: 0,
      timestamp: new Date().toISOString(),
    };

    expect(evaluator.extractMetricValue('cpu', metric)).toBe(85);
  });

  it('should extract memory usage as percentage', () => {
    const metric = {
      id: 'm1', serverId: 'srv-1',
      cpuUsage: 50, memoryUsage: 750, memoryTotal: 1000,
      diskUsage: 200, diskTotal: 500, networkIn: 0, networkOut: 0,
      timestamp: new Date().toISOString(),
    };

    expect(evaluator.extractMetricValue('memory', metric)).toBe(75);
  });

  it('should extract disk usage as percentage', () => {
    const metric = {
      id: 'm1', serverId: 'srv-1',
      cpuUsage: 50, memoryUsage: 500, memoryTotal: 1000,
      diskUsage: 450, diskTotal: 500, networkIn: 0, networkOut: 0,
      timestamp: new Date().toISOString(),
    };

    expect(evaluator.extractMetricValue('disk', metric)).toBe(90);
  });

  it('should return 0 for zero total', () => {
    const metric = {
      id: 'm1', serverId: 'srv-1',
      cpuUsage: 50, memoryUsage: 0, memoryTotal: 0,
      diskUsage: 0, diskTotal: 0, networkIn: 0, networkOut: 0,
      timestamp: new Date().toISOString(),
    };

    expect(evaluator.extractMetricValue('memory', metric)).toBe(0);
    expect(evaluator.extractMetricValue('disk', metric)).toBe(0);
  });

  // ==========================================================================
  // Comparison operators
  // ==========================================================================

  it('should compare values correctly with gt', () => {
    expect(evaluator.compareValue(85, 'gt', 80)).toBe(true);
    expect(evaluator.compareValue(80, 'gt', 80)).toBe(false);
    expect(evaluator.compareValue(75, 'gt', 80)).toBe(false);
  });

  it('should compare values correctly with gte', () => {
    expect(evaluator.compareValue(85, 'gte', 80)).toBe(true);
    expect(evaluator.compareValue(80, 'gte', 80)).toBe(true);
    expect(evaluator.compareValue(75, 'gte', 80)).toBe(false);
  });

  it('should compare values correctly with lt', () => {
    expect(evaluator.compareValue(10, 'lt', 20)).toBe(true);
    expect(evaluator.compareValue(20, 'lt', 20)).toBe(false);
    expect(evaluator.compareValue(30, 'lt', 20)).toBe(false);
  });

  it('should compare values correctly with lte', () => {
    expect(evaluator.compareValue(10, 'lte', 20)).toBe(true);
    expect(evaluator.compareValue(20, 'lte', 20)).toBe(true);
    expect(evaluator.compareValue(30, 'lte', 20)).toBe(false);
  });

  // ==========================================================================
  // Evaluation cycle
  // ==========================================================================

  it('should trigger alert when threshold is breached', async () => {
    await ruleRepo.create({
      serverId: 'srv-1',
      userId: 'user-1',
      name: 'CPU check',
      metricType: 'cpu',
      operator: 'gt',
      threshold: 80,
      severity: 'critical',
      emailRecipients: ['admin@example.com'],
    });

    await metricsRepo.record({
      serverId: 'srv-1',
      cpuUsage: 90,
      memoryUsage: 500,
      memoryTotal: 1000,
      diskUsage: 200,
      diskTotal: 500,
      networkIn: 0,
      networkOut: 0,
    });

    const results = await evaluator.evaluate();

    expect(results).toHaveLength(1);
    expect(results[0].triggered).toBe(true);
    expect(results[0].currentValue).toBe(90);

    // Verify alert was created
    const alerts = await alertRepo.listUnresolved('user-1', { limit: 10, offset: 0 });
    expect(alerts.total).toBe(1);
    expect(alerts.alerts[0].type).toBe('cpu');

    // Verify email was sent
    expect(mockEmailNotifier.sendAlertNotification).toHaveBeenCalledTimes(1);
    expect(mockEmailNotifier.sendAlertNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        recipients: ['admin@example.com'],
        ruleName: 'CPU check',
        serverId: 'srv-1',
        metricType: 'cpu',
        severity: 'critical',
      }),
    );
  });

  it('should NOT trigger alert when value is within threshold', async () => {
    await ruleRepo.create({
      serverId: 'srv-1',
      userId: 'user-1',
      name: 'CPU check',
      metricType: 'cpu',
      operator: 'gt',
      threshold: 80,
      severity: 'warning',
    });

    await metricsRepo.record({
      serverId: 'srv-1',
      cpuUsage: 50,
      memoryUsage: 500,
      memoryTotal: 1000,
      diskUsage: 200,
      diskTotal: 500,
      networkIn: 0,
      networkOut: 0,
    });

    const results = await evaluator.evaluate();

    expect(results).toHaveLength(1);
    expect(results[0].triggered).toBe(false);

    const alerts = await alertRepo.listUnresolved('user-1', { limit: 10, offset: 0 });
    expect(alerts.total).toBe(0);
  });

  it('should respect cooldown period', async () => {
    const rule = await ruleRepo.create({
      serverId: 'srv-1',
      userId: 'user-1',
      name: 'CPU check',
      metricType: 'cpu',
      operator: 'gt',
      threshold: 80,
      severity: 'warning',
      cooldownMinutes: 60,
    });

    await metricsRepo.record({
      serverId: 'srv-1',
      cpuUsage: 90,
      memoryUsage: 500,
      memoryTotal: 1000,
      diskUsage: 200,
      diskTotal: 500,
      networkIn: 0,
      networkOut: 0,
    });

    // First evaluation should trigger
    const results1 = await evaluator.evaluate();
    expect(results1[0].triggered).toBe(true);

    const alerts1 = await alertRepo.listUnresolved('user-1', { limit: 10, offset: 0 });
    expect(alerts1.total).toBe(1);

    // Second evaluation should be in cooldown
    const results2 = await evaluator.evaluate();
    expect(results2[0].triggered).toBe(true); // Still triggered, but no new alert

    const alerts2 = await alertRepo.listUnresolved('user-1', { limit: 10, offset: 0 });
    expect(alerts2.total).toBe(1); // Still only 1 alert
  });

  it('should skip disabled rules', async () => {
    const rule = await ruleRepo.create({
      serverId: 'srv-1',
      userId: 'user-1',
      name: 'CPU check',
      metricType: 'cpu',
      operator: 'gt',
      threshold: 80,
      severity: 'warning',
    });

    await ruleRepo.update(rule.id, 'user-1', { enabled: false });

    await metricsRepo.record({
      serverId: 'srv-1',
      cpuUsage: 95,
      memoryUsage: 500,
      memoryTotal: 1000,
      diskUsage: 200,
      diskTotal: 500,
      networkIn: 0,
      networkOut: 0,
    });

    const results = await evaluator.evaluate();
    expect(results).toHaveLength(0);
  });

  it('should skip servers with no metrics', async () => {
    await ruleRepo.create({
      serverId: 'srv-1',
      userId: 'user-1',
      name: 'CPU check',
      metricType: 'cpu',
      operator: 'gt',
      threshold: 80,
      severity: 'warning',
    });

    // No metrics recorded
    const results = await evaluator.evaluate();
    expect(results).toHaveLength(0);
  });

  it('should not send email when no recipients configured', async () => {
    await ruleRepo.create({
      serverId: 'srv-1',
      userId: 'user-1',
      name: 'CPU check',
      metricType: 'cpu',
      operator: 'gt',
      threshold: 80,
      severity: 'warning',
      emailRecipients: [],
    });

    await metricsRepo.record({
      serverId: 'srv-1',
      cpuUsage: 90,
      memoryUsage: 500,
      memoryTotal: 1000,
      diskUsage: 200,
      diskTotal: 500,
      networkIn: 0,
      networkOut: 0,
    });

    await evaluator.evaluate();

    expect(mockEmailNotifier.sendAlertNotification).not.toHaveBeenCalled();
  });

  // ==========================================================================
  // Start/Stop
  // ==========================================================================

  it('should start and stop correctly', () => {
    expect(evaluator.isRunning()).toBe(false);
    evaluator.start();
    expect(evaluator.isRunning()).toBe(true);
    evaluator.stop();
    expect(evaluator.isRunning()).toBe(false);
  });

  it('should not start twice', () => {
    evaluator.start();
    evaluator.start(); // No-op
    expect(evaluator.isRunning()).toBe(true);
    evaluator.stop();
  });
});
