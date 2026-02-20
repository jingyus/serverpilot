// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  CloudAIProvider,
  QuotaExceededError,
  getCloudAIProvider,
  setCloudAIProvider,
  _resetCloudAIProvider,
} from './cloud-provider.js';
import type {
  CloudChatOptions,
  CloudChatResponse,
  CloudStreamCallbacks,
  CloudStreamResponse,
  UnderlyingProvider,
  CloudChatContext,
} from './cloud-provider.js';
import { ModelRouter } from './model-router.js';
import type { RoutingDataAccess } from './model-router.js';
import { AIQuotaManager } from './quota-manager.js';
import type { QuotaDataAccess, AIUsageRecord } from './quota-manager.js';
import type { ModelName, PlanId } from './types.js';

// ---------------------------------------------------------------------------
// In-memory data-access implementations
// ---------------------------------------------------------------------------

class InMemoryRoutingData implements RoutingDataAccess {
  logs: Array<{
    id: number;
    userId: string;
    tenantId: string;
    command: string | null;
    riskLevel: string | null;
    conversationLength: number;
    selectedModel: ModelName;
    actualCost: string;
  }> = [];
  private nextId = 1;

  async insertRoutingLog(record: Omit<(typeof this.logs)[0], 'id'>): Promise<number> {
    const id = this.nextId++;
    this.logs.push({ ...record, id });
    return id;
  }
}

class InMemoryQuotaData implements QuotaDataAccess {
  plan: PlanId | null = 'pro';
  callCount = 0;
  totalCost = 0;
  usageRecords: Array<Omit<AIUsageRecord, 'id' | 'createdAt'>> = [];
  private nextId = 1;

  async getTenantPlan(_tenantId: string): Promise<PlanId | null> {
    return this.plan;
  }
  async getCallCount(_userId: string, _since: Date): Promise<number> {
    return this.callCount;
  }
  async getTotalCost(_userId: string, _since: Date): Promise<number> {
    return this.totalCost;
  }
  async insertUsage(record: Omit<AIUsageRecord, 'id' | 'createdAt'>): Promise<number> {
    this.usageRecords.push(record);
    return this.nextId++;
  }
}

// ---------------------------------------------------------------------------
// Mock provider
// ---------------------------------------------------------------------------

