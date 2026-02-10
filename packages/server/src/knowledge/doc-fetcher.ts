/**
 * Unified documentation fetcher orchestrator.
 *
 * Provides a single interface for scraping documentation from multiple
 * source types (GitHub repos, official websites) and persisting results
 * to the knowledge base (file system + database).
 *
 * @module knowledge/doc-fetcher
 */

import path from 'node:path';
import { existsSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

import {
  scrapeGitHubDocs,
  type GitHubDocSource,
  type GitHubFetchOptions,
  type GitHubScrapeSummary,
} from './github-doc-scraper.js';
import {
  scrapeWebDocs,
  type WebDocSource,
  type WebFetchOptions,
  type WebScrapeSummary,
} from './web-doc-scraper.js';

// ============================================================================
// Types
// ============================================================================

/** Source type discriminator */
export type DocSourceType = 'github' | 'website';

/** A documentation source configuration */
export interface DocSource {
  /** Unique identifier for this source */
  id: string;
  /** Source type */
  type: DocSourceType;
  /** Software name for categorization */
  software: string;
  /** Human-readable label */
  label: string;
  /** GitHub-specific config (when type === 'github') */
  github?: GitHubDocSource;
  /** Website-specific config (when type === 'website') */
  website?: WebDocSource;
}

/** Status of a fetch task */
export type FetchTaskStatus = 'pending' | 'running' | 'completed' | 'failed';

/** A fetch task record */
export interface FetchTask {
  /** Unique task ID */
  id: string;
  /** Source being fetched */
  sourceId: string;
  /** Current status */
  status: FetchTaskStatus;
  /** When the task started */
  startedAt: string;
  /** When the task completed */
  completedAt?: string;
  /** Summary data (populated on completion) */
  summary?: GitHubScrapeSummary | WebScrapeSummary;
  /** Error message if failed */
  error?: string;
}

/** Options for the doc fetcher */
export interface DocFetcherOptions {
  /** Base directory for storing fetched docs */
  outputBaseDir: string;
  /** GitHub API token (optional) */
  githubToken?: string;
  /** Custom fetch function (for testing) */
  fetchFn?: typeof fetch;
  /** Request timeout in ms */
  timeoutMs?: number;
}

/** Summary of a fetch operation across all sources */
export interface FetchAllSummary {
  /** Total sources processed */
  totalSources: number;
  /** Sources that succeeded */
  succeeded: number;
  /** Sources that failed */
  failed: number;
  /** Per-source results */
  tasks: FetchTask[];
}

// ============================================================================
// Built-in Sources
// ============================================================================

/**
 * Pre-configured documentation sources for common DevOps software.
 */
export const BUILTIN_SOURCES: DocSource[] = [
  {
    id: 'nginx-github',
    type: 'github',
    software: 'nginx',
    label: 'Nginx GitHub Docs',
    github: {
      owner: 'nginx',
      repo: 'nginx',
      branch: 'master',
      paths: ['docs/', 'README'],
      extensions: ['.md', '.txt', '.rst'],
      maxFiles: 20,
    },
  },
  {
    id: 'redis-github',
    type: 'github',
    software: 'redis',
    label: 'Redis GitHub Docs',
    github: {
      owner: 'redis',
      repo: 'redis',
      branch: 'unstable',
      paths: ['README.md', 'CONTRIBUTING.md'],
      extensions: ['.md'],
      maxFiles: 10,
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
      pages: [
        'https://docs.docker.com/get-started/',
        'https://docs.docker.com/get-started/docker-concepts/the-basics/what-is-a-container/',
        'https://docs.docker.com/get-started/docker-concepts/the-basics/what-is-an-image/',
      ],
      maxPages: 10,
    },
  },
  {
    id: 'nodejs-github',
    type: 'github',
    software: 'nodejs',
    label: 'Node.js GitHub Docs',
    github: {
      owner: 'nodejs',
      repo: 'node',
      branch: 'main',
      paths: ['doc/api/'],
      extensions: ['.md'],
      maxFiles: 30,
    },
  },
];

// ============================================================================
// DocFetcher
// ============================================================================

/**
 * Unified documentation fetcher.
 *
 * Manages scraping tasks across multiple source types and coordinates
 * output to the knowledge base directory structure.
 */
export class DocFetcher {
  private readonly outputBaseDir: string;
  private readonly githubToken?: string;
  private readonly fetchFn?: typeof fetch;
  private readonly timeoutMs: number;
  private readonly tasks: Map<string, FetchTask> = new Map();

  constructor(options: DocFetcherOptions) {
    this.outputBaseDir = path.resolve(options.outputBaseDir);
    this.githubToken = options.githubToken;
    this.fetchFn = options.fetchFn;
    this.timeoutMs = options.timeoutMs ?? 30000;
  }

  /**
   * Fetch documentation from a single source.
   */
  async fetchSource(source: DocSource): Promise<FetchTask> {
    const task: FetchTask = {
      id: randomUUID(),
      sourceId: source.id,
      status: 'running',
      startedAt: new Date().toISOString(),
    };
    this.tasks.set(task.id, task);

    const outputDir = path.join(this.outputBaseDir, source.software, source.type);

    try {
      if (source.type === 'github' && source.github) {
        const summary = await scrapeGitHubDocs(source.github, outputDir, {
          fetchFn: this.fetchFn,
          token: this.githubToken,
          timeoutMs: this.timeoutMs,
        });
        task.status = 'completed';
        task.summary = summary;
      } else if (source.type === 'website' && source.website) {
        const summary = await scrapeWebDocs(source.website, outputDir, {
          fetchFn: this.fetchFn,
          timeoutMs: this.timeoutMs,
          requestDelayMs: 100,
        });
        task.status = 'completed';
        task.summary = summary;
      } else {
        throw new Error(`Invalid source configuration: missing ${source.type} config`);
      }
    } catch (err) {
      task.status = 'failed';
      task.error = err instanceof Error ? err.message : String(err);
    }

    task.completedAt = new Date().toISOString();
    this.tasks.set(task.id, task);
    return task;
  }

  /**
   * Fetch documentation from multiple sources.
   */
  async fetchAll(sources: DocSource[]): Promise<FetchAllSummary> {
    const tasks: FetchTask[] = [];

    for (const source of sources) {
      const task = await this.fetchSource(source);
      tasks.push(task);
    }

    const succeeded = tasks.filter((t) => t.status === 'completed').length;

    return {
      totalSources: sources.length,
      succeeded,
      failed: sources.length - succeeded,
      tasks,
    };
  }

  /**
   * Fetch all built-in documentation sources.
   */
  async fetchBuiltinSources(): Promise<FetchAllSummary> {
    return this.fetchAll(BUILTIN_SOURCES);
  }

  /**
   * Get a task by ID.
   */
  getTask(taskId: string): FetchTask | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * List all tasks.
   */
  listTasks(): FetchTask[] {
    return [...this.tasks.values()];
  }

  /**
   * List available documentation in the output directory.
   */
  listAvailableDocs(): Array<{ software: string; type: string; files: string[] }> {
    const result: Array<{ software: string; type: string; files: string[] }> = [];

    if (!existsSync(this.outputBaseDir)) return result;

    try {
      const softwareDirs = readdirSync(this.outputBaseDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);

      for (const software of softwareDirs) {
        const softwarePath = path.join(this.outputBaseDir, software);
        const typeDirs = readdirSync(softwarePath, { withFileTypes: true })
          .filter((d) => d.isDirectory())
          .map((d) => d.name);

        for (const type of typeDirs) {
          const typePath = path.join(softwarePath, type);
          const files = readdirSync(typePath)
            .filter((f) => f.endsWith('.md'));
          if (files.length > 0) {
            result.push({ software, type, files });
          }
        }
      }
    } catch {
      // Directory doesn't exist or isn't readable
    }

    return result;
  }
}

/**
 * Create a DocFetcher with default settings for the project.
 */
export function createDocFetcher(
  projectRoot: string,
  options?: Partial<DocFetcherOptions>,
): DocFetcher {
  return new DocFetcher({
    outputBaseDir: path.join(projectRoot, 'knowledge-base'),
    ...options,
  });
}
