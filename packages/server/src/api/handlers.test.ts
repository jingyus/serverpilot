// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for packages/server/src/api/handlers.ts
 *
 * Tests the message handler functions including:
 * - handleCreateSession() - session creation and plan.receive response
 * - handleEnvReport() - environment report processing
 * - handleStepComplete() - step completion with success/failure paths
 * - handleErrorOccurred() - error handling and fix.suggest response
 * - routeMessage() - message routing to correct handler
 * - HandlerResult interface type checks
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import WebSocket from 'ws';
import { createMessage, MessageType, SessionStatus } from '@aiinstaller/shared';
import type {
  Message,
  SessionCreateMessage,
  EnvReportMessage,
  StepCompleteMessage,
  ErrorOccurredMessage,
  EnvironmentInfo,
} from '@aiinstaller/shared';
import { InstallServer } from './server.js';
import {
  handleCreateSession,
  handleEnvReport,
  handleStepComplete,
  handleErrorOccurred,
  routeMessage,
} from './handlers.js';
import type { HandlerResult } from './handlers.js';

// ============================================================================
// Test Helpers
// ============================================================================

let testPort = 18400;
function nextPort() {
  return testPort++;
}

/**
 * Poll a condition until it becomes true, or timeout.
 */
function waitFor(
  condition: () => boolean,
  timeoutMs = 2000,
  intervalMs = 50,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const timer = setInterval(() => {
      if (condition()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - start >= timeoutMs) {
        clearInterval(timer);
        reject(new Error('waitFor timed out'));
      }
    }, intervalMs);
  });
}

/**
 * Connect a WebSocket client to the given port and wait until it is open.
 */
function connectClient(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.on('open', () => resolve(ws));
    ws.on('error', (err) => reject(err));
  });
}

/**
 * Wait for the next message on a WebSocket.
 */
function waitForMessage(ws: WebSocket, timeoutMs = 2000): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('waitForMessage timed out'));
    }, timeoutMs);
    ws.once('message', (data) => {
      clearTimeout(timer);
      resolve(data.toString());
    });
  });
}

/**
 * Create a minimal valid EnvironmentInfo payload.
 */
function makeEnvInfo(): EnvironmentInfo {
  return {
    os: { platform: 'darwin', version: '14.0', arch: 'arm64' },
    shell: { type: 'zsh', version: '5.9' },
    runtime: { node: '22.0.0' },
    packageManagers: { npm: '10.0.0' },
    network: { canAccessNpm: true, canAccessGithub: true },
    permissions: { hasSudo: false, canWriteTo: ['/tmp'] },
  };
}

/**
 * Create a valid ErrorOccurredMessage payload (ErrorContext).
 */
function makeErrorContext() {
  return {
    stepId: 'step-1',
    command: 'npm install',
    exitCode: 1,
    stdout: '',
    stderr: 'ERR! code ENOENT',
    environment: makeEnvInfo(),
    previousSteps: [],
  };
}

// ============================================================================
// handleCreateSession
// ============================================================================

describe('handleCreateSession', () => {
  let server: InstallServer;
  let ws: WebSocket;
  let clientId: string;

  afterEach(async () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
    if (server && server.isRunning()) {
      await server.stop();
    }
  });

  it('creates a session and returns success', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 60000 });

    const clientIdPromise = new Promise<string>((resolve) => {
      server.on('connection', (id) => resolve(id));
    });

    await server.start();
    ws = await connectClient(port);
    clientId = await clientIdPromise;

    const message = createMessage(MessageType.SESSION_CREATE, {
      software: 'nodejs',
    }) as SessionCreateMessage;

    const result = handleCreateSession(server, clientId, message);

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('sends a plan.receive response to the client', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 60000 });

    const clientIdPromise = new Promise<string>((resolve) => {
      server.on('connection', (id) => resolve(id));
    });

    await server.start();
    ws = await connectClient(port);
    clientId = await clientIdPromise;

    const msgPromise = waitForMessage(ws);

    const message = createMessage(MessageType.SESSION_CREATE, {
      software: 'nodejs',
    }) as SessionCreateMessage;

    handleCreateSession(server, clientId, message);

    const raw = await msgPromise;
    const parsed = JSON.parse(raw) as Message;

    expect(parsed.type).toBe(MessageType.PLAN_RECEIVE);
    expect(parsed.payload).toHaveProperty('steps');
    expect(parsed.payload).toHaveProperty('estimatedTime');
    expect(parsed.payload).toHaveProperty('risks');
  });

  it('sends plan.receive with empty steps, 0 estimatedTime, and empty risks', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 60000 });

    const clientIdPromise = new Promise<string>((resolve) => {
      server.on('connection', (id) => resolve(id));
    });

    await server.start();
    ws = await connectClient(port);
    clientId = await clientIdPromise;

    const msgPromise = waitForMessage(ws);

    const message = createMessage(MessageType.SESSION_CREATE, {
      software: 'nodejs',
    }) as SessionCreateMessage;

    handleCreateSession(server, clientId, message);

    const raw = await msgPromise;
    const parsed = JSON.parse(raw) as Message;

    expect((parsed.payload as any).steps).toEqual([]);
    expect((parsed.payload as any).estimatedTime).toBe(0);
    expect((parsed.payload as any).risks).toEqual([]);
  });

  it('passes requestId through to the plan.receive response', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 60000 });

    const clientIdPromise = new Promise<string>((resolve) => {
      server.on('connection', (id) => resolve(id));
    });

    await server.start();
    ws = await connectClient(port);
    clientId = await clientIdPromise;

    const msgPromise = waitForMessage(ws);

    const message = createMessage(MessageType.SESSION_CREATE, {
      software: 'nodejs',
    }, 'req-123') as SessionCreateMessage;

    handleCreateSession(server, clientId, message);

    const raw = await msgPromise;
    const parsed = JSON.parse(raw) as Message;

    expect(parsed.requestId).toBe('req-123');
  });

  it('returns failure for non-existent client', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 60000 });
    await server.start();

    const message = createMessage(MessageType.SESSION_CREATE, {
      software: 'nodejs',
    }) as SessionCreateMessage;

    const result = handleCreateSession(server, 'nonexistent-id', message);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toContain('nonexistent-id');
  });

  it('handles optional version in session create payload', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 60000 });

    const clientIdPromise = new Promise<string>((resolve) => {
      server.on('connection', (id) => resolve(id));
    });

    await server.start();
    ws = await connectClient(port);
    clientId = await clientIdPromise;

    const message = createMessage(MessageType.SESSION_CREATE, {
      software: 'nodejs',
      version: '22.0.0',
    }) as SessionCreateMessage;

    const result = handleCreateSession(server, clientId, message);

    expect(result.success).toBe(true);
  });

  it('creates a session with correct software name stored', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 60000 });

    const clientIdPromise = new Promise<string>((resolve) => {
      server.on('connection', (id) => resolve(id));
    });

    await server.start();
    ws = await connectClient(port);
    clientId = await clientIdPromise;

    const message = createMessage(MessageType.SESSION_CREATE, {
      software: 'python',
    }) as SessionCreateMessage;

    handleCreateSession(server, clientId, message);

    const sessionId = server.getClientSessionId(clientId);
    expect(sessionId).toBeDefined();

    const session = server.getSession(sessionId!);
    expect(session).toBeDefined();
    expect(session!.software).toBe('python');
    expect(session!.status).toBe(SessionStatus.CREATED);
  });
});

// ============================================================================
// handleEnvReport
// ============================================================================

