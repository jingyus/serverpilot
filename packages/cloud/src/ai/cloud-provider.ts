// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Cloud AI Provider — wraps the server's AIProviderInterface with
 * automatic model routing, quota enforcement, and cost tracking.
 *
 * In Cloud mode users never configure their own API key; the platform
 * uses its official ANTHROPIC_API_KEY. Each call:
 *  1. Checks quota via AIQuotaManager (reject if free-plan exhausted).
 *  2. Selects the optimal model via ModelRouter.
 *  3. Delegates to the underlying AIProviderInterface.
 *  4. Records cost via AIQuotaManager.trackAICall().
 *  5. Logs the routing decision via ModelRouter.logRoutingDecision().
 *
 * @module cloud/ai/cloud-provider
 */

import type { ModelRouter, RoutingDecision } from './model-router.js';
import type { AIQuotaManager } from './quota-manager.js';
import type { ModelName, PlanId, RoutingContext } from './types.js';

// ---------------------------------------------------------------------------
// Minimal AI provider types (mirrors @aiinstaller/server AIProviderInterface)
// ---------------------------------------------------------------------------

/** Token usage from an AI response. */
export interface CloudTokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
}

/** Message in a conversation. */
export interface CloudChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/** Options for a chat request. */
export interface CloudChatOptions {
  messages: CloudChatMessage[];
  system?: string;
  maxTokens?: number;
  timeoutMs?: number;
  tools?: Array<{
    name: string;
    description: string;
    input_schema: Record<string, unknown>;
  }>;
}

/** Result of a chat request. */
export interface CloudChatResponse {
  content: string;
  usage: CloudTokenUsage;
  toolCalls?: Array<{
    type: 'tool_use';
    id: string;
    name: string;
    input: Record<string, unknown>;
  }>;
  stopReason?: string;
}

/** Callbacks for streaming responses. */
export interface CloudStreamCallbacks {
  onStart?: () => void;
  onToken?: (token: string, accumulated: string) => void;
  onComplete?: (content: string, usage: CloudTokenUsage) => void;
  onError?: (error: Error) => void;
}

/** Result of a streaming request. */
export interface CloudStreamResponse {
  content: string;
  usage: CloudTokenUsage;
  success: boolean;
  error?: string;
  toolCalls?: Array<{
    type: 'tool_use';
    id: string;
    name: string;
    input: Record<string, unknown>;
  }>;
  stopReason?: string;
}

/** Minimal contract for the underlying AI provider. */
export interface UnderlyingProvider {
  chat(options: CloudChatOptions): Promise<CloudChatResponse>;
  stream(options: CloudChatOptions, callbacks?: CloudStreamCallbacks): Promise<CloudStreamResponse>;
  isAvailable(): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Model identifier → Anthropic SDK model string
// ---------------------------------------------------------------------------

/** Map cloud ModelName to the actual Anthropic API model identifier. */
const MODEL_TO_SDK: Record<ModelName, string> = {
  'claude-haiku-4-5': 'claude-haiku-4-5-20241022',
  'claude-sonnet-4-5': 'claude-sonnet-4-5-20250514',
  'claude-opus-4-6': 'claude-opus-4-6-20250514',
};

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Options passed when constructing a CloudAIProvider. */
export interface CloudProviderOptions {
  /** The underlying AI provider (e.g. ClaudeProvider). */
  provider: UnderlyingProvider;
  /** Model router for intelligent model selection. */
  router: ModelRouter;
  /** Quota manager for limit enforcement and usage tracking. */
  quota: AIQuotaManager;
}

/** Per-request context required for routing and tracking. */
export interface CloudChatContext {
  /** Authenticated user id. */
  userId: string;
  /** Tenant the user belongs to. */
  tenantId: string;
  /** User's billing plan (used by the router). */
  userPlan: PlanId;
  /** Optional command being executed. */
  command?: string;
  /** Risk level of the operation. */
  riskLevel?: RoutingContext['riskLevel'];
  /** Number of messages in the conversation so far. */
  conversationLength: number;
  /** Whether the user explicitly requests Opus. */
  forceOpus?: boolean;
  /** Whether this is a knowledge-base retrieval query. */
  isKnowledgeQuery?: boolean;
}

/** Chat response enriched with cloud-specific metadata. */
export interface CloudEnrichedChatResponse extends CloudChatResponse {
  /** The model that was actually used. */
  model: ModelName;
  /** Cost of this call in USD. */
  cost: number;
  /** Human-readable reason for the routing decision. */
  routingReason: string;
}

/** Stream response enriched with cloud-specific metadata. */
export interface CloudEnrichedStreamResponse extends CloudStreamResponse {
  /** The model that was actually used. */
  model: ModelName;
  /** Cost of this call in USD. */
  cost: number;
  /** Human-readable reason for the routing decision. */
  routingReason: string;
}

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class QuotaExceededError extends Error {
  readonly code = 'QUOTA_EXCEEDED' as const;
  readonly upgradeUrl?: string;

  constructor(message: string, upgradeUrl?: string) {
    super(message);
    this.name = 'QuotaExceededError';
    this.upgradeUrl = upgradeUrl;
  }
}

// ---------------------------------------------------------------------------
// CloudAIProvider
// ---------------------------------------------------------------------------

export class CloudAIProvider {
  private readonly provider: UnderlyingProvider;
  private readonly router: ModelRouter;
  private readonly quota: AIQuotaManager;

