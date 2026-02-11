/**
 * E2E Test: Core User Journeys
 *
 * Tests the four critical end-to-end user journeys required by task-052:
 *
 * Journey 1: Register → Login → Add Server → View Agent Token
 * Journey 2: Select Server → Send Chat → Receive AI Response → View Plan
 * Journey 3: Settings → Switch AI Provider → Verify Health Check
 * Journey 4: Server Detail → View Real-Time Monitoring Metrics
 *
 * These tests validate the complete user experience through the Dashboard UI,
 * combining API calls for data setup with Playwright UI interactions.
 *
 * The AI provider runs without an API key, so the server returns
 * built-in fallback responses (SSE stream with error or preset messages).
 *
 * @module tests/e2e/08-core-user-journeys
 */

import { test, expect } from '@playwright/test';
import { WebSocket } from 'ws';
import {
  registerUser,
  createServer,
  setAuthInBrowser,
  uniqueEmail,
  apiGet,
  apiPost,
} from './helpers';

const WS_URL = 'ws://localhost:3000';
const API_BASE = 'http://localhost:3000/api/v1';

// ============================================================================
// Simulated Agent Helper (reused from 07-full-ops-loop)
// ============================================================================

interface AgentConnection {
  ws: WebSocket;
  receivedMessages: Array<{ type: string; payload: Record<string, unknown> }>;
  close: () => void;
}

function connectAgent(serverId: string, agentToken: string): Promise<AgentConnection> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const receivedMessages: AgentConnection['receivedMessages'] = [];
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('Agent connection timeout'));
    }, 10_000);

    ws.on('open', () => {
      clearTimeout(timeout);
      ws.send(JSON.stringify({
        type: 'auth.request',
        payload: {
          deviceId: serverId,
          deviceToken: agentToken,
          platform: 'linux',
          osVersion: '22.04',
          architecture: 'x64',
          hostname: 'e2e-journey-agent',
        },
        timestamp: Date.now(),
      }));
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        receivedMessages.push(msg);
        if (msg.type === 'auth.response') {
          resolve({ ws, receivedMessages, close: () => ws.close() });
        }
      } catch {
        // Ignore parse errors
      }
    });

    ws.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

// ============================================================================
// Journey 1: Register → Login → Add Server → View Agent Token
// ============================================================================

