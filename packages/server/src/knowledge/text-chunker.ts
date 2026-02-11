// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Text chunker for the knowledge base indexing pipeline.
 *
 * Splits loaded documents into smaller chunks suitable for vector embedding,
 * preserving Markdown structure (headings, code blocks, paragraphs).
 *
 * Pipeline: load → **chunk** → embed → store
 *
 * @module knowledge/text-chunker
 */

import type { LoadedDocument } from './document-loader.js';

// ============================================================================
// Types
// ============================================================================

/** A chunk produced from a document */
export interface TextChunk {
  /** Unique chunk identifier: `{documentId}#chunk-{index}` */
  id: string;
  /** The document this chunk belongs to */
  documentId: string;
  /** Zero-based index of this chunk within the document */
  index: number;
  /** The text content of this chunk */
  content: string;
  /** Character count of the chunk content */
  charCount: number;
  /** The heading context for this chunk (closest ancestor headings) */
  headingContext: string;
  /** Category inherited from the source document */
  category: string;
}

/** Summary of a chunking operation */
export interface ChunkSummary {
  /** Total number of documents processed */
  totalDocuments: number;
  /** Total number of chunks produced */
  totalChunks: number;
  /** Average chunk size in characters */
  avgChunkSize: number;
  /** Minimum chunk size in characters */
  minChunkSize: number;
  /** Maximum chunk size in characters */
  maxChunkSize: number;
}

/** Options for the TextChunker */
export interface TextChunkerOptions {
  /** Maximum chunk size in characters (default: 1000) */
  maxChunkSize?: number;
  /** Overlap size in characters between adjacent chunks (default: 100) */
  overlapSize?: number;
  /** Minimum chunk size in characters — chunks smaller than this are merged (default: 50) */
  minChunkSize?: number;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_MAX_CHUNK_SIZE = 1000;
const DEFAULT_OVERLAP_SIZE = 100;
const DEFAULT_MIN_CHUNK_SIZE = 50;

// ============================================================================
// TextChunker
// ============================================================================

/**
 * Text chunker for the knowledge base indexing pipeline.
 *
 * Splits Markdown documents into semantically meaningful chunks by respecting
 * document structure: headings create natural boundaries, code blocks are kept
 * intact when possible, and paragraphs are used as fallback split points.
 *
 * @example
 * ```ts
 * const chunker = new TextChunker({ maxChunkSize: 800 });
 * const { chunks, summary } = chunker.chunkDocuments(documents);
 * console.log(`Produced ${summary.totalChunks} chunks`);
 * ```
 */
export class TextChunker {
  private readonly maxChunkSize: number;
  private readonly overlapSize: number;
  private readonly minChunkSize: number;

