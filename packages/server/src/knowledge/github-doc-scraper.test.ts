// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for the GitHub documentation scraper module.
 */

import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  buildGitHubHeaders,
  fetchRepoTree,
  filterTreeEntries,
  fetchFileContent,
  formatGitHubDoc,
  saveGitHubDoc,
  scrapeGitHubDocs,
  GITHUB_API_BASE,
  type GitHubDocSource,
  type GitHubDocResult,
  type GitHubTreeEntry,
} from './github-doc-scraper.js';

// ============================================================================
// Helpers
// ============================================================================

function createMockFetch(body: unknown, status = 200, headers?: Record<string, string>): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
    headers: new Map(Object.entries(headers ?? {})),
  });
}

function createErrorFetch(error: string): typeof fetch {
  return vi.fn().mockRejectedValue(new Error(error));
}

const sampleSource: GitHubDocSource = {
  owner: 'nginx',
  repo: 'nginx',
  branch: 'main',
  paths: ['docs/'],
  extensions: ['.md'],
  maxFiles: 10,
};

const sampleTreeEntries: GitHubTreeEntry[] = [
  { path: 'docs/readme.md', mode: '100644', type: 'blob', sha: 'abc123', size: 100, url: '' },
  { path: 'docs/install.md', mode: '100644', type: 'blob', sha: 'def456', size: 200, url: '' },
  { path: 'docs/images', mode: '040000', type: 'tree', sha: 'ghi789', url: '' },
  { path: 'src/main.c', mode: '100644', type: 'blob', sha: 'jkl012', size: 5000, url: '' },
  { path: 'README.md', mode: '100644', type: 'blob', sha: 'mno345', size: 300, url: '' },
];

// ============================================================================
// Tests
// ============================================================================

