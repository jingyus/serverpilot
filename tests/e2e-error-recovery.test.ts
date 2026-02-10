/**
 * E2E Test: Error Recovery Flow
 *
 * Tests the error handling and recovery workflow:
 * 1. Step fails during execution
 * 2. Client sends error report with full context
 * 3. Server diagnoses error and sends fix suggestions
 * 4. Client retries with fix strategy
 * 5. Session recovers or reports final failure
 *
 * All tests use real WebSocket connections (no mocks).
 * Authentication is disabled (requireAuth: false) to focus on error recovery flow.
 */

import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { createMessage, MessageType } from '@aiinstaller/shared';
import { InstallServer } from '../packages/server/src/api/server.js';
import { routeMessage } from '../packages/server/src/api/handlers.js';
import { InstallClient } from '../packages/agent/src/client.js';

// ============================================================================
// Helpers
// ============================================================================

let testPort = 19700;
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

function makeEnvInfo() {
  return {
    os: { platform: 'linux' as const, version: '22.04', arch: 'x86_64' },
    shell: { type: 'bash' as const, version: '5.1' },
    runtime: { node: '22.0.0' },
    packageManagers: { npm: '10.0.0' },
    network: { canAccessNpm: true, canAccessGithub: true },
    permissions: { hasSudo: false, canWriteTo: ['/home/user'] },
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

describe('E2E: Error Recovery Flow', () => {
  let server: InstallServer | null = null;
  let rawClients: WebSocket[] = [];
  let installClients: InstallClient[] = [];

  afterEach(async () => {
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

    if (server?.isRunning()) {
      await server.stop();
    }
    server = null;
  });

  // --------------------------------------------------------------------------
  // Error report triggers fix suggestion
  // --------------------------------------------------------------------------

  it('should send fix suggestions when client reports an error', async () => {
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

    // Send env report and wait for fallback plan
    const envMsg = createMessage(MessageType.ENV_REPORT, makeEnvInfo());
    const planPromise = waitForMessage(ws);
    ws.send(JSON.stringify(envMsg));
    await planPromise;

    // Report an error (EACCES permission denied)
    const errorMsg = createMessage(MessageType.ERROR_OCCURRED, {
      stepId: 'install-pnpm',
      command: 'npm install -g pnpm',
      exitCode: 1,
      stdout: '',
      stderr: 'EACCES: permission denied, mkdir \'/usr/local/lib/node_modules/pnpm\'',
      environment: makeEnvInfo(),
      previousSteps: [
        {
          stepId: 'check-node',
          success: true,
          exitCode: 0,
          stdout: 'v22.0.0',
          stderr: '',
          duration: 500,
        },
      ],
    });

    const fixPromise = waitForMessage(ws);
    ws.send(JSON.stringify(errorMsg));

    // Should receive fix suggestions
    const fixStr = await fixPromise;
    const fixResponse = JSON.parse(fixStr);
    expect(fixResponse.type).toBe(MessageType.FIX_SUGGEST);
    expect(Array.isArray(fixResponse.payload)).toBe(true);
    expect(fixResponse.payload.length).toBeGreaterThan(0);

    // Verify fix strategy structure
    const fix = fixResponse.payload[0];
    expect(fix).toHaveProperty('id');
    expect(fix).toHaveProperty('description');
    expect(fix).toHaveProperty('commands');
    expect(fix).toHaveProperty('confidence');
    expect(Array.isArray(fix.commands)).toBe(true);
    expect(fix.commands.length).toBeGreaterThan(0);
    expect(typeof fix.confidence).toBe('number');
    expect(fix.confidence).toBeGreaterThanOrEqual(0);
    expect(fix.confidence).toBeLessThanOrEqual(1);

    ws.close();
  });

  // --------------------------------------------------------------------------
  // Step failure updates session to error
  // --------------------------------------------------------------------------

  it('should update session status to error when step fails', async () => {
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

    // Report failed step
    const stepFailMsg = createMessage(MessageType.STEP_COMPLETE, {
      stepId: 'install-openclaw',
      success: false,
      exitCode: 1,
      stdout: '',
      stderr: 'npm ERR! network timeout',
      duration: 60000,
    });
    ws.send(JSON.stringify(stepFailMsg));
    await new Promise((r) => setTimeout(r, 100));

    // Verify session is in error state
    expect(server.getSessionCount()).toBe(1);
    const clientIds = Array.from((server as any).clients.keys());
    const sessionId = server.getClientSessionId(clientIds[0]);
    expect(sessionId).toBeDefined();
    const session = server.getSession(sessionId!);
    expect(session).toBeDefined();
    expect(session!.status).toBe('error');

    // Send another step complete (success) to recover
    const stepOk = createMessage(MessageType.STEP_COMPLETE, {
      stepId: 'recovery-step',
      success: true,
      exitCode: 0,
      stdout: 'recovered',
      stderr: '',
      duration: 100,
    });
    ws.send(JSON.stringify(stepOk));
    await new Promise((r) => setTimeout(r, 100));

    // Session should now be in executing state (recovered from error)
    const sessionAfter = server.getSession(sessionId!);
    expect(sessionAfter!.status).toBe('executing');

    ws.close();
  });

  // --------------------------------------------------------------------------
  // Error recovery with retry flow (using InstallClient)
  // --------------------------------------------------------------------------

  it('should handle error → fix suggestion → retry → success flow', async () => {
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

    // Send env report and wait for fallback plan
    const envMsg = createMessage(MessageType.ENV_REPORT, makeEnvInfo());
    await client.sendAndWait(envMsg, MessageType.PLAN_RECEIVE, 5000);

    // Report error and get fix suggestion
    const errorMsg = createMessage(MessageType.ERROR_OCCURRED, {
      stepId: 'install-pnpm',
      command: 'npm install -g pnpm',
      exitCode: 1,
      stdout: '',
      stderr: 'EACCES: permission denied',
      environment: makeEnvInfo(),
      previousSteps: [],
    });

    const fixSuggestion = await client.sendAndWait(
      errorMsg,
      MessageType.FIX_SUGGEST,
      5000,
    );

    expect(fixSuggestion.type).toBe(MessageType.FIX_SUGGEST);
    expect(fixSuggestion.payload.length).toBeGreaterThan(0);

    // Verify session is in error state after error report
    const clientIds = Array.from((server as any).clients.keys());
    const sessionId = server!.getClientSessionId(clientIds[0]);
    expect(sessionId).toBeDefined();
    const sessionInError = server!.getSession(sessionId!);
    expect(sessionInError!.status).toBe('error');

    // Client applies fix and retries - step succeeds this time
    const retrySuccess = createMessage(MessageType.STEP_COMPLETE, {
      stepId: 'install-pnpm',
      success: true,
      exitCode: 0,
      stdout: 'pnpm installed successfully with sudo',
      stderr: '',
      duration: 3000,
    });
    client.send(retrySuccess);
    await new Promise((r) => setTimeout(r, 100));

    // Session should be back to executing state (recovered)
    const sessionRecovered = server!.getSession(sessionId!);
    expect(sessionRecovered!.status).toBe('executing');

    // Complete the session
    const completeMsg = createMessage(MessageType.SESSION_COMPLETE, {
      success: true,
      summary: 'Recovered from permission error and completed',
    });
    client.send(completeMsg);
    await new Promise((r) => setTimeout(r, 100));

    client.disconnect();
  });

  // --------------------------------------------------------------------------
  // Multiple errors in sequence
  // --------------------------------------------------------------------------

  it('should handle multiple errors in sequence', async () => {
    const port = nextPort();
    server = createTestServer(port);

    const fixSuggestionsReceived: number[] = [];

    server.on('message', (clientId, msg) => {
      routeMessage(server!, clientId, msg);
    });

    await server.start();

    const client = new InstallClient({
      serverUrl: `ws://127.0.0.1:${port}`,
      autoReconnect: false,
    });
    installClients.push(client);

    client.on('message', (msg) => {
      if (msg.type === MessageType.FIX_SUGGEST) {
        fixSuggestionsReceived.push(msg.payload.length);
      }
    });

    await client.connect();

    // Create session
    const createMsg = createMessage(MessageType.SESSION_CREATE, { software: 'openclaw' });
    await client.sendAndWait(createMsg, MessageType.PLAN_RECEIVE, 5000);

    // First error: network timeout
    const error1 = createMessage(MessageType.ERROR_OCCURRED, {
      stepId: 'install-openclaw',
      command: 'pnpm install -g openclaw',
      exitCode: 1,
      stdout: '',
      stderr: 'network timeout at https://registry.npmjs.org',
      environment: makeEnvInfo(),
      previousSteps: [],
    });
    const fix1 = await client.sendAndWait(error1, MessageType.FIX_SUGGEST, 5000);
    expect(fix1.payload.length).toBeGreaterThan(0);

    // Second error: different error after retry
    const error2 = createMessage(MessageType.ERROR_OCCURRED, {
      stepId: 'install-openclaw',
      command: 'pnpm install -g openclaw --registry https://registry.npmmirror.com',
      exitCode: 1,
      stdout: '',
      stderr: 'ERR_PNPM_NO_PKG_MANIFEST  No package.json',
      environment: makeEnvInfo(),
      previousSteps: [],
    });
    const fix2 = await client.sendAndWait(error2, MessageType.FIX_SUGGEST, 5000);
    expect(fix2.payload.length).toBeGreaterThan(0);

    // Third error: version conflict
    const error3 = createMessage(MessageType.ERROR_OCCURRED, {
      stepId: 'install-openclaw',
      command: 'npm install -g openclaw',
      exitCode: 1,
      stdout: '',
      stderr: 'ERESOLVE unable to resolve dependency tree',
      environment: makeEnvInfo(),
      previousSteps: [],
    });
    const fix3 = await client.sendAndWait(error3, MessageType.FIX_SUGGEST, 5000);
    expect(fix3.payload.length).toBeGreaterThan(0);

    // Verify all 3 fix suggestions were received
    await new Promise((r) => setTimeout(r, 100));
    expect(fixSuggestionsReceived.length).toBe(3);

    // Each fix suggestion should have at least 1 strategy
    for (const count of fixSuggestionsReceived) {
      expect(count).toBeGreaterThan(0);
    }

    client.disconnect();
  });

  // --------------------------------------------------------------------------
  // Error with complete context
  // --------------------------------------------------------------------------

  it('should handle error with full context including previous steps', async () => {
    const port = nextPort();
    server = createTestServer(port);

    let receivedErrorContext: any = null;

    server.on('message', (clientId, msg) => {
      if (msg.type === MessageType.ERROR_OCCURRED) {
        receivedErrorContext = msg.payload;
      }
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

    // Send error with full context (out of memory kill)
    const errorMsg = createMessage(MessageType.ERROR_OCCURRED, {
      stepId: 'install-openclaw',
      command: 'pnpm install -g openclaw',
      exitCode: 137,
      stdout: 'Downloading openclaw@1.0.0...\nProgress: 45%',
      stderr: 'Killed: out of memory',
      environment: {
        os: { platform: 'linux' as const, version: '22.04', arch: 'x86_64' },
        shell: { type: 'bash' as const, version: '5.1' },
        runtime: { node: '22.0.0' },
        packageManagers: { npm: '10.0.0', pnpm: '9.0.0' },
        network: { canAccessNpm: true, canAccessGithub: true },
        permissions: { hasSudo: true, canWriteTo: ['/usr/local'] },
      },
      previousSteps: [
        {
          stepId: 'check-node',
          success: true,
          exitCode: 0,
          stdout: 'v22.0.0',
          stderr: '',
          duration: 200,
        },
        {
          stepId: 'install-pnpm',
          success: true,
          exitCode: 0,
          stdout: 'pnpm 9.0.0 installed',
          stderr: '',
          duration: 5000,
        },
      ],
    });

    const fixPromise = waitForMessage(ws);
    ws.send(JSON.stringify(errorMsg));
    const fixStr = await fixPromise;
    const fixResponse = JSON.parse(fixStr);

    // Verify fix suggestion was returned
    expect(fixResponse.type).toBe(MessageType.FIX_SUGGEST);
    expect(fixResponse.payload.length).toBeGreaterThan(0);

    // Verify the full error context was received by the server
    expect(receivedErrorContext).not.toBeNull();
    expect(receivedErrorContext.stepId).toBe('install-openclaw');
    expect(receivedErrorContext.command).toBe('pnpm install -g openclaw');
    expect(receivedErrorContext.exitCode).toBe(137);
    expect(receivedErrorContext.stdout).toContain('Progress: 45%');
    expect(receivedErrorContext.stderr).toContain('out of memory');
    expect(receivedErrorContext.previousSteps.length).toBe(2);
    expect(receivedErrorContext.previousSteps[0].stepId).toBe('check-node');
    expect(receivedErrorContext.previousSteps[1].stepId).toBe('install-pnpm');
    expect(receivedErrorContext.environment.os.platform).toBe('linux');
    expect(receivedErrorContext.environment.packageManagers.pnpm).toBe('9.0.0');

    ws.close();
  });

  // --------------------------------------------------------------------------
  // Failed session with no recovery
  // --------------------------------------------------------------------------

  it('should handle session that fails without recovery', async () => {
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

    // Step fails
    const stepFail = createMessage(MessageType.STEP_COMPLETE, {
      stepId: 'check-node',
      success: false,
      exitCode: 127,
      stdout: '',
      stderr: 'command not found: node',
      duration: 100,
    });
    client.send(stepFail);
    await new Promise((r) => setTimeout(r, 100));

    // Verify session is in error state
    const clientIds = Array.from((server as any).clients.keys());
    const sessionId = server.getClientSessionId(clientIds[0]);
    expect(sessionId).toBeDefined();
    const session = server.getSession(sessionId!);
    expect(session!.status).toBe('error');

    // Client decides to abort - sends session complete with failure
    const abortMsg = createMessage(MessageType.SESSION_COMPLETE, {
      success: false,
      summary: 'Node.js not found. Please install Node.js 22+ first.',
    });
    client.send(abortMsg);
    await new Promise((r) => setTimeout(r, 100));

    client.disconnect();
    expect(client.state).toBe('disconnected');
  });

  // --------------------------------------------------------------------------
  // Error report without session should fail gracefully
  // --------------------------------------------------------------------------

  it('should handle error report without prior session creation', async () => {
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

    // Send error report without creating a session first
    const errorMsg = createMessage(MessageType.ERROR_OCCURRED, {
      stepId: 'install-pnpm',
      command: 'npm install -g pnpm',
      exitCode: 1,
      stdout: '',
      stderr: 'EACCES: permission denied',
      environment: makeEnvInfo(),
      previousSteps: [],
    });
    ws.send(JSON.stringify(errorMsg));
    await new Promise((r) => setTimeout(r, 200));

    // Handler should return failure because no session exists
    expect(handlerResults.length).toBe(1);
    expect(handlerResults[0].success).toBe(false);
    expect(handlerResults[0].error).toContain('No session found');

    ws.close();
  });

  // --------------------------------------------------------------------------
  // Session state transitions during error recovery
  // --------------------------------------------------------------------------

  it('should track session state transitions during error recovery', async () => {
    const port = nextPort();
    server = createTestServer(port);

    const stateTransitions: string[] = [];

    server.on('message', (clientId, msg) => {
      routeMessage(server!, clientId, msg);

      // Track session state after each message
      const sessionId = server!.getClientSessionId(clientId);
      if (sessionId) {
        const session = server!.getSession(sessionId);
        if (session) {
          stateTransitions.push(session.status);
        }
      }
    });

    await server.start();

    const ws = await connectRawClient(port);
    rawClients.push(ws);
    await waitFor(() => server!.getClientCount() === 1);

    // 1. Create session → status: created
    const createMsg = createMessage(MessageType.SESSION_CREATE, { software: 'openclaw' });
    const ackPromise = waitForMessage(ws);
    ws.send(JSON.stringify(createMsg));
    await ackPromise;

    // 2. Send env report → status transitions to planning
    const envMsg = createMessage(MessageType.ENV_REPORT, makeEnvInfo());
    const planPromise = waitForMessage(ws);
    ws.send(JSON.stringify(envMsg));
    await planPromise;

    // 3. Send successful step → status: executing
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

    // 4. Report error → status: error
    const errorMsg = createMessage(MessageType.ERROR_OCCURRED, {
      stepId: 'install-pnpm',
      command: 'npm install -g pnpm',
      exitCode: 1,
      stdout: '',
      stderr: 'EACCES: permission denied',
      environment: makeEnvInfo(),
      previousSteps: [],
    });
    const fixPromise = waitForMessage(ws);
    ws.send(JSON.stringify(errorMsg));
    await fixPromise;

    // 5. Retry and succeed → status: executing
    const retryOk = createMessage(MessageType.STEP_COMPLETE, {
      stepId: 'install-pnpm',
      success: true,
      exitCode: 0,
      stdout: 'installed with sudo',
      stderr: '',
      duration: 2000,
    });
    ws.send(JSON.stringify(retryOk));
    await new Promise((r) => setTimeout(r, 100));

    // Verify key transitions occurred
    expect(stateTransitions).toContain('created');
    expect(stateTransitions).toContain('planning');
    expect(stateTransitions).toContain('executing');
    expect(stateTransitions).toContain('error');

    // The last state should be executing (recovered from error)
    expect(stateTransitions[stateTransitions.length - 1]).toBe('executing');

    ws.close();
  });

  // --------------------------------------------------------------------------
  // Fix suggestion contains actionable commands
  // --------------------------------------------------------------------------

  it('should return fix suggestions with actionable retry commands', async () => {
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

    // Report error
    const errorMsg = createMessage(MessageType.ERROR_OCCURRED, {
      stepId: 'install-dep',
      command: 'npm install express',
      exitCode: 1,
      stdout: '',
      stderr: 'command not found: npm',
      environment: makeEnvInfo(),
      previousSteps: [],
    });

    const fixSuggestion = await client.sendAndWait(
      errorMsg,
      MessageType.FIX_SUGGEST,
      5000,
    );

    // Verify fix strategies are well-formed
    expect(fixSuggestion.payload.length).toBeGreaterThan(0);
    for (const strategy of fixSuggestion.payload) {
      expect(strategy.description).toBeTruthy();
      expect(strategy.commands.length).toBeGreaterThan(0);
      expect(typeof strategy.confidence).toBe('number');
      expect(strategy.confidence).toBeGreaterThanOrEqual(0);
      expect(strategy.confidence).toBeLessThanOrEqual(1);
      // Each command should be a non-empty string
      for (const cmd of strategy.commands) {
        expect(typeof cmd).toBe('string');
        expect(cmd.length).toBeGreaterThan(0);
      }
    }

    client.disconnect();
  });

  // --------------------------------------------------------------------------
  // Multiple clients with independent error recovery
  // --------------------------------------------------------------------------

  it('should handle independent error recovery for multiple clients', async () => {
    const port = nextPort();
    server = createTestServer(port);

    server.on('message', (clientId, msg) => {
      routeMessage(server!, clientId, msg);
    });

    await server.start();

    // Connect two clients
    const client1 = new InstallClient({
      serverUrl: `ws://127.0.0.1:${port}`,
      autoReconnect: false,
    });
    const client2 = new InstallClient({
      serverUrl: `ws://127.0.0.1:${port}`,
      autoReconnect: false,
    });
    installClients.push(client1, client2);

    await client1.connect();
    await client2.connect();

    // Both create sessions
    const createMsg1 = createMessage(MessageType.SESSION_CREATE, { software: 'openclaw' });
    const createMsg2 = createMessage(MessageType.SESSION_CREATE, { software: 'openclaw' });
    await client1.sendAndWait(createMsg1, MessageType.PLAN_RECEIVE, 5000);
    await client2.sendAndWait(createMsg2, MessageType.PLAN_RECEIVE, 5000);

    expect(server.getSessionCount()).toBe(2);

    // Client 1 reports an error
    const error1 = createMessage(MessageType.ERROR_OCCURRED, {
      stepId: 'install-pnpm',
      command: 'npm install -g pnpm',
      exitCode: 1,
      stdout: '',
      stderr: 'EACCES: permission denied',
      environment: makeEnvInfo(),
      previousSteps: [],
    });
    const fix1 = await client1.sendAndWait(error1, MessageType.FIX_SUGGEST, 5000);
    expect(fix1.payload.length).toBeGreaterThan(0);

    // Client 2 reports a different error
    const error2 = createMessage(MessageType.ERROR_OCCURRED, {
      stepId: 'install-node',
      command: 'apt install nodejs',
      exitCode: 1,
      stdout: '',
      stderr: 'E: Unable to locate package nodejs',
      environment: makeEnvInfo(),
      previousSteps: [],
    });
    const fix2 = await client2.sendAndWait(error2, MessageType.FIX_SUGGEST, 5000);
    expect(fix2.payload.length).toBeGreaterThan(0);

    // Both sessions should be in error state
    const clientIds = Array.from((server as any).clients.keys());
    for (const cid of clientIds) {
      const sid = server.getClientSessionId(cid);
      if (sid) {
        const session = server.getSession(sid);
        expect(session!.status).toBe('error');
      }
    }

    client1.disconnect();
    client2.disconnect();
  });
});
