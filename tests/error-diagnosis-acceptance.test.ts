/**
 * Acceptance Test: 安装失败时能获得 AI 诊断和修复建议
 *
 * Validates the end-to-end error diagnosis and fix suggestion flow:
 * 1. Server-side: Error analysis correctly identifies error types
 * 2. Server-side: Common error rules library returns fix strategies without AI
 * 3. Server-side: AI-powered diagnosis with mock AI agent
 * 4. Server-side: handleErrorOccurred returns FixSuggest messages
 * 5. Client-side: Error messages are formatted for users
 * 6. E2E: WebSocket error → fix suggestion round trip
 *
 * Covers at least 5 common error scenarios as required by acceptance criteria.
 */

import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { createMessage, MessageType } from '@aiinstaller/shared';
import type { ErrorContext, FixStrategy, EnvironmentInfo } from '@aiinstaller/shared';
import { InstallServer } from '../packages/server/src/api/server.js';
import { routeMessage, handleErrorOccurred } from '../packages/server/src/api/handlers.js';
import {
  analyzeError,
  identifyErrorType,
  diagnoseError,
} from '../packages/server/src/ai/error-analyzer.js';
import {
  matchCommonErrors,
  getBestMatch,
  shouldSkipAI,
} from '../packages/server/src/ai/common-errors.js';
import {
  formatPlainError,
  renderPlainError,
} from '../packages/agent/src/ui/error-messages.js';

// ============================================================================
// Test Environment
// ============================================================================

function makeEnv(overrides?: Partial<EnvironmentInfo>): EnvironmentInfo {
  return {
    os: { platform: 'darwin', version: '24.0.0', arch: 'arm64' },
    shell: { type: 'zsh', version: '5.9' },
    runtime: { node: '22.1.0' },
    packageManagers: { npm: '10.2.0', pnpm: '9.1.0' },
    network: { canAccessNpm: true, canAccessGithub: true },
    permissions: { hasSudo: true, canWriteTo: ['/usr/local'] },
    ...overrides,
  };
}

function makeErrorContext(overrides: Partial<ErrorContext>): ErrorContext {
  return {
    stepId: 'test-step',
    command: 'npm install -g openclaw',
    exitCode: 1,
    stdout: '',
    stderr: '',
    environment: makeEnv(),
    previousSteps: [],
    ...overrides,
  };
}

// ============================================================================
// WebSocket test helpers
// ============================================================================

let testPort = 19900;
function nextPort() {
  return testPort++;
}

