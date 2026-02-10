/**
 * Embedding generator for the knowledge base indexing pipeline.
 *
 * Converts text chunks into vector embeddings for storage in a vector database.
 * Supports multiple embedding providers with a pluggable architecture.
 *
 * Pipeline: load → chunk → **embed** → store
 *
 * Built-in providers:
 * - **tfidf**: Local TF-IDF embeddings (zero dependencies, default)
 *
 * @module knowledge/embedding-generator
 */

import type { TextChunk } from './text-chunker.js';

// ============================================================================
// Types
// ============================================================================

/** A text chunk with its computed vector embedding */
export interface EmbeddedChunk {
  /** Original chunk ID */
  chunkId: string;
  /** Document ID this chunk belongs to */
  documentId: string;
  /** The text content that was embedded */
  content: string;
  /** The computed vector embedding */
  embedding: number[];
  /** Dimension of the embedding vector */
  dimension: number;
  /** Category inherited from the source document */
  category: string;
  /** Heading context from the chunk */
  headingContext: string;
}

/** Summary of an embedding generation operation */
export interface EmbeddingSummary {
  /** Total number of chunks processed */
  totalChunks: number;
  /** Number of chunks successfully embedded */
  succeeded: number;
  /** Number of chunks that failed to embed */
  failed: number;
  /** Embedding dimension */
  dimension: number;
  /** Provider used for embedding */
  provider: string;
  /** Total processing time in milliseconds */
  durationMs: number;
}

/** Configuration for an embedding provider */
export interface EmbeddingProviderConfig {
  /** Provider identifier */
  id: string;
  /** Human-readable provider name */
  name: string;
  /** Embedding vector dimension */
  dimension: number;
  /** Maximum tokens/characters per request (0 = unlimited) */
  maxInputLength: number;
  /** Whether this provider requires network access */
  requiresNetwork: boolean;
  /** Whether this provider requires an API key */
  requiresApiKey: boolean;
}

/**
 * Interface for embedding providers.
 *
 * Implement this interface to add support for new embedding backends
 * (e.g., OpenAI, Cohere, local models).
 */
export interface EmbeddingProvider {
  /** Get the provider configuration */
  getConfig(): EmbeddingProviderConfig;

  /**
   * Generate an embedding for a single text.
   *
   * @param text - Text to embed
   * @returns The embedding vector
   */
  embed(text: string): Promise<number[]>;

  /**
   * Generate embeddings for multiple texts in batch.
   *
   * Default implementation calls embed() for each text sequentially.
   * Override for providers that support batch APIs.
   *
   * @param texts - Array of texts to embed
   * @returns Array of embedding vectors (same order as input)
   */
  embedBatch(texts: string[]): Promise<number[][]>;
}

/** Options for the EmbeddingGenerator */
export interface EmbeddingGeneratorOptions {
  /** The embedding provider to use */
  provider: EmbeddingProvider;
  /** Batch size for processing chunks (default: 50) */
  batchSize?: number;
  /** Whether to skip chunks that fail to embed (default: true) */
  skipOnError?: boolean;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_BATCH_SIZE = 50;

// ============================================================================
// TF-IDF Embedding Provider
// ============================================================================

/** Options for the TF-IDF embedding provider */
export interface TfIdfProviderOptions {
  /** Maximum vocabulary size (default: 5000) */
  maxFeatures?: number;
  /** Minimum document frequency for a term (default: 1) */
  minDocFreq?: number;
}

/**
 * TF-IDF based embedding provider.
 *
 * Computes TF-IDF (Term Frequency - Inverse Document Frequency) vectors
 * locally without any external dependencies or API calls.
 *
 * The provider works in two phases:
 * 1. **Build vocabulary**: Call `buildVocabulary()` with all texts first
 * 2. **Generate embeddings**: Call `embed()` or `embedBatch()` to get vectors
 *
 * @example
 * ```ts
 * const provider = new TfIdfEmbeddingProvider();
 * provider.buildVocabulary(['doc1 text', 'doc2 text']);
 * const embedding = await provider.embed('search query');
 * ```
 */
export class TfIdfEmbeddingProvider implements EmbeddingProvider {
  private readonly maxFeatures: number;
  private readonly minDocFreq: number;
  private vocabulary: Map<string, number> = new Map();
  private idfValues: Map<string, number> = new Map();
  private vocabularyBuilt = false;

