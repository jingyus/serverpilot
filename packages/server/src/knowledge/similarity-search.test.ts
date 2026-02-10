/**
 * Tests for the similarity search module.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  SimilaritySearch,
  deduplicateByDocument,
  averageEmbeddings,
  type SimilarityResult,
  type SimilaritySearchOptions,
  type SearchResponse,
  type SearchSummary,
  type SimilaritySearchConfig,
} from './similarity-search.js';
import { LocalVectorStore } from './vector-store.js';
import { QueryEmbedder } from './query-embedder.js';
import { TfIdfEmbeddingProvider } from './embedding-generator.js';
import type { EmbeddedChunk } from './embedding-generator.js';

// ============================================================================
// Test Helpers
// ============================================================================

/** Create a normalized embedding vector */
function makeEmbedding(values: number[]): number[] {
  const mag = Math.sqrt(values.reduce((s, v) => s + v * v, 0));
  return mag > 0 ? values.map((v) => v / mag) : values;
}

/** Create a test EmbeddedChunk */
function makeChunk(overrides: Partial<EmbeddedChunk> = {}): EmbeddedChunk {
  const embedding = overrides.embedding ?? makeEmbedding([1, 0, 0, 0]);
  return {
    chunkId: overrides.chunkId ?? 'doc1#chunk-0',
    documentId: overrides.documentId ?? 'doc1',
    content: overrides.content ?? 'test content',
    embedding,
    dimension: overrides.dimension ?? embedding.length,
    category: overrides.category ?? 'docs',
    headingContext: overrides.headingContext ?? 'Test Heading',
  };
}

/** Set up a SimilaritySearch with a TF-IDF provider and local vector store */
function createTestSearch(corpusTexts: string[]): {
  search: SimilaritySearch;
  store: LocalVectorStore;
  provider: TfIdfEmbeddingProvider;
  embedder: QueryEmbedder;
} {
  const provider = new TfIdfEmbeddingProvider();
  provider.buildVocabulary(corpusTexts);
  const embedder = new QueryEmbedder({ provider });
  const store = new LocalVectorStore();
  const search = new SimilaritySearch({ queryEmbedder: embedder, vectorStore: store });
  return { search, store, provider, embedder };
}

/** Populate a store with chunks using a provider to generate embeddings */
async function populateStore(
  store: LocalVectorStore,
  provider: TfIdfEmbeddingProvider,
  entries: Array<{ id: string; docId: string; content: string; category?: string; heading?: string }>,
): Promise<void> {
  const chunks: EmbeddedChunk[] = [];
  for (const entry of entries) {
    const embedding = await provider.embed(entry.content);
    chunks.push({
      chunkId: entry.id,
      documentId: entry.docId,
      content: entry.content,
      embedding,
      dimension: embedding.length,
      category: entry.category ?? 'docs',
      headingContext: entry.heading ?? 'Heading',
    });
  }
  await store.upsert(chunks);
}

// ============================================================================
// deduplicateByDocument
// ============================================================================

describe('deduplicateByDocument', () => {
  const makeResult = (id: string, docId: string, score: number): SimilarityResult => ({
    id,
    documentId: docId,
    content: `content-${id}`,
    score,
    category: 'docs',
    headingContext: 'heading',
  });

  it('should return empty array for empty input', () => {
    expect(deduplicateByDocument([], 1)).toEqual([]);
  });

  it('should keep all results when each belongs to a different document', () => {
    const results = [
      makeResult('a', 'doc1', 0.9),
      makeResult('b', 'doc2', 0.8),
      makeResult('c', 'doc3', 0.7),
    ];
    const deduped = deduplicateByDocument(results, 1);
    expect(deduped).toHaveLength(3);
  });

  it('should keep only maxPerDocument results per document', () => {
    const results = [
      makeResult('a1', 'doc1', 0.9),
      makeResult('a2', 'doc1', 0.8),
      makeResult('a3', 'doc1', 0.7),
      makeResult('b1', 'doc2', 0.6),
    ];
    const deduped = deduplicateByDocument(results, 1);
    expect(deduped).toHaveLength(2);
    expect(deduped[0].id).toBe('a1');
    expect(deduped[1].id).toBe('b1');
  });

  it('should allow multiple results per document when maxPerDocument > 1', () => {
    const results = [
      makeResult('a1', 'doc1', 0.9),
      makeResult('a2', 'doc1', 0.8),
      makeResult('a3', 'doc1', 0.7),
      makeResult('b1', 'doc2', 0.6),
    ];
    const deduped = deduplicateByDocument(results, 2);
    expect(deduped).toHaveLength(3);
    expect(deduped.map((r) => r.id)).toEqual(['a1', 'a2', 'b1']);
  });

  it('should maintain score order', () => {
    const results = [
      makeResult('a1', 'doc1', 0.9),
      makeResult('b1', 'doc2', 0.85),
      makeResult('a2', 'doc1', 0.8),
      makeResult('b2', 'doc2', 0.75),
    ];
    const deduped = deduplicateByDocument(results, 1);
    expect(deduped).toHaveLength(2);
    expect(deduped[0].score).toBeGreaterThan(deduped[1].score);
  });
});

