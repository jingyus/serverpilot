// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Context window manager for AI prompt composition.
 *
 * Manages the total token budget for an AI request, allocating tokens across
 * multiple components: system prompt, conversation history, knowledge context,
 * and response reserve. Implements priority-based truncation strategies to
 * ensure the composed prompt fits within model-specific context window limits.
 *
 * This module sits between the knowledge search pipeline and the AI agent,
 * ensuring that prompts never exceed the model's context window while
 * maximizing the useful information included.
 *
 * Pipeline: search results + prompt + history → **manage window** → composed prompt
 *
 * @module knowledge/context-window-manager
 */

import { getCharsPerToken } from '../ai/profile-context.js';
import type { SimilarityResult } from './similarity-search.js';
import {
  formatKnowledgeContext,
  estimateTokenCount,
  type ContextEnhancerOptions,
  type FormattedContext,
} from './context-enhancer.js';

// ============================================================================
// Types
// ============================================================================

/** Known model context window sizes (in tokens) */
export interface ModelContextLimits {
  /** Maximum total tokens (input + output) for the model */
  maxTokens: number;
  /** Default max output tokens the model supports */
  defaultMaxOutputTokens: number;
}

/** A message in the conversation history */
export interface ConversationMessage {
  /** Role of the message sender */
  role: 'system' | 'user' | 'assistant';
  /** Message content */
  content: string;
  /** Estimated token count (will be computed if not provided) */
  tokenCount?: number;
}

/** How to handle truncation when the context window is exceeded */
export type TruncationStrategy =
  | 'drop-oldest'      // Drop oldest messages first (keep recent context)
  | 'drop-middle'      // Keep first and last messages, drop middle ones
  | 'keep-latest'      // Keep only the latest N messages that fit
  | 'none';            // No truncation, throw error if exceeded

/** Configuration for the ContextWindowManager */
export interface ContextWindowConfig {
  /** The model identifier (used to look up context limits) */
  model: string;
  /** Override the default max tokens for the model */
  maxTotalTokens?: number;
  /** Tokens reserved for the AI response (default: 4096) */
  reservedOutputTokens?: number;
  /** Maximum percentage of input budget for knowledge context (default: 0.4 = 40%) */
  maxKnowledgeRatio?: number;
  /** Truncation strategy for conversation history (default: 'drop-oldest') */
  truncationStrategy?: TruncationStrategy;
  /** Minimum number of messages to keep when truncating (default: 2) */
  minMessagesToKeep?: number;
}

/** Token allocation breakdown for a composed prompt */
export interface TokenAllocation {
  /** Tokens used by the system prompt */
  systemPromptTokens: number;
  /** Tokens used by conversation history */
  conversationTokens: number;
  /** Tokens used by knowledge context */
  knowledgeContextTokens: number;
  /** Tokens reserved for AI response */
  reservedOutputTokens: number;
  /** Total tokens allocated */
  totalAllocated: number;
  /** Remaining tokens available */
  remainingTokens: number;
  /** Total context window size */
  maxTokens: number;
  /** Whether any content was truncated */
  wasTruncated: boolean;
  /** Number of messages dropped from history */
  messagesDropped: number;
  /** Number of knowledge results dropped */
  knowledgeResultsDropped: number;
}

/** Result of composing a prompt within the context window */
export interface ComposedPrompt {
  /** The system prompt */
  systemPrompt: string;
  /** Conversation messages that fit within the window */
  messages: ConversationMessage[];
  /** The formatted knowledge context to append to the user prompt */
  knowledgeContext: string;
  /** Token allocation breakdown */
  allocation: TokenAllocation;
}

// ============================================================================
// Constants
// ============================================================================

/** Default output token reservation */
const DEFAULT_RESERVED_OUTPUT_TOKENS = 4096;

/** Default maximum ratio of input budget for knowledge context */
const DEFAULT_MAX_KNOWLEDGE_RATIO = 0.4;

/** Default minimum messages to keep when truncating */
const DEFAULT_MIN_MESSAGES_TO_KEEP = 2;

/** Known model context window limits */
export const MODEL_CONTEXT_LIMITS: Record<string, ModelContextLimits> = {
  'claude-sonnet-4-20250514': {
    maxTokens: 200000,
    defaultMaxOutputTokens: 8192,
  },
  'claude-haiku-3-5-20241022': {
    maxTokens: 200000,
    defaultMaxOutputTokens: 8192,
  },
  'claude-opus-4-20250514': {
    maxTokens: 200000,
    defaultMaxOutputTokens: 8192,
  },
};