describe('github-doc-scraper', () => {
  // --------------------------------------------------------------------------
  // buildGitHubHeaders
  // --------------------------------------------------------------------------

  describe('buildGitHubHeaders', () => {
    it('should include User-Agent and Accept headers', () => {
      const headers = buildGitHubHeaders();
      expect(headers['User-Agent']).toContain('ServerPilot');
      expect(headers['Accept']).toContain('github');
    });

    it('should include Authorization header when token is provided', () => {
      const headers = buildGitHubHeaders('test-token');
      expect(headers['Authorization']).toBe('Bearer test-token');
    });

    it('should not include Authorization header when no token', () => {
      const headers = buildGitHubHeaders();
      expect(headers['Authorization']).toBeUndefined();
    });
  });

  // --------------------------------------------------------------------------
  // filterTreeEntries
  // --------------------------------------------------------------------------

  describe('filterTreeEntries', () => {
    it('should filter by extension', () => {
      const result = filterTreeEntries(sampleTreeEntries, {
        owner: 'test',
        repo: 'test',
        extensions: ['.md'],
      });
      expect(result.every((e) => e.path.endsWith('.md'))).toBe(true);
    });

    it('should filter by path prefix', () => {
      const result = filterTreeEntries(sampleTreeEntries, {
        owner: 'test',
        repo: 'test',
        paths: ['docs/'],
        extensions: ['.md'],
      });
      expect(result).toHaveLength(2);
      expect(result.every((e) => e.path.startsWith('docs/'))).toBe(true);
    });

    it('should filter by exact path', () => {
      const result = filterTreeEntries(sampleTreeEntries, {
        owner: 'test',
        repo: 'test',
        paths: ['README.md'],
        extensions: ['.md'],
      });
      expect(result).toHaveLength(1);
      expect(result[0].path).toBe('README.md');
    });

    it('should exclude tree (directory) entries', () => {
      const result = filterTreeEntries(sampleTreeEntries, {
        owner: 'test',
        repo: 'test',
      });
      expect(result.every((e) => e.type === 'blob')).toBe(true);
    });

    it('should respect maxFiles limit', () => {
      const result = filterTreeEntries(sampleTreeEntries, {
        owner: 'test',
        repo: 'test',
        extensions: ['.md', '.c'],
        maxFiles: 2,
      });
      expect(result).toHaveLength(2);
    });

    it('should use default extensions when not specified', () => {
      const result = filterTreeEntries(sampleTreeEntries, {
        owner: 'test',
        repo: 'test',
      });
      // Default includes .md, .txt, .rst
      expect(result.every((e) => e.path.endsWith('.md'))).toBe(true);
    });

    it('should return all matching files when no paths specified', () => {
      const result = filterTreeEntries(sampleTreeEntries, {
        owner: 'test',
        repo: 'test',
        extensions: ['.md'],
      });
      expect(result).toHaveLength(3); // docs/readme.md, docs/install.md, README.md
    });
  });

  // --------------------------------------------------------------------------
  // fetchRepoTree
  // --------------------------------------------------------------------------

  describe('fetchRepoTree', () => {
    it('should fetch and filter the repository tree', async () => {
      const mockFetch = createMockFetch(
        { tree: sampleTreeEntries, truncated: false },
        200,
        { 'x-ratelimit-remaining': '59' },
      );

      const { entries, rateLimitRemaining } = await fetchRepoTree(sampleSource, {
        fetchFn: mockFetch,
      });

      expect(entries).toHaveLength(2); // Only docs/*.md
      expect(rateLimitRemaining).toBe(59);
      expect(mockFetch).toHaveBeenCalledOnce();
    });

    it('should use the correct API URL with branch', async () => {
      const mockFetch = createMockFetch({ tree: [], truncated: false });
      await fetchRepoTree(sampleSource, { fetchFn: mockFetch });

      const url = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(url).toBe(
        `${GITHUB_API_BASE}/repos/nginx/nginx/git/trees/main?recursive=1`,
      );
    });

    it('should default to main branch when not specified', async () => {
      const mockFetch = createMockFetch({ tree: [], truncated: false });
      await fetchRepoTree(
        { owner: 'test', repo: 'test' },
        { fetchFn: mockFetch },
      );

      const url = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(url).toContain('/main?');
    });

    it('should throw on HTTP error', async () => {
      const mockFetch = createMockFetch({}, 404, {});
      await expect(
        fetchRepoTree(sampleSource, { fetchFn: mockFetch }),
      ).rejects.toThrow('GitHub API error');
    });

    it('should throw on network error', async () => {
      const mockFetch = createErrorFetch('Network error');
      await expect(
        fetchRepoTree(sampleSource, { fetchFn: mockFetch }),
      ).rejects.toThrow('Network error');
    });

    it('should pass auth token in headers', async () => {
      const mockFetch = createMockFetch({ tree: [], truncated: false });
      await fetchRepoTree(sampleSource, {
        fetchFn: mockFetch,
        token: 'my-token',
      });

      const callArgs = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(callArgs[1].headers['Authorization']).toBe('Bearer my-token');
    });
  });

  // --------------------------------------------------------------------------
  // fetchFileContent
  // --------------------------------------------------------------------------

  describe('fetchFileContent', () => {
    it('should decode base64 content', async () => {
      const encoded = Buffer.from('# Hello World').toString('base64');
      const mockFetch = createMockFetch({
        content: encoded,
        encoding: 'base64',
        sha: 'abc123',
        size: 13,
      });

      const result = await fetchFileContent('owner', 'repo', 'README.md', 'main', {
        fetchFn: mockFetch,
      });

      expect(result.content).toBe('# Hello World');
      expect(result.sha).toBe('abc123');
      expect(result.size).toBe(13);
    });

    it('should handle non-base64 encoding', async () => {
      const mockFetch = createMockFetch({
        content: '# Plain text',
        encoding: 'utf-8',
        sha: 'def456',
        size: 12,
      });

      const result = await fetchFileContent('owner', 'repo', 'doc.md', 'main', {
        fetchFn: mockFetch,
      });

      expect(result.content).toBe('# Plain text');
    });

    it('should use correct API URL with ref param', async () => {
      const encoded = Buffer.from('content').toString('base64');
      const mockFetch = createMockFetch({
        content: encoded,
        encoding: 'base64',
        sha: 'x',
        size: 7,
      });

      await fetchFileContent('owner', 'repo', 'docs/file.md', 'develop', {
        fetchFn: mockFetch,
      });

      const url = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(url).toBe(
        `${GITHUB_API_BASE}/repos/owner/repo/contents/docs/file.md?ref=develop`,
      );
    });

    it('should throw on file too large', async () => {
      const mockFetch = createMockFetch({
        content: 'x',
        encoding: 'utf-8',
        sha: 'x',
        size: 1024 * 1024, // 1MB
      });

      await expect(
        fetchFileContent('owner', 'repo', 'big.md', 'main', {
          fetchFn: mockFetch,
          maxFileSize: 100,
        }),
      ).rejects.toThrow('File too large');
    });

    it('should throw on HTTP error', async () => {
      const mockFetch = createMockFetch({}, 404);
      await expect(
        fetchFileContent('owner', 'repo', 'missing.md', 'main', {
          fetchFn: mockFetch,
        }),
      ).rejects.toThrow('HTTP 404');
    });

    it('should throw on network error', async () => {
      const mockFetch = createErrorFetch('Connection refused');
      await expect(
        fetchFileContent('owner', 'repo', 'file.md', 'main', {
          fetchFn: mockFetch,
        }),
      ).rejects.toThrow('Connection refused');
    });
  });

  // --------------------------------------------------------------------------
  // formatGitHubDoc
  // --------------------------------------------------------------------------

  describe('formatGitHubDoc', () => {
    it('should format a successful result with metadata header', () => {
      const result: GitHubDocResult = {
        filePath: 'docs/install.md',
        success: true,
        content: '# Install\n\nRun the installer.',
        size: 30,
        sha: 'abc123',
      };

      const formatted = formatGitHubDoc(result, sampleSource);

      expect(formatted).toContain('# install');
      expect(formatted).toContain('> 来源:');
      expect(formatted).toContain('> 仓库: nginx/nginx');
      expect(formatted).toContain('> 抓取时间:');
      expect(formatted).toContain('Run the installer.');
    });

    it('should include the correct GitHub URL', () => {
      const result: GitHubDocResult = {
        filePath: 'docs/readme.md',
        success: true,
        content: 'content',
        size: 7,
        sha: 'x',
      };

      const formatted = formatGitHubDoc(result, sampleSource);
      expect(formatted).toContain('https://github.com/nginx/nginx/blob/main/docs/readme.md');
    });

    it('should return empty string for failed results', () => {
      const result: GitHubDocResult = {
        filePath: 'x.md',
        success: false,
        error: 'fail',
        size: 0,
        sha: 'x',
      };

      expect(formatGitHubDoc(result, sampleSource)).toBe('');
    });

    it('should return empty string when content is undefined', () => {
      const result: GitHubDocResult = {
        filePath: 'x.md',
        success: true,
        content: undefined,
        size: 0,
        sha: 'x',
      };

      expect(formatGitHubDoc(result, sampleSource)).toBe('');
    });
  });

  // --------------------------------------------------------------------------
  // saveGitHubDoc
  // --------------------------------------------------------------------------

  describe('saveGitHubDoc', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = path.join(
        os.tmpdir(),
        `gh-scraper-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      );
    });

    afterEach(() => {
      if (existsSync(tmpDir)) {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('should save document to file with sanitized name', () => {
      const result: GitHubDocResult = {
        filePath: 'docs/install.md',
        success: true,
        content: '# Install Guide',
        size: 16,
        sha: 'abc',
      };

      const savedPath = saveGitHubDoc(result, sampleSource, tmpDir);
      expect(savedPath).not.toBeNull();
      expect(savedPath).toBe(path.join(tmpDir, 'docs_install.md'));
      expect(existsSync(savedPath!)).toBe(true);

      const content = readFileSync(savedPath!, 'utf-8');
      expect(content).toContain('# Install Guide');
      expect(content).toContain('> 仓库: nginx/nginx');
    });

    it('should create output directory if it does not exist', () => {
      const result: GitHubDocResult = {
        filePath: 'README.md',
        success: true,
        content: '# Test',
        size: 6,
        sha: 'x',
      };

      saveGitHubDoc(result, sampleSource, tmpDir);
      expect(existsSync(tmpDir)).toBe(true);
    });

    it('should return null for failed results', () => {
      const result: GitHubDocResult = {
        filePath: 'x.md',
        success: false,
        error: 'fail',
        size: 0,
        sha: 'x',
      };

      expect(saveGitHubDoc(result, sampleSource, tmpDir)).toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // scrapeGitHubDocs
  // --------------------------------------------------------------------------

  describe('scrapeGitHubDocs', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = path.join(
        os.tmpdir(),
        `gh-scrape-int-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      );
    });

    afterEach(() => {
      if (existsSync(tmpDir)) {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('should scrape files and return summary', async () => {
      const encoded = Buffer.from('# Doc Content').toString('base64');
      let callIndex = 0;

      const mockFetch = vi.fn().mockImplementation((_url: string) => {
        callIndex++;
        if (callIndex === 1) {
          // Tree request
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({
              tree: [
                { path: 'docs/readme.md', mode: '100644', type: 'blob', sha: 'a1', size: 50, url: '' },
              ],
              truncated: false,
            }),
            headers: new Map([['x-ratelimit-remaining', '58']]),
          });
        }
        // Content request
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({
            content: encoded,
            encoding: 'base64',
            sha: 'a1',
            size: 13,
          }),
          headers: new Map(),
        });
      });

      const summary = await scrapeGitHubDocs(sampleSource, tmpDir, {
        fetchFn: mockFetch as typeof fetch,
      });

      expect(summary.repository).toBe('nginx/nginx');
      expect(summary.branch).toBe('main');
      expect(summary.totalFound).toBe(1);
      expect(summary.succeeded).toBe(1);
      expect(summary.failed).toBe(0);
      expect(summary.rateLimitRemaining).toBe(58);
      expect(existsSync(path.join(tmpDir, 'docs_readme.md'))).toBe(true);
    });

    it('should handle tree fetch failure gracefully', async () => {
      const mockFetch = createMockFetch({}, 401);

      const summary = await scrapeGitHubDocs(sampleSource, tmpDir, {
        fetchFn: mockFetch,
      });

      expect(summary.totalFound).toBe(0);
      expect(summary.succeeded).toBe(0);
      expect(summary.failed).toBe(0);
      expect(summary.results).toHaveLength(0);
    });

    it('should handle individual file fetch failure', async () => {
      let callIndex = 0;
      const mockFetch = vi.fn().mockImplementation(() => {
        callIndex++;
        if (callIndex === 1) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({
              tree: [
                { path: 'docs/ok.md', mode: '100644', type: 'blob', sha: 'a', size: 10, url: '' },
                { path: 'docs/fail.md', mode: '100644', type: 'blob', sha: 'b', size: 10, url: '' },
              ],
              truncated: false,
            }),
            headers: new Map(),
          });
        }
        if (callIndex === 2) {
          const encoded = Buffer.from('# OK').toString('base64');
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ content: encoded, encoding: 'base64', sha: 'a', size: 4 }),
            headers: new Map(),
          });
        }
        return Promise.resolve({
          ok: false,
          status: 404,
          statusText: 'Not Found',
          json: () => Promise.resolve({}),
          headers: new Map(),
        });
      });

      const summary = await scrapeGitHubDocs(sampleSource, tmpDir, {
        fetchFn: mockFetch as typeof fetch,
      });

      expect(summary.totalFound).toBe(2);
      expect(summary.succeeded).toBe(1);
      expect(summary.failed).toBe(1);
      expect(summary.results[1].error).toContain('404');
    });

    it('should use default branch "main" when not specified', async () => {
      const mockFetch = createMockFetch({ tree: [], truncated: false });
      const source: GitHubDocSource = { owner: 'test', repo: 'test' };

      const summary = await scrapeGitHubDocs(source, tmpDir, {
        fetchFn: mockFetch,
      });

      expect(summary.branch).toBe('main');
    });
  });

  // --------------------------------------------------------------------------
  // GITHUB_API_BASE
  // --------------------------------------------------------------------------

  describe('GITHUB_API_BASE', () => {
    it('should point to the GitHub API', () => {
      expect(GITHUB_API_BASE).toBe('https://api.github.com');
    });
  });
});
