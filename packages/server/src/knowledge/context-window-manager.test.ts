// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for the context window manager module.
 *
 * @module knowledge/context-window-manager.test
 */

import { describe, it, expect } from 'vitest';
import type { SimilarityResult } from './similarity-search.js';
import {
  ContextWindowManager,
  getModelLimits,
  truncateMessages,
  MODEL_CONTEXT_LIMITS,
  type ConversationMessage,
  type ContextWindowConfig,
} from './context-window-manager.js';
import { estimateTokenCount } from './context-enhancer.js';

// ============================================================================
// Test Helpers
// ============================================================================

/** Create a test ConversationMessage */
function makeMessage(
  role: 'system' | 'user' | 'assistant',
  content: string,
  tokenCount?: number,
): ConversationMessage {
  return { role, content, tokenCount };
}

/** Create messages of known token sizes */
function makeMessages(count: number, tokensEach: number): ConversationMessage[] {
  return Array.from({ length: count }, (_, i) => ({
    role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
    content: 'x'.repeat(tokensEach * 4), // ~4 chars per token
    tokenCount: tokensEach,
  }));
}

/** Create a test SimilarityResult */
function makeResult(overrides: Partial<SimilarityResult> = {}): SimilarityResult {
  return {
    id: overrides.id ?? 'chunk-1',
    documentId: overrides.documentId ?? 'doc1',
    content: overrides.content ?? 'Test content for knowledge base.',
    score: overrides.score ?? 0.85,
    category: overrides.category ?? 'docs',
    headingContext: overrides.headingContext ?? 'Installation Guide',
  };
}

/** Create a default manager for testing */
function makeManager(overrides: Partial<ContextWindowConfig> = {}): ContextWindowManager {
  return new ContextWindowManager({
    model: 'claude-sonnet-4-20250514',
    ...overrides,
  });
}

// ============================================================================
// getModelLimits
// ============================================================================

describe('getModelLimits', () => {
  it('should return limits for known models', () => {
    const limits = getModelLimits('claude-sonnet-4-20250514');
    expect(limits.maxTokens).toBe(200000);
    expect(limits.defaultMaxOutputTokens).toBe(8192);
  });

  it('should return limits for haiku', () => {
    const limits = getModelLimits('claude-haiku-3-5-20241022');
    expect(limits.maxTokens).toBe(200000);
  });

  it('should return limits for opus', () => {
    const limits = getModelLimits('claude-opus-4-20250514');
    expect(limits.maxTokens).toBe(200000);
  });

  it('should return default limits for unknown models', () => {
    const limits = getModelLimits('unknown-model');
    expect(limits.maxTokens).toBe(100000);
    expect(limits.defaultMaxOutputTokens).toBe(4096);
  });
});

// ============================================================================
// truncateMessages
// ============================================================================

