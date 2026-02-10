import { describe, expect, it } from 'vitest';

import type { TextChunk } from './text-chunker.js';
import {
  EmbeddingGenerator,
  TfIdfEmbeddingProvider,
  tokenize,
  magnitude,
  cosineSimilarity,
} from './embedding-generator.js';
import type {
  EmbeddedChunk,
  EmbeddingProvider,
  EmbeddingProviderConfig,
  EmbeddingSummary,
} from './embedding-generator.js';

// ============================================================================
// Helpers
// ============================================================================

/** Create a minimal TextChunk for testing */
function makeChunk(
  content: string,
  overrides: Partial<TextChunk> = {},
): TextChunk {
  const index = overrides.index ?? 0;
  const documentId = overrides.documentId ?? 'docs/test.md';
  return {
    id: overrides.id ?? `${documentId}#chunk-${index}`,
    documentId,
    index,
    content,
    charCount: content.length,
    headingContext: overrides.headingContext ?? '',
    category: overrides.category ?? 'docs',
  };
}

/** Create a mock embedding provider for testing */
function makeMockProvider(options: {
  dimension?: number;
  failOnEmbed?: boolean;
  failOnBatch?: boolean;
} = {}): EmbeddingProvider {
  const dimension = options.dimension ?? 3;

  return {
    getConfig(): EmbeddingProviderConfig {
      return {
        id: 'mock',
        name: 'Mock Provider',
        dimension,
        maxInputLength: 0,
        requiresNetwork: false,
        requiresApiKey: false,
      };
    },
    async embed(text: string): Promise<number[]> {
      if (options.failOnEmbed) {
        throw new Error('Mock embed failure');
      }
      // Simple hash-based embedding for deterministic testing
      const vector = new Array(dimension).fill(0);
      for (let i = 0; i < text.length; i++) {
        vector[i % dimension] += text.charCodeAt(i);
      }
      // Normalize
      const mag = Math.sqrt(vector.reduce((s, v) => s + v * v, 0));
      if (mag > 0) {
        for (let i = 0; i < vector.length; i++) {
          vector[i] /= mag;
        }
      }
      return vector;
    },
    async embedBatch(texts: string[]): Promise<number[][]> {
      if (options.failOnBatch) {
        throw new Error('Mock batch failure');
      }
      const results: number[][] = [];
      for (const text of texts) {
        results.push(await this.embed(text));
      }
      return results;
    },
  };
}

// ============================================================================
// tokenize
// ============================================================================

describe('tokenize', () => {
  it('should tokenize English text into lowercase terms', () => {
    const tokens = tokenize('Hello World');
    expect(tokens).toContain('hello');
    expect(tokens).toContain('world');
  });

  it('should filter out stopwords', () => {
    const tokens = tokenize('the quick brown fox is a good animal');
    expect(tokens).not.toContain('the');
    expect(tokens).not.toContain('is');
    expect(tokens).not.toContain('a');
    expect(tokens).toContain('quick');
    expect(tokens).toContain('brown');
    expect(tokens).toContain('fox');
  });

  it('should filter out single-character tokens', () => {
    const tokens = tokenize('I am a test x y z');
    expect(tokens).not.toContain('i');
    expect(tokens).not.toContain('x');
    expect(tokens).not.toContain('y');
    expect(tokens).not.toContain('z');
  });

  it('should handle Chinese text', () => {
    const tokens = tokenize('npm 安装 超时 错误');
    expect(tokens).toContain('npm');
    expect(tokens).toContain('安装');
    expect(tokens).toContain('超时');
    expect(tokens).toContain('错误');
  });

  it('should remove special characters', () => {
    const tokens = tokenize('npm@latest! (version) #tag');
    expect(tokens).toContain('npm');
    expect(tokens).toContain('latest');
    expect(tokens).toContain('version');
    expect(tokens).toContain('tag');
  });

  it('should handle empty input', () => {
    expect(tokenize('')).toEqual([]);
  });

  it('should handle input with only stopwords', () => {
    const tokens = tokenize('the is a an');
    expect(tokens).toEqual([]);
  });

  it('should preserve hyphenated words', () => {
    const tokens = tokenize('node-version arm64-darwin');
    expect(tokens).toContain('node-version');
    expect(tokens).toContain('arm64-darwin');
  });
});

// ============================================================================
// magnitude
// ============================================================================