function connectRawClient(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
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

function createTestServer(port: number) {
  return new InstallServer({
    port,
    heartbeatIntervalMs: 60000,
    requireAuth: false,
  });
}

// ============================================================================
// Error Scenarios (at least 5 common errors as required)
// ============================================================================

const ERROR_SCENARIOS = {
  permissionDenied: {
    label: 'EACCES permission denied',
    context: makeErrorContext({
      stepId: 'install-pnpm',
      command: 'npm install -g pnpm',
      exitCode: 1,
      stderr: 'npm ERR! code EACCES\nnpm ERR! EACCES: permission denied, mkdir \'/usr/local/lib/node_modules/pnpm\'',
    }),
    expectedType: 'permission' as const,
    expectedCategory: 'permission' as const,
  },
  networkTimeout: {
    label: 'ETIMEDOUT network timeout',
    context: makeErrorContext({
      stepId: 'install-openclaw',
      command: 'pnpm install -g openclaw',
      exitCode: 1,
      stderr: 'npm ERR! code ETIMEDOUT\nnpm ERR! errno ETIMEDOUT\nnpm ERR! network timeout at: https://registry.npmjs.org/openclaw',
    }),
    expectedType: 'network' as const,
    expectedCategory: 'network' as const,
  },
  commandNotFound: {
    label: 'command not found',
    context: makeErrorContext({
      stepId: 'install-dep',
      command: 'pnpm install -g openclaw',
      exitCode: 127,
      stderr: 'bash: pnpm: command not found',
    }),
    expectedType: 'dependency' as const,
    expectedCategory: 'dependency' as const,
  },
  dependencyConflict: {
    label: 'ERESOLVE dependency conflict',
    context: makeErrorContext({
      stepId: 'install-deps',
      command: 'npm install',
      exitCode: 1,
      stderr: 'npm ERR! code ERESOLVE\nnpm ERR! ERESOLVE unable to resolve dependency tree\nnpm ERR! Could not resolve dependency',
    }),
    expectedType: 'dependency' as const,
    expectedCategory: 'dependency' as const,
  },
  versionIncompatible: {
    label: 'engine version incompatible',
    context: makeErrorContext({
      stepId: 'check-engine',
      command: 'npm install openclaw',
      exitCode: 1,
      stderr: 'npm ERR! engine {"node":">=22.0.0"} is incompatible with this module',
      environment: makeEnv({ runtime: { node: '16.0.0' } }),
    }),
    expectedType: 'version' as const,
    expectedCategory: 'version' as const,
  },
  dnsFailed: {
    label: 'ENOTFOUND DNS lookup failed',
    context: makeErrorContext({
      stepId: 'download',
      command: 'npm install openclaw',
      exitCode: 1,
      stderr: 'npm ERR! code ENOTFOUND\nnpm ERR! errno ENOTFOUND\nnpm ERR! request to https://registry.npmjs.org/ failed',
    }),
    expectedType: 'network' as const,
    expectedCategory: 'network' as const,
  },
  jsonParseError: {
    label: 'EJSONPARSE configuration error',
    context: makeErrorContext({
      stepId: 'read-config',
      command: 'npm install',
      exitCode: 1,
      stderr: 'npm ERR! code EJSONPARSE\nnpm ERR! file /home/user/package.json\nnpm ERR! JSON.parse',
    }),
    expectedType: 'configuration' as const,
    expectedCategory: 'configuration' as const,
  },
};

// ============================================================================
// Tests
// ============================================================================

describe('Acceptance: 安装失败时能获得 AI 诊断和修复建议', () => {

  // ==========================================================================
  // 1. Error type identification (server-side rule-based analysis)
  // ==========================================================================
  describe('1. Error type identification', () => {
    for (const [key, scenario] of Object.entries(ERROR_SCENARIOS)) {
      it(`should identify "${scenario.label}" as ${scenario.expectedType} error`, () => {
        const analysis = identifyErrorType(scenario.context);
        expect(analysis.type).toBe(scenario.expectedType);
        expect(analysis.confidence).toBeGreaterThan(0);
        expect(analysis.matchedPatterns.length).toBeGreaterThan(0);
        expect(analysis.summary).toBeTruthy();
      });
    }

    it('should return "unknown" for unrecognized errors', () => {
      const ctx = makeErrorContext({
        stderr: 'some random output that matches nothing',
      });
      const analysis = identifyErrorType(ctx);
      expect(analysis.type).toBe('unknown');
    });
  });

  // ==========================================================================
  // 2. Detailed error information extraction
  // ==========================================================================
  describe('2. Error information extraction', () => {
    it('should extract error codes from output', () => {
      const ctx = makeErrorContext({
        stderr: 'npm ERR! code EACCES\nnpm ERR! EACCES: permission denied',
      });
      const info = analyzeError(ctx);
      expect(info.errorCodes).toContain('EACCES');
    });

    it('should extract missing dependencies', () => {
      const ctx = makeErrorContext({
        stderr: 'bash: pnpm: command not found',
      });
      const info = analyzeError(ctx);
      expect(info.missingDependencies).toContain('pnpm');
    });

    it('should extract permission issues and detect needsSudo', () => {
      const ctx = makeErrorContext({
        stderr: 'EACCES: permission denied, mkdir \'/usr/local/lib/node_modules\'',
      });
      const info = analyzeError(ctx);
      expect(info.permissionIssues.needsSudo).toBe(true);
    });

    it('should extract version conflicts', () => {
      const ctx = makeErrorContext({
        stderr: 'requires a peer of react@^18.0.0 but none is installed',
      });
      const info = analyzeError(ctx);
      expect(info.versionConflicts.length).toBeGreaterThan(0);
      expect(info.versionConflicts[0].package).toBe('react');
    });

    it('should extract configuration issues', () => {
      const ctx = makeErrorContext({
        stderr: 'npm ERR! code EJSONPARSE\nnpm ERR! file /home/user/package.json',
      });
      const info = analyzeError(ctx);
      expect(info.configIssues.length).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // 3. Common error rules library matches with fix strategies
  // ==========================================================================
  describe('3. Common error rules library', () => {
    it('should match at least 5 common error types with fix strategies', () => {
      const scenarios = Object.values(ERROR_SCENARIOS);
      let matchCount = 0;

      for (const scenario of scenarios) {
        const matches = matchCommonErrors(scenario.context);
        if (matches.length > 0) {
          matchCount++;
          // Each match should have fix strategies
          expect(matches[0].fixStrategies.length).toBeGreaterThan(0);
        }
      }

      // At least 5 scenarios must match rules
      expect(matchCount).toBeGreaterThanOrEqual(5);
    });

    it('should return fix strategies with valid structure for permission denied', () => {
      const match = getBestMatch(ERROR_SCENARIOS.permissionDenied.context);
      expect(match).not.toBeNull();
      expect(match!.fixStrategies.length).toBeGreaterThan(0);

      for (const strategy of match!.fixStrategies) {
        expect(strategy.description).toBeTruthy();
        expect(strategy.commands.length).toBeGreaterThan(0);
        expect(strategy.confidence).toBeGreaterThanOrEqual(0);
        expect(strategy.confidence).toBeLessThanOrEqual(1);
        expect(typeof strategy.requiresSudo).toBe('boolean');
      }
    });

    it('should return fix strategies for network timeout', () => {
      const match = getBestMatch(ERROR_SCENARIOS.networkTimeout.context);
      expect(match).not.toBeNull();
      expect(match!.fixStrategies.length).toBeGreaterThan(0);
      // Network timeout fixes should include retry
      const descriptions = match!.fixStrategies.map(s => s.description.toLowerCase());
      const hasRetry = descriptions.some(d => d.includes('retry'));
      expect(hasRetry).toBe(true);
    });

    it('should return fix strategies for command not found', () => {
      const match = getBestMatch(ERROR_SCENARIOS.commandNotFound.context);
      expect(match).not.toBeNull();
      expect(match!.fixStrategies.length).toBeGreaterThan(0);
      // Should suggest installing the missing command
      const descriptions = match!.fixStrategies.map(s => s.description.toLowerCase());
      const hasInstall = descriptions.some(d => d.includes('install'));
      expect(hasInstall).toBe(true);
    });

    it('should return fix strategies for dependency conflict', () => {
      const match = getBestMatch(ERROR_SCENARIOS.dependencyConflict.context);
      expect(match).not.toBeNull();
      expect(match!.fixStrategies.length).toBeGreaterThan(0);
    });

    it('should return fix strategies for version incompatibility', () => {
      const match = getBestMatch(ERROR_SCENARIOS.versionIncompatible.context);
      expect(match).not.toBeNull();
      expect(match!.fixStrategies.length).toBeGreaterThan(0);
    });

    it('should skip AI for high-confidence rule matches', () => {
      // Permission denied is a common, high-confidence rule match
      expect(shouldSkipAI(ERROR_SCENARIOS.permissionDenied.context)).toBe(true);
      expect(shouldSkipAI(ERROR_SCENARIOS.networkTimeout.context)).toBe(true);
      expect(shouldSkipAI(ERROR_SCENARIOS.commandNotFound.context)).toBe(true);
    });
  });

  // ==========================================================================
  // 4. AI-powered diagnosis with mock AI agent (rule-library path)
  // ==========================================================================
  describe('4. AI-powered diagnosis (rule-library fast path)', () => {
    it('should diagnose permission error using rule library without AI call', async () => {
      const mockAgent = {} as any; // AI agent not needed for rule-library path
      const result = await diagnoseError(
        ERROR_SCENARIOS.permissionDenied.context,
        mockAgent,
      );

      expect(result.success).toBe(true);
      expect(result.usedRuleLibrary).toBe(true);
      expect(result.diagnosis).toBeDefined();
      expect(result.diagnosis!.rootCause).toBeTruthy();
      expect(result.diagnosis!.category).toBe('permission');
      expect(result.fixStrategies).toBeDefined();
      expect(result.fixStrategies!.length).toBeGreaterThan(0);
    });

    it('should diagnose network timeout using rule library', async () => {
      const mockAgent = {} as any;
      const result = await diagnoseError(
        ERROR_SCENARIOS.networkTimeout.context,
        mockAgent,
      );

      expect(result.success).toBe(true);
      expect(result.usedRuleLibrary).toBe(true);
      expect(result.fixStrategies!.length).toBeGreaterThan(0);
    });

    it('should diagnose command not found using rule library', async () => {
      const mockAgent = {} as any;
      const result = await diagnoseError(
        ERROR_SCENARIOS.commandNotFound.context,
        mockAgent,
      );

      expect(result.success).toBe(true);
      expect(result.usedRuleLibrary).toBe(true);
      expect(result.fixStrategies!.length).toBeGreaterThan(0);
    });

    it('should diagnose dependency conflict using rule library', async () => {
      const mockAgent = {} as any;
      const result = await diagnoseError(
        ERROR_SCENARIOS.dependencyConflict.context,
        mockAgent,
      );

      expect(result.success).toBe(true);
      expect(result.usedRuleLibrary).toBe(true);
      expect(result.fixStrategies!.length).toBeGreaterThan(0);
    });

    it('should diagnose version incompatibility using rule library', async () => {
      const mockAgent = {} as any;
      const result = await diagnoseError(
        ERROR_SCENARIOS.versionIncompatible.context,
        mockAgent,
      );

      expect(result.success).toBe(true);
      expect(result.usedRuleLibrary).toBe(true);
      expect(result.fixStrategies!.length).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // 5. Client-side: Error messages formatted for users
  // ==========================================================================
  describe('5. Client-side error message formatting', () => {
    for (const [key, scenario] of Object.entries(ERROR_SCENARIOS)) {
      it(`should format "${scenario.label}" as user-friendly message`, () => {
        const msg = formatPlainError(scenario.context);

        // Every error should produce a meaningful message
        expect(msg.title).toBeTruthy();
        expect(msg.explanation).toBeTruthy();
        expect(msg.category).toBe(scenario.expectedCategory);
        expect(msg.nextSteps.length).toBeGreaterThan(0);
        expect(['low', 'medium', 'high', 'critical']).toContain(msg.severity);
      });
    }

    it('should render a plain-text error message', () => {
      const msg = formatPlainError(ERROR_SCENARIOS.permissionDenied.context);
      const rendered = renderPlainError(msg);

      expect(rendered).toContain(msg.title);
      expect(rendered).toContain(msg.explanation);
      expect(rendered).toContain('Next steps:');
    });

    it('should provide help links for common errors', () => {
      const msg = formatPlainError(ERROR_SCENARIOS.permissionDenied.context);
      expect(msg.helpLinks.length).toBeGreaterThan(0);
      expect(msg.helpLinks[0].label).toBeTruthy();
      expect(msg.helpLinks[0].url).toBeTruthy();
    });

    it('should handle unknown errors gracefully with fallback message', () => {
      const ctx = makeErrorContext({
        command: 'some-unknown-cmd',
        exitCode: 42,
        stderr: 'something completely unexpected happened',
      });
      const msg = formatPlainError(ctx);

      expect(msg.title).toBeTruthy();
      expect(msg.explanation).toBeTruthy();
      expect(msg.category).toBe('unknown');
      expect(msg.nextSteps.length).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // 6. E2E: WebSocket error → fix suggestion round trip
  // ==========================================================================
  describe('6. E2E WebSocket error diagnosis flow', () => {
    let server: InstallServer | null = null;
    let rawClients: WebSocket[] = [];

    afterEach(async () => {
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

    it('should return fix suggestions for permission denied via WebSocket', async () => {
      const port = nextPort();
      server = createTestServer(port);
      server.on('message', (clientId, msg) => routeMessage(server!, clientId, msg));
      await server.start();

      const ws = await connectRawClient(port);
      rawClients.push(ws);
      await waitFor(() => server!.getClientCount() === 1);

      // Create session
      const createMsg = createMessage(MessageType.SESSION_CREATE, { software: 'openclaw' });
      ws.send(JSON.stringify(createMsg));
      await waitForMessage(ws); // plan.receive ack

      // Send env report — without AI agent, handler sends ai.stream.error + plan.receive
      const envMsg = createMessage(MessageType.ENV_REPORT, makeEnv());

      // Set up a message queue to capture all responses reliably
      const messages: string[] = [];
      let resolveNext: ((value: string) => void) | null = null;
      const onMsg = (data: unknown) => {
        const str = String(data);
        if (resolveNext) {
          const r = resolveNext;
          resolveNext = null;
          r(str);
        } else {
          messages.push(str);
        }
      };
      ws.on('message', onMsg);

      const nextMessage = (timeoutMs = 3000): Promise<string> =>
        new Promise((resolve, reject) => {
          if (messages.length > 0) {
            resolve(messages.shift()!);
            return;
          }
          const timer = setTimeout(() => {
            resolveNext = null;
            reject(new Error('nextMessage timed out'));
          }, timeoutMs);
          resolveNext = (v) => {
            clearTimeout(timer);
            resolve(v);
          };
        });

      ws.send(JSON.stringify(envMsg));
      await nextMessage(); // ai.stream.error
      await nextMessage(); // plan.receive (fallback plan)

      // Report permission denied error
      const errorPayload = {
        stepId: 'install-pnpm',
        command: 'npm install -g pnpm',
        exitCode: 1,
        stdout: '',
        stderr: 'EACCES: permission denied, mkdir \'/usr/local/lib/node_modules/pnpm\'',
        environment: makeEnv(),
        previousSteps: [],
      };
      const errorMsg = createMessage(MessageType.ERROR_OCCURRED, errorPayload);
      ws.send(JSON.stringify(errorMsg));

      const fixStr = await nextMessage();
      ws.off('message', onMsg);
      const fixResponse = JSON.parse(fixStr);

      expect(fixResponse.type).toBe(MessageType.FIX_SUGGEST);
      expect(Array.isArray(fixResponse.payload)).toBe(true);
      expect(fixResponse.payload.length).toBeGreaterThan(0);

      // Validate fix strategy structure
      const fix = fixResponse.payload[0];
      expect(fix.description).toBeTruthy();
      expect(Array.isArray(fix.commands)).toBe(true);
      expect(fix.commands.length).toBeGreaterThan(0);
      expect(fix.confidence).toBeGreaterThanOrEqual(0);
      expect(fix.confidence).toBeLessThanOrEqual(1);

      ws.close();
    });

    it('should return fix suggestions for network timeout via WebSocket', async () => {
      const port = nextPort();
      server = createTestServer(port);
      server.on('message', (clientId, msg) => routeMessage(server!, clientId, msg));
      await server.start();

      const ws = await connectRawClient(port);
      rawClients.push(ws);
      await waitFor(() => server!.getClientCount() === 1);

      // Create session
      ws.send(JSON.stringify(createMessage(MessageType.SESSION_CREATE, { software: 'openclaw' })));
      await waitForMessage(ws);

      // Report network timeout error
      const errorMsg = createMessage(MessageType.ERROR_OCCURRED, {
        stepId: 'install-openclaw',
        command: 'npm install -g openclaw',
        exitCode: 1,
        stdout: '',
        stderr: 'npm ERR! code ETIMEDOUT\nnpm ERR! network timeout',
        environment: makeEnv(),
        previousSteps: [],
      });
      ws.send(JSON.stringify(errorMsg));

      const fixStr = await waitForMessage(ws);
      const fixResponse = JSON.parse(fixStr);

      expect(fixResponse.type).toBe(MessageType.FIX_SUGGEST);
      expect(fixResponse.payload.length).toBeGreaterThan(0);

      ws.close();
    });

    it('should return fix suggestions for command not found via WebSocket', async () => {
      const port = nextPort();
      server = createTestServer(port);
      server.on('message', (clientId, msg) => routeMessage(server!, clientId, msg));
      await server.start();

      const ws = await connectRawClient(port);
      rawClients.push(ws);
      await waitFor(() => server!.getClientCount() === 1);

      // Create session
      ws.send(JSON.stringify(createMessage(MessageType.SESSION_CREATE, { software: 'openclaw' })));
      await waitForMessage(ws);

      // Report command not found error
      const errorMsg = createMessage(MessageType.ERROR_OCCURRED, {
        stepId: 'install-dep',
        command: 'pnpm install -g openclaw',
        exitCode: 127,
        stderr: 'bash: pnpm: command not found',
        stdout: '',
        environment: makeEnv(),
        previousSteps: [],
      });
      ws.send(JSON.stringify(errorMsg));

      const fixStr = await waitForMessage(ws);
      const fixResponse = JSON.parse(fixStr);

      expect(fixResponse.type).toBe(MessageType.FIX_SUGGEST);
      expect(fixResponse.payload.length).toBeGreaterThan(0);

      ws.close();
    });

    it('should return basic retry suggestion when no AI agent available', async () => {
      const port = nextPort();
      server = createTestServer(port);

      // Route messages WITHOUT providing an AI agent
      server.on('message', (clientId, msg) => routeMessage(server!, clientId, msg));
      await server.start();

      const ws = await connectRawClient(port);
      rawClients.push(ws);
      await waitFor(() => server!.getClientCount() === 1);

      // Create session
      ws.send(JSON.stringify(createMessage(MessageType.SESSION_CREATE, { software: 'openclaw' })));
      await waitForMessage(ws);

      // Report error
      const errorMsg = createMessage(MessageType.ERROR_OCCURRED, {
        stepId: 'test-step',
        command: 'npm install',
        exitCode: 1,
        stdout: '',
        stderr: 'some random error',
        environment: makeEnv(),
        previousSteps: [],
      });
      ws.send(JSON.stringify(errorMsg));

      const fixStr = await waitForMessage(ws);
      const fixResponse = JSON.parse(fixStr);

      // Should still return a basic retry suggestion
      expect(fixResponse.type).toBe(MessageType.FIX_SUGGEST);
      expect(fixResponse.payload.length).toBeGreaterThan(0);
      expect(fixResponse.payload[0].description).toContain('Retry');

      ws.close();
    });

    it('should handle complete error → fix → recovery flow via WebSocket', async () => {
      const port = nextPort();
      server = createTestServer(port);
      server.on('message', (clientId, msg) => routeMessage(server!, clientId, msg));
      await server.start();

      const ws = await connectRawClient(port);
      rawClients.push(ws);
      await waitFor(() => server!.getClientCount() === 1);

      // Create session
      ws.send(JSON.stringify(createMessage(MessageType.SESSION_CREATE, { software: 'openclaw' })));
      await waitForMessage(ws);

      // Send env report
      ws.send(JSON.stringify(createMessage(MessageType.ENV_REPORT, makeEnv())));
      await waitForMessage(ws);

      // 1. Report error
      const errorMsg = createMessage(MessageType.ERROR_OCCURRED, {
        stepId: 'install-pnpm',
        command: 'npm install -g pnpm',
        exitCode: 1,
        stdout: '',
        stderr: 'EACCES: permission denied, mkdir \'/usr/local/lib/node_modules/pnpm\'',
        environment: makeEnv(),
        previousSteps: [],
      });
      ws.send(JSON.stringify(errorMsg));

      // 2. Receive fix suggestions
      const fixStr = await waitForMessage(ws);
      const fixResponse = JSON.parse(fixStr);
      expect(fixResponse.type).toBe(MessageType.FIX_SUGGEST);
      expect(fixResponse.payload.length).toBeGreaterThan(0);

      // Verify session is in error state
      const clientIds = Array.from((server as any).clients.keys());
      const sessionId = server.getClientSessionId(clientIds[0]);
      expect(sessionId).toBeDefined();
      const sessionInError = server.getSession(sessionId!);
      expect(sessionInError!.status).toBe('error');

      // 3. Client applies fix and retries successfully
      const retryMsg = createMessage(MessageType.STEP_COMPLETE, {
        stepId: 'install-pnpm',
        success: true,
        exitCode: 0,
        stdout: 'pnpm installed successfully with sudo',
        stderr: '',
        duration: 3000,
      });
      ws.send(JSON.stringify(retryMsg));
      await new Promise(r => setTimeout(r, 100));

      // 4. Session should recover from error
      const sessionRecovered = server.getSession(sessionId!);
      expect(sessionRecovered!.status).toBe('executing');

      ws.close();
    });
  });

  // ==========================================================================
  // 7. Fix strategy quality validation
  // ==========================================================================
  describe('7. Fix strategy quality', () => {
    it('should sort fix strategies by confidence (highest first)', async () => {
      const mockAgent = {} as any;
      const result = await diagnoseError(
        ERROR_SCENARIOS.permissionDenied.context,
        mockAgent,
      );

      expect(result.success).toBe(true);
      const strategies = result.fixStrategies!;
      expect(strategies.length).toBeGreaterThanOrEqual(2);

      // Verify sorted by confidence descending
      for (let i = 1; i < strategies.length; i++) {
        expect(strategies[i - 1].confidence).toBeGreaterThanOrEqual(strategies[i].confidence);
      }
    });

    it('should include risk level in fix strategies', async () => {
      const mockAgent = {} as any;
      const result = await diagnoseError(
        ERROR_SCENARIOS.permissionDenied.context,
        mockAgent,
      );

      for (const strategy of result.fixStrategies!) {
        expect(['low', 'medium', 'high']).toContain(strategy.risk);
      }
    });

    it('should indicate when sudo is required', async () => {
      const mockAgent = {} as any;
      const result = await diagnoseError(
        ERROR_SCENARIOS.permissionDenied.context,
        mockAgent,
      );

      // Permission errors should have at least one fix that requires sudo
      const hasSudoFix = result.fixStrategies!.some(s => s.requiresSudo);
      expect(hasSudoFix).toBe(true);
    });

    it('should provide reasoning for fix strategies', async () => {
      const mockAgent = {} as any;
      const result = await diagnoseError(
        ERROR_SCENARIOS.permissionDenied.context,
        mockAgent,
      );

      for (const strategy of result.fixStrategies!) {
        expect(strategy.reasoning).toBeTruthy();
      }
    });
  });

  // ==========================================================================
  // 8. Complete acceptance criteria check
  // ==========================================================================
  describe('8. Acceptance criteria summary', () => {
    it('should diagnose at least 5 common error types with fix suggestions', async () => {
      const mockAgent = {} as any;
      const scenarios = Object.values(ERROR_SCENARIOS);
      let diagnosedCount = 0;

      for (const scenario of scenarios) {
        const result = await diagnoseError(scenario.context, mockAgent);
        if (result.success && result.fixStrategies && result.fixStrategies.length > 0) {
          diagnosedCount++;
        }
      }

      // Must diagnose at least 5 types
      expect(diagnosedCount).toBeGreaterThanOrEqual(5);
    });

    it('should provide fix strategies with executable commands for all common errors', async () => {
      const mockAgent = {} as any;

      for (const scenario of Object.values(ERROR_SCENARIOS)) {
        const result = await diagnoseError(scenario.context, mockAgent);
        expect(result.success).toBe(true);
        expect(result.fixStrategies!.length).toBeGreaterThan(0);

        // Every fix strategy should have at least one command
        for (const strategy of result.fixStrategies!) {
          expect(strategy.commands.length).toBeGreaterThan(0);
          for (const cmd of strategy.commands) {
            expect(typeof cmd).toBe('string');
            expect(cmd.length).toBeGreaterThan(0);
          }
        }
      }
    });

    it('should produce user-friendly messages for all common errors', () => {
      for (const scenario of Object.values(ERROR_SCENARIOS)) {
        const msg = formatPlainError(scenario.context);
        expect(msg.title).toBeTruthy();
        expect(msg.explanation.length).toBeGreaterThan(20);
        expect(msg.nextSteps.length).toBeGreaterThan(0);
      }
    });
  });
});
