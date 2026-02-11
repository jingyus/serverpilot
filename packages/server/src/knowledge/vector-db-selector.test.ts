// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for the vector database backend selector module.
 */

import { describe, it, expect } from 'vitest';
import {
  checkEnvironment,
  isBackendAvailable,
  selectVectorDBBackend,
  getAllBackendInfo,
  getBackendInfo,
  BACKENDS,
  type VectorDBBackend,
  type EnvironmentCheck,
  type BackendInfo,
  type SelectionResult,
} from './vector-db-selector.js';

// ============================================================================
// checkEnvironment
// ============================================================================

describe('checkEnvironment', () => {
  it('should return defaults when no env vars are set', () => {
    const result = checkEnvironment({});
    expect(result.hasQdrantUrl).toBe(false);
    expect(result.hasPineconeApiKey).toBe(false);
    expect(result.hasPineconeEnvironment).toBe(false);
    expect(result.explicitBackend).toBeNull();
    expect(result.documentCount).toBe(0);
  });

  it('should detect QDRANT_URL', () => {
    const result = checkEnvironment({ QDRANT_URL: 'http://localhost:6333' });
    expect(result.hasQdrantUrl).toBe(true);
  });

  it('should ignore empty QDRANT_URL', () => {
    const result = checkEnvironment({ QDRANT_URL: '' });
    expect(result.hasQdrantUrl).toBe(false);
  });

  it('should ignore whitespace-only QDRANT_URL', () => {
    const result = checkEnvironment({ QDRANT_URL: '   ' });
    expect(result.hasQdrantUrl).toBe(false);
  });

  it('should detect PINECONE_API_KEY', () => {
    const result = checkEnvironment({ PINECONE_API_KEY: 'pk-abc123' });
    expect(result.hasPineconeApiKey).toBe(true);
  });

  it('should ignore empty PINECONE_API_KEY', () => {
    const result = checkEnvironment({ PINECONE_API_KEY: '' });
    expect(result.hasPineconeApiKey).toBe(false);
  });

  it('should detect PINECONE_ENVIRONMENT', () => {
    const result = checkEnvironment({ PINECONE_ENVIRONMENT: 'us-east-1' });
    expect(result.hasPineconeEnvironment).toBe(true);
  });

  it('should ignore empty PINECONE_ENVIRONMENT', () => {
    const result = checkEnvironment({ PINECONE_ENVIRONMENT: '' });
    expect(result.hasPineconeEnvironment).toBe(false);
  });

  it('should detect explicit VECTOR_DB_BACKEND=local', () => {
    const result = checkEnvironment({ VECTOR_DB_BACKEND: 'local' });
    expect(result.explicitBackend).toBe('local');
  });

  it('should detect explicit VECTOR_DB_BACKEND=qdrant', () => {
    const result = checkEnvironment({ VECTOR_DB_BACKEND: 'qdrant' });
    expect(result.explicitBackend).toBe('qdrant');
  });

  it('should detect explicit VECTOR_DB_BACKEND=pinecone', () => {
    const result = checkEnvironment({ VECTOR_DB_BACKEND: 'pinecone' });
    expect(result.explicitBackend).toBe('pinecone');
  });

  it('should handle case-insensitive VECTOR_DB_BACKEND', () => {
    const result = checkEnvironment({ VECTOR_DB_BACKEND: 'QDRANT' });
    expect(result.explicitBackend).toBe('qdrant');
  });

  it('should handle VECTOR_DB_BACKEND with whitespace', () => {
    const result = checkEnvironment({ VECTOR_DB_BACKEND: '  local  ' });
    expect(result.explicitBackend).toBe('local');
  });

  it('should ignore invalid VECTOR_DB_BACKEND', () => {
    const result = checkEnvironment({ VECTOR_DB_BACKEND: 'invalid' });
    expect(result.explicitBackend).toBeNull();
  });

  it('should ignore empty VECTOR_DB_BACKEND', () => {
    const result = checkEnvironment({ VECTOR_DB_BACKEND: '' });
    expect(result.explicitBackend).toBeNull();
  });

  it('should accept documentCount parameter', () => {
    const result = checkEnvironment({}, 500);
    expect(result.documentCount).toBe(500);
  });

  it('should handle all env vars set together', () => {
    const result = checkEnvironment({
      QDRANT_URL: 'http://localhost:6333',
      PINECONE_API_KEY: 'pk-abc',
      PINECONE_ENVIRONMENT: 'us-east-1',
      VECTOR_DB_BACKEND: 'pinecone',
    }, 100);
    expect(result.hasQdrantUrl).toBe(true);
    expect(result.hasPineconeApiKey).toBe(true);
    expect(result.hasPineconeEnvironment).toBe(true);
    expect(result.explicitBackend).toBe('pinecone');
    expect(result.documentCount).toBe(100);
  });

  it('should handle undefined env vars', () => {
    const result = checkEnvironment({ QDRANT_URL: undefined, PINECONE_API_KEY: undefined });
    expect(result.hasQdrantUrl).toBe(false);
    expect(result.hasPineconeApiKey).toBe(false);
  });
});

