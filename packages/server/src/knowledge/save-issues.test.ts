// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for the knowledge base issue document save module.
 */

import { existsSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  DEFAULT_ISSUES_DIR,
  REQUIRED_ISSUES,
  DEFAULT_ISSUE_PAGES,
  resolveIssuesDir,
  listExistingIssues,
  checkMissingIssues,
  saveOpenClawIssues,
} from './save-issues.js';
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
    `save-issues-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
}

// ============================================================================
// Tests
// ============================================================================

describe('save-issues', () => {
  // --------------------------------------------------------------------------
  // Constants
  // --------------------------------------------------------------------------

  describe('DEFAULT_ISSUES_DIR', () => {
    it('should point to knowledge-base/openclaw/issues', () => {
      expect(DEFAULT_ISSUES_DIR).toBe('knowledge-base/openclaw/issues');
    });
  });

  describe('REQUIRED_ISSUES', () => {
    it('should contain network-errors.md', () => {
      expect(REQUIRED_ISSUES).toContain('network-errors.md');
    });

    it('should contain permission-errors.md', () => {
      expect(REQUIRED_ISSUES).toContain('permission-errors.md');
    });

    it('should contain dependency-errors.md', () => {
      expect(REQUIRED_ISSUES).toContain('dependency-errors.md');
    });

    it('should contain version-conflicts.md', () => {
      expect(REQUIRED_ISSUES).toContain('version-conflicts.md');
    });

    it('should have exactly 4 required issue docs', () => {
      expect(REQUIRED_ISSUES).toHaveLength(4);
    });
  });

  describe('DEFAULT_ISSUE_PAGES', () => {
    it('should have 4 pages', () => {
      expect(DEFAULT_ISSUE_PAGES).toHaveLength(4);
    });

    it('should all have category "issues"', () => {
      for (const page of DEFAULT_ISSUE_PAGES) {
        expect(page.category).toBe('issues');
      }
    });

    it('should have matching filenames to REQUIRED_ISSUES', () => {
      const filenames = DEFAULT_ISSUE_PAGES.map((p) => `${p.filename}.md`);
      for (const req of REQUIRED_ISSUES) {
        expect(filenames).toContain(req);
      }
    });

    it('should have valid URLs', () => {
      for (const page of DEFAULT_ISSUE_PAGES) {
        expect(page.url).toMatch(/^https:\/\//);
      }
    });

    it('should have non-empty titles', () => {
      for (const page of DEFAULT_ISSUE_PAGES) {
        expect(page.title.length).toBeGreaterThan(0);
      }
    });
  });

  // --------------------------------------------------------------------------
  // resolveIssuesDir
  // --------------------------------------------------------------------------

  describe('resolveIssuesDir', () => {
    it('should use provided projectRoot', () => {
      const result = resolveIssuesDir({ projectRoot: '/tmp/myproject' });
      expect(result).toBe(path.resolve('/tmp/myproject', DEFAULT_ISSUES_DIR));
    });

    it('should use custom outputSubdir', () => {
      const result = resolveIssuesDir({
        projectRoot: '/tmp/myproject',
        outputSubdir: 'custom/issues',
      });
      expect(result).toBe(path.resolve('/tmp/myproject', 'custom/issues'));
    });

    it('should return an absolute path', () => {
      const result = resolveIssuesDir({ projectRoot: '/tmp/myproject' });
      expect(path.isAbsolute(result)).toBe(true);
    });

    it('should default to DEFAULT_ISSUES_DIR when no outputSubdir given', () => {
      const result = resolveIssuesDir({ projectRoot: '/tmp/test' });
      expect(result).toContain('knowledge-base/openclaw/issues');
    });
  });

  // --------------------------------------------------------------------------
  // listExistingIssues
  // --------------------------------------------------------------------------

  describe('listExistingIssues', () => {
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
      expect(listExistingIssues('/nonexistent/path')).toEqual([]);
    });

    it('should return empty array for empty directory', () => {
      mkdirSync(tmpDir, { recursive: true });
      expect(listExistingIssues(tmpDir)).toEqual([]);
    });

    it('should return markdown files only', () => {
      mkdirSync(tmpDir, { recursive: true });
      writeFileSync(path.join(tmpDir, 'network-errors.md'), '# Network Errors');
      writeFileSync(path.join(tmpDir, 'permission-errors.md'), '# Permission Errors');
      writeFileSync(path.join(tmpDir, 'readme.txt'), 'text file');

      const result = listExistingIssues(tmpDir);
      expect(result).toContain('network-errors.md');
      expect(result).toContain('permission-errors.md');
      expect(result).not.toContain('readme.txt');
    });

    it('should return correct number of markdown files', () => {
      mkdirSync(tmpDir, { recursive: true });
      writeFileSync(path.join(tmpDir, 'a.md'), '# A');
      writeFileSync(path.join(tmpDir, 'b.md'), '# B');
      writeFileSync(path.join(tmpDir, 'c.md'), '# C');

      expect(listExistingIssues(tmpDir)).toHaveLength(3);
    });
  });

  // --------------------------------------------------------------------------
  // checkMissingIssues
  // --------------------------------------------------------------------------

  describe('checkMissingIssues', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = createTmpDir();
    });

    afterEach(() => {
      if (existsSync(tmpDir)) {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('should report all issues as missing for non-existent directory', () => {
      const missing = checkMissingIssues('/nonexistent/path');
      expect(missing).toHaveLength(REQUIRED_ISSUES.length);
      for (const issue of REQUIRED_ISSUES) {
        expect(missing).toContain(issue);
      }
    });

    it('should report no issues missing when all are present', () => {
      mkdirSync(tmpDir, { recursive: true });
      for (const issue of REQUIRED_ISSUES) {
        writeFileSync(path.join(tmpDir, issue), `# ${issue}`);
      }

      expect(checkMissingIssues(tmpDir)).toEqual([]);
    });

    it('should report specific missing issues', () => {
      mkdirSync(tmpDir, { recursive: true });
      writeFileSync(path.join(tmpDir, 'network-errors.md'), '# Network');
      writeFileSync(path.join(tmpDir, 'version-conflicts.md'), '# Version');

      const missing = checkMissingIssues(tmpDir);
      expect(missing).toContain('permission-errors.md');
      expect(missing).toContain('dependency-errors.md');
      expect(missing).not.toContain('network-errors.md');
      expect(missing).not.toContain('version-conflicts.md');
    });

    it('should handle partial presence correctly', () => {
      mkdirSync(tmpDir, { recursive: true });
      writeFileSync(path.join(tmpDir, 'network-errors.md'), '# Network');

      const missing = checkMissingIssues(tmpDir);
      expect(missing).toHaveLength(3);
    });
  });

  // --------------------------------------------------------------------------
  // saveOpenClawIssues
  // --------------------------------------------------------------------------

  describe('saveOpenClawIssues', () => {
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
        { url: 'https://example.com/network.md', filename: 'network-errors', title: 'Network Errors', category: 'issues' },
        { url: 'https://example.com/perm.md', filename: 'permission-errors', title: 'Permission Errors', category: 'issues' },
        { url: 'https://example.com/dep.md', filename: 'dependency-errors', title: 'Dependency Errors', category: 'issues' },
        { url: 'https://example.com/ver.md', filename: 'version-conflicts', title: 'Version Conflicts', category: 'issues' },
      ];
      const mockFetch = createMockFetch('# Issue Content\nSome content here.');

      const result = await saveOpenClawIssues({
        projectRoot: tmpDir,
        outputSubdir: 'issues',
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
      const outputDir = path.join(tmpDir, 'deep', 'nested', 'issues');
      const pages: DocPage[] = [
        { url: 'https://example.com/a.md', filename: 'test', title: 'Test', category: 'issues' },
      ];
      const mockFetch = createMockFetch('# Test');

      await saveOpenClawIssues({
        projectRoot: tmpDir,
        outputSubdir: 'deep/nested/issues',
        pages,
        fetchOptions: { fetchFn: mockFetch },
      });

      expect(existsSync(outputDir)).toBe(true);
    });

    it('should report missing required issues when not all are saved', async () => {
      const pages: DocPage[] = [
        { url: 'https://example.com/network.md', filename: 'network-errors', title: 'Network', category: 'issues' },
      ];
      const mockFetch = createMockFetch('# Network Errors');

      const result = await saveOpenClawIssues({
        projectRoot: tmpDir,
        outputSubdir: 'issues',
        pages,
        fetchOptions: { fetchFn: mockFetch },
      });

      expect(result.allRequiredPresent).toBe(false);
      expect(result.missingRequired).toContain('permission-errors.md');
      expect(result.missingRequired).toContain('dependency-errors.md');
      expect(result.missingRequired).toContain('version-conflicts.md');
    });

    it('should handle fetch failures gracefully', async () => {
      const pages: DocPage[] = [
        { url: 'https://example.com/fail.md', filename: 'network-errors', title: 'Network', category: 'issues' },
      ];
      const mockFetch = createMockFetch('', 500, 'Server Error');

      const result = await saveOpenClawIssues({
        projectRoot: tmpDir,
        outputSubdir: 'issues',
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

      const result = await saveOpenClawIssues({
        projectRoot: tmpDir,
        outputSubdir: 'kb/openclaw/issues',
        pages,
        fetchOptions: { fetchFn: mockFetch },
      });

      expect(result.outputDir).toBe(path.resolve(tmpDir, 'kb/openclaw/issues'));
    });

    it('should save files with formatted content including metadata', async () => {
      const pages: DocPage[] = [
        { url: 'https://docs.openclaw.ai/help/network-errors.md', filename: 'network-errors', title: 'OpenClaw 网络错误', category: 'issues' },
      ];
      const mockFetch = createMockFetch('## Connection Timeout\nCheck your network.');

      const result = await saveOpenClawIssues({
        projectRoot: tmpDir,
        outputSubdir: 'issues',
        pages,
        fetchOptions: { fetchFn: mockFetch },
      });

      const filePath = path.join(result.outputDir, 'network-errors.md');
      expect(existsSync(filePath)).toBe(true);

      const content = readFileSync(filePath, 'utf-8');
      expect(content).toContain('# OpenClaw 网络错误');
      expect(content).toContain('> 来源:');
      expect(content).toContain('> 抓取时间:');
      expect(content).toContain('## Connection Timeout');
    });

    it('should handle empty page list', async () => {
      const mockFetch = createMockFetch('content');

      const result = await saveOpenClawIssues({
        projectRoot: tmpDir,
        outputSubdir: 'issues',
        pages: [],
        fetchOptions: { fetchFn: mockFetch },
      });

      expect(result.scrapeSummary.total).toBe(0);
      expect(result.savedFiles).toHaveLength(0);
    });

    it('should handle mixed success and failure', async () => {
      const pages: DocPage[] = [
        { url: 'https://example.com/ok.md', filename: 'network-errors', title: 'Network', category: 'issues' },
        { url: 'https://example.com/fail.md', filename: 'permission-errors', title: 'Permission', category: 'issues' },
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

      const result = await saveOpenClawIssues({
        projectRoot: tmpDir,
        outputSubdir: 'issues',
        pages,
        fetchOptions: { fetchFn: mockFetch as typeof fetch },
      });

      expect(result.scrapeSummary.succeeded).toBe(1);
      expect(result.scrapeSummary.failed).toBe(1);
      expect(result.savedFiles).toContain('network-errors.md');
      expect(result.savedFiles).not.toContain('permission-errors.md');
    });

    it('should list all saved files including pre-existing ones', async () => {
      const issuesDir = path.join(tmpDir, 'issues');
      mkdirSync(issuesDir, { recursive: true });
      writeFileSync(path.join(issuesDir, 'existing.md'), '# Existing');

      const pages: DocPage[] = [
        { url: 'https://example.com/new.md', filename: 'new-issue', title: 'New', category: 'issues' },
      ];
      const mockFetch = createMockFetch('# New Issue');

      const result = await saveOpenClawIssues({
        projectRoot: tmpDir,
        outputSubdir: 'issues',
        pages,
        fetchOptions: { fetchFn: mockFetch },
      });

      expect(result.savedFiles).toContain('existing.md');
      expect(result.savedFiles).toContain('new-issue.md');
    });

    it('should use default pages when none specified', async () => {
      const mockFetch = createMockFetch('# Issue content');

      const result = await saveOpenClawIssues({
        projectRoot: tmpDir,
        outputSubdir: 'issues',
        fetchOptions: { fetchFn: mockFetch },
      });

      expect(result.scrapeSummary.total).toBe(DEFAULT_ISSUE_PAGES.length);
    });
  });
});
