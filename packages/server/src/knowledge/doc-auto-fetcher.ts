// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Automated documentation fetcher with scheduling and update detection.
 *
 * Orchestrates periodic fetching of external documentation from configured
 * sources. Integrates with DocSourceRepository, DocFetcher, and update
 * detection to automatically keep the knowledge base current.
 *
 * @module knowledge/doc-auto-fetcher
 */

import path from 'node:path';
import { logger } from '../utils/logger.js';
import { getDocSourceRepository, type DocSource } from '../db/repositories/doc-source-repository.js';
import { DocFetcher } from './doc-fetcher.js';
import { checkGitHubUpdate, checkWebsiteUpdate } from './doc-update-detector.js';
import { DocumentLoader } from './document-loader.js';

// ============================================================================
// Types
// ============================================================================

/** Configuration for the auto-fetcher */
export interface AutoFetcherConfig {
  /** Base directory for storing fetched docs */
  outputBaseDir: string;
  /** GitHub API token (optional) */
  githubToken?: string;
  /** Check interval in milliseconds (default: 1 hour) */
  checkIntervalMs?: number;
  /** Whether to run immediately on start (default: true) */
  runOnStart?: boolean;
  /** Maximum concurrent fetch operations (default: 3) */
  maxConcurrent?: number;
}

/** Result of a fetch operation */
export interface FetchOperationResult {
  sourceId: string;
  sourceName: string;
  success: boolean;
  documentsAdded: number;
  error?: string;
  duration: number;
}

/** Summary of a scheduled fetch run */
export interface FetchRunSummary {
  startTime: Date;
  endTime: Date;
  sourcesChecked: number;
  sourcesUpdated: number;
  sourcesFailed: number;
  totalDocuments: number;
  results: FetchOperationResult[];
}

// ============================================================================
// DocAutoFetcher
// ============================================================================

/**
 * Automated documentation fetcher.
 *
 * Periodically checks for updates to configured documentation sources
 * and fetches new/changed content. Integrates with the repository layer
 * to track fetch history and status.
 */
export class DocAutoFetcher {
  private readonly config: Required<Omit<AutoFetcherConfig, 'githubToken'>> & { githubToken?: string };
  private readonly fetcher: DocFetcher;
  private readonly repository = getDocSourceRepository();
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor(config: AutoFetcherConfig) {
    this.config = {
      checkIntervalMs: 60 * 60 * 1000, // 1 hour
      runOnStart: true,
      maxConcurrent: 3,
      ...config,
    };

    this.fetcher = new DocFetcher({
      outputBaseDir: this.config.outputBaseDir,
      githubToken: this.config.githubToken,
    });
  }

  /**
   * Start the auto-fetcher with periodic checks.
   */
  start(): void {
    if (this.intervalId) {
      logger.warn('DocAutoFetcher already started');
      return;
    }

    logger.info(
      { intervalMs: this.config.checkIntervalMs },
      'Starting DocAutoFetcher',
    );

    if (this.config.runOnStart) {
      // Run immediately in background
      this.runScheduledFetch().catch((err) => {
        logger.error({ error: err }, 'Initial fetch run failed');
      });
    }

    this.intervalId = setInterval(() => {
      this.runScheduledFetch().catch((err) => {
        logger.error({ error: err }, 'Scheduled fetch run failed');
      });
    }, this.config.checkIntervalMs);
  }

  /**
   * Stop the auto-fetcher.
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      logger.info('DocAutoFetcher stopped');
    }
  }

  /**
   * Check if the fetcher is currently running.
   */
  isActive(): boolean {
    return this.intervalId !== null;
  }

