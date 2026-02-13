// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Dynamic context budget calculator.
 *
 * Computes how many tokens the conversation history can safely use
 * given the model's context window, the system prompt size, and
 * reserved output tokens. Prevents prompt overflow on small-context
 * models (e.g. Ollama with 4K-8K windows).
 *
 * @module ai/context-budget
 */

import { estimateTokens } from './profile-context.js';

// ============================================================================
// Types
// ============================================================================

export interface ContextBudgetParams {
  /** Model context window size in tokens */
  contextWindowSize: number;
  /** System prompt text (base + profile + caveats + knowledge) */
  systemPrompt: string;
  /** User message text */
  userMessage: string;
  /** Server label text (e.g. "Server: web-01") */
  serverLabel: string;
  /** Tokens reserved for AI output generation (default: 4096) */
  reservedOutputTokens?: number;
}

export interface ContextBudgetResult {
  /** Maximum tokens available for conversation history */
  maxConversationTokens: number;
  /** Breakdown of token allocation (for logging/debugging) */
  breakdown: {
    contextWindow: number;
    systemPrompt: number;
    userMessage: number;
    serverLabel: number;
    reservedOutput: number;
    available: number;
  };
}

// ============================================================================
// Constants
// ============================================================================

/** Default tokens reserved for AI output */
const DEFAULT_RESERVED_OUTPUT_TOKENS = 4096;

/**
 * Minimum conversation history budget (tokens).
 * Even on very small models, we keep at least some history context.
 */
const MIN_CONVERSATION_TOKENS = 200;

/**
 * Formatting overhead per message in conversation context.
 * Accounts for "role: " prefix and "\n\n" separator between messages.
 */
const FORMATTING_OVERHEAD_TOKENS = 10;

// ============================================================================
// Calculator
// ============================================================================

/**
 * Calculate the dynamic token budget for conversation history.
 *
 * Formula:
 *   available = contextWindow - systemPrompt - userMessage - serverLabel
 *               - reservedOutput - formattingOverhead
 *
 * Returns at least MIN_CONVERSATION_TOKENS to ensure some history is kept.
 *
 * @param params - Budget calculation parameters
 * @returns Budget result with max tokens and breakdown
 */
export function calculateConversationBudget(
  params: ContextBudgetParams,
): ContextBudgetResult {
  const {
    contextWindowSize,
    systemPrompt,
    userMessage,
    serverLabel,
    reservedOutputTokens = DEFAULT_RESERVED_OUTPUT_TOKENS,
  } = params;

  const systemPromptTokens = estimateTokens(systemPrompt);
  const userMessageTokens = estimateTokens(userMessage);
  const serverLabelTokens = estimateTokens(serverLabel);

  const available = contextWindowSize
    - systemPromptTokens
    - userMessageTokens
    - serverLabelTokens
    - reservedOutputTokens
    - FORMATTING_OVERHEAD_TOKENS;

  const maxConversationTokens = Math.max(MIN_CONVERSATION_TOKENS, available);

  return {
    maxConversationTokens,
    breakdown: {
      contextWindow: contextWindowSize,
      systemPrompt: systemPromptTokens,
      userMessage: userMessageTokens,
      serverLabel: serverLabelTokens,
      reservedOutput: reservedOutputTokens,
      available: maxConversationTokens,
    },
  };
}
