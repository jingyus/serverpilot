/**
 * E2E Test: Complete Installation Flow
 *
 * Tests the full end-to-end installation workflow:
 * 1. Client connects to server via WebSocket
 * 2. Client creates a session
 * 3. Server acknowledges with empty plan
 * 4. Client reports environment
 * 5. Server generates fallback install plan
 * 6. Client sends step execution results
 * 7. Server tracks step completion and session state
 * 8. Client sends session complete
 *
 * All tests use real WebSocket connections (no mocks).
 * Authentication is disabled (requireAuth: false) to focus on installation flow.
 */

import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { createMessage, MessageType } from '@aiinstaller/shared';
import { InstallServer } from '../packages/server/src/api/server.js';
import { routeMessage } from '../packages/server/src/api/handlers.js';
import { InstallClient, ConnectionState } from '../packages/agent/src/client.js';

// ============================================================================
// Helpers
// ============================================================================

let testPort = 19600;
function nextPort() {
  return testPort++;
}

function waitFor(
  condition: () => boolean,
  timeoutMs = 3000,
  intervalMs = 50,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (condition()) {
        resolve();
        return;
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error('waitFor timed out'));
        return;
      }
      setTimeout(check, intervalMs);
    };
    check();
  });
}

function connectRawClient(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

function waitForMessage(ws: WebSocket, timeoutMs = 3000): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('waitForMessage timed out')),
      timeoutMs,
    );
    ws.once('message', (data) => {
      clearTimeout(timer);
      resolve(data.toString());
    });
  });
}

function collectMessages(ws: WebSocket, count: number, timeoutMs = 5000): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const messages: string[] = [];
    const timer = setTimeout(
      () => reject(new Error(`collectMessages timed out, received ${messages.length}/${count}`)),
      timeoutMs,
    );
    const handler = (data: WebSocket.RawData) => {
      messages.push(data.toString());
      if (messages.length >= count) {
        clearTimeout(timer);
        ws.off('message', handler);
        resolve(messages);
      }
    };
    ws.on('message', handler);
  });
}

function makeEnvInfo() {
  return {
    os: { platform: 'darwin' as const, version: '14.0', arch: 'arm64' },
    shell: { type: 'zsh' as const, version: '5.9' },
    runtime: { node: '22.0.0', python: '3.12.0' },
    packageManagers: { npm: '10.0.0', pnpm: '9.0.0' },
    network: { canAccessNpm: true, canAccessGithub: true },
    permissions: { hasSudo: true, canWriteTo: ['/usr/local'] },
  };
}

function makeInstallPlan() {
  return {
    steps: [
      {
        id: 'check-node',
        description: 'Check Node.js version',
        command: 'node --version',
        expectedOutput: 'v22',
        timeout: 10000,
        canRollback: false,
        onError: 'retry' as const,
      },
      {
        id: 'install-pnpm',
        description: 'Install pnpm',
        command: 'npm install -g pnpm',
        timeout: 60000,
        canRollback: true,
        onError: 'retry' as const,
      },
      {
        id: 'install-openclaw',
        description: 'Install OpenClaw',
        command: 'pnpm install -g openclaw',
        timeout: 120000,
        canRollback: true,
        onError: 'fallback' as const,
      },
    ],
    estimatedTime: 180000,
    risks: [{ level: 'low' as const, description: 'Global package install' }],
  };
}

/** Create a server with auth disabled for testing */
function createTestServer(port: number) {
  return new InstallServer({
    port,
    heartbeatIntervalMs: 60000,
    requireAuth: false,
  });
}

// ============================================================================
// Tests
// ============================================================================