  /**
   * Manually trigger a fetch for all auto-update sources.
   */
  async runScheduledFetch(): Promise<FetchRunSummary> {
    if (this.isRunning) {
      logger.warn('Fetch already in progress, skipping');
      throw new Error('Fetch already in progress');
    }

    this.isRunning = true;
    const startTime = new Date();

    try {
      logger.info('Starting scheduled documentation fetch');

      const sources = await this.repository.listAutoUpdateSources();
      const sourcesToUpdate = sources.filter((s) => this.repository.shouldUpdate(s));

      logger.info(
        {
          totalSources: sources.length,
          sourcesToUpdate: sourcesToUpdate.length,
        },
        'Checked sources for updates',
      );

      const results = await this.fetchSources(sourcesToUpdate);

      const endTime = new Date();
      const summary: FetchRunSummary = {
        startTime,
        endTime,
        sourcesChecked: sources.length,
        sourcesUpdated: results.filter((r) => r.success).length,
        sourcesFailed: results.filter((r) => !r.success).length,
        totalDocuments: results.reduce((sum, r) => sum + r.documentsAdded, 0),
        results,
      };

      logger.info(summary, 'Scheduled fetch completed');

      return summary;
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Fetch documentation from a single source.
   */
  async fetchSource(source: DocSource): Promise<FetchOperationResult> {
    const startTime = Date.now();

    logger.info(
      { sourceId: source.id, software: source.software, type: source.type },
      'Fetching documentation source',
    );

    try {
      // Check for updates first
      const updateCheck = await this.checkSourceUpdate(source);

      if (!updateCheck.hasUpdate) {
        logger.info({ sourceId: source.id }, 'No updates detected, skipping fetch');

        // Record no-change history entry
        await this.repository.recordFetchResult(source.id, source.userId, {
          status: 'success',
          documentCount: source.documentCount,
          currentVersion: updateCheck.currentVersion,
          changeType: 'no_change',
        });

        return {
          sourceId: source.id,
          sourceName: source.name,
          success: true,
          documentsAdded: 0,
          duration: Date.now() - startTime,
        };
      }

      // Perform the fetch
      const docSource = this.convertToDocSource(source);
      const task = await this.fetcher.fetchSource(docSource);

      if (task.status === 'failed') {
        await this.repository.recordFetchResult(source.id, source.userId, {
          status: 'failed',
          error: task.error,
          currentVersion: updateCheck.currentVersion,
          changeType: updateCheck.changeType,
        });

        return {
          sourceId: source.id,
          sourceName: source.name,
          success: false,
          documentsAdded: 0,
          error: task.error,
          duration: Date.now() - startTime,
        };
      }

      // Count documents in the output directory
      const outputDir = path.join(
        this.config.outputBaseDir,
        source.software,
        source.type,
      );
      const documentCount = this.countDocuments(outputDir);

      await this.repository.recordFetchResult(source.id, source.userId, {
        status: 'success',
        documentCount,
        currentVersion: updateCheck.currentVersion,
        changeType: updateCheck.changeType,
      });

      logger.info(
        {
          sourceId: source.id,
          documentCount,
          changeType: updateCheck.changeType,
          duration: Date.now() - startTime,
        },
        'Successfully fetched documentation',
      );

      return {
        sourceId: source.id,
        sourceName: source.name,
        success: true,
        documentsAdded: documentCount,
        duration: Date.now() - startTime,
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logger.error({ sourceId: source.id, error: err }, 'Failed to fetch source');

      await this.repository.recordFetchResult(source.id, source.userId, {
        status: 'failed',
        error,
      });

      return {
        sourceId: source.id,
        sourceName: source.name,
        success: false,
        documentsAdded: 0,
        error,
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Fetch multiple sources with concurrency limit.
   */
  private async fetchSources(sources: DocSource[]): Promise<FetchOperationResult[]> {
    const results: FetchOperationResult[] = [];
    const queue = [...sources];

    while (queue.length > 0) {
      const batch = queue.splice(0, this.config.maxConcurrent);
      const batchResults = await Promise.all(batch.map((s) => this.fetchSource(s)));
      results.push(...batchResults);
    }

    return results;
  }

  /**
   * Check if a source has updates available.
   * Returns update check result with version information.
   */
  private async checkSourceUpdate(source: DocSource): Promise<{
    hasUpdate: boolean;
    currentVersion?: string;
    changeType: 'initial' | 'update' | 'no_change';
  }> {
    try {
      if (source.type === 'github' && source.githubConfig) {
        const result = await checkGitHubUpdate({
          owner: source.githubConfig.owner,
          repo: source.githubConfig.repo,
          branch: source.githubConfig.branch ?? 'main',
          previousSha: source.lastSha ?? undefined,
        });

        return {
          hasUpdate: result.hasUpdate,
          currentVersion: result.currentVersion,
          changeType: !source.lastSha ? 'initial' : (result.hasUpdate ? 'update' : 'no_change'),
        };
      }

      if (source.type === 'website' && source.websiteConfig) {
        const result = await checkWebsiteUpdate({
          url: source.websiteConfig.baseUrl,
          previousHash: source.lastHash ?? undefined,
        });

        return {
          hasUpdate: result.hasUpdate,
          currentVersion: result.currentVersion,
          changeType: !source.lastHash ? 'initial' : (result.hasUpdate ? 'update' : 'no_change'),
        };
      }

      // If we can't check, assume update is needed
      return {
        hasUpdate: true,
        changeType: 'initial',
      };
    } catch (err) {
      logger.warn(
        { sourceId: source.id, error: err },
        'Update check failed, will fetch anyway',
      );
      return {
        hasUpdate: true,
        changeType: source.lastSha || source.lastHash ? 'update' : 'initial',
      };
    }
  }

  /**
   * Convert a DocSource to the format expected by DocFetcher.
   */
  private convertToDocSource(source: DocSource) {
    return {
      id: source.id,
      type: source.type,
      software: source.software,
      label: source.name,
      github: source.githubConfig ?? undefined,
      website: source.websiteConfig
        ? { ...source.websiteConfig, software: source.software }
        : undefined,
    };
  }

  /**
   * Count documents in a directory.
   */
  private countDocuments(dir: string): number {
    try {
      const loader = new DocumentLoader({
        baseDir: dir,
        extensions: ['.md'],
      });
      const { summary } = loader.loadAll();
      return summary.loaded;
    } catch {
      return 0;
    }
  }
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create and configure a DocAutoFetcher for the project.
 */
export function createDocAutoFetcher(
  projectRoot: string,
  config?: Partial<AutoFetcherConfig>,
): DocAutoFetcher {
  return new DocAutoFetcher({
    outputBaseDir: path.join(projectRoot, 'knowledge-base'),
    ...config,
  });
}