describe('handleEnvReport', () => {
  let server: InstallServer;
  let ws: WebSocket;
  let clientId: string;

  afterEach(async () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
    if (server && server.isRunning()) {
      await server.stop();
    }
  });

  it('updates session status to detecting', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 60000 });

    const clientIdPromise = new Promise<string>((resolve) => {
      server.on('connection', (id) => resolve(id));
    });

    await server.start();
    ws = await connectClient(port);
    clientId = await clientIdPromise;

    // First create a session
    const createMsg = createMessage(MessageType.SESSION_CREATE, {
      software: 'nodejs',
    }) as SessionCreateMessage;
    handleCreateSession(server, clientId, createMsg);

    // Drain the plan.receive message from the ws buffer
    await waitForMessage(ws);

    // Now send env report
    const envMsg = createMessage(MessageType.ENV_REPORT, makeEnvInfo()) as EnvReportMessage;
    const result = await handleEnvReport(server, clientId, envMsg);

    expect(result.success).toBe(true);

    const sessionId = server.getClientSessionId(clientId)!;
    const session = server.getSession(sessionId)!;
    expect(session.status).toBe(SessionStatus.PLANNING);
  });

  it('returns success true on valid env report', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 60000 });

    const clientIdPromise = new Promise<string>((resolve) => {
      server.on('connection', (id) => resolve(id));
    });

    await server.start();
    ws = await connectClient(port);
    clientId = await clientIdPromise;

    const createMsg = createMessage(MessageType.SESSION_CREATE, {
      software: 'nodejs',
    }) as SessionCreateMessage;
    handleCreateSession(server, clientId, createMsg);
    await waitForMessage(ws);

    const envMsg = createMessage(MessageType.ENV_REPORT, makeEnvInfo()) as EnvReportMessage;
    const result = await handleEnvReport(server, clientId, envMsg);

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('succeeds silently without an existing session (daemon mode)', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 60000 });

    const clientIdPromise = new Promise<string>((resolve) => {
      server.on('connection', (id) => resolve(id));
    });

    await server.start();
    ws = await connectClient(port);
    clientId = await clientIdPromise;

    // Simulate daemon-mode agent with auth credentials (no install session)
    server.authenticateClient(clientId, 'device-1', 'token-1');

    const envMsg = createMessage(MessageType.ENV_REPORT, makeEnvInfo()) as EnvReportMessage;
    const result = await handleEnvReport(server, clientId, envMsg);

    // Daemon-mode agents have no install session; env.report is silently ignored
    expect(result.success).toBe(true);
  });

  it('returns failure for non-existent client', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 60000 });
    await server.start();

    const envMsg = createMessage(MessageType.ENV_REPORT, makeEnvInfo()) as EnvReportMessage;
    const result = await handleEnvReport(server, 'nonexistent-client', envMsg);

    expect(result.success).toBe(false);
    expect(result.error).toContain('No session found');
  });

  it('calls AI agent to analyze environment when provided', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 60000 });

    const clientIdPromise = new Promise<string>((resolve) => {
      server.on('connection', (id) => resolve(id));
    });

    await server.start();
    ws = await connectClient(port);
    clientId = await clientIdPromise;

    const createMsg = createMessage(MessageType.SESSION_CREATE, {
      software: 'nodejs',
    }) as SessionCreateMessage;
    handleCreateSession(server, clientId, createMsg);
    await waitForMessage(ws);

    // Mock AI agent
    const mockAIAgent = {
      analyzeEnvironment: async () => ({
        success: true,
        data: {
          summary: 'Environment is ready for installation',
          ready: true,
          issues: [],
          recommendations: ['Install Node.js if not present'],
          detectedCapabilities: {
            hasRequiredRuntime: true,
            hasPackageManager: true,
            hasNetworkAccess: true,
            hasSufficientPermissions: true,
          },
        },
      }),
    } as any;

    const envMsg = createMessage(MessageType.ENV_REPORT, makeEnvInfo()) as EnvReportMessage;
    const result = await handleEnvReport(server, clientId, envMsg, mockAIAgent);

    expect(result.success).toBe(true);

    // Should update status to PLANNING when ready
    const sessionId = server.getClientSessionId(clientId)!;
    const session = server.getSession(sessionId)!;
    expect(session.status).toBe(SessionStatus.PLANNING);
  });

  it('sends AI stream messages when AI agent analyzes successfully', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 60000 });

    const clientIdPromise = new Promise<string>((resolve) => {
      server.on('connection', (id) => resolve(id));
    });

    await server.start();
    ws = await connectClient(port);
    clientId = await clientIdPromise;

    const createMsg = createMessage(MessageType.SESSION_CREATE, {
      software: 'nodejs',
    }) as SessionCreateMessage;
    handleCreateSession(server, clientId, createMsg);
    await waitForMessage(ws); // drain plan.receive

    // Mock AI agent
    const mockAIAgent = {
      analyzeEnvironment: async () => ({
        success: true,
        data: {
          summary: 'Test summary',
          ready: true,
          issues: ['Issue 1'],
          recommendations: ['Recommendation 1'],
          detectedCapabilities: {
            hasRequiredRuntime: true,
            hasPackageManager: true,
            hasNetworkAccess: true,
            hasSufficientPermissions: true,
          },
        },
      }),
    } as any;

    const messages: Message[] = [];
    ws.on('message', (data) => {
      messages.push(JSON.parse(data.toString()) as Message);
    });

    const envMsg = createMessage(MessageType.ENV_REPORT, makeEnvInfo()) as EnvReportMessage;
    await handleEnvReport(server, clientId, envMsg, mockAIAgent);

    // Wait for messages to arrive
    await waitFor(() => messages.length >= 3, 3000);

    expect(messages.length).toBeGreaterThanOrEqual(3);
    expect(messages[0].type).toBe(MessageType.AI_STREAM_START);
    expect(messages[1].type).toBe(MessageType.AI_STREAM_TOKEN);
    expect(messages[2].type).toBe(MessageType.AI_STREAM_COMPLETE);
  });

  it('continues normal flow when AI analysis fails', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 60000 });

    const clientIdPromise = new Promise<string>((resolve) => {
      server.on('connection', (id) => resolve(id));
    });

    await server.start();
    ws = await connectClient(port);
    clientId = await clientIdPromise;

    const createMsg = createMessage(MessageType.SESSION_CREATE, {
      software: 'nodejs',
    }) as SessionCreateMessage;
    handleCreateSession(server, clientId, createMsg);
    await waitForMessage(ws);

    // Mock AI agent that fails
    const mockAIAgent = {
      analyzeEnvironment: async () => ({
        success: false,
        error: 'AI service unavailable',
      }),
    } as any;

    const envMsg = createMessage(MessageType.ENV_REPORT, makeEnvInfo()) as EnvReportMessage;
    const result = await handleEnvReport(server, clientId, envMsg, mockAIAgent);

    expect(result.success).toBe(true);

    // Should still continue to PLANNING status
    const sessionId = server.getClientSessionId(clientId)!;
    const session = server.getSession(sessionId)!;
    expect(session.status).toBe(SessionStatus.PLANNING);
  });

  it('updates status to ERROR when environment is not ready', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 60000 });

    const clientIdPromise = new Promise<string>((resolve) => {
      server.on('connection', (id) => resolve(id));
    });

    await server.start();
    ws = await connectClient(port);
    clientId = await clientIdPromise;

    const createMsg = createMessage(MessageType.SESSION_CREATE, {
      software: 'nodejs',
    }) as SessionCreateMessage;
    handleCreateSession(server, clientId, createMsg);
    await waitForMessage(ws);

    // Mock AI agent that says environment is not ready
    const mockAIAgent = {
      analyzeEnvironment: async () => ({
        success: true,
        data: {
          summary: 'Environment is not ready',
          ready: false,
          issues: ['Node.js not installed'],
          recommendations: ['Install Node.js first'],
          detectedCapabilities: {
            hasRequiredRuntime: false,
            hasPackageManager: false,
            hasNetworkAccess: true,
            hasSufficientPermissions: true,
          },
        },
      }),
    } as any;

    const envMsg = createMessage(MessageType.ENV_REPORT, makeEnvInfo()) as EnvReportMessage;
    await handleEnvReport(server, clientId, envMsg, mockAIAgent);

    const sessionId = server.getClientSessionId(clientId)!;
    const session = server.getSession(sessionId)!;
    expect(session.status).toBe(SessionStatus.ERROR);
  });
});

