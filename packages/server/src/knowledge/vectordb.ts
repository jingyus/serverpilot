/**
 * In-memory vector database for semantic document search.
 *
 * Provides TF-IDF based vector embeddings and cosine similarity search
 * as a lightweight alternative to external vector databases (Qdrant/Pinecone).
 * Can be replaced with an external vector DB in the future without changing
 * the public API.
 *
 * @module knowledge/vectordb
 */

import type { KnowledgeDocument, SearchResult } from './loader.js';

// ============================================================================
// Types
// ============================================================================

/** A document stored in the vector database with its embedding */
export interface VectorDocument {
  /** Document ID */
  id: string;
  /** Original knowledge document reference */
  document: KnowledgeDocument;
  /** TF-IDF vector embedding */
  embedding: number[];
}

/** Options for the VectorDB constructor */
export interface VectorDBOptions {
  /** Maximum number of features (vocabulary size) for embeddings (default: 5000) */
  maxFeatures?: number;
  /** Minimum document frequency for a term to be included (default: 1) */
  minDocFreq?: number;
}

/** Result of a vector similarity search */
export interface VectorSearchResult extends SearchResult {
  /** Cosine similarity score (0 to 1) */
  similarity: number;
}

// ============================================================================
// VectorDB
// ============================================================================

/**
 * In-memory vector database using TF-IDF embeddings and cosine similarity.
 *
 * Indexes documents as TF-IDF vectors and supports semantic-like search
 * via cosine similarity. Suitable for small-to-medium knowledge bases
 * (hundreds to low thousands of documents).
 *
 * @example
 * ```ts
 * const vectordb = new VectorDB();
 * vectordb.indexDocuments(documents);
 * const results = vectordb.search('npm install timeout error');
 * ```
 */
export class VectorDB {
  private readonly maxFeatures: number;
  private readonly minDocFreq: number;
  private vocabulary: Map<string, number> = new Map();
  private idfValues: Map<string, number> = new Map();
  private documents: VectorDocument[] = [];
  private indexed = false;

