/**
 * E2E Test: Alert Triggering & Notification
 *
 * Tests alert rule management and alert lifecycle:
 * 1. Create alert rules (threshold-based)
 * 2. List/get/update/delete alert rules
 * 3. List alerts
 * 4. Resolve alerts
 * 5. Alert rule validation
 *
 * Note: Actual alert triggering requires agent metrics data.
 * These tests validate the rule CRUD and alert management APIs.
 *
 * @module tests/e2e/05-alerts
 */

import { test, expect } from '@playwright/test';
import {
  registerUser,
  createServer,
  apiGet,
  apiPost,
  apiPatch,
  apiDelete,
} from './helpers';

test.describe('Alert Trigger & Notification', () => {
  test('API: create an alert rule', async ({ request }) => {
    const user = await registerUser(request);
    const server = await createServer(request, user.accessToken, 'Alert Rule Server');

    const { status, body } = await apiPost(
      request,
      '/alert-rules',
      user.accessToken,
      {
        serverId: server.id,
        name: 'High CPU Alert',
        metricType: 'cpu',
        operator: 'gt',
        threshold: 90,
        severity: 'critical',
        cooldownMinutes: 5,
      },
    );

    expect(status).toBe(201);
    const rule = (body as { rule: {
      id: string;
      name: string;
      metricType: string;
      threshold: number;
    } }).rule;
    expect(rule.id).toBeTruthy();
    expect(rule.name).toBe('High CPU Alert');
    expect(rule.metricType).toBe('cpu');
    expect(rule.threshold).toBe(90);
  });

  test('API: list alert rules', async ({ request }) => {
    const user = await registerUser(request);
    const server = await createServer(request, user.accessToken, 'Alert List Server');

    await apiPost(request, '/alert-rules', user.accessToken, {
      serverId: server.id,
      name: 'CPU Rule',
      metricType: 'cpu',
      operator: 'gt',
      threshold: 80,
      severity: 'warning',
    });
    await apiPost(request, '/alert-rules', user.accessToken, {
      serverId: server.id,
      name: 'Memory Rule',
      metricType: 'memory',
      operator: 'gt',
      threshold: 85,
      severity: 'critical',
    });

    const result = await apiGet(
      request,
      `/alert-rules?serverId=${server.id}`,
      user.accessToken,
    ) as { rules: unknown[]; total: number };

    expect(result.rules.length).toBe(2);
    expect(result.total).toBe(2);
  });

  test('API: get alert rule details', async ({ request }) => {
    const user = await registerUser(request);
    const server = await createServer(request, user.accessToken, 'Rule Detail Server');

    const { body: created } = await apiPost(request, '/alert-rules', user.accessToken, {
      serverId: server.id,
      name: 'Disk Alert',
      metricType: 'disk',
      operator: 'gt',
      threshold: 95,
      severity: 'critical',
    });
    const ruleId = (created as { rule: { id: string } }).rule.id;

    const result = await apiGet(
      request,
      `/alert-rules/${ruleId}`,
      user.accessToken,
    ) as { rule: { id: string; name: string; metricType: string } };

    expect(result.rule.id).toBe(ruleId);
    expect(result.rule.name).toBe('Disk Alert');
    expect(result.rule.metricType).toBe('disk');
  });

  test('API: update alert rule', async ({ request }) => {
    const user = await registerUser(request);
    const server = await createServer(request, user.accessToken, 'Rule Update Server');

    const { body: created } = await apiPost(request, '/alert-rules', user.accessToken, {
      serverId: server.id,
      name: 'Original Rule',
      metricType: 'cpu',
      operator: 'gt',
      threshold: 70,
      severity: 'info',
    });
    const ruleId = (created as { rule: { id: string } }).rule.id;

    const { status, body } = await apiPatch(
      request,
      `/alert-rules/${ruleId}`,
      user.accessToken,
      { threshold: 85, severity: 'warning', name: 'Updated Rule' },
    );

    expect(status).toBe(200);
    const rule = (body as { rule: { name: string; threshold: number; severity: string } }).rule;
    expect(rule.name).toBe('Updated Rule');
    expect(rule.threshold).toBe(85);
    expect(rule.severity).toBe('warning');
  });

  test('API: disable/enable alert rule', async ({ request }) => {
    const user = await registerUser(request);
    const server = await createServer(request, user.accessToken, 'Toggle Server');

    const { body: created } = await apiPost(request, '/alert-rules', user.accessToken, {
      serverId: server.id,
      name: 'Toggle Rule',
      metricType: 'cpu',
      operator: 'gt',
      threshold: 80,
      severity: 'warning',
    });
    const ruleId = (created as { rule: { id: string } }).rule.id;

    // Disable
    const { status: disableStatus } = await apiPatch(
      request,
      `/alert-rules/${ruleId}`,
      user.accessToken,
      { enabled: false },
    );
    expect(disableStatus).toBe(200);

    // Verify disabled
    const disabled = await apiGet(
      request,
      `/alert-rules/${ruleId}`,
      user.accessToken,
    ) as { rule: { enabled: boolean } };
    expect(disabled.rule.enabled).toBe(false);

    // Enable
    await apiPatch(
      request,
      `/alert-rules/${ruleId}`,
      user.accessToken,
      { enabled: true },
    );
    const enabled = await apiGet(
      request,
      `/alert-rules/${ruleId}`,
      user.accessToken,
    ) as { rule: { enabled: boolean } };
    expect(enabled.rule.enabled).toBe(true);
  });

  test('API: delete alert rule', async ({ request }) => {
    const user = await registerUser(request);
    const server = await createServer(request, user.accessToken, 'Rule Delete Server');

    const { body: created } = await apiPost(request, '/alert-rules', user.accessToken, {
      serverId: server.id,
      name: 'Delete Me Rule',
      metricType: 'cpu',
      operator: 'gt',
      threshold: 80,
      severity: 'info',
    });
    const ruleId = (created as { rule: { id: string } }).rule.id;

    const { status, body } = await apiDelete(
      request,
      `/alert-rules/${ruleId}`,
      user.accessToken,
    );
    expect(status).toBe(200);
    expect((body as { success: boolean }).success).toBe(true);
  });

  test('API: list alerts (empty initially)', async ({ request }) => {
    const user = await registerUser(request);

    const result = await apiGet(
      request,
      '/alerts',
      user.accessToken,
    ) as { alerts: unknown[]; total: number };

    expect(result.alerts).toEqual([]);
    expect(result.total).toBe(0);
  });

  test('API: alert rule with email recipients', async ({ request }) => {
    const user = await registerUser(request);
    const server = await createServer(request, user.accessToken, 'Email Alert Server');

    const { status, body } = await apiPost(
      request,
      '/alert-rules',
      user.accessToken,
      {
        serverId: server.id,
        name: 'Email Alert Rule',
        metricType: 'cpu',
        operator: 'gt',
        threshold: 95,
        severity: 'critical',
        emailRecipients: ['admin@test.local', 'ops@test.local'],
        cooldownMinutes: 15,
      },
    );

    expect(status).toBe(201);
    const rule = (body as { rule: {
      emailRecipients: string[];
      cooldownMinutes: number;
    } }).rule;
    expect(rule.emailRecipients).toContain('admin@test.local');
    expect(rule.cooldownMinutes).toBe(15);
  });

  test('API: reject invalid alert rule', async ({ request }) => {
    const user = await registerUser(request);
    const server = await createServer(request, user.accessToken, 'Invalid Rule Server');

    // Invalid metric type
    const { status } = await apiPost(
      request,
      '/alert-rules',
      user.accessToken,
      {
        serverId: server.id,
        name: 'Bad Rule',
        metricType: 'invalid_metric',
        operator: 'gt',
        threshold: 80,
        severity: 'info',
      },
    );

    expect(status).toBe(400);
  });
});
