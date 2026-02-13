// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/** OpenAI AI Provider — Tier 2, supports GPT-4o/4/3.5-turbo with function calling. */

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

/** Per-token pricing in USD (per 1M tokens) by model */
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'gpt-4o':             { input: 2.50,  output: 10.00 },
  'gpt-4o-mini':        { input: 0.15,  output: 0.60 },
  'gpt-4-turbo':        { input: 10.00, output: 30.00 },
  'gpt-4':              { input: 30.00, output: 60.00 },
  'gpt-3.5-turbo':      { input: 0.50,  output: 1.50 },
};

/** Cost estimate result */
export interface CostEstimate {
  inputCost: number;
  outputCost: number;
  totalCost: number;
  currency: 'USD';
}

export function estimateCost(usage: TokenUsage, model: string): CostEstimate | null {
  const pricing = MODEL_PRICING[model];
  if (!pricing) return null;

  const inputCost = (usage.inputTokens / 1_000_000) * pricing.input;
  const outputCost = (usage.outputTokens / 1_000_000) * pricing.output;

  return {
    inputCost,
    outputCost,
    totalCost: inputCost + outputCost,
    currency: 'USD',
  };
}

/** Parse structured JSON from AI output, stripping code fences if present. */
export function parseStructuredOutput<T>(text: string, schema: z.ZodType<T>): T {
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }
  const parsed: unknown = JSON.parse(cleaned);
  return schema.parse(parsed);
}

export interface OpenAIRetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
}

export interface OpenAIRetryResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  attempts: number;
}

const DEFAULT_RETRY: Required<OpenAIRetryOptions> = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
};

const DEFAULTS = {
  baseUrl: 'https://api.openai.com',
  model: 'gpt-4o',
  timeoutMs: 60_000,
  maxTokens: 4096,
} as const;

export interface OpenAIConfig {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
}

export const OpenAIConfigSchema = z.object({
  baseUrl: z.string().url().default(DEFAULTS.baseUrl),
  apiKey: z.string().min(1, 'OpenAI API key is required'),
  model: z.string().min(1).default(DEFAULTS.model),
  timeoutMs: z.number().int().positive().default(DEFAULTS.timeoutMs),
});

// OpenAI API Types
interface OpenAIMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

interface OpenAIToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/** Request body for OpenAI /v1/chat/completions */
interface OpenAIChatRequest {
  model: string;
  messages: OpenAIMessage[];
  max_tokens?: number;
  stream: boolean;
  stream_options?: {
    include_usage: boolean;
  };
  tools?: OpenAIToolDefinition[];
}

const OpenAIToolCallSchema = z.object({
  id: z.string(),
  type: z.literal('function'),
  function: z.object({
    name: z.string(),
    arguments: z.string(),
  }),
});

const OpenAIChatResponseSchema = z.object({
  id: z.string(),
  choices: z.array(z.object({
    index: z.number(),
    message: z.object({
      role: z.string(),
      content: z.string().nullable(),
      tool_calls: z.array(OpenAIToolCallSchema).optional(),
    }),
    finish_reason: z.string().nullable(),
  })).min(1),
  usage: z.object({
    prompt_tokens: z.number(),
    completion_tokens: z.number(),
    total_tokens: z.number(),
  }),
});

const OpenAIStreamToolCallDeltaSchema = z.object({
  index: z.number(),
  id: z.string().optional(),
  type: z.literal('function').optional(),
  function: z.object({
    name: z.string().optional(),
    arguments: z.string().optional(),
  }).optional(),
});

