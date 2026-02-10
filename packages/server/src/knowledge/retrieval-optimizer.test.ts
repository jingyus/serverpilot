/**
 * Tests for the retrieval optimizer module.
 */

import { describe, it, expect } from 'vitest';
import type { SimilarityResult, SearchResponse } from './similarity-search.js';
import {
  optimizeResults,
  optimizeSearchResponse,
  getCategoryPriorities,
  deduplicateByContent,
  computeContentSimilarity,
  reRankByIntent,
  enforceCategoryDiversity,
  trimToTokenBudget,
  INTENT_CATEGORY_PRIORITIES,
  type RetrievalOptimizerConfig,
  type RetrievalIntent,
} from './retrieval-optimizer.js';

// ============================================================================
// Test Helpers
// ============================================================================

/** Create a test SimilarityResult */
function makeResult(overrides: Partial<SimilarityResult> = {}): SimilarityResult {
  return {
    id: overrides.id ?? 'chunk-1',
    documentId: overrides.documentId ?? 'doc1',
    content: overrides.content ?? 'Test content for knowledge base.',
    score: overrides.score ?? 0.85,
    category: overrides.category ?? 'docs',
    headingContext: overrides.headingContext ?? 'Installation Guide',
  };
}

/** Create diverse results across multiple categories */
function makeDiverseResults(): SimilarityResult[] {
  return [
    makeResult({
      id: 'c1',
      documentId: 'installation-guide',
      content: 'Run npm install -g openclaw to install globally.',
      score: 0.95,
      category: 'docs',
      headingContext: 'Installation',
    }),
    makeResult({
      id: 'c2',
      documentId: 'troubleshooting',
      content: 'If you get EACCES error, try using sudo or change npm prefix.',
      score: 0.82,
      category: 'solutions',
      headingContext: 'Permission Errors',
    }),
    makeResult({
      id: 'c3',
      documentId: 'network-errors',
      content: 'Network timeout can be resolved by setting registry mirror.',
      score: 0.75,
      category: 'issues',
      headingContext: 'NPM Timeout',
    }),
    makeResult({
      id: 'c4',
      documentId: 'macos-m1',
      content: 'On macOS M1, ensure you use the arm64 version of Node.js.',
      score: 0.68,
      category: 'cases',
      headingContext: 'macOS M1 Setup',
    }),
    makeResult({
      id: 'c5',
      documentId: 'faq',
      content: 'OpenClaw requires Node.js 22 or later.',
      score: 0.55,
      category: 'docs',
      headingContext: 'Prerequisites',
    }),
  ];
}

/** Create results with duplicate content */
function makeDuplicateResults(): SimilarityResult[] {
  return [
    makeResult({
      id: 'dup1',
      documentId: 'doc-a',
      content: 'Run npm install -g openclaw to install the package globally on your system.',
      score: 0.95,
      category: 'docs',
    }),
    makeResult({
      id: 'dup2',
      documentId: 'doc-b',
      content: 'Run npm install -g openclaw to install the package globally.',
      score: 0.88,
      category: 'docs',
    }),
    makeResult({
      id: 'dup3',
      documentId: 'doc-c',
      content: 'A completely different topic about network configuration and proxy settings.',
      score: 0.75,
      category: 'issues',
    }),
  ];
}

/** Create results all from one category */
function makeSingleCategoryResults(): SimilarityResult[] {
  return [
    makeResult({ id: 'sc1', score: 0.95, category: 'docs', content: 'Doc content one.' }),
    makeResult({ id: 'sc2', score: 0.90, category: 'docs', content: 'Doc content two.' }),
    makeResult({ id: 'sc3', score: 0.85, category: 'docs', content: 'Doc content three.' }),
    makeResult({ id: 'sc4', score: 0.80, category: 'solutions', content: 'Solution content.' }),
    makeResult({ id: 'sc5', score: 0.70, category: 'issues', content: 'Issue content.' }),
  ];
}

/** Create a mock SearchResponse */
function makeSearchResponse(results?: SimilarityResult[]): SearchResponse {
  const r = results ?? makeDiverseResults();
  return {
    results: r,
    summary: {
      query: 'install openclaw',
      processedQuery: 'install openclaw',
      totalFound: r.length,
      returned: r.length,
      embeddingCached: false,
      durationMs: 42,
    },
  };
}