// ============================================================================
// isBackendAvailable
// ============================================================================

describe('isBackendAvailable', () => {
  const baseEnvCheck: EnvironmentCheck = {
    hasQdrantUrl: false,
    hasPineconeApiKey: false,
    hasPineconeEnvironment: false,
    explicitBackend: null,
    documentCount: 0,
  };

  describe('local backend', () => {
    it('should always be available', () => {
      const result = isBackendAvailable('local', baseEnvCheck);
      expect(result.available).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('should be available even with no env vars', () => {
      const result = isBackendAvailable('local', {
        ...baseEnvCheck,
        hasQdrantUrl: false,
        hasPineconeApiKey: false,
      });
      expect(result.available).toBe(true);
    });
  });

  describe('qdrant backend', () => {
    it('should be available when QDRANT_URL is set', () => {
      const result = isBackendAvailable('qdrant', {
        ...baseEnvCheck,
        hasQdrantUrl: true,
      });
      expect(result.available).toBe(true);
    });

    it('should not be available when QDRANT_URL is not set', () => {
      const result = isBackendAvailable('qdrant', baseEnvCheck);
      expect(result.available).toBe(false);
      expect(result.reason).toContain('QDRANT_URL');
    });
  });

  describe('pinecone backend', () => {
    it('should be available when both API key and environment are set', () => {
      const result = isBackendAvailable('pinecone', {
        ...baseEnvCheck,
        hasPineconeApiKey: true,
        hasPineconeEnvironment: true,
      });
      expect(result.available).toBe(true);
    });

    it('should not be available when only API key is set', () => {
      const result = isBackendAvailable('pinecone', {
        ...baseEnvCheck,
        hasPineconeApiKey: true,
        hasPineconeEnvironment: false,
      });
      expect(result.available).toBe(false);
      expect(result.reason).toContain('PINECONE_ENVIRONMENT');
    });

    it('should not be available when only environment is set', () => {
      const result = isBackendAvailable('pinecone', {
        ...baseEnvCheck,
        hasPineconeApiKey: false,
        hasPineconeEnvironment: true,
      });
      expect(result.available).toBe(false);
      expect(result.reason).toContain('PINECONE_API_KEY');
    });

    it('should not be available when neither is set', () => {
      const result = isBackendAvailable('pinecone', baseEnvCheck);
      expect(result.available).toBe(false);
      expect(result.reason).toContain('PINECONE_API_KEY');
      expect(result.reason).toContain('PINECONE_ENVIRONMENT');
    });
  });
});

// ============================================================================
// selectVectorDBBackend
// ============================================================================

describe('selectVectorDBBackend', () => {
  describe('default selection (no env vars)', () => {
    it('should default to local when no env vars are set', () => {
      const result = selectVectorDBBackend({});
      expect(result.selected).toBe('local');
      expect(result.isExplicit).toBe(false);
      expect(result.reason).toContain('local');
    });

    it('should include availability of all backends', () => {
      const result = selectVectorDBBackend({});
      expect(result.available).toHaveLength(3);
      expect(result.available[0].backend).toBe('local');
      expect(result.available[0].isAvailable).toBe(true);
      expect(result.available[1].backend).toBe('qdrant');
      expect(result.available[1].isAvailable).toBe(false);
      expect(result.available[2].backend).toBe('pinecone');
      expect(result.available[2].isAvailable).toBe(false);
    });

    it('should provide a recommendation', () => {
      const result = selectVectorDBBackend({});
      expect(result.recommendation).toBeTruthy();
      expect(result.recommendation.length).toBeGreaterThan(0);
    });
  });

  describe('explicit VECTOR_DB_BACKEND', () => {
    it('should use explicit local backend', () => {
      const result = selectVectorDBBackend({ VECTOR_DB_BACKEND: 'local' });
      expect(result.selected).toBe('local');
      expect(result.isExplicit).toBe(true);
      expect(result.reason).toContain('Explicitly configured');
    });

    it('should use explicit qdrant backend when available', () => {
      const result = selectVectorDBBackend({
        VECTOR_DB_BACKEND: 'qdrant',
        QDRANT_URL: 'http://localhost:6333',
      });
      expect(result.selected).toBe('qdrant');
      expect(result.isExplicit).toBe(true);
    });

    it('should use explicit pinecone backend when available', () => {
      const result = selectVectorDBBackend({
        VECTOR_DB_BACKEND: 'pinecone',
        PINECONE_API_KEY: 'pk-abc',
        PINECONE_ENVIRONMENT: 'us-east-1',
      });
      expect(result.selected).toBe('pinecone');
      expect(result.isExplicit).toBe(true);
    });

    it('should fall through to auto-detect when explicit backend is unavailable (qdrant without URL)', () => {
      const result = selectVectorDBBackend({
        VECTOR_DB_BACKEND: 'qdrant',
        // no QDRANT_URL
      });
      expect(result.selected).toBe('local');
      expect(result.isExplicit).toBe(false);
    });

    it('should fall through to auto-detect when explicit pinecone is unavailable', () => {
      const result = selectVectorDBBackend({
        VECTOR_DB_BACKEND: 'pinecone',
        // no PINECONE_API_KEY or PINECONE_ENVIRONMENT
      });
      expect(result.selected).toBe('local');
      expect(result.isExplicit).toBe(false);
    });
  });

  describe('auto-detection priority', () => {
    it('should prefer qdrant over pinecone when both are configured', () => {
      const result = selectVectorDBBackend({
        QDRANT_URL: 'http://localhost:6333',
        PINECONE_API_KEY: 'pk-abc',
        PINECONE_ENVIRONMENT: 'us-east-1',
      });
      expect(result.selected).toBe('qdrant');
      expect(result.isExplicit).toBe(false);
    });

    it('should select qdrant when only QDRANT_URL is configured', () => {
      const result = selectVectorDBBackend({
        QDRANT_URL: 'http://localhost:6333',
      });
      expect(result.selected).toBe('qdrant');
      expect(result.reason).toContain('QDRANT_URL');
    });

    it('should select pinecone when only pinecone vars are configured', () => {
      const result = selectVectorDBBackend({
        PINECONE_API_KEY: 'pk-abc',
        PINECONE_ENVIRONMENT: 'us-east-1',
      });
      expect(result.selected).toBe('pinecone');
      expect(result.reason).toContain('Pinecone');
    });

    it('should fall back to local when pinecone is partially configured', () => {
      const result = selectVectorDBBackend({
        PINECONE_API_KEY: 'pk-abc',
        // no PINECONE_ENVIRONMENT
      });
      expect(result.selected).toBe('local');
    });

    it('should explicit override beat auto-detection', () => {
      const result = selectVectorDBBackend({
        VECTOR_DB_BACKEND: 'pinecone',
        QDRANT_URL: 'http://localhost:6333',
        PINECONE_API_KEY: 'pk-abc',
        PINECONE_ENVIRONMENT: 'us-east-1',
      });
      // Explicit pinecone should win over auto-detected qdrant
      expect(result.selected).toBe('pinecone');
      expect(result.isExplicit).toBe(true);
    });
  });

  describe('recommendations', () => {
    it('should warn about large document count with local backend', () => {
      const result = selectVectorDBBackend({}, 1500);
      expect(result.selected).toBe('local');
      expect(result.recommendation).toContain('1500');
      expect(result.recommendation).toContain('Qdrant');
    });

    it('should provide general recommendation for small local knowledge base', () => {
      const result = selectVectorDBBackend({}, 50);
      expect(result.recommendation).toContain('local');
    });

    it('should mention production readiness for qdrant', () => {
      const result = selectVectorDBBackend({
        QDRANT_URL: 'http://localhost:6333',
      });
      expect(result.recommendation).toContain('production');
    });

    it('should mention API quota for pinecone', () => {
      const result = selectVectorDBBackend({
        PINECONE_API_KEY: 'pk-abc',
        PINECONE_ENVIRONMENT: 'us-east-1',
      });
      expect(result.recommendation).toContain('quota');
    });
  });
});

// ============================================================================
// BACKENDS registry
// ============================================================================

describe('BACKENDS registry', () => {
  it('should have three backends', () => {
    expect(Object.keys(BACKENDS)).toHaveLength(3);
  });

  it('should include local, qdrant, pinecone', () => {
    expect(BACKENDS).toHaveProperty('local');
    expect(BACKENDS).toHaveProperty('qdrant');
    expect(BACKENDS).toHaveProperty('pinecone');
  });

  it('should have consistent id fields', () => {
    for (const [key, info] of Object.entries(BACKENDS)) {
      expect(info.id).toBe(key);
    }
  });

  describe('local backend info', () => {
    it('should not require external deps', () => {
      expect(BACKENDS.local.requiresExternalDeps).toBe(false);
    });

    it('should not require network', () => {
      expect(BACKENDS.local.requiresNetwork).toBe(false);
    });

    it('should have no required env vars', () => {
      expect(BACKENDS.local.requiredEnvVars).toHaveLength(0);
    });

    it('should have a max recommended docs limit', () => {
      expect(BACKENDS.local.maxRecommendedDocs).toBeGreaterThan(0);
    });

    it('should have pros and cons', () => {
      expect(BACKENDS.local.pros.length).toBeGreaterThan(0);
      expect(BACKENDS.local.cons.length).toBeGreaterThan(0);
    });
  });

  describe('qdrant backend info', () => {
    it('should require external deps', () => {
      expect(BACKENDS.qdrant.requiresExternalDeps).toBe(true);
    });

    it('should require network', () => {
      expect(BACKENDS.qdrant.requiresNetwork).toBe(true);
    });

    it('should require QDRANT_URL', () => {
      expect(BACKENDS.qdrant.requiredEnvVars).toContain('QDRANT_URL');
    });

    it('should have unlimited max docs', () => {
      expect(BACKENDS.qdrant.maxRecommendedDocs).toBe(0);
    });

    it('should have pros and cons', () => {
      expect(BACKENDS.qdrant.pros.length).toBeGreaterThan(0);
      expect(BACKENDS.qdrant.cons.length).toBeGreaterThan(0);
    });
  });

  describe('pinecone backend info', () => {
    it('should require external deps', () => {
      expect(BACKENDS.pinecone.requiresExternalDeps).toBe(true);
    });

    it('should require network', () => {
      expect(BACKENDS.pinecone.requiresNetwork).toBe(true);
    });

    it('should require PINECONE_API_KEY and PINECONE_ENVIRONMENT', () => {
      expect(BACKENDS.pinecone.requiredEnvVars).toContain('PINECONE_API_KEY');
      expect(BACKENDS.pinecone.requiredEnvVars).toContain('PINECONE_ENVIRONMENT');
    });

    it('should have unlimited max docs', () => {
      expect(BACKENDS.pinecone.maxRecommendedDocs).toBe(0);
    });

    it('should have pros and cons', () => {
      expect(BACKENDS.pinecone.pros.length).toBeGreaterThan(0);
      expect(BACKENDS.pinecone.cons.length).toBeGreaterThan(0);
    });
  });
});

// ============================================================================
// getAllBackendInfo
// ============================================================================

describe('getAllBackendInfo', () => {
  it('should return all three backends', () => {
    const all = getAllBackendInfo();
    expect(all).toHaveLength(3);
  });

  it('should return BackendInfo objects', () => {
    const all = getAllBackendInfo();
    for (const info of all) {
      expect(info).toHaveProperty('id');
      expect(info).toHaveProperty('name');
      expect(info).toHaveProperty('description');
      expect(info).toHaveProperty('requiresExternalDeps');
      expect(info).toHaveProperty('requiresNetwork');
      expect(info).toHaveProperty('requiredEnvVars');
      expect(info).toHaveProperty('maxRecommendedDocs');
      expect(info).toHaveProperty('pros');
      expect(info).toHaveProperty('cons');
    }
  });

  it('should include local, qdrant, and pinecone', () => {
    const ids = getAllBackendInfo().map((b) => b.id);
    expect(ids).toContain('local');
    expect(ids).toContain('qdrant');
    expect(ids).toContain('pinecone');
  });
});

// ============================================================================
// getBackendInfo
// ============================================================================

describe('getBackendInfo', () => {
  it('should return info for local', () => {
    const info = getBackendInfo('local');
    expect(info).toBeDefined();
    expect(info!.id).toBe('local');
    expect(info!.name).toBe('Local TF-IDF');
  });

  it('should return info for qdrant', () => {
    const info = getBackendInfo('qdrant');
    expect(info).toBeDefined();
    expect(info!.id).toBe('qdrant');
    expect(info!.name).toBe('Qdrant');
  });

  it('should return info for pinecone', () => {
    const info = getBackendInfo('pinecone');
    expect(info).toBeDefined();
    expect(info!.id).toBe('pinecone');
    expect(info!.name).toBe('Pinecone');
  });

  it('should return undefined for unknown backend', () => {
    const info = getBackendInfo('unknown' as VectorDBBackend);
    expect(info).toBeUndefined();
  });
});

// ============================================================================
// SelectionResult structure
// ============================================================================

describe('SelectionResult structure', () => {
  it('should always have required fields', () => {
    const result = selectVectorDBBackend({});
    expect(result).toHaveProperty('selected');
    expect(result).toHaveProperty('reason');
    expect(result).toHaveProperty('isExplicit');
    expect(result).toHaveProperty('available');
    expect(result).toHaveProperty('recommendation');
  });

  it('should have valid selected backend', () => {
    const result = selectVectorDBBackend({});
    expect(['local', 'qdrant', 'pinecone']).toContain(result.selected);
  });

  it('should have non-empty reason', () => {
    const result = selectVectorDBBackend({});
    expect(result.reason.length).toBeGreaterThan(0);
  });

  it('should have non-empty recommendation', () => {
    const result = selectVectorDBBackend({});
    expect(result.recommendation.length).toBeGreaterThan(0);
  });

  it('should have availability for all three backends', () => {
    const result = selectVectorDBBackend({});
    expect(result.available).toHaveLength(3);
    const backends = result.available.map((a) => a.backend);
    expect(backends).toContain('local');
    expect(backends).toContain('qdrant');
    expect(backends).toContain('pinecone');
  });

  it('should include unavailable reason for unavailable backends', () => {
    const result = selectVectorDBBackend({});
    const qdrant = result.available.find((a) => a.backend === 'qdrant');
    expect(qdrant?.isAvailable).toBe(false);
    expect(qdrant?.unavailableReason).toBeTruthy();
  });
});

// ============================================================================
// Edge cases
// ============================================================================

describe('edge cases', () => {
  it('should handle completely empty env object', () => {
    const result = selectVectorDBBackend({});
    expect(result.selected).toBe('local');
  });

  it('should handle env with only irrelevant vars', () => {
    const result = selectVectorDBBackend({
      HOME: '/Users/test',
      PATH: '/usr/bin',
      NODE_ENV: 'test',
    });
    expect(result.selected).toBe('local');
  });

  it('should handle zero document count', () => {
    const result = selectVectorDBBackend({}, 0);
    expect(result.selected).toBe('local');
  });

  it('should handle very large document count', () => {
    const result = selectVectorDBBackend({}, 1000000);
    expect(result.selected).toBe('local');
    expect(result.recommendation).toContain('Qdrant');
  });

  it('should handle document count at exactly the local limit', () => {
    const limit = BACKENDS.local.maxRecommendedDocs;
    const result = selectVectorDBBackend({}, limit);
    // At the limit, should not warn
    expect(result.selected).toBe('local');
  });

  it('should handle document count just above the local limit', () => {
    const limit = BACKENDS.local.maxRecommendedDocs;
    const result = selectVectorDBBackend({}, limit + 1);
    expect(result.selected).toBe('local');
    expect(result.recommendation).toContain('exceeds');
  });
});
