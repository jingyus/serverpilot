// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for agentic chat message trimming and token estimation.
 *
 * Validates that:
 * 1. Token estimation is CJK-aware (not just ASCII chars/4)
 * 2. Message trimming recalculates totals (no cumulative drift)
 * 3. Chinese conversations are trimmed correctly under token budget
 */

import { describe, it, expect } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { trimMessagesIfNeeded, estimateMessagesTokens } from './agentic-chat.js';

function makeMessage(role: 'user' | 'assistant', content: string): Anthropic.MessageParam {
  return { role, content };
}

function makeLargeMessages(pairCount: number, contentSize = 1000): Anthropic.MessageParam[] {
  const messages: Anthropic.MessageParam[] = [
    makeMessage('user', 'Initial user question'),
  ];
  for (let i = 0; i < pairCount; i++) {
    messages.push(makeMessage('assistant', `Assistant reply ${i}: ${'a'.repeat(contentSize)}`));
    messages.push(makeMessage('user', `Tool result ${i}: ${'b'.repeat(contentSize)}`));
  }
  return messages;
}

function makeCjkMessages(pairCount: number, contentSize = 500): Anthropic.MessageParam[] {
  const messages: Anthropic.MessageParam[] = [
    makeMessage('user', '请帮我安装 Nginx 服务器'),
  ];
  for (let i = 0; i < pairCount; i++) {
    messages.push(makeMessage('assistant', `正在检查系统环境${'。'.repeat(contentSize)}`));
    messages.push(makeMessage('user', `命令执行结果${'测'.repeat(contentSize)}`));
  }
  return messages;
}

// ============================================================================
// estimateMessagesTokens — CJK awareness
// ============================================================================

describe('estimateMessagesTokens', () => {
  it('should estimate ASCII text at ~4 chars per token', () => {
    const messages = [makeMessage('user', 'a'.repeat(400))];
    const tokens = estimateMessagesTokens(messages);
    // 400 chars / 4 = 100 tokens
    expect(tokens).toBe(100);
  });

  it('should estimate pure CJK text at ~1.5 chars per token', () => {
    const messages = [makeMessage('user', '中'.repeat(150))];
    const tokens = estimateMessagesTokens(messages);
    // 150 chars / 1.5 = 100 tokens
    expect(tokens).toBe(100);
  });

  it('should estimate mixed CJK/ASCII text with weighted ratio', () => {
    // 50% CJK, 50% ASCII → weighted ratio ≈ (1.5*0.5 + 4*0.5) = 2.75
    const mixedText = '你好hello你好hello你好hello';
    const messages = [makeMessage('user', mixedText)];
    const tokens = estimateMessagesTokens(messages);
    // Should be higher than pure ASCII estimate (length/4)
    const naiveEstimate = Math.ceil(mixedText.length / 4);
    expect(tokens).toBeGreaterThan(naiveEstimate);
  });

  it('should give CJK text significantly more tokens than ASCII of same length', () => {
    const length = 1000;
    const asciiTokens = estimateMessagesTokens([makeMessage('user', 'a'.repeat(length))]);
    const cjkTokens = estimateMessagesTokens([makeMessage('user', '中'.repeat(length))]);
    // CJK should be ~2.67x more tokens than ASCII for same char count
    expect(cjkTokens / asciiTokens).toBeGreaterThan(2);
    expect(cjkTokens / asciiTokens).toBeLessThan(3);
  });

  it('should handle structured content blocks with text', () => {
    const messages: Anthropic.MessageParam[] = [
      {
        role: 'assistant',
        content: [
          { type: 'text' as const, text: '让我检查一下系统状态' },
          { type: 'tool_use' as const, id: 'tool-1', name: 'execute_command', input: { command: 'ls -la' } },
        ],
      },
    ];
    const tokens = estimateMessagesTokens(messages);
    expect(tokens).toBeGreaterThan(0);
  });

  it('should handle tool_result content blocks', () => {
    const messages: Anthropic.MessageParam[] = [
      {
        role: 'user',
        content: [
          { type: 'tool_result' as const, tool_use_id: 'tool-1', content: '文件列表：测试文件.txt\n日志文件.log' },
        ],
      },
    ];
    const tokens = estimateMessagesTokens(messages);
    expect(tokens).toBeGreaterThan(0);
  });

  it('should handle empty messages', () => {
    expect(estimateMessagesTokens([])).toBe(0);
  });

  it('should handle empty string content', () => {
    expect(estimateMessagesTokens([makeMessage('user', '')])).toBe(0);
  });

  it('should accumulate tokens across multiple messages', () => {
    const single = estimateMessagesTokens([makeMessage('user', 'a'.repeat(400))]);
    const double = estimateMessagesTokens([
      makeMessage('user', 'a'.repeat(400)),
      makeMessage('assistant', 'a'.repeat(400)),
    ]);
    expect(double).toBe(single * 2);
  });

  it('should estimate CJK messages within 2x of true token count', () => {
    // Real Claude tokenizer: 1 CJK char ≈ 1-2 tokens
    // Our estimate: 1.5 chars/token → 1000 chars = 667 tokens
    // Acceptable range: 333-1334 (within 2x of 667)
    const cjk1000 = '中'.repeat(1000);
    const tokens = estimateMessagesTokens([makeMessage('user', cjk1000)]);
    // Should be roughly 667 tokens (1000/1.5)
    expect(tokens).toBeGreaterThanOrEqual(500);
    expect(tokens).toBeLessThanOrEqual(1000);
  });
});