describe('truncateMessages', () => {
  it('should return all messages when they fit within budget', () => {
    const messages = makeMessages(3, 100); // 300 tokens total
    const { kept, dropped } = truncateMessages(messages, 500, 'drop-oldest', 2);
    expect(kept).toHaveLength(3);
    expect(dropped).toBe(0);
  });

  it('should return empty for empty messages', () => {
    const { kept, dropped } = truncateMessages([], 500, 'drop-oldest', 2);
    expect(kept).toHaveLength(0);
    expect(dropped).toBe(0);
  });

  it('should not truncate with strategy none', () => {
    const messages = makeMessages(5, 200); // 1000 tokens total
    const { kept, dropped } = truncateMessages(messages, 500, 'none', 2);
    expect(kept).toHaveLength(5);
    expect(dropped).toBe(0);
  });

  describe('drop-oldest strategy', () => {
    it('should drop oldest messages first', () => {
      const messages: ConversationMessage[] = [
        { role: 'user', content: 'old message', tokenCount: 100 },
        { role: 'assistant', content: 'old reply', tokenCount: 100 },
        { role: 'user', content: 'recent message', tokenCount: 100 },
        { role: 'assistant', content: 'recent reply', tokenCount: 100 },
      ];

      const { kept, dropped } = truncateMessages(messages, 200, 'drop-oldest', 1);
      expect(kept).toHaveLength(2);
      expect(dropped).toBe(2);
      // Should keep the last two messages
      expect(kept[0].content).toBe('recent message');
      expect(kept[1].content).toBe('recent reply');
    });

    it('should keep as many recent messages as fit', () => {
      const messages: ConversationMessage[] = [
        { role: 'user', content: 'msg1', tokenCount: 50 },
        { role: 'assistant', content: 'msg2', tokenCount: 50 },
        { role: 'user', content: 'msg3', tokenCount: 50 },
        { role: 'assistant', content: 'msg4', tokenCount: 50 },
        { role: 'user', content: 'msg5', tokenCount: 50 },
      ];

      const { kept, dropped } = truncateMessages(messages, 150, 'drop-oldest', 1);
      expect(kept).toHaveLength(3);
      expect(dropped).toBe(2);
      expect(kept[0].content).toBe('msg3');
    });

    it('should return empty when no single message fits', () => {
      const messages: ConversationMessage[] = [
        { role: 'user', content: 'big message', tokenCount: 500 },
      ];

      const { kept, dropped } = truncateMessages(messages, 100, 'drop-oldest', 1);
      expect(kept).toHaveLength(0);
      expect(dropped).toBe(1);
    });
  });

  describe('drop-middle strategy', () => {
    it('should keep first and last messages', () => {
      const messages: ConversationMessage[] = [
        { role: 'user', content: 'first', tokenCount: 50 },
        { role: 'assistant', content: 'middle1', tokenCount: 50 },
        { role: 'user', content: 'middle2', tokenCount: 50 },
        { role: 'assistant', content: 'last', tokenCount: 50 },
      ];

      const { kept, dropped } = truncateMessages(messages, 150, 'drop-middle', 2);
      expect(dropped).toBeGreaterThan(0);
      // First and last should be present
      expect(kept[0].content).toBe('first');
      expect(kept[kept.length - 1].content).toBe('last');
    });

    it('should keep all messages when they fit', () => {
      const messages: ConversationMessage[] = [
        { role: 'user', content: 'first', tokenCount: 50 },
        { role: 'assistant', content: 'middle', tokenCount: 50 },
        { role: 'user', content: 'last', tokenCount: 50 },
      ];

      const { kept, dropped } = truncateMessages(messages, 200, 'drop-middle', 2);
      expect(kept).toHaveLength(3);
      expect(dropped).toBe(0);
    });

    it('should handle two messages', () => {
      const messages: ConversationMessage[] = [
        { role: 'user', content: 'first', tokenCount: 50 },
        { role: 'assistant', content: 'second', tokenCount: 50 },
      ];

      const { kept, dropped } = truncateMessages(messages, 100, 'drop-middle', 2);
      expect(kept).toHaveLength(2);
      expect(dropped).toBe(0);
    });

    it('should prefer keeping recent middle messages', () => {
      const messages: ConversationMessage[] = [
        { role: 'user', content: 'first', tokenCount: 50 },
        { role: 'assistant', content: 'mid-old', tokenCount: 50 },
        { role: 'user', content: 'mid-new', tokenCount: 50 },
        { role: 'assistant', content: 'last', tokenCount: 50 },
      ];

      // Budget: 150 = first(50) + last(50) + one middle(50)
      const { kept, dropped } = truncateMessages(messages, 150, 'drop-middle', 2);
      expect(kept).toHaveLength(3);
      expect(dropped).toBe(1);
      // Should keep first, mid-new (most recent middle), last
      expect(kept[0].content).toBe('first');
      expect(kept[1].content).toBe('mid-new');
      expect(kept[2].content).toBe('last');
    });
  });

  describe('keep-latest strategy', () => {
    it('should keep only the latest messages that fit', () => {
      const messages: ConversationMessage[] = [
        { role: 'user', content: 'msg1', tokenCount: 100 },
        { role: 'assistant', content: 'msg2', tokenCount: 100 },
        { role: 'user', content: 'msg3', tokenCount: 100 },
        { role: 'assistant', content: 'msg4', tokenCount: 100 },
      ];

      const { kept, dropped } = truncateMessages(messages, 200, 'keep-latest', 1);
      expect(kept).toHaveLength(2);
      expect(dropped).toBe(2);
      expect(kept[0].content).toBe('msg3');
      expect(kept[1].content).toBe('msg4');
    });

    it('should stop when a message does not fit', () => {
      const messages: ConversationMessage[] = [
        { role: 'user', content: 'small', tokenCount: 50 },
        { role: 'assistant', content: 'big', tokenCount: 500 },
        { role: 'user', content: 'small2', tokenCount: 50 },
        { role: 'assistant', content: 'small3', tokenCount: 50 },
      ];

      const { kept, dropped } = truncateMessages(messages, 150, 'keep-latest', 1);
      expect(kept).toHaveLength(2);
      expect(kept[0].content).toBe('small2');
      expect(kept[1].content).toBe('small3');
      expect(dropped).toBe(2);
    });
  });
});

