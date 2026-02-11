// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Custom OpenAI-compatible AI Provider.
 *
 * Supports OneAPI, LiteLLM, Azure OpenAI, and any other service that
 * exposes an OpenAI-compatible /v1/chat/completions endpoint.
 *
 * Tier 2 provider — requires baseUrl, apiKey, and modelName.
 *
 * @module ai/providers/custom-openai
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

const DEFAULTS = {
  timeoutMs: 60_000,
  maxTokens: 4096,
} as const;

/** Configuration for the Custom OpenAI-compatible provider */
export interface CustomOpenAIConfig {
  /** Base URL for the API (required, e.g. https://your-oneapi.example.com/v1) */
  baseUrl: string;
  /** API key for authentication (required) */
  apiKey: string;
  /** Model name to use (required, e.g. gpt-4o, deepseek-chat, etc.) */
  model: string;
  /** Request timeout in milliseconds (default: 60000) */
  timeoutMs?: number;
}

/** Zod schema for Custom OpenAI provider configuration */
export const CustomOpenAIConfigSchema = z.object({
  baseUrl: z.string().url('Base URL is required and must be a valid URL'),
  apiKey: z.string().min(1, 'API key is required'),
  model: z.string().min(1, 'Model name is required'),
  timeoutMs: z.number().int().positive().default(DEFAULTS.timeoutMs),
});

// ============================================================================
// OpenAI-compatible API Types
// ============================================================================

interface OpenAIMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface OpenAIChatRequest {
  model: string;
  messages: OpenAIMessage[];
  max_tokens?: number;
  stream: boolean;
}

const OpenAIChatResponseSchema = z.object({
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

const OpenAIStreamChunkSchema = z.object({
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

type OpenAIStreamChunk = z.infer<typeof OpenAIStreamChunkSchema>;

const OpenAIErrorResponseSchema = z.object({
  error: z.object({
    message: z.string(),
    type: z.string(),
    code: z.string().nullable().optional(),
  }),
});

// ============================================================================
// Custom OpenAI Provider
// ============================================================================

/**
 * Custom OpenAI-compatible AI Provider — Tier 2.
 *
 * Connects to any OpenAI-compatible API (OneAPI, LiteLLM, Azure, etc.)
 * via the standard /v1/chat/completions endpoint.
 *
 * @example
 * ```ts
 * const provider = new CustomOpenAIProvider({
 *   baseUrl: 'https://your-oneapi.example.com/v1',
 *   apiKey: 'sk-...',
 *   model: 'gpt-4o',
 * });
 * ```
 */
export class CustomOpenAIProvider implements AIProviderInterface {
  readonly name = 'custom-openai';
  readonly tier = 2 as const;

  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(config: CustomOpenAIConfig) {
    const validated = CustomOpenAIConfigSchema.parse(config);
    this.baseUrl = validated.baseUrl.replace(/\/+$/, '');
    this.apiKey = validated.apiKey;
    this.model = validated.model;
    this.timeoutMs = validated.timeoutMs;
  }

  /** Expose model name for external access */
  getModel(): string {
    return this.model;
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  async chat(options: ChatOptions): Promise<ChatResponse> {
    const messages = this.buildMessages(options);
    const body: OpenAIChatRequest = {
      model: this.model,
      messages,
      max_tokens: options.maxTokens ?? DEFAULTS.maxTokens,
      stream: false,
    };

    const response = await this.fetchWithTimeout(
      `${this.baseUrl}/chat/completions`,
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
    const data = OpenAIChatResponseSchema.parse(raw);

    return {
      content: data.choices[0].message.content,
      usage: {
        inputTokens: data.usage.prompt_tokens,
        outputTokens: data.usage.completion_tokens,
      },
    };
  }

  async stream(
    options: ChatOptions,
    callbacks?: ProviderStreamCallbacks,
  ): Promise<StreamResponse> {
    const messages = this.buildMessages(options);
    const body: OpenAIChatRequest = {
      model: this.model,
      messages,
      max_tokens: options.maxTokens ?? DEFAULTS.maxTokens,
      stream: true,
    };

    let accumulated = '';
    let usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };

    try {
      const response = await this.fetchWithTimeout(
        `${this.baseUrl}/chat/completions`,
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
        throw new CustomOpenAIError('Response body is not readable', 0);
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === 'data: [DONE]') continue;
          if (!trimmed.startsWith('data: ')) continue;

          const jsonStr = trimmed.slice(6);
          const chunk = this.parseStreamChunk(jsonStr);
          if (!chunk) continue;

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

  async isAvailable(): Promise<boolean> {
    try {
      const response = await this.fetchWithTimeout(
        `${this.baseUrl}/models`,
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

  private buildMessages(options: ChatOptions): OpenAIMessage[] {
    const messages: OpenAIMessage[] = [];

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

  private parseStreamChunk(json: string): OpenAIStreamChunk | null {
    try {
      const parsed: unknown = JSON.parse(json);
      return OpenAIStreamChunkSchema.parse(parsed);
    } catch {
      return null;
    }
  }

  private async handleErrorResponse(response: Response): Promise<never> {
    let errorMessage: string;

    try {
      const raw: unknown = await response.json();
      const parsed = OpenAIErrorResponseSchema.parse(raw);
      errorMessage = parsed.error.message;
    } catch {
      errorMessage = await response.text().catch(() => 'unknown error');
    }

    const status = response.status;

    if (status === 401) {
      throw new CustomOpenAIError(
        `Custom OpenAI authentication failed: ${errorMessage}`,
        status,
      );
    }

    if (status === 429) {
      throw new CustomOpenAIError(
        `Custom OpenAI rate limit exceeded: ${errorMessage}`,
        status,
      );
    }

    throw new CustomOpenAIError(
      `Custom OpenAI API error (${status}): ${errorMessage}`,
      status,
    );
  }

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
        throw new CustomOpenAIError(
          `Custom OpenAI request timed out after ${timeoutMs}ms`,
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

export class CustomOpenAIError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'CustomOpenAIError';
  }
}