/** Default context limits for unknown models */
const DEFAULT_CONTEXT_LIMITS: ModelContextLimits = {
  maxTokens: 100000,
  defaultMaxOutputTokens: 4096,
};

// ============================================================================
// ContextWindowManager
// ============================================================================

/**
 * Manages the context window for AI prompt composition.
 *
 * Allocates tokens across system prompt, conversation history, knowledge
 * context, and response reserve. Automatically truncates content to fit
 * within the model's context window.
 *
 * @example
 * ```ts
 * const manager = new ContextWindowManager({ model: 'claude-sonnet-4-20250514' });
 *
 * const composed = manager.compose({
 *   systemPrompt: 'You are a helpful assistant.',
 *   messages: conversationHistory,
 *   knowledgeResults: searchResults,
 *   userPrompt: 'How do I install openclaw?',
 * });
 *
 * // Use composed.systemPrompt, composed.messages, composed.knowledgeContext
 * // for the API call
 * ```
 */
export class ContextWindowManager {
  private readonly model: string;
  private readonly maxTotalTokens: number;
  private readonly reservedOutputTokens: number;
  private readonly maxKnowledgeRatio: number;
  private readonly truncationStrategy: TruncationStrategy;
  private readonly minMessagesToKeep: number;

  constructor(config: ContextWindowConfig) {
    this.model = config.model;
    const limits = getModelLimits(config.model);
    this.maxTotalTokens = config.maxTotalTokens ?? limits.maxTokens;
    this.reservedOutputTokens = config.reservedOutputTokens ?? DEFAULT_RESERVED_OUTPUT_TOKENS;
    this.maxKnowledgeRatio = config.maxKnowledgeRatio ?? DEFAULT_MAX_KNOWLEDGE_RATIO;
    this.truncationStrategy = config.truncationStrategy ?? 'drop-oldest';
    this.minMessagesToKeep = config.minMessagesToKeep ?? DEFAULT_MIN_MESSAGES_TO_KEEP;
  }

  /**
   * Get the maximum input tokens available (total minus output reservation).
   */
  get maxInputTokens(): number {
    return this.maxTotalTokens - this.reservedOutputTokens;
  }

  /**
   * Compose a prompt that fits within the context window.
   *
   * Allocates tokens in this priority order:
   * 1. System prompt (always fully included)
   * 2. Reserved output tokens
   * 3. Knowledge context (up to maxKnowledgeRatio of remaining budget)
   * 4. Conversation history (truncated if needed)
   *
   * @param params - The components to compose
   * @returns A composed prompt with allocation details
   */
  compose(params: {
    systemPrompt: string;
    messages?: ConversationMessage[];
    knowledgeResults?: SimilarityResult[];
    knowledgeOptions?: ContextEnhancerOptions;
  }): ComposedPrompt {
    const { systemPrompt, messages = [], knowledgeResults = [] } = params;

    // Step 1: Calculate system prompt tokens (always included in full)
    const systemTokens = estimateTokenCount(systemPrompt);

    // Step 2: Calculate available input budget
    const inputBudget = this.maxInputTokens;
    let remainingBudget = inputBudget - systemTokens;

    if (remainingBudget <= 0) {
      // System prompt alone exceeds budget - return with no context
      return {
        systemPrompt,
        messages: [],
        knowledgeContext: '',
        allocation: {
          systemPromptTokens: systemTokens,
          conversationTokens: 0,
          knowledgeContextTokens: 0,
          reservedOutputTokens: this.reservedOutputTokens,
          totalAllocated: systemTokens + this.reservedOutputTokens,
          remainingTokens: 0,
          maxTokens: this.maxTotalTokens,
          wasTruncated: messages.length > 0 || knowledgeResults.length > 0,
          messagesDropped: messages.length,
          knowledgeResultsDropped: knowledgeResults.length,
        },
      };
    }

    // Step 3: Allocate budget for knowledge context
    const maxKnowledgeTokens = Math.floor(remainingBudget * this.maxKnowledgeRatio);
    // Use CJK-aware ratio based on system prompt language mix
    const maxKnowledgeChars = Math.floor(maxKnowledgeTokens * getCharsPerToken(systemPrompt));

    // Step 4: Format knowledge context within budget
    let knowledgeContext = '';
    let knowledgeTokens = 0;
    let knowledgeResultsDropped = 0;

    if (knowledgeResults.length > 0) {
      const contextOptions: ContextEnhancerOptions = {
        ...params.knowledgeOptions,
        maxContextLength: maxKnowledgeChars,
      };
      const formatted: FormattedContext = formatKnowledgeContext(knowledgeResults, contextOptions);
      knowledgeContext = formatted.text;
      knowledgeTokens = estimateTokenCount(knowledgeContext);
      knowledgeResultsDropped = formatted.truncatedCount;
    }

    remainingBudget -= knowledgeTokens;

    // Step 5: Fit conversation messages within remaining budget
    const annotatedMessages = annotateMessages(messages);
    const { kept, dropped } = truncateMessages(
      annotatedMessages,
      remainingBudget,
      this.truncationStrategy,
      this.minMessagesToKeep,
    );

    const conversationTokens = kept.reduce((sum, m) => sum + m.tokenCount!, 0);

    const totalAllocated = systemTokens + conversationTokens + knowledgeTokens + this.reservedOutputTokens;

    return {
      systemPrompt,
      messages: kept,
      knowledgeContext,
      allocation: {
        systemPromptTokens: systemTokens,
        conversationTokens,
        knowledgeContextTokens: knowledgeTokens,
        reservedOutputTokens: this.reservedOutputTokens,
        totalAllocated,
        remainingTokens: this.maxTotalTokens - totalAllocated,
        maxTokens: this.maxTotalTokens,
        wasTruncated: dropped > 0 || knowledgeResultsDropped > 0,
        messagesDropped: dropped,
        knowledgeResultsDropped,
      },
    };
  }

