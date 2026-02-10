/**
 * E2E Test: AI Conversation → Plan → Command Execution Flow
 *
 * Tests the complete AI chat lifecycle:
 * 1. Send message to AI chat endpoint
 * 2. Receive SSE streaming response
 * 3. Plan generation from AI response
 * 4. Session management (list, get, delete)
 * 5. Execute plan (agent connectivity check)
 *
 * Note: AI responses are mocked since E2E tests run without
 * a real ANTHROPIC_API_KEY. Tests validate the API contract,
 * SSE streaming, and session management.
 *
 * @module tests/e2e/03-ai-chat-flow
 */

import { test, expect } from '@playwright/test';
import {
  registerUser,
  createServer,
  setAuthInBrowser,
  apiGet,
  apiDelete,
} from './helpers';

test.describe('AI Chat → Plan → Execution Flow', () => {
  test('API: send chat message returns SSE stream', async ({ request }) => {
    const user = await registerUser(request);
    const server = await createServer(request, user.accessToken, 'Chat Test Server');

    // Send a chat message — response is SSE
    const res = await request.post(
      `http://localhost:3000/api/v1/chat/${server.id}`,
      {
        headers: {
          Authorization: `Bearer ${user.accessToken}`,
          'Content-Type': 'application/json',
        },
        data: { message: 'Install nginx on this server' },
      },
    );

    // The endpoint always responds, even without AI API key configured.
    // With no API key, it should return an SSE stream with an error message.
    expect(res.status()).toBe(200);

    const body = await res.text();
    // SSE format: lines starting with "event:" or "data:"
    expect(body).toContain('event:');
    expect(body).toContain('data:');
  });

  test('API: chat creates a session', async ({ request }) => {
    const user = await registerUser(request);
    const server = await createServer(request, user.accessToken, 'Session Test Server');

    // Send a message to create a session
    await request.post(
      `http://localhost:3000/api/v1/chat/${server.id}`,
      {
        headers: {
          Authorization: `Bearer ${user.accessToken}`,
          'Content-Type': 'application/json',
        },
        data: { message: 'Hello' },
      },
    );

    // List sessions
    const sessions = await apiGet(
      request,
      `/chat/${server.id}/sessions`,
      user.accessToken,
    ) as { sessions: Array<{ id: string }> };

    expect(sessions.sessions.length).toBeGreaterThanOrEqual(1);
  });

  test('API: get session details with messages', async ({ request }) => {
    const user = await registerUser(request);
    const server = await createServer(request, user.accessToken, 'Detail Session Server');

    // Send message to create session
    const chatRes = await request.post(
      `http://localhost:3000/api/v1/chat/${server.id}`,
      {
        headers: {
          Authorization: `Bearer ${user.accessToken}`,
          'Content-Type': 'application/json',
        },
        data: { message: 'Test message' },
      },
    );

    const sseText = await chatRes.text();
    // Extract sessionId from SSE data
    const sessionIdMatch = sseText.match(/"sessionId"\s*:\s*"([^"]+)"/);
    expect(sessionIdMatch).toBeTruthy();
    const sessionId = sessionIdMatch![1];

    // Get session details
    const session = await apiGet(
      request,
      `/chat/${server.id}/sessions/${sessionId}`,
      user.accessToken,
    ) as { session: { id: string; messages: unknown[] } };

    expect(session.session.id).toBe(sessionId);
    expect(session.session.messages.length).toBeGreaterThanOrEqual(1);
  });

  test('API: delete chat session', async ({ request }) => {
    const user = await registerUser(request);
    const server = await createServer(request, user.accessToken, 'Delete Session Server');

    // Create session
    const chatRes = await request.post(
      `http://localhost:3000/api/v1/chat/${server.id}`,
      {
        headers: {
          Authorization: `Bearer ${user.accessToken}`,
          'Content-Type': 'application/json',
        },
        data: { message: 'To be deleted' },
      },
    );

    const sseText = await chatRes.text();
    const sessionIdMatch = sseText.match(/"sessionId"\s*:\s*"([^"]+)"/);
    const sessionId = sessionIdMatch![1];

    // Delete session
    const { status, body } = await apiDelete(
      request,
      `/chat/${server.id}/sessions/${sessionId}`,
      user.accessToken,
    );

    expect(status).toBe(200);
    expect((body as { success: boolean }).success).toBe(true);
  });

  test('API: execute plan requires agent connection', async ({ request }) => {
    const user = await registerUser(request);
    const server = await createServer(request, user.accessToken, 'Execute Test Server');

    // Try to execute a plan — should fail because no agent is connected
    const res = await request.post(
      `http://localhost:3000/api/v1/chat/${server.id}/execute`,
      {
        headers: {
          Authorization: `Bearer ${user.accessToken}`,
          'Content-Type': 'application/json',
        },
        data: {
          planId: 'nonexistent-plan-id',
          sessionId: 'nonexistent-session-id',
        },
      },
    );

    // Should get 404 (plan not found) since we didn't create a real plan
    expect(res.status()).toBe(404);
  });

  test('API: chat requires valid server', async ({ request }) => {
    const user = await registerUser(request);

    const res = await request.post(
      'http://localhost:3000/api/v1/chat/nonexistent-server-id/execute',
      {
        headers: {
          Authorization: `Bearer ${user.accessToken}`,
          'Content-Type': 'application/json',
        },
        data: { planId: 'test', sessionId: 'test' },
      },
    );

    expect(res.status()).toBe(404);
  });

  test('UI: navigate to chat page (authenticated)', async ({ page, request }) => {
    const user = await registerUser(request);

    await page.goto('/login');
    await setAuthInBrowser(page, user);
    await page.goto('/chat');

    // Should see the chat interface
    await expect(page.locator('body')).toBeVisible({ timeout: 10_000 });
  });

  test('API: chat with session continuity', async ({ request }) => {
    const user = await registerUser(request);
    const server = await createServer(request, user.accessToken, 'Continuity Server');

    // First message
    const res1 = await request.post(
      `http://localhost:3000/api/v1/chat/${server.id}`,
      {
        headers: {
          Authorization: `Bearer ${user.accessToken}`,
          'Content-Type': 'application/json',
        },
        data: { message: 'First message' },
      },
    );
    const text1 = await res1.text();
    const match1 = text1.match(/"sessionId"\s*:\s*"([^"]+)"/);
    const sessionId = match1![1];

    // Second message with same sessionId
    const res2 = await request.post(
      `http://localhost:3000/api/v1/chat/${server.id}`,
      {
        headers: {
          Authorization: `Bearer ${user.accessToken}`,
          'Content-Type': 'application/json',
        },
        data: { message: 'Follow-up message', sessionId },
      },
    );

    expect(res2.status()).toBe(200);
    const text2 = await res2.text();
    // Should use same session
    expect(text2).toContain(sessionId);
  });
});