  constructor(options: TfIdfProviderOptions = {}) {
    this.maxFeatures = options.maxFeatures ?? 5000;
    this.minDocFreq = options.minDocFreq ?? 1;
  }

  getConfig(): EmbeddingProviderConfig {
    return {
      id: 'tfidf',
      name: 'Local TF-IDF',
      dimension: this.vocabulary.size || this.maxFeatures,
      maxInputLength: 0,
      requiresNetwork: false,
      requiresApiKey: false,
    };
  }

  /**
   * Build the vocabulary from a corpus of texts.
   *
   * Must be called before `embed()` or `embedBatch()`.
   * Computes document frequency and IDF values for all terms.
   *
   * @param texts - Array of text documents to build vocabulary from
   * @returns The vocabulary size
   */
  buildVocabulary(texts: string[]): number {
    if (texts.length === 0) {
      this.vocabulary = new Map();
      this.idfValues = new Map();
      this.vocabularyBuilt = true;
      return 0;
    }

    // Step 1: Compute document frequency
    const docFreq = new Map<string, number>();

    for (const text of texts) {
      const tokens = tokenize(text);
      const uniqueTokens = new Set(tokens);

      for (const token of uniqueTokens) {
        docFreq.set(token, (docFreq.get(token) ?? 0) + 1);
      }
    }

    // Step 2: Filter by min doc freq and select top features
    const filteredTerms = [...docFreq.entries()]
      .filter(([, freq]) => freq >= this.minDocFreq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, this.maxFeatures);

    this.vocabulary = new Map();
    for (let i = 0; i < filteredTerms.length; i++) {
      this.vocabulary.set(filteredTerms[i][0], i);
    }

    // Step 3: Compute IDF values: log(N / df)
    const N = texts.length;
    this.idfValues = new Map();
    for (const [term, freq] of filteredTerms) {
      this.idfValues.set(term, Math.log(N / freq));
    }

    this.vocabularyBuilt = true;
    return this.vocabulary.size;
  }

  /**
   * Check if the vocabulary has been built.
   */
  isVocabularyBuilt(): boolean {
    return this.vocabularyBuilt;
  }

  /**
   * Get the current vocabulary size.
   */
  getVocabularySize(): number {
    return this.vocabulary.size;
  }

  async embed(text: string): Promise<number[]> {
    if (!this.vocabularyBuilt) {
      throw new Error('Vocabulary not built. Call buildVocabulary() first.');
    }

    return this.computeTfIdfVector(text);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (!this.vocabularyBuilt) {
      throw new Error('Vocabulary not built. Call buildVocabulary() first.');
    }

    return texts.map((text) => this.computeTfIdfVector(text));
  }

  /**
   * Compute a TF-IDF vector for the given text.
   */
  private computeTfIdfVector(text: string): number[] {
    const tokens = tokenize(text);
    const dimension = this.vocabulary.size;
    const vector = new Array<number>(dimension).fill(0);

    if (tokens.length === 0 || dimension === 0) {
      return vector;
    }

    // Compute term frequency
    const termFreq = new Map<string, number>();
    for (const token of tokens) {
      termFreq.set(token, (termFreq.get(token) ?? 0) + 1);
    }

    // Compute TF-IDF for each term in vocabulary
    for (const [term, count] of termFreq) {
      const vocabIndex = this.vocabulary.get(term);
      if (vocabIndex !== undefined) {
        const tf = count / tokens.length;
        const idf = this.idfValues.get(term) ?? 0;
        vector[vocabIndex] = tf * idf;
      }
    }

    // L2 normalize
    const mag = magnitude(vector);
    if (mag > 0) {
      for (let i = 0; i < vector.length; i++) {
        vector[i] /= mag;
      }
    }

    return vector;
  }
}

// ============================================================================
// EmbeddingGenerator
// ============================================================================

/**
 * Embedding generator for the knowledge base indexing pipeline.
 *
 * Takes text chunks from the TextChunker and generates vector embeddings
 * using a configurable provider. Supports batch processing and error handling.
 *
 * @example
 * ```ts
 * const provider = new TfIdfEmbeddingProvider();
 * const generator = new EmbeddingGenerator({ provider });
 *
 * // For TF-IDF, build vocabulary from all chunk texts first
 * provider.buildVocabulary(chunks.map(c => c.content));
 *
 * const { embeddings, summary } = await generator.generateEmbeddings(chunks);
 * console.log(`Generated ${summary.succeeded} embeddings`);
 * ```
 */
export class EmbeddingGenerator {
  private readonly provider: EmbeddingProvider;
  private readonly batchSize: number;
  private readonly skipOnError: boolean;

