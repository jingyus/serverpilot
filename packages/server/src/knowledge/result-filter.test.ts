/**
 * Tests for the result sorting and filtering module.
 */

import { describe, it, expect } from 'vitest';
import {
  applyResultFilter,
  filterResults,
  sortResults,
  boostResults,
  groupResults,
  type FilterConfig,
  type SortCriterion,
  type BoostConfig,
  type ResultFilterConfig,
} from './result-filter.js';
import type { SimilarityResult } from './similarity-search.js';

// ============================================================================
// Test Helpers
// ============================================================================

/** Create a test SimilarityResult */
function makeResult(overrides: Partial<SimilarityResult> = {}): SimilarityResult {
  return {
    id: overrides.id ?? 'chunk-1',
    documentId: overrides.documentId ?? 'doc1',
    content: overrides.content ?? 'test content',
    score: overrides.score ?? 0.5,
    category: overrides.category ?? 'docs',
    headingContext: overrides.headingContext ?? 'Test Heading',
  };
}

/** Create a set of diverse test results */
function makeDiverseResults(): SimilarityResult[] {
  return [
    makeResult({ id: 'c1', documentId: 'doc1', content: 'npm install timeout error', score: 0.9, category: 'issues', headingContext: 'NPM Timeout' }),
    makeResult({ id: 'c2', documentId: 'doc2', content: 'permission denied fix', score: 0.8, category: 'solutions', headingContext: 'Permission Fix' }),
    makeResult({ id: 'c3', documentId: 'doc3', content: 'node version 22 setup guide', score: 0.7, category: 'docs', headingContext: 'Node Setup' }),
    makeResult({ id: 'c4', documentId: 'doc4', content: 'npm registry proxy configuration', score: 0.6, category: 'docs', headingContext: 'Proxy Config' }),
    makeResult({ id: 'c5', documentId: 'doc5', content: 'pnpm install permission error', score: 0.5, category: 'issues', headingContext: 'PNPM Error' }),
    makeResult({ id: 'c6', documentId: 'doc1', content: 'npm install retry after timeout', score: 0.4, category: 'solutions', headingContext: 'Retry Guide' }),
  ];
}

// ============================================================================
// filterResults
// ============================================================================

