// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for doc-sources API routes.
 *
 * Validates CRUD operations, manual fetch triggers,
 * status queries, authentication, and input validation.
 *
 * @module api/routes/doc-sources.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { ApiEnv } from './types.js';
import { onError } from '../middleware/error-handler.js';

// ============================================================================
// Mocks
// ============================================================================

vi.mock('../../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const mockDocSourceRepo = {
  create: vi.fn(),
  findById: vi.fn(),
  listByUserId: vi.fn(),
  listEnabledByUserId: vi.fn(),
  listAutoUpdateSources: vi.fn(),
  findBySoftware: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  recordFetchResult: vi.fn(),
  shouldUpdate: vi.fn(),
};

vi.mock('../../db/repositories/doc-source-repository.js', () => ({
  getDocSourceRepository: () => mockDocSourceRepo,
}));

const mockFetchSource = vi.fn();

vi.mock('../../knowledge/doc-fetcher.js', () => ({
  DocFetcher: vi.fn().mockImplementation(() => ({
    fetchSource: mockFetchSource,
  })),
}));

// Mock auth middleware to inject userId
vi.mock('../middleware/auth.js', () => ({
  requireAuth: async (c: any, next: any) => {
    c.set('userId', 'test-user-id');
    await next();
  },
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
  requireRole: vi.fn(() => {
    return async (_c: unknown, next: () => Promise<void>) => {
      await next();
    };
  }),
}));

// Dynamic import after mocks
const { default: docSourcesApp } = await import('./doc-sources.js');

// ============================================================================
// Helpers
// ============================================================================

function createTestApp() {
  const app = new Hono<ApiEnv>();
  app.onError(onError);
  app.route('/doc-sources', docSourcesApp);
  return app;
}

function jsonRequest(
  app: Hono<ApiEnv>,
  path: string,
  method: string,
  body?: unknown,
) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  return app.request(path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
}

const MOCK_DOC_SOURCE = {
  id: 'ds-1',
  userId: 'test-user-id',
  name: 'Nginx Docs',
  software: 'nginx',
  type: 'github' as const,
  githubConfig: { owner: 'nginx', repo: 'nginx', branch: 'master' },
  websiteConfig: null,
  enabled: true,
  autoUpdate: false,
  updateFrequencyHours: 168,
  lastFetchedAt: null,
  lastFetchStatus: null,
  lastFetchError: null,
  documentCount: 0,
  lastSha: null,
  lastHash: null,
  lastUpdateTime: null,
  createdAt: new Date('2025-01-01'),
  updatedAt: new Date('2025-01-01'),
};

// ============================================================================
// Setup / Teardown
// ============================================================================

beforeEach(() => {
  vi.clearAllMocks();
});

// ============================================================================
// Tests
// ============================================================================

describe('GET /doc-sources', () => {
  it('returns empty list when no sources exist', async () => {
    mockDocSourceRepo.listByUserId.mockResolvedValue([]);
    const app = createTestApp();
    const res = await app.request('/doc-sources');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sources).toEqual([]);
    expect(mockDocSourceRepo.listByUserId).toHaveBeenCalledWith('test-user-id');
  });

  it('returns list of sources', async () => {
    mockDocSourceRepo.listByUserId.mockResolvedValue([MOCK_DOC_SOURCE]);
    const app = createTestApp();
    const res = await app.request('/doc-sources');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sources).toHaveLength(1);
    expect(body.sources[0].name).toBe('Nginx Docs');
    expect(body.sources[0].software).toBe('nginx');
    expect(body.sources[0].type).toBe('github');
  });
});

describe('GET /doc-sources/:id', () => {
  it('returns 404 for non-existent source', async () => {
    mockDocSourceRepo.findById.mockResolvedValue(null);
    const app = createTestApp();
    const res = await app.request('/doc-sources/nonexistent');

    expect(res.status).toBe(404);
  });

  it('returns source details', async () => {
    mockDocSourceRepo.findById.mockResolvedValue(MOCK_DOC_SOURCE);
    const app = createTestApp();
    const res = await app.request('/doc-sources/ds-1');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.source.name).toBe('Nginx Docs');
    expect(mockDocSourceRepo.findById).toHaveBeenCalledWith('ds-1', 'test-user-id');
  });
});

describe('POST /doc-sources', () => {
  it('creates a GitHub doc source', async () => {
    mockDocSourceRepo.create.mockResolvedValue({ ...MOCK_DOC_SOURCE, id: 'new-id' });
    const app = createTestApp();

    const res = await jsonRequest(app, '/doc-sources', 'POST', {
      name: 'Nginx Docs',
      software: 'nginx',
      type: 'github',
      githubConfig: { owner: 'nginx', repo: 'nginx' },
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.source.name).toBe('Nginx Docs');
    expect(mockDocSourceRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'test-user-id',
        name: 'Nginx Docs',
        software: 'nginx',
        type: 'github',
      }),
    );
  });

  it('creates a website doc source', async () => {
    const webSource = {
      ...MOCK_DOC_SOURCE,
      id: 'ws-1',
      type: 'website' as const,
      githubConfig: null,
      websiteConfig: { baseUrl: 'https://docs.docker.com' },
    };
    mockDocSourceRepo.create.mockResolvedValue(webSource);
    const app = createTestApp();

    const res = await jsonRequest(app, '/doc-sources', 'POST', {
      name: 'Docker Docs',
      software: 'docker',
      type: 'website',
      websiteConfig: { baseUrl: 'https://docs.docker.com' },
    });

    expect(res.status).toBe(201);
  });

  it('returns 400 when github type missing githubConfig', async () => {
    const app = createTestApp();

    const res = await jsonRequest(app, '/doc-sources', 'POST', {
      name: 'Bad Source',
      software: 'nginx',
      type: 'github',
    });

    expect(res.status).toBe(400);
  });

  it('returns 400 when website type missing websiteConfig', async () => {
    const app = createTestApp();

    const res = await jsonRequest(app, '/doc-sources', 'POST', {
      name: 'Bad Source',
      software: 'docker',
      type: 'website',
    });

    expect(res.status).toBe(400);
  });

  it('validates required fields', async () => {
    const app = createTestApp();

    const res = await jsonRequest(app, '/doc-sources', 'POST', {});

    expect(res.status).toBe(400);
  });
});

