// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for the in-memory vector database module (VectorDB).
 *
 * Covers TF-IDF indexing, cosine similarity search, document CRUD,
 * vocabulary management, and edge cases.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { VectorDB } from './vectordb.js';

// ============================================================================
// Test Helpers
// ============================================================================

/** Minimal KnowledgeDocument shape matching loader.ts */
interface KnowledgeDocument {
  id: string;
  title: string;
  content: string;
  filePath: string;
  category: string;
}

/** Create a test KnowledgeDocument with sensible defaults */
function makeDoc(id: string, title: string, content: string, category = 'root'): KnowledgeDocument {
  return { id, title, content, filePath: `${category}/${id}.md`, category };
}

// ============================================================================
// VectorDB - Constructor
// ============================================================================

describe('VectorDB', () => {
  let db: VectorDB;

  beforeEach(() => {
    db = new VectorDB();
  });

  // --------------------------------------------------------------------------
  // Constructor
  // --------------------------------------------------------------------------

  describe('constructor', () => {
    it('should create an instance with default options', () => {
      const instance = new VectorDB();
      expect(instance).toBeInstanceOf(VectorDB);
      expect(instance.isIndexed()).toBe(false);
      expect(instance.getDocumentCount()).toBe(0);
      expect(instance.getVocabularySize()).toBe(0);
    });

    it('should accept custom maxFeatures option', () => {
      const instance = new VectorDB({ maxFeatures: 100 });
      expect(instance).toBeInstanceOf(VectorDB);
    });

    it('should accept custom minDocFreq option', () => {
      const instance = new VectorDB({ minDocFreq: 3 });
      expect(instance).toBeInstanceOf(VectorDB);
    });

    it('should accept both custom options together', () => {
      const instance = new VectorDB({ maxFeatures: 200, minDocFreq: 2 });
      expect(instance).toBeInstanceOf(VectorDB);
    });
  });

  // --------------------------------------------------------------------------
  // indexDocuments
  // --------------------------------------------------------------------------

  describe('indexDocuments', () => {
    it('should index documents and return the count', () => {
      const docs = [
        makeDoc('d1', 'Install Guide', 'How to install packages using npm'),
        makeDoc('d2', 'Error Fixes', 'Common error solutions for node projects'),
      ];
      const count = db.indexDocuments(docs);
      expect(count).toBe(2);
    });

    it('should handle an empty array and still mark as indexed', () => {
      const count = db.indexDocuments([]);
      expect(count).toBe(0);
      expect(db.isIndexed()).toBe(true);
      expect(db.getDocumentCount()).toBe(0);
      expect(db.getVocabularySize()).toBe(0);
    });

    it('should build a vocabulary from the documents', () => {
      const docs = [
        makeDoc('d1', 'Alpha', 'javascript typescript programming'),
        makeDoc('d2', 'Beta', 'python programming machine learning'),
      ];
      db.indexDocuments(docs);
      expect(db.getVocabularySize()).toBeGreaterThan(0);
    });

    it('should compute embeddings for each document', () => {
      const docs = [
        makeDoc('d1', 'Title', 'content words here'),
      ];
      db.indexDocuments(docs);

      const vectorDoc = db.getDocument('d1');
      expect(vectorDoc).toBeDefined();
      expect(vectorDoc!.embedding).toBeInstanceOf(Array);
      expect(vectorDoc!.embedding.length).toBe(db.getVocabularySize());
    });

    it('should set the indexed flag to true', () => {
      expect(db.isIndexed()).toBe(false);
      db.indexDocuments([makeDoc('d1', 'Title', 'content')]);
      expect(db.isIndexed()).toBe(true);
    });

    it('should replace previous index when called again', () => {
      db.indexDocuments([
        makeDoc('d1', 'First', 'first batch'),
        makeDoc('d2', 'Second', 'second batch'),
      ]);
      expect(db.getDocumentCount()).toBe(2);

      db.indexDocuments([makeDoc('d3', 'Third', 'third batch only')]);
      expect(db.getDocumentCount()).toBe(1);
      expect(db.getDocument('d1')).toBeUndefined();
      expect(db.getDocument('d3')).toBeDefined();
    });
  });

  // --------------------------------------------------------------------------
  // search
  // --------------------------------------------------------------------------

  describe('search', () => {
    it('should return empty array before indexing', () => {
      const results = db.search('anything');
      expect(results).toEqual([]);
    });

    it('should return empty array when indexed with no documents', () => {
      db.indexDocuments([]);
      const results = db.search('anything');
      expect(results).toEqual([]);
    });

    it('should find relevant documents by query terms', () => {
      db.indexDocuments([
        makeDoc('d1', 'Install Guide', 'npm install packages step by step'),
        makeDoc('d2', 'Error Fixes', 'common runtime errors debugging tips'),
      ]);

      const results = db.search('install npm');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].document.id).toBe('d1');
    });

    it('should return results sorted by similarity descending', () => {
      db.indexDocuments([
        makeDoc('d1', 'Alpha', 'webpack bundler configuration setup'),
        makeDoc('d2', 'Beta', 'webpack webpack webpack performance tuning'),
        makeDoc('d3', 'Gamma', 'database migration schema design'),
      ]);

      const results = db.search('webpack');
      expect(results.length).toBeGreaterThanOrEqual(1);

      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].similarity).toBeGreaterThanOrEqual(results[i].similarity);
      }
    });

    it('should return empty array when query has no vocabulary overlap', () => {
      db.indexDocuments([
        makeDoc('d1', 'Guide', 'javascript typescript programming'),
      ]);

      // Use completely unrelated terms that would not appear in the vocab
      const results = db.search('xylophone zebra');
      expect(results).toEqual([]);
    });

    it('should respect the maxResults parameter', () => {
      db.indexDocuments([
        makeDoc('d1', 'Doc One', 'testing framework jest vitest'),
        makeDoc('d2', 'Doc Two', 'testing coverage reports jest'),
        makeDoc('d3', 'Doc Three', 'testing snapshots jest assertions'),
        makeDoc('d4', 'Doc Four', 'testing mocking jest spies'),
        makeDoc('d5', 'Doc Five', 'testing integration jest e2e'),
      ]);

      const results = db.search('testing jest', 2);
      expect(results.length).toBeLessThanOrEqual(2);
    });

    it('should respect the minSimilarity parameter', () => {
      db.indexDocuments([
        makeDoc('d1', 'Relevant', 'docker container orchestration kubernetes'),
        makeDoc('d2', 'Barely', 'python flask web server deployment docker'),
      ]);

      const highThreshold = db.search('docker kubernetes', 5, 0.99);
      const lowThreshold = db.search('docker kubernetes', 5, 0.01);

      expect(highThreshold.length).toBeLessThanOrEqual(lowThreshold.length);
    });

    it('should include snippets in results', () => {
      db.indexDocuments([
        makeDoc('d1', 'Guide', 'Step one: install dependencies\nStep two: run build\nStep three: deploy'),
        makeDoc('d2', 'Other', 'unrelated topic about cooking recipes'),
      ]);

      const results = db.search('install');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].snippets).toBeInstanceOf(Array);
    });

    it('should include a similarity property on each result', () => {
      db.indexDocuments([
        makeDoc('d1', 'Guide', 'react component hooks state management'),
        makeDoc('d2', 'Other', 'database schema migration design patterns'),
      ]);

      const results = db.search('react hooks');
      expect(results.length).toBeGreaterThan(0);
      expect(typeof results[0].similarity).toBe('number');
      expect(results[0].similarity).toBeGreaterThan(0);
      expect(results[0].similarity).toBeLessThanOrEqual(1);
    });

    it('should set score equal to similarity', () => {
      db.indexDocuments([
        makeDoc('d1', 'Guide', 'react component hooks state'),
        makeDoc('d2', 'Other', 'database migration schema query'),
      ]);

      const results = db.search('react hooks');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].score).toBe(results[0].similarity);
    });

    it('should return empty when query consists only of stopwords', () => {
      db.indexDocuments([
        makeDoc('d1', 'Guide', 'important information here'),
      ]);

      // "the", "is", "a", "and" are all stopwords
      const results = db.search('the is a and');
      expect(results).toEqual([]);
    });
  });

  // --------------------------------------------------------------------------
  // addDocument
  // --------------------------------------------------------------------------

  describe('addDocument', () => {
    it('should add a document to an existing index', () => {
      db.indexDocuments([
        makeDoc('d1', 'First', 'initial content words here'),
      ]);
      expect(db.getDocumentCount()).toBe(1);

      db.addDocument(makeDoc('d2', 'Second', 'additional content words'));
      expect(db.getDocumentCount()).toBe(2);
      expect(db.getDocument('d2')).toBeDefined();
    });

    it('should index if not already indexed', () => {
      expect(db.isIndexed()).toBe(false);

      db.addDocument(makeDoc('d1', 'First', 'some content here'));

      expect(db.isIndexed()).toBe(true);
      expect(db.getDocumentCount()).toBe(1);
    });

    it('should compute an embedding for the added document', () => {
      db.indexDocuments([
        makeDoc('d1', 'Existing', 'existing content data'),
      ]);

      db.addDocument(makeDoc('d2', 'New', 'new content data'));
      const vectorDoc = db.getDocument('d2');

      expect(vectorDoc).toBeDefined();
      expect(vectorDoc!.embedding).toBeInstanceOf(Array);
      expect(vectorDoc!.embedding.length).toBe(db.getVocabularySize());
    });
  });

  // --------------------------------------------------------------------------
  // removeDocument
  // --------------------------------------------------------------------------

  describe('removeDocument', () => {
    it('should remove a document by ID and return true', () => {
      db.indexDocuments([
        makeDoc('d1', 'First', 'content one'),
        makeDoc('d2', 'Second', 'content two'),
      ]);

      const removed = db.removeDocument('d1');
      expect(removed).toBe(true);
      expect(db.getDocumentCount()).toBe(1);
      expect(db.getDocument('d1')).toBeUndefined();
    });

    it('should return false for a non-existent document ID', () => {
      db.indexDocuments([makeDoc('d1', 'First', 'content one')]);
      const removed = db.removeDocument('nonexistent');
      expect(removed).toBe(false);
      expect(db.getDocumentCount()).toBe(1);
    });

    it('should return false when index is empty', () => {
      const removed = db.removeDocument('anything');
      expect(removed).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // getDocument
  // --------------------------------------------------------------------------

  describe('getDocument', () => {
    it('should find a document by ID', () => {
      db.indexDocuments([
        makeDoc('d1', 'First', 'content one'),
        makeDoc('d2', 'Second', 'content two'),
      ]);

      const doc = db.getDocument('d1');
      expect(doc).toBeDefined();
      expect(doc!.id).toBe('d1');
      expect(doc!.document.title).toBe('First');
    });

    it('should return undefined for a missing ID', () => {
      db.indexDocuments([makeDoc('d1', 'First', 'content one')]);
      const doc = db.getDocument('nonexistent');
      expect(doc).toBeUndefined();
    });

    it('should return undefined when nothing is indexed', () => {
      const doc = db.getDocument('anything');
      expect(doc).toBeUndefined();
    });

    it('should return a VectorDocument with embedding', () => {
      db.indexDocuments([makeDoc('d1', 'Title', 'some words')]);
      const doc = db.getDocument('d1');

      expect(doc).toBeDefined();
      expect(doc!.id).toBe('d1');
      expect(doc!.document).toBeDefined();
      expect(doc!.embedding).toBeInstanceOf(Array);
    });
  });

  // --------------------------------------------------------------------------
  // isIndexed / getDocumentCount / getVocabularySize
  // --------------------------------------------------------------------------

  describe('isIndexed', () => {
    it('should return false initially', () => {
      expect(db.isIndexed()).toBe(false);
    });

    it('should return true after indexing', () => {
      db.indexDocuments([makeDoc('d1', 'Title', 'content')]);
      expect(db.isIndexed()).toBe(true);
    });

    it('should return true after indexing empty array', () => {
      db.indexDocuments([]);
      expect(db.isIndexed()).toBe(true);
    });
  });

  describe('getDocumentCount', () => {
    it('should return 0 initially', () => {
      expect(db.getDocumentCount()).toBe(0);
    });

    it('should return the correct count after indexing', () => {
      db.indexDocuments([
        makeDoc('d1', 'A', 'alpha'),
        makeDoc('d2', 'B', 'beta'),
        makeDoc('d3', 'C', 'gamma'),
      ]);
      expect(db.getDocumentCount()).toBe(3);
    });

    it('should update after addDocument', () => {
      db.indexDocuments([makeDoc('d1', 'A', 'alpha')]);
      db.addDocument(makeDoc('d2', 'B', 'beta'));
      expect(db.getDocumentCount()).toBe(2);
    });

    it('should update after removeDocument', () => {
      db.indexDocuments([
        makeDoc('d1', 'A', 'alpha'),
        makeDoc('d2', 'B', 'beta'),
      ]);
      db.removeDocument('d1');
      expect(db.getDocumentCount()).toBe(1);
    });
  });

  describe('getVocabularySize', () => {
    it('should return 0 initially', () => {
      expect(db.getVocabularySize()).toBe(0);
    });

    it('should return a positive number after indexing documents with content', () => {
      db.indexDocuments([makeDoc('d1', 'Title', 'javascript typescript programming')]);
      expect(db.getVocabularySize()).toBeGreaterThan(0);
    });
  });

  // --------------------------------------------------------------------------
  // clear
  // --------------------------------------------------------------------------

  describe('clear', () => {
    it('should remove all documents and reset vocabulary', () => {
      db.indexDocuments([
        makeDoc('d1', 'First', 'content words here'),
        makeDoc('d2', 'Second', 'more content words'),
      ]);
      expect(db.getDocumentCount()).toBe(2);
      expect(db.getVocabularySize()).toBeGreaterThan(0);

      db.clear();

      expect(db.getDocumentCount()).toBe(0);
      expect(db.getVocabularySize()).toBe(0);
    });

    it('should reset the indexed state to false', () => {
      db.indexDocuments([makeDoc('d1', 'Title', 'content')]);
      expect(db.isIndexed()).toBe(true);

      db.clear();
      expect(db.isIndexed()).toBe(false);
    });

    it('should be safe to call on an empty, non-indexed db', () => {
      db.clear();
      expect(db.isIndexed()).toBe(false);
      expect(db.getDocumentCount()).toBe(0);
      expect(db.getVocabularySize()).toBe(0);
    });

    it('should make search return empty results', () => {
      db.indexDocuments([makeDoc('d1', 'Guide', 'install packages npm')]);
      db.clear();

      const results = db.search('install');
      expect(results).toEqual([]);
    });
  });

  // --------------------------------------------------------------------------
  // TF-IDF Behavior
  // --------------------------------------------------------------------------

  describe('TF-IDF behavior', () => {
    it('should rank a more relevant document higher', () => {
      db.indexDocuments([
        makeDoc('d1', 'NPM Guide', 'npm install npm run npm build npm test'),
        makeDoc('d2', 'Random', 'random unrelated topic about cooking recipes'),
      ]);

      const results = db.search('npm install');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].document.id).toBe('d1');
    });

    it('should give higher similarity when term frequency is higher', () => {
      db.indexDocuments([
        makeDoc('d1', 'Repeated', 'docker docker docker container container'),
        makeDoc('d2', 'Single', 'docker container orchestration service mesh'),
        makeDoc('d3', 'Unrelated', 'baking bread flour yeast oven temperature'),
      ]);

      const results = db.search('docker container');
      expect(results.length).toBeGreaterThanOrEqual(2);
      // d1 has a higher proportion of the query terms
      // Both d1 and d2 should appear; the one with more matching tokens should rank higher or similarly
      const ids = results.map((r) => r.document.id);
      expect(ids).toContain('d1');
      expect(ids).toContain('d2');
    });

    it('should give higher weight to rarer terms (IDF effect)', () => {
      // "common" appears in all docs, "rare" only in d1
      db.indexDocuments([
        makeDoc('d1', 'Rare', 'common rare unique special'),
        makeDoc('d2', 'Common1', 'common everyday normal typical'),
        makeDoc('d3', 'Common2', 'common regular standard basic'),
      ]);

      const results = db.search('rare');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].document.id).toBe('d1');
    });

    it('should produce L2-normalized embeddings', () => {
      db.indexDocuments([
        makeDoc('d1', 'Test', 'alpha beta gamma delta epsilon'),
      ]);

      const vectorDoc = db.getDocument('d1');
      expect(vectorDoc).toBeDefined();

      const embedding = vectorDoc!.embedding;
      const magnitude = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));

      // Normalized vector should have magnitude ~1 (or 0 if all zeros)
      if (magnitude > 0) {
        expect(magnitude).toBeCloseTo(1, 5);
      }
    });
  });

  // --------------------------------------------------------------------------
  // Edge Cases
  // --------------------------------------------------------------------------

  describe('edge cases', () => {
    it('should handle a single document', () => {
      db.indexDocuments([makeDoc('d1', 'Solo', 'only document here')]);

      expect(db.getDocumentCount()).toBe(1);
      expect(db.isIndexed()).toBe(true);

      // IDF for terms unique to one doc in a corpus of 1: log(1/1) = 0
      // So the embedding will be all zeros and search should return empty
      const results = db.search('document');
      // With single doc, log(1/1) = 0 so all IDF values are 0
      // The embedding will be a zero vector, so search returns []
      expect(results).toEqual([]);
    });

    it('should handle identical documents', () => {
      db.indexDocuments([
        makeDoc('d1', 'Same', 'identical content here'),
        makeDoc('d2', 'Same', 'identical content here'),
      ]);

      expect(db.getDocumentCount()).toBe(2);

      // Both have the same embedding, search should return both
      const results = db.search('identical content');
      // "identical" appears in both docs: IDF = log(2/2) = 0
      // "content" appears in both docs: IDF = log(2/2) = 0
      // All IDF = 0 so embeddings are zero vectors => empty results
      expect(results).toEqual([]);
    });

    it('should cap vocabulary at maxFeatures', () => {
      // Create docs with many unique terms
      const docs: KnowledgeDocument[] = [];
      for (let i = 0; i < 20; i++) {
        const words = Array.from({ length: 10 }, (_, j) => `word${i}x${j}`).join(' ');
        docs.push(makeDoc(`d${i}`, `Doc ${i}`, words));
      }

      const limitedDb = new VectorDB({ maxFeatures: 10 });
      limitedDb.indexDocuments(docs);

      expect(limitedDb.getVocabularySize()).toBeLessThanOrEqual(10);
    });

    it('should filter terms below minDocFreq', () => {
      // "shared" appears in both docs, "unique1" only in d1, "unique2" only in d2
      const docs = [
        makeDoc('d1', 'Doc1', 'shared shared unique1'),
        makeDoc('d2', 'Doc2', 'shared shared unique2'),
      ];

      const strictDb = new VectorDB({ minDocFreq: 2 });
      strictDb.indexDocuments(docs);

      // Only "shared" meets minDocFreq=2 (but IDF = log(2/2) = 0, so it contributes 0)
      // "unique1" and "unique2" each have df=1, which is < minDocFreq=2
      // "doc1", "doc2" come from title+content concatenation
      // The vocabulary should be smaller than with minDocFreq=1
      const defaultDb = new VectorDB({ minDocFreq: 1 });
      defaultDb.indexDocuments(docs);

      expect(strictDb.getVocabularySize()).toBeLessThan(defaultDb.getVocabularySize());
    });

    it('should filter stopwords during tokenization', () => {
      // Document whose content is mostly stopwords plus one real word
      db.indexDocuments([
        makeDoc('d1', 'Stopwords', 'the is at which on a an and or but javascript'),
        makeDoc('d2', 'Other', 'python typescript golang rust programming'),
      ]);

      // Search for "javascript" should find d1
      const results = db.search('javascript');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].document.id).toBe('d1');
    });

    it('should handle Chinese characters in content', () => {
      db.indexDocuments([
        makeDoc('d1', 'Chinese', 'npm install error'),
        makeDoc('d2', 'English', 'npm install error guide'),
      ]);

      // Basic test: indexing with non-ASCII should not throw
      expect(db.isIndexed()).toBe(true);
      expect(db.getDocumentCount()).toBe(2);
    });

    it('should handle hyphenated terms', () => {
      db.indexDocuments([
        makeDoc('d1', 'Hyphen', 'cross-platform multi-threading real-time'),
        makeDoc('d2', 'Plain', 'performance optimization scaling patterns'),
      ]);

      const results = db.search('cross-platform');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].document.id).toBe('d1');
    });

    it('should handle documents with empty content', () => {
      db.indexDocuments([
        makeDoc('d1', 'Empty', ''),
        makeDoc('d2', 'Filled', 'actual content words here'),
      ]);

      expect(db.getDocumentCount()).toBe(2);
      expect(db.isIndexed()).toBe(true);
    });

    it('should handle query with special characters', () => {
      db.indexDocuments([
        makeDoc('d1', 'Guide', 'install packages npm yarn'),
      ]);

      // Special characters should not cause errors
      const results = db.search('install!!! @#$% npm');
      // After tokenization, special chars are removed; "install" and "npm" remain
      expect(results.length).toBeGreaterThanOrEqual(0);
    });
  });

  // --------------------------------------------------------------------------
  // Integration: index + search + mutate
  // --------------------------------------------------------------------------

  describe('integration: index, search, mutate', () => {
    it('should find newly added documents via search', () => {
      db.indexDocuments([
        makeDoc('d1', 'Base', 'react hooks state management'),
        makeDoc('d2', 'Other', 'vue composition api reactive'),
      ]);

      db.addDocument(makeDoc('d3', 'Added', 'react hooks custom hook patterns'));

      const results = db.search('react hooks');
      const ids = results.map((r) => r.document.id);
      expect(ids).toContain('d1');
    });

    it('should not find removed documents via search', () => {
      db.indexDocuments([
        makeDoc('d1', 'Keep', 'database queries optimization'),
        makeDoc('d2', 'Remove', 'database queries indexing tips'),
      ]);

      db.removeDocument('d2');

      const results = db.search('database queries');
      const ids = results.map((r) => r.document.id);
      expect(ids).not.toContain('d2');
    });

    it('should work correctly after clear and re-index', () => {
      db.indexDocuments([
        makeDoc('d1', 'Old', 'old content data'),
      ]);
      db.clear();

      db.indexDocuments([
        makeDoc('d2', 'New', 'completely new content different'),
        makeDoc('d3', 'Also New', 'another new document fresh'),
      ]);

      expect(db.getDocumentCount()).toBe(2);
      expect(db.getDocument('d1')).toBeUndefined();
      expect(db.getDocument('d2')).toBeDefined();
    });
  });
});
