// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * RAG (Retrieval-Augmented Generation) pipeline singleton for chat integration.
 *
 * Manages the full knowledge base lifecycle: load → chunk → embed → store,
 * and provides a high-level `search()` method for the chat route to call.
 *
 * Design:
 * - Lazy initialization: pipeline is built on first search call
 * - Graceful degradation: returns empty results on any failure
 * - Token budget: knowledge context limited to 15% of model context window
 *
 * @module knowledge/rag-pipeline
 */

import { IntegratedKnowledgeLoader } from './integrated-loader.js';
import { TextChunker } from './text-chunker.js';
import {
  TfIdfEmbeddingProvider,
  EmbeddingGenerator,
} from './embedding-generator.js';
import { LocalVectorStore } from './vector-store.js';
import { QueryEmbedder } from './query-embedder.js';
import { SimilaritySearch } from './similarity-search.js';
import {
  formatKnowledgeContext,
  type FormattedContext,
} from './context-enhancer.js';
import { logger } from '../utils/logger.js';

// ============================================================================
// Types
// ============================================================================

/** Result of a RAG search formatted for prompt injection */
export interface RagSearchResult {
  /** Formatted knowledge context text for system prompt injection */
  contextText: string;
  /** Number of relevant results found */
  resultCount: number;
  /** Estimated token count of the context */
  estimatedTokens: number;
  /** Search duration in milliseconds */
  durationMs: number;
  /** Whether the search returned any results */
  hasResults: boolean;
}

/** Options for RAG search */
export interface RagSearchOptions {
  /** Maximum number of results (default: 5) */
  maxResults?: number;
  /** Maximum character length for context (default: computed from token budget) */
  maxContextLength?: number;
  /** Minimum similarity score (default: 0.05) */
  minScore?: number;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_MAX_RESULTS = 5;
const DEFAULT_MIN_SCORE = 0.05;
/** Knowledge context budget: 15% of model context window */
const KNOWLEDGE_CONTEXT_PERCENTAGE = 0.15;
const MODEL_CONTEXT_WINDOW = 200_000;
const CHARS_PER_TOKEN = 4;
const DEFAULT_MAX_CONTEXT_CHARS =
  Math.floor(MODEL_CONTEXT_WINDOW * KNOWLEDGE_CONTEXT_PERCENTAGE) * CHARS_PER_TOKEN;

// ============================================================================
// RAGPipeline
// ============================================================================

/**
 * Manages the full RAG pipeline for knowledge-augmented AI chat.
 *
 * Handles lazy initialization of the indexing pipeline and provides
 * a simple search interface for the chat route.
 */
export class RAGPipeline {
  private readonly projectRoot: string;
  private similaritySearch: SimilaritySearch | null = null;
  private initialized = false;
  private initializing: Promise<void> | null = null;
  private indexedDocCount = 0;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  /**
   * Search the knowledge base for content relevant to a user query.
   *
   * Lazily initializes the pipeline on first call. Returns empty results
   * on any failure (graceful degradation).
   *
   * @param query - User's chat message
   * @param options - Search options
   * @returns Formatted context for prompt injection
   */
  async search(query: string, options: RagSearchOptions = {}): Promise<RagSearchResult> {
    const startTime = Date.now();

    try {
      await this.ensureInitialized();

      if (!this.similaritySearch || this.indexedDocCount === 0) {
        return emptyResult(startTime);
      }

      const maxResults = options.maxResults ?? DEFAULT_MAX_RESULTS;
      const minScore = options.minScore ?? DEFAULT_MIN_SCORE;
      const maxContextLength = options.maxContextLength ?? DEFAULT_MAX_CONTEXT_CHARS;

      const searchResponse = await this.similaritySearch.search(query, {
        maxResults,
        minScore,
        deduplicateByDocument: true,
        maxPerDocument: 2,
      });

      if (searchResponse.results.length === 0) {
        return emptyResult(startTime);
      }

      const formatted: FormattedContext = formatKnowledgeContext(
        searchResponse.results,
        {
          maxContextLength,
          includeScores: false,
          includeSources: true,
          includeHeadings: true,
          sectionHeader: 'Knowledge Base Reference',
        },
      );

      if (formatted.resultCount === 0) {
        return emptyResult(startTime);
      }

      const durationMs = Date.now() - startTime;
      const estimatedTokens = Math.ceil(formatted.totalLength / CHARS_PER_TOKEN);

      logger.debug(
        {
          operation: 'rag_search',
          query: query.slice(0, 100),
          resultCount: formatted.resultCount,
          estimatedTokens,
          durationMs,
        },
        `RAG search: ${formatted.resultCount} results, ${estimatedTokens} tokens, ${durationMs}ms`,
      );

      return {
        contextText: formatted.text,
        resultCount: formatted.resultCount,
        estimatedTokens,
        durationMs,
        hasResults: true,
      };
    } catch (err) {
      const durationMs = Date.now() - startTime;
      logger.warn(
        { operation: 'rag_search_error', error: String(err), durationMs },
        'RAG search failed, falling back to no context',
      );
      return emptyResult(startTime);
    }
  }

