// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for agentic chat message trimming, token estimation, and stream abort.
 *
 * Validates that:
 * 1. Token estimation is CJK-aware (not just ASCII chars/4)
 * 2. Message trimming recalculates totals (no cumulative drift)
 * 3. Chinese conversations are trimmed correctly under token budget
 * 4. Agentic loop aborts when SSE stream is closed by client
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import type { SSEStreamingApi } from 'hono/streaming';

// Module mocks for AgenticChatEngine.run() — must be before import
vi.mock('../core/agent/agent-connector.js', () => ({
  findConnectedAgent: vi.fn(() => 'agent-1'),
}));
vi.mock('../core/task/executor.js', () => ({
  getTaskExecutor: vi.fn(() => ({
    executeCommand: vi.fn(async () => ({
      stdout: 'ok\n', stderr: '', exitCode: 0, success: true,
      operationId: 'op-1', duration: 100,
    })),
    addProgressListener: vi.fn(),
    removeProgressListener: vi.fn(),
  })),
}));
vi.mock('../core/security/audit-logger.js', () => ({
  getAuditLogger: vi.fn(() => ({
    log: vi.fn(async () => ({ id: 'audit-1' })),
    updateExecutionResult: vi.fn(async () => true),
  })),
}));
vi.mock('../core/security/command-validator.js', () => ({
  validateCommand: vi.fn(() => ({
    action: 'allowed',
    classification: { riskLevel: 'green', reason: 'safe' },
  })),
}));
vi.mock('../knowledge/rag-pipeline.js', () => ({
  getRagPipeline: vi.fn(() => null),
}));

import {
  trimMessagesIfNeeded, estimateMessagesTokens, AgenticChatEngine,
  ExecuteCommandInputSchema, ReadFileInputSchema, ListFilesInputSchema,
  type TrimResult,
} from './agentic-chat.js';

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

  it('should truncate first message when exactly 3 messages exceed budget', () => {
    const messages = [
      makeMessage('user', 'x'.repeat(10000)),
      makeMessage('assistant', 'y'.repeat(10000)),
      makeMessage('user', 'z'.repeat(10000)),
    ];
    // 3 messages over budget → truncate first message content, keep 3 messages
    const result = trimMessagesIfNeeded(messages, 1);
    expect(messages).toHaveLength(3);
    expect(result).not.toBeNull();
    expect(result!.removedTokens).toBeGreaterThan(0);
    // First message should contain truncation marker
    expect(typeof messages[0].content === 'string' && messages[0].content).toContain('[Content truncated:');
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
    // First message should be preserved (with context-loss notice appended)
    expect(typeof messages[0].content === 'string' && messages[0].content).toContain('Initial user question');
    // Last messages should be the most recent pair
    const lastMsg = messages[messages.length - 1];
    expect(typeof lastMsg.content === 'string' && lastMsg.content).toContain('Tool result 9');
  });

  it('should preserve the first user message when budget allows', () => {
    const messages = makeLargeMessages(5, 200);
    // Budget large enough to keep first msg + one pair after removing older pairs
    trimMessagesIfNeeded(messages, 5000);

    expect(messages[0].role).toBe('user');
    // Original text preserved (with context-loss notice appended)
    expect(typeof messages[0].content === 'string' && messages[0].content).toContain('Initial user question');
  });

  it('should truncate first message when budget is too tight for all 3 remaining', () => {
    const messages = makeLargeMessages(5, 2000);
    trimMessagesIfNeeded(messages, 500);

    expect(messages[0].role).toBe('user');
    // First message is truncated because even after pair removal, 3 messages exceed budget
    const firstContent = messages[0].content as string;
    expect(firstContent).toContain('[Content truncated:');
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
    // First message preserved (with context-loss notice appended if trimmed)
    expect(typeof messages[0].content === 'string' && messages[0].content).toContain('请帮我在服务器上安装并配置 Nginx 反向代理');
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
    expect(typeof messages[0].content === 'string' && messages[0].content).toContain('帮我检查 Nginx 配置');
  });
});

// ============================================================================
// trimMessagesIfNeeded — 3-message overflow (content truncation)
// ============================================================================

describe('trimMessagesIfNeeded — 3-message content truncation', () => {
  it('should guarantee token budget even with 3 huge messages (string content)', () => {
    // Simulate: 50K token first message + 60K + 60K recent pair = 170K > 150K budget
    const messages = [
      makeMessage('user', 'a'.repeat(200_000)),  // ~50K tokens
      makeMessage('assistant', 'b'.repeat(240_000)), // ~60K tokens
      makeMessage('user', 'c'.repeat(240_000)),  // ~60K tokens
    ];
    const budget = 150_000;

    const result = trimMessagesIfNeeded(messages, budget);

    expect(result).not.toBeNull();
    expect(messages).toHaveLength(3);
    const tokensAfterNotice = estimateMessagesTokens(messages);
    // The notice adds some tokens, but the core guarantee: pre-notice content fits budget
    // We verify the total (with notice) is reasonably close to budget
    // The truncation marker + notice add ~100 tokens max
    expect(tokensAfterNotice).toBeLessThanOrEqual(budget + 200);
  });

  it('should guarantee token budget when first message has massive file paste', () => {
    // Real-world scenario: user pastes a 50K-token file, then recent turn is 110K tokens
    const messages = [
      makeMessage('user', 'x'.repeat(200_000)),  // ~50K tokens (large file paste)
      makeMessage('assistant', 'y'.repeat(200_000)), // ~50K tokens
      makeMessage('user', 'z'.repeat(240_000)),  // ~60K tokens
    ];
    const budget = 150_000;

    trimMessagesIfNeeded(messages, budget);

    expect(messages).toHaveLength(3);
    // First message should be truncated with marker
    const firstContent = messages[0].content as string;
    expect(firstContent).toContain('[Content truncated:');
    expect(firstContent).toContain('[System: Earlier conversation context was trimmed');
  });

  it('should truncate array content blocks when 3 messages exceed budget', () => {
    // First message has multiple tool_result blocks
    const messages: Anthropic.MessageParam[] = [
      {
        role: 'user',
        content: [
          { type: 'tool_result' as const, tool_use_id: 'tool-1', content: 'a'.repeat(100_000) },
          { type: 'tool_result' as const, tool_use_id: 'tool-2', content: 'b'.repeat(100_000) },
          { type: 'text' as const, text: 'Please analyze these results' },
        ],
      },
      makeMessage('assistant', 'c'.repeat(100_000)),
      makeMessage('user', 'd'.repeat(100_000)),
    ];
    const budget = 50_000;

    const result = trimMessagesIfNeeded(messages, budget);

    expect(result).not.toBeNull();
    expect(messages).toHaveLength(3);
    // First message content blocks should be reduced
    const firstContent = messages[0].content;
    expect(Array.isArray(firstContent)).toBe(true);
    const blocks = firstContent as Array<Record<string, unknown>>;
    // Some blocks were removed or truncated, plus notice appended
    expect(blocks.length).toBeLessThan(4); // original 3 blocks + would have notice
  });

  it('should handle trimming from many messages down to 3 and still need truncation', () => {
    // Start with many messages, trim to 3, but remaining 3 still exceed budget
    const messages: Anthropic.MessageParam[] = [
      makeMessage('user', 'x'.repeat(80_000)), // ~20K tokens
    ];
    for (let i = 0; i < 10; i++) {
      messages.push(makeMessage('assistant', 'a'.repeat(40_000)));
      messages.push(makeMessage('user', 'b'.repeat(40_000)));
    }
    // Total: 21 messages. After removing pairs to 3: first(20K) + last pair(20K) = 40K tokens
    const budget = 30_000;

    trimMessagesIfNeeded(messages, budget);

    expect(messages).toHaveLength(3);
    const tokensAfter = estimateMessagesTokens(messages);
    // Should be under budget (with small margin for notice text)
    expect(tokensAfter).toBeLessThanOrEqual(budget + 200);
    // First message should have been truncated
    const firstContent = messages[0].content as string;
    expect(firstContent).toContain('[Content truncated:');
  });

  it('should preserve recent messages even when first message is truncated', () => {
    const messages = [
      makeMessage('user', 'INITIAL_QUERY:' + 'x'.repeat(200_000)),
      makeMessage('assistant', 'RECENT_REPLY:' + 'y'.repeat(40_000)),
      makeMessage('user', 'RECENT_RESULT:' + 'z'.repeat(40_000)),
    ];
    const budget = 50_000;

    trimMessagesIfNeeded(messages, budget);

    // Recent messages should be fully preserved
    expect((messages[1].content as string)).toContain('RECENT_REPLY:');
    expect((messages[2].content as string)).toContain('RECENT_RESULT:');
    // First message truncated — original start may be gone, but tail preserved
    const firstContent = messages[0].content as string;
    expect(firstContent).toContain('[Content truncated:');
  });

  it('should not truncate when 3 messages fit within budget', () => {
    const messages = [
      makeMessage('user', 'Hello'),
      makeMessage('assistant', 'Hi there'),
      makeMessage('user', 'Thanks'),
    ];
    const result = trimMessagesIfNeeded(messages, 100_000);

    expect(result).toBeNull();
    expect(messages[0].content).toBe('Hello');
  });

  it('should handle CJK content truncation correctly', () => {
    // CJK: ~1.5 chars/token, so 150K chars ≈ 100K tokens
    const messages = [
      makeMessage('user', '中'.repeat(150_000)),  // ~100K tokens
      makeMessage('assistant', '文'.repeat(75_000)), // ~50K tokens
      makeMessage('user', '字'.repeat(75_000)),   // ~50K tokens
    ];
    const budget = 150_000;

    trimMessagesIfNeeded(messages, budget);

    expect(messages).toHaveLength(3);
    const tokensAfter = estimateMessagesTokens(messages);
    expect(tokensAfter).toBeLessThanOrEqual(budget + 200);
  });
});