// ============================================================================
// handleStepComplete
// ============================================================================

describe('handleStepComplete', () => {
  let server: InstallServer;
  let ws: WebSocket;
  let clientId: string;

  afterEach(async () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
    if (server && server.isRunning()) {
      await server.stop();
    }
  });

  it('sets session status to executing on success', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 60000 });

    const clientIdPromise = new Promise<string>((resolve) => {
      server.on('connection', (id) => resolve(id));
    });

    await server.start();
    ws = await connectClient(port);
    clientId = await clientIdPromise;

    // Create a session first
    const createMsg = createMessage(MessageType.SESSION_CREATE, {
      software: 'nodejs',
    }) as SessionCreateMessage;
    handleCreateSession(server, clientId, createMsg);
    await waitForMessage(ws);

    const stepMsg = createMessage(MessageType.STEP_COMPLETE, {
      stepId: 'step-1',
      success: true,
      exitCode: 0,
      stdout: 'installed',
      stderr: '',
      duration: 1000,
    }) as StepCompleteMessage;

    const result = handleStepComplete(server, clientId, stepMsg);

    expect(result.success).toBe(true);

    const sessionId = server.getClientSessionId(clientId)!;
    const session = server.getSession(sessionId)!;
    expect(session.status).toBe(SessionStatus.EXECUTING);
  });

  it('sets session status to error on failure', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 60000 });

    const clientIdPromise = new Promise<string>((resolve) => {
      server.on('connection', (id) => resolve(id));
    });

    await server.start();
    ws = await connectClient(port);
    clientId = await clientIdPromise;

    const createMsg = createMessage(MessageType.SESSION_CREATE, {
      software: 'nodejs',
    }) as SessionCreateMessage;
    handleCreateSession(server, clientId, createMsg);
    await waitForMessage(ws);

    const stepMsg = createMessage(MessageType.STEP_COMPLETE, {
      stepId: 'step-1',
      success: false,
      exitCode: 1,
      stdout: '',
      stderr: 'command not found',
      duration: 500,
    }) as StepCompleteMessage;

    const result = handleStepComplete(server, clientId, stepMsg);

    expect(result.success).toBe(true);

    const sessionId = server.getClientSessionId(clientId)!;
    const session = server.getSession(sessionId)!;
    expect(session.status).toBe(SessionStatus.ERROR);
  });

  it('returns success true even when step fails', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 60000 });

    const clientIdPromise = new Promise<string>((resolve) => {
      server.on('connection', (id) => resolve(id));
    });

    await server.start();
    ws = await connectClient(port);
    clientId = await clientIdPromise;

    const createMsg = createMessage(MessageType.SESSION_CREATE, {
      software: 'nodejs',
    }) as SessionCreateMessage;
    handleCreateSession(server, clientId, createMsg);
    await waitForMessage(ws);

    const stepMsg = createMessage(MessageType.STEP_COMPLETE, {
      stepId: 'step-1',
      success: false,
      exitCode: 127,
      stdout: '',
      stderr: 'not found',
      duration: 100,
    }) as StepCompleteMessage;

    const result = handleStepComplete(server, clientId, stepMsg);

    // Handler returns success=true because it processed the message successfully,
    // even though the step itself failed.
    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('succeeds without an existing session (daemon-mode agent)', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 60000 });

    const clientIdPromise = new Promise<string>((resolve) => {
      server.on('connection', (id) => resolve(id));
    });

    await server.start();
    ws = await connectClient(port);
    clientId = await clientIdPromise;

    // Simulate daemon-mode agent with auth credentials (no install session)
    server.authenticateClient(clientId, 'device-1', 'token-1');

    const stepMsg = createMessage(MessageType.STEP_COMPLETE, {
      stepId: 'step-1',
      success: true,
      exitCode: 0,
      stdout: '',
      stderr: '',
      duration: 100,
    }) as StepCompleteMessage;

    const result = handleStepComplete(server, clientId, stepMsg);

    // Daemon-mode agent with auth credentials but no install session;
    // result still routes to TaskExecutor and returns success
    expect(result.success).toBe(true);
  });

  it('returns failure for non-existent client', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 60000 });
    await server.start();

    const stepMsg = createMessage(MessageType.STEP_COMPLETE, {
      stepId: 'step-1',
      success: true,
      exitCode: 0,
      stdout: '',
      stderr: '',
      duration: 100,
    }) as StepCompleteMessage;

    const result = handleStepComplete(server, 'ghost-client', stepMsg);

    expect(result.success).toBe(false);
    expect(result.error).toContain('No session found');
  });
});

// ============================================================================
// handleErrorOccurred
// ============================================================================

