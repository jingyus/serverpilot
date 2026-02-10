/**
 * Similarity search module for the knowledge base search pipeline.
 *
 * Orchestrates the full search flow: query preprocessing, embedding generation,
 * vector similarity search, and result ranking/filtering.
 *
 * Search pipeline: query → embed → **search → rank → return**
 *
 * @module knowledge/similarity-search
 */

import type { QueryEmbedder, QueryEmbeddingResult } from './query-embedder.js';
import type { VectorStore, VectorSearchResult, SearchOptions } from './vector-store.js';

// ============================================================================
// Types
// ============================================================================

/** A single search result with full context */
export interface SimilarityResult {
  /** Unique record ID */
  id: string;
  /** Document ID this result belongs to */
  documentId: string;
  /** The matched text content */
  content: string;
  /** Similarity score (0 to 1) */
  score: number;
  /** Document category (e.g., 'docs', 'issues', 'solutions') */
  category: string;
  /** Heading context from the original chunk */
  headingContext: string;
}

/** Options for similarity search */
export interface SimilaritySearchOptions {
  /** Maximum number of results to return (default: 5) */
  maxResults?: number;
  /** Minimum similarity score threshold (default: 0.01) */
  minScore?: number;
  /** Filter by document category */
  category?: string;
  /** Filter by document ID */
  documentId?: string;
  /** Whether to deduplicate results from the same document (default: false) */
  deduplicateByDocument?: boolean;
  /** Maximum results per document when deduplicating (default: 1) */
  maxPerDocument?: number;
}

/** Summary of a search operation */
export interface SearchSummary {
  /** The original user query */
  query: string;
  /** The preprocessed query */
  processedQuery: string;
  /** Total number of results found (before limiting) */
  totalFound: number;
  /** Number of results returned */
  returned: number;
  /** Whether the query embedding was served from cache */
  embeddingCached: boolean;
  /** Total search duration in milliseconds */
  durationMs: number;
}

/** Full search response including results and metadata */
export interface SearchResponse {
  /** The search results, sorted by score descending */
  results: SimilarityResult[];
  /** Search operation summary */
  summary: SearchSummary;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_MAX_RESULTS = 5;
const DEFAULT_MIN_SCORE = 0.01;
const DEFAULT_MAX_PER_DOCUMENT = 1;

// ============================================================================
// SimilaritySearch
// ============================================================================

/**
 * High-level similarity search engine for the knowledge base.
 *
 * Combines query embedding and vector store search into a single API.
 * Supports filtering, deduplication, and result ranking.
 *
 * @example
 * ```ts
 * const search = new SimilaritySearch({ queryEmbedder, vectorStore });
 * const response = await search.search('npm install timeout');
 * for (const result of response.results) {
 *   console.log(`[${result.score.toFixed(2)}] ${result.headingContext}`);
 *   console.log(result.content);
 * }
 * ```
 */
export class SimilaritySearch {
  private readonly queryEmbedder: QueryEmbedder;
  private readonly vectorStore: VectorStore;

  constructor(config: SimilaritySearchConfig) {
    this.queryEmbedder = config.queryEmbedder;
    this.vectorStore = config.vectorStore;
  }

  /**
   * Perform a similarity search against the knowledge base.
   *
   * @param query - The user's search query text
   * @param options - Search options (filters, limits, deduplication)
   * @returns Search response with results and summary
   */
  async search(query: string, options: SimilaritySearchOptions = {}): Promise<SearchResponse> {
    const startTime = Date.now();

    // Step 1: Generate query embedding
    const embeddingResult = await this.queryEmbedder.embedQuery(query);

    // Step 2: Search the vector store
    const storeOptions: SearchOptions = {
      maxResults: options.deduplicateByDocument
        ? (options.maxResults ?? DEFAULT_MAX_RESULTS) * 3 // Fetch more to allow deduplication
        : (options.maxResults ?? DEFAULT_MAX_RESULTS),
      minScore: options.minScore ?? DEFAULT_MIN_SCORE,
      category: options.category,
      documentId: options.documentId,
    };

    const rawResults = await this.vectorStore.search(embeddingResult.embedding, storeOptions);

    // Step 3: Transform results
    let results = rawResults.map((r) => toSimilarityResult(r));

    // Step 4: Deduplicate by document if requested
    if (options.deduplicateByDocument) {
      results = deduplicateByDocument(results, options.maxPerDocument ?? DEFAULT_MAX_PER_DOCUMENT);
    }

    // Step 5: Limit results
    const maxResults = options.maxResults ?? DEFAULT_MAX_RESULTS;
    const totalFound = results.length;
    results = results.slice(0, maxResults);

    const durationMs = Date.now() - startTime;

    return {
      results,
      summary: buildSummary(query, embeddingResult, totalFound, results.length, durationMs),
    };
  }