  constructor(options: EmbeddingGeneratorOptions) {
    this.provider = options.provider;
    this.batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
    this.skipOnError = options.skipOnError ?? true;
  }

  /**
   * Generate embeddings for an array of text chunks.
   *
   * Processes chunks in batches and returns embedded chunks with their vectors.
   *
   * @param chunks - Array of text chunks to embed
   * @returns Object containing embedded chunks and a summary
   */
  async generateEmbeddings(
    chunks: TextChunk[],
  ): Promise<{ embeddings: EmbeddedChunk[]; summary: EmbeddingSummary }> {
    const startTime = Date.now();
    const config = this.provider.getConfig();
    const embeddings: EmbeddedChunk[] = [];
    let failed = 0;

    // Process in batches
    for (let i = 0; i < chunks.length; i += this.batchSize) {
      const batch = chunks.slice(i, i + this.batchSize);
      const texts = batch.map((chunk) => chunk.content);

      try {
        const vectors = await this.provider.embedBatch(texts);

        for (let j = 0; j < batch.length; j++) {
          const chunk = batch[j];
          const vector = vectors[j];

          if (vector && vector.length > 0) {
            embeddings.push({
              chunkId: chunk.id,
              documentId: chunk.documentId,
              content: chunk.content,
              embedding: vector,
              dimension: vector.length,
              category: chunk.category,
              headingContext: chunk.headingContext,
            });
          } else {
            failed++;
          }
        }
      } catch (error) {
        if (!this.skipOnError) {
          throw error;
        }
        // Skip entire batch on error
        failed += batch.length;
      }
    }

    const durationMs = Date.now() - startTime;
    const summary: EmbeddingSummary = {
      totalChunks: chunks.length,
      succeeded: embeddings.length,
      failed,
      dimension: config.dimension,
      provider: config.id,
      durationMs,
    };

    return { embeddings, summary };
  }

  /**
   * Generate an embedding for a single text (e.g., a search query).
   *
   * @param text - Text to embed
   * @returns The embedding vector
   */
  async generateQueryEmbedding(text: string): Promise<number[]> {
    return this.provider.embed(text);
  }

  /**
   * Get the embedding provider configuration.
   */
  getProviderConfig(): EmbeddingProviderConfig {
    return this.provider.getConfig();
  }

  /**
   * Get the configured batch size.
   */
  getBatchSize(): number {
    return this.batchSize;
  }
}

// ============================================================================
// Utility Functions (exported for testing)
// ============================================================================

/** Common English stopwords to filter during tokenization */
const STOPWORDS = new Set([
  'the', 'is', 'at', 'which', 'on', 'a', 'an', 'and', 'or', 'but',
  'in', 'with', 'to', 'for', 'of', 'not', 'no', 'be', 'are', 'was',
  'were', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did',
  'will', 'would', 'could', 'should', 'may', 'might', 'shall', 'can',
  'it', 'its', 'if', 'then', 'than', 'that', 'this', 'these', 'those',
  'he', 'she', 'we', 'they', 'you', 'me', 'him', 'her', 'us', 'them',
  'my', 'your', 'his', 'our', 'their', 'what', 'so', 'up', 'out',
  'about', 'into', 'by', 'from', 'as',
]);

/**
 * Tokenize text into lowercase terms, filtering out short words and stopwords.
 *
 * Supports both English and Chinese text.
 *
 * @param text - The text to tokenize
 * @returns Array of filtered tokens
 */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff\s-]/g, ' ')
    .split(/\s+/)
    .filter((term) => term.length > 1 && !STOPWORDS.has(term));
}

/**
 * Compute the magnitude (L2 norm) of a vector.
 *
 * @param vector - The vector
 * @returns The L2 norm
 */
export function magnitude(vector: number[]): number {
  let sum = 0;
  for (const v of vector) {
    sum += v * v;
  }
  return Math.sqrt(sum);
}

/**
 * Compute cosine similarity between two vectors.
 *
 * @param a - First vector
 * @param b - Second vector
 * @returns Cosine similarity (0 to 1 for normalized vectors)
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) {
    return 0;
  }

  const magA = magnitude(a);
  const magB = magnitude(b);

  if (magA === 0 || magB === 0) {
    return 0;
  }

  let dotProduct = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
  }

  return dotProduct / (magA * magB);
}