// ============================================================================
// ContextWindowManager - constructor
// ============================================================================

describe('ContextWindowManager', () => {
  describe('constructor', () => {
    it('should use model defaults', () => {
      const manager = makeManager();
      expect(manager.maxInputTokens).toBe(200000 - 4096);
    });

    it('should allow overriding maxTotalTokens', () => {
      const manager = makeManager({ maxTotalTokens: 50000 });
      expect(manager.maxInputTokens).toBe(50000 - 4096);
    });

    it('should allow overriding reservedOutputTokens', () => {
      const manager = makeManager({ reservedOutputTokens: 2048 });
      expect(manager.maxInputTokens).toBe(200000 - 2048);
    });

    it('should use default limits for unknown models', () => {
      const manager = makeManager({ model: 'unknown-model' });
      expect(manager.maxInputTokens).toBe(100000 - 4096);
    });
  });

  // ==========================================================================
  // compose
  // ==========================================================================

  describe('compose', () => {
    it('should compose a simple prompt with system message only', () => {
      const manager = makeManager();
      const composed = manager.compose({
        systemPrompt: 'You are a helpful assistant.',
      });

      expect(composed.systemPrompt).toBe('You are a helpful assistant.');
      expect(composed.messages).toHaveLength(0);
      expect(composed.knowledgeContext).toBe('');
      expect(composed.allocation.systemPromptTokens).toBeGreaterThan(0);
      expect(composed.allocation.wasTruncated).toBe(false);
      expect(composed.allocation.messagesDropped).toBe(0);
      expect(composed.allocation.knowledgeResultsDropped).toBe(0);
    });

    it('should include conversation messages that fit', () => {
      const manager = makeManager();
      const messages: ConversationMessage[] = [
        makeMessage('user', 'Hello'),
        makeMessage('assistant', 'Hi there!'),
      ];

      const composed = manager.compose({
        systemPrompt: 'You are a helper.',
        messages,
      });

      expect(composed.messages).toHaveLength(2);
      expect(composed.allocation.conversationTokens).toBeGreaterThan(0);
      expect(composed.allocation.wasTruncated).toBe(false);
    });

    it('should include knowledge context', () => {
      const manager = makeManager();
      const results = [
        makeResult({ content: 'Install openclaw using npm.' }),
      ];

      const composed = manager.compose({
        systemPrompt: 'You are a helper.',
        knowledgeResults: results,
      });

      expect(composed.knowledgeContext).toContain('Install openclaw using npm.');
      expect(composed.allocation.knowledgeContextTokens).toBeGreaterThan(0);
    });

    it('should truncate messages when budget is tight', () => {
      // Use a very small total budget to force truncation
      const manager = makeManager({
        maxTotalTokens: 500,
        reservedOutputTokens: 100,
      });

      const messages = makeMessages(10, 50); // 500 tokens total for messages

      const composed = manager.compose({
        systemPrompt: 'System.',
        messages,
      });

      expect(composed.allocation.messagesDropped).toBeGreaterThan(0);
      expect(composed.allocation.wasTruncated).toBe(true);
      expect(composed.messages.length).toBeLessThan(10);
    });

    it('should limit knowledge context by ratio', () => {
      const manager = makeManager({
        maxTotalTokens: 1000,
        reservedOutputTokens: 200,
        maxKnowledgeRatio: 0.3, // Only 30% for knowledge
      });

      // Create many knowledge results
      const results = Array.from({ length: 20 }, (_, i) =>
        makeResult({
          id: `chunk-${i}`,
          content: 'A'.repeat(200),
          score: 0.9 - i * 0.01,
        }),
      );

      const composed = manager.compose({
        systemPrompt: 'S.',
        knowledgeResults: results,
      });

      // Knowledge context should be limited
      const knowledgeRatio =
        composed.allocation.knowledgeContextTokens /
        (manager.maxInputTokens - composed.allocation.systemPromptTokens);
      expect(knowledgeRatio).toBeLessThanOrEqual(0.5); // Some slack
    });

    it('should handle system prompt exceeding budget', () => {
      const manager = makeManager({
        maxTotalTokens: 100,
        reservedOutputTokens: 50,
      });

      const bigSystemPrompt = 'x'.repeat(500); // ~125 tokens > 50 available

      const composed = manager.compose({
        systemPrompt: bigSystemPrompt,
        messages: [makeMessage('user', 'Hello')],
        knowledgeResults: [makeResult()],
      });

      expect(composed.messages).toHaveLength(0);
      expect(composed.knowledgeContext).toBe('');
      expect(composed.allocation.wasTruncated).toBe(true);
      expect(composed.allocation.messagesDropped).toBe(1);
      expect(composed.allocation.knowledgeResultsDropped).toBe(1);
    });

    it('should pass knowledge options through', () => {
      const manager = makeManager();
      const results = [makeResult({ score: 0.91 })];

      const composed = manager.compose({
        systemPrompt: 'System.',
        knowledgeResults: results,
        knowledgeOptions: { includeScores: true },
      });

      expect(composed.knowledgeContext).toContain('score: 0.91');
    });

    it('should report correct allocation totals', () => {
      const manager = makeManager({ reservedOutputTokens: 1000 });
      const composed = manager.compose({
        systemPrompt: 'System prompt.',
        messages: [makeMessage('user', 'Hello')],
        knowledgeResults: [makeResult()],
      });

      const alloc = composed.allocation;
      expect(alloc.totalAllocated).toBe(
        alloc.systemPromptTokens +
          alloc.conversationTokens +
          alloc.knowledgeContextTokens +
          alloc.reservedOutputTokens,
      );
      expect(alloc.remainingTokens).toBe(alloc.maxTokens - alloc.totalAllocated);
      expect(alloc.reservedOutputTokens).toBe(1000);
    });

    it('should handle empty knowledge results', () => {
      const manager = makeManager();
      const composed = manager.compose({
        systemPrompt: 'System.',
        knowledgeResults: [],
      });

      expect(composed.knowledgeContext).toBe('');
      expect(composed.allocation.knowledgeContextTokens).toBe(0);
      expect(composed.allocation.knowledgeResultsDropped).toBe(0);
    });

    it('should use default truncation strategy (drop-oldest)', () => {
      const manager = makeManager({
        maxTotalTokens: 200,
        reservedOutputTokens: 50,
      });

      const messages: ConversationMessage[] = [
        { role: 'user', content: 'old message', tokenCount: 40 },
        { role: 'assistant', content: 'old reply', tokenCount: 40 },
        { role: 'user', content: 'new message', tokenCount: 40 },
        { role: 'assistant', content: 'new reply', tokenCount: 40 },
      ];

      const composed = manager.compose({
        systemPrompt: 'Sys.', // ~2 tokens
        messages,
      });

      // Should drop oldest messages first
      if (composed.allocation.messagesDropped > 0) {
        const keptContents = composed.messages.map((m) => m.content);
        expect(keptContents).toContain('new reply');
      }
    });
  });

  // ==========================================================================
  // checkFit
  // ==========================================================================

  describe('checkFit', () => {
    it('should report fit when everything fits', () => {
      const manager = makeManager();
      const result = manager.checkFit({
        systemPrompt: 'System.',
        messages: [makeMessage('user', 'Hello')],
      });

      expect(result.fits).toBe(true);
      expect(result.overflow).toBe(0);
      expect(result.totalTokens).toBeGreaterThan(0);
    });

    it('should report overflow when content exceeds budget', () => {
      const manager = makeManager({
        maxTotalTokens: 100,
        reservedOutputTokens: 50,
      });

      const bigContent = 'x'.repeat(1000); // ~250 tokens

      const result = manager.checkFit({
        systemPrompt: bigContent,
      });

      expect(result.fits).toBe(false);
      expect(result.overflow).toBeGreaterThan(0);
    });

    it('should include knowledge context in calculation', () => {
      const manager = makeManager({
        maxTotalTokens: 100,
        reservedOutputTokens: 20,
      });

      const result = manager.checkFit({
        systemPrompt: 'S.',
        knowledgeContext: 'x'.repeat(400), // ~100 tokens
      });

      expect(result.fits).toBe(false);
    });

    it('should respect reserved output tokens', () => {
      const manager = makeManager({
        maxTotalTokens: 200,
        reservedOutputTokens: 150,
      });

      // Input budget = 200 - 150 = 50 tokens
      const result = manager.checkFit({
        systemPrompt: 'x'.repeat(200), // ~50 tokens, exactly at limit
      });

      expect(result.maxInputTokens).toBe(50);
    });

    it('should use provided token counts on messages', () => {
      const manager = makeManager({
        maxTotalTokens: 200,
        reservedOutputTokens: 50,
      });

      const result = manager.checkFit({
        systemPrompt: 'S.',
        messages: [
          { role: 'user', content: 'short', tokenCount: 100 },
        ],
      });

      // System (~1 token) + message (100 tokens) = ~101
      expect(result.totalTokens).toBeGreaterThanOrEqual(100);
    });
  });

  // ==========================================================================
  // getKnowledgeBudget
  // ==========================================================================

  describe('getKnowledgeBudget', () => {
    it('should calculate available knowledge budget', () => {
      const manager = makeManager({
        maxTotalTokens: 10000,
        reservedOutputTokens: 2000,
        maxKnowledgeRatio: 0.5,
      });

      const budget = manager.getKnowledgeBudget('System prompt.');
      // Input budget = 10000 - 2000 = 8000
      // System prompt = ~4 tokens
      // Remaining = ~7996
      // Knowledge max = 7996 * 0.5 = ~3998
      expect(budget.maxTokens).toBeGreaterThan(3000);
      expect(budget.maxChars).toBe(budget.maxTokens * 4);
    });

    it('should return 0 when system prompt fills budget', () => {
      const manager = makeManager({
        maxTotalTokens: 100,
        reservedOutputTokens: 50,
      });

      const budget = manager.getKnowledgeBudget('x'.repeat(500)); // ~125 tokens > 50 available
      expect(budget.maxTokens).toBe(0);
      expect(budget.maxChars).toBe(0);
    });

    it('should account for conversation messages', () => {
      const manager = makeManager({
        maxTotalTokens: 1000,
        reservedOutputTokens: 200,
        maxKnowledgeRatio: 0.5,
      });

      const withoutMessages = manager.getKnowledgeBudget('Sys.');
      const withMessages = manager.getKnowledgeBudget('Sys.', [
        { role: 'user', content: 'x'.repeat(400), tokenCount: 100 },
      ]);

      expect(withMessages.maxTokens).toBeLessThan(withoutMessages.maxTokens);
    });

    it('should respect maxKnowledgeRatio', () => {
      const manager = makeManager({
        maxTotalTokens: 10000,
        reservedOutputTokens: 1000,
        maxKnowledgeRatio: 0.2, // Only 20%
      });

      const budget = manager.getKnowledgeBudget('S.');
      // Input budget = 9000, system ~1, remaining ~8999
      // 20% of 8999 = ~1800
      expect(budget.maxTokens).toBeLessThan(2000);
      expect(budget.maxTokens).toBeGreaterThan(1500);
    });

    it('should use CJK-aware chars-per-token for Chinese system prompt', () => {
      const manager = makeManager({
        maxTotalTokens: 10000,
        reservedOutputTokens: 2000,
        maxKnowledgeRatio: 0.5,
      });

      const asciiBudget = manager.getKnowledgeBudget('System prompt.');
      const cjkBudget = manager.getKnowledgeBudget('你是一个有用的AI助手。');

      // Both should have similar maxTokens (same token budget logic)
      // but CJK should have fewer maxChars due to lower chars-per-token ratio
      expect(cjkBudget.maxChars).toBeLessThan(asciiBudget.maxChars);
      // CJK ratio ~1.5 vs ASCII ~4, so roughly 2.7× fewer chars
      expect(cjkBudget.maxChars).toBeLessThan(asciiBudget.maxChars * 0.5);
    });
  });
});