describe('magnitude', () => {
  it('should compute L2 norm of a vector', () => {
    expect(magnitude([3, 4])).toBeCloseTo(5);
  });

  it('should return 0 for zero vector', () => {
    expect(magnitude([0, 0, 0])).toBe(0);
  });

  it('should return 1 for unit vector', () => {
    expect(magnitude([1, 0, 0])).toBe(1);
  });

  it('should handle single element', () => {
    expect(magnitude([7])).toBe(7);
  });

  it('should handle empty vector', () => {
    expect(magnitude([])).toBe(0);
  });
});

// ============================================================================
// cosineSimilarity
// ============================================================================

describe('cosineSimilarity', () => {
  it('should return 1 for identical normalized vectors', () => {
    const v = [0.6, 0.8];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1);
  });

  it('should return 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it('should return value between 0 and 1 for similar vectors', () => {
    const a = [1, 2, 3];
    const b = [1, 2, 4];
    const sim = cosineSimilarity(a, b);
    expect(sim).toBeGreaterThan(0);
    expect(sim).toBeLessThanOrEqual(1);
  });

  it('should return 0 when either vector is zero', () => {
    expect(cosineSimilarity([0, 0], [1, 2])).toBe(0);
    expect(cosineSimilarity([1, 2], [0, 0])).toBe(0);
  });

  it('should return 0 for different length vectors', () => {
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
  });

  it('should return 0 for empty vectors', () => {
    expect(cosineSimilarity([], [])).toBe(0);
  });

  it('should handle negative values', () => {
    const sim = cosineSimilarity([1, 0], [-1, 0]);
    expect(sim).toBeCloseTo(-1);
  });
});

// ============================================================================
// TfIdfEmbeddingProvider - Vocabulary Building
// ============================================================================

