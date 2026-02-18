// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Claude AI Provider wrapping the Anthropic SDK.
 *
 * Tier 1 provider — highest capability. Requires ANTHROPIC_API_KEY.
 *
 * @module ai/providers/claude
 */

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type {
  AIProviderInterface,
  ChatOptions,
  ChatResponse,
  ProviderStreamCallbacks,
  StreamResponse,
  TokenUsage,
  ToolUseBlock,
} from "./base.js";

// ============================================================================
// Configuration
// ============================================================================

/** 默认使用官方别名（推荐），兼容代理与不同区域；完整 ID 见 https://docs.anthropic.com/en/api/models-list */
const DEFAULTS = {
  model: "claude-sonnet-4-5",
  timeoutMs: 60_000,
  maxTokens: 4096,
} as const;

export interface ClaudeConfig {
  /** Anthropic API key (required, or set ANTHROPIC_API_KEY env var) */
  apiKey?: string;
  /** Model name (default: claude-sonnet-4-5，官方别名) */
  model?: string;
  /** Request timeout in milliseconds (default: 60000) */
  timeoutMs?: number;
}

export const ClaudeConfigSchema = z.object({
  apiKey: z.string().min(1, "Anthropic API key is required"),
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
/** Known context window sizes for Claude models (in tokens) */
const CLAUDE_CONTEXT_WINDOWS: Record<string, number> = {
  "claude-sonnet-4-5": 200_000,
  "claude-sonnet-4-5-20250929": 200_000,
  "claude-opus-4-6": 200_000,
  "claude-haiku-4-5-20251001": 200_000,
  "claude-sonnet-4-20250514": 200_000,
  "claude-opus-4-20250514": 200_000,
  "claude-haiku-4-20250514": 200_000,
  "claude-3-5-sonnet-20241022": 200_000,
  "claude-3-5-haiku-20241022": 200_000,
  "claude-3-opus-20240229": 200_000,
  "claude-3-sonnet-20240229": 200_000,
  "claude-3-haiku-20240307": 200_000,
};

/** Default context window for unknown Claude models */
const DEFAULT_CLAUDE_CONTEXT_WINDOW = 200_000;

/** 官方 API 地址；显式传入以忽略 ANTHROPIC_BASE_URL，避免请求被代理（如 claude-code-router）转发到错误后端 */
const ANTHROPIC_OFFICIAL_BASE_URL = "https://api.anthropic.com";

export class ClaudeProvider implements AIProviderInterface {
  readonly name = "claude";
  readonly tier = 1 as const;
  readonly contextWindowSize: number;

  private readonly client: Anthropic;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(config: ClaudeConfig = {}) {
    const resolved = {
      ...config,
      apiKey: config.apiKey ?? process.env.ANTHROPIC_API_KEY ?? "",
    };
    const validated = ClaudeConfigSchema.parse(resolved);
    this.client = new Anthropic({
      apiKey: validated.apiKey,
      baseURL: ANTHROPIC_OFFICIAL_BASE_URL,
    });
    this.model = validated.model;
    this.timeoutMs = validated.timeoutMs;
    this.contextWindowSize =
      CLAUDE_CONTEXT_WINDOWS[this.model] ?? DEFAULT_CLAUDE_CONTEXT_WINDOW;
  }

  async chat(options: ChatOptions): Promise<ChatResponse> {
    const createParams: Anthropic.MessageCreateParams = {
      model: this.model,
      max_tokens: options.maxTokens ?? DEFAULTS.maxTokens,
      system: options.system,
      messages: options.messages.map((m) => ({
        role: m.role === "system" ? ("user" as const) : m.role,
        content: m.content,
      })),
    };

    if (options.tools?.length) {
      createParams.tools = options.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.input_schema as Anthropic.Tool.InputSchema,
      }));
    }

    const response = await this.client.messages.create(createParams, {
      timeout: options.timeoutMs ?? this.timeoutMs,
    });

    const content = this.extractText(response);
    const toolCalls = this.extractToolCalls(response);

    return {
      content,
      usage: {
        inputTokens: response.usage?.input_tokens ?? 0,
        outputTokens: response.usage?.output_tokens ?? 0,
        cacheCreationInputTokens:
          response.usage?.cache_creation_input_tokens ?? 0,
        cacheReadInputTokens: response.usage?.cache_read_input_tokens ?? 0,
      },
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      stopReason: response.stop_reason ?? undefined,
    };
  }

  async stream(
    options: ChatOptions,
    callbacks?: ProviderStreamCallbacks,
  ): Promise<StreamResponse> {
    let accumulated = "";
    let usage: TokenUsage = {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    };

    try {
      const streamParams: Anthropic.MessageCreateParams = {
        model: this.model,
        max_tokens: options.maxTokens ?? DEFAULTS.maxTokens,
        system: options.system,
        messages: options.messages.map((m) => ({
          role: m.role === "system" ? ("user" as const) : m.role,
          content: m.content,
        })),
      };

      if (options.tools?.length) {
        streamParams.tools = options.tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.input_schema as Anthropic.Tool.InputSchema,
        }));
      }

      const stream = this.client.messages.stream(streamParams, {
        timeout: options.timeoutMs ?? this.timeoutMs,
      });

      callbacks?.onStart?.();

      stream.on("text", (delta: string) => {
        accumulated += delta;
        callbacks?.onToken?.(delta, accumulated);
      });

      const finalMessage = await stream.finalMessage();
      usage = {
        inputTokens: finalMessage.usage?.input_tokens ?? 0,
        outputTokens: finalMessage.usage?.output_tokens ?? 0,
        cacheCreationInputTokens:
          finalMessage.usage?.cache_creation_input_tokens ?? 0,
        cacheReadInputTokens: finalMessage.usage?.cache_read_input_tokens ?? 0,
      };

      const toolCalls = this.extractToolCalls(finalMessage);

      callbacks?.onComplete?.(accumulated, usage);
      return {
        content: accumulated,
        usage,
        success: true,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        stopReason: finalMessage.stop_reason ?? undefined,
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
      // Minimal request to verify API key
      await this.client.messages.create(
        {
          model: this.model,
          max_tokens: 1,
          messages: [{ role: "user", content: "ping" }],
        },
        { timeout: 5000 },
      );
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const status =
        typeof (err as { status?: number })?.status === "number"
          ? (err as { status: number }).status
          : null;
      if (status === 401)
        throw new Error(
          "Claude API 密钥无效或已过期，请检查 ANTHROPIC_API_KEY。",
        );
      if (status === 403)
        throw new Error("Claude API 无权限访问，请检查密钥与模型权限。");
      if (status === 404)
        throw new Error(
          `Claude 模型 "${this.model}" 不存在或不可用。请先尝试使用官方别名：claude-sonnet-4-5、claude-opus-4-6、claude-haiku-4-5。若仍报错，请检查 API 密钥权限与区域、或是否经代理转发。完整列表：https://docs.anthropic.com/en/api/models-list`,
        );
      if (status === 429)
        throw new Error("Claude API 请求过于频繁，请稍后再试。");
      throw new Error(`Claude 健康检查失败: ${msg}`);
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
    const texts: string[] = [];
    for (const block of response.content) {
      if (block.type === "text") {
        texts.push(block.text);
      }
    }
    return texts.join("");
  }

  private extractToolCalls(response: Anthropic.Message): ToolUseBlock[] {
    const calls: ToolUseBlock[] = [];
    for (const block of response.content) {
      if (block.type === "tool_use") {
        calls.push({
          type: "tool_use",
          id: block.id,
          name: block.name,
          input: block.input as Record<string, unknown>,
        });
      }
    }
    return calls;
  }
}
