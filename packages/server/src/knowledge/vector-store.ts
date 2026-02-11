// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Vector database storage module for the knowledge base indexing pipeline.
 *
 * Stores embedded chunks into a vector database and provides similarity search.
 * Supports multiple backends via a pluggable interface.
 *
 * Pipeline: load → chunk → embed → **store**
 *
 * Built-in backends:
 * - **local**: In-memory vector store with cosine similarity (default)
 *
 * @module knowledge/vector-store
 */

import type { EmbeddedChunk } from './embedding-generator.js';
import { cosineSimilarity } from './embedding-generator.js';
import type { VectorDBBackend } from './vector-db-selector.js';

// ============================================================================
// Types
// ============================================================================

/** A stored vector record in the database */
export interface VectorRecord {
  /** Unique record ID (same as chunkId) */
  id: string;
  /** Document ID this record belongs to */
  documentId: string;
  /** The text content */
  content: string;
  /** The vector embedding */
  embedding: number[];
  /** Embedding vector dimension */
  dimension: number;
  /** Document category */
  category: string;
  /** Heading context from the original chunk */
  headingContext: string;
}

/** A search result from the vector store */
export interface VectorSearchResult {
  /** The matching record */
  record: VectorRecord;
  /** Similarity score (0 to 1) */
  score: number;
}

/** Options for similarity search */
export interface SearchOptions {
  /** Maximum number of results to return (default: 5) */
  maxResults?: number;
  /** Minimum similarity threshold (default: 0.01) */
  minScore?: number;
  /** Filter by category */
  category?: string;
  /** Filter by document ID */
  documentId?: string;
}

/** Summary of a store operation */
export interface StoreSummary {
  /** Total records attempted to store */
  totalRecords: number;
  /** Number of records successfully stored */
  stored: number;
  /** Number of records that failed */
  failed: number;
  /** Backend used */
  backend: VectorDBBackend;
  /** Duration in milliseconds */
  durationMs: number;
}

/** Statistics about the vector store */
export interface StoreStats {
  /** Total number of records */
  totalRecords: number;
  /** Number of unique documents */
  uniqueDocuments: number;
  /** Embedding dimension */
  dimension: number;
  /** Backend identifier */
  backend: VectorDBBackend;
}

// ============================================================================
// VectorStore Interface
// ============================================================================

/**
 * Interface for vector database backends.
 *
 * Implement this interface to add support for new vector database backends
 * (e.g., Qdrant, Pinecone).
 */
export interface VectorStore {
  /** Get the backend identifier */
  getBackend(): VectorDBBackend;

  /**
   * Store a batch of embedded chunks.
   *
   * If a record with the same ID already exists, it is replaced (upsert).
   *
   * @param chunks - Array of embedded chunks to store
   * @returns Storage summary
   */
  upsert(chunks: EmbeddedChunk[]): Promise<StoreSummary>;

  /**
   * Search for similar vectors.
   *
   * @param queryEmbedding - The query vector
   * @param options - Search options
   * @returns Array of search results sorted by score (descending)
   */
  search(queryEmbedding: number[], options?: SearchOptions): Promise<VectorSearchResult[]>;

  /**
   * Delete records by their IDs.
   *
   * @param ids - Array of record IDs to delete
   * @returns Number of records actually deleted
   */
  delete(ids: string[]): Promise<number>;

  /**
   * Delete all records belonging to a document.
   *
   * @param documentId - Document ID whose records should be deleted
   * @returns Number of records deleted
   */
  deleteByDocument(documentId: string): Promise<number>;

  /**
   * Get a record by its ID.
   *
   * @param id - Record ID
   * @returns The record if found, null otherwise
   */
  get(id: string): Promise<VectorRecord | null>;

  /**
   * Get statistics about the store.
   *
   * @returns Store statistics
   */
  getStats(): Promise<StoreStats>;

  /**
   * Remove all records from the store.
   */
  clear(): Promise<void>;
}

// ============================================================================
// LocalVectorStore
// ============================================================================

/**
 * In-memory vector store using cosine similarity search.
 *
 * Stores vectors in a Map and performs brute-force cosine similarity
 * search. Suitable for small-to-medium knowledge bases (up to ~1000 docs).
 *
 * @example
 * ```ts
 * const store = new LocalVectorStore();
 * await store.upsert(embeddedChunks);
 * const results = await store.search(queryVector, { maxResults: 5 });
 * ```
 */
export class LocalVectorStore implements VectorStore {
  private records: Map<string, VectorRecord> = new Map();

