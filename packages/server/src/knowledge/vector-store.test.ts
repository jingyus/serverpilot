/**
 * Tests for the vector database storage module.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  LocalVectorStore,
  createVectorStore,
  storeEmbeddings,
  type VectorStore,
  type VectorRecord,
  type VectorSearchResult,
  type SearchOptions,
  type StoreSummary,
  type StoreStats,
} from './vector-store.js';
import type { EmbeddedChunk } from './embedding-generator.js';

// ============================================================================
// Test Helpers
// ============================================================================

/** Create a simple normalized embedding vector */
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

/** Create multiple test chunks with distinct embeddings */
function makeChunks(count: number, docId = 'doc1'): EmbeddedChunk[] {
  const chunks: EmbeddedChunk[] = [];
  for (let i = 0; i < count; i++) {
    const values = new Array(4).fill(0);
    values[i % 4] = 1;
    chunks.push(
      makeChunk({
        chunkId: `${docId}#chunk-${i}`,
        documentId: docId,
        content: `content ${i}`,
        embedding: makeEmbedding(values),
        category: i % 2 === 0 ? 'docs' : 'issues',
        headingContext: `Heading ${i}`,
      }),
    );
  }
  return chunks;
}

// ============================================================================
// LocalVectorStore
// ============================================================================