function createMockProvider(overrides?: Partial<UnderlyingProvider>): UnderlyingProvider {
  return {
    chat: vi.fn<(opts: CloudChatOptions) => Promise<CloudChatResponse>>().mockResolvedValue({
      content: 'Hello from AI',
      usage: { inputTokens: 100, outputTokens: 50 },
      stopReason: 'end_turn',
    }),
    stream: vi.fn<(opts: CloudChatOptions, cb?: CloudStreamCallbacks) => Promise<CloudStreamResponse>>().mockResolvedValue({
      content: 'Streamed response',
      usage: { inputTokens: 200, outputTokens: 100 },
      success: true,
      stopReason: 'end_turn',
    }),
    isAvailable: vi.fn<() => Promise<boolean>>().mockResolvedValue(true),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const USER_ID = 'user-cloud-1';
const TENANT_ID = 'tenant-cloud-1';

function makeCtx(overrides?: Partial<CloudChatContext>): CloudChatContext {
  return {
    userId: USER_ID,
    tenantId: TENANT_ID,
    userPlan: 'pro',
    conversationLength: 5,
    ...overrides,
  };
}

const defaultOptions: CloudChatOptions = {
  messages: [{ role: 'user', content: 'Hello' }],
  system: 'You are a helpful assistant',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CloudAIProvider', () => {
  let routingData: InMemoryRoutingData;
  let quotaData: InMemoryQuotaData;
  let router: ModelRouter;
  let quota: AIQuotaManager;
  let mockProvider: UnderlyingProvider;
  let cloud: CloudAIProvider;

  beforeEach(() => {
    routingData = new InMemoryRoutingData();
    quotaData = new InMemoryQuotaData();
    router = new ModelRouter(routingData);
    quota = new AIQuotaManager(quotaData, vi.fn()); // suppress warnings
    mockProvider = createMockProvider();
    cloud = new CloudAIProvider({ provider: mockProvider, router, quota });
    _resetCloudAIProvider();
  });

  // -------------------------------------------------------------------------
  // 1. Default usage — no API Key needed
  // -------------------------------------------------------------------------

  it('uses the platform provider without user-supplied API key', async () => {
    const result = await cloud.chat(defaultOptions, makeCtx());
    expect(result.content).toBe('Hello from AI');
    expect(mockProvider.chat).toHaveBeenCalledWith(defaultOptions);
  });

  // -------------------------------------------------------------------------
  // 2. Automatic model routing
  // -------------------------------------------------------------------------

  it('routes to Sonnet by default (pro plan, long conversation)', async () => {
    const result = await cloud.chat(defaultOptions, makeCtx());
    expect(result.model).toBe('claude-sonnet-4-5');
    expect(result.routingReason).toBe('Default routing');
  });

  it('routes to Haiku for simple queries (short conversation, no command)', async () => {
    const result = await cloud.chat(
      defaultOptions,
      makeCtx({ conversationLength: 1 }),
    );
    expect(result.model).toBe('claude-haiku-4-5');
    expect(result.routingReason).toContain('Simple query');
  });

  it('routes to Opus for high-risk operations', async () => {
    const result = await cloud.chat(
      defaultOptions,
      makeCtx({ riskLevel: 'critical' }),
    );
    expect(result.model).toBe('claude-opus-4-6');
    expect(result.routingReason).toContain('High-risk');
  });

  it('routes to Haiku for knowledge queries', async () => {
    const result = await cloud.chat(
      defaultOptions,
      makeCtx({ isKnowledgeQuery: true }),
    );
    expect(result.model).toBe('claude-haiku-4-5');
    expect(result.routingReason).toContain('Knowledge');
  });

  it('routes to Opus when enterprise user forces Opus', async () => {
    const result = await cloud.chat(
      defaultOptions,
      makeCtx({ userPlan: 'enterprise', forceOpus: true }),
    );
    expect(result.model).toBe('claude-opus-4-6');
    expect(result.routingReason).toContain('Enterprise');
  });

  // -------------------------------------------------------------------------
  // 3. Cost tracking — every AI call recorded
  // -------------------------------------------------------------------------

  it('records usage in ai_usage table after chat', async () => {
    const result = await cloud.chat(defaultOptions, makeCtx());

    expect(quotaData.usageRecords).toHaveLength(1);
    const record = quotaData.usageRecords[0];
    expect(record.userId).toBe(USER_ID);
    expect(record.tenantId).toBe(TENANT_ID);
    expect(record.model).toBe('claude-sonnet-4-5');
    expect(record.inputTokens).toBe(100);
    expect(record.outputTokens).toBe(50);
    expect(result.cost).toBeGreaterThan(0);
  });

  it('records usage in ai_usage table after stream', async () => {
    const result = await cloud.stream(defaultOptions, makeCtx());

    expect(quotaData.usageRecords).toHaveLength(1);
    const record = quotaData.usageRecords[0];
    expect(record.userId).toBe(USER_ID);
    expect(record.tenantId).toBe(TENANT_ID);
    expect(record.inputTokens).toBe(200);
    expect(record.outputTokens).toBe(100);
    expect(result.cost).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // 4. Routing decision logged
  // -------------------------------------------------------------------------

  it('logs routing decision to ai_routing_logs after chat', async () => {
    await cloud.chat(defaultOptions, makeCtx({ command: 'apt install nginx' }));

    expect(routingData.logs).toHaveLength(1);
    const log = routingData.logs[0];
    expect(log.userId).toBe(USER_ID);
    expect(log.tenantId).toBe(TENANT_ID);
    expect(log.command).toBe('apt install nginx');
    expect(log.selectedModel).toBe('claude-sonnet-4-5');
    expect(Number(log.actualCost)).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // 5. Quota enforcement
  // -------------------------------------------------------------------------

  it('throws QuotaExceededError when free plan quota exhausted', async () => {
    quotaData.plan = 'free';
    quotaData.callCount = 100; // exactly at limit

    await expect(cloud.chat(defaultOptions, makeCtx({ userPlan: 'free' }))).rejects.toThrow(
      QuotaExceededError,
    );
  });

  it('QuotaExceededError has code and upgradeUrl', async () => {
    quotaData.plan = 'free';
    quotaData.callCount = 100;

    try {
      await cloud.chat(defaultOptions, makeCtx({ userPlan: 'free' }));
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(QuotaExceededError);
      const qe = err as QuotaExceededError;
      expect(qe.code).toBe('QUOTA_EXCEEDED');
      expect(qe.upgradeUrl).toBe('/billing?upgrade=pro');
    }
  });

  it('allows paid plan users even when call count is high', async () => {
    quotaData.plan = 'team';
    quotaData.callCount = 10000;
    quotaData.totalCost = 300; // above soft limit

    const result = await cloud.chat(defaultOptions, makeCtx({ userPlan: 'team' }));
    expect(result.content).toBe('Hello from AI');
  });

  it('does not call provider when quota check fails', async () => {
    quotaData.plan = 'free';
    quotaData.callCount = 100;

    await expect(cloud.chat(defaultOptions, makeCtx({ userPlan: 'free' }))).rejects.toThrow();
    expect(mockProvider.chat).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 6. Streaming support
  // -------------------------------------------------------------------------

  it('supports streaming with cost tracking', async () => {
    const result = await cloud.stream(defaultOptions, makeCtx());

    expect(result.content).toBe('Streamed response');
    expect(result.success).toBe(true);
    expect(result.model).toBe('claude-sonnet-4-5');
    expect(result.cost).toBeGreaterThan(0);
    expect(result.routingReason).toBe('Default routing');
    expect(mockProvider.stream).toHaveBeenCalled();
  });

  it('passes callbacks through to underlying provider stream', async () => {
    const callbacks: CloudStreamCallbacks = {
      onStart: vi.fn(),
      onToken: vi.fn(),
    };

    await cloud.stream(defaultOptions, makeCtx(), callbacks);
    expect(mockProvider.stream).toHaveBeenCalledWith(defaultOptions, callbacks);
  });

  it('enforces quota before streaming', async () => {
    quotaData.plan = 'free';
    quotaData.callCount = 100;

    await expect(cloud.stream(defaultOptions, makeCtx({ userPlan: 'free' }))).rejects.toThrow(
      QuotaExceededError,
    );
    expect(mockProvider.stream).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 7. isAvailable delegates to provider
  // -------------------------------------------------------------------------

  it('delegates isAvailable to underlying provider', async () => {
    expect(await cloud.isAvailable()).toBe(true);
    expect(mockProvider.isAvailable).toHaveBeenCalled();
  });

  it('returns false when provider is unavailable', async () => {
    const unavailable = createMockProvider({
      isAvailable: vi.fn<() => Promise<boolean>>().mockResolvedValue(false),
    });
    const cloudUnavail = new CloudAIProvider({
      provider: unavailable,
      router,
      quota,
    });
    expect(await cloudUnavail.isAvailable()).toBe(false);
  });

  // -------------------------------------------------------------------------
  // 8. getRoutingDecision (preview without calling AI)
  // -------------------------------------------------------------------------

  it('returns routing decision without making an AI call', () => {
    const decision = cloud.getRoutingDecision(makeCtx({ riskLevel: 'critical' }));
    expect(decision.model).toBe('claude-opus-4-6');
    expect(mockProvider.chat).not.toHaveBeenCalled();
    expect(mockProvider.stream).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 9. resolveModelId static helper
  // -------------------------------------------------------------------------

  it('resolves cloud model names to Anthropic SDK identifiers', () => {
    expect(CloudAIProvider.resolveModelId('claude-haiku-4-5')).toBe('claude-haiku-4-5-20241022');
    expect(CloudAIProvider.resolveModelId('claude-sonnet-4-5')).toBe('claude-sonnet-4-5-20250514');
    expect(CloudAIProvider.resolveModelId('claude-opus-4-6')).toBe('claude-opus-4-6-20250514');
  });

  // -------------------------------------------------------------------------
  // 10. Singleton management
  // -------------------------------------------------------------------------

  describe('singleton', () => {
    it('throws when not initialized', () => {
      expect(() => getCloudAIProvider()).toThrow('CloudAIProvider not initialized');
    });

    it('returns instance after set', () => {
      setCloudAIProvider(cloud);
      expect(getCloudAIProvider()).toBe(cloud);
    });

    it('resets singleton correctly', () => {
      setCloudAIProvider(cloud);
      _resetCloudAIProvider();
      expect(() => getCloudAIProvider()).toThrow('CloudAIProvider not initialized');
    });
  });

  // -------------------------------------------------------------------------
  // 11. Error propagation from underlying provider
  // -------------------------------------------------------------------------

  it('propagates provider errors (not swallowed by cost tracking)', async () => {
    const failingProvider = createMockProvider({
      chat: vi.fn().mockRejectedValue(new Error('API timeout')),
    });
    const failCloud = new CloudAIProvider({
      provider: failingProvider,
      router,
      quota,
    });

    await expect(failCloud.chat(defaultOptions, makeCtx())).rejects.toThrow('API timeout');
    // No usage should be recorded since the call failed
    expect(quotaData.usageRecords).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // 12. Tenant not found
  // -------------------------------------------------------------------------

  it('throws QuotaExceededError when tenant not found', async () => {
    quotaData.plan = null;

    await expect(cloud.chat(defaultOptions, makeCtx())).rejects.toThrow(QuotaExceededError);
  });
});
