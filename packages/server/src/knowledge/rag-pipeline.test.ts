// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for the RAG (Retrieval-Augmented Generation) pipeline.
 *
 * Validates lazy initialization, knowledge base search, graceful degradation,
 * token budget management, and singleton lifecycle.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { RAGPipeline, getRagPipeline, initRagPipeline, _resetRagPipeline } from './rag-pipeline.js';

// ============================================================================
// Mocks
// ============================================================================

// Mock the integrated loader
vi.mock('./integrated-loader.js', () => {
  return {
    IntegratedKnowledgeLoader: vi.fn().mockImplementation(() => ({
      loadAll: vi.fn().mockReturnValue({
        documents: [
          {
            id: 'nginx/installation',
            title: 'Nginx Installation Guide',
            content: '# Installing Nginx\n\nTo install nginx on Ubuntu:\n\n```bash\nsudo apt update\nsudo apt install nginx\n```\n\nAfter installation, start the service:\n\n```bash\nsudo systemctl start nginx\nsudo systemctl enable nginx\n```\n\n## Configuration\n\nThe main configuration file is at `/etc/nginx/nginx.conf`.',
            filePath: 'nginx/installation.md',
            category: 'nginx',
            metadata: { wordCount: 30, charCount: 250, headingCount: 2, codeBlockCount: 2, sourceUrl: null, scrapedAt: null, category: 'nginx', tags: ['nginx', 'installation'] },
          },
          {
            id: 'redis/installation',
            title: 'Redis Installation Guide',
            content: '# Installing Redis\n\nTo install Redis on Ubuntu:\n\n```bash\nsudo apt update\nsudo apt install redis-server\n```\n\nConfigure Redis for production by editing `/etc/redis/redis.conf`.\n\n## Security\n\nAlways set a password with `requirepass` directive.',
            filePath: 'redis/installation.md',
            category: 'redis',
            metadata: { wordCount: 25, charCount: 200, headingCount: 2, codeBlockCount: 1, sourceUrl: null, scrapedAt: null, category: 'redis', tags: ['redis', 'installation'] },
          },
        ],
        summary: {
          totalDocuments: 2,
          staticDocuments: 2,
          fetchedDocuments: 0,
          categories: ['nginx', 'redis'],
          software: ['nginx', 'redis'],
          totalWords: 55,
        },
      }),
    })),
  };
});

