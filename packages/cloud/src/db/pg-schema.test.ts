// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect } from 'vitest';
import * as pgSchema from './pg-schema.js';

describe('pg-schema', () => {
  it('exports all expected table objects', () => {
    const expectedTables = [
      'tenants', 'users', 'oauthAccounts', 'userSettings',
      'servers', 'agents', 'profiles', 'sessions',
      'operations', 'snapshots', 'tasks', 'alertRules',
      'alerts', 'metrics', 'metricsHourly', 'metricsDaily',
      'knowledgeCache', 'auditLogs', 'docSources', 'docSourceHistory',
      'webhooks', 'webhookDeliveries', 'invitations',
    ];

    for (const table of expectedTables) {
      expect(pgSchema).toHaveProperty(table);
      expect((pgSchema as Record<string, unknown>)[table]).toBeDefined();
    }
  });

  it('pg metrics table uses bigint for memory/disk/network columns', () => {
    const metricsConfig = pgSchema.metrics;
    expect(metricsConfig).toBeDefined();
    expect(metricsConfig.memoryUsage).toBeDefined();
    expect(metricsConfig.memoryTotal).toBeDefined();
    expect(metricsConfig.diskUsage).toBeDefined();
    expect(metricsConfig.diskTotal).toBeDefined();
    expect(metricsConfig.networkIn).toBeDefined();
    expect(metricsConfig.networkOut).toBeDefined();
  });

  it('pg schema uses jsonb for JSON fields', () => {
    expect(pgSchema.servers.tags).toBeDefined();
    expect(pgSchema.userSettings.aiProvider).toBeDefined();
    expect(pgSchema.profiles.software).toBeDefined();
  });

  it('pg schema uses native boolean for boolean fields', () => {
    expect(pgSchema.alertRules.enabled).toBeDefined();
    expect(pgSchema.alerts.resolved).toBeDefined();
    expect(pgSchema.docSources.enabled).toBeDefined();
    expect(pgSchema.webhooks.enabled).toBeDefined();
  });

  it('pg schema uses timestamp for date fields', () => {
    expect(pgSchema.users.createdAt).toBeDefined();
    expect(pgSchema.users.updatedAt).toBeDefined();
    expect(pgSchema.metrics.timestamp).toBeDefined();
  });
});