describe('TfIdfEmbeddingProvider', () => {
  describe('vocabulary building', () => {
    it('should build vocabulary from texts', () => {
      const provider = new TfIdfEmbeddingProvider();
      const size = provider.buildVocabulary([
        'npm install timeout error',
        'permission denied sudo',
        'npm registry connection failed',
      ]);
      expect(size).toBeGreaterThan(0);
      expect(provider.isVocabularyBuilt()).toBe(true);
      expect(provider.getVocabularySize()).toBe(size);
    });

    it('should handle empty corpus', () => {
      const provider = new TfIdfEmbeddingProvider();
      const size = provider.buildVocabulary([]);
      expect(size).toBe(0);
      expect(provider.isVocabularyBuilt()).toBe(true);
    });

    it('should filter by minimum document frequency', () => {
      const provider = new TfIdfEmbeddingProvider({ minDocFreq: 2 });
      const size = provider.buildVocabulary([
        'npm install error',
        'npm permission error',
        'unique-word-only-once',
      ]);
      // 'npm' and 'error' appear in 2+ docs, 'unique-word-only-once' only once
      expect(size).toBeGreaterThan(0);
      // unique word should be filtered out
      const vocabSize = provider.getVocabularySize();
      expect(vocabSize).toBeLessThan(
        new Set(tokenize('npm install error npm permission error unique-word-only-once')).size,
      );
    });

    it('should limit vocabulary to maxFeatures', () => {
      const provider = new TfIdfEmbeddingProvider({ maxFeatures: 3 });
      provider.buildVocabulary([
        'word1 word2 word3 word4 word5',
        'word1 word2 word3 word4',
        'word1 word2 word3',
      ]);
      expect(provider.getVocabularySize()).toBeLessThanOrEqual(3);
    });

    it('should not be built initially', () => {
      const provider = new TfIdfEmbeddingProvider();
      expect(provider.isVocabularyBuilt()).toBe(false);
    });

    it('should rebuild vocabulary when called again', () => {
      const provider = new TfIdfEmbeddingProvider();
      provider.buildVocabulary(['first corpus text']);
      const size1 = provider.getVocabularySize();

      provider.buildVocabulary(['completely different second corpus text with more words']);
      const size2 = provider.getVocabularySize();

      // Different corpus should produce different vocabulary
      expect(size2).not.toBe(size1);
    });
  });

  // --------------------------------------------------------------------------
  // Embedding Generation
  // --------------------------------------------------------------------------

  describe('embedding generation', () => {
    it('should throw if vocabulary not built', async () => {
      const provider = new TfIdfEmbeddingProvider();
      await expect(provider.embed('test text')).rejects.toThrow(
        'Vocabulary not built',
      );
    });

    it('should throw on embedBatch if vocabulary not built', async () => {
      const provider = new TfIdfEmbeddingProvider();
      await expect(provider.embedBatch(['test'])).rejects.toThrow(
        'Vocabulary not built',
      );
    });

    it('should generate embedding vector', async () => {
      const provider = new TfIdfEmbeddingProvider();
      provider.buildVocabulary([
        'npm install package error',
        'node version check',
      ]);
      const embedding = await provider.embed('npm install error');

      expect(embedding).toBeInstanceOf(Array);
      expect(embedding.length).toBe(provider.getVocabularySize());
    });

    it('should generate normalized embeddings (L2 norm ~= 1)', async () => {
      const provider = new TfIdfEmbeddingProvider();
      provider.buildVocabulary([
        'npm install timeout error',
        'permission denied access',
      ]);
      const embedding = await provider.embed('npm install timeout');
      const norm = magnitude(embedding);

      // Should be approximately 1 if non-zero
      if (norm > 0) {
        expect(norm).toBeCloseTo(1, 5);
      }
    });

    it('should return zero vector for text with no vocabulary overlap', async () => {
      const provider = new TfIdfEmbeddingProvider();
      provider.buildVocabulary(['alpha beta gamma']);
      const embedding = await provider.embed('xyz qqq zzz');

      const allZero = embedding.every((v) => v === 0);
      expect(allZero).toBe(true);
    });

    it('should produce similar embeddings for similar texts', async () => {
      const provider = new TfIdfEmbeddingProvider();
      provider.buildVocabulary([
        'npm install timeout error connection',
        'npm install failed network error',
        'permission denied sudo access',
        'node version mismatch compatibility',
      ]);

      const emb1 = await provider.embed('npm install timeout error');
      const emb2 = await provider.embed('npm install failed error');
      const emb3 = await provider.embed('permission denied access');

      const sim12 = cosineSimilarity(emb1, emb2);
      const sim13 = cosineSimilarity(emb1, emb3);

      // npm-related texts should be more similar to each other
      expect(sim12).toBeGreaterThan(sim13);
    });

    it('should handle embedBatch correctly', async () => {
      const provider = new TfIdfEmbeddingProvider();
      provider.buildVocabulary([
        'first document text',
        'second document text',
      ]);

      const results = await provider.embedBatch([
        'first document',
        'second document',
      ]);

      expect(results).toHaveLength(2);
      expect(results[0].length).toBe(provider.getVocabularySize());
      expect(results[1].length).toBe(provider.getVocabularySize());
    });

    it('should generate embedding for empty text after vocabulary is built', async () => {
      const provider = new TfIdfEmbeddingProvider();
      provider.buildVocabulary(['some text here']);
      const embedding = await provider.embed('');

      expect(embedding).toBeInstanceOf(Array);
      expect(embedding.length).toBe(provider.getVocabularySize());
      // Should be all zeros
      expect(embedding.every((v) => v === 0)).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Configuration
  // --------------------------------------------------------------------------

  describe('configuration', () => {
    it('should return correct config', () => {
      const provider = new TfIdfEmbeddingProvider();
      provider.buildVocabulary(['test text']);
      const config = provider.getConfig();

      expect(config.id).toBe('tfidf');
      expect(config.name).toBe('Local TF-IDF');
      expect(config.requiresNetwork).toBe(false);
      expect(config.requiresApiKey).toBe(false);
      expect(config.dimension).toBe(provider.getVocabularySize());
    });

    it('should use default maxFeatures before vocabulary is built', () => {
      const provider = new TfIdfEmbeddingProvider({ maxFeatures: 100 });
      const config = provider.getConfig();
      // Before building vocabulary, dimension reports maxFeatures
      expect(config.dimension).toBe(100);
    });
  });
});

// ============================================================================
// EmbeddingGenerator - Basic Operations
// ============================================================================

describe('EmbeddingGenerator', () => {
  describe('generateEmbeddings', () => {
    it('should generate embeddings for all chunks', async () => {
      const provider = makeMockProvider({ dimension: 4 });
      const generator = new EmbeddingGenerator({ provider });

      const chunks = [
        makeChunk('first chunk content', { index: 0 }),
        makeChunk('second chunk content', { index: 1 }),
        makeChunk('third chunk content', { index: 2 }),
      ];

      const { embeddings, summary } = await generator.generateEmbeddings(chunks);

      expect(embeddings).toHaveLength(3);
      expect(summary.totalChunks).toBe(3);
      expect(summary.succeeded).toBe(3);
      expect(summary.failed).toBe(0);
      expect(summary.provider).toBe('mock');
    });

    it('should preserve chunk metadata in embedded chunks', async () => {
      const provider = makeMockProvider({ dimension: 3 });
      const generator = new EmbeddingGenerator({ provider });

      const chunk = makeChunk('test content', {
        id: 'docs/readme.md#chunk-0',
        documentId: 'docs/readme.md',
        index: 0,
        category: 'solutions',
        headingContext: 'Installation',
      });

      const { embeddings } = await generator.generateEmbeddings([chunk]);

      expect(embeddings).toHaveLength(1);
      expect(embeddings[0].chunkId).toBe('docs/readme.md#chunk-0');
      expect(embeddings[0].documentId).toBe('docs/readme.md');
      expect(embeddings[0].content).toBe('test content');
      expect(embeddings[0].category).toBe('solutions');
      expect(embeddings[0].headingContext).toBe('Installation');
      expect(embeddings[0].dimension).toBe(3);
    });

    it('should handle empty chunk array', async () => {
      const provider = makeMockProvider();
      const generator = new EmbeddingGenerator({ provider });

      const { embeddings, summary } = await generator.generateEmbeddings([]);

      expect(embeddings).toHaveLength(0);
      expect(summary.totalChunks).toBe(0);
      expect(summary.succeeded).toBe(0);
      expect(summary.failed).toBe(0);
    });

    it('should include duration in summary', async () => {
      const provider = makeMockProvider();
      const generator = new EmbeddingGenerator({ provider });

      const { summary } = await generator.generateEmbeddings([
        makeChunk('test content'),
      ]);

      expect(summary.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should report dimension in summary', async () => {
      const provider = makeMockProvider({ dimension: 128 });
      const generator = new EmbeddingGenerator({ provider });

      const { summary } = await generator.generateEmbeddings([
        makeChunk('test content'),
      ]);

      expect(summary.dimension).toBe(128);
    });
  });

  // --------------------------------------------------------------------------
  // Batch Processing
  // --------------------------------------------------------------------------

  describe('batch processing', () => {
    it('should process chunks in batches', async () => {
      const provider = makeMockProvider({ dimension: 3 });
      const generator = new EmbeddingGenerator({ provider, batchSize: 2 });

      const chunks = [
        makeChunk('chunk 1', { index: 0 }),
        makeChunk('chunk 2', { index: 1 }),
        makeChunk('chunk 3', { index: 2 }),
        makeChunk('chunk 4', { index: 3 }),
        makeChunk('chunk 5', { index: 4 }),
      ];

      const { embeddings, summary } = await generator.generateEmbeddings(chunks);

      expect(embeddings).toHaveLength(5);
      expect(summary.succeeded).toBe(5);
      expect(summary.failed).toBe(0);
    });

    it('should handle batch size larger than chunk count', async () => {
      const provider = makeMockProvider();
      const generator = new EmbeddingGenerator({ provider, batchSize: 100 });

      const chunks = [makeChunk('small set', { index: 0 })];
      const { embeddings } = await generator.generateEmbeddings(chunks);

      expect(embeddings).toHaveLength(1);
    });

    it('should handle batch size of 1', async () => {
      const provider = makeMockProvider();
      const generator = new EmbeddingGenerator({ provider, batchSize: 1 });

      const chunks = [
        makeChunk('chunk a', { index: 0 }),
        makeChunk('chunk b', { index: 1 }),
        makeChunk('chunk c', { index: 2 }),
      ];

      const { embeddings } = await generator.generateEmbeddings(chunks);
      expect(embeddings).toHaveLength(3);
    });
  });

  // --------------------------------------------------------------------------
  // Error Handling
  // --------------------------------------------------------------------------

  describe('error handling', () => {
    it('should skip failed batches when skipOnError is true', async () => {
      const provider = makeMockProvider({ failOnBatch: true });
      const generator = new EmbeddingGenerator({
        provider,
        skipOnError: true,
        batchSize: 2,
      });

      const chunks = [
        makeChunk('chunk 1', { index: 0 }),
        makeChunk('chunk 2', { index: 1 }),
      ];

      const { embeddings, summary } = await generator.generateEmbeddings(chunks);

      expect(embeddings).toHaveLength(0);
      expect(summary.failed).toBe(2);
      expect(summary.succeeded).toBe(0);
    });

    it('should throw on batch failure when skipOnError is false', async () => {
      const provider = makeMockProvider({ failOnBatch: true });
      const generator = new EmbeddingGenerator({
        provider,
        skipOnError: false,
      });

      const chunks = [makeChunk('test chunk')];

      await expect(generator.generateEmbeddings(chunks)).rejects.toThrow(
        'Mock batch failure',
      );
    });

    it('should handle partial batch failures across multiple batches', async () => {
      // Create a provider that fails on even-indexed batches
      let batchIndex = 0;
      const provider: EmbeddingProvider = {
        getConfig() {
          return {
            id: 'partial-fail',
            name: 'Partial Fail',
            dimension: 3,
            maxInputLength: 0,
            requiresNetwork: false,
            requiresApiKey: false,
          };
        },
        async embed(text: string) {
          return [1, 0, 0];
        },
        async embedBatch(texts: string[]) {
          const currentBatch = batchIndex++;
          if (currentBatch % 2 === 1) {
            throw new Error('Alternate batch failure');
          }
          return texts.map(() => [1, 0, 0]);
        },
      };

      const generator = new EmbeddingGenerator({
        provider,
        batchSize: 2,
        skipOnError: true,
      });

      const chunks = [
        makeChunk('chunk 1', { index: 0 }),
        makeChunk('chunk 2', { index: 1 }),
        makeChunk('chunk 3', { index: 2 }),
        makeChunk('chunk 4', { index: 3 }),
      ];

      const { embeddings, summary } = await generator.generateEmbeddings(chunks);

      // First batch (index 0) succeeds, second batch (index 1) fails
      expect(summary.succeeded).toBe(2);
      expect(summary.failed).toBe(2);
      expect(embeddings).toHaveLength(2);
    });
  });

  // --------------------------------------------------------------------------
  // Query Embedding
  // --------------------------------------------------------------------------

  describe('generateQueryEmbedding', () => {
    it('should generate embedding for a query text', async () => {
      const provider = makeMockProvider({ dimension: 5 });
      const generator = new EmbeddingGenerator({ provider });

      const embedding = await generator.generateQueryEmbedding('search query');

      expect(embedding).toBeInstanceOf(Array);
      expect(embedding).toHaveLength(5);
    });

    it('should propagate errors from provider', async () => {
      const provider = makeMockProvider({ failOnEmbed: true });
      const generator = new EmbeddingGenerator({ provider });

      await expect(
        generator.generateQueryEmbedding('test'),
      ).rejects.toThrow('Mock embed failure');
    });
  });

  // --------------------------------------------------------------------------
  // Configuration
  // --------------------------------------------------------------------------

  describe('configuration', () => {
    it('should expose provider config', () => {
      const provider = makeMockProvider({ dimension: 256 });
      const generator = new EmbeddingGenerator({ provider });

      const config = generator.getProviderConfig();
      expect(config.id).toBe('mock');
      expect(config.dimension).toBe(256);
    });

    it('should expose batch size', () => {
      const provider = makeMockProvider();
      const generator = new EmbeddingGenerator({ provider, batchSize: 25 });

      expect(generator.getBatchSize()).toBe(25);
    });

    it('should use default batch size of 50', () => {
      const provider = makeMockProvider();
      const generator = new EmbeddingGenerator({ provider });

      expect(generator.getBatchSize()).toBe(50);
    });
  });

  // --------------------------------------------------------------------------
  // Integration with TF-IDF Provider
  // --------------------------------------------------------------------------

  describe('integration with TfIdfEmbeddingProvider', () => {
    it('should work end-to-end with TF-IDF provider', async () => {
      const provider = new TfIdfEmbeddingProvider();
      const chunks = [
        makeChunk('npm install timeout connection error', {
          id: 'issues/network.md#chunk-0',
          documentId: 'issues/network.md',
          index: 0,
          category: 'issues',
          headingContext: 'Network Errors',
        }),
        makeChunk('permission denied sudo access root', {
          id: 'issues/permission.md#chunk-0',
          documentId: 'issues/permission.md',
          index: 0,
          category: 'issues',
          headingContext: 'Permission Errors',
        }),
        makeChunk('node version mismatch compatibility check', {
          id: 'solutions/node-version.md#chunk-0',
          documentId: 'solutions/node-version.md',
          index: 0,
          category: 'solutions',
          headingContext: 'Node Version',
        }),
      ];

      // Build vocabulary from chunk contents
      provider.buildVocabulary(chunks.map((c) => c.content));

      const generator = new EmbeddingGenerator({ provider });
      const { embeddings, summary } = await generator.generateEmbeddings(chunks);

      expect(summary.totalChunks).toBe(3);
      expect(summary.succeeded).toBe(3);
      expect(summary.failed).toBe(0);
      expect(summary.provider).toBe('tfidf');
      expect(summary.dimension).toBe(provider.getVocabularySize());

      // Each embedded chunk should have the right dimension
      for (const emb of embeddings) {
        expect(emb.embedding.length).toBe(provider.getVocabularySize());
        expect(emb.dimension).toBe(provider.getVocabularySize());
      }

      // Verify metadata preservation
      expect(embeddings[0].chunkId).toBe('issues/network.md#chunk-0');
      expect(embeddings[0].category).toBe('issues');
      expect(embeddings[0].headingContext).toBe('Network Errors');
    });

    it('should enable semantic search via query embedding', async () => {
      const provider = new TfIdfEmbeddingProvider();
      const chunks = [
        makeChunk('npm install timeout connection error registry'),
        makeChunk('permission denied sudo access control root'),
        makeChunk('node version mismatch nvm install update'),
      ];

      provider.buildVocabulary(chunks.map((c) => c.content));

      const generator = new EmbeddingGenerator({ provider });
      const { embeddings } = await generator.generateEmbeddings(chunks);

      // Generate a query embedding
      const queryEmb = await generator.generateQueryEmbedding('npm timeout error');

      // Compute similarities
      const similarities = embeddings.map((emb) =>
        cosineSimilarity(queryEmb, emb.embedding),
      );

      // The first chunk (about npm install timeout) should be most similar
      const maxIndex = similarities.indexOf(Math.max(...similarities));
      expect(maxIndex).toBe(0);
    });

    it('should handle single document corpus', async () => {
      const provider = new TfIdfEmbeddingProvider();
      const chunks = [makeChunk('single document content text here')];

      provider.buildVocabulary(chunks.map((c) => c.content));

      const generator = new EmbeddingGenerator({ provider });
      const { embeddings, summary } = await generator.generateEmbeddings(chunks);

      expect(summary.succeeded).toBe(1);
      expect(embeddings).toHaveLength(1);
    });

    it('should handle chunks with overlapping content', async () => {
      const provider = new TfIdfEmbeddingProvider();
      // Need more docs so shared terms get non-zero IDF when not in all docs
      const chunks = [
        makeChunk('install npm package globally sudo', { index: 0 }),
        makeChunk('npm package globally sudo permissions', { index: 1 }),
        makeChunk('completely different topic about network timeout', { index: 2 }),
        makeChunk('another unrelated text about version mismatch', { index: 3 }),
      ];

      provider.buildVocabulary(chunks.map((c) => c.content));

      const generator = new EmbeddingGenerator({ provider });
      const { embeddings } = await generator.generateEmbeddings(chunks);

      // First two chunks (overlapping) should be more similar than first and third
      const simOverlap = cosineSimilarity(embeddings[0].embedding, embeddings[1].embedding);
      const simDifferent = cosineSimilarity(embeddings[0].embedding, embeddings[2].embedding);
      expect(simOverlap).toBeGreaterThan(simDifferent);
    });

    it('should handle large batch with TF-IDF', async () => {
      const provider = new TfIdfEmbeddingProvider();
      const chunks: TextChunk[] = [];

      for (let i = 0; i < 100; i++) {
        chunks.push(
          makeChunk(`document number ${i} with content about topic ${i % 10}`, {
            index: i,
            id: `doc-${i}#chunk-0`,
            documentId: `doc-${i}`,
          }),
        );
      }

      provider.buildVocabulary(chunks.map((c) => c.content));

      const generator = new EmbeddingGenerator({ provider, batchSize: 20 });
      const { embeddings, summary } = await generator.generateEmbeddings(chunks);

      expect(summary.totalChunks).toBe(100);
      expect(summary.succeeded).toBe(100);
      expect(summary.failed).toBe(0);
      expect(embeddings).toHaveLength(100);
    });
  });
});