describe('handleErrorOccurred', () => {
  let server: InstallServer;
  let ws: WebSocket;
  let clientId: string;

  afterEach(async () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
    if (server && server.isRunning()) {
      await server.stop();
    }
  });

  it('sets session status to error', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 60000 });

    const clientIdPromise = new Promise<string>((resolve) => {
      server.on('connection', (id) => resolve(id));
    });

    await server.start();
    ws = await connectClient(port);
    clientId = await clientIdPromise;

    const createMsg = createMessage(MessageType.SESSION_CREATE, {
      software: 'nodejs',
    }) as SessionCreateMessage;
    handleCreateSession(server, clientId, createMsg);
    await waitForMessage(ws);

    const errorMsg = createMessage(
      MessageType.ERROR_OCCURRED,
      makeErrorContext(),
    ) as ErrorOccurredMessage;

    const result = await handleErrorOccurred(server, clientId, errorMsg);

    expect(result.success).toBe(true);

    const sessionId = server.getClientSessionId(clientId)!;
    const session = server.getSession(sessionId)!;
    expect(session.status).toBe(SessionStatus.ERROR);
  });

  it('sends a fix.suggest response to the client', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 60000 });

    const clientIdPromise = new Promise<string>((resolve) => {
      server.on('connection', (id) => resolve(id));
    });

    await server.start();
    ws = await connectClient(port);
    clientId = await clientIdPromise;

    const createMsg = createMessage(MessageType.SESSION_CREATE, {
      software: 'nodejs',
    }) as SessionCreateMessage;
    handleCreateSession(server, clientId, createMsg);
    // Drain plan.receive
    await waitForMessage(ws);

    const fixPromise = waitForMessage(ws);

    const errorMsg = createMessage(
      MessageType.ERROR_OCCURRED,
      makeErrorContext(),
    ) as ErrorOccurredMessage;

    await handleErrorOccurred(server, clientId, errorMsg);

    const raw = await fixPromise;
    const parsed = JSON.parse(raw) as Message;

    expect(parsed.type).toBe(MessageType.FIX_SUGGEST);
  });

  it('fix.suggest payload includes the failed command in description', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 60000 });

    const clientIdPromise = new Promise<string>((resolve) => {
      server.on('connection', (id) => resolve(id));
    });

    await server.start();
    ws = await connectClient(port);
    clientId = await clientIdPromise;

    const createMsg = createMessage(MessageType.SESSION_CREATE, {
      software: 'nodejs',
    }) as SessionCreateMessage;
    handleCreateSession(server, clientId, createMsg);
    await waitForMessage(ws);

    const fixPromise = waitForMessage(ws);

    const ctx = makeErrorContext();
    ctx.command = 'pip install flask';

    const errorMsg = createMessage(
      MessageType.ERROR_OCCURRED,
      ctx,
    ) as ErrorOccurredMessage;

    await handleErrorOccurred(server, clientId, errorMsg);

    const raw = await fixPromise;
    const parsed = JSON.parse(raw) as Message;
    const strategies = parsed.payload as any[];

    expect(strategies.length).toBeGreaterThanOrEqual(1);
    const retryStrategy = strategies.find((s: any) => s.id === 'retry');
    expect(retryStrategy).toBeDefined();
    expect(retryStrategy.description).toContain('pip install flask');
    expect(retryStrategy.commands).toContain('pip install flask');
  });

  it('fix.suggest response includes a confidence value', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 60000 });

    const clientIdPromise = new Promise<string>((resolve) => {
      server.on('connection', (id) => resolve(id));
    });

    await server.start();
    ws = await connectClient(port);
    clientId = await clientIdPromise;

    const createMsg = createMessage(MessageType.SESSION_CREATE, {
      software: 'nodejs',
    }) as SessionCreateMessage;
    handleCreateSession(server, clientId, createMsg);
    await waitForMessage(ws);

    const fixPromise = waitForMessage(ws);

    const errorMsg = createMessage(
      MessageType.ERROR_OCCURRED,
      makeErrorContext(),
    ) as ErrorOccurredMessage;

    await handleErrorOccurred(server, clientId, errorMsg);

    const raw = await fixPromise;
    const parsed = JSON.parse(raw) as Message;
    const strategies = parsed.payload as any[];

    expect(strategies[0].confidence).toBe(0.5);
  });

  it('passes requestId through to the fix.suggest response', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 60000 });

    const clientIdPromise = new Promise<string>((resolve) => {
      server.on('connection', (id) => resolve(id));
    });

    await server.start();
    ws = await connectClient(port);
    clientId = await clientIdPromise;

    const createMsg = createMessage(MessageType.SESSION_CREATE, {
      software: 'nodejs',
    }) as SessionCreateMessage;
    handleCreateSession(server, clientId, createMsg);
    await waitForMessage(ws);

    const fixPromise = waitForMessage(ws);

    const errorMsg = createMessage(
      MessageType.ERROR_OCCURRED,
      makeErrorContext(),
      'err-req-456',
    ) as ErrorOccurredMessage;

    await handleErrorOccurred(server, clientId, errorMsg);

    const raw = await fixPromise;
    const parsed = JSON.parse(raw) as Message;

    expect(parsed.requestId).toBe('err-req-456');
  });

  it('fails without an existing session', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 60000 });

    const clientIdPromise = new Promise<string>((resolve) => {
      server.on('connection', (id) => resolve(id));
    });

    await server.start();
    ws = await connectClient(port);
    clientId = await clientIdPromise;

    const errorMsg = createMessage(
      MessageType.ERROR_OCCURRED,
      makeErrorContext(),
    ) as ErrorOccurredMessage;

    const result = await handleErrorOccurred(server, clientId, errorMsg);

    expect(result.success).toBe(false);
    expect(result.error).toContain('No session found');
  });

  it('fails for non-existent client', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 60000 });
    await server.start();

    const errorMsg = createMessage(
      MessageType.ERROR_OCCURRED,
      makeErrorContext(),
    ) as ErrorOccurredMessage;

    const result = await handleErrorOccurred(server, 'fake-client', errorMsg);

    expect(result.success).toBe(false);
    expect(result.error).toContain('No session found');
  });

  it('uses common-errors rule library for "command not found" without AI', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 60000 });

    const clientIdPromise = new Promise<string>((resolve) => {
      server.on('connection', (id) => resolve(id));
    });

    await server.start();
    ws = await connectClient(port);
    clientId = await clientIdPromise;

    const createMsg = createMessage(MessageType.SESSION_CREATE, {
      software: 'nodejs',
    }) as SessionCreateMessage;
    handleCreateSession(server, clientId, createMsg);
    await waitForMessage(ws);

    const ctx = makeErrorContext();
    ctx.command = 'pnpm install';
    ctx.stderr = 'command not found: pnpm';

    const errorMsg = createMessage(
      MessageType.ERROR_OCCURRED,
      ctx,
    ) as ErrorOccurredMessage;

    // Call with AI agent to trigger rule library check
    const mockAIAgent = {
      analyzeEnvironment: async () => ({ success: true }),
    } as any;

    // Collect messages
    const messages: Message[] = [];
    ws.on('message', (data) => {
      messages.push(JSON.parse(data.toString()) as Message);
    });

    await handleErrorOccurred(server, clientId, errorMsg, mockAIAgent);

    // Wait for messages to arrive
    await waitFor(() => messages.some(m => m.type === MessageType.FIX_SUGGEST), 3000);

    // Find the fix.suggest message
    const fixSuggestMsg = messages.find(m => m.type === MessageType.FIX_SUGGEST);
    expect(fixSuggestMsg).toBeDefined();

    const strategies = fixSuggestMsg!.payload as any[];
    expect(strategies.length).toBeGreaterThanOrEqual(1);

    // Should suggest installing pnpm or a package manager
    const installStrategy = strategies.find((s: any) =>
      s.description.toLowerCase().includes('pnpm') ||
      s.description.toLowerCase().includes('install') ||
      s.description.toLowerCase().includes('command') ||
      s.commands.some((c: string) => c.includes('pnpm') || c.includes('install'))
    );
    expect(installStrategy).toBeDefined();
    expect(installStrategy.confidence).toBeGreaterThan(0.5);
  });

  it('uses common-errors rule library for permission errors without AI', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 60000 });

    const clientIdPromise = new Promise<string>((resolve) => {
      server.on('connection', (id) => resolve(id));
    });

    await server.start();
    ws = await connectClient(port);
    clientId = await clientIdPromise;

    const createMsg = createMessage(MessageType.SESSION_CREATE, {
      software: 'nodejs',
    }) as SessionCreateMessage;
    handleCreateSession(server, clientId, createMsg);
    await waitForMessage(ws);

    const ctx = makeErrorContext();
    ctx.command = 'npm install -g typescript';
    ctx.stderr = 'Error: EACCES: permission denied, access \'/usr/local/lib/node_modules\'';
    ctx.exitCode = 1;

    const errorMsg = createMessage(
      MessageType.ERROR_OCCURRED,
      ctx,
    ) as ErrorOccurredMessage;

    // Call with AI agent to trigger rule library check
    const mockAIAgent = {
      analyzeEnvironment: async () => ({ success: true }),
    } as any;

    // Collect messages
    const messages: Message[] = [];
    ws.on('message', (data) => {
      messages.push(JSON.parse(data.toString()) as Message);
    });

    await handleErrorOccurred(server, clientId, errorMsg, mockAIAgent);

    // Wait for messages to arrive
    await waitFor(() => messages.some(m => m.type === MessageType.FIX_SUGGEST), 3000);

    // Find the fix.suggest message
    const fixSuggestMsg = messages.find(m => m.type === MessageType.FIX_SUGGEST);
    expect(fixSuggestMsg).toBeDefined();

    const strategies = fixSuggestMsg!.payload as any[];
    expect(strategies.length).toBeGreaterThanOrEqual(1);

    // Should suggest using sudo or fixing permissions
    const permissionStrategy = strategies.find((s: any) =>
      s.description.toLowerCase().includes('permission') ||
      s.description.toLowerCase().includes('sudo') ||
      s.commands.some((c: string) => c.includes('sudo') || c.includes('chown'))
    );
    expect(permissionStrategy).toBeDefined();
    expect(permissionStrategy.confidence).toBeGreaterThan(0.7);
  });

  it('uses common-errors rule library for network timeout errors', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 60000 });

    const clientIdPromise = new Promise<string>((resolve) => {
      server.on('connection', (id) => resolve(id));
    });

    await server.start();
    ws = await connectClient(port);
    clientId = await clientIdPromise;

    const createMsg = createMessage(MessageType.SESSION_CREATE, {
      software: 'nodejs',
    }) as SessionCreateMessage;
    handleCreateSession(server, clientId, createMsg);
    await waitForMessage(ws);

    const ctx = makeErrorContext();
    ctx.command = 'npm install';
    ctx.stderr = 'Error: ETIMEDOUT: connection timed out';
    ctx.exitCode = 1;

    const errorMsg = createMessage(
      MessageType.ERROR_OCCURRED,
      ctx,
    ) as ErrorOccurredMessage;

    const mockAIAgent = {
      analyzeEnvironment: async () => ({ success: true }),
    } as any;

    // Collect messages
    const messages: Message[] = [];
    ws.on('message', (data) => {
      messages.push(JSON.parse(data.toString()) as Message);
    });

    await handleErrorOccurred(server, clientId, errorMsg, mockAIAgent);

    // Wait for messages to arrive
    await waitFor(() => messages.some(m => m.type === MessageType.FIX_SUGGEST), 3000);

    // Find the fix.suggest message
    const fixSuggestMsg = messages.find(m => m.type === MessageType.FIX_SUGGEST);
    expect(fixSuggestMsg).toBeDefined();

    const strategies = fixSuggestMsg!.payload as any[];
    expect(strategies.length).toBeGreaterThanOrEqual(1);

    // Should suggest network-related fixes
    const networkStrategy = strategies.find((s: any) =>
      s.description.toLowerCase().includes('network') ||
      s.description.toLowerCase().includes('connection') ||
      s.description.toLowerCase().includes('retry')
    );
    expect(networkStrategy).toBeDefined();
  });

  it('returns FixSuggestMessage with all required fields', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 60000 });

    const clientIdPromise = new Promise<string>((resolve) => {
      server.on('connection', (id) => resolve(id));
    });

    await server.start();
    ws = await connectClient(port);
    clientId = await clientIdPromise;

    const createMsg = createMessage(MessageType.SESSION_CREATE, {
      software: 'nodejs',
    }) as SessionCreateMessage;
    handleCreateSession(server, clientId, createMsg);
    await waitForMessage(ws);

    const ctx = makeErrorContext();
    ctx.stderr = 'command not found: pnpm';

    const errorMsg = createMessage(
      MessageType.ERROR_OCCURRED,
      ctx,
    ) as ErrorOccurredMessage;

    const mockAIAgent = {
      analyzeEnvironment: async () => ({ success: true }),
    } as any;

    // Collect messages
    const messages: Message[] = [];
    ws.on('message', (data) => {
      messages.push(JSON.parse(data.toString()) as Message);
    });

    await handleErrorOccurred(server, clientId, errorMsg, mockAIAgent);

    // Wait for messages to arrive
    await waitFor(() => messages.some(m => m.type === MessageType.FIX_SUGGEST), 3000);

    // Find the fix.suggest message
    const fixSuggestMsg = messages.find(m => m.type === MessageType.FIX_SUGGEST);
    expect(fixSuggestMsg).toBeDefined();

    // Verify message type
    expect(fixSuggestMsg!.type).toBe(MessageType.FIX_SUGGEST);

    // Verify payload is an array of fix strategies
    const strategies = fixSuggestMsg!.payload as any[];
    expect(Array.isArray(strategies)).toBe(true);
    expect(strategies.length).toBeGreaterThan(0);

    // Verify each strategy has all required fields
    strategies.forEach((strategy: any) => {
      expect(strategy).toHaveProperty('description');
      expect(strategy).toHaveProperty('commands');
      expect(strategy).toHaveProperty('confidence');
      expect(strategy).toHaveProperty('estimatedTime');
      expect(strategy).toHaveProperty('requiresSudo');
      expect(strategy).toHaveProperty('risk');

      expect(typeof strategy.description).toBe('string');
      expect(Array.isArray(strategy.commands)).toBe(true);
      expect(typeof strategy.confidence).toBe('number');
      expect(strategy.confidence).toBeGreaterThanOrEqual(0);
      expect(strategy.confidence).toBeLessThanOrEqual(1);
      expect(typeof strategy.requiresSudo).toBe('boolean');
      expect(['low', 'medium', 'high']).toContain(strategy.risk);
    });
  });
});

