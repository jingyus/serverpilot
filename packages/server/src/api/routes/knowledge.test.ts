// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for knowledge base documentation routes.
 *
 * Validates scraping triggers, built-in source listing, task status,
 * documentation listing, and knowledge search endpoints.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';

import type { ApiEnv } from './types.js';
import type { FetchTask, FetchAllSummary, DocSource } from '../../knowledge/doc-fetcher.js';
import type { Knowledge, KnowledgeRepository } from '../../db/repositories/knowledge-repository.js';
import { onError } from '../middleware/error-handler.js';

// ============================================================================
// Module Mocks
// ============================================================================

const mockFetchSource = vi.fn();
const mockFetchBuiltinSources = vi.fn();
const mockListAvailableDocs = vi.fn();
const mockListTasks = vi.fn();
const mockGetTask = vi.fn();

const mockFetcherInstance = {
  fetchSource: mockFetchSource,
  fetchBuiltinSources: mockFetchBuiltinSources,
  listAvailableDocs: mockListAvailableDocs,
  listTasks: mockListTasks,
  getTask: mockGetTask,
};

const mockBuiltinSources: DocSource[] = [
  {
    id: 'nginx-github',
    type: 'github',
    software: 'nginx',
    label: 'Nginx GitHub Docs',
    github: {
      owner: 'nginx',
      repo: 'nginx',
      branch: 'master',
      paths: ['docs/'],
      extensions: ['.md'],
      maxFiles: 20,
    },
  },
  {
    id: 'docker-docs',
    type: 'website',
    software: 'docker',
    label: 'Docker Official Docs',
    website: {
      baseUrl: 'https://docs.docker.com/get-started/',
      software: 'docker',
      pages: ['https://docs.docker.com/get-started/'],
      maxPages: 10,
    },
  },
];

vi.mock('../../knowledge/doc-fetcher.js', () => ({
  DocFetcher: vi.fn().mockImplementation(() => mockFetcherInstance),
  BUILTIN_SOURCES: [
    {
      id: 'nginx-github',
      type: 'github',
      software: 'nginx',
      label: 'Nginx GitHub Docs',
      github: {
        owner: 'nginx',
        repo: 'nginx',
        branch: 'master',
        paths: ['docs/'],
        extensions: ['.md'],
        maxFiles: 20,
      },
    },
    {
      id: 'docker-docs',
      type: 'website',
      software: 'docker',
      label: 'Docker Official Docs',
      website: {
        baseUrl: 'https://docs.docker.com/get-started/',
        software: 'docker',
        pages: ['https://docs.docker.com/get-started/'],
        maxPages: 10,
      },
    },
  ],
}));

const mockKnowledgeRepo: Pick<KnowledgeRepository, 'search'> = {
  search: vi.fn(),
};

vi.mock('../../db/repositories/knowledge-repository.js', () => ({
  getKnowledgeRepository: () => mockKnowledgeRepo,
}));

vi.mock('../middleware/auth.js', () => ({
  requireAuth: vi.fn(async (c: { set: (k: string, v: string) => void }, next: () => Promise<void>) => {
    c.set('userId', 'user-1');
    await next();
  }),
}));

vi.mock('../middleware/rbac.js', () => ({
  resolveRole: vi.fn(async (c: Record<string, (k: string, v: string) => void>, next: () => Promise<void>) => {
    c.set('userRole', 'owner');
    await next();
  }),
  requirePermission: vi.fn(() => {
    return async (_c: unknown, next: () => Promise<void>) => {
      await next();
    };
  }),
}));

vi.mock('../middleware/validate.js', () => ({
  validateBody: vi.fn(() => {
    return async (c: { req: { json: () => Promise<unknown>; }; set: (k: string, v: unknown) => void }, next: () => Promise<void>) => {
      const body = await c.req.json();
      c.set('validatedBody', body);
      await next();
    };
  }),
}));

