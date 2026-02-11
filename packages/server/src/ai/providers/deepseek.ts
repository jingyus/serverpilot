// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * DeepSeek AI Provider for Chinese domestic users.
 *
 * Integrates with DeepSeek's OpenAI-compatible API to provide AI capabilities.
 * Tier 2 provider — requires API key from DEEPSEEK_API_KEY environment variable.
 *
 * DeepSeek API is OpenAI-compatible, supporting /v1/chat/completions with SSE streaming.
 *
 * @module ai/providers/deepseek
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

/** Default DeepSeek configuration values */
const DEFAULTS = {
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-chat',
  timeoutMs: 60_000,
  maxTokens: 4096,
} as const;

/** Configuration specific to the DeepSeek provider */
export interface DeepSeekConfig {
  /** Base URL for the DeepSeek API (default: https://api.deepseek.com) */
  baseUrl?: string;
  /** API key for authentication (required, or set DEEPSEEK_API_KEY env var) */
  apiKey?: string;
  /** Model name to use (default: deepseek-chat) */
  model?: string;
  /** Request timeout in milliseconds (default: 60000) */
  timeoutMs?: number;
}

/** Zod schema for DeepSeek provider configuration */
export const DeepSeekConfigSchema = z.object({
  baseUrl: z.string().url().default(DEFAULTS.baseUrl),
  apiKey: z.string().min(1, 'DeepSeek API key is required'),
  model: z.string().min(1).default(DEFAULTS.model),
  timeoutMs: z.number().int().positive().default(DEFAULTS.timeoutMs),
});

// ============================================================================
// DeepSeek API Types (OpenAI-compatible)
// ============================================================================

/** Message format for DeepSeek /v1/chat/completions */
interface DeepSeekMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/** Request body for DeepSeek /v1/chat/completions */
interface DeepSeekChatRequest {
  model: string;
  messages: DeepSeekMessage[];
  max_tokens?: number;
  stream: boolean;
}

/** Non-streaming response from DeepSeek /v1/chat/completions */
const DeepSeekChatResponseSchema = z.object({
  id: z.string(),
  choices: z.array(z.object({
    index: z.number(),
    message: z.object({
      role: z.string(),
      content: z.string(),
    }),
    finish_reason: z.string().nullable(),
  })).min(1),
  usage: z.object({
    prompt_tokens: z.number(),
    completion_tokens: z.number(),
    total_tokens: z.number(),
  }),
});

/** SSE streaming chunk from DeepSeek */
const DeepSeekStreamChunkSchema = z.object({
  id: z.string(),
  choices: z.array(z.object({
    index: z.number(),
    delta: z.object({
      role: z.string().optional(),
      content: z.string().optional(),
    }),
    finish_reason: z.string().nullable(),
  })),
  usage: z.object({
    prompt_tokens: z.number(),
    completion_tokens: z.number(),
    total_tokens: z.number(),
  }).nullable().optional(),
});

type DeepSeekStreamChunk = z.infer<typeof DeepSeekStreamChunkSchema>;

/** Error response from DeepSeek API */
const DeepSeekErrorResponseSchema = z.object({
  error: z.object({
    message: z.string(),
    type: z.string(),
    code: z.string().nullable().optional(),
  }),
});

// ============================================================================
// DeepSeek Provider
// ============================================================================

/**
 * DeepSeek AI Provider — Tier 2 for Chinese domestic users.
 *
 * Connects to the DeepSeek API (OpenAI-compatible) to provide AI
 * capabilities. Supports both synchronous and streaming chat.
 *
 * @example
 * ```ts
 * const deepseek = new DeepSeekProvider({ apiKey: 'sk-...' });
 * if (await deepseek.isAvailable()) {
 *   const response = await deepseek.chat({
 *     messages: [{ role: 'user', content: 'Analyze this environment...' }],
 *     system: 'You are a DevOps expert.',
 *   });
 * }
 * ```
 */