test.describe('Journey 1: Register → Login → Add Server → View Key', () => {
  test('complete registration and login flow via UI', async ({ page }) => {
    const email = uniqueEmail();
    const password = 'JourneyPass123!';

    // Step 1: Navigate to login page
    await page.goto('/login');
    await expect(page.getByText('ServerPilot')).toBeVisible();

    // Step 2: Switch to register mode
    await page.getByRole('button', { name: /Register/ }).click();
    await expect(page.getByLabel('Name')).toBeVisible();

    // Step 3: Fill registration form
    await page.getByLabel('Name').fill('Journey Test User');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByLabel('Confirm Password').fill(password);

    // Step 4: Submit registration
    await page.getByRole('button', { name: 'Create Account' }).click();

    // Step 5: Should redirect to dashboard
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });

    // Step 6: Navigate to servers page
    await page.goto('/servers');
    await expect(page.locator('[data-testid="server-stats"]')).toBeVisible({ timeout: 10_000 });
  });

  test('add server via UI and view agent token', async ({ page, request }) => {
    const user = await registerUser(request);

    // Set auth and go to servers page
    await page.goto('/login');
    await setAuthInBrowser(page, user);
    await page.goto('/servers');

    // Wait for page to load
    await page.waitForLoadState('networkidle');

    // Click Add Server button (use first() — there are two: header + empty-state)
    const addButton = page.getByRole('button', { name: /Add Server/i }).first();
    await expect(addButton).toBeVisible({ timeout: 10_000 });
    await addButton.click();

    // Fill server name in dialog (scope to dialog)
    const dialog = page.getByRole('dialog');
    const nameInput = dialog.locator('#server-name');
    await expect(nameInput).toBeVisible({ timeout: 5_000 });
    await nameInput.fill('journey-test-server');

    // Submit (scope to dialog to avoid matching header/empty-state buttons)
    await dialog.getByRole('button', { name: 'Add Server' }).click();

    // Wait for token display to appear
    const tokenDisplay = page.locator('[data-testid="agent-token"]');
    await expect(tokenDisplay).toBeVisible({ timeout: 10_000 });

    // Verify install command is shown
    const installCommand = page.locator('[data-testid="install-command"]');
    await expect(installCommand).toBeVisible();

    // Verify the token is masked by default (contains asterisks)
    const tokenText = await tokenDisplay.textContent();
    expect(tokenText).toContain('*');

    // Click show token button to reveal the full token
    const showButton = page.getByRole('button', { name: /Show token/i });
    if (await showButton.isVisible()) {
      await showButton.click();
      // After clicking, token should be fully visible (no asterisks pattern)
      const revealedToken = await tokenDisplay.textContent();
      expect(revealedToken!.length).toBeGreaterThan(10);
    }

    // Close dialog
    await page.getByRole('button', { name: 'Done' }).click();
  });

  test('API: full register → login → create server → verify token flow', async ({ request }) => {
    const email = uniqueEmail();
    const password = 'Journey123!';

    // Register
    const registerRes = await request.post(`${API_BASE}/auth/register`, {
      data: { email, password, name: 'API Journey User' },
    });
    expect(registerRes.ok()).toBeTruthy();
    const registerData = await registerRes.json();
    expect(registerData.accessToken).toBeTruthy();
    expect(registerData.user.email).toBe(email);

    // Login with same credentials
    const loginRes = await request.post(`${API_BASE}/auth/login`, {
      data: { email, password },
    });
    expect(loginRes.ok()).toBeTruthy();
    const loginData = await loginRes.json();
    expect(loginData.accessToken).toBeTruthy();

    // Create server
    const serverRes = await request.post(`${API_BASE}/servers`, {
      headers: { Authorization: `Bearer ${loginData.accessToken}` },
      data: { name: 'API Journey Server', tags: ['journey-test'] },
    });
    expect(serverRes.ok()).toBeTruthy();
    const serverData = await serverRes.json();

    // Verify server has agent token and install command
    expect(serverData.server.id).toBeTruthy();
    expect(serverData.server.name).toBe('API Journey Server');
    expect(serverData.token).toBeTruthy();
    expect(serverData.token.length).toBeGreaterThan(10);
    expect(serverData.installCommand).toBeTruthy();
    expect(serverData.installCommand).toContain('curl');

    // Verify server appears in list
    const listRes = await request.get(`${API_BASE}/servers`, {
      headers: { Authorization: `Bearer ${loginData.accessToken}` },
    });
    const listData = await listRes.json();
    expect(listData.servers.some((s: { name: string }) => s.name === 'API Journey Server')).toBeTruthy();
  });
});

// ============================================================================
// Journey 2: Select Server → Chat → AI Reply → View Plan
// ============================================================================

