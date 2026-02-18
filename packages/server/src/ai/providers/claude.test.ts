// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for the Claude AI Provider.
 */

import { describe, it, expect, vi } from "vitest";
import { ClaudeProvider, ClaudeConfigSchema } from "./claude.js";

// Mock the Anthropic SDK
vi.mock("@anthropic-ai/sdk", () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ type: "text", text: "Hello, world!" }],
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
        stream: vi.fn().mockImplementation(() => {
          const handler = {
            _textCallbacks: [] as Array<(delta: string) => void>,
            on(event: string, cb: (delta: string) => void) {
              if (event === "text") this._textCallbacks.push(cb);
              return handler;
            },
            async finalMessage() {
              for (const cb of handler._textCallbacks) {
                cb("Hello ");
                cb("world!");
              }
              return {
                content: [{ type: "text", text: "Hello world!" }],
                usage: { input_tokens: 10, output_tokens: 6 },
              };
            },
          };
          return handler;
        }),
      },
    })),
  };
});

describe("ClaudeProvider", () => {
  describe("constructor", () => {
    it("should create with explicit API key", () => {
      const provider = new ClaudeProvider({ apiKey: "sk-test" });
      expect(provider.name).toBe("claude");
      expect(provider.tier).toBe(1);
    });

    it("should use default model", () => {
      const provider = new ClaudeProvider({ apiKey: "sk-test" });
      expect(provider.getModel()).toBe("claude-sonnet-4-5");
    });

    it("should accept custom model", () => {
      const provider = new ClaudeProvider({
        apiKey: "sk-test",
        model: "claude-3-haiku-20240307",
      });
      expect(provider.getModel()).toBe("claude-3-haiku-20240307");
    });

    it("should throw when API key is empty", () => {
      const origKey = process.env.ANTHROPIC_API_KEY;
      delete process.env.ANTHROPIC_API_KEY;
      try {
        expect(() => new ClaudeProvider({ apiKey: "" })).toThrow();
      } finally {
        if (origKey) process.env.ANTHROPIC_API_KEY = origKey;
      }
    });
  });

  describe("chat", () => {
    it("should return content and usage", async () => {
      const provider = new ClaudeProvider({ apiKey: "sk-test" });
      const result = await provider.chat({
        messages: [{ role: "user", content: "Hi" }],
      });
      expect(result.content).toBe("Hello, world!");
      expect(result.usage.inputTokens).toBe(10);
      expect(result.usage.outputTokens).toBe(5);
    });

    it("should pass system prompt", async () => {
      const provider = new ClaudeProvider({ apiKey: "sk-test" });
      const result = await provider.chat({
        messages: [{ role: "user", content: "Hi" }],
        system: "You are a helpful assistant.",
      });
      expect(result.content).toBe("Hello, world!");
    });
  });

  describe("stream", () => {
    it("should return streamed content", async () => {
      const provider = new ClaudeProvider({ apiKey: "sk-test" });
      const tokens: string[] = [];

      const result = await provider.stream(
        { messages: [{ role: "user", content: "Hi" }] },
        {
          onToken: (token) => tokens.push(token),
        },
      );

      expect(result.success).toBe(true);
      expect(result.content).toBe("Hello world!");
      expect(tokens).toEqual(["Hello ", "world!"]);
    });
  });
});

describe("ClaudeConfigSchema", () => {
  it("should validate valid config", () => {
    const result = ClaudeConfigSchema.parse({
      apiKey: "sk-test",
    });
    expect(result.apiKey).toBe("sk-test");
    expect(result.model).toBe("claude-sonnet-4-5");
    expect(result.timeoutMs).toBe(60_000);
  });

  it("should reject empty API key", () => {
    expect(() => ClaudeConfigSchema.parse({ apiKey: "" })).toThrow();
  });

  it("should accept custom model and timeout", () => {
    const result = ClaudeConfigSchema.parse({
      apiKey: "sk-test",
      model: "claude-3-opus",
      timeoutMs: 120000,
    });
    expect(result.model).toBe("claude-3-opus");
    expect(result.timeoutMs).toBe(120000);
  });
});
