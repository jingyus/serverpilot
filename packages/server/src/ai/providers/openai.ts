// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * OpenAI AI Provider for GPT-4 and other OpenAI models.
 *
 * Integrates with the OpenAI API to provide AI capabilities.
 * Tier 2 provider — requires API key from OPENAI_API_KEY environment variable.
 *
 * Supports:
 * - GPT-4o, GPT-4 Turbo, GPT-4, GPT-3.5 Turbo
 * - Chat completions with streaming
 * - Token usage tracking and cost estimation
 * - Request retry with exponential backoff
 * - Structured JSON output parsing
 *
 * @module ai/providers/openai
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
// Cost Estimation
// ============================================================================

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

/**
 * Estimate the cost of a request based on token usage and model.
 *
 * @param usage - Token usage from the response
 * @param model - Model name used for the request
 * @returns Cost estimate in USD, or null if pricing is unknown
 */
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

// ============================================================================
// Structured Output Parsing
// ============================================================================

/**
 * Parse a structured JSON response from AI output.
 *
 * Strips markdown code fences if the model wraps the response,
 * then parses and validates the JSON against the provided Zod schema.
 *
 * @param text - Raw text output from the AI model
 * @param schema - Zod schema to validate against
 * @returns The validated data
 * @throws {Error} If JSON parsing or schema validation fails
 */
export function parseStructuredOutput<T>(text: string, schema: z.ZodType<T>): T {
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }
  const parsed: unknown = JSON.parse(cleaned);
  return schema.parse(parsed);
}

// ============================================================================
// Retry Types
// ============================================================================

/** Configuration for retry behavior */
export interface OpenAIRetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries?: number;
  /** Initial delay between retries in ms (default: 1000) */
  initialDelayMs?: number;
  /** Maximum delay between retries in ms (default: 30000) */
  maxDelayMs?: number;
  /** Backoff multiplier (default: 2) */
  backoffMultiplier?: number;
}

/** Result of a retried operation */
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

// ============================================================================
// Configuration
// ============================================================================

/** Default OpenAI configuration values */
const DEFAULTS = {
  baseUrl: 'https://api.openai.com',
  model: 'gpt-4o',
  timeoutMs: 60_000,
  maxTokens: 4096,
} as const;

/** Configuration specific to the OpenAI provider */
export interface OpenAIConfig {
  /** Base URL for the OpenAI API (default: https://api.openai.com) */
  baseUrl?: string;
  /** API key for authentication (required, or set OPENAI_API_KEY env var) */
  apiKey?: string;
  /** Model name to use (default: gpt-4o) */
  model?: string;
  /** Request timeout in milliseconds (default: 60000) */
  timeoutMs?: number;
}

/** Zod schema for OpenAI provider configuration */
export const OpenAIConfigSchema = z.object({
  baseUrl: z.string().url().default(DEFAULTS.baseUrl),
  apiKey: z.string().min(1, 'OpenAI API key is required'),
  model: z.string().min(1).default(DEFAULTS.model),
  timeoutMs: z.number().int().positive().default(DEFAULTS.timeoutMs),
});

// ============================================================================
// OpenAI API Types
// ============================================================================

/** Message format for OpenAI /v1/chat/completions */
interface OpenAIMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
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
}

/** Non-streaming response from OpenAI /v1/chat/completions */
const OpenAIChatResponseSchema = z.object({
  id: z.string(),
  choices: z.array(z.object({
    index: z.number(),
    message: z.object({
      role: z.string(),
      content: z.string().nullable(),
    }),
    finish_reason: z.string().nullable(),
  })).min(1),
  usage: z.object({
    prompt_tokens: z.number(),
    completion_tokens: z.number(),
    total_tokens: z.number(),
  }),
});

