// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for agentic-message-utils — token estimation and message trimming.
 *
 * Validates that:
 * 1. Token estimation is CJK-aware (not just ASCII chars/4)
 * 2. Message trimming recalculates totals (no cumulative drift)
 * 3. Chinese conversations are trimmed correctly under token budget
 * 4. Content truncation (string and array) handles boundary cases
 */

import { describe, it, expect } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import {
  estimateMessagesTokens,
  trimMessagesIfNeeded,
} from "./agentic-message-utils.js";

// ============================================================================
// Test helpers
// ============================================================================

function makeMessage(
  role: "user" | "assistant",
  content: string,
): Anthropic.MessageParam {
  return { role, content };
}

function makeLargeMessages(
  pairCount: number,
  contentSize = 1000,
): Anthropic.MessageParam[] {
  const messages: Anthropic.MessageParam[] = [
    makeMessage("user", "Initial user question"),
  ];
  for (let i = 0; i < pairCount; i++) {
    messages.push(
      makeMessage(
        "assistant",
        `Assistant reply ${i}: ${"a".repeat(contentSize)}`,
      ),
    );
    messages.push(
      makeMessage("user", `Tool result ${i}: ${"b".repeat(contentSize)}`),
    );
  }
  return messages;
}

function makeCjkMessages(
  pairCount: number,
  contentSize = 500,
): Anthropic.MessageParam[] {
  const messages: Anthropic.MessageParam[] = [
    makeMessage("user", "请帮我安装 Nginx 服务器"),
  ];
  for (let i = 0; i < pairCount; i++) {
    messages.push(
      makeMessage("assistant", `正在检查系统环境${"。".repeat(contentSize)}`),
    );
    messages.push(
      makeMessage("user", `命令执行结果${"测".repeat(contentSize)}`),
    );
  }
  return messages;
}

// ============================================================================
// estimateMessagesTokens — CJK awareness
// ============================================================================

describe("estimateMessagesTokens", () => {
  it("should estimate ASCII text at ~4 chars per token", () => {
    const messages = [makeMessage("user", "a".repeat(400))];
    const tokens = estimateMessagesTokens(messages);
    // 400 chars / 4 = 100 tokens
    expect(tokens).toBe(100);
  });

  it("should estimate pure CJK text at ~1.5 chars per token", () => {
    const messages = [makeMessage("user", "中".repeat(150))];
    const tokens = estimateMessagesTokens(messages);
    // 150 chars / 1.5 = 100 tokens
    expect(tokens).toBe(100);
  });

  it("should estimate mixed CJK/ASCII text with weighted ratio", () => {
    // 50% CJK, 50% ASCII → weighted ratio ≈ (1.5*0.5 + 4*0.5) = 2.75
    const mixedText = "你好hello你好hello你好hello";
    const messages = [makeMessage("user", mixedText)];
    const tokens = estimateMessagesTokens(messages);
    // Should be higher than pure ASCII estimate (length/4)
    const naiveEstimate = Math.ceil(mixedText.length / 4);
    expect(tokens).toBeGreaterThan(naiveEstimate);
  });

  it("should give CJK text significantly more tokens than ASCII of same length", () => {
    const length = 1000;
    const asciiTokens = estimateMessagesTokens([
      makeMessage("user", "a".repeat(length)),
    ]);
    const cjkTokens = estimateMessagesTokens([
      makeMessage("user", "中".repeat(length)),
    ]);
    // CJK should be ~2.67x more tokens than ASCII for same char count
    expect(cjkTokens / asciiTokens).toBeGreaterThan(2);
    expect(cjkTokens / asciiTokens).toBeLessThan(3);
  });

  it("should handle structured content blocks with text", () => {
    const messages: Anthropic.MessageParam[] = [
      {
        role: "assistant",
        content: [
          { type: "text" as const, text: "让我检查一下系统状态" },
          {
            type: "tool_use" as const,
            id: "tool-1",
            name: "execute_command",
            input: { command: "ls -la" },
          },
        ],
      },
    ];
    const tokens = estimateMessagesTokens(messages);
    expect(tokens).toBeGreaterThan(0);
  });

  it("should handle tool_result content blocks", () => {
    const messages: Anthropic.MessageParam[] = [
      {
        role: "user",
        content: [
          {
            type: "tool_result" as const,
            tool_use_id: "tool-1",
            content: "文件列表：测试文件.txt\n日志文件.log",
          },
        ],
      },
    ];
    const tokens = estimateMessagesTokens(messages);
    expect(tokens).toBeGreaterThan(0);
  });

  it("should handle empty messages", () => {
    expect(estimateMessagesTokens([])).toBe(0);
  });

  it("should handle empty string content", () => {
    expect(estimateMessagesTokens([makeMessage("user", "")])).toBe(0);
  });

  it("should accumulate tokens across multiple messages", () => {
    const single = estimateMessagesTokens([
      makeMessage("user", "a".repeat(400)),
    ]);
    const double = estimateMessagesTokens([
      makeMessage("user", "a".repeat(400)),
      makeMessage("assistant", "a".repeat(400)),
    ]);
    expect(double).toBe(single * 2);
  });

  it("should estimate CJK messages within 2x of true token count", () => {
    // Real Claude tokenizer: 1 CJK char ≈ 1-2 tokens
    // Our estimate: 1.5 chars/token → 1000 chars = 667 tokens
    // Acceptable range: 333-1334 (within 2x of 667)
    const cjk1000 = "中".repeat(1000);
    const tokens = estimateMessagesTokens([makeMessage("user", cjk1000)]);
    // Should be roughly 667 tokens (1000/1.5)
    expect(tokens).toBeGreaterThanOrEqual(500);
    expect(tokens).toBeLessThanOrEqual(1000);
  });
});