vi.mock('../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Import after mocks
import { knowledge, setDocFetcher } from './knowledge.js';

// ============================================================================
// Test App Setup
// ============================================================================

function createTestApp() {
  const app = new Hono<ApiEnv>();
  app.route('/knowledge', knowledge);
  app.onError(onError);
  return app;
}

function makeTask(overrides: Partial<FetchTask> = {}): FetchTask {
  return {
    id: 'task-001',
    sourceId: 'github-nginx-nginx',
    status: 'completed',
    startedAt: '2026-02-11T00:00:00.000Z',
    completedAt: '2026-02-11T00:01:00.000Z',
    summary: { filesProcessed: 5, totalSize: 10240 } as unknown as FetchTask['summary'],
    ...overrides,
  };
}

function makeKnowledge(overrides: Partial<Knowledge> = {}): Knowledge {
  return {
    id: 'kb-1',
    software: 'nginx',
    platform: 'linux',
    content: { commands: ['apt-get install nginx'], verification: 'nginx -v' } as unknown as Knowledge['content'],
    source: 'builtin',
    successCount: 10,
    lastUsed: '2026-02-10T12:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-02-10T12:00:00.000Z',
    ...overrides,
  };
}

// ============================================================================
// Setup
// ============================================================================

let app: ReturnType<typeof createTestApp>;

beforeEach(() => {
  app = createTestApp();
  // Inject the mock fetcher via the exported setter
  setDocFetcher(mockFetcherInstance as any);
  vi.clearAllMocks();
});

afterEach(() => {
  setDocFetcher(null);
  vi.restoreAllMocks();
});

// ============================================================================
// POST /knowledge/scrape — Trigger a documentation scrape
// ============================================================================

describe('POST /knowledge/scrape', () => {
  it('should scrape a GitHub source and return 200 on success', async () => {
    const task = makeTask({ status: 'completed' });
    mockFetchSource.mockResolvedValue(task);

    const res = await app.request('/knowledge/scrape', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'github',
        source: {
          owner: 'nginx',
          repo: 'nginx',
          software: 'nginx',
          branch: 'master',
          paths: ['docs/'],
          extensions: ['.md'],
          maxFiles: 20,
        },
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.task).toBeDefined();
    expect(body.task.status).toBe('completed');
    expect(body.task.sourceId).toBe('github-nginx-nginx');
    expect(mockFetchSource).toHaveBeenCalledOnce();
  });

  it('should scrape a website source and return 200 on success', async () => {
    const task = makeTask({
      sourceId: 'website-docker',
      status: 'completed',
    });
    mockFetchSource.mockResolvedValue(task);

    const res = await app.request('/knowledge/scrape', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'website',
        source: {
          baseUrl: 'https://docs.docker.com/',
          software: 'docker',
          pages: ['https://docs.docker.com/get-started/'],
          maxPages: 10,
        },
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.task).toBeDefined();
    expect(body.task.status).toBe('completed');
    expect(body.task.sourceId).toBe('website-docker');
    expect(mockFetchSource).toHaveBeenCalledOnce();
  });

  it('should build correct GitHub source config from body', async () => {
    const task = makeTask({ status: 'completed' });
    mockFetchSource.mockResolvedValue(task);

    await app.request('/knowledge/scrape', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'github',
        source: {
          owner: 'redis',
          repo: 'redis',
          software: 'redis',
          branch: 'unstable',
          paths: ['README.md'],
          extensions: ['.md'],
          maxFiles: 10,
        },
      }),
    });

    const sourceArg = mockFetchSource.mock.calls[0][0] as DocSource;
    expect(sourceArg.id).toBe('github-redis-redis');
    expect(sourceArg.type).toBe('github');
    expect(sourceArg.software).toBe('redis');
    expect(sourceArg.label).toBe('redis/redis');
    expect(sourceArg.github).toEqual({
      owner: 'redis',
      repo: 'redis',
      branch: 'unstable',
      paths: ['README.md'],
      extensions: ['.md'],
      maxFiles: 10,
    });
  });

  it('should build correct website source config from body', async () => {
    const task = makeTask({ status: 'completed' });
    mockFetchSource.mockResolvedValue(task);

    await app.request('/knowledge/scrape', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'website',
        source: {
          baseUrl: 'https://docs.docker.com/',
          software: 'docker',
          pages: ['https://docs.docker.com/get-started/'],
          maxDepth: 2,
          maxPages: 10,
          includePatterns: ['/get-started/'],
          excludePatterns: ['/enterprise/'],
        },
      }),
    });

    const sourceArg = mockFetchSource.mock.calls[0][0] as DocSource;
    expect(sourceArg.id).toBe('website-docker');
    expect(sourceArg.type).toBe('website');
    expect(sourceArg.software).toBe('docker');
    expect(sourceArg.label).toBe('docker docs');
    expect(sourceArg.website).toEqual({
      baseUrl: 'https://docs.docker.com/',
      software: 'docker',
      pages: ['https://docs.docker.com/get-started/'],
      maxDepth: 2,
      maxPages: 10,
      includePatterns: ['/get-started/'],
      excludePatterns: ['/enterprise/'],
    });
  });

  it('should return 500 when task status is failed', async () => {
    const task = makeTask({
      status: 'failed',
      error: 'Rate limit exceeded',
    });
    mockFetchSource.mockResolvedValue(task);

    const res = await app.request('/knowledge/scrape', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'github',
        source: {
          owner: 'nginx',
          repo: 'nginx',
          software: 'nginx',
        },
      }),
    });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.task.status).toBe('failed');
    expect(body.task.error).toBe('Rate limit exceeded');
  });

  it('should return 500 when task status is running (not completed)', async () => {
    const task = makeTask({ status: 'running', completedAt: undefined });
    mockFetchSource.mockResolvedValue(task);

    const res = await app.request('/knowledge/scrape', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'github',
        source: {
          owner: 'nginx',
          repo: 'nginx',
          software: 'nginx',
        },
      }),
    });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.task.status).toBe('running');
  });
});