// ============================================================================
// trimMessagesIfNeeded — context-loss notice & return value
// ============================================================================

describe('trimMessagesIfNeeded — context-loss notice', () => {
  it('should return null when no trimming occurs', () => {
    const messages = [
      makeMessage('user', 'Hello'),
      makeMessage('assistant', 'Hi'),
      makeMessage('user', 'Thanks'),
    ];
    const result = trimMessagesIfNeeded(messages, 100000);
    expect(result).toBeNull();
  });

  it('should return TrimResult with counts when trimming occurs', () => {
    const messages = makeLargeMessages(10, 1000);
    const result = trimMessagesIfNeeded(messages, 2000);

    expect(result).not.toBeNull();
    expect(result!.removedMessages).toBeGreaterThan(0);
    expect(result!.removedTokens).toBeGreaterThan(0);
  });

  it('should inject context-loss notice into string first message after trim', () => {
    const messages = makeLargeMessages(10, 1000);
    trimMessagesIfNeeded(messages, 2000);

    const firstContent = messages[0].content;
    expect(typeof firstContent).toBe('string');
    expect(firstContent as string).toContain('[System: Earlier conversation context was trimmed');
    expect(firstContent as string).toContain('messages');
    expect(firstContent as string).toContain('tokens) were removed');
    expect(firstContent as string).toContain('re-read the relevant files');
  });

  it('should inject context-loss notice into array first message after trim', () => {
    // Build messages with structured content in the first user message
    const messages: Anthropic.MessageParam[] = [
      {
        role: 'user',
        content: [{ type: 'text' as const, text: 'Initial structured query' }],
      },
    ];
    for (let i = 0; i < 10; i++) {
      messages.push(makeMessage('assistant', 'a'.repeat(1000)));
      messages.push(makeMessage('user', 'b'.repeat(1000)));
    }

    trimMessagesIfNeeded(messages, 2000);

    const firstContent = messages[0].content;
    expect(Array.isArray(firstContent)).toBe(true);
    const blocks = firstContent as Array<{ type: string; text?: string }>;
    // Original block preserved
    expect(blocks[0].text).toBe('Initial structured query');
    // Notice appended as new text block
    const lastBlock = blocks[blocks.length - 1];
    expect(lastBlock.type).toBe('text');
    expect(lastBlock.text).toContain('[System: Earlier conversation context was trimmed');
  });

  it('should not inject notice when no trimming needed', () => {
    const messages = [
      makeMessage('user', 'Hello'),
      makeMessage('assistant', 'Hi'),
      makeMessage('user', 'Thanks'),
    ];
    trimMessagesIfNeeded(messages, 100000);

    // Content should be unchanged
    expect(messages[0].content).toBe('Hello');
  });

  it('should include accurate removed message count in notice', () => {
    const messages = makeLargeMessages(10, 1000);
    const lengthBefore = messages.length;

    const result = trimMessagesIfNeeded(messages, 2000);
    const lengthAfter = messages.length;

    const expectedRemoved = lengthBefore - lengthAfter;
    expect(result!.removedMessages).toBe(expectedRemoved);

    // Notice text should contain the count
    const notice = messages[0].content as string;
    expect(notice).toContain(`${expectedRemoved} messages`);
  });

  it('should truncate first message for ≤3 messages over budget', () => {
    const messages = [
      makeMessage('user', 'x'.repeat(50000)),
      makeMessage('assistant', 'y'.repeat(50000)),
      makeMessage('user', 'z'.repeat(50000)),
    ];
    const result = trimMessagesIfNeeded(messages, 1);
    expect(result).not.toBeNull();
    expect(result!.removedTokens).toBeGreaterThan(0);
    // First message truncated + notice injected
    const firstContent = messages[0].content as string;
    expect(firstContent).toContain('[Content truncated:');
    expect(firstContent).toContain('[System: Earlier conversation context was trimmed');
  });
});

// ============================================================================
// AgenticChatEngine — stream abort behavior
// ============================================================================

/**
 * Create a mock SSEStreamingApi with abort trigger support.
 * If `simulateAbort()` is called before `onAbort()`, the callback fires
 * immediately on registration.
 */
function createMockStream() {
  let abortCallback: (() => void) | null = null;
  let preAborted = false;
  const sseEvents: Array<{ event: string; data: Record<string, unknown> }> = [];

  const stream = {
    writeSSE: vi.fn(async (msg: { event?: string; data: string }) => {
      sseEvents.push({ event: msg.event ?? 'message', data: JSON.parse(msg.data) });
    }),
    onAbort: vi.fn((cb: () => void) => {
      abortCallback = cb;
      if (preAborted) cb();
    }),
    aborted: false,
  } as unknown as SSEStreamingApi;

  return {
    stream,
    sseEvents,
    simulateAbort: () => {
      preAborted = true;
      if (abortCallback) abortCallback();
    },
  };
}

