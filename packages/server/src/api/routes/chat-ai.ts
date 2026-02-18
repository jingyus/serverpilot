// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Chat-specific AI agent wrapper.
 *
 * Provides a conversational interface to the AI that can generate
 * both text responses and structured install plans from user messages.
 * Supports multiple AI providers via the provider factory.
 *
 * @module api/routes/chat-ai
 */

import { InstallPlanSchema } from "@aiinstaller/shared";
import type { InstallPlan } from "@aiinstaller/shared";
import type { AIProviderInterface } from "../../ai/providers/base.js";
import {
  getActiveProvider,
  createProvider,
} from "../../ai/providers/provider-factory.js";
import type { AIProviderType } from "../../ai/providers/provider-factory.js";
import { ClaudeProvider } from "../../ai/providers/claude.js";
import {
  initAgenticEngine,
  _resetAgenticEngine,
} from "../../ai/agentic-chat.js";
import { classifyError } from "../../ai/request-retry.js";
import type { ErrorClassification } from "../../ai/request-retry.js";
import { estimateTokens } from "../../ai/profile-context.js";
import { logger } from "../../utils/logger.js";

// ============================================================================
// Types
// ============================================================================

/** Retry configuration for chat AI requests */
export interface ChatRetryConfig {
  /** Maximum retry attempts (default: 3) */
  maxRetries: number;
  /** Initial delay in ms (default: 1000) */
  initialDelayMs: number;
  /** Backoff multiplier (default: 2) */
  backoffMultiplier: number;
  /** Maximum delay in ms (default: 30000) */
  maxDelayMs: number;
}

/** Retry event info pushed to the frontend via SSE */
export interface ChatRetryEvent {
  /** Current attempt number (1-based) */
  attempt: number;
  /** Maximum attempts allowed */
  maxAttempts: number;
  /** Error category from the failed attempt */
  errorCategory: string;
  /** Human-readable error message */
  errorMessage: string;
  /** Delay before next retry in ms */
  delayMs: number;
  /** Whether falling back to another provider */
  isFallback: boolean;
  /** Fallback provider name (if isFallback) */
  fallbackProvider?: string;
}

export interface ChatStreamCallbacks {
  onToken?: (token: string) => void | Promise<void>;
  /** Called before each retry attempt */
  onRetry?: (event: ChatRetryEvent) => void | Promise<void>;
}

export interface ChatResult {
  text: string;
  plan: (InstallPlan & { description?: string }) | null;
  /** Estimated token usage for profile context portion */
  profileTokens?: number;
}

/** Default retry configuration */
export const DEFAULT_CHAT_RETRY_CONFIG: ChatRetryConfig = {
  maxRetries: 3,
  initialDelayMs: 1000,
  backoffMultiplier: 2,
  maxDelayMs: 30000,
};

// ============================================================================
// ChatAIAgent
// ============================================================================

const BASE_SYSTEM_PROMPT = `You are ServerPilot, an AI DevOps assistant that helps users manage servers.
You operate like a terminal — execute commands directly and show results. Be action-oriented, not verbose.

CRITICAL RULES:
1. When users ask to check, inspect, diagnose, or monitor something — immediately generate a json-plan with read-only commands. Do NOT explain what you're going to do. Do NOT describe the commands. Just output the plan directly.
2. When users ask to install, configure, modify, or manage software — immediately generate a json-plan. You may add a brief one-line note about risks, but keep it minimal.
3. For general questions or discussions that don't require execution — respond conversationally and concisely.

Read-only commands (auto-executed, no confirmation needed):
ls, cat, df, du, free, top, ps, netstat, ss, lsof, systemctl status, docker ps, journalctl, uname, whoami, id, hostname, uptime, which, file, stat, wc, head, tail, grep, find, curl (GET only), ping, dig, nslookup, ip addr, ip route, iptables -L, mount, lsblk, lsusb, lspci, env, printenv, crontab -l

Output format — wrap the plan in \`\`\`json-plan markers:

\`\`\`json-plan
{
  "description": "Brief description",
  "steps": [
    {
      "id": "step-1",
      "description": "What this step does",
      "command": "the command",
      "timeout": 60000,
      "canRollback": false,
      "onError": "skip"
    }
  ],
  "estimatedTime": 120000,
  "risks": [
    { "level": "low", "description": "Risk description" }
  ]
}
\`\`\`

Schema rules:
- "onError" MUST be one of: "retry", "skip", "abort", "fallback"
- "risks[].level" MUST be one of: "low", "medium", "high"
- All step fields (id, description, command, timeout, canRollback, onError) are required

IMPORTANT: Do NOT output any text before the json-plan block when generating read-only check commands. The commands will be auto-executed and the user will see the output directly. Any text you write before the plan is wasted — the user wants results, not descriptions.`;