describe('filterResults', () => {
  it('should return all results with empty config', () => {
    const results = makeDiverseResults();
    const filtered = filterResults(results, {});
    expect(filtered).toHaveLength(results.length);
  });

  it('should filter by included categories (OR logic)', () => {
    const results = makeDiverseResults();
    const filtered = filterResults(results, { categories: ['issues', 'solutions'] });
    expect(filtered.every((r) => ['issues', 'solutions'].includes(r.category))).toBe(true);
    expect(filtered).toHaveLength(4);
  });

  it('should return empty when no results match included categories', () => {
    const results = makeDiverseResults();
    const filtered = filterResults(results, { categories: ['nonexistent'] });
    expect(filtered).toHaveLength(0);
  });

  it('should filter by excluded categories', () => {
    const results = makeDiverseResults();
    const filtered = filterResults(results, { excludeCategories: ['issues'] });
    expect(filtered.every((r) => r.category !== 'issues')).toBe(true);
    expect(filtered).toHaveLength(4);
  });

  it('should filter by included document IDs', () => {
    const results = makeDiverseResults();
    const filtered = filterResults(results, { documentIds: ['doc1'] });
    expect(filtered.every((r) => r.documentId === 'doc1')).toBe(true);
    expect(filtered).toHaveLength(2);
  });

  it('should filter by excluded document IDs', () => {
    const results = makeDiverseResults();
    const filtered = filterResults(results, { excludeDocumentIds: ['doc1', 'doc2'] });
    expect(filtered.every((r) => !['doc1', 'doc2'].includes(r.documentId))).toBe(true);
    expect(filtered).toHaveLength(3);
  });

  it('should filter by minimum score', () => {
    const results = makeDiverseResults();
    const filtered = filterResults(results, { minScore: 0.7 });
    expect(filtered.every((r) => r.score >= 0.7)).toBe(true);
    expect(filtered).toHaveLength(3);
  });

  it('should filter by maximum score', () => {
    const results = makeDiverseResults();
    const filtered = filterResults(results, { maxScore: 0.6 });
    expect(filtered.every((r) => r.score <= 0.6)).toBe(true);
    expect(filtered).toHaveLength(3);
  });

  it('should filter by score range', () => {
    const results = makeDiverseResults();
    const filtered = filterResults(results, { minScore: 0.5, maxScore: 0.8 });
    expect(filtered.every((r) => r.score >= 0.5 && r.score <= 0.8)).toBe(true);
    expect(filtered).toHaveLength(4);
  });

  it('should filter by content keyword (case-insensitive)', () => {
    const results = makeDiverseResults();
    const filtered = filterResults(results, { contentKeyword: 'npm' });
    expect(filtered.every((r) => r.content.toLowerCase().includes('npm'))).toBe(true);
    // c1: "npm install timeout error", c4: "npm registry proxy configuration",
    // c5: "pnpm install permission error" (contains "npm"), c6: "npm install retry after timeout"
    expect(filtered).toHaveLength(4);
  });

  it('should filter by content keyword case-insensitively', () => {
    const results = makeDiverseResults();
    const filtered = filterResults(results, { contentKeyword: 'NPM' });
    expect(filtered).toHaveLength(4);
  });

  it('should filter by heading keyword (case-insensitive)', () => {
    const results = makeDiverseResults();
    const filtered = filterResults(results, { headingKeyword: 'error' });
    expect(filtered.every((r) => r.headingContext.toLowerCase().includes('error'))).toBe(true);
    expect(filtered).toHaveLength(1);
  });

  it('should combine multiple filter criteria (AND logic)', () => {
    const results = makeDiverseResults();
    const filtered = filterResults(results, {
      categories: ['issues'],
      minScore: 0.6,
    });
    expect(filtered.every((r) => r.category === 'issues' && r.score >= 0.6)).toBe(true);
    expect(filtered).toHaveLength(1); // Only c1 (issues, 0.9)
  });

  it('should preserve order of results', () => {
    const results = makeDiverseResults();
    const filtered = filterResults(results, { categories: ['docs'] });
    expect(filtered[0].id).toBe('c3');
    expect(filtered[1].id).toBe('c4');
  });

  it('should handle empty results array', () => {
    const filtered = filterResults([], { categories: ['docs'] });
    expect(filtered).toHaveLength(0);
  });
});

// ============================================================================
// sortResults
// ============================================================================

describe('sortResults', () => {
  it('should sort by score descending (default)', () => {
    const results = makeDiverseResults();
    const sorted = sortResults(results, [{ field: 'score' }]);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i - 1].score).toBeGreaterThanOrEqual(sorted[i].score);
    }
  });

  it('should sort by score ascending', () => {
    const results = makeDiverseResults();
    const sorted = sortResults(results, [{ field: 'score', direction: 'asc' }]);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i - 1].score).toBeLessThanOrEqual(sorted[i].score);
    }
  });

  it('should sort by category ascending (default)', () => {
    const results = makeDiverseResults();
    const sorted = sortResults(results, [{ field: 'category' }]);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i - 1].category.localeCompare(sorted[i].category)).toBeLessThanOrEqual(0);
    }
  });

  it('should sort by category descending', () => {
    const results = makeDiverseResults();
    const sorted = sortResults(results, [{ field: 'category', direction: 'desc' }]);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i - 1].category.localeCompare(sorted[i].category)).toBeGreaterThanOrEqual(0);
    }
  });

  it('should sort by documentId ascending (default)', () => {
    const results = makeDiverseResults();
    const sorted = sortResults(results, [{ field: 'documentId' }]);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i - 1].documentId.localeCompare(sorted[i].documentId)).toBeLessThanOrEqual(0);
    }
  });

  it('should support multi-criteria sorting', () => {
    const results = makeDiverseResults();
    const sorted = sortResults(results, [
      { field: 'category', direction: 'asc' },
      { field: 'score', direction: 'desc' },
    ]);

    // Results should be grouped by category (alphabetical), then sorted by score descending
    // docs: c3(0.7), c4(0.6)
    // issues: c1(0.9), c5(0.5)
    // solutions: c2(0.8), c6(0.4)
    expect(sorted[0].category).toBe('docs');
    expect(sorted[1].category).toBe('docs');
    expect(sorted[0].score).toBeGreaterThanOrEqual(sorted[1].score);

    expect(sorted[2].category).toBe('issues');
    expect(sorted[3].category).toBe('issues');
    expect(sorted[2].score).toBeGreaterThanOrEqual(sorted[3].score);

    expect(sorted[4].category).toBe('solutions');
    expect(sorted[5].category).toBe('solutions');
    expect(sorted[4].score).toBeGreaterThanOrEqual(sorted[5].score);
  });

  it('should not modify the original array', () => {
    const results = makeDiverseResults();
    const originalIds = results.map((r) => r.id);
    sortResults(results, [{ field: 'score', direction: 'asc' }]);
    expect(results.map((r) => r.id)).toEqual(originalIds);
  });

  it('should handle empty criteria array', () => {
    const results = makeDiverseResults();
    const sorted = sortResults(results, []);
    expect(sorted.map((r) => r.id)).toEqual(results.map((r) => r.id));
  });

  it('should handle empty results array', () => {
    const sorted = sortResults([], [{ field: 'score' }]);
    expect(sorted).toHaveLength(0);
  });
});