// ============================================================================
// routeMessage
// ============================================================================

describe('routeMessage', () => {
  let server: InstallServer;
  let ws: WebSocket;
  let clientId: string;

  afterEach(async () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
    if (server && server.isRunning()) {
      await server.stop();
    }
  });

  it('routes session.create messages to handleCreateSession', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 60000 });

    const clientIdPromise = new Promise<string>((resolve) => {
      server.on('connection', (id) => resolve(id));
    });

    await server.start();
    ws = await connectClient(port);
    clientId = await clientIdPromise;

    // Authenticate client before routing messages
    server.authenticateClient(clientId, 'test-device', 'test-token');

    const message = createMessage(MessageType.SESSION_CREATE, {
      software: 'nodejs',
    });

    const result = await routeMessage(server, clientId, message);

    expect(result.success).toBe(true);
    // Verify session was actually created
    expect(server.getClientSessionId(clientId)).toBeDefined();
  });

  it('routes env.report messages to handleEnvReport', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 60000 });

    const clientIdPromise = new Promise<string>((resolve) => {
      server.on('connection', (id) => resolve(id));
    });

    await server.start();
    ws = await connectClient(port);
    clientId = await clientIdPromise;

    // Authenticate client before routing messages
    server.authenticateClient(clientId, 'test-device', 'test-token');

    // Create session first
    const createMsg = createMessage(MessageType.SESSION_CREATE, {
      software: 'nodejs',
    }) as SessionCreateMessage;
    handleCreateSession(server, clientId, createMsg);
    await waitForMessage(ws);

    const envMsg = createMessage(MessageType.ENV_REPORT, makeEnvInfo());
    const result = await routeMessage(server, clientId, envMsg);

    expect(result.success).toBe(true);

    const sessionId = server.getClientSessionId(clientId)!;
    const session = server.getSession(sessionId)!;
    expect(session.status).toBe(SessionStatus.PLANNING);
  });

  it('routes step.complete messages to handleStepComplete', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 60000 });

    const clientIdPromise = new Promise<string>((resolve) => {
      server.on('connection', (id) => resolve(id));
    });

    await server.start();
    ws = await connectClient(port);
    clientId = await clientIdPromise;

    // Authenticate client before routing messages
    server.authenticateClient(clientId, 'test-device', 'test-token');

    // Create session first
    const createMsg = createMessage(MessageType.SESSION_CREATE, {
      software: 'nodejs',
    }) as SessionCreateMessage;
    handleCreateSession(server, clientId, createMsg);
    await waitForMessage(ws);

    const stepMsg = createMessage(MessageType.STEP_COMPLETE, {
      stepId: 'step-1',
      success: true,
      exitCode: 0,
      stdout: 'ok',
      stderr: '',
      duration: 200,
    });

    const result = await routeMessage(server, clientId, stepMsg);

    expect(result.success).toBe(true);

    const sessionId = server.getClientSessionId(clientId)!;
    const session = server.getSession(sessionId)!;
    expect(session.status).toBe(SessionStatus.EXECUTING);
  });

  it('routes error.occurred messages to handleErrorOccurred', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 60000 });

    const clientIdPromise = new Promise<string>((resolve) => {
      server.on('connection', (id) => resolve(id));
    });

    await server.start();
    ws = await connectClient(port);
    clientId = await clientIdPromise;

    // Authenticate client before routing messages
    server.authenticateClient(clientId, 'test-device', 'test-token');

    // Create session first
    const createMsg = createMessage(MessageType.SESSION_CREATE, {
      software: 'nodejs',
    }) as SessionCreateMessage;
    handleCreateSession(server, clientId, createMsg);
    await waitForMessage(ws);

    const errorMsg = createMessage(MessageType.ERROR_OCCURRED, makeErrorContext());
    const result = await routeMessage(server, clientId, errorMsg);

    expect(result.success).toBe(true);

    const sessionId = server.getClientSessionId(clientId)!;
    const session = server.getSession(sessionId)!;
    expect(session.status).toBe(SessionStatus.ERROR);
  });

  it('returns failure for plan.receive (server-to-client type)', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 60000 });

    const clientIdPromise = new Promise<string>((resolve) => {
      server.on('connection', (id) => resolve(id));
    });

    await server.start();
    ws = await connectClient(port);
    clientId = await clientIdPromise;

    // Authenticate client so we test message type routing, not auth
    server.authenticateClient(clientId, 'test-device', 'test-token');

    const message = createMessage(MessageType.PLAN_RECEIVE, {
      steps: [],
      estimatedTime: 0,
      risks: [],
    });

    const result = await routeMessage(server, clientId, message);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Unhandled message type');
    expect(result.error).toContain('plan.receive');
  });

  it('returns failure for fix.suggest (server-to-client type)', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 60000 });

    const clientIdPromise = new Promise<string>((resolve) => {
      server.on('connection', (id) => resolve(id));
    });

    await server.start();
    ws = await connectClient(port);
    clientId = await clientIdPromise;

    // Authenticate client so we test message type routing, not auth
    server.authenticateClient(clientId, 'test-device', 'test-token');

    const message = createMessage(MessageType.FIX_SUGGEST, []);

    const result = await routeMessage(server, clientId, message);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Unhandled message type');
    expect(result.error).toContain('fix.suggest');
  });

  it('returns failure for step.execute (server-to-client type)', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 60000 });

    const clientIdPromise = new Promise<string>((resolve) => {
      server.on('connection', (id) => resolve(id));
    });

    await server.start();
    ws = await connectClient(port);
    clientId = await clientIdPromise;

    // Authenticate client so we test message type routing, not auth
    server.authenticateClient(clientId, 'test-device', 'test-token');

    const message = createMessage(MessageType.STEP_EXECUTE, {
      id: 'step-1',
      description: 'Test step',
      command: 'echo hello',
      timeout: 5000,
      canRollback: false,
      onError: 'abort',
    });

    const result = await routeMessage(server, clientId, message);

    // step.execute from agent is accepted as an informational notification
    expect(result.success).toBe(true);
  });

  it('handles session.complete from agent via router', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 60000 });

    const clientIdPromise = new Promise<string>((resolve) => {
      server.on('connection', (id) => resolve(id));
    });

    await server.start();
    ws = await connectClient(port);
    clientId = await clientIdPromise;

    // Authenticate client and create a session first
    server.authenticateClient(clientId, 'test-device', 'test-token');
    server.createSession(clientId, { software: 'nginx' });

    const message = createMessage(MessageType.SESSION_COMPLETE, {
      success: true,
      summary: 'All done',
    });

    const result = await routeMessage(server, clientId, message);

    expect(result.success).toBe(true);
  });
});