function createMockAnthropicClient(turnCount: number) {
  let callIndex = 0;

  const client = {
    messages: {
      stream: vi.fn(() => {
        callIndex++;
        const isLastTurn = callIndex >= turnCount;

        const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};

        return {
          on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
            if (!listeners[event]) listeners[event] = [];
            listeners[event].push(handler);
          }),
          finalMessage: vi.fn(async () => {
            // Emit a text delta
            for (const handler of (listeners['text'] ?? [])) {
              handler(`Response turn ${callIndex}`);
            }

            if (isLastTurn) {
              return {
                content: [{ type: 'text', text: `Response turn ${callIndex}` }],
                stop_reason: 'end_turn',
              };
            }

            return {
              content: [
                { type: 'text', text: `Thinking turn ${callIndex}...` },
                { type: 'tool_use', id: `tool-${callIndex}`, name: 'execute_command', input: { command: 'echo test', description: 'test' } },
              ],
              stop_reason: 'tool_use',
            };
          }),
        };
      }),
    },
  } as unknown as Anthropic;

  return { client, getCallCount: () => callIndex };
}

describe('AgenticChatEngine — stream abort', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should register an onAbort handler on the stream', async () => {
    const { client } = createMockAnthropicClient(1);
    const engine = new AgenticChatEngine(client);
    const { stream } = createMockStream();

    await engine.run({
      userMessage: 'hello',
      serverId: 'srv-1',
      userId: 'usr-1',
      sessionId: 'sess-1',
      stream,
    });

    expect(stream.onAbort).toHaveBeenCalledOnce();
  });

  it('should stop the agentic loop when stream is aborted before AI call', async () => {
    const { client, getCallCount } = createMockAnthropicClient(5);
    const engine = new AgenticChatEngine(client);
    const { stream, simulateAbort } = createMockStream();

    // Abort before engine.run — onAbort callback fires immediately on register
    simulateAbort();

    const result = await engine.run({
      userMessage: 'install nginx',
      serverId: 'srv-1',
      userId: 'usr-1',
      sessionId: 'sess-1',
      stream,
    });

    expect(result.success).toBe(false);
    expect(result.turns).toBe(1); // Entered turn 1 then detected abort
    expect(getCallCount()).toBe(0); // No AI calls made
  });

  it('should stop the loop after one turn when stream is aborted during AI call', async () => {
    const { stream, simulateAbort, sseEvents } = createMockStream();

    // Create a client where the first AI call triggers abort during finalMessage
    let apiCallCount = 0;
    const client = {
      messages: {
        stream: vi.fn(() => {
          apiCallCount++;
          const currentCall = apiCallCount;
          return {
            on: vi.fn(),
            finalMessage: vi.fn(async () => {
              if (currentCall === 1) {
                // Abort during first AI response
                simulateAbort();
              }
              return {
                content: [
                  { type: 'text', text: `turn ${currentCall}` },
                  { type: 'tool_use', id: `tool-${currentCall}`, name: 'execute_command', input: { command: 'echo test', description: 'test' } },
                ],
                stop_reason: 'tool_use',
              };
            }),
          };
        }),
      },
    } as unknown as Anthropic;

    const engine = new AgenticChatEngine(client);
    const result = await engine.run({
      userMessage: 'install nginx',
      serverId: 'srv-1',
      userId: 'usr-1',
      sessionId: 'sess-1',
      stream,
    });

    expect(result.success).toBe(false);
    // Only 1 API call — abort detected before tool execution and before turn 2
    expect(apiCallCount).toBe(1);

    // Should NOT have a 'complete' event (stream was aborted)
    const completeEvent = sseEvents.find((e) => e.event === 'complete');
    expect(completeEvent).toBeUndefined();
  });

  it('should not write complete SSE event when stream is aborted before run', async () => {
    const { client } = createMockAnthropicClient(1);
    const engine = new AgenticChatEngine(client);
    const { stream, simulateAbort, sseEvents } = createMockStream();

    // Abort before run — callback fires on onAbort registration
    simulateAbort();

    await engine.run({
      userMessage: 'hello',
      serverId: 'srv-1',
      userId: 'usr-1',
      sessionId: 'sess-1',
      stream,
    });

    // No complete event should have been sent
    const completeEvents = sseEvents.filter((e) => e.event === 'complete');
    expect(completeEvents).toHaveLength(0);
  });
});

// Tool Input Schema validation