// ============================================================================
// trimMessagesIfNeeded — basic behavior
// ============================================================================

describe('trimMessagesIfNeeded', () => {
  it('should not trim when under token budget', () => {
    const messages = [
      makeMessage('user', 'Hello'),
      makeMessage('assistant', 'Hi'),
      makeMessage('user', 'Thanks'),
    ];
    trimMessagesIfNeeded(messages, 100000);
    expect(messages).toHaveLength(3);
  });

  it('should not trim when exactly 3 messages (minimum)', () => {
    const messages = [
      makeMessage('user', 'x'.repeat(10000)),
      makeMessage('assistant', 'y'.repeat(10000)),
      makeMessage('user', 'z'.repeat(10000)),
    ];
    // Even if over budget, don't trim below 3
    trimMessagesIfNeeded(messages, 1);
    expect(messages).toHaveLength(3);
  });

  it('should trim oldest pairs when over budget', () => {
    // 10 pairs × 1000 chars each side ≈ 20K chars ≈ 5000 tokens
    const messages = makeLargeMessages(10, 1000);
    expect(messages).toHaveLength(21); // 1 + 10*2

    trimMessagesIfNeeded(messages, 2000); // force significant trimming

    // Should have fewer messages
    expect(messages.length).toBeLessThan(21);
    // Should keep at least 3 (first user + one pair)
    expect(messages.length).toBeGreaterThanOrEqual(3);
    // First message should be preserved
    expect(messages[0].content).toBe('Initial user question');
    // Last messages should be the most recent pair
    const lastMsg = messages[messages.length - 1];
    expect(typeof lastMsg.content === 'string' && lastMsg.content).toContain('Tool result 9');
  });

  it('should preserve the first user message', () => {
    const messages = makeLargeMessages(5, 2000);
    trimMessagesIfNeeded(messages, 500);

    expect(messages[0].role).toBe('user');
    expect(messages[0].content).toBe('Initial user question');
  });

  it('should maintain alternating user/assistant structure', () => {
    const messages = makeLargeMessages(8, 500);
    trimMessagesIfNeeded(messages, 1000);

    // After the first user message, should alternate assistant/user
    for (let i = 1; i < messages.length; i++) {
      const expectedRole = i % 2 === 1 ? 'assistant' : 'user';
      expect(messages[i].role).toBe(expectedRole);
    }
  });

  it('should handle empty messages array', () => {
    const messages: Anthropic.MessageParam[] = [];
    trimMessagesIfNeeded(messages, 1000);
    expect(messages).toHaveLength(0);
  });

  it('should handle single message', () => {
    const messages = [makeMessage('user', 'Hello')];
    trimMessagesIfNeeded(messages, 1);
    expect(messages).toHaveLength(1);
  });

  it('should handle structured content blocks', () => {
    const messages: Anthropic.MessageParam[] = [
      makeMessage('user', 'Hello'),
      {
        role: 'assistant',
        content: [
          { type: 'text' as const, text: 'Let me check...' },
          { type: 'tool_use' as const, id: 'tool-1', name: 'execute_command', input: { command: 'ls' } },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result' as const, tool_use_id: 'tool-1', content: 'file1.txt\nfile2.txt' },
        ],
      },
      makeMessage('assistant', 'I found 2 files.'),
      makeMessage('user', 'Thanks'),
    ];

    // Should not crash with structured content
    trimMessagesIfNeeded(messages, 100000);
    expect(messages).toHaveLength(5);
  });
});

// ============================================================================
// trimMessagesIfNeeded — CJK scenarios
// ============================================================================