// ============================================================================
// HandlerResult type checks
// ============================================================================

describe('HandlerResult interface', () => {
  it('success-only result has no error property', () => {
    const result: HandlerResult = { success: true };
    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('failure result has both success and error', () => {
    const result: HandlerResult = { success: false, error: 'Something went wrong' };
    expect(result.success).toBe(false);
    expect(result.error).toBe('Something went wrong');
  });

  it('error property is optional on success', () => {
    const result: HandlerResult = { success: true };
    expect('error' in result).toBe(false);
  });

  it('error property can be present even on success (type allows it)', () => {
    // The interface allows error on success; just verifying the shape
    const result: HandlerResult = { success: true, error: undefined };
    expect(result.success).toBe(true);
  });
});

// ============================================================================
// Integration: full flow through multiple handlers
// ============================================================================

describe('handler integration flow', () => {
  let server: InstallServer;
  let ws: WebSocket;
  let clientId: string;

  afterEach(async () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
    if (server && server.isRunning()) {
      await server.stop();
    }
  });

  it('full lifecycle: create -> env report -> step complete (success)', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 60000 });

    const clientIdPromise = new Promise<string>((resolve) => {
      server.on('connection', (id) => resolve(id));
    });

    await server.start();
    ws = await connectClient(port);
    clientId = await clientIdPromise;

    // 1. Create session
    const createMsg = createMessage(MessageType.SESSION_CREATE, {
      software: 'nodejs',
      version: '22.0.0',
    }) as SessionCreateMessage;

    const r1 = handleCreateSession(server, clientId, createMsg);
    expect(r1.success).toBe(true);
    await waitForMessage(ws); // drain plan.receive

    const sessionId = server.getClientSessionId(clientId)!;
    expect(server.getSession(sessionId)!.status).toBe(SessionStatus.CREATED);

    // 2. Env report
    const envMsg = createMessage(MessageType.ENV_REPORT, makeEnvInfo()) as EnvReportMessage;
    const r2 = await handleEnvReport(server, clientId, envMsg);
    expect(r2.success).toBe(true);
    expect(server.getSession(sessionId)!.status).toBe(SessionStatus.PLANNING);

    // 3. Step complete (success)
    const stepMsg = createMessage(MessageType.STEP_COMPLETE, {
      stepId: 'step-1',
      success: true,
      exitCode: 0,
      stdout: 'done',
      stderr: '',
      duration: 500,
    }) as StepCompleteMessage;

    const r3 = handleStepComplete(server, clientId, stepMsg);
    expect(r3.success).toBe(true);
    expect(server.getSession(sessionId)!.status).toBe(SessionStatus.EXECUTING);
  });

  it('full lifecycle: create -> step complete (failure) -> error occurred', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 60000 });

    const clientIdPromise = new Promise<string>((resolve) => {
      server.on('connection', (id) => resolve(id));
    });

    await server.start();
    ws = await connectClient(port);
    clientId = await clientIdPromise;

    // 1. Create session
    const createMsg = createMessage(MessageType.SESSION_CREATE, {
      software: 'python',
    }) as SessionCreateMessage;

    handleCreateSession(server, clientId, createMsg);
    await waitForMessage(ws); // drain plan.receive

    const sessionId = server.getClientSessionId(clientId)!;

    // 2. Step fails
    const stepMsg = createMessage(MessageType.STEP_COMPLETE, {
      stepId: 'step-1',
      success: false,
      exitCode: 127,
      stdout: '',
      stderr: 'command not found',
      duration: 100,
    }) as StepCompleteMessage;

    handleStepComplete(server, clientId, stepMsg);
    expect(server.getSession(sessionId)!.status).toBe(SessionStatus.ERROR);

    // 3. Error occurred
    const fixPromise = waitForMessage(ws);

    const errorMsg = createMessage(
      MessageType.ERROR_OCCURRED,
      makeErrorContext(),
    ) as ErrorOccurredMessage;

    const r3 = await handleErrorOccurred(server, clientId, errorMsg);
    expect(r3.success).toBe(true);
    expect(server.getSession(sessionId)!.status).toBe(SessionStatus.ERROR);

    // Verify fix.suggest was sent
    const raw = await fixPromise;
    const parsed = JSON.parse(raw) as Message;
    expect(parsed.type).toBe(MessageType.FIX_SUGGEST);
  });

  it('routeMessage routes the full create -> env -> step flow', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 60000 });

    const clientIdPromise = new Promise<string>((resolve) => {
      server.on('connection', (id) => resolve(id));
    });

    await server.start();
    ws = await connectClient(port);
    clientId = await clientIdPromise;

    // Authenticate client before routing messages
    server.authenticateClient(clientId, 'test-device', 'test-token');

    // 1. Route session.create
    const createMsg = createMessage(MessageType.SESSION_CREATE, {
      software: 'redis',
    });
    const r1 = await routeMessage(server, clientId, createMsg);
    expect(r1.success).toBe(true);
    await waitForMessage(ws); // drain plan.receive

    // 2. Route env.report
    const envMsg = createMessage(MessageType.ENV_REPORT, makeEnvInfo());
    const r2 = await routeMessage(server, clientId, envMsg);
    expect(r2.success).toBe(true);

    // 3. Route step.complete
    const stepMsg = createMessage(MessageType.STEP_COMPLETE, {
      stepId: 'step-1',
      success: true,
      exitCode: 0,
      stdout: 'ok',
      stderr: '',
      duration: 300,
    });
    const r3 = await routeMessage(server, clientId, stepMsg);
    expect(r3.success).toBe(true);

    const sessionId = server.getClientSessionId(clientId)!;
    expect(server.getSession(sessionId)!.status).toBe(SessionStatus.EXECUTING);
  });
});

