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
import type { StreamCallbacks } from '../packages/server/src/ai/streaming.js';

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

/** Create a mock stream object for testing agent streaming methods */
function createMockStream(jsonData: unknown) {
  const textContent = JSON.stringify(jsonData);
  const listeners: Record<string, ((...args: any[]) => void)[]> = {};

  return {
    on(event: string, listener: (...args: any[]) => void) {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(listener);
      return this;
    },
    finalMessage: vi.fn().mockImplementation(async () => {
      // Emit the full text as a single token
      for (const listener of listeners['text'] ?? []) {
        listener(textContent);
      }

      return {
        content: [{ type: 'text', text: textContent }],
        usage: { input_tokens: 10, output_tokens: 20 },
      };
    }),
  };
}

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

  beforeEach(() => {
    agent = new InstallAIAgent({ apiKey: 'test-key', maxRetries: 0, enablePresetFallback: false });
  });

  describe('analyzeEnvironmentStreaming', () => {
    it('should return valid analysis result', async () => {
      const mockStream = createMockStream(VALID_ENV_ANALYSIS);
      (agent as any).client = { messages: { stream: vi.fn().mockReturnValue(mockStream) } };

      const result = await agent.analyzeEnvironmentStreaming(createEnvInfo(), 'openclaw');

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data!.ready).toBe(true);
      expect(result.data!.summary).toBe('Ready');
    });

    it('should invoke onToken callback', async () => {
      const mockStream = createMockStream(VALID_ENV_ANALYSIS);
      (agent as any).client = { messages: { stream: vi.fn().mockReturnValue(mockStream) } };
      const onToken = vi.fn();

      await agent.analyzeEnvironmentStreaming(createEnvInfo(), 'openclaw', { onToken });

      expect(onToken).toHaveBeenCalled();
    });

    it('should invoke onStart callback', async () => {
      const mockStream = createMockStream(VALID_ENV_ANALYSIS);
      (agent as any).client = { messages: { stream: vi.fn().mockReturnValue(mockStream) } };
      const onStart = vi.fn();

      await agent.analyzeEnvironmentStreaming(createEnvInfo(), 'openclaw', { onStart });

      expect(onStart).toHaveBeenCalledTimes(1);
    });

    it('should return failure on invalid response', async () => {
      const mockStream = createMockStream({ invalid: true });
      (agent as any).client = { messages: { stream: vi.fn().mockReturnValue(mockStream) } };

      const result = await agent.analyzeEnvironmentStreaming(createEnvInfo(), 'openclaw');

      expect(result.success).toBe(false);
      expect(result.errorType).toBe('validation');
    });
  });

  describe('generateInstallPlanStreaming', () => {
    it('should return valid install plan', async () => {
      const mockStream = createMockStream(VALID_INSTALL_PLAN);
      (agent as any).client = { messages: { stream: vi.fn().mockReturnValue(mockStream) } };

      const result = await agent.generateInstallPlanStreaming(createEnvInfo(), 'openclaw');

      expect(result.success).toBe(true);
      expect(result.data!.steps).toHaveLength(1);
      expect(result.data!.steps[0].id).toBe('check-node');
    });

    it('should accept optional version parameter', async () => {
      const mockStream = createMockStream(VALID_INSTALL_PLAN);
      (agent as any).client = { messages: { stream: vi.fn().mockReturnValue(mockStream) } };

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
      const mockStream = createMockStream(VALID_DIAGNOSIS);
      (agent as any).client = { messages: { stream: vi.fn().mockReturnValue(mockStream) } };

      const result = await agent.diagnoseErrorStreaming(createErrorContext());

      expect(result.success).toBe(true);
      expect(result.data!.category).toBe('permission');
      expect(result.data!.rootCause).toBe('Permission denied');
    });

    it('should invoke onComplete callback', async () => {
      const mockStream = createMockStream(VALID_DIAGNOSIS);
      (agent as any).client = { messages: { stream: vi.fn().mockReturnValue(mockStream) } };
      const onComplete = vi.fn();

      await agent.diagnoseErrorStreaming(createErrorContext(), { onComplete });

      expect(onComplete).toHaveBeenCalledTimes(1);
    });
  });

  describe('suggestFixesStreaming', () => {
    it('should return valid fix strategies', async () => {
      const mockStream = createMockStream(VALID_FIX_STRATEGIES);
      (agent as any).client = { messages: { stream: vi.fn().mockReturnValue(mockStream) } };

      const result = await agent.suggestFixesStreaming(createErrorContext());

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data![0].id).toBe('use-sudo');
    });

    it('should accept optional diagnosis parameter', async () => {
      const mockStream = createMockStream(VALID_FIX_STRATEGIES);
      (agent as any).client = { messages: { stream: vi.fn().mockReturnValue(mockStream) } };

      const result = await agent.suggestFixesStreaming(
        createErrorContext(),
        VALID_DIAGNOSIS,
      );

      expect(result.success).toBe(true);
    });
  });

  describe('Streaming error handling', () => {
    it('should return failure when stream errors', async () => {
      const listeners: Record<string, ((...args: any[]) => void)[]> = {};
      const mockStream = {
        on(event: string, listener: (...args: any[]) => void) {
          if (!listeners[event]) listeners[event] = [];
          listeners[event].push(listener);
          return mockStream;
        },
        finalMessage: vi.fn().mockRejectedValue(new Error('Connection timeout')),
      };
      (agent as any).client = { messages: { stream: vi.fn().mockReturnValue(mockStream) } };

      const result = await agent.analyzeEnvironmentStreaming(createEnvInfo(), 'openclaw');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Connection timeout');
    });

    it('should call onError callback on stream failure', async () => {
      const listeners: Record<string, ((...args: any[]) => void)[]> = {};
      const mockStream = {
        on(event: string, listener: (...args: any[]) => void) {
          if (!listeners[event]) listeners[event] = [];
          listeners[event].push(listener);
          return mockStream;
        },
        finalMessage: vi.fn().mockRejectedValue(new Error('API error')),
      };
      (agent as any).client = { messages: { stream: vi.fn().mockReturnValue(mockStream) } };
      const onError = vi.fn();

      await agent.analyzeEnvironmentStreaming(createEnvInfo(), 'openclaw', { onError });

      expect(onError).toHaveBeenCalledTimes(1);
    });

    it('should retry on network error up to maxRetries', async () => {
      const retryAgent = new InstallAIAgent({ apiKey: 'test-key', maxRetries: 1 });

      let callCount = 0;
      const mockStreamFn = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // First call fails
          return {
            on: vi.fn().mockReturnThis(),
            finalMessage: vi.fn().mockRejectedValue(new Error('Network error')),
          };
        }
        // Second call succeeds
        return createMockStream(VALID_ENV_ANALYSIS);
      });

      (retryAgent as any).client = { messages: { stream: mockStreamFn } };

      const result = await retryAgent.analyzeEnvironmentStreaming(createEnvInfo(), 'openclaw');

      expect(result.success).toBe(true);
      expect(mockStreamFn).toHaveBeenCalledTimes(2);
    });
  });
});