// ============================================================================
// computeContentSimilarity
// ============================================================================

describe('computeContentSimilarity', () => {
  it('should return 1 for identical texts', () => {
    const text = 'Install openclaw using npm install command.';
    expect(computeContentSimilarity(text, text)).toBe(1);
  });

  it('should return 1 for two empty strings', () => {
    expect(computeContentSimilarity('', '')).toBe(1);
  });

  it('should return 0 when one text is empty', () => {
    expect(computeContentSimilarity('some text here', '')).toBe(0);
    expect(computeContentSimilarity('', 'some text here')).toBe(0);
  });

  it('should return 0 for completely different texts', () => {
    const similarity = computeContentSimilarity(
      'Install openclaw using npm globally.',
      'Configure database connection pooling parameters.',
    );
    expect(similarity).toBeLessThan(0.2);
  });

  it('should return high similarity for near-duplicate texts', () => {
    const similarity = computeContentSimilarity(
      'Run npm install -g openclaw to install the package globally.',
      'Run npm install -g openclaw to install the package globally on your system.',
    );
    expect(similarity).toBeGreaterThan(0.7);
  });

  it('should be case-insensitive', () => {
    const similarity = computeContentSimilarity(
      'Install OpenClaw using NPM',
      'install openclaw using npm',
    );
    expect(similarity).toBe(1);
  });

  it('should handle texts with short words (filtered out)', () => {
    // Words < 3 chars are filtered
    const similarity = computeContentSimilarity('a b c', 'x y z');
    // Both result in empty word sets, so similarity = 1
    expect(similarity).toBe(1);
  });
});

// ============================================================================
// deduplicateByContent
// ============================================================================

describe('deduplicateByContent', () => {
  it('should return empty array for empty input', () => {
    expect(deduplicateByContent([], 0.7)).toEqual([]);
  });

  it('should return single result unchanged', () => {
    const results = [makeResult()];
    const deduped = deduplicateByContent(results, 0.7);
    expect(deduped).toHaveLength(1);
    expect(deduped[0].id).toBe(results[0].id);
  });

  it('should remove near-duplicate content', () => {
    const results = makeDuplicateResults();
    const deduped = deduplicateByContent(results, 0.7);
    // dup1 and dup2 are near-duplicates; dup3 is different
    expect(deduped).toHaveLength(2);
    expect(deduped[0].id).toBe('dup1'); // Higher score kept
    expect(deduped[1].id).toBe('dup3'); // Different content kept
  });

  it('should keep all results with low threshold', () => {
    const results = makeDuplicateResults();
    const deduped = deduplicateByContent(results, 0.99);
    // Even near-duplicates won't reach 0.99 threshold
    expect(deduped.length).toBeGreaterThanOrEqual(2);
  });

  it('should keep all unique results', () => {
    const results = makeDiverseResults();
    const deduped = deduplicateByContent(results, 0.7);
    expect(deduped).toHaveLength(results.length);
  });
});

// ============================================================================
// reRankByIntent
// ============================================================================

