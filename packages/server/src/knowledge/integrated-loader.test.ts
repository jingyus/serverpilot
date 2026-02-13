// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for the integrated knowledge loader module.
 */

import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  IntegratedKnowledgeLoader,
  createIntegratedLoader,
} from './integrated-loader.js';

// ============================================================================
// Helpers
// ============================================================================

function createTestDocs(baseDir: string): void {
  // Create static knowledge base
  const staticDir = path.join(baseDir, 'knowledge-base');
  mkdirSync(staticDir, { recursive: true });

  writeFileSync(
    path.join(staticDir, 'nginx.md'),
    '# Nginx\n\nNginx is a web server.',
  );

  writeFileSync(
    path.join(staticDir, 'redis.md'),
    '# Redis\n\nRedis is a database.',
  );

  // Create fetched documents
  const nginxGithubDir = path.join(baseDir, 'knowledge-base', 'nginx', 'github');
  mkdirSync(nginxGithubDir, { recursive: true });

  writeFileSync(
    path.join(nginxGithubDir, 'README.md'),
    '# Nginx GitHub\n\nNginx README from GitHub.',
  );

  const redisWebsiteDir = path.join(baseDir, 'knowledge-base', 'redis', 'website');
  mkdirSync(redisWebsiteDir, { recursive: true });

  writeFileSync(
    path.join(redisWebsiteDir, 'docs.md'),
    '# Redis Docs\n\nRedis documentation from website.',
  );
}

// ============================================================================
// Tests
// ============================================================================