export class DeepSeekProvider implements AIProviderInterface {
  readonly name = 'deepseek';
  readonly tier = 2 as const;

  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(config: DeepSeekConfig = {}) {
    const resolved = {
      ...config,
      apiKey: config.apiKey ?? process.env.DEEPSEEK_API_KEY ?? '',
    };
    const validated = DeepSeekConfigSchema.parse(resolved);
    this.baseUrl = validated.baseUrl.replace(/\/+$/, '');
    this.apiKey = validated.apiKey;
    this.model = validated.model;
    this.timeoutMs = validated.timeoutMs;
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  /**
   * Send a non-streaming chat request to DeepSeek.
   *
   * @param options - Chat request options
   * @returns The chat response with content and usage
   */
  async chat(options: ChatOptions): Promise<ChatResponse> {
    const messages = this.buildMessages(options);
    const body: DeepSeekChatRequest = {
      model: this.model,
      messages,
      max_tokens: options.maxTokens ?? DEFAULTS.maxTokens,
      stream: false,
    };

    const response = await this.fetchWithTimeout(
      `${this.baseUrl}/v1/chat/completions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
      },
      options.timeoutMs ?? this.timeoutMs,
    );

    if (!response.ok) {
      await this.handleErrorResponse(response);
    }

    const raw: unknown = await response.json();
    const data = DeepSeekChatResponseSchema.parse(raw);

    return {
      content: data.choices[0].message.content,
      usage: {
        inputTokens: data.usage.prompt_tokens,
        outputTokens: data.usage.completion_tokens,
      },
    };
  }

  /**
   * Send a streaming chat request to DeepSeek.
   *
   * DeepSeek uses SSE (Server-Sent Events) format for streaming,
   * compatible with the OpenAI streaming protocol.
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
    const body: DeepSeekChatRequest = {
      model: this.model,
      messages,
      max_tokens: options.maxTokens ?? DEFAULTS.maxTokens,
      stream: true,
    };

    let accumulated = '';
    let usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };

    try {
      const response = await this.fetchWithTimeout(
        `${this.baseUrl}/v1/chat/completions`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify(body),
        },
        options.timeoutMs ?? this.timeoutMs,
      );

      if (!response.ok) {
        await this.handleErrorResponse(response);
      }

      callbacks?.onStart?.();

      const reader = response.body?.getReader();
      if (!reader) {
        throw new DeepSeekError('Response body is not readable', 0);
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
          if (!trimmed || trimmed === 'data: [DONE]') continue;

          // SSE format: "data: {...json...}"
          if (!trimmed.startsWith('data: ')) continue;

          const jsonStr = trimmed.slice(6);
          const chunk = this.parseStreamChunk(jsonStr);
          if (!chunk) continue;

          const delta = chunk.choices[0]?.delta;
          if (delta?.content) {
            accumulated += delta.content;
            callbacks?.onToken?.(delta.content, accumulated);
          }

          // Extract usage from the final chunk if provided
          if (chunk.usage) {
            usage = {
              inputTokens: chunk.usage.prompt_tokens,
              outputTokens: chunk.usage.completion_tokens,
            };
          }
        }
      }

      // Process any remaining buffer
      if (buffer.trim() && buffer.trim() !== 'data: [DONE]') {
        const trimmed = buffer.trim();
        if (trimmed.startsWith('data: ')) {
          const jsonStr = trimmed.slice(6);
          const chunk = this.parseStreamChunk(jsonStr);
          if (chunk) {
            const delta = chunk.choices[0]?.delta;
            if (delta?.content) {
              accumulated += delta.content;
              callbacks?.onToken?.(delta.content, accumulated);
            }
            if (chunk.usage) {
              usage = {
                inputTokens: chunk.usage.prompt_tokens,
                outputTokens: chunk.usage.completion_tokens,
              };
            }
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
   * Check if the DeepSeek API is available and configured.
   *
   * Sends a minimal request to verify the API key is valid.
   *
   * @returns true if the API is reachable and the key is valid
   */
  async isAvailable(): Promise<boolean> {
    try {
      const response = await this.fetchWithTimeout(
        `${this.baseUrl}/v1/models`,
        {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
          },
        },
        5000,
      );

      return response.ok;
    } catch {
      return false;
    }
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  /**
   * Build the DeepSeek message array from ChatOptions.
   * Prepends a system message if `options.system` is provided.
   */
  private buildMessages(options: ChatOptions): DeepSeekMessage[] {
    const messages: DeepSeekMessage[] = [];

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
   * Parse a single SSE JSON chunk from the stream.
   * Returns null for unparseable chunks instead of throwing.
   */
  private parseStreamChunk(json: string): DeepSeekStreamChunk | null {
    try {
      const parsed: unknown = JSON.parse(json);
      return DeepSeekStreamChunkSchema.parse(parsed);
    } catch {
      return null;
    }
  }

  /**
   * Handle an error response from the DeepSeek API.
   * Attempts to parse the structured error; falls back to status text.
   */
  private async handleErrorResponse(response: Response): Promise<never> {
    let errorMessage: string;

    try {
      const raw: unknown = await response.json();
      const parsed = DeepSeekErrorResponseSchema.parse(raw);
      errorMessage = parsed.error.message;
    } catch {
      errorMessage = await response.text().catch(() => 'unknown error');
    }

    const status = response.status;

    if (status === 401) {
      throw new DeepSeekError(
        `DeepSeek authentication failed: ${errorMessage}`,
        status,
      );
    }

    if (status === 429) {
      throw new DeepSeekError(
        `DeepSeek rate limit exceeded: ${errorMessage}`,
        status,
      );
    }

    throw new DeepSeekError(
      `DeepSeek API error (${status}): ${errorMessage}`,
      status,
    );
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
        throw new DeepSeekError(
          `DeepSeek request timed out after ${timeoutMs}ms`,
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
 * Custom error for DeepSeek provider failures.
 * Includes the HTTP status code for error classification.
 */
export class DeepSeekError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'DeepSeekError';
  }
}
