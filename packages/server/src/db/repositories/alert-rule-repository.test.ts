// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for AlertRuleRepository (Drizzle implementation).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { initDatabase, closeDatabase } from '../connection.js';
import { createTables } from '../connection.js';
import { DrizzleAlertRuleRepository } from './alert-rule-repository.js';

import type { DrizzleDB } from '../connection.js';

let db: DrizzleDB;
let repo: DrizzleAlertRuleRepository;

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

describe('DrizzleAlertRuleRepository', () => {
  beforeEach(() => {
    db = initDatabase(':memory:');
    createTables();
    repo = new DrizzleAlertRuleRepository(db);

    seedUser('user-1', 'test@example.com');
    seedUser('user-2', 'other@example.com');
    seedServer('srv-1', 'user-1');
    seedServer('srv-2', 'user-2');
  });

  afterEach(() => {
    closeDatabase();
  });

  // ==========================================================================
  // Create
  // ==========================================================================

  it('should create an alert rule', async () => {
    const rule = await repo.create({
      serverId: 'srv-1',
      userId: 'user-1',
      name: 'High CPU',
      metricType: 'cpu',
      operator: 'gt',
      threshold: 80,
      severity: 'warning',
      emailRecipients: ['admin@example.com'],
    });

    expect(rule.id).toBeTruthy();
    expect(rule.name).toBe('High CPU');
    expect(rule.metricType).toBe('cpu');
    expect(rule.operator).toBe('gt');
    expect(rule.threshold).toBe(80);
    expect(rule.severity).toBe('warning');
    expect(rule.enabled).toBe(true);
    expect(rule.emailRecipients).toEqual(['admin@example.com']);
    expect(rule.cooldownMinutes).toBe(30);
    expect(rule.lastTriggeredAt).toBeNull();
  });

  it('should throw when creating rule for non-owned server', async () => {
    await expect(
      repo.create({
        serverId: 'srv-2',
        userId: 'user-1',
        name: 'Hack',
        metricType: 'cpu',
        operator: 'gt',
        threshold: 90,
        severity: 'critical',
      }),
    ).rejects.toThrow('Server not found or access denied');
  });

  it('should use default values for optional fields', async () => {
    const rule = await repo.create({
      serverId: 'srv-1',
      userId: 'user-1',
      name: 'Disk check',
      metricType: 'disk',
      operator: 'gte',
      threshold: 90,
      severity: 'critical',
    });

    expect(rule.emailRecipients).toEqual([]);
    expect(rule.cooldownMinutes).toBe(30);
  });

  // ==========================================================================
  // GetById
  // ==========================================================================

  it('should get rule by ID with user isolation', async () => {
    const created = await repo.create({
      serverId: 'srv-1',
      userId: 'user-1',
      name: 'Memory check',
      metricType: 'memory',
      operator: 'gt',
      threshold: 75,
      severity: 'warning',
    });

    const found = await repo.getById(created.id, 'user-1');
    expect(found).not.toBeNull();
    expect(found!.name).toBe('Memory check');

    const notFound = await repo.getById(created.id, 'user-2');
    expect(notFound).toBeNull();
  });

  it('should return null for non-existent rule', async () => {
    const result = await repo.getById('non-existent', 'user-1');
    expect(result).toBeNull();
  });

  // ==========================================================================
  // Update
  // ==========================================================================

  it('should update an alert rule', async () => {
    const created = await repo.create({
      serverId: 'srv-1',
      userId: 'user-1',
      name: 'CPU check',
      metricType: 'cpu',
      operator: 'gt',
      threshold: 80,
      severity: 'warning',
    });

    const updated = await repo.update(created.id, 'user-1', {
      name: 'CPU critical',
      threshold: 95,
      severity: 'critical',
      emailRecipients: ['ops@example.com'],
    });

    expect(updated).not.toBeNull();
    expect(updated!.name).toBe('CPU critical');
    expect(updated!.threshold).toBe(95);
    expect(updated!.severity).toBe('critical');
    expect(updated!.emailRecipients).toEqual(['ops@example.com']);
  });

  it('should return null when updating non-owned rule', async () => {
    const created = await repo.create({
      serverId: 'srv-1',
      userId: 'user-1',
      name: 'CPU check',
      metricType: 'cpu',
      operator: 'gt',
      threshold: 80,
      severity: 'warning',
    });

    const result = await repo.update(created.id, 'user-2', { threshold: 50 });
    expect(result).toBeNull();
  });

  it('should enable/disable rule via update', async () => {
    const created = await repo.create({
      serverId: 'srv-1',
      userId: 'user-1',
      name: 'Disk check',
      metricType: 'disk',
      operator: 'gt',
      threshold: 90,
      severity: 'critical',
    });

    const disabled = await repo.update(created.id, 'user-1', { enabled: false });
    expect(disabled!.enabled).toBe(false);

    const enabled = await repo.update(created.id, 'user-1', { enabled: true });
    expect(enabled!.enabled).toBe(true);
  });

  // ==========================================================================
  // Delete
  // ==========================================================================

  it('should delete an alert rule', async () => {
    const created = await repo.create({
      serverId: 'srv-1',
      userId: 'user-1',
      name: 'Temp rule',
      metricType: 'cpu',
      operator: 'gt',
      threshold: 50,
      severity: 'info',
    });

    const success = await repo.delete(created.id, 'user-1');
    expect(success).toBe(true);

    const found = await repo.getById(created.id, 'user-1');
    expect(found).toBeNull();
  });

  it('should deny deleting non-owned rule', async () => {
    const created = await repo.create({
      serverId: 'srv-1',
      userId: 'user-1',
      name: 'My rule',
      metricType: 'cpu',
      operator: 'gt',
      threshold: 80,
      severity: 'warning',
    });

    const success = await repo.delete(created.id, 'user-2');
    expect(success).toBe(false);

    // Rule should still exist
    const found = await repo.getById(created.id, 'user-1');
    expect(found).not.toBeNull();
  });

  // ==========================================================================
  // List
  // ==========================================================================

  it('should list rules by server', async () => {
    await repo.create({
      serverId: 'srv-1',
      userId: 'user-1',
      name: 'Rule A',
      metricType: 'cpu',
      operator: 'gt',
      threshold: 80,
      severity: 'warning',
    });
    await repo.create({
      serverId: 'srv-1',
      userId: 'user-1',
      name: 'Rule B',
      metricType: 'memory',
      operator: 'gt',
      threshold: 90,
      severity: 'critical',
    });

    const result = await repo.listByServer('srv-1', 'user-1', { limit: 10, offset: 0 });
    expect(result.total).toBe(2);
    expect(result.rules).toHaveLength(2);
  });

  it('should deny listing rules for non-owned server', async () => {
    await repo.create({
      serverId: 'srv-1',
      userId: 'user-1',
      name: 'Rule',
      metricType: 'cpu',
      operator: 'gt',
      threshold: 80,
      severity: 'warning',
    });

    const result = await repo.listByServer('srv-1', 'user-2', { limit: 10, offset: 0 });
    expect(result.rules).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('should list rules by user', async () => {
    await repo.create({
      serverId: 'srv-1',
      userId: 'user-1',
      name: 'Rule 1',
      metricType: 'cpu',
      operator: 'gt',
      threshold: 80,
      severity: 'warning',
    });
    await repo.create({
      serverId: 'srv-1',
      userId: 'user-1',
      name: 'Rule 2',
      metricType: 'disk',
      operator: 'gte',
      threshold: 90,
      severity: 'critical',
    });

    const result = await repo.listByUser('user-1', { limit: 10, offset: 0 });
    expect(result.total).toBe(2);
    expect(result.rules).toHaveLength(2);
  });

  it('should paginate rules', async () => {
    for (let i = 0; i < 5; i++) {
      await repo.create({
        serverId: 'srv-1',
        userId: 'user-1',
        name: `Rule ${i}`,
        metricType: 'cpu',
        operator: 'gt',
        threshold: 50 + i * 10,
        severity: 'warning',
      });
    }

    const page1 = await repo.listByUser('user-1', { limit: 2, offset: 0 });
    expect(page1.total).toBe(5);
    expect(page1.rules).toHaveLength(2);

    const page2 = await repo.listByUser('user-1', { limit: 2, offset: 2 });
    expect(page2.total).toBe(5);
    expect(page2.rules).toHaveLength(2);
  });

  // ==========================================================================
  // Enabled Rules
  // ==========================================================================

  it('should list only enabled rules', async () => {
    const rule1 = await repo.create({
      serverId: 'srv-1',
      userId: 'user-1',
      name: 'Enabled',
      metricType: 'cpu',
      operator: 'gt',
      threshold: 80,
      severity: 'warning',
    });

    await repo.create({
      serverId: 'srv-1',
      userId: 'user-1',
      name: 'To disable',
      metricType: 'disk',
      operator: 'gt',
      threshold: 90,
      severity: 'critical',
    });

    // Disable the second rule
    const all = await repo.listByUser('user-1', { limit: 10, offset: 0 });
    const secondRule = all.rules.find((r) => r.name === 'To disable')!;
    await repo.update(secondRule.id, 'user-1', { enabled: false });

    const enabled = await repo.listEnabled();
    expect(enabled).toHaveLength(1);
    expect(enabled[0].id).toBe(rule1.id);
  });

  // ==========================================================================
  // Last Triggered
  // ==========================================================================

  it('should update lastTriggeredAt', async () => {
    const rule = await repo.create({
      serverId: 'srv-1',
      userId: 'user-1',
      name: 'CPU check',
      metricType: 'cpu',
      operator: 'gt',
      threshold: 80,
      severity: 'warning',
    });

    expect(rule.lastTriggeredAt).toBeNull();

    await repo.updateLastTriggered(rule.id);

    const updated = await repo.getById(rule.id, 'user-1');
    expect(updated!.lastTriggeredAt).toBeTruthy();
  });
});
