// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Claude AI Provider wrapping the Anthropic SDK.
 *
 * Tier 1 provider — highest capability. Requires ANTHROPIC_API_KEY.
 *
 * @module ai/providers/claude
 */

import Anthropic from '@anthropic-ai/sdk';
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
  model: 'claude-sonnet-4-20250514',
  timeoutMs: 60_000,
  maxTokens: 4096,
} as const;

export interface ClaudeConfig {
  /** Anthropic API key (required, or set ANTHROPIC_API_KEY env var) */
  apiKey?: string;
  /** Model name (default: claude-sonnet-4-20250514) */
  model?: string;
  /** Request timeout in milliseconds (default: 60000) */
  timeoutMs?: number;
}

export const ClaudeConfigSchema = z.object({
  apiKey: z.string().min(1, 'Anthropic API key is required'),
  model: z.string().min(1).default(DEFAULTS.model),
  timeoutMs: z.number().int().positive().default(DEFAULTS.timeoutMs),
});

// ============================================================================
// Claude Provider
// ============================================================================

/**
 * Claude AI Provider — Tier 1 highest capability.
 *
 * Wraps the Anthropic SDK to implement AIProviderInterface.
 */
export class ClaudeProvider implements AIProviderInterface {
  readonly name = 'claude';
  readonly tier = 1 as const;

  private readonly client: Anthropic;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(config: ClaudeConfig = {}) {
    const resolved = {
      ...config,
      apiKey: config.apiKey ?? process.env.ANTHROPIC_API_KEY ?? '',
    };
    const validated = ClaudeConfigSchema.parse(resolved);
    this.client = new Anthropic({ apiKey: validated.apiKey });
    this.model = validated.model;
    this.timeoutMs = validated.timeoutMs;
  }

  async chat(options: ChatOptions): Promise<ChatResponse> {
    const response = await this.client.messages.create(
      {
        model: this.model,
        max_tokens: options.maxTokens ?? DEFAULTS.maxTokens,
        system: options.system,
        messages: options.messages.map((m) => ({
          role: m.role === 'system' ? ('user' as const) : m.role,
          content: m.content,
        })),
      },
      { timeout: options.timeoutMs ?? this.timeoutMs },
    );

    const content = this.extractText(response);
    return {
      content,
      usage: {
        inputTokens: response.usage?.input_tokens ?? 0,
        outputTokens: response.usage?.output_tokens ?? 0,
      },
    };
  }

  async stream(
    options: ChatOptions,
    callbacks?: ProviderStreamCallbacks,
  ): Promise<StreamResponse> {
    let accumulated = '';
    let usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };

    try {
      const stream = this.client.messages.stream(
        {
          model: this.model,
          max_tokens: options.maxTokens ?? DEFAULTS.maxTokens,
          system: options.system,
          messages: options.messages.map((m) => ({
            role: m.role === 'system' ? ('user' as const) : m.role,
            content: m.content,
          })),
        },
        { timeout: options.timeoutMs ?? this.timeoutMs },
      );

      callbacks?.onStart?.();

      stream.on('text', (delta: string) => {
        accumulated += delta;
        callbacks?.onToken?.(delta, accumulated);
      });

      const finalMessage = await stream.finalMessage();
      usage = {
        inputTokens: finalMessage.usage?.input_tokens ?? 0,
        outputTokens: finalMessage.usage?.output_tokens ?? 0,
      };

      callbacks?.onComplete?.(accumulated, usage);
      return { content: accumulated, usage, success: true };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      callbacks?.onError?.(error);
      return { content: accumulated, usage, success: false, error: error.message };
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      // Minimal request to verify API key
      await this.client.messages.create(
        {
          model: this.model,
          max_tokens: 1,
          messages: [{ role: 'user', content: 'ping' }],
        },
        { timeout: 5000 },
      );
      return true;
    } catch (err) {
      // Auth errors → not available; other errors (network) → also not available
      return false;
    }
  }

  /** Get the underlying Anthropic client (for InstallAIAgent compatibility). */
  getClient(): Anthropic {
    return this.client;
  }

  /** Get the configured model name. */
  getModel(): string {
    return this.model;
  }

  private extractText(response: Anthropic.Message): string {
    for (const block of response.content) {
      if (block.type === 'text') {
        return block.text;
      }
    }
    return '';
  }
}