// ============================================================================
// POST /knowledge/scrape/builtin — Scrape all built-in sources
// ============================================================================

describe('POST /knowledge/scrape/builtin', () => {
  it('should trigger builtin sources scrape and return 200', async () => {
    const summary: FetchAllSummary = {
      totalSources: 4,
      succeeded: 3,
      failed: 1,
      tasks: [
        makeTask({ id: 't1', sourceId: 'nginx-github', status: 'completed' }),
        makeTask({ id: 't2', sourceId: 'redis-github', status: 'completed' }),
        makeTask({ id: 't3', sourceId: 'docker-docs', status: 'completed' }),
        makeTask({ id: 't4', sourceId: 'nodejs-github', status: 'failed', error: 'timeout' }),
      ],
    };
    mockFetchBuiltinSources.mockResolvedValue(summary);

    const res = await app.request('/knowledge/scrape/builtin', {
      method: 'POST',
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.summary).toBeDefined();
    expect(body.summary.totalSources).toBe(4);
    expect(body.summary.succeeded).toBe(3);
    expect(body.summary.failed).toBe(1);
    expect(body.summary.tasks).toHaveLength(4);
    expect(mockFetchBuiltinSources).toHaveBeenCalledOnce();
  });

  it('should return summary even when all sources fail', async () => {
    const summary: FetchAllSummary = {
      totalSources: 2,
      succeeded: 0,
      failed: 2,
      tasks: [
        makeTask({ id: 't1', status: 'failed', error: 'Network error' }),
        makeTask({ id: 't2', status: 'failed', error: 'Rate limited' }),
      ],
    };
    mockFetchBuiltinSources.mockResolvedValue(summary);

    const res = await app.request('/knowledge/scrape/builtin', {
      method: 'POST',
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.summary.succeeded).toBe(0);
    expect(body.summary.failed).toBe(2);
  });
});

// ============================================================================
// GET /knowledge/sources — List built-in documentation sources
// ============================================================================

describe('GET /knowledge/sources', () => {
  it('should return formatted built-in sources', async () => {
    const res = await app.request('/knowledge/sources');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sources).toBeDefined();
    expect(body.sources).toHaveLength(2);

    // Verify the sources are formatted with only id, type, software, label
    const nginx = body.sources.find((s: { id: string }) => s.id === 'nginx-github');
    expect(nginx).toEqual({
      id: 'nginx-github',
      type: 'github',
      software: 'nginx',
      label: 'Nginx GitHub Docs',
    });

    const docker = body.sources.find((s: { id: string }) => s.id === 'docker-docs');
    expect(docker).toEqual({
      id: 'docker-docs',
      type: 'website',
      software: 'docker',
      label: 'Docker Official Docs',
    });
  });

  it('should not expose internal config like github/website details', async () => {
    const res = await app.request('/knowledge/sources');

    const body = await res.json();
    for (const source of body.sources) {
      expect(source).not.toHaveProperty('github');
      expect(source).not.toHaveProperty('website');
    }
  });
});

// ============================================================================
// GET /knowledge/docs — List available fetched documentation
// ============================================================================

describe('GET /knowledge/docs', () => {
  it('should return available documentation list', async () => {
    const docs = [
      { software: 'nginx', type: 'github', files: ['README.md', 'config.md'] },
      { software: 'docker', type: 'website', files: ['getting-started.md'] },
    ];
    mockListAvailableDocs.mockReturnValue(docs);

    const res = await app.request('/knowledge/docs');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.docs).toBeDefined();
    expect(body.docs).toHaveLength(2);
    expect(body.docs[0].software).toBe('nginx');
    expect(body.docs[0].files).toContain('README.md');
    expect(body.docs[1].software).toBe('docker');
    expect(mockListAvailableDocs).toHaveBeenCalledOnce();
  });

  it('should return empty array when no docs available', async () => {
    mockListAvailableDocs.mockReturnValue([]);

    const res = await app.request('/knowledge/docs');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.docs).toEqual([]);
  });
});