/** SSE streaming chunk from OpenAI */
const OpenAIStreamChunkSchema = z.object({
  id: z.string(),
  choices: z.array(z.object({
    index: z.number(),
    delta: z.object({
      role: z.string().optional(),
      content: z.string().nullable().optional(),
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

/** Error response from OpenAI API */
const OpenAIErrorResponseSchema = z.object({
  error: z.object({
    message: z.string(),
    type: z.string(),
    code: z.string().nullable().optional(),
    param: z.string().nullable().optional(),
  }),
});

// ============================================================================
// OpenAI Provider
// ============================================================================

/**
 * OpenAI AI Provider — Tier 2 for GPT-4 and other OpenAI models.
 *
 * Connects to the OpenAI API to provide AI capabilities.
 * Supports both synchronous and streaming chat.
 *
 * @example
 * ```ts
 * const openai = new OpenAIProvider({ apiKey: 'sk-...' });
 * if (await openai.isAvailable()) {
 *   const response = await openai.chat({
 *     messages: [{ role: 'user', content: 'Analyze this environment...' }],
 *     system: 'You are a DevOps expert.',
 *   });
 * }
 * ```
 */
export class OpenAIProvider implements AIProviderInterface {
  readonly name = 'openai';
  readonly tier = 2 as const;

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
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  /**
   * Send a non-streaming chat request to OpenAI.
   *
   * @param options - Chat request options
   * @returns The chat response with content and usage
   */
  async chat(options: ChatOptions): Promise<ChatResponse> {
    const messages = this.buildMessages(options);
    const body: OpenAIChatRequest = {
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
    const data = OpenAIChatResponseSchema.parse(raw);

    return {
      content: data.choices[0].message.content ?? '',
      usage: {
        inputTokens: data.usage.prompt_tokens,
        outputTokens: data.usage.completion_tokens,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
      },
    };
  }

  /**
   * Send a streaming chat request to OpenAI.
   *
   * OpenAI uses SSE (Server-Sent Events) format for streaming.
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
    const body: OpenAIChatRequest = {
      model: this.model,
      messages,
      max_tokens: options.maxTokens ?? DEFAULTS.maxTokens,
      stream: true,
      stream_options: {
        include_usage: true,
      },
    };

    let accumulated = '';
    let usage: TokenUsage = { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 };

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
   * Check if the OpenAI API is available and configured.
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

  /**
   * Get the configured model name.
   */
  getModel(): string {
    return this.model;
  }

  /**
   * Estimate the cost of a token usage for the configured model.
   *
   * @param usage - Token usage from a response
   * @returns Cost estimate in USD, or null if pricing is unavailable
   */
  estimateCost(usage: TokenUsage): CostEstimate | null {
    return estimateCost(usage, this.model);
  }

  /**
   * Send a chat request with automatic retry on transient failures.
   *
   * Retries on server errors (5xx), rate limits (429), network errors,
   * and timeouts. Does not retry on auth (401) or bad request (400/404).
   *
   * @param options - Chat request options
   * @param retryOpts - Retry configuration
   * @returns Retry result wrapping the chat response
   */
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

  /**
   * Send a streaming chat request with automatic retry on transient failures.
   *
   * Only retries if the error occurs before streaming starts (connection phase).
   * Once streaming begins, errors are not retried.
   *
   * @param options - Chat request options
   * @param callbacks - Optional streaming event callbacks
   * @param retryOpts - Retry configuration
   * @returns Retry result wrapping the stream response
   */
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

  /**
   * Send a chat request and parse the response as structured JSON.
   *
   * Combines chat() with parseStructuredOutput() for convenience.
   * Strips markdown code fences and validates against the provided schema.
   *
   * @param options - Chat request options
   * @param schema - Zod schema to validate the response against
   * @returns The validated structured data
   */
  async chatStructured<T>(
    options: ChatOptions,
    schema: z.ZodType<T>,
  ): Promise<{ data: T; usage: TokenUsage }> {
    const response = await this.chat(options);
    const data = parseStructuredOutput(response.content, schema);
    return { data, usage: response.usage };
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  /**
   * Build the OpenAI message array from ChatOptions.
   * Prepends a system message if `options.system` is provided.
   */
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

  /**
   * Parse a single SSE JSON chunk from the stream.
   * Returns null for unparseable chunks instead of throwing.
   */
  private parseStreamChunk(json: string): OpenAIStreamChunk | null {
    try {
      const parsed: unknown = JSON.parse(json);
      return OpenAIStreamChunkSchema.parse(parsed);
    } catch {
      return null;
    }
  }

  /**
   * Handle an error response from the OpenAI API.
   * Attempts to parse the structured error; falls back to status text.
   */
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

  /**
   * Determine if an error is retryable (transient).
   * Non-retryable: auth (401), bad request (400), not found (404).
   * Retryable: server errors (5xx), rate limits (429), network errors, timeouts.
   */
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

  /**
   * Check if an error message indicates a retryable failure.
   */
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

// ============================================================================
// Error Type
// ============================================================================

/**
 * Custom error for OpenAI provider failures.
 * Includes the HTTP status code for error classification.
 */
export class OpenAIError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'OpenAIError';
  }
}

// ============================================================================
// Internal Utilities
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