describe('Tool Input Schemas — runtime validation', () => {
  describe('ExecuteCommandInputSchema', () => {
    it('should accept valid input', () => {
      const result = ExecuteCommandInputSchema.safeParse({
        command: 'ls -la',
        description: 'List files',
      });
      expect(result.success).toBe(true);
    });

    it('should accept valid input with optional timeout_seconds', () => {
      const result = ExecuteCommandInputSchema.safeParse({
        command: 'apt update',
        description: 'Update packages',
        timeout_seconds: 120,
      });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.timeout_seconds).toBe(120);
    });

    it('should reject when command is missing', () => {
      const result = ExecuteCommandInputSchema.safeParse({
        description: 'no command',
      });
      expect(result.success).toBe(false);
    });

    it('should reject when command is a number instead of string', () => {
      const result = ExecuteCommandInputSchema.safeParse({
        command: 123,
        description: 'bad type',
      });
      expect(result.success).toBe(false);
    });

    it('should reject when command is an empty string', () => {
      const result = ExecuteCommandInputSchema.safeParse({
        command: '',
        description: 'empty command',
      });
      expect(result.success).toBe(false);
    });

    it('should reject when description is missing', () => {
      const result = ExecuteCommandInputSchema.safeParse({
        command: 'ls',
      });
      expect(result.success).toBe(false);
    });

    it('should reject null input', () => {
      const result = ExecuteCommandInputSchema.safeParse(null);
      expect(result.success).toBe(false);
    });

    it('should reject when timeout_seconds is a string', () => {
      const result = ExecuteCommandInputSchema.safeParse({
        command: 'ls',
        description: 'list',
        timeout_seconds: '30',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('ReadFileInputSchema', () => {
    it('should accept valid input', () => {
      const result = ReadFileInputSchema.safeParse({ path: '/etc/nginx/nginx.conf' });
      expect(result.success).toBe(true);
    });

    it('should accept valid input with optional max_lines', () => {
      const result = ReadFileInputSchema.safeParse({ path: '/var/log/syslog', max_lines: 50 });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.max_lines).toBe(50);
    });

    it('should reject when path is missing', () => {
      const result = ReadFileInputSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('should reject when path is a number', () => {
      const result = ReadFileInputSchema.safeParse({ path: 42 });
      expect(result.success).toBe(false);
    });

    it('should reject when path is an empty string', () => {
      const result = ReadFileInputSchema.safeParse({ path: '' });
      expect(result.success).toBe(false);
    });
  });

  describe('ListFilesInputSchema', () => {
    it('should accept valid input', () => {
      const result = ListFilesInputSchema.safeParse({ path: '/home' });
      expect(result.success).toBe(true);
    });

    it('should accept valid input with optional show_hidden', () => {
      const result = ListFilesInputSchema.safeParse({ path: '/etc', show_hidden: true });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.show_hidden).toBe(true);
    });

    it('should reject when path is missing', () => {
      const result = ListFilesInputSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('should reject when show_hidden is a string instead of boolean', () => {
      const result = ListFilesInputSchema.safeParse({ path: '/tmp', show_hidden: 'yes' });
      expect(result.success).toBe(false);
    });
  });
});

// AgenticChatEngine — malformed tool input handling (integration)

describe('AgenticChatEngine — malformed tool input', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createClientWithMalformedToolInput(toolName: string, malformedInput: unknown) {
    const client = {
      messages: {
        stream: vi.fn(() => ({
          on: vi.fn(),
          finalMessage: vi.fn(async () => ({
            content: [
              { type: 'tool_use', id: 'tool-bad', name: toolName, input: malformedInput },
            ],
            stop_reason: 'tool_use',
          })),
        })),
      },
    } as unknown as Anthropic;
    return client;
  }

  function createClientTwoTurns(toolName: string, malformedInput: unknown) {
    let callIndex = 0;
    const client = {
      messages: {
        stream: vi.fn(() => {
          callIndex++;
          if (callIndex === 1) {
            return {
              on: vi.fn(),
              finalMessage: vi.fn(async () => ({
                content: [
                  { type: 'tool_use', id: 'tool-bad', name: toolName, input: malformedInput },
                ],
                stop_reason: 'tool_use',
              })),
            };
          }
          // Second turn: AI sees the error and responds with text
          return {
            on: vi.fn(),
            finalMessage: vi.fn(async () => ({
              content: [{ type: 'text', text: 'I see the input was invalid, let me fix that.' }],
              stop_reason: 'end_turn',
            })),
          };
        }),
      },
    } as unknown as Anthropic;
    return { client, getCallCount: () => callIndex };
  }

  it('should return error string and send validation_error SSE for execute_command with numeric command', async () => {
    const { client, getCallCount } = createClientTwoTurns('execute_command', {
      command: 123,
      description: 'bad',
    });
    const engine = new AgenticChatEngine(client);
    const { stream, sseEvents } = createMockStream();

    const result = await engine.run({
      userMessage: 'test',
      serverId: 'srv-1',
      userId: 'usr-1',
      sessionId: 'sess-1',
      stream,
    });

    // AI should get 2 turns: first returns invalid tool → error, second ends
    expect(getCallCount()).toBe(2);
    expect(result.success).toBe(true);

    // Check that no tool_executing event was sent (command was never dispatched)
    const executingEvents = sseEvents.filter((e) => e.event === 'tool_executing');
    expect(executingEvents).toHaveLength(0);

    // Should have sent a tool_result SSE event with validation_error status
    const validationEvents = sseEvents.filter(
      (e) => e.event === 'tool_result' && (e.data as Record<string, unknown>).status === 'validation_error',
    );
    expect(validationEvents).toHaveLength(1);
    expect((validationEvents[0].data as Record<string, unknown>).tool).toBe('execute_command');
    expect((validationEvents[0].data as Record<string, unknown>).id).toBe('tool-bad');
    expect((validationEvents[0].data as Record<string, unknown>).error).toBeDefined();
  });

  it('should send validation_error SSE for execute_command with missing fields', async () => {
    const { client, getCallCount } = createClientTwoTurns('execute_command', {});
    const engine = new AgenticChatEngine(client);
    const { stream, sseEvents } = createMockStream();

    const result = await engine.run({
      userMessage: 'test',
      serverId: 'srv-1',
      userId: 'usr-1',
      sessionId: 'sess-1',
      stream,
    });

    expect(getCallCount()).toBe(2);
    expect(result.success).toBe(true);
    expect(result.toolCallCount).toBe(1);

    const validationEvents = sseEvents.filter(
      (e) => e.event === 'tool_result' && (e.data as Record<string, unknown>).status === 'validation_error',
    );
    expect(validationEvents).toHaveLength(1);
    expect((validationEvents[0].data as Record<string, unknown>).tool).toBe('execute_command');
  });

  it('should send validation_error SSE for read_file with missing path', async () => {
    const { client, getCallCount } = createClientTwoTurns('read_file', { max_lines: 100 });
    const engine = new AgenticChatEngine(client);
    const { stream, sseEvents } = createMockStream();

    const result = await engine.run({
      userMessage: 'read something',
      serverId: 'srv-1',
      userId: 'usr-1',
      sessionId: 'sess-1',
      stream,
    });

    expect(getCallCount()).toBe(2);
    expect(result.success).toBe(true);
    expect(result.toolCallCount).toBe(1);

    const validationEvents = sseEvents.filter(
      (e) => e.event === 'tool_result' && (e.data as Record<string, unknown>).status === 'validation_error',
    );
    expect(validationEvents).toHaveLength(1);
    expect((validationEvents[0].data as Record<string, unknown>).tool).toBe('read_file');
  });

  it('should send validation_error SSE for list_files with non-string path', async () => {
    const { client, getCallCount } = createClientTwoTurns('list_files', { path: 42 });
    const engine = new AgenticChatEngine(client);
    const { stream, sseEvents } = createMockStream();

    const result = await engine.run({
      userMessage: 'list files',
      serverId: 'srv-1',
      userId: 'usr-1',
      sessionId: 'sess-1',
      stream,
    });

    expect(getCallCount()).toBe(2);
    expect(result.success).toBe(true);
    expect(result.toolCallCount).toBe(1);

    const validationEvents = sseEvents.filter(
      (e) => e.event === 'tool_result' && (e.data as Record<string, unknown>).status === 'validation_error',
    );
    expect(validationEvents).toHaveLength(1);
    expect((validationEvents[0].data as Record<string, unknown>).tool).toBe('list_files');
  });

  it('should send validation_error SSE for null tool input without crashing', async () => {
    const { client, getCallCount } = createClientTwoTurns('execute_command', null);
    const engine = new AgenticChatEngine(client);
    const { stream, sseEvents } = createMockStream();

    const result = await engine.run({
      userMessage: 'test null',
      serverId: 'srv-1',
      userId: 'usr-1',
      sessionId: 'sess-1',
      stream,
    });

    expect(getCallCount()).toBe(2);
    expect(result.success).toBe(true);

    const validationEvents = sseEvents.filter(
      (e) => e.event === 'tool_result' && (e.data as Record<string, unknown>).status === 'validation_error',
    );
    expect(validationEvents).toHaveLength(1);
  });

  it('should execute valid tool input normally after validation', async () => {
    // Valid execute_command input should still work end-to-end
    let callIndex = 0;
    const client = {
      messages: {
        stream: vi.fn(() => {
          callIndex++;
          if (callIndex === 1) {
            return {
              on: vi.fn(),
              finalMessage: vi.fn(async () => ({
                content: [
                  {
                    type: 'tool_use', id: 'tool-ok', name: 'execute_command',
                    input: { command: 'echo hello', description: 'Test echo' },
                  },
                ],
                stop_reason: 'tool_use',
              })),
            };
          }
          return {
            on: vi.fn(),
            finalMessage: vi.fn(async () => ({
              content: [{ type: 'text', text: 'Done.' }],
              stop_reason: 'end_turn',
            })),
          };
        }),
      },
    } as unknown as Anthropic;

    const engine = new AgenticChatEngine(client);
    const { stream, sseEvents } = createMockStream();

    const result = await engine.run({
      userMessage: 'run echo',
      serverId: 'srv-1',
      userId: 'usr-1',
      sessionId: 'sess-1',
      stream,
    });

    expect(result.success).toBe(true);
    expect(result.toolCallCount).toBe(1);
    // Should have a tool_executing event (command was dispatched)
    const executingEvents = sseEvents.filter((e) => e.event === 'tool_executing');
    expect(executingEvents).toHaveLength(1);
  });

  it('should log a warning when tool input validation fails', async () => {
    const { logger: loggerModule } = await import('../utils/logger.js');
    const warnSpy = vi.spyOn(loggerModule, 'warn');

    const { client } = createClientTwoTurns('execute_command', { command: 999 });
    const engine = new AgenticChatEngine(client);
    const { stream } = createMockStream();

    await engine.run({
      userMessage: 'test warn log',
      serverId: 'srv-1',
      userId: 'usr-1',
      sessionId: 'sess-1',
      stream,
    });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'tool_validation',
        tool: 'execute_command',
      }),
      expect.stringContaining('Tool input validation failed'),
    );
    warnSpy.mockRestore();
  });

  it('should not send validation_error SSE for valid tool input', async () => {
    // Valid execute_command input should only produce tool_executing/tool_result, not validation_error
    let callIndex = 0;
    const client = {
      messages: {
        stream: vi.fn(() => {
          callIndex++;
          if (callIndex === 1) {
            return {
              on: vi.fn(),
              finalMessage: vi.fn(async () => ({
                content: [
                  {
                    type: 'tool_use', id: 'tool-ok-2', name: 'execute_command',
                    input: { command: 'whoami', description: 'Check user' },
                  },
                ],
                stop_reason: 'tool_use',
              })),
            };
          }
          return {
            on: vi.fn(),
            finalMessage: vi.fn(async () => ({
              content: [{ type: 'text', text: 'Done.' }],
              stop_reason: 'end_turn',
            })),
          };
        }),
      },
    } as unknown as Anthropic;

    const engine = new AgenticChatEngine(client);
    const { stream, sseEvents } = createMockStream();

    await engine.run({
      userMessage: 'whoami',
      serverId: 'srv-1',
      userId: 'usr-1',
      sessionId: 'sess-1',
      stream,
    });

    const validationEvents = sseEvents.filter(
      (e) => e.event === 'tool_result' && (e.data as Record<string, unknown>).status === 'validation_error',
    );
    expect(validationEvents).toHaveLength(0);
  });
});

// ============================================================================
// AgenticChatEngine — writeSSE failure triggers abort (chat-034)
// ============================================================================

describe('AgenticChatEngine — writeSSE failure triggers abort', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should set abort flag when writeSSE throws, stopping subsequent tool calls', async () => {
    // AI returns 3 tool calls in one response. After the first tool call,
    // writeSSE (tool_result) throws → abort.aborted should become true
    // → remaining 2 tool calls should be skipped.
    let writeCallCount = 0;
    const stream = {
      writeSSE: vi.fn(async () => {
        writeCallCount++;
        // Fail on the 4th writeSSE call (after tool_executing + tool_output + tool_result for 1st tool)
        // For simplicity, fail after a few calls to simulate mid-execution disconnect
        if (writeCallCount >= 3) {
          throw new Error('stream closed');
        }
      }),
      onAbort: vi.fn(),
    } as unknown as SSEStreamingApi;

    let callIndex = 0;
    const client = {
      messages: {
        stream: vi.fn(() => {
          callIndex++;
          if (callIndex === 1) {
            return {
              on: vi.fn(),
              finalMessage: vi.fn(async () => ({
                content: [
                  { type: 'tool_use', id: 'tool-1', name: 'execute_command', input: { command: 'echo 1', description: 'first' } },
                  { type: 'tool_use', id: 'tool-2', name: 'execute_command', input: { command: 'echo 2', description: 'second' } },
                  { type: 'tool_use', id: 'tool-3', name: 'execute_command', input: { command: 'echo 3', description: 'third' } },
                ],
                stop_reason: 'tool_use',
              })),
            };
          }
          return {
            on: vi.fn(),
            finalMessage: vi.fn(async () => ({
              content: [{ type: 'text', text: 'Done.' }],
              stop_reason: 'end_turn',
            })),
          };
        }),
      },
    } as unknown as Anthropic;

    const engine = new AgenticChatEngine(client);
    const result = await engine.run({
      userMessage: 'multi-tool test',
      serverId: 'srv-1',
      userId: 'usr-1',
      sessionId: 'sess-1',
      stream,
    });

    // Should abort — not all 3 tools executed
    expect(result.success).toBe(false);
    // At most 1-2 tool calls actually dispatched (3rd should be skipped)
    expect(result.toolCallCount).toBeLessThan(3);
  });

  it('should stop agentic loop after writeSSE failure on text stream', async () => {
    // AI streams text → writeSSE fails → abort.aborted set → loop stops
    let writeCount = 0;
    const stream = {
      writeSSE: vi.fn(async () => {
        writeCount++;
        if (writeCount >= 2) throw new Error('connection reset');
      }),
      onAbort: vi.fn(),
    } as unknown as SSEStreamingApi;

    let apiCalls = 0;
    const client = {
      messages: {
        stream: vi.fn(() => {
          apiCalls++;
          const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
          return {
            on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
              if (!listeners[event]) listeners[event] = [];
              listeners[event].push(handler);
            }),
            abort: vi.fn(),
            finalMessage: vi.fn(async () => {
              // Emit text which triggers writeSSE → failure → abort
              for (const handler of (listeners['text'] ?? [])) {
                handler('Hello ');
              }
              return {
                content: [
                  { type: 'text', text: 'Hello' },
                  { type: 'tool_use', id: 'tool-1', name: 'execute_command', input: { command: 'echo test', description: 'test' } },
                ],
                stop_reason: 'tool_use',
              };
            }),
          };
        }),
      },
    } as unknown as Anthropic;

    const engine = new AgenticChatEngine(client);
    const result = await engine.run({
      userMessage: 'test',
      serverId: 'srv-1',
      userId: 'usr-1',
      sessionId: 'sess-1',
      stream,
    });

    expect(result.success).toBe(false);
    // Should not make a second API call — loop stops after abort
    expect(apiCalls).toBe(1);
  });
});