describe('trimMessagesIfNeeded — CJK conversations', () => {
  it('should trim CJK messages more aggressively than ASCII (same char count)', () => {
    // CJK text is ~2.67x more tokens per char, so same char budget
    // should result in more aggressive trimming
    const asciiMsgs = makeLargeMessages(10, 500);
    const cjkMsgs = makeCjkMessages(10, 500);

    const budget = 3000;
    trimMessagesIfNeeded(asciiMsgs, budget);
    trimMessagesIfNeeded(cjkMsgs, budget);

    // CJK should have fewer messages remaining (more trimmed)
    expect(cjkMsgs.length).toBeLessThanOrEqual(asciiMsgs.length);
  });

  it('should correctly trim 20+ turn Chinese conversation under 150K budget', () => {
    // Simulate a realistic 20-turn Chinese agentic conversation
    const messages: Anthropic.MessageParam[] = [
      makeMessage('user', '请帮我在服务器上安装并配置 Nginx 反向代理'),
    ];

    for (let i = 0; i < 20; i++) {
      messages.push({
        role: 'assistant',
        content: [
          { type: 'text' as const, text: `第${i + 1}步：正在执行系统检查${'。'.repeat(200)}` },
          { type: 'tool_use' as const, id: `tool-${i}`, name: 'execute_command', input: { command: `check-step-${i}` } },
        ],
      });
      messages.push({
        role: 'user',
        content: [
          { type: 'tool_result' as const, tool_use_id: `tool-${i}`, content: `步骤${i + 1}结果：${'测试输出数据'.repeat(100)}` },
        ],
      });
    }

    trimMessagesIfNeeded(messages, 150_000);

    // After trimming, the actual token count should be within budget
    const actualTokens = estimateMessagesTokens(messages);
    expect(actualTokens).toBeLessThanOrEqual(150_000);
    // First message preserved
    expect(messages[0].content).toBe('请帮我在服务器上安装并配置 Nginx 反向代理');
  });

  it('should produce consistent results (no cumulative drift)', () => {
    // Build messages, trim, measure. Then rebuild same messages and verify same result.
    const buildMessages = (): Anthropic.MessageParam[] => {
      const msgs = makeCjkMessages(15, 300);
      return msgs;
    };

    const msgs1 = buildMessages();
    const msgs2 = buildMessages();

    trimMessagesIfNeeded(msgs1, 5000);
    trimMessagesIfNeeded(msgs2, 5000);

    // Both should produce identical results
    expect(msgs1.length).toBe(msgs2.length);

    // And the final token count should match the fresh estimate
    const estimateAfterTrim = estimateMessagesTokens(msgs1);
    expect(estimateAfterTrim).toBeLessThanOrEqual(5000);
  });
});

// ============================================================================
// trimMessagesIfNeeded — recalculation vs accumulation accuracy
// ============================================================================

describe('trimMessagesIfNeeded — recalculation accuracy', () => {
  it('should keep messages under budget after trim (verified by fresh estimate)', () => {
    const messages = makeLargeMessages(15, 2000);
    const budget = 5000;

    trimMessagesIfNeeded(messages, budget);

    // Fresh recalculation should confirm we're under budget
    const freshEstimate = estimateMessagesTokens(messages);
    expect(freshEstimate).toBeLessThanOrEqual(budget);
  });

  it('should keep CJK messages under budget after trim (verified by fresh estimate)', () => {
    const messages = makeCjkMessages(15, 400);
    const budget = 5000;

    trimMessagesIfNeeded(messages, budget);

    const freshEstimate = estimateMessagesTokens(messages);
    expect(freshEstimate).toBeLessThanOrEqual(budget);
  });

  it('should handle mixed CJK/ASCII conversation trimming', () => {
    const messages: Anthropic.MessageParam[] = [
      makeMessage('user', '帮我检查 Nginx 配置'),
    ];

    for (let i = 0; i < 10; i++) {
      // Assistant replies in Chinese
      messages.push(makeMessage('assistant', `正在检查配置文件${'内容'.repeat(200)}`));
      // Tool results in ASCII (command output)
      messages.push(makeMessage('user', `server {\n  listen 80;\n  ${'location /api { proxy_pass http://localhost:3000; }\n  '.repeat(50)}\n}`));
    }

    const budget = 5000;
    trimMessagesIfNeeded(messages, budget);

    const freshEstimate = estimateMessagesTokens(messages);
    expect(freshEstimate).toBeLessThanOrEqual(budget);
    expect(messages[0].content).toBe('帮我检查 Nginx 配置');
  });
});
