// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Knowledge base document loader and search module.
 *
 * Loads markdown documents from a knowledge-base directory and provides
 * keyword-based search to find relevant content for AI prompt augmentation.
 *
 * @module knowledge/loader
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';

// ============================================================================
// Types
// ============================================================================

/** A single document loaded from the knowledge base */
export interface KnowledgeDocument {
  /** Unique identifier derived from the relative file path */
  id: string;
  /** Document title extracted from the first heading or filename */
  title: string;
  /** Raw content of the document */
  content: string;
  /** Relative file path from the knowledge base root */
  filePath: string;
  /** Category derived from the parent directory name */
  category: string;
}

/** A search result with relevance score */
export interface SearchResult {
  /** The matched document */
  document: KnowledgeDocument;
  /** Relevance score (higher is more relevant) */
  score: number;
  /** Matched text snippets */
  snippets: string[];
}

/** Options for the KnowledgeBase constructor */
export interface KnowledgeBaseOptions {
  /** Root directory of the knowledge base */
  baseDir: string;
  /** File extensions to load (default: ['.md']) */
  extensions?: string[];
}

// ============================================================================
// KnowledgeBase
// ============================================================================

/**
 * File-based knowledge base that loads and searches markdown documents.
 *
 * Scans a directory recursively for markdown files, loads them into memory,
 * and provides keyword-based search for finding relevant content.
 *
 * @example
 * ```ts
 * const kb = new KnowledgeBase({ baseDir: './knowledge-base' });
 * kb.loadDocuments();
 * const results = kb.search('npm timeout');
 * ```
 */
export class KnowledgeBase {
  private readonly baseDir: string;
  private readonly extensions: string[];
  private documents: KnowledgeDocument[] = [];
  private loaded = false;

  constructor(options: KnowledgeBaseOptions) {
    this.baseDir = path.resolve(options.baseDir);
    this.extensions = options.extensions ?? ['.md'];
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  /**
   * Load all documents from the knowledge base directory.
   *
   * Recursively scans the base directory for files matching the configured
   * extensions and loads them into memory.
   *
   * @returns The number of documents loaded
   * @throws Error if the base directory does not exist
   */
  loadDocuments(): number {
    if (!existsSync(this.baseDir)) {
      throw new Error(`Knowledge base directory does not exist: ${this.baseDir}`);
    }

    this.documents = [];
    const files = this.scanDirectory(this.baseDir);

    for (const filePath of files) {
      const doc = this.loadDocument(filePath);
      if (doc) {
        this.documents.push(doc);
      }
    }

    this.loaded = true;
    return this.documents.length;
  }

  /**
   * Search the knowledge base for documents matching the query.
   *
   * Uses keyword matching to find relevant documents. Each query term
   * is matched against document titles and content. Results are sorted
   * by relevance score (descending).
   *
   * @param query - Search query string
   * @param maxResults - Maximum number of results to return (default: 5)
   * @returns Array of search results sorted by relevance
   */
  search(query: string, maxResults = 5): SearchResult[] {
    if (!this.loaded) {
      return [];
    }

    const terms = this.tokenize(query);
    if (terms.length === 0) {
      return [];
    }

    const results: SearchResult[] = [];

    for (const document of this.documents) {
      const result = this.scoreDocument(document, terms);
      if (result.score > 0) {
        results.push(result);
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, maxResults);
  }

  /**
   * Get all loaded documents.
   *
   * @returns Array of all loaded documents
   */
  getDocuments(): KnowledgeDocument[] {
    return [...this.documents];
  }

  /**
   * Get a document by its ID.
   *
   * @param id - Document ID
   * @returns The document if found, undefined otherwise
   */
  getDocumentById(id: string): KnowledgeDocument | undefined {
    return this.documents.find((doc) => doc.id === id);
  }

  /**
   * Get documents filtered by category.
   *
   * @param category - Category name
   * @returns Array of documents in the specified category
   */
  getDocumentsByCategory(category: string): KnowledgeDocument[] {
    return this.documents.filter((doc) => doc.category === category);
  }

  /**
   * Check if documents have been loaded.
   *
   * @returns true if loadDocuments() has been called successfully
   */
  isLoaded(): boolean {
    return this.loaded;
  }

  /**
   * Get the number of loaded documents.
   *
   * @returns Document count
   */
  getDocumentCount(): number {
    return this.documents.length;
  }

  // --------------------------------------------------------------------------
  // File Scanning
  // --------------------------------------------------------------------------

  /**
   * Recursively scan a directory for matching files.
   */
  private scanDirectory(dir: string): string[] {
    const files: string[] = [];

    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return files;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry);

      let stat;
      try {
        stat = statSync(fullPath);
      } catch {
        continue;
      }

      if (stat.isDirectory()) {
        files.push(...this.scanDirectory(fullPath));
      } else if (stat.isFile() && this.hasMatchingExtension(fullPath)) {
        files.push(fullPath);
      }
    }

    return files;
  }

  /**
   * Check if a file has a matching extension.
   */
  private hasMatchingExtension(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return this.extensions.includes(ext);
  }

  // --------------------------------------------------------------------------
  // Document Loading
  // --------------------------------------------------------------------------

  /**
   * Load a single document from a file path.
   */
  private loadDocument(filePath: string): KnowledgeDocument | null {
    try {
      const content = readFileSync(filePath, 'utf-8');
      const relativePath = path.relative(this.baseDir, filePath);
      const id = relativePath.replace(/\\/g, '/');
      const title = this.extractTitle(content, filePath);
      const category = this.extractCategory(relativePath);

      return { id, title, content, filePath: relativePath, category };
    } catch {
      return null;
    }
  }

  /**
   * Extract the title from document content.
   * Uses the first markdown heading, or falls back to the filename.
   */
  private extractTitle(content: string, filePath: string): string {
    const headingMatch = content.match(/^#\s+(.+)$/m);
    if (headingMatch) {
      return headingMatch[1].trim();
    }
    return path.basename(filePath, path.extname(filePath));
  }

  /**
   * Extract the category from the relative file path.
   * Uses the first directory component, or 'root' for top-level files.
   */
  private extractCategory(relativePath: string): string {
    const normalized = relativePath.replace(/\\/g, '/');
    const parts = normalized.split('/');
    return parts.length > 1 ? parts[0] : 'root';
  }

  // --------------------------------------------------------------------------
  // Search
  // --------------------------------------------------------------------------

  /**
   * Tokenize a query string into lowercase search terms.
   */
  private tokenize(query: string): string[] {
    return query
      .toLowerCase()
      .split(/\s+/)
      .filter((term) => term.length > 1);
  }

  /**
   * Score a document against search terms.
   */
  private scoreDocument(document: KnowledgeDocument, terms: string[]): SearchResult {
    let score = 0;
    const snippets: string[] = [];
    const contentLower = document.content.toLowerCase();
    const titleLower = document.title.toLowerCase();
    const lines = document.content.split('\n');

    for (const term of terms) {
      // Title matches are worth more
      if (titleLower.includes(term)) {
        score += 10;
      }

      // Count content occurrences
      let idx = 0;
      let count = 0;
      while ((idx = contentLower.indexOf(term, idx)) !== -1) {
        count++;
        idx += term.length;
      }

      if (count > 0) {
        score += count;

        // Collect snippet lines
        for (const line of lines) {
          if (line.toLowerCase().includes(term) && snippets.length < 3) {
            const trimmed = line.trim();
            if (trimmed.length > 0 && !snippets.includes(trimmed)) {
              snippets.push(trimmed);
            }
          }
        }
      }
    }

    return { document, score, snippets };
  }
}
