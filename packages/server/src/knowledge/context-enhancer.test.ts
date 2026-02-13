// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for the context enhancer module.
 */

import { describe, it, expect } from 'vitest';
import type { SimilarityResult, SearchResponse } from './similarity-search.js';
import {
  formatSearchResult,
  formatKnowledgeContext,
  enhancePromptWithContext,
  enhancePromptWithSearchResponse,
  estimateTokenCount,
  calculateContextBudget,
  type ContextEnhancerOptions,
} from './context-enhancer.js';

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

/** Create a diverse set of results for testing */
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
// formatSearchResult
// ============================================================================

describe('formatSearchResult', () => {
  it('should format a result with defaults', () => {
    const result = makeResult();
    const formatted = formatSearchResult(result);
    expect(formatted).toContain('[docs]');
    expect(formatted).toContain('Installation Guide');
    expect(formatted).toContain('Test content for knowledge base.');
    expect(formatted).toContain('Source: doc1');
  });

  it('should include score when includeScores is true', () => {
    const result = makeResult({ score: 0.92 });
    const formatted = formatSearchResult(result, { includeScores: true });
    expect(formatted).toContain('score: 0.92');
  });

  it('should not include score by default', () => {
    const result = makeResult({ score: 0.92 });
    const formatted = formatSearchResult(result);
    expect(formatted).not.toContain('score:');
  });

  it('should exclude source when includeSources is false', () => {
    const result = makeResult();
    const formatted = formatSearchResult(result, { includeSources: false });
    expect(formatted).not.toContain('Source:');
  });

  it('should exclude heading when includeHeadings is false', () => {
    const result = makeResult({ headingContext: 'My Heading' });
    const formatted = formatSearchResult(result, { includeHeadings: false });
    expect(formatted).not.toContain('My Heading');
  });

  it('should show category only when heading is empty and scores are off', () => {
    const result = makeResult({ headingContext: '' });
    const formatted = formatSearchResult(result, { includeScores: false });
    expect(formatted).toContain('[docs]');
    expect(formatted).not.toContain('score:');
  });

  it('should show category with score when heading is empty and scores are on', () => {
    const result = makeResult({ headingContext: '', score: 0.75 });
    const formatted = formatSearchResult(result, { includeScores: true });
    expect(formatted).toContain('[docs]');
    expect(formatted).toContain('score: 0.75');
  });

  it('should include content in the output', () => {
    const result = makeResult({ content: 'Some specific content here.' });
    const formatted = formatSearchResult(result);
    expect(formatted).toContain('Some specific content here.');
  });

  it('should combine heading and score on the same line', () => {
    const result = makeResult({
      headingContext: 'Setup Guide',
      score: 0.88,
      category: 'solutions',
    });
    const formatted = formatSearchResult(result, { includeScores: true });
    const lines = formatted.split('\n');
    expect(lines[0]).toBe('[solutions] Setup Guide (score: 0.88)');
  });
});

// ============================================================================
// formatKnowledgeContext
// ============================================================================

