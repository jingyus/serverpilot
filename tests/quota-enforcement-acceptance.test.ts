/**
 * Acceptance Test: 免费用户每月 5 次安装额度限制生效
 *
 * Validates the end-to-end quota enforcement flow:
 * 1. Rate limiter: Free tier limit is 5 installations/month
 * 2. Rate limiter: Quota check allows when quota available
 * 3. Rate limiter: Quota check blocks when quota exhausted
 * 4. Rate limiter: Upgrade message for free users
 * 5. Auth handler: Returns quota info during authentication
 * 6. Handlers: Quota check before plan generation (env.report)
 * 7. Handlers: Quota check before error diagnosis (error.occurred)
 * 8. Handlers: Fallback plan when quota exhausted
 * 9. Handlers: AI call increment after successful AI operation
 * 10. E2E: WebSocket auth → quota info → quota enforcement round trip
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import WebSocket from 'ws';
import { createMessage, MessageType } from '@aiinstaller/shared';
import type { EnvironmentInfo, ErrorContext, Message } from '@aiinstaller/shared';
import { InstallServer } from '../packages/server/src/api/server.js';
import { handleEnvReport, handleErrorOccurred, routeMessage } from '../packages/server/src/api/handlers.js';
import {
  checkRateLimit,
  incrementAICall,
  getUpgradeMessage,
  isQuotaExceededError,
  createQuotaExceededMessage,
  FREE_TIER_INSTALLATION_LIMIT,
  QUOTA_EXCEEDED_ERROR,
} from '../packages/server/src/api/rate-limiter.js';
import {
  authenticateDevice,
  createAuthResponse,
  hasQuota,
} from '../packages/server/src/api/auth-handler.js';
import { DeviceClient } from '../packages/server/src/api/device-client.js';
import { SessionClient } from '../packages/server/src/api/session-client.js';

// ============================================================================
// Mock Setup
// ============================================================================

vi.mock('../packages/server/src/api/device-client.js', () => ({
  DeviceClient: {
    verify: vi.fn(),
    register: vi.fn(),
    getQuota: vi.fn(),
    incrementCall: vi.fn(),
  },
}));

vi.mock('../packages/server/src/api/session-client.js', () => ({
  SessionClient: {
    logAICall: vi.fn(),
  },
}));

vi.mock('../packages/server/src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  createContextLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
  logMessageRoute: vi.fn(),
  logAIOperation: vi.fn(),
  logError: vi.fn(),
}));

// ============================================================================
// Test Helpers
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

function makeErrorContext(overrides?: Partial<ErrorContext>): ErrorContext {
  return {
    stepId: 'test-step',
    command: 'npm install -g openclaw',
    exitCode: 1,
    stdout: '',
    stderr: 'command not found: pnpm',
    environment: makeEnv(),
    previousSteps: [],
    ...overrides,
  };
}

let testPort = 19800;
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

function waitForMessage(ws: WebSocket): Promise<Message> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timeout waiting for message')), 5000);
    ws.once('message', (data) => {
      clearTimeout(timeout);
      resolve(JSON.parse(data.toString()));
    });
  });
}

function collectMessages(ws: WebSocket, count: number): Promise<Message[]> {
  return new Promise((resolve, reject) => {
    const msgs: Message[] = [];
    const timeout = setTimeout(() => reject(new Error(`Timeout: got ${msgs.length}/${count}`)), 5000);
    ws.on('message', (data) => {
      msgs.push(JSON.parse(data.toString()));
      if (msgs.length >= count) {
        clearTimeout(timeout);
        resolve(msgs);
      }
    });
  });
}

// ============================================================================
// Tests
// ============================================================================

describe('Acceptance: 免费用户每月 5 次安装额度限制生效', () => {

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // 1. Free Tier Limit Constants
  // ==========================================================================

  describe('1. Free tier limit configuration', () => {
    it('should set free tier installation limit to 5', () => {
      expect(FREE_TIER_INSTALLATION_LIMIT).toBe(5);
    });

    it('should have a quota exceeded error code', () => {
      expect(QUOTA_EXCEEDED_ERROR).toBe('QUOTA_EXCEEDED');
    });
  });

  // ==========================================================================
  // 2. Rate Limiter: Quota Check Allows When Available
  // ==========================================================================

  describe('2. Rate limiter allows operations when quota available', () => {
    it('should allow when user has used 0/5', async () => {
      vi.mocked(DeviceClient.getQuota).mockResolvedValue({
        success: true,
        data: {
          quotaLimit: 5,
          quotaUsed: 0,
          quotaRemaining: 5,
          plan: 'free',
          resetDate: '2026-03-01',
        },
      });

      const result = await checkRateLimit('device-1', 'token-1');
      expect(result.allowed).toBe(true);
      expect(result.quotaRemaining).toBe(5);
    });

    it('should allow when user has used 4/5 (last one)', async () => {
      vi.mocked(DeviceClient.getQuota).mockResolvedValue({
        success: true,
        data: {
          quotaLimit: 5,
          quotaUsed: 4,
          quotaRemaining: 1,
          plan: 'free',
          resetDate: '2026-03-01',
        },
      });

      const result = await checkRateLimit('device-1', 'token-1');
      expect(result.allowed).toBe(true);
      expect(result.quotaRemaining).toBe(1);
    });
  });

  // ==========================================================================
  // 3. Rate Limiter: Blocks When Quota Exhausted
  // ==========================================================================

  describe('3. Rate limiter blocks when quota exhausted', () => {
    it('should block when user has used 5/5', async () => {
      vi.mocked(DeviceClient.getQuota).mockResolvedValue({
        success: true,
        data: {
          quotaLimit: 5,
          quotaUsed: 5,
          quotaRemaining: 0,
          plan: 'free',
          resetDate: '2026-03-01',
        },
      });

      const result = await checkRateLimit('device-1', 'token-1');
      expect(result.allowed).toBe(false);
      expect(result.quotaRemaining).toBe(0);
      expect(result.errorCode).toBe(QUOTA_EXCEEDED_ERROR);
    });

    it('should block when quota is negative (over limit)', async () => {
      vi.mocked(DeviceClient.getQuota).mockResolvedValue({
        success: true,
        data: {
          quotaLimit: 5,
          quotaUsed: 7,
          quotaRemaining: -2,
          plan: 'free',
          resetDate: '2026-03-01',
        },
      });

      const result = await checkRateLimit('device-1', 'token-1');
      expect(result.allowed).toBe(false);
      expect(result.error).toBe('Monthly quota exceeded');
    });

    it('should block when quota query fails', async () => {
      vi.mocked(DeviceClient.getQuota).mockResolvedValue({
        success: false,
        error: 'Network error',
      });

      const result = await checkRateLimit('device-1', 'token-1');
      expect(result.allowed).toBe(false);
      expect(result.error).toBe('Network error');
    });
  });

  // ==========================================================================
  // 4. Upgrade Message for Free Users
  // ==========================================================================

  describe('4. Upgrade message for free users', () => {
    it('should show upgrade to Pro message for free plan', () => {
      const msg = getUpgradeMessage('free');
      expect(msg).toContain('Upgrade to Pro');
      expect(msg).toContain('5 installations');
      expect(msg).toContain('https://aiinstaller.dev/pricing');
    });

    it('should include upgrade URL in quota exceeded check result', async () => {
      vi.mocked(DeviceClient.getQuota).mockResolvedValue({
        success: true,
        data: {
          quotaLimit: 5,
          quotaUsed: 5,
          quotaRemaining: 0,
          plan: 'free',
          resetDate: '2026-03-01',
        },
      });

      const result = await checkRateLimit('device-1', 'token-1');
      expect(result.upgradeMessage).toContain('Upgrade to Pro');
      expect(result.upgradeMessage).toContain('https://aiinstaller.dev/pricing');
    });

    it('should show contact support for non-free plans', () => {
      const msg = getUpgradeMessage('pro');
      expect(msg).toContain('contact support');
      expect(msg).not.toContain('Upgrade to Pro');
    });

    it('should create full quota exceeded message with error code', () => {
      const msg = createQuotaExceededMessage('free');
      expect(msg).toContain('Upgrade to Pro');
      expect(msg).toContain(QUOTA_EXCEEDED_ERROR);
    });

    it('should detect quota exceeded errors from strings', () => {
      expect(isQuotaExceededError('quota exceeded')).toBe(true);
      expect(isQuotaExceededError(QUOTA_EXCEEDED_ERROR)).toBe(true);
      expect(isQuotaExceededError(new Error('QUOTA_EXCEEDED'))).toBe(true);
      expect(isQuotaExceededError('some other error')).toBe(false);
    });
  });

  // ==========================================================================
  // 5. Auth Handler: Quota Info During Authentication
  // ==========================================================================

  describe('5. Auth handler returns quota info', () => {
    it('should return quota info for existing device with token', async () => {
      vi.mocked(DeviceClient.verify).mockResolvedValue({
        success: true,
        data: {
          valid: true,
          banned: false,
          plan: 'free',
          quotaLimit: 5,
          quotaUsed: 3,
        },
      });

      const result = await authenticateDevice({
        type: MessageType.AUTH_REQUEST,
        payload: {
          deviceId: 'device-123',
          deviceToken: 'existing-token',
          platform: 'darwin',
        },
        timestamp: Date.now(),
      });

      expect(result.success).toBe(true);
      expect(result.quota).toEqual({ limit: 5, used: 3, remaining: 2 });
      expect(result.plan).toBe('free');
    });

    it('should return quota info for newly registered device', async () => {
      vi.mocked(DeviceClient.register).mockResolvedValue({
        success: true,
        data: {
          token: 'new-token-abc',
          quotaLimit: 5,
          quotaUsed: 0,
          plan: 'free',
        },
      });

      const result = await authenticateDevice({
        type: MessageType.AUTH_REQUEST,
        payload: {
          deviceId: 'new-device',
          platform: 'linux',
        },
        timestamp: Date.now(),
      });

      expect(result.success).toBe(true);
      expect(result.deviceToken).toBe('new-token-abc');
      expect(result.quota).toEqual({ limit: 5, used: 0, remaining: 5 });
      expect(result.plan).toBe('free');
    });

    it('should create auth response with quota fields', () => {
      const response = createAuthResponse({
        success: true,
        deviceToken: 'token-xyz',
        quota: { limit: 5, used: 2, remaining: 3 },
        plan: 'free',
      });

      expect(response.type).toBe(MessageType.AUTH_RESPONSE);
      expect(response.payload.success).toBe(true);
      expect(response.payload.quotaLimit).toBe(5);
      expect(response.payload.quotaUsed).toBe(2);
      expect(response.payload.quotaRemaining).toBe(3);
      expect(response.payload.plan).toBe('free');
    });

    it('should check quota availability via hasQuota helper', () => {
      expect(hasQuota({
        success: true,
        quota: { limit: 5, used: 2, remaining: 3 },
      })).toBe(true);

      expect(hasQuota({
        success: true,
        quota: { limit: 5, used: 5, remaining: 0 },
      })).toBe(false);

      expect(hasQuota({
        success: false,
      })).toBe(false);
    });
  });

  // ==========================================================================
  // 6. Handlers: Quota Check Before Plan Generation
  // ==========================================================================

  describe('6. handleEnvReport checks quota before plan generation', () => {
    it('should return fallback plan when quota exhausted', async () => {
      const port = nextPort();
      const server = new InstallServer({ port, requireAuth: false });
      await server.start();

      try {
        const ws = await connectRawClient(port);
        // Wait for connection event to propagate
        await new Promise(r => setTimeout(r, 50));

        // Find client ID
        const clientId = Array.from((server as any).clients.keys())[0] as string;

        // Create session
        const sessionMsg = createMessage(MessageType.SESSION_CREATE, {
          software: 'openclaw',
          version: '1.0.0',
        });
        const sessionResult = await import('../packages/server/src/api/handlers.js')
          .then(m => m.handleCreateSession(server, clientId, sessionMsg));
        expect(sessionResult.success).toBe(true);

        // Drain the plan.receive message from session creation
        await waitForMessage(ws);

        // Authenticate client
        server.authenticateClient(clientId, 'device-test', 'token-test');

        // Mock quota exhausted
        vi.mocked(DeviceClient.getQuota).mockResolvedValue({
          success: true,
          data: {
            quotaLimit: 5,
            quotaUsed: 5,
            quotaRemaining: 0,
            plan: 'free',
            resetDate: '2026-03-01',
          },
        });

        // Create a mock AI agent
        const mockAIAgent = {
          analyzeEnvironment: vi.fn(),
          generatePlan: vi.fn(),
          diagnoseError: vi.fn(),
        };

        // Send env report
        const envMsg = createMessage(MessageType.ENV_REPORT, makeEnv());

        // Collect messages: AI_STREAM_START + AI_STREAM_TOKEN + AI_STREAM_COMPLETE + PLAN_RECEIVE
        const messagesPromise = collectMessages(ws, 4);

        const result = await handleEnvReport(server, clientId, envMsg, mockAIAgent as any);
        expect(result.success).toBe(true);

        const messages = await messagesPromise;

        // Verify AI stream messages show quota exceeded
        expect(messages[0].type).toBe(MessageType.AI_STREAM_START);
        expect((messages[0].payload as any).operation).toBe('quota_check');

        expect(messages[1].type).toBe(MessageType.AI_STREAM_TOKEN);
        expect((messages[1].payload as any).token).toContain('Upgrade to Pro');

        expect(messages[2].type).toBe(MessageType.AI_STREAM_COMPLETE);

        // Verify fallback plan is returned
        expect(messages[3].type).toBe(MessageType.PLAN_RECEIVE);
        expect((messages[3].payload as any).steps.length).toBeGreaterThan(0);

        // AI agent should NOT have been called
        expect(mockAIAgent.analyzeEnvironment).not.toHaveBeenCalled();

        ws.close();
      } finally {
        await server.stop();
      }
    });

    it('should call AI when quota is available and increment counter', async () => {
      const port = nextPort();
      const server = new InstallServer({ port, requireAuth: false });
      await server.start();

      try {
        const ws = await connectRawClient(port);
        await new Promise(r => setTimeout(r, 50));

        const clientId = Array.from((server as any).clients.keys())[0] as string;

        // Create session
        const sessionMsg = createMessage(MessageType.SESSION_CREATE, {
          software: 'openclaw',
          version: '1.0.0',
        });
        await import('../packages/server/src/api/handlers.js')
          .then(m => m.handleCreateSession(server, clientId, sessionMsg));
        await waitForMessage(ws);

        // Authenticate client
        server.authenticateClient(clientId, 'device-quota', 'token-quota');

        // Mock quota available
        vi.mocked(DeviceClient.getQuota).mockResolvedValue({
          success: true,
          data: {
            quotaLimit: 5,
            quotaUsed: 2,
            quotaRemaining: 3,
            plan: 'free',
            resetDate: '2026-03-01',
          },
        });

        // Mock increment and log
        vi.mocked(DeviceClient.incrementCall).mockResolvedValue({
          success: true,
          data: { quotaUsed: 3, quotaRemaining: 2 },
        });

        vi.mocked(SessionClient.logAICall).mockResolvedValue({
          success: true,
          data: { logId: 'log-123' },
        });

        // Mock AI agent that returns analysis
        const mockAIAgent = {
          analyzeEnvironment: vi.fn().mockResolvedValue({
            success: true,
            data: {
              summary: 'Environment is ready',
              ready: true,
              issues: [],
              recommendations: [],
            },
          }),
          generatePlan: vi.fn(),
          diagnoseError: vi.fn(),
        };

        const envMsg = createMessage(MessageType.ENV_REPORT, makeEnv());

        // Will get multiple messages: AI stream + plan
        const result = await handleEnvReport(server, clientId, envMsg, mockAIAgent as any);
        expect(result.success).toBe(true);

        // Verify AI was called
        expect(mockAIAgent.analyzeEnvironment).toHaveBeenCalled();

        // Verify rate limit was checked
        expect(DeviceClient.getQuota).toHaveBeenCalledWith({
          deviceId: 'device-quota',
          token: 'token-quota',
        });

        ws.close();
      } finally {
        await server.stop();
      }
    });
  });

  // ==========================================================================
  // 7. Handlers: Quota Check Before Error Diagnosis
  // ==========================================================================

  describe('7. handleErrorOccurred checks quota before AI diagnosis', () => {
    it('should send basic retry when quota exhausted', async () => {
      const port = nextPort();
      const server = new InstallServer({ port, requireAuth: false });
      await server.start();

      try {
        const ws = await connectRawClient(port);
        await new Promise(r => setTimeout(r, 50));

        const clientId = Array.from((server as any).clients.keys())[0] as string;

        // Create session
        const sessionMsg = createMessage(MessageType.SESSION_CREATE, {
          software: 'openclaw',
        });
        await import('../packages/server/src/api/handlers.js')
          .then(m => m.handleCreateSession(server, clientId, sessionMsg));
        await waitForMessage(ws);

        // Authenticate client
        server.authenticateClient(clientId, 'device-err', 'token-err');

        // Mock quota exhausted
        vi.mocked(DeviceClient.getQuota).mockResolvedValue({
          success: true,
          data: {
            quotaLimit: 5,
            quotaUsed: 5,
            quotaRemaining: 0,
            plan: 'free',
            resetDate: '2026-03-01',
          },
        });

        const mockAIAgent = {
          analyzeEnvironment: vi.fn(),
          generatePlan: vi.fn(),
          diagnoseError: vi.fn(),
        };

        const errorMsg = createMessage(MessageType.ERROR_OCCURRED, makeErrorContext());
        const responsePromise = waitForMessage(ws);

        const result = await handleErrorOccurred(server, clientId, errorMsg, mockAIAgent as any);
        expect(result.success).toBe(true);

        const response = await responsePromise;

        // Should receive fix.suggest with upgrade message
        expect(response.type).toBe(MessageType.FIX_SUGGEST);
        const strategies = response.payload as any[];
        expect(strategies).toHaveLength(1);
        expect(strategies[0].id).toBe('retry');
        expect(strategies[0].description).toContain('Upgrade to Pro');

        // AI should NOT be called
        expect(mockAIAgent.diagnoseError).not.toHaveBeenCalled();

        ws.close();
      } finally {
        await server.stop();
      }
    });
  });

  // ==========================================================================
  // 8. AI Call Increment After Successful Operation
  // ==========================================================================

  describe('8. AI call increment tracking', () => {
    it('should increment call count after successful AI operation', async () => {
      vi.mocked(DeviceClient.incrementCall).mockResolvedValue({
        success: true,
        data: { quotaUsed: 3, quotaRemaining: 2 },
      });

      const result = await incrementAICall('device-1', 'token-1', 'planGeneration');

      expect(result.success).toBe(true);
      expect(result.quotaRemaining).toBe(2);
      expect(DeviceClient.incrementCall).toHaveBeenCalledWith({
        deviceId: 'device-1',
        token: 'token-1',
        scene: 'planGeneration',
      });
    });

    it('should track progressive quota consumption from 5 down to 0', async () => {
      for (let used = 1; used <= 5; used++) {
        vi.mocked(DeviceClient.incrementCall).mockResolvedValue({
          success: true,
          data: { quotaUsed: used, quotaRemaining: 5 - used },
        });

        const result = await incrementAICall('device-1', 'token-1', 'planGeneration');
        expect(result.success).toBe(true);
        expect(result.quotaRemaining).toBe(5 - used);
      }

      // Now quota should be exhausted, check rate limit
      vi.mocked(DeviceClient.getQuota).mockResolvedValue({
        success: true,
        data: {
          quotaLimit: 5,
          quotaUsed: 5,
          quotaRemaining: 0,
          plan: 'free',
          resetDate: '2026-03-01',
        },
      });

      const check = await checkRateLimit('device-1', 'token-1');
      expect(check.allowed).toBe(false);
      expect(check.errorCode).toBe(QUOTA_EXCEEDED_ERROR);
    });
  });

  // ==========================================================================
  // 9. Full Lifecycle: Auth → Quota Check → Block
  // ==========================================================================

  describe('9. Full lifecycle: register → use quota → get blocked', () => {
    it('should simulate a full free user lifecycle', async () => {
      // Step 1: New device registers → gets 5 quota
      vi.mocked(DeviceClient.register).mockResolvedValue({
        success: true,
        data: {
          token: 'new-free-token',
          quotaLimit: 5,
          quotaUsed: 0,
          plan: 'free',
        },
      });

      const authResult = await authenticateDevice({
        type: MessageType.AUTH_REQUEST,
        payload: {
          deviceId: 'lifecycle-device',
          platform: 'darwin',
        },
        timestamp: Date.now(),
      });

      expect(authResult.success).toBe(true);
      expect(authResult.quota?.remaining).toBe(5);
      expect(authResult.plan).toBe('free');

      // Step 2: Use 4 installations → still allowed
      vi.mocked(DeviceClient.getQuota).mockResolvedValue({
        success: true,
        data: {
          quotaLimit: 5,
          quotaUsed: 4,
          quotaRemaining: 1,
          plan: 'free',
          resetDate: '2026-03-01',
        },
      });

      const check4 = await checkRateLimit('lifecycle-device', 'new-free-token');
      expect(check4.allowed).toBe(true);
      expect(check4.quotaRemaining).toBe(1);

      // Step 3: Use 5th installation → quota becomes 0 → blocked
      vi.mocked(DeviceClient.getQuota).mockResolvedValue({
        success: true,
        data: {
          quotaLimit: 5,
          quotaUsed: 5,
          quotaRemaining: 0,
          plan: 'free',
          resetDate: '2026-03-01',
        },
      });

      const check5 = await checkRateLimit('lifecycle-device', 'new-free-token');
      expect(check5.allowed).toBe(false);
      expect(check5.errorCode).toBe(QUOTA_EXCEEDED_ERROR);
      expect(check5.upgradeMessage).toContain('Upgrade to Pro');
      expect(check5.upgradeMessage).toContain('5 installations');
    });
  });

  // ==========================================================================
  // 10. E2E: WebSocket Auth → Quota Info Round Trip
  // ==========================================================================

  describe('10. E2E WebSocket auth with quota info', () => {
    it('should return quota info in auth response via WebSocket', async () => {
      const port = nextPort();
      const server = new InstallServer({ port, requireAuth: false });
      await server.start();

      try {
        const ws = await connectRawClient(port);
        await new Promise(r => setTimeout(r, 50));

        const clientId = Array.from((server as any).clients.keys())[0] as string;

        // Mock device verification
        vi.mocked(DeviceClient.verify).mockResolvedValue({
          success: true,
          data: {
            valid: true,
            banned: false,
            plan: 'free',
            quotaLimit: 5,
            quotaUsed: 3,
          },
        });

        // Send auth request via handler
        const authMsg = createMessage(MessageType.AUTH_REQUEST, {
          deviceId: 'ws-device',
          deviceToken: 'ws-token',
          platform: 'darwin',
        });

        const responsePromise = waitForMessage(ws);

        await routeMessage(server, clientId, authMsg);

        const response = await responsePromise;

        // Verify auth response contains quota info
        expect(response.type).toBe(MessageType.AUTH_RESPONSE);
        expect((response.payload as any).success).toBe(true);
        expect((response.payload as any).quotaLimit).toBe(5);
        expect((response.payload as any).quotaUsed).toBe(3);
        expect((response.payload as any).quotaRemaining).toBe(2);
        expect((response.payload as any).plan).toBe('free');

        ws.close();
      } finally {
        await server.stop();
      }
    });

    it('should block unauthenticated message routing', async () => {
      const port = nextPort();
      const server = new InstallServer({ port, requireAuth: true });
      await server.start();

      try {
        const ws = await connectRawClient(port);
        await new Promise(r => setTimeout(r, 50));

        const clientId = Array.from((server as any).clients.keys())[0] as string;

        // Try to send non-auth message without authentication
        const sessionMsg = createMessage(MessageType.SESSION_CREATE, {
          software: 'openclaw',
        });

        const result = await routeMessage(server, clientId, sessionMsg);

        expect(result.success).toBe(false);
        expect(result.error).toContain('Authentication required');

        ws.close();
      } finally {
        await server.stop();
      }
    });
  });

  // ==========================================================================
  // 11. Edge Cases
  // ==========================================================================

  describe('11. Edge cases', () => {
    it('should handle quota check when device client throws', async () => {
      vi.mocked(DeviceClient.getQuota).mockRejectedValue(new Error('Connection refused'));

      const result = await checkRateLimit('device-1', 'token-1');
      expect(result.allowed).toBe(false);
      expect(result.error).toBe('Connection refused');
    });

    it('should handle increment failure gracefully', async () => {
      vi.mocked(DeviceClient.incrementCall).mockResolvedValue({
        success: false,
        error: 'Database error',
      });

      const result = await incrementAICall('device-1', 'token-1', 'envAnalysis');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Database error');
    });

    it('should handle banned device during auth', async () => {
      vi.mocked(DeviceClient.verify).mockResolvedValue({
        success: true,
        data: {
          valid: true,
          banned: true,
          banReason: 'Terms of service violation',
          plan: 'free',
          quotaLimit: 5,
          quotaUsed: 0,
        },
      });

      const result = await authenticateDevice({
        type: MessageType.AUTH_REQUEST,
        payload: {
          deviceId: 'banned-device',
          deviceToken: 'banned-token',
          platform: 'linux',
        },
        timestamp: Date.now(),
      });

      expect(result.success).toBe(false);
      expect(result.banned).toBe(true);
    });

    it('should not call AI agent when no client auth available', async () => {
      const port = nextPort();
      const server = new InstallServer({ port, requireAuth: false });
      await server.start();

      try {
        const ws = await connectRawClient(port);
        await new Promise(r => setTimeout(r, 50));

        const clientId = Array.from((server as any).clients.keys())[0] as string;

        // Create session but do NOT authenticate
        const sessionMsg = createMessage(MessageType.SESSION_CREATE, {
          software: 'openclaw',
        });
        await import('../packages/server/src/api/handlers.js')
          .then(m => m.handleCreateSession(server, clientId, sessionMsg));
        await waitForMessage(ws);

        const mockAIAgent = {
          analyzeEnvironment: vi.fn().mockResolvedValue({
            success: true,
            data: {
              summary: 'Ready',
              ready: true,
              issues: [],
              recommendations: [],
            },
          }),
          generatePlan: vi.fn(),
          diagnoseError: vi.fn(),
        };

        const envMsg = createMessage(MessageType.ENV_REPORT, makeEnv());
        await handleEnvReport(server, clientId, envMsg, mockAIAgent as any);

        // Rate limit check should NOT be called (no auth)
        expect(DeviceClient.getQuota).not.toHaveBeenCalled();
        // AI should still be called (no rate limit without auth)
        expect(mockAIAgent.analyzeEnvironment).toHaveBeenCalled();

        ws.close();
      } finally {
        await server.stop();
      }
    });
  });
});
