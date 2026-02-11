// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for the knowledge base case document save module.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  DEFAULT_CASES_DIR,
  REQUIRED_CASES,
  DEFAULT_CASE_PAGES,
  resolveCasesDir,
  listExistingCases,
  checkMissingCases,
  saveOpenClawCases,
  type SaveCasesOptions,
} from './save-cases.js';
import type { DocPage } from './scraper.js';

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
    `save-cases-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
}

// ============================================================================
// Tests
// ============================================================================

describe('save-cases', () => {
  // --------------------------------------------------------------------------
  // Constants
  // --------------------------------------------------------------------------

  describe('DEFAULT_CASES_DIR', () => {
    it('should point to knowledge-base/openclaw/cases', () => {
      expect(DEFAULT_CASES_DIR).toBe('knowledge-base/openclaw/cases');
    });
  });

  describe('REQUIRED_CASES', () => {
    it('should contain macos-m1.md', () => {
      expect(REQUIRED_CASES).toContain('macos-m1.md');
    });

    it('should contain ubuntu-22.md', () => {
      expect(REQUIRED_CASES).toContain('ubuntu-22.md');
    });

    it('should contain windows-wsl.md', () => {
      expect(REQUIRED_CASES).toContain('windows-wsl.md');
    });

    it('should have exactly 3 required case docs', () => {
      expect(REQUIRED_CASES).toHaveLength(3);
    });
  });

  describe('DEFAULT_CASE_PAGES', () => {
    it('should have 3 pages', () => {
      expect(DEFAULT_CASE_PAGES).toHaveLength(3);
    });

    it('should all have category "cases"', () => {
      for (const page of DEFAULT_CASE_PAGES) {
        expect(page.category).toBe('cases');
      }
    });

    it('should have matching filenames to REQUIRED_CASES', () => {
      const filenames = DEFAULT_CASE_PAGES.map((p) => `${p.filename}.md`);
      for (const req of REQUIRED_CASES) {
        expect(filenames).toContain(req);
      }
    });

    it('should have valid URLs', () => {
      for (const page of DEFAULT_CASE_PAGES) {
        expect(page.url).toMatch(/^https:\/\//);
      }
    });

    it('should have non-empty titles', () => {
      for (const page of DEFAULT_CASE_PAGES) {
        expect(page.title.length).toBeGreaterThan(0);
      }
    });
  });

  // --------------------------------------------------------------------------
  // resolveCasesDir
  // --------------------------------------------------------------------------

  describe('resolveCasesDir', () => {
    it('should use provided projectRoot', () => {
      const result = resolveCasesDir({ projectRoot: '/tmp/myproject' });
      expect(result).toBe(path.resolve('/tmp/myproject', DEFAULT_CASES_DIR));
    });

    it('should use custom outputSubdir', () => {
      const result = resolveCasesDir({
        projectRoot: '/tmp/myproject',
        outputSubdir: 'custom/cases',
      });
      expect(result).toBe(path.resolve('/tmp/myproject', 'custom/cases'));
    });

    it('should return an absolute path', () => {
      const result = resolveCasesDir({ projectRoot: '/tmp/myproject' });
      expect(path.isAbsolute(result)).toBe(true);
    });

    it('should default to DEFAULT_CASES_DIR when no outputSubdir given', () => {
      const result = resolveCasesDir({ projectRoot: '/tmp/test' });
      expect(result).toContain('knowledge-base/openclaw/cases');
    });
  });

  // --------------------------------------------------------------------------
  // listExistingCases
  // --------------------------------------------------------------------------

  describe('listExistingCases', () => {
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
      expect(listExistingCases('/nonexistent/path')).toEqual([]);
    });

    it('should return empty array for empty directory', () => {
      mkdirSync(tmpDir, { recursive: true });
      expect(listExistingCases(tmpDir)).toEqual([]);
    });

    it('should return markdown files only', () => {
      mkdirSync(tmpDir, { recursive: true });
      writeFileSync(path.join(tmpDir, 'macos-m1.md'), '# macOS M1');
      writeFileSync(path.join(tmpDir, 'ubuntu-22.md'), '# Ubuntu 22');
      writeFileSync(path.join(tmpDir, 'readme.txt'), 'text file');

      const result = listExistingCases(tmpDir);
      expect(result).toContain('macos-m1.md');
      expect(result).toContain('ubuntu-22.md');
      expect(result).not.toContain('readme.txt');
    });

    it('should return correct number of markdown files', () => {
      mkdirSync(tmpDir, { recursive: true });
      writeFileSync(path.join(tmpDir, 'a.md'), '# A');
      writeFileSync(path.join(tmpDir, 'b.md'), '# B');
      writeFileSync(path.join(tmpDir, 'c.md'), '# C');

      expect(listExistingCases(tmpDir)).toHaveLength(3);
    });
  });

  // --------------------------------------------------------------------------
  // checkMissingCases
  // --------------------------------------------------------------------------

  describe('checkMissingCases', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = createTmpDir();
    });

    afterEach(() => {
      if (existsSync(tmpDir)) {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('should report all cases as missing for non-existent directory', () => {
      const missing = checkMissingCases('/nonexistent/path');
      expect(missing).toHaveLength(REQUIRED_CASES.length);
      for (const c of REQUIRED_CASES) {
        expect(missing).toContain(c);
      }
    });

    it('should report no cases missing when all are present', () => {
      mkdirSync(tmpDir, { recursive: true });
      for (const c of REQUIRED_CASES) {
        writeFileSync(path.join(tmpDir, c), `# ${c}`);
      }

      expect(checkMissingCases(tmpDir)).toEqual([]);
    });

    it('should report specific missing cases', () => {
      mkdirSync(tmpDir, { recursive: true });
      writeFileSync(path.join(tmpDir, 'macos-m1.md'), '# macOS');
      writeFileSync(path.join(tmpDir, 'windows-wsl.md'), '# Windows');

      const missing = checkMissingCases(tmpDir);
      expect(missing).toContain('ubuntu-22.md');
      expect(missing).not.toContain('macos-m1.md');
      expect(missing).not.toContain('windows-wsl.md');
    });

    it('should handle partial presence correctly', () => {
      mkdirSync(tmpDir, { recursive: true });
      writeFileSync(path.join(tmpDir, 'macos-m1.md'), '# macOS');

      const missing = checkMissingCases(tmpDir);
      expect(missing).toHaveLength(2);
    });
  });

  // --------------------------------------------------------------------------
  // saveOpenClawCases
  // --------------------------------------------------------------------------

  describe('saveOpenClawCases', () => {
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
        { url: 'https://example.com/macos.md', filename: 'macos-m1', title: 'macOS M1', category: 'cases' },
        { url: 'https://example.com/ubuntu.md', filename: 'ubuntu-22', title: 'Ubuntu 22', category: 'cases' },
        { url: 'https://example.com/windows.md', filename: 'windows-wsl', title: 'Windows WSL', category: 'cases' },
      ];
      const mockFetch = createMockFetch('# Case Content\nSome content here.');

      const result = await saveOpenClawCases({
        projectRoot: tmpDir,
        outputSubdir: 'cases',
        pages,
        fetchOptions: { fetchFn: mockFetch },
      });

      expect(result.scrapeSummary.total).toBe(3);
      expect(result.scrapeSummary.succeeded).toBe(3);
      expect(result.scrapeSummary.failed).toBe(0);
      expect(result.savedFiles).toHaveLength(3);
      expect(result.allRequiredPresent).toBe(true);
      expect(result.missingRequired).toHaveLength(0);
    });

    it('should create the output directory if it does not exist', async () => {
      const outputDir = path.join(tmpDir, 'deep', 'nested', 'cases');
      const pages: DocPage[] = [
        { url: 'https://example.com/a.md', filename: 'test', title: 'Test', category: 'cases' },
      ];
      const mockFetch = createMockFetch('# Test');

      await saveOpenClawCases({
        projectRoot: tmpDir,
        outputSubdir: 'deep/nested/cases',
        pages,
        fetchOptions: { fetchFn: mockFetch },
      });

      expect(existsSync(outputDir)).toBe(true);
    });

    it('should report missing required cases when not all are saved', async () => {
      const pages: DocPage[] = [
        { url: 'https://example.com/macos.md', filename: 'macos-m1', title: 'macOS', category: 'cases' },
      ];
      const mockFetch = createMockFetch('# macOS M1 Case');

      const result = await saveOpenClawCases({
        projectRoot: tmpDir,
        outputSubdir: 'cases',
        pages,
        fetchOptions: { fetchFn: mockFetch },
      });

      expect(result.allRequiredPresent).toBe(false);
      expect(result.missingRequired).toContain('ubuntu-22.md');
      expect(result.missingRequired).toContain('windows-wsl.md');
    });

    it('should handle fetch failures gracefully', async () => {
      const pages: DocPage[] = [
        { url: 'https://example.com/fail.md', filename: 'macos-m1', title: 'macOS', category: 'cases' },
      ];
      const mockFetch = createMockFetch('', 500, 'Server Error');

      const result = await saveOpenClawCases({
        projectRoot: tmpDir,
        outputSubdir: 'cases',
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

      const result = await saveOpenClawCases({
        projectRoot: tmpDir,
        outputSubdir: 'kb/openclaw/cases',
        pages,
        fetchOptions: { fetchFn: mockFetch },
      });

      expect(result.outputDir).toBe(path.resolve(tmpDir, 'kb/openclaw/cases'));
    });

    it('should save files with formatted content including metadata', async () => {
      const pages: DocPage[] = [
        { url: 'https://docs.openclaw.ai/cases/macos-m1.md', filename: 'macos-m1', title: 'macOS M1/M2 安装案例', category: 'cases' },
      ];
      const mockFetch = createMockFetch('## Environment\nmacOS 14 Apple Silicon.');

      const result = await saveOpenClawCases({
        projectRoot: tmpDir,
        outputSubdir: 'cases',
        pages,
        fetchOptions: { fetchFn: mockFetch },
      });

      const filePath = path.join(result.outputDir, 'macos-m1.md');
      expect(existsSync(filePath)).toBe(true);

      const content = readFileSync(filePath, 'utf-8');
      expect(content).toContain('# macOS M1/M2 安装案例');
      expect(content).toContain('> 来源:');
      expect(content).toContain('> 抓取时间:');
      expect(content).toContain('## Environment');
    });

    it('should handle empty page list', async () => {
      const mockFetch = createMockFetch('content');

      const result = await saveOpenClawCases({
        projectRoot: tmpDir,
        outputSubdir: 'cases',
        pages: [],
        fetchOptions: { fetchFn: mockFetch },
      });

      expect(result.scrapeSummary.total).toBe(0);
      expect(result.savedFiles).toHaveLength(0);
    });

    it('should handle mixed success and failure', async () => {
      const pages: DocPage[] = [
        { url: 'https://example.com/ok.md', filename: 'macos-m1', title: 'macOS', category: 'cases' },
        { url: 'https://example.com/fail.md', filename: 'ubuntu-22', title: 'Ubuntu', category: 'cases' },
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

      const result = await saveOpenClawCases({
        projectRoot: tmpDir,
        outputSubdir: 'cases',
        pages,
        fetchOptions: { fetchFn: mockFetch as typeof fetch },
      });

      expect(result.scrapeSummary.succeeded).toBe(1);
      expect(result.scrapeSummary.failed).toBe(1);
      expect(result.savedFiles).toContain('macos-m1.md');
      expect(result.savedFiles).not.toContain('ubuntu-22.md');
    });

    it('should list all saved files including pre-existing ones', async () => {
      const casesDir = path.join(tmpDir, 'cases');
      mkdirSync(casesDir, { recursive: true });
      writeFileSync(path.join(casesDir, 'existing.md'), '# Existing');

      const pages: DocPage[] = [
        { url: 'https://example.com/new.md', filename: 'new-case', title: 'New', category: 'cases' },
      ];
      const mockFetch = createMockFetch('# New Case');

      const result = await saveOpenClawCases({
        projectRoot: tmpDir,
        outputSubdir: 'cases',
        pages,
        fetchOptions: { fetchFn: mockFetch },
      });

      expect(result.savedFiles).toContain('existing.md');
      expect(result.savedFiles).toContain('new-case.md');
    });

    it('should use default pages when none specified', async () => {
      const mockFetch = createMockFetch('# Case content');

      const result = await saveOpenClawCases({
        projectRoot: tmpDir,
        outputSubdir: 'cases',
        fetchOptions: { fetchFn: mockFetch },
      });

      expect(result.scrapeSummary.total).toBe(DEFAULT_CASE_PAGES.length);
    });
  });
});