describe('reRankByIntent', () => {
  it('should prioritize docs for environment-analysis', () => {
    const results = [
      makeResult({ id: 'r1', score: 0.80, category: 'solutions' }),
      makeResult({ id: 'r2', score: 0.80, category: 'docs' }),
    ];
    const reranked = reRankByIntent(results, 'environment-analysis');
    // docs has priority 1.0 vs solutions 0.4
    expect(reranked[0].id).toBe('r2');
  });

  it('should prioritize issues for error-diagnosis', () => {
    const results = [
      makeResult({ id: 'r1', score: 0.80, category: 'docs' }),
      makeResult({ id: 'r2', score: 0.80, category: 'issues' }),
    ];
    const reranked = reRankByIntent(results, 'error-diagnosis');
    // issues has priority 1.0 vs docs 0.5
    expect(reranked[0].id).toBe('r2');
  });

  it('should prioritize solutions for fix-suggestion', () => {
    const results = [
      makeResult({ id: 'r1', score: 0.80, category: 'docs' }),
      makeResult({ id: 'r2', score: 0.80, category: 'solutions' }),
    ];
    const reranked = reRankByIntent(results, 'fix-suggestion');
    // solutions has priority 1.0 vs docs 0.4
    expect(reranked[0].id).toBe('r2');
  });

  it('should not override significantly higher scores', () => {
    const results = [
      makeResult({ id: 'r1', score: 0.99, category: 'docs' }),
      makeResult({ id: 'r2', score: 0.50, category: 'solutions' }),
    ];
    const reranked = reRankByIntent(results, 'fix-suggestion');
    // r1: 0.99 * (0.6 + 0.4*0.4) = 0.99 * 0.76 = 0.7524
    // r2: 0.50 * (0.6 + 0.4*1.0) = 0.50 * 1.0  = 0.50
    expect(reranked[0].id).toBe('r1');
  });

  it('should apply custom priority overrides', () => {
    const results = [
      makeResult({ id: 'r1', score: 0.80, category: 'docs' }),
      makeResult({ id: 'r2', score: 0.80, category: 'custom-cat' }),
    ];
    const reranked = reRankByIntent(results, 'general', {
      'custom-cat': 1.0,
    });
    expect(reranked[0].id).toBe('r2');
  });

  it('should use 0.5 priority for unknown categories', () => {
    const results = [
      makeResult({ id: 'r1', score: 0.80, category: 'unknown-category' }),
    ];
    const reranked = reRankByIntent(results, 'general');
    // Score = 0.80 * (0.6 + 0.4*0.5) = 0.80 * 0.8 = 0.64
    expect(reranked).toHaveLength(1);
    expect(reranked[0].id).toBe('r1');
  });

  it('should preserve order for equal adjusted scores', () => {
    const results = [
      makeResult({ id: 'r1', score: 0.80, category: 'docs' }),
      makeResult({ id: 'r2', score: 0.80, category: 'docs' }),
    ];
    const reranked = reRankByIntent(results, 'general');
    expect(reranked[0].id).toBe('r1');
    expect(reranked[1].id).toBe('r2');
  });
});

// ============================================================================
// enforceCategoryDiversity
// ============================================================================

describe('enforceCategoryDiversity', () => {
  it('should return empty array for empty input', () => {
    expect(enforceCategoryDiversity([], 2, 5)).toEqual([]);
  });

  it('should return results unchanged when already diverse', () => {
    const results = makeDiverseResults();
    const diversified = enforceCategoryDiversity(results, 2, 5);
    expect(diversified).toHaveLength(5);
  });

  it('should promote lower-scored results from other categories', () => {
    const results = makeSingleCategoryResults();
    const diversified = enforceCategoryDiversity(results, 2, 5);

    const categories = new Set(diversified.map((r) => r.category));
    // Should have at least 2 categories even though top 3 are all 'docs'
    expect(categories.size).toBeGreaterThanOrEqual(2);
  });

  it('should not exceed maxResults', () => {
    const results = makeDiverseResults();
    const diversified = enforceCategoryDiversity(results, 2, 3);
    expect(diversified).toHaveLength(3);
  });

  it('should handle single category gracefully', () => {
    const results = [
      makeResult({ id: 'a', score: 0.9, category: 'docs' }),
      makeResult({ id: 'b', score: 0.8, category: 'docs' }),
    ];
    const diversified = enforceCategoryDiversity(results, 2, 5);
    // Only one category exists, so just return what's available
    expect(diversified).toHaveLength(2);
  });

  it('should sort results by score after diversification', () => {
    const results = makeSingleCategoryResults();
    const diversified = enforceCategoryDiversity(results, 3, 5);
    for (let i = 1; i < diversified.length; i++) {
      expect(diversified[i].score).toBeLessThanOrEqual(diversified[i - 1].score);
    }
  });
});

// ============================================================================
// trimToTokenBudget
// ============================================================================