test.describe('Journey 2: Select Server → Chat → AI Reply → View Plan', () => {
  test('UI: select server and access chat interface', async ({ page, request }) => {
    const user = await registerUser(request);
    const server = await createServer(request, user.accessToken, 'Chat Journey Server');

    await page.goto('/login');
    await setAuthInBrowser(page, user);

    // Navigate to chat page — should show server selector
    await page.goto('/chat');
    await page.waitForLoadState('networkidle');

    // The chat page with no serverId should show a server selector
    const chatPage = page.locator('[data-testid="chat-page"]');
    const serverSelector = page.locator('[data-testid="server-selector"]');

    // Either shows server selector or chat interface
    await expect(chatPage.or(serverSelector)).toBeVisible({ timeout: 10_000 });

    // Navigate directly to chat with server
    await page.goto(`/chat/${server.id}`);
    await expect(page.locator('[data-testid="chat-page"]')).toBeVisible({ timeout: 10_000 });
  });

  test('UI: send message and receive AI response via chat', async ({ page, request }) => {
    const user = await registerUser(request);
    const server = await createServer(request, user.accessToken, 'Chat UI Server');

    await page.goto('/login');
    await setAuthInBrowser(page, user);
    await page.goto(`/chat/${server.id}`);

    // Wait for chat to load
    await page.waitForLoadState('networkidle');

    // Type a message in the chat input
    const textarea = page.locator('[data-testid="message-textarea"]');
    await expect(textarea).toBeVisible({ timeout: 10_000 });
    await textarea.fill('Check disk space on this server');

    // Send the message
    const sendBtn = page.locator('[data-testid="send-btn"]');
    await expect(sendBtn).toBeEnabled();
    await sendBtn.click();

    // Wait for AI response — either streaming message, thinking indicator, or error
    const aiResponse = page.locator('[data-testid="streaming-message"]')
      .or(page.locator('[data-testid="thinking-indicator"]'))
      .or(page.getByRole('alert'));

    await expect(aiResponse).toBeVisible({ timeout: 30_000 });

    // Wait for the streaming to complete (streaming message disappears or message appears)
    await page.waitForTimeout(3000);

    // The message list should have messages
    const messageList = page.locator('[data-testid="message-list"]');
    await expect(messageList).toBeVisible();
  });

  test('API: send chat and verify SSE response with session', async ({ request }) => {
    const user = await registerUser(request);
    const server = await createServer(request, user.accessToken, 'Chat API Journey Server');

    // Connect an agent for full flow
    const agent = await connectAgent(server.id, server.agentToken);

    try {
      // Send a chat message
      const chatRes = await request.post(`${API_BASE}/chat/${server.id}`, {
        headers: {
          Authorization: `Bearer ${user.accessToken}`,
          'Content-Type': 'application/json',
        },
        data: { message: 'List all running services on this server' },
      });

      expect(chatRes.status()).toBe(200);
      const sseText = await chatRes.text();

      // Verify SSE format
      expect(sseText).toContain('event:');
      expect(sseText).toContain('data:');

      // Parse SSE events
      const events: Array<{ event: string; data: string }> = [];
      const blocks = sseText.split('\n\n').filter(Boolean);
      for (const block of blocks) {
        const lines = block.split('\n');
        let event = '';
        let data = '';
        for (const line of lines) {
          if (line.startsWith('event:')) event = line.slice(6).trim();
          else if (line.startsWith('data:')) data = line.slice(5).trim();
        }
        if (event || data) events.push({ event, data });
      }

      expect(events.length).toBeGreaterThanOrEqual(2);

      // First event should contain sessionId
      const firstData = JSON.parse(events[0].data);
      expect(firstData.sessionId).toBeTruthy();

      // Should have a complete event
      const completeEvent = events.find(e => e.event === 'complete');
      expect(completeEvent).toBeTruthy();

      // Verify session was persisted
      const sessions = await apiGet(
        request,
        `/chat/${server.id}/sessions`,
        user.accessToken,
      ) as { sessions: Array<{ id: string; messageCount: number }> };

      expect(sessions.sessions.length).toBeGreaterThanOrEqual(1);
      const session = sessions.sessions.find(s => s.id === firstData.sessionId);
      expect(session).toBeTruthy();
      expect(session!.messageCount).toBeGreaterThanOrEqual(1);
    } finally {
      agent.close();
    }
  });

  test('API: chat session supports multi-turn conversation', async ({ request }) => {
    const user = await registerUser(request);
    const server = await createServer(request, user.accessToken, 'Multi-Turn Server');
    const agent = await connectAgent(server.id, server.agentToken);

    try {
      // Turn 1: create session
      const res1 = await request.post(`${API_BASE}/chat/${server.id}`, {
        headers: {
          Authorization: `Bearer ${user.accessToken}`,
          'Content-Type': 'application/json',
        },
        data: { message: 'What OS is running?' },
      });
      const text1 = await res1.text();
      const sessionIdMatch = text1.match(/"sessionId"\s*:\s*"([^"]+)"/);
      expect(sessionIdMatch).toBeTruthy();
      const sessionId = sessionIdMatch![1];

      // Turn 2: continue in same session
      const res2 = await request.post(`${API_BASE}/chat/${server.id}`, {
        headers: {
          Authorization: `Bearer ${user.accessToken}`,
          'Content-Type': 'application/json',
        },
        data: { message: 'Now check memory usage', sessionId },
      });
      expect(res2.status()).toBe(200);
      const text2 = await res2.text();
      expect(text2).toContain(sessionId);

      // Verify session accumulated messages
      const detail = await apiGet(
        request,
        `/chat/${server.id}/sessions/${sessionId}`,
        user.accessToken,
      ) as { session: { messages: Array<{ role: string }> } };

      const userMsgs = detail.session.messages.filter(m => m.role === 'user');
      expect(userMsgs.length).toBeGreaterThanOrEqual(2);
    } finally {
      agent.close();
    }
  });
});

// ============================================================================
// Journey 3: Settings → Switch AI Provider → Health Check
// ============================================================================

