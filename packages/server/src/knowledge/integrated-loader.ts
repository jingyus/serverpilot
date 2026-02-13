// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Integrated knowledge loader that combines static documents and auto-fetched content.
 *
 * Provides a unified interface to load knowledge from multiple sources:
 * - Built-in static documents in knowledge-base/
 * - Auto-fetched documentation from GitHub and websites
 * - Auto-learned knowledge from successful operations
 *
 * @module knowledge/integrated-loader
 */

import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { logger } from '../utils/logger.js';
import { DocumentLoader, type LoadedDocument } from './document-loader.js';

// ============================================================================
// Types
// ============================================================================

/** Summary of the integrated load operation */
export interface IntegratedLoadSummary {
  /** Total documents loaded across all sources */
  totalDocuments: number;
  /** Documents from static knowledge base */
  staticDocuments: number;
  /** Documents from auto-fetched sources */
  fetchedDocuments: number;
  /** Categories found */
  categories: string[];
  /** Software covered */
  software: string[];
  /** Total word count */
  totalWords: number;
}

/** Options for the integrated loader */
export interface IntegratedLoaderOptions {
  /** Project root directory */
  projectRoot: string;
  /** Include auto-fetched documents (default: true) */
  includeFetched?: boolean;
  /** Include static knowledge base (default: true) */
  includeStatic?: boolean;
}

// ============================================================================
// IntegratedKnowledgeLoader
// ============================================================================

/**
 * Loads knowledge from all configured sources.
 *
 * Combines static built-in documentation with dynamically fetched content
 * to provide a comprehensive knowledge base for AI operations.
 */
export class IntegratedKnowledgeLoader {
  private readonly projectRoot: string;
  private readonly includeFetched: boolean;
  private readonly includeStatic: boolean;
  private documents: LoadedDocument[] = [];

  constructor(options: IntegratedLoaderOptions) {
    this.projectRoot = options.projectRoot;
    this.includeFetched = options.includeFetched ?? true;
    this.includeStatic = options.includeStatic ?? true;
  }

  /**
   * Load all documents from configured sources.
   */
  loadAll(): { documents: LoadedDocument[]; summary: IntegratedLoadSummary } {
    const documents: LoadedDocument[] = [];
    const categoriesSet = new Set<string>();
    const softwareSet = new Set<string>();
    let staticCount = 0;
    let fetchedCount = 0;
    let totalWords = 0;

    // Load static knowledge base
    if (this.includeStatic) {
      const staticDir = path.join(this.projectRoot, 'knowledge-base');
      if (existsSync(staticDir)) {
        try {
          const loader = new DocumentLoader({ baseDir: staticDir });
          const result = loader.loadAll();
          documents.push(...result.documents);
          staticCount = result.summary.loaded;
          totalWords += result.summary.totalWordCount;
          result.summary.categories.forEach((c) => categoriesSet.add(c));

          logger.info(
            { count: staticCount, dir: staticDir },
            'Loaded static knowledge documents',
          );
        } catch (err) {
          logger.warn(
            { error: err, dir: staticDir },
            'Failed to load static knowledge',
          );
        }
      }
    }

    // Load auto-fetched documents
    if (this.includeFetched) {
      const fetchedDir = path.join(this.projectRoot, 'knowledge-base');
      if (existsSync(fetchedDir)) {
        try {
          // Scan for software directories
          const softwareDirs = readdirSync(fetchedDir, { withFileTypes: true })
            .filter((d) => d.isDirectory())
            .map((d) => d.name);

          for (const software of softwareDirs) {
            softwareSet.add(software);
            const softwarePath = path.join(fetchedDir, software);

            // Check for github/ and website/ subdirectories
            for (const sourceType of ['github', 'website']) {
              const sourcePath = path.join(softwarePath, sourceType);
              if (existsSync(sourcePath)) {
                try {
                  const loader = new DocumentLoader({ baseDir: sourcePath });
                  const result = loader.loadAll();

                  // Prefix category with software name for clarity
                  const prefixedDocs = result.documents.map((doc) => ({
                    ...doc,
                    category: `${software}/${sourceType}`,
                  }));

                  documents.push(...prefixedDocs);
                  fetchedCount += result.summary.loaded;
                  totalWords += result.summary.totalWordCount;
                  categoriesSet.add(`${software}/${sourceType}`);

                  logger.debug(
                    {
                      software,
                      sourceType,
                      count: result.summary.loaded,
                    },
                    'Loaded fetched documents',
                  );
                } catch (err) {
                  logger.warn(
                    { error: err, path: sourcePath },
                    'Failed to load fetched documents',
                  );
                }
              }
            }
          }

          logger.info(
            { count: fetchedCount, software: [...softwareSet] },
            'Loaded auto-fetched documents',
          );
        } catch (err) {
          logger.warn(
            { error: err, dir: fetchedDir },
            'Failed to scan fetched documents',
          );
        }
      }
    }

    this.documents = documents;

    const summary: IntegratedLoadSummary = {
      totalDocuments: documents.length,
      staticDocuments: staticCount,
      fetchedDocuments: fetchedCount,
      categories: [...categoriesSet].sort(),
      software: [...softwareSet].sort(),
      totalWords,
    };

    logger.info(summary, 'Integrated knowledge load completed');

    return { documents, summary };
  }

  /**
   * Get all loaded documents.
   */
  getDocuments(): LoadedDocument[] {
    return [...this.documents];
  }

  /**
   * Filter documents by software name.
   */
  getDocumentsBySoftware(software: string): LoadedDocument[] {
    return this.documents.filter(
      (doc) =>
        doc.category.startsWith(software) ||
        doc.title.toLowerCase().includes(software.toLowerCase()) ||
        doc.content.toLowerCase().includes(software.toLowerCase()),
    );
  }

  /**
   * Filter documents by category.
   */
  getDocumentsByCategory(category: string): LoadedDocument[] {
    return this.documents.filter((doc) => doc.category === category);
  }

  /**
   * Search documents by keyword.
   */
  searchDocuments(query: string): LoadedDocument[] {
    const lowerQuery = query.toLowerCase();
    return this.documents.filter(
      (doc) =>
        doc.title.toLowerCase().includes(lowerQuery) ||
        doc.content.toLowerCase().includes(lowerQuery),
    );
  }

  /**
   * Get summary statistics.
   */
  getSummary(): IntegratedLoadSummary {
    const categoriesSet = new Set(this.documents.map((d) => d.category));
    const softwareSet = new Set<string>();

    // Extract software names from categories
    for (const category of categoriesSet) {
      const parts = category.split('/');
      if (parts.length > 1) {
        softwareSet.add(parts[0]);
      }
    }

    return {
      totalDocuments: this.documents.length,
      staticDocuments: this.documents.filter((d) => !d.category.includes('/')).length,
      fetchedDocuments: this.documents.filter((d) => d.category.includes('/')).length,
      categories: [...categoriesSet].sort(),
      software: [...softwareSet].sort(),
      totalWords: this.documents.reduce((sum, d) => sum + d.metadata.wordCount, 0),
    };
  }
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create an integrated knowledge loader for the project.
 */
export function createIntegratedLoader(
  projectRoot: string,
  options?: Partial<IntegratedLoaderOptions>,
): IntegratedKnowledgeLoader {
  return new IntegratedKnowledgeLoader({
    projectRoot,
    ...options,
  });
}