describe('PATCH /doc-sources/:id', () => {
  it('updates a doc source', async () => {
    const updated = { ...MOCK_DOC_SOURCE, name: 'Updated Name' };
    mockDocSourceRepo.update.mockResolvedValue(updated);
    const app = createTestApp();

    const res = await jsonRequest(app, '/doc-sources/ds-1', 'PATCH', {
      name: 'Updated Name',
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.source.name).toBe('Updated Name');
    expect(mockDocSourceRepo.update).toHaveBeenCalledWith(
      'ds-1',
      'test-user-id',
      expect.objectContaining({ name: 'Updated Name' }),
    );
  });

  it('returns 404 for non-existent source', async () => {
    mockDocSourceRepo.update.mockResolvedValue(null);
    const app = createTestApp();

    const res = await jsonRequest(app, '/doc-sources/bad-id', 'PATCH', {
      name: 'Updated',
    });

    expect(res.status).toBe(404);
  });
});

describe('DELETE /doc-sources/:id', () => {
  it('deletes a doc source', async () => {
    mockDocSourceRepo.delete.mockResolvedValue(true);
    const app = createTestApp();

    const res = await app.request('/doc-sources/ds-1', { method: 'DELETE' });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it('returns 404 for non-existent source', async () => {
    mockDocSourceRepo.delete.mockResolvedValue(false);
    const app = createTestApp();

    const res = await app.request('/doc-sources/bad-id', { method: 'DELETE' });

    expect(res.status).toBe(404);
  });
});

describe('POST /doc-sources/:id/fetch', () => {
  it('triggers fetch for an enabled source', async () => {
    mockDocSourceRepo.findById.mockResolvedValue(MOCK_DOC_SOURCE);
    mockFetchSource.mockResolvedValue({
      id: 'task-1',
      status: 'completed',
      summary: { succeeded: 5 },
    });
    mockDocSourceRepo.recordFetchResult.mockResolvedValue(MOCK_DOC_SOURCE);

    const app = createTestApp();
    const res = await app.request('/doc-sources/ds-1/fetch', { method: 'POST' });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.task.status).toBe('completed');
  });

  it('returns 404 for non-existent source', async () => {
    mockDocSourceRepo.findById.mockResolvedValue(null);
    const app = createTestApp();

    const res = await app.request('/doc-sources/bad-id/fetch', { method: 'POST' });

    expect(res.status).toBe(404);
  });

  it('returns 400 for disabled source', async () => {
    mockDocSourceRepo.findById.mockResolvedValue({
      ...MOCK_DOC_SOURCE,
      enabled: false,
    });
    const app = createTestApp();

    const res = await app.request('/doc-sources/ds-1/fetch', { method: 'POST' });

    expect(res.status).toBe(400);
  });

  it('handles fetch failure', async () => {
    mockDocSourceRepo.findById.mockResolvedValue(MOCK_DOC_SOURCE);
    mockFetchSource.mockResolvedValue({
      id: 'task-1',
      status: 'failed',
      error: 'Network timeout',
    });
    mockDocSourceRepo.recordFetchResult.mockResolvedValue(MOCK_DOC_SOURCE);

    const app = createTestApp();
    const res = await app.request('/doc-sources/ds-1/fetch', { method: 'POST' });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('Network timeout');
  });

  it('handles fetch exception', async () => {
    mockDocSourceRepo.findById.mockResolvedValue(MOCK_DOC_SOURCE);
    mockFetchSource.mockRejectedValue(new Error('Connection refused'));
    mockDocSourceRepo.recordFetchResult.mockResolvedValue(MOCK_DOC_SOURCE);

    const app = createTestApp();
    const res = await app.request('/doc-sources/ds-1/fetch', { method: 'POST' });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('Connection refused');
  });
});

describe('GET /doc-sources/:id/status', () => {
  it('returns fetch status', async () => {
    mockDocSourceRepo.findById.mockResolvedValue({
      ...MOCK_DOC_SOURCE,
      lastFetchedAt: new Date('2025-01-15'),
      lastFetchStatus: 'success',
      documentCount: 10,
    });
    mockDocSourceRepo.shouldUpdate.mockReturnValue(false);

    const app = createTestApp();
    const res = await app.request('/doc-sources/ds-1/status');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status.lastFetchStatus).toBe('success');
    expect(body.status.documentCount).toBe(10);
    expect(body.status.shouldUpdate).toBe(false);
  });

  it('returns 404 for non-existent source', async () => {
    mockDocSourceRepo.findById.mockResolvedValue(null);
    const app = createTestApp();

    const res = await app.request('/doc-sources/bad-id/status');

    expect(res.status).toBe(404);
  });
});