/**
 * Build the full system prompt with optional server profile and knowledge context.
 *
 * When profile context is provided, it is appended to the base prompt
 * so the AI is aware of the server's environment, installed software,
 * and any user-specified notes or caveats. Knowledge context (from RAG
 * search) provides relevant documentation snippets.
 */
export function buildSystemPrompt(
  profileContext?: string,
  caveats?: string[],
  knowledgeContext?: string,
): string {
  const parts = [BASE_SYSTEM_PROMPT];

  if (profileContext) {
    parts.push(profileContext);
  }

  if (caveats && caveats.length > 0) {
    parts.push(
      "## Important Caveats\n" + caveats.map((c) => `- ${c}`).join("\n"),
    );
  }

  if (knowledgeContext) {
    parts.push(knowledgeContext);
  }

  return parts.join("\n\n");
}

export class ChatAIAgent {
  private readonly provider: AIProviderInterface;
  private readonly retryConfig: ChatRetryConfig;

  constructor(
    provider: AIProviderInterface,
    retryConfig?: Partial<ChatRetryConfig>,
  ) {
    this.provider = provider;
    this.retryConfig = { ...DEFAULT_CHAT_RETRY_CONFIG, ...retryConfig };
  }

  /**
   * Send a chat message and stream the response with automatic retry.
   *
   * Retries on transient errors (network, timeout, 429, 5xx) with
   * exponential backoff. Non-retryable errors (auth, bad request) fail
   * immediately. Notifies the frontend of retry attempts via onRetry.
   *
   * @param message - User message
   * @param serverContext - Minimal server identifier (e.g. "Server: web-01")
   * @param conversationHistory - Formatted conversation history
   * @param callbacks - Optional streaming callbacks (onToken, onRetry)
   * @param profileContext - Rich server profile context for system prompt
   * @param caveats - One-line cautions about existing software/services
   * @param knowledgeContext - RAG knowledge base context for system prompt
   */
  async chat(
    message: string,
    serverContext: string,
    conversationHistory: string,
    callbacks?: ChatStreamCallbacks,
    profileContext?: string,
    caveats?: string[],
    knowledgeContext?: string,
  ): Promise<ChatResult> {
    const systemPrompt = buildSystemPrompt(
      profileContext,
      caveats,
      knowledgeContext,
    );
    const profileTokens = profileContext ? estimateTokens(profileContext) : 0;

    const userPrompt = conversationHistory
      ? `${serverContext}\n\nConversation history:\n${conversationHistory}\n\nUser: ${message}`
      : `${serverContext}\n\nUser: ${message}`;

    const chatOptions = {
      messages: [{ role: "user" as const, content: userPrompt }],
      system: systemPrompt,
      maxTokens: 4096,
    };

    const makeStreamCallbacks = () => ({
      onToken: (token: string) => {
        if (callbacks?.onToken) {
          const cbResult = callbacks.onToken(token);
          if (
            cbResult &&
            typeof (cbResult as Promise<void>).catch === "function"
          ) {
            (cbResult as Promise<void>).catch((err) => {
              logger.error(
                { operation: "chat_stream_token_error", error: String(err) },
                "Token callback error",
              );
            });
          }
        }
      },
    });

    // Attempt with retries on the primary provider
    const { maxRetries } = this.retryConfig;
    let lastError: Error | undefined;
    let lastClassification: ErrorClassification | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await this.provider.stream(
          chatOptions,
          makeStreamCallbacks(),
        );

        if (!result.success) {
          throw new Error(result.error ?? "AI streaming request failed");
        }

        const plan = this.extractPlan(result.content);
        return { text: result.content, plan, profileTokens };
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        const classification = classifyError(err);
        lastError = error;
        lastClassification = classification;

        // Non-retryable errors fail immediately
        if (!classification.retryable) {
          throw error;
        }

        // If we have retries left, notify and delay
        if (attempt < maxRetries) {
          const delayMs = this.calculateDelay(attempt, classification);

          logger.warn(
            {
              operation: "chat_retry",
              attempt: attempt + 1,
              maxRetries,
              category: classification.category,
              delayMs,
            },
            `Chat AI request failed (${classification.category}), retrying in ${delayMs}ms...`,
          );

          // Notify frontend of retry
          await this.notifyRetry(callbacks, {
            attempt: attempt + 1,
            maxAttempts: maxRetries + 1,
            errorCategory: classification.category,
            errorMessage: classification.message,
            delayMs,
            isFallback: false,
          });

          await sleep(delayMs);
        }
      }
    }

    // All retries exhausted — throw with context
    const retryError = new ChatRetryExhaustedError(
      `AI request failed after ${maxRetries + 1} attempts: ${lastError?.message}`,
      lastClassification,
    );
    throw retryError;
  }

  /**
   * Try to chat using a fallback provider after primary fails.
   * Returns null if no fallback is available or fallback also fails.
   */
  async chatWithFallback(
    message: string,
    serverContext: string,
    conversationHistory: string,
    callbacks?: ChatStreamCallbacks,
    profileContext?: string,
    caveats?: string[],
    knowledgeContext?: string,
  ): Promise<ChatResult | null> {
    const fallbackProvider = resolveFallbackProvider(this.provider.name);
    if (!fallbackProvider) return null;

    logger.info(
      {
        operation: "chat_fallback",
        from: this.provider.name,
        to: fallbackProvider.name,
      },
      `Falling back to ${fallbackProvider.name} provider`,
    );

    // Notify frontend about fallback
    await this.notifyRetry(callbacks, {
      attempt: 1,
      maxAttempts: 1,
      errorCategory: "fallback",
      errorMessage: `Primary provider failed, trying ${fallbackProvider.name}`,
      delayMs: 0,
      isFallback: true,
      fallbackProvider: fallbackProvider.name,
    });

    const fallbackAgent = new ChatAIAgent(fallbackProvider, { maxRetries: 1 });
    try {
      return await fallbackAgent.chat(
        message,
        serverContext,
        conversationHistory,
        callbacks,
        profileContext,
        caveats,
        knowledgeContext,
      );
    } catch (err) {
      logger.error(
        {
          operation: "chat_fallback_failed",
          provider: fallbackProvider.name,
          error: String(err),
        },
        "Fallback provider also failed",
      );
      return null;
    }
  }

  /** Calculate delay for retry attempt, respecting Retry-After headers */
  private calculateDelay(
    attempt: number,
    classification?: ErrorClassification,
  ): number {
    // Respect Retry-After header for rate-limit errors
    if (classification?.retryAfterMs && classification.retryAfterMs > 0) {
      return Math.min(classification.retryAfterMs, this.retryConfig.maxDelayMs);
    }

    const delay =
      this.retryConfig.initialDelayMs *
      Math.pow(this.retryConfig.backoffMultiplier, attempt);
    return Math.min(delay, this.retryConfig.maxDelayMs);
  }

  /** Notify frontend of a retry event */
  private async notifyRetry(
    callbacks: ChatStreamCallbacks | undefined,
    event: ChatRetryEvent,
  ): Promise<void> {
    if (!callbacks?.onRetry) return;
    try {
      const result = callbacks.onRetry(event);
      if (result && typeof (result as Promise<void>).catch === "function") {
        await result;
      }
    } catch (err) {
      logger.error(
        { operation: "chat_retry_callback_error", error: String(err) },
        "Retry callback error",
      );
    }
  }

  /**
   * Extract a JSON plan block from the AI response text.
   * Looks for ```json-plan ... ``` markers.
   *
   * AI-generated plans may not perfectly match the strict schema,
   * so we normalize common variations before validation.
   */
  private extractPlan(
    text: string,
  ): (InstallPlan & { description?: string }) | null {
    const planMatch = text.match(/```json-plan\s*\n([\s\S]*?)```/);
    if (!planMatch) return null;

    try {
      const raw = JSON.parse(planMatch[1]);
      const description = raw.description as string | undefined;

      // Normalize AI-generated values to match strict schema
      const validOnError = new Set(["retry", "skip", "abort", "fallback"]);
      const validRiskLevel = new Set(["low", "medium", "high"]);

      if (Array.isArray(raw.steps)) {
        for (const step of raw.steps) {
          // Normalize onError: continue→skip, stop→abort, etc.
          if (step.onError && !validOnError.has(step.onError)) {
            step.onError =
              step.onError === "abort" || step.onError === "stop"
                ? "abort"
                : "skip";
          }
          if (step.onError === undefined) step.onError = "skip";
          // Ensure required fields have defaults
          if (step.timeout === undefined) step.timeout = 30000;
          if (step.canRollback === undefined) step.canRollback = false;
        }
      }

      if (Array.isArray(raw.risks)) {
        for (const risk of raw.risks) {
          if (risk.level && !validRiskLevel.has(risk.level)) {
            risk.level =
              risk.level === "none" || risk.level === "minimal"
                ? "low"
                : "medium";
          }
        }
      }

      // Ensure estimatedTime exists
      if (raw.estimatedTime === undefined) raw.estimatedTime = 30000;

      const plan = InstallPlanSchema.parse(raw);
      return { ...plan, description };
    } catch (err) {
      logger.warn(
        { operation: "plan_parse_error", error: String(err) },
        "Failed to parse plan from AI response",
      );
      return null;
    }
  }
}

