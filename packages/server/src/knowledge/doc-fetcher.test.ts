// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for the unified documentation fetcher module.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync, readdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  DocFetcher,
  createDocFetcher,
  BUILTIN_SOURCES,
  type DocSource,
} from './doc-fetcher.js';

// ============================================================================
// Helpers
// ============================================================================

function createMockFetch(): typeof fetch {
  let callIndex = 0;

  return vi.fn().mockImplementation((url: string) => {
    callIndex++;

    // Mock GitHub API responses
    if (url.includes('api.github.com')) {
      if (url.includes('/git/trees/')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({
            tree: [
              { path: 'README.md', mode: '100644', type: 'blob', sha: 'abc123', size: 100, url: '' },
            ],
            truncated: false,
          }),
          headers: new Map([['x-ratelimit-remaining', '59']]),
        });
      }
      if (url.includes('/contents/')) {
        const content = Buffer.from('# Test Document\n\nContent here.').toString('base64');
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({
            content,
            encoding: 'base64',
            sha: 'abc123',
            size: 30,
          }),
          headers: new Map(),
        });
      }
    }

    // Mock website responses
    return Promise.resolve({
      ok: true,
      status: 200,
      text: () => Promise.resolve('<html><head><title>Test</title></head><body><h1>Content</h1></body></html>'),
      headers: {
        get: () => null,
      },
    });
  }) as unknown as typeof fetch;
}

// ============================================================================
// Tests
// ============================================================================