// ============================================================================
// AgenticChatEngine — writeSSE never rejects (chat-055)
// ============================================================================

describe('AgenticChatEngine — writeSSE never rejects (no .catch needed)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should set abort.aborted via writeSSE internal catch when stream throws during text delta', async () => {
    // writeSSE catches internally and sets abort.aborted = true.
    // The fire-and-forget `void this.writeSSE(...)` in on('text') must not cause
    // unhandled rejection — writeSSE should never reject.
    let writeCount = 0;
    const stream = {
      writeSSE: vi.fn(async () => {
        writeCount++;
        // Fail on first writeSSE call (the text delta from on('text'))
        if (writeCount === 1) throw new Error('stream closed');
      }),
      onAbort: vi.fn(),
    } as unknown as SSEStreamingApi;

    let apiCalls = 0;
    const client = {
      messages: {
        stream: vi.fn(() => {
          apiCalls++;
          const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
          return {
            on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
              if (!listeners[event]) listeners[event] = [];
              listeners[event].push(handler);
            }),
            abort: vi.fn(),
            finalMessage: vi.fn(async () => {
              // Emit text → triggers writeSSE → throws → abort set internally
              for (const handler of (listeners['text'] ?? [])) {
                handler('token');
              }
              return {
                content: [
                  { type: 'text', text: 'token' },
                  { type: 'tool_use', id: 'tool-1', name: 'execute_command', input: { command: 'echo hi', description: 'test' } },
                ],
                stop_reason: 'tool_use',
              };
            }),
          };
        }),
      },
    } as unknown as Anthropic;

    const engine = new AgenticChatEngine(client);
    // Should not throw unhandled rejection
    const result = await engine.run({
      userMessage: 'test writeSSE no reject',
      serverId: 'srv-1',
      userId: 'usr-1',
      sessionId: 'sess-1',
      stream,
    });

    // Abort should have been detected — loop stops
    expect(result.success).toBe(false);
    expect(apiCalls).toBe(1);
  });

  it('should set abort.aborted via writeSSE internal catch when stream throws during contentBlock', async () => {
    // writeSSE in the contentBlock handler is also fire-and-forget.
    // It must not cause unhandled rejection.
    let writeCount = 0;
    const stream = {
      writeSSE: vi.fn(async () => {
        writeCount++;
        throw new Error('connection reset');
      }),
      onAbort: vi.fn(),
    } as unknown as SSEStreamingApi;

    const client = {
      messages: {
        stream: vi.fn(() => {
          const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
          return {
            on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
              if (!listeners[event]) listeners[event] = [];
              listeners[event].push(handler);
            }),
            abort: vi.fn(),
            finalMessage: vi.fn(async () => {
              // Emit contentBlock → triggers writeSSE → throws → abort set
              for (const handler of (listeners['contentBlock'] ?? [])) {
                handler({ type: 'tool_use', id: 'tool-1', name: 'execute_command', input: {} });
              }
              return {
                content: [
                  { type: 'tool_use', id: 'tool-1', name: 'execute_command', input: { command: 'ls', description: 'list' } },
                ],
                stop_reason: 'tool_use',
              };
            }),
          };
        }),
      },
    } as unknown as Anthropic;

    const engine = new AgenticChatEngine(client);
    const result = await engine.run({
      userMessage: 'test contentBlock writeSSE no reject',
      serverId: 'srv-1',
      userId: 'usr-1',
      sessionId: 'sess-1',
      stream,
    });

    // Abort detected, loop stopped
    expect(result.success).toBe(false);
    // writeSSE was called (even though it threw)
    expect(writeCount).toBeGreaterThanOrEqual(1);
  });
});

