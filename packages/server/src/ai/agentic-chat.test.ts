// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for agentic chat message trimming utility.
 *
 * Validates that the message array stays within token budget
 * during long agentic tool-use loops.
 */

import { describe, it, expect } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { trimMessagesIfNeeded } from './agentic-chat.js';

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
