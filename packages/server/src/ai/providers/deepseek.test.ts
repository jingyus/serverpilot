// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for DeepSeekProvider (ai/providers/deepseek.ts)
 *
 * Tests the DeepSeek AI provider including:
 * - Constructor defaults and custom configuration
 * - Configuration validation via Zod schema (API key required)
 * - chat() - success, API errors, timeout, auth errors, rate limits
 * - stream() - SSE parsing, callbacks, error handling, [DONE] signal
 * - isAvailable() - valid key, invalid key, connection failure
 * - Error classification (DeepSeekError with status codes)
 * - Message building with system prompts
 * - Token usage extraction from OpenAI-compatible format
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  DeepSeekProvider,
  DeepSeekError,
  DeepSeekConfigSchema,
} from "./deepseek.js";
import type { DeepSeekConfig } from "./deepseek.js";
import type { ChatOptions, ProviderStreamCallbacks } from "./base.js";

// ============================================================================
// Mock fetch globally
// ============================================================================

const mockFetch = vi.fn<(...args: unknown[]) => Promise<Response>>();

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ============================================================================
// Test Helpers
// ============================================================================

const TEST_API_KEY = "sk-test-deepseek-key-12345";

function createProvider(overrides?: Partial<DeepSeekConfig>): DeepSeekProvider {
  return new DeepSeekProvider({
    apiKey: TEST_API_KEY,
    ...overrides,
  });
}

function createChatOptions(overrides?: Partial<ChatOptions>): ChatOptions {
  return {
    messages: [{ role: "user", content: "Analyze this environment" }],
    system: "You are a DevOps expert. Respond with JSON only.",
    maxTokens: 2048,
    ...overrides,
  };
}

function createMockChatResponse(
  content: string,
  overrides?: Record<string, unknown>,
) {
  return {
    id: "chatcmpl-test-123",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content },
        finish_reason: "stop",
      },
    ],
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
      id: "chatcmpl-test-123",
      choices: [
        {
          index: 0,
          delta: { content: tokens[i] },
          finish_reason: isLast ? "stop" : null,
        },
      ],
      ...(isLast
        ? {
            usage: {
              prompt_tokens: 42,
              completion_tokens: tokens.length,
              total_tokens: 42 + tokens.length,
            },
          }
        : {}),
    };
    lines.push(`data: ${JSON.stringify(chunk)}`);
  }
  lines.push("data: [DONE]");
  lines.push("");
  return lines.join("\n");
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
    text: () =>
      Promise.resolve(typeof body === "string" ? body : JSON.stringify(body)),
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

function createMockErrorResponse(
  message: string,
  type: string,
  status: number,
): Response {
  return createMockResponse(
    {
      error: { message, type, code: null },
    },
    status,
  );
}

// ============================================================================
// Tests: Constructor & Configuration
// ============================================================================

