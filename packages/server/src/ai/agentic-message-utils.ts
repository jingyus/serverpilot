// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/** Message trimming and token estimation utilities for the Agentic Chat Engine. */

import type Anthropic from '@anthropic-ai/sdk';
import { estimateTokens } from './profile-context.js';
import { logger } from '../utils/logger.js';

/** Extract text from a content block for token estimation. */
function extractBlockText(block: Record<string, unknown>): string {
  if ('text' in block && typeof block.text === 'string') {
    return block.text;
  }
  if ('content' in block && typeof block.content === 'string') {
    return block.content;
  }
  // tool_use input or other structured data — serialize for estimation
  return JSON.stringify(block);
}

/** Estimate total token count of the messages array (CJK-aware). */
export function estimateMessagesTokens(messages: Anthropic.MessageParam[]): number {
  let tokens = 0;
  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      tokens += estimateTokens(msg.content);
    } else if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        const text = extractBlockText(block as Record<string, unknown>);
        tokens += estimateTokens(text);
      }
    }
  }
  return tokens;
}

/** Result of a trim operation, or null if no trimming occurred. */
export interface TrimResult {
  removedMessages: number;
  removedTokens: number;
}

/**
 * Trim messages in-place if over token budget, keeping first message and newest pairs.
 * After trimming, injects a context-loss notice into the first user message so the AI
 * model is aware that earlier tool results and conversation turns were removed.
 * Returns a TrimResult if trimming occurred, or null otherwise.
 */
export function trimMessagesIfNeeded(
  messages: Anthropic.MessageParam[],
  maxTokens: number,
): TrimResult | null {
  if (messages.length <= 3) return null; // first user + one turn pair minimum

  const tokensBefore = estimateMessagesTokens(messages);
  if (tokensBefore <= maxTokens) return null;

  const lengthBefore = messages.length;

  // Remove pairs from index 1 (after the first user message) until under budget.
  // Each "pair" is an assistant message + a user message (tool results).
  // Recalculate total after each splice to avoid cumulative estimation drift.
  while (messages.length > 3) {
    messages.splice(1, 2);
    if (estimateMessagesTokens(messages) <= maxTokens) break;
  }

  const tokensAfter = estimateMessagesTokens(messages);
  const removedMessages = lengthBefore - messages.length;
  const removedTokens = tokensBefore - tokensAfter;

  // Inject context-loss notice into the first user message so the model
  // knows earlier conversation context was truncated.
  const removedTokensK = Math.round(removedTokens / 1000);
  const notice =
    `[System: Earlier conversation context was trimmed to fit the context window. ` +
    `${removedMessages} messages (~${removedTokensK}K tokens) were removed. ` +
    `Recent tool results and file contents from those turns are no longer available. ` +
    `If you need information from earlier steps, re-read the relevant files.]`;

  const firstMsg = messages[0];
  if (typeof firstMsg.content === 'string') {
    messages[0] = { role: 'user', content: firstMsg.content + '\n\n' + notice };
  } else if (Array.isArray(firstMsg.content)) {
    messages[0] = {
      role: 'user',
      content: [...firstMsg.content, { type: 'text' as const, text: notice }],
    };
  }

  logger.debug(
    { operation: 'trim_messages', removedMessages, removedTokens, remainingMessages: messages.length, remainingTokens: tokensAfter },
    `Trimmed ${removedMessages} messages (~${removedTokensK}K tokens) from conversation context`,
  );

  return { removedMessages, removedTokens };
}
