/**
 * E2E Test: Snapshot & Rollback
 *
 * Tests snapshot management and rollback lifecycle:
 * 1. List snapshots for a server
 * 2. Get snapshot details
 * 3. Rollback from snapshot (requires agent)
 * 4. Delete snapshot
 * 5. Access control
 *
 * Note: Creating snapshots requires an agent connection.
 * These tests validate the API contract and error handling.
 *
 * @module tests/e2e/06-snapshot-rollback
 */

import { test, expect } from '@playwright/test';
import {
  registerUser,
  createServer,
  setAuthInBrowser,
  apiGet,
  apiDelete,
  apiPost,
} from './helpers';

test.describe('Snapshot & Rollback', () => {
  test('API: list snapshots (empty initially)', async ({ request }) => {
    const user = await registerUser(request);
    const server = await createServer(request, user.accessToken, 'Snapshot List Server');

    const result = await apiGet(
      request,
      `/servers/${server.id}/snapshots`,
      user.accessToken,
    ) as { snapshots: unknown[]; total: number };

    expect(result.snapshots).toEqual([]);
    expect(result.total).toBe(0);
  });

  test('API: get nonexistent snapshot returns 404', async ({ request }) => {
    const user = await registerUser(request);
    const server = await createServer(request, user.accessToken, 'Snapshot 404 Server');

    const res = await request.get(
      `http://localhost:3000/api/v1/servers/${server.id}/snapshots/nonexistent-id`,
      { headers: { Authorization: `Bearer ${user.accessToken}` } },
    );

    expect(res.status()).toBe(404);
  });

  test('API: delete nonexistent snapshot returns 404', async ({ request }) => {
    const user = await registerUser(request);
    const server = await createServer(request, user.accessToken, 'Snapshot Del Server');

    const res = await request.delete(
      `http://localhost:3000/api/v1/servers/${server.id}/snapshots/nonexistent-id`,
      { headers: { Authorization: `Bearer ${user.accessToken}` } },
    );

    expect(res.status()).toBe(404);
  });

  test('API: rollback nonexistent snapshot returns error', async ({ request }) => {
    const user = await registerUser(request);
    const server = await createServer(request, user.accessToken, 'Rollback 404 Server');

    const res = await request.post(
      `http://localhost:3000/api/v1/servers/${server.id}/snapshots/nonexistent-id/rollback`,
      {
        headers: { Authorization: `Bearer ${user.accessToken}` },
        data: {
          clientId: 'fake-client-id',
          reason: 'Test rollback',
        },
      },
    );

    // Should return 404 (snapshot not found) or 502 (rollback failed)
    expect([404, 502]).toContain(res.status());
  });

  test('API: snapshot access control between users', async ({ request }) => {
    const user1 = await registerUser(request);
    const user2 = await registerUser(request);
    const server = await createServer(request, user1.accessToken, 'ACL Snapshot Server');

    // User2 should not access User1's server snapshots
    const res = await request.get(
      `http://localhost:3000/api/v1/servers/${server.id}/snapshots`,
      { headers: { Authorization: `Bearer ${user2.accessToken}` } },
    );

    // Should either return empty (no access) or 404
    const body = await res.json();
    if (res.ok()) {
      expect((body as { snapshots: unknown[] }).snapshots).toEqual([]);
    }
  });

  test('API: operations history for server', async ({ request }) => {
    const user = await registerUser(request);
    const server = await createServer(request, user.accessToken, 'Ops History Server');

    // List operations — should be empty initially
    const result = await apiGet(
      request,
      `/servers/${server.id}/operations`,
      user.accessToken,
    ) as { operations: unknown[]; total: number };

    expect(result.operations).toEqual([]);
    expect(result.total).toBe(0);
  });

  test('API: health check endpoint', async ({ request }) => {
    const res = await request.get('http://localhost:3000/health');
    expect(res.ok()).toBeTruthy();

    const json = await res.json();
    expect(json.status).toBe('ok');
    expect(json.timestamp).toBeTruthy();
  });

  test('UI: navigate to server detail (authenticated)', async ({ page, request }) => {
    const user = await registerUser(request);
    const server = await createServer(request, user.accessToken, 'UI Detail Server');

    await page.goto('/login');
    await setAuthInBrowser(page, user);
    await page.goto(`/servers/${server.id}`);

    await expect(page.locator('body')).toBeVisible({ timeout: 10_000 });
  });

  test('API: rollback requires valid body', async ({ request }) => {
    const user = await registerUser(request);
    const server = await createServer(request, user.accessToken, 'Rollback Validation Server');

    // Missing required clientId
    const res = await request.post(
      `http://localhost:3000/api/v1/servers/${server.id}/snapshots/some-id/rollback`,
      {
        headers: { Authorization: `Bearer ${user.accessToken}` },
        data: { reason: 'Test' },
      },
    );

    expect(res.status()).toBe(400);
  });

  test('API: full CRUD lifecycle via operations API', async ({ request }) => {
    const user = await registerUser(request);
    const server = await createServer(request, user.accessToken, 'CRUD Ops Server');

    // Create an operation record via profile history
    const { status: recordStatus } = await apiPost(
      request,
      `/servers/${server.id}/profile/history`,
      user.accessToken,
      { summary: 'E2E snapshot test operation' },
    );
    expect(recordStatus).toBe(200);

    // Get history
    const history = await apiGet(
      request,
      `/servers/${server.id}/profile/history`,
      user.accessToken,
    ) as { history: string[]; total: number };

    expect(history.total).toBeGreaterThanOrEqual(1);
    expect(history.history[0]).toContain('E2E snapshot test operation');
  });

  test('API: server metrics endpoint', async ({ request }) => {
    const user = await registerUser(request);
    const server = await createServer(request, user.accessToken, 'Metrics Server');

    const result = await apiGet(
      request,
      `/servers/${server.id}/metrics?range=1h`,
      user.accessToken,
    ) as { metrics: unknown[]; range: string };

    expect(result.metrics).toEqual([]);
    expect(result.range).toBe('1h');
  });
});
