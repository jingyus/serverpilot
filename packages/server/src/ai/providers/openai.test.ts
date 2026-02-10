/**
 * Tests for OpenAIProvider (ai/providers/openai.ts)
 *
 * Tests the OpenAI AI provider including:
 * - Constructor defaults and custom configuration
 * - Configuration validation via Zod schema (API key required)
 * - chat() - success, API errors, timeout, auth errors, rate limits
 * - stream() - SSE parsing, callbacks, error handling, [DONE] signal
 * - isAvailable() - valid key, invalid key, connection failure
 * - Error classification (OpenAIError with status codes)
 * - Message building with system prompts
 * - Token usage extraction
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import {
  OpenAIProvider,
  OpenAIError,
  OpenAIConfigSchema,
  estimateCost,
  parseStructuredOutput,
} from './openai.js';
import type { OpenAIConfig } from './openai.js';
import type { ChatOptions, ProviderStreamCallbacks, TokenUsage } from './base.js';

// ============================================================================
// Mock fetch globally
// ============================================================================

const mockFetch = vi.fn<(...args: unknown[]) => Promise<Response>>();

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ============================================================================
// Test Helpers
// ============================================================================

const TEST_API_KEY = 'sk-test-openai-key-12345';

function createProvider(overrides?: Partial<OpenAIConfig>): OpenAIProvider {
  return new OpenAIProvider({
    apiKey: TEST_API_KEY,
    ...overrides,
  });
}

function createChatOptions(overrides?: Partial<ChatOptions>): ChatOptions {
  return {
    messages: [{ role: 'user', content: 'Analyze this environment' }],
    system: 'You are a DevOps expert. Respond with JSON only.',
    maxTokens: 2048,
    ...overrides,
  };
}

function createMockChatResponse(content: string, overrides?: Record<string, unknown>) {
  return {
    id: 'chatcmpl-test-123',
    choices: [{
      index: 0,
      message: { role: 'assistant', content },
      finish_reason: 'stop',
    }],
    usage: {
      prompt_tokens: 42,
      completion_tokens: 128,
      total_tokens: 170,
    },
    ...overrides,
  };
}

function createMockStreamChunks(tokens: string[]): string {
  const lines: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const isLast = i === tokens.length - 1;
    const chunk = {
      id: 'chatcmpl-test-123',
      choices: [{
        index: 0,
        delta: { content: tokens[i] },
        finish_reason: isLast ? 'stop' : null,
      }],
      ...(isLast ? {
        usage: {
          prompt_tokens: 42,
          completion_tokens: tokens.length,
          total_tokens: 42 + tokens.length,
        },
      } : {}),
    };
    lines.push(`data: ${JSON.stringify(chunk)}`);
  }
  lines.push('data: [DONE]');
  lines.push('');
  return lines.join('\n');
}

function createReadableStream(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const chunks = [encoder.encode(text)];
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(chunks[index++]);
      } else {
        controller.close();
      }
    },
  });
}

function createMockResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
    body: null,
    headers: new Headers(),
  } as unknown as Response;
}

function createMockStreamResponse(text: string, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    body: createReadableStream(text),
    text: () => Promise.resolve(text),
    json: () => Promise.resolve(JSON.parse(text)),
    headers: new Headers(),
  } as unknown as Response;
}

function createMockErrorResponse(message: string, type: string, status: number): Response {
  return createMockResponse({
    error: { message, type, code: null },
  }, status);
}

// ============================================================================
// Tests: Constructor & Configuration
// ============================================================================

describe('OpenAIProvider', () => {
  describe('constructor', () => {
    it('should use default configuration with API key', () => {
      const provider = createProvider();
      expect(provider.name).toBe('openai');
      expect(provider.tier).toBe(2);
    });

    it('should accept custom configuration', () => {
      const provider = createProvider({
        baseUrl: 'https://custom.openai.azure.com',
        model: 'gpt-4-turbo',
        timeoutMs: 30000,
      });
      expect(provider.name).toBe('openai');
      expect(provider.tier).toBe(2);
    });

    it('should strip trailing slashes from baseUrl', async () => {
      const provider = createProvider({
        baseUrl: 'https://api.openai.com/',
      });

      mockFetch.mockResolvedValueOnce(
        createMockResponse(createMockChatResponse('hello')),
      );

      await provider.chat(createChatOptions());

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.openai.com/v1/chat/completions',
        expect.anything(),
      );
    });

    it('should throw when API key is missing', () => {
      expect(() => new OpenAIProvider({ apiKey: '' })).toThrow();
    });

    it('should throw when API key is not provided and env is empty', () => {
      const originalEnv = process.env.OPENAI_API_KEY;
      delete process.env.OPENAI_API_KEY;

      try {
        expect(() => new OpenAIProvider()).toThrow();
      } finally {
        if (originalEnv !== undefined) {
          process.env.OPENAI_API_KEY = originalEnv;
        }
      }
    });

    it('should read API key from OPENAI_API_KEY env var', () => {
      const originalEnv = process.env.OPENAI_API_KEY;
      process.env.OPENAI_API_KEY = 'sk-env-test-key';

      try {
        const provider = new OpenAIProvider();
        expect(provider.name).toBe('openai');
      } finally {
        if (originalEnv !== undefined) {
          process.env.OPENAI_API_KEY = originalEnv;
        } else {
          delete process.env.OPENAI_API_KEY;
        }
      }
    });

    it('should reject invalid baseUrl', () => {
      expect(() => createProvider({ baseUrl: 'not-a-url' })).toThrow();
    });

    it('should reject empty model name', () => {
      expect(() => createProvider({ model: '' })).toThrow();
    });

    it('should reject non-positive timeout', () => {
      expect(() => createProvider({ timeoutMs: 0 })).toThrow();
      expect(() => createProvider({ timeoutMs: -1 })).toThrow();
    });
  });

  describe('OpenAIConfigSchema', () => {
    it('should apply defaults for minimal config', () => {
      const config = OpenAIConfigSchema.parse({ apiKey: TEST_API_KEY });
      expect(config.baseUrl).toBe('https://api.openai.com');
      expect(config.model).toBe('gpt-4o');
      expect(config.timeoutMs).toBe(60000);
      expect(config.apiKey).toBe(TEST_API_KEY);
    });

    it('should accept valid custom config', () => {
      const config = OpenAIConfigSchema.parse({
        baseUrl: 'https://custom.api.openai.com',
        apiKey: TEST_API_KEY,
        model: 'gpt-4-turbo',
        timeoutMs: 30000,
      });
      expect(config.model).toBe('gpt-4-turbo');
      expect(config.timeoutMs).toBe(30000);
    });

    it('should reject missing API key', () => {
      expect(() => OpenAIConfigSchema.parse({})).toThrow();
    });
  });

  // ==========================================================================
  // Tests: chat()
  // ==========================================================================

  describe('chat()', () => {
    it('should send a successful chat request', async () => {
      const provider = createProvider();
      const responseBody = createMockChatResponse('{"summary": "All good"}');

      mockFetch.mockResolvedValueOnce(createMockResponse(responseBody));

      const result = await provider.chat(createChatOptions());

      expect(result.content).toBe('{"summary": "All good"}');
      expect(result.usage.inputTokens).toBe(42);
      expect(result.usage.outputTokens).toBe(128);
    });

    it('should include system prompt as a system message', async () => {
      const provider = createProvider();
      mockFetch.mockResolvedValueOnce(
        createMockResponse(createMockChatResponse('ok')),
      );

      await provider.chat(createChatOptions({
        system: 'You are a JSON-only bot.',
        messages: [{ role: 'user', content: 'Hello' }],
      }));

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1].body as string);

      expect(body.messages[0]).toEqual({
        role: 'system',
        content: 'You are a JSON-only bot.',
      });
      expect(body.messages[1]).toEqual({
        role: 'user',
        content: 'Hello',
      });
    });

    it('should omit system message when system is not provided', async () => {
      const provider = createProvider();
      mockFetch.mockResolvedValueOnce(
        createMockResponse(createMockChatResponse('ok')),
      );

      await provider.chat(createChatOptions({ system: undefined }));

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1].body as string);

      expect(body.messages).toHaveLength(1);
      expect(body.messages[0].role).toBe('user');
    });

    it('should send stream: false for chat requests', async () => {
      const provider = createProvider();
      mockFetch.mockResolvedValueOnce(
        createMockResponse(createMockChatResponse('ok')),
      );

      await provider.chat(createChatOptions());

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1].body as string);
      expect(body.stream).toBe(false);
    });

    it('should use configured model name', async () => {
      const provider = createProvider({ model: 'gpt-4-turbo' });
      mockFetch.mockResolvedValueOnce(
        createMockResponse(createMockChatResponse('ok')),
      );

      await provider.chat(createChatOptions());

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1].body as string);
      expect(body.model).toBe('gpt-4-turbo');
    });

    it('should pass maxTokens as max_tokens', async () => {
      const provider = createProvider();
      mockFetch.mockResolvedValueOnce(
        createMockResponse(createMockChatResponse('ok')),
      );

      await provider.chat(createChatOptions({ maxTokens: 8192 }));

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1].body as string);
      expect(body.max_tokens).toBe(8192);
    });

    it('should include Authorization header with Bearer token', async () => {
      const provider = createProvider();
      mockFetch.mockResolvedValueOnce(
        createMockResponse(createMockChatResponse('ok')),
      );

      await provider.chat(createChatOptions());

      const fetchCall = mockFetch.mock.calls[0];
      const headers = fetchCall[1].headers;
      expect(headers['Authorization']).toBe(`Bearer ${TEST_API_KEY}`);
      expect(headers['Content-Type']).toBe('application/json');
    });

    it('should throw OpenAIError on HTTP error response', async () => {
      const provider = createProvider();
      mockFetch.mockResolvedValueOnce(
        createMockErrorResponse('Model not found', 'invalid_request_error', 404),
      );

      await expect(provider.chat(createChatOptions()))
        .rejects.toThrow(OpenAIError);
    });

    it('should include status code in OpenAIError', async () => {
      const provider = createProvider();
      mockFetch.mockResolvedValueOnce(
        createMockErrorResponse('Internal error', 'server_error', 500),
      );

      try {
        await provider.chat(createChatOptions());
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(OpenAIError);
        expect((err as OpenAIError).statusCode).toBe(500);
      }
    });

    it('should throw specific error on 401 authentication failure', async () => {
      const provider = createProvider();
      mockFetch.mockResolvedValueOnce(
        createMockErrorResponse('Invalid API key', 'authentication_error', 401),
      );

      await expect(provider.chat(createChatOptions()))
        .rejects.toThrow(/authentication failed/);
    });

    it('should throw specific error on 429 rate limit', async () => {
      const provider = createProvider();
      mockFetch.mockResolvedValueOnce(
        createMockErrorResponse('Rate limit exceeded', 'rate_limit_error', 429),
      );

      await expect(provider.chat(createChatOptions()))
        .rejects.toThrow(/rate limit/);
    });

    it('should throw specific error on 400 bad request', async () => {
      const provider = createProvider();
      mockFetch.mockResolvedValueOnce(
        createMockErrorResponse('Invalid request', 'invalid_request_error', 400),
      );

      await expect(provider.chat(createChatOptions()))
        .rejects.toThrow(/bad request/);
    });

    it('should throw OpenAIError on timeout', async () => {
      const provider = createProvider({ timeoutMs: 50 });

      mockFetch.mockImplementationOnce(
        () => new Promise((_, reject) => {
          setTimeout(() => {
            const err = new DOMException('The operation was aborted', 'AbortError');
            reject(err);
          }, 10);
        }),
      );

      await expect(provider.chat(createChatOptions()))
        .rejects.toThrow(/timed out/);
    });

    it('should throw on malformed API response', async () => {
      const provider = createProvider();
      mockFetch.mockResolvedValueOnce(
        createMockResponse({ invalid: 'response' }),
      );

      await expect(provider.chat(createChatOptions())).rejects.toThrow();
    });

    it('should use per-request timeoutMs if provided', async () => {
      const provider = createProvider({ timeoutMs: 120000 });
      mockFetch.mockResolvedValueOnce(
        createMockResponse(createMockChatResponse('ok')),
      );

      await provider.chat(createChatOptions({ timeoutMs: 5000 }));

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should call /v1/chat/completions endpoint', async () => {
      const provider = createProvider({
        baseUrl: 'https://custom.openai.com',
      });
      mockFetch.mockResolvedValueOnce(
        createMockResponse(createMockChatResponse('ok')),
      );

      await provider.chat(createChatOptions());

      expect(mockFetch).toHaveBeenCalledWith(
        'https://custom.openai.com/v1/chat/completions',
        expect.anything(),
      );
    });

    it('should handle error response with non-JSON body', async () => {
      const provider = createProvider();
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 502,
        json: () => Promise.reject(new Error('not json')),
        text: () => Promise.resolve('Bad Gateway'),
        headers: new Headers(),
      } as unknown as Response);

      await expect(provider.chat(createChatOptions()))
        .rejects.toThrow(/502/);
    });

    it('should handle null content in response', async () => {
      const provider = createProvider();
      const responseBody = {
        id: 'chatcmpl-test-123',
        choices: [{
          index: 0,
          message: { role: 'assistant', content: null },
          finish_reason: 'stop',
        }],
        usage: {
          prompt_tokens: 42,
          completion_tokens: 0,
          total_tokens: 42,
        },
      };

      mockFetch.mockResolvedValueOnce(createMockResponse(responseBody));

      const result = await provider.chat(createChatOptions());

      expect(result.content).toBe('');
    });
  });

  // ==========================================================================
  // Tests: stream()
  // ==========================================================================

  describe('stream()', () => {
    it('should stream tokens and call callbacks', async () => {
      const provider = createProvider();
      const streamText = createMockStreamChunks(['Hello', ' world', '!']);

      mockFetch.mockResolvedValueOnce(createMockStreamResponse(streamText));

      const tokens: string[] = [];
      const callbacks: ProviderStreamCallbacks = {
        onStart: vi.fn(),
        onToken: vi.fn((token) => tokens.push(token)),
        onComplete: vi.fn(),
        onError: vi.fn(),
      };

      const result = await provider.stream(createChatOptions(), callbacks);

      expect(result.success).toBe(true);
      expect(result.content).toBe('Hello world!');
      expect(tokens).toEqual(['Hello', ' world', '!']);
      expect(callbacks.onStart).toHaveBeenCalledTimes(1);
      expect(callbacks.onComplete).toHaveBeenCalledWith(
        'Hello world!',
        expect.objectContaining({ inputTokens: 42, outputTokens: 3 }),
      );
      expect(callbacks.onError).not.toHaveBeenCalled();
    });

    it('should send stream: true for streaming requests', async () => {
      const provider = createProvider();
      const streamText = createMockStreamChunks(['ok']);
      mockFetch.mockResolvedValueOnce(createMockStreamResponse(streamText));

      await provider.stream(createChatOptions());

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1].body as string);
      expect(body.stream).toBe(true);
    });

    it('should include stream_options for usage in streaming', async () => {
      const provider = createProvider();
      const streamText = createMockStreamChunks(['ok']);
      mockFetch.mockResolvedValueOnce(createMockStreamResponse(streamText));

      await provider.stream(createChatOptions());

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1].body as string);
      expect(body.stream_options).toEqual({ include_usage: true });
    });

    it('should work without callbacks', async () => {
      const provider = createProvider();
      const streamText = createMockStreamChunks(['Hello', ' world']);
      mockFetch.mockResolvedValueOnce(createMockStreamResponse(streamText));

      const result = await provider.stream(createChatOptions());

      expect(result.success).toBe(true);
      expect(result.content).toBe('Hello world');
    });

    it('should call onToken with accumulated text', async () => {
      const provider = createProvider();
      const streamText = createMockStreamChunks(['A', 'B', 'C']);
      mockFetch.mockResolvedValueOnce(createMockStreamResponse(streamText));

      const accumulatedValues: string[] = [];
      const callbacks: ProviderStreamCallbacks = {
        onToken: vi.fn((_, acc) => accumulatedValues.push(acc)),
      };

      await provider.stream(createChatOptions(), callbacks);

      expect(accumulatedValues).toEqual(['A', 'AB', 'ABC']);
    });

    it('should return error on HTTP failure', async () => {
      const provider = createProvider();
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: { message: 'Internal Server Error', type: 'server_error' } }),
        text: () => Promise.resolve('Internal Server Error'),
        body: null,
        headers: new Headers(),
      } as unknown as Response);

      const onError = vi.fn();
      const result = await provider.stream(createChatOptions(), { onError });

      expect(result.success).toBe(false);
      expect(result.error).toContain('500');
      expect(onError).toHaveBeenCalled();
    });

    it('should handle unreadable response body', async () => {
      const provider = createProvider();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: null,
        text: () => Promise.resolve(''),
        headers: new Headers(),
      } as unknown as Response);

      const result = await provider.stream(createChatOptions());

      expect(result.success).toBe(false);
      expect(result.error).toContain('not readable');
    });

    it('should handle [DONE] signal correctly', async () => {
      const provider = createProvider();
      // Manually build SSE with [DONE]
      const lines = [
        `data: ${JSON.stringify({
          id: 'chatcmpl-test',
          choices: [{ index: 0, delta: { content: 'done' }, finish_reason: null }],
        })}`,
        'data: [DONE]',
        '',
      ].join('\n');

      mockFetch.mockResolvedValueOnce(createMockStreamResponse(lines));

      const result = await provider.stream(createChatOptions());

      expect(result.success).toBe(true);
      expect(result.content).toBe('done');
    });

    it('should skip non-SSE lines gracefully', async () => {
      const provider = createProvider();
      const goodChunk = `data: ${JSON.stringify({
        id: 'chatcmpl-test',
        choices: [{ index: 0, delta: { content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 },
      })}`;
      const streamText = 'garbage line\n: comment\n' + goodChunk + '\ndata: [DONE]\n';
      mockFetch.mockResolvedValueOnce(createMockStreamResponse(streamText));

      const result = await provider.stream(createChatOptions());

      expect(result.success).toBe(true);
      expect(result.content).toBe('ok');
    });

    it('should handle fetch network error in stream', async () => {
      const provider = createProvider();
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const onError = vi.fn();
      const result = await provider.stream(createChatOptions(), { onError });

      expect(result.success).toBe(false);
      expect(result.error).toContain('ECONNREFUSED');
      expect(onError).toHaveBeenCalled();
    });

    it('should extract usage from final chunk', async () => {
      const provider = createProvider();
      const lines = [
        `data: ${JSON.stringify({
          id: 'chatcmpl-test',
          choices: [{ index: 0, delta: { content: 'Hello' }, finish_reason: null }],
        })}`,
        `data: ${JSON.stringify({
          id: 'chatcmpl-test',
          choices: [{ index: 0, delta: { content: '' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
        })}`,
        'data: [DONE]',
        '',
      ].join('\n');

      mockFetch.mockResolvedValueOnce(createMockStreamResponse(lines));

      const result = await provider.stream(createChatOptions());

      expect(result.usage.inputTokens).toBe(100);
      expect(result.usage.outputTokens).toBe(50);
    });

    it('should include Authorization header in stream requests', async () => {
      const provider = createProvider();
      const streamText = createMockStreamChunks(['ok']);
      mockFetch.mockResolvedValueOnce(createMockStreamResponse(streamText));

      await provider.stream(createChatOptions());

      const fetchCall = mockFetch.mock.calls[0];
      const headers = fetchCall[1].headers;
      expect(headers['Authorization']).toBe(`Bearer ${TEST_API_KEY}`);
    });
  });

  // ==========================================================================
  // Tests: isAvailable()
  // ==========================================================================

  describe('isAvailable()', () => {
    it('should return true when API responds with 200', async () => {
      const provider = createProvider();
      mockFetch.mockResolvedValueOnce(
        createMockResponse({ data: [{ id: 'gpt-4o' }] }),
      );

      expect(await provider.isAvailable()).toBe(true);
    });

    it('should return false when API responds with 401', async () => {
      const provider = createProvider();
      mockFetch.mockResolvedValueOnce(
        createMockResponse({ error: { message: 'Unauthorized' } }, 401),
      );

      expect(await provider.isAvailable()).toBe(false);
    });

    it('should return false when API is unreachable', async () => {
      const provider = createProvider();
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      expect(await provider.isAvailable()).toBe(false);
    });

    it('should return false on non-200 response', async () => {
      const provider = createProvider();
      mockFetch.mockResolvedValueOnce(
        createMockResponse('error', 500),
      );

      expect(await provider.isAvailable()).toBe(false);
    });

    it('should call /v1/models endpoint', async () => {
      const provider = createProvider({
        baseUrl: 'https://custom.openai.com',
      });
      mockFetch.mockResolvedValueOnce(
        createMockResponse({ data: [] }),
      );

      await provider.isAvailable();

      expect(mockFetch).toHaveBeenCalledWith(
        'https://custom.openai.com/v1/models',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'Authorization': `Bearer ${TEST_API_KEY}`,
          }),
        }),
      );
    });

    it('should use a short timeout for availability checks', async () => {
      const provider = createProvider();
      mockFetch.mockImplementationOnce(
        () => new Promise((_, reject) => {
          setTimeout(() => {
            const err = new DOMException('The operation was aborted', 'AbortError');
            reject(err);
          }, 10);
        }),
      );

      // Should not throw, just return false
      expect(await provider.isAvailable()).toBe(false);
    });
  });

  // ==========================================================================
  // Tests: OpenAIError
  // ==========================================================================

  describe('OpenAIError', () => {
    it('should carry the status code', () => {
      const err = new OpenAIError('Not Found', 404);
      expect(err.name).toBe('OpenAIError');
      expect(err.message).toBe('Not Found');
      expect(err.statusCode).toBe(404);
      expect(err).toBeInstanceOf(Error);
    });

    it('should have correct name for authentication error', () => {
      const err = new OpenAIError('OpenAI authentication failed: Invalid API key', 401);
      expect(err.name).toBe('OpenAIError');
      expect(err.statusCode).toBe(401);
      expect(err.message).toContain('authentication');
    });

    it('should have correct name for rate limit error', () => {
      const err = new OpenAIError('OpenAI rate limit exceeded', 429);
      expect(err.statusCode).toBe(429);
      expect(err.message).toContain('rate limit');
    });
  });

  // ==========================================================================
  // Tests: Edge Cases
  // ==========================================================================

  describe('edge cases', () => {
    it('should handle empty messages array', async () => {
      const provider = createProvider();
      mockFetch.mockResolvedValueOnce(
        createMockResponse(createMockChatResponse('ok')),
      );

      await provider.chat(createChatOptions({
        messages: [],
        system: undefined,
      }));

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1].body as string);
      expect(body.messages).toEqual([]);
    });

    it('should handle multi-turn conversation', async () => {
      const provider = createProvider();
      mockFetch.mockResolvedValueOnce(
        createMockResponse(createMockChatResponse('result')),
      );

      await provider.chat(createChatOptions({
        messages: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi there!' },
          { role: 'user', content: 'What is the status?' },
        ],
        system: 'You are helpful.',
      }));

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1].body as string);
      // system + 3 conversation messages
      expect(body.messages).toHaveLength(4);
      expect(body.messages[0].role).toBe('system');
      expect(body.messages[1].role).toBe('user');
      expect(body.messages[2].role).toBe('assistant');
      expect(body.messages[3].role).toBe('user');
    });

    it('should use default maxTokens when not specified', async () => {
      const provider = createProvider();
      mockFetch.mockResolvedValueOnce(
        createMockResponse(createMockChatResponse('ok')),
      );

      await provider.chat(createChatOptions({ maxTokens: undefined }));

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1].body as string);
      expect(body.max_tokens).toBe(4096);
    });

    it('should handle stream with empty delta content', async () => {
      const provider = createProvider();
      const lines = [
        `data: ${JSON.stringify({
          id: 'chatcmpl-test',
          choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }],
        })}`,
        `data: ${JSON.stringify({
          id: 'chatcmpl-test',
          choices: [{ index: 0, delta: { content: 'Hello' }, finish_reason: null }],
        })}`,
        `data: ${JSON.stringify({
          id: 'chatcmpl-test',
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 },
        })}`,
        'data: [DONE]',
        '',
      ].join('\n');

      mockFetch.mockResolvedValueOnce(createMockStreamResponse(lines));

      const result = await provider.stream(createChatOptions());

      expect(result.success).toBe(true);
      expect(result.content).toBe('Hello');
    });
  });

  // ==========================================================================
  // Tests: getModel()
  // ==========================================================================

  describe('getModel()', () => {
    it('should return default model', () => {
      const provider = createProvider();
      expect(provider.getModel()).toBe('gpt-4o');
    });

    it('should return custom model', () => {
      const provider = createProvider({ model: 'gpt-4-turbo' });
      expect(provider.getModel()).toBe('gpt-4-turbo');
    });
  });

  // ==========================================================================
  // Tests: estimateCost()
  // ==========================================================================

  describe('estimateCost()', () => {
    const usage: TokenUsage = { inputTokens: 1000, outputTokens: 500 };

    it('should estimate cost for gpt-4o', () => {
      const cost = estimateCost(usage, 'gpt-4o');
      expect(cost).not.toBeNull();
      expect(cost!.currency).toBe('USD');
      // 1000/1M * 2.50 = 0.0025 input
      expect(cost!.inputCost).toBeCloseTo(0.0025, 6);
      // 500/1M * 10.00 = 0.005 output
      expect(cost!.outputCost).toBeCloseTo(0.005, 6);
      expect(cost!.totalCost).toBeCloseTo(0.0075, 6);
    });

    it('should estimate cost for gpt-4o-mini', () => {
      const cost = estimateCost(usage, 'gpt-4o-mini');
      expect(cost).not.toBeNull();
      // 1000/1M * 0.15 = 0.00015 input
      expect(cost!.inputCost).toBeCloseTo(0.00015, 6);
      // 500/1M * 0.60 = 0.0003 output
      expect(cost!.outputCost).toBeCloseTo(0.0003, 6);
    });

    it('should estimate cost for gpt-4', () => {
      const cost = estimateCost(usage, 'gpt-4');
      expect(cost).not.toBeNull();
      // 1000/1M * 30.00 = 0.03 input
      expect(cost!.inputCost).toBeCloseTo(0.03, 6);
    });

    it('should estimate cost for gpt-3.5-turbo', () => {
      const cost = estimateCost(usage, 'gpt-3.5-turbo');
      expect(cost).not.toBeNull();
      expect(cost!.inputCost).toBeCloseTo(0.0005, 6);
    });

    it('should return null for unknown model', () => {
      const cost = estimateCost(usage, 'unknown-model');
      expect(cost).toBeNull();
    });

    it('should handle zero token usage', () => {
      const cost = estimateCost({ inputTokens: 0, outputTokens: 0 }, 'gpt-4o');
      expect(cost).not.toBeNull();
      expect(cost!.totalCost).toBe(0);
    });

    it('should be accessible via provider instance', () => {
      const provider = createProvider();
      const cost = provider.estimateCost(usage);
      expect(cost).not.toBeNull();
      expect(cost!.currency).toBe('USD');
    });

    it('should return null for provider with unknown model', () => {
      const provider = createProvider({ model: 'custom-model' });
      const cost = provider.estimateCost(usage);
      expect(cost).toBeNull();
    });
  });

  // ==========================================================================
  // Tests: parseStructuredOutput()
  // ==========================================================================

  describe('parseStructuredOutput()', () => {
    const TestSchema = z.object({
      name: z.string(),
      value: z.number(),
    });

    it('should parse plain JSON', () => {
      const result = parseStructuredOutput('{"name":"test","value":42}', TestSchema);
      expect(result).toEqual({ name: 'test', value: 42 });
    });

    it('should strip json code fences', () => {
      const text = '```json\n{"name":"test","value":42}\n```';
      const result = parseStructuredOutput(text, TestSchema);
      expect(result).toEqual({ name: 'test', value: 42 });
    });

    it('should strip bare code fences', () => {
      const text = '```\n{"name":"test","value":42}\n```';
      const result = parseStructuredOutput(text, TestSchema);
      expect(result).toEqual({ name: 'test', value: 42 });
    });

    it('should handle leading/trailing whitespace', () => {
      const text = '  \n  {"name":"test","value":42}  \n  ';
      const result = parseStructuredOutput(text, TestSchema);
      expect(result).toEqual({ name: 'test', value: 42 });
    });

    it('should throw on invalid JSON', () => {
      expect(() => parseStructuredOutput('not json', TestSchema)).toThrow();
    });

    it('should throw on schema validation failure', () => {
      expect(() => parseStructuredOutput('{"name":123}', TestSchema)).toThrow();
    });

    it('should parse array schemas', () => {
      const ArraySchema = z.array(z.object({ id: z.string() }));
      const text = '[{"id":"a"},{"id":"b"}]';
      const result = parseStructuredOutput(text, ArraySchema);
      expect(result).toHaveLength(2);
    });
  });

  // ==========================================================================
  // Tests: chatStructured()
  // ==========================================================================

  describe('chatStructured()', () => {
    const PlanSchema = z.object({
      steps: z.array(z.object({
        id: z.string(),
        command: z.string(),
      })),
    });

    it('should parse structured JSON response', async () => {
      const provider = createProvider();
      const jsonContent = '{"steps":[{"id":"s1","command":"npm install"}]}';
      mockFetch.mockResolvedValueOnce(
        createMockResponse(createMockChatResponse(jsonContent)),
      );

      const result = await provider.chatStructured(createChatOptions(), PlanSchema);

      expect(result.data.steps).toHaveLength(1);
      expect(result.data.steps[0].id).toBe('s1');
      expect(result.usage.inputTokens).toBe(42);
    });

    it('should strip code fences before parsing', async () => {
      const provider = createProvider();
      const jsonContent = '```json\n{"steps":[{"id":"s1","command":"apt install"}]}\n```';
      mockFetch.mockResolvedValueOnce(
        createMockResponse(createMockChatResponse(jsonContent)),
      );

      const result = await provider.chatStructured(createChatOptions(), PlanSchema);

      expect(result.data.steps[0].command).toBe('apt install');
    });

    it('should throw on invalid response structure', async () => {
      const provider = createProvider();
      mockFetch.mockResolvedValueOnce(
        createMockResponse(createMockChatResponse('{"invalid": true}')),
      );

      await expect(provider.chatStructured(createChatOptions(), PlanSchema))
        .rejects.toThrow();
    });
  });

  // ==========================================================================
  // Tests: chatWithRetry()
  // ==========================================================================

  describe('chatWithRetry()', () => {
    it('should succeed on first attempt', async () => {
      const provider = createProvider();
      mockFetch.mockResolvedValueOnce(
        createMockResponse(createMockChatResponse('ok')),
      );

      const result = await provider.chatWithRetry(createChatOptions());

      expect(result.success).toBe(true);
      expect(result.data?.content).toBe('ok');
      expect(result.attempts).toBe(1);
    });

    it('should retry on server error and succeed', async () => {
      const provider = createProvider();

      // First call: 500 error
      mockFetch.mockResolvedValueOnce(
        createMockErrorResponse('Internal error', 'server_error', 500),
      );
      // Second call: success
      mockFetch.mockResolvedValueOnce(
        createMockResponse(createMockChatResponse('ok')),
      );

      const result = await provider.chatWithRetry(createChatOptions(), {
        maxRetries: 2,
        initialDelayMs: 1,
      });

      expect(result.success).toBe(true);
      expect(result.attempts).toBe(2);
    });

    it('should retry on rate limit error', async () => {
      const provider = createProvider();

      mockFetch.mockResolvedValueOnce(
        createMockErrorResponse('Rate limited', 'rate_limit_error', 429),
      );
      mockFetch.mockResolvedValueOnce(
        createMockResponse(createMockChatResponse('ok')),
      );

      const result = await provider.chatWithRetry(createChatOptions(), {
        maxRetries: 1,
        initialDelayMs: 1,
      });

      expect(result.success).toBe(true);
      expect(result.attempts).toBe(2);
    });

    it('should not retry on auth error (401)', async () => {
      const provider = createProvider();
      mockFetch.mockResolvedValueOnce(
        createMockErrorResponse('Invalid API key', 'auth_error', 401),
      );

      const result = await provider.chatWithRetry(createChatOptions(), {
        maxRetries: 3,
        initialDelayMs: 1,
      });

      expect(result.success).toBe(false);
      expect(result.attempts).toBe(1);
      expect(result.error).toContain('authentication');
    });

    it('should not retry on bad request (400)', async () => {
      const provider = createProvider();
      mockFetch.mockResolvedValueOnce(
        createMockErrorResponse('Bad request', 'invalid_request', 400),
      );

      const result = await provider.chatWithRetry(createChatOptions(), {
        maxRetries: 3,
        initialDelayMs: 1,
      });

      expect(result.success).toBe(false);
      expect(result.attempts).toBe(1);
    });

    it('should not retry on 404', async () => {
      const provider = createProvider();
      mockFetch.mockResolvedValueOnce(
        createMockErrorResponse('Not found', 'not_found', 404),
      );

      const result = await provider.chatWithRetry(createChatOptions(), {
        maxRetries: 3,
        initialDelayMs: 1,
      });

      expect(result.success).toBe(false);
      expect(result.attempts).toBe(1);
    });

    it('should exhaust retries and report failure', async () => {
      const provider = createProvider();

      for (let i = 0; i < 4; i++) {
        mockFetch.mockResolvedValueOnce(
          createMockErrorResponse('Server error', 'server_error', 500),
        );
      }

      const result = await provider.chatWithRetry(createChatOptions(), {
        maxRetries: 3,
        initialDelayMs: 1,
      });

      expect(result.success).toBe(false);
      expect(result.attempts).toBe(4);
      expect(result.error).toContain('4 attempts');
    });

    it('should retry on network error', async () => {
      const provider = createProvider();

      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      mockFetch.mockResolvedValueOnce(
        createMockResponse(createMockChatResponse('ok')),
      );

      const result = await provider.chatWithRetry(createChatOptions(), {
        maxRetries: 1,
        initialDelayMs: 1,
      });

      expect(result.success).toBe(true);
      expect(result.attempts).toBe(2);
    });

    it('should use default retry options when not specified', async () => {
      const provider = createProvider();
      mockFetch.mockResolvedValueOnce(
        createMockResponse(createMockChatResponse('ok')),
      );

      const result = await provider.chatWithRetry(createChatOptions());

      expect(result.success).toBe(true);
      expect(result.attempts).toBe(1);
    });
  });

  // ==========================================================================
  // Tests: streamWithRetry()
  // ==========================================================================

  describe('streamWithRetry()', () => {
    it('should succeed on first attempt', async () => {
      const provider = createProvider();
      const streamText = createMockStreamChunks(['Hello']);
      mockFetch.mockResolvedValueOnce(createMockStreamResponse(streamText));

      const result = await provider.streamWithRetry(createChatOptions());

      expect(result.success).toBe(true);
      expect(result.data?.content).toBe('Hello');
      expect(result.attempts).toBe(1);
    });

    it('should retry on stream connection error', async () => {
      const provider = createProvider();

      // First call: network error
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      // Second call: success
      const streamText = createMockStreamChunks(['ok']);
      mockFetch.mockResolvedValueOnce(createMockStreamResponse(streamText));

      const result = await provider.streamWithRetry(createChatOptions(), undefined, {
        maxRetries: 1,
        initialDelayMs: 1,
      });

      expect(result.success).toBe(true);
      expect(result.attempts).toBe(2);
    });

    it('should not retry on auth error in stream', async () => {
      const provider = createProvider();
      mockFetch.mockResolvedValueOnce(
        createMockErrorResponse('Invalid API key', 'auth_error', 401),
      );

      const result = await provider.streamWithRetry(createChatOptions(), undefined, {
        maxRetries: 3,
        initialDelayMs: 1,
      });

      expect(result.success).toBe(false);
      expect(result.attempts).toBe(1);
    });

    it('should only use callbacks on first attempt', async () => {
      const provider = createProvider();

      // First attempt fails with unreadable body
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: null,
        text: () => Promise.resolve(''),
        headers: new Headers(),
      } as unknown as Response);

      // Second attempt succeeds
      const streamText = createMockStreamChunks(['ok']);
      mockFetch.mockResolvedValueOnce(createMockStreamResponse(streamText));

      const onStart = vi.fn();
      const result = await provider.streamWithRetry(
        createChatOptions(),
        { onStart },
        { maxRetries: 1, initialDelayMs: 1 },
      );

      expect(result.success).toBe(true);
    });

    it('should exhaust retries for stream failures', async () => {
      const provider = createProvider();

      // All attempts fail with server error
      for (let i = 0; i < 3; i++) {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 500,
          json: () => Promise.resolve({ error: { message: 'Server Error 500', type: 'server_error' } }),
          text: () => Promise.resolve('Server Error 500'),
          body: null,
          headers: new Headers(),
        } as unknown as Response);
      }

      const result = await provider.streamWithRetry(createChatOptions(), undefined, {
        maxRetries: 2,
        initialDelayMs: 1,
      });

      expect(result.success).toBe(false);
      expect(result.attempts).toBe(3);
      expect(result.error).toContain('3 attempts');
    });
  });
});