// ============================================================================
// GET /knowledge/tasks — List fetch tasks
// ============================================================================

describe('GET /knowledge/tasks', () => {
  it('should return list of tasks', async () => {
    const tasks = [
      makeTask({ id: 'task-1', sourceId: 'nginx-github', status: 'completed' }),
      makeTask({ id: 'task-2', sourceId: 'docker-docs', status: 'failed', error: 'timeout' }),
    ];
    mockListTasks.mockReturnValue(tasks);

    const res = await app.request('/knowledge/tasks');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tasks).toBeDefined();
    expect(body.tasks).toHaveLength(2);
    expect(body.tasks[0].id).toBe('task-1');
    expect(body.tasks[1].status).toBe('failed');
    expect(mockListTasks).toHaveBeenCalledOnce();
  });

  it('should return empty array when no tasks exist', async () => {
    mockListTasks.mockReturnValue([]);

    const res = await app.request('/knowledge/tasks');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tasks).toEqual([]);
  });
});

// ============================================================================
// GET /knowledge/tasks/:taskId — Get a specific fetch task
// ============================================================================

describe('GET /knowledge/tasks/:taskId', () => {
  it('should return a specific task by ID', async () => {
    const task = makeTask({ id: 'task-abc', sourceId: 'nginx-github' });
    mockGetTask.mockReturnValue(task);

    const res = await app.request('/knowledge/tasks/task-abc');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.task).toBeDefined();
    expect(body.task.id).toBe('task-abc');
    expect(body.task.sourceId).toBe('nginx-github');
    expect(mockGetTask).toHaveBeenCalledWith('task-abc');
  });

  it('should return 404 for missing task', async () => {
    mockGetTask.mockReturnValue(undefined);

    const res = await app.request('/knowledge/tasks/non-existent-task');

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Task not found');
  });
});

