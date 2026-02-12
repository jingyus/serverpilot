// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * AI API communication utilities.
 *
 * Provides `callAI` and `callAIStreaming` functions that send prompts
 * to AI providers, parse JSON responses, and validate with Zod schemas.
 * Includes retry logic via fault-tolerance and error classification.
 * Extracted from agent.ts to keep each module under 500 lines.
 *
 * @module ai/api-call
 */

import { z } from 'zod';
import type { AIProviderInterface, ProviderStreamCallbacks } from './providers/base.js';
import { retryWithBackoff } from './fault-tolerance.js';
import type { RetryConfig } from './fault-tolerance.js';
import type { AIAnalysisResult, TokenUsage } from './schemas.js';

// ============================================================================
// Configuration
// ============================================================================

/** Parameters for AI API calls */
export interface AICallConfig {
  /** The AI provider to use */
  provider: AIProviderInterface;
  /** Request timeout in milliseconds */
  timeoutMs: number;
  /** Retry configuration for transient errors */
  retryConfig: RetryConfig;
}

/** System prompt used for all JSON-only AI calls */
const SYSTEM_PROMPT = 'You are a software installation expert. Always respond with valid JSON only. No markdown, no code fences, no extra text.';

/** Max tokens for AI responses */
const MAX_TOKENS = 4096;

// ============================================================================
// Public API
// ============================================================================

/**
 * Send a prompt to the AI and parse the JSON response.
 *
 * Uses exponential backoff retry for transient errors.
 * Delegates to the configured AIProviderInterface.chat().
 *
 * @param prompt - The user prompt to send
 * @param schema - Zod schema to validate the response
 * @param config - AI call configuration
 * @returns Parsed and validated result
 */
export async function callAI<T>(
  prompt: string,
  schema: z.ZodType<T>,
  config: AICallConfig,
): Promise<AIAnalysisResult<T>> {
  let detectedErrorType: 'validation' | 'auth' | undefined;
  let usage: TokenUsage | undefined;

  const result = await retryWithBackoff(
    async () => {
      const response = await config.provider.chat({
        messages: [{ role: 'user', content: prompt }],
        system: SYSTEM_PROMPT,
        maxTokens: MAX_TOKENS,
        timeoutMs: config.timeoutMs,
      });

      usage = {
        inputTokens: response.usage.inputTokens,
        outputTokens: response.usage.outputTokens,
      };

      const parsed = parseJSON(response.content);
      const validated = schema.parse(parsed);

      return validated;
    },
    config.retryConfig,
    (error) => {
      const isZodError = error.constructor.name === 'ZodError' ||
                        (error && typeof error === 'object' && 'issues' in error);
      const isSyntaxError = error.constructor.name === 'SyntaxError' ||
                           error.name === 'SyntaxError' ||
                           error.message.includes('JSON') ||
                           error.message.includes('Unexpected token');

      if (isZodError || isSyntaxError ||
          error.message.includes('validation') ||
          error.message.includes('No text content')) {
        detectedErrorType = 'validation';
        return false;
      }
      if (error.message.includes('authentication') || error.message.includes('401')) {
        detectedErrorType = 'auth';
        return false;
      }
      return true;
    },
  );

  if (result.success && result.data) {
    return { success: true, data: result.data, usage };
  }

  const errorType = detectedErrorType ?? classifyErrorMessage(result.error ?? '');

  return { success: false, error: result.error, errorType, usage };
}

/**
 * Send a prompt to the AI with streaming and parse the JSON response.
 *
 * Uses the provider's stream() method for real-time token delivery while
 * still parsing and validating the final response as JSON. Falls back
 * to non-streaming chat() if streaming fails with a non-transient error.
 * Uses exponential backoff retry for transient errors.
 *
 * @param prompt - The user prompt to send
 * @param schema - Zod schema to validate the response
 * @param config - AI call configuration
 * @param callbacks - Optional streaming callbacks
 * @returns Parsed and validated result
 */
export async function callAIStreaming<T>(
  prompt: string,
  schema: z.ZodType<T>,
  config: AICallConfig,
  callbacks?: ProviderStreamCallbacks,
): Promise<AIAnalysisResult<T>> {
  let callbacksUsed = false;
  let detectedErrorType: 'validation' | 'auth' | undefined;
  let usage: TokenUsage | undefined;

  const retryResult = await retryWithBackoff(
    async () => {
      const streamResult = await config.provider.stream(
        {
          messages: [{ role: 'user', content: prompt }],
          system: SYSTEM_PROMPT,
          maxTokens: MAX_TOKENS,
          timeoutMs: config.timeoutMs,
        },
        !callbacksUsed ? callbacks : undefined,
      );

      callbacksUsed = true;

      usage = {
        inputTokens: streamResult.usage.inputTokens,
        outputTokens: streamResult.usage.outputTokens,
      };

      if (!streamResult.success) {
        throw new Error(streamResult.error ?? 'Streaming request failed');
      }

      const parsed = parseJSON(streamResult.content);
      const validated = schema.parse(parsed);

      return validated;
    },
    config.retryConfig,
    (error) => {
      if (error.constructor.name === 'ZodError' ||
          error.constructor.name === 'SyntaxError' ||
          error.message.includes('validation') ||
          error.message.includes('No text content')) {
        detectedErrorType = 'validation';
        return false;
      }
      if (error.message.includes('authentication') || error.message.includes('401')) {
        detectedErrorType = 'auth';
        return false;
      }
      return true;
    },
  );

  if (retryResult.success && retryResult.data) {
    return { success: true, data: retryResult.data, usage };
  }

  const errorType = detectedErrorType ?? classifyErrorMessage(retryResult.error ?? '');

  return { success: false, error: retryResult.error, errorType, usage };
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Parse a JSON string, stripping markdown code fences if present.
 */
export function parseJSON(text: string): unknown {
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }
  return JSON.parse(cleaned);
}

/**
 * Classify error type from an error message string.
 * Used as fallback when error type was not captured during retry.
 */
export function classifyErrorMessage(errorMsg: string): 'validation' | 'network' | 'auth' | 'other' {
  const msg = errorMsg.toLowerCase();

  if (msg.includes('json') || msg.includes('validation') ||
      msg.includes('zoderror') || msg.includes('expected') ||
      msg.includes('invalid') || msg.includes('no text content') ||
      msg.includes('content blocks') || msg.includes('parse') ||
      msg.includes('schema') || msg.includes('unexpected token') ||
      msg.includes('invalid_type') || msg.includes('required')) {
    return 'validation';
  }

  if (msg.includes('authentication') || msg.includes('401') ||
      msg.includes('unauthorized') || msg.includes('api key')) {
    return 'auth';
  }

  if (msg.includes('network') || msg.includes('timeout') ||
      msg.includes('econnrefused') || msg.includes('connection') ||
      msg.includes('etimedout') || msg.includes('fetch failed') ||
      msg.includes('dropped') || msg.includes('enotfound') ||
      msg.includes('stream') || msg.includes('request failed')) {
    return 'network';
  }

  return 'other';
}
