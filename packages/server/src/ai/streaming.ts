// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Streaming response handler for AI API calls.
 *
 * Wraps the Anthropic SDK's streaming API to provide real-time token
 * delivery with progress callbacks. Supports text accumulation,
 * error handling, and abort control.
 *
 * @module ai/streaming
 */

import Anthropic from '@anthropic-ai/sdk';
import type { MessageStream } from '@anthropic-ai/sdk/lib/MessageStream';

// ============================================================================
// Types
// ============================================================================

/** Events emitted during streaming */
export interface StreamCallbacks {
  /** Called when a text delta is received */
  onToken?: (token: string, accumulated: string) => void;
  /** Called when streaming completes with the final text */
  onComplete?: (fullText: string, usage: StreamUsage) => void;
  /** Called when an error occurs during streaming */
  onError?: (error: Error) => void;
  /** Called when streaming starts (connection established) */
  onStart?: () => void;
}

/** Token usage statistics from a streaming response */
export interface StreamUsage {
  inputTokens: number;
  outputTokens: number;
}

/** Options for a streaming AI request */
export interface StreamRequestOptions {
  /** Anthropic API client instance */
  client: Anthropic;
  /** Model to use */
  model: string;
  /** Maximum tokens to generate */
  maxTokens: number;
  /** User prompt */
  prompt: string;
  /** System prompt */
  system?: string;
  /** Request timeout in milliseconds */
  timeoutMs?: number;
  /** Callbacks for streaming events */
  callbacks?: StreamCallbacks;
}

/** Result of a streaming request */
export interface StreamResult {
  /** The full accumulated text */
  text: string;
  /** Token usage statistics */
  usage: StreamUsage;
  /** Whether the stream completed successfully */
  success: boolean;
  /** Error message if the stream failed */
  error?: string;
}

// ============================================================================
// Streaming Handler
// ============================================================================

/**
 * Execute a streaming AI request with real-time token callbacks.
 *
 * Uses the Anthropic SDK's `messages.stream()` method to receive tokens
 * incrementally. Provides callbacks for each token, completion, and errors.
 *
 * @param options - Configuration for the streaming request
 * @returns The accumulated result with usage statistics
 *
 * @example
 * ```ts
 * const result = await streamAIResponse({
 *   client: new Anthropic({ apiKey: 'sk-...' }),
 *   model: 'claude-sonnet-4-20250514',
 *   maxTokens: 4096,
 *   prompt: 'Analyze this environment...',
 *   callbacks: {
 *     onToken: (token) => process.stdout.write(token),
 *     onComplete: (text) => console.log('Done!'),
 *   },
 * });
 * ```
 */
export async function streamAIResponse(
  options: StreamRequestOptions,
): Promise<StreamResult> {
  const {
    client,
    model,
    maxTokens,
    prompt,
    system,
    timeoutMs,
    callbacks,
  } = options;

  let accumulated = '';
  const usage: StreamUsage = { inputTokens: 0, outputTokens: 0 };

  try {
    const stream = client.messages.stream(
      {
        model,
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }],
        ...(system ? { system } : {}),
      },
      ...(timeoutMs ? [{ timeout: timeoutMs }] : []),
    );

    callbacks?.onStart?.();

    stream.on('text', (delta: string) => {
      accumulated += delta;
      callbacks?.onToken?.(delta, accumulated);
    });

    const finalMessage = await stream.finalMessage();

    usage.inputTokens = finalMessage.usage?.input_tokens ?? 0;
    usage.outputTokens = finalMessage.usage?.output_tokens ?? 0;

    // Ensure accumulated text matches the final message text
    if (!accumulated) {
      for (const block of finalMessage.content) {
        if (block.type === 'text') {
          accumulated = block.text;
          break;
        }
      }
    }

    callbacks?.onComplete?.(accumulated, usage);

    return { text: accumulated, usage, success: true };
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    callbacks?.onError?.(error);

    return {
      text: accumulated,
      usage,
      success: false,
      error: error.message,
    };
  }
}

/**
 * Create an abort controller for cancelling a streaming request.
 *
 * Returns a controller that can be used to cancel an in-progress stream.
 * The AbortController's signal can be passed to the Anthropic SDK options.
 *
 * @returns An AbortController instance
 */
export function createStreamAbortController(): AbortController {
  return new AbortController();
}
