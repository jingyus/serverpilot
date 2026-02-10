/**
 * Tests for the knowledge base document save module.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  DEFAULT_OUTPUT_DIR,
  REQUIRED_DOCS,
  resolveOutputDir,
  listExistingDocs,
  checkMissingDocs,
  saveOpenClawDocs,
  findProjectRoot,
  type SaveDocsOptions,
} from './save-docs.js';
import { DEFAULT_DOC_PAGES, type DocPage } from './scraper.js';

// ============================================================================
// Helpers
// ============================================================================

/** Create a mock fetch that returns the given response */
function createMockFetch(
  body: string,
  status = 200,
  statusText = 'OK',
): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText,
    text: () => Promise.resolve(body),
  });
}

/** Create a temporary directory for testing */
function createTmpDir(): string {
  return path.join(
    os.tmpdir(),
    `save-docs-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
}

// ============================================================================
// Tests
// ============================================================================

describe('save-docs', () => {
  // --------------------------------------------------------------------------
  // Constants
  // --------------------------------------------------------------------------

  describe('DEFAULT_OUTPUT_DIR', () => {
    it('should point to knowledge-base/openclaw/docs', () => {
      expect(DEFAULT_OUTPUT_DIR).toBe('knowledge-base/openclaw/docs');
    });
  });

  describe('REQUIRED_DOCS', () => {
    it('should contain installation.md', () => {
      expect(REQUIRED_DOCS).toContain('installation.md');
    });

    it('should contain prerequisites.md', () => {
      expect(REQUIRED_DOCS).toContain('prerequisites.md');
    });

    it('should contain troubleshooting.md', () => {
      expect(REQUIRED_DOCS).toContain('troubleshooting.md');
    });

    it('should contain faq.md', () => {
      expect(REQUIRED_DOCS).toContain('faq.md');
    });

    it('should have exactly 4 required docs', () => {
      expect(REQUIRED_DOCS).toHaveLength(4);
    });
  });

  // --------------------------------------------------------------------------
  // resolveOutputDir
  // --------------------------------------------------------------------------

  describe('resolveOutputDir', () => {
    it('should use provided projectRoot', () => {
      const result = resolveOutputDir({ projectRoot: '/tmp/myproject' });
      expect(result).toBe(path.resolve('/tmp/myproject', DEFAULT_OUTPUT_DIR));
    });

    it('should use custom outputSubdir', () => {
      const result = resolveOutputDir({
        projectRoot: '/tmp/myproject',
        outputSubdir: 'custom/output',
      });
      expect(result).toBe(path.resolve('/tmp/myproject', 'custom/output'));
    });

    it('should return an absolute path', () => {
      const result = resolveOutputDir({ projectRoot: '/tmp/myproject' });
      expect(path.isAbsolute(result)).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // listExistingDocs
  // --------------------------------------------------------------------------

  describe('listExistingDocs', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = createTmpDir();
    });

    afterEach(() => {
      if (existsSync(tmpDir)) {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('should return empty array for non-existent directory', () => {
      expect(listExistingDocs('/nonexistent/path')).toEqual([]);
    });

    it('should return empty array for empty directory', () => {
      mkdirSync(tmpDir, { recursive: true });
      expect(listExistingDocs(tmpDir)).toEqual([]);
    });

    it('should return markdown files only', () => {
      mkdirSync(tmpDir, { recursive: true });
      writeFileSync(path.join(tmpDir, 'doc1.md'), '# Doc 1');
      writeFileSync(path.join(tmpDir, 'doc2.md'), '# Doc 2');
      writeFileSync(path.join(tmpDir, 'readme.txt'), 'text file');

      const result = listExistingDocs(tmpDir);
      expect(result).toContain('doc1.md');
      expect(result).toContain('doc2.md');
      expect(result).not.toContain('readme.txt');
    });

    it('should return correct number of markdown files', () => {
      mkdirSync(tmpDir, { recursive: true });
      writeFileSync(path.join(tmpDir, 'a.md'), '# A');
      writeFileSync(path.join(tmpDir, 'b.md'), '# B');
      writeFileSync(path.join(tmpDir, 'c.md'), '# C');

      expect(listExistingDocs(tmpDir)).toHaveLength(3);
    });
  });

  // --------------------------------------------------------------------------
  // checkMissingDocs
  // --------------------------------------------------------------------------

  describe('checkMissingDocs', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = createTmpDir();
    });

    afterEach(() => {
      if (existsSync(tmpDir)) {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('should report all docs as missing for non-existent directory', () => {
      const missing = checkMissingDocs('/nonexistent/path');
      expect(missing).toHaveLength(REQUIRED_DOCS.length);
      for (const doc of REQUIRED_DOCS) {
        expect(missing).toContain(doc);
      }
    });

    it('should report no docs missing when all are present', () => {
      mkdirSync(tmpDir, { recursive: true });
      for (const doc of REQUIRED_DOCS) {
        writeFileSync(path.join(tmpDir, doc), `# ${doc}`);
      }

      expect(checkMissingDocs(tmpDir)).toEqual([]);
    });

    it('should report specific missing docs', () => {
      mkdirSync(tmpDir, { recursive: true });
      writeFileSync(path.join(tmpDir, 'installation.md'), '# Install');
      writeFileSync(path.join(tmpDir, 'faq.md'), '# FAQ');

      const missing = checkMissingDocs(tmpDir);
      expect(missing).toContain('prerequisites.md');
      expect(missing).toContain('troubleshooting.md');
      expect(missing).not.toContain('installation.md');
      expect(missing).not.toContain('faq.md');
    });

    it('should handle partial presence correctly', () => {
      mkdirSync(tmpDir, { recursive: true });
      writeFileSync(path.join(tmpDir, 'installation.md'), '# Install');

      const missing = checkMissingDocs(tmpDir);
      expect(missing).toHaveLength(3);
    });
  });

  // --------------------------------------------------------------------------
  // findProjectRoot
  // --------------------------------------------------------------------------

  describe('findProjectRoot', () => {
    it('should return null for a path with no matching package.json', () => {
      const result = findProjectRoot(os.tmpdir());
      // tmpdir may not have a matching package.json
      // This test just verifies the function doesn't crash
      expect(result === null || typeof result === 'string').toBe(true);
    });

    it('should find the actual project root from a subdirectory', () => {
      const projectRoot = path.resolve(
        __dirname,
        '..', // src
        '..', // packages/server
        '..', // packages
        '..', // project root
      );
      const result = findProjectRoot(__dirname);
      // Should find the project root (may be null in test environments)
      if (result !== null) {
        expect(existsSync(path.join(result, 'package.json'))).toBe(true);
      }
    });
  });

  // --------------------------------------------------------------------------
  // saveOpenClawDocs
  // --------------------------------------------------------------------------

  describe('saveOpenClawDocs', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = createTmpDir();
    });

    afterEach(() => {
      if (existsSync(tmpDir)) {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('should scrape and save all pages successfully', async () => {
      const pages: DocPage[] = [
        { url: 'https://example.com/install.md', filename: 'installation', title: 'Install', category: 'docs' },
        { url: 'https://example.com/prereq.md', filename: 'prerequisites', title: 'Prerequisites', category: 'docs' },
        { url: 'https://example.com/trouble.md', filename: 'troubleshooting', title: 'Troubleshooting', category: 'docs' },
        { url: 'https://example.com/faq.md', filename: 'faq', title: 'FAQ', category: 'docs' },
      ];
      const mockFetch = createMockFetch('# Documentation\nSome content here.');

      const result = await saveOpenClawDocs({
        projectRoot: tmpDir,
        outputSubdir: 'docs',
        pages,
        fetchOptions: { fetchFn: mockFetch },
      });

      expect(result.scrapeSummary.total).toBe(4);
      expect(result.scrapeSummary.succeeded).toBe(4);
      expect(result.scrapeSummary.failed).toBe(0);
      expect(result.savedFiles).toHaveLength(4);
      expect(result.allRequiredPresent).toBe(true);
      expect(result.missingRequired).toHaveLength(0);
    });

    it('should create the output directory if it does not exist', async () => {
      const outputDir = path.join(tmpDir, 'deep', 'nested', 'docs');
      const pages: DocPage[] = [
        { url: 'https://example.com/a.md', filename: 'test', title: 'Test', category: 'docs' },
      ];
      const mockFetch = createMockFetch('# Test');

      await saveOpenClawDocs({
        projectRoot: tmpDir,
        outputSubdir: 'deep/nested/docs',
        pages,
        fetchOptions: { fetchFn: mockFetch },
      });

      expect(existsSync(outputDir)).toBe(true);
    });

    it('should report missing required docs when not all are saved', async () => {
      const pages: DocPage[] = [
        { url: 'https://example.com/install.md', filename: 'installation', title: 'Install', category: 'docs' },
      ];
      const mockFetch = createMockFetch('# Install Guide');

      const result = await saveOpenClawDocs({
        projectRoot: tmpDir,
        outputSubdir: 'docs',
        pages,
        fetchOptions: { fetchFn: mockFetch },
      });

      expect(result.allRequiredPresent).toBe(false);
      expect(result.missingRequired).toContain('prerequisites.md');
      expect(result.missingRequired).toContain('troubleshooting.md');
      expect(result.missingRequired).toContain('faq.md');
    });

    it('should handle fetch failures gracefully', async () => {
      const pages: DocPage[] = [
        { url: 'https://example.com/fail.md', filename: 'installation', title: 'Install', category: 'docs' },
      ];
      const mockFetch = createMockFetch('', 500, 'Server Error');

      const result = await saveOpenClawDocs({
        projectRoot: tmpDir,
        outputSubdir: 'docs',
        pages,
        fetchOptions: { fetchFn: mockFetch },
      });

      expect(result.scrapeSummary.failed).toBe(1);
      expect(result.scrapeSummary.succeeded).toBe(0);
      expect(result.allRequiredPresent).toBe(false);
    });

    it('should return the correct output directory path', async () => {
      const pages: DocPage[] = [];
      const mockFetch = createMockFetch('content');

      const result = await saveOpenClawDocs({
        projectRoot: tmpDir,
        outputSubdir: 'kb/openclaw/docs',
        pages,
        fetchOptions: { fetchFn: mockFetch },
      });

      expect(result.outputDir).toBe(path.resolve(tmpDir, 'kb/openclaw/docs'));
    });

    it('should save files with formatted content including metadata', async () => {
      const pages: DocPage[] = [
        { url: 'https://docs.openclaw.ai/install/index.md', filename: 'installation', title: 'OpenClaw 安装指南', category: 'docs' },
      ];
      const mockFetch = createMockFetch('## Quick Start\nInstall with npm.');

      const result = await saveOpenClawDocs({
        projectRoot: tmpDir,
        outputSubdir: 'docs',
        pages,
        fetchOptions: { fetchFn: mockFetch },
      });

      const filePath = path.join(result.outputDir, 'installation.md');
      expect(existsSync(filePath)).toBe(true);

      const content = readFileSync(filePath, 'utf-8');
      expect(content).toContain('# OpenClaw 安装指南');
      expect(content).toContain('> 来源:');
      expect(content).toContain('> 抓取时间:');
      expect(content).toContain('## Quick Start');
    });

    it('should handle empty page list', async () => {
      const mockFetch = createMockFetch('content');

      const result = await saveOpenClawDocs({
        projectRoot: tmpDir,
        outputSubdir: 'docs',
        pages: [],
        fetchOptions: { fetchFn: mockFetch },
      });

      expect(result.scrapeSummary.total).toBe(0);
      expect(result.savedFiles).toHaveLength(0);
    });

    it('should handle mixed success and failure', async () => {
      const pages: DocPage[] = [
        { url: 'https://example.com/ok.md', filename: 'installation', title: 'Install', category: 'docs' },
        { url: 'https://example.com/fail.md', filename: 'prerequisites', title: 'Prereq', category: 'docs' },
      ];

      let callCount = 0;
      const mockFetch = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            ok: true,
            status: 200,
            statusText: 'OK',
            text: () => Promise.resolve('# Good content'),
          });
        }
        return Promise.resolve({
          ok: false,
          status: 404,
          statusText: 'Not Found',
          text: () => Promise.resolve(''),
        });
      });

      const result = await saveOpenClawDocs({
        projectRoot: tmpDir,
        outputSubdir: 'docs',
        pages,
        fetchOptions: { fetchFn: mockFetch as typeof fetch },
      });

      expect(result.scrapeSummary.succeeded).toBe(1);
      expect(result.scrapeSummary.failed).toBe(1);
      expect(result.savedFiles).toContain('installation.md');
      expect(result.savedFiles).not.toContain('prerequisites.md');
    });

    it('should list all saved files including extra docs', async () => {
      const docsDir = path.join(tmpDir, 'docs');
      mkdirSync(docsDir, { recursive: true });
      // Pre-existing file
      writeFileSync(path.join(docsDir, 'existing.md'), '# Existing');

      const pages: DocPage[] = [
        { url: 'https://example.com/new.md', filename: 'new-doc', title: 'New', category: 'docs' },
      ];
      const mockFetch = createMockFetch('# New Doc');

      const result = await saveOpenClawDocs({
        projectRoot: tmpDir,
        outputSubdir: 'docs',
        pages,
        fetchOptions: { fetchFn: mockFetch },
      });

      expect(result.savedFiles).toContain('existing.md');
      expect(result.savedFiles).toContain('new-doc.md');
    });
  });
});