// ============================================================================
// boostResults
// ============================================================================

describe('boostResults', () => {
  it('should return unmodified results with empty config', () => {
    const results = makeDiverseResults();
    const boosted = boostResults(results, {});
    expect(boosted.map((r) => r.score)).toEqual(results.map((r) => r.score));
  });

  it('should boost scores by category', () => {
    const results = [
      makeResult({ id: 'c1', score: 0.5, category: 'solutions' }),
      makeResult({ id: 'c2', score: 0.5, category: 'docs' }),
    ];
    const boosted = boostResults(results, {
      categoryBoosts: { solutions: 1.5 },
    });
    expect(boosted[0].score).toBeCloseTo(0.75, 5);
    expect(boosted[1].score).toBe(0.5); // Unchanged
  });

  it('should penalize scores with boost < 1', () => {
    const results = [
      makeResult({ id: 'c1', score: 0.8, category: 'issues' }),
    ];
    const boosted = boostResults(results, {
      categoryBoosts: { issues: 0.5 },
    });
    expect(boosted[0].score).toBeCloseTo(0.4, 5);
  });

  it('should boost scores by document ID', () => {
    const results = [
      makeResult({ id: 'c1', score: 0.5, documentId: 'important-doc' }),
      makeResult({ id: 'c2', score: 0.5, documentId: 'other-doc' }),
    ];
    const boosted = boostResults(results, {
      documentBoosts: { 'important-doc': 1.8 },
    });
    expect(boosted[0].score).toBeCloseTo(0.9, 5);
    expect(boosted[1].score).toBe(0.5);
  });

  it('should boost scores by content keyword (case-insensitive)', () => {
    const results = [
      makeResult({ id: 'c1', score: 0.5, content: 'npm install timeout' }),
      makeResult({ id: 'c2', score: 0.5, content: 'python setup guide' }),
    ];
    const boosted = boostResults(results, {
      keywordBoosts: { timeout: 1.4 },
    });
    expect(boosted[0].score).toBeCloseTo(0.7, 5);
    expect(boosted[1].score).toBe(0.5);
  });

  it('should apply multiple boosts multiplicatively', () => {
    const results = [
      makeResult({ id: 'c1', score: 0.5, category: 'solutions', content: 'timeout fix' }),
    ];
    const boosted = boostResults(results, {
      categoryBoosts: { solutions: 1.5 },
      keywordBoosts: { timeout: 1.2 },
    });
    // 0.5 * 1.5 * 1.2 = 0.9
    expect(boosted[0].score).toBeCloseTo(0.9, 5);
  });

  it('should clamp boosted scores to max 1.0', () => {
    const results = [
      makeResult({ id: 'c1', score: 0.8, category: 'solutions' }),
    ];
    const boosted = boostResults(results, {
      categoryBoosts: { solutions: 2.0 },
    });
    expect(boosted[0].score).toBe(1.0);
  });

  it('should clamp boosted scores to min 0', () => {
    const results = [
      makeResult({ id: 'c1', score: 0.5, category: 'issues' }),
    ];
    const boosted = boostResults(results, {
      categoryBoosts: { issues: -1 },
    });
    expect(boosted[0].score).toBe(0);
  });

  it('should not modify the original results', () => {
    const results = [
      makeResult({ id: 'c1', score: 0.5, category: 'solutions' }),
    ];
    const originalScore = results[0].score;
    boostResults(results, { categoryBoosts: { solutions: 2.0 } });
    expect(results[0].score).toBe(originalScore);
  });

  it('should handle empty results', () => {
    const boosted = boostResults([], { categoryBoosts: { solutions: 2.0 } });
    expect(boosted).toHaveLength(0);
  });
});