  constructor(options: VectorDBOptions = {}) {
    this.maxFeatures = options.maxFeatures ?? 5000;
    this.minDocFreq = options.minDocFreq ?? 1;
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  /**
   * Index a set of documents by computing TF-IDF embeddings.
   *
   * Builds the vocabulary from all documents, computes IDF values,
   * and generates TF-IDF vectors for each document.
   *
   * @param documents - Array of knowledge documents to index
   * @returns The number of documents indexed
   */
  indexDocuments(documents: KnowledgeDocument[]): number {
    if (documents.length === 0) {
      this.documents = [];
      this.vocabulary = new Map();
      this.idfValues = new Map();
      this.indexed = true;
      return 0;
    }

    // Step 1: Build vocabulary and document frequency
    const docFreq = new Map<string, number>();
    const allTokenSets: Set<string>[] = [];

    for (const doc of documents) {
      const tokens = this.tokenize(`${doc.title} ${doc.content}`);
      const uniqueTokens = new Set(tokens);
      allTokenSets.push(uniqueTokens);

      for (const token of uniqueTokens) {
        docFreq.set(token, (docFreq.get(token) ?? 0) + 1);
      }
    }

    // Step 2: Filter by minDocFreq and select top features by document frequency
    const filteredTerms = [...docFreq.entries()]
      .filter(([, freq]) => freq >= this.minDocFreq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, this.maxFeatures);

    this.vocabulary = new Map();
    for (let i = 0; i < filteredTerms.length; i++) {
      this.vocabulary.set(filteredTerms[i][0], i);
    }

    // Step 3: Compute IDF values: log(N / df)
    const N = documents.length;
    this.idfValues = new Map();
    for (const [term, freq] of filteredTerms) {
      this.idfValues.set(term, Math.log(N / freq));
    }

    // Step 4: Compute TF-IDF vectors for each document
    this.documents = documents.map((doc) => {
      const embedding = this.computeEmbedding(`${doc.title} ${doc.content}`);
      return { id: doc.id, document: doc, embedding };
    });

    this.indexed = true;
    return this.documents.length;
  }

  /**
   * Search for documents similar to the query using cosine similarity.
   *
   * Converts the query into a TF-IDF vector using the existing vocabulary,
   * then finds the most similar documents.
   *
   * @param query - Search query string
   * @param maxResults - Maximum number of results (default: 5)
   * @param minSimilarity - Minimum similarity threshold (default: 0.01)
   * @returns Array of search results sorted by similarity (descending)
   */
  search(query: string, maxResults = 5, minSimilarity = 0.01): VectorSearchResult[] {
    if (!this.indexed || this.documents.length === 0) {
      return [];
    }

    const queryEmbedding = this.computeEmbedding(query);

    // Check if query vector is zero (no vocabulary overlap)
    const queryMagnitude = this.magnitude(queryEmbedding);
    if (queryMagnitude === 0) {
      return [];
    }

    const results: VectorSearchResult[] = [];

    for (const vectorDoc of this.documents) {
      const similarity = this.cosineSimilarity(queryEmbedding, vectorDoc.embedding);

      if (similarity >= minSimilarity) {
        const snippets = this.extractSnippets(vectorDoc.document, query);
        results.push({
          document: vectorDoc.document,
          score: similarity,
          similarity,
          snippets,
        });
      }
    }

    results.sort((a, b) => b.similarity - a.similarity);
    return results.slice(0, maxResults);
  }

  /**
   * Add a single document to the index.
   *
   * Note: This uses the existing vocabulary. For best results,
   * re-index all documents after adding many new ones.
   *
   * @param document - Knowledge document to add
   */
  addDocument(document: KnowledgeDocument): void {
    if (!this.indexed) {
      this.indexDocuments([document]);
      return;
    }

    const embedding = this.computeEmbedding(`${document.title} ${document.content}`);
    this.documents.push({ id: document.id, document, embedding });
  }

  /**
   * Remove a document from the index by ID.
   *
   * @param id - Document ID to remove
   * @returns true if the document was found and removed
   */
  removeDocument(id: string): boolean {
    const initialLength = this.documents.length;
    this.documents = this.documents.filter((doc) => doc.id !== id);
    return this.documents.length < initialLength;
  }

  /**
   * Get a document from the index by ID.
   *
   * @param id - Document ID
   * @returns The vector document if found, undefined otherwise
   */
  getDocument(id: string): VectorDocument | undefined {
    return this.documents.find((doc) => doc.id === id);
  }

  /**
   * Check if the index has been built.
   *
   * @returns true if indexDocuments() has been called
   */
  isIndexed(): boolean {
    return this.indexed;
  }

  /**
   * Get the number of indexed documents.
   *
   * @returns Document count
   */
  getDocumentCount(): number {
    return this.documents.length;
  }

  /**
   * Get the vocabulary size (number of unique terms).
   *
   * @returns Vocabulary size
   */
  getVocabularySize(): number {
    return this.vocabulary.size;
  }

  /**
   * Clear the entire index.
   */
  clear(): void {
    this.documents = [];
    this.vocabulary = new Map();
    this.idfValues = new Map();
    this.indexed = false;
  }

  // --------------------------------------------------------------------------
  // Embedding Computation
  // --------------------------------------------------------------------------

  /**
   * Compute a TF-IDF embedding vector for the given text.
   */
  private computeEmbedding(text: string): number[] {
    const tokens = this.tokenize(text);
    const vector = new Array<number>(this.vocabulary.size).fill(0);

    if (tokens.length === 0) {
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

    // L2 normalize the vector
    const mag = this.magnitude(vector);
    if (mag > 0) {
      for (let i = 0; i < vector.length; i++) {
        vector[i] /= mag;
      }
    }

    return vector;
  }

  // --------------------------------------------------------------------------
  // Similarity Computation
  // --------------------------------------------------------------------------

  /**
   * Compute cosine similarity between two vectors.
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    const magA = this.magnitude(a);
    const magB = this.magnitude(b);

    if (magA === 0 || magB === 0) {
      return 0;
    }

    let dotProduct = 0;
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
    }

    return dotProduct / (magA * magB);
  }

  /**
   * Compute the magnitude (L2 norm) of a vector.
   */
  private magnitude(vector: number[]): number {
    let sum = 0;
    for (const v of vector) {
      sum += v * v;
    }
    return Math.sqrt(sum);
  }

  // --------------------------------------------------------------------------
  // Text Processing
  // --------------------------------------------------------------------------

  /**
   * Tokenize text into lowercase terms, filtering out short words and stopwords.
   */
  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fff\s-]/g, ' ')
      .split(/\s+/)
      .filter((term) => term.length > 1 && !STOPWORDS.has(term));
  }

  /**
   * Extract text snippets matching query terms from a document.
   */
  private extractSnippets(document: KnowledgeDocument, query: string, maxSnippets = 3): string[] {
    const terms = query
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 1);
    const lines = document.content.split('\n');
    const snippets: string[] = [];

    for (const line of lines) {
      if (snippets.length >= maxSnippets) break;

      const lineLower = line.toLowerCase();
      const hasMatch = terms.some((term) => lineLower.includes(term));

      if (hasMatch) {
        const trimmed = line.trim();
        if (trimmed.length > 0 && !snippets.includes(trimmed)) {
          snippets.push(trimmed);
        }
      }
    }

    return snippets;
  }
}

// ============================================================================
// Stopwords
// ============================================================================

/** Common English stopwords to filter during tokenization */
const STOPWORDS = new Set([
  'the',
  'is',
  'at',
  'which',
  'on',
  'a',
  'an',
  'and',
  'or',
  'but',
  'in',
  'with',
  'to',
  'for',
  'of',
  'not',
  'no',
  'be',
  'are',
  'was',
  'were',
  'been',
  'being',
  'have',
  'has',
  'had',
  'do',
  'does',
  'did',
  'will',
  'would',
  'could',
  'should',
  'may',
  'might',
  'shall',
  'can',
  'it',
  'its',
  'if',
  'then',
  'than',
  'that',
  'this',
  'these',
  'those',
  'he',
  'she',
  'we',
  'they',
  'you',
  'me',
  'him',
  'her',
  'us',
  'them',
  'my',
  'your',
  'his',
  'our',
  'their',
  'what',
  'so',
  'up',
  'out',
  'about',
  'into',
  'by',
  'from',
  'as',
]);
