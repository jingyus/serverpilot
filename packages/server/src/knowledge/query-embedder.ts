// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Query embedding generator for the knowledge base search pipeline.
 *
 * Converts user queries into vector embeddings for similarity search
 * against the stored knowledge base vectors.
 *
 * Search pipeline: **query → embed** → search → rank → return
 *
 * Features:
 * - Query text preprocessing (normalization, cleanup)
 * - Embedding generation via pluggable provider
 * - Query expansion with synonyms/related terms
 * - Caching of recent query embeddings
 *
 * @module knowledge/query-embedder
 */

import type { EmbeddingProvider } from './embedding-generator.js';
import { tokenize } from './embedding-generator.js';

// ============================================================================
// Types
// ============================================================================

/** Result of generating a query embedding */
export interface QueryEmbeddingResult {
  /** The original query text */
  originalQuery: string;
  /** The preprocessed query text (after normalization) */
  processedQuery: string;
  /** The computed embedding vector */
  embedding: number[];
  /** Embedding vector dimension */
  dimension: number;
  /** Whether the result was served from cache */
  cached: boolean;
  /** Processing time in milliseconds */
  durationMs: number;
}

/** Options for query preprocessing */
export interface QueryPreprocessOptions {
  /** Convert query to lowercase (default: true) */
  lowercase?: boolean;
  /** Remove extra whitespace (default: true) */
  trimWhitespace?: boolean;
  /** Expand query with synonyms (default: false) */
  expandSynonyms?: boolean;
  /** Minimum query length to process (default: 1) */
  minQueryLength?: number;
}

/** Configuration for the QueryEmbedder */
export interface QueryEmbedderConfig {
  /** The embedding provider to use */
  provider: EmbeddingProvider;
  /** Preprocessing options */
  preprocessOptions?: QueryPreprocessOptions;
  /** Maximum cache size (0 = no caching, default: 100) */
  maxCacheSize?: number;
}

/** A cached query embedding entry */
interface CacheEntry {
  embedding: number[];
  dimension: number;
  timestamp: number;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_MAX_CACHE_SIZE = 100;
const DEFAULT_MIN_QUERY_LENGTH = 1;

/**
 * Common synonym mappings for installation-related queries.
 *
 * These help expand short queries to match more relevant documents.
 */
const SYNONYM_MAP: Record<string, string[]> = {
  'install': ['setup', 'configure', 'deploy'],
  'error': ['failure', 'failed', 'issue', 'problem', 'bug'],
  'timeout': ['slow', 'hang', 'stuck', 'waiting'],
  'permission': ['access', 'denied', 'forbidden', 'eacces'],
  'version': ['compatibility', 'mismatch', 'upgrade', 'downgrade'],
  'network': ['connection', 'proxy', 'dns', 'registry'],
  'npm': ['package', 'dependency', 'module'],
  'node': ['nodejs', 'runtime'],
};

// ============================================================================
// QueryEmbedder
// ============================================================================

/**
 * Generates embeddings for user search queries.
 *
 * Handles query preprocessing, embedding generation, and optional caching
 * to improve search performance.
 *
 * @example
 * ```ts
 * const provider = new TfIdfEmbeddingProvider();
 * provider.buildVocabulary(corpusTexts);
 *
 * const embedder = new QueryEmbedder({ provider });
 * const result = await embedder.embedQuery('npm install timeout');
 * // Use result.embedding for vector similarity search
 * ```
 */
export class QueryEmbedder {
  private readonly provider: EmbeddingProvider;
  private readonly preprocessOptions: Required<QueryPreprocessOptions>;
  private readonly maxCacheSize: number;
  private readonly cache: Map<string, CacheEntry> = new Map();

  constructor(config: QueryEmbedderConfig) {
    this.provider = config.provider;
    this.maxCacheSize = config.maxCacheSize ?? DEFAULT_MAX_CACHE_SIZE;
    this.preprocessOptions = {
      lowercase: config.preprocessOptions?.lowercase ?? true,
      trimWhitespace: config.preprocessOptions?.trimWhitespace ?? true,
      expandSynonyms: config.preprocessOptions?.expandSynonyms ?? false,
      minQueryLength: config.preprocessOptions?.minQueryLength ?? DEFAULT_MIN_QUERY_LENGTH,
    };
  }