describe('integrated-loader', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(
      os.tmpdir(),
      `integrated-loader-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
  });

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // --------------------------------------------------------------------------
  // IntegratedKnowledgeLoader
  // --------------------------------------------------------------------------

  describe('IntegratedKnowledgeLoader', () => {
    it('should initialize with project root', () => {
      const loader = new IntegratedKnowledgeLoader({ projectRoot: tmpDir });
      expect(loader).toBeDefined();
    });

    it('should load all documents when both sources enabled', () => {
      createTestDocs(tmpDir);

      const loader = new IntegratedKnowledgeLoader({
        projectRoot: tmpDir,
        includeFetched: true,
        includeStatic: true,
      });

      const { documents, summary } = loader.loadAll();

      expect(documents.length).toBeGreaterThan(0);
      expect(summary.totalDocuments).toBe(documents.length);
      expect(summary.staticDocuments).toBeGreaterThan(0);
      expect(summary.fetchedDocuments).toBeGreaterThan(0);
    });

    it('should load only static documents when fetched disabled', () => {
      createTestDocs(tmpDir);

      const loader = new IntegratedKnowledgeLoader({
        projectRoot: tmpDir,
        includeFetched: false,
        includeStatic: true,
      });

      const { summary } = loader.loadAll();

      expect(summary.staticDocuments).toBeGreaterThan(0);
      expect(summary.fetchedDocuments).toBe(0);
    });

    it('should load only fetched documents when static disabled', () => {
      createTestDocs(tmpDir);

      const loader = new IntegratedKnowledgeLoader({
        projectRoot: tmpDir,
        includeFetched: true,
        includeStatic: false,
      });

      const { summary } = loader.loadAll();

      expect(summary.staticDocuments).toBe(0);
      expect(summary.fetchedDocuments).toBeGreaterThan(0);
    });

    it('should include software in summary', () => {
      createTestDocs(tmpDir);

      const loader = new IntegratedKnowledgeLoader({ projectRoot: tmpDir });
      const { summary } = loader.loadAll();

      expect(summary.software).toContain('nginx');
      expect(summary.software).toContain('redis');
    });

    it('should include categories in summary', () => {
      createTestDocs(tmpDir);

      const loader = new IntegratedKnowledgeLoader({ projectRoot: tmpDir });
      const { summary } = loader.loadAll();

      expect(summary.categories.some((c) => c.includes('nginx'))).toBe(true);
      expect(summary.categories.some((c) => c.includes('redis'))).toBe(true);
    });

    it('should prefix fetched document categories', () => {
      createTestDocs(tmpDir);

      const loader = new IntegratedKnowledgeLoader({ projectRoot: tmpDir });
      const { documents } = loader.loadAll();

      const githubDoc = documents.find((d) => d.category.includes('github'));
      expect(githubDoc).toBeDefined();
      expect(githubDoc?.category).toMatch(/^[\w-]+\/github$/);

      const websiteDoc = documents.find((d) => d.category.includes('website'));
      expect(websiteDoc).toBeDefined();
      expect(websiteDoc?.category).toMatch(/^[\w-]+\/website$/);
    });

    it('should handle missing knowledge base gracefully', () => {
      const loader = new IntegratedKnowledgeLoader({ projectRoot: tmpDir });
      const { documents, summary } = loader.loadAll();

      expect(documents).toEqual([]);
      expect(summary.totalDocuments).toBe(0);
    });

    it('should get all loaded documents', () => {
      createTestDocs(tmpDir);

      const loader = new IntegratedKnowledgeLoader({ projectRoot: tmpDir });
      loader.loadAll();

      const documents = loader.getDocuments();
      expect(documents.length).toBeGreaterThan(0);
    });

    it('should filter documents by software', () => {
      createTestDocs(tmpDir);

      const loader = new IntegratedKnowledgeLoader({ projectRoot: tmpDir });
      loader.loadAll();

      const nginxDocs = loader.getDocumentsBySoftware('nginx');
      expect(nginxDocs.length).toBeGreaterThan(0);
      expect(nginxDocs.every((d) =>
        d.category.includes('nginx') ||
        d.title.toLowerCase().includes('nginx') ||
        d.content.toLowerCase().includes('nginx')
      )).toBe(true);
    });

    it('should filter documents by category', () => {
      createTestDocs(tmpDir);

      const loader = new IntegratedKnowledgeLoader({ projectRoot: tmpDir });
      loader.loadAll();

      const githubDocs = loader.getDocumentsByCategory('nginx/github');
      expect(githubDocs.every((d) => d.category === 'nginx/github')).toBe(true);
    });

    it('should search documents by query', () => {
      createTestDocs(tmpDir);

      const loader = new IntegratedKnowledgeLoader({ projectRoot: tmpDir });
      loader.loadAll();

      const results = loader.searchDocuments('web server');
      expect(results.length).toBeGreaterThan(0);
      expect(results.some((d) =>
        d.title.toLowerCase().includes('web') ||
        d.content.toLowerCase().includes('web server')
      )).toBe(true);
    });

    it('should search case-insensitively', () => {
      createTestDocs(tmpDir);

      const loader = new IntegratedKnowledgeLoader({ projectRoot: tmpDir });
      loader.loadAll();

      const results = loader.searchDocuments('NGINX');
      expect(results.length).toBeGreaterThan(0);
    });

    it('should get summary statistics', () => {
      createTestDocs(tmpDir);

      const loader = new IntegratedKnowledgeLoader({ projectRoot: tmpDir });
      loader.loadAll();

      const summary = loader.getSummary();

      expect(summary.totalDocuments).toBeGreaterThan(0);
      expect(summary.staticDocuments).toBeGreaterThan(0);
      expect(summary.fetchedDocuments).toBeGreaterThan(0);
      expect(summary.categories.length).toBeGreaterThan(0);
      expect(summary.software.length).toBeGreaterThan(0);
      expect(summary.totalWords).toBeGreaterThan(0);
    });

    it('should extract software from categories', () => {
      createTestDocs(tmpDir);

      const loader = new IntegratedKnowledgeLoader({ projectRoot: tmpDir });
      loader.loadAll();

      const summary = loader.getSummary();

      expect(summary.software).toContain('nginx');
      expect(summary.software).toContain('redis');
    });

    it('should sort categories alphabetically', () => {
      createTestDocs(tmpDir);

      const loader = new IntegratedKnowledgeLoader({ projectRoot: tmpDir });
      loader.loadAll();

      const summary = loader.getSummary();

      const sorted = [...summary.categories].sort();
      expect(summary.categories).toEqual(sorted);
    });

    it('should sort software alphabetically', () => {
      createTestDocs(tmpDir);

      const loader = new IntegratedKnowledgeLoader({ projectRoot: tmpDir });
      loader.loadAll();

      const summary = loader.getSummary();

      const sorted = [...summary.software].sort();
      expect(summary.software).toEqual(sorted);
    });
  });

  // --------------------------------------------------------------------------
  // createIntegratedLoader
  // --------------------------------------------------------------------------

  describe('createIntegratedLoader', () => {
    it('should create an IntegratedKnowledgeLoader', () => {
      const loader = createIntegratedLoader(tmpDir);
      expect(loader).toBeDefined();
      expect(loader).toBeInstanceOf(IntegratedKnowledgeLoader);
    });

    it('should accept optional configuration', () => {
      const loader = createIntegratedLoader(tmpDir, {
        includeFetched: false,
        includeStatic: true,
      });
      expect(loader).toBeDefined();
    });
  });
});