// ============================================================================
// averageEmbeddings
// ============================================================================

describe('averageEmbeddings', () => {
  it('should return empty array for empty input', () => {
    expect(averageEmbeddings([])).toEqual([]);
  });

  it('should return the same vector for a single embedding', () => {
    const emb = [0.5, 0.3, 0.2];
    const avg = averageEmbeddings([emb]);
    expect(avg).toEqual([0.5, 0.3, 0.2]);
  });

  it('should compute element-wise average of two vectors', () => {
    const avg = averageEmbeddings([
      [1, 0, 0],
      [0, 1, 0],
    ]);
    expect(avg).toEqual([0.5, 0.5, 0]);
  });

  it('should compute element-wise average of multiple vectors', () => {
    const avg = averageEmbeddings([
      [1, 0, 0, 0],
      [0, 1, 0, 0],
      [0, 0, 1, 0],
    ]);
    expect(avg[0]).toBeCloseTo(1 / 3, 5);
    expect(avg[1]).toBeCloseTo(1 / 3, 5);
    expect(avg[2]).toBeCloseTo(1 / 3, 5);
    expect(avg[3]).toBeCloseTo(0, 5);
  });

  it('should handle identical vectors', () => {
    const avg = averageEmbeddings([
      [0.5, 0.5],
      [0.5, 0.5],
    ]);
    expect(avg).toEqual([0.5, 0.5]);
  });
});

// ============================================================================
// SimilaritySearch - basic search
// ============================================================================

