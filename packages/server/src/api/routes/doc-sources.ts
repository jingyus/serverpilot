// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * API routes for managing documentation sources.
 *
 * Provides endpoints for CRUD operations on doc sources, manual fetch
 * triggering, and viewing fetch history/status.
 *
 * @module api/routes/doc-sources
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { getDocSourceRepository } from '../../db/repositories/doc-source-repository.js';
import type { CreateDocSourceData, UpdateDocSourceData } from '../../db/repositories/doc-source-repository.js';
import { DocFetcher } from '../../knowledge/doc-fetcher.js';
import type { DocSource as FetcherDocSource } from '../../knowledge/doc-fetcher.js';
import type { ApiEnv } from './types.js';

// ============================================================================
// Schemas
// ============================================================================

const GitHubConfigSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  branch: z.string().optional(),
  paths: z.array(z.string()).optional(),
  extensions: z.array(z.string()).optional(),
  maxFiles: z.number().int().positive().optional(),
});

const WebsiteConfigSchema = z.object({
  baseUrl: z.string().url(),
  pages: z.array(z.string().url()).optional(),
  maxDepth: z.number().int().positive().optional(),
  maxPages: z.number().int().positive().optional(),
  includePatterns: z.array(z.string()).optional(),
  excludePatterns: z.array(z.string()).optional(),
});

const CreateDocSourceSchema = z.object({
  name: z.string().min(1).max(100),
  software: z.string().min(1).max(50),
  type: z.enum(['github', 'website']),
  githubConfig: GitHubConfigSchema.optional(),
  websiteConfig: WebsiteConfigSchema.optional(),
  enabled: z.boolean().optional(),
  autoUpdate: z.boolean().optional(),
  updateFrequencyHours: z.number().int().positive().optional(),
});

const UpdateDocSourceSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  enabled: z.boolean().optional(),
  autoUpdate: z.boolean().optional(),
  updateFrequencyHours: z.number().int().positive().optional(),
  githubConfig: GitHubConfigSchema.optional(),
  websiteConfig: WebsiteConfigSchema.optional(),
});

// ============================================================================
// Routes
// ============================================================================

const app = new Hono<ApiEnv>();

/**
 * List all doc sources for the authenticated user.
 */
app.get('/', requireAuth, async (c) => {
  const userId = c.get('userId');
  const repository = getDocSourceRepository();

  const sources = await repository.listByUserId(userId);

  return c.json({
    sources: sources.map((s) => ({
      id: s.id,
      name: s.name,
      software: s.software,
      type: s.type,
      enabled: s.enabled,
      autoUpdate: s.autoUpdate,
      updateFrequencyHours: s.updateFrequencyHours,
      lastFetchedAt: s.lastFetchedAt,
      lastFetchStatus: s.lastFetchStatus,
      documentCount: s.documentCount,
      createdAt: s.createdAt,
    })),
  });
});

/**
 * Get a single doc source by ID.
 */
app.get('/:id', requireAuth, async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const repository = getDocSourceRepository();

  const source = await repository.findById(id, userId);

  if (!source) {
    return c.json({ error: 'Doc source not found' }, 404);
  }

  return c.json({ source });
});

/**
 * Create a new doc source.
 */
app.post('/', requireAuth, validateBody(CreateDocSourceSchema), async (c) => {
  const userId = c.get('userId');
  const data = c.get('validatedBody') as z.infer<typeof CreateDocSourceSchema>;
  const repository = getDocSourceRepository();

  // Validate that the appropriate config is provided
  if (data.type === 'github' && !data.githubConfig) {
    return c.json({ error: 'githubConfig is required for github type' }, 400);
  }
  if (data.type === 'website' && !data.websiteConfig) {
    return c.json({ error: 'websiteConfig is required for website type' }, 400);
  }

  const source = await repository.create({
    userId,
    ...data,
  } as CreateDocSourceData);

  return c.json({ source }, 201);
});

/**
 * Update an existing doc source.
 */
app.patch('/:id', requireAuth, validateBody(UpdateDocSourceSchema), async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const data = c.get('validatedBody') as UpdateDocSourceData;
  const repository = getDocSourceRepository();

  const source = await repository.update(id, userId, data);

  if (!source) {
    return c.json({ error: 'Doc source not found' }, 404);
  }

  return c.json({ source });
});

/**
 * Delete a doc source.
 */
app.delete('/:id', requireAuth, async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const repository = getDocSourceRepository();

  const deleted = await repository.delete(id, userId);

  if (!deleted) {
    return c.json({ error: 'Doc source not found' }, 404);
  }

  return c.json({ success: true });
});

/**
 * Manually trigger a fetch for a specific doc source.
 */
app.post('/:id/fetch', requireAuth, async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const repository = getDocSourceRepository();

  const source = await repository.findById(id, userId);

  if (!source) {
    return c.json({ error: 'Doc source not found' }, 404);
  }

  if (!source.enabled) {
    return c.json({ error: 'Doc source is disabled' }, 400);
  }

  // Create a fetcher and trigger the fetch
  const fetcher = new DocFetcher({
    outputBaseDir: './knowledge-base',
  });

  try {
    const docSource: FetcherDocSource = {
      id: source.id,
      type: source.type,
      software: source.software,
      label: source.name,
      github: source.githubConfig ?? undefined,
      website: source.websiteConfig
        ? { ...source.websiteConfig, software: source.software }
        : undefined,
    };

    const task = await fetcher.fetchSource(docSource);

    if (task.status === 'failed') {
      await repository.recordFetchResult(id, userId, {
        status: 'failed',
        error: task.error,
      });

      return c.json({ error: task.error, task }, 500);
    }

    // Count documents
    const documentCount = task.summary
      ? 'succeeded' in task.summary
        ? task.summary.succeeded
        : 0
      : 0;

    await repository.recordFetchResult(id, userId, {
      status: 'success',
      documentCount,
    });

    return c.json({
      success: true,
      task: {
        id: task.id,
        status: task.status,
        summary: task.summary,
      },
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await repository.recordFetchResult(id, userId, {
      status: 'failed',
      error,
    });

    return c.json({ error }, 500);
  }
});

/**
 * Get fetch history/status for a doc source.
 */
app.get('/:id/status', requireAuth, async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const repository = getDocSourceRepository();

  const source = await repository.findById(id, userId);

  if (!source) {
    return c.json({ error: 'Doc source not found' }, 404);
  }

  return c.json({
    status: {
      lastFetchedAt: source.lastFetchedAt,
      lastFetchStatus: source.lastFetchStatus,
      lastFetchError: source.lastFetchError,
      documentCount: source.documentCount,
      shouldUpdate: repository.shouldUpdate(source),
    },
  });
});

export default app;
