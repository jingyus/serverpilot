/**
 * Result sorting and filtering module for the knowledge base search pipeline.
 *
 * Provides advanced post-processing of similarity search results including:
 * - Multi-criteria sorting (score, category, document)
 * - Advanced filtering (multi-category, keyword, score range, heading)
 * - Score boosting/penalizing by category or keyword
 * - Result grouping by category or document
 *
 * Search pipeline: query → embed → search → **rank/filter** → return
 *
 * @module knowledge/result-filter
 */

import type { SimilarityResult } from './similarity-search.js';

// ============================================================================
// Types
// ============================================================================

/** Sort direction */
export type SortDirection = 'asc' | 'desc';

/** Fields available for sorting */
export type SortField = 'score' | 'category' | 'documentId';

/** A single sort criterion */
export interface SortCriterion {
  /** Field to sort by */
  field: SortField;
  /** Sort direction (default: 'desc' for score, 'asc' for text fields) */
  direction?: SortDirection;
}

/** Configuration for filtering results */
export interface FilterConfig {
  /** Include only these categories (OR logic) */
  categories?: string[];
  /** Exclude these categories */
  excludeCategories?: string[];
  /** Include only these document IDs */
  documentIds?: string[];
  /** Exclude these document IDs */
  excludeDocumentIds?: string[];
  /** Minimum score threshold (inclusive) */
  minScore?: number;
  /** Maximum score threshold (inclusive) */
  maxScore?: number;
  /** Content must contain this substring (case-insensitive) */
  contentKeyword?: string;
  /** Heading context must contain this substring (case-insensitive) */
  headingKeyword?: string;
}

/** Configuration for score boosting */
export interface BoostConfig {
  /** Boost multiplier for results in these categories */
  categoryBoosts?: Record<string, number>;
  /** Boost multiplier for results containing these keywords (case-insensitive) */
  keywordBoosts?: Record<string, number>;
  /** Boost multiplier for results from these document IDs */
  documentBoosts?: Record<string, number>;
}

/** A group of results */
export interface ResultGroup {
  /** The grouping key (category name or document ID) */
  key: string;
  /** Results in this group */
  results: SimilarityResult[];
  /** Number of results in the group */
  count: number;
  /** Average score of results in the group */
  avgScore: number;
  /** Maximum score in the group */
  maxScore: number;
}