describe('LocalVectorStore', () => {
  let store: LocalVectorStore;

  beforeEach(() => {
    store = new LocalVectorStore();
  });

  // --------------------------------------------------------------------------
  // getBackend
  // --------------------------------------------------------------------------

  describe('getBackend', () => {
    it('should return "local"', () => {
      expect(store.getBackend()).toBe('local');
    });
  });

  // --------------------------------------------------------------------------
  // upsert
  // --------------------------------------------------------------------------

  describe('upsert', () => {
    it('should store a single chunk', async () => {
      const chunk = makeChunk();
      const summary = await store.upsert([chunk]);

      expect(summary.totalRecords).toBe(1);
      expect(summary.stored).toBe(1);
      expect(summary.failed).toBe(0);
      expect(summary.backend).toBe('local');
      expect(summary.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should store multiple chunks', async () => {
      const chunks = makeChunks(5);
      const summary = await store.upsert(chunks);

      expect(summary.totalRecords).toBe(5);
      expect(summary.stored).toBe(5);
      expect(summary.failed).toBe(0);
    });

    it('should store zero chunks', async () => {
      const summary = await store.upsert([]);

      expect(summary.totalRecords).toBe(0);
      expect(summary.stored).toBe(0);
      expect(summary.failed).toBe(0);
    });

    it('should upsert (replace) existing records with same ID', async () => {
      const chunk1 = makeChunk({ chunkId: 'id1', content: 'original' });
      await store.upsert([chunk1]);

      const chunk2 = makeChunk({ chunkId: 'id1', content: 'updated' });
      const summary = await store.upsert([chunk2]);

      expect(summary.stored).toBe(1);

      const record = await store.get('id1');
      expect(record).not.toBeNull();
      expect(record!.content).toBe('updated');
    });

    it('should preserve all record fields', async () => {
      const chunk = makeChunk({
        chunkId: 'c1',
        documentId: 'd1',
        content: 'hello world',
        embedding: [0.5, 0.5, 0.5, 0.5],
        dimension: 4,
        category: 'solutions',
        headingContext: 'My Heading',
      });

      await store.upsert([chunk]);
      const record = await store.get('c1');

      expect(record).not.toBeNull();
      expect(record!.id).toBe('c1');
      expect(record!.documentId).toBe('d1');
      expect(record!.content).toBe('hello world');
      expect(record!.embedding).toEqual([0.5, 0.5, 0.5, 0.5]);
      expect(record!.dimension).toBe(4);
      expect(record!.category).toBe('solutions');
      expect(record!.headingContext).toBe('My Heading');
    });
  });

  // --------------------------------------------------------------------------
  // get
  // --------------------------------------------------------------------------

  describe('get', () => {
    it('should return null for non-existent ID', async () => {
      const result = await store.get('nonexistent');
      expect(result).toBeNull();
    });

    it('should return the stored record by ID', async () => {
      await store.upsert([makeChunk({ chunkId: 'abc' })]);
      const result = await store.get('abc');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('abc');
    });
  });

  // --------------------------------------------------------------------------
  // search
  // --------------------------------------------------------------------------

  describe('search', () => {
    it('should return empty array for empty store', async () => {
      const results = await store.search(makeEmbedding([1, 0, 0, 0]));
      expect(results).toEqual([]);
    });

    it('should find the most similar record', async () => {
      const chunks = [
        makeChunk({ chunkId: 'a', content: 'first', embedding: makeEmbedding([1, 0, 0, 0]) }),
        makeChunk({ chunkId: 'b', content: 'second', embedding: makeEmbedding([0, 1, 0, 0]) }),
        makeChunk({ chunkId: 'c', content: 'third', embedding: makeEmbedding([0, 0, 1, 0]) }),
      ];
      await store.upsert(chunks);

      const results = await store.search(makeEmbedding([1, 0, 0, 0]));

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].record.id).toBe('a');
      expect(results[0].score).toBeCloseTo(1, 5);
    });

    it('should sort results by score descending', async () => {
      const chunks = [
        makeChunk({ chunkId: 'a', embedding: makeEmbedding([1, 0, 0, 0]) }),
        makeChunk({ chunkId: 'b', embedding: makeEmbedding([0.8, 0.6, 0, 0]) }),
        makeChunk({ chunkId: 'c', embedding: makeEmbedding([0.5, 0.5, 0.5, 0.5]) }),
      ];
      await store.upsert(chunks);

      const results = await store.search(makeEmbedding([1, 0, 0, 0]));

      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
      }
    });

    it('should respect maxResults option', async () => {
      await store.upsert(makeChunks(10));

      const results = await store.search(makeEmbedding([1, 0, 0, 0]), { maxResults: 3 });

      expect(results.length).toBeLessThanOrEqual(3);
    });

    it('should respect minScore option', async () => {
      const chunks = [
        makeChunk({ chunkId: 'a', embedding: makeEmbedding([1, 0, 0, 0]) }),
        makeChunk({ chunkId: 'b', embedding: makeEmbedding([0, 0, 0, 1]) }),
      ];
      await store.upsert(chunks);

      // Query is [1,0,0,0] - similar to 'a' but not 'b'
      const results = await store.search(makeEmbedding([1, 0, 0, 0]), { minScore: 0.5 });

      expect(results.length).toBe(1);
      expect(results[0].record.id).toBe('a');
    });

    it('should filter by category', async () => {
      const chunks = [
        makeChunk({ chunkId: 'a', category: 'docs', embedding: makeEmbedding([1, 0, 0, 0]) }),
        makeChunk({ chunkId: 'b', category: 'issues', embedding: makeEmbedding([1, 0, 0, 0]) }),
      ];
      await store.upsert(chunks);

      const results = await store.search(makeEmbedding([1, 0, 0, 0]), { category: 'docs' });

      expect(results.length).toBe(1);
      expect(results[0].record.category).toBe('docs');
    });

    it('should filter by documentId', async () => {
      const chunks = [
        makeChunk({ chunkId: 'a', documentId: 'doc1', embedding: makeEmbedding([1, 0, 0, 0]) }),
        makeChunk({ chunkId: 'b', documentId: 'doc2', embedding: makeEmbedding([1, 0, 0, 0]) }),
      ];
      await store.upsert(chunks);

      const results = await store.search(makeEmbedding([1, 0, 0, 0]), { documentId: 'doc1' });

      expect(results.length).toBe(1);
      expect(results[0].record.documentId).toBe('doc1');
    });

    it('should combine multiple filters', async () => {
      const chunks = [
        makeChunk({ chunkId: 'a', documentId: 'doc1', category: 'docs', embedding: makeEmbedding([1, 0, 0, 0]) }),
        makeChunk({ chunkId: 'b', documentId: 'doc1', category: 'issues', embedding: makeEmbedding([1, 0, 0, 0]) }),
        makeChunk({ chunkId: 'c', documentId: 'doc2', category: 'docs', embedding: makeEmbedding([1, 0, 0, 0]) }),
      ];
      await store.upsert(chunks);

      const results = await store.search(makeEmbedding([1, 0, 0, 0]), {
        documentId: 'doc1',
        category: 'docs',
      });

      expect(results.length).toBe(1);
      expect(results[0].record.id).toBe('a');
    });

    it('should skip records with dimension mismatch', async () => {
      const chunks = [
        makeChunk({ chunkId: 'a', embedding: makeEmbedding([1, 0, 0, 0]), dimension: 4 }),
      ];
      await store.upsert(chunks);

      // Query with different dimension
      const results = await store.search(makeEmbedding([1, 0, 0, 0, 0, 0]));

      expect(results.length).toBe(0);
    });

    it('should use default options when none provided', async () => {
      await store.upsert([makeChunk({ embedding: makeEmbedding([1, 0, 0, 0]) })]);

      const results = await store.search(makeEmbedding([1, 0, 0, 0]));

      expect(results.length).toBe(1);
    });

    it('should handle zero vector query', async () => {
      await store.upsert([makeChunk({ embedding: makeEmbedding([1, 0, 0, 0]) })]);

      const results = await store.search([0, 0, 0, 0]);

      expect(results.length).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // delete
  // --------------------------------------------------------------------------

  describe('delete', () => {
    it('should delete existing records', async () => {
      await store.upsert(makeChunks(3));

      const deleted = await store.delete(['doc1#chunk-0', 'doc1#chunk-1']);

      expect(deleted).toBe(2);

      const record0 = await store.get('doc1#chunk-0');
      const record1 = await store.get('doc1#chunk-1');
      const record2 = await store.get('doc1#chunk-2');

      expect(record0).toBeNull();
      expect(record1).toBeNull();
      expect(record2).not.toBeNull();
    });

    it('should return 0 for non-existent IDs', async () => {
      const deleted = await store.delete(['nonexistent']);
      expect(deleted).toBe(0);
    });

    it('should handle empty ID array', async () => {
      const deleted = await store.delete([]);
      expect(deleted).toBe(0);
    });

    it('should count only actually deleted records', async () => {
      await store.upsert([makeChunk({ chunkId: 'exists' })]);

      const deleted = await store.delete(['exists', 'nonexistent']);

      expect(deleted).toBe(1);
    });
  });

  // --------------------------------------------------------------------------
  // deleteByDocument
  // --------------------------------------------------------------------------

  describe('deleteByDocument', () => {
    it('should delete all records for a document', async () => {
      const chunks = [
        ...makeChunks(3, 'doc1'),
        ...makeChunks(2, 'doc2'),
      ];
      await store.upsert(chunks);

      const deleted = await store.deleteByDocument('doc1');

      expect(deleted).toBe(3);
      const stats = await store.getStats();
      expect(stats.totalRecords).toBe(2);
    });

    it('should return 0 for non-existent document', async () => {
      const deleted = await store.deleteByDocument('nonexistent');
      expect(deleted).toBe(0);
    });

    it('should not affect other documents', async () => {
      const chunks = [
        ...makeChunks(2, 'doc1'),
        ...makeChunks(2, 'doc2'),
      ];
      await store.upsert(chunks);

      await store.deleteByDocument('doc1');

      const record = await store.get('doc2#chunk-0');
      expect(record).not.toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // getStats
  // --------------------------------------------------------------------------

  describe('getStats', () => {
    it('should return zero stats for empty store', async () => {
      const stats = await store.getStats();

      expect(stats.totalRecords).toBe(0);
      expect(stats.uniqueDocuments).toBe(0);
      expect(stats.dimension).toBe(0);
      expect(stats.backend).toBe('local');
    });

    it('should return correct stats after upsert', async () => {
      const chunks = [
        ...makeChunks(3, 'doc1'),
        ...makeChunks(2, 'doc2'),
      ];
      await store.upsert(chunks);

      const stats = await store.getStats();

      expect(stats.totalRecords).toBe(5);
      expect(stats.uniqueDocuments).toBe(2);
      expect(stats.dimension).toBe(4);
      expect(stats.backend).toBe('local');
    });

    it('should update after delete', async () => {
      await store.upsert(makeChunks(3));
      await store.delete(['doc1#chunk-0']);

      const stats = await store.getStats();
      expect(stats.totalRecords).toBe(2);
    });
  });

  // --------------------------------------------------------------------------
  // clear
  // --------------------------------------------------------------------------

  describe('clear', () => {
    it('should remove all records', async () => {
      await store.upsert(makeChunks(5));
      await store.clear();

      const stats = await store.getStats();
      expect(stats.totalRecords).toBe(0);
    });

    it('should be idempotent on empty store', async () => {
      await store.clear();
      const stats = await store.getStats();
      expect(stats.totalRecords).toBe(0);
    });
  });
});

// ============================================================================
// createVectorStore
// ============================================================================

describe('createVectorStore', () => {
  it('should create a LocalVectorStore for "local" backend', () => {
    const store = createVectorStore('local');
    expect(store).toBeInstanceOf(LocalVectorStore);
    expect(store.getBackend()).toBe('local');
  });

  it('should fall back to LocalVectorStore for "qdrant" when fallbackToLocal is true', () => {
    const store = createVectorStore('qdrant', true);
    expect(store).toBeInstanceOf(LocalVectorStore);
  });

  it('should fall back to LocalVectorStore for "pinecone" when fallbackToLocal is true', () => {
    const store = createVectorStore('pinecone', true);
    expect(store).toBeInstanceOf(LocalVectorStore);
  });

  it('should throw for "qdrant" when fallbackToLocal is false', () => {
    expect(() => createVectorStore('qdrant', false)).toThrow(
      /not yet implemented/,
    );
  });

  it('should throw for "pinecone" when fallbackToLocal is false', () => {
    expect(() => createVectorStore('pinecone', false)).toThrow(
      /not yet implemented/,
    );
  });

  it('should default fallbackToLocal to true', () => {
    const store = createVectorStore('qdrant');
    expect(store).toBeInstanceOf(LocalVectorStore);
  });

  it('should throw for unknown backend', () => {
    expect(() => createVectorStore('unknown' as any, false)).toThrow(
      /Unknown vector store backend/,
    );
  });
});

// ============================================================================
// storeEmbeddings (pipeline helper)
// ============================================================================

describe('storeEmbeddings', () => {
  it('should store chunks into the provided vector store', async () => {
    const store = new LocalVectorStore();
    const chunks = makeChunks(3);

    const summary = await storeEmbeddings(chunks, store);

    expect(summary.stored).toBe(3);
    expect(summary.failed).toBe(0);

    const stats = await store.getStats();
    expect(stats.totalRecords).toBe(3);
  });

  it('should work with empty chunks', async () => {
    const store = new LocalVectorStore();
    const summary = await storeEmbeddings([], store);

    expect(summary.stored).toBe(0);
    expect(summary.totalRecords).toBe(0);
  });

  it('should return a valid StoreSummary', async () => {
    const store = new LocalVectorStore();
    const summary = await storeEmbeddings(makeChunks(2), store);

    expect(summary).toHaveProperty('totalRecords');
    expect(summary).toHaveProperty('stored');
    expect(summary).toHaveProperty('failed');
    expect(summary).toHaveProperty('backend');
    expect(summary).toHaveProperty('durationMs');
    expect(summary.backend).toBe('local');
  });
});

// ============================================================================
// Integration: upsert + search
// ============================================================================

describe('Integration: upsert + search', () => {
  let store: LocalVectorStore;

  beforeEach(() => {
    store = new LocalVectorStore();
  });

  it('should find upserted records via search', async () => {
    const chunks = [
      makeChunk({ chunkId: 'install-guide', content: 'npm install', embedding: makeEmbedding([1, 0.5, 0, 0]) }),
      makeChunk({ chunkId: 'error-fix', content: 'permission denied fix', embedding: makeEmbedding([0, 0, 1, 0.5]) }),
    ];
    await store.upsert(chunks);

    // Search with a vector close to the first chunk
    const results = await store.search(makeEmbedding([1, 0.3, 0, 0]));

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].record.id).toBe('install-guide');
  });

  it('should not find records after clear', async () => {
    await store.upsert(makeChunks(3));
    await store.clear();

    const results = await store.search(makeEmbedding([1, 0, 0, 0]));
    expect(results.length).toBe(0);
  });

  it('should not find deleted records', async () => {
    await store.upsert([
      makeChunk({ chunkId: 'keep', embedding: makeEmbedding([1, 0, 0, 0]) }),
      makeChunk({ chunkId: 'remove', embedding: makeEmbedding([1, 0, 0, 0]) }),
    ]);
    await store.delete(['remove']);

    const results = await store.search(makeEmbedding([1, 0, 0, 0]));

    expect(results.length).toBe(1);
    expect(results[0].record.id).toBe('keep');
  });

  it('should reflect upserted (updated) records in search', async () => {
    await store.upsert([
      makeChunk({ chunkId: 'item', content: 'old content', embedding: makeEmbedding([1, 0, 0, 0]) }),
    ]);

    // Upsert with updated content and different embedding
    await store.upsert([
      makeChunk({ chunkId: 'item', content: 'new content', embedding: makeEmbedding([0, 0, 1, 0]) }),
    ]);

    // Search for the new embedding direction
    const results = await store.search(makeEmbedding([0, 0, 1, 0]));

    expect(results.length).toBe(1);
    expect(results[0].record.content).toBe('new content');
    expect(results[0].score).toBeCloseTo(1, 5);
  });

  it('should handle full pipeline: upsert many, search, filter', async () => {
    const docsChunks = makeChunks(4, 'docs-doc');
    const issuesChunks = makeChunks(4, 'issues-doc');

    // Set specific categories
    for (const c of docsChunks) c.category = 'docs';
    for (const c of issuesChunks) c.category = 'issues';

    await store.upsert([...docsChunks, ...issuesChunks]);

    const stats = await store.getStats();
    expect(stats.totalRecords).toBe(8);
    expect(stats.uniqueDocuments).toBe(2);

    // Search with category filter
    const docsResults = await store.search(makeEmbedding([1, 0, 0, 0]), {
      category: 'docs',
      maxResults: 10,
    });

    for (const r of docsResults) {
      expect(r.record.category).toBe('docs');
    }
  });
});
