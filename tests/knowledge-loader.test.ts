/**
 * Tests for packages/server/src/knowledge/loader.ts
 *
 * Tests the KnowledgeBase class including:
 * - File existence and exports
 * - Constructor and configuration
 * - loadDocuments() - document loading from filesystem
 * - search() - keyword-based search
 * - getDocuments() / getDocumentById() / getDocumentsByCategory()
 * - Title extraction from markdown headings
 * - Category extraction from directory structure
 * - Edge cases (empty directory, non-existent directory, no matches)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { KnowledgeBase } from '../packages/server/src/knowledge/loader.js';
import type {
  KnowledgeDocument,
  SearchResult,
  KnowledgeBaseOptions,
} from '../packages/server/src/knowledge/loader.js';

const LOADER_FILE = path.resolve('packages/server/src/knowledge/loader.ts');

// ============================================================================
// Test Fixtures
// ============================================================================

const TEST_DIR = path.resolve('test-knowledge-base-tmp');

function setupTestKnowledgeBase(): void {
  mkdirSync(TEST_DIR, { recursive: true });

  // Root level document
  writeFileSync(
    path.join(TEST_DIR, 'overview.md'),
    '# Project Overview\n\nThis is the main project overview document.\nIt contains important information about the project.\n',
  );

  // docs/ category
  mkdirSync(path.join(TEST_DIR, 'docs'), { recursive: true });
  writeFileSync(
    path.join(TEST_DIR, 'docs', 'installation.md'),
    '# Installation Guide\n\nHow to install the software.\n\n## Prerequisites\n\n- Node.js >= 22.0.0\n- pnpm >= 9.0.0\n\n## Steps\n\n1. Run `npm install -g pnpm`\n2. Run `pnpm install`\n',
  );
  writeFileSync(
    path.join(TEST_DIR, 'docs', 'troubleshooting.md'),
    '# Troubleshooting\n\n## Common Errors\n\n### npm timeout\n\nIf you encounter npm timeout errors, try using a mirror registry.\n\n### Permission denied\n\nUse sudo or fix directory permissions.\n',
  );

  // issues/ category
  mkdirSync(path.join(TEST_DIR, 'issues'), { recursive: true });
  writeFileSync(
    path.join(TEST_DIR, 'issues', 'network-errors.md'),
    '# Network Errors\n\nCommon network error solutions.\n\n## npm registry timeout\n\nSet registry to a mirror:\n```\nnpm config set registry https://registry.npmmirror.com\n```\n\n## GitHub access denied\n\nCheck your proxy settings.\n',
  );

  // solutions/ category
  mkdirSync(path.join(TEST_DIR, 'solutions'), { recursive: true });
  writeFileSync(
    path.join(TEST_DIR, 'solutions', 'npm-registry-timeout.md'),
    '# npm Registry Timeout Solution\n\nWhen npm times out connecting to the registry:\n\n1. Check network connection\n2. Try mirror registry\n3. Use proxy if behind firewall\n',
  );

  // File without heading
  writeFileSync(
    path.join(TEST_DIR, 'no-heading.md'),
    'This document has no markdown heading.\nJust plain text content.\n',
  );
}

function cleanupTestKnowledgeBase(): void {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('Knowledge Loader - File Existence', () => {
  it('should exist at the expected path', () => {
    expect(existsSync(LOADER_FILE)).toBe(true);
  });

  it('should export KnowledgeBase class', () => {
    expect(KnowledgeBase).toBeDefined();
    expect(typeof KnowledgeBase).toBe('function');
  });

  it('should have TypeScript source with proper module header', () => {
    const content = readFileSync(LOADER_FILE, 'utf-8');
    expect(content).toContain('@module knowledge/loader');
  });
});

describe('Knowledge Loader - Exports', () => {
  it('should export KnowledgeBase class', () => {
    expect(KnowledgeBase).toBeDefined();
  });

  it('should have proper source code with all exports', () => {
    const content = readFileSync(LOADER_FILE, 'utf-8');
    expect(content).toContain('export class KnowledgeBase');
    expect(content).toContain('export interface KnowledgeDocument');
    expect(content).toContain('export interface SearchResult');
    expect(content).toContain('export interface KnowledgeBaseOptions');
  });
});

describe('Knowledge Loader - Constructor', () => {
  it('should create instance with baseDir', () => {
    const kb = new KnowledgeBase({ baseDir: '/tmp/test' });
    expect(kb).toBeInstanceOf(KnowledgeBase);
  });

  it('should default to .md extensions', () => {
    const kb = new KnowledgeBase({ baseDir: '/tmp/test' });
    expect(kb.isLoaded()).toBe(false);
    expect(kb.getDocumentCount()).toBe(0);
  });

  it('should accept custom extensions', () => {
    const kb = new KnowledgeBase({ baseDir: '/tmp/test', extensions: ['.md', '.txt'] });
    expect(kb).toBeInstanceOf(KnowledgeBase);
  });
});

describe('Knowledge Loader - loadDocuments()', () => {
  beforeEach(() => {
    setupTestKnowledgeBase();
  });

  afterEach(() => {
    cleanupTestKnowledgeBase();
  });

  it('should load documents from the knowledge base directory', () => {
    const kb = new KnowledgeBase({ baseDir: TEST_DIR });
    const count = kb.loadDocuments();
    expect(count).toBe(6);
    expect(kb.isLoaded()).toBe(true);
    expect(kb.getDocumentCount()).toBe(6);
  });

  it('should throw error if directory does not exist', () => {
    const kb = new KnowledgeBase({ baseDir: '/non/existent/dir' });
    expect(() => kb.loadDocuments()).toThrow('Knowledge base directory does not exist');
  });

  it('should handle empty directory', () => {
    const emptyDir = path.join(TEST_DIR, 'empty-subdir');
    mkdirSync(emptyDir, { recursive: true });
    const kb = new KnowledgeBase({ baseDir: emptyDir });
    const count = kb.loadDocuments();
    expect(count).toBe(0);
    expect(kb.isLoaded()).toBe(true);
  });

  it('should only load files with matching extensions', () => {
    writeFileSync(path.join(TEST_DIR, 'readme.txt'), 'This is a txt file');
    const kb = new KnowledgeBase({ baseDir: TEST_DIR });
    const count = kb.loadDocuments();
    // Should not include readme.txt since default extension is .md
    expect(count).toBe(6);
  });

  it('should load txt files when configured', () => {
    writeFileSync(path.join(TEST_DIR, 'readme.txt'), 'This is a txt file');
    const kb = new KnowledgeBase({ baseDir: TEST_DIR, extensions: ['.md', '.txt'] });
    const count = kb.loadDocuments();
    expect(count).toBe(7);
  });

  it('should reload documents when called again', () => {
    const kb = new KnowledgeBase({ baseDir: TEST_DIR });
    kb.loadDocuments();
    expect(kb.getDocumentCount()).toBe(6);

    // Add a new file and reload
    writeFileSync(path.join(TEST_DIR, 'new-doc.md'), '# New Document\n\nNew content.\n');
    const count = kb.loadDocuments();
    expect(count).toBe(7);
  });
});

describe('Knowledge Loader - Document Properties', () => {
  beforeEach(() => {
    setupTestKnowledgeBase();
  });

  afterEach(() => {
    cleanupTestKnowledgeBase();
  });

  it('should set document id as relative path with forward slashes', () => {
    const kb = new KnowledgeBase({ baseDir: TEST_DIR });
    kb.loadDocuments();
    const doc = kb.getDocumentById('docs/installation.md');
    expect(doc).toBeDefined();
    expect(doc!.id).toBe('docs/installation.md');
  });

  it('should extract title from first markdown heading', () => {
    const kb = new KnowledgeBase({ baseDir: TEST_DIR });
    kb.loadDocuments();
    const doc = kb.getDocumentById('docs/installation.md');
    expect(doc!.title).toBe('Installation Guide');
  });

  it('should fallback to filename when no heading exists', () => {
    const kb = new KnowledgeBase({ baseDir: TEST_DIR });
    kb.loadDocuments();
    const doc = kb.getDocumentById('no-heading.md');
    expect(doc).toBeDefined();
    expect(doc!.title).toBe('no-heading');
  });

  it('should set category from first directory component', () => {
    const kb = new KnowledgeBase({ baseDir: TEST_DIR });
    kb.loadDocuments();

    const docsDoc = kb.getDocumentById('docs/installation.md');
    expect(docsDoc!.category).toBe('docs');

    const issuesDoc = kb.getDocumentById('issues/network-errors.md');
    expect(issuesDoc!.category).toBe('issues');

    const solutionsDoc = kb.getDocumentById('solutions/npm-registry-timeout.md');
    expect(solutionsDoc!.category).toBe('solutions');
  });

  it('should set category to root for top-level files', () => {
    const kb = new KnowledgeBase({ baseDir: TEST_DIR });
    kb.loadDocuments();
    const doc = kb.getDocumentById('overview.md');
    expect(doc!.category).toBe('root');
  });

  it('should contain the full file content', () => {
    const kb = new KnowledgeBase({ baseDir: TEST_DIR });
    kb.loadDocuments();
    const doc = kb.getDocumentById('overview.md');
    expect(doc!.content).toContain('Project Overview');
    expect(doc!.content).toContain('main project overview document');
  });

  it('should set filePath as relative path from base dir', () => {
    const kb = new KnowledgeBase({ baseDir: TEST_DIR });
    kb.loadDocuments();
    const doc = kb.getDocumentById('docs/troubleshooting.md');
    expect(doc!.filePath).toBe('docs/troubleshooting.md');
  });
});

describe('Knowledge Loader - search()', () => {
  beforeEach(() => {
    setupTestKnowledgeBase();
  });

  afterEach(() => {
    cleanupTestKnowledgeBase();
  });

  it('should return empty array when not loaded', () => {
    const kb = new KnowledgeBase({ baseDir: TEST_DIR });
    const results = kb.search('npm');
    expect(results).toEqual([]);
  });

  it('should return empty array for empty query', () => {
    const kb = new KnowledgeBase({ baseDir: TEST_DIR });
    kb.loadDocuments();
    const results = kb.search('');
    expect(results).toEqual([]);
  });

  it('should return empty array for single-char query', () => {
    const kb = new KnowledgeBase({ baseDir: TEST_DIR });
    kb.loadDocuments();
    const results = kb.search('a');
    expect(results).toEqual([]);
  });

  it('should find documents matching query terms', () => {
    const kb = new KnowledgeBase({ baseDir: TEST_DIR });
    kb.loadDocuments();
    const results = kb.search('npm timeout');
    expect(results.length).toBeGreaterThan(0);
  });

  it('should return results sorted by score descending', () => {
    const kb = new KnowledgeBase({ baseDir: TEST_DIR });
    kb.loadDocuments();
    const results = kb.search('npm timeout');
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });

  it('should rank title matches higher', () => {
    const kb = new KnowledgeBase({ baseDir: TEST_DIR });
    kb.loadDocuments();
    const results = kb.search('network errors');
    expect(results.length).toBeGreaterThan(0);
    // The doc titled "Network Errors" should score highly
    const topResult = results[0];
    expect(topResult.document.title.toLowerCase()).toContain('network');
  });

  it('should respect maxResults parameter', () => {
    const kb = new KnowledgeBase({ baseDir: TEST_DIR });
    kb.loadDocuments();
    const results = kb.search('npm', 2);
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it('should include snippets in results', () => {
    const kb = new KnowledgeBase({ baseDir: TEST_DIR });
    kb.loadDocuments();
    const results = kb.search('permission');
    expect(results.length).toBeGreaterThan(0);
    const result = results.find((r) => r.snippets.length > 0);
    expect(result).toBeDefined();
    expect(result!.snippets.length).toBeGreaterThan(0);
  });

  it('should be case insensitive', () => {
    const kb = new KnowledgeBase({ baseDir: TEST_DIR });
    kb.loadDocuments();
    const resultsLower = kb.search('npm');
    const resultsUpper = kb.search('NPM');
    expect(resultsLower.length).toBe(resultsUpper.length);
  });

  it('should return no results for non-matching query', () => {
    const kb = new KnowledgeBase({ baseDir: TEST_DIR });
    kb.loadDocuments();
    const results = kb.search('xyznonexistentterm');
    expect(results.length).toBe(0);
  });

  it('should handle multi-word queries', () => {
    const kb = new KnowledgeBase({ baseDir: TEST_DIR });
    kb.loadDocuments();
    const results = kb.search('registry mirror proxy');
    expect(results.length).toBeGreaterThan(0);
  });

  it('should have positive scores for all returned results', () => {
    const kb = new KnowledgeBase({ baseDir: TEST_DIR });
    kb.loadDocuments();
    const results = kb.search('install');
    for (const result of results) {
      expect(result.score).toBeGreaterThan(0);
    }
  });

  it('should limit snippets to at most 3', () => {
    const kb = new KnowledgeBase({ baseDir: TEST_DIR });
    kb.loadDocuments();
    const results = kb.search('npm');
    for (const result of results) {
      expect(result.snippets.length).toBeLessThanOrEqual(3);
    }
  });
});

describe('Knowledge Loader - getDocuments()', () => {
  beforeEach(() => {
    setupTestKnowledgeBase();
  });

  afterEach(() => {
    cleanupTestKnowledgeBase();
  });

  it('should return empty array before loading', () => {
    const kb = new KnowledgeBase({ baseDir: TEST_DIR });
    expect(kb.getDocuments()).toEqual([]);
  });

  it('should return all loaded documents', () => {
    const kb = new KnowledgeBase({ baseDir: TEST_DIR });
    kb.loadDocuments();
    const docs = kb.getDocuments();
    expect(docs.length).toBe(6);
  });

  it('should return a copy (not a reference)', () => {
    const kb = new KnowledgeBase({ baseDir: TEST_DIR });
    kb.loadDocuments();
    const docs1 = kb.getDocuments();
    const docs2 = kb.getDocuments();
    expect(docs1).not.toBe(docs2);
    expect(docs1).toEqual(docs2);
  });
});

describe('Knowledge Loader - getDocumentById()', () => {
  beforeEach(() => {
    setupTestKnowledgeBase();
  });

  afterEach(() => {
    cleanupTestKnowledgeBase();
  });

  it('should find document by id', () => {
    const kb = new KnowledgeBase({ baseDir: TEST_DIR });
    kb.loadDocuments();
    const doc = kb.getDocumentById('docs/installation.md');
    expect(doc).toBeDefined();
    expect(doc!.title).toBe('Installation Guide');
  });

  it('should return undefined for non-existent id', () => {
    const kb = new KnowledgeBase({ baseDir: TEST_DIR });
    kb.loadDocuments();
    expect(kb.getDocumentById('nonexistent.md')).toBeUndefined();
  });
});

describe('Knowledge Loader - getDocumentsByCategory()', () => {
  beforeEach(() => {
    setupTestKnowledgeBase();
  });

  afterEach(() => {
    cleanupTestKnowledgeBase();
  });

  it('should return documents in a specific category', () => {
    const kb = new KnowledgeBase({ baseDir: TEST_DIR });
    kb.loadDocuments();
    const docs = kb.getDocumentsByCategory('docs');
    expect(docs.length).toBe(2);
    expect(docs.every((d) => d.category === 'docs')).toBe(true);
  });

  it('should return root category documents', () => {
    const kb = new KnowledgeBase({ baseDir: TEST_DIR });
    kb.loadDocuments();
    const rootDocs = kb.getDocumentsByCategory('root');
    expect(rootDocs.length).toBe(2); // overview.md and no-heading.md
  });

  it('should return empty array for non-existent category', () => {
    const kb = new KnowledgeBase({ baseDir: TEST_DIR });
    kb.loadDocuments();
    expect(kb.getDocumentsByCategory('nonexistent')).toEqual([]);
  });
});

describe('Knowledge Loader - isLoaded() and getDocumentCount()', () => {
  beforeEach(() => {
    setupTestKnowledgeBase();
  });

  afterEach(() => {
    cleanupTestKnowledgeBase();
  });

  it('should not be loaded initially', () => {
    const kb = new KnowledgeBase({ baseDir: TEST_DIR });
    expect(kb.isLoaded()).toBe(false);
    expect(kb.getDocumentCount()).toBe(0);
  });

  it('should be loaded after loadDocuments()', () => {
    const kb = new KnowledgeBase({ baseDir: TEST_DIR });
    kb.loadDocuments();
    expect(kb.isLoaded()).toBe(true);
    expect(kb.getDocumentCount()).toBe(6);
  });
});

describe('Knowledge Loader - Code Quality', () => {
  it('should use proper imports', () => {
    const content = readFileSync(LOADER_FILE, 'utf-8');
    expect(content).toContain("from 'node:fs'");
    expect(content).toContain("from 'node:path'");
  });

  it('should have JSDoc on all exported members', () => {
    const content = readFileSync(LOADER_FILE, 'utf-8');
    // Check JSDoc before each export
    expect(content).toContain('/** A single document loaded from the knowledge base */');
    expect(content).toContain('/** A search result with relevance score */');
    expect(content).toContain('/** Options for the KnowledgeBase constructor */');
  });

  it('should use named exports (not default)', () => {
    const content = readFileSync(LOADER_FILE, 'utf-8');
    expect(content).not.toContain('export default');
  });

  it('should have proper type annotations', () => {
    const content = readFileSync(LOADER_FILE, 'utf-8');
    expect(content).toContain('KnowledgeDocument');
    expect(content).toContain('SearchResult');
    expect(content).toContain('KnowledgeBaseOptions');
  });
});