  /**
   * Search with multiple queries and merge results.
   *
   * Useful for expanding a search with related terms or for multi-faceted queries.
   * Results are merged by highest score per record and re-sorted.
   *
   * @param queries - Array of query texts
   * @param options - Search options applied to each query
   * @returns Merged search response
   */
  async searchMultiple(
    queries: string[],
    options: SimilaritySearchOptions = {},
  ): Promise<SearchResponse> {
    if (queries.length === 0) {
      return {
        results: [],
        summary: {
          query: '',
          processedQuery: '',
          totalFound: 0,
          returned: 0,
          embeddingCached: false,
          durationMs: 0,
        },
      };
    }

    if (queries.length === 1) {
      return this.search(queries[0], options);
    }

    const startTime = Date.now();

    // Run all queries
    const allResults = new Map<string, SimilarityResult>();
    let anyCached = false;
    const processedQueries: string[] = [];

    for (const query of queries) {
      const response = await this.search(query, {
        ...options,
        maxResults: (options.maxResults ?? DEFAULT_MAX_RESULTS) * 2,
        deduplicateByDocument: false,
      });

      if (response.summary.embeddingCached) {
        anyCached = true;
      }
      processedQueries.push(response.summary.processedQuery);

      // Merge: keep highest score per record
      for (const result of response.results) {
        const existing = allResults.get(result.id);
        if (!existing || result.score > existing.score) {
          allResults.set(result.id, result);
        }
      }
    }

    // Sort merged results by score
    let merged = [...allResults.values()].sort((a, b) => b.score - a.score);

    // Deduplicate if requested
    if (options.deduplicateByDocument) {
      merged = deduplicateByDocument(merged, options.maxPerDocument ?? DEFAULT_MAX_PER_DOCUMENT);
    }

    const maxResults = options.maxResults ?? DEFAULT_MAX_RESULTS;
    const totalFound = merged.length;
    merged = merged.slice(0, maxResults);

    const durationMs = Date.now() - startTime;

    return {
      results: merged,
      summary: {
        query: queries.join(' | '),
        processedQuery: processedQueries.join(' | '),
        totalFound,
        returned: merged.length,
        embeddingCached: anyCached,
        durationMs,
      },
    };
  }