describe('trimToTokenBudget', () => {
  it('should keep all results when within budget', () => {
    const results = [
      makeResult({ content: 'Short text.' }), // ~3 tokens
    ];
    const { kept, trimmed } = trimToTokenBudget(results, 100);
    expect(kept).toHaveLength(1);
    expect(trimmed).toBe(0);
  });

  it('should trim results when exceeding budget', () => {
    const results = [
      makeResult({ id: 'a', content: 'a'.repeat(100) }), // ~25 tokens
      makeResult({ id: 'b', content: 'b'.repeat(100) }), // ~25 tokens
      makeResult({ id: 'c', content: 'c'.repeat(100) }), // ~25 tokens
    ];
    const { kept, trimmed } = trimToTokenBudget(results, 50);
    expect(kept).toHaveLength(2);
    expect(trimmed).toBe(1);
  });

  it('should return empty when budget is 0', () => {
    const results = [makeResult()];
    const { kept, trimmed } = trimToTokenBudget(results, 0);
    expect(kept).toHaveLength(0);
    expect(trimmed).toBe(1);
  });

  it('should keep results in order', () => {
    const results = [
      makeResult({ id: 'a', content: 'First result here.' }),
      makeResult({ id: 'b', content: 'Second result here.' }),
    ];
    const { kept } = trimToTokenBudget(results, 100);
    expect(kept[0].id).toBe('a');
    expect(kept[1].id).toBe('b');
  });

  it('should handle empty input', () => {
    const { kept, trimmed } = trimToTokenBudget([], 100);
    expect(kept).toHaveLength(0);
    expect(trimmed).toBe(0);
  });

  it('should stop at first result that exceeds remaining budget', () => {
    const results = [
      makeResult({ id: 'a', content: 'a'.repeat(40) }),  // ~10 tokens
      makeResult({ id: 'b', content: 'b'.repeat(200) }), // ~50 tokens, exceeds
      makeResult({ id: 'c', content: 'c'.repeat(20) }),   // ~5 tokens, would fit but skipped
    ];
    const { kept, trimmed } = trimToTokenBudget(results, 30);
    expect(kept).toHaveLength(1);
    expect(kept[0].id).toBe('a');
    expect(trimmed).toBe(2);
  });
});

// ============================================================================
// getCategoryPriorities
// ============================================================================

describe('getCategoryPriorities', () => {
  it('should return priorities for environment-analysis', () => {
    const priorities = getCategoryPriorities('environment-analysis');
    expect(priorities.docs).toBe(1.0);
    expect(priorities.solutions).toBeLessThan(priorities.docs);
  });

  it('should return priorities for error-diagnosis', () => {
    const priorities = getCategoryPriorities('error-diagnosis');
    expect(priorities.issues).toBe(1.0);
    expect(priorities.solutions).toBe(0.9);
  });

  it('should return priorities for fix-suggestion', () => {
    const priorities = getCategoryPriorities('fix-suggestion');
    expect(priorities.solutions).toBe(1.0);
  });

  it('should return priorities for install-plan', () => {
    const priorities = getCategoryPriorities('install-plan');
    expect(priorities.docs).toBe(1.0);
  });

  it('should return equal priorities for general', () => {
    const priorities = getCategoryPriorities('general');
    expect(priorities.docs).toBe(priorities.issues);
    expect(priorities.issues).toBe(priorities.solutions);
  });

  it('should return a copy (not the original)', () => {
    const priorities = getCategoryPriorities('general');
    priorities.docs = 999;
    const fresh = getCategoryPriorities('general');
    expect(fresh.docs).toBe(0.7);
  });
});

// ============================================================================
// INTENT_CATEGORY_PRIORITIES
// ============================================================================