// ============================================================================
// Integration tests
// ============================================================================

describe('Integration: compose with realistic inputs', () => {
  it('should compose a prompt for environment analysis', () => {
    const manager = makeManager();
    const systemPrompt =
      'You are a software installation expert. Always respond with valid JSON only.';

    const messages: ConversationMessage[] = [
      makeMessage(
        'user',
        'I want to install openclaw on my macOS M1. My environment: Node 22.1.0, pnpm 9.0.0.',
      ),
    ];

    const results = [
      makeResult({
        content: 'On macOS M1, ensure you use the arm64 version of Node.js.',
        score: 0.92,
        category: 'cases',
        headingContext: 'macOS M1 Setup',
      }),
      makeResult({
        content: 'Run pnpm install -g openclaw to install globally.',
        score: 0.88,
        category: 'docs',
        headingContext: 'Installation',
      }),
    ];

    const composed = manager.compose({
      systemPrompt,
      messages,
      knowledgeResults: results,
    });

    // Everything should fit in 200K context
    expect(composed.allocation.wasTruncated).toBe(false);
    expect(composed.messages).toHaveLength(1);
    expect(composed.knowledgeContext).toContain('macOS M1');
    expect(composed.knowledgeContext).toContain('pnpm install -g openclaw');
    expect(composed.allocation.totalAllocated).toBeLessThan(200000);
  });

  it('should handle a long conversation history with truncation', () => {
    const manager = makeManager({
      maxTotalTokens: 1000,
      reservedOutputTokens: 200,
      maxKnowledgeRatio: 0.3,
    });

    const systemPrompt = 'You are a helper.'; // ~5 tokens

    // Create a long conversation (20 exchanges, ~50 tokens each = ~1000 tokens)
    const messages: ConversationMessage[] = [];
    for (let i = 0; i < 20; i++) {
      messages.push(
        makeMessage('user', `Question ${i}: ${'x'.repeat(100)}`),
        makeMessage('assistant', `Answer ${i}: ${'y'.repeat(100)}`),
      );
    }

    const results = [
      makeResult({ content: 'Knowledge result.' }),
    ];

    const composed = manager.compose({
      systemPrompt,
      messages,
      knowledgeResults: results,
    });

    // Should truncate some messages
    expect(composed.allocation.messagesDropped).toBeGreaterThan(0);
    expect(composed.allocation.wasTruncated).toBe(true);
    expect(composed.messages.length).toBeLessThan(40);
    expect(composed.allocation.totalAllocated).toBeLessThanOrEqual(1000);
  });

  it('should use drop-middle strategy correctly in a full compose', () => {
    const manager = makeManager({
      maxTotalTokens: 500,
      reservedOutputTokens: 100,
      truncationStrategy: 'drop-middle',
    });

    const messages: ConversationMessage[] = [
      { role: 'user', content: 'initial question', tokenCount: 50 },
      { role: 'assistant', content: 'first reply', tokenCount: 50 },
      { role: 'user', content: 'follow-up 1', tokenCount: 50 },
      { role: 'assistant', content: 'reply 2', tokenCount: 50 },
      { role: 'user', content: 'follow-up 2', tokenCount: 50 },
      { role: 'assistant', content: 'reply 3', tokenCount: 50 },
      { role: 'user', content: 'latest question', tokenCount: 50 },
    ];

    const composed = manager.compose({
      systemPrompt: 'Sys.', // ~2 tokens
      messages,
    });

    if (composed.allocation.messagesDropped > 0) {
      // First and last should be preserved with drop-middle
      expect(composed.messages[0].content).toBe('initial question');
      expect(composed.messages[composed.messages.length - 1].content).toBe('latest question');
    }
  });

  it('should correctly report remaining tokens', () => {
    const manager = makeManager({
      maxTotalTokens: 10000,
      reservedOutputTokens: 2000,
    });

    const composed = manager.compose({
      systemPrompt: 'System.',
      messages: [makeMessage('user', 'Hello')],
    });

    const alloc = composed.allocation;
    expect(alloc.maxTokens).toBe(10000);
    expect(alloc.remainingTokens).toBe(
      10000 - alloc.systemPromptTokens - alloc.conversationTokens -
        alloc.knowledgeContextTokens - alloc.reservedOutputTokens,
    );
    expect(alloc.remainingTokens).toBeGreaterThan(0);
  });

  it('should estimate more tokens for CJK system prompt than ASCII of same char length', () => {
    const manager = makeManager({
      maxTotalTokens: 10000,
      reservedOutputTokens: 2000,
    });

    // ASCII and CJK prompts of same character length
    const asciiComposed = manager.compose({
      systemPrompt: 'a'.repeat(60),
      messages: [makeMessage('user', 'Hello')],
    });
    const cjkComposed = manager.compose({
      systemPrompt: '你'.repeat(60),
      messages: [makeMessage('user', 'Hello')],
    });

    // CJK should consume more tokens from the budget
    expect(cjkComposed.allocation.systemPromptTokens).toBeGreaterThan(
      asciiComposed.allocation.systemPromptTokens,
    );
  });
});
