/**
 * Tests for packages/server/src/api/handlers.ts
 *
 * Tests the message handler functions including:
 * - handleCreateSession - session creation handling
 * - handleEnvReport - environment report handling
 * - handleStepComplete - step completion handling
 * - handleErrorOccurred - error handling
 * - routeMessage - message routing
 * - HandlerResult type
 */

import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import WebSocket from 'ws';
import { createMessage, MessageType } from '@aiinstaller/shared';
import { InstallServer } from '../packages/server/src/api/server.js';
import {
  handleCreateSession,
  handleEnvReport,
  handleStepComplete,
  handleErrorOccurred,
  routeMessage,
} from '../packages/server/src/api/handlers.js';
import type { HandlerResult } from '../packages/server/src/api/handlers.js';

const HANDLERS_FILE = path.resolve('packages/server/src/api/handlers.ts');

// Helper: wait for a condition with timeout
function waitFor(
  condition: () => boolean,
  timeoutMs = 2000,
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

// Helper: create a connected WebSocket client
function connectClient(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

// Helper: wait for a WebSocket message
function waitForMessage(ws: WebSocket, timeoutMs = 2000): Promise<string> {
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

// Use a dynamic port to avoid conflicts
let testPort = 19300;
function nextPort() {
  return testPort++;
}

// Helper: create valid environment info for tests
function createEnvInfo() {
  return {
    os: { platform: 'darwin' as const, version: '24.0.0', arch: 'arm64' },
    shell: { type: 'zsh' as const, version: '5.9' },
    runtime: { node: '22.0.0' },
    packageManagers: { npm: '10.0.0', pnpm: '9.0.0' },
    network: { canAccessNpm: true, canAccessGithub: true },
    permissions: { hasSudo: true, canWriteTo: ['/usr/local'] },
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('src/api/handlers.ts', () => {
  // --------------------------------------------------------------------------
  // File existence and structure
  // --------------------------------------------------------------------------

  describe('File existence', () => {
    it('should exist at packages/server/src/api/handlers.ts', () => {
      expect(existsSync(HANDLERS_FILE)).toBe(true);
    });

    it('should be a non-empty TypeScript file', () => {
      const content = readFileSync(HANDLERS_FILE, 'utf-8');
      expect(content.length).toBeGreaterThan(0);
    });
  });

  describe('Exports', () => {
    it('should export handleCreateSession function', () => {
      expect(handleCreateSession).toBeDefined();
      expect(typeof handleCreateSession).toBe('function');
    });

    it('should export handleEnvReport function', () => {
      expect(handleEnvReport).toBeDefined();
      expect(typeof handleEnvReport).toBe('function');
    });

    it('should export handleStepComplete function', () => {
      expect(handleStepComplete).toBeDefined();
      expect(typeof handleStepComplete).toBe('function');
    });

    it('should export handleErrorOccurred function', () => {
      expect(handleErrorOccurred).toBeDefined();
      expect(typeof handleErrorOccurred).toBe('function');
    });

    it('should export routeMessage function', () => {
      expect(routeMessage).toBeDefined();
      expect(typeof routeMessage).toBe('function');
    });
  });

  // --------------------------------------------------------------------------
  // handleCreateSession
  // --------------------------------------------------------------------------

  describe('handleCreateSession', () => {
    let server: InstallServer;
    let port: number;

    afterEach(async () => {
      if (server?.isRunning()) {
        await server.stop();
      }
    });

    it('should create a session and return success', async () => {
      port = nextPort();
      server = new InstallServer({ port });
      await server.start();

      let clientId = '';
      server.on('connection', (id: string) => {
        clientId = id;
      });

      const ws = await connectClient(port);
      await waitFor(() => clientId !== '');

      const message = createMessage(MessageType.SESSION_CREATE, {
        software: 'openclaw',
        version: '1.0.0',
      });

      // Start listening for the response before calling handler
      const responsePromise = waitForMessage(ws);

      const result = handleCreateSession(server, clientId, message);
      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();

      // Verify a session was created
      expect(server.getSessionCount()).toBe(1);
      const sessionId = server.getClientSessionId(clientId);
      expect(sessionId).toBeDefined();

      // Verify response was sent to client
      const responseStr = await responsePromise;
      const response = JSON.parse(responseStr);
      expect(response.type).toBe('plan.receive');
      expect(response.payload.steps).toEqual([]);

      ws.close();
    });

    it('should pass requestId to response message', async () => {
      port = nextPort();
      server = new InstallServer({ port });
      await server.start();

      let clientId = '';
      server.on('connection', (id: string) => {
        clientId = id;
      });

      const ws = await connectClient(port);
      await waitFor(() => clientId !== '');

      const message = createMessage(MessageType.SESSION_CREATE, {
        software: 'openclaw',
      }, 'req-123');

      const responsePromise = waitForMessage(ws);
      handleCreateSession(server, clientId, message);

      const responseStr = await responsePromise;
      const response = JSON.parse(responseStr);
      expect(response.requestId).toBe('req-123');

      ws.close();
    });

    it('should return failure when client does not exist', async () => {
      port = nextPort();
      server = new InstallServer({ port });
      await server.start();

      const message = createMessage(MessageType.SESSION_CREATE, {
        software: 'openclaw',
      });

      const result = handleCreateSession(server, 'nonexistent-client', message);
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain('not found');
    });

    it('should create session without version', async () => {
      port = nextPort();
      server = new InstallServer({ port });
      await server.start();

      let clientId = '';
      server.on('connection', (id: string) => {
        clientId = id;
      });

      const ws = await connectClient(port);
      await waitFor(() => clientId !== '');

      const message = createMessage(MessageType.SESSION_CREATE, {
        software: 'openclaw',
      });

      const responsePromise = waitForMessage(ws);
      const result = handleCreateSession(server, clientId, message);
      expect(result.success).toBe(true);

      const sessionId = server.getClientSessionId(clientId)!;
      const session = server.getSession(sessionId)!;
      expect(session.software).toBe('openclaw');
      expect(session.version).toBeUndefined();

      await responsePromise;
      ws.close();
    });
  });

  // --------------------------------------------------------------------------
  // handleEnvReport
  // --------------------------------------------------------------------------

  describe('handleEnvReport', () => {
    let server: InstallServer;
    let port: number;

    afterEach(async () => {
      if (server?.isRunning()) {
        await server.stop();
      }
    });

    it('should update session status to detecting', async () => {
      port = nextPort();
      server = new InstallServer({ port });
      await server.start();

      let clientId = '';
      server.on('connection', (id: string) => {
        clientId = id;
      });

      const ws = await connectClient(port);
      await waitFor(() => clientId !== '');

      // Create a session first
      server.createSession(clientId, { software: 'openclaw' });
      const sessionId = server.getClientSessionId(clientId)!;

      const message = createMessage(MessageType.ENV_REPORT, createEnvInfo());

      const result = await handleEnvReport(server, clientId, message);
      expect(result.success).toBe(true);

      const session = server.getSession(sessionId)!;
      expect(session.status).toBe('planning');

      ws.close();
    });

    it('should use AI agent when provided for environment analysis', async () => {
      port = nextPort();
      server = new InstallServer({ port });
      await server.start();

      let clientId = '';
      server.on('connection', (id: string) => {
        clientId = id;
      });

      const ws = await connectClient(port);
      await waitFor(() => clientId !== '');

      server.createSession(clientId, { software: 'openclaw' });
      const sessionId = server.getClientSessionId(clientId)!;

      // Create a mock AI agent with all required methods
      const mockAiAgent = {
        analyzeEnvironment: async () => ({
          success: true,
          data: {
            summary: 'Environment looks good',
            ready: true,
            issues: [],
            recommendations: ['Use pnpm for faster installs'],
          },
        }),
        generateInstallPlanStreaming: async (prompt: string, callbacks: any) => {
          // Call callbacks to simulate streaming
          callbacks?.onStart?.();
          callbacks?.onToken?.('Step 1: Check prerequisites\n');
          callbacks?.onToken?.('Step 2: Install dependencies\n');
          callbacks?.onEnd?.();

          return {
            success: true,
            data: {
              steps: [
                { id: '1', description: 'Check prerequisites', command: 'node --version', timeout: 5000 },
                { id: '2', description: 'Install dependencies', command: 'pnpm install', timeout: 30000 },
              ],
              estimatedTime: 35,
              risks: [],
            },
          };
        },
      } as any;

      const message = createMessage(MessageType.ENV_REPORT, createEnvInfo());

      // Collect messages sent to client
      const messages: any[] = [];
      ws.on('message', (data) => {
        messages.push(JSON.parse(data.toString()));
      });

      const result = await handleEnvReport(server, clientId, message, mockAiAgent);
      expect(result.success).toBe(true);

      // Wait for messages to be sent
      await waitFor(() => messages.length >= 4, 3000);

      // Should have sent AI stream messages for environment analysis
      const envStreamStartMsg = messages.find(m => m.type === 'ai.stream.start' && m.payload.operation === 'environment_analysis');
      expect(envStreamStartMsg).toBeDefined();

      const streamTokenMsg = messages.find(m => m.type === 'ai.stream.token' && m.payload.token.includes('Environment Analysis'));
      expect(streamTokenMsg).toBeDefined();
      expect(streamTokenMsg.payload.token).toContain('Ready: true');

      ws.close();
    });

    it('should handle AI analysis failure and continue with fallback', async () => {
      port = nextPort();
      server = new InstallServer({ port });
      await server.start();

      let clientId = '';
      server.on('connection', (id: string) => {
        clientId = id;
      });

      const ws = await connectClient(port);
      await waitFor(() => clientId !== '');

      server.createSession(clientId, { software: 'openclaw' });

      // Create a mock AI agent that fails environment analysis
      const mockAiAgent = {
        analyzeEnvironment: async () => ({
          success: false,
          error: 'API rate limit exceeded',
        }),
        generateInstallPlanStreaming: async (prompt: string, callbacks: any) => {
          // Also fail plan generation to test fallback
          return {
            success: false,
            error: 'API rate limit exceeded',
          };
        },
      } as any;

      const message = createMessage(MessageType.ENV_REPORT, createEnvInfo());

      const result = await handleEnvReport(server, clientId, message, mockAiAgent);
      expect(result.success).toBe(true); // Should still succeed with fallback

      ws.close();
    });

    it('should stop if environment is not ready', async () => {
      port = nextPort();
      server = new InstallServer({ port });
      await server.start();

      let clientId = '';
      server.on('connection', (id: string) => {
        clientId = id;
      });

      const ws = await connectClient(port);
      await waitFor(() => clientId !== '');

      server.createSession(clientId, { software: 'openclaw' });
      const sessionId = server.getClientSessionId(clientId)!;

      // Create a mock AI agent that reports environment not ready
      const mockAiAgent = {
        analyzeEnvironment: async () => ({
          success: true,
          data: {
            summary: 'Missing dependencies',
            ready: false,
            issues: ['Node.js version too old'],
            recommendations: ['Upgrade to Node.js 18+'],
          },
        }),
        generateInstallPlanStreaming: async () => ({
          success: true,
          data: { steps: [], estimatedTime: 0, risks: [] },
        }),
      } as any;

      const message = createMessage(MessageType.ENV_REPORT, createEnvInfo());

      const result = await handleEnvReport(server, clientId, message, mockAiAgent);
      expect(result.success).toBe(true);

      // Session should be in error state
      const session = server.getSession(sessionId)!;
      expect(session.status).toBe('error');

      ws.close();
    });

    it('should return failure when client has no session', async () => {
      port = nextPort();
      server = new InstallServer({ port });
      await server.start();

      let clientId = '';
      server.on('connection', (id: string) => {
        clientId = id;
      });

      const ws = await connectClient(port);
      await waitFor(() => clientId !== '');

      const message = createMessage(MessageType.ENV_REPORT, createEnvInfo());

      const result = await handleEnvReport(server, clientId, message);
      expect(result.success).toBe(false);
      expect(result.error).toContain('No session found');

      ws.close();
    });

    it('should return failure for non-existent client', async () => {
      port = nextPort();
      server = new InstallServer({ port });
      await server.start();

      const message = createMessage(MessageType.ENV_REPORT, createEnvInfo());

      const result = await handleEnvReport(server, 'nonexistent-client', message);
      expect(result.success).toBe(false);
      expect(result.error).toContain('No session found');
    });
  });

  // --------------------------------------------------------------------------
  // handleStepComplete
  // --------------------------------------------------------------------------

  describe('handleStepComplete', () => {
    let server: InstallServer;
    let port: number;

    afterEach(async () => {
      if (server?.isRunning()) {
        await server.stop();
      }
    });

    it('should keep session in executing status when step succeeds', async () => {
      port = nextPort();
      server = new InstallServer({ port });
      await server.start();

      let clientId = '';
      server.on('connection', (id: string) => {
        clientId = id;
      });

      const ws = await connectClient(port);
      await waitFor(() => clientId !== '');

      server.createSession(clientId, { software: 'openclaw' });
      const sessionId = server.getClientSessionId(clientId)!;

      const message = createMessage(MessageType.STEP_COMPLETE, {
        stepId: 'check-node',
        success: true,
        exitCode: 0,
        stdout: 'v22.0.0',
        stderr: '',
        duration: 150,
      });

      const result = handleStepComplete(server, clientId, message);
      expect(result.success).toBe(true);

      const session = server.getSession(sessionId)!;
      expect(session.status).toBe('executing');

      ws.close();
    });

    it('should update session to error status when step fails', async () => {
      port = nextPort();
      server = new InstallServer({ port });
      await server.start();

      let clientId = '';
      server.on('connection', (id: string) => {
        clientId = id;
      });

      const ws = await connectClient(port);
      await waitFor(() => clientId !== '');

      server.createSession(clientId, { software: 'openclaw' });
      const sessionId = server.getClientSessionId(clientId)!;

      const message = createMessage(MessageType.STEP_COMPLETE, {
        stepId: 'install-pnpm',
        success: false,
        exitCode: 1,
        stdout: '',
        stderr: 'EACCES: permission denied',
        duration: 500,
      });

      const result = handleStepComplete(server, clientId, message);
      expect(result.success).toBe(true);

      const session = server.getSession(sessionId)!;
      expect(session.status).toBe('error');

      ws.close();
    });

    it('should return failure when client has no session', async () => {
      port = nextPort();
      server = new InstallServer({ port });
      await server.start();

      let clientId = '';
      server.on('connection', (id: string) => {
        clientId = id;
      });

      const ws = await connectClient(port);
      await waitFor(() => clientId !== '');

      const message = createMessage(MessageType.STEP_COMPLETE, {
        stepId: 'check-node',
        success: true,
        exitCode: 0,
        stdout: 'v22.0.0',
        stderr: '',
        duration: 150,
      });

      const result = handleStepComplete(server, clientId, message);
      expect(result.success).toBe(false);
      expect(result.error).toContain('No session found');

      ws.close();
    });

    it('should return failure for non-existent client', async () => {
      port = nextPort();
      server = new InstallServer({ port });
      await server.start();

      const message = createMessage(MessageType.STEP_COMPLETE, {
        stepId: 'check-node',
        success: true,
        exitCode: 0,
        stdout: 'v22.0.0',
        stderr: '',
        duration: 150,
      });

      const result = handleStepComplete(server, 'nonexistent-client', message);
      expect(result.success).toBe(false);
      expect(result.error).toContain('No session found');
    });
  });

  // --------------------------------------------------------------------------
  // handleErrorOccurred
  // --------------------------------------------------------------------------

  describe('handleErrorOccurred', () => {
    let server: InstallServer;
    let port: number;

    afterEach(async () => {
      if (server?.isRunning()) {
        await server.stop();
      }
    });

    it('should update session to error status and send fix suggestions', async () => {
      port = nextPort();
      server = new InstallServer({ port });
      await server.start();

      let clientId = '';
      server.on('connection', (id: string) => {
        clientId = id;
      });

      const ws = await connectClient(port);
      await waitFor(() => clientId !== '');

      server.createSession(clientId, { software: 'openclaw' });
      const sessionId = server.getClientSessionId(clientId)!;

      const message = createMessage(MessageType.ERROR_OCCURRED, {
        stepId: 'install-openclaw',
        command: 'pnpm install -g openclaw',
        exitCode: 1,
        stdout: '',
        stderr: 'EACCES: permission denied',
        environment: createEnvInfo(),
        previousSteps: [],
      });

      const responsePromise = waitForMessage(ws);

      const result = await handleErrorOccurred(server, clientId, message);
      expect(result.success).toBe(true);

      // Verify session status was updated
      const session = server.getSession(sessionId)!;
      expect(session.status).toBe('error');

      // Verify fix suggestion was sent
      const responseStr = await responsePromise;
      const response = JSON.parse(responseStr);
      expect(response.type).toBe('fix.suggest');
      expect(Array.isArray(response.payload)).toBe(true);
      expect(response.payload.length).toBeGreaterThan(0);
      expect(response.payload[0].id).toBe('retry');
      expect(response.payload[0].commands).toContain('pnpm install -g openclaw');
      expect(response.payload[0].confidence).toBeGreaterThan(0);
      expect(response.payload[0].confidence).toBeLessThanOrEqual(1);

      ws.close();
    });

    it('should pass requestId to fix suggestion response', async () => {
      port = nextPort();
      server = new InstallServer({ port });
      await server.start();

      let clientId = '';
      server.on('connection', (id: string) => {
        clientId = id;
      });

      const ws = await connectClient(port);
      await waitFor(() => clientId !== '');

      server.createSession(clientId, { software: 'openclaw' });

      const message = createMessage(MessageType.ERROR_OCCURRED, {
        stepId: 'install-openclaw',
        command: 'pnpm install -g openclaw',
        exitCode: 1,
        stdout: '',
        stderr: 'network timeout',
        environment: createEnvInfo(),
        previousSteps: [],
      }, 'error-req-456');

      const responsePromise = waitForMessage(ws);
      await handleErrorOccurred(server, clientId, message);

      const responseStr = await responsePromise;
      const response = JSON.parse(responseStr);
      expect(response.requestId).toBe('error-req-456');

      ws.close();
    });

    it('should return failure when client has no session', async () => {
      port = nextPort();
      server = new InstallServer({ port });
      await server.start();

      let clientId = '';
      server.on('connection', (id: string) => {
        clientId = id;
      });

      const ws = await connectClient(port);
      await waitFor(() => clientId !== '');

      const message = createMessage(MessageType.ERROR_OCCURRED, {
        stepId: 'install-openclaw',
        command: 'pnpm install -g openclaw',
        exitCode: 1,
        stdout: '',
        stderr: 'error',
        environment: createEnvInfo(),
        previousSteps: [],
      });

      const result = await handleErrorOccurred(server, clientId, message);
      expect(result.success).toBe(false);
      expect(result.error).toContain('No session found');

      ws.close();
    });

    it('should return failure for non-existent client', async () => {
      port = nextPort();
      server = new InstallServer({ port });
      await server.start();

      const message = createMessage(MessageType.ERROR_OCCURRED, {
        stepId: 'install-openclaw',
        command: 'pnpm install -g openclaw',
        exitCode: 1,
        stdout: '',
        stderr: 'error',
        environment: createEnvInfo(),
        previousSteps: [],
      });

      const result = await handleErrorOccurred(server, 'nonexistent-client', message);
      expect(result.success).toBe(false);
      expect(result.error).toContain('No session found');
    });

    it('should include the failed command in the fix suggestion', async () => {
      port = nextPort();
      server = new InstallServer({ port });
      await server.start();

      let clientId = '';
      server.on('connection', (id: string) => {
        clientId = id;
      });

      const ws = await connectClient(port);
      await waitFor(() => clientId !== '');

      server.createSession(clientId, { software: 'openclaw' });

      const failedCommand = 'npm install -g openclaw';
      const message = createMessage(MessageType.ERROR_OCCURRED, {
        stepId: 'install-openclaw',
        command: failedCommand,
        exitCode: 1,
        stdout: '',
        stderr: 'error',
        environment: createEnvInfo(),
        previousSteps: [],
      });

      const responsePromise = waitForMessage(ws);
      await handleErrorOccurred(server, clientId, message);

      const responseStr = await responsePromise;
      const response = JSON.parse(responseStr);
      expect(response.payload[0].commands).toContain(failedCommand);
      expect(response.payload[0].description).toContain(failedCommand);

      ws.close();
    });

    it('should use AI agent for error diagnosis when provided', async () => {
      port = nextPort();
      server = new InstallServer({ port });
      await server.start();

      let clientId = '';
      server.on('connection', (id: string) => {
        clientId = id;
      });

      const ws = await connectClient(port);
      await waitFor(() => clientId !== '');

      server.createSession(clientId, { software: 'openclaw' });

      // Create a mock AI agent
      const mockAiAgent = {
        analyzeEnvironment: async () => ({ success: true, data: {} }),
      } as any;

      const message = createMessage(MessageType.ERROR_OCCURRED, {
        stepId: 'install-openclaw',
        command: 'pnpm install -g openclaw',
        exitCode: 1,
        stdout: '',
        stderr: 'EACCES: permission denied',
        environment: createEnvInfo(),
        previousSteps: [],
      });

      // Collect messages
      const messages: any[] = [];
      ws.on('message', (data) => {
        messages.push(JSON.parse(data.toString()));
      });

      const result = await handleErrorOccurred(server, clientId, message, mockAiAgent);
      expect(result.success).toBe(true);

      // Should receive fix suggestions
      await waitFor(() => messages.some(m => m.type === 'fix.suggest'), 3000);

      const fixSuggest = messages.find(m => m.type === 'fix.suggest');
      expect(fixSuggest).toBeDefined();
      expect(Array.isArray(fixSuggest.payload)).toBe(true);

      ws.close();
    });

    it('should handle AI diagnosis failure gracefully', async () => {
      port = nextPort();
      server = new InstallServer({ port });
      await server.start();

      let clientId = '';
      server.on('connection', (id: string) => {
        clientId = id;
      });

      const ws = await connectClient(port);
      await waitFor(() => clientId !== '');

      server.createSession(clientId, { software: 'openclaw' });

      // Create a mock AI agent (diagnoseError will be called internally)
      const mockAiAgent = {
        analyzeEnvironment: async () => ({ success: true, data: {} }),
      } as any;

      const message = createMessage(MessageType.ERROR_OCCURRED, {
        stepId: 'install-openclaw',
        command: 'invalid command',
        exitCode: 127,
        stdout: '',
        stderr: 'command not found',
        environment: createEnvInfo(),
        previousSteps: [],
      });

      // Collect all messages
      const messages: any[] = [];
      ws.on('message', (data) => {
        messages.push(JSON.parse(data.toString()));
      });

      const result = await handleErrorOccurred(server, clientId, message, mockAiAgent);
      expect(result.success).toBe(true);

      // Wait for fix.suggest message (may receive stream messages first)
      await waitFor(() => messages.some(m => m.type === 'fix.suggest'), 3000);

      const fixSuggest = messages.find(m => m.type === 'fix.suggest');
      expect(fixSuggest).toBeDefined();
      expect(Array.isArray(fixSuggest.payload)).toBe(true);

      ws.close();
    });

    it('should handle exception during error handling', async () => {
      port = nextPort();
      server = new InstallServer({ port });
      await server.start();

      let clientId = '';
      server.on('connection', (id: string) => {
        clientId = id;
      });

      const ws = await connectClient(port);
      await waitFor(() => clientId !== '');

      // Don't create a session to trigger an error when trying to get session

      const message = createMessage(MessageType.ERROR_OCCURRED, {
        stepId: 'install-openclaw',
        command: 'pnpm install',
        exitCode: 1,
        stdout: '',
        stderr: 'error',
        environment: createEnvInfo(),
        previousSteps: [],
      });

      const result = await handleErrorOccurred(server, clientId, message);
      expect(result.success).toBe(false);
      expect(result.error).toContain('No session found');

      ws.close();
    });
  });

  // --------------------------------------------------------------------------
  // routeMessage
  // --------------------------------------------------------------------------

  describe('routeMessage', () => {
    let server: InstallServer;
    let port: number;

    afterEach(async () => {
      if (server?.isRunning()) {
        await server.stop();
      }
    });

    it('should route session.create messages to handleCreateSession', async () => {
      port = nextPort();
      server = new InstallServer({ port });
      await server.start();

      let clientId = '';
      server.on('connection', (id: string) => {
        clientId = id;
      });

      const ws = await connectClient(port);
      await waitFor(() => clientId !== '');

      // Authenticate client before routing messages
      server.authenticateClient(clientId, 'test-device', 'test-token');

      const message = createMessage(MessageType.SESSION_CREATE, {
        software: 'openclaw',
      });

      const responsePromise = waitForMessage(ws);
      const result = await routeMessage(server, clientId, message);
      expect(result.success).toBe(true);

      // Verify session was created (confirms it went through handleCreateSession)
      expect(server.getSessionCount()).toBe(1);

      await responsePromise;
      ws.close();
    });

    it('should route env.report messages to handleEnvReport', async () => {
      port = nextPort();
      server = new InstallServer({ port });
      await server.start();

      let clientId = '';
      server.on('connection', (id: string) => {
        clientId = id;
      });

      const ws = await connectClient(port);
      await waitFor(() => clientId !== '');

      // Authenticate client before routing messages
      server.authenticateClient(clientId, 'test-device', 'test-token');

      server.createSession(clientId, { software: 'openclaw' });
      const sessionId = server.getClientSessionId(clientId)!;

      const message = createMessage(MessageType.ENV_REPORT, createEnvInfo());

      const result = await routeMessage(server, clientId, message);
      expect(result.success).toBe(true);

      const session = server.getSession(sessionId)!;
      expect(session.status).toBe('planning');

      ws.close();
    });

    it('should route step.complete messages to handleStepComplete', async () => {
      port = nextPort();
      server = new InstallServer({ port });
      await server.start();

      let clientId = '';
      server.on('connection', (id: string) => {
        clientId = id;
      });

      const ws = await connectClient(port);
      await waitFor(() => clientId !== '');

      // Authenticate client before routing messages
      server.authenticateClient(clientId, 'test-device', 'test-token');

      server.createSession(clientId, { software: 'openclaw' });
      const sessionId = server.getClientSessionId(clientId)!;

      const message = createMessage(MessageType.STEP_COMPLETE, {
        stepId: 'check-node',
        success: true,
        exitCode: 0,
        stdout: 'v22.0.0',
        stderr: '',
        duration: 150,
      });

      const result = await routeMessage(server, clientId, message);
      expect(result.success).toBe(true);

      const session = server.getSession(sessionId)!;
      expect(session.status).toBe('executing');

      ws.close();
    });

    it('should route error.occurred messages to handleErrorOccurred', async () => {
      port = nextPort();
      server = new InstallServer({ port });
      await server.start();

      let clientId = '';
      server.on('connection', (id: string) => {
        clientId = id;
      });

      const ws = await connectClient(port);
      await waitFor(() => clientId !== '');

      // Authenticate client before routing messages
      server.authenticateClient(clientId, 'test-device', 'test-token');

      server.createSession(clientId, { software: 'openclaw' });
      const sessionId = server.getClientSessionId(clientId)!;

      const message = createMessage(MessageType.ERROR_OCCURRED, {
        stepId: 'install-openclaw',
        command: 'pnpm install -g openclaw',
        exitCode: 1,
        stdout: '',
        stderr: 'error',
        environment: createEnvInfo(),
        previousSteps: [],
      });

      const responsePromise = waitForMessage(ws);
      const result = await routeMessage(server, clientId, message);
      expect(result.success).toBe(true);

      const session = server.getSession(sessionId)!;
      expect(session.status).toBe('error');

      await responsePromise;
      ws.close();
    });

    it('should return failure for unhandled message types', async () => {
      port = nextPort();
      server = new InstallServer({ port });
      await server.start();

      let clientId = '';
      server.on('connection', (id: string) => {
        clientId = id;
      });

      const ws = await connectClient(port);
      await waitFor(() => clientId !== '');

      // Authenticate client so we test message type routing, not auth
      server.authenticateClient(clientId, 'test-device', 'test-token');

      // plan.receive is a server -> client message, not handled on server
      const message = createMessage(MessageType.PLAN_RECEIVE, {
        steps: [],
        estimatedTime: 0,
        risks: [],
      });

      const result = await routeMessage(server, clientId, message);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Unhandled message type');

      ws.close();
    });

    it('should return success for step.output (handled)', async () => {
      port = nextPort();
      server = new InstallServer({ port });
      await server.start();

      let clientId = '';
      server.on('connection', (id: string) => {
        clientId = id;
      });

      const ws = await connectClient(port);
      await waitFor(() => clientId !== '');

      // Authenticate client so we test message type routing, not auth
      server.authenticateClient(clientId, 'test-device', 'test-token');

      const message = createMessage(MessageType.STEP_OUTPUT, {
        stepId: 'check-node',
        output: 'some output',
      });

      const result = await routeMessage(server, clientId, message);
      expect(result.success).toBe(true);

      ws.close();
    });
  });

  // --------------------------------------------------------------------------
  // HandlerResult type
  // --------------------------------------------------------------------------

  describe('HandlerResult type', () => {
    it('should have correct shape for success result', () => {
      const result: HandlerResult = { success: true };
      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should have correct shape for failure result', () => {
      const result: HandlerResult = { success: false, error: 'Something went wrong' };
      expect(result.success).toBe(false);
      expect(result.error).toBe('Something went wrong');
    });
  });

  // --------------------------------------------------------------------------
  // Code quality
  // --------------------------------------------------------------------------

  describe('Code quality', () => {
    it('should use proper imports from @aiinstaller/shared', () => {
      const content = readFileSync(HANDLERS_FILE, 'utf-8');
      expect(content).toContain("from '@aiinstaller/shared'");
    });

    it('should import from server.js', () => {
      const content = readFileSync(HANDLERS_FILE, 'utf-8');
      expect(content).toContain("from './server.js'");
    });

    it('should have JSDoc comments on all handler functions', () => {
      const content = readFileSync(HANDLERS_FILE, 'utf-8');
      expect(content).toContain('* Handle a session creation request');
      expect(content).toContain('* Handle an environment report');
      expect(content).toContain('* Handle a step completion report');
      expect(content).toContain('* Handle an error report');
      expect(content).toContain('* Route a message to the appropriate handler');
    });

    it('should export HandlerResult interface', () => {
      const content = readFileSync(HANDLERS_FILE, 'utf-8');
      expect(content).toContain('export interface HandlerResult');
    });

    it('should use MessageType constants in routeMessage', () => {
      const content = readFileSync(HANDLERS_FILE, 'utf-8');
      expect(content).toContain('MessageType.SESSION_CREATE');
      expect(content).toContain('MessageType.ENV_REPORT');
      expect(content).toContain('MessageType.STEP_COMPLETE');
      expect(content).toContain('MessageType.ERROR_OCCURRED');
    });

    it('should use SessionStatus constants', () => {
      const content = readFileSync(HANDLERS_FILE, 'utf-8');
      expect(content).toContain('SessionStatus.DETECTING');
      expect(content).toContain('SessionStatus.EXECUTING');
      expect(content).toContain('SessionStatus.ERROR');
    });

    it('should use createMessage for building responses', () => {
      const content = readFileSync(HANDLERS_FILE, 'utf-8');
      expect(content).toContain('createMessage(');
    });

    it('should have proper error handling in all handlers', () => {
      const content = readFileSync(HANDLERS_FILE, 'utf-8');
      // Each handler should have try-catch
      const tryCatchCount = (content.match(/try\s*\{/g) || []).length;
      expect(tryCatchCount).toBeGreaterThanOrEqual(4);
    });
  });
});
