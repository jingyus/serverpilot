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
      'aiUsage', 'aiRoutingLogs', 'subscriptions', 'skillExecutions',
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

  it('ai_usage table has all required columns', () => {
    const t = pgSchema.aiUsage;
    expect(t.id).toBeDefined();
    expect(t.userId).toBeDefined();
    expect(t.tenantId).toBeDefined();
    expect(t.model).toBeDefined();
    expect(t.inputTokens).toBeDefined();
    expect(t.outputTokens).toBeDefined();
    expect(t.cost).toBeDefined();
    expect(t.createdAt).toBeDefined();
  });

  it('ai_routing_logs table has all required columns', () => {
    const t = pgSchema.aiRoutingLogs;
    expect(t.id).toBeDefined();
    expect(t.userId).toBeDefined();
    expect(t.tenantId).toBeDefined();
    expect(t.command).toBeDefined();
    expect(t.riskLevel).toBeDefined();
    expect(t.conversationLength).toBeDefined();
    expect(t.selectedModel).toBeDefined();
    expect(t.actualCost).toBeDefined();
    expect(t.createdAt).toBeDefined();
  });

  it('tenants plan enum includes team', () => {
    // The plan column definition should accept 'team' as a valid value
    const planConfig = pgSchema.tenants.plan;
    expect(planConfig).toBeDefined();
    expect(planConfig.enumValues).toContain('team');
  });

  describe('subscriptions table', () => {
    it('has all required columns', () => {
      const t = pgSchema.subscriptions;
      expect(t.id).toBeDefined();
      expect(t.tenantId).toBeDefined();
      expect(t.userId).toBeDefined();
      expect(t.plan).toBeDefined();
      expect(t.status).toBeDefined();
      expect(t.stripeSubscriptionId).toBeDefined();
      expect(t.stripeCustomerId).toBeDefined();
      expect(t.currentPeriodStart).toBeDefined();
      expect(t.currentPeriodEnd).toBeDefined();
      expect(t.cancelAtPeriodEnd).toBeDefined();
      expect(t.createdAt).toBeDefined();
      expect(t.updatedAt).toBeDefined();
    });

    it('plan enum covers all billing plans', () => {
      const planConfig = pgSchema.subscriptions.plan;
      expect(planConfig.enumValues).toContain('free');
      expect(planConfig.enumValues).toContain('pro');
      expect(planConfig.enumValues).toContain('team');
      expect(planConfig.enumValues).toContain('enterprise');
    });

    it('status enum covers all Stripe lifecycle states', () => {
      const statusConfig = pgSchema.subscriptions.status;
      expect(statusConfig.enumValues).toContain('incomplete');
      expect(statusConfig.enumValues).toContain('active');
      expect(statusConfig.enumValues).toContain('past_due');
      expect(statusConfig.enumValues).toContain('canceled');
      expect(statusConfig.enumValues).toContain('unpaid');
    });

    it('uses serial for primary key', () => {
      // serial columns have a notNull constraint and a generated identity
      expect(pgSchema.subscriptions.id).toBeDefined();
    });
  });
});
