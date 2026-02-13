// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors

import { describe, it, expect } from 'vitest';
import { calculateConversationBudget } from './context-budget.js';
import type { ContextBudgetParams } from './context-budget.js';

describe('calculateConversationBudget', () => {
  const baseParams: ContextBudgetParams = {
    contextWindowSize: 200_000,
    systemPrompt: 'You are a helpful assistant.',
    userMessage: 'Install nginx',
    serverLabel: 'Server: web-01',
  };

  it('should return a large budget for a large context window model', () => {
    const result = calculateConversationBudget(baseParams);

    // 200K context - small prompt - 4096 output reserve = ~195K+
    expect(result.maxConversationTokens).toBeGreaterThan(100_000);
    expect(result.breakdown.contextWindow).toBe(200_000);
    expect(result.breakdown.reservedOutput).toBe(4096);
  });

  it('should return a smaller budget for Ollama small model (8K context)', () => {
    const result = calculateConversationBudget({
      ...baseParams,
      contextWindowSize: 8_192,
    });

    // 8192 - ~8 (system) - ~4 (user) - ~4 (label) - 4096 (output) - 10 (overhead) ≈ 4070
    expect(result.maxConversationTokens).toBeLessThan(5000);
    expect(result.maxConversationTokens).toBeGreaterThan(200); // at least MIN
    expect(result.breakdown.contextWindow).toBe(8_192);
  });

  it('should return MIN_CONVERSATION_TOKENS when budget is extremely tight', () => {
    const result = calculateConversationBudget({
      contextWindowSize: 4_096,
      // Large system prompt that eats most of the budget
      systemPrompt: 'x'.repeat(12000), // ~3000 tokens
      userMessage: 'y'.repeat(4000),   // ~1000 tokens
      serverLabel: 'Server: name',
    });

    // Budget would be negative, but clamped to 200
    expect(result.maxConversationTokens).toBe(200);
  });

  it('should account for large profile + knowledge context in system prompt', () => {
    const largeSystemPrompt = 'Base prompt. ' + 'Profile info. '.repeat(500) + 'Knowledge docs. '.repeat(300);
    const result = calculateConversationBudget({
      ...baseParams,
      contextWindowSize: 128_000,
      systemPrompt: largeSystemPrompt,
    });

    // Should deduct the large system prompt from the budget
    const smallPromptResult = calculateConversationBudget({
      ...baseParams,
      contextWindowSize: 128_000,
    });

    expect(result.maxConversationTokens).toBeLessThan(smallPromptResult.maxConversationTokens);
  });

  it('should respect custom reservedOutputTokens', () => {
    const defaultResult = calculateConversationBudget(baseParams);
    const largeReserve = calculateConversationBudget({
      ...baseParams,
      reservedOutputTokens: 8192,
    });

    expect(largeReserve.maxConversationTokens).toBeLessThan(defaultResult.maxConversationTokens);
    expect(defaultResult.maxConversationTokens - largeReserve.maxConversationTokens).toBe(8192 - 4096);
  });

  it('should include complete breakdown in the result', () => {
    const result = calculateConversationBudget(baseParams);

    expect(result.breakdown).toHaveProperty('contextWindow');
    expect(result.breakdown).toHaveProperty('systemPrompt');
    expect(result.breakdown).toHaveProperty('userMessage');
    expect(result.breakdown).toHaveProperty('serverLabel');
    expect(result.breakdown).toHaveProperty('reservedOutput');
    expect(result.breakdown).toHaveProperty('available');

    // Breakdown.available should match maxConversationTokens
    expect(result.breakdown.available).toBe(result.maxConversationTokens);
  });

  it('should handle empty system prompt', () => {
    const result = calculateConversationBudget({
      ...baseParams,
      systemPrompt: '',
    });

    expect(result.maxConversationTokens).toBeGreaterThan(0);
    expect(result.breakdown.systemPrompt).toBe(0);
  });

  it('should handle CJK text correctly (higher token density)', () => {
    const result = calculateConversationBudget({
      ...baseParams,
      // CJK text has ~1.5 chars per token (higher token count per char)
      systemPrompt: '你好世界'.repeat(100), // 400 CJK chars ≈ 267 tokens
      userMessage: '安装数据库',             // 5 CJK chars ≈ 4 tokens
    });

    expect(result.breakdown.systemPrompt).toBeGreaterThan(200); // More tokens for CJK
    expect(result.maxConversationTokens).toBeGreaterThan(0);
  });

  it('should produce consistent results for the same input', () => {
    const result1 = calculateConversationBudget(baseParams);
    const result2 = calculateConversationBudget(baseParams);

    expect(result1.maxConversationTokens).toBe(result2.maxConversationTokens);
    expect(result1.breakdown).toEqual(result2.breakdown);
  });

  // Regression test: Ollama llama2 (4K context) + large profile should not overflow
  it('should stay safe for Ollama llama2 (4K) with large profile', () => {
    const largeProfile = 'OS: Ubuntu 22.04\n' + 'Software: '.repeat(200);
    const systemPrompt = `Base system prompt.\n\n${largeProfile}\n\nKnowledge docs.`;

    const result = calculateConversationBudget({
      contextWindowSize: 4_096,
      systemPrompt,
      userMessage: 'Check disk space',
      serverLabel: 'Server: my-server',
    });

    // Even with tight budget, should not return negative
    expect(result.maxConversationTokens).toBeGreaterThanOrEqual(200);
  });
});
