// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Document loader for the knowledge base indexing pipeline.
 *
 * Extends the base KnowledgeBase loader with document validation, metadata
 * extraction, and batch loading capabilities needed by the indexing pipeline
 * (load → chunk → embed → store).
 *
 * @module knowledge/document-loader
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';

// ============================================================================
// Types
// ============================================================================

/** Metadata extracted from a document */
export interface DocumentMetadata {
  /** Source URL if the document was scraped */
  sourceUrl: string | null;
  /** Timestamp when the document was scraped */
  scrapedAt: string | null;
  /** Document category (e.g., 'docs', 'issues', 'solutions', 'cases') */
  category: string;
  /** Document tags extracted from headings and content */
  tags: string[];
  /** Word count of the document content */
  wordCount: number;
  /** Character count of the document content */
  charCount: number;
  /** Number of headings in the document */
  headingCount: number;
  /** Number of code blocks in the document */
  codeBlockCount: number;
}

/** A document loaded and prepared for the indexing pipeline */
export interface LoadedDocument {
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
  /** Extracted metadata */
  metadata: DocumentMetadata;
}

/** Summary of a document loading operation */
export interface LoadSummary {
  /** Total number of files found */
  totalFiles: number;
  /** Number of files successfully loaded */
  loaded: number;
  /** Number of files that failed to load */
  failed: number;
  /** Number of files skipped (e.g., too small, invalid) */
  skipped: number;
  /** Paths of failed files */
  failedPaths: string[];
  /** Paths of skipped files */
  skippedPaths: string[];
  /** Categories found */
  categories: string[];
  /** Total word count across all loaded documents */
  totalWordCount: number;
}

/** Options for the DocumentLoader */
export interface DocumentLoaderOptions {
  /** Root directory of the knowledge base */
  baseDir: string;
  /** File extensions to load (default: ['.md']) */
  extensions?: string[];
  /** Minimum file size in bytes to load (default: 10) */
  minFileSize?: number;
  /** Maximum file size in bytes to load (default: 1MB) */
  maxFileSize?: number;
}

// ============================================================================
// Constants
// ============================================================================

/** Default minimum file size in bytes */
const DEFAULT_MIN_FILE_SIZE = 10;

/** Default maximum file size in bytes (1MB) */
const DEFAULT_MAX_FILE_SIZE = 1024 * 1024;

/** Default file extensions to load */
const DEFAULT_EXTENSIONS = ['.md'];

// ============================================================================
// DocumentLoader
// ============================================================================

/**
 * Document loader for the indexing pipeline.
 *
 * Loads documents from a knowledge base directory, extracts metadata,
 * validates content, and prepares documents for the downstream pipeline
 * steps (chunking, embedding, storage).
 *
 * @example
 * ```ts
 * const loader = new DocumentLoader({ baseDir: './knowledge-base' });
 * const { documents, summary } = loader.loadAll();
 * console.log(`Loaded ${summary.loaded} documents`);
 * ```
 */
export class DocumentLoader {
  private readonly baseDir: string;
  private readonly extensions: string[];
  private readonly minFileSize: number;
  private readonly maxFileSize: number;