// ============================================================================
// groupResults
// ============================================================================

describe('groupResults', () => {
  it('should group results by category', () => {
    const results = makeDiverseResults();
    const groups = groupResults(results, 'category');

    // Should have 3 categories: issues, solutions, docs
    expect(groups).toHaveLength(3);

    const categoryNames = groups.map((g) => g.key);
    expect(categoryNames).toContain('issues');
    expect(categoryNames).toContain('solutions');
    expect(categoryNames).toContain('docs');
  });

  it('should group results by documentId', () => {
    const results = makeDiverseResults();
    const groups = groupResults(results, 'documentId');

    // doc1 appears twice (c1, c6), others once
    expect(groups).toHaveLength(5);
    const doc1Group = groups.find((g) => g.key === 'doc1');
    expect(doc1Group).toBeDefined();
    expect(doc1Group!.count).toBe(2);
  });

  it('should calculate correct count for each group', () => {
    const results = makeDiverseResults();
    const groups = groupResults(results, 'category');

    const issuesGroup = groups.find((g) => g.key === 'issues')!;
    expect(issuesGroup.count).toBe(2); // c1, c5

    const docsGroup = groups.find((g) => g.key === 'docs')!;
    expect(docsGroup.count).toBe(2); // c3, c4
  });

  it('should calculate correct avgScore for each group', () => {
    const results = makeDiverseResults();
    const groups = groupResults(results, 'category');

    const issuesGroup = groups.find((g) => g.key === 'issues')!;
    expect(issuesGroup.avgScore).toBeCloseTo((0.9 + 0.5) / 2, 5);

    const solutionsGroup = groups.find((g) => g.key === 'solutions')!;
    expect(solutionsGroup.avgScore).toBeCloseTo((0.8 + 0.4) / 2, 5);
  });

  it('should calculate correct maxScore for each group', () => {
    const results = makeDiverseResults();
    const groups = groupResults(results, 'category');

    const issuesGroup = groups.find((g) => g.key === 'issues')!;
    expect(issuesGroup.maxScore).toBe(0.9);

    const docsGroup = groups.find((g) => g.key === 'docs')!;
    expect(docsGroup.maxScore).toBe(0.7);
  });

  it('should sort groups by maxScore descending', () => {
    const results = makeDiverseResults();
    const groups = groupResults(results, 'category');

    for (let i = 1; i < groups.length; i++) {
      expect(groups[i - 1].maxScore).toBeGreaterThanOrEqual(groups[i].maxScore);
    }
  });

  it('should maintain result order within each group', () => {
    const results = makeDiverseResults();
    const groups = groupResults(results, 'category');

    const issuesGroup = groups.find((g) => g.key === 'issues')!;
    expect(issuesGroup.results[0].id).toBe('c1');
    expect(issuesGroup.results[1].id).toBe('c5');
  });

  it('should handle empty results', () => {
    const groups = groupResults([], 'category');
    expect(groups).toHaveLength(0);
  });

  it('should handle single result', () => {
    const results = [makeResult({ id: 'c1', category: 'docs', score: 0.5 })];
    const groups = groupResults(results, 'category');

    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe('docs');
    expect(groups[0].count).toBe(1);
    expect(groups[0].avgScore).toBe(0.5);
    expect(groups[0].maxScore).toBe(0.5);
  });
});

