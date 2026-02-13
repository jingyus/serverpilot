// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for the query embedding generator module.
 */

import { describe, it, expect } from 'vitest';
import {
  QueryEmbedder,
  expandWithSynonyms,
  getSynonymMap,
} from './query-embedder.js';
import {
  TfIdfEmbeddingProvider,
  cosineSimilarity,
  magnitude,
} from './embedding-generator.js';
import type {
  EmbeddingProvider,
  EmbeddingProviderConfig,
} from './embedding-generator.js';

// ============================================================================
// Test Helpers
// ============================================================================

/** Create a mock embedding provider */
function makeMockProvider(options: {
  dimension?: number;
  failOnEmbed?: boolean;
} = {}): EmbeddingProvider {
  const dimension = options.dimension ?? 4;

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
      const vector = new Array(dimension).fill(0);
      for (let i = 0; i < text.length; i++) {
        vector[i % dimension] += text.charCodeAt(i);
      }
      const mag = Math.sqrt(vector.reduce((s: number, v: number) => s + v * v, 0));
      if (mag > 0) {
        for (let i = 0; i < vector.length; i++) {
          vector[i] /= mag;
        }
      }
      return vector;
    },
    async embedBatch(texts: string[]): Promise<number[][]> {
      const results: number[][] = [];
      for (const text of texts) {
        results.push(await this.embed(text));
      }
      return results;
    },
  };
}

// ============================================================================
// QueryEmbedder - Basic Operations
// ============================================================================