describe('INTENT_CATEGORY_PRIORITIES', () => {
  it('should have entries for all intents', () => {
    const intents: RetrievalIntent[] = [
      'environment-analysis',
      'error-diagnosis',
      'fix-suggestion',
      'install-plan',
      'general',
    ];
    for (const intent of intents) {
      expect(INTENT_CATEGORY_PRIORITIES[intent]).toBeDefined();
    }
  });

  it('should have values between 0 and 1', () => {
    for (const [, priorities] of Object.entries(INTENT_CATEGORY_PRIORITIES)) {
      for (const [, value] of Object.entries(priorities)) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
  });
});

// ============================================================================
// optimizeResults
// ============================================================================

describe('optimizeResults', () => {
  it('should return empty for empty input', () => {
    const result = optimizeResults([], { intent: 'general' });
    expect(result.results).toHaveLength(0);
    expect(result.stats.inputCount).toBe(0);
    expect(result.stats.outputCount).toBe(0);
  });

  it('should filter by minimum score', () => {
    const results = makeDiverseResults();
    const optimized = optimizeResults(results, {
      intent: 'general',
      minScore: 0.80,
    });
    // Only scores >= 0.80: 0.95 and 0.82
    expect(optimized.results.every((r) => r.score >= 0.80)).toBe(true);
    expect(optimized.stats.filteredByScore).toBeGreaterThan(0);
  });

  it('should deduplicate similar content', () => {
    const results = makeDuplicateResults();
    const optimized = optimizeResults(results, {
      intent: 'general',
      deduplicationThreshold: 0.7,
    });
    expect(optimized.stats.deduplicatedCount).toBeGreaterThan(0);
    expect(optimized.results.length).toBeLessThan(results.length);
  });

  it('should respect maxResults limit', () => {
    const results = makeDiverseResults();
    const optimized = optimizeResults(results, {
      intent: 'general',
      maxResults: 3,
    });
    expect(optimized.results).toHaveLength(3);
    expect(optimized.stats.outputCount).toBe(3);
  });

  it('should respect token budget', () => {
    const results = [
      makeResult({ id: 'a', content: 'a'.repeat(400), score: 0.9 }), // ~100 tokens
      makeResult({ id: 'b', content: 'b'.repeat(400), score: 0.8 }), // ~100 tokens
      makeResult({ id: 'c', content: 'c'.repeat(400), score: 0.7 }), // ~100 tokens
    ];
    const optimized = optimizeResults(results, {
      intent: 'general',
      maxTokenBudget: 200,
    });
    expect(optimized.results.length).toBeLessThan(3);
    expect(optimized.stats.trimmedByBudget).toBeGreaterThan(0);
  });

  it('should re-rank based on intent', () => {
    const results = [
      makeResult({ id: 'doc', score: 0.80, category: 'docs', content: 'Documentation about installation prerequisites.' }),
      makeResult({ id: 'sol', score: 0.80, category: 'solutions', content: 'Fix permission errors by changing npm prefix directory.' }),
    ];
    const optimized = optimizeResults(results, {
      intent: 'fix-suggestion',
      enforceDiversity: false,
    });
    // Solutions should rank higher for fix-suggestion
    expect(optimized.results[0].id).toBe('sol');
  });

  it('should report correct stats', () => {
    const results = makeDiverseResults();
    const optimized = optimizeResults(results, {
      intent: 'general',
      maxResults: 3,
    });
    expect(optimized.stats.inputCount).toBe(5);
    expect(optimized.stats.outputCount).toBe(3);
    expect(optimized.stats.categoriesRepresented.length).toBeGreaterThan(0);
    expect(optimized.stats.totalTokens).toBeGreaterThan(0);
  });

  it('should enforce diversity by default', () => {
    const results = makeSingleCategoryResults();
    const optimized = optimizeResults(results, {
      intent: 'general',
      maxResults: 5,
    });
    const categories = new Set(optimized.results.map((r) => r.category));
    expect(categories.size).toBeGreaterThanOrEqual(2);
  });

  it('should skip diversity enforcement when disabled', () => {
    const optimized = optimizeResults(makeSingleCategoryResults(), {
      intent: 'general',
      enforceDiversity: false,
      maxResults: 3,
    });
    // Should just take top 3 by score regardless of category
    expect(optimized.stats.diversityApplied).toBe(false);
  });

  it('should apply custom category priority overrides', () => {
    const results = [
      makeResult({ id: 'r1', score: 0.80, category: 'docs', content: 'Standard documentation about the software setup.' }),
      makeResult({ id: 'r2', score: 0.80, category: 'custom', content: 'Custom category content with specific fix strategy details.' }),
    ];
    const optimized = optimizeResults(results, {
      intent: 'general',
      enforceDiversity: false,
      categoryPriorityOverrides: { custom: 1.0 },
    });
    expect(optimized.results[0].id).toBe('r2');
  });

  it('should handle all results being below minScore', () => {
    const results = [
      makeResult({ score: 0.05 }),
      makeResult({ score: 0.03 }),
    ];
    const optimized = optimizeResults(results, {
      intent: 'general',
      minScore: 0.5,
    });
    expect(optimized.results).toHaveLength(0);
    expect(optimized.stats.filteredByScore).toBe(2);
  });

  it('should report categories represented in output', () => {
    const results = makeDiverseResults();
    const optimized = optimizeResults(results, { intent: 'general' });
    expect(optimized.stats.categoriesRepresented).toContain('docs');
    expect(optimized.stats.categoriesRepresented.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// optimizeSearchResponse
// ============================================================================

describe('optimizeSearchResponse', () => {
  it('should work with a SearchResponse object', () => {
    const response = makeSearchResponse();
    const optimized = optimizeSearchResponse(response, {
      intent: 'error-diagnosis',
      maxResults: 3,
    });
    expect(optimized.results.length).toBeLessThanOrEqual(3);
    expect(optimized.stats.inputCount).toBe(5);
  });

  it('should handle empty search response', () => {
    const response = makeSearchResponse([]);
    const optimized = optimizeSearchResponse(response, { intent: 'general' });
    expect(optimized.results).toHaveLength(0);
  });

  it('should pass config through correctly', () => {
    const response = makeSearchResponse();
    const optimized = optimizeSearchResponse(response, {
      intent: 'fix-suggestion',
      maxResults: 2,
      minScore: 0.60,
    });
    expect(optimized.results.length).toBeLessThanOrEqual(2);
    expect(optimized.results.every((r) => r.score >= 0.60)).toBe(true);
  });
});

// ============================================================================
// Integration: Full pipeline
// ============================================================================

describe('Integration: optimization pipeline', () => {
  it('should produce optimized results for error diagnosis intent', () => {
    const results = makeDiverseResults();
    const optimized = optimizeResults(results, {
      intent: 'error-diagnosis',
      maxResults: 3,
      maxTokenBudget: 1000,
      minScore: 0.5,
    });

    // Should have at most 3 results
    expect(optimized.results.length).toBeLessThanOrEqual(3);
    // Should have filtered out low scores
    expect(optimized.results.every((r) => r.score >= 0.5)).toBe(true);
    // Issues/solutions should be prioritized for error diagnosis
    expect(optimized.stats.inputCount).toBe(5);
  });

  it('should handle the full pipeline with deduplication and diversity', () => {
    const results = [
      // Near-duplicate pair (should be deduplicated)
      makeResult({
        id: 'dup1',
        content: 'Install openclaw using npm install -g openclaw command.',
        score: 0.95,
        category: 'docs',
      }),
      makeResult({
        id: 'dup2',
        content: 'Install openclaw using npm install -g openclaw.',
        score: 0.90,
        category: 'docs',
      }),
      // Different category results
      makeResult({
        id: 'sol1',
        content: 'Fix permission errors by changing npm prefix directory.',
        score: 0.85,
        category: 'solutions',
      }),
      makeResult({
        id: 'iss1',
        content: 'Common network timeout issue during npm install operations.',
        score: 0.78,
        category: 'issues',
      }),
      makeResult({
        id: 'case1',
        content: 'Successfully installed on Ubuntu 22.04 with Node 22.',
        score: 0.65,
        category: 'cases',
      }),
    ];

    const optimized = optimizeResults(results, {
      intent: 'fix-suggestion',
      maxResults: 4,
      deduplicationThreshold: 0.7,
    });

    // dup2 should be removed as near-duplicate of dup1
    expect(optimized.stats.deduplicatedCount).toBeGreaterThanOrEqual(1);
    // Multiple categories should be present
    expect(optimized.stats.categoriesRepresented.length).toBeGreaterThanOrEqual(2);
  });

  it('should use environment-analysis intent to prioritize docs', () => {
    const results = [
      makeResult({ id: 'sol', score: 0.85, category: 'solutions', content: 'Solution content here.' }),
      makeResult({ id: 'doc', score: 0.85, category: 'docs', content: 'Documentation content here.' }),
    ];

    const optimized = optimizeResults(results, {
      intent: 'environment-analysis',
      enforceDiversity: false,
      maxResults: 2,
    });

    // Docs should be ranked first for environment analysis
    expect(optimized.results[0].id).toBe('doc');
  });

  it('should produce valid stats throughout the pipeline', () => {
    const results = makeDiverseResults();
    const optimized = optimizeResults(results, {
      intent: 'general',
      maxResults: 3,
      minScore: 0.5,
    });

    // Verify stats consistency
    expect(optimized.stats.inputCount).toBe(results.length);
    expect(optimized.stats.outputCount).toBe(optimized.results.length);
    expect(optimized.stats.outputCount).toBeLessThanOrEqual(optimized.stats.inputCount);
    expect(optimized.stats.totalTokens).toBeGreaterThan(0);
    expect(optimized.stats.categoriesRepresented.length).toBeGreaterThan(0);
    // All reported categories should actually appear in results
    for (const cat of optimized.stats.categoriesRepresented) {
      expect(optimized.results.some((r) => r.category === cat)).toBe(true);
    }
  });
});
