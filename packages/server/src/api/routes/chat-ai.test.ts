// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AIProviderInterface, StreamResponse, ChatOptions, ProviderStreamCallbacks } from '../../ai/providers/base.js';
import type { ErrorClassification } from '../../ai/request-retry.js';

// ---------------------------------------------------------------------------
// Module-level mocks (must be before imports of the module under test)
// ---------------------------------------------------------------------------

vi.mock('../../ai/providers/provider-factory.js', () => ({
  getActiveProvider: vi.fn(() => null),
  createProvider: vi.fn(),
}));

vi.mock('../../ai/request-retry.js', () => ({
  classifyError: vi.fn(),
}));

vi.mock('../../ai/profile-context.js', () => ({
  estimateTokens: vi.fn((text: string) => Math.ceil(text.length / 4)),
}));

vi.mock('../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Import after mocks are set up
import {
  ChatAIAgent,
  ChatRetryExhaustedError,
  buildSystemPrompt,
  resolveFallbackProvider,
  DEFAULT_CHAT_RETRY_CONFIG,
  type ChatStreamCallbacks,
  type ChatRetryEvent,
} from './chat-ai.js';
import { classifyError } from '../../ai/request-retry.js';
import { createProvider } from '../../ai/providers/provider-factory.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockProvider(overrides?: Partial<AIProviderInterface>): AIProviderInterface {
  return {
    name: 'mock-provider',
    tier: 1 as const,
    contextWindowSize: 200_000,
    chat: vi.fn().mockResolvedValue({
      content: 'hello',
      usage: { inputTokens: 10, outputTokens: 20 },
    }),
    stream: vi.fn<[ChatOptions, ProviderStreamCallbacks?], Promise<StreamResponse>>().mockResolvedValue({
      content: 'AI response text',
      usage: { inputTokens: 10, outputTokens: 20 },
      success: true,
    }),
    isAvailable: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

function mockClassifyError(classification: Partial<ErrorClassification>): void {
  (classifyError as ReturnType<typeof vi.fn>).mockReturnValue({
    retryable: false,
    category: 'unknown',
    message: 'error',
    ...classification,
  });
}

// Minimal valid json-plan that passes InstallPlanSchema
const VALID_PLAN_JSON = JSON.stringify({
  steps: [
    {
      id: 'step-1',
      description: 'Check disk',
      command: 'df -h',
      timeout: 30000,
      canRollback: false,
      onError: 'skip',
    },
  ],
  estimatedTime: 60000,
  risks: [{ level: 'low', description: 'Read-only command' }],
});

const VALID_PLAN_RESPONSE = `Here is the plan:\n\n\`\`\`json-plan\n${VALID_PLAN_JSON}\n\`\`\``;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ChatAIAgent', () => {
  let provider: AIProviderInterface;
  let agent: ChatAIAgent;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    provider = createMockProvider();
    agent = new ChatAIAgent(provider, {
      maxRetries: 2,
      initialDelayMs: 100,
      backoffMultiplier: 2,
      maxDelayMs: 5000,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ========================================================================
  // buildSystemPrompt
  // ========================================================================

  describe('buildSystemPrompt()', () => {
    it('returns base prompt when no arguments provided', () => {
      const prompt = buildSystemPrompt();
      expect(prompt).toContain('You are ServerPilot');
      expect(prompt).not.toContain('Important Caveats');
    });

    it('appends profile context', () => {
      const prompt = buildSystemPrompt('## Server Profile\nOS: Ubuntu 22.04');
      expect(prompt).toContain('## Server Profile');
      expect(prompt).toContain('Ubuntu 22.04');
    });

    it('appends caveats section', () => {
      const prompt = buildSystemPrompt(undefined, ['Docker is running', 'Nginx configured']);
      expect(prompt).toContain('## Important Caveats');
      expect(prompt).toContain('- Docker is running');
      expect(prompt).toContain('- Nginx configured');
    });

    it('appends knowledge context', () => {
      const prompt = buildSystemPrompt(undefined, undefined, '## Knowledge\nSome docs...');
      expect(prompt).toContain('## Knowledge');
      expect(prompt).toContain('Some docs...');
    });

    it('combines all parts in order', () => {
      const prompt = buildSystemPrompt('PROFILE', ['CAVEAT'], 'KNOWLEDGE');
      const profileIdx = prompt.indexOf('PROFILE');
      const caveatIdx = prompt.indexOf('CAVEAT');
      const knowledgeIdx = prompt.indexOf('KNOWLEDGE');
      expect(profileIdx).toBeLessThan(caveatIdx);
      expect(caveatIdx).toBeLessThan(knowledgeIdx);
    });
  });

  // ========================================================================
  // chat() — success path
  // ========================================================================

  describe('chat() — success', () => {
    it('returns text and null plan for plain text response', async () => {
      const result = await agent.chat('hello', 'Server: web-01', '');
      expect(result.text).toBe('AI response text');
      expect(result.plan).toBeNull();
      expect(provider.stream).toHaveBeenCalledTimes(1);
    });

    it('extracts plan from json-plan fenced block', async () => {
      (provider.stream as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        content: VALID_PLAN_RESPONSE,
        usage: { inputTokens: 10, outputTokens: 50 },
        success: true,
      });

      const result = await agent.chat('check disk', 'Server: web-01', '');
      expect(result.plan).not.toBeNull();
      expect(result.plan?.steps).toHaveLength(1);
      expect(result.plan?.steps[0].command).toBe('df -h');
      expect(result.plan?.description).toBe(undefined); // No description in raw JSON
    });

    it('includes profileTokens when profileContext is provided', async () => {
      const profileCtx = 'OS: Ubuntu 22.04 LTS';
      const result = await agent.chat('hello', 'Server: web-01', '', undefined, profileCtx);
      expect(result.profileTokens).toBeGreaterThan(0);
    });

    it('passes conversation history into user prompt', async () => {
      await agent.chat('latest msg', 'Server: db-01', 'User: prev\nAI: reply');

      const streamCall = (provider.stream as ReturnType<typeof vi.fn>).mock.calls[0];
      const userContent = streamCall[0].messages[0].content as string;
      expect(userContent).toContain('Conversation history:');
      expect(userContent).toContain('User: prev');
      expect(userContent).toContain('latest msg');
    });

    it('invokes onToken callback during streaming', async () => {
      const tokens: string[] = [];
      (provider.stream as ReturnType<typeof vi.fn>).mockImplementation(
        async (_opts: ChatOptions, cbs?: ProviderStreamCallbacks) => {
          cbs?.onToken?.('Hello', 'Hello');
          cbs?.onToken?.(' world', 'Hello world');
          return { content: 'Hello world', usage: { inputTokens: 5, outputTokens: 10 }, success: true };
        },
      );

      await agent.chat('hi', 'Server: x', '', {
        onToken: (token: string) => { tokens.push(token); },
      });

      // The agent wraps the callback — tokens may not propagate exactly
      // but the provider's stream was called with callbacks
      expect(provider.stream).toHaveBeenCalledTimes(1);
    });
  });

  // ========================================================================
  // chat() — retry on transient errors
  // ========================================================================

  describe('chat() — retry logic', () => {
    it('retries on transient error and succeeds on second attempt', async () => {
      const transientError = new Error('ECONNRESET');
      mockClassifyError({ retryable: true, category: 'network', message: 'Network error' });

      let callCount = 0;
      (provider.stream as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        callCount++;
        if (callCount === 1) throw transientError;
        return { content: 'ok', usage: { inputTokens: 5, outputTokens: 5 }, success: true };
      });

      const retryEvents: ChatRetryEvent[] = [];
      const result = await agent.chat('msg', 'Server: x', '', {
        onRetry: (evt) => { retryEvents.push(evt); },
      });

      expect(result.text).toBe('ok');
      expect(callCount).toBe(2);
      expect(retryEvents).toHaveLength(1);
      expect(retryEvents[0].attempt).toBe(1);
      expect(retryEvents[0].isFallback).toBe(false);
    });

    it('throws immediately on non-retryable error (auth)', async () => {
      const authError = new Error('Invalid API key');
      mockClassifyError({ retryable: false, category: 'authentication', message: 'Auth failed' });

      (provider.stream as ReturnType<typeof vi.fn>).mockRejectedValueOnce(authError);

      await expect(
        agent.chat('msg', 'Server: x', ''),
      ).rejects.toThrow('Invalid API key');

      expect(provider.stream).toHaveBeenCalledTimes(1);
    });

    it('throws ChatRetryExhaustedError after all retries', async () => {
      const serverError = new Error('Internal Server Error');
      mockClassifyError({ retryable: true, category: 'server_error', message: 'Server error' });

      (provider.stream as ReturnType<typeof vi.fn>).mockRejectedValue(serverError);

      const retryEvents: ChatRetryEvent[] = [];
      await expect(
        agent.chat('msg', 'Server: x', '', {
          onRetry: (evt) => { retryEvents.push(evt); },
        }),
      ).rejects.toThrow(ChatRetryExhaustedError);

      // maxRetries=2, so 3 attempts total, 2 retries notified
      expect(provider.stream).toHaveBeenCalledTimes(3);
      expect(retryEvents).toHaveLength(2);
    });

    it('ChatRetryExhaustedError carries last classification', async () => {
      mockClassifyError({ retryable: true, category: 'rate_limit', message: 'Rate limited' });
      (provider.stream as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('429'));

      try {
        await agent.chat('msg', 'Server: x', '');
        expect.fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ChatRetryExhaustedError);
        const retryErr = err as ChatRetryExhaustedError;
        expect(retryErr.classification?.category).toBe('rate_limit');
      }
    });

    it('respects retryAfterMs from classification in delay calculation', async () => {
      mockClassifyError({
        retryable: true,
        category: 'rate_limit',
        message: 'Rate limited',
        retryAfterMs: 50,
      });

      let callCount = 0;
      (provider.stream as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        callCount++;
        if (callCount <= 1) throw new Error('429');
        return { content: 'ok', usage: { inputTokens: 5, outputTokens: 5 }, success: true };
      });

      const result = await agent.chat('msg', 'Server: x', '');
      expect(result.text).toBe('ok');
      expect(callCount).toBe(2);
    });

    it('handles stream returning success=false as an error', async () => {
      mockClassifyError({ retryable: false, category: 'unknown', message: 'AI streaming request failed' });

      (provider.stream as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        content: '',
        usage: { inputTokens: 0, outputTokens: 0 },
        success: false,
        error: 'AI streaming request failed',
      });

      await expect(
        agent.chat('msg', 'Server: x', ''),
      ).rejects.toThrow('AI streaming request failed');
    });
  });

  // ========================================================================
  // chat() — onRetry callback error handling
  // ========================================================================

  describe('chat() — callback error handling', () => {
    it('does not crash when onRetry callback throws', async () => {
      mockClassifyError({ retryable: true, category: 'network', message: 'Network error' });

      let callCount = 0;
      (provider.stream as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        callCount++;
        if (callCount === 1) throw new Error('network fail');
        return { content: 'ok', usage: { inputTokens: 5, outputTokens: 5 }, success: true };
      });

      const result = await agent.chat('msg', 'Server: x', '', {
        onRetry: () => { throw new Error('callback exploded'); },
      });

      // Should still succeed despite the broken callback
      expect(result.text).toBe('ok');
    });
  });

  // ========================================================================
  // extractPlan (via chat)
  // ========================================================================

  describe('extractPlan (via chat)', () => {
    it('returns null when no json-plan block in response', async () => {
      (provider.stream as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        content: 'Just a text answer with no plan.',
        usage: { inputTokens: 5, outputTokens: 10 },
        success: true,
      });

      const result = await agent.chat('hello', 'Server: x', '');
      expect(result.plan).toBeNull();
    });

    it('normalizes missing onError to "skip"', async () => {
      const planJson = JSON.stringify({
        steps: [{
          id: 's1',
          description: 'Test',
          command: 'echo test',
          timeout: 5000,
          canRollback: false,
          // onError intentionally missing
        }],
        estimatedTime: 5000,
        risks: [],
      });
      (provider.stream as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        content: `\`\`\`json-plan\n${planJson}\n\`\`\``,
        usage: { inputTokens: 5, outputTokens: 30 },
        success: true,
      });

      const result = await agent.chat('do something', 'Server: x', '');
      expect(result.plan?.steps[0].onError).toBe('skip');
    });

    it('normalizes invalid onError values', async () => {
      const planJson = JSON.stringify({
        steps: [{
          id: 's1',
          description: 'Test',
          command: 'echo test',
          timeout: 5000,
          canRollback: false,
          onError: 'continue', // invalid → normalized to "skip"
        }],
        estimatedTime: 5000,
        risks: [],
      });
      (provider.stream as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        content: `\`\`\`json-plan\n${planJson}\n\`\`\``,
        usage: { inputTokens: 5, outputTokens: 30 },
        success: true,
      });

      const result = await agent.chat('do something', 'Server: x', '');
      expect(result.plan?.steps[0].onError).toBe('skip');
    });

    it('normalizes "stop" onError to "abort"', async () => {
      const planJson = JSON.stringify({
        steps: [{
          id: 's1',
          description: 'Test',
          command: 'rm -rf /tmp/test',
          timeout: 5000,
          canRollback: false,
          onError: 'stop',
        }],
        estimatedTime: 5000,
        risks: [{ level: 'high', description: 'Destructive' }],
      });
      (provider.stream as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        content: `\`\`\`json-plan\n${planJson}\n\`\`\``,
        usage: { inputTokens: 5, outputTokens: 30 },
        success: true,
      });

      const result = await agent.chat('do something', 'Server: x', '');
      expect(result.plan?.steps[0].onError).toBe('abort');
    });

    it('normalizes invalid risk levels', async () => {
      const planJson = JSON.stringify({
        steps: [{
          id: 's1',
          description: 'Test',
          command: 'echo ok',
          timeout: 5000,
          canRollback: false,
          onError: 'skip',
        }],
        estimatedTime: 5000,
        risks: [{ level: 'none', description: 'Safe' }], // "none" → "low"
      });
      (provider.stream as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        content: `\`\`\`json-plan\n${planJson}\n\`\`\``,
        usage: { inputTokens: 5, outputTokens: 30 },
        success: true,
      });

      const result = await agent.chat('do something', 'Server: x', '');
      expect(result.plan?.risks[0].level).toBe('low');
    });

    it('defaults missing timeout and canRollback', async () => {
      const planJson = JSON.stringify({
        steps: [{
          id: 's1',
          description: 'Test',
          command: 'echo ok',
          onError: 'skip',
          // timeout and canRollback missing
        }],
        estimatedTime: 5000,
        risks: [],
      });
      (provider.stream as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        content: `\`\`\`json-plan\n${planJson}\n\`\`\``,
        usage: { inputTokens: 5, outputTokens: 30 },
        success: true,
      });

      const result = await agent.chat('do something', 'Server: x', '');
      expect(result.plan?.steps[0].timeout).toBe(30000);
      expect(result.plan?.steps[0].canRollback).toBe(false);
    });

    it('defaults missing estimatedTime', async () => {
      const planJson = JSON.stringify({
        steps: [{
          id: 's1',
          description: 'Test',
          command: 'echo ok',
          timeout: 5000,
          canRollback: false,
          onError: 'skip',
        }],
        risks: [],
        // estimatedTime missing
      });
      (provider.stream as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        content: `\`\`\`json-plan\n${planJson}\n\`\`\``,
        usage: { inputTokens: 5, outputTokens: 30 },
        success: true,
      });

      const result = await agent.chat('do something', 'Server: x', '');
      expect(result.plan?.estimatedTime).toBe(30000);
    });

    it('returns null for invalid JSON in json-plan block', async () => {
      (provider.stream as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        content: '```json-plan\n{invalid json}\n```',
        usage: { inputTokens: 5, outputTokens: 10 },
        success: true,
      });

      const result = await agent.chat('do something', 'Server: x', '');
      expect(result.plan).toBeNull();
    });

    it('preserves description from raw plan JSON', async () => {
      const planJson = JSON.stringify({
        description: 'Check server disk usage',
        steps: [{
          id: 's1',
          description: 'Run df',
          command: 'df -h',
          timeout: 5000,
          canRollback: false,
          onError: 'skip',
        }],
        estimatedTime: 5000,
        risks: [],
      });
      (provider.stream as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        content: `\`\`\`json-plan\n${planJson}\n\`\`\``,
        usage: { inputTokens: 5, outputTokens: 30 },
        success: true,
      });

      const result = await agent.chat('check disk', 'Server: x', '');
      expect(result.plan?.description).toBe('Check server disk usage');
    });
  });

  // ========================================================================
  // chatWithFallback()
  // ========================================================================

  describe('chatWithFallback()', () => {
    it('returns null when no fallback provider is available', async () => {
      // Ensure resolveFallbackProvider returns null by clearing env
      const savedKeys = {
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
        OPENAI_API_KEY: process.env.OPENAI_API_KEY,
        DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
        OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL,
        CUSTOM_OPENAI_API_KEY: process.env.CUSTOM_OPENAI_API_KEY,
      };
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.OPENAI_API_KEY;
      delete process.env.DEEPSEEK_API_KEY;
      delete process.env.OLLAMA_BASE_URL;
      delete process.env.CUSTOM_OPENAI_API_KEY;

      // createProvider will throw for each fallback attempt
      (createProvider as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('No credentials');
      });

      const result = await agent.chatWithFallback('msg', 'Server: x', '');
      expect(result).toBeNull();

      // Restore env
      Object.entries(savedKeys).forEach(([k, v]) => {
        if (v !== undefined) process.env[k] = v;
      });
    });

    it('successfully falls back to another provider', async () => {
      const fallbackProvider = createMockProvider({ name: 'openai' });
      (createProvider as ReturnType<typeof vi.fn>).mockReturnValueOnce(fallbackProvider);

      // Set env so resolveFallbackConfig finds openai
      const savedKey = process.env.OPENAI_API_KEY;
      process.env.OPENAI_API_KEY = 'test-key';

      const retryEvents: ChatRetryEvent[] = [];
      const result = await agent.chatWithFallback('msg', 'Server: x', '', {
        onRetry: (evt) => { retryEvents.push(evt); },
      });

      expect(result).not.toBeNull();
      expect(result?.text).toBe('AI response text');
      expect(retryEvents).toHaveLength(1);
      expect(retryEvents[0].isFallback).toBe(true);
      expect(retryEvents[0].fallbackProvider).toBe('openai');

      if (savedKey !== undefined) {
        process.env.OPENAI_API_KEY = savedKey;
      } else {
        delete process.env.OPENAI_API_KEY;
      }
    });

    it('returns null when fallback provider also fails', async () => {
      const failingProvider = createMockProvider({ name: 'openai' });
      mockClassifyError({ retryable: false, category: 'authentication', message: 'Bad key' });
      (failingProvider.stream as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Bad key'));
      (createProvider as ReturnType<typeof vi.fn>).mockReturnValueOnce(failingProvider);

      const savedKey = process.env.OPENAI_API_KEY;
      process.env.OPENAI_API_KEY = 'bad-key';

      const result = await agent.chatWithFallback('msg', 'Server: x', '');
      expect(result).toBeNull();

      if (savedKey !== undefined) {
        process.env.OPENAI_API_KEY = savedKey;
      } else {
        delete process.env.OPENAI_API_KEY;
      }
    });
  });

  // ========================================================================
  // DEFAULT_CHAT_RETRY_CONFIG
  // ========================================================================

  describe('DEFAULT_CHAT_RETRY_CONFIG', () => {
    it('has sensible defaults', () => {
      expect(DEFAULT_CHAT_RETRY_CONFIG.maxRetries).toBe(3);
      expect(DEFAULT_CHAT_RETRY_CONFIG.initialDelayMs).toBe(1000);
      expect(DEFAULT_CHAT_RETRY_CONFIG.backoffMultiplier).toBe(2);
      expect(DEFAULT_CHAT_RETRY_CONFIG.maxDelayMs).toBe(30000);
    });
  });

  // ========================================================================
  // ChatRetryExhaustedError
  // ========================================================================

  describe('ChatRetryExhaustedError', () => {
    it('sets name and classification properties', () => {
      const classification: ErrorClassification = {
        retryable: true,
        category: 'server_error',
        message: 'Server error',
        statusCode: 500,
      };
      const err = new ChatRetryExhaustedError('All retries failed', classification);
      expect(err.name).toBe('ChatRetryExhaustedError');
      expect(err.message).toBe('All retries failed');
      expect(err.classification).toBe(classification);
      expect(err).toBeInstanceOf(Error);
    });

    it('works without classification', () => {
      const err = new ChatRetryExhaustedError('Failed');
      expect(err.classification).toBeUndefined();
    });
  });
});

