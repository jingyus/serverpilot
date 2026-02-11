// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Retrieval result optimizer for intelligent knowledge base usage.
 *
 * Sits between the search pipeline and the AI agent to optimize how
 * search results are selected, deduplicated, and prioritized before
 * being injected into AI prompts. Adapts retrieval strategy based on
 * the specific use case (environment analysis, error diagnosis, fix suggestion).
 *
 * Pipeline: search → filter → **optimize** → enhance prompt → AI
 *
 * Key optimizations:
 * - Context-aware category prioritization per use case
 * - Content deduplication via similarity detection
 * - Diversity enforcement across categories
 * - Token-budget-aware result selection
 * - Relevance re-ranking based on query intent
 *
 * @module knowledge/retrieval-optimizer
 */

import type { SimilarityResult, SearchResponse } from './similarity-search.js';
import { estimateTokenCount } from './context-enhancer.js';

// ============================================================================
// Types
// ============================================================================

/** The type of AI operation that will consume the search results */
export type RetrievalIntent =
  | 'environment-analysis'
  | 'error-diagnosis'
  | 'fix-suggestion'
  | 'install-plan'
  | 'general';

/** Configuration for the retrieval optimizer */
export interface RetrievalOptimizerConfig {
  /** The intent of the retrieval (determines category priorities) */
  intent: RetrievalIntent;
  /** Maximum number of results to return (default: 5) */
  maxResults?: number;
  /** Maximum total token budget for all results (default: 2000) */
  maxTokenBudget?: number;
  /** Minimum similarity score to include (default: 0.1) */
  minScore?: number;
  /** Whether to enforce category diversity (default: true) */
  enforceDiversity?: boolean;
  /** Minimum number of unique categories in results (default: 2) */
  minCategories?: number;
  /** Similarity threshold for deduplication (0-1, default: 0.7) */
  deduplicationThreshold?: number;
  /** Custom category priority overrides (higher = more important) */
  categoryPriorityOverrides?: Record<string, number>;
}

/** Statistics about the optimization process */
export interface OptimizationStats {
  /** Number of input results */
  inputCount: number;
  /** Number of results after optimization */
  outputCount: number;
  /** Number of results removed by deduplication */
  deduplicatedCount: number;
  /** Number of results removed by score filtering */
  filteredByScore: number;
  /** Number of results removed by token budget constraint */
  trimmedByBudget: number;
  /** Whether diversity enforcement was applied */
  diversityApplied: boolean;
  /** Total estimated tokens used by output results */
  totalTokens: number;
  /** Categories represented in the output */
  categoriesRepresented: string[];
}