// ============================================================================
// estimateMessagesTokens — extractBlockText boundary cases
// ============================================================================

describe("estimateMessagesTokens — extractBlockText edge cases", () => {
  it("should handle content block with 'content' string key (tool_result)", () => {
    const messages: Anthropic.MessageParam[] = [
      {
        role: "user",
        content: [
          {
            type: "tool_result" as const,
            tool_use_id: "t-1",
            content: "result text",
          },
        ],
      },
    ];
    const tokens = estimateMessagesTokens(messages);
    expect(tokens).toBeGreaterThan(0);
  });

  it("should serialize non-text blocks to JSON for estimation", () => {
    const messages: Anthropic.MessageParam[] = [
      {
        role: "assistant",
        content: [
          {
            type: "tool_use" as const,
            id: "t-1",
            name: "execute_command",
            input: { command: "echo hello" },
          },
        ],
      },
    ];
    const tokens = estimateMessagesTokens(messages);
    // JSON.stringify of the block is used for estimation
    expect(tokens).toBeGreaterThan(0);
  });

  it("should handle block with empty text", () => {
    const messages: Anthropic.MessageParam[] = [
      {
        role: "assistant",
        content: [{ type: "text" as const, text: "" }],
      },
    ];
    expect(estimateMessagesTokens(messages)).toBe(0);
  });
});

// ============================================================================
// trimMessagesIfNeeded — basic behavior
// ============================================================================