describe('formatKnowledgeContext', () => {
  it('should return empty context for empty results', () => {
    const context = formatKnowledgeContext([]);
    expect(context.text).toBe('');
    expect(context.resultCount).toBe(0);
    expect(context.truncatedCount).toBe(0);
    expect(context.totalLength).toBe(0);
    expect(context.wasTruncated).toBe(false);
  });

  it('should format a single result with header', () => {
    const results = [makeResult()];
    const context = formatKnowledgeContext(results);
    expect(context.text).toContain('Relevant Knowledge Base Context:');
    expect(context.text).toContain('Test content for knowledge base.');
    expect(context.resultCount).toBe(1);
    expect(context.truncatedCount).toBe(0);
    expect(context.wasTruncated).toBe(false);
  });

  it('should format multiple results with separators', () => {
    const results = makeDiverseResults().slice(0, 3);
    const context = formatKnowledgeContext(results);
    expect(context.resultCount).toBe(3);
    expect(context.text).toContain('---');
    expect(context.text).toContain('npm install -g openclaw');
    expect(context.text).toContain('EACCES error');
    expect(context.text).toContain('Network timeout');
  });

  it('should use custom section header', () => {
    const results = [makeResult()];
    const context = formatKnowledgeContext(results, {
      sectionHeader: 'Knowledge Base',
    });
    expect(context.text).toContain('Knowledge Base:');
    expect(context.text).not.toContain('Relevant Knowledge Base Context:');
  });

  it('should use custom result separator', () => {
    const results = makeDiverseResults().slice(0, 2);
    const context = formatKnowledgeContext(results, {
      resultSeparator: '\n===\n',
    });
    expect(context.text).toContain('===');
    expect(context.text).not.toContain('---');
  });

  it('should filter by minScore', () => {
    const results = makeDiverseResults(); // scores: 0.95, 0.82, 0.75, 0.68, 0.55
    const context = formatKnowledgeContext(results, { minScore: 0.80 });
    expect(context.resultCount).toBe(2); // 0.95 and 0.82
    expect(context.text).toContain('npm install -g openclaw');
    expect(context.text).toContain('EACCES error');
    expect(context.text).not.toContain('Network timeout');
  });

  it('should return empty for all results below minScore', () => {
    const results = makeDiverseResults();
    const context = formatKnowledgeContext(results, { minScore: 0.99 });
    expect(context.resultCount).toBe(0);
    expect(context.text).toBe('');
  });

  it('should limit by maxResults', () => {
    const results = makeDiverseResults();
    const context = formatKnowledgeContext(results, { maxResults: 2 });
    expect(context.resultCount).toBe(2);
    // Should include the first two (highest scored)
    expect(context.text).toContain('npm install -g openclaw');
    expect(context.text).toContain('EACCES error');
  });

  it('should truncate results when exceeding maxContextLength', () => {
    const results = makeDiverseResults();
    // Use a very small max length to force truncation
    const context = formatKnowledgeContext(results, { maxContextLength: 200 });
    expect(context.wasTruncated).toBe(true);
    expect(context.truncatedCount).toBeGreaterThan(0);
    expect(context.resultCount).toBeLessThan(results.length);
    expect(context.text).toContain('omitted due to context length limit');
  });

  it('should handle case where even first result exceeds max length', () => {
    const result = makeResult({
      content: 'A'.repeat(5000),
    });
    const context = formatKnowledgeContext([result], { maxContextLength: 100 });
    expect(context.resultCount).toBe(0);
    expect(context.wasTruncated).toBe(true);
    expect(context.truncatedCount).toBe(1);
    expect(context.text).toBe('');
  });

  it('should report correct totalLength', () => {
    const results = [makeResult()];
    const context = formatKnowledgeContext(results);
    expect(context.totalLength).toBe(context.text.length);
  });

  it('should work with includeScores option passed through', () => {
    const results = [makeResult({ score: 0.91 })];
    const context = formatKnowledgeContext(results, { includeScores: true });
    expect(context.text).toContain('score: 0.91');
  });

  it('should work with includeSources=false passed through', () => {
    const results = [makeResult()];
    const context = formatKnowledgeContext(results, { includeSources: false });
    expect(context.text).not.toContain('Source:');
  });

  it('should not exceed maxContextLength', () => {
    const results = makeDiverseResults();
    const maxLen = 500;
    const context = formatKnowledgeContext(results, { maxContextLength: maxLen });
    expect(context.totalLength).toBeLessThanOrEqual(
      maxLen + 100, // Allow some slack for the truncation notice
    );
  });
});

// ============================================================================
// enhancePromptWithContext
// ============================================================================

describe('enhancePromptWithContext', () => {
  it('should return original prompt when no results', () => {
    const prompt = 'Analyze this environment.';
    const enhanced = enhancePromptWithContext(prompt, []);
    expect(enhanced).toBe(prompt);
  });

  it('should append knowledge context to prompt', () => {
    const prompt = 'Analyze this environment.';
    const results = [makeResult()];
    const enhanced = enhancePromptWithContext(prompt, results);
    expect(enhanced).toContain('Analyze this environment.');
    expect(enhanced).toContain('Relevant Knowledge Base Context:');
    expect(enhanced).toContain('Test content for knowledge base.');
  });

  it('should preserve original prompt at the start', () => {
    const prompt = 'Original prompt text here.';
    const results = [makeResult()];
    const enhanced = enhancePromptWithContext(prompt, results);
    expect(enhanced.startsWith('Original prompt text here.')).toBe(true);
  });

  it('should pass options through to formatting', () => {
    const prompt = 'Base prompt.';
    const results = [makeResult({ score: 0.77 })];
    const enhanced = enhancePromptWithContext(prompt, results, {
      includeScores: true,
      sectionHeader: 'Context',
    });
    expect(enhanced).toContain('score: 0.77');
    expect(enhanced).toContain('Context:');
  });

  it('should return original prompt when all results below minScore', () => {
    const prompt = 'Base prompt.';
    const results = [makeResult({ score: 0.3 })];
    const enhanced = enhancePromptWithContext(prompt, results, {
      minScore: 0.5,
    });
    expect(enhanced).toBe(prompt);
  });

  it('should work with multiple results', () => {
    const prompt = 'Diagnose this error.';
    const results = makeDiverseResults().slice(0, 3);
    const enhanced = enhancePromptWithContext(prompt, results);
    expect(enhanced).toContain('Diagnose this error.');
    expect(enhanced).toContain('npm install -g openclaw');
    expect(enhanced).toContain('EACCES error');
    expect(enhanced).toContain('Network timeout');
  });

  it('should respect maxContextLength relative to total prompt', () => {
    const prompt = 'Short prompt.';
    const results = makeDiverseResults();
    const enhanced = enhancePromptWithContext(prompt, results, {
      maxContextLength: 300,
    });
    // Enhanced should be shorter than if we had unlimited context
    const unlimited = enhancePromptWithContext(prompt, results, {
      maxContextLength: 100000,
    });
    expect(enhanced.length).toBeLessThan(unlimited.length);
  });
});

