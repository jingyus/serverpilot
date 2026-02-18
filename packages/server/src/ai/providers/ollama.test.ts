// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for OllamaProvider (ai/providers/ollama.ts)
 *
 * Tests the Ollama AI provider including:
 * - Constructor defaults and custom configuration
 * - Configuration validation via Zod schema
 * - chat() - success, API errors, timeout, JSON parsing
 * - stream() - success, chunk parsing, callbacks, error handling
 * - isAvailable() - model found, model not found, connection failure
 * - Error classification (OllamaError with status codes)
 * - Message building with system prompts
 * - Token usage extraction
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OllamaProvider, OllamaError, OllamaConfigSchema } from "./ollama.js";
import type { OllamaConfig } from "./ollama.js";
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
    model: "llama3.2",
    message: { role: "assistant", content },
    done: true,
    total_duration: 5000000000,
    prompt_eval_count: 42,
    eval_count: 128,
    ...overrides,
  };
}

function createMockStreamChunks(tokens: string[]): string {
  const chunks = tokens.map((token, i) => {
    const isLast = i === tokens.length - 1;
    return JSON.stringify({
      model: "llama3.2",
      message: { role: "assistant", content: token },
      done: isLast,
      ...(isLast ? { prompt_eval_count: 42, eval_count: tokens.length } : {}),
    });
  });
  return chunks.join("\n") + "\n";
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
    headers: new Headers(),
  } as unknown as Response;
}

// ============================================================================
// Tests: Constructor & Configuration
// ============================================================================