describe("trimMessagesIfNeeded", () => {
  it("should not trim when under token budget", () => {
    const messages = [
      makeMessage("user", "Hello"),
      makeMessage("assistant", "Hi"),
      makeMessage("user", "Thanks"),
    ];
    trimMessagesIfNeeded(messages, 100000);
    expect(messages).toHaveLength(3);
  });

  it("should truncate first message when exactly 3 messages exceed budget", () => {
    const messages = [
      makeMessage("user", "x".repeat(10000)),
      makeMessage("assistant", "y".repeat(10000)),
      makeMessage("user", "z".repeat(10000)),
    ];
    // 3 messages over budget → truncate first message content, keep 3 messages
    const result = trimMessagesIfNeeded(messages, 1);
    expect(messages).toHaveLength(3);
    expect(result).not.toBeNull();
    expect(result!.removedTokens).toBeGreaterThan(0);
    // First message should contain truncation marker
    expect(
      typeof messages[0].content === "string" && messages[0].content,
    ).toContain("[Content truncated:");
  });

  it("should trim oldest pairs when over budget", () => {
    // 10 pairs × 1000 chars each side ≈ 20K chars ≈ 5000 tokens
    const messages = makeLargeMessages(10, 1000);
    expect(messages).toHaveLength(21); // 1 + 10*2

    trimMessagesIfNeeded(messages, 2000); // force significant trimming

    // Should have fewer messages
    expect(messages.length).toBeLessThan(21);
    // Should keep at least 3 (first user + one pair)
    expect(messages.length).toBeGreaterThanOrEqual(3);
    // First message should be preserved (with context-loss notice appended)
    expect(
      typeof messages[0].content === "string" && messages[0].content,
    ).toContain("Initial user question");
    // Last messages should be the most recent pair
    const lastMsg = messages[messages.length - 1];
    expect(typeof lastMsg.content === "string" && lastMsg.content).toContain(
      "Tool result 9",
    );
  });

  it("should preserve the first user message when budget allows", () => {
    const messages = makeLargeMessages(5, 200);
    // Budget large enough to keep first msg + one pair after removing older pairs
    trimMessagesIfNeeded(messages, 5000);

    expect(messages[0].role).toBe("user");
    // Original text preserved (with context-loss notice appended)
    expect(
      typeof messages[0].content === "string" && messages[0].content,
    ).toContain("Initial user question");
  });

  it("should truncate first message when budget is too tight for all 3 remaining", () => {
    const messages = makeLargeMessages(5, 2000);
    trimMessagesIfNeeded(messages, 500);

    expect(messages[0].role).toBe("user");
    // First message is truncated because even after pair removal, 3 messages exceed budget
    const firstContent = messages[0].content as string;
    expect(firstContent).toContain("[Content truncated:");
  });

  it("should maintain alternating user/assistant structure", () => {
    const messages = makeLargeMessages(8, 500);
    trimMessagesIfNeeded(messages, 1000);

    // After the first user message, should alternate assistant/user
    for (let i = 1; i < messages.length; i++) {
      const expectedRole = i % 2 === 1 ? "assistant" : "user";
      expect(messages[i].role).toBe(expectedRole);
    }
  });

  it("should handle empty messages array", () => {
    const messages: Anthropic.MessageParam[] = [];
    trimMessagesIfNeeded(messages, 1000);
    expect(messages).toHaveLength(0);
  });

  it("should handle single message", () => {
    const messages = [makeMessage("user", "Hello")];
    trimMessagesIfNeeded(messages, 1);
    expect(messages).toHaveLength(1);
  });

  it("should handle structured content blocks", () => {
    const messages: Anthropic.MessageParam[] = [
      makeMessage("user", "Hello"),
      {
        role: "assistant",
        content: [
          { type: "text" as const, text: "Let me check..." },
          {
            type: "tool_use" as const,
            id: "tool-1",
            name: "execute_command",
            input: { command: "ls" },
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool_result" as const,
            tool_use_id: "tool-1",
            content: "file1.txt\nfile2.txt",
          },
        ],
      },
      makeMessage("assistant", "I found 2 files."),
      makeMessage("user", "Thanks"),
    ];

    // Should not crash with structured content
    trimMessagesIfNeeded(messages, 100000);
    expect(messages).toHaveLength(5);
  });
});

// ============================================================================
// trimMessagesIfNeeded — CJK scenarios
// ============================================================================