/** Result of the optimization process */
export interface OptimizedResults {
  /** The optimized search results */
  results: SimilarityResult[];
  /** Statistics about the optimization */
  stats: OptimizationStats;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_MAX_RESULTS = 5;
const DEFAULT_MAX_TOKEN_BUDGET = 2000;
const DEFAULT_MIN_SCORE = 0.1;
const DEFAULT_MIN_CATEGORIES = 2;
const DEFAULT_DEDUP_THRESHOLD = 0.7;

/**
 * Category priority weights per retrieval intent.
 * Higher values = higher priority.
 */
export const INTENT_CATEGORY_PRIORITIES: Record<RetrievalIntent, Record<string, number>> = {
  'environment-analysis': {
    docs: 1.0,
    cases: 0.8,
    issues: 0.5,
    solutions: 0.4,
  },
  'error-diagnosis': {
    issues: 1.0,
    solutions: 0.9,
    docs: 0.5,
    cases: 0.6,
  },
  'fix-suggestion': {
    solutions: 1.0,
    issues: 0.8,
    cases: 0.7,
    docs: 0.4,
  },
  'install-plan': {
    docs: 1.0,
    cases: 0.7,
    solutions: 0.5,
    issues: 0.4,
  },
  general: {
    docs: 0.7,
    issues: 0.7,
    solutions: 0.7,
    cases: 0.7,
  },
};

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Optimize search results for a specific retrieval intent.
 *
 * Applies a multi-step optimization pipeline:
 * 1. Filter by minimum score
 * 2. Deduplicate overlapping content
 * 3. Re-rank based on intent-specific category priorities
 * 4. Enforce category diversity (optional)
 * 5. Trim to token budget
 * 6. Limit result count
 *
 * @param results - Raw similarity search results
 * @param config - Optimization configuration
 * @returns Optimized results with statistics
 *
 * @example
 * ```ts
 * const optimized = optimizeResults(searchResponse.results, {
 *   intent: 'error-diagnosis',
 *   maxResults: 5,
 *   maxTokenBudget: 2000,
 * });
 * // Use optimized.results for prompt enhancement
 * ```
 */
export function optimizeResults(
  results: SimilarityResult[],
  config: RetrievalOptimizerConfig,
): OptimizedResults {
  const maxResults = config.maxResults ?? DEFAULT_MAX_RESULTS;
  const maxTokenBudget = config.maxTokenBudget ?? DEFAULT_MAX_TOKEN_BUDGET;
  const minScore = config.minScore ?? DEFAULT_MIN_SCORE;
  const enforceDiversity = config.enforceDiversity ?? true;
  const minCategories = config.minCategories ?? DEFAULT_MIN_CATEGORIES;
  const dedupThreshold = config.deduplicationThreshold ?? DEFAULT_DEDUP_THRESHOLD;

  const inputCount = results.length;
  let working = [...results];

  // Step 1: Filter by minimum score
  const afterScoreFilter = working.filter((r) => r.score >= minScore);
  const filteredByScore = working.length - afterScoreFilter.length;
  working = afterScoreFilter;

  // Step 2: Deduplicate overlapping content
  const afterDedup = deduplicateByContent(working, dedupThreshold);
  const deduplicatedCount = working.length - afterDedup.length;
  working = afterDedup;

  // Step 3: Re-rank based on intent-specific priorities
  working = reRankByIntent(working, config.intent, config.categoryPriorityOverrides);

  // Step 4: Enforce category diversity
  let diversityApplied = false;
  if (enforceDiversity && working.length > minCategories) {
    const before = working.length;
    working = enforceCategoryDiversity(working, minCategories, maxResults);
    diversityApplied = working.length !== before || hasDiverseCategories(working, minCategories);
  }

  // Step 5: Trim to token budget
  const { kept, trimmed } = trimToTokenBudget(working, maxTokenBudget);
  working = kept;
  const trimmedByBudget = trimmed;

  // Step 6: Limit result count
  if (working.length > maxResults) {
    working = working.slice(0, maxResults);
  }

  const totalTokens = working.reduce((sum, r) => sum + estimateTokenCount(r.content), 0);
  const categoriesRepresented = [...new Set(working.map((r) => r.category))];

  return {
    results: working,
    stats: {
      inputCount,
      outputCount: working.length,
      deduplicatedCount,
      filteredByScore,
      trimmedByBudget,
      diversityApplied,
      totalTokens,
      categoriesRepresented,
    },
  };
}

/**
 * Optimize results from a full SearchResponse.
 *
 * Convenience wrapper over `optimizeResults` that accepts a SearchResponse directly.
 *
 * @param searchResponse - Full search response from SimilaritySearch
 * @param config - Optimization configuration
 * @returns Optimized results with statistics
 */
export function optimizeSearchResponse(
  searchResponse: SearchResponse,
  config: RetrievalOptimizerConfig,
): OptimizedResults {
  return optimizeResults(searchResponse.results, config);
}

/**
 * Get the default category priorities for a given intent.
 *
 * @param intent - The retrieval intent
 * @returns Category priority map (higher = more important)
 */
export function getCategoryPriorities(intent: RetrievalIntent): Record<string, number> {
  return { ...INTENT_CATEGORY_PRIORITIES[intent] };
}

// ============================================================================
// Deduplication
// ============================================================================

/**
 * Deduplicate results with overlapping content.
 *
 * Uses a word-overlap (Jaccard-like) similarity metric to detect
 * near-duplicate content. When two results are similar above the
 * threshold, the lower-scored one is removed.
 *
 * @param results - Results sorted by score descending
 * @param threshold - Similarity threshold (0-1). Results above this are considered duplicates.
 * @returns Deduplicated results maintaining score order
 */
export function deduplicateByContent(
  results: SimilarityResult[],
  threshold: number,
): SimilarityResult[] {
  if (results.length <= 1) return [...results];

  const kept: SimilarityResult[] = [];

  for (const result of results) {
    const isDuplicate = kept.some(
      (existing) => computeContentSimilarity(existing.content, result.content) >= threshold,
    );

    if (!isDuplicate) {
      kept.push(result);
    }
  }

  return kept;
}

/**
 * Compute a word-overlap similarity between two text strings.
 *
 * Uses Jaccard similarity on the set of normalized words:
 * J(A, B) = |A ∩ B| / |A ∪ B|
 *
 * @param textA - First text
 * @param textB - Second text
 * @returns Similarity score between 0 and 1
 */
export function computeContentSimilarity(textA: string, textB: string): number {
  const wordsA = extractWords(textA);
  const wordsB = extractWords(textB);

  if (wordsA.size === 0 && wordsB.size === 0) return 1;
  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  let intersection = 0;
  for (const word of wordsA) {
    if (wordsB.has(word)) {
      intersection++;
    }
  }

  const union = wordsA.size + wordsB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Extract a set of normalized words from text.
 *
 * @param text - Input text
 * @returns Set of lowercase words (3+ characters)
 */
function extractWords(text: string): Set<string> {
  const words = text.toLowerCase().match(/\b[a-z0-9]{3,}\b/g);
  return new Set(words ?? []);
}

// ============================================================================
// Re-ranking
// ============================================================================

/**
 * Re-rank results based on intent-specific category priorities.
 *
 * Combines the original similarity score with category priority weight
 * to produce a final ranking score: finalScore = score * (0.6 + 0.4 * priority)
 *
 * This ensures that highly relevant results from less-prioritized categories
 * can still rank above lower-relevance results from prioritized categories.
 *
 * @param results - Results to re-rank
 * @param intent - The retrieval intent
 * @param overrides - Optional category priority overrides
 * @returns Re-ranked results sorted by adjusted score descending
 */
export function reRankByIntent(
  results: SimilarityResult[],
  intent: RetrievalIntent,
  overrides?: Record<string, number>,
): SimilarityResult[] {
  const priorities = {
    ...INTENT_CATEGORY_PRIORITIES[intent],
    ...overrides,
  };

  const scored = results.map((result) => {
    const priority = priorities[result.category] ?? 0.5;
    const adjustedScore = result.score * (0.6 + 0.4 * priority);
    return { result, adjustedScore };
  });

  scored.sort((a, b) => b.adjustedScore - a.adjustedScore);

  return scored.map((s) => s.result);
}

// ============================================================================
// Diversity
// ============================================================================

/**
 * Enforce category diversity in the result set.
 *
 * Ensures that at least `minCategories` different categories are
 * represented in the results. If the top results are all from one
 * category, this function promotes lower-ranked results from other
 * categories to ensure diversity.
 *
 * @param results - Results sorted by score
 * @param minCategories - Minimum number of categories to include
 * @param maxResults - Maximum total results
 * @returns Diversified results
 */
export function enforceCategoryDiversity(
  results: SimilarityResult[],
  minCategories: number,
  maxResults: number,
): SimilarityResult[] {
  if (results.length === 0) return [];

  const categories = new Set(results.map((r) => r.category));
  if (categories.size <= 1 || categories.size >= minCategories) {
    // Already diverse enough, or only one category exists
    return results.slice(0, maxResults);
  }

  // Group results by category
  const byCategory = new Map<string, SimilarityResult[]>();
  for (const result of results) {
    const existing = byCategory.get(result.category);
    if (existing) {
      existing.push(result);
    } else {
      byCategory.set(result.category, [result]);
    }
  }

  // Take the top result from each category first
  const selected: SimilarityResult[] = [];
  const usedIds = new Set<string>();

  for (const [, catResults] of byCategory) {
    if (selected.length >= maxResults) break;
    const top = catResults[0];
    selected.push(top);
    usedIds.add(top.id);
  }

  // Fill remaining slots with the highest scored unused results
  for (const result of results) {
    if (selected.length >= maxResults) break;
    if (!usedIds.has(result.id)) {
      selected.push(result);
      usedIds.add(result.id);
    }
  }

  // Re-sort by original score to maintain a sensible order
  selected.sort((a, b) => b.score - a.score);

  return selected;
}

/**
 * Check if results have diverse categories.
 *
 * @param results - Results to check
 * @param minCategories - Minimum number of categories needed
 * @returns Whether the diversity requirement is met
 */
function hasDiverseCategories(
  results: SimilarityResult[],
  minCategories: number,
): boolean {
  const categories = new Set(results.map((r) => r.category));
  return categories.size >= minCategories;
}

// ============================================================================
// Token Budget Management
// ============================================================================

/**
 * Trim results to fit within a token budget.
 *
 * Removes the lowest-scored results until the total content token
 * count fits within the budget. Results are assumed to be pre-sorted
 * by relevance (highest first).
 *
 * @param results - Results sorted by relevance (highest first)
 * @param maxTokens - Maximum total tokens for all result content
 * @returns Object with kept results and count of trimmed results
 */
export function trimToTokenBudget(
  results: SimilarityResult[],
  maxTokens: number,
): { kept: SimilarityResult[]; trimmed: number } {
  const kept: SimilarityResult[] = [];
  let usedTokens = 0;

  for (const result of results) {
    const tokens = estimateTokenCount(result.content);
    if (usedTokens + tokens <= maxTokens) {
      kept.push(result);
      usedTokens += tokens;
    } else {
      // Stop adding results once budget is exceeded
      break;
    }
  }

  return {
    kept,
    trimmed: results.length - kept.length,
  };
}