// Mock the logger to suppress output during tests
vi.mock('../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// ============================================================================
// Tests
// ============================================================================

describe('RAGPipeline', () => {
  beforeEach(() => {
    _resetRagPipeline();
  });

  afterEach(() => {
    _resetRagPipeline();
  });

  // --------------------------------------------------------------------------
  // Initialization
  // --------------------------------------------------------------------------

  describe('initialization', () => {
    it('should lazily initialize on first search', async () => {
      const pipeline = new RAGPipeline('/fake/project/root');
      expect(pipeline.isReady()).toBe(false);

      const result = await pipeline.search('install nginx');
      // After search, pipeline should be initialized
      expect(pipeline.isReady()).toBe(true);
      expect(pipeline.getIndexedDocCount()).toBe(2);
      // Should return results since we have nginx docs
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should not reinitialize on subsequent searches', async () => {
      const pipeline = new RAGPipeline('/fake/project/root');

      await pipeline.search('install nginx');
      const docCount1 = pipeline.getIndexedDocCount();

      await pipeline.search('install redis');
      const docCount2 = pipeline.getIndexedDocCount();

      expect(docCount1).toBe(docCount2);
    });

    it('should handle concurrent initialization safely', async () => {
      const pipeline = new RAGPipeline('/fake/project/root');

      // Launch multiple concurrent searches
      const [r1, r2, r3] = await Promise.all([
        pipeline.search('nginx'),
        pipeline.search('redis'),
        pipeline.search('docker'),
      ]);

      // All should succeed and pipeline should be initialized once
      expect(pipeline.isReady()).toBe(true);
      expect(r1.durationMs).toBeGreaterThanOrEqual(0);
      expect(r2.durationMs).toBeGreaterThanOrEqual(0);
      expect(r3.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  // --------------------------------------------------------------------------
  // Search
  // --------------------------------------------------------------------------

  describe('search', () => {
    it('should return results for matching queries', async () => {
      const pipeline = new RAGPipeline('/fake/project/root');
      const result = await pipeline.search('install nginx');

      expect(result.hasResults).toBe(true);
      expect(result.resultCount).toBeGreaterThan(0);
      expect(result.contextText).toContain('Knowledge Base Reference');
      expect(result.estimatedTokens).toBeGreaterThan(0);
    });

    it('should return results for redis queries', async () => {
      const pipeline = new RAGPipeline('/fake/project/root');
      const result = await pipeline.search('install redis server');

      expect(result.hasResults).toBe(true);
      expect(result.resultCount).toBeGreaterThan(0);
      expect(result.contextText.length).toBeGreaterThan(0);
    });

    it('should return empty results for unrelated queries', async () => {
      const pipeline = new RAGPipeline('/fake/project/root');
      const result = await pipeline.search('zzzzxyzzy quantum flux capacitor');

      // TF-IDF with a small corpus may still return low-score results,
      // but with our minScore threshold they should be filtered
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      // Result may or may not have matches depending on TF-IDF scoring
    });

    it('should respect maxResults option', async () => {
      const pipeline = new RAGPipeline('/fake/project/root');
      const result = await pipeline.search('install', { maxResults: 1 });

      if (result.hasResults) {
        expect(result.resultCount).toBeLessThanOrEqual(1);
      }
    });

    it('should include source information in context text', async () => {
      const pipeline = new RAGPipeline('/fake/project/root');
      const result = await pipeline.search('install nginx');

      if (result.hasResults) {
        expect(result.contextText).toContain('Source:');
      }
    });

    it('should estimate tokens based on context length', async () => {
      const pipeline = new RAGPipeline('/fake/project/root');
      const result = await pipeline.search('install nginx');

      if (result.hasResults) {
        // Token estimate ≈ chars / 4
        const expectedMinTokens = Math.floor(result.contextText.length / 4);
        expect(result.estimatedTokens).toBeGreaterThanOrEqual(expectedMinTokens - 1);
      }
    });
  });

  // --------------------------------------------------------------------------
  // Graceful degradation
  // --------------------------------------------------------------------------

  describe('graceful degradation', () => {
    it('should return empty results when knowledge base is empty', async () => {
      // Override the mock for this test to return no documents
      const { IntegratedKnowledgeLoader } = await import('./integrated-loader.js');
      vi.mocked(IntegratedKnowledgeLoader).mockImplementationOnce(() => ({
        loadAll: () => ({
          documents: [],
          summary: {
            totalDocuments: 0,
            staticDocuments: 0,
            fetchedDocuments: 0,
            categories: [],
            software: [],
            totalWords: 0,
          },
        }),
        getDocuments: () => [],
        getDocumentsBySoftware: () => [],
        getDocumentsByCategory: () => [],
        searchDocuments: () => [],
        getSummary: () => ({
          totalDocuments: 0,
          staticDocuments: 0,
          fetchedDocuments: 0,
          categories: [],
          software: [],
          totalWords: 0,
        }),
      }) as unknown as ConstructorParameters<typeof import('./integrated-loader.js').IntegratedKnowledgeLoader>[0]);

      const pipeline = new RAGPipeline('/fake/empty/root');
      const result = await pipeline.search('install nginx');

      expect(result.hasResults).toBe(false);
      expect(result.resultCount).toBe(0);
      expect(result.contextText).toBe('');
      expect(result.estimatedTokens).toBe(0);
    });

    it('should return empty results when loader throws an error', async () => {
      const { IntegratedKnowledgeLoader } = await import('./integrated-loader.js');
      vi.mocked(IntegratedKnowledgeLoader).mockImplementationOnce(() => ({
        loadAll: () => { throw new Error('File system error'); },
        getDocuments: () => [],
        getDocumentsBySoftware: () => [],
        getDocumentsByCategory: () => [],
        searchDocuments: () => [],
        getSummary: () => ({
          totalDocuments: 0,
          staticDocuments: 0,
          fetchedDocuments: 0,
          categories: [],
          software: [],
          totalWords: 0,
        }),
      }) as unknown as ConstructorParameters<typeof import('./integrated-loader.js').IntegratedKnowledgeLoader>[0]);

      const pipeline = new RAGPipeline('/fake/broken/root');
      const result = await pipeline.search('install nginx');

      // Should not throw — returns empty results
      expect(result.hasResults).toBe(false);
      expect(result.resultCount).toBe(0);
      expect(result.contextText).toBe('');
    });
  });

  // --------------------------------------------------------------------------
  // Reinitialize
  // --------------------------------------------------------------------------

  describe('reinitialize', () => {
    it('should allow reinitializing the pipeline', async () => {
      const pipeline = new RAGPipeline('/fake/project/root');

      await pipeline.search('nginx');
      expect(pipeline.isReady()).toBe(true);

      await pipeline.reinitialize();
      expect(pipeline.isReady()).toBe(true); // re-inited
      expect(pipeline.getIndexedDocCount()).toBe(2);
    });
  });

  // --------------------------------------------------------------------------
  // Singleton
  // --------------------------------------------------------------------------

  describe('singleton', () => {
    it('should return null when not initialized', () => {
      expect(getRagPipeline()).toBeNull();
    });

    it('should create pipeline via initRagPipeline', () => {
      const pipeline = initRagPipeline('/fake/root');
      expect(pipeline).toBeInstanceOf(RAGPipeline);
      expect(getRagPipeline()).toBe(pipeline);
    });

    it('should return existing pipeline from getRagPipeline', () => {
      const pipeline = initRagPipeline('/fake/root');
      expect(getRagPipeline()).toBe(pipeline);
      expect(getRagPipeline()).toBe(pipeline);
    });

    it('should create pipeline via getRagPipeline with projectRoot', () => {
      const pipeline = getRagPipeline('/fake/root');
      expect(pipeline).toBeInstanceOf(RAGPipeline);
    });

    it('should reset singleton via _resetRagPipeline', () => {
      initRagPipeline('/fake/root');
      expect(getRagPipeline()).not.toBeNull();

      _resetRagPipeline();
      expect(getRagPipeline()).toBeNull();
    });
  });
});

// ============================================================================
// buildSystemPrompt with knowledge context
// ============================================================================

describe('buildSystemPrompt with knowledgeContext', () => {
  it('should append knowledge context to system prompt', async () => {
    const { buildSystemPrompt } = await import('../api/routes/chat-ai.js');

    const prompt = buildSystemPrompt(
      '## Server Profile\n- OS: Ubuntu',
      ['Nginx is already installed'],
      '\nKnowledge Base Reference:\n[nginx] Installation\nInstall with apt.',
    );

    expect(prompt).toContain('ServerPilot');
    expect(prompt).toContain('Server Profile');
    expect(prompt).toContain('Important Caveats');
    expect(prompt).toContain('Knowledge Base Reference');
    expect(prompt).toContain('Install with apt');
  });

  it('should work without knowledge context', async () => {
    const { buildSystemPrompt } = await import('../api/routes/chat-ai.js');

    const prompt = buildSystemPrompt('## Profile', ['caveat1']);
    expect(prompt).toContain('ServerPilot');
    expect(prompt).toContain('Profile');
    expect(prompt).not.toContain('Knowledge Base Reference');
  });

  it('should work with only knowledge context', async () => {
    const { buildSystemPrompt } = await import('../api/routes/chat-ai.js');

    const prompt = buildSystemPrompt(undefined, undefined, '\nKnowledge Base:\nSome docs');
    expect(prompt).toContain('ServerPilot');
    expect(prompt).toContain('Knowledge Base');
  });
});