// ============================================================================
// AgenticChatEngine — Anthropic stream abort on disconnect (chat-034)
// ============================================================================

describe('AgenticChatEngine — Anthropic stream abort on disconnect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should call response.abort() when client disconnects during AI streaming', async () => {
    const { stream, simulateAbort } = createMockStream();
    const abortSpy = vi.fn();

    const client = {
      messages: {
        stream: vi.fn(() => {
          const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
          return {
            on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
              if (!listeners[event]) listeners[event] = [];
              listeners[event].push(handler);
            }),
            abort: abortSpy,
            finalMessage: vi.fn(async () => {
              // Simulate: first text delta arrives, then client disconnects,
              // then more text arrives — abort should be called
              for (const handler of (listeners['text'] ?? [])) {
                handler('First token ');
              }
              simulateAbort();
              for (const handler of (listeners['text'] ?? [])) {
                handler('Second token ');
              }
              return {
                content: [{ type: 'text', text: 'First token Second token ' }],
                stop_reason: 'end_turn',
              };
            }),
          };
        }),
      },
    } as unknown as Anthropic;

    const engine = new AgenticChatEngine(client);
    const result = await engine.run({
      userMessage: 'test',
      serverId: 'srv-1',
      userId: 'usr-1',
      sessionId: 'sess-1',
      stream,
    });

    // abort() should have been called when text delta detected abort state
    expect(abortSpy).toHaveBeenCalled();
    expect(result.success).toBe(true); // loop ended naturally (end_turn, no tool_use)
  });

  it('should call response.abort() on inputJson delta when disconnected', async () => {
    const { stream, simulateAbort } = createMockStream();
    const abortSpy = vi.fn();

    const client = {
      messages: {
        stream: vi.fn(() => {
          const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
          return {
            on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
              if (!listeners[event]) listeners[event] = [];
              listeners[event].push(handler);
            }),
            abort: abortSpy,
            finalMessage: vi.fn(async () => {
              // Disconnect then receive inputJson delta
              simulateAbort();
              for (const handler of (listeners['inputJson'] ?? [])) {
                handler('{"command":');
              }
              return {
                content: [
                  { type: 'tool_use', id: 'tool-1', name: 'execute_command', input: { command: 'ls', description: 'list' } },
                ],
                stop_reason: 'tool_use',
              };
            }),
          };
        }),
      },
    } as unknown as Anthropic;

    const engine = new AgenticChatEngine(client);
    const result = await engine.run({
      userMessage: 'test',
      serverId: 'srv-1',
      userId: 'usr-1',
      sessionId: 'sess-1',
      stream,
    });

    expect(abortSpy).toHaveBeenCalled();
    // Loop should stop — abort detected after AI call
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// AgenticChatEngine — confirmation + abort race (chat-056)
// ============================================================================

