// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/** Message trimming and token estimation utilities for the Agentic Chat Engine. */

import type Anthropic from '@anthropic-ai/sdk';
import { estimateTokens, getCharsPerToken } from './profile-context.js';
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
        const text = extractBlockText(block as unknown as Record<string, unknown>);
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
 * Truncate a string content to fit within a target character length.
 * Keeps the tail (most recent context) and prepends a truncation marker.
 */
function truncateStringContent(content: string, targetChars: number): string {
  if (content.length <= targetChars) return content;
  const removedChars = content.length - targetChars;
  const removedK = Math.round(removedChars / 1000);
  const marker = `[Content truncated: ~${removedK}K chars removed from start]\n\n`;
  // Reserve space for the marker itself, keep the tail
  const keepChars = Math.max(0, targetChars - marker.length);
  if (keepChars === 0) return marker;
  return marker + content.slice(-keepChars);
}

/**
 * Truncate array content blocks to fit within a target token budget.
 * Removes earliest blocks first; if still over budget, truncates the first remaining text block.
 */
function truncateArrayContent(
  blocks: Anthropic.ContentBlockParam[],
  excessTokens: number,
): Anthropic.ContentBlockParam[] {
  const result = [...blocks];
  let remaining = excessTokens;

  // Remove blocks from the front until we've freed enough tokens
  while (result.length > 1 && remaining > 0) {
    const block = result[0];
    const text = extractBlockText(block as unknown as Record<string, unknown>);
    const blockTokens = estimateTokens(text);
    result.shift();
    remaining -= blockTokens;
  }

  // If still over budget and there's a text block, truncate it
  if (remaining > 0 && result.length > 0) {
    const first = result[0] as unknown as Record<string, unknown>;
    if ('text' in first && typeof first.text === 'string') {
      const charsPerToken = getCharsPerToken(first.text);
      const charsToRemove = Math.ceil(remaining * charsPerToken);
      result[0] = {
        type: 'text' as const,
        text: truncateStringContent(first.text, first.text.length - charsToRemove),
      };
    }
  }

  return result;
}

/**
 * Trim messages in-place if over token budget, keeping first message and newest pairs.
 * After trimming, if the remaining 3 messages still exceed the budget, the first
 * message's content is truncated to fit. Injects a context-loss notice into the
 * first user message so the AI model is aware that context was removed.
 * Returns a TrimResult if trimming or truncation occurred, or null otherwise.
 */
export function trimMessagesIfNeeded(
  messages: Anthropic.MessageParam[],
  maxTokens: number,
): TrimResult | null {
  const tokensBefore = estimateMessagesTokens(messages);
  if (tokensBefore <= maxTokens) return null;
  if (messages.length <= 1) return null; // single message, nothing we can do

  const lengthBefore = messages.length;

  // Remove pairs from index 1 (after the first user message) until under budget.
  // Each "pair" is an assistant message + a user message (tool results).
  // Recalculate total after each splice to avoid cumulative estimation drift.
  while (messages.length > 3) {
    messages.splice(1, 2);
    if (estimateMessagesTokens(messages) <= maxTokens) break;
  }

  // Post-loop check: if remaining messages still exceed budget, truncate the
  // first message's content to fit. This handles the case where 3 messages
  // contain very large content (e.g. 50K file paste + 110K recent turn).
  let tokensAfter = estimateMessagesTokens(messages);
  if (tokensAfter > maxTokens) {
    const excessTokens = tokensAfter - maxTokens;
    const firstMsg = messages[0];

    if (typeof firstMsg.content === 'string') {
      const charsPerToken = getCharsPerToken(firstMsg.content);
      const targetChars = firstMsg.content.length - Math.ceil(excessTokens * charsPerToken);
      messages[0] = {
        role: firstMsg.role,
        content: truncateStringContent(firstMsg.content, Math.max(0, targetChars)),
      };
    } else if (Array.isArray(firstMsg.content)) {
      messages[0] = {
        role: firstMsg.role,
        content: truncateArrayContent(
          firstMsg.content as Anthropic.ContentBlockParam[],
          excessTokens,
        ),
      };
    }

    tokensAfter = estimateMessagesTokens(messages);
    logger.debug(
      { operation: 'truncate_first_message', excessTokens, remainingTokens: tokensAfter },
      `Truncated first message to fit token budget (excess was ~${Math.round(excessTokens / 1000)}K tokens)`,
    );
  }

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
      content: [...(firstMsg.content as Anthropic.ContentBlockParam[]), { type: 'text' as const, text: notice }],
    };
  }

  logger.debug(
    { operation: 'trim_messages', removedMessages, removedTokens, remainingMessages: messages.length, remainingTokens: tokensAfter },
    `Trimmed ${removedMessages} messages (~${removedTokensK}K tokens) from conversation context`,
  );

  return { removedMessages, removedTokens };
}
