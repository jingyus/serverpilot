// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ModelRouter,
  getModelRouter,
  setModelRouter,
  _resetModelRouter,
} from './model-router.js';
import type { RoutingDataAccess } from './model-router.js';
import type { RoutingContext } from './types.js';

// ---------------------------------------------------------------------------
// In-memory RoutingDataAccess implementation for testing
// ---------------------------------------------------------------------------

interface StoredLog {
  id: number;
  userId: string;
  tenantId: string;
  command: string | null;
  riskLevel: string | null;
  conversationLength: number;
  selectedModel: string;
  actualCost: string;
}

class InMemoryRoutingDataAccess implements RoutingDataAccess {
  logs: StoredLog[] = [];
  private nextId = 1;

  async insertRoutingLog(record: Omit<StoredLog, 'id'>): Promise<number> {
    const id = this.nextId++;
    this.logs.push({ ...record, id });
    return id;
  }
}

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const USER_ID = 'user-1';
const TENANT_ID = 'tenant-1';

function makeContext(overrides?: Partial<RoutingContext>): RoutingContext {
  return {
    conversationLength: 5,
    userPlan: 'pro',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ModelRouter', () => {
  let data: InMemoryRoutingDataAccess;
  let router: ModelRouter;

  beforeEach(() => {
    data = new InMemoryRoutingDataAccess();
    router = new ModelRouter(data);
    _resetModelRouter();
  });

  // -----------------------------------------------------------------------
  // Rule 1: Enterprise + forceOpus → Opus
  // -----------------------------------------------------------------------

  describe('enterprise forceOpus', () => {
    it('selects opus when enterprise user sets forceOpus', () => {
      const result = router.selectModel(makeContext({
        userPlan: 'enterprise',
        forceOpus: true,
      }));
      expect(result.model).toBe('claude-opus-4-6');
      expect(result.reason).toContain('Enterprise');
    });

    it('ignores forceOpus for non-enterprise plans', () => {
      const result = router.selectModel(makeContext({
        userPlan: 'pro',
        forceOpus: true,
      }));
      // Should fall through to default (sonnet), not opus
      expect(result.model).not.toBe('claude-opus-4-6');
    });

    it('ignores forceOpus=false for enterprise', () => {
      const result = router.selectModel(makeContext({
        userPlan: 'enterprise',
        forceOpus: false,
      }));
      // No forceOpus, no risk → should be sonnet (default)
      expect(result.model).toBe('claude-sonnet-4-5');
    });
  });

  // -----------------------------------------------------------------------
  // Rule 2: Critical / high risk → Opus
  // -----------------------------------------------------------------------

  describe('high-risk routing', () => {
    it('selects opus for critical risk', () => {
      const result = router.selectModel(makeContext({
        riskLevel: 'critical',
        command: 'rm -rf /',
      }));
      expect(result.model).toBe('claude-opus-4-6');
      expect(result.reason).toContain('critical');
    });

    it('selects opus for high risk', () => {
      const result = router.selectModel(makeContext({
        riskLevel: 'high',
        command: 'chmod 777 /etc/passwd',
      }));
      expect(result.model).toBe('claude-opus-4-6');
      expect(result.reason).toContain('high');
    });

    it('does not select opus for red risk (medium)', () => {
      const result = router.selectModel(makeContext({
        riskLevel: 'red',
        command: 'systemctl restart nginx',
      }));
      expect(result.model).not.toBe('claude-opus-4-6');
    });

    it('does not select opus for green risk', () => {
      const result = router.selectModel(makeContext({
        riskLevel: 'green',
        command: 'ls -la',
      }));
      expect(result.model).not.toBe('claude-opus-4-6');
    });

    it('does not select opus for yellow risk', () => {
      const result = router.selectModel(makeContext({
        riskLevel: 'yellow',
        command: 'cat /etc/hosts',
      }));
      expect(result.model).not.toBe('claude-opus-4-6');
    });
  });

  // -----------------------------------------------------------------------
  // Rule 3: Knowledge-base retrieval → Haiku
  // -----------------------------------------------------------------------

  describe('knowledge query routing', () => {
    it('selects haiku for knowledge-base queries', () => {
      const result = router.selectModel(makeContext({
        isKnowledgeQuery: true,
      }));
      expect(result.model).toBe('claude-haiku-4-5');
      expect(result.reason).toContain('Knowledge');
    });

    it('prefers opus over haiku when knowledge query has critical risk', () => {
      const result = router.selectModel(makeContext({
        isKnowledgeQuery: true,
        riskLevel: 'critical',
      }));
      // Critical risk has higher priority than knowledge query
      expect(result.model).toBe('claude-opus-4-6');
    });
  });

  // -----------------------------------------------------------------------
  // Rule 4: Simple query (short conversation, no command) → Haiku
  // -----------------------------------------------------------------------

  describe('simple query routing', () => {
    it('selects haiku for short conversation without command', () => {
      const result = router.selectModel(makeContext({
        conversationLength: 1,
        command: undefined,
      }));
      expect(result.model).toBe('claude-haiku-4-5');
      expect(result.reason).toContain('Simple query');
    });

    it('selects haiku when conversationLength is 0 (new conversation)', () => {
      const result = router.selectModel(makeContext({
        conversationLength: 0,
        command: undefined,
      }));
      expect(result.model).toBe('claude-haiku-4-5');
    });

    it('selects haiku when conversationLength is 2 (still short)', () => {
      const result = router.selectModel(makeContext({
        conversationLength: 2,
        command: undefined,
      }));
      expect(result.model).toBe('claude-haiku-4-5');
    });

    it('does not select haiku when conversationLength reaches threshold (3)', () => {
      const result = router.selectModel(makeContext({
        conversationLength: 3,
        command: undefined,
      }));
      expect(result.model).toBe('claude-sonnet-4-5');
    });

    it('does not select haiku for short conversation with a command', () => {
      const result = router.selectModel(makeContext({
        conversationLength: 1,
        command: 'ls -la',
      }));
      // Has a command → not "simple", falls through to default
      expect(result.model).toBe('claude-sonnet-4-5');
    });
  });

  // -----------------------------------------------------------------------
  // Rule 5: Default → Sonnet
  // -----------------------------------------------------------------------

  describe('default routing', () => {
    it('selects sonnet for typical conversation with command', () => {
      const result = router.selectModel(makeContext({
        conversationLength: 10,
        command: 'apt update',
      }));
      expect(result.model).toBe('claude-sonnet-4-5');
      expect(result.reason).toBe('Default routing');
    });

    it('selects sonnet for long conversation without command', () => {
      const result = router.selectModel(makeContext({
        conversationLength: 20,
        command: undefined,
      }));
      expect(result.model).toBe('claude-sonnet-4-5');
    });
  });

  // -----------------------------------------------------------------------
  // Priority ordering
  // -----------------------------------------------------------------------

  describe('priority ordering', () => {
    it('enterprise forceOpus takes precedence over high risk', () => {
      const result = router.selectModel(makeContext({
        userPlan: 'enterprise',
        forceOpus: true,
        riskLevel: 'critical',
      }));
      expect(result.model).toBe('claude-opus-4-6');
      expect(result.reason).toContain('Enterprise');
    });

    it('high risk takes precedence over knowledge query', () => {
      const result = router.selectModel(makeContext({
        riskLevel: 'high',
        isKnowledgeQuery: true,
      }));
      expect(result.model).toBe('claude-opus-4-6');
      expect(result.reason).toContain('high');
    });

    it('knowledge query takes precedence over simple query', () => {
      const result = router.selectModel(makeContext({
        conversationLength: 1,
        command: undefined,
        isKnowledgeQuery: true,
      }));
      expect(result.model).toBe('claude-haiku-4-5');
      expect(result.reason).toContain('Knowledge');
    });
  });

  // -----------------------------------------------------------------------
  // logRoutingDecision
  // -----------------------------------------------------------------------

  describe('logRoutingDecision', () => {
    it('inserts a routing log with all fields', async () => {
      const context = makeContext({
        command: 'systemctl restart nginx',
        riskLevel: 'red',
        conversationLength: 7,
      });

      const id = await router.logRoutingDecision(
        USER_ID,
        TENANT_ID,
        context,
        'claude-sonnet-4-5',
        0.039,
      );

      expect(id).toBe(1);
      expect(data.logs).toHaveLength(1);
      expect(data.logs[0]).toEqual({
        id: 1,
        userId: USER_ID,
        tenantId: TENANT_ID,
        command: 'systemctl restart nginx',
        riskLevel: 'red',
        conversationLength: 7,
        selectedModel: 'claude-sonnet-4-5',
        actualCost: '0.039000',
      });
    });

    it('stores null for optional fields when absent', async () => {
      const context = makeContext({
        command: undefined,
        riskLevel: undefined,
      });

      await router.logRoutingDecision(
        USER_ID,
        TENANT_ID,
        context,
        'claude-haiku-4-5',
        0.001,
      );

      expect(data.logs[0]!.command).toBeNull();
      expect(data.logs[0]!.riskLevel).toBeNull();
    });

    it('formats actualCost to 6 decimal places', async () => {
      const context = makeContext();

      await router.logRoutingDecision(
        USER_ID,
        TENANT_ID,
        context,
        'claude-opus-4-6',
        0.195,
      );

      expect(data.logs[0]!.actualCost).toBe('0.195000');
    });

    it('auto-increments log ids', async () => {
      const context = makeContext();

      const id1 = await router.logRoutingDecision(USER_ID, TENANT_ID, context, 'claude-haiku-4-5', 0.001);
      const id2 = await router.logRoutingDecision(USER_ID, TENANT_ID, context, 'claude-sonnet-4-5', 0.039);

      expect(id1).toBe(1);
      expect(id2).toBe(2);
    });
  });

  // -----------------------------------------------------------------------
  // Singleton management
  // -----------------------------------------------------------------------

  describe('singleton', () => {
    it('throws when accessed before initialization', () => {
      expect(() => getModelRouter()).toThrow('ModelRouter not initialized');
    });

    it('returns the set instance after initialization', () => {
      setModelRouter(router);
      expect(getModelRouter()).toBe(router);
    });

    it('can be reset and re-set', () => {
      setModelRouter(router);
      _resetModelRouter();
      expect(() => getModelRouter()).toThrow('ModelRouter not initialized');

      const router2 = new ModelRouter(data);
      setModelRouter(router2);
      expect(getModelRouter()).toBe(router2);
    });
  });

  // -----------------------------------------------------------------------
  // Plan-specific behavior
  // -----------------------------------------------------------------------

  describe('plan-specific behavior', () => {
    it('free plan users get default routing (no forceOpus)', () => {
      const result = router.selectModel(makeContext({
        userPlan: 'free',
        forceOpus: true, // free plan → forceOpus ignored
        conversationLength: 5,
      }));
      expect(result.model).toBe('claude-sonnet-4-5');
    });

    it('team plan users get default routing (no forceOpus)', () => {
      const result = router.selectModel(makeContext({
        userPlan: 'team',
        forceOpus: true,
        conversationLength: 5,
      }));
      expect(result.model).toBe('claude-sonnet-4-5');
    });
  });
});