  getBackend(): VectorDBBackend {
    return 'local';
  }

  async upsert(chunks: EmbeddedChunk[]): Promise<StoreSummary> {
    const startTime = Date.now();
    let stored = 0;
    let failed = 0;

    for (const chunk of chunks) {
      try {
        const record: VectorRecord = {
          id: chunk.chunkId,
          documentId: chunk.documentId,
          content: chunk.content,
          embedding: chunk.embedding,
          dimension: chunk.dimension,
          category: chunk.category,
          headingContext: chunk.headingContext,
        };
        this.records.set(record.id, record);
        stored++;
      } catch {
        failed++;
      }
    }

    return {
      totalRecords: chunks.length,
      stored,
      failed,
      backend: 'local',
      durationMs: Date.now() - startTime,
    };
  }

  async search(queryEmbedding: number[], options: SearchOptions = {}): Promise<VectorSearchResult[]> {
    const maxResults = options.maxResults ?? 5;
    const minScore = options.minScore ?? 0.01;

    const results: VectorSearchResult[] = [];

    for (const record of this.records.values()) {
      // Apply filters
      if (options.category && record.category !== options.category) {
        continue;
      }
      if (options.documentId && record.documentId !== options.documentId) {
        continue;
      }

      // Dimension mismatch check
      if (queryEmbedding.length !== record.embedding.length) {
        continue;
      }

      const score = cosineSimilarity(queryEmbedding, record.embedding);

      if (score >= minScore) {
        results.push({ record, score });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, maxResults);
  }

  async delete(ids: string[]): Promise<number> {
    let deleted = 0;
    for (const id of ids) {
      if (this.records.delete(id)) {
        deleted++;
      }
    }
    return deleted;
  }

  async deleteByDocument(documentId: string): Promise<number> {
    let deleted = 0;
    for (const [id, record] of this.records) {
      if (record.documentId === documentId) {
        this.records.delete(id);
        deleted++;
      }
    }
    return deleted;
  }

  async get(id: string): Promise<VectorRecord | null> {
    return this.records.get(id) ?? null;
  }

  async getStats(): Promise<StoreStats> {
    const uniqueDocs = new Set<string>();
    let dimension = 0;

    for (const record of this.records.values()) {
      uniqueDocs.add(record.documentId);
      if (dimension === 0 && record.dimension > 0) {
        dimension = record.dimension;
      }
    }

    return {
      totalRecords: this.records.size,
      uniqueDocuments: uniqueDocs.size,
      dimension,
      backend: 'local',
    };
  }

  async clear(): Promise<void> {
    this.records.clear();
  }
}

// ============================================================================
// VectorStoreFactory
// ============================================================================

/**
 * Create a vector store instance for the given backend.
 *
 * Currently only 'local' is fully implemented. 'qdrant' and 'pinecone'
 * backends will throw an error indicating they are not yet implemented,
 * with a fallback to local if `fallbackToLocal` is true.
 *
 * @param backend - The vector database backend to use
 * @param fallbackToLocal - Whether to fall back to local if the backend is unavailable (default: true)
 * @returns A VectorStore instance
 */
export function createVectorStore(
  backend: VectorDBBackend,
  fallbackToLocal = true,
): VectorStore {
  switch (backend) {
    case 'local':
      return new LocalVectorStore();

    case 'qdrant':
    case 'pinecone':
      if (fallbackToLocal) {
        return new LocalVectorStore();
      }
      throw new Error(
        `Vector store backend '${backend}' is not yet implemented. ` +
        `Set fallbackToLocal=true to use the local in-memory store instead.`,
      );

    default:
      throw new Error(`Unknown vector store backend: ${backend as string}`);
  }
}

// ============================================================================
// Pipeline Helper
// ============================================================================

/**
 * Store embedded chunks into a vector store (pipeline convenience function).
 *
 * This is the final step of the indexing pipeline:
 * load → chunk → embed → **store**
 *
 * @param chunks - Array of embedded chunks from the EmbeddingGenerator
 * @param store - The vector store to use
 * @returns Storage summary
 *
 * @example
 * ```ts
 * const store = createVectorStore('local');
 * const summary = await storeEmbeddings(embeddedChunks, store);
 * console.log(`Stored ${summary.stored} records`);
 * ```
 */
export async function storeEmbeddings(
  chunks: EmbeddedChunk[],
  store: VectorStore,
): Promise<StoreSummary> {
  return store.upsert(chunks);
}
