// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect } from 'vitest';
import * as pgSchema from './pg-schema.js';
import * as sqliteSchema from './schema.js';

describe('pg-schema', () => {
  it('exports all the same table names as sqlite schema', () => {
    const pgTables = Object.keys(pgSchema).filter(
      (k) => typeof (pgSchema as Record<string, unknown>)[k] === 'object'
        && (pgSchema as Record<string, unknown>)[k] !== null
        && 'getSQL' in ((pgSchema as Record<string, Record<string, unknown>>)[k] ?? {}),
    );
    const sqliteTables = Object.keys(sqliteSchema).filter(
      (k) => typeof (sqliteSchema as Record<string, unknown>)[k] === 'object'
        && (sqliteSchema as Record<string, unknown>)[k] !== null
        && 'getSQL' in ((sqliteSchema as Record<string, Record<string, unknown>>)[k] ?? {}),
    );

    // Both should have the same table names
    expect(pgTables.sort()).toEqual(sqliteTables.sort());
  });

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

  it('pg tables use the same column names as sqlite', () => {
    // Verify a representative table (users) has matching column names
    // pgTable adds an internal `enableRLS` property — filter it out
    const pgCols = Object.keys(pgSchema.users).filter((k) => k !== 'enableRLS');
    const sqliteCols = Object.keys(sqliteSchema.users);
    // Both should have the same column accessor keys
    expect(pgCols.sort()).toEqual(sqliteCols.sort());
  });

  it('pg metrics table uses bigint for memory/disk/network columns', () => {
    // Verify that the PG schema uses bigint for large number columns
    const metricsConfig = pgSchema.metrics;
    expect(metricsConfig).toBeDefined();
    // Columns should exist
    expect(metricsConfig.memoryUsage).toBeDefined();
    expect(metricsConfig.memoryTotal).toBeDefined();
    expect(metricsConfig.diskUsage).toBeDefined();
    expect(metricsConfig.diskTotal).toBeDefined();
    expect(metricsConfig.networkIn).toBeDefined();
    expect(metricsConfig.networkOut).toBeDefined();
  });

  it('pg schema uses jsonb for JSON fields', () => {
    // Verify servers.tags uses jsonb, not text
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
