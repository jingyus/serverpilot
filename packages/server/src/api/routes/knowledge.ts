// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Knowledge base documentation routes.
 *
 * Provides endpoints for triggering documentation scraping from
 * GitHub repositories and official websites, listing available
 * docs, and checking scrape task status.
 *
 * @module api/routes/knowledge
 */

import { Hono } from 'hono';
import { ScrapeDocBodySchema } from './schemas.js';
import { validateBody } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { logger } from '../../utils/logger.js';
import {
  DocFetcher,
  BUILTIN_SOURCES,
  type DocSource,
} from '../../knowledge/doc-fetcher.js';
import type { GitHubDocSource } from '../../knowledge/github-doc-scraper.js';
import type { WebDocSource } from '../../knowledge/web-doc-scraper.js';
import type { ScrapeDocBody } from './schemas.js';
import type { ApiEnv } from './types.js';
import { getKnowledgeRepository } from '../../db/repositories/knowledge-repository.js';

// ============================================================================
// State
// ============================================================================

let _fetcher: DocFetcher | null = null;

/** Get or create the doc fetcher singleton. */
function getFetcher(): DocFetcher {
  if (!_fetcher) {
    _fetcher = new DocFetcher({
      outputBaseDir: process.env.KNOWLEDGE_BASE_DIR || 'knowledge-base',
      githubToken: process.env.GITHUB_TOKEN,
    });
  }
  return _fetcher;
}

/** Override the fetcher (for testing). */
export function setDocFetcher(fetcher: DocFetcher | null): void {
  _fetcher = fetcher;
}

// ============================================================================
// Routes
// ============================================================================

const knowledge = new Hono<ApiEnv>();

// All knowledge routes require authentication
knowledge.use('*', requireAuth);

// --------------------------------------------------------------------------
// POST /knowledge/scrape — Trigger a documentation scrape
// --------------------------------------------------------------------------

knowledge.post('/scrape', validateBody(ScrapeDocBodySchema), async (c) => {
  const body = c.get('validatedBody') as ScrapeDocBody;
  const fetcher = getFetcher();

  let source: DocSource;

  if (body.type === 'github') {
    const gh = body.source;
    const githubConfig: GitHubDocSource = {
      owner: gh.owner,
      repo: gh.repo,
      branch: gh.branch,
      paths: gh.paths,
      extensions: gh.extensions,
      maxFiles: gh.maxFiles,
    };
    source = {
      id: `github-${gh.owner}-${gh.repo}`,
      type: 'github',
      software: gh.software,
      label: `${gh.owner}/${gh.repo}`,
      github: githubConfig,
    };
  } else {
    const web = body.source;
    const webConfig: WebDocSource = {
      baseUrl: web.baseUrl,
      software: web.software,
      pages: web.pages,
      maxDepth: web.maxDepth,
      maxPages: web.maxPages,
      includePatterns: web.includePatterns,
      excludePatterns: web.excludePatterns,
    };
    source = {
      id: `website-${web.software}`,
      type: 'website',
      software: web.software,
      label: `${web.software} docs`,
      website: webConfig,
    };
  }

  logger.info({ sourceId: source.id, type: body.type }, 'Starting doc scrape');

  const task = await fetcher.fetchSource(source);

  logger.info(
    { taskId: task.id, status: task.status },
    'Doc scrape completed',
  );

  return c.json({ task }, task.status === 'completed' ? 200 : 500);
});

// --------------------------------------------------------------------------
// POST /knowledge/scrape/builtin — Scrape all built-in sources
// --------------------------------------------------------------------------

knowledge.post('/scrape/builtin', async (c) => {
  const fetcher = getFetcher();

  logger.info('Starting built-in sources scrape');

  const summary = await fetcher.fetchBuiltinSources();

  logger.info(
    { succeeded: summary.succeeded, failed: summary.failed },
    'Built-in sources scrape completed',
  );

  return c.json({ summary });
});

// --------------------------------------------------------------------------
// GET /knowledge/sources — List configured documentation sources
// --------------------------------------------------------------------------

knowledge.get('/sources', (c) => {
  return c.json({
    sources: BUILTIN_SOURCES.map((s) => ({
      id: s.id,
      type: s.type,
      software: s.software,
      label: s.label,
    })),
  });
});

// --------------------------------------------------------------------------
// GET /knowledge/docs — List available fetched documentation
// --------------------------------------------------------------------------

knowledge.get('/docs', (c) => {
  const fetcher = getFetcher();
  const docs = fetcher.listAvailableDocs();
  return c.json({ docs });
});

// --------------------------------------------------------------------------
// GET /knowledge/tasks — List fetch tasks
// --------------------------------------------------------------------------

knowledge.get('/tasks', (c) => {
  const fetcher = getFetcher();
  const tasks = fetcher.listTasks();
  return c.json({ tasks });
});

// --------------------------------------------------------------------------
// GET /knowledge/tasks/:taskId — Get a specific fetch task
// --------------------------------------------------------------------------

knowledge.get('/tasks/:taskId', (c) => {
  const fetcher = getFetcher();
  const task = fetcher.getTask(c.req.param('taskId'));
  if (!task) {
    return c.json({ error: 'Task not found' }, 404);
  }
  return c.json({ task });
});

// --------------------------------------------------------------------------
// GET /knowledge/search — Search knowledge base entries
// --------------------------------------------------------------------------

knowledge.get('/search', async (c) => {
  const query = c.req.query('q');
  const source = c.req.query('source') as 'builtin' | 'auto_learn' | 'scrape' | 'community' | undefined;

  if (!query) {
    return c.json({ error: 'Query parameter "q" is required' }, 400);
  }

  logger.info({ query, source }, 'Searching knowledge base');

  const repo = getKnowledgeRepository();

  let results = await repo.search(query);

  // Filter by source if provided
  if (source) {
    results = results.filter((r) => r.source === source);
  }

  logger.info({ query, count: results.length }, 'Knowledge search completed');

  return c.json({
    query,
    count: results.length,
    results: results.map((r) => ({
      id: r.id,
      software: r.software,
      platform: r.platform,
      content: r.content,
      source: r.source,
      successCount: r.successCount,
      lastUsed: r.lastUsed,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    })),
  });
});

export { knowledge };