  /**
   * Check if the pipeline has been initialized and has indexed documents.
   */
  isReady(): boolean {
    return this.initialized && this.indexedDocCount > 0;
  }

  /**
   * Get the number of indexed documents.
   */
  getIndexedDocCount(): number {
    return this.indexedDocCount;
  }

  /**
   * Force re-initialization of the pipeline (e.g., after knowledge base update).
   */
  async reinitialize(): Promise<void> {
    this.initialized = false;
    this.initializing = null;
    this.similaritySearch = null;
    this.indexedDocCount = 0;
    await this.ensureInitialized();
  }

  /**
   * Ensure the pipeline is initialized (lazy, thread-safe via promise dedup).
   */
  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;

    if (!this.initializing) {
      this.initializing = this.initialize();
    }

    await this.initializing;
  }

  /**
   * Build the full indexing pipeline: load → chunk → embed → store.
   */
  private async initialize(): Promise<void> {
    const startTime = Date.now();

    try {
      // Step 1: Load documents
      const loader = new IntegratedKnowledgeLoader({
        projectRoot: this.projectRoot,
      });
      const { documents, summary } = loader.loadAll();

      if (documents.length === 0) {
        logger.info('RAG pipeline: no knowledge base documents found');
        this.initialized = true;
        return;
      }

      // Step 2: Chunk documents
      const chunker = new TextChunker({ maxChunkSize: 800, overlapSize: 100 });
      const { chunks } = chunker.chunkDocuments(documents);

      if (chunks.length === 0) {
        logger.info('RAG pipeline: no chunks generated from documents');
        this.initialized = true;
        return;
      }

      // Step 3: Build TF-IDF vocabulary and generate embeddings
      const embeddingProvider = new TfIdfEmbeddingProvider();
      embeddingProvider.buildVocabulary(chunks.map((c) => c.content));

      const generator = new EmbeddingGenerator({ provider: embeddingProvider });
      const { embeddings } = await generator.generateEmbeddings(chunks);

      // Step 4: Store in vector store
      const vectorStore = new LocalVectorStore();
      await vectorStore.upsert(embeddings);

      // Step 5: Create search engine
      const queryEmbedder = new QueryEmbedder({
        provider: embeddingProvider,
        preprocessOptions: { expandSynonyms: true },
      });
      this.similaritySearch = new SimilaritySearch({
        queryEmbedder,
        vectorStore,
      });

      this.indexedDocCount = summary.totalDocuments;
      this.initialized = true;

      const durationMs = Date.now() - startTime;
      logger.info(
        {
          operation: 'rag_pipeline_init',
          documents: summary.totalDocuments,
          chunks: chunks.length,
          embeddings: embeddings.length,
          software: summary.software,
          durationMs,
        },
        `RAG pipeline initialized: ${summary.totalDocuments} docs, ${chunks.length} chunks, ${durationMs}ms`,
      );
    } catch (err) {
      logger.error(
        { operation: 'rag_pipeline_init_error', error: String(err) },
        'Failed to initialize RAG pipeline',
      );
      this.initialized = true; // Mark as initialized to avoid retry loops
    }
  }
}

// ============================================================================
// Helper
// ============================================================================

function emptyResult(startTime: number): RagSearchResult {
  return {
    contextText: '',
    resultCount: 0,
    estimatedTokens: 0,
    durationMs: Date.now() - startTime,
    hasResults: false,
  };
}

// ============================================================================
// Singleton
// ============================================================================

let _pipeline: RAGPipeline | null = null;

/**
 * Get or create the RAG pipeline singleton.
 *
 * @param projectRoot - Project root directory (required on first call)
 */
export function getRagPipeline(projectRoot?: string): RAGPipeline | null {
  if (!_pipeline && projectRoot) {
    _pipeline = new RAGPipeline(projectRoot);
  }
  return _pipeline;
}

/**
 * Initialize the RAG pipeline with a specific project root.
 */
export function initRagPipeline(projectRoot: string): RAGPipeline {
  _pipeline = new RAGPipeline(projectRoot);
  return _pipeline;
}

/** Reset for testing */
export function _resetRagPipeline(): void {
  _pipeline = null;
}
