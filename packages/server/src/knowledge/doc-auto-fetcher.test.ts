/**
 * Tests for the automated documentation fetcher module.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  DocAutoFetcher,
  createDocAutoFetcher,
  type AutoFetcherConfig,
  type FetchRunSummary,
} from './doc-auto-fetcher.js';
import { DocFetcher, type DocSource, type FetchTask } from './doc-fetcher.js';
import type { DocSource as RepoDocSource } from '../db/repositories/doc-source-repository.js';

// ============================================================================
// Mocks
// ============================================================================

// Mock logger to avoid noise in tests
vi.mock('../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock repository
const mockRepository = {
  listAutoUpdateSources: vi.fn(),
  shouldUpdate: vi.fn(),
  recordFetchResult: vi.fn(),
};

vi.mock('../db/repositories/doc-source-repository.js', () => ({
  getDocSourceRepository: () => mockRepository,
}));

// Mock doc-update-detector
vi.mock('./doc-update-detector.js', () => ({
  checkGitHubUpdate: vi.fn(),
  checkWebsiteUpdate: vi.fn(),
}));

import { checkGitHubUpdate, checkWebsiteUpdate } from './doc-update-detector.js';

// ============================================================================
// Helpers
// ============================================================================

function createMockDocSource(overrides?: Partial<RepoDocSource>): RepoDocSource {
  const base: RepoDocSource = {
    id: 'test-source-id',
    userId: 'test-user',
    name: 'Test Source',
    software: 'nginx',
    type: 'github',
    githubConfig: {
      owner: 'nginx',
      repo: 'nginx',
      branch: 'master',
      paths: ['docs/'],
      extensions: ['.md'],
      maxFiles: 10,
    },
    websiteConfig: null,
    enabled: true,
    autoUpdate: true,
    updateFrequencyHours: 168,
    lastFetchedAt: null,
    lastFetchStatus: null,
    lastFetchError: null,
    documentCount: 0,
    lastSha: null,
    lastHash: null,
    lastUpdateTime: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  return { ...base, ...overrides };
}

function createTmpDir(): string {
  return path.join(
    os.tmpdir(),
    `doc-auto-fetcher-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
}

function setupMockDocuments(dir: string, software: string, type: string, count: number): void {
  const targetDir = path.join(dir, software, type);
  mkdirSync(targetDir, { recursive: true });
  for (let i = 0; i < count; i++) {
    writeFileSync(path.join(targetDir, `doc-${i}.md`), `# Document ${i}\n\nContent here.`);
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('DocAutoFetcher', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTmpDir();
    vi.clearAllMocks();
    mockRepository.listAutoUpdateSources.mockResolvedValue([]);
    mockRepository.shouldUpdate.mockReturnValue(true);
    mockRepository.recordFetchResult.mockResolvedValue(null);
  });

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // --------------------------------------------------------------------------
  // Initialization
  // --------------------------------------------------------------------------

  describe('initialization', () => {
    it('should initialize with required config', () => {
      const fetcher = new DocAutoFetcher({
        outputBaseDir: tmpDir,
      });

      expect(fetcher).toBeDefined();
      expect(fetcher.isActive()).toBe(false);
    });

    it('should accept optional configuration', () => {
      const fetcher = new DocAutoFetcher({
        outputBaseDir: tmpDir,
        githubToken: 'test-token',
        checkIntervalMs: 30000,
        runOnStart: false,
        maxConcurrent: 5,
      });

      expect(fetcher).toBeDefined();
    });

    it('should use default values for optional config', () => {
      const fetcher = new DocAutoFetcher({
        outputBaseDir: tmpDir,
      });

      expect(fetcher).toBeDefined();
      // Verify defaults by checking behavior
      expect(fetcher.isActive()).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // Start/Stop
  // --------------------------------------------------------------------------

  describe('start and stop', () => {
    it('should start the auto-fetcher', () => {
      const fetcher = new DocAutoFetcher({
        outputBaseDir: tmpDir,
        runOnStart: false,
      });

      fetcher.start();
      expect(fetcher.isActive()).toBe(true);
    });

    it('should stop the auto-fetcher', () => {
      const fetcher = new DocAutoFetcher({
        outputBaseDir: tmpDir,
        runOnStart: false,
      });

      fetcher.start();
      expect(fetcher.isActive()).toBe(true);

      fetcher.stop();
      expect(fetcher.isActive()).toBe(false);
    });

    it('should not start twice', () => {
      const fetcher = new DocAutoFetcher({
        outputBaseDir: tmpDir,
        runOnStart: false,
      });

      fetcher.start();
      const firstActive = fetcher.isActive();
      fetcher.start(); // Second start
      const stillActive = fetcher.isActive();

      expect(firstActive).toBe(true);
      expect(stillActive).toBe(true);
    });

    it('should handle stop when not started', () => {
      const fetcher = new DocAutoFetcher({
        outputBaseDir: tmpDir,
        runOnStart: false,
      });

      fetcher.stop(); // No error
      expect(fetcher.isActive()).toBe(false);
    });

    it('should run immediately on start when runOnStart is true', async () => {
      mockRepository.listAutoUpdateSources.mockResolvedValue([]);

      const fetcher = new DocAutoFetcher({
        outputBaseDir: tmpDir,
        runOnStart: true,
        checkIntervalMs: 100000, // Long interval
      });

      fetcher.start();

      // Wait a bit for the immediate run to trigger
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockRepository.listAutoUpdateSources).toHaveBeenCalled();

      fetcher.stop();
    });

    it('should schedule periodic checks', async () => {
      mockRepository.listAutoUpdateSources.mockResolvedValue([]);

      const fetcher = new DocAutoFetcher({
        outputBaseDir: tmpDir,
        runOnStart: false,
        checkIntervalMs: 100, // Very short interval for testing
      });

      fetcher.start();

      // Wait for multiple intervals
      await new Promise((resolve) => setTimeout(resolve, 350));

      fetcher.stop();

      // Should have been called multiple times
      expect(mockRepository.listAutoUpdateSources.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  // --------------------------------------------------------------------------
  // Scheduled Fetch
  // --------------------------------------------------------------------------

  describe('runScheduledFetch', () => {
    it('should fetch sources marked for update', async () => {
      const source = createMockDocSource();
      mockRepository.listAutoUpdateSources.mockResolvedValue([source]);
      mockRepository.shouldUpdate.mockReturnValue(true);

      vi.mocked(checkGitHubUpdate).mockResolvedValue({
        hasUpdate: true,
        currentVersion: 'abc123',
        reason: 'New commits detected',
      });

      // Mock DocFetcher
      vi.spyOn(DocFetcher.prototype, 'fetchSource').mockResolvedValue({
        id: 'task-id',
        sourceId: source.id,
        status: 'completed',
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        summary: {
          software: 'nginx',
          totalFiles: 5,
          fetchedFiles: 5,
          skippedFiles: 0,
          savedFiles: 5,
          errors: [],
          fileDetails: [],
        },
      } as FetchTask);

      setupMockDocuments(tmpDir, 'nginx', 'github', 5);

      const fetcher = new DocAutoFetcher({
        outputBaseDir: tmpDir,
        runOnStart: false,
      });

      const summary = await fetcher.runScheduledFetch();

      expect(summary.sourcesChecked).toBe(1);
      expect(summary.sourcesUpdated).toBe(1);
      expect(summary.sourcesFailed).toBe(0);
      expect(mockRepository.recordFetchResult).toHaveBeenCalledWith(
        source.id,
        source.userId,
        expect.objectContaining({ status: 'success' }),
      );
    });

    it('should skip sources not marked for update', async () => {
      const source = createMockDocSource();
      mockRepository.listAutoUpdateSources.mockResolvedValue([source]);
      mockRepository.shouldUpdate.mockReturnValue(false); // Should not update

      const fetcher = new DocAutoFetcher({
        outputBaseDir: tmpDir,
        runOnStart: false,
      });

      const summary = await fetcher.runScheduledFetch();

      expect(summary.sourcesChecked).toBe(1);
      expect(summary.sourcesUpdated).toBe(0);
      expect(summary.totalDocuments).toBe(0);
    });

    it('should prevent concurrent fetch runs', async () => {
      mockRepository.listAutoUpdateSources.mockResolvedValue([]);

      const fetcher = new DocAutoFetcher({
        outputBaseDir: tmpDir,
        runOnStart: false,
      });

      // Start first fetch (will take some time)
      const firstFetch = fetcher.runScheduledFetch();

      // Try to start second fetch immediately
      await expect(fetcher.runScheduledFetch()).rejects.toThrow('Fetch already in progress');

      // Wait for first to complete
      await firstFetch;
    });

    it('should generate summary with correct statistics', async () => {
      const sources = [
        createMockDocSource({ id: 'source-1', software: 'nginx' }),
        createMockDocSource({ id: 'source-2', software: 'redis', type: 'website' }),
      ];

      mockRepository.listAutoUpdateSources.mockResolvedValue(sources);
      mockRepository.shouldUpdate.mockReturnValue(true);

      vi.mocked(checkGitHubUpdate).mockResolvedValue({ hasUpdate: true });
      vi.mocked(checkWebsiteUpdate).mockResolvedValue({ hasUpdate: true });

      vi.spyOn(DocFetcher.prototype, 'fetchSource').mockResolvedValue({
        id: 'task-id',
        sourceId: 'test',
        status: 'completed',
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      } as FetchTask);

      setupMockDocuments(tmpDir, 'nginx', 'github', 3);
      setupMockDocuments(tmpDir, 'redis', 'website', 2);

      const fetcher = new DocAutoFetcher({
        outputBaseDir: tmpDir,
        runOnStart: false,
      });

      const summary = await fetcher.runScheduledFetch();

      expect(summary.sourcesChecked).toBe(2);
      expect(summary.startTime).toBeInstanceOf(Date);
      expect(summary.endTime).toBeInstanceOf(Date);
      expect(summary.endTime.getTime()).toBeGreaterThanOrEqual(summary.startTime.getTime());
    });
  });

  // --------------------------------------------------------------------------
  // Single Source Fetch
  // --------------------------------------------------------------------------

  describe('fetchSource', () => {
    it('should fetch a GitHub source successfully', async () => {
      const source = createMockDocSource();

      vi.mocked(checkGitHubUpdate).mockResolvedValue({
        hasUpdate: true,
        currentVersion: 'abc123',
      });

      vi.spyOn(DocFetcher.prototype, 'fetchSource').mockResolvedValue({
        id: 'task-id',
        sourceId: source.id,
        status: 'completed',
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      } as FetchTask);

      setupMockDocuments(tmpDir, 'nginx', 'github', 5);

      const fetcher = new DocAutoFetcher({
        outputBaseDir: tmpDir,
      });

      const result = await fetcher.fetchSource(source);

      expect(result.success).toBe(true);
      expect(result.sourceId).toBe(source.id);
      expect(result.documentsAdded).toBe(5);
      expect(result.error).toBeUndefined();
    });

    it('should skip fetch when no updates detected', async () => {
      const source = createMockDocSource();

      vi.mocked(checkGitHubUpdate).mockResolvedValue({
        hasUpdate: false,
        reason: 'No new commits',
      });

      const fetcher = new DocAutoFetcher({
        outputBaseDir: tmpDir,
      });

      const result = await fetcher.fetchSource(source);

      expect(result.success).toBe(true);
      expect(result.documentsAdded).toBe(0);
    });

    it('should handle fetch failure', async () => {
      const source = createMockDocSource();

      vi.mocked(checkGitHubUpdate).mockResolvedValue({ hasUpdate: true });

      vi.spyOn(DocFetcher.prototype, 'fetchSource').mockResolvedValue({
        id: 'task-id',
        sourceId: source.id,
        status: 'failed',
        error: 'Network error',
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      } as FetchTask);

      const fetcher = new DocAutoFetcher({
        outputBaseDir: tmpDir,
      });

      const result = await fetcher.fetchSource(source);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Network error');
      expect(mockRepository.recordFetchResult).toHaveBeenCalledWith(
        source.id,
        source.userId,
        expect.objectContaining({ status: 'failed', error: 'Network error' }),
      );
    });

    it('should handle website source', async () => {
      const source = createMockDocSource({
        type: 'website',
        githubConfig: null,
        websiteConfig: {
          baseUrl: 'https://example.com',
          software: 'nginx',
          pages: ['https://example.com/docs'],
          maxPages: 10,
        },
      });

      vi.mocked(checkWebsiteUpdate).mockResolvedValue({
        hasUpdate: true,
        currentVersion: 'hash123',
      });

      vi.spyOn(DocFetcher.prototype, 'fetchSource').mockResolvedValue({
        id: 'task-id',
        sourceId: source.id,
        status: 'completed',
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      } as FetchTask);

      setupMockDocuments(tmpDir, 'nginx', 'website', 3);

      const fetcher = new DocAutoFetcher({
        outputBaseDir: tmpDir,
      });

      const result = await fetcher.fetchSource(source);

      expect(result.success).toBe(true);
      expect(result.documentsAdded).toBe(3);
    });

    it('should handle update check failure gracefully', async () => {
      const source = createMockDocSource();

      vi.mocked(checkGitHubUpdate).mockRejectedValue(new Error('API error'));

      vi.spyOn(DocFetcher.prototype, 'fetchSource').mockResolvedValue({
        id: 'task-id',
        sourceId: source.id,
        status: 'completed',
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      } as FetchTask);

      setupMockDocuments(tmpDir, 'nginx', 'github', 2);

      const fetcher = new DocAutoFetcher({
        outputBaseDir: tmpDir,
      });

      const result = await fetcher.fetchSource(source);

      // Should proceed with fetch even if update check fails
      expect(result.success).toBe(true);
    });

    it('should handle exceptions during fetch', async () => {
      const source = createMockDocSource();

      vi.mocked(checkGitHubUpdate).mockResolvedValue({ hasUpdate: true });

      vi.spyOn(DocFetcher.prototype, 'fetchSource').mockRejectedValue(
        new Error('Unexpected error'),
      );

      const fetcher = new DocAutoFetcher({
        outputBaseDir: tmpDir,
      });

      const result = await fetcher.fetchSource(source);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Unexpected error');
      expect(mockRepository.recordFetchResult).toHaveBeenCalledWith(
        source.id,
        source.userId,
        expect.objectContaining({ status: 'failed' }),
      );
    });

    it('should record fetch duration', async () => {
      const source = createMockDocSource();

      vi.mocked(checkGitHubUpdate).mockResolvedValue({ hasUpdate: true });

      vi.spyOn(DocFetcher.prototype, 'fetchSource').mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return {
          id: 'task-id',
          sourceId: source.id,
          status: 'completed',
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        } as FetchTask;
      });

      setupMockDocuments(tmpDir, 'nginx', 'github', 1);

      const fetcher = new DocAutoFetcher({
        outputBaseDir: tmpDir,
      });

      const result = await fetcher.fetchSource(source);

      expect(result.duration).toBeGreaterThan(0);
    });
  });

  // --------------------------------------------------------------------------
  // Concurrency Control
  // --------------------------------------------------------------------------

  describe('concurrency control', () => {
    it('should limit concurrent fetches', async () => {
      const sources = Array.from({ length: 10 }, (_, i) =>
        createMockDocSource({ id: `source-${i}`, software: `soft-${i}` }),
      );

      mockRepository.listAutoUpdateSources.mockResolvedValue(sources);
      mockRepository.shouldUpdate.mockReturnValue(true);

      vi.mocked(checkGitHubUpdate).mockResolvedValue({ hasUpdate: true });

      let concurrentCount = 0;
      let maxConcurrent = 0;

      vi.spyOn(DocFetcher.prototype, 'fetchSource').mockImplementation(async () => {
        concurrentCount++;
        maxConcurrent = Math.max(maxConcurrent, concurrentCount);

        await new Promise((resolve) => setTimeout(resolve, 50));

        concurrentCount--;
        return {
          id: 'task-id',
          sourceId: 'test',
          status: 'completed',
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        } as FetchTask;
      });

      const fetcher = new DocAutoFetcher({
        outputBaseDir: tmpDir,
        runOnStart: false,
        maxConcurrent: 3,
      });

      await fetcher.runScheduledFetch();

      expect(maxConcurrent).toBeLessThanOrEqual(3);
    });

    it('should handle mixed success and failure in concurrent fetches', async () => {
      const sources = [
        createMockDocSource({ id: 'success-1' }),
        createMockDocSource({ id: 'fail-1' }),
        createMockDocSource({ id: 'success-2' }),
      ];

      mockRepository.listAutoUpdateSources.mockResolvedValue(sources);
      mockRepository.shouldUpdate.mockReturnValue(true);

      vi.mocked(checkGitHubUpdate).mockResolvedValue({ hasUpdate: true });

      vi.spyOn(DocFetcher.prototype, 'fetchSource').mockImplementation(async (source) => {
        const docSource = source as unknown as RepoDocSource;
        if (docSource.id === 'fail-1') {
          return {
            id: 'task-id',
            sourceId: docSource.id,
            status: 'failed',
            error: 'Failed',
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
          } as FetchTask;
        }
        return {
          id: 'task-id',
          sourceId: docSource.id,
          status: 'completed',
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        } as FetchTask;
      });

      setupMockDocuments(tmpDir, 'nginx', 'github', 1);

      const fetcher = new DocAutoFetcher({
        outputBaseDir: tmpDir,
        runOnStart: false,
        maxConcurrent: 2,
      });

      const summary = await fetcher.runScheduledFetch();

      expect(summary.sourcesUpdated).toBe(2);
      expect(summary.sourcesFailed).toBe(1);
    });
  });

  // --------------------------------------------------------------------------
  // Error Handling
  // --------------------------------------------------------------------------

  describe('error handling', () => {
    it('should handle repository errors gracefully', async () => {
      mockRepository.listAutoUpdateSources.mockRejectedValue(new Error('DB error'));

      const fetcher = new DocAutoFetcher({
        outputBaseDir: tmpDir,
        runOnStart: false,
      });

      await expect(fetcher.runScheduledFetch()).rejects.toThrow('DB error');
    });

    it('should continue on single source error', async () => {
      const sources = [
        createMockDocSource({ id: 'source-1' }),
        createMockDocSource({ id: 'source-2' }),
      ];

      mockRepository.listAutoUpdateSources.mockResolvedValue(sources);
      mockRepository.shouldUpdate.mockReturnValue(true);

      vi.mocked(checkGitHubUpdate).mockResolvedValue({ hasUpdate: true });

      vi.spyOn(DocFetcher.prototype, 'fetchSource')
        .mockResolvedValueOnce({
          id: 'task-1',
          sourceId: 'source-1',
          status: 'failed',
          error: 'Error',
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        } as FetchTask)
        .mockResolvedValueOnce({
          id: 'task-2',
          sourceId: 'source-2',
          status: 'completed',
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        } as FetchTask);

      setupMockDocuments(tmpDir, 'nginx', 'github', 1);

      const fetcher = new DocAutoFetcher({
        outputBaseDir: tmpDir,
        runOnStart: false,
      });

      const summary = await fetcher.runScheduledFetch();

      expect(summary.sourcesUpdated).toBe(1);
      expect(summary.sourcesFailed).toBe(1);
    });
  });

  // --------------------------------------------------------------------------
  // Factory Function
  // --------------------------------------------------------------------------

  describe('createDocAutoFetcher', () => {
    it('should create fetcher with default settings', () => {
      const fetcher = createDocAutoFetcher(tmpDir);

      expect(fetcher).toBeDefined();
      expect(fetcher).toBeInstanceOf(DocAutoFetcher);
    });

    it('should accept optional configuration', () => {
      const fetcher = createDocAutoFetcher(tmpDir, {
        githubToken: 'token',
        checkIntervalMs: 30000,
      });

      expect(fetcher).toBeDefined();
    });

    it('should set correct output directory', () => {
      const projectRoot = tmpDir;
      const fetcher = createDocAutoFetcher(projectRoot);

      expect(fetcher).toBeDefined();
      // The fetcher should use projectRoot/knowledge-base
    });
  });

  // --------------------------------------------------------------------------
  // Incremental Update Logic
  // --------------------------------------------------------------------------

  describe('incremental update tracking', () => {
    it('should use stored SHA for GitHub update check', async () => {
      const source = createMockDocSource({
        lastSha: 'old-sha-123',
        lastUpdateTime: new Date(Date.now() - 24 * 60 * 60 * 1000), // 1 day ago
      });

      vi.mocked(checkGitHubUpdate).mockResolvedValue({
        hasUpdate: false,
        currentVersion: 'old-sha-123',
        previousVersion: 'old-sha-123',
        reason: 'No new commits',
      });

      const fetcher = new DocAutoFetcher({
        outputBaseDir: tmpDir,
      });

      const result = await fetcher.fetchSource(source);

      expect(checkGitHubUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          previousSha: 'old-sha-123',
        }),
      );
      expect(result.success).toBe(true);
      expect(result.documentsAdded).toBe(0); // No fetch happened
      expect(mockRepository.recordFetchResult).toHaveBeenCalledWith(
        source.id,
        source.userId,
        expect.objectContaining({
          status: 'success',
          changeType: 'no_change',
        }),
      );
    });

    it('should use stored hash for website update check', async () => {
      const source = createMockDocSource({
        type: 'website',
        githubConfig: null,
        websiteConfig: {
          baseUrl: 'https://example.com',
          maxPages: 10,
        },
        lastHash: 'old-hash-456',
        lastUpdateTime: new Date(Date.now() - 24 * 60 * 60 * 1000),
      });

      vi.mocked(checkWebsiteUpdate).mockResolvedValue({
        hasUpdate: false,
        currentVersion: 'old-hash-456',
        previousVersion: 'old-hash-456',
        reason: 'Content unchanged',
      });

      const fetcher = new DocAutoFetcher({
        outputBaseDir: tmpDir,
      });

      const result = await fetcher.fetchSource(source);

      expect(checkWebsiteUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          previousHash: 'old-hash-456',
        }),
      );
      expect(result.success).toBe(true);
      expect(result.documentsAdded).toBe(0);
    });

    it('should detect and fetch updates when SHA changes', async () => {
      const source = createMockDocSource({
        lastSha: 'old-sha-123',
        documentCount: 3,
      });

      vi.mocked(checkGitHubUpdate).mockResolvedValue({
        hasUpdate: true,
        currentVersion: 'new-sha-456',
        previousVersion: 'old-sha-123',
        reason: 'New commits detected',
      });

      vi.spyOn(DocFetcher.prototype, 'fetchSource').mockResolvedValue({
        id: 'task-id',
        sourceId: source.id,
        status: 'completed',
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      } as FetchTask);

      setupMockDocuments(tmpDir, 'nginx', 'github', 5);

      const fetcher = new DocAutoFetcher({
        outputBaseDir: tmpDir,
      });

      const result = await fetcher.fetchSource(source);

      expect(result.success).toBe(true);
      expect(result.documentsAdded).toBe(5);
      expect(mockRepository.recordFetchResult).toHaveBeenCalledWith(
        source.id,
        source.userId,
        expect.objectContaining({
          status: 'success',
          currentVersion: 'new-sha-456',
          changeType: 'update',
        }),
      );
    });

    it('should mark first fetch as initial', async () => {
      const source = createMockDocSource({
        lastSha: null,
        lastHash: null,
        lastUpdateTime: null,
      });

      vi.mocked(checkGitHubUpdate).mockResolvedValue({
        hasUpdate: true,
        currentVersion: 'first-sha-789',
        reason: 'No previous version recorded',
      });

      vi.spyOn(DocFetcher.prototype, 'fetchSource').mockResolvedValue({
        id: 'task-id',
        sourceId: source.id,
        status: 'completed',
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      } as FetchTask);

      setupMockDocuments(tmpDir, 'nginx', 'github', 5);

      const fetcher = new DocAutoFetcher({
        outputBaseDir: tmpDir,
      });

      const result = await fetcher.fetchSource(source);

      expect(result.success).toBe(true);
      expect(mockRepository.recordFetchResult).toHaveBeenCalledWith(
        source.id,
        source.userId,
        expect.objectContaining({
          status: 'success',
          currentVersion: 'first-sha-789',
          changeType: 'initial',
        }),
      );
    });

    it('should store version info on successful fetch', async () => {
      const source = createMockDocSource({
        lastSha: 'old-sha',
      });

      vi.mocked(checkGitHubUpdate).mockResolvedValue({
        hasUpdate: true,
        currentVersion: 'new-sha-999',
      });

      vi.spyOn(DocFetcher.prototype, 'fetchSource').mockResolvedValue({
        id: 'task-id',
        sourceId: source.id,
        status: 'completed',
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      } as FetchTask);

      setupMockDocuments(tmpDir, 'nginx', 'github', 2);

      const fetcher = new DocAutoFetcher({
        outputBaseDir: tmpDir,
      });

      await fetcher.fetchSource(source);

      expect(mockRepository.recordFetchResult).toHaveBeenCalledWith(
        source.id,
        source.userId,
        expect.objectContaining({
          currentVersion: 'new-sha-999',
        }),
      );
    });

    it('should not skip fetch on update check failure', async () => {
      const source = createMockDocSource({
        lastSha: 'old-sha',
      });

      vi.mocked(checkGitHubUpdate).mockRejectedValue(new Error('Network error'));

      vi.spyOn(DocFetcher.prototype, 'fetchSource').mockResolvedValue({
        id: 'task-id',
        sourceId: source.id,
        status: 'completed',
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      } as FetchTask);

      setupMockDocuments(tmpDir, 'nginx', 'github', 3);

      const fetcher = new DocAutoFetcher({
        outputBaseDir: tmpDir,
      });

      const result = await fetcher.fetchSource(source);

      // Should proceed with fetch even when update check fails
      expect(result.success).toBe(true);
      expect(result.documentsAdded).toBe(3);
    });
  });
});