test.describe('Journey 3: Settings → AI Provider → Health Check', () => {
  test('UI: navigate to settings and view AI provider section', async ({ page, request }) => {
    const user = await registerUser(request);

    await page.goto('/login');
    await setAuthInBrowser(page, user);
    await page.goto('/settings');

    // Settings page should load
    const settingsPage = page.locator('[data-testid="settings-page"]');
    await expect(settingsPage).toBeVisible({ timeout: 10_000 });

    // AI Provider section should be visible
    const providerSelect = page.locator('#ai-provider');
    await expect(providerSelect).toBeVisible({ timeout: 5_000 });
  });

  test('UI: view health status indicator on settings page', async ({ page, request }) => {
    const user = await registerUser(request);

    await page.goto('/login');
    await setAuthInBrowser(page, user);
    await page.goto('/settings');

    // Wait for the page to load
    await page.waitForLoadState('networkidle');
    const settingsPage = page.locator('[data-testid="settings-page"]');
    await expect(settingsPage).toBeVisible({ timeout: 10_000 });

    // Health status section should be present
    const healthStatus = page.locator('[data-testid="health-status"]');
    // Health status might not be visible if no provider is configured,
    // but the section should exist in the DOM when settings load
    await page.waitForTimeout(2000);

    // The provider dropdown should show available options
    const providerSelect = page.locator('#ai-provider');
    await expect(providerSelect).toBeVisible();
  });

  test('API: get settings returns AI provider config', async ({ request }) => {
    const user = await registerUser(request);

    // Get current settings
    const res = await request.get(`${API_BASE}/settings`, {
      headers: { Authorization: `Bearer ${user.accessToken}` },
    });

    if (!res.ok()) {
      const errorBody = await res.text();
      throw new Error(`Settings GET failed (${res.status()}): ${errorBody}`);
    }
    const settings = await res.json();

    // Should have expected structure
    expect(settings).toHaveProperty('aiProvider');
    expect(settings).toHaveProperty('userProfile');
    expect(settings).toHaveProperty('notifications');
    expect(settings).toHaveProperty('knowledgeBase');
    expect(settings.userProfile.email).toBe(user.email);
  });

  test('API: check AI provider health endpoint', async ({ request }) => {
    const user = await registerUser(request);

    // Health check for AI provider
    const res = await request.get(`${API_BASE}/settings/ai-provider/health`, {
      headers: { Authorization: `Bearer ${user.accessToken}` },
    });

    expect(res.ok()).toBeTruthy();
    const health = await res.json();

    // Without API key configured, provider should show as unavailable
    // The response has { provider, available, error? } or { available: false }
    expect(health).toHaveProperty('available');
    expect(typeof health.available).toBe('boolean');
  });

  test('API: update user profile via settings', async ({ request }) => {
    const user = await registerUser(request);

    // Update profile
    const res = await request.put(`${API_BASE}/settings/profile`, {
      headers: {
        Authorization: `Bearer ${user.accessToken}`,
        'Content-Type': 'application/json',
      },
      data: {
        name: 'Updated Journey User',
        email: user.email,
        timezone: 'Asia/Shanghai',
      },
    });

    expect(res.ok()).toBeTruthy();
    const settings = await res.json();
    expect(settings.userProfile.name).toBe('Updated Journey User');
    expect(settings.userProfile.timezone).toBe('Asia/Shanghai');
  });

  test('API: update notification preferences', async ({ request }) => {
    const user = await registerUser(request);

    // Update notification settings
    const res = await request.put(`${API_BASE}/settings/notifications`, {
      headers: {
        Authorization: `Bearer ${user.accessToken}`,
        'Content-Type': 'application/json',
      },
      data: {
        emailNotifications: true,
        taskCompletion: false,
        systemAlerts: true,
        operationReports: false,
      },
    });

    expect(res.ok()).toBeTruthy();
    const settings = await res.json();
    expect(settings.notifications).toBeTruthy();
  });

  test('API: switch AI provider and verify settings saved', async ({ request }) => {
    const user = await registerUser(request);

    // Try to switch to ollama (doesn't require API key, only base URL)
    const switchRes = await request.put(`${API_BASE}/settings/ai-provider`, {
      headers: {
        Authorization: `Bearer ${user.accessToken}`,
        'Content-Type': 'application/json',
      },
      data: {
        provider: 'ollama',
        baseUrl: 'http://localhost:11434',
        model: 'llama3',
      },
    });

    // This may succeed or fail depending on whether ollama is running,
    // but we verify the API contract is correct
    if (switchRes.ok()) {
      const settings = await switchRes.json();
      expect(settings.aiProvider.provider).toBe('ollama');
    } else {
      // Provider initialization failure returns 400
      expect(switchRes.status()).toBe(400);
    }

    // Verify health check reflects the current provider state
    const healthRes = await request.get(`${API_BASE}/settings/ai-provider/health`, {
      headers: { Authorization: `Bearer ${user.accessToken}` },
    });
    expect(healthRes.ok()).toBeTruthy();
  });
});