describe('E2E: Complete Installation Flow', () => {
  let server: InstallServer | null = null;
  let rawClients: WebSocket[] = [];
  let installClients: InstallClient[] = [];

  afterEach(async () => {
    // Clean up clients
    for (const c of installClients) {
      c.disconnect();
    }
    installClients = [];

    for (const ws of rawClients) {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
    }
    rawClients = [];

    // Clean up server
    if (server?.isRunning()) {
      await server.stop();
    }
    server = null;
  });

  // --------------------------------------------------------------------------
  // Happy path: Full installation flow with raw WebSocket
  // --------------------------------------------------------------------------

  it('should complete a full session lifecycle with raw WebSocket client', async () => {
    const port = nextPort();
    server = createTestServer(port);

    server.on('message', (clientId, msg) => {
      routeMessage(server!, clientId, msg);
    });

    await server.start();

    // Step 1: Client connects
    const ws = await connectRawClient(port);
    rawClients.push(ws);

    await waitFor(() => server!.getClientCount() === 1);
    expect(server.getClientCount()).toBe(1);

    // Step 2: Client sends SESSION_CREATE
    const sessionCreateMsg = createMessage(MessageType.SESSION_CREATE, {
      software: 'openclaw',
      version: '1.0.0',
    });
    const responsePromise = waitForMessage(ws);
    ws.send(JSON.stringify(sessionCreateMsg));

    // Step 3: Server responds with empty PLAN_RECEIVE
    const responseStr = await responsePromise;
    const response = JSON.parse(responseStr);
    expect(response.type).toBe(MessageType.PLAN_RECEIVE);
    expect(response.payload.steps).toEqual([]);
    expect(response.payload.estimatedTime).toBe(0);

    // Verify session was created
    expect(server.getSessionCount()).toBe(1);

    // Step 4: Client sends ENV_REPORT → server generates fallback plan
    // Without an AI agent, the handler sends AI_STREAM_ERROR first, then PLAN_RECEIVE
    const envMsg = createMessage(MessageType.ENV_REPORT, makeEnvInfo());
    const envResponses = collectMessages(ws, 2);
    ws.send(JSON.stringify(envMsg));

    // Step 5: Server responds with AI error notification + fallback install plan
    const envMsgs = await envResponses;
    const errorNotification = JSON.parse(envMsgs[0]);
    expect(errorNotification.type).toBe(MessageType.AI_STREAM_ERROR);

    const planResponse = JSON.parse(envMsgs[1]);
    expect(planResponse.type).toBe(MessageType.PLAN_RECEIVE);
    expect(planResponse.payload.steps.length).toBeGreaterThanOrEqual(2);

    // Step 6: Client sends successful STEP_COMPLETE for each step
    const plan = makeInstallPlan();
    for (const step of plan.steps) {
      const stepCompleteMsg = createMessage(MessageType.STEP_COMPLETE, {
        stepId: step.id,
        success: true,
        exitCode: 0,
        stdout: `${step.command} completed successfully`,
        stderr: '',
        duration: 1000,
      });
      ws.send(JSON.stringify(stepCompleteMsg));
      await new Promise((r) => setTimeout(r, 50));
    }

    // Step 7: Client sends SESSION_COMPLETE
    const sessionCompleteMsg = createMessage(MessageType.SESSION_COMPLETE, {
      success: true,
      summary: 'OpenClaw installed successfully',
    });
    ws.send(JSON.stringify(sessionCompleteMsg));

    await new Promise((r) => setTimeout(r, 100));

    // Verify final state
    expect(server.getSessionCount()).toBe(1);
    expect(server.getClientCount()).toBe(1);

    ws.close();
    await waitFor(() => server!.getClientCount() === 0);
  });

  // --------------------------------------------------------------------------
  // Happy path: Full installation flow with InstallClient
  // --------------------------------------------------------------------------

  it('should complete a full session lifecycle with InstallClient', async () => {
    const port = nextPort();
    server = createTestServer(port);

    server.on('message', (clientId, msg) => {
      routeMessage(server!, clientId, msg);
    });

    await server.start();

    // Step 1: Connect using InstallClient
    const client = new InstallClient({
      serverUrl: `ws://127.0.0.1:${port}`,
      autoReconnect: false,
      connectionTimeoutMs: 5000,
    });
    installClients.push(client);

    await client.connect();
    expect(client.state).toBe(ConnectionState.CONNECTED);

    // Step 2: Send session.create and wait for plan.receive
    const sessionCreateMsg = createMessage(MessageType.SESSION_CREATE, {
      software: 'openclaw',
    });
    const planResponse = await client.sendAndWait(
      sessionCreateMsg,
      MessageType.PLAN_RECEIVE,
      5000,
    );

    expect(planResponse.type).toBe(MessageType.PLAN_RECEIVE);
    expect(planResponse.payload.steps).toEqual([]);

    // Step 3: Send environment report and get fallback plan
    const envMsg = createMessage(MessageType.ENV_REPORT, makeEnvInfo());
    const fallbackPlan = await client.sendAndWait(envMsg, MessageType.PLAN_RECEIVE, 5000);
    expect(fallbackPlan.type).toBe(MessageType.PLAN_RECEIVE);
    expect(fallbackPlan.payload.steps.length).toBeGreaterThanOrEqual(2);

    // Step 4: Simulate step execution results
    const stepCompleteMsg = createMessage(MessageType.STEP_COMPLETE, {
      stepId: 'check-node',
      success: true,
      exitCode: 0,
      stdout: 'v22.0.0',
      stderr: '',
      duration: 500,
    });
    client.send(stepCompleteMsg);

    await new Promise((r) => setTimeout(r, 100));

    // Step 5: Send session complete
    const sessionCompleteMsg = createMessage(MessageType.SESSION_COMPLETE, {
      success: true,
      summary: 'Installation complete',
    });
    client.send(sessionCompleteMsg);

    await new Promise((r) => setTimeout(r, 100));

    // Verify
    expect(client.state).toBe(ConnectionState.CONNECTED);
    client.disconnect();
    expect(client.state).toBe(ConnectionState.DISCONNECTED);
  });

  // --------------------------------------------------------------------------
  // Session state transitions
  // --------------------------------------------------------------------------

  it('should track session state transitions correctly', async () => {
    const port = nextPort();
    server = createTestServer(port);

    const stateChanges: string[] = [];
    server.on('message', (clientId, msg) => {
      const sessionId = server!.getClientSessionId(clientId);
      if (sessionId) {
        const beforeSession = server!.getSession(sessionId);
        if (beforeSession) stateChanges.push(`before:${beforeSession.status}`);
      }
      routeMessage(server!, clientId, msg);
      const sessionIdAfter = server!.getClientSessionId(clientId);
      if (sessionIdAfter) {
        const afterSession = server!.getSession(sessionIdAfter);
        if (afterSession) stateChanges.push(`after:${afterSession.status}`);
      }
    });

    await server.start();

    const ws = await connectRawClient(port);
    rawClients.push(ws);
    await waitFor(() => server!.getClientCount() === 1);

    // Create session → status: created
    const createMsg = createMessage(MessageType.SESSION_CREATE, { software: 'openclaw' });
    const ackPromise = waitForMessage(ws);
    ws.send(JSON.stringify(createMsg));
    await ackPromise;

    // Env report → status: detecting → planning (via handleEnvReport)
    const envMsg = createMessage(MessageType.ENV_REPORT, makeEnvInfo());
    // handleEnvReport sends back a plan.receive message
    const planPromise = waitForMessage(ws);
    ws.send(JSON.stringify(envMsg));
    await planPromise;

    // Step complete (success) → status: executing
    const stepOk = createMessage(MessageType.STEP_COMPLETE, {
      stepId: 'check-node',
      success: true,
      exitCode: 0,
      stdout: 'v22.0.0',
      stderr: '',
      duration: 500,
    });
    ws.send(JSON.stringify(stepOk));
    await new Promise((r) => setTimeout(r, 100));

    // Step complete (failure) → status: error
    const stepFail = createMessage(MessageType.STEP_COMPLETE, {
      stepId: 'install-pnpm',
      success: false,
      exitCode: 1,
      stdout: '',
      stderr: 'EACCES permission denied',
      duration: 2000,
    });
    ws.send(JSON.stringify(stepFail));
    await new Promise((r) => setTimeout(r, 100));

    // Verify state transitions occurred
    expect(stateChanges).toContain('after:created');
    expect(stateChanges).toContain('after:planning');
    expect(stateChanges).toContain('after:executing');
    expect(stateChanges).toContain('after:error');

    ws.close();
  });

  // --------------------------------------------------------------------------
  // Multi-step execution with output streaming
  // --------------------------------------------------------------------------

  it('should handle multi-step execution with output streaming', async () => {
    const port = nextPort();
    server = createTestServer(port);

    const receivedMessages: { clientId: string; type: string }[] = [];
    server.on('message', (clientId, msg) => {
      receivedMessages.push({ clientId, type: msg.type });
      routeMessage(server!, clientId, msg);
    });

    await server.start();

    const ws = await connectRawClient(port);
    rawClients.push(ws);
    await waitFor(() => server!.getClientCount() === 1);

    // Create session
    const createMsg = createMessage(MessageType.SESSION_CREATE, { software: 'openclaw' });
    const ackPromise = waitForMessage(ws);
    ws.send(JSON.stringify(createMsg));
    await ackPromise;

    // Send env report and wait for plan response
    const envMsg = createMessage(MessageType.ENV_REPORT, makeEnvInfo());
    const planPromise = waitForMessage(ws);
    ws.send(JSON.stringify(envMsg));
    await planPromise;

    // Simulate executing 3 steps with output streaming
    const plan = makeInstallPlan();
    for (const step of plan.steps) {
      // Send step output (streaming)
      const outputMsg = createMessage(MessageType.STEP_OUTPUT, {
        stepId: step.id,
        output: `Executing: ${step.command}\n`,
      });
      ws.send(JSON.stringify(outputMsg));
      await new Promise((r) => setTimeout(r, 30));

      // Send more output
      const outputMsg2 = createMessage(MessageType.STEP_OUTPUT, {
        stepId: step.id,
        output: 'Done.\n',
      });
      ws.send(JSON.stringify(outputMsg2));
      await new Promise((r) => setTimeout(r, 30));

      // Send step complete
      const completeMsg = createMessage(MessageType.STEP_COMPLETE, {
        stepId: step.id,
        success: true,
        exitCode: 0,
        stdout: `Executing: ${step.command}\nDone.\n`,
        stderr: '',
        duration: 1000,
      });
      ws.send(JSON.stringify(completeMsg));
      await new Promise((r) => setTimeout(r, 30));
    }

    // Verify all messages were received
    await new Promise((r) => setTimeout(r, 200));

    const messageTypes = receivedMessages.map((m) => m.type);
    expect(messageTypes).toContain(MessageType.SESSION_CREATE);
    expect(messageTypes).toContain(MessageType.ENV_REPORT);
    expect(messageTypes.filter((t) => t === MessageType.STEP_OUTPUT).length).toBe(6);
    expect(messageTypes.filter((t) => t === MessageType.STEP_COMPLETE).length).toBe(3);

    ws.close();
  });

  // --------------------------------------------------------------------------
  // Multiple concurrent clients
  // --------------------------------------------------------------------------

  it('should handle multiple concurrent client sessions', async () => {
    const port = nextPort();
    server = createTestServer(port);

    server.on('message', (clientId, msg) => {
      routeMessage(server!, clientId, msg);
    });

    await server.start();

    // Connect 3 clients simultaneously
    const ws1 = await connectRawClient(port);
    const ws2 = await connectRawClient(port);
    const ws3 = await connectRawClient(port);
    rawClients.push(ws1, ws2, ws3);

    await waitFor(() => server!.getClientCount() === 3);

    // Each client creates a session
    const clients = [ws1, ws2, ws3];
    const responses: string[] = [];

    for (const ws of clients) {
      const msg = createMessage(MessageType.SESSION_CREATE, {
        software: 'openclaw',
      });
      const resPromise = waitForMessage(ws);
      ws.send(JSON.stringify(msg));
      const res = await resPromise;
      responses.push(res);
    }

    // All should get plan.receive responses
    expect(responses.length).toBe(3);
    for (const res of responses) {
      const parsed = JSON.parse(res);
      expect(parsed.type).toBe(MessageType.PLAN_RECEIVE);
    }

    // All sessions created
    expect(server.getSessionCount()).toBe(3);

    // Close all
    for (const ws of clients) {
      ws.close();
    }
    await waitFor(() => server!.getClientCount() === 0);
  });

  // --------------------------------------------------------------------------
  // Server sends plan to client after env report
  // --------------------------------------------------------------------------

  it('should allow server to send install plan to client', async () => {
    const port = nextPort();
    server = createTestServer(port);

    server.on('message', (clientId, msg) => {
      routeMessage(server!, clientId, msg);
    });

    await server.start();

    const client = new InstallClient({
      serverUrl: `ws://127.0.0.1:${port}`,
      autoReconnect: false,
    });
    installClients.push(client);

    await client.connect();

    // Create session
    const sessionCreateMsg = createMessage(MessageType.SESSION_CREATE, { software: 'openclaw' });
    const emptyPlan = await client.sendAndWait(sessionCreateMsg, MessageType.PLAN_RECEIVE, 5000);
    expect(emptyPlan.payload.steps).toEqual([]);

    // Send env report and wait for the fallback plan
    const envMsg = createMessage(MessageType.ENV_REPORT, makeEnvInfo());
    const plan = await client.sendAndWait(envMsg, MessageType.PLAN_RECEIVE, 5000);

    expect(plan.type).toBe(MessageType.PLAN_RECEIVE);
    expect(plan.payload.steps.length).toBeGreaterThanOrEqual(2);
    expect(plan.payload.steps[0].id).toBe('check-node');
    expect(plan.payload.estimatedTime).toBeGreaterThan(0);
    expect(plan.payload.risks).toBeDefined();

    client.disconnect();
  });

  // --------------------------------------------------------------------------
  // Server instructs client to execute steps
  // --------------------------------------------------------------------------

  it('should handle server-driven step execution flow', async () => {
    const port = nextPort();
    server = createTestServer(port);

    const plan = makeInstallPlan();
    let stepIndex = 0;

    server.on('message', (clientId, msg) => {
      routeMessage(server!, clientId, msg);

      if (msg.type === MessageType.ENV_REPORT) {
        // After env report is processed, send first step to execute
        // Use setTimeout to ensure handleEnvReport finishes first
        setTimeout(() => {
          const stepMsg = createMessage(MessageType.STEP_EXECUTE, plan.steps[0]);
          server!.send(clientId, stepMsg);
        }, 50);
      }

      if (msg.type === MessageType.STEP_COMPLETE && msg.payload.success) {
        stepIndex++;
        if (stepIndex < plan.steps.length) {
          // Send next step
          const stepMsg = createMessage(MessageType.STEP_EXECUTE, plan.steps[stepIndex]);
          server!.send(clientId, stepMsg);
        } else {
          // All steps done, send session complete
          const completeMsg = createMessage(MessageType.SESSION_COMPLETE, {
            success: true,
            summary: 'All steps completed',
          });
          server!.send(clientId, completeMsg);
        }
      }
    });

    await server.start();

    const client = new InstallClient({
      serverUrl: `ws://127.0.0.1:${port}`,
      autoReconnect: false,
    });
    installClients.push(client);

    await client.connect();

    // Create session
    const createMsg = createMessage(MessageType.SESSION_CREATE, { software: 'openclaw' });
    await client.sendAndWait(createMsg, MessageType.PLAN_RECEIVE, 5000);

    // Send env report and wait for first step execute
    // The handler sends PLAN_RECEIVE (from handleEnvReport) and then STEP_EXECUTE
    const envMsg = createMessage(MessageType.ENV_REPORT, makeEnvInfo());
    client.send(envMsg);
    const step1 = await client.waitFor(MessageType.STEP_EXECUTE, 5000);
    expect(step1.payload.id).toBe('check-node');

    // Complete step 1, wait for step 2
    const step1Complete = createMessage(MessageType.STEP_COMPLETE, {
      stepId: 'check-node',
      success: true,
      exitCode: 0,
      stdout: 'v22.0.0',
      stderr: '',
      duration: 500,
    });
    const step2 = await client.sendAndWait(step1Complete, MessageType.STEP_EXECUTE, 5000);
    expect(step2.payload.id).toBe('install-pnpm');

    // Complete step 2, wait for step 3
    const step2Complete = createMessage(MessageType.STEP_COMPLETE, {
      stepId: 'install-pnpm',
      success: true,
      exitCode: 0,
      stdout: 'installed',
      stderr: '',
      duration: 5000,
    });
    const step3 = await client.sendAndWait(step2Complete, MessageType.STEP_EXECUTE, 5000);
    expect(step3.payload.id).toBe('install-openclaw');

    // Complete step 3, wait for session complete
    const step3Complete = createMessage(MessageType.STEP_COMPLETE, {
      stepId: 'install-openclaw',
      success: true,
      exitCode: 0,
      stdout: 'openclaw installed',
      stderr: '',
      duration: 10000,
    });
    const sessionComplete = await client.sendAndWait(
      step3Complete,
      MessageType.SESSION_COMPLETE,
      5000,
    );
    expect(sessionComplete.payload.success).toBe(true);
    expect(sessionComplete.payload.summary).toBe('All steps completed');

    client.disconnect();
  });

  // --------------------------------------------------------------------------
  // Message validation in E2E flow
  // --------------------------------------------------------------------------

  it('should validate all messages in the flow conform to protocol schema', async () => {
    const port = nextPort();
    server = createTestServer(port);

    const validatedMessages: { type: string; valid: boolean }[] = [];

    server.on('message', (clientId, msg) => {
      validatedMessages.push({ type: msg.type, valid: true });
      routeMessage(server!, clientId, msg);
    });

    server.on('error', (_clientId, _error) => {
      validatedMessages.push({ type: 'invalid', valid: false });
    });

    await server.start();

    const ws = await connectRawClient(port);
    rawClients.push(ws);
    await waitFor(() => server!.getClientCount() === 1);

    // Send all types of client messages
    const messages = [
      createMessage(MessageType.SESSION_CREATE, { software: 'openclaw' }),
      createMessage(MessageType.ENV_REPORT, makeEnvInfo()),
      createMessage(MessageType.STEP_OUTPUT, { stepId: 's1', output: 'test output' }),
      createMessage(MessageType.STEP_COMPLETE, {
        stepId: 's1', success: true, exitCode: 0,
        stdout: 'ok', stderr: '', duration: 100,
      }),
      createMessage(MessageType.SESSION_COMPLETE, { success: true, summary: 'done' }),
    ];

    // Collect server response (session.create triggers plan.receive,
    // env.report triggers another plan.receive)
    const responsePromise = waitForMessage(ws);

    for (const msg of messages) {
      ws.send(JSON.stringify(msg));
      await new Promise((r) => setTimeout(r, 50));
    }

    // Wait for the plan.receive response from session.create
    await responsePromise;
    await new Promise((r) => setTimeout(r, 300));

    // All messages should have been validated successfully
    expect(validatedMessages.length).toBe(messages.length);
    expect(validatedMessages.every((m) => m.valid)).toBe(true);

    // Send an invalid message
    ws.send(JSON.stringify({ type: 'invalid.type', payload: {} }));
    await new Promise((r) => setTimeout(r, 100));

    // Should have one invalid message logged
    expect(validatedMessages.some((m) => !m.valid)).toBe(true);

    ws.close();
  });

  // --------------------------------------------------------------------------
  // Error flow: step failure triggers error status
  // --------------------------------------------------------------------------

  it('should handle step failure and update session to error status', async () => {
    const port = nextPort();
    server = createTestServer(port);

    server.on('message', (clientId, msg) => {
      routeMessage(server!, clientId, msg);
    });

    await server.start();

    const client = new InstallClient({
      serverUrl: `ws://127.0.0.1:${port}`,
      autoReconnect: false,
    });
    installClients.push(client);

    await client.connect();

    // Create session
    const createMsg = createMessage(MessageType.SESSION_CREATE, { software: 'openclaw' });
    await client.sendAndWait(createMsg, MessageType.PLAN_RECEIVE, 5000);

    // Send env report
    const envMsg = createMessage(MessageType.ENV_REPORT, makeEnvInfo());
    await client.sendAndWait(envMsg, MessageType.PLAN_RECEIVE, 5000);

    // Send a failed step
    const failedStep = createMessage(MessageType.STEP_COMPLETE, {
      stepId: 'install-pnpm',
      success: false,
      exitCode: 1,
      stdout: '',
      stderr: 'Error: EACCES permission denied',
      duration: 2000,
    });
    client.send(failedStep);
    await new Promise((r) => setTimeout(r, 200));

    // Verify session is in error state
    const clientIds = Array.from((server as any).clients.keys());
    const sessionId = server.getClientSessionId(clientIds[0]);
    expect(sessionId).toBeDefined();
    const session = server.getSession(sessionId!);
    expect(session).toBeDefined();
    expect(session!.status).toBe('error');

    client.disconnect();
  });

  // --------------------------------------------------------------------------
  // Connection lifecycle: disconnect cleans up
  // --------------------------------------------------------------------------

  it('should clean up client on disconnect', async () => {
    const port = nextPort();
    server = createTestServer(port);

    server.on('message', (clientId, msg) => {
      routeMessage(server!, clientId, msg);
    });

    await server.start();

    const ws = await connectRawClient(port);
    rawClients.push(ws);
    await waitFor(() => server!.getClientCount() === 1);

    // Create session
    const createMsg = createMessage(MessageType.SESSION_CREATE, { software: 'openclaw' });
    const ackPromise = waitForMessage(ws);
    ws.send(JSON.stringify(createMsg));
    await ackPromise;

    expect(server.getClientCount()).toBe(1);
    expect(server.getSessionCount()).toBe(1);

    // Disconnect
    ws.close();
    await waitFor(() => server!.getClientCount() === 0);

    expect(server.getClientCount()).toBe(0);
    // Sessions persist after disconnect (for record keeping)
    expect(server.getSessionCount()).toBe(1);
  });

  // --------------------------------------------------------------------------
  // Env report without session should fail gracefully
  // --------------------------------------------------------------------------

  it('should handle env report without prior session creation', async () => {
    const port = nextPort();
    server = createTestServer(port);

    const handlerResults: { success: boolean; error?: string }[] = [];
    server.on('message', async (clientId, msg) => {
      const result = await routeMessage(server!, clientId, msg);
      handlerResults.push(result);
    });

    await server.start();

    const ws = await connectRawClient(port);
    rawClients.push(ws);
    await waitFor(() => server!.getClientCount() === 1);

    // Send env report without creating a session first
    const envMsg = createMessage(MessageType.ENV_REPORT, makeEnvInfo());
    ws.send(JSON.stringify(envMsg));
    await new Promise((r) => setTimeout(r, 200));

    // Handler should return failure
    expect(handlerResults.length).toBe(1);
    expect(handlerResults[0].success).toBe(false);
    expect(handlerResults[0].error).toContain('No session found');

    ws.close();
  });
});