  constructor(options: DocumentLoaderOptions) {
    this.baseDir = path.resolve(options.baseDir);
    this.extensions = options.extensions ?? DEFAULT_EXTENSIONS;
    this.minFileSize = options.minFileSize ?? DEFAULT_MIN_FILE_SIZE;
    this.maxFileSize = options.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  /**
   * Load all documents from the knowledge base directory.
   *
   * Recursively scans the base directory for files matching the configured
   * extensions, validates them, extracts metadata, and returns the results.
   *
   * @returns Object containing loaded documents and a summary
   * @throws Error if the base directory does not exist
   */
  loadAll(): { documents: LoadedDocument[]; summary: LoadSummary } {
    if (!existsSync(this.baseDir)) {
      throw new Error(`Knowledge base directory does not exist: ${this.baseDir}`);
    }

    const files = this.scanDirectory(this.baseDir);
    const documents: LoadedDocument[] = [];
    const failedPaths: string[] = [];
    const skippedPaths: string[] = [];
    const categoriesSet = new Set<string>();
    let totalWordCount = 0;

    for (const filePath of files) {
      const relativePath = path.relative(this.baseDir, filePath);

      // Validate file size
      const validation = this.validateFile(filePath);
      if (validation === 'skip') {
        skippedPaths.push(relativePath);
        continue;
      }

      // Load the document
      const doc = this.loadDocument(filePath);
      if (doc === null) {
        failedPaths.push(relativePath);
        continue;
      }

      documents.push(doc);
      categoriesSet.add(doc.category);
      totalWordCount += doc.metadata.wordCount;
    }

    const summary: LoadSummary = {
      totalFiles: files.length,
      loaded: documents.length,
      failed: failedPaths.length,
      skipped: skippedPaths.length,
      failedPaths,
      skippedPaths,
      categories: [...categoriesSet].sort(),
      totalWordCount,
    };

    return { documents, summary };
  }

  /**
   * Load a single document from a file path.
   *
   * @param filePath - Absolute path to the file
   * @returns The loaded document, or null if loading failed
   */
  loadSingle(filePath: string): LoadedDocument | null {
    const absolutePath = path.resolve(filePath);
    if (!existsSync(absolutePath)) {
      return null;
    }

    return this.loadDocument(absolutePath);
  }

  /**
   * Load documents from a specific subdirectory.
   *
   * @param subdir - Subdirectory relative to the base directory
   * @returns Object containing loaded documents and a summary
   * @throws Error if the subdirectory does not exist
   */
  loadFromSubdir(subdir: string): { documents: LoadedDocument[]; summary: LoadSummary } {
    const fullPath = path.resolve(this.baseDir, subdir);
    if (!existsSync(fullPath)) {
      throw new Error(`Subdirectory does not exist: ${fullPath}`);
    }

    const originalBaseDir = this.baseDir;
    // Temporarily create a new loader for the subdirectory scope
    const subLoader = new DocumentLoader({
      baseDir: this.baseDir,
      extensions: this.extensions,
      minFileSize: this.minFileSize,
      maxFileSize: this.maxFileSize,
    });

    // Scan only the subdirectory but use the original baseDir for relative paths
    const files = subLoader.scanDirectory(fullPath);
    const documents: LoadedDocument[] = [];
    const failedPaths: string[] = [];
    const skippedPaths: string[] = [];
    const categoriesSet = new Set<string>();
    let totalWordCount = 0;

    for (const filePath of files) {
      const relativePath = path.relative(originalBaseDir, filePath);

      const validation = this.validateFile(filePath);
      if (validation === 'skip') {
        skippedPaths.push(relativePath);
        continue;
      }

      const doc = this.loadDocument(filePath);
      if (doc === null) {
        failedPaths.push(relativePath);
        continue;
      }

      documents.push(doc);
      categoriesSet.add(doc.category);
      totalWordCount += doc.metadata.wordCount;
    }

    return {
      documents,
      summary: {
        totalFiles: files.length,
        loaded: documents.length,
        failed: failedPaths.length,
        skipped: skippedPaths.length,
        failedPaths,
        skippedPaths,
        categories: [...categoriesSet].sort(),
        totalWordCount,
      },
    };
  }

  /**
   * Get the base directory path.
   */
  getBaseDir(): string {
    return this.baseDir;
  }

  /**
   * Get the configured extensions.
   */
  getExtensions(): string[] {
    return [...this.extensions];
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
  // File Validation
  // --------------------------------------------------------------------------

  /**
   * Validate a file for loading.
   *
   * @returns 'ok' if the file should be loaded, 'skip' if it should be skipped
   */
  private validateFile(filePath: string): 'ok' | 'skip' {
    try {
      const stat = statSync(filePath);
      if (stat.size < this.minFileSize) {
        return 'skip';
      }
      if (stat.size > this.maxFileSize) {
        return 'skip';
      }
      return 'ok';
    } catch {
      return 'skip';
    }
  }

  // --------------------------------------------------------------------------
  // Document Loading
  // --------------------------------------------------------------------------

  /**
   * Load a single document from a file path and extract metadata.
   */
  private loadDocument(filePath: string): LoadedDocument | null {
    try {
      const content = readFileSync(filePath, 'utf-8');
      const relativePath = path.relative(this.baseDir, filePath);
      const id = relativePath.replace(/\\/g, '/');
      const title = extractTitle(content, filePath);
      const category = extractCategory(relativePath);
      const metadata = extractMetadata(content, category);

      return { id, title, content, filePath: relativePath, category, metadata };
    } catch {
      return null;
    }
  }
}

// ============================================================================
// Metadata Extraction (exported for testing)
// ============================================================================

/**
 * Extract the title from document content.
 * Uses the first markdown heading, or falls back to the filename.
 */
export function extractTitle(content: string, filePath: string): string {
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
export function extractCategory(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, '/');
  const parts = normalized.split('/');
  return parts.length > 1 ? parts[0] : 'root';
}

/**
 * Extract metadata from document content.
 */
export function extractMetadata(content: string, category: string): DocumentMetadata {
  return {
    sourceUrl: extractSourceUrl(content),
    scrapedAt: extractScrapedAt(content),
    category,
    tags: extractTags(content),
    wordCount: countWords(content),
    charCount: content.length,
    headingCount: countHeadings(content),
    codeBlockCount: countCodeBlocks(content),
  };
}

/**
 * Extract source URL from document metadata header.
 * Looks for `> 来源: URL` or `> Source: URL` patterns.
 */
export function extractSourceUrl(content: string): string | null {
  const match = content.match(/^>\s*(?:来源|Source):\s*(.+)$/m);
  if (match) {
    return match[1].trim();
  }
  return null;
}

/**
 * Extract scraped timestamp from document metadata header.
 * Looks for `> 抓取时间: TIMESTAMP` or `> Scraped: TIMESTAMP` patterns.
 */
export function extractScrapedAt(content: string): string | null {
  const match = content.match(/^>\s*(?:抓取时间|创建时间|Scraped|Created):\s*(.+)$/m);
  if (match) {
    return match[1].trim();
  }
  return null;
}

/**
 * Extract tags from document headings.
 * Uses second-level headings (##) as tags.
 */
export function extractTags(content: string): string[] {
  const headings: string[] = [];
  const regex = /^##\s+(.+)$/gm;
  let match;
  while ((match = regex.exec(content)) !== null) {
    const tag = match[1].trim().toLowerCase();
    if (tag.length > 0 && !headings.includes(tag)) {
      headings.push(tag);
    }
  }
  return headings;
}

/**
 * Count the number of words in the content.
 */
export function countWords(content: string): number {
  const stripped = content
    .replace(/```[\s\S]*?```/g, '') // remove code blocks
    .replace(/`[^`]*`/g, '')        // remove inline code
    .replace(/[#>*_\-|~[\]()]/g, ' '); // remove markdown symbols

  const words = stripped.split(/\s+/).filter((w) => w.length > 0);
  return words.length;
}

/**
 * Count the number of headings in the content.
 */
export function countHeadings(content: string): number {
  const matches = content.match(/^#{1,6}\s+.+$/gm);
  return matches ? matches.length : 0;
}

/**
 * Count the number of fenced code blocks in the content.
 */
export function countCodeBlocks(content: string): number {
  const matches = content.match(/^```/gm);
  // Code blocks come in pairs (opening + closing)
  return matches ? Math.floor(matches.length / 2) : 0;
}
