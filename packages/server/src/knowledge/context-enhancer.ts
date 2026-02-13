// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Context enhancer module for adding knowledge base search results to AI prompts.
 *
 * Takes similarity search results and formats them into a structured context
 * block that can be appended to AI prompts. Handles result formatting,
 * context window management, and priority-based truncation.
 *
 * Search pipeline: query → embed → search → rank/filter → **enhance prompt**
 *
 * @module knowledge/context-enhancer
 */

import type { SimilarityResult, SearchResponse } from './similarity-search.js';
import {
  estimateTokens,
  getCharsPerToken,
} from '../ai/profile-context.js';

// ============================================================================
// Types
// ============================================================================

/** Options for formatting knowledge context */
export interface ContextEnhancerOptions {
  /** Maximum total character length for the knowledge context block (default: 4000) */
  maxContextLength?: number;
  /** Whether to include similarity scores in the output (default: false) */
  includeScores?: boolean;
  /** Whether to include document source IDs (default: true) */
  includeSources?: boolean;
  /** Whether to include heading context (default: true) */
  includeHeadings?: boolean;
  /** Header text for the knowledge context section (default: 'Relevant Knowledge Base Context') */
  sectionHeader?: string;
  /** Separator between individual results (default: '\n---\n') */
  resultSeparator?: string;
  /** Minimum score to include a result (default: 0) */
  minScore?: number;
  /** Maximum number of results to include (default: Infinity) */
  maxResults?: number;
}

