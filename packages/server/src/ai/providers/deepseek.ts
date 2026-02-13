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
  ToolDefinition,
  ToolUseBlock,
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
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

/** OpenAI-compatible tool definition for function calling */
interface DeepSeekToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/** Request body for DeepSeek /v1/chat/completions */
interface DeepSeekChatRequest {
  model: string;
  messages: DeepSeekMessage[];
  max_tokens?: number;
  stream: boolean;
  stream_options?: { include_usage: boolean };
  tools?: DeepSeekToolDefinition[];
}

const DeepSeekToolCallSchema = z.object({
  id: z.string(),
  type: z.literal('function'),
  function: z.object({
    name: z.string(),
    arguments: z.string(),
  }),
});

/** Non-streaming response from DeepSeek /v1/chat/completions */
const DeepSeekChatResponseSchema = z.object({
  id: z.string(),
  choices: z.array(z.object({
    index: z.number(),
    message: z.object({
      role: z.string(),
      content: z.string().nullable(),
      tool_calls: z.array(DeepSeekToolCallSchema).optional(),
    }),
    finish_reason: z.string().nullable(),
  })).min(1),
  usage: z.object({
    prompt_tokens: z.number(),
    completion_tokens: z.number(),
    total_tokens: z.number(),
  }),
});

const DeepSeekStreamToolCallDeltaSchema = z.object({
  index: z.number(),
  id: z.string().optional(),
  type: z.literal('function').optional(),
  function: z.object({
    name: z.string().optional(),
    arguments: z.string().optional(),
  }).optional(),
});

/** SSE streaming chunk from DeepSeek */
const DeepSeekStreamChunkSchema = z.object({
  id: z.string(),
  choices: z.array(z.object({
    index: z.number(),
    delta: z.object({
      role: z.string().optional(),
      content: z.string().nullable().optional(),
      tool_calls: z.array(DeepSeekStreamToolCallDeltaSchema).optional(),
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
/** Known context window sizes for DeepSeek models (in tokens) */
const DEEPSEEK_CONTEXT_WINDOWS: Record<string, number> = {
  'deepseek-chat': 64_000,
  'deepseek-coder': 128_000,
  'deepseek-reasoner': 64_000,
};

/** Default context window for unknown DeepSeek models */
const DEFAULT_DEEPSEEK_CONTEXT_WINDOW = 64_000;

export class DeepSeekProvider implements AIProviderInterface {
  readonly name = 'deepseek';
  readonly tier = 2 as const;
  readonly contextWindowSize: number;

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
    this.contextWindowSize = DEEPSEEK_CONTEXT_WINDOWS[this.model] ?? DEFAULT_DEEPSEEK_CONTEXT_WINDOW;
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

    if (options.tools?.length) {
      body.tools = this.convertTools(options.tools);
    }

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

    const choice = data.choices[0];
    const toolCalls = this.extractToolCalls(choice.message.tool_calls);
    const stopReason = this.mapStopReason(choice.finish_reason);

    return {
      content: choice.message.content ?? '',
      usage: {
        inputTokens: data.usage.prompt_tokens,
        outputTokens: data.usage.completion_tokens,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
      },
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      stopReason,
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
      stream_options: { include_usage: true },
    };

    if (options.tools?.length) {
      body.tools = this.convertTools(options.tools);
    }

    let accumulated = '';
    let usage: TokenUsage = { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 };
    const toolCallAccumulators = new Map<number, { id: string; name: string; arguments: string }>();
    let finishReason: string | null = null;

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
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === 'data: [DONE]') continue;
          if (!trimmed.startsWith('data: ')) continue;

          const jsonStr = trimmed.slice(6);
          const chunk = this.parseStreamChunk(jsonStr);
          if (!chunk) continue;

          const choice = chunk.choices[0];
          if (!choice) continue;

          const delta = choice.delta;
          if (delta?.content) {
            accumulated += delta.content;
            callbacks?.onToken?.(delta.content, accumulated);
          }

          if (delta?.tool_calls) {
            this.accumulateToolCallDeltas(delta.tool_calls, toolCallAccumulators);
          }

          if (choice.finish_reason) {
            finishReason = choice.finish_reason;
          }

          if (chunk.usage) {
            usage = {
              inputTokens: chunk.usage.prompt_tokens,
              outputTokens: chunk.usage.completion_tokens,
              cacheCreationInputTokens: 0,
              cacheReadInputTokens: 0,
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
            const choice = chunk.choices[0];
            if (choice) {
              if (choice.delta?.content) {
                accumulated += choice.delta.content;
                callbacks?.onToken?.(choice.delta.content, accumulated);
              }
              if (choice.delta?.tool_calls) {
                this.accumulateToolCallDeltas(choice.delta.tool_calls, toolCallAccumulators);
              }
              if (choice.finish_reason) {
                finishReason = choice.finish_reason;
              }
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

      const toolCalls = this.buildToolCallsFromAccumulators(toolCallAccumulators);
      const stopReason = this.mapStopReason(finishReason);

      return {
        content: accumulated,
        usage,
        success: true,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        stopReason,
      };
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

  /** Convert ToolDefinition[] to OpenAI-compatible function calling format. */
  private convertTools(tools: ToolDefinition[]): DeepSeekToolDefinition[] {
    return tools.map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      },
    }));
  }

  /** Extract tool calls from a non-streaming response. */
  private extractToolCalls(
    toolCalls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>,
  ): ToolUseBlock[] {
    if (!toolCalls?.length) return [];

    return toolCalls.map((tc) => ({
      type: 'tool_use' as const,
      id: tc.id,
      name: tc.function.name,
      input: JSON.parse(tc.function.arguments) as Record<string, unknown>,
    }));
  }

  /** Accumulate incremental tool call deltas from streaming chunks. */
  private accumulateToolCallDeltas(
    deltas: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }>,
    accumulators: Map<number, { id: string; name: string; arguments: string }>,
  ): void {
    for (const delta of deltas) {
      const existing = accumulators.get(delta.index);
      if (existing) {
        if (delta.function?.arguments) {
          existing.arguments += delta.function.arguments;
        }
      } else {
        accumulators.set(delta.index, {
          id: delta.id ?? '',
          name: delta.function?.name ?? '',
          arguments: delta.function?.arguments ?? '',
        });
      }
    }
  }

  /** Build final ToolUseBlock[] from accumulated streaming deltas. */
  private buildToolCallsFromAccumulators(
    accumulators: Map<number, { id: string; name: string; arguments: string }>,
  ): ToolUseBlock[] {
    if (accumulators.size === 0) return [];

    const sorted = [...accumulators.entries()].sort((a, b) => a[0] - b[0]);
    return sorted.map(([, acc]) => ({
      type: 'tool_use' as const,
      id: acc.id,
      name: acc.name,
      input: JSON.parse(acc.arguments) as Record<string, unknown>,
    }));
  }

  /** Map DeepSeek finish_reason → unified stop reason. */
  private mapStopReason(finishReason: string | null | undefined): string | undefined {
    if (!finishReason) return undefined;
    switch (finishReason) {
      case 'stop': return 'end_turn';
      case 'tool_calls': return 'tool_use';
      case 'length': return 'max_tokens';
      default: return finishReason;
    }
  }

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