  /**
   * Check if a prompt fits within the context window without composing.
   *
   * @param systemPrompt - The system prompt
   * @param messages - Conversation messages
   * @param knowledgeContext - Optional knowledge context string
   * @returns Whether the prompt fits and details about token usage
   */
  checkFit(params: {
    systemPrompt: string;
    messages?: ConversationMessage[];
    knowledgeContext?: string;
  }): { fits: boolean; totalTokens: number; maxInputTokens: number; overflow: number } {
    const systemTokens = estimateTokenCount(params.systemPrompt);
    const messageTokens = (params.messages ?? []).reduce(
      (sum, m) => sum + (m.tokenCount ?? estimateTokenCount(m.content)),
      0,
    );
    const knowledgeTokens = params.knowledgeContext
      ? estimateTokenCount(params.knowledgeContext)
      : 0;

    const totalTokens = systemTokens + messageTokens + knowledgeTokens;
    const maxInput = this.maxInputTokens;
    const overflow = Math.max(0, totalTokens - maxInput);

    return {
      fits: totalTokens <= maxInput,
      totalTokens,
      maxInputTokens: maxInput,
      overflow,
    };
  }

  /**
   * Get the token budget available for knowledge context given a system prompt and messages.
   *
   * @param systemPrompt - The system prompt
   * @param messages - Conversation messages
   * @returns Maximum tokens and characters available for knowledge context
   */
  getKnowledgeBudget(
    systemPrompt: string,
    messages: ConversationMessage[] = [],
  ): { maxTokens: number; maxChars: number } {
    const systemTokens = estimateTokenCount(systemPrompt);
    const messageTokens = messages.reduce(
      (sum, m) => sum + (m.tokenCount ?? estimateTokenCount(m.content)),
      0,
    );

    const remaining = this.maxInputTokens - systemTokens - messageTokens;
    if (remaining <= 0) {
      return { maxTokens: 0, maxChars: 0 };
    }

    const maxTokens = Math.min(
      Math.floor(remaining * this.maxKnowledgeRatio),
      remaining,
    );

    return { maxTokens, maxChars: Math.floor(maxTokens * getCharsPerToken(systemPrompt)) };
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get the context limits for a model.
 *
 * @param model - The model identifier
 * @returns Context window limits for the model
 */
export function getModelLimits(model: string): ModelContextLimits {
  return MODEL_CONTEXT_LIMITS[model] ?? DEFAULT_CONTEXT_LIMITS;
}

/**
 * Annotate messages with token counts if not already present.
 *
 * @param messages - Messages to annotate
 * @returns Messages with tokenCount populated
 */
function annotateMessages(messages: ConversationMessage[]): ConversationMessage[] {
  return messages.map((m) => ({
    ...m,
    tokenCount: m.tokenCount ?? estimateTokenCount(m.content),
  }));
}

/**
 * Truncate conversation messages to fit within a token budget.
 *
 * @param messages - Messages with token counts
 * @param budgetTokens - Maximum tokens for conversation
 * @param strategy - Truncation strategy to use
 * @param minKeep - Minimum messages to keep
 * @returns Kept messages and number dropped
 */
export function truncateMessages(
  messages: ConversationMessage[],
  budgetTokens: number,
  strategy: TruncationStrategy,
  minKeep: number,
): { kept: ConversationMessage[]; dropped: number } {
  if (messages.length === 0) {
    return { kept: [], dropped: 0 };
  }

  const totalTokens = messages.reduce((sum, m) => sum + m.tokenCount!, 0);

  // All messages fit
  if (totalTokens <= budgetTokens) {
    return { kept: [...messages], dropped: 0 };
  }

  // No truncation allowed
  if (strategy === 'none') {
    return { kept: [...messages], dropped: 0 };
  }

  switch (strategy) {
    case 'drop-oldest':
      return truncateDropOldest(messages, budgetTokens, minKeep);
    case 'drop-middle':
      return truncateDropMiddle(messages, budgetTokens, minKeep);
    case 'keep-latest':
      return truncateKeepLatest(messages, budgetTokens, minKeep);
    default:
      return truncateDropOldest(messages, budgetTokens, minKeep);
  }
}

/**
 * Drop oldest messages first until budget is met.
 */
function truncateDropOldest(
  messages: ConversationMessage[],
  budgetTokens: number,
  _minKeep: number,
): { kept: ConversationMessage[]; dropped: number } {
  // Work backwards from the end, accumulating messages
  const kept: ConversationMessage[] = [];
  let usedTokens = 0;

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (usedTokens + msg.tokenCount! <= budgetTokens) {
      kept.unshift(msg);
      usedTokens += msg.tokenCount!;
    }
  }

  return { kept, dropped: messages.length - kept.length };
}

/**
 * Keep first and last messages, drop middle ones.
 */
function truncateDropMiddle(
  messages: ConversationMessage[],
  budgetTokens: number,
  minKeep: number,
): { kept: ConversationMessage[]; dropped: number } {
  if (messages.length <= minKeep) {
    return { kept: [...messages], dropped: 0 };
  }

  // Always keep the first message and the last message
  const first = messages[0];
  const last = messages[messages.length - 1];
  const essentialTokens = first.tokenCount! + (messages.length > 1 ? last.tokenCount! : 0);

  if (essentialTokens > budgetTokens) {
    // Even first + last don't fit, keep only the last
    if (last.tokenCount! <= budgetTokens) {
      return { kept: [last], dropped: messages.length - 1 };
    }
    return { kept: [], dropped: messages.length };
  }

  if (messages.length <= 2) {
    return { kept: [first, last], dropped: 0 };
  }

  // Add messages from the end (before last), working backwards
  let remainingBudget = budgetTokens - essentialTokens;
  const middleKept: ConversationMessage[] = [];

  // Add from the end (most recent messages are most relevant)
  for (let i = messages.length - 2; i >= 1; i--) {
    const msg = messages[i];
    if (msg.tokenCount! <= remainingBudget) {
      middleKept.unshift(msg);
      remainingBudget -= msg.tokenCount!;
    }
  }

  const kept = [first, ...middleKept, last];
  return { kept, dropped: messages.length - kept.length };
}

/**
 * Keep only the latest N messages that fit.
 */
function truncateKeepLatest(
  messages: ConversationMessage[],
  budgetTokens: number,
  _minKeep: number,
): { kept: ConversationMessage[]; dropped: number } {
  const kept: ConversationMessage[] = [];
  let usedTokens = 0;

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (usedTokens + msg.tokenCount! <= budgetTokens) {
      kept.unshift(msg);
      usedTokens += msg.tokenCount!;
    } else {
      break; // Stop when we can't fit any more
    }
  }

  return { kept, dropped: messages.length - kept.length };
}