// ============================================================================
// Error Types
// ============================================================================

/**
 * Thrown when all retry attempts are exhausted for a chat AI request.
 * Contains the last error classification for the caller to decide on fallback.
 */
export class ChatRetryExhaustedError extends Error {
  readonly classification?: ErrorClassification;

  constructor(message: string, classification?: ErrorClassification) {
    super(message);
    this.name = "ChatRetryExhaustedError";
    this.classification = classification;
  }
}

// ============================================================================
// Fallback Provider Resolution
// ============================================================================

/** Fallback order: claude → openai → deepseek → ollama */
const FALLBACK_ORDER: AIProviderType[] = [
  "claude",
  "openai",
  "deepseek",
  "ollama",
];

/**
 * Resolve a fallback provider that differs from the current one.
 * Returns null if no alternative provider is configured.
 */
export function resolveFallbackProvider(
  currentProviderName: string,
): AIProviderInterface | null {
  for (const providerType of FALLBACK_ORDER) {
    if (providerType === currentProviderName) continue;

    try {
      const config = resolveFallbackConfig(providerType);
      if (config) {
        return createProvider(config);
      }
    } catch {
      continue;
    }
  }
  return null;
}

/** Check if a specific provider type has credentials configured */
function resolveFallbackConfig(provider: AIProviderType): {
  provider: AIProviderType;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
} | null {
  switch (provider) {
    case "claude": {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      return apiKey ? { provider, apiKey } : null;
    }
    case "openai": {
      const apiKey = process.env.OPENAI_API_KEY;
      return apiKey
        ? { provider, apiKey, baseUrl: process.env.OPENAI_BASE_URL }
        : null;
    }
    case "deepseek": {
      const apiKey = process.env.DEEPSEEK_API_KEY;
      return apiKey
        ? { provider, apiKey, baseUrl: process.env.DEEPSEEK_BASE_URL }
        : null;
    }
    case "ollama":
      return { provider, baseUrl: process.env.OLLAMA_BASE_URL };
    case "custom-openai": {
      const apiKey = process.env.CUSTOM_OPENAI_API_KEY;
      const baseUrl = process.env.CUSTOM_OPENAI_BASE_URL;
      return apiKey && baseUrl ? { provider, apiKey, baseUrl } : null;
    }
    default:
      return null;
  }
}

// ============================================================================
// Helpers
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// Singleton
// ============================================================================

let _agent: ChatAIAgent | null = null;

/**
 * Initialize the chat AI agent with a specific provider.
 */
export function initChatAIAgent(provider: AIProviderInterface): ChatAIAgent {
  _agent = new ChatAIAgent(provider);
  return _agent;
}

/**
 * Get the chat AI agent, lazily initializing from the active provider.
 */
export function getChatAIAgent(): ChatAIAgent | null {
  if (!_agent) {
    const provider = getActiveProvider();
    if (provider) {
      _agent = new ChatAIAgent(provider);
    }
  }
  return _agent;
}

/**
 * Reinitialize the chat AI agent and（若当前为 Claude）AgenticChatEngine。
 * 在设置里切换 AI 提供商后调用，确保对话使用刚保存的 provider 与模型。
 */
export function refreshChatAIAgent(): void {
  _agent = null;
  _resetAgenticEngine();
  const provider = getActiveProvider();
  if (provider && provider instanceof ClaudeProvider) {
    initAgenticEngine(provider.getClient(), provider.getModel());
  }
}

/** Reset for testing */
export function _resetChatAIAgent(): void {
  _agent = null;
}