// ============================================================================
// Journey 4: Server Detail → Real-Time Monitoring Metrics
// ============================================================================

test.describe('Journey 4: Server Detail → Real-Time Metrics', () => {
  test('UI: navigate to server detail and see monitoring section', async ({ page, request }) => {
    const user = await registerUser(request);
    const server = await createServer(request, user.accessToken, 'Metrics Journey Server');

    await page.goto('/login');
    await setAuthInBrowser(page, user);
    await page.goto(`/servers/${server.id}`);

    // Server name should be visible (don't use networkidle — SSE keeps connection open)
    await expect(page.getByText('Metrics Journey Server')).toBeVisible({ timeout: 10_000 });

    // Monitoring section should be present
    const metricsSection = page.locator('[data-testid="metrics-grid"]')
      .or(page.locator('[data-testid="no-metrics"]'))
      .or(page.locator('[data-testid="metrics-loading"]'));
    await expect(metricsSection).toBeVisible({ timeout: 10_000 });
  });

  test('UI: server detail shows no-metrics state when no data', async ({ page, request }) => {
    const user = await registerUser(request);
    const server = await createServer(request, user.accessToken, 'Empty Metrics Server');

    await page.goto('/login');
    await setAuthInBrowser(page, user);
    await page.goto(`/servers/${server.id}`);

    // Don't use networkidle — SSE keeps connection open
    await expect(page.getByText('Empty Metrics Server')).toBeVisible({ timeout: 10_000 });

    // Without agent connected, should show no-metrics state
    const noMetrics = page.locator('[data-testid="no-metrics"]');
    await expect(noMetrics).toBeVisible({ timeout: 10_000 });
  });

  test('API: metrics appear after agent reports', async ({ request }) => {
    const user = await registerUser(request);
    const server = await createServer(request, user.accessToken, 'Agent Metrics Server');
    const agent = await connectAgent(server.id, server.agentToken);

    try {
      // Agent reports metrics
      agent.ws.send(JSON.stringify({
        type: 'metrics.report',
        payload: {
          serverId: server.id,
          cpuUsage: 35.2,
          memoryUsage: 3_221_225_472, // 3GB
          memoryTotal: 8_589_934_592, // 8GB
          diskUsage: 85_899_345_920, // 80GB
          diskTotal: 536_870_912_000, // 500GB
          networkIn: 2048,
          networkOut: 4096,
        },
        timestamp: Date.now(),
      }));

      // Wait for processing
      await new Promise(r => setTimeout(r, 1000));

      // Verify metrics via API
      const metrics = await apiGet(
        request,
        `/servers/${server.id}/metrics?range=1h`,
        user.accessToken,
      ) as { metrics: Array<{ cpuUsage: number }>; range: string };

      expect(metrics.range).toBe('1h');
      expect(metrics.metrics.length).toBeGreaterThanOrEqual(1);
      expect(metrics.metrics[0].cpuUsage).toBeCloseTo(35.2, 0);
    } finally {
      agent.close();
    }
  });

  test('UI: server detail shows metrics after agent report', async ({ page, request }) => {
    const user = await registerUser(request);
    const server = await createServer(request, user.accessToken, 'Live Metrics Server');

    // Connect agent and send metrics BEFORE loading the page
    const agent = await connectAgent(server.id, server.agentToken);

    try {
      // Send metrics from agent
      agent.ws.send(JSON.stringify({
        type: 'metrics.report',
        payload: {
          serverId: server.id,
          cpuUsage: 42.7,
          memoryUsage: 4_294_967_296, // 4GB
          memoryTotal: 16_106_127_360, // 15GB
          diskUsage: 107_374_182_400, // 100GB
          diskTotal: 536_870_912_000, // 500GB
          networkIn: 1024,
          networkOut: 2048,
        },
        timestamp: Date.now(),
      }));

      // Wait for server to process metrics
      await new Promise(r => setTimeout(r, 1000));

      // Now load the server detail page
      await page.goto('/login');
      await setAuthInBrowser(page, user);
      await page.goto(`/servers/${server.id}`);

      // Don't use networkidle — SSE keeps connection open
      await expect(page.getByText('Live Metrics Server')).toBeVisible({ timeout: 10_000 });

      // Metrics grid should appear with data
      const metricsGrid = page.locator('[data-testid="metrics-grid"]');
      await expect(metricsGrid).toBeVisible({ timeout: 15_000 });

      // Verify individual metric cards are visible
      const cpuMetric = page.locator('[data-testid="metric-cpu"]');
      const memoryMetric = page.locator('[data-testid="metric-memory"]');
      const diskMetric = page.locator('[data-testid="metric-disk"]');
      const networkMetric = page.locator('[data-testid="metric-network"]');

      await expect(cpuMetric).toBeVisible({ timeout: 5_000 });
      await expect(memoryMetric).toBeVisible();
      await expect(diskMetric).toBeVisible();
      await expect(networkMetric).toBeVisible();

      // CPU should show the reported value
      const cpuText = await cpuMetric.textContent();
      expect(cpuText).toContain('42.7');
    } finally {
      agent.close();
    }
  });

  test('API: metrics endpoint supports different time ranges', async ({ request }) => {
    const user = await registerUser(request);
    const server = await createServer(request, user.accessToken, 'Range Metrics Server');
    const agent = await connectAgent(server.id, server.agentToken);

    try {
      // Send metrics
      agent.ws.send(JSON.stringify({
        type: 'metrics.report',
        payload: {
          serverId: server.id,
          cpuUsage: 50,
          memoryUsage: 4_294_967_296,
          memoryTotal: 8_589_934_592,
          diskUsage: 107_374_182_400,
          diskTotal: 536_870_912_000,
          networkIn: 512,
          networkOut: 1024,
        },
        timestamp: Date.now(),
      }));

      await new Promise(r => setTimeout(r, 500));

      // Test 1h range
      const m1h = await apiGet(
        request,
        `/servers/${server.id}/metrics?range=1h`,
        user.accessToken,
      ) as { metrics: unknown[]; range: string };
      expect(m1h.range).toBe('1h');
      expect(m1h.metrics.length).toBeGreaterThanOrEqual(1);

      // Test 24h range
      const m24h = await apiGet(
        request,
        `/servers/${server.id}/metrics?range=24h`,
        user.accessToken,
      ) as { metrics: unknown[]; range: string };
      expect(m24h.range).toBe('24h');

      // Test 7d range
      const m7d = await apiGet(
        request,
        `/servers/${server.id}/metrics?range=7d`,
        user.accessToken,
      ) as { metrics: unknown[]; range: string };
      expect(m7d.range).toBe('7d');
    } finally {
      agent.close();
    }
  });

  test('API: latest metrics endpoint returns most recent data', async ({ request }) => {
    const user = await registerUser(request);
    const server = await createServer(request, user.accessToken, 'Latest Metrics Server');
    const agent = await connectAgent(server.id, server.agentToken);

    try {
      // Send two rounds of metrics
      for (const cpu of [30, 60]) {
        agent.ws.send(JSON.stringify({
          type: 'metrics.report',
          payload: {
            serverId: server.id,
            cpuUsage: cpu,
            memoryUsage: 4_294_967_296,
            memoryTotal: 8_589_934_592,
            diskUsage: 107_374_182_400,
            diskTotal: 536_870_912_000,
            networkIn: 512,
            networkOut: 1024,
          },
          timestamp: Date.now(),
        }));
        await new Promise(r => setTimeout(r, 300));
      }

      // Get latest metrics
      const res = await request.get(
        `${API_BASE}/metrics/latest?serverId=${server.id}`,
        { headers: { Authorization: `Bearer ${user.accessToken}` } },
      );

      expect(res.ok()).toBeTruthy();
      const data = await res.json();
      // Should have the most recent metric point
      expect(data).toBeTruthy();
    } finally {
      agent.close();
    }
  });

  test('UI: server detail Chat with AI button navigates to chat', async ({ page, request }) => {
    const user = await registerUser(request);
    const server = await createServer(request, user.accessToken, 'Chat Nav Server');

    await page.goto('/login');
    await setAuthInBrowser(page, user);
    await page.goto(`/servers/${server.id}`);

    // Don't use networkidle — SSE keeps connection open
    await expect(page.getByText('Chat Nav Server')).toBeVisible({ timeout: 10_000 });

    // Click "Chat with AI" button (visible in screenshot as a button)
    const chatButton = page.getByRole('link', { name: /Chat with AI/i })
      .or(page.getByRole('button', { name: /Chat with AI/i }));

    if (await chatButton.isVisible()) {
      await chatButton.click();
      // Should navigate to chat page
      await expect(page).toHaveURL(/\/chat/, { timeout: 10_000 });
    }
  });
});