// ============================================================================
// enhancePromptWithSearchResponse
// ============================================================================

describe('enhancePromptWithSearchResponse', () => {
  it('should work with a SearchResponse object', () => {
    const prompt = 'Base prompt.';
    const response = makeSearchResponse();
    const enhanced = enhancePromptWithSearchResponse(prompt, response);
    expect(enhanced).toContain('Base prompt.');
    expect(enhanced).toContain('Relevant Knowledge Base Context:');
  });

  it('should return original prompt for empty search response', () => {
    const prompt = 'Base prompt.';
    const response = makeSearchResponse([]);
    const enhanced = enhancePromptWithSearchResponse(prompt, response);
    expect(enhanced).toBe(prompt);
  });

  it('should pass options through', () => {
    const prompt = 'Base prompt.';
    const response = makeSearchResponse([makeResult({ score: 0.88 })]);
    const enhanced = enhancePromptWithSearchResponse(prompt, response, {
      includeScores: true,
    });
    expect(enhanced).toContain('score: 0.88');
  });
});

// ============================================================================
// estimateTokenCount
// ============================================================================

describe('estimateTokenCount', () => {
  it('should return 0 for empty string', () => {
    expect(estimateTokenCount('')).toBe(0);
  });

  it('should estimate approximately 1 token per 4 chars for ASCII', () => {
    // 20 ASCII chars → ~5 tokens (4 chars/token)
    expect(estimateTokenCount('12345678901234567890')).toBe(5);
  });

  it('should round up partial tokens', () => {
    // 5 ASCII chars → ceil(5/4) = 2
    expect(estimateTokenCount('Hello')).toBe(2);
  });

  it('should handle single character', () => {
    expect(estimateTokenCount('A')).toBe(1);
  });

  it('should handle long ASCII text', () => {
    const text = 'a'.repeat(1000);
    expect(estimateTokenCount(text)).toBe(250);
  });

  it('should estimate more tokens for CJK text (1.5 chars/token)', () => {
    // 6 CJK chars → ceil(6/1.5) = 4 tokens
    const cjk = '你好世界测试';
    expect(estimateTokenCount(cjk)).toBe(4);
  });

  it('should estimate more tokens for pure Chinese text than ASCII', () => {
    // Same character count but different token estimates
    const ascii = 'abcdef'; // 6 chars → ceil(6/4) = 2 tokens
    const cjk = '你好世界测试'; // 6 chars → ceil(6/1.5) = 4 tokens
    expect(estimateTokenCount(cjk)).toBeGreaterThan(estimateTokenCount(ascii));
  });

  it('should use weighted average for mixed CJK/ASCII text', () => {
    // Mixed: "你好abc" — 2 CJK + 3 ASCII = 5 chars
    // cjkRatio = 2/5 = 0.4, asciiRatio = 0.6
    // charsPerToken = 1.5*0.4 + 4*0.6 = 0.6 + 2.4 = 3.0
    // tokens = ceil(5/3.0) = 2
    const mixed = '你好abc';
    expect(estimateTokenCount(mixed)).toBe(2);
  });
});

// ============================================================================
// calculateContextBudget
// ============================================================================