describe("OllamaProvider", () => {
  describe("constructor", () => {
    it("should use default configuration", () => {
      const provider = new OllamaProvider();
      expect(provider.name).toBe("ollama");
      expect(provider.tier).toBe(3);
    });

    it("should accept custom configuration", () => {
      const provider = new OllamaProvider({
        baseUrl: "http://192.168.1.100:11434",
        model: "mistral",
        timeoutMs: 60000,
      });
      expect(provider.name).toBe("ollama");
      expect(provider.tier).toBe(3);
    });

    it("should strip trailing slashes from baseUrl", async () => {
      const provider = new OllamaProvider({
        baseUrl: "http://localhost:11434/",
      });

      mockFetch.mockResolvedValueOnce(
        createMockResponse(createMockChatResponse("hello")),
      );

      await provider.chat(createChatOptions());

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:11434/api/chat",
        expect.anything(),
      );
    });

    it("should reject invalid baseUrl", () => {
      expect(() => new OllamaProvider({ baseUrl: "not-a-url" })).toThrow();
    });

    it("should reject empty model name", () => {
      expect(() => new OllamaProvider({ model: "" })).toThrow();
    });

    it("should reject non-positive timeout", () => {
      expect(() => new OllamaProvider({ timeoutMs: 0 })).toThrow();
      expect(() => new OllamaProvider({ timeoutMs: -1 })).toThrow();
    });
  });

  describe("OllamaConfigSchema", () => {
    it("should apply defaults for empty object", () => {
      const config = OllamaConfigSchema.parse({});
      expect(config.baseUrl).toBe("http://localhost:11434");
      expect(config.model).toBe("llama3.2");
      expect(config.timeoutMs).toBe(120000);
    });

    it("should accept valid custom config", () => {
      const config = OllamaConfigSchema.parse({
        baseUrl: "http://10.0.0.5:11434",
        model: "codellama",
        timeoutMs: 30000,
      });
      expect(config.model).toBe("codellama");
      expect(config.timeoutMs).toBe(30000);
    });
  });

  // ==========================================================================
  // Tests: chat()
  // ==========================================================================

  describe("chat()", () => {
    it("should send a successful chat request", async () => {
      const provider = new OllamaProvider();
      const responseBody = createMockChatResponse('{"summary": "All good"}');

      mockFetch.mockResolvedValueOnce(createMockResponse(responseBody));

      const result = await provider.chat(createChatOptions());

      expect(result.content).toBe('{"summary": "All good"}');
      expect(result.usage.inputTokens).toBe(42);
      expect(result.usage.outputTokens).toBe(128);
    });

    it("should include system prompt as a system message", async () => {
      const provider = new OllamaProvider();
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
      const provider = new OllamaProvider();
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
      const provider = new OllamaProvider();
      mockFetch.mockResolvedValueOnce(
        createMockResponse(createMockChatResponse("ok")),
      );

      await provider.chat(createChatOptions());

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1].body as string);
      expect(body.stream).toBe(false);
    });

    it("should use configured model name", async () => {
      const provider = new OllamaProvider({ model: "codellama" });
      mockFetch.mockResolvedValueOnce(
        createMockResponse(createMockChatResponse("ok")),
      );

      await provider.chat(createChatOptions());

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1].body as string);
      expect(body.model).toBe("codellama");
    });

    it("should pass maxTokens as num_predict", async () => {
      const provider = new OllamaProvider();
      mockFetch.mockResolvedValueOnce(
        createMockResponse(createMockChatResponse("ok")),
      );

      await provider.chat(createChatOptions({ maxTokens: 8192 }));

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1].body as string);
      expect(body.options.num_predict).toBe(8192);
    });

    it("should throw OllamaError on HTTP error response", async () => {
      const provider = new OllamaProvider();
      mockFetch.mockResolvedValueOnce(
        createMockResponse("model not found", 404),
      );

      await expect(provider.chat(createChatOptions())).rejects.toThrow(
        OllamaError,
      );

      try {
        await provider.chat(createChatOptions());
      } catch (err) {
        // fetch was already called above, this would be a second call
      }
    });

    it("should include status code in OllamaError", async () => {
      const provider = new OllamaProvider();
      mockFetch.mockResolvedValueOnce(
        createMockResponse("Internal Server Error", 500),
      );

      try {
        await provider.chat(createChatOptions());
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(OllamaError);
        expect((err as OllamaError).statusCode).toBe(500);
      }
    });

    it("should throw OllamaError on timeout", async () => {
      const provider = new OllamaProvider({ timeoutMs: 50 });

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

    it("should handle missing usage fields gracefully", async () => {
      const provider = new OllamaProvider();
      const responseBody = createMockChatResponse("ok", {
        prompt_eval_count: undefined,
        eval_count: undefined,
      });

      mockFetch.mockResolvedValueOnce(createMockResponse(responseBody));

      const result = await provider.chat(createChatOptions());
      expect(result.usage.inputTokens).toBe(0);
      expect(result.usage.outputTokens).toBe(0);
    });

    it("should throw on malformed API response", async () => {
      const provider = new OllamaProvider();
      mockFetch.mockResolvedValueOnce(
        createMockResponse({ invalid: "response" }),
      );

      await expect(provider.chat(createChatOptions())).rejects.toThrow();
    });

    it("should use per-request timeoutMs if provided", async () => {
      const provider = new OllamaProvider({ timeoutMs: 120000 });
      mockFetch.mockResolvedValueOnce(
        createMockResponse(createMockChatResponse("ok")),
      );

      await provider.chat(createChatOptions({ timeoutMs: 5000 }));

      // Verify fetch was called (timeout is internal, hard to assert directly)
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  // ==========================================================================
  // Tests: stream()
  // ==========================================================================

  describe("stream()", () => {
    it("should stream tokens and call callbacks", async () => {
      const provider = new OllamaProvider();
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
      const provider = new OllamaProvider();
      const streamText = createMockStreamChunks(["ok"]);
      mockFetch.mockResolvedValueOnce(createMockStreamResponse(streamText));

      await provider.stream(createChatOptions());

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1].body as string);
      expect(body.stream).toBe(true);
    });

    it("should work without callbacks", async () => {
      const provider = new OllamaProvider();
      const streamText = createMockStreamChunks(["Hello", " world"]);
      mockFetch.mockResolvedValueOnce(createMockStreamResponse(streamText));

      const result = await provider.stream(createChatOptions());

      expect(result.success).toBe(true);
      expect(result.content).toBe("Hello world");
    });

    it("should call onToken with accumulated text", async () => {
      const provider = new OllamaProvider();
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
      const provider = new OllamaProvider();
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
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
      const provider = new OllamaProvider();
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

    it("should skip unparseable stream lines gracefully", async () => {
      const provider = new OllamaProvider();
      const goodChunk = JSON.stringify({
        model: "llama3.2",
        message: { role: "assistant", content: "ok" },
        done: true,
        prompt_eval_count: 10,
        eval_count: 1,
      });
      const streamText = "garbage line\n" + goodChunk + "\n";
      mockFetch.mockResolvedValueOnce(createMockStreamResponse(streamText));

      const result = await provider.stream(createChatOptions());

      expect(result.success).toBe(true);
      expect(result.content).toBe("ok");
    });

    it("should handle fetch network error in stream", async () => {
      const provider = new OllamaProvider();
      mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));

      const onError = vi.fn();
      const result = await provider.stream(createChatOptions(), { onError });

      expect(result.success).toBe(false);
      expect(result.error).toContain("ECONNREFUSED");
      expect(onError).toHaveBeenCalled();
    });

    it("should extract usage from final done chunk", async () => {
      const provider = new OllamaProvider();
      const chunks =
        [
          JSON.stringify({
            model: "llama3.2",
            message: { role: "assistant", content: "Hello" },
            done: false,
          }),
          JSON.stringify({
            model: "llama3.2",
            message: { role: "assistant", content: "" },
            done: true,
            prompt_eval_count: 100,
            eval_count: 50,
          }),
        ].join("\n") + "\n";

      mockFetch.mockResolvedValueOnce(createMockStreamResponse(chunks));

      const result = await provider.stream(createChatOptions());

      expect(result.usage.inputTokens).toBe(100);
      expect(result.usage.outputTokens).toBe(50);
    });
  });

  // ==========================================================================
  // Tests: isAvailable()
  // ==========================================================================

  describe("isAvailable()", () => {
    it("should return true when model is found", async () => {
      const provider = new OllamaProvider({ model: "llama3.2" });
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          models: [
            { name: "llama3.2", size: 4_000_000_000 },
            { name: "mistral", size: 4_000_000_000 },
          ],
        }),
      );

      expect(await provider.isAvailable()).toBe(true);
    });

    it("should match model with tag suffix", async () => {
      const provider = new OllamaProvider({ model: "llama3.2" });
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          models: [{ name: "llama3.2:latest", size: 4_000_000_000 }],
        }),
      );

      expect(await provider.isAvailable()).toBe(true);
    });

    it("should throw when model is not found", async () => {
      const provider = new OllamaProvider({ model: "nonexistent" });
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          models: [{ name: "llama3.2", size: 4_000_000_000 }],
        }),
      );

      await expect(provider.isAvailable()).rejects.toThrow(
        /未在 Ollama 中找到/,
      );
    });

    it("should throw when Ollama is unreachable", async () => {
      const provider = new OllamaProvider();
      mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));

      await expect(provider.isAvailable()).rejects.toThrow(/无法连接 Ollama/);
    });

    it("should throw on non-200 response", async () => {
      const provider = new OllamaProvider();
      mockFetch.mockResolvedValueOnce(createMockResponse("error", 500));

      await expect(provider.isAvailable()).rejects.toThrow(/Ollama 未响应/);
    });

    it("should throw on malformed tags response", async () => {
      const provider = new OllamaProvider();
      mockFetch.mockResolvedValueOnce(createMockResponse({ invalid: true }));

      await expect(provider.isAvailable()).rejects.toThrow(/无法连接 Ollama/);
    });

    it("should call /api/tags endpoint", async () => {
      const provider = new OllamaProvider({
        baseUrl: "http://10.0.0.5:11434",
      });
      mockFetch.mockResolvedValueOnce(createMockResponse({ models: [] }));

      await expect(provider.isAvailable()).rejects.toThrow(
        /未在 Ollama 中找到/,
      );
      expect(mockFetch).toHaveBeenCalledWith(
        "http://10.0.0.5:11434/api/tags",
        expect.objectContaining({ method: "GET" }),
      );
    });
  });

  // ==========================================================================
  // Tests: OllamaError
  // ==========================================================================

  describe("OllamaError", () => {
    it("should carry the status code", () => {
      const err = new OllamaError("Not Found", 404);
      expect(err.name).toBe("OllamaError");
      expect(err.message).toBe("Not Found");
      expect(err.statusCode).toBe(404);
      expect(err).toBeInstanceOf(Error);
    });
  });

  // ==========================================================================
  // Tests: Edge Cases
  // ==========================================================================

  describe("edge cases", () => {
    it("should handle empty messages array", async () => {
      const provider = new OllamaProvider();
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
      const provider = new OllamaProvider();
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
      const provider = new OllamaProvider();
      mockFetch.mockResolvedValueOnce(
        createMockResponse(createMockChatResponse("ok")),
      );

      await provider.chat(createChatOptions({ maxTokens: undefined }));

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1].body as string);
      expect(body.options.num_predict).toBe(4096);
    });
  });
});
