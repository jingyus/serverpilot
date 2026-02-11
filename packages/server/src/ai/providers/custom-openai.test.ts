// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for CustomOpenAIProvider (ai/providers/custom-openai.ts)
 *
 * Tests the Custom OpenAI-compatible provider including:
 * - Constructor validation (baseUrl, apiKey, model all required)
 * - chat() - success, API errors, timeout, auth errors, rate limits
 * - stream() - SSE parsing, callbacks, error handling, [DONE] signal
 * - isAvailable() - valid key, invalid key, connection failure
 * - Error classification (CustomOpenAIError with status codes)
 * - Message building with system prompts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CustomOpenAIProvider, CustomOpenAIError, CustomOpenAIConfigSchema } from './custom-openai.js';
import type { CustomOpenAIConfig } from './custom-openai.js';
import type { ChatOptions, ProviderStreamCallbacks } from './base.js';

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

const DEFAULT_CONFIG: CustomOpenAIConfig = {
  baseUrl: 'https://oneapi.example.com/v1',
  apiKey: 'sk-test-custom-key-12345',
  model: 'gpt-4o',
};

function createProvider(overrides?: Partial<CustomOpenAIConfig>): CustomOpenAIProvider {
  return new CustomOpenAIProvider({ ...DEFAULT_CONFIG, ...overrides });
}

function createChatOptions(overrides?: Partial<ChatOptions>): ChatOptions {
  return {
    messages: [{ role: 'user', content: 'Analyze this environment' }],
    system: 'You are a DevOps expert.',
    maxTokens: 2048,
    ...overrides,
  };
}

