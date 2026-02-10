/**
 * E2E Test: Add Server Flow
 *
 * Tests server management lifecycle through both UI and API:
 * 1. Add a new server (generates agent token)
 * 2. List servers
 * 3. View server details
 * 4. Update server info
 * 5. Delete server
 * 6. Server profile management
 *
 * @module tests/e2e/02-server-management
 */

import { test, expect } from '@playwright/test';
import {
  registerUser,
  createServer,
  setAuthInBrowser,
  apiGet,
  apiPatch,
  apiDelete,
  apiPost,
} from './helpers';

test.describe('Add Server Flow', () => {
  test('API: create server and get agent token', async ({ request }) => {
    const user = await registerUser(request);

    // Create server
    const server = await createServer(request, user.accessToken, 'API Test Server', ['production']);

    expect(server.id).toBeTruthy();
    expect(server.name).toBe('API Test Server');
    expect(server.agentToken).toBeTruthy();
    expect(server.agentToken.length).toBeGreaterThan(10);
  });

  test('API: list servers returns created server', async ({ request }) => {
    const user = await registerUser(request);
    await createServer(request, user.accessToken, 'List Test Server');

    const result = await apiGet(request, '/servers', user.accessToken) as {
      servers: Array<{ name: string }>;
    };

    expect(result.servers).toHaveLength(1);
    expect(result.servers[0].name).toBe('List Test Server');
  });

  test('API: get server details', async ({ request }) => {
    const user = await registerUser(request);
    const server = await createServer(request, user.accessToken, 'Detail Server');

    const result = await apiGet(
      request,
      `/servers/${server.id}`,
      user.accessToken,
    ) as { server: { id: string; name: string } };

    expect(result.server.id).toBe(server.id);
    expect(result.server.name).toBe('Detail Server');
  });

  test('API: update server', async ({ request }) => {
    const user = await registerUser(request);
    const server = await createServer(request, user.accessToken, 'Original Name');

    const { status, body } = await apiPatch(
      request,
      `/servers/${server.id}`,
      user.accessToken,
      { name: 'Updated Name', tags: ['staging'] },
    );

    expect(status).toBe(200);
    expect((body as { server: { name: string } }).server.name).toBe('Updated Name');
  });

  test('API: delete server', async ({ request }) => {
    const user = await registerUser(request);
    const server = await createServer(request, user.accessToken, 'To Delete');

    const { status, body } = await apiDelete(
      request,
      `/servers/${server.id}`,
      user.accessToken,
    );

    expect(status).toBe(200);
    expect((body as { success: boolean }).success).toBe(true);

    // Verify deleted
    const res = await request.get(`http://localhost:3000/api/v1/servers/${server.id}`, {
      headers: { Authorization: `Bearer ${user.accessToken}` },
    });
    expect(res.status()).toBe(404);
  });

  test('API: server profile operations', async ({ request }) => {
    const user = await registerUser(request);
    const server = await createServer(request, user.accessToken, 'Profile Server');

    // Get profile (may be empty initially)
    const profile = await apiGet(
      request,
      `/servers/${server.id}/profile`,
      user.accessToken,
    ) as { profile: unknown };
    expect(profile).toBeTruthy();

    // Add a note
    const noteResult = await apiPost(
      request,
      `/servers/${server.id}/profile/notes`,
      user.accessToken,
      { note: 'Test note for E2E' },
    );
    expect(noteResult.status).toBe(200);

    // Record an operation in history
    const historyResult = await apiPost(
      request,
      `/servers/${server.id}/profile/history`,
      user.accessToken,
      { summary: 'E2E test operation' },
    );
    expect(historyResult.status).toBe(200);
  });

  test('UI: navigate to servers page (authenticated)', async ({ page, request }) => {
    const user = await registerUser(request);

    // Set auth state in browser
    await page.goto('/login');
    await setAuthInBrowser(page, user);
    await page.goto('/servers');

    // Should see the servers page
    await expect(page.getByText(/server/i).first()).toBeVisible({ timeout: 10_000 });
  });

  test('API: server access isolation between users', async ({ request }) => {
    const user1 = await registerUser(request);
    const user2 = await registerUser(request);

    const server = await createServer(request, user1.accessToken, 'User1 Server');

    // User2 should not see User1's server
    const res = await request.get(`http://localhost:3000/api/v1/servers/${server.id}`, {
      headers: { Authorization: `Bearer ${user2.accessToken}` },
    });
    expect(res.status()).toBe(404);
  });
});