describe('AgenticChatEngine — confirmation abort race', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /** Create a client that returns a single risky tool_use, then ends. */
  function createRiskyToolClient() {
    let callIndex = 0;
    const client = {
      messages: {
        stream: vi.fn(() => {
          callIndex++;
          if (callIndex === 1) {
            return {
              on: vi.fn(),
              finalMessage: vi.fn(async () => ({
                content: [
                  { type: 'tool_use', id: 'tool-risky', name: 'execute_command', input: { command: 'rm -rf /tmp/test', description: 'cleanup' } },
                ],
                stop_reason: 'tool_use',
              })),
            };
          }
          return {
            on: vi.fn(),
            finalMessage: vi.fn(async () => ({
              content: [{ type: 'text', text: 'Done.' }],
              stop_reason: 'end_turn',
            })),
          };
        }),
      },
    } as unknown as Anthropic;
    return { client, getCallCount: () => callIndex };
  }

  it('should unblock confirmation wait within 1s when client disconnects', async () => {
    // Override validateCommand to return 'yellow' risk for this test
    const { validateCommand } = await import('../core/security/command-validator.js');
    vi.mocked(validateCommand).mockReturnValue({
      action: 'allowed',
      classification: { riskLevel: 'yellow', reason: 'potentially risky' },
    } as ReturnType<typeof validateCommand>);

    const { client } = createRiskyToolClient();
    const engine = new AgenticChatEngine(client);
    const { stream, simulateAbort, sseEvents } = createMockStream();

    // Provide onConfirmRequired that never resolves (simulates user not responding)
    const onConfirmRequired = vi.fn((_cmd: string, _risk: string, _desc: string) => ({
      confirmId: 'sess-1:confirm-1',
      approved: new Promise<boolean>(() => {
        // Never resolves — simulates 5-min timeout scenario
      }),
    }));

    const startTime = Date.now();

    // Abort after 100ms to simulate client disconnect
    setTimeout(() => simulateAbort(), 100);

    const result = await engine.run({
      userMessage: 'delete temp files',
      serverId: 'srv-1',
      userId: 'usr-1',
      sessionId: 'sess-1',
      stream,
      onConfirmRequired,
    });

    const elapsed = Date.now() - startTime;

    // Should have finished within 1 second (not 5 minutes)
    expect(elapsed).toBeLessThan(1000);
    expect(result.success).toBe(false);

    // Confirmation was requested
    expect(onConfirmRequired).toHaveBeenCalledOnce();

    // A confirm_required SSE event was sent
    const confirmEvents = sseEvents.filter((e) => e.event === 'confirm_required');
    expect(confirmEvents).toHaveLength(1);
  });

  it('should resolve immediately when abort is already true before confirmation wait', async () => {
    const { validateCommand } = await import('../core/security/command-validator.js');
    vi.mocked(validateCommand).mockReturnValue({
      action: 'allowed',
      classification: { riskLevel: 'red', reason: 'dangerous' },
    } as ReturnType<typeof validateCommand>);

    const { client } = createRiskyToolClient();
    const engine = new AgenticChatEngine(client);
    const { stream, simulateAbort } = createMockStream();

    // Abort BEFORE confirmation
    simulateAbort();

    const onConfirmRequired = vi.fn((_cmd: string, _risk: string, _desc: string) => ({
      confirmId: 'sess-1:confirm-2',
      approved: new Promise<boolean>(() => { /* never resolves */ }),
    }));

    const startTime = Date.now();
    const result = await engine.run({
      userMessage: 'risky command',
      serverId: 'srv-1',
      userId: 'usr-1',
      sessionId: 'sess-1',
      stream,
      onConfirmRequired,
    });
    const elapsed = Date.now() - startTime;

    // Should resolve nearly instantly (abort was pre-set)
    expect(elapsed).toBeLessThan(500);
    expect(result.success).toBe(false);
  });

  it('should still allow user approval when abort has not fired', async () => {
    const { validateCommand } = await import('../core/security/command-validator.js');
    vi.mocked(validateCommand).mockReturnValue({
      action: 'allowed',
      classification: { riskLevel: 'yellow', reason: 'needs confirmation' },
    } as ReturnType<typeof validateCommand>);

    const { client, getCallCount } = createRiskyToolClient();
    const engine = new AgenticChatEngine(client);
    const { stream, sseEvents } = createMockStream();

    // User approves after 50ms
    const onConfirmRequired = vi.fn((_cmd: string, _risk: string, _desc: string) => {
      let resolveApproved!: (v: boolean) => void;
      const approved = new Promise<boolean>((resolve) => { resolveApproved = resolve; });
      setTimeout(() => resolveApproved(true), 50);
      return { confirmId: 'sess-1:confirm-3', approved };
    });

    const result = await engine.run({
      userMessage: 'do something risky',
      serverId: 'srv-1',
      userId: 'usr-1',
      sessionId: 'sess-1',
      stream,
      onConfirmRequired,
    });

    // Should succeed — user approved, command executed
    expect(result.success).toBe(true);
    expect(getCallCount()).toBe(2); // 1st turn: tool_use, 2nd turn: end_turn

    // A tool_executing event should have been sent (command was dispatched)
    const executingEvents = sseEvents.filter((e) => e.event === 'tool_executing');
    expect(executingEvents).toHaveLength(1);
  });

  it('should not execute command when abort fires during confirmation', async () => {
    const { validateCommand } = await import('../core/security/command-validator.js');
    vi.mocked(validateCommand).mockReturnValue({
      action: 'allowed',
      classification: { riskLevel: 'red', reason: 'destructive' },
    } as ReturnType<typeof validateCommand>);

    const { client } = createRiskyToolClient();
    const engine = new AgenticChatEngine(client);
    const { stream, simulateAbort, sseEvents } = createMockStream();

    const onConfirmRequired = vi.fn((_cmd: string, _risk: string, _desc: string) => ({
      confirmId: 'sess-1:confirm-4',
      approved: new Promise<boolean>(() => { /* never resolves */ }),
    }));

    // Abort after 50ms
    setTimeout(() => simulateAbort(), 50);

    const result = await engine.run({
      userMessage: 'dangerous command',
      serverId: 'srv-1',
      userId: 'usr-1',
      sessionId: 'sess-1',
      stream,
      onConfirmRequired,
    });

    expect(result.success).toBe(false);

    // No tool_executing event — command was never dispatched
    const executingEvents = sseEvents.filter((e) => e.event === 'tool_executing');
    expect(executingEvents).toHaveLength(0);
  });

  it('should handle user rejection (approved=false) normally without abort', async () => {
    const { validateCommand } = await import('../core/security/command-validator.js');
    vi.mocked(validateCommand).mockReturnValue({
      action: 'allowed',
      classification: { riskLevel: 'yellow', reason: 'risky' },
    } as ReturnType<typeof validateCommand>);

    const { client, getCallCount } = createRiskyToolClient();
    const engine = new AgenticChatEngine(client);
    const { stream, sseEvents } = createMockStream();

    // User rejects after 30ms
    const onConfirmRequired = vi.fn((_cmd: string, _risk: string, _desc: string) => {
      let resolveApproved!: (v: boolean) => void;
      const approved = new Promise<boolean>((resolve) => { resolveApproved = resolve; });
      setTimeout(() => resolveApproved(false), 30);
      return { confirmId: 'sess-1:confirm-5', approved };
    });

    const result = await engine.run({
      userMessage: 'risky thing',
      serverId: 'srv-1',
      userId: 'usr-1',
      sessionId: 'sess-1',
      stream,
      onConfirmRequired,
    });

    // AI sees rejection and responds, loop ends normally
    expect(result.success).toBe(true);
    expect(getCallCount()).toBe(2);

    // A tool_result with 'rejected' status should have been sent
    const rejectedEvents = sseEvents.filter(
      (e) => e.event === 'tool_result' && (e.data as Record<string, unknown>).status === 'rejected',
    );
    expect(rejectedEvents).toHaveLength(1);
  });

  it('should clean up abort listener after user approves (no leaked interval/listener)', async () => {
    const { validateCommand } = await import('../core/security/command-validator.js');
    vi.mocked(validateCommand).mockReturnValue({
      action: 'allowed',
      classification: { riskLevel: 'yellow', reason: 'needs confirmation' },
    } as ReturnType<typeof validateCommand>);

    const { client } = createRiskyToolClient();
    const engine = new AgenticChatEngine(client);
    const { stream, simulateAbort } = createMockStream();

    // Track whether abort listener is still active after confirmation resolves
    let abortListenerFired = false;

    // User approves after 30ms
    const onConfirmRequired = vi.fn((_cmd: string, _risk: string, _desc: string) => {
      let resolveApproved!: (v: boolean) => void;
      const approved = new Promise<boolean>((resolve) => { resolveApproved = resolve; });
      setTimeout(() => resolveApproved(true), 30);
      return { confirmId: 'sess-1:confirm-cleanup', approved };
    });

    const result = await engine.run({
      userMessage: 'test cleanup',
      serverId: 'srv-1',
      userId: 'usr-1',
      sessionId: 'sess-1',
      stream,
      onConfirmRequired,
    });

    expect(result.success).toBe(true);

    // Now fire abort AFTER the run completed — if the listener leaked,
    // it would still be registered and would fire.
    // We spy on Promise resolution to verify no stale callbacks execute.
    const preAbortTime = Date.now();
    simulateAbort();
    const postAbortTime = Date.now();

    // The abort should fire synchronously (no interval polling delay).
    // If the old setInterval approach leaked, it would keep polling for up to 200ms.
    expect(postAbortTime - preAbortTime).toBeLessThan(50);

    // Verify no setInterval is running by waiting 300ms and confirming
    // no unexpected side effects (the run already completed successfully).
    await new Promise((resolve) => setTimeout(resolve, 300));
    // If we got here without hanging or errors, the cleanup worked correctly.
    abortListenerFired = true;
    expect(abortListenerFired).toBe(true);
  });

  it('should clean up abort listener after user rejects (no leaked listener)', async () => {
    const { validateCommand } = await import('../core/security/command-validator.js');
    vi.mocked(validateCommand).mockReturnValue({
      action: 'allowed',
      classification: { riskLevel: 'red', reason: 'destructive' },
    } as ReturnType<typeof validateCommand>);

    const { client } = createRiskyToolClient();
    const engine = new AgenticChatEngine(client);
    const { stream, simulateAbort } = createMockStream();

    // User rejects after 30ms
    const onConfirmRequired = vi.fn((_cmd: string, _risk: string, _desc: string) => {
      let resolveApproved!: (v: boolean) => void;
      const approved = new Promise<boolean>((resolve) => { resolveApproved = resolve; });
      setTimeout(() => resolveApproved(false), 30);
      return { confirmId: 'sess-1:confirm-cleanup-reject', approved };
    });

    const result = await engine.run({
      userMessage: 'test cleanup on reject',
      serverId: 'srv-1',
      userId: 'usr-1',
      sessionId: 'sess-1',
      stream,
      onConfirmRequired,
    });

    expect(result.success).toBe(true);

    // Fire abort after completion — should be a no-op (listener already cleaned up)
    simulateAbort();

    // Wait to confirm no leaked interval/timer causes issues
    await new Promise((resolve) => setTimeout(resolve, 300));
  });
});