function createMockChatResponse(content: string) {
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

describe('CustomOpenAIProvider', () => {
  describe('constructor', () => {
    it('should create provider with valid config', () => {
      const provider = createProvider();
      expect(provider.name).toBe('custom-openai');
      expect(provider.tier).toBe(2);
    });

    it('should accept custom configuration', () => {
      const provider = createProvider({
        baseUrl: 'https://litellm.example.com/v1',
        model: 'claude-3-sonnet',
        timeoutMs: 30000,
      });
      expect(provider.name).toBe('custom-openai');
      expect(provider.getModel()).toBe('claude-3-sonnet');
    });

    it('should strip trailing slashes from baseUrl', async () => {
      const provider = createProvider({
        baseUrl: 'https://oneapi.example.com/v1/',
      });

      mockFetch.mockResolvedValueOnce(
        createMockResponse(createMockChatResponse('hello')),
      );

      await provider.chat(createChatOptions());

      expect(mockFetch).toHaveBeenCalledWith(
        'https://oneapi.example.com/v1/chat/completions',
        expect.anything(),
      );
    });

    it('should throw when baseUrl is missing', () => {
      expect(() => new CustomOpenAIProvider({
        baseUrl: '',
        apiKey: 'sk-test',
        model: 'gpt-4o',
      })).toThrow();
    });

    it('should throw when baseUrl is invalid', () => {
      expect(() => new CustomOpenAIProvider({
        baseUrl: 'not-a-url',
        apiKey: 'sk-test',
        model: 'gpt-4o',
      })).toThrow();
    });

    it('should throw when apiKey is missing', () => {
      expect(() => new CustomOpenAIProvider({
        baseUrl: 'https://api.example.com/v1',
        apiKey: '',
        model: 'gpt-4o',
      })).toThrow();
    });

    it('should throw when model is missing', () => {
      expect(() => new CustomOpenAIProvider({
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'sk-test',
        model: '',
      })).toThrow();
    });

    it('should reject non-positive timeout', () => {
      expect(() => createProvider({ timeoutMs: 0 })).toThrow();
      expect(() => createProvider({ timeoutMs: -1 })).toThrow();
    });
  });

  describe('CustomOpenAIConfigSchema', () => {
    it('should apply default timeout for valid config', () => {
      const config = CustomOpenAIConfigSchema.parse({
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'sk-test',
        model: 'gpt-4o',
      });
      expect(config.timeoutMs).toBe(60000);
    });

    it('should accept custom timeout', () => {
      const config = CustomOpenAIConfigSchema.parse({
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'sk-test',
        model: 'gpt-4o',
        timeoutMs: 30000,
      });
      expect(config.timeoutMs).toBe(30000);
    });

    it('should reject missing baseUrl', () => {
      expect(() => CustomOpenAIConfigSchema.parse({
        apiKey: 'sk-test',
        model: 'gpt-4o',
      })).toThrow();
    });

    it('should reject missing apiKey', () => {
      expect(() => CustomOpenAIConfigSchema.parse({
        baseUrl: 'https://api.example.com/v1',
        model: 'gpt-4o',
      })).toThrow();
    });

    it('should reject missing model', () => {
      expect(() => CustomOpenAIConfigSchema.parse({
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'sk-test',
      })).toThrow();
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
      const provider = createProvider({ model: 'claude-3-sonnet' });
      mockFetch.mockResolvedValueOnce(
        createMockResponse(createMockChatResponse('ok')),
      );

      await provider.chat(createChatOptions());

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1].body as string);
      expect(body.model).toBe('claude-3-sonnet');
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
      expect(headers['Authorization']).toBe(`Bearer ${DEFAULT_CONFIG.apiKey}`);
      expect(headers['Content-Type']).toBe('application/json');
    });

    it('should call /chat/completions endpoint (appended to baseUrl)', async () => {
      const provider = createProvider({
        baseUrl: 'https://custom-api.example.com/v1',
      });
      mockFetch.mockResolvedValueOnce(
        createMockResponse(createMockChatResponse('ok')),
      );

      await provider.chat(createChatOptions());

      expect(mockFetch).toHaveBeenCalledWith(
        'https://custom-api.example.com/v1/chat/completions',
        expect.anything(),
      );
    });

    it('should throw CustomOpenAIError on HTTP error response', async () => {
      const provider = createProvider();
      mockFetch.mockResolvedValueOnce(
        createMockErrorResponse('Model not found', 'invalid_request_error', 404),
      );

      await expect(provider.chat(createChatOptions()))
        .rejects.toThrow(CustomOpenAIError);
    });

    it('should include status code in CustomOpenAIError', async () => {
      const provider = createProvider();
      mockFetch.mockResolvedValueOnce(
        createMockErrorResponse('Internal error', 'server_error', 500),
      );

      try {
        await provider.chat(createChatOptions());
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(CustomOpenAIError);
        expect((err as CustomOpenAIError).statusCode).toBe(500);
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

    it('should throw CustomOpenAIError on timeout', async () => {
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

    it('should call /models endpoint on the configured baseUrl', async () => {
      const provider = createProvider({
        baseUrl: 'https://custom.example.com/v1',
      });
      mockFetch.mockResolvedValueOnce(
        createMockResponse({ data: [] }),
      );

      await provider.isAvailable();

      expect(mockFetch).toHaveBeenCalledWith(
        'https://custom.example.com/v1/models',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'Authorization': `Bearer ${DEFAULT_CONFIG.apiKey}`,
          }),
        }),
      );
    });

    it('should return false on timeout', async () => {
      const provider = createProvider();
      mockFetch.mockImplementationOnce(
        () => new Promise((_, reject) => {
          setTimeout(() => {
            const err = new DOMException('The operation was aborted', 'AbortError');
            reject(err);
          }, 10);
        }),
      );

      expect(await provider.isAvailable()).toBe(false);
    });
  });

  // ==========================================================================
  // Tests: CustomOpenAIError
  // ==========================================================================

  describe('CustomOpenAIError', () => {
    it('should carry the status code', () => {
      const err = new CustomOpenAIError('Not Found', 404);
      expect(err.name).toBe('CustomOpenAIError');
      expect(err.message).toBe('Not Found');
      expect(err.statusCode).toBe(404);
      expect(err).toBeInstanceOf(Error);
    });

    it('should have correct name for authentication error', () => {
      const err = new CustomOpenAIError('Custom OpenAI authentication failed: Invalid API key', 401);
      expect(err.name).toBe('CustomOpenAIError');
      expect(err.statusCode).toBe(401);
      expect(err.message).toContain('authentication');
    });

    it('should have correct name for rate limit error', () => {
      const err = new CustomOpenAIError('Custom OpenAI rate limit exceeded', 429);
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
      expect(body.messages).toHaveLength(4);
      expect(body.messages[0].role).toBe('system');
      expect(body.messages[1].role).toBe('user');
      expect(body.messages[2].role).toBe('assistant');
      expect(body.messages[3].role).toBe('user');
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

    it('should expose model name via getModel()', () => {
      const provider = createProvider({ model: 'my-custom-model' });
      expect(provider.getModel()).toBe('my-custom-model');
    });
  });
});