  /**
   * Generate an embedding for a search query.
   *
   * @param query - The user's search query text
   * @returns Query embedding result with vector, metadata, and timing
   * @throws Error if the query is too short after preprocessing
   */
  async embedQuery(query: string): Promise<QueryEmbeddingResult> {
    const startTime = Date.now();

    // Step 1: Preprocess the query
    const processedQuery = this.preprocessQuery(query);

    // Step 2: Validate
    if (processedQuery.length < this.preprocessOptions.minQueryLength) {
      throw new Error(
        `Query too short: "${processedQuery}" (min ${this.preprocessOptions.minQueryLength} chars)`,
      );
    }

    // Step 3: Check cache
    if (this.maxCacheSize > 0) {
      const cached = this.cache.get(processedQuery);
      if (cached) {
        return {
          originalQuery: query,
          processedQuery,
          embedding: cached.embedding,
          dimension: cached.dimension,
          cached: true,
          durationMs: Date.now() - startTime,
        };
      }
    }

    // Step 4: Generate embedding
    const embedding = await this.provider.embed(processedQuery);
    const dimension = embedding.length;

    // Step 5: Cache the result
    if (this.maxCacheSize > 0) {
      this.addToCache(processedQuery, { embedding, dimension, timestamp: Date.now() });
    }

    return {
      originalQuery: query,
      processedQuery,
      embedding,
      dimension,
      cached: false,
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * Generate embeddings for multiple queries in batch.
   *
   * @param queries - Array of query texts
   * @returns Array of query embedding results (same order as input)
   */
  async embedQueries(queries: string[]): Promise<QueryEmbeddingResult[]> {
    const results: QueryEmbeddingResult[] = [];
    for (const query of queries) {
      results.push(await this.embedQuery(query));
    }
    return results;
  }

  /**
   * Preprocess a query string for embedding.
   *
   * Applies normalization, whitespace cleanup, and optional synonym expansion.
   *
   * @param query - The raw query text
   * @returns The preprocessed query text
   */
  preprocessQuery(query: string): string {
    let processed = query;

    if (this.preprocessOptions.lowercase) {
      processed = processed.toLowerCase();
    }

    if (this.preprocessOptions.trimWhitespace) {
      processed = processed.replace(/\s+/g, ' ').trim();
    }

    if (this.preprocessOptions.expandSynonyms) {
      processed = expandWithSynonyms(processed);
    }

    return processed;
  }

  /**
   * Clear the query embedding cache.
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get the current cache size.
   */
  getCacheSize(): number {
    return this.cache.size;
  }

  /**
   * Get the embedding provider configuration.
   */
  getProviderConfig() {
    return this.provider.getConfig();
  }

  /**
   * Add an entry to the cache, evicting the oldest entry if at capacity.
   */
  private addToCache(key: string, entry: CacheEntry): void {
    // Evict oldest entry if at capacity
    if (this.cache.size >= this.maxCacheSize) {
      let oldestKey: string | undefined;
      let oldestTime = Infinity;

      for (const [k, v] of this.cache) {
        if (v.timestamp < oldestTime) {
          oldestTime = v.timestamp;
          oldestKey = k;
        }
      }

      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      }
    }

    this.cache.set(key, entry);
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Expand a query string with synonyms from the synonym map.
 *
 * For each word in the query that has known synonyms, appends
 * the synonyms to the query text.
 *
 * @param query - The query text to expand
 * @returns The expanded query text
 */
export function expandWithSynonyms(query: string): string {
  const tokens = tokenize(query);
  const additions: string[] = [];

  for (const token of tokens) {
    const synonyms = SYNONYM_MAP[token];
    if (synonyms) {
      additions.push(...synonyms);
    }
  }

  if (additions.length === 0) {
    return query;
  }

  return `${query} ${additions.join(' ')}`;
}

/**
 * Get all available synonym mappings.
 *
 * @returns A copy of the synonym map
 */
export function getSynonymMap(): Record<string, string[]> {
  return { ...SYNONYM_MAP };
}