describe("DeepSeekProvider", () => {
  describe("constructor", () => {
    it("should use default configuration with API key", () => {
      const provider = createProvider();
      expect(provider.name).toBe("deepseek");
      expect(provider.tier).toBe(2);
    });

    it("should accept custom configuration", () => {
      const provider = createProvider({
        baseUrl: "https://custom.deepseek.com",
        model: "deepseek-coder",
        timeoutMs: 30000,
      });
      expect(provider.name).toBe("deepseek");
      expect(provider.tier).toBe(2);
    });

    it("should strip trailing slashes from baseUrl", async () => {
      const provider = createProvider({
        baseUrl: "https://api.deepseek.com/",
      });

      mockFetch.mockResolvedValueOnce(
        createMockResponse(createMockChatResponse("hello")),
      );

      await provider.chat(createChatOptions());

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.deepseek.com/v1/chat/completions",
        expect.anything(),
      );
    });

    it("should throw when API key is missing", () => {
      expect(() => new DeepSeekProvider({ apiKey: "" })).toThrow();
    });

    it("should throw when API key is not provided and env is empty", () => {
      const originalEnv = process.env.DEEPSEEK_API_KEY;
      delete process.env.DEEPSEEK_API_KEY;

      try {
        expect(() => new DeepSeekProvider()).toThrow();
      } finally {
        if (originalEnv !== undefined) {
          process.env.DEEPSEEK_API_KEY = originalEnv;
        }
      }
    });

    it("should read API key from DEEPSEEK_API_KEY env var", () => {
      const originalEnv = process.env.DEEPSEEK_API_KEY;
      process.env.DEEPSEEK_API_KEY = "sk-env-test-key";

      try {
        const provider = new DeepSeekProvider();
        expect(provider.name).toBe("deepseek");
      } finally {
        if (originalEnv !== undefined) {
          process.env.DEEPSEEK_API_KEY = originalEnv;
        } else {
          delete process.env.DEEPSEEK_API_KEY;
        }
      }
    });

    it("should reject invalid baseUrl", () => {
      expect(() => createProvider({ baseUrl: "not-a-url" })).toThrow();
    });

    it("should reject empty model name", () => {
      expect(() => createProvider({ model: "" })).toThrow();
    });

    it("should reject non-positive timeout", () => {
      expect(() => createProvider({ timeoutMs: 0 })).toThrow();
      expect(() => createProvider({ timeoutMs: -1 })).toThrow();
    });
  });

  describe("DeepSeekConfigSchema", () => {
    it("should apply defaults for minimal config", () => {
      const config = DeepSeekConfigSchema.parse({ apiKey: TEST_API_KEY });
      expect(config.baseUrl).toBe("https://api.deepseek.com");
      expect(config.model).toBe("deepseek-chat");
      expect(config.timeoutMs).toBe(60000);
      expect(config.apiKey).toBe(TEST_API_KEY);
    });

    it("should accept valid custom config", () => {
      const config = DeepSeekConfigSchema.parse({
        baseUrl: "https://custom.api.deepseek.com",
        apiKey: TEST_API_KEY,
        model: "deepseek-coder",
        timeoutMs: 30000,
      });
      expect(config.model).toBe("deepseek-coder");
      expect(config.timeoutMs).toBe(30000);
    });

    it("should reject missing API key", () => {
      expect(() => DeepSeekConfigSchema.parse({})).toThrow();
    });
  });

  // ==========================================================================
  // Tests: chat()
  // ==========================================================================

  describe("chat()", () => {
    it("should send a successful chat request", async () => {
      const provider = createProvider();
      const responseBody = createMockChatResponse('{"summary": "All good"}');

      mockFetch.mockResolvedValueOnce(createMockResponse(responseBody));

      const result = await provider.chat(createChatOptions());

      expect(result.content).toBe('{"summary": "All good"}');
      expect(result.usage.inputTokens).toBe(42);
      expect(result.usage.outputTokens).toBe(128);
    });

    it("should include system prompt as a system message", async () => {
      const provider = createProvider();
      mockFetch.mockResolvedValueOnce(
        createMockResponse(createMockChatResponse("ok")),
      );

      await provider.chat(
        createChatOptions({
          system: "You are a JSON-only bot.",
          messages: [{ role: "user", content: "Hello" }],
        }),
      );

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1].body as string);

      expect(body.messages[0]).toEqual({
        role: "system",
        content: "You are a JSON-only bot.",
      });
      expect(body.messages[1]).toEqual({
        role: "user",
        content: "Hello",
      });
    });

    it("should omit system message when system is not provided", async () => {
      const provider = createProvider();
      mockFetch.mockResolvedValueOnce(
        createMockResponse(createMockChatResponse("ok")),
      );

      await provider.chat(createChatOptions({ system: undefined }));

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1].body as string);

      expect(body.messages).toHaveLength(1);
      expect(body.messages[0].role).toBe("user");
    });

    it("should send stream: false for chat requests", async () => {
      const provider = createProvider();
      mockFetch.mockResolvedValueOnce(
        createMockResponse(createMockChatResponse("ok")),
      );

      await provider.chat(createChatOptions());

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1].body as string);
      expect(body.stream).toBe(false);
    });

    it("should use configured model name", async () => {
      const provider = createProvider({ model: "deepseek-coder" });
      mockFetch.mockResolvedValueOnce(
        createMockResponse(createMockChatResponse("ok")),
      );

      await provider.chat(createChatOptions());

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1].body as string);
      expect(body.model).toBe("deepseek-coder");
    });

    it("should pass maxTokens as max_tokens", async () => {
      const provider = createProvider();
      mockFetch.mockResolvedValueOnce(
        createMockResponse(createMockChatResponse("ok")),
      );

      await provider.chat(createChatOptions({ maxTokens: 8192 }));

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1].body as string);
      expect(body.max_tokens).toBe(8192);
    });

    it("should include Authorization header with Bearer token", async () => {
      const provider = createProvider();
      mockFetch.mockResolvedValueOnce(
        createMockResponse(createMockChatResponse("ok")),
      );

      await provider.chat(createChatOptions());

      const fetchCall = mockFetch.mock.calls[0];
      const headers = fetchCall[1].headers;
      expect(headers["Authorization"]).toBe(`Bearer ${TEST_API_KEY}`);
      expect(headers["Content-Type"]).toBe("application/json");
    });

    it("should throw DeepSeekError on HTTP error response", async () => {
      const provider = createProvider();
      mockFetch.mockResolvedValueOnce(
        createMockErrorResponse(
          "Model not found",
          "invalid_request_error",
          404,
        ),
      );

      await expect(provider.chat(createChatOptions())).rejects.toThrow(
        DeepSeekError,
      );
    });

    it("should include status code in DeepSeekError", async () => {
      const provider = createProvider();
      mockFetch.mockResolvedValueOnce(
        createMockErrorResponse("Internal error", "server_error", 500),
      );

      try {
        await provider.chat(createChatOptions());
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(DeepSeekError);
        expect((err as DeepSeekError).statusCode).toBe(500);
      }
    });

    it("should throw specific error on 401 authentication failure", async () => {
      const provider = createProvider();
      mockFetch.mockResolvedValueOnce(
        createMockErrorResponse("Invalid API key", "authentication_error", 401),
      );

      await expect(provider.chat(createChatOptions())).rejects.toThrow(
        /authentication failed/,
      );
    });

    it("should throw specific error on 429 rate limit", async () => {
      const provider = createProvider();
      mockFetch.mockResolvedValueOnce(
        createMockErrorResponse("Rate limit exceeded", "rate_limit_error", 429),
      );

      await expect(provider.chat(createChatOptions())).rejects.toThrow(
        /rate limit/,
      );
    });

    it("should throw DeepSeekError on timeout", async () => {
      const provider = createProvider({ timeoutMs: 50 });

      mockFetch.mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            setTimeout(() => {
              const err = new DOMException(
                "The operation was aborted",
                "AbortError",
              );
              reject(err);
            }, 10);
          }),
      );

      await expect(provider.chat(createChatOptions())).rejects.toThrow(
        /timed out/,
      );
    });

    it("should throw on malformed API response", async () => {
      const provider = createProvider();
      mockFetch.mockResolvedValueOnce(
        createMockResponse({ invalid: "response" }),
      );

      await expect(provider.chat(createChatOptions())).rejects.toThrow();
    });

    it("should use per-request timeoutMs if provided", async () => {
      const provider = createProvider({ timeoutMs: 120000 });
      mockFetch.mockResolvedValueOnce(
        createMockResponse(createMockChatResponse("ok")),
      );

      await provider.chat(createChatOptions({ timeoutMs: 5000 }));

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("should call /v1/chat/completions endpoint", async () => {
      const provider = createProvider({
        baseUrl: "https://custom.deepseek.com",
      });
      mockFetch.mockResolvedValueOnce(
        createMockResponse(createMockChatResponse("ok")),
      );

      await provider.chat(createChatOptions());

      expect(mockFetch).toHaveBeenCalledWith(
        "https://custom.deepseek.com/v1/chat/completions",
        expect.anything(),
      );
    });

    it("should handle error response with non-JSON body", async () => {
      const provider = createProvider();
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 502,
        json: () => Promise.reject(new Error("not json")),
        text: () => Promise.resolve("Bad Gateway"),
        headers: new Headers(),
      } as unknown as Response);

      await expect(provider.chat(createChatOptions())).rejects.toThrow(/502/);
    });
  });

  // ==========================================================================
  // Tests: stream()
  // ==========================================================================

  describe("stream()", () => {
    it("should stream tokens and call callbacks", async () => {
      const provider = createProvider();
      const streamText = createMockStreamChunks(["Hello", " world", "!"]);

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
      expect(result.content).toBe("Hello world!");
      expect(tokens).toEqual(["Hello", " world", "!"]);
      expect(callbacks.onStart).toHaveBeenCalledTimes(1);
      expect(callbacks.onComplete).toHaveBeenCalledWith(
        "Hello world!",
        expect.objectContaining({ inputTokens: 42, outputTokens: 3 }),
      );
      expect(callbacks.onError).not.toHaveBeenCalled();
    });

    it("should send stream: true for streaming requests", async () => {
      const provider = createProvider();
      const streamText = createMockStreamChunks(["ok"]);
      mockFetch.mockResolvedValueOnce(createMockStreamResponse(streamText));

      await provider.stream(createChatOptions());

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1].body as string);
      expect(body.stream).toBe(true);
    });

    it("should work without callbacks", async () => {
      const provider = createProvider();
      const streamText = createMockStreamChunks(["Hello", " world"]);
      mockFetch.mockResolvedValueOnce(createMockStreamResponse(streamText));

      const result = await provider.stream(createChatOptions());

      expect(result.success).toBe(true);
      expect(result.content).toBe("Hello world");
    });

    it("should call onToken with accumulated text", async () => {
      const provider = createProvider();
      const streamText = createMockStreamChunks(["A", "B", "C"]);
      mockFetch.mockResolvedValueOnce(createMockStreamResponse(streamText));

      const accumulatedValues: string[] = [];
      const callbacks: ProviderStreamCallbacks = {
        onToken: vi.fn((_, acc) => accumulatedValues.push(acc)),
      };

      await provider.stream(createChatOptions(), callbacks);

      expect(accumulatedValues).toEqual(["A", "AB", "ABC"]);
    });

    it("should return error on HTTP failure", async () => {
      const provider = createProvider();
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: () =>
          Promise.resolve({
            error: { message: "Internal Server Error", type: "server_error" },
          }),
        text: () => Promise.resolve("Internal Server Error"),
        body: null,
        headers: new Headers(),
      } as unknown as Response);

      const onError = vi.fn();
      const result = await provider.stream(createChatOptions(), { onError });

      expect(result.success).toBe(false);
      expect(result.error).toContain("500");
      expect(onError).toHaveBeenCalled();
    });

    it("should handle unreadable response body", async () => {
      const provider = createProvider();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: null,
        text: () => Promise.resolve(""),
        headers: new Headers(),
      } as unknown as Response);

      const result = await provider.stream(createChatOptions());

      expect(result.success).toBe(false);
      expect(result.error).toContain("not readable");
    });

    it("should handle [DONE] signal correctly", async () => {
      const provider = createProvider();
      // Manually build SSE with [DONE]
      const lines = [
        `data: ${JSON.stringify({
          id: "chatcmpl-test",
          choices: [
            { index: 0, delta: { content: "done" }, finish_reason: null },
          ],
        })}`,
        "data: [DONE]",
        "",
      ].join("\n");

      mockFetch.mockResolvedValueOnce(createMockStreamResponse(lines));

      const result = await provider.stream(createChatOptions());

      expect(result.success).toBe(true);
      expect(result.content).toBe("done");
    });

    it("should skip non-SSE lines gracefully", async () => {
      const provider = createProvider();
      const goodChunk = `data: ${JSON.stringify({
        id: "chatcmpl-test",
        choices: [
          { index: 0, delta: { content: "ok" }, finish_reason: "stop" },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 },
      })}`;
      const streamText =
        "garbage line\n: comment\n" + goodChunk + "\ndata: [DONE]\n";
      mockFetch.mockResolvedValueOnce(createMockStreamResponse(streamText));

      const result = await provider.stream(createChatOptions());

      expect(result.success).toBe(true);
      expect(result.content).toBe("ok");
    });

    it("should handle fetch network error in stream", async () => {
      const provider = createProvider();
      mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));

      const onError = vi.fn();
      const result = await provider.stream(createChatOptions(), { onError });

      expect(result.success).toBe(false);
      expect(result.error).toContain("ECONNREFUSED");
      expect(onError).toHaveBeenCalled();
    });

    it("should extract usage from final chunk", async () => {
      const provider = createProvider();
      const lines = [
        `data: ${JSON.stringify({
          id: "chatcmpl-test",
          choices: [
            { index: 0, delta: { content: "Hello" }, finish_reason: null },
          ],
        })}`,
        `data: ${JSON.stringify({
          id: "chatcmpl-test",
          choices: [
            { index: 0, delta: { content: "" }, finish_reason: "stop" },
          ],
          usage: {
            prompt_tokens: 100,
            completion_tokens: 50,
            total_tokens: 150,
          },
        })}`,
        "data: [DONE]",
        "",
      ].join("\n");

      mockFetch.mockResolvedValueOnce(createMockStreamResponse(lines));

      const result = await provider.stream(createChatOptions());

      expect(result.usage.inputTokens).toBe(100);
      expect(result.usage.outputTokens).toBe(50);
    });

    it("should include Authorization header in stream requests", async () => {
      const provider = createProvider();
      const streamText = createMockStreamChunks(["ok"]);
      mockFetch.mockResolvedValueOnce(createMockStreamResponse(streamText));

      await provider.stream(createChatOptions());

      const fetchCall = mockFetch.mock.calls[0];
      const headers = fetchCall[1].headers;
      expect(headers["Authorization"]).toBe(`Bearer ${TEST_API_KEY}`);
    });
  });

  // ==========================================================================
  // Tests: isAvailable()
  // ==========================================================================

  describe("isAvailable()", () => {
    it("should return true when API responds with 200", async () => {
      const provider = createProvider();
      mockFetch.mockResolvedValueOnce(
        createMockResponse({ data: [{ id: "deepseek-chat" }] }),
      );

      expect(await provider.isAvailable()).toBe(true);
    });

    it("should throw when API responds with 401", async () => {
      const provider = createProvider();
      mockFetch.mockResolvedValueOnce(
        createMockResponse({ error: { message: "Unauthorized" } }, 401),
      );

      await expect(provider.isAvailable()).rejects.toThrow(
        /API 密钥无效或已过期/,
      );
    });

    it("should throw when API is unreachable", async () => {
      const provider = createProvider();
      mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));

      await expect(provider.isAvailable()).rejects.toThrow(/无法连接 DeepSeek/);
    });

    it("should throw on non-200 response", async () => {
      const provider = createProvider();
      mockFetch.mockResolvedValueOnce(createMockResponse("error", 500));

      await expect(provider.isAvailable()).rejects.toThrow(/健康检查失败/);
    });

    it("should call /v1/models endpoint", async () => {
      const provider = createProvider({
        baseUrl: "https://custom.deepseek.com",
      });
      mockFetch.mockResolvedValueOnce(createMockResponse({ data: [] }));

      await provider.isAvailable();

      expect(mockFetch).toHaveBeenCalledWith(
        "https://custom.deepseek.com/v1/models",
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            Authorization: `Bearer ${TEST_API_KEY}`,
          }),
        }),
      );
    });

    it("should use a short timeout for availability checks", async () => {
      const provider = createProvider();
      mockFetch.mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            setTimeout(() => {
              const err = new DOMException(
                "The operation was aborted",
                "AbortError",
              );
              reject(err);
            }, 10);
          }),
      );

      await expect(provider.isAvailable()).rejects.toThrow(
        /无法连接 DeepSeek|timed out|AbortError/i,
      );
    });
  });

  // ==========================================================================
  // Tests: DeepSeekError
  // ==========================================================================

  describe("DeepSeekError", () => {
    it("should carry the status code", () => {
      const err = new DeepSeekError("Not Found", 404);
      expect(err.name).toBe("DeepSeekError");
      expect(err.message).toBe("Not Found");
      expect(err.statusCode).toBe(404);
      expect(err).toBeInstanceOf(Error);
    });

    it("should have correct name for authentication error", () => {
      const err = new DeepSeekError(
        "DeepSeek authentication failed: Invalid API key",
        401,
      );
      expect(err.name).toBe("DeepSeekError");
      expect(err.statusCode).toBe(401);
      expect(err.message).toContain("authentication");
    });

    it("should have correct name for rate limit error", () => {
      const err = new DeepSeekError("DeepSeek rate limit exceeded", 429);
      expect(err.statusCode).toBe(429);
      expect(err.message).toContain("rate limit");
    });
  });

  // ==========================================================================
  // Tests: Edge Cases
  // ==========================================================================

  describe("edge cases", () => {
    it("should handle empty messages array", async () => {
      const provider = createProvider();
      mockFetch.mockResolvedValueOnce(
        createMockResponse(createMockChatResponse("ok")),
      );

      await provider.chat(
        createChatOptions({
          messages: [],
          system: undefined,
        }),
      );

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1].body as string);
      expect(body.messages).toEqual([]);
    });

    it("should handle multi-turn conversation", async () => {
      const provider = createProvider();
      mockFetch.mockResolvedValueOnce(
        createMockResponse(createMockChatResponse("result")),
      );

      await provider.chat(
        createChatOptions({
          messages: [
            { role: "user", content: "Hello" },
            { role: "assistant", content: "Hi there!" },
            { role: "user", content: "What is the status?" },
          ],
          system: "You are helpful.",
        }),
      );

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1].body as string);
      // system + 3 conversation messages
      expect(body.messages).toHaveLength(4);
      expect(body.messages[0].role).toBe("system");
      expect(body.messages[1].role).toBe("user");
      expect(body.messages[2].role).toBe("assistant");
      expect(body.messages[3].role).toBe("user");
    });

    it("should use default maxTokens when not specified", async () => {
      const provider = createProvider();
      mockFetch.mockResolvedValueOnce(
        createMockResponse(createMockChatResponse("ok")),
      );

      await provider.chat(createChatOptions({ maxTokens: undefined }));

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1].body as string);
      expect(body.max_tokens).toBe(4096);
    });

    it("should handle stream with empty delta content", async () => {
      const provider = createProvider();
      const lines = [
        `data: ${JSON.stringify({
          id: "chatcmpl-test",
          choices: [
            { index: 0, delta: { role: "assistant" }, finish_reason: null },
          ],
        })}`,
        `data: ${JSON.stringify({
          id: "chatcmpl-test",
          choices: [
            { index: 0, delta: { content: "Hello" }, finish_reason: null },
          ],
        })}`,
        `data: ${JSON.stringify({
          id: "chatcmpl-test",
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 },
        })}`,
        "data: [DONE]",
        "",
      ].join("\n");

      mockFetch.mockResolvedValueOnce(createMockStreamResponse(lines));

      const result = await provider.stream(createChatOptions());

      expect(result.success).toBe(true);
      expect(result.content).toBe("Hello");
    });
  });

  // ==========================================================================
  // Tests: Tool Use / Function Calling
  // ==========================================================================

  describe("tool_use (function calling)", () => {
    const toolDefinitions = [
      {
        name: "execute_command",
        description: "Execute a shell command on the target server",
        input_schema: {
          type: "object",
          properties: {
            command: { type: "string", description: "The command to run" },
            description: {
              type: "string",
              description: "What this command does",
            },
          },
          required: ["command", "description"],
        },
      },
      {
        name: "read_file",
        description: "Read contents of a file",
        input_schema: {
          type: "object",
          properties: {
            path: { type: "string", description: "File path to read" },
          },
          required: ["path"],
        },
      },
    ];

    function createToolCallResponse(
      calls: Array<{
        id: string;
        name: string;
        arguments: Record<string, unknown>;
      }>,
    ) {
      return {
        id: "chatcmpl-tool-123",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: null,
              tool_calls: calls.map((tc) => ({
                id: tc.id,
                type: "function",
                function: {
                  name: tc.name,
                  arguments: JSON.stringify(tc.arguments),
                },
              })),
            },
            finish_reason: "tool_calls",
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
      };
    }

    it("should pass tools in OpenAI function calling format in chat()", async () => {
      const provider = createProvider();
      mockFetch.mockResolvedValueOnce(
        createMockResponse(createMockChatResponse("ok")),
      );

      await provider.chat(createChatOptions({ tools: toolDefinitions }));

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1].body as string);

      expect(body.tools).toHaveLength(2);
      expect(body.tools[0]).toEqual({
        type: "function",
        function: {
          name: "execute_command",
          description: "Execute a shell command on the target server",
          parameters: toolDefinitions[0].input_schema,
        },
      });
    });

    it("should extract tool calls from chat() response", async () => {
      const provider = createProvider();
      const responseBody = createToolCallResponse([
        {
          id: "call_abc123",
          name: "execute_command",
          arguments: { command: "ls -la", description: "List files" },
        },
      ]);

      mockFetch.mockResolvedValueOnce(createMockResponse(responseBody));

      const result = await provider.chat(
        createChatOptions({ tools: toolDefinitions }),
      );

      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls![0]).toEqual({
        type: "tool_use",
        id: "call_abc123",
        name: "execute_command",
        input: { command: "ls -la", description: "List files" },
      });
      expect(result.stopReason).toBe("tool_use");
      expect(result.content).toBe("");
    });

    it("should handle multiple tool calls in a single chat() response", async () => {
      const provider = createProvider();
      const responseBody = createToolCallResponse([
        {
          id: "call_1",
          name: "execute_command",
          arguments: { command: "ls", description: "List" },
        },
        { id: "call_2", name: "read_file", arguments: { path: "/etc/hosts" } },
      ]);

      mockFetch.mockResolvedValueOnce(createMockResponse(responseBody));

      const result = await provider.chat(
        createChatOptions({ tools: toolDefinitions }),
      );

      expect(result.toolCalls).toHaveLength(2);
      expect(result.toolCalls![0].name).toBe("execute_command");
      expect(result.toolCalls![1].name).toBe("read_file");
      expect(result.toolCalls![1].input).toEqual({ path: "/etc/hosts" });
    });

    it('should return stopReason "end_turn" when finish_reason is "stop"', async () => {
      const provider = createProvider();
      mockFetch.mockResolvedValueOnce(
        createMockResponse(createMockChatResponse("done")),
      );

      const result = await provider.chat(createChatOptions());
      expect(result.stopReason).toBe("end_turn");
    });

    it('should return stopReason "max_tokens" when finish_reason is "length"', async () => {
      const provider = createProvider();
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          id: "chatcmpl-test",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "partial output" },
              finish_reason: "length",
            },
          ],
          usage: {
            prompt_tokens: 50,
            completion_tokens: 4096,
            total_tokens: 4146,
          },
        }),
      );

      const result = await provider.chat(createChatOptions());
      expect(result.stopReason).toBe("max_tokens");
    });

    it("should not include tools in request body when tools is empty", async () => {
      const provider = createProvider();
      mockFetch.mockResolvedValueOnce(
        createMockResponse(createMockChatResponse("ok")),
      );

      await provider.chat(createChatOptions({ tools: [] }));

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1].body as string);
      expect(body.tools).toBeUndefined();
    });

    it("should accumulate streaming tool calls across chunks", async () => {
      const provider = createProvider();
      const lines = [
        // First chunk: tool call header with id and name
        `data: ${JSON.stringify({
          id: "chatcmpl-stream-tool",
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: "call_stream_1",
                    type: "function",
                    function: { name: "execute_command", arguments: '{"com' },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        })}`,
        // Second chunk: argument fragment
        `data: ${JSON.stringify({
          id: "chatcmpl-stream-tool",
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    function: { arguments: 'mand":"uname' },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        })}`,
        // Third chunk: closing argument + finish
        `data: ${JSON.stringify({
          id: "chatcmpl-stream-tool",
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    function: {
                      arguments: ' -a","description":"Get system info"}',
                    },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        })}`,
        // Final chunk: finish_reason + usage
        `data: ${JSON.stringify({
          id: "chatcmpl-stream-tool",
          choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
          usage: {
            prompt_tokens: 80,
            completion_tokens: 20,
            total_tokens: 100,
          },
        })}`,
        "data: [DONE]",
        "",
      ].join("\n");

      mockFetch.mockResolvedValueOnce(createMockStreamResponse(lines));

      const result = await provider.stream(
        createChatOptions({ tools: toolDefinitions }),
      );

      expect(result.success).toBe(true);
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls![0]).toEqual({
        type: "tool_use",
        id: "call_stream_1",
        name: "execute_command",
        input: { command: "uname -a", description: "Get system info" },
      });
      expect(result.stopReason).toBe("tool_use");
    });

    it("should handle stream with mixed text and tool calls", async () => {
      const provider = createProvider();
      const lines = [
        // Text content first
        `data: ${JSON.stringify({
          id: "chatcmpl-mix",
          choices: [
            {
              index: 0,
              delta: { content: "Let me check" },
              finish_reason: null,
            },
          ],
        })}`,
        // Then tool call
        `data: ${JSON.stringify({
          id: "chatcmpl-mix",
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: "call_mix",
                    type: "function",
                    function: {
                      name: "execute_command",
                      arguments:
                        '{"command":"df -h","description":"Check disk"}',
                    },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        })}`,
        `data: ${JSON.stringify({
          id: "chatcmpl-mix",
          choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
          usage: { prompt_tokens: 60, completion_tokens: 30, total_tokens: 90 },
        })}`,
        "data: [DONE]",
        "",
      ].join("\n");

      mockFetch.mockResolvedValueOnce(createMockStreamResponse(lines));

      const result = await provider.stream(
        createChatOptions({ tools: toolDefinitions }),
      );

      expect(result.success).toBe(true);
      expect(result.content).toBe("Let me check");
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls![0].name).toBe("execute_command");
      expect(result.stopReason).toBe("tool_use");
    });

    it("should handle multiple streaming tool calls with different indices", async () => {
      const provider = createProvider();
      const lines = [
        // First tool call
        `data: ${JSON.stringify({
          id: "chatcmpl-multi",
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: "call_a",
                    type: "function",
                    function: {
                      name: "execute_command",
                      arguments: '{"command":"ls","description":"List"}',
                    },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        })}`,
        // Second tool call (different index)
        `data: ${JSON.stringify({
          id: "chatcmpl-multi",
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 1,
                    id: "call_b",
                    type: "function",
                    function: {
                      name: "read_file",
                      arguments: '{"path":"/etc/hostname"}',
                    },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        })}`,
        `data: ${JSON.stringify({
          id: "chatcmpl-multi",
          choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
          usage: {
            prompt_tokens: 90,
            completion_tokens: 40,
            total_tokens: 130,
          },
        })}`,
        "data: [DONE]",
        "",
      ].join("\n");

      mockFetch.mockResolvedValueOnce(createMockStreamResponse(lines));

      const result = await provider.stream(
        createChatOptions({ tools: toolDefinitions }),
      );

      expect(result.success).toBe(true);
      expect(result.toolCalls).toHaveLength(2);
      expect(result.toolCalls![0].id).toBe("call_a");
      expect(result.toolCalls![0].name).toBe("execute_command");
      expect(result.toolCalls![1].id).toBe("call_b");
      expect(result.toolCalls![1].name).toBe("read_file");
      expect(result.toolCalls![1].input).toEqual({ path: "/etc/hostname" });
    });

    it("should pass tools in stream request body", async () => {
      const provider = createProvider();
      const streamText = createMockStreamChunks(["ok"]);
      mockFetch.mockResolvedValueOnce(createMockStreamResponse(streamText));

      await provider.stream(createChatOptions({ tools: toolDefinitions }));

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1].body as string);

      expect(body.tools).toHaveLength(2);
      expect(body.tools[0].type).toBe("function");
      expect(body.tools[0].function.name).toBe("execute_command");
    });

    it("should return no toolCalls when response has no tool_calls", async () => {
      const provider = createProvider();
      mockFetch.mockResolvedValueOnce(
        createMockResponse(createMockChatResponse("plain response")),
      );

      const result = await provider.chat(
        createChatOptions({ tools: toolDefinitions }),
      );

      expect(result.toolCalls).toBeUndefined();
      expect(result.stopReason).toBe("end_turn");
      expect(result.content).toBe("plain response");
    });
  });
});