describe('SimilaritySearch', () => {
  describe('search', () => {
    it('should return empty results for empty store', async () => {
      const { search } = createTestSearch(['hello world']);
      const response = await search.search('hello');

      expect(response.results).toEqual([]);
      expect(response.summary.returned).toBe(0);
      expect(response.summary.totalFound).toBe(0);
    });

    it('should find relevant results', async () => {
      const corpus = [
        'npm install timeout error',
        'permission denied fix',
        'node version mismatch',
      ];
      const { search, store, provider } = createTestSearch(corpus);

      await populateStore(store, provider, [
        { id: 'c1', docId: 'doc1', content: 'npm install timeout error', category: 'issues' },
        { id: 'c2', docId: 'doc2', content: 'permission denied fix', category: 'solutions' },
        { id: 'c3', docId: 'doc3', content: 'node version mismatch', category: 'issues' },
      ]);

      const response = await search.search('npm install timeout');

      expect(response.results.length).toBeGreaterThan(0);
      expect(response.results[0].id).toBe('c1');
      expect(response.results[0].score).toBeGreaterThan(0);
    });

    it('should return results sorted by score descending', async () => {
      const corpus = [
        'npm install fails with timeout',
        'npm registry connection error',
        'python install guide',
      ];
      const { search, store, provider } = createTestSearch(corpus);

      await populateStore(store, provider, [
        { id: 'c1', docId: 'doc1', content: 'npm install fails with timeout' },
        { id: 'c2', docId: 'doc2', content: 'npm registry connection error' },
        { id: 'c3', docId: 'doc3', content: 'python install guide' },
      ]);

      const response = await search.search('npm install');

      for (let i = 1; i < response.results.length; i++) {
        expect(response.results[i - 1].score).toBeGreaterThanOrEqual(response.results[i].score);
      }
    });

    it('should respect maxResults option', async () => {
      const corpus = ['aaa', 'bbb', 'ccc', 'ddd', 'eee'];
      const { search, store, provider } = createTestSearch(corpus);

      await populateStore(store, provider, [
        { id: 'c1', docId: 'doc1', content: 'aaa' },
        { id: 'c2', docId: 'doc2', content: 'bbb' },
        { id: 'c3', docId: 'doc3', content: 'ccc' },
        { id: 'c4', docId: 'doc4', content: 'ddd' },
        { id: 'c5', docId: 'doc5', content: 'eee' },
      ]);

      const response = await search.search('aaa', { maxResults: 2 });

      expect(response.results.length).toBeLessThanOrEqual(2);
    });

    it('should respect minScore option', async () => {
      const corpus = [
        'npm install error timeout',
        'completely unrelated topic about cooking recipes',
      ];
      const { search, store, provider } = createTestSearch(corpus);

      await populateStore(store, provider, [
        { id: 'c1', docId: 'doc1', content: 'npm install error timeout' },
        { id: 'c2', docId: 'doc2', content: 'completely unrelated topic about cooking recipes' },
      ]);

      const response = await search.search('npm install error', { minScore: 0.5 });

      for (const result of response.results) {
        expect(result.score).toBeGreaterThanOrEqual(0.5);
      }
    });

    it('should filter by category', async () => {
      const corpus = [
        'npm install guide',
        'npm install error fix',
      ];
      const { search, store, provider } = createTestSearch(corpus);

      await populateStore(store, provider, [
        { id: 'c1', docId: 'doc1', content: 'npm install guide', category: 'docs' },
        { id: 'c2', docId: 'doc2', content: 'npm install error fix', category: 'solutions' },
      ]);

      const response = await search.search('npm install', { category: 'docs' });

      for (const result of response.results) {
        expect(result.category).toBe('docs');
      }
    });

    it('should filter by documentId', async () => {
      const corpus = ['npm install guide step one', 'npm install guide step two'];
      const { search, store, provider } = createTestSearch(corpus);

      await populateStore(store, provider, [
        { id: 'c1', docId: 'doc1', content: 'npm install guide step one' },
        { id: 'c2', docId: 'doc2', content: 'npm install guide step two' },
      ]);

      const response = await search.search('npm install', { documentId: 'doc1' });

      for (const result of response.results) {
        expect(result.documentId).toBe('doc1');
      }
    });

    it('should deduplicate by document when enabled', async () => {
      const corpus = [
        'npm install timeout first chunk',
        'npm install timeout second chunk',
        'permission denied fix',
      ];
      const { search, store, provider } = createTestSearch(corpus);

      await populateStore(store, provider, [
        { id: 'c1', docId: 'doc1', content: 'npm install timeout first chunk' },
        { id: 'c2', docId: 'doc1', content: 'npm install timeout second chunk' },
        { id: 'c3', docId: 'doc2', content: 'permission denied fix' },
      ]);

      const response = await search.search('npm install timeout', {
        deduplicateByDocument: true,
        maxPerDocument: 1,
      });

      // Only one result from doc1
      const doc1Results = response.results.filter((r) => r.documentId === 'doc1');
      expect(doc1Results.length).toBeLessThanOrEqual(1);
    });

    it('should include correct summary fields', async () => {
      const corpus = ['npm install timeout'];
      const { search, store, provider } = createTestSearch(corpus);

      await populateStore(store, provider, [
        { id: 'c1', docId: 'doc1', content: 'npm install timeout' },
      ]);

      const response = await search.search('npm install timeout');

      expect(response.summary).toHaveProperty('query', 'npm install timeout');
      expect(response.summary).toHaveProperty('processedQuery');
      expect(response.summary).toHaveProperty('totalFound');
      expect(response.summary).toHaveProperty('returned');
      expect(response.summary).toHaveProperty('embeddingCached');
      expect(response.summary).toHaveProperty('durationMs');
      expect(response.summary.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should report cached status from query embedder', async () => {
      const corpus = ['npm install timeout'];
      const { search, store, provider } = createTestSearch(corpus);

      await populateStore(store, provider, [
        { id: 'c1', docId: 'doc1', content: 'npm install timeout' },
      ]);

      // First search - not cached
      const response1 = await search.search('npm install timeout');
      expect(response1.summary.embeddingCached).toBe(false);

      // Second search with same query - cached
      const response2 = await search.search('npm install timeout');
      expect(response2.summary.embeddingCached).toBe(true);
    });

    it('should include all result fields', async () => {
      const corpus = ['npm install timeout error'];
      const { search, store, provider } = createTestSearch(corpus);

      await populateStore(store, provider, [
        {
          id: 'chunk-1',
          docId: 'install-doc',
          content: 'npm install timeout error',
          category: 'issues',
          heading: 'Install Error',
        },
      ]);

      const response = await search.search('npm install timeout');

      if (response.results.length > 0) {
        const result = response.results[0];
        expect(result).toHaveProperty('id');
        expect(result).toHaveProperty('documentId');
        expect(result).toHaveProperty('content');
        expect(result).toHaveProperty('score');
        expect(result).toHaveProperty('category');
        expect(result).toHaveProperty('headingContext');
      }
    });
  });

  // --------------------------------------------------------------------------
  // searchMultiple
  // --------------------------------------------------------------------------

  describe('searchMultiple', () => {
    it('should return empty results for empty queries array', async () => {
      const { search } = createTestSearch(['hello']);
      const response = await search.searchMultiple([]);

      expect(response.results).toEqual([]);
      expect(response.summary.returned).toBe(0);
    });

    it('should delegate to search for a single query', async () => {
      const corpus = ['npm install timeout'];
      const { search, store, provider } = createTestSearch(corpus);

      await populateStore(store, provider, [
        { id: 'c1', docId: 'doc1', content: 'npm install timeout' },
      ]);

      const single = await search.search('npm install');
      const multi = await search.searchMultiple(['npm install']);

      expect(multi.results.length).toBe(single.results.length);
      if (multi.results.length > 0 && single.results.length > 0) {
        expect(multi.results[0].id).toBe(single.results[0].id);
      }
    });

    it('should merge results from multiple queries', async () => {
      const corpus = [
        'npm install timeout error',
        'permission denied access',
        'node version mismatch',
      ];
      const { search, store, provider } = createTestSearch(corpus);

      await populateStore(store, provider, [
        { id: 'c1', docId: 'doc1', content: 'npm install timeout error' },
        { id: 'c2', docId: 'doc2', content: 'permission denied access' },
        { id: 'c3', docId: 'doc3', content: 'node version mismatch' },
      ]);

      const response = await search.searchMultiple([
        'npm install timeout',
        'permission denied',
      ]);

      expect(response.results.length).toBeGreaterThan(0);
    });

    it('should keep highest score when results overlap', async () => {
      const corpus = [
        'npm install timeout error network',
      ];
      const { search, store, provider } = createTestSearch(corpus);

      await populateStore(store, provider, [
        { id: 'c1', docId: 'doc1', content: 'npm install timeout error network' },
      ]);

      const response = await search.searchMultiple([
        'npm install',
        'timeout error',
      ]);

      // The same record should appear only once
      const ids = response.results.map((r) => r.id);
      const uniqueIds = new Set(ids);
      expect(ids.length).toBe(uniqueIds.size);
    });

    it('should sort merged results by score descending', async () => {
      const corpus = [
        'npm install timeout error',
        'permission denied access',
        'node version mismatch compatibility',
      ];
      const { search, store, provider } = createTestSearch(corpus);

      await populateStore(store, provider, [
        { id: 'c1', docId: 'doc1', content: 'npm install timeout error' },
        { id: 'c2', docId: 'doc2', content: 'permission denied access' },
        { id: 'c3', docId: 'doc3', content: 'node version mismatch compatibility' },
      ]);

      const response = await search.searchMultiple([
        'npm install',
        'permission denied',
      ]);

      for (let i = 1; i < response.results.length; i++) {
        expect(response.results[i - 1].score).toBeGreaterThanOrEqual(response.results[i].score);
      }
    });

    it('should join query strings in summary', async () => {
      const { search } = createTestSearch(['hello world', 'foo bar']);
      const response = await search.searchMultiple(['hello', 'foo']);

      expect(response.summary.query).toContain('|');
    });

    it('should support deduplication with multiple queries', async () => {
      const corpus = [
        'npm install timeout first',
        'npm install timeout second',
        'permission denied fix',
      ];
      const { search, store, provider } = createTestSearch(corpus);

      await populateStore(store, provider, [
        { id: 'c1', docId: 'doc1', content: 'npm install timeout first' },
        { id: 'c2', docId: 'doc1', content: 'npm install timeout second' },
        { id: 'c3', docId: 'doc2', content: 'permission denied fix' },
      ]);

      const response = await search.searchMultiple(
        ['npm install', 'timeout'],
        { deduplicateByDocument: true, maxPerDocument: 1 },
      );

      const doc1Results = response.results.filter((r) => r.documentId === 'doc1');
      expect(doc1Results.length).toBeLessThanOrEqual(1);
    });
  });

  // --------------------------------------------------------------------------
  // findSimilarDocuments
  // --------------------------------------------------------------------------

  describe('findSimilarDocuments', () => {
    it('should return empty results for empty store', async () => {
      const { search } = createTestSearch(['hello']);
      const response = await search.findSimilarDocuments('doc1');

      expect(response.results).toEqual([]);
      expect(response.summary.returned).toBe(0);
    });

    it('should return empty results when document is not found', async () => {
      const corpus = ['npm install guide'];
      const { search, store, provider } = createTestSearch(corpus);

      await populateStore(store, provider, [
        { id: 'c1', docId: 'doc1', content: 'npm install guide' },
      ]);

      const response = await search.findSimilarDocuments('nonexistent');

      expect(response.results).toEqual([]);
    });

    it('should exclude the source document from results', async () => {
      const corpus = [
        'npm install guide setup',
        'npm install tutorial steps',
        'python setup guide',
      ];
      const { search, store, provider } = createTestSearch(corpus);

      await populateStore(store, provider, [
        { id: 'c1', docId: 'doc1', content: 'npm install guide setup' },
        { id: 'c2', docId: 'doc2', content: 'npm install tutorial steps' },
        { id: 'c3', docId: 'doc3', content: 'python setup guide' },
      ]);

      const response = await search.findSimilarDocuments('doc1');

      for (const result of response.results) {
        expect(result.documentId).not.toBe('doc1');
      }
    });

    it('should find documents with similar content', async () => {
      const corpus = [
        'npm install guide setup configure',
        'npm install tutorial steps walkthrough',
        'cooking recipe pasta tomato',
      ];
      const { search, store, provider } = createTestSearch(corpus);

      await populateStore(store, provider, [
        { id: 'c1', docId: 'doc1', content: 'npm install guide setup configure' },
        { id: 'c2', docId: 'doc2', content: 'npm install tutorial steps walkthrough' },
        { id: 'c3', docId: 'doc3', content: 'cooking recipe pasta tomato' },
      ]);

      const response = await search.findSimilarDocuments('doc1');

      if (response.results.length > 0) {
        // doc2 should be more similar to doc1 than doc3
        expect(response.results[0].documentId).toBe('doc2');
      }
    });

    it('should include summary with document query info', async () => {
      const corpus = ['npm install guide'];
      const { search, store, provider } = createTestSearch(corpus);

      await populateStore(store, provider, [
        { id: 'c1', docId: 'doc1', content: 'npm install guide' },
      ]);

      const response = await search.findSimilarDocuments('doc1');

      expect(response.summary.query).toContain('similar:');
      expect(response.summary.query).toContain('doc1');
    });

    it('should respect maxResults option', async () => {
      const corpus = [
        'npm install aaa',
        'npm install bbb',
        'npm install ccc',
        'npm install ddd',
      ];
      const { search, store, provider } = createTestSearch(corpus);

      await populateStore(store, provider, [
        { id: 'c1', docId: 'doc1', content: 'npm install aaa' },
        { id: 'c2', docId: 'doc2', content: 'npm install bbb' },
        { id: 'c3', docId: 'doc3', content: 'npm install ccc' },
        { id: 'c4', docId: 'doc4', content: 'npm install ddd' },
      ]);

      const response = await search.findSimilarDocuments('doc1', { maxResults: 1 });

      expect(response.results.length).toBeLessThanOrEqual(1);
    });

    it('should support category filter', async () => {
      const corpus = [
        'npm install guide setup',
        'npm install error fix',
        'npm install walkthrough',
      ];
      const { search, store, provider } = createTestSearch(corpus);

      await populateStore(store, provider, [
        { id: 'c1', docId: 'doc1', content: 'npm install guide setup', category: 'docs' },
        { id: 'c2', docId: 'doc2', content: 'npm install error fix', category: 'solutions' },
        { id: 'c3', docId: 'doc3', content: 'npm install walkthrough', category: 'docs' },
      ]);

      const response = await search.findSimilarDocuments('doc1', { category: 'docs' });

      for (const result of response.results) {
        expect(result.category).toBe('docs');
      }
    });
  });

  // --------------------------------------------------------------------------
  // Integration: full pipeline
  // --------------------------------------------------------------------------

  describe('Integration: full pipeline', () => {
    it('should work with TF-IDF provider end-to-end', async () => {
      const corpus = [
        'npm install timeout error solution',
        'permission denied when running npm install globally',
        'node version 22 required for openclaw',
        'pnpm setup configuration guide',
        'network proxy settings for npm registry',
      ];

      const { search, store, provider } = createTestSearch(corpus);

      await populateStore(store, provider, [
        { id: 'c1', docId: 'd1', content: corpus[0], category: 'solutions', heading: 'NPM Timeout' },
        { id: 'c2', docId: 'd2', content: corpus[1], category: 'issues', heading: 'Permission Error' },
        { id: 'c3', docId: 'd3', content: corpus[2], category: 'docs', heading: 'Node Version' },
        { id: 'c4', docId: 'd4', content: corpus[3], category: 'docs', heading: 'PNPM Setup' },
        { id: 'c5', docId: 'd5', content: corpus[4], category: 'solutions', heading: 'Proxy Settings' },
      ]);

      // Basic search
      const response = await search.search('npm install timeout');
      expect(response.results.length).toBeGreaterThan(0);
      expect(response.summary.query).toBe('npm install timeout');

      // Category filter
      const solutionsOnly = await search.search('npm install', { category: 'solutions' });
      for (const r of solutionsOnly.results) {
        expect(r.category).toBe('solutions');
      }
    });

    it('should handle consecutive searches correctly', async () => {
      const corpus = ['aaa bbb ccc', 'ddd eee fff', 'ggg hhh iii'];
      const { search, store, provider } = createTestSearch(corpus);

      await populateStore(store, provider, [
        { id: 'c1', docId: 'd1', content: 'aaa bbb ccc' },
        { id: 'c2', docId: 'd2', content: 'ddd eee fff' },
        { id: 'c3', docId: 'd3', content: 'ggg hhh iii' },
      ]);

      const r1 = await search.search('aaa');
      const r2 = await search.search('ddd');
      const r3 = await search.search('ggg');

      // Each search should find its matching document first
      if (r1.results.length > 0) expect(r1.results[0].id).toBe('c1');
      if (r2.results.length > 0) expect(r2.results[0].id).toBe('c2');
      if (r3.results.length > 0) expect(r3.results[0].id).toBe('c3');
    });

    it('should work with deduplication and multi-chunk documents', async () => {
      const corpus = [
        'npm install guide introduction',
        'npm install guide advanced steps',
        'npm install guide troubleshooting',
        'python pip install guide',
      ];
      const { search, store, provider } = createTestSearch(corpus);

      await populateStore(store, provider, [
        { id: 'c1', docId: 'npm-guide', content: 'npm install guide introduction' },
        { id: 'c2', docId: 'npm-guide', content: 'npm install guide advanced steps' },
        { id: 'c3', docId: 'npm-guide', content: 'npm install guide troubleshooting' },
        { id: 'c4', docId: 'pip-guide', content: 'python pip install guide' },
      ]);

      // Without deduplication
      const withDupes = await search.search('npm install guide', { maxResults: 10 });

      // With deduplication
      const withoutDupes = await search.search('npm install guide', {
        maxResults: 10,
        deduplicateByDocument: true,
        maxPerDocument: 1,
      });

      const npmGuideCountWithDupes = withDupes.results.filter(
        (r) => r.documentId === 'npm-guide',
      ).length;
      const npmGuideCountWithoutDupes = withoutDupes.results.filter(
        (r) => r.documentId === 'npm-guide',
      ).length;

      expect(npmGuideCountWithoutDupes).toBeLessThanOrEqual(1);
      expect(npmGuideCountWithDupes).toBeGreaterThanOrEqual(npmGuideCountWithoutDupes);
    });
  });
});
