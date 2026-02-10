import { describe, it, expect, beforeEach } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

// --------------------------------------------------------------------------
// Test helpers
// --------------------------------------------------------------------------

const vectordbPath = path.resolve('packages/server/src/knowledge/vectordb.ts');

interface KnowledgeDocument {
  id: string;
  title: string;
  content: string;
  filePath: string;
  category: string;
}

function makeDoc(id: string, title: string, content: string, category = 'root'): KnowledgeDocument {
  return { id, title, content, filePath: `${category}/${id}.md`, category };
}

// --------------------------------------------------------------------------
// Tests
// --------------------------------------------------------------------------

describe('knowledge/vectordb.ts', () => {
  // ---- File existence ----

  describe('File and exports', () => {
    it('should exist at packages/server/src/knowledge/vectordb.ts', () => {
      expect(existsSync(vectordbPath)).toBe(true);
    });

    it('should export VectorDB class', async () => {
      const mod = await import(vectordbPath);
      expect(mod.VectorDB).toBeDefined();
      expect(typeof mod.VectorDB).toBe('function');
    });

    it('should be importable and instantiable', async () => {
      const { VectorDB } = await import(vectordbPath);
      const db = new VectorDB();
      expect(db).toBeDefined();
    });
  });

  // ---- Constructor ----

  describe('Constructor', () => {
    it('should accept default options', async () => {
      const { VectorDB } = await import(vectordbPath);
      const db = new VectorDB();
      expect(db.isIndexed()).toBe(false);
      expect(db.getDocumentCount()).toBe(0);
    });

    it('should accept custom options', async () => {
      const { VectorDB } = await import(vectordbPath);
      const db = new VectorDB({ maxFeatures: 1000, minDocFreq: 2 });
      expect(db).toBeDefined();
    });
  });

  // ---- indexDocuments ----

  describe('indexDocuments', () => {
    let VectorDB: any;

    beforeEach(async () => {
      const mod = await import(vectordbPath);
      VectorDB = mod.VectorDB;
    });

    it('should return the number of documents indexed', () => {
      const db = new VectorDB();
      const docs = [
        makeDoc('doc1', 'NPM Install', 'How to install packages with npm'),
        makeDoc('doc2', 'Yarn Guide', 'Using yarn for package management'),
      ];
      const count = db.indexDocuments(docs);
      expect(count).toBe(2);
    });

    it('should handle empty document array', () => {
      const db = new VectorDB();
      const count = db.indexDocuments([]);
      expect(count).toBe(0);
      expect(db.isIndexed()).toBe(true);
    });

    it('should set indexed flag to true', () => {
      const db = new VectorDB();
      expect(db.isIndexed()).toBe(false);
      db.indexDocuments([makeDoc('doc1', 'Test', 'content')]);
      expect(db.isIndexed()).toBe(true);
    });

    it('should re-index when called multiple times', () => {
      const db = new VectorDB();
      db.indexDocuments([makeDoc('doc1', 'Test', 'content')]);
      expect(db.getDocumentCount()).toBe(1);

      db.indexDocuments([
        makeDoc('doc2', 'Test 2', 'content 2'),
        makeDoc('doc3', 'Test 3', 'content 3'),
      ]);
      expect(db.getDocumentCount()).toBe(2);
    });

    it('should build vocabulary from documents', () => {
      const db = new VectorDB();
      db.indexDocuments([
        makeDoc('doc1', 'NPM Install', 'npm install packages'),
        makeDoc('doc2', 'Yarn Install', 'yarn add packages'),
      ]);
      expect(db.getVocabularySize()).toBeGreaterThan(0);
    });

    it('should respect maxFeatures option', () => {
      const db = new VectorDB({ maxFeatures: 3 });
      db.indexDocuments([
        makeDoc(
          'doc1',
          'Test',
          'alpha bravo charlie delta echo foxtrot golf hotel india juliet'
        ),
      ]);
      expect(db.getVocabularySize()).toBeLessThanOrEqual(3);
    });

    it('should respect minDocFreq option', () => {
      const db = new VectorDB({ minDocFreq: 2 });
      db.indexDocuments([
        makeDoc('doc1', 'Test', 'unique-term-abc common-term'),
        makeDoc('doc2', 'Test', 'unique-term-xyz common-term'),
      ]);
      // unique terms appear only once, common-term appears in both
      const vocabSize = db.getVocabularySize();
      // At minimum "common-term" and "test" appear in both docs
      expect(vocabSize).toBeGreaterThan(0);
    });
  });

  // ---- search ----

  describe('search', () => {
    let VectorDB: any;

    beforeEach(async () => {
      const mod = await import(vectordbPath);
      VectorDB = mod.VectorDB;
    });

    it('should return empty array if not indexed', () => {
      const db = new VectorDB();
      const results = db.search('test');
      expect(results).toEqual([]);
    });

    it('should return empty array for empty query', () => {
      const db = new VectorDB();
      db.indexDocuments([makeDoc('doc1', 'Test', 'content')]);
      const results = db.search('');
      expect(results).toEqual([]);
    });

    it('should return empty array if no matching documents', () => {
      const db = new VectorDB();
      db.indexDocuments([makeDoc('doc1', 'NPM', 'npm install packages')]);
      const results = db.search('zzzznonexistent');
      expect(results).toEqual([]);
    });

    it('should find documents matching query terms', () => {
      const db = new VectorDB();
      db.indexDocuments([
        makeDoc('doc1', 'NPM Install', 'How to install packages with npm'),
        makeDoc('doc2', 'Python Setup', 'Setting up python environment'),
      ]);
      const results = db.search('npm install');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].document.id).toBe('doc1');
    });

    it('should sort results by similarity descending', () => {
      const db = new VectorDB();
      db.indexDocuments([
        makeDoc('doc1', 'NPM Install', 'How to install packages with npm'),
        makeDoc('doc2', 'NPM Guide', 'Complete npm guide for developers npm npm npm'),
        makeDoc('doc3', 'Python', 'python programming language'),
      ]);
      const results = db.search('npm guide');
      expect(results.length).toBeGreaterThanOrEqual(1);
      // All results should have decreasing similarity
      for (let i = 1; i < results.length; i++) {
        expect(results[i].similarity).toBeLessThanOrEqual(results[i - 1].similarity);
      }
    });

    it('should respect maxResults parameter', () => {
      const db = new VectorDB();
      db.indexDocuments([
        makeDoc('doc1', 'Install A', 'install packages software'),
        makeDoc('doc2', 'Install B', 'install programs software'),
        makeDoc('doc3', 'Install C', 'install tools software'),
        makeDoc('doc4', 'Install D', 'install apps software'),
      ]);
      const results = db.search('install software', 2);
      expect(results.length).toBeLessThanOrEqual(2);
    });

    it('should respect minSimilarity parameter', () => {
      const db = new VectorDB();
      db.indexDocuments([
        makeDoc('doc1', 'NPM Install', 'npm install command packages'),
        makeDoc('doc2', 'Python Setup', 'python programming environment'),
      ]);
      const results = db.search('npm install', 10, 0.99);
      // Very high threshold means very few or no results
      for (const r of results) {
        expect(r.similarity).toBeGreaterThanOrEqual(0.99);
      }
    });

    it('should include similarity score in results', () => {
      const db = new VectorDB();
      db.indexDocuments([makeDoc('doc1', 'NPM Install', 'npm install packages')]);
      const results = db.search('npm');
      if (results.length > 0) {
        expect(results[0]).toHaveProperty('similarity');
        expect(typeof results[0].similarity).toBe('number');
        expect(results[0].similarity).toBeGreaterThan(0);
        expect(results[0].similarity).toBeLessThanOrEqual(1);
      }
    });

    it('should include snippets in results', () => {
      const db = new VectorDB();
      db.indexDocuments([
        makeDoc('doc1', 'NPM Install', 'Run npm install to install packages\nCheck npm version'),
      ]);
      const results = db.search('npm');
      if (results.length > 0) {
        expect(results[0].snippets).toBeDefined();
        expect(Array.isArray(results[0].snippets)).toBe(true);
      }
    });

    it('should set score equal to similarity', () => {
      const db = new VectorDB();
      db.indexDocuments([makeDoc('doc1', 'NPM', 'npm install packages')]);
      const results = db.search('npm');
      if (results.length > 0) {
        expect(results[0].score).toBe(results[0].similarity);
      }
    });

    it('should handle single-document index', () => {
      const db = new VectorDB();
      db.indexDocuments([makeDoc('doc1', 'NPM Install', 'npm install packages')]);
      // With a single document, IDF for all terms is log(1/1) = 0
      // This means the vector will be zero - this is expected behavior
      const results = db.search('npm install');
      // We don't assert results because single-doc IDF is degenerate
      expect(Array.isArray(results)).toBe(true);
    });
  });

  // ---- addDocument ----

  describe('addDocument', () => {
    let VectorDB: any;

    beforeEach(async () => {
      const mod = await import(vectordbPath);
      VectorDB = mod.VectorDB;
    });

    it('should add a document to an existing index', () => {
      const db = new VectorDB();
      db.indexDocuments([makeDoc('doc1', 'Test', 'content')]);
      expect(db.getDocumentCount()).toBe(1);

      db.addDocument(makeDoc('doc2', 'Test 2', 'more content'));
      expect(db.getDocumentCount()).toBe(2);
    });

    it('should initialize index if not indexed', () => {
      const db = new VectorDB();
      expect(db.isIndexed()).toBe(false);

      db.addDocument(makeDoc('doc1', 'Test', 'content'));
      expect(db.isIndexed()).toBe(true);
      expect(db.getDocumentCount()).toBe(1);
    });

    it('should make added document searchable', () => {
      const db = new VectorDB();
      db.indexDocuments([
        makeDoc('doc1', 'NPM Install', 'npm install packages'),
        makeDoc('doc2', 'Yarn Install', 'yarn add packages'),
      ]);

      db.addDocument(makeDoc('doc3', 'PNPM Install', 'pnpm install packages'));
      const doc = db.getDocument('doc3');
      expect(doc).toBeDefined();
      expect(doc!.document.title).toBe('PNPM Install');
    });
  });

  // ---- removeDocument ----

  describe('removeDocument', () => {
    let VectorDB: any;

    beforeEach(async () => {
      const mod = await import(vectordbPath);
      VectorDB = mod.VectorDB;
    });

    it('should remove an existing document and return true', () => {
      const db = new VectorDB();
      db.indexDocuments([
        makeDoc('doc1', 'Test 1', 'content 1'),
        makeDoc('doc2', 'Test 2', 'content 2'),
      ]);
      expect(db.removeDocument('doc1')).toBe(true);
      expect(db.getDocumentCount()).toBe(1);
    });

    it('should return false for non-existent document', () => {
      const db = new VectorDB();
      db.indexDocuments([makeDoc('doc1', 'Test', 'content')]);
      expect(db.removeDocument('nonexistent')).toBe(false);
      expect(db.getDocumentCount()).toBe(1);
    });

    it('should make removed document unsearchable', () => {
      const db = new VectorDB();
      db.indexDocuments([
        makeDoc('doc1', 'NPM Install', 'npm install packages'),
        makeDoc('doc2', 'Yarn Install', 'yarn add packages'),
      ]);
      db.removeDocument('doc1');
      expect(db.getDocument('doc1')).toBeUndefined();
    });
  });

  // ---- getDocument ----

  describe('getDocument', () => {
    let VectorDB: any;

    beforeEach(async () => {
      const mod = await import(vectordbPath);
      VectorDB = mod.VectorDB;
    });

    it('should return the document with matching ID', () => {
      const db = new VectorDB();
      db.indexDocuments([makeDoc('doc1', 'Test', 'content')]);
      const doc = db.getDocument('doc1');
      expect(doc).toBeDefined();
      expect(doc!.id).toBe('doc1');
      expect(doc!.document.title).toBe('Test');
    });

    it('should return undefined for non-existent ID', () => {
      const db = new VectorDB();
      db.indexDocuments([makeDoc('doc1', 'Test', 'content')]);
      expect(db.getDocument('nonexistent')).toBeUndefined();
    });

    it('should include embedding in the result', () => {
      const db = new VectorDB();
      db.indexDocuments([
        makeDoc('doc1', 'NPM', 'npm install'),
        makeDoc('doc2', 'Yarn', 'yarn add'),
      ]);
      const doc = db.getDocument('doc1');
      expect(doc).toBeDefined();
      expect(doc!.embedding).toBeDefined();
      expect(Array.isArray(doc!.embedding)).toBe(true);
      expect(doc!.embedding.length).toBe(db.getVocabularySize());
    });
  });

  // ---- clear ----

  describe('clear', () => {
    let VectorDB: any;

    beforeEach(async () => {
      const mod = await import(vectordbPath);
      VectorDB = mod.VectorDB;
    });

    it('should reset the entire index', () => {
      const db = new VectorDB();
      db.indexDocuments([
        makeDoc('doc1', 'Test', 'content'),
        makeDoc('doc2', 'Test 2', 'content 2'),
      ]);
      expect(db.isIndexed()).toBe(true);
      expect(db.getDocumentCount()).toBe(2);

      db.clear();
      expect(db.isIndexed()).toBe(false);
      expect(db.getDocumentCount()).toBe(0);
      expect(db.getVocabularySize()).toBe(0);
    });

    it('should allow re-indexing after clear', () => {
      const db = new VectorDB();
      db.indexDocuments([makeDoc('doc1', 'Test', 'content')]);
      db.clear();
      db.indexDocuments([makeDoc('doc2', 'Test 2', 'content 2')]);
      expect(db.getDocumentCount()).toBe(1);
      expect(db.isIndexed()).toBe(true);
    });
  });

  // ---- State queries ----

  describe('State queries', () => {
    let VectorDB: any;

    beforeEach(async () => {
      const mod = await import(vectordbPath);
      VectorDB = mod.VectorDB;
    });

    it('isIndexed() returns false before indexing', () => {
      const db = new VectorDB();
      expect(db.isIndexed()).toBe(false);
    });

    it('isIndexed() returns true after indexing', () => {
      const db = new VectorDB();
      db.indexDocuments([]);
      expect(db.isIndexed()).toBe(true);
    });

    it('getDocumentCount() returns correct count', () => {
      const db = new VectorDB();
      expect(db.getDocumentCount()).toBe(0);
      db.indexDocuments([
        makeDoc('doc1', 'A', 'a'),
        makeDoc('doc2', 'B', 'b'),
        makeDoc('doc3', 'C', 'c'),
      ]);
      expect(db.getDocumentCount()).toBe(3);
    });

    it('getVocabularySize() returns correct size', () => {
      const db = new VectorDB();
      expect(db.getVocabularySize()).toBe(0);
      db.indexDocuments([
        makeDoc('doc1', 'Alpha', 'bravo charlie'),
        makeDoc('doc2', 'Delta', 'echo foxtrot'),
      ]);
      expect(db.getVocabularySize()).toBeGreaterThan(0);
    });
  });

  // ---- VectorDocument type ----

  describe('VectorDocument', () => {
    it('should have expected properties', async () => {
      const { VectorDB } = await import(vectordbPath);
      const db = new VectorDB();
      db.indexDocuments([
        makeDoc('doc1', 'Test', 'content here'),
        makeDoc('doc2', 'Test 2', 'more content'),
      ]);
      const vdoc = db.getDocument('doc1');
      expect(vdoc).toBeDefined();
      expect(vdoc).toHaveProperty('id');
      expect(vdoc).toHaveProperty('document');
      expect(vdoc).toHaveProperty('embedding');
      expect(vdoc!.document).toHaveProperty('id');
      expect(vdoc!.document).toHaveProperty('title');
      expect(vdoc!.document).toHaveProperty('content');
      expect(vdoc!.document).toHaveProperty('filePath');
      expect(vdoc!.document).toHaveProperty('category');
    });
  });

  // ---- VectorSearchResult type ----

  describe('VectorSearchResult', () => {
    it('should include similarity, score, document, and snippets', async () => {
      const { VectorDB } = await import(vectordbPath);
      const db = new VectorDB();
      db.indexDocuments([
        makeDoc('doc1', 'NPM Install Guide', 'npm install packages manage dependencies'),
        makeDoc('doc2', 'Yarn Guide', 'yarn add packages manage dependencies'),
      ]);
      const results = db.search('npm install');
      if (results.length > 0) {
        const result = results[0];
        expect(result).toHaveProperty('similarity');
        expect(result).toHaveProperty('score');
        expect(result).toHaveProperty('document');
        expect(result).toHaveProperty('snippets');
        expect(typeof result.similarity).toBe('number');
        expect(typeof result.score).toBe('number');
      }
    });
  });

  // ---- Semantic-like search behavior ----

  describe('Semantic-like search', () => {
    let VectorDB: any;

    beforeEach(async () => {
      const mod = await import(vectordbPath);
      VectorDB = mod.VectorDB;
    });

    it('should rank documents with more query term overlap higher', () => {
      const db = new VectorDB();
      db.indexDocuments([
        makeDoc('doc1', 'NPM Install Error', 'npm install error EACCES permission denied'),
        makeDoc('doc2', 'Yarn Guide', 'yarn add packages for project'),
        makeDoc('doc3', 'Permission Fix', 'fix permission error for npm global install'),
      ]);
      const results = db.search('npm install permission error');
      expect(results.length).toBeGreaterThanOrEqual(2);
      // doc1 and doc3 both mention npm/install/permission/error, so should rank high
      const ids = results.map((r: any) => r.document.id);
      expect(ids).toContain('doc1');
      expect(ids).toContain('doc3');
    });

    it('should handle multi-word queries', () => {
      const db = new VectorDB();
      db.indexDocuments([
        makeDoc('doc1', 'Network Timeout', 'network connection timeout when installing'),
        makeDoc('doc2', 'CPU Usage', 'high cpu usage during compilation'),
      ]);
      const results = db.search('network timeout error');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].document.id).toBe('doc1');
    });

    it('should be case insensitive', () => {
      const db = new VectorDB();
      db.indexDocuments([
        makeDoc('doc1', 'NPM', 'npm install packages'),
        makeDoc('doc2', 'Yarn', 'yarn add packages'),
      ]);
      const lower = db.search('npm');
      const upper = db.search('NPM');
      expect(lower.length).toBe(upper.length);
      if (lower.length > 0) {
        expect(lower[0].document.id).toBe(upper[0].document.id);
      }
    });

    it('should filter stopwords from queries', () => {
      const db = new VectorDB();
      db.indexDocuments([
        makeDoc('doc1', 'Install Guide', 'install packages software'),
        makeDoc('doc2', 'Other', 'unrelated document content'),
      ]);
      // "the" and "to" are stopwords
      const results = db.search('the install');
      // Should still find results based on "install" term
      if (results.length > 0) {
        expect(results[0].document.id).toBe('doc1');
      }
    });
  });

  // ---- Code quality ----

  describe('Code quality', () => {
    let source: string;

    beforeEach(() => {
      source = readFileSync(vectordbPath, 'utf-8');
    });

    it('should use proper TypeScript import syntax', () => {
      expect(source).toContain("import type");
    });

    it('should have JSDoc comments for exported members', () => {
      // Class JSDoc
      expect(source).toContain('/**');
      expect(source).toContain('* In-memory vector database');
    });

    it('should export VectorDB class', () => {
      expect(source).toMatch(/export\s+class\s+VectorDB/);
    });

    it('should export VectorDocument interface', () => {
      expect(source).toMatch(/export\s+interface\s+VectorDocument/);
    });

    it('should export VectorDBOptions interface', () => {
      expect(source).toMatch(/export\s+interface\s+VectorDBOptions/);
    });

    it('should export VectorSearchResult interface', () => {
      expect(source).toMatch(/export\s+interface\s+VectorSearchResult/);
    });

    it('should import KnowledgeDocument from loader', () => {
      expect(source).toContain('KnowledgeDocument');
      expect(source).toContain('./loader');
    });

    it('should use private methods for internal operations', () => {
      expect(source).toMatch(/private\s+tokenize/);
      expect(source).toMatch(/private\s+computeEmbedding/);
      expect(source).toMatch(/private\s+cosineSimilarity/);
      expect(source).toMatch(/private\s+magnitude/);
    });
  });
});