/** A formatted context block ready for prompt injection */
export interface FormattedContext {
  /** The formatted text block to inject into a prompt */
  text: string;
  /** Number of results included */
  resultCount: number;
  /** Number of results truncated due to length limit */
  truncatedCount: number;
  /** Total character length of the formatted text */
  totalLength: number;
  /** Whether any results were truncated */
  wasTruncated: boolean;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_MAX_CONTEXT_LENGTH = 4000;
const DEFAULT_SECTION_HEADER = 'Relevant Knowledge Base Context';
const DEFAULT_RESULT_SEPARATOR = '\n---\n';

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Format a single search result into a text block.
 *
 * @param result - The similarity search result
 * @param options - Formatting options
 * @returns Formatted text for this result
 */
export function formatSearchResult(
  result: SimilarityResult,
  options: ContextEnhancerOptions = {},
): string {
  const includeScores = options.includeScores ?? false;
  const includeSources = options.includeSources ?? true;
  const includeHeadings = options.includeHeadings ?? true;

  const parts: string[] = [];

  // Heading line
  if (includeHeadings && result.headingContext) {
    if (includeScores) {
      parts.push(`[${result.category}] ${result.headingContext} (score: ${result.score.toFixed(2)})`);
    } else {
      parts.push(`[${result.category}] ${result.headingContext}`);
    }
  } else if (includeScores) {
    parts.push(`[${result.category}] (score: ${result.score.toFixed(2)})`);
  } else {
    parts.push(`[${result.category}]`);
  }

  // Content
  parts.push(result.content);

  // Source reference
  if (includeSources) {
    parts.push(`Source: ${result.documentId}`);
  }

  return parts.join('\n');
}

/**
 * Format multiple search results into a knowledge context block.
 *
 * Results are formatted with headers and separators, then truncated
 * if the total exceeds the maximum context length. Truncation removes
 * lower-scored results first (assumes results are pre-sorted by score
 * descending).
 *
 * @param results - Array of similarity search results (should be sorted by score desc)
 * @param options - Formatting options
 * @returns Formatted context block with metadata
 *
 * @example
 * ```ts
 * const context = formatKnowledgeContext(searchResponse.results, {
 *   maxContextLength: 3000,
 *   includeScores: true,
 * });
 * const enhancedPrompt = `${originalPrompt}\n\n${context.text}`;
 * ```
 */
export function formatKnowledgeContext(
  results: SimilarityResult[],
  options: ContextEnhancerOptions = {},
): FormattedContext {
  const maxLength = options.maxContextLength ?? DEFAULT_MAX_CONTEXT_LENGTH;
  const separator = options.resultSeparator ?? DEFAULT_RESULT_SEPARATOR;
  const header = options.sectionHeader ?? DEFAULT_SECTION_HEADER;
  const minScore = options.minScore ?? 0;
  const maxResults = options.maxResults ?? Infinity;

  // Filter by minimum score
  let filtered = results.filter((r) => r.score >= minScore);

  // Limit by maxResults
  if (filtered.length > maxResults) {
    filtered = filtered.slice(0, maxResults);
  }

  if (filtered.length === 0) {
    return {
      text: '',
      resultCount: 0,
      truncatedCount: 0,
      totalLength: 0,
      wasTruncated: false,
    };
  }

  // Format each result
  const formattedResults = filtered.map((r) => formatSearchResult(r, options));

  // Build incrementally, respecting max length
  const headerLine = `\n${header}:\n`;
  let currentLength = headerLine.length;
  const includedResults: string[] = [];
  let truncatedCount = 0;

  for (const formatted of formattedResults) {
    const addLength = formatted.length + (includedResults.length > 0 ? separator.length : 0);

    if (currentLength + addLength > maxLength) {
      truncatedCount = formattedResults.length - includedResults.length;
      break;
    }

    includedResults.push(formatted);
    currentLength += addLength;
  }

  if (includedResults.length === 0) {
    return {
      text: '',
      resultCount: 0,
      truncatedCount: formattedResults.length,
      totalLength: 0,
      wasTruncated: true,
    };
  }

  let text = headerLine + includedResults.join(separator);

  if (truncatedCount > 0) {
    text += `\n\n(${truncatedCount} additional result(s) omitted due to context length limit)`;
  }

  return {
    text,
    resultCount: includedResults.length,
    truncatedCount,
    totalLength: text.length,
    wasTruncated: truncatedCount > 0,
  };
}

/**
 * Enhance an existing prompt by appending knowledge base search results.
 *
 * Combines the original prompt with formatted knowledge context.
 * If no results are available or all are below threshold, returns the
 * original prompt unchanged.
 *
 * @param prompt - The original AI prompt
 * @param results - Similarity search results to inject
 * @param options - Context formatting options
 * @returns Enhanced prompt with knowledge context appended
 *
 * @example
 * ```ts
 * const enhanced = enhancePromptWithContext(
 *   buildEnvAnalysisPrompt(env, 'openclaw'),
 *   searchResponse.results,
 *   { maxContextLength: 3000, includeScores: true },
 * );
 * ```
 */
export function enhancePromptWithContext(
  prompt: string,
  results: SimilarityResult[],
  options: ContextEnhancerOptions = {},
): string {
  const context = formatKnowledgeContext(results, options);

  if (context.resultCount === 0) {
    return prompt;
  }

  return prompt + context.text;
}

/**
 * Enhance a prompt using a full SearchResponse.
 *
 * Convenience wrapper over `enhancePromptWithContext` that accepts
 * a SearchResponse object directly.
 *
 * @param prompt - The original AI prompt
 * @param searchResponse - Full search response from SimilaritySearch
 * @param options - Context formatting options
 * @returns Enhanced prompt with knowledge context appended
 */
export function enhancePromptWithSearchResponse(
  prompt: string,
  searchResponse: SearchResponse,
  options: ContextEnhancerOptions = {},
): string {
  return enhancePromptWithContext(prompt, searchResponse.results, options);
}

/**
 * CJK-aware token estimation (re-exported from profile-context).
 *
 * Uses language-aware heuristics:
 * - English/ASCII text: ~4 chars per token
 * - CJK text (Chinese/Japanese/Korean): ~1.5 chars per token
 * - Mixed text: weighted average based on CJK proportion
 *
 * @param text - The text to estimate tokens for
 * @returns Estimated token count
 */
export const estimateTokenCount = estimateTokens;

/**
 * Calculate the maximum context length based on a total token budget.
 *
 * Given a prompt and a total token budget, calculates how many characters
 * can be allocated to the knowledge context block. Uses the prompt's own
 * CJK proportion to estimate the chars-per-token ratio for the budget.
 *
 * @param prompt - The base prompt (before context injection)
 * @param totalTokenBudget - Total token budget for prompt + context
 * @param reservedTokens - Tokens reserved for the AI response (default: 1024)
 * @returns Maximum character length for context, or 0 if budget exhausted
 */
export function calculateContextBudget(
  prompt: string,
  totalTokenBudget: number,
  reservedTokens: number = 1024,
): number {
  const promptTokens = estimateTokenCount(prompt);
  const availableTokens = totalTokenBudget - promptTokens - reservedTokens;

  if (availableTokens <= 0) {
    return 0;
  }

  // Convert tokens back to approximate character count using CJK-aware ratio
  const charsPerToken = getCharsPerToken(prompt);
  return Math.floor(availableTokens * charsPerToken);
}