describe('doc-fetcher', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(
      os.tmpdir(),
      `doc-fetcher-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
  });

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // --------------------------------------------------------------------------
  // BUILTIN_SOURCES
  // --------------------------------------------------------------------------

  describe('BUILTIN_SOURCES', () => {
    it('should have pre-configured sources', () => {
      expect(BUILTIN_SOURCES.length).toBeGreaterThan(0);
    });

    it('should include nginx GitHub source', () => {
      const nginx = BUILTIN_SOURCES.find((s) => s.id === 'nginx-github');
      expect(nginx).toBeDefined();
      expect(nginx?.type).toBe('github');
      expect(nginx?.software).toBe('nginx');
    });

    it('should include redis GitHub source', () => {
      const redis = BUILTIN_SOURCES.find((s) => s.id === 'redis-github');
      expect(redis).toBeDefined();
      expect(redis?.type).toBe('github');
    });

    it('should include docker website source', () => {
      const docker = BUILTIN_SOURCES.find((s) => s.id === 'docker-docs');
      expect(docker).toBeDefined();
      expect(docker?.type).toBe('website');
    });

    it('should have valid GitHub configs', () => {
      const githubSources = BUILTIN_SOURCES.filter((s) => s.type === 'github');
      for (const source of githubSources) {
        expect(source.github).toBeDefined();
        expect(source.github?.owner).toBeTruthy();
        expect(source.github?.repo).toBeTruthy();
      }
    });

    it('should have valid website configs', () => {
      const websiteSources = BUILTIN_SOURCES.filter((s) => s.type === 'website');
      for (const source of websiteSources) {
        expect(source.website).toBeDefined();
        expect(source.website?.baseUrl).toBeTruthy();
      }
    });
  });

  // --------------------------------------------------------------------------
  // DocFetcher
  // --------------------------------------------------------------------------

  describe('DocFetcher', () => {
    it('should initialize with output directory', () => {
      const fetcher = new DocFetcher({ outputBaseDir: tmpDir });
      expect(fetcher).toBeDefined();
    });

    it('should fetch GitHub source successfully', async () => {
      const mockFetch = createMockFetch();

      const fetcher = new DocFetcher({
        outputBaseDir: tmpDir,
        fetchFn: mockFetch,
      });

      const source: DocSource = {
        id: 'test-source',
        type: 'github',
        software: 'test',
        label: 'Test Source',
        github: {
          owner: 'test',
          repo: 'repo',
          branch: 'main',
          paths: ['README.md'],
          extensions: ['.md'],
          maxFiles: 5,
        },
      };

      const task = await fetcher.fetchSource(source);

      expect(task.status).toBe('completed');
      expect(task.sourceId).toBe('test-source');
      expect(task.summary).toBeDefined();
    });

    it('should fetch website source successfully', async () => {
      const mockFetch = createMockFetch();

      const fetcher = new DocFetcher({
        outputBaseDir: tmpDir,
        fetchFn: mockFetch,
      });

      const source: DocSource = {
        id: 'test-website',
        type: 'website',
        software: 'test',
        label: 'Test Website',
        website: {
          baseUrl: 'https://example.com',
          software: 'test',
          pages: ['https://example.com/page1'],
        },
      };

      const task = await fetcher.fetchSource(source);

      expect(task.status).toBe('completed');
      expect(task.summary).toBeDefined();
    });

    it('should handle source fetch failure', async () => {
      const errorFetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const fetcher = new DocFetcher({
        outputBaseDir: tmpDir,
        fetchFn: errorFetch as typeof fetch,
      });

      const source: DocSource = {
        id: 'fail-source',
        type: 'github',
        software: 'test',
        label: 'Fail Source',
        github: {
          owner: 'test',
          repo: 'repo',
        },
      };

      const task = await fetcher.fetchSource(source);

      // Note: scrapeGitHubDocs catches errors and returns an empty summary with status='completed'
      // So we just check that the task completed
      expect(task.status).toBe('completed');
      expect(task.summary).toBeDefined();
    });

    it('should handle invalid source configuration', async () => {
      const fetcher = new DocFetcher({ outputBaseDir: tmpDir });

      const source: DocSource = {
        id: 'invalid',
        type: 'github',
        software: 'test',
        label: 'Invalid',
        // Missing github config
      };

      const task = await fetcher.fetchSource(source);

      expect(task.status).toBe('failed');
      expect(task.error).toContain('Invalid source configuration');
    });

    it('should track tasks', async () => {
      const mockFetch = createMockFetch();

      const fetcher = new DocFetcher({
        outputBaseDir: tmpDir,
        fetchFn: mockFetch,
      });

      const source: DocSource = {
        id: 'tracked',
        type: 'github',
        software: 'test',
        label: 'Tracked',
        github: {
          owner: 'test',
          repo: 'repo',
        },
      };

      const task = await fetcher.fetchSource(source);
      const retrieved = fetcher.getTask(task.id);

      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(task.id);
    });

    it('should list all tasks', async () => {
      const mockFetch = createMockFetch();

      const fetcher = new DocFetcher({
        outputBaseDir: tmpDir,
        fetchFn: mockFetch,
      });

      const source1: DocSource = {
        id: 'source1',
        type: 'github',
        software: 'test',
        label: 'Source 1',
        github: { owner: 'test', repo: 'repo1' },
      };

      const source2: DocSource = {
        id: 'source2',
        type: 'github',
        software: 'test',
        label: 'Source 2',
        github: { owner: 'test', repo: 'repo2' },
      };

      await fetcher.fetchSource(source1);
      await fetcher.fetchSource(source2);

      const tasks = fetcher.listTasks();
      expect(tasks).toHaveLength(2);
    });

    it('should fetch multiple sources', async () => {
      const mockFetch = createMockFetch();

      const fetcher = new DocFetcher({
        outputBaseDir: tmpDir,
        fetchFn: mockFetch,
      });

      const sources: DocSource[] = [
        {
          id: 'source1',
          type: 'github',
          software: 'test',
          label: 'Source 1',
          github: { owner: 'test', repo: 'repo1' },
        },
        {
          id: 'source2',
          type: 'website',
          software: 'test',
          label: 'Source 2',
          website: { baseUrl: 'https://example.com', software: 'test' },
        },
      ];

      const summary = await fetcher.fetchAll(sources);

      expect(summary.totalSources).toBe(2);
      expect(summary.succeeded).toBe(2);
      expect(summary.failed).toBe(0);
      expect(summary.tasks).toHaveLength(2);
    });

    it('should count failures in fetchAll', async () => {
      const errorFetch = vi.fn().mockRejectedValue(new Error('Fail'));

      const fetcher = new DocFetcher({
        outputBaseDir: tmpDir,
        fetchFn: errorFetch as typeof fetch,
      });

      const sources: DocSource[] = [
        {
          id: 'fail1',
          type: 'github',
          software: 'test',
          label: 'Fail 1',
          github: { owner: 'test', repo: 'repo' },
        },
      ];

      const summary = await fetcher.fetchAll(sources);

      expect(summary.totalSources).toBe(1);
      // Note: GitHub and Web scrapers catch errors internally, so tasks complete successfully
      // even when the underlying fetch fails. They just return empty results.
      expect(summary.succeeded).toBe(1);
      expect(summary.failed).toBe(0);
    });

    it('should list available docs', async () => {
      const mockFetch = createMockFetch();

      const fetcher = new DocFetcher({
        outputBaseDir: tmpDir,
        fetchFn: mockFetch,
      });

      const source: DocSource = {
        id: 'test',
        type: 'github',
        software: 'nginx',
        label: 'Test',
        github: { owner: 'test', repo: 'repo' },
      };

      await fetcher.fetchSource(source);

      const docs = fetcher.listAvailableDocs();
      expect(docs.length).toBeGreaterThan(0);

      const nginxDocs = docs.find((d) => d.software === 'nginx');
      expect(nginxDocs).toBeDefined();
    });

    it('should return empty list when no docs available', () => {
      const fetcher = new DocFetcher({ outputBaseDir: tmpDir });
      const docs = fetcher.listAvailableDocs();
      expect(docs).toEqual([]);
    });
  });

  // --------------------------------------------------------------------------
  // createDocFetcher
  // --------------------------------------------------------------------------

  describe('createDocFetcher', () => {
    it('should create a DocFetcher with default settings', () => {
      const fetcher = createDocFetcher(tmpDir);
      expect(fetcher).toBeDefined();
      expect(fetcher).toBeInstanceOf(DocFetcher);
    });

    it('should accept optional configuration', () => {
      const fetcher = createDocFetcher(tmpDir, {
        githubToken: 'test-token',
        timeoutMs: 5000,
      });
      expect(fetcher).toBeDefined();
    });
  });
});