describe('calculateContextBudget', () => {
  it('should calculate remaining budget after prompt and reserved tokens', () => {
    // 100 chars = ~25 tokens. Budget = 1000, reserved = 100
    // Available = 1000 - 25 - 100 = 875 tokens → 3500 chars
    const prompt = 'a'.repeat(100);
    const budget = calculateContextBudget(prompt, 1000, 100);
    expect(budget).toBe(3500);
  });

  it('should return 0 when prompt exceeds budget', () => {
    const prompt = 'a'.repeat(10000);
    const budget = calculateContextBudget(prompt, 100, 50);
    expect(budget).toBe(0);
  });

  it('should return 0 when prompt plus reserved equals budget', () => {
    // 400 chars = 100 tokens. Budget = 100, reserved = 0
    const prompt = 'a'.repeat(400);
    const budget = calculateContextBudget(prompt, 100, 0);
    expect(budget).toBe(0);
  });

  it('should use default reserved tokens of 1024', () => {
    // 0 chars prompt, budget = 2000, reserved = 1024 (default)
    // Available = 2000 - 0 - 1024 = 976 tokens → 3904 chars
    const budget = calculateContextBudget('', 2000);
    expect(budget).toBe(3904);
  });

  it('should handle exact token boundary', () => {
    // 8 chars = 2 tokens. Budget = 10, reserved = 5
    // Available = 10 - 2 - 5 = 3 tokens → 12 chars
    const budget = calculateContextBudget('12345678', 10, 5);
    expect(budget).toBe(12);
  });

  it('should return 0 for negative available tokens', () => {
    const prompt = 'a'.repeat(400); // 100 tokens
    const budget = calculateContextBudget(prompt, 50, 10);
    expect(budget).toBe(0);
  });

  it('should use CJK-aware ratio for Chinese prompts', () => {
    // 6 CJK chars → charsPerToken=1.5, tokens=ceil(6/1.5)=4
    // Available = 100 - 4 - 10 = 86 tokens
    // Budget chars = floor(86 * 1.5) = 129
    const prompt = '你好世界测试';
    const budget = calculateContextBudget(prompt, 100, 10);
    expect(budget).toBe(129);
  });

  it('should return fewer chars for CJK prompt than ASCII with same token budget', () => {
    // CJK chars take fewer chars-per-token, so the same token budget
    // translates to fewer characters for CJK content
    const asciiPrompt = 'abcd'; // 4 chars, 1 token, ratio=4
    const cjkPrompt = '你好世界'; // 4 chars, ceil(4/1.5)=3 tokens, ratio=1.5
    const ascBudget = calculateContextBudget(asciiPrompt, 1000, 100);
    const cjkBudget = calculateContextBudget(cjkPrompt, 1000, 100);
    // ASCII: avail = 1000-1-100 = 899 → floor(899*4) = 3596
    // CJK: avail = 1000-3-100 = 897 → floor(897*1.5) = 1345
    expect(cjkBudget).toBeLessThan(ascBudget);
  });
});

// ============================================================================
// Integration: Full pipeline
// ============================================================================

describe('Integration: prompt enhancement pipeline', () => {
  it('should enhance an environment analysis prompt with search results', () => {
    const basePrompt = `You are a software installation expert. The user wants to install openclaw.

Environment:
- OS: darwin 24.0.0 (arm64)
- Node.js: 22.1.0
- Package Managers: pnpm@9.1.0, npm@10.2.0

Please analyze this environment.`;

    const results = makeDiverseResults().slice(0, 2);
    const enhanced = enhancePromptWithContext(basePrompt, results, {
      includeScores: true,
      maxContextLength: 2000,
    });

    // Should contain original prompt
    expect(enhanced).toContain('software installation expert');
    expect(enhanced).toContain('darwin 24.0.0');

    // Should contain knowledge context
    expect(enhanced).toContain('Relevant Knowledge Base Context:');
    expect(enhanced).toContain('npm install -g openclaw');
    expect(enhanced).toContain('EACCES error');
    expect(enhanced).toContain('score:');
  });

  it('should enhance an error diagnosis prompt with relevant solutions', () => {
    const basePrompt = `Diagnose this error:
Command: npm install -g openclaw
Exit Code: 1
Stderr: EACCES: permission denied`;

    const results = [
      makeResult({
        id: 's1',
        documentId: 'permission-fix',
        content: 'Use sudo npm install -g or change npm prefix to a user-writable directory.',
        score: 0.92,
        category: 'solutions',
        headingContext: 'Permission Error Fix',
      }),
    ];

    const enhanced = enhancePromptWithContext(basePrompt, results);
    expect(enhanced).toContain('Diagnose this error:');
    expect(enhanced).toContain('Permission Error Fix');
    expect(enhanced).toContain('sudo npm install -g');
    expect(enhanced).toContain('Source: permission-fix');
  });

  it('should use calculateContextBudget with enhancePromptWithContext', () => {
    const basePrompt = 'A short prompt.';
    const results = makeDiverseResults();
    const budget = calculateContextBudget(basePrompt, 500, 100);

    const enhanced = enhancePromptWithContext(basePrompt, results, {
      maxContextLength: budget,
    });

    // The context length should respect the budget
    const contextLength = enhanced.length - basePrompt.length;
    // Allow some slack for truncation message
    expect(contextLength).toBeLessThanOrEqual(budget + 100);
  });

  it('should handle the full pipeline with SearchResponse', () => {
    const basePrompt = 'Generate a fix plan.';
    const response = makeSearchResponse();

    const enhanced = enhancePromptWithSearchResponse(basePrompt, response, {
      maxResults: 3,
      includeScores: false,
      includeSources: true,
    });

    expect(enhanced).toContain('Generate a fix plan.');
    expect(enhanced).toContain('Relevant Knowledge Base Context:');
    // Should not contain scores
    expect(enhanced).not.toContain('score:');
    // Should contain sources
    expect(enhanced).toContain('Source:');
  });
});
