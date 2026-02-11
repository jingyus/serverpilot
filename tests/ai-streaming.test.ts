/**
 * Tests for AI streaming integration
 *
 * Tests the streaming methods on InstallAIAgent and the
 * streaming message types in the shared protocol.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { EnvironmentInfo, ErrorContext } from '@aiinstaller/shared';
import {
  MessageType,
  AIStreamStartMessageSchema,
  AIStreamTokenMessageSchema,
  AIStreamCompleteMessageSchema,
  AIStreamErrorMessageSchema,
  MessageSchema,
  createMessage,
} from '@aiinstaller/shared';
import { InstallAIAgent } from '../packages/server/src/ai/agent.js';
import type { StreamCallbacks } from '../packages/server/src/ai/agent.js';
import type { AIProviderInterface, StreamResponse } from '../packages/server/src/ai/providers/base.js';

// ============================================================================
// Mock Provider Factory
// ============================================================================

/** Create a mock AI provider for testing */
function createMockProvider(overrides?: Partial<AIProviderInterface>): AIProviderInterface {
  return {
    name: 'mock',
    tier: 1,
    chat: vi.fn().mockResolvedValue({
      content: '{}',
      usage: { inputTokens: 10, outputTokens: 20 },
    }),
    stream: vi.fn().mockResolvedValue({
      content: '{}',
      usage: { inputTokens: 10, outputTokens: 20 },
      success: true,
    }),
    isAvailable: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

/** Create a mock StreamResponse returning the given data as JSON */
function mockStreamResponse(jsonData: unknown, opts?: { success?: boolean; error?: string }): StreamResponse {
  return {
    content: JSON.stringify(jsonData),
    usage: { inputTokens: 10, outputTokens: 20 },
    success: opts?.success ?? true,
    error: opts?.error,
  };
}

// ============================================================================
// Test Fixtures
// ============================================================================

function createEnvInfo(): EnvironmentInfo {
  return {
    os: { platform: 'darwin', version: '24.0.0', arch: 'arm64' },
    shell: { type: 'zsh', version: '5.9' },
    runtime: { node: '22.0.0', python: '3.12.0' },
    packageManagers: { npm: '10.0.0', pnpm: '9.0.0' },
    network: { canAccessNpm: true, canAccessGithub: true },
    permissions: { hasSudo: true, canWriteTo: ['/usr/local'] },
  };
}

function createErrorContext(): ErrorContext {
  return {
    stepId: 'install-openclaw',
    command: 'pnpm install -g openclaw',
    exitCode: 1,
    stdout: '',
    stderr: 'EACCES: permission denied',
    environment: createEnvInfo(),
    previousSteps: [],
  };
}

const VALID_ENV_ANALYSIS = {
  summary: 'Ready',
  issues: [],
  ready: true,
  recommendations: [],
  detectedCapabilities: {
    hasRequiredRuntime: true,
    hasPackageManager: true,
    hasNetworkAccess: true,
    hasSufficientPermissions: true,
  },
};

const VALID_INSTALL_PLAN = {
  steps: [
    {
      id: 'check-node',
      description: 'Check Node.js version',
      command: 'node --version',
      timeout: 10000,
      canRollback: false,
      onError: 'abort' as const,
    },
  ],
  estimatedTime: 10000,
  risks: [],
};

const VALID_DIAGNOSIS = {
  rootCause: 'Permission denied',
  category: 'permission' as const,
  explanation: 'Write access denied to /usr/local',
  severity: 'high' as const,
  affectedComponent: 'pnpm',
  suggestedNextSteps: ['Use sudo'],
};

const VALID_FIX_STRATEGIES = [
  {
    id: 'use-sudo',
    description: 'Run with sudo',
    commands: ['sudo pnpm install -g openclaw'],
    confidence: 0.9,
  },
];

// ============================================================================
// Protocol Message Tests
// ============================================================================

describe('AI Streaming Protocol Messages', () => {
  describe('MessageType constants', () => {
    it('should include AI streaming message types', () => {
      expect(MessageType.AI_STREAM_START).toBe('ai.stream.start');
      expect(MessageType.AI_STREAM_TOKEN).toBe('ai.stream.token');
      expect(MessageType.AI_STREAM_COMPLETE).toBe('ai.stream.complete');
      expect(MessageType.AI_STREAM_ERROR).toBe('ai.stream.error');
    });
  });

  describe('AIStreamStartMessageSchema', () => {
    it('should validate a correct stream start message', () => {
      const msg = {
        type: 'ai.stream.start',
        payload: { operation: 'analyzeEnvironment' },
        timestamp: Date.now(),
      };
      const result = AIStreamStartMessageSchema.safeParse(msg);
      expect(result.success).toBe(true);
    });

    it('should reject missing operation', () => {
      const msg = {
        type: 'ai.stream.start',
        payload: {},
        timestamp: Date.now(),
      };
      const result = AIStreamStartMessageSchema.safeParse(msg);
      expect(result.success).toBe(false);
    });

    it('should accept optional requestId', () => {
      const msg = {
        type: 'ai.stream.start',
        payload: { operation: 'diagnoseError' },
        timestamp: Date.now(),
        requestId: 'req-123',
      };
      const result = AIStreamStartMessageSchema.safeParse(msg);
      expect(result.success).toBe(true);
    });
  });

  describe('AIStreamTokenMessageSchema', () => {
    it('should validate a correct token message', () => {
      const msg = {
        type: 'ai.stream.token',
        payload: { token: 'Hello', accumulated: 'Hello' },
        timestamp: Date.now(),
      };
      const result = AIStreamTokenMessageSchema.safeParse(msg);
      expect(result.success).toBe(true);
    });

    it('should reject missing token field', () => {
      const msg = {
        type: 'ai.stream.token',
        payload: { accumulated: 'Hello' },
        timestamp: Date.now(),
      };
      const result = AIStreamTokenMessageSchema.safeParse(msg);
      expect(result.success).toBe(false);
    });

    it('should reject missing accumulated field', () => {
      const msg = {
        type: 'ai.stream.token',
        payload: { token: 'Hello' },
        timestamp: Date.now(),
      };
      const result = AIStreamTokenMessageSchema.safeParse(msg);
      expect(result.success).toBe(false);
    });
  });

  describe('AIStreamCompleteMessageSchema', () => {
    it('should validate a correct complete message', () => {
      const msg = {
        type: 'ai.stream.complete',
        payload: { text: 'Full text', inputTokens: 100, outputTokens: 50 },
        timestamp: Date.now(),
      };
      const result = AIStreamCompleteMessageSchema.safeParse(msg);
      expect(result.success).toBe(true);
    });

    it('should reject missing token counts', () => {
      const msg = {
        type: 'ai.stream.complete',
        payload: { text: 'Full text' },
        timestamp: Date.now(),
      };
      const result = AIStreamCompleteMessageSchema.safeParse(msg);
      expect(result.success).toBe(false);
    });
  });

  describe('AIStreamErrorMessageSchema', () => {
    it('should validate a correct error message', () => {
      const msg = {
        type: 'ai.stream.error',
        payload: { error: 'Rate limit exceeded' },
        timestamp: Date.now(),
      };
      const result = AIStreamErrorMessageSchema.safeParse(msg);
      expect(result.success).toBe(true);
    });

    it('should reject missing error field', () => {
      const msg = {
        type: 'ai.stream.error',
        payload: {},
        timestamp: Date.now(),
      };
      const result = AIStreamErrorMessageSchema.safeParse(msg);
      expect(result.success).toBe(false);
    });
  });

  describe('MessageSchema union', () => {
    it('should parse AI stream start message', () => {
      const msg = {
        type: 'ai.stream.start',
        payload: { operation: 'analyzeEnvironment' },
        timestamp: Date.now(),
      };
      const result = MessageSchema.safeParse(msg);
      expect(result.success).toBe(true);
    });

    it('should parse AI stream token message', () => {
      const msg = {
        type: 'ai.stream.token',
        payload: { token: 'x', accumulated: 'x' },
        timestamp: Date.now(),
      };
      const result = MessageSchema.safeParse(msg);
      expect(result.success).toBe(true);
    });

    it('should parse AI stream complete message', () => {
      const msg = {
        type: 'ai.stream.complete',
        payload: { text: 'done', inputTokens: 1, outputTokens: 1 },
        timestamp: Date.now(),
      };
      const result = MessageSchema.safeParse(msg);
      expect(result.success).toBe(true);
    });

    it('should parse AI stream error message', () => {
      const msg = {
        type: 'ai.stream.error',
        payload: { error: 'fail' },
        timestamp: Date.now(),
      };
      const result = MessageSchema.safeParse(msg);
      expect(result.success).toBe(true);
    });
  });

  describe('createMessage with streaming types', () => {
    it('should create AI stream start message', () => {
      const msg = createMessage(MessageType.AI_STREAM_START, { operation: 'test' });
      expect(msg.type).toBe('ai.stream.start');
      expect(msg.payload.operation).toBe('test');
      expect(msg.timestamp).toBeGreaterThan(0);
    });

    it('should create AI stream token message', () => {
      const msg = createMessage(MessageType.AI_STREAM_TOKEN, { token: 'hi', accumulated: 'hi' });
      expect(msg.type).toBe('ai.stream.token');
      expect(msg.payload.token).toBe('hi');
    });

    it('should create AI stream complete message', () => {
      const msg = createMessage(MessageType.AI_STREAM_COMPLETE, {
        text: 'done',
        inputTokens: 10,
        outputTokens: 5,
      });
      expect(msg.type).toBe('ai.stream.complete');
      expect(msg.payload.inputTokens).toBe(10);
    });

    it('should create AI stream error message', () => {
      const msg = createMessage(MessageType.AI_STREAM_ERROR, { error: 'timeout' });
      expect(msg.type).toBe('ai.stream.error');
      expect(msg.payload.error).toBe('timeout');
    });
  });
});

// ============================================================================
// InstallAIAgent Streaming Methods
// ============================================================================

describe('InstallAIAgent streaming methods', () => {
  let agent: InstallAIAgent;
  let mockProvider: AIProviderInterface;

  beforeEach(() => {
    mockProvider = createMockProvider({
      stream: vi.fn().mockResolvedValue(mockStreamResponse(VALID_ENV_ANALYSIS)),
    });
    agent = new InstallAIAgent({ provider: mockProvider, maxRetries: 0, enablePresetFallback: false });
  });

  describe('analyzeEnvironmentStreaming', () => {
    it('should return valid analysis result', async () => {
      const result = await agent.analyzeEnvironmentStreaming(createEnvInfo(), 'openclaw');

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data!.ready).toBe(true);
      expect(result.data!.summary).toBe('Ready');
    });

    it('should pass callbacks to provider.stream', async () => {
      const onToken = vi.fn();
      const streamFn = vi.fn().mockImplementation((_opts, callbacks) => {
        // Simulate calling onToken
        callbacks?.onToken?.('token', 'token');
        return Promise.resolve(mockStreamResponse(VALID_ENV_ANALYSIS));
      });
      mockProvider = createMockProvider({ stream: streamFn });
      agent = new InstallAIAgent({ provider: mockProvider, maxRetries: 0, enablePresetFallback: false });

      await agent.analyzeEnvironmentStreaming(createEnvInfo(), 'openclaw', { onToken });

      expect(onToken).toHaveBeenCalled();
    });

    it('should pass onStart callback to provider.stream', async () => {
      const onStart = vi.fn();
      const streamFn = vi.fn().mockImplementation((_opts, callbacks) => {
        callbacks?.onStart?.();
        return Promise.resolve(mockStreamResponse(VALID_ENV_ANALYSIS));
      });
      mockProvider = createMockProvider({ stream: streamFn });
      agent = new InstallAIAgent({ provider: mockProvider, maxRetries: 0, enablePresetFallback: false });

      await agent.analyzeEnvironmentStreaming(createEnvInfo(), 'openclaw', { onStart });

      expect(onStart).toHaveBeenCalledTimes(1);
    });

    it('should return failure on invalid response', async () => {
      mockProvider = createMockProvider({
        stream: vi.fn().mockResolvedValue(mockStreamResponse({ invalid: true })),
      });
      agent = new InstallAIAgent({ provider: mockProvider, maxRetries: 0, enablePresetFallback: false });

      const result = await agent.analyzeEnvironmentStreaming(createEnvInfo(), 'openclaw');

      expect(result.success).toBe(false);
      expect(result.errorType).toBe('validation');
    });
  });

  describe('generateInstallPlanStreaming', () => {
    it('should return valid install plan', async () => {
      mockProvider = createMockProvider({
        stream: vi.fn().mockResolvedValue(mockStreamResponse(VALID_INSTALL_PLAN)),
      });
      agent = new InstallAIAgent({ provider: mockProvider, maxRetries: 0, enablePresetFallback: false });

      const result = await agent.generateInstallPlanStreaming(createEnvInfo(), 'openclaw');

      expect(result.success).toBe(true);
      expect(result.data!.steps).toHaveLength(1);
      expect(result.data!.steps[0].id).toBe('check-node');
    });

    it('should accept optional version parameter', async () => {
      mockProvider = createMockProvider({
        stream: vi.fn().mockResolvedValue(mockStreamResponse(VALID_INSTALL_PLAN)),
      });
      agent = new InstallAIAgent({ provider: mockProvider, maxRetries: 0, enablePresetFallback: false });

      const result = await agent.generateInstallPlanStreaming(
        createEnvInfo(),
        'openclaw',
        '2.0.0',
      );

      expect(result.success).toBe(true);
    });
  });

  describe('diagnoseErrorStreaming', () => {
    it('should return valid diagnosis', async () => {
      mockProvider = createMockProvider({
        stream: vi.fn().mockResolvedValue(mockStreamResponse(VALID_DIAGNOSIS)),
      });
      agent = new InstallAIAgent({ provider: mockProvider, maxRetries: 0, enablePresetFallback: false });

      const result = await agent.diagnoseErrorStreaming(createErrorContext());

      expect(result.success).toBe(true);
      expect(result.data!.category).toBe('permission');
      expect(result.data!.rootCause).toBe('Permission denied');
    });

    it('should pass onComplete callback to provider.stream', async () => {
      const onComplete = vi.fn();
      const streamFn = vi.fn().mockImplementation((_opts, callbacks) => {
        const resp = mockStreamResponse(VALID_DIAGNOSIS);
        callbacks?.onComplete?.(resp.content, resp.usage);
        return Promise.resolve(resp);
      });
      mockProvider = createMockProvider({ stream: streamFn });
      agent = new InstallAIAgent({ provider: mockProvider, maxRetries: 0, enablePresetFallback: false });

      await agent.diagnoseErrorStreaming(createErrorContext(), { onComplete });

      expect(onComplete).toHaveBeenCalledTimes(1);
    });
  });

  describe('suggestFixesStreaming', () => {
    it('should return valid fix strategies', async () => {
      mockProvider = createMockProvider({
        stream: vi.fn().mockResolvedValue(mockStreamResponse(VALID_FIX_STRATEGIES)),
      });
      agent = new InstallAIAgent({ provider: mockProvider, maxRetries: 0, enablePresetFallback: false });

      const result = await agent.suggestFixesStreaming(createErrorContext());

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data![0].id).toBe('use-sudo');
    });

    it('should accept optional diagnosis parameter', async () => {
      mockProvider = createMockProvider({
        stream: vi.fn().mockResolvedValue(mockStreamResponse(VALID_FIX_STRATEGIES)),
      });
      agent = new InstallAIAgent({ provider: mockProvider, maxRetries: 0, enablePresetFallback: false });

      const result = await agent.suggestFixesStreaming(
        createErrorContext(),
        VALID_DIAGNOSIS,
      );

      expect(result.success).toBe(true);
    });
  });

  describe('Streaming error handling', () => {
    it('should return failure when stream errors', async () => {
      mockProvider = createMockProvider({
        stream: vi.fn().mockResolvedValue(
          mockStreamResponse({}, { success: false, error: 'Connection timeout' }),
        ),
      });
      agent = new InstallAIAgent({ provider: mockProvider, maxRetries: 0, enablePresetFallback: false });

      const result = await agent.analyzeEnvironmentStreaming(createEnvInfo(), 'openclaw');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Connection timeout');
    });

    it('should call onError callback on stream failure', async () => {
      const onError = vi.fn();
      const streamFn = vi.fn().mockImplementation((_opts, callbacks) => {
        const error = new Error('API error');
        callbacks?.onError?.(error);
        return Promise.resolve(
          mockStreamResponse({}, { success: false, error: 'API error' }),
        );
      });
      mockProvider = createMockProvider({ stream: streamFn });
      agent = new InstallAIAgent({ provider: mockProvider, maxRetries: 0, enablePresetFallback: false });

      await agent.analyzeEnvironmentStreaming(createEnvInfo(), 'openclaw', { onError });

      expect(onError).toHaveBeenCalledTimes(1);
    });

    it('should retry on network error up to maxRetries', async () => {
      let callCount = 0;
      const streamFn = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve(
            mockStreamResponse({}, { success: false, error: 'Network error' }),
          );
        }
        return Promise.resolve(mockStreamResponse(VALID_ENV_ANALYSIS));
      });

      mockProvider = createMockProvider({ stream: streamFn });
      const retryAgent = new InstallAIAgent({ provider: mockProvider, maxRetries: 1, enablePresetFallback: false });

      const result = await retryAgent.analyzeEnvironmentStreaming(createEnvInfo(), 'openclaw');

      expect(result.success).toBe(true);
      expect(streamFn).toHaveBeenCalledTimes(2);
    });
  });
});