  constructor(options: TextChunkerOptions = {}) {
    this.maxChunkSize = options.maxChunkSize ?? DEFAULT_MAX_CHUNK_SIZE;
    this.overlapSize = options.overlapSize ?? DEFAULT_OVERLAP_SIZE;
    this.minChunkSize = options.minChunkSize ?? DEFAULT_MIN_CHUNK_SIZE;

    if (this.maxChunkSize <= 0) {
      throw new Error('maxChunkSize must be positive');
    }
    if (this.overlapSize < 0) {
      throw new Error('overlapSize must be non-negative');
    }
    if (this.overlapSize >= this.maxChunkSize) {
      throw new Error('overlapSize must be less than maxChunkSize');
    }
    if (this.minChunkSize < 0) {
      throw new Error('minChunkSize must be non-negative');
    }
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  /**
   * Chunk multiple documents at once.
   *
   * @param documents - Array of loaded documents to chunk
   * @returns Object containing all chunks and a summary
   */
  chunkDocuments(documents: LoadedDocument[]): { chunks: TextChunk[]; summary: ChunkSummary } {
    const allChunks: TextChunk[] = [];

    for (const doc of documents) {
      const docChunks = this.chunkDocument(doc);
      allChunks.push(...docChunks);
    }

    const summary = buildSummary(documents.length, allChunks);
    return { chunks: allChunks, summary };
  }

  /**
   * Chunk a single document.
   *
   * @param document - The document to chunk
   * @returns Array of chunks produced from the document
   */
  chunkDocument(document: LoadedDocument): TextChunk[] {
    const { content, id: documentId, category } = document;

    if (content.trim().length === 0) {
      return [];
    }

    // Split by Markdown structure
    const sections = splitByHeadings(content);

    // Process each section into chunks
    const rawChunks: Array<{ content: string; headingContext: string }> = [];

    for (const section of sections) {
      const sectionChunks = this.splitSection(section.content, section.heading);
      rawChunks.push(...sectionChunks);
    }

    // Merge small chunks
    const merged = this.mergeSmallChunks(rawChunks);

    // Build final chunks with IDs
    return merged.map((raw, index) => ({
      id: `${documentId}#chunk-${index}`,
      documentId,
      index,
      content: raw.content,
      charCount: raw.content.length,
      headingContext: raw.headingContext,
      category,
    }));
  }

  // --------------------------------------------------------------------------
  // Internal: Section splitting
  // --------------------------------------------------------------------------

  /**
   * Split a section into chunks respecting maxChunkSize.
   * Tries to split at paragraph boundaries first, then at sentence boundaries.
   */
  private splitSection(
    content: string,
    heading: string,
  ): Array<{ content: string; headingContext: string }> {
    const trimmed = content.trim();
    if (trimmed.length === 0) {
      return [];
    }

    // If the section fits in one chunk, return it directly
    if (trimmed.length <= this.maxChunkSize) {
      return [{ content: trimmed, headingContext: heading }];
    }

    // Split into blocks (paragraphs & code blocks)
    const blocks = splitIntoBlocks(trimmed);
    const chunks: Array<{ content: string; headingContext: string }> = [];
    let currentContent = '';

    for (const block of blocks) {
      // If a single block exceeds maxChunkSize, force-split it
      if (block.length > this.maxChunkSize) {
        // Flush current buffer first
        if (currentContent.trim().length > 0) {
          chunks.push({ content: currentContent.trim(), headingContext: heading });
          currentContent = this.getOverlapText(currentContent.trim());
        }
        // Force-split the large block
        const forceSplit = this.forceSplitText(block);
        for (const part of forceSplit) {
          chunks.push({ content: part.trim(), headingContext: heading });
        }
        currentContent = this.getOverlapText(forceSplit[forceSplit.length - 1].trim());
        continue;
      }

      // Check if adding this block would exceed the limit
      const separator = currentContent.length > 0 ? '\n\n' : '';
      const candidate = currentContent + separator + block;

      if (candidate.length > this.maxChunkSize && currentContent.trim().length > 0) {
        // Flush current chunk
        chunks.push({ content: currentContent.trim(), headingContext: heading });
        currentContent = this.getOverlapText(currentContent.trim()) + '\n\n' + block;
      } else {
        currentContent = candidate;
      }
    }

    // Flush remaining content
    if (currentContent.trim().length > 0) {
      chunks.push({ content: currentContent.trim(), headingContext: heading });
    }

    return chunks;
  }

  /**
   * Force-split a text that exceeds maxChunkSize.
   * Tries to split at sentence boundaries, then at word boundaries.
   */
  private forceSplitText(text: string): string[] {
    const parts: string[] = [];
    let remaining = text;

    while (remaining.length > this.maxChunkSize) {
      // Try to find a sentence boundary
      let splitPos = findSentenceBoundary(remaining, this.maxChunkSize);
      if (splitPos <= 0) {
        // Fall back to word boundary
        splitPos = findWordBoundary(remaining, this.maxChunkSize);
      }
      if (splitPos <= 0) {
        // Last resort: hard split
        splitPos = this.maxChunkSize;
      }

      parts.push(remaining.slice(0, splitPos));
      const overlapStart = Math.max(0, splitPos - this.overlapSize);
      remaining = remaining.slice(overlapStart);
    }

    if (remaining.length > 0) {
      parts.push(remaining);
    }

    return parts;
  }

  /**
   * Get overlap text from the end of a chunk.
   */
  private getOverlapText(text: string): string {
    if (this.overlapSize === 0 || text.length === 0) {
      return '';
    }
    if (text.length <= this.overlapSize) {
      return text;
    }
    const overlapText = text.slice(-this.overlapSize);
    // Try to start at a word boundary
    const wordBound = overlapText.indexOf(' ');
    if (wordBound > 0 && wordBound < overlapText.length - 1) {
      return overlapText.slice(wordBound + 1);
    }
    return overlapText;
  }

  /**
   * Merge chunks smaller than minChunkSize into adjacent chunks.
   */
  private mergeSmallChunks(
    chunks: Array<{ content: string; headingContext: string }>,
  ): Array<{ content: string; headingContext: string }> {
    if (chunks.length <= 1) {
      return chunks;
    }

    const merged: Array<{ content: string; headingContext: string }> = [];

    for (const chunk of chunks) {
      if (
        merged.length > 0 &&
        chunk.content.length < this.minChunkSize
      ) {
        // Merge with previous chunk
        const prev = merged[merged.length - 1];
        prev.content = prev.content + '\n\n' + chunk.content;
      } else if (
        merged.length > 0 &&
        merged[merged.length - 1].content.length < this.minChunkSize
      ) {
        // Previous chunk is too small, merge this into it
        const prev = merged[merged.length - 1];
        prev.content = prev.content + '\n\n' + chunk.content;
        prev.headingContext = chunk.headingContext || prev.headingContext;
      } else {
        merged.push({ ...chunk });
      }
    }

    return merged;
  }
}

// ============================================================================
// Utility Functions (exported for testing)
// ============================================================================

/** A parsed section from a Markdown document */
export interface MarkdownSection {
  /** The heading text (e.g., "## Installation") or empty string for preamble */
  heading: string;
  /** The content of the section (including the heading line) */
  content: string;
}

/**
 * Split Markdown content by headings into sections.
 *
 * Each section starts at a heading and includes all content until the next
 * heading of the same or higher level. Content before the first heading is
 * grouped as a "preamble" section with an empty heading.
 */
export function splitByHeadings(content: string): MarkdownSection[] {
  const lines = content.split('\n');
  const sections: MarkdownSection[] = [];
  let currentHeading = '';
  let currentLines: string[] = [];

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);

