// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Ollama AI Provider for local model support.
 *
 * Integrates with Ollama's REST API to provide AI capabilities using
 * locally-hosted models (e.g. llama3, mistral, codellama, qwen).
 * Tier 3 provider — no API key required, runs on user's machine.
 *
 * Ollama API reference: POST /api/chat (with streaming support)
 *
 * @module ai/providers/ollama
 */

import { z } from 'zod';
import type {
  AIProviderInterface,
  ChatOptions,
  ChatResponse,
  ProviderStreamCallbacks,
  StreamResponse,
  TokenUsage,
} from './base.js';

// ============================================================================
// Configuration
// ============================================================================

/** Default Ollama configuration values */
const DEFAULTS = {
  baseUrl: 'http://localhost:11434',
  model: 'llama3.2',
  timeoutMs: 120_000,
  maxTokens: 4096,
} as const;

/** Configuration specific to the Ollama provider */
export interface OllamaConfig {
  /** Base URL for the Ollama API (default: http://localhost:11434) */
  baseUrl?: string;
  /** Model name to use (default: llama3.2) */
  model?: string;
  /** Request timeout in milliseconds (default: 120000) */
  timeoutMs?: number;
}

/** Zod schema for Ollama provider configuration */
export const OllamaConfigSchema = z.object({
  baseUrl: z.string().url().default(DEFAULTS.baseUrl),
  model: z.string().min(1).default(DEFAULTS.model),
  timeoutMs: z.number().int().positive().default(DEFAULTS.timeoutMs),
});

// ============================================================================
// Ollama API Types
// ============================================================================

/** Message format for Ollama /api/chat */
interface OllamaChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/** Request body for Ollama /api/chat */
interface OllamaChatRequest {
  model: string;
  messages: OllamaChatMessage[];
  stream: boolean;
  options?: {
    num_predict?: number;
    temperature?: number;
  };
}

/** Non-streaming response from Ollama /api/chat */
const OllamaChatResponseSchema = z.object({
  model: z.string(),
  message: z.object({
    role: z.string(),
    content: z.string(),
  }),
  done: z.boolean(),
  total_duration: z.number().optional(),
  prompt_eval_count: z.number().optional(),
  eval_count: z.number().optional(),
});

type OllamaChatResponse = z.infer<typeof OllamaChatResponseSchema>;

/** Streaming chunk from Ollama /api/chat */
const OllamaStreamChunkSchema = z.object({
  model: z.string(),
  message: z.object({
    role: z.string(),
    content: z.string(),
  }),
  done: z.boolean(),
  total_duration: z.number().optional(),
  prompt_eval_count: z.number().optional(),
  eval_count: z.number().optional(),
});

type OllamaStreamChunk = z.infer<typeof OllamaStreamChunkSchema>;

/** Response from Ollama /api/tags (list models) */
const OllamaTagsResponseSchema = z.object({
  models: z.array(z.object({
    name: z.string(),
    modified_at: z.string().optional(),
    size: z.number().optional(),
  })),
});

// ============================================================================
// Ollama Provider
// ============================================================================

/**
 * Ollama AI Provider — Tier 3 local model support.
 *
 * Connects to a locally running Ollama instance to provide AI
 * capabilities without external API dependencies. Supports both
 * synchronous and streaming chat.
 *
 * @example
 * ```ts
 * const ollama = new OllamaProvider({ model: 'llama3.2' });
 * if (await ollama.isAvailable()) {
 *   const response = await ollama.chat({
 *     messages: [{ role: 'user', content: 'Analyze this environment...' }],
 *     system: 'You are a DevOps expert.',
 *   });
 * }
 * ```
 */
export class OllamaProvider implements AIProviderInterface {
  readonly name = 'ollama';
  readonly tier = 3 as const;

  private readonly baseUrl: string;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(config: OllamaConfig = {}) {
    const validated = OllamaConfigSchema.parse(config);
    this.baseUrl = validated.baseUrl.replace(/\/+$/, '');
    this.model = validated.model;
    this.timeoutMs = validated.timeoutMs;
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  /**
   * Send a non-streaming chat request to Ollama.
   *
   * @param options - Chat request options
   * @returns The chat response with content and estimated usage
   */
  async chat(options: ChatOptions): Promise<ChatResponse> {
    const messages = this.buildMessages(options);
    const body: OllamaChatRequest = {
      model: this.model,
      messages,
      stream: false,
      options: {
        num_predict: options.maxTokens ?? DEFAULTS.maxTokens,
      },
    };

    const response = await this.fetchWithTimeout(
      `${this.baseUrl}/api/chat`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      options.timeoutMs ?? this.timeoutMs,
    );

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'unknown error');
      throw new OllamaError(
        `Ollama API error (${response.status}): ${errorText}`,
        response.status,
      );
    }