/** Full configuration for the ResultFilter pipeline */
export interface ResultFilterConfig {
  /** Filter criteria */
  filter?: FilterConfig;
  /** Sort criteria (applied in order) */
  sort?: SortCriterion[];
  /** Score boost configuration */
  boost?: BoostConfig;
  /** Maximum number of results to return after all processing */
  limit?: number;
  /** Number of results to skip (for pagination) */
  offset?: number;
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Apply a complete filter/sort/boost pipeline to search results.
 *
 * Processing order:
 * 1. Apply filters (include/exclude)
 * 2. Apply score boosts
 * 3. Sort results
 * 4. Apply offset and limit (pagination)
 *
 * @param results - Raw similarity search results
 * @param config - Filter/sort/boost configuration
 * @returns Processed results
 *
 * @example
 * ```ts
 * const processed = applyResultFilter(results, {
 *   filter: { categories: ['solutions', 'docs'], minScore: 0.3 },
 *   boost: { categoryBoosts: { solutions: 1.5 } },
 *   sort: [{ field: 'score', direction: 'desc' }],
 *   limit: 10,
 * });
 * ```
 */
export function applyResultFilter(
  results: SimilarityResult[],
  config: ResultFilterConfig,
): SimilarityResult[] {
  let processed = [...results];

  // Step 1: Filter
  if (config.filter) {
    processed = filterResults(processed, config.filter);
  }

  // Step 2: Boost scores
  if (config.boost) {
    processed = boostResults(processed, config.boost);
  }

  // Step 3: Sort
  if (config.sort && config.sort.length > 0) {
    processed = sortResults(processed, config.sort);
  }

  // Step 4: Pagination
  if (config.offset !== undefined && config.offset > 0) {
    processed = processed.slice(config.offset);
  }
  if (config.limit !== undefined && config.limit > 0) {
    processed = processed.slice(0, config.limit);
  }

  return processed;
}

/**
 * Filter results based on include/exclude criteria.
 *
 * @param results - Results to filter
 * @param config - Filter configuration
 * @returns Filtered results (order preserved)
 */
export function filterResults(
  results: SimilarityResult[],
  config: FilterConfig,
): SimilarityResult[] {
  return results.filter((result) => {
    // Category include filter (OR logic)
    if (config.categories && config.categories.length > 0) {
      if (!config.categories.includes(result.category)) {
        return false;
      }
    }

    // Category exclude filter
    if (config.excludeCategories && config.excludeCategories.length > 0) {
      if (config.excludeCategories.includes(result.category)) {
        return false;
      }
    }

    // Document ID include filter
    if (config.documentIds && config.documentIds.length > 0) {
      if (!config.documentIds.includes(result.documentId)) {
        return false;
      }
    }

    // Document ID exclude filter
    if (config.excludeDocumentIds && config.excludeDocumentIds.length > 0) {
      if (config.excludeDocumentIds.includes(result.documentId)) {
        return false;
      }
    }

    // Score range filter
    if (config.minScore !== undefined && result.score < config.minScore) {
      return false;
    }
    if (config.maxScore !== undefined && result.score > config.maxScore) {
      return false;
    }

    // Content keyword filter (case-insensitive)
    if (config.contentKeyword) {
      if (!result.content.toLowerCase().includes(config.contentKeyword.toLowerCase())) {
        return false;
      }
    }

    // Heading keyword filter (case-insensitive)
    if (config.headingKeyword) {
      if (!result.headingContext.toLowerCase().includes(config.headingKeyword.toLowerCase())) {
        return false;
      }
    }

    return true;
  });
}

/**
 * Sort results by multiple criteria.
 *
 * Sort criteria are applied in order: the first criterion is the primary sort,
 * the second is the tiebreaker, and so on.
 *
 * @param results - Results to sort
 * @param criteria - Array of sort criteria (applied in order)
 * @returns Sorted results (new array)
 */
export function sortResults(
  results: SimilarityResult[],
  criteria: SortCriterion[],
): SimilarityResult[] {
  const sorted = [...results];
  sorted.sort((a, b) => {
    for (const criterion of criteria) {
      const cmp = compareByField(a, b, criterion.field, criterion.direction);
      if (cmp !== 0) return cmp;
    }
    return 0;
  });
  return sorted;
}

/**
 * Apply score boosts to results.
 *
 * Boosts multiply the original score by the boost factor. A boost of 1.5
 * increases the score by 50%, while 0.5 halves it. Multiple boosts are
 * multiplicative (e.g., category boost 1.5 + keyword boost 1.2 = 1.8x).
 *
 * Scores are clamped to [0, 1] after boosting.
 *
 * @param results - Results to boost
 * @param config - Boost configuration
 * @returns Results with boosted scores (new array, new objects)
 */
export function boostResults(
  results: SimilarityResult[],
  config: BoostConfig,
): SimilarityResult[] {
  return results.map((result) => {
    let multiplier = 1;

    // Category boost
    if (config.categoryBoosts && config.categoryBoosts[result.category] !== undefined) {
      multiplier *= config.categoryBoosts[result.category];
    }

    // Document boost
    if (config.documentBoosts && config.documentBoosts[result.documentId] !== undefined) {
      multiplier *= config.documentBoosts[result.documentId];
    }

    // Keyword boost (check content, case-insensitive)
    if (config.keywordBoosts) {
      for (const [keyword, boost] of Object.entries(config.keywordBoosts)) {
        if (result.content.toLowerCase().includes(keyword.toLowerCase())) {
          multiplier *= boost;
        }
      }
    }

    if (multiplier === 1) {
      return result;
    }

    return {
      ...result,
      score: clampScore(result.score * multiplier),
    };
  });
}

/**
 * Group results by a specified field.
 *
 * Results within each group maintain their original order.
 * Groups are sorted by the maximum score in each group (descending).
 *
 * @param results - Results to group
 * @param groupBy - Field to group by ('category' or 'documentId')
 * @returns Array of result groups, sorted by max score descending
 */
export function groupResults(
  results: SimilarityResult[],
  groupBy: 'category' | 'documentId',
): ResultGroup[] {
  const groups = new Map<string, SimilarityResult[]>();

  for (const result of results) {
    const key = groupBy === 'category' ? result.category : result.documentId;
    const existing = groups.get(key);
    if (existing) {
      existing.push(result);
    } else {
      groups.set(key, [result]);
    }
  }

  const resultGroups: ResultGroup[] = [];
  for (const [key, groupResults] of groups) {
    const scores = groupResults.map((r) => r.score);
    resultGroups.push({
      key,
      results: groupResults,
      count: groupResults.length,
      avgScore: scores.reduce((sum, s) => sum + s, 0) / scores.length,
      maxScore: Math.max(...scores),
    });
  }

  // Sort groups by max score descending
  resultGroups.sort((a, b) => b.maxScore - a.maxScore);

  return resultGroups;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Compare two results by a specific field.
 *
 * @param a - First result
 * @param b - Second result
 * @param field - Field to compare
 * @param direction - Sort direction (default: 'desc' for score, 'asc' for text fields)
 * @returns Comparison value (-1, 0, or 1)
 */
function compareByField(
  a: SimilarityResult,
  b: SimilarityResult,
  field: SortField,
  direction?: SortDirection,
): number {
  let cmp: number;

  switch (field) {
    case 'score': {
      const dir = direction ?? 'desc';
      cmp = a.score - b.score;
      return dir === 'desc' ? -cmp : cmp;
    }
    case 'category': {
      const dir = direction ?? 'asc';
      cmp = a.category.localeCompare(b.category);
      return dir === 'desc' ? -cmp : cmp;
    }
    case 'documentId': {
      const dir = direction ?? 'asc';
      cmp = a.documentId.localeCompare(b.documentId);
      return dir === 'desc' ? -cmp : cmp;
    }
    default:
      return 0;
  }
}

/**
 * Clamp a score to the [0, 1] range.
 */
function clampScore(score: number): number {
  return Math.max(0, Math.min(1, score));
}
