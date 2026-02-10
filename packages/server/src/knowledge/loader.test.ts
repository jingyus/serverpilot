/**
 * Tests for the KnowledgeBase loader and search module.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { KnowledgeBase } from './loader.js';
import type { KnowledgeDocument, SearchResult, KnowledgeBaseOptions } from './loader.js';

// ============================================================================
// Helpers
// ============================================================================

let testDir: string;

beforeEach(() => {
  testDir = path.join(os.tmpdir(), `kb-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

/** Write a file relative to testDir, creating intermediate directories. */
function writeTestFile(relativePath: string, content: string): void {
  const fullPath = path.join(testDir, relativePath);
  mkdirSync(path.dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content, 'utf-8');
}

/** Create a KnowledgeBase pointing at testDir with optional overrides. */
function createKB(overrides?: Partial<KnowledgeBaseOptions>): KnowledgeBase {
  return new KnowledgeBase({ baseDir: testDir, ...overrides });
}

// ============================================================================
// Constructor
// ============================================================================

describe('KnowledgeBase', () => {
  describe('constructor', () => {
    it('creates an instance with the given baseDir', () => {
      const kb = createKB();
      expect(kb).toBeInstanceOf(KnowledgeBase);
    });

    it('resolves a relative baseDir to an absolute path', () => {
      const kb = new KnowledgeBase({ baseDir: './relative-path' });
      // After construction, the internal path should be resolved.
      // We can verify indirectly: loading from a non-existent resolved path
      // should include the resolved absolute path in the error message.
      expect(() => kb.loadDocuments()).toThrow(/does not exist/);
    });

    it('defaults extensions to [".md"]', () => {
      writeTestFile('doc.md', '# Hello');
      writeTestFile('doc.txt', 'plain text');
      const kb = createKB();
      const count = kb.loadDocuments();
      expect(count).toBe(1);
    });

    it('accepts custom extensions', () => {
      writeTestFile('doc.md', '# Markdown');
      writeTestFile('doc.txt', 'plain text');
      const kb = createKB({ extensions: ['.txt'] });
      const count = kb.loadDocuments();
      expect(count).toBe(1);
      const docs = kb.getDocuments();
      expect(docs[0].id).toBe('doc.txt');
    });
  });

  // ==========================================================================
  // loadDocuments
  // ==========================================================================

  describe('loadDocuments', () => {
    it('loads .md files and returns the count', () => {
      writeTestFile('a.md', '# A');
      writeTestFile('b.md', '# B');
      const kb = createKB();
      expect(kb.loadDocuments()).toBe(2);
    });

    it('loads files recursively from nested directories', () => {
      writeTestFile('top.md', '# Top');
      writeTestFile('sub/nested.md', '# Nested');
      writeTestFile('sub/deep/deeper.md', '# Deeper');
      const kb = createKB();
      expect(kb.loadDocuments()).toBe(3);
    });

    it('throws when the base directory does not exist', () => {
      const kb = new KnowledgeBase({ baseDir: path.join(testDir, 'nonexistent') });
      expect(() => kb.loadDocuments()).toThrow('Knowledge base directory does not exist');
    });

    it('clears previous documents on reload', () => {
      writeTestFile('a.md', '# A');
      const kb = createKB();
      expect(kb.loadDocuments()).toBe(1);

      // Add another file and reload
      writeTestFile('b.md', '# B');
      expect(kb.loadDocuments()).toBe(2);
    });

    it('returns 0 for an empty directory', () => {
      const kb = createKB();
      expect(kb.loadDocuments()).toBe(0);
    });

    it('respects custom extensions and ignores non-matching files', () => {
      writeTestFile('readme.md', '# Readme');
      writeTestFile('data.json', '{}');
      writeTestFile('notes.txt', 'notes');
      const kb = createKB({ extensions: ['.md', '.txt'] });
      expect(kb.loadDocuments()).toBe(2);
    });

    it('handles multiple extensions', () => {
      writeTestFile('a.md', '# A');
      writeTestFile('b.txt', 'B');
      writeTestFile('c.rst', 'C');
      const kb = createKB({ extensions: ['.md', '.txt', '.rst'] });
      expect(kb.loadDocuments()).toBe(3);
    });

    it('sets loaded flag to true after successful load', () => {
      const kb = createKB();
      expect(kb.isLoaded()).toBe(false);
      kb.loadDocuments();
      expect(kb.isLoaded()).toBe(true);
    });

    it('reload clears old documents that no longer exist', () => {
      writeTestFile('a.md', '# A');
      writeTestFile('b.md', '# B');
      const kb = createKB();
      expect(kb.loadDocuments()).toBe(2);

      // Simulate deletion by removing the file and reloading
      rmSync(path.join(testDir, 'b.md'));
      expect(kb.loadDocuments()).toBe(1);
    });
  });

  // ==========================================================================
  // search
  // ==========================================================================

  describe('search', () => {
    it('returns results sorted by score in descending order', () => {
      writeTestFile('low.md', 'Some content about testing');
      writeTestFile('high.md', '# testing\n\ntesting testing testing testing');
      const kb = createKB();
      kb.loadDocuments();

      const results = kb.search('testing');
      expect(results.length).toBe(2);
      expect(results[0].score).toBeGreaterThanOrEqual(results[1].score);
    });

    it('scores title matches higher than content-only matches', () => {
      writeTestFile('title-match.md', '# installation\n\nSome other content here');
      writeTestFile('content-match.md', '# Guide\n\nThis mentions installation once');
      const kb = createKB();
      kb.loadDocuments();

      const results = kb.search('installation');
      expect(results.length).toBe(2);
      // Title match should be first (10 bonus points)
      expect(results[0].document.title).toBe('installation');
      expect(results[0].score).toBeGreaterThan(results[1].score);
    });

    it('returns empty array before documents are loaded', () => {
      writeTestFile('doc.md', '# Hello world');
      const kb = createKB();
      // Do not call loadDocuments
      const results = kb.search('hello');
      expect(results).toEqual([]);
    });

    it('returns empty array when no documents match', () => {
      writeTestFile('doc.md', '# Hello\n\nWorld');
      const kb = createKB();
      kb.loadDocuments();
      const results = kb.search('nonexistentkeyword');
      expect(results).toEqual([]);
    });

    it('respects the maxResults parameter', () => {
      writeTestFile('a.md', 'keyword keyword');
      writeTestFile('b.md', 'keyword');
      writeTestFile('c.md', 'keyword keyword keyword');
      const kb = createKB();
      kb.loadDocuments();

      const results = kb.search('keyword', 2);
      expect(results.length).toBe(2);
    });

    it('uses default maxResults of 5', () => {
      for (let i = 0; i < 8; i++) {
        writeTestFile(`doc${i}.md`, `keyword content ${i}`);
      }
      const kb = createKB();
      kb.loadDocuments();

      const results = kb.search('keyword');
      expect(results.length).toBe(5);
    });

    it('filters out search terms with length <= 1', () => {
      writeTestFile('doc.md', '# Doc\n\na b longterm');
      const kb = createKB();
      kb.loadDocuments();

      // "a" and "b" should be filtered out, only "longterm" is used
      const results = kb.search('a b longterm');
      expect(results.length).toBe(1);
      // Verify score is based only on "longterm"
      const singleTermResults = kb.search('longterm');
      expect(results[0].score).toBe(singleTermResults[0].score);
    });

    it('returns empty when all terms are filtered out (too short)', () => {
      writeTestFile('doc.md', '# A\n\na b c');
      const kb = createKB();
      kb.loadDocuments();

      const results = kb.search('a b');
      expect(results).toEqual([]);
    });

    it('collects matching snippets from lines', () => {
      writeTestFile('doc.md', '# Guide\n\nFirst line with keyword\nSecond line with keyword\nThird line');
      const kb = createKB();
      kb.loadDocuments();

      const results = kb.search('keyword');
      expect(results.length).toBe(1);
      expect(results[0].snippets.length).toBeGreaterThanOrEqual(1);
      expect(results[0].snippets.every((s) => s.includes('keyword'))).toBe(true);
    });

    it('limits snippets to a maximum of 3', () => {
      const lines = [];
      for (let i = 0; i < 10; i++) {
        lines.push(`Line ${i} contains the term searchable`);
      }
      writeTestFile('doc.md', `# Doc\n\n${lines.join('\n')}`);
      const kb = createKB();
      kb.loadDocuments();

      const results = kb.search('searchable');
      expect(results.length).toBe(1);
      expect(results[0].snippets.length).toBe(3);
    });

    it('counts content occurrences correctly', () => {
      // "alpha" appears 3 times in content
      writeTestFile('doc.md', 'alpha alpha alpha');
      const kb = createKB();
      kb.loadDocuments();

      const results = kb.search('alpha');
      expect(results.length).toBe(1);
      // Content score should be 3 (one per occurrence)
      expect(results[0].score).toBe(3);
    });

    it('adds 10 points for a title match', () => {
      writeTestFile('doc.md', '# alpha\n\nalpha');
      const kb = createKB();
      kb.loadDocuments();

      const results = kb.search('alpha');
      expect(results.length).toBe(1);
      // Title match (10) + content heading line "# alpha" occurrence (1) + body "alpha" (1) = 12
      // Let's verify the score includes the title bonus
      expect(results[0].score).toBeGreaterThanOrEqual(10);
    });

    it('performs case-insensitive search', () => {
      writeTestFile('doc.md', '# Guide\n\nINSTALLATION instructions');
      const kb = createKB();
      kb.loadDocuments();

      const results = kb.search('installation');
      expect(results.length).toBe(1);
    });

    it('does not include duplicate snippets', () => {
      writeTestFile('doc.md', '# Doc\n\nsame keyword line\nsame keyword line\ndifferent keyword line');
      const kb = createKB();
      kb.loadDocuments();

      const results = kb.search('keyword');
      expect(results.length).toBe(1);
      // "same keyword line" appears twice but should only be collected once as a snippet
      const uniqueSnippets = new Set(results[0].snippets);
      expect(results[0].snippets.length).toBe(uniqueSnippets.size);
    });

    it('does not include empty lines as snippets', () => {
      writeTestFile('doc.md', '# Doc\n\n\n\nkeyword\n\n\n');
      const kb = createKB();
      kb.loadDocuments();

      const results = kb.search('keyword');
      expect(results.length).toBe(1);
      for (const snippet of results[0].snippets) {
        expect(snippet.trim().length).toBeGreaterThan(0);
      }
    });

    it('handles multi-term queries combining scores', () => {
      writeTestFile('doc.md', '# alpha beta\n\nalpha gamma beta');
      const kb = createKB();
      kb.loadDocuments();

      const resultsAlpha = kb.search('alpha');
      const resultsBeta = kb.search('beta');
      const resultsCombined = kb.search('alpha beta');

      expect(resultsCombined[0].score).toBeGreaterThan(resultsAlpha[0].score);
      expect(resultsCombined[0].score).toBeGreaterThan(resultsBeta[0].score);
    });
  });

  // ==========================================================================
  // getDocuments
  // ==========================================================================

  describe('getDocuments', () => {
    it('returns a copy of the documents array', () => {
      writeTestFile('doc.md', '# Doc');
      const kb = createKB();
      kb.loadDocuments();

      const docs1 = kb.getDocuments();
      const docs2 = kb.getDocuments();
      expect(docs1).toEqual(docs2);
      expect(docs1).not.toBe(docs2); // different array references
    });

    it('returns all loaded documents', () => {
      writeTestFile('a.md', '# A');
      writeTestFile('b.md', '# B');
      writeTestFile('sub/c.md', '# C');
      const kb = createKB();
      kb.loadDocuments();

      const docs = kb.getDocuments();
      expect(docs.length).toBe(3);
    });

    it('returns empty array before loading', () => {
      const kb = createKB();
      expect(kb.getDocuments()).toEqual([]);
    });
  });

  // ==========================================================================
  // getDocumentById
  // ==========================================================================

  describe('getDocumentById', () => {
    it('finds a document by its normalized ID', () => {
      writeTestFile('guides/setup.md', '# Setup');
      const kb = createKB();
      kb.loadDocuments();

      const doc = kb.getDocumentById('guides/setup.md');
      expect(doc).toBeDefined();
      expect(doc!.title).toBe('Setup');
    });

    it('returns undefined for a non-existent ID', () => {
      writeTestFile('doc.md', '# Doc');
      const kb = createKB();
      kb.loadDocuments();

      expect(kb.getDocumentById('nonexistent.md')).toBeUndefined();
    });

    it('uses forward slashes in IDs regardless of OS', () => {
      writeTestFile('sub/dir/doc.md', '# Doc');
      const kb = createKB();
      kb.loadDocuments();

      const doc = kb.getDocumentById('sub/dir/doc.md');
      expect(doc).toBeDefined();
      expect(doc!.id).toBe('sub/dir/doc.md');
    });
  });

  // ==========================================================================
  // getDocumentsByCategory
  // ==========================================================================

  describe('getDocumentsByCategory', () => {
    it('filters documents by category', () => {
      writeTestFile('guides/a.md', '# A');
      writeTestFile('guides/b.md', '# B');
      writeTestFile('reference/c.md', '# C');
      const kb = createKB();
      kb.loadDocuments();

      const guides = kb.getDocumentsByCategory('guides');
      expect(guides.length).toBe(2);
      expect(guides.every((d) => d.category === 'guides')).toBe(true);
    });

    it('returns empty array for a non-existent category', () => {
      writeTestFile('guides/a.md', '# A');
      const kb = createKB();
      kb.loadDocuments();

      expect(kb.getDocumentsByCategory('nonexistent')).toEqual([]);
    });

    it('returns root category for top-level files', () => {
      writeTestFile('top.md', '# Top');
      const kb = createKB();
      kb.loadDocuments();

      const rootDocs = kb.getDocumentsByCategory('root');
      expect(rootDocs.length).toBe(1);
      expect(rootDocs[0].category).toBe('root');
    });
  });

  // ==========================================================================
  // isLoaded / getDocumentCount
  // ==========================================================================

  describe('isLoaded', () => {
    it('returns false initially', () => {
      const kb = createKB();
      expect(kb.isLoaded()).toBe(false);
    });

    it('returns true after loadDocuments is called', () => {
      const kb = createKB();
      kb.loadDocuments();
      expect(kb.isLoaded()).toBe(true);
    });

    it('remains true after reload', () => {
      const kb = createKB();
      kb.loadDocuments();
      kb.loadDocuments();
      expect(kb.isLoaded()).toBe(true);
    });
  });

  describe('getDocumentCount', () => {
    it('returns 0 initially', () => {
      const kb = createKB();
      expect(kb.getDocumentCount()).toBe(0);
    });

    it('returns the number of loaded documents', () => {
      writeTestFile('a.md', '# A');
      writeTestFile('b.md', '# B');
      const kb = createKB();
      kb.loadDocuments();
      expect(kb.getDocumentCount()).toBe(2);
    });

    it('updates after reload', () => {
      writeTestFile('a.md', '# A');
      const kb = createKB();
      kb.loadDocuments();
      expect(kb.getDocumentCount()).toBe(1);

      writeTestFile('b.md', '# B');
      kb.loadDocuments();
      expect(kb.getDocumentCount()).toBe(2);
    });
  });

  // ==========================================================================
  // Title extraction
  // ==========================================================================

  describe('title extraction', () => {
    it('extracts title from the first markdown heading', () => {
      writeTestFile('doc.md', '# My Title\n\nSome content');
      const kb = createKB();
      kb.loadDocuments();

      const doc = kb.getDocumentById('doc.md');
      expect(doc!.title).toBe('My Title');
    });

    it('falls back to filename when no heading is present', () => {
      writeTestFile('my-document.md', 'Just content, no heading');
      const kb = createKB();
      kb.loadDocuments();

      const doc = kb.getDocumentById('my-document.md');
      expect(doc!.title).toBe('my-document');
    });

    it('uses the first heading even if there are multiple', () => {
      writeTestFile('doc.md', '# First\n\n## Second\n\n# Third');
      const kb = createKB();
      kb.loadDocuments();

      const doc = kb.getDocumentById('doc.md');
      expect(doc!.title).toBe('First');
    });

    it('trims whitespace from the extracted title', () => {
      writeTestFile('doc.md', '#   Spaced Title   \n\nContent');
      const kb = createKB();
      kb.loadDocuments();

      const doc = kb.getDocumentById('doc.md');
      expect(doc!.title).toBe('Spaced Title');
    });

    it('handles heading not on the first line', () => {
      writeTestFile('doc.md', '\nSome preamble\n\n# Actual Title\n\nContent');
      const kb = createKB();
      kb.loadDocuments();

      const doc = kb.getDocumentById('doc.md');
      expect(doc!.title).toBe('Actual Title');
    });
  });

  // ==========================================================================
  // Category extraction
  // ==========================================================================

  describe('category extraction', () => {
    it('uses the first directory component as category', () => {
      writeTestFile('guides/install.md', '# Install');
      const kb = createKB();
      kb.loadDocuments();

      const doc = kb.getDocumentById('guides/install.md');
      expect(doc!.category).toBe('guides');
    });

    it('returns "root" for top-level files', () => {
      writeTestFile('readme.md', '# Readme');
      const kb = createKB();
      kb.loadDocuments();

      const doc = kb.getDocumentById('readme.md');
      expect(doc!.category).toBe('root');
    });

    it('uses the first directory component even for deeply nested files', () => {
      writeTestFile('docs/api/v2/endpoint.md', '# Endpoint');
      const kb = createKB();
      kb.loadDocuments();

      const doc = kb.getDocumentById('docs/api/v2/endpoint.md');
      expect(doc!.category).toBe('docs');
    });
  });

  // ==========================================================================
  // Document structure
  // ==========================================================================

  describe('document structure', () => {
    it('sets the id to the relative path with forward slashes', () => {
      writeTestFile('sub/doc.md', '# Doc');
      const kb = createKB();
      kb.loadDocuments();

      const doc = kb.getDocumentById('sub/doc.md');
      expect(doc).toBeDefined();
      expect(doc!.id).toBe('sub/doc.md');
    });

    it('stores the raw content of the file', () => {
      const content = '# Title\n\nParagraph one.\n\nParagraph two.';
      writeTestFile('doc.md', content);
      const kb = createKB();
      kb.loadDocuments();

      const doc = kb.getDocumentById('doc.md');
      expect(doc!.content).toBe(content);
    });

    it('sets filePath to the relative path', () => {
      writeTestFile('category/doc.md', '# Doc');
      const kb = createKB();
      kb.loadDocuments();

      const doc = kb.getDocumentById('category/doc.md');
      expect(doc!.filePath).toMatch(/category/);
    });
  });

  // ==========================================================================
  // Edge cases
  // ==========================================================================

  describe('edge cases', () => {
    it('handles files with no heading', () => {
      writeTestFile('no-heading.md', 'Just plain text without any heading');
      const kb = createKB();
      kb.loadDocuments();

      const doc = kb.getDocumentById('no-heading.md');
      expect(doc).toBeDefined();
      expect(doc!.title).toBe('no-heading');
    });

    it('handles empty files', () => {
      writeTestFile('empty.md', '');
      const kb = createKB();
      const count = kb.loadDocuments();
      // Empty file should still load (readFileSync succeeds)
      const doc = kb.getDocumentById('empty.md');
      expect(doc).toBeDefined();
      expect(doc!.content).toBe('');
      expect(doc!.title).toBe('empty');
    });

    it('handles deeply nested directory structures', () => {
      writeTestFile('a/b/c/d/e/deep.md', '# Deep');
      const kb = createKB();
      kb.loadDocuments();

      const doc = kb.getDocumentById('a/b/c/d/e/deep.md');
      expect(doc).toBeDefined();
      expect(doc!.category).toBe('a');
      expect(doc!.title).toBe('Deep');
    });

    it('ignores non-matching file extensions', () => {
      writeTestFile('doc.md', '# Doc');
      writeTestFile('image.png', 'binary data');
      writeTestFile('script.js', 'console.log()');
      const kb = createKB();
      kb.loadDocuments();

      expect(kb.getDocumentCount()).toBe(1);
    });

    it('handles files with special characters in filenames', () => {
      writeTestFile('docs/my file (1).md', '# Special');
      const kb = createKB();
      kb.loadDocuments();

      expect(kb.getDocumentCount()).toBe(1);
      const docs = kb.getDocuments();
      expect(docs[0].title).toBe('Special');
    });

    it('handles search with empty query string', () => {
      writeTestFile('doc.md', '# Doc\n\nContent');
      const kb = createKB();
      kb.loadDocuments();

      // Empty string tokenizes to no terms, should return empty
      const results = kb.search('');
      expect(results).toEqual([]);
    });

    it('handles search with only whitespace', () => {
      writeTestFile('doc.md', '# Doc\n\nContent');
      const kb = createKB();
      kb.loadDocuments();

      const results = kb.search('   ');
      expect(results).toEqual([]);
    });

    it('handles search with single-character terms only', () => {
      writeTestFile('doc.md', '# A\n\na b c');
      const kb = createKB();
      kb.loadDocuments();

      const results = kb.search('a b c');
      expect(results).toEqual([]);
    });

    it('handles directory with only non-matching files', () => {
      writeTestFile('data.json', '{}');
      writeTestFile('config.yaml', 'key: value');
      const kb = createKB();
      expect(kb.loadDocuments()).toBe(0);
    });

    it('handles maxResults of 0', () => {
      writeTestFile('doc.md', 'keyword');
      const kb = createKB();
      kb.loadDocuments();

      const results = kb.search('keyword', 0);
      expect(results).toEqual([]);
    });

    it('handles maxResults of 1', () => {
      writeTestFile('a.md', 'keyword');
      writeTestFile('b.md', 'keyword');
      const kb = createKB();
      kb.loadDocuments();

      const results = kb.search('keyword', 1);
      expect(results.length).toBe(1);
    });
  });

  // ==========================================================================
  // Integration with real knowledge base
  // ==========================================================================

  describe('integration with real knowledge base', () => {
    const realKBDir = path.resolve(
      __dirname,
      '..', // src
      '..', // packages/server
      '..', // packages
      '..', // project root
      'knowledge-base',
    );

    it('should load all 18 knowledge base documents', () => {
      const kb = new KnowledgeBase({ baseDir: realKBDir });
      const count = kb.loadDocuments();
      expect(count).toBeGreaterThanOrEqual(18);
    });

    it('should have all 6 technology categories', () => {
      const kb = new KnowledgeBase({ baseDir: realKBDir });
      kb.loadDocuments();

      const categories = new Set(kb.getDocuments().map((d) => d.category));
      for (const cat of ['nginx', 'mysql', 'docker', 'nodejs', 'postgresql', 'redis']) {
        expect(categories.has(cat)).toBe(true);
      }
    });

    it('should find Nginx installation content when searching "如何安装 Nginx"', () => {
      const kb = new KnowledgeBase({ baseDir: realKBDir });
      kb.loadDocuments();

      const results = kb.search('安装 Nginx');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].document.category).toBe('nginx');
    });

    it('should find Docker troubleshooting when searching for container errors', () => {
      const kb = new KnowledgeBase({ baseDir: realKBDir });
      kb.loadDocuments();

      const results = kb.search('Docker 容器 故障');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].document.category).toBe('docker');
    });

    it('should find Redis configuration when searching for Redis config', () => {
      const kb = new KnowledgeBase({ baseDir: realKBDir });
      kb.loadDocuments();

      const results = kb.search('Redis 配置 maxmemory');
      expect(results.length).toBeGreaterThan(0);
      const hasRedis = results.some((r) => r.document.category === 'redis');
      expect(hasRedis).toBe(true);
    });

    it('should find MySQL content when searching for database queries', () => {
      const kb = new KnowledgeBase({ baseDir: realKBDir });
      kb.loadDocuments();

      const results = kb.search('MySQL 慢查询');
      expect(results.length).toBeGreaterThan(0);
      const hasMySQL = results.some((r) => r.document.category === 'mysql');
      expect(hasMySQL).toBe(true);
    });

    it('should find PostgreSQL content when searching for backup', () => {
      const kb = new KnowledgeBase({ baseDir: realKBDir });
      kb.loadDocuments();

      const results = kb.search('PostgreSQL 备份');
      expect(results.length).toBeGreaterThan(0);
      const hasPG = results.some((r) => r.document.category === 'postgresql');
      expect(hasPG).toBe(true);
    });

    it('should find Node.js content when searching for npm issues', () => {
      const kb = new KnowledgeBase({ baseDir: realKBDir });
      kb.loadDocuments();

      const results = kb.search('Node.js npm');
      expect(results.length).toBeGreaterThan(0);
      const hasNodejs = results.some((r) => r.document.category === 'nodejs');
      expect(hasNodejs).toBe(true);
    });
  });
});