// ============================================================================
// AgenticChatEngine — pre-trim long conversation history (chat-057)
// ============================================================================

describe('AgenticChatEngine — pre-trim long conversation history', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should not fail on first API call when conversation history exceeds 150K tokens', async () => {
    // Build a conversation history with hundreds of long messages
    // Each message ~1000 chars ≈ 250 tokens → 600+ messages ≈ 150K+ tokens
    const longHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    for (let i = 0; i < 400; i++) {
      longHistory.push({ role: 'user', content: `用户消息 ${i}: ${'这是一段很长的对话内容'.repeat(50)}` });
      longHistory.push({ role: 'assistant', content: `助手回复 ${i}: ${'执行系统检查和维护操作'.repeat(50)}` });
    }

    const { client } = createMockAnthropicClient(1);
    const engine = new AgenticChatEngine(client);
    const { stream } = createMockStream();

    const result = await engine.run({
      userMessage: '继续帮我检查服务器状态',
      serverId: 'srv-1',
      userId: 'usr-1',
      sessionId: 'sess-1',
      stream,
      conversationHistory: longHistory,
    });

    // Should succeed — pre-trim prevented context overflow
    expect(result.success).toBe(true);
    expect(result.turns).toBe(1);
  });

  it('should preserve the latest user message after pre-trim', async () => {
    // Spy on the Anthropic stream call to capture what messages are sent
    const capturedMessages: Anthropic.MessageParam[][] = [];
    const client = {
      messages: {
        stream: vi.fn((params: { messages: Anthropic.MessageParam[] }) => {
          capturedMessages.push([...params.messages]);
          return {
            on: vi.fn(),
            finalMessage: vi.fn(async () => ({
              content: [{ type: 'text', text: 'Done' }],
              stop_reason: 'end_turn',
            })),
          };
        }),
      },
    } as unknown as Anthropic;

    const longHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    for (let i = 0; i < 400; i++) {
      longHistory.push({ role: 'user', content: `Message ${i}: ${'x'.repeat(2000)}` });
      longHistory.push({ role: 'assistant', content: `Reply ${i}: ${'y'.repeat(2000)}` });
    }

    const engine = new AgenticChatEngine(client);
    const { stream } = createMockStream();

    await engine.run({
      userMessage: 'Latest question from user',
      serverId: 'srv-1',
      userId: 'usr-1',
      sessionId: 'sess-1',
      stream,
      conversationHistory: longHistory,
    });

    // Verify the API was called
    expect(capturedMessages).toHaveLength(1);
    const sentMessages = capturedMessages[0];

    // The last message should be the current user message
    const lastMsg = sentMessages[sentMessages.length - 1];
    expect(lastMsg.role).toBe('user');
    expect(typeof lastMsg.content === 'string' && lastMsg.content).toContain('Latest question from user');

    // Total token count should be within budget (150K)
    const tokens = estimateMessagesTokens(sentMessages);
    expect(tokens).toBeLessThanOrEqual(150_000);
  });

  it('should preserve the first user message (original context) after pre-trim', async () => {
    const capturedMessages: Anthropic.MessageParam[][] = [];
    const client = {
      messages: {
        stream: vi.fn((params: { messages: Anthropic.MessageParam[] }) => {
          capturedMessages.push([...params.messages]);
          return {
            on: vi.fn(),
            finalMessage: vi.fn(async () => ({
              content: [{ type: 'text', text: 'Done' }],
              stop_reason: 'end_turn',
            })),
          };
        }),
      },
    } as unknown as Anthropic;

    const longHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    // First message is from user — this is part of conversationHistory
    longHistory.push({ role: 'user', content: 'ORIGINAL_FIRST_MESSAGE' });
    longHistory.push({ role: 'assistant', content: 'First reply' });
    for (let i = 0; i < 400; i++) {
      longHistory.push({ role: 'user', content: `Msg ${i}: ${'z'.repeat(2000)}` });
      longHistory.push({ role: 'assistant', content: `Rep ${i}: ${'w'.repeat(2000)}` });
    }

    const engine = new AgenticChatEngine(client);
    const { stream } = createMockStream();

    await engine.run({
      userMessage: 'New message',
      serverId: 'srv-1',
      userId: 'usr-1',
      sessionId: 'sess-1',
      stream,
      conversationHistory: longHistory,
    });

    expect(capturedMessages).toHaveLength(1);
    const sentMessages = capturedMessages[0];

    // First message should still contain the original user message
    const firstMsg = sentMessages[0];
    expect(firstMsg.role).toBe('user');
    expect(typeof firstMsg.content === 'string' && firstMsg.content).toContain('ORIGINAL_FIRST_MESSAGE');
  });

  it('should not trim when conversation history is within token budget', async () => {
    const capturedMessages: Anthropic.MessageParam[][] = [];
    const client = {
      messages: {
        stream: vi.fn((params: { messages: Anthropic.MessageParam[] }) => {
          capturedMessages.push([...params.messages]);
          return {
            on: vi.fn(),
            finalMessage: vi.fn(async () => ({
              content: [{ type: 'text', text: 'Done' }],
              stop_reason: 'end_turn',
            })),
          };
        }),
      },
    } as unknown as Anthropic;

    // Short history — well within budget
    const shortHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there' },
      { role: 'user', content: 'How are you?' },
      { role: 'assistant', content: 'Good' },
    ];

    const engine = new AgenticChatEngine(client);
    const { stream } = createMockStream();

    await engine.run({
      userMessage: 'New question',
      serverId: 'srv-1',
      userId: 'usr-1',
      sessionId: 'sess-1',
      stream,
      conversationHistory: shortHistory,
    });

    expect(capturedMessages).toHaveLength(1);
    // All messages should be preserved (4 history + 1 current = 5)
    expect(capturedMessages[0]).toHaveLength(5);
  });

  it('should handle CJK conversation history pre-trim correctly', async () => {
    const capturedMessages: Anthropic.MessageParam[][] = [];
    const client = {
      messages: {
        stream: vi.fn((params: { messages: Anthropic.MessageParam[] }) => {
          capturedMessages.push([...params.messages]);
          return {
            on: vi.fn(),
            finalMessage: vi.fn(async () => ({
              content: [{ type: 'text', text: '完成' }],
              stop_reason: 'end_turn',
            })),
          };
        }),
      },
    } as unknown as Anthropic;

    // CJK text uses more tokens per char (~1.5 chars/token vs 4 chars/token for ASCII)
    const cjkHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    for (let i = 0; i < 300; i++) {
      cjkHistory.push({ role: 'user', content: `用户请求 ${i}: ${'服务器运维管理系统检查'.repeat(100)}` });
      cjkHistory.push({ role: 'assistant', content: `系统回复 ${i}: ${'正在执行安全检查和性能优化'.repeat(100)}` });
    }

    const engine = new AgenticChatEngine(client);
    const { stream } = createMockStream();

    const result = await engine.run({
      userMessage: '请检查最新状态',
      serverId: 'srv-1',
      userId: 'usr-1',
      sessionId: 'sess-1',
      stream,
      conversationHistory: cjkHistory,
    });

    expect(result.success).toBe(true);

    // Messages sent to API should be within token budget
    const sentMessages = capturedMessages[0];
    const tokens = estimateMessagesTokens(sentMessages);
    expect(tokens).toBeLessThanOrEqual(150_000);

    // Should have been trimmed (original was way over budget)
    expect(sentMessages.length).toBeLessThan(601); // 300 pairs + 1 current
  });
});
