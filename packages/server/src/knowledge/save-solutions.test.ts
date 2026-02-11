// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for the knowledge base solution document save module.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  DEFAULT_SOLUTIONS_DIR,
  REQUIRED_SOLUTIONS,
  DEFAULT_SOLUTION_PAGES,
  resolveSolutionsDir,
  listExistingSolutions,
  checkMissingSolutions,
  saveOpenClawSolutions,
  type SaveSolutionsOptions,
} from './save-solutions.js';
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
    `save-solutions-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
}

// ============================================================================
// Tests
// ============================================================================

describe('save-solutions', () => {
  // --------------------------------------------------------------------------
  // Constants
  // --------------------------------------------------------------------------

  describe('DEFAULT_SOLUTIONS_DIR', () => {
    it('should point to knowledge-base/openclaw/solutions', () => {
      expect(DEFAULT_SOLUTIONS_DIR).toBe('knowledge-base/openclaw/solutions');
    });
  });

  describe('REQUIRED_SOLUTIONS', () => {
    it('should contain npm-registry-timeout.md', () => {
      expect(REQUIRED_SOLUTIONS).toContain('npm-registry-timeout.md');
    });

    it('should contain node-version-mismatch.md', () => {
      expect(REQUIRED_SOLUTIONS).toContain('node-version-mismatch.md');
    });

    it('should contain global-install-permission.md', () => {
      expect(REQUIRED_SOLUTIONS).toContain('global-install-permission.md');
    });

    it('should have exactly 3 required solution docs', () => {
      expect(REQUIRED_SOLUTIONS).toHaveLength(3);
    });
  });

  describe('DEFAULT_SOLUTION_PAGES', () => {
    it('should have 3 pages', () => {
      expect(DEFAULT_SOLUTION_PAGES).toHaveLength(3);
    });

    it('should all have category "solutions"', () => {
      for (const page of DEFAULT_SOLUTION_PAGES) {
        expect(page.category).toBe('solutions');
      }
    });

    it('should have matching filenames to REQUIRED_SOLUTIONS', () => {
      const filenames = DEFAULT_SOLUTION_PAGES.map((p) => `${p.filename}.md`);
      for (const req of REQUIRED_SOLUTIONS) {
        expect(filenames).toContain(req);
      }
    });

    it('should have valid URLs', () => {
      for (const page of DEFAULT_SOLUTION_PAGES) {
        expect(page.url).toMatch(/^https:\/\//);
      }
    });

    it('should have non-empty titles', () => {
      for (const page of DEFAULT_SOLUTION_PAGES) {
        expect(page.title.length).toBeGreaterThan(0);
      }
    });
  });

  // --------------------------------------------------------------------------
  // resolveSolutionsDir
  // --------------------------------------------------------------------------

  describe('resolveSolutionsDir', () => {
    it('should use provided projectRoot', () => {
      const result = resolveSolutionsDir({ projectRoot: '/tmp/myproject' });
      expect(result).toBe(path.resolve('/tmp/myproject', DEFAULT_SOLUTIONS_DIR));
    });

    it('should use custom outputSubdir', () => {
      const result = resolveSolutionsDir({
        projectRoot: '/tmp/myproject',
        outputSubdir: 'custom/solutions',
      });
      expect(result).toBe(path.resolve('/tmp/myproject', 'custom/solutions'));
    });

    it('should return an absolute path', () => {
      const result = resolveSolutionsDir({ projectRoot: '/tmp/myproject' });
      expect(path.isAbsolute(result)).toBe(true);
    });

    it('should default to DEFAULT_SOLUTIONS_DIR when no outputSubdir given', () => {
      const result = resolveSolutionsDir({ projectRoot: '/tmp/test' });
      expect(result).toContain('knowledge-base/openclaw/solutions');
    });
  });

  // --------------------------------------------------------------------------
  // listExistingSolutions
  // --------------------------------------------------------------------------

  describe('listExistingSolutions', () => {
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
      expect(listExistingSolutions('/nonexistent/path')).toEqual([]);
    });

    it('should return empty array for empty directory', () => {
      mkdirSync(tmpDir, { recursive: true });
      expect(listExistingSolutions(tmpDir)).toEqual([]);
    });

    it('should return markdown files only', () => {
      mkdirSync(tmpDir, { recursive: true });
      writeFileSync(path.join(tmpDir, 'npm-registry-timeout.md'), '# npm timeout');
      writeFileSync(path.join(tmpDir, 'node-version-mismatch.md'), '# Node version');
      writeFileSync(path.join(tmpDir, 'readme.txt'), 'text file');

      const result = listExistingSolutions(tmpDir);
      expect(result).toContain('npm-registry-timeout.md');
      expect(result).toContain('node-version-mismatch.md');
      expect(result).not.toContain('readme.txt');
    });

    it('should return correct number of markdown files', () => {
      mkdirSync(tmpDir, { recursive: true });
      writeFileSync(path.join(tmpDir, 'a.md'), '# A');
      writeFileSync(path.join(tmpDir, 'b.md'), '# B');
      writeFileSync(path.join(tmpDir, 'c.md'), '# C');

      expect(listExistingSolutions(tmpDir)).toHaveLength(3);
    });
  });

  // --------------------------------------------------------------------------
  // checkMissingSolutions
  // --------------------------------------------------------------------------

  describe('checkMissingSolutions', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = createTmpDir();
    });

    afterEach(() => {
      if (existsSync(tmpDir)) {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('should report all solutions as missing for non-existent directory', () => {
      const missing = checkMissingSolutions('/nonexistent/path');
      expect(missing).toHaveLength(REQUIRED_SOLUTIONS.length);
      for (const s of REQUIRED_SOLUTIONS) {
        expect(missing).toContain(s);
      }
    });

    it('should report no solutions missing when all are present', () => {
      mkdirSync(tmpDir, { recursive: true });
      for (const s of REQUIRED_SOLUTIONS) {
        writeFileSync(path.join(tmpDir, s), `# ${s}`);
      }

      expect(checkMissingSolutions(tmpDir)).toEqual([]);
    });

    it('should report specific missing solutions', () => {
      mkdirSync(tmpDir, { recursive: true });
      writeFileSync(path.join(tmpDir, 'npm-registry-timeout.md'), '# npm timeout');
      writeFileSync(path.join(tmpDir, 'global-install-permission.md'), '# permissions');

      const missing = checkMissingSolutions(tmpDir);
      expect(missing).toContain('node-version-mismatch.md');
      expect(missing).not.toContain('npm-registry-timeout.md');
      expect(missing).not.toContain('global-install-permission.md');
    });

    it('should handle partial presence correctly', () => {
      mkdirSync(tmpDir, { recursive: true });
      writeFileSync(path.join(tmpDir, 'npm-registry-timeout.md'), '# npm timeout');

      const missing = checkMissingSolutions(tmpDir);
      expect(missing).toHaveLength(2);
    });
  });

  // --------------------------------------------------------------------------
  // saveOpenClawSolutions
  // --------------------------------------------------------------------------

  describe('saveOpenClawSolutions', () => {
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
        { url: 'https://example.com/timeout.md', filename: 'npm-registry-timeout', title: 'npm Timeout', category: 'solutions' },
        { url: 'https://example.com/version.md', filename: 'node-version-mismatch', title: 'Node Version', category: 'solutions' },
        { url: 'https://example.com/permission.md', filename: 'global-install-permission', title: 'Permissions', category: 'solutions' },
      ];
      const mockFetch = createMockFetch('# Solution Content\nSome content here.');

      const result = await saveOpenClawSolutions({
        projectRoot: tmpDir,
        outputSubdir: 'solutions',
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
      const outputDir = path.join(tmpDir, 'deep', 'nested', 'solutions');
      const pages: DocPage[] = [
        { url: 'https://example.com/a.md', filename: 'test', title: 'Test', category: 'solutions' },
      ];
      const mockFetch = createMockFetch('# Test');

      await saveOpenClawSolutions({
        projectRoot: tmpDir,
        outputSubdir: 'deep/nested/solutions',
        pages,
        fetchOptions: { fetchFn: mockFetch },
      });

      expect(existsSync(outputDir)).toBe(true);
    });

    it('should report missing required solutions when not all are saved', async () => {
      const pages: DocPage[] = [
        { url: 'https://example.com/timeout.md', filename: 'npm-registry-timeout', title: 'npm Timeout', category: 'solutions' },
      ];
      const mockFetch = createMockFetch('# npm Registry Timeout Solution');

      const result = await saveOpenClawSolutions({
        projectRoot: tmpDir,
        outputSubdir: 'solutions',
        pages,
        fetchOptions: { fetchFn: mockFetch },
      });

      expect(result.allRequiredPresent).toBe(false);
      expect(result.missingRequired).toContain('node-version-mismatch.md');
      expect(result.missingRequired).toContain('global-install-permission.md');
    });

    it('should handle fetch failures gracefully', async () => {
      const pages: DocPage[] = [
        { url: 'https://example.com/fail.md', filename: 'npm-registry-timeout', title: 'npm Timeout', category: 'solutions' },
      ];
      const mockFetch = createMockFetch('', 500, 'Server Error');

      const result = await saveOpenClawSolutions({
        projectRoot: tmpDir,
        outputSubdir: 'solutions',
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

      const result = await saveOpenClawSolutions({
        projectRoot: tmpDir,
        outputSubdir: 'kb/openclaw/solutions',
        pages,
        fetchOptions: { fetchFn: mockFetch },
      });

      expect(result.outputDir).toBe(path.resolve(tmpDir, 'kb/openclaw/solutions'));
    });

    it('should save files with formatted content including metadata', async () => {
      const pages: DocPage[] = [
        { url: 'https://docs.openclaw.ai/solutions/npm-registry-timeout.md', filename: 'npm-registry-timeout', title: 'npm Registry 超时解决方案', category: 'solutions' },
      ];
      const mockFetch = createMockFetch('## Problem\nnpm registry timeout during install.');

      const result = await saveOpenClawSolutions({
        projectRoot: tmpDir,
        outputSubdir: 'solutions',
        pages,
        fetchOptions: { fetchFn: mockFetch },
      });

      const filePath = path.join(result.outputDir, 'npm-registry-timeout.md');
      expect(existsSync(filePath)).toBe(true);

      const content = readFileSync(filePath, 'utf-8');
      expect(content).toContain('# npm Registry 超时解决方案');
      expect(content).toContain('> 来源:');
      expect(content).toContain('> 抓取时间:');
      expect(content).toContain('## Problem');
    });

    it('should handle empty page list', async () => {
      const mockFetch = createMockFetch('content');

      const result = await saveOpenClawSolutions({
        projectRoot: tmpDir,
        outputSubdir: 'solutions',
        pages: [],
        fetchOptions: { fetchFn: mockFetch },
      });

      expect(result.scrapeSummary.total).toBe(0);
      expect(result.savedFiles).toHaveLength(0);
    });

    it('should handle mixed success and failure', async () => {
      const pages: DocPage[] = [
        { url: 'https://example.com/ok.md', filename: 'npm-registry-timeout', title: 'npm Timeout', category: 'solutions' },
        { url: 'https://example.com/fail.md', filename: 'node-version-mismatch', title: 'Node Version', category: 'solutions' },
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

      const result = await saveOpenClawSolutions({
        projectRoot: tmpDir,
        outputSubdir: 'solutions',
        pages,
        fetchOptions: { fetchFn: mockFetch as typeof fetch },
      });

      expect(result.scrapeSummary.succeeded).toBe(1);
      expect(result.scrapeSummary.failed).toBe(1);
      expect(result.savedFiles).toContain('npm-registry-timeout.md');
      expect(result.savedFiles).not.toContain('node-version-mismatch.md');
    });

    it('should list all saved files including pre-existing ones', async () => {
      const solutionsDir = path.join(tmpDir, 'solutions');
      mkdirSync(solutionsDir, { recursive: true });
      writeFileSync(path.join(solutionsDir, 'existing.md'), '# Existing');

      const pages: DocPage[] = [
        { url: 'https://example.com/new.md', filename: 'new-solution', title: 'New', category: 'solutions' },
      ];
      const mockFetch = createMockFetch('# New Solution');

      const result = await saveOpenClawSolutions({
        projectRoot: tmpDir,
        outputSubdir: 'solutions',
        pages,
        fetchOptions: { fetchFn: mockFetch },
      });

      expect(result.savedFiles).toContain('existing.md');
      expect(result.savedFiles).toContain('new-solution.md');
    });

    it('should use default pages when none specified', async () => {
      const mockFetch = createMockFetch('# Solution content');

      const result = await saveOpenClawSolutions({
        projectRoot: tmpDir,
        outputSubdir: 'solutions',
        fetchOptions: { fetchFn: mockFetch },
      });

      expect(result.scrapeSummary.total).toBe(DEFAULT_SOLUTION_PAGES.length);
    });
  });
});