// ============================================================================
// applyResultFilter (full pipeline)
// ============================================================================

describe('applyResultFilter', () => {
  it('should return all results with empty config', () => {
    const results = makeDiverseResults();
    const processed = applyResultFilter(results, {});
    expect(processed).toHaveLength(results.length);
  });

  it('should apply filter then sort', () => {
    const results = makeDiverseResults();
    const processed = applyResultFilter(results, {
      filter: { categories: ['issues'] },
      sort: [{ field: 'score', direction: 'asc' }],
    });

    expect(processed).toHaveLength(2);
    expect(processed[0].score).toBeLessThanOrEqual(processed[1].score);
  });

  it('should apply boost before sort', () => {
    const results = [
      makeResult({ id: 'c1', score: 0.5, category: 'solutions' }),
      makeResult({ id: 'c2', score: 0.6, category: 'docs' }),
    ];
    const processed = applyResultFilter(results, {
      boost: { categoryBoosts: { solutions: 1.5 } },
      sort: [{ field: 'score', direction: 'desc' }],
    });

    // After boost: c1 = 0.75, c2 = 0.6
    expect(processed[0].id).toBe('c1');
    expect(processed[0].score).toBeCloseTo(0.75, 5);
  });

  it('should apply limit', () => {
    const results = makeDiverseResults();
    const processed = applyResultFilter(results, { limit: 3 });
    expect(processed).toHaveLength(3);
  });

  it('should apply offset', () => {
    const results = makeDiverseResults();
    const processed = applyResultFilter(results, { offset: 2 });
    expect(processed).toHaveLength(results.length - 2);
    expect(processed[0].id).toBe(results[2].id);
  });

  it('should apply offset and limit together (pagination)', () => {
    const results = makeDiverseResults();
    const processed = applyResultFilter(results, { offset: 2, limit: 2 });
    expect(processed).toHaveLength(2);
    expect(processed[0].id).toBe(results[2].id);
    expect(processed[1].id).toBe(results[3].id);
  });

  it('should apply full pipeline: filter → boost → sort → paginate', () => {
    const results = makeDiverseResults();
    const processed = applyResultFilter(results, {
      filter: {
        categories: ['issues', 'solutions'],
        minScore: 0.4,
      },
      boost: {
        categoryBoosts: { solutions: 1.2 },
      },
      sort: [{ field: 'score', direction: 'desc' }],
      limit: 3,
    });

    // After filter: c1(issues,0.9), c2(solutions,0.8), c5(issues,0.5), c6(solutions,0.4)
    // After boost: c1(0.9), c2(0.96), c5(0.5), c6(0.48)
    // After sort desc: c2(0.96), c1(0.9), c5(0.5), c6(0.48)
    // After limit 3: c2, c1, c5
    expect(processed).toHaveLength(3);
    expect(processed[0].id).toBe('c2');
    expect(processed[0].score).toBeCloseTo(0.96, 5);
    expect(processed[1].id).toBe('c1');
  });

  it('should handle empty results', () => {
    const processed = applyResultFilter([], {
      filter: { categories: ['docs'] },
      sort: [{ field: 'score' }],
      limit: 5,
    });
    expect(processed).toHaveLength(0);
  });

  it('should handle filter that removes all results', () => {
    const results = makeDiverseResults();
    const processed = applyResultFilter(results, {
      filter: { categories: ['nonexistent'] },
    });
    expect(processed).toHaveLength(0);
  });

  it('should not modify original results', () => {
    const results = makeDiverseResults();
    const originalScores = results.map((r) => r.score);
    applyResultFilter(results, {
      boost: { categoryBoosts: { issues: 2.0 } },
      sort: [{ field: 'score', direction: 'asc' }],
    });
    expect(results.map((r) => r.score)).toEqual(originalScores);
  });
});