describe('QueryEmbedder', () => {
  describe('embedQuery', () => {
    it('should generate an embedding for a query', async () => {
      const provider = makeMockProvider({ dimension: 4 });
      const embedder = new QueryEmbedder({ provider });

      const result = await embedder.embedQuery('npm install error');

      expect(result.originalQuery).toBe('npm install error');
      expect(result.processedQuery).toBe('npm install error');
      expect(result.embedding).toBeInstanceOf(Array);
      expect(result.embedding).toHaveLength(4);
      expect(result.dimension).toBe(4);
      expect(result.cached).toBe(false);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should return a normalized embedding vector', async () => {
      const provider = makeMockProvider({ dimension: 4 });
      const embedder = new QueryEmbedder({ provider });

      const result = await embedder.embedQuery('test query');
      const norm = magnitude(result.embedding);

      if (norm > 0) {
        expect(norm).toBeCloseTo(1, 5);
      }
    });

    it('should propagate provider errors', async () => {
      const provider = makeMockProvider({ failOnEmbed: true });
      const embedder = new QueryEmbedder({ provider });

      await expect(embedder.embedQuery('test')).rejects.toThrow('Mock embed failure');
    });

    it('should throw for empty query when minQueryLength > 0', async () => {
      const provider = makeMockProvider();
      const embedder = new QueryEmbedder({
        provider,
        preprocessOptions: { minQueryLength: 1 },
      });

      await expect(embedder.embedQuery('')).rejects.toThrow('Query too short');
    });

    it('should throw for short query below minQueryLength', async () => {
      const provider = makeMockProvider();
      const embedder = new QueryEmbedder({
        provider,
        preprocessOptions: { minQueryLength: 5 },
      });

      await expect(embedder.embedQuery('hi')).rejects.toThrow('Query too short');
    });

    it('should handle single word query', async () => {
      const provider = makeMockProvider({ dimension: 3 });
      const embedder = new QueryEmbedder({ provider });

      const result = await embedder.embedQuery('npm');

      expect(result.embedding).toHaveLength(3);
      expect(result.processedQuery).toBe('npm');
    });

    it('should handle query with special characters', async () => {
      const provider = makeMockProvider({ dimension: 3 });
      const embedder = new QueryEmbedder({ provider });

      const result = await embedder.embedQuery('npm@latest --save-dev');

      expect(result.embedding).toHaveLength(3);
      expect(result.processedQuery).toBe('npm@latest --save-dev');
    });

    it('should handle Chinese query text', async () => {
      const provider = makeMockProvider({ dimension: 3 });
      const embedder = new QueryEmbedder({ provider });

      const result = await embedder.embedQuery('npm 安装超时错误');

      expect(result.embedding).toHaveLength(3);
      expect(result.processedQuery).toBe('npm 安装超时错误');
    });
  });

  // --------------------------------------------------------------------------
  // Preprocessing
  // --------------------------------------------------------------------------

  describe('preprocessQuery', () => {
    it('should lowercase by default', () => {
      const provider = makeMockProvider();
      const embedder = new QueryEmbedder({ provider });

      expect(embedder.preprocessQuery('NPM Install')).toBe('npm install');
    });

    it('should trim whitespace by default', () => {
      const provider = makeMockProvider();
      const embedder = new QueryEmbedder({ provider });

      expect(embedder.preprocessQuery('  npm   install  ')).toBe('npm install');
    });

    it('should not lowercase when disabled', () => {
      const provider = makeMockProvider();
      const embedder = new QueryEmbedder({
        provider,
        preprocessOptions: { lowercase: false },
      });

      expect(embedder.preprocessQuery('NPM Install')).toBe('NPM Install');
    });

    it('should not trim whitespace when disabled', () => {
      const provider = makeMockProvider();
      const embedder = new QueryEmbedder({
        provider,
        preprocessOptions: { trimWhitespace: false },
      });

      expect(embedder.preprocessQuery('  npm   install  ')).toBe('  npm   install  ');
    });

    it('should expand synonyms when enabled', () => {
      const provider = makeMockProvider();
      const embedder = new QueryEmbedder({
        provider,
        preprocessOptions: { expandSynonyms: true },
      });

      const result = embedder.preprocessQuery('install error');
      // Should contain the original plus synonyms
      expect(result).toContain('install');
      expect(result).toContain('error');
      expect(result).toContain('setup'); // synonym of install
      expect(result).toContain('failure'); // synonym of error
    });

    it('should not expand synonyms by default', () => {
      const provider = makeMockProvider();
      const embedder = new QueryEmbedder({ provider });

      const result = embedder.preprocessQuery('install error');
      expect(result).toBe('install error');
      expect(result).not.toContain('setup');
    });

    it('should handle empty string', () => {
      const provider = makeMockProvider();
      const embedder = new QueryEmbedder({ provider });

      expect(embedder.preprocessQuery('')).toBe('');
    });
  });

  // --------------------------------------------------------------------------
  // Caching
  // --------------------------------------------------------------------------

  describe('caching', () => {
    it('should cache query embeddings', async () => {
      const provider = makeMockProvider({ dimension: 3 });
      const embedder = new QueryEmbedder({ provider, maxCacheSize: 10 });

      const result1 = await embedder.embedQuery('npm error');
      expect(result1.cached).toBe(false);

      const result2 = await embedder.embedQuery('npm error');
      expect(result2.cached).toBe(true);
      expect(result2.embedding).toEqual(result1.embedding);
    });

    it('should not cache when maxCacheSize is 0', async () => {
      const provider = makeMockProvider({ dimension: 3 });
      const embedder = new QueryEmbedder({ provider, maxCacheSize: 0 });

      const result1 = await embedder.embedQuery('npm error');
      const result2 = await embedder.embedQuery('npm error');

      expect(result1.cached).toBe(false);
      expect(result2.cached).toBe(false);
    });

    it('should evict oldest entry when cache is full', async () => {
      const provider = makeMockProvider({ dimension: 3 });
      const embedder = new QueryEmbedder({ provider, maxCacheSize: 2 });

      await embedder.embedQuery('query one');
      await embedder.embedQuery('query two');
      expect(embedder.getCacheSize()).toBe(2);

      // This should evict 'query one'
      await embedder.embedQuery('query three');
      expect(embedder.getCacheSize()).toBe(2);

      // 'query two' should still be cached
      const result2 = await embedder.embedQuery('query two');
      expect(result2.cached).toBe(true);

      // 'query one' should no longer be cached
      const result1 = await embedder.embedQuery('query one');
      expect(result1.cached).toBe(false);
    });

    it('should clear cache', async () => {
      const provider = makeMockProvider({ dimension: 3 });
      const embedder = new QueryEmbedder({ provider, maxCacheSize: 10 });

      await embedder.embedQuery('test query');
      expect(embedder.getCacheSize()).toBe(1);

      embedder.clearCache();
      expect(embedder.getCacheSize()).toBe(0);

      // Should not be cached after clear
      const result = await embedder.embedQuery('test query');
      expect(result.cached).toBe(false);
    });

    it('should use preprocessed query as cache key', async () => {
      const provider = makeMockProvider({ dimension: 3 });
      const embedder = new QueryEmbedder({ provider, maxCacheSize: 10 });

      await embedder.embedQuery('NPM Error');
      // Same query in different case should hit cache (since lowercase is on)
      const result = await embedder.embedQuery('npm error');
      expect(result.cached).toBe(true);
    });

    it('should report cache size correctly', async () => {
      const provider = makeMockProvider({ dimension: 3 });
      const embedder = new QueryEmbedder({ provider, maxCacheSize: 10 });

      expect(embedder.getCacheSize()).toBe(0);

      await embedder.embedQuery('query one');
      expect(embedder.getCacheSize()).toBe(1);

      await embedder.embedQuery('query two');
      expect(embedder.getCacheSize()).toBe(2);

      // Same query should not increase size
      await embedder.embedQuery('query one');
      expect(embedder.getCacheSize()).toBe(2);
    });
  });

  // --------------------------------------------------------------------------
  // Batch Queries
  // --------------------------------------------------------------------------

  describe('embedQueries', () => {
    it('should generate embeddings for multiple queries', async () => {
      const provider = makeMockProvider({ dimension: 4 });
      const embedder = new QueryEmbedder({ provider });

      const results = await embedder.embedQueries([
        'npm install error',
        'permission denied',
        'node version mismatch',
      ]);

      expect(results).toHaveLength(3);
      for (const result of results) {
        expect(result.embedding).toHaveLength(4);
        expect(result.dimension).toBe(4);
      }
    });

    it('should return empty array for empty input', async () => {
      const provider = makeMockProvider();
      const embedder = new QueryEmbedder({ provider });

      const results = await embedder.embedQueries([]);
      expect(results).toEqual([]);
    });

    it('should cache repeated queries in batch', async () => {
      const provider = makeMockProvider({ dimension: 3 });
      const embedder = new QueryEmbedder({ provider, maxCacheSize: 10 });

      const results = await embedder.embedQueries([
        'test query',
        'test query',
      ]);

      expect(results[0].cached).toBe(false);
      expect(results[1].cached).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Configuration
  // --------------------------------------------------------------------------

  describe('configuration', () => {
    it('should expose provider config', () => {
      const provider = makeMockProvider({ dimension: 128 });
      const embedder = new QueryEmbedder({ provider });

      const config = embedder.getProviderConfig();
      expect(config.id).toBe('mock');
      expect(config.dimension).toBe(128);
    });

    it('should default maxCacheSize to 100', async () => {
      const provider = makeMockProvider();
      const embedder = new QueryEmbedder({ provider });

      // Fill cache with many queries
      for (let i = 0; i < 101; i++) {
        await embedder.embedQuery(`query ${i}`);
      }

      // Cache should be capped at 100
      expect(embedder.getCacheSize()).toBe(100);
    });

    it('should use default preprocessing options', () => {
      const provider = makeMockProvider();
      const embedder = new QueryEmbedder({ provider });

      // Default: lowercase + trim, no synonym expansion
      expect(embedder.preprocessQuery('  HELLO  WORLD  ')).toBe('hello world');
    });
  });

  // --------------------------------------------------------------------------
  // Integration with TF-IDF Provider
  // --------------------------------------------------------------------------

  describe('integration with TfIdfEmbeddingProvider', () => {
    it('should work end-to-end with TF-IDF provider', async () => {
      const provider = new TfIdfEmbeddingProvider();
      provider.buildVocabulary([
        'npm install timeout connection error registry',
        'permission denied sudo access control',
        'node version mismatch nvm install',
      ]);

      const embedder = new QueryEmbedder({ provider });
      const result = await embedder.embedQuery('npm timeout error');

      expect(result.embedding).toBeInstanceOf(Array);
      expect(result.embedding.length).toBe(provider.getVocabularySize());
      expect(result.dimension).toBe(provider.getVocabularySize());
      expect(result.cached).toBe(false);
    });

    it('should produce semantically relevant query embeddings', async () => {
      const provider = new TfIdfEmbeddingProvider();
      const corpus = [
        'npm install timeout connection error registry',
        'permission denied sudo access control root',
        'node version mismatch nvm install update',
      ];
      provider.buildVocabulary(corpus);

      const embedder = new QueryEmbedder({ provider });

      // Generate query embedding
      const queryResult = await embedder.embedQuery('npm timeout error');

      // Generate corpus embeddings for comparison
      const corpusEmbeddings = await provider.embedBatch(corpus);

      // Compute similarities
      const similarities = corpusEmbeddings.map((emb) =>
        cosineSimilarity(queryResult.embedding, emb),
      );

      // The first corpus entry (npm install timeout) should be most similar
      const maxIndex = similarities.indexOf(Math.max(...similarities));
      expect(maxIndex).toBe(0);
    });

    it('should produce different embeddings for different queries', async () => {
      const provider = new TfIdfEmbeddingProvider();
      provider.buildVocabulary([
        'npm install timeout error',
        'permission denied sudo',
        'node version check',
      ]);

      const embedder = new QueryEmbedder({ provider });

      const result1 = await embedder.embedQuery('npm timeout');
      const result2 = await embedder.embedQuery('permission denied');

      // Should not be identical
      const similarity = cosineSimilarity(result1.embedding, result2.embedding);
      expect(similarity).toBeLessThan(1);
    });

    it('should benefit from synonym expansion for search relevance', async () => {
      const provider = new TfIdfEmbeddingProvider();
      const corpus = [
        'setup configure deploy application',
        'install package dependency module',
        'network connection proxy registry',
      ];
      provider.buildVocabulary(corpus);

      const embedderNoSynonyms = new QueryEmbedder({ provider });
      const embedderWithSynonyms = new QueryEmbedder({
        provider,
        preprocessOptions: { expandSynonyms: true },
      });

      // Query "install" with synonym expansion should also match "setup configure deploy"
      const resultNoSyn = await embedderNoSynonyms.embedQuery('install');
      const resultWithSyn = await embedderWithSynonyms.embedQuery('install');

      // The expanded query should be different from the non-expanded
      expect(resultWithSyn.processedQuery).not.toBe(resultNoSyn.processedQuery);
      expect(resultWithSyn.processedQuery).toContain('setup');
    });
  });
});

// ============================================================================
// expandWithSynonyms
// ============================================================================

describe('expandWithSynonyms', () => {
  it('should expand known words with synonyms', () => {
    const result = expandWithSynonyms('install error');
    expect(result).toContain('install');
    expect(result).toContain('error');
    expect(result).toContain('setup'); // synonym of install
    expect(result).toContain('failure'); // synonym of error
  });

  it('should not modify query without synonym matches', () => {
    const result = expandWithSynonyms('unknown word here');
    expect(result).toBe('unknown word here');
  });

  it('should handle empty string', () => {
    const result = expandWithSynonyms('');
    expect(result).toBe('');
  });

  it('should expand timeout with synonyms', () => {
    const result = expandWithSynonyms('timeout problem');
    expect(result).toContain('slow');
    expect(result).toContain('hang');
  });

  it('should expand permission with synonyms', () => {
    const result = expandWithSynonyms('permission error');
    expect(result).toContain('access');
    expect(result).toContain('denied');
    expect(result).toContain('eacces');
  });

  it('should expand network with synonyms', () => {
    const result = expandWithSynonyms('network error');
    expect(result).toContain('connection');
    expect(result).toContain('proxy');
    expect(result).toContain('registry');
  });
});

// ============================================================================
// getSynonymMap
// ============================================================================

describe('getSynonymMap', () => {
  it('should return a copy of the synonym map', () => {
    const map = getSynonymMap();
    expect(map).toHaveProperty('install');
    expect(map).toHaveProperty('error');
    expect(map).toHaveProperty('timeout');
    expect(map).toHaveProperty('permission');
    expect(map).toHaveProperty('network');
  });

  it('should return a new object each time', () => {
    const map1 = getSynonymMap();
    const map2 = getSynonymMap();
    expect(map1).not.toBe(map2);
    expect(map1).toEqual(map2);
  });

  it('should not allow mutation of internal map', () => {
    const map = getSynonymMap();
    map['install'] = ['modified'];

    const map2 = getSynonymMap();
    expect(map2['install']).toContain('setup');
  });
});
