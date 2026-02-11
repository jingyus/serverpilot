// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Token Counting Utilities
 *
 * Provides unified interface for extracting and aggregating token usage
 * from different AI providers (Claude, OpenAI, DeepSeek, Ollama).
 *
 * @module ai/token-counting
 */

import type { TokenUsage } from './agent.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Supported AI providers
 */
export type AIProvider = 'claude' | 'anthropic' | 'openai' | 'deepseek' | 'ollama' | 'google' | 'qwen';

/**
 * Token usage with provider metadata
 */
export interface TokenUsageWithProvider extends TokenUsage {
  /** AI provider name */
  provider: AIProvider;
  /** Model name */
  model: string;
  /** Whether token count is estimated (for providers without native support) */
  estimated?: boolean;
}

/**
 * Aggregated token usage across multiple operations
 */
export interface AggregatedTokenUsage {
  /** Total input tokens */
  totalInputTokens: number;
  /** Total output tokens */
  totalOutputTokens: number;
  /** Total tokens (input + output) */
  totalTokens: number;
  /** Breakdown by operation type */
  byOperation: Record<string, TokenUsage>;
  /** Breakdown by provider */
  byProvider: Record<AIProvider, TokenUsage>;
}

// ============================================================================
// Token Extraction
// ============================================================================

/**
 * Extract token usage from Claude/Anthropic API response.
 *
 * Claude API returns usage in response.usage:
 * - input_tokens: number
 * - output_tokens: number
 *
 * @param response - Anthropic API response object
 * @returns Token usage or null if not available
 *
 * @example
 * ```ts
 * const response = await client.messages.create({...});
 * const usage = extractClaudeTokens(response);
 * console.log(`Used ${usage.inputTokens} input, ${usage.outputTokens} output`);
 * ```
 */
export function extractClaudeTokens(response: any): TokenUsage | null {
  if (!response || typeof response !== 'object') {
    return null;
  }

  // Check for usage in response
  const usage = response.usage;
  if (!usage || typeof usage !== 'object') {
    return null;
  }

  const inputTokens = typeof usage.input_tokens === 'number' ? usage.input_tokens : 0;
  const outputTokens = typeof usage.output_tokens === 'number' ? usage.output_tokens : 0;

  return {
    inputTokens,
    outputTokens,
  };
}

/**
 * Extract token usage from OpenAI API response.
 *
 * OpenAI API returns usage in response.usage:
 * - prompt_tokens: number
 * - completion_tokens: number
 * - total_tokens: number
 *
 * @param response - OpenAI API response object
 * @returns Token usage or null if not available
 *
 * @example
 * ```ts
 * const response = await openai.chat.completions.create({...});
 * const usage = extractOpenAITokens(response);
 * console.log(`Used ${usage.inputTokens} input, ${usage.outputTokens} output`);
 * ```
 */
export function extractOpenAITokens(response: any): TokenUsage | null {
  if (!response || typeof response !== 'object') {
    return null;
  }

  const usage = response.usage;
  if (!usage || typeof usage !== 'object') {
    return null;
  }

  const inputTokens = typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : 0;
  const outputTokens = typeof usage.completion_tokens === 'number' ? usage.completion_tokens : 0;

  return {
    inputTokens,
    outputTokens,
  };
}

/**
 * Extract token usage from DeepSeek API response.
 *
 * DeepSeek uses OpenAI-compatible format:
 * - prompt_tokens: number
 * - completion_tokens: number
 *
 * @param response - DeepSeek API response object
 * @returns Token usage or null if not available
 */
export function extractDeepSeekTokens(response: any): TokenUsage | null {
  // DeepSeek is OpenAI-compatible
  return extractOpenAITokens(response);
}

/**
 * Extract token usage from Ollama API response.
 *
 * Ollama returns token counts in the response:
 * - prompt_eval_count: number (input tokens)
 * - eval_count: number (output tokens)
 *
 * Note: Not all Ollama models support token counting.
 *
 * @param response - Ollama API response object
 * @returns Token usage or null if not available
 */
export function extractOllamaTokens(response: any): TokenUsage | null {
  if (!response || typeof response !== 'object') {
    return null;
  }

  const inputTokens = typeof response.prompt_eval_count === 'number' ? response.prompt_eval_count : 0;
  const outputTokens = typeof response.eval_count === 'number' ? response.eval_count : 0;

  // Return null if both are 0 (model doesn't support counting)
  if (inputTokens === 0 && outputTokens === 0) {
    return null;
  }

  return {
    inputTokens,
    outputTokens,
  };
}

/**
 * Extract token usage from any AI provider response.
 *
 * Automatically detects provider format and extracts tokens.
 *
 * @param response - AI provider response object
 * @param provider - Provider name (for format detection)
 * @returns Token usage or null if not available
 *
 * @example
 * ```ts
 * const usage = extractTokenUsage(response, 'claude');
 * if (usage) {
 *   console.log(`Used ${usage.inputTokens + usage.outputTokens} total tokens`);
 * }
 * ```
 */