    const raw: unknown = await response.json();
    const data = OllamaChatResponseSchema.parse(raw);
    const usage = this.extractUsage(data);

    return {
      content: data.message.content,
      usage,
    };
  }

  /**
   * Send a streaming chat request to Ollama.
   *
   * Ollama natively supports streaming via newline-delimited JSON.
   *
   * @param options - Chat request options
   * @param callbacks - Optional streaming event callbacks
   * @returns The complete stream response
   */
  async stream(
    options: ChatOptions,
    callbacks?: ProviderStreamCallbacks,
  ): Promise<StreamResponse> {
    const messages = this.buildMessages(options);
    const body: OllamaChatRequest = {
      model: this.model,
      messages,
      stream: true,
      options: {
        num_predict: options.maxTokens ?? DEFAULTS.maxTokens,
      },
    };

    let accumulated = '';
    let usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };

    try {
      const response = await this.fetchWithTimeout(
        `${this.baseUrl}/api/chat`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
        options.timeoutMs ?? this.timeoutMs,
      );

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'unknown error');
        throw new OllamaError(
          `Ollama API error (${response.status}): ${errorText}`,
          response.status,
        );
      }

      callbacks?.onStart?.();

      const reader = response.body?.getReader();
      if (!reader) {
        throw new OllamaError('Response body is not readable', 0);
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        // Keep the last potentially incomplete line in the buffer
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          const chunk = this.parseStreamChunk(trimmed);
          if (!chunk) continue;

          const token = chunk.message.content;
          if (token) {
            accumulated += token;
            callbacks?.onToken?.(token, accumulated);
          }

          if (chunk.done) {
            usage = this.extractUsage(chunk);
          }
        }
      }

      // Process any remaining buffer
      if (buffer.trim()) {
        const chunk = this.parseStreamChunk(buffer.trim());
        if (chunk) {
          const token = chunk.message.content;
          if (token) {
            accumulated += token;
            callbacks?.onToken?.(token, accumulated);
          }
          if (chunk.done) {
            usage = this.extractUsage(chunk);
          }
        }
      }

      callbacks?.onComplete?.(accumulated, usage);

      return { content: accumulated, usage, success: true };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      callbacks?.onError?.(error);
      return {
        content: accumulated,
        usage,
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Check if the Ollama instance is available.
   *
   * Pings the Ollama API and verifies the configured model exists.
   *
   * @returns true if Ollama is reachable and the model is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      const response = await this.fetchWithTimeout(
        `${this.baseUrl}/api/tags`,
        { method: 'GET' },
        5000,
      );

      if (!response.ok) return false;

      const raw: unknown = await response.json();
      const data = OllamaTagsResponseSchema.parse(raw);
      return data.models.some(
        (m) => m.name === this.model || m.name.startsWith(`${this.model}:`),
      );
    } catch {
      return false;
    }
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  /**
   * Build the Ollama message array from ChatOptions.
   * Prepends a system message if `options.system` is provided.
   */
  private buildMessages(options: ChatOptions): OllamaChatMessage[] {
    const messages: OllamaChatMessage[] = [];

    if (options.system) {
      messages.push({ role: 'system', content: options.system });
    }

    for (const msg of options.messages) {
      messages.push({
        role: msg.role === 'system' ? 'system' : msg.role,
        content: msg.content,
      });
    }

    return messages;
  }

  /**
   * Extract token usage from an Ollama response.
   * Ollama provides eval_count (output tokens) and prompt_eval_count (input tokens).
   */
  private extractUsage(data: OllamaChatResponse | OllamaStreamChunk): TokenUsage {
    return {
      inputTokens: data.prompt_eval_count ?? 0,
      outputTokens: data.eval_count ?? 0,
    };
  }

  /**
   * Parse a single line of newline-delimited JSON from the stream.
   * Returns null for unparseable lines instead of throwing.
   */
  private parseStreamChunk(line: string): OllamaStreamChunk | null {
    try {
      const parsed: unknown = JSON.parse(line);
      return OllamaStreamChunkSchema.parse(parsed);
    } catch {
      return null;
    }
  }

  /**
   * Fetch with an AbortController-based timeout.
   */
  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
    timeoutMs: number,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new OllamaError(
          `Ollama request timed out after ${timeoutMs}ms`,
          0,
        );
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}

// ============================================================================
// Error Type
// ============================================================================

/**
 * Custom error for Ollama provider failures.
 * Includes the HTTP status code for error classification.
 */
export class OllamaError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'OllamaError';
  }
}