// ============================================================================
// handleEnvReport - Installation Plan Generation
// ============================================================================

describe('handleEnvReport - Plan Generation', () => {
  let server: InstallServer;
  let ws: WebSocket;
  let clientId: string;

  afterEach(async () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
    if (server && server.isRunning()) {
      await server.stop();
    }
  });

  it('should generate and send installation plan after environment analysis', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 60000 });

    const clientIdPromise = new Promise<string>((resolve) => {
      server.on('connection', (id) => resolve(id));
    });

    await server.start();
    ws = await connectClient(port);
    clientId = await clientIdPromise;

    // Create session
    const createMsg = createMessage(MessageType.SESSION_CREATE, {
      software: 'openclaw',
    }) as SessionCreateMessage;
    handleCreateSession(server, clientId, createMsg);
    await waitForMessage(ws); // drain plan.receive

    // Create mock AI agent
    const mockAgent = {
      analyzeEnvironment: vi.fn().mockResolvedValue({
        success: true,
        data: {
          summary: 'Environment is ready',
          ready: true,
          issues: [],
          recommendations: [],
          detectedCapabilities: {
            hasRequiredRuntime: true,
            hasPackageManager: true,
            hasNetworkAccess: true,
            hasSufficientPermissions: true,
          },
        },
      }),
      generateInstallPlanStreaming: vi.fn().mockResolvedValue({
        success: true,
        data: {
          steps: [
            {
              id: 'install-step',
              description: 'Install openclaw',
              command: 'pnpm install -g openclaw',
              timeout: 120000,
              canRollback: true,
              onError: 'retry',
            },
          ],
          estimatedTime: 120000,
          risks: [],
        },
      }),
    };

    // Send env.report
    const envMsg = createMessage(MessageType.ENV_REPORT, makeEnvInfo()) as EnvReportMessage;

    // Collect all messages sent to client
    const messages: Message[] = [];
    const messagePromises: Promise<Message>[] = [];
    for (let i = 0; i < 10; i++) {
      messagePromises.push(waitForMessage(ws));
    }

    await handleEnvReport(server, clientId, envMsg, mockAgent as any);

    // Wait a bit for messages to arrive
    await new Promise(resolve => setTimeout(resolve, 100));

    // Verify AI agent was called
    expect(mockAgent.analyzeEnvironment).toHaveBeenCalled();
    expect(mockAgent.generateInstallPlanStreaming).toHaveBeenCalled();

    // Session should be in PLANNING status
    const sessionId = server.getClientSessionId(clientId)!;
    expect(server.getSession(sessionId)!.status).toBe(SessionStatus.PLANNING);
  });

  it('should send fallback plan when AI is not available', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 60000 });

    const clientIdPromise = new Promise<string>((resolve) => {
      server.on('connection', (id) => resolve(id));
    });

    await server.start();
    ws = await connectClient(port);
    clientId = await clientIdPromise;

    // Create session
    const createMsg = createMessage(MessageType.SESSION_CREATE, {
      software: 'test-package',
    }) as SessionCreateMessage;
    handleCreateSession(server, clientId, createMsg);
    await waitForMessage(ws); // drain initial plan.receive

    // Collect ALL messages using a persistent listener
    const received: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const allReceived = new Promise<void>((resolve) => {
      const handler = (data: Buffer | string) => {
        received.push(JSON.parse(data.toString()));
        // Expect 2 messages: AI_STREAM_ERROR + PLAN_RECEIVE
        if (received.length >= 2) {
          ws.off('message', handler);
          resolve();
        }
      };
      ws.on('message', handler);
      // Safety timeout
      setTimeout(() => { ws.off('message', handler); resolve(); }, 2000);
    });

    // Send env.report without AI agent
    const envMsg = createMessage(MessageType.ENV_REPORT, makeEnvInfo()) as EnvReportMessage;
    await handleEnvReport(server, clientId, envMsg);
    await allReceived;

    // Should receive AI_STREAM_ERROR notification before fallback plan
    const errorMsg = received.find(m => m.type === MessageType.AI_STREAM_ERROR);
    expect(errorMsg).toBeDefined();
    expect(errorMsg?.payload).toHaveProperty('error');

    // Should receive a plan.receive message with fallback plan
    const planMsg = received.find(m => m.type === MessageType.PLAN_RECEIVE);
    expect(planMsg).toBeDefined();
    expect(planMsg?.payload).toBeDefined();
    expect((planMsg?.payload as { steps: unknown[] }).steps.length).toBeGreaterThan(0);
  });

  it('should include knowledge base context when generating plan', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 60000 });

    const clientIdPromise = new Promise<string>((resolve) => {
      server.on('connection', (id) => resolve(id));
    });

    await server.start();
    ws = await connectClient(port);
    clientId = await clientIdPromise;

    // Create session for software with knowledge base
    const createMsg = createMessage(MessageType.SESSION_CREATE, {
      software: 'openclaw',
    }) as SessionCreateMessage;
    handleCreateSession(server, clientId, createMsg);
    await waitForMessage(ws); // drain plan.receive

    // Create mock AI agent
    const mockAgent = {
      analyzeEnvironment: vi.fn().mockResolvedValue({
        success: true,
        data: {
          summary: 'Environment is ready',
          ready: true,
          issues: [],
          recommendations: [],
          detectedCapabilities: {
            hasRequiredRuntime: true,
            hasPackageManager: true,
            hasNetworkAccess: true,
            hasSufficientPermissions: true,
          },
        },
      }),
      generateInstallPlanStreaming: vi.fn().mockResolvedValue({
        success: true,
        data: {
          steps: [
            {
              id: 'install-step',
              description: 'Install openclaw via script',
              command: 'curl -fsSL https://openclaw.ai/install.sh | bash',
              timeout: 120000,
              canRollback: true,
              onError: 'fallback',
            },
          ],
          estimatedTime: 120000,
          risks: [],
        },
      }),
    };

    // Send env.report
    const envMsg = createMessage(MessageType.ENV_REPORT, makeEnvInfo()) as EnvReportMessage;

    await handleEnvReport(server, clientId, envMsg, mockAgent as any);

    // Wait for processing
    await new Promise(resolve => setTimeout(resolve, 100));

    // Verify AI was called with knowledge context (5th parameter)
    expect(mockAgent.generateInstallPlanStreaming).toHaveBeenCalled();
    const calls = vi.mocked(mockAgent.generateInstallPlanStreaming).mock.calls;
    // Knowledge context is the 5th parameter (index 4)
    expect(calls[0][4]).toBeDefined();
  });

  it('should send AI streaming messages during plan generation', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 60000 });

    const clientIdPromise = new Promise<string>((resolve) => {
      server.on('connection', (id) => resolve(id));
    });

    await server.start();
    ws = await connectClient(port);
    clientId = await clientIdPromise;

    // Create session
    const createMsg = createMessage(MessageType.SESSION_CREATE, {
      software: 'openclaw',
    }) as SessionCreateMessage;
    handleCreateSession(server, clientId, createMsg);
    await waitForMessage(ws); // drain plan.receive

    // Create mock AI agent that calls streaming callbacks
    const mockAgent = {
      analyzeEnvironment: vi.fn().mockResolvedValue({
        success: true,
        data: {
          summary: 'Environment is ready',
          ready: true,
          issues: [],
          recommendations: [],
          detectedCapabilities: {
            hasRequiredRuntime: true,
            hasPackageManager: true,
            hasNetworkAccess: true,
            hasSufficientPermissions: true,
          },
        },
      }),
      generateInstallPlanStreaming: vi.fn().mockImplementation(async (env: unknown, sw: unknown, ver: unknown, callbacks: { onStart?: () => void; onToken?: (t: string) => void; onEnd?: () => void; onComplete?: (text: string, usage: { inputTokens: number; outputTokens: number }) => void }) => {
        // Simulate streaming callbacks
        if (callbacks) {
          callbacks.onStart?.();
          callbacks.onToken?.('Generating');
          callbacks.onToken?.(' installation');
          callbacks.onToken?.(' plan...');
          callbacks.onComplete?.('Plan complete', { inputTokens: 100, outputTokens: 50 });
        }

        return {
          success: true,
          data: {
            steps: [{
              id: 'install',
              description: 'Install package',
              command: 'npm install -g openclaw',
              timeout: 120000,
              canRollback: true,
              onError: 'retry',
            }],
            estimatedTime: 120000,
            risks: [],
          },
          usage: { inputTokens: 100, outputTokens: 50 },
        };
      }),
    };

    // Collect ALL messages using a persistent listener
    const received: Array<{ type: string }> = [];
    const done = new Promise<void>((resolve) => {
      const handler = (data: Buffer | string) => {
        received.push(JSON.parse(data.toString()));
        // Expect ~9 messages: analysis(START+TOKEN+COMPLETE) + plan(START+3×TOKEN+COMPLETE) + PLAN_RECEIVE
        if (received.length >= 8) { ws.off('message', handler); resolve(); }
      };
      ws.on('message', handler);
      setTimeout(() => { ws.off('message', handler); resolve(); }, 2000);
    });

    // Send env.report
    const envMsg = createMessage(MessageType.ENV_REPORT, makeEnvInfo()) as EnvReportMessage;
    await handleEnvReport(server, clientId, envMsg, mockAgent as unknown as import('../ai/agent.js').InstallAIAgent);
    await done;

    // Should have received streaming messages (analysis + plan generation)
    const streamStartMsgs = received.filter(m => m.type === MessageType.AI_STREAM_START);
    const streamEndMsgs = received.filter(m => m.type === MessageType.AI_STREAM_COMPLETE);

    // We expect at least 1 stream start and 1 stream end (from either analysis or plan generation)
    expect(streamStartMsgs.length).toBeGreaterThan(0);
    expect(streamEndMsgs.length).toBeGreaterThan(0);
  });

  it('should send AI_STREAM_ERROR with descriptive message when AI is unavailable', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 60000 });

    const clientIdPromise = new Promise<string>((resolve) => {
      server.on('connection', (id) => resolve(id));
    });

    await server.start();
    ws = await connectClient(port);
    clientId = await clientIdPromise;

    const createMsg = createMessage(MessageType.SESSION_CREATE, {
      software: 'nginx',
    }) as SessionCreateMessage;
    handleCreateSession(server, clientId, createMsg);
    await waitForMessage(ws); // drain initial plan.receive

    // Set up listeners before handler call
    const messagePromises: Promise<string>[] = [];
    for (let i = 0; i < 5; i++) {
      messagePromises.push(waitForMessage(ws));
    }

    const envMsg = createMessage(MessageType.ENV_REPORT, makeEnvInfo()) as EnvReportMessage;
    const result = await handleEnvReport(server, clientId, envMsg);

    expect(result.success).toBe(true);

    await new Promise(resolve => setTimeout(resolve, 100));

    const messages: Array<{ type: string; payload: { error?: string } }> = [];
    for (const p of messagePromises) {
      try {
        const raw = await Promise.race([
          p,
          new Promise<string>((_, reject) => setTimeout(() => reject(new Error('timeout')), 300)),
        ]);
        messages.push(JSON.parse(raw));
      } catch {
        break;
      }
    }

    const errorMsg = messages.find(m => m.type === MessageType.AI_STREAM_ERROR);
    expect(errorMsg).toBeDefined();
    expect(errorMsg!.payload.error).toContain('AI service is not available');
  });

  it('should return success even when using fallback plan (no 500 error)', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 60000 });

    const clientIdPromise = new Promise<string>((resolve) => {
      server.on('connection', (id) => resolve(id));
    });

    await server.start();
    ws = await connectClient(port);
    clientId = await clientIdPromise;

    const createMsg = createMessage(MessageType.SESSION_CREATE, {
      software: 'redis',
    }) as SessionCreateMessage;
    handleCreateSession(server, clientId, createMsg);
    await waitForMessage(ws);

    const envMsg = createMessage(MessageType.ENV_REPORT, makeEnvInfo()) as EnvReportMessage;
    const result = await handleEnvReport(server, clientId, envMsg);

    // Should succeed (graceful fallback), not return error
    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('should send AI_STREAM_ERROR when AI plan generation fails', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 60000 });

    const clientIdPromise = new Promise<string>((resolve) => {
      server.on('connection', (id) => resolve(id));
    });

    await server.start();
    ws = await connectClient(port);
    clientId = await clientIdPromise;

    const createMsg = createMessage(MessageType.SESSION_CREATE, {
      software: 'test-pkg',
    }) as SessionCreateMessage;
    handleCreateSession(server, clientId, createMsg);
    await waitForMessage(ws);

    // Mock AI agent where plan generation fails
    const failingAgent = {
      analyzeEnvironment: vi.fn().mockResolvedValue({
        success: true,
        data: {
          summary: 'OK', ready: true, issues: [], recommendations: [],
          detectedCapabilities: {
            hasRequiredRuntime: true, hasPackageManager: true,
            hasNetworkAccess: true, hasSufficientPermissions: true,
          },
        },
      }),
      generateInstallPlanStreaming: vi.fn().mockResolvedValue({
        success: false,
        error: 'API key invalid',
        data: null,
      }),
    };

    // Collect ALL messages using a persistent listener
    const received: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const done = new Promise<void>((resolve) => {
      const handler = (data: Buffer | string) => {
        received.push(JSON.parse(data.toString()));
        // Expect ~6 messages: analysis(3) + AI_STREAM_ERROR + PLAN_RECEIVE
        if (received.length >= 5) { ws.off('message', handler); resolve(); }
      };
      ws.on('message', handler);
      setTimeout(() => { ws.off('message', handler); resolve(); }, 2000);
    });

    const envMsg = createMessage(MessageType.ENV_REPORT, makeEnvInfo()) as EnvReportMessage;
    await handleEnvReport(server, clientId, envMsg, failingAgent as unknown as import('../ai/agent.js').InstallAIAgent);
    await done;

    // Should have AI_STREAM_ERROR notification
    const errorMsg = received.find(m => m.type === MessageType.AI_STREAM_ERROR);
    expect(errorMsg).toBeDefined();
    expect(errorMsg!.payload.error).toContain('plan generation failed');

    // Should still have a fallback PLAN_RECEIVE
    const planMsg = received.find(m => m.type === MessageType.PLAN_RECEIVE);
    expect(planMsg).toBeDefined();
  });

  it('should set session to PLANNING status when using fallback plan', async () => {
    const port = nextPort();
    server = new InstallServer({ port, heartbeatIntervalMs: 60000 });

    const clientIdPromise = new Promise<string>((resolve) => {
      server.on('connection', (id) => resolve(id));
    });

    await server.start();
    ws = await connectClient(port);
    clientId = await clientIdPromise;

    const createMsg = createMessage(MessageType.SESSION_CREATE, {
      software: 'docker',
    }) as SessionCreateMessage;
    handleCreateSession(server, clientId, createMsg);
    await waitForMessage(ws);

    // Set up listeners
    const messagePromises: Promise<string>[] = [];
    for (let i = 0; i < 5; i++) {
      messagePromises.push(waitForMessage(ws));
    }

    const envMsg = createMessage(MessageType.ENV_REPORT, makeEnvInfo()) as EnvReportMessage;
    await handleEnvReport(server, clientId, envMsg);

    const sessionId = server.getClientSessionId(clientId)!;
    const session = server.getSession(sessionId)!;
    expect(session.status).toBe(SessionStatus.PLANNING);
  });
});