    if (headingMatch) {
      // Save the current section if it has content
      if (currentLines.length > 0) {
        const sectionContent = currentLines.join('\n').trim();
        if (sectionContent.length > 0) {
          sections.push({ heading: currentHeading, content: sectionContent });
        }
      }
      // Start a new section
      currentHeading = headingMatch[2].trim();
      currentLines = [line];
    } else {
      currentLines.push(line);
    }
  }

  // Flush the last section
  if (currentLines.length > 0) {
    const sectionContent = currentLines.join('\n').trim();
    if (sectionContent.length > 0) {
      sections.push({ heading: currentHeading, content: sectionContent });
    }
  }

  return sections;
}

/**
 * Split text into blocks: paragraphs and fenced code blocks.
 *
 * Code blocks (``` ... ```) are kept as single blocks.
 * Consecutive non-empty lines form paragraphs.
 * Blocks are separated by blank lines.
 */
export function splitIntoBlocks(text: string): string[] {
  const lines = text.split('\n');
  const blocks: string[] = [];
  let currentBlock: string[] = [];
  let inCodeBlock = false;

  for (const line of lines) {
    if (line.trimStart().startsWith('```')) {
      if (!inCodeBlock) {
        // Flush any current paragraph before starting code block
        if (currentBlock.length > 0) {
          const block = currentBlock.join('\n').trim();
          if (block.length > 0) {
            blocks.push(block);
          }
          currentBlock = [];
        }
        // Start code block
        inCodeBlock = true;
        currentBlock.push(line);
      } else {
        // End code block
        currentBlock.push(line);
        blocks.push(currentBlock.join('\n'));
        currentBlock = [];
        inCodeBlock = false;
      }
      continue;
    }

    if (inCodeBlock) {
      currentBlock.push(line);
      continue;
    }

    // Outside code block: split on blank lines
    if (line.trim() === '') {
      if (currentBlock.length > 0) {
        const block = currentBlock.join('\n').trim();
        if (block.length > 0) {
          blocks.push(block);
        }
        currentBlock = [];
      }
    } else {
      currentBlock.push(line);
    }
  }

  // Flush remaining
  if (currentBlock.length > 0) {
    const block = currentBlock.join('\n').trim();
    if (block.length > 0) {
      blocks.push(block);
    }
  }

  return blocks;
}

/**
 * Find the best sentence boundary position before maxPos.
 * Returns the position right after the sentence-ending punctuation.
 */
export function findSentenceBoundary(text: string, maxPos: number): number {
  const searchArea = text.slice(0, maxPos);
  // Look for sentence-ending punctuation followed by a space,
  // or Chinese punctuation followed by any character (Chinese has no spaces)
  const sentenceEnders = /[.!?]\s|[。！？]/g;
  let lastMatch = -1;
  let match;

  while ((match = sentenceEnders.exec(searchArea)) !== null) {
    lastMatch = match.index + match[0].length;
  }

  return lastMatch;
}

/**
 * Find the best word boundary position before maxPos.
 * Returns the position right after the last space before maxPos.
 */
export function findWordBoundary(text: string, maxPos: number): number {
  const searchArea = text.slice(0, maxPos);
  const lastSpace = searchArea.lastIndexOf(' ');
  return lastSpace > 0 ? lastSpace + 1 : -1;
}

// ============================================================================
// Summary Builder
// ============================================================================

/**
 * Build a summary of a chunking operation.
 */
function buildSummary(totalDocuments: number, chunks: TextChunk[]): ChunkSummary {
  if (chunks.length === 0) {
    return {
      totalDocuments,
      totalChunks: 0,
      avgChunkSize: 0,
      minChunkSize: 0,
      maxChunkSize: 0,
    };
  }

  const sizes = chunks.map((c) => c.charCount);
  const totalSize = sizes.reduce((a, b) => a + b, 0);

  return {
    totalDocuments,
    totalChunks: chunks.length,
    avgChunkSize: Math.round(totalSize / chunks.length),
    minChunkSize: Math.min(...sizes),
    maxChunkSize: Math.max(...sizes),
  };
}