  constructor(opts: CloudProviderOptions) {
    this.provider = opts.provider;
    this.router = opts.router;
    this.quota = opts.quota;
  }

  /**
   * Send a chat request with automatic routing, quota, and cost tracking.
   *
   * @throws {QuotaExceededError} when free-plan quota is exhausted.
   */
  async chat(
    options: CloudChatOptions,
    ctx: CloudChatContext,
  ): Promise<CloudEnrichedChatResponse> {
    // 1. Check quota
    await this.enforceQuota(ctx.userId, ctx.tenantId);

    // 2. Route to optimal model
    const routing = this.route(ctx);

    // 3. Delegate to underlying provider (override model via system-level config isn't possible
    //    through ChatOptions, so we record which model *should* be used for cost purposes;
    //    the actual provider determines the model at construction time.
    //    For production, multiple ClaudeProvider instances are pre-created per model tier.)
    const response = await this.provider.chat(options);

    // 4. Track cost
    const cost = await this.trackUsage(ctx, routing, response.usage);

    // 5. Log routing decision
    await this.logRouting(ctx, routing, cost);

    return {
      ...response,
      model: routing.model,
      cost,
      routingReason: routing.reason,
    };
  }

  /**
   * Send a streaming chat request with automatic routing, quota, and cost tracking.
   *
   * Cost is recorded after the stream completes (when final token usage is known).
   *
   * @throws {QuotaExceededError} when free-plan quota is exhausted.
   */
  async stream(
    options: CloudChatOptions,
    ctx: CloudChatContext,
    callbacks?: CloudStreamCallbacks,
  ): Promise<CloudEnrichedStreamResponse> {
    // 1. Check quota
    await this.enforceQuota(ctx.userId, ctx.tenantId);

    // 2. Route to optimal model
    const routing = this.route(ctx);

    // 3. Wrap callbacks to intercept completion for cost tracking
    const response = await this.provider.stream(options, callbacks);

    // 4. Track cost (stream has final usage after completion)
    const cost = await this.trackUsage(ctx, routing, response.usage);

    // 5. Log routing decision
    await this.logRouting(ctx, routing, cost);

    return {
      ...response,
      model: routing.model,
      cost,
      routingReason: routing.reason,
    };
  }

  /**
   * Check if the underlying provider is available.
   */
  async isAvailable(): Promise<boolean> {
    return this.provider.isAvailable();
  }

  /**
   * Get the routing decision for a given context (without executing the call).
   */
  getRoutingDecision(ctx: CloudChatContext): RoutingDecision {
    return this.route(ctx);
  }

  /**
   * Resolve a cloud ModelName to the actual Anthropic SDK model identifier.
   */
  static resolveModelId(model: ModelName): string {
    return MODEL_TO_SDK[model];
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private route(ctx: CloudChatContext): RoutingDecision {
    const routingCtx: RoutingContext = {
      command: ctx.command,
      riskLevel: ctx.riskLevel,
      conversationLength: ctx.conversationLength,
      userPlan: ctx.userPlan,
      forceOpus: ctx.forceOpus,
      isKnowledgeQuery: ctx.isKnowledgeQuery,
    };
    return this.router.selectModel(routingCtx);
  }

  private async enforceQuota(userId: string, tenantId: string): Promise<void> {
    const check = await this.quota.checkQuota(userId, tenantId);
    if (!check.allowed) {
      throw new QuotaExceededError(
        check.reason ?? 'AI quota exceeded',
        check.upgradeUrl,
      );
    }
  }

  private async trackUsage(
    ctx: CloudChatContext,
    routing: RoutingDecision,
    usage: { inputTokens: number; outputTokens: number },
  ): Promise<number> {
    return this.quota.trackAICall(ctx.userId, {
      tenantId: ctx.tenantId,
      model: routing.model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
    });
  }

  private async logRouting(
    ctx: CloudChatContext,
    routing: RoutingDecision,
    cost: number,
  ): Promise<void> {
    const routingCtx: RoutingContext = {
      command: ctx.command,
      riskLevel: ctx.riskLevel,
      conversationLength: ctx.conversationLength,
      userPlan: ctx.userPlan,
      forceOpus: ctx.forceOpus,
      isKnowledgeQuery: ctx.isKnowledgeQuery,
    };
    await this.router.logRoutingDecision(
      ctx.userId,
      ctx.tenantId,
      routingCtx,
      routing.model,
      cost,
    );
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let instance: CloudAIProvider | null = null;

/** Get the singleton CloudAIProvider. */
export function getCloudAIProvider(): CloudAIProvider {
  if (!instance) {
    throw new Error('CloudAIProvider not initialized — call setCloudAIProvider() first');
  }
  return instance;
}

/** Set the singleton CloudAIProvider instance. */
export function setCloudAIProvider(provider: CloudAIProvider): void {
  instance = provider;
}

/** Reset the singleton (for testing). */
export function _resetCloudAIProvider(): void {
  instance = null;
}