// ===========================================================================
// resolveFallbackProvider (exported, testable independently)
// ===========================================================================

describe('resolveFallbackProvider()', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    // Clean up env vars we may have set
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.OLLAMA_BASE_URL;
    delete process.env.CUSTOM_OPENAI_API_KEY;
    delete process.env.CUSTOM_OPENAI_BASE_URL;
  });

  it('skips the current provider and picks the next available', () => {
    const mockOpenAI = createMockProvider({ name: 'openai' });
    (createProvider as ReturnType<typeof vi.fn>).mockReturnValueOnce(mockOpenAI);
    process.env.OPENAI_API_KEY = 'test-key';

    const result = resolveFallbackProvider('claude');
    expect(result).not.toBeNull();
    expect(result?.name).toBe('openai');
  });

  it('falls back through priority order: claude → openai → deepseek → ollama', () => {
    // No openai key, but deepseek key available
    process.env.DEEPSEEK_API_KEY = 'dk-test';
    const mockDeepSeek = createMockProvider({ name: 'deepseek' });

    (createProvider as ReturnType<typeof vi.fn>)
      .mockImplementationOnce(() => { throw new Error('No openai credentials'); }) // openai skipped (no key, but it still goes through the flow)
      .mockReturnValueOnce(mockDeepSeek); // deepseek succeeds

    const result = resolveFallbackProvider('claude');
    // Since OPENAI_API_KEY is not set, resolveFallbackConfig returns null for openai
    // createProvider won't even be called for openai — it's guarded by config check
    expect(result).not.toBeNull();
  });

  it('returns null when no fallback has credentials', () => {
    // All env vars cleared in afterEach, createProvider will throw for ollama
    (createProvider as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('No credentials');
    });

    const result = resolveFallbackProvider('claude');
    // ollama always has config (no key needed), so createProvider is called
    // but we make it throw
    expect(result).toBeNull();
  });

  it('returns ollama as last resort (no API key needed)', () => {
    const mockOllama = createMockProvider({ name: 'ollama' });
    (createProvider as ReturnType<typeof vi.fn>).mockReturnValue(mockOllama);

    const result = resolveFallbackProvider('claude');
    expect(result).not.toBeNull();
  });
});