  /**
   * Find documents similar to a given document.
   *
   * Retrieves the document's chunks from the store, averages their embeddings,
   * and searches for similar content.
   *
   * @param documentId - The ID of the source document
   * @param options - Search options
   * @returns Search response excluding the source document
   */
  async findSimilarDocuments(
    documentId: string,
    options: SimilaritySearchOptions = {},
  ): Promise<SearchResponse> {
    const startTime = Date.now();

    // Get the store stats to iterate through records
    const storeStats = await this.vectorStore.getStats();
    if (storeStats.totalRecords === 0) {
      return {
        results: [],
        summary: {
          query: `similar:${documentId}`,
          processedQuery: documentId,
          totalFound: 0,
          returned: 0,
          embeddingCached: false,
          durationMs: Date.now() - startTime,
        },
      };
    }

    // Search using the document's own embedding by first retrieving it
    // We search the store for entries matching this documentId to get an embedding
    const docResults = await this.vectorStore.search(
      new Array(storeStats.dimension).fill(0),
      { documentId, maxResults: 100, minScore: 0 },
    );

    if (docResults.length === 0) {
      return {
        results: [],
        summary: {
          query: `similar:${documentId}`,
          processedQuery: documentId,
          totalFound: 0,
          returned: 0,
          embeddingCached: false,
          durationMs: Date.now() - startTime,
        },
      };
    }

    // Average the embeddings from all chunks of the document
    const avgEmbedding = averageEmbeddings(docResults.map((r) => r.record.embedding));

    // Search with the averaged embedding, excluding the source document
    const searchOptions: SearchOptions = {
      maxResults: (options.maxResults ?? DEFAULT_MAX_RESULTS) * 2,
      minScore: options.minScore ?? DEFAULT_MIN_SCORE,
      category: options.category,
    };

    const rawResults = await this.vectorStore.search(avgEmbedding, searchOptions);

    // Filter out results from the source document
    let results = rawResults
      .filter((r) => r.record.documentId !== documentId)
      .map((r) => toSimilarityResult(r));

    if (options.deduplicateByDocument) {
      results = deduplicateByDocument(results, options.maxPerDocument ?? DEFAULT_MAX_PER_DOCUMENT);
    }

    const maxResults = options.maxResults ?? DEFAULT_MAX_RESULTS;
    const totalFound = results.length;
    results = results.slice(0, maxResults);

    const durationMs = Date.now() - startTime;

    return {
      results,
      summary: {
        query: `similar:${documentId}`,
        processedQuery: documentId,
        totalFound,
        returned: results.length,
        embeddingCached: false,
        durationMs,
      },
    };
  }
}

/** Configuration for SimilaritySearch */
export interface SimilaritySearchConfig {
  /** The query embedder for converting queries to vectors */
  queryEmbedder: QueryEmbedder;
  /** The vector store to search against */
  vectorStore: VectorStore;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Convert a VectorSearchResult to a SimilarityResult.
 */
function toSimilarityResult(result: VectorSearchResult): SimilarityResult {
  return {
    id: result.record.id,
    documentId: result.record.documentId,
    content: result.record.content,
    score: result.score,
    category: result.record.category,
    headingContext: result.record.headingContext,
  };
}

/**
 * Deduplicate results by document, keeping only the top N per document.
 *
 * @param results - Sorted results (by score descending)
 * @param maxPerDocument - Maximum results to keep per document
 * @returns Deduplicated results maintaining score order
 */
export function deduplicateByDocument(
  results: SimilarityResult[],
  maxPerDocument: number,
): SimilarityResult[] {
  const countByDoc = new Map<string, number>();
  const deduped: SimilarityResult[] = [];

  for (const result of results) {
    const count = countByDoc.get(result.documentId) ?? 0;
    if (count < maxPerDocument) {
      deduped.push(result);
      countByDoc.set(result.documentId, count + 1);
    }
  }

  return deduped;
}

/**
 * Compute the element-wise average of multiple embedding vectors.
 *
 * @param embeddings - Array of embedding vectors (must all have same dimension)
 * @returns Averaged embedding vector
 */
export function averageEmbeddings(embeddings: number[][]): number[] {
  if (embeddings.length === 0) {
    return [];
  }

  const dim = embeddings[0].length;
  const avg = new Array<number>(dim).fill(0);

  for (const emb of embeddings) {
    for (let i = 0; i < dim; i++) {
      avg[i] += emb[i];
    }
  }

  const count = embeddings.length;
  for (let i = 0; i < dim; i++) {
    avg[i] /= count;
  }

  return avg;
}

/**
 * Build a search summary from the search operation data.
 */
function buildSummary(
  query: string,
  embeddingResult: QueryEmbeddingResult,
  totalFound: number,
  returned: number,
  durationMs: number,
): SearchSummary {
  return {
    query,
    processedQuery: embeddingResult.processedQuery,
    totalFound,
    returned,
    embeddingCached: embeddingResult.cached,
    durationMs,
  };
}