// ============================================================================
// GET /knowledge/search — Search knowledge base entries
// ============================================================================

describe('GET /knowledge/search', () => {
  it('should return 400 when missing q param', async () => {
    const res = await app.request('/knowledge/search');

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('"q"');
  });

  it('should return search results for valid query', async () => {
    const results = [
      makeKnowledge({ id: 'kb-1', software: 'nginx' }),
      makeKnowledge({ id: 'kb-2', software: 'nginx-proxy' }),
    ];
    (mockKnowledgeRepo.search as ReturnType<typeof vi.fn>).mockResolvedValue(results);

    const res = await app.request('/knowledge/search?q=nginx');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.query).toBe('nginx');
    expect(body.count).toBe(2);
    expect(body.results).toHaveLength(2);
    expect(body.results[0].id).toBe('kb-1');
    expect(body.results[0].software).toBe('nginx');
    expect(mockKnowledgeRepo.search).toHaveBeenCalledWith('nginx');
  });

  it('should filter results by source when source param provided', async () => {
    const results = [
      makeKnowledge({ id: 'kb-1', software: 'nginx', source: 'builtin' }),
      makeKnowledge({ id: 'kb-2', software: 'nginx', source: 'scrape' }),
      makeKnowledge({ id: 'kb-3', software: 'nginx', source: 'auto_learn' }),
    ];
    (mockKnowledgeRepo.search as ReturnType<typeof vi.fn>).mockResolvedValue(results);

    const res = await app.request('/knowledge/search?q=nginx&source=builtin');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(1);
    expect(body.results).toHaveLength(1);
    expect(body.results[0].source).toBe('builtin');
  });

  it('should filter results by scrape source', async () => {
    const results = [
      makeKnowledge({ id: 'kb-1', source: 'builtin' }),
      makeKnowledge({ id: 'kb-2', source: 'scrape' }),
    ];
    (mockKnowledgeRepo.search as ReturnType<typeof vi.fn>).mockResolvedValue(results);

    const res = await app.request('/knowledge/search?q=docker&source=scrape');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(1);
    expect(body.results[0].source).toBe('scrape');
  });

  it('should return empty results when no matches', async () => {
    (mockKnowledgeRepo.search as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const res = await app.request('/knowledge/search?q=nonexistent');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.query).toBe('nonexistent');
    expect(body.count).toBe(0);
    expect(body.results).toEqual([]);
  });

  it('should map result fields correctly', async () => {
    const entry = makeKnowledge({
      id: 'kb-full',
      software: 'redis',
      platform: 'ubuntu-22',
      source: 'community',
      successCount: 42,
      lastUsed: '2026-02-10T10:00:00.000Z',
      createdAt: '2026-01-15T08:00:00.000Z',
      updatedAt: '2026-02-10T10:00:00.000Z',
    });
    (mockKnowledgeRepo.search as ReturnType<typeof vi.fn>).mockResolvedValue([entry]);

    const res = await app.request('/knowledge/search?q=redis');

    expect(res.status).toBe(200);
    const body = await res.json();
    const result = body.results[0];

    expect(result.id).toBe('kb-full');
    expect(result.software).toBe('redis');
    expect(result.platform).toBe('ubuntu-22');
    expect(result.source).toBe('community');
    expect(result.successCount).toBe(42);
    expect(result.lastUsed).toBe('2026-02-10T10:00:00.000Z');
    expect(result.createdAt).toBe('2026-01-15T08:00:00.000Z');
    expect(result.updatedAt).toBe('2026-02-10T10:00:00.000Z');
  });

  it('should return empty when source filter matches nothing', async () => {
    const results = [
      makeKnowledge({ id: 'kb-1', source: 'builtin' }),
    ];
    (mockKnowledgeRepo.search as ReturnType<typeof vi.fn>).mockResolvedValue(results);

    const res = await app.request('/knowledge/search?q=nginx&source=community');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(0);
    expect(body.results).toEqual([]);
  });
});