const OpenAIStreamChunkSchema = z.object({
  id: z.string(),
  choices: z.array(z.object({
    index: z.number(),
    delta: z.object({
      role: z.string().optional(),
      content: z.string().nullable().optional(),
      tool_calls: z.array(OpenAIStreamToolCallDeltaSchema).optional(),
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
    param: z.string().nullable().optional(),
  }),
});

/** Known context window sizes for OpenAI models (in tokens) */
const OPENAI_CONTEXT_WINDOWS: Record<string, number> = {
  'gpt-4o':        128_000,
  'gpt-4o-mini':   128_000,
  'gpt-4-turbo':   128_000,
  'gpt-4':         8_192,
  'gpt-3.5-turbo': 16_385,
};

/** Default context window for unknown OpenAI models */
const DEFAULT_OPENAI_CONTEXT_WINDOW = 128_000;

export class OpenAIProvider implements AIProviderInterface {
  readonly name = 'openai';
  readonly tier = 2 as const;
  readonly contextWindowSize: number;

  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(config: OpenAIConfig = {}) {
    const resolved = {
      ...config,
      apiKey: config.apiKey ?? process.env.OPENAI_API_KEY ?? '',
    };
    const validated = OpenAIConfigSchema.parse(resolved);
    this.baseUrl = validated.baseUrl.replace(/\/+$/, '');
    this.apiKey = validated.apiKey;
    this.model = validated.model;
    this.timeoutMs = validated.timeoutMs;
    this.contextWindowSize = OPENAI_CONTEXT_WINDOWS[this.model] ?? DEFAULT_OPENAI_CONTEXT_WINDOW;
  }

  async chat(options: ChatOptions): Promise<ChatResponse> {
    const messages = this.buildMessages(options);
    const body: OpenAIChatRequest = {
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
    const data = OpenAIChatResponseSchema.parse(raw);

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
      stream_options: {
        include_usage: true,
      },
    };

    if (options.tools?.length) {
      body.tools = this.convertTools(options.tools);
    }

    let accumulated = '';
    let usage: TokenUsage = { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 };
    // Accumulate streaming tool calls: index → { id, name, arguments }
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
        throw new OpenAIError('Response body is not readable', 0);
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

          // Accumulate streaming tool call deltas
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

  getModel(): string {
    return this.model;
  }

  estimateCost(usage: TokenUsage): CostEstimate | null {
    return estimateCost(usage, this.model);
  }

  async chatWithRetry(
    options: ChatOptions,
    retryOpts?: OpenAIRetryOptions,
  ): Promise<OpenAIRetryResult<ChatResponse>> {
    const opts = { ...DEFAULT_RETRY, ...retryOpts };
    let lastError: string | undefined;

    for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
      try {
        const data = await this.chat(options);
        return { success: true, data, attempts: attempt + 1 };
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        lastError = error.message;

        if (!this.isRetryableError(err)) {
          return { success: false, error: lastError, attempts: attempt + 1 };
        }

        if (attempt < opts.maxRetries) {
          const delay = Math.min(
            opts.initialDelayMs * Math.pow(opts.backoffMultiplier, attempt),
            opts.maxDelayMs,
          );
          await sleep(delay);
        }
      }
    }

    return {
      success: false,
      error: `Request failed after ${opts.maxRetries + 1} attempts: ${lastError}`,
      attempts: opts.maxRetries + 1,
    };
  }

  async streamWithRetry(
    options: ChatOptions,
    callbacks?: ProviderStreamCallbacks,
    retryOpts?: OpenAIRetryOptions,
  ): Promise<OpenAIRetryResult<StreamResponse>> {
    const opts = { ...DEFAULT_RETRY, ...retryOpts };
    let lastError: string | undefined;

    for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
      const result = await this.stream(options, attempt === 0 ? callbacks : undefined);

      if (result.success) {
        return { success: true, data: result, attempts: attempt + 1 };
      }

      lastError = result.error;

      if (!this.isRetryableErrorMessage(result.error ?? '')) {
        return { success: false, error: lastError, attempts: attempt + 1 };
      }

      if (attempt < opts.maxRetries) {
        const delay = Math.min(
          opts.initialDelayMs * Math.pow(opts.backoffMultiplier, attempt),
          opts.maxDelayMs,
        );
        await sleep(delay);
      }
    }

    return {
      success: false,
      error: `Stream failed after ${opts.maxRetries + 1} attempts: ${lastError}`,
      attempts: opts.maxRetries + 1,
    };
  }

  async chatStructured<T>(
    options: ChatOptions,
    schema: z.ZodType<T>,
  ): Promise<{ data: T; usage: TokenUsage }> {
    const response = await this.chat(options);
    const data = parseStructuredOutput(response.content, schema);
    return { data, usage: response.usage };
  }

  /** Convert ToolDefinition[] to OpenAI function calling format. */
  private convertTools(tools: ToolDefinition[]): OpenAIToolDefinition[] {
    return tools.map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      },
    }));
  }

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

  /** Map OpenAI finish_reason → unified stop reason. */
  private mapStopReason(finishReason: string | null | undefined): string | undefined {
    if (!finishReason) return undefined;
    switch (finishReason) {
      case 'stop': return 'end_turn';
      case 'tool_calls': return 'tool_use';
      case 'length': return 'max_tokens';
      default: return finishReason;
    }
  }

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
      throw new OpenAIError(
        `OpenAI authentication failed: ${errorMessage}`,
        status,
      );
    }

    if (status === 429) {
      throw new OpenAIError(
        `OpenAI rate limit exceeded: ${errorMessage}`,
        status,
      );
    }

    if (status === 400) {
      throw new OpenAIError(
        `OpenAI bad request: ${errorMessage}`,
        status,
      );
    }

    if (status === 404) {
      throw new OpenAIError(
        `OpenAI model not found: ${errorMessage}`,
        status,
      );
    }

    throw new OpenAIError(
      `OpenAI API error (${status}): ${errorMessage}`,
      status,
    );
  }

  private isRetryableError(err: unknown): boolean {
    if (err instanceof OpenAIError) {
      const code = err.statusCode;
      if (code === 401 || code === 400 || code === 404) return false;
      if (code === 429 || code >= 500 || code === 0) return true;
    }
    if (err instanceof DOMException && err.name === 'AbortError') return true;
    if (err instanceof Error) {
      return this.isRetryableErrorMessage(err.message);
    }
    return false;
  }

  private isRetryableErrorMessage(msg: string): boolean {
    const lower = msg.toLowerCase();
    if (lower.includes('authentication') || lower.includes('bad request') ||
        lower.includes('model not found')) {
      return false;
    }
    return lower.includes('rate limit') || lower.includes('timed out') ||
      lower.includes('timeout') || lower.includes('econnrefused') ||
      lower.includes('econnreset') || lower.includes('fetch failed') ||
      lower.includes('network') || lower.includes('500') ||
      lower.includes('502') || lower.includes('503') ||
      lower.includes('504') || lower.includes('not readable');
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
        throw new OpenAIError(
          `OpenAI request timed out after ${timeoutMs}ms`,
          0,
        );
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}

export class OpenAIError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'OpenAIError';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