describe("trimMessagesIfNeeded — CJK conversations", () => {
  it("should trim CJK messages more aggressively than ASCII (same char count)", () => {
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

  it("should correctly trim 20+ turn Chinese conversation under 150K budget", () => {
    // Simulate a realistic 20-turn Chinese agentic conversation
    const messages: Anthropic.MessageParam[] = [
      makeMessage("user", "请帮我在服务器上安装并配置 Nginx 反向代理"),
    ];

    for (let i = 0; i < 20; i++) {
      messages.push({
        role: "assistant",
        content: [
          {
            type: "text" as const,
            text: `第${i + 1}步：正在执行系统检查${"。".repeat(200)}`,
          },
          {
            type: "tool_use" as const,
            id: `tool-${i}`,
            name: "execute_command",
            input: { command: `check-step-${i}` },
          },
        ],
      });
      messages.push({
        role: "user",
        content: [
          {
            type: "tool_result" as const,
            tool_use_id: `tool-${i}`,
            content: `步骤${i + 1}结果：${"测试输出数据".repeat(100)}`,
          },
        ],
      });
    }

    trimMessagesIfNeeded(messages, 150_000);

    // After trimming, the actual token count should be within budget
    const actualTokens = estimateMessagesTokens(messages);
    expect(actualTokens).toBeLessThanOrEqual(150_000);
    // First message preserved (with context-loss notice appended if trimmed)
    expect(
      typeof messages[0].content === "string" && messages[0].content,
    ).toContain("请帮我在服务器上安装并配置 Nginx 反向代理");
  });

  it("should produce consistent results (no cumulative drift)", () => {
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

describe("trimMessagesIfNeeded — recalculation accuracy", () => {
  it("should keep messages under budget after trim (verified by fresh estimate)", () => {
    const messages = makeLargeMessages(15, 2000);
    const budget = 5000;

    trimMessagesIfNeeded(messages, budget);

    // Fresh recalculation should confirm we're under budget
    const freshEstimate = estimateMessagesTokens(messages);
    expect(freshEstimate).toBeLessThanOrEqual(budget);
  });

  it("should keep CJK messages under budget after trim (verified by fresh estimate)", () => {
    const messages = makeCjkMessages(15, 400);
    const budget = 5000;

    trimMessagesIfNeeded(messages, budget);

    const freshEstimate = estimateMessagesTokens(messages);
    expect(freshEstimate).toBeLessThanOrEqual(budget);
  });

  it("should handle mixed CJK/ASCII conversation trimming", () => {
    const messages: Anthropic.MessageParam[] = [
      makeMessage("user", "帮我检查 Nginx 配置"),
    ];

    for (let i = 0; i < 10; i++) {
      // Assistant replies in Chinese
      messages.push(
        makeMessage("assistant", `正在检查配置文件${"内容".repeat(200)}`),
      );
      // Tool results in ASCII (command output)
      messages.push(
        makeMessage(
          "user",
          `server {\n  listen 80;\n  ${"location /api { proxy_pass http://localhost:3000; }\n  ".repeat(50)}\n}`,
        ),
      );
    }

    const budget = 5000;
    trimMessagesIfNeeded(messages, budget);

    const freshEstimate = estimateMessagesTokens(messages);
    expect(freshEstimate).toBeLessThanOrEqual(budget);
    expect(
      typeof messages[0].content === "string" && messages[0].content,
    ).toContain("帮我检查 Nginx 配置");
  });
});

// ============================================================================
// trimMessagesIfNeeded — 3-message overflow (content truncation)
// ============================================================================

describe("trimMessagesIfNeeded — 3-message content truncation", () => {
  it("should guarantee token budget even with 3 huge messages (string content)", () => {
    // Simulate: 50K token first message + 60K + 60K recent pair = 170K > 150K budget
    const messages = [
      makeMessage("user", "a".repeat(200_000)), // ~50K tokens
      makeMessage("assistant", "b".repeat(240_000)), // ~60K tokens
      makeMessage("user", "c".repeat(240_000)), // ~60K tokens
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

  it("should guarantee token budget when first message has massive file paste", () => {
    // Real-world scenario: user pastes a 50K-token file, then recent turn is 110K tokens
    const messages = [
      makeMessage("user", "x".repeat(200_000)), // ~50K tokens (large file paste)
      makeMessage("assistant", "y".repeat(200_000)), // ~50K tokens
      makeMessage("user", "z".repeat(240_000)), // ~60K tokens
    ];
    const budget = 150_000;

    trimMessagesIfNeeded(messages, budget);

    expect(messages).toHaveLength(3);
    // First message should be truncated with marker
    const firstContent = messages[0].content as string;
    expect(firstContent).toContain("[Content truncated:");
    expect(firstContent).toContain(
      "[System: Earlier conversation context was trimmed",
    );
  });

  it("should truncate array content blocks when 3 messages exceed budget", () => {
    // First message has multiple tool_result blocks
    const messages: Anthropic.MessageParam[] = [
      {
        role: "user",
        content: [
          {
            type: "tool_result" as const,
            tool_use_id: "tool-1",
            content: "a".repeat(100_000),
          },
          {
            type: "tool_result" as const,
            tool_use_id: "tool-2",
            content: "b".repeat(100_000),
          },
          { type: "text" as const, text: "Please analyze these results" },
        ],
      },
      makeMessage("assistant", "c".repeat(100_000)),
      makeMessage("user", "d".repeat(100_000)),
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

  it("should handle trimming from many messages down to 3 and still need truncation", () => {
    // Start with many messages, trim to 3, but remaining 3 still exceed budget
    const messages: Anthropic.MessageParam[] = [
      makeMessage("user", "x".repeat(80_000)), // ~20K tokens
    ];
    for (let i = 0; i < 10; i++) {
      messages.push(makeMessage("assistant", "a".repeat(40_000)));
      messages.push(makeMessage("user", "b".repeat(40_000)));
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
    expect(firstContent).toContain("[Content truncated:");
  });

  it("should preserve recent messages even when first message is truncated", () => {
    const messages = [
      makeMessage("user", "INITIAL_QUERY:" + "x".repeat(200_000)),
      makeMessage("assistant", "RECENT_REPLY:" + "y".repeat(40_000)),
      makeMessage("user", "RECENT_RESULT:" + "z".repeat(40_000)),
    ];
    const budget = 50_000;

    trimMessagesIfNeeded(messages, budget);

    // Recent messages should be fully preserved
    expect(messages[1].content as string).toContain("RECENT_REPLY:");
    expect(messages[2].content as string).toContain("RECENT_RESULT:");
    // First message truncated — original start may be gone, but tail preserved
    const firstContent = messages[0].content as string;
    expect(firstContent).toContain("[Content truncated:");
  });

  it("should not truncate when 3 messages fit within budget", () => {
    const messages = [
      makeMessage("user", "Hello"),
      makeMessage("assistant", "Hi there"),
      makeMessage("user", "Thanks"),
    ];
    const result = trimMessagesIfNeeded(messages, 100_000);

    expect(result).toBeNull();
    expect(messages[0].content).toBe("Hello");
  });

  it("should handle CJK content truncation correctly", () => {
    // CJK: ~1.5 chars/token, so 150K chars ≈ 100K tokens
    const messages = [
      makeMessage("user", "中".repeat(150_000)), // ~100K tokens
      makeMessage("assistant", "文".repeat(75_000)), // ~50K tokens
      makeMessage("user", "字".repeat(75_000)), // ~50K tokens
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

describe("trimMessagesIfNeeded — context-loss notice", () => {
  it("should return null when no trimming occurs", () => {
    const messages = [
      makeMessage("user", "Hello"),
      makeMessage("assistant", "Hi"),
      makeMessage("user", "Thanks"),
    ];
    const result = trimMessagesIfNeeded(messages, 100000);
    expect(result).toBeNull();
  });

  it("should return TrimResult with counts when trimming occurs", () => {
    const messages = makeLargeMessages(10, 1000);
    const result = trimMessagesIfNeeded(messages, 2000);

    expect(result).not.toBeNull();
    expect(result!.removedMessages).toBeGreaterThan(0);
    expect(result!.removedTokens).toBeGreaterThan(0);
  });

  it("should inject context-loss notice into string first message after trim", () => {
    const messages = makeLargeMessages(10, 1000);
    trimMessagesIfNeeded(messages, 2000);

    const firstContent = messages[0].content;
    expect(typeof firstContent).toBe("string");
    expect(firstContent as string).toContain(
      "[System: Earlier conversation context was trimmed",
    );
    expect(firstContent as string).toContain("messages");
    expect(firstContent as string).toContain("tokens) were removed");
    expect(firstContent as string).toContain("re-read the relevant files");
  });

  it("should inject context-loss notice into array first message after trim", () => {
    // Build messages with structured content in the first user message
    const messages: Anthropic.MessageParam[] = [
      {
        role: "user",
        content: [{ type: "text" as const, text: "Initial structured query" }],
      },
    ];
    for (let i = 0; i < 10; i++) {
      messages.push(makeMessage("assistant", "a".repeat(1000)));
      messages.push(makeMessage("user", "b".repeat(1000)));
    }

    trimMessagesIfNeeded(messages, 2000);

    const firstContent = messages[0].content;
    expect(Array.isArray(firstContent)).toBe(true);
    const blocks = firstContent as Array<{ type: string; text?: string }>;
    // Original block preserved
    expect(blocks[0].text).toBe("Initial structured query");
    // Notice appended as new text block
    const lastBlock = blocks[blocks.length - 1];
    expect(lastBlock.type).toBe("text");
    expect(lastBlock.text).toContain(
      "[System: Earlier conversation context was trimmed",
    );
  });

  it("should not inject notice when no trimming needed", () => {
    const messages = [
      makeMessage("user", "Hello"),
      makeMessage("assistant", "Hi"),
      makeMessage("user", "Thanks"),
    ];
    trimMessagesIfNeeded(messages, 100000);

    // Content should be unchanged
    expect(messages[0].content).toBe("Hello");
  });

  it("should include accurate removed message count in notice", () => {
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

  it("should truncate first message for ≤3 messages over budget", () => {
    const messages = [
      makeMessage("user", "x".repeat(50000)),
      makeMessage("assistant", "y".repeat(50000)),
      makeMessage("user", "z".repeat(50000)),
    ];
    const result = trimMessagesIfNeeded(messages, 1);
    expect(result).not.toBeNull();
    expect(result!.removedTokens).toBeGreaterThan(0);
    // First message truncated + notice injected
    const firstContent = messages[0].content as string;
    expect(firstContent).toContain("[Content truncated:");
    expect(firstContent).toContain(
      "[System: Earlier conversation context was trimmed",
    );
  });
});

// ============================================================================
// truncateStringContent — boundary cases (tested via trimMessagesIfNeeded)
// ============================================================================

describe("truncateStringContent — boundary cases via trimMessagesIfNeeded", () => {
  it("should handle extremely tight budget forcing near-zero targetChars", () => {
    // Budget of 1 token with 3 messages → first message gets targetChars near 0
    const messages = [
      makeMessage("user", "a".repeat(1000)),
      makeMessage("assistant", "b".repeat(100)),
      makeMessage("user", "c".repeat(100)),
    ];
    // Budget so low that first message truncation leads to targetChars ≈ 0
    const result = trimMessagesIfNeeded(messages, 1);
    expect(result).not.toBeNull();
    // Should not crash; first message gets a truncation marker
    const firstContent = messages[0].content as string;
    expect(firstContent).toContain("[Content truncated:");
  });

  it("should preserve truncation marker even when content is very short", () => {
    const messages = [
      makeMessage("user", "tiny"),
      makeMessage("assistant", "b".repeat(5000)),
      makeMessage("user", "c".repeat(5000)),
    ];
    trimMessagesIfNeeded(messages, 10);
    // Even short content that gets truncated should have the marker
    const firstContent = messages[0].content as string;
    expect(firstContent).toContain("[Content truncated:");
  });
});

// ============================================================================
// truncateArrayContent — boundary cases (tested via trimMessagesIfNeeded)
// ============================================================================

describe("truncateArrayContent — boundary cases via trimMessagesIfNeeded", () => {
  it("should handle single-block array content that exceeds budget", () => {
    // First message has a single large tool_result block
    const messages: Anthropic.MessageParam[] = [
      {
        role: "user",
        content: [
          {
            type: "tool_result" as const,
            tool_use_id: "t-1",
            content: "a".repeat(200_000), // huge single block
          },
        ],
      },
      makeMessage("assistant", "b".repeat(1000)),
      makeMessage("user", "c".repeat(1000)),
    ];
    const budget = 5000;

    const result = trimMessagesIfNeeded(messages, budget);

    expect(result).not.toBeNull();
    expect(messages).toHaveLength(3);
    // Single block can't be removed (result.length > 1 guard), so it remains
    // but the content may be serialized/handled without crash
    const firstContent = messages[0].content;
    expect(Array.isArray(firstContent)).toBe(true);
  });

  it("should remove earlier blocks before truncating remaining text block", () => {
    // First message has 3 blocks: two large tool_results + one text
    const messages: Anthropic.MessageParam[] = [
      {
        role: "user",
        content: [
          {
            type: "tool_result" as const,
            tool_use_id: "t-1",
            content: "x".repeat(50_000),
          },
          {
            type: "tool_result" as const,
            tool_use_id: "t-2",
            content: "y".repeat(50_000),
          },
          { type: "text" as const, text: "Analyze both results please" },
        ],
      },
      makeMessage("assistant", "short reply"),
      makeMessage("user", "short followup"),
    ];
    const budget = 5000;

    const result = trimMessagesIfNeeded(messages, budget);

    expect(result).not.toBeNull();
    // First block(s) should have been removed, leaving fewer blocks
    const firstContent = messages[0].content;
    expect(Array.isArray(firstContent)).toBe(true);
    const blocks = firstContent as Array<Record<string, unknown>>;
    // At least 1 block should remain (the text or a truncated version) + notice
    expect(blocks.length).toBeGreaterThanOrEqual(1);
  });

  it("should handle array content with only text blocks", () => {
    const messages: Anthropic.MessageParam[] = [
      {
        role: "user",
        content: [
          { type: "text" as const, text: "a".repeat(100_000) },
          { type: "text" as const, text: "b".repeat(100_000) },
        ],
      },
      makeMessage("assistant", "c".repeat(10_000)),
      makeMessage("user", "d".repeat(10_000)),
    ];
    const budget = 10_000;

    const result = trimMessagesIfNeeded(messages, budget);

    expect(result).not.toBeNull();
    expect(messages).toHaveLength(3);
    const firstContent = messages[0].content;
    expect(Array.isArray(firstContent)).toBe(true);
  });
});