export function extractTokenUsage(response: any, provider: AIProvider): TokenUsage | null {
  switch (provider) {
    case 'claude':
    case 'anthropic':
      return extractClaudeTokens(response);
    case 'openai':
      return extractOpenAITokens(response);
    case 'deepseek':
      return extractDeepSeekTokens(response);
    case 'ollama':
      return extractOllamaTokens(response);
    case 'google':
    case 'qwen':
      // TODO: Add support for Google Gemini and Qwen APIs
      return null;
    default:
      return null;
  }
}

// ============================================================================
// Token Aggregation
// ============================================================================

/**
 * Create an empty aggregated token usage object.
 *
 * @returns Empty aggregation object
 */
export function createEmptyAggregation(): AggregatedTokenUsage {
  return {
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalTokens: 0,
    byOperation: {},
    byProvider: {} as Record<AIProvider, TokenUsage>,
  };
}

/**
 * Add token usage to an aggregated result.
 *
 * @param aggregation - Existing aggregation to update
 * @param usage - Token usage to add
 * @param operation - Operation type (e.g., 'planGeneration', 'errorDiagnosis')
 * @param provider - AI provider name
 * @returns Updated aggregation
 *
 * @example
 * ```ts
 * let total = createEmptyAggregation();
 * total = addTokenUsage(total, { inputTokens: 100, outputTokens: 50 }, 'planGeneration', 'claude');
 * total = addTokenUsage(total, { inputTokens: 80, outputTokens: 40 }, 'errorDiagnosis', 'claude');
 * console.log(`Total tokens used: ${total.totalTokens}`);
 * ```
 */
export function addTokenUsage(
  aggregation: AggregatedTokenUsage,
  usage: TokenUsage,
  operation: string,
  provider: AIProvider
): AggregatedTokenUsage {
  // Update totals
  aggregation.totalInputTokens += usage.inputTokens;
  aggregation.totalOutputTokens += usage.outputTokens;
  aggregation.totalTokens = aggregation.totalInputTokens + aggregation.totalOutputTokens;

  // Update operation breakdown
  if (!aggregation.byOperation[operation]) {
    aggregation.byOperation[operation] = { inputTokens: 0, outputTokens: 0 };
  }
  aggregation.byOperation[operation].inputTokens += usage.inputTokens;
  aggregation.byOperation[operation].outputTokens += usage.outputTokens;

  // Update provider breakdown
  if (!aggregation.byProvider[provider]) {
    aggregation.byProvider[provider] = { inputTokens: 0, outputTokens: 0 };
  }
  aggregation.byProvider[provider].inputTokens += usage.inputTokens;
  aggregation.byProvider[provider].outputTokens += usage.outputTokens;

  return aggregation;
}

/**
 * Merge multiple token usage objects into one.
 *
 * @param usages - Array of token usage objects
 * @returns Merged token usage
 *
 * @example
 * ```ts
 * const total = mergeTokenUsage([
 *   { inputTokens: 100, outputTokens: 50 },
 *   { inputTokens: 80, outputTokens: 40 },
 * ]);
 * console.log(total); // { inputTokens: 180, outputTokens: 90 }
 * ```
 */
export function mergeTokenUsage(usages: TokenUsage[]): TokenUsage {
  return usages.reduce(
    (acc, usage) => ({
      inputTokens: acc.inputTokens + usage.inputTokens,
      outputTokens: acc.outputTokens + usage.outputTokens,
    }),
    { inputTokens: 0, outputTokens: 0 }
  );
}

// ============================================================================
// Token Estimation (for providers without native support)
// ============================================================================

/**
 * Estimate token count for text.
 *
 * Uses a rough approximation: 1 token ≈ 4 characters for English text.
 * This is less accurate than provider-specific tokenizers but works as fallback.
 *
 * @param text - Text to estimate tokens for
 * @returns Estimated token count
 *
 * @example
 * ```ts
 * const tokens = estimateTokenCount('Hello, how are you?');
 * console.log(`Estimated ${tokens} tokens`);
 * ```
 */
export function estimateTokenCount(text: string): number {
  if (!text || typeof text !== 'string') {
    return 0;
  }

  // Simple approximation: ~4 characters per token
  // This is a rough estimate and should only be used as fallback
  return Math.ceil(text.length / 4);
}

/**
 * Estimate token usage for prompt and response.
 *
 * @param prompt - Input prompt text
 * @param response - Output response text
 * @returns Estimated token usage
 */
export function estimateTokenUsage(prompt: string, response: string): TokenUsage {
  return {
    inputTokens: estimateTokenCount(prompt),
    outputTokens: estimateTokenCount(response),
  };
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Check if token usage object is valid.
 *
 * @param usage - Token usage object to validate
 * @returns True if valid, false otherwise
 */
export function isValidTokenUsage(usage: any): usage is TokenUsage {
  if (!usage || typeof usage !== 'object') {
    return false;
  }

  return (
    typeof usage.inputTokens === 'number' &&
    usage.inputTokens >= 0 &&
    typeof usage.outputTokens === 'number' &&
    usage.outputTokens >= 0
  );
}

/**
 * Safely extract token usage with fallback to zero.
 *
 * @param usage - Potentially invalid token usage
 * @returns Valid token usage (zero if invalid)
 */
export function safeTokenUsage(usage: any): TokenUsage {
  if (isValidTokenUsage(usage)) {
    return usage;
  }

  return {
    inputTokens: 0,
    outputTokens: 0,
  };
}
