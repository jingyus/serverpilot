/**
 * Tests for the document update detection module.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  checkGitHubUpdate,
  checkWebsiteUpdate,
  hashContent,
  extractGitHubSha,
  extractWebsiteHash,
} from './doc-update-detector.js';

// ============================================================================
// Helpers
// ============================================================================

function createMockFetch(
  body: unknown,
  status = 200,
  headers?: Record<string, string>,
): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
    headers: {
      get: (name: string) => headers?.[name.toLowerCase()] ?? null,
    },
  }) as unknown as typeof fetch;
}

function createErrorFetch(error: string): typeof fetch {
  return vi.fn().mockRejectedValue(new Error(error)) as unknown as typeof fetch;
}

// ============================================================================
// Tests
// ============================================================================

describe('doc-update-detector', () => {
  // --------------------------------------------------------------------------
  // hashContent
  // --------------------------------------------------------------------------

  describe('hashContent', () => {
    it('should generate a 16-character hash', () => {
      const hash = hashContent('test content');
      expect(hash).toHaveLength(16);
      expect(hash).toMatch(/^[0-9a-f]{16}$/);
    });

    it('should generate different hashes for different content', () => {
      const hash1 = hashContent('content 1');
      const hash2 = hashContent('content 2');
      expect(hash1).not.toBe(hash2);
    });

    it('should generate the same hash for the same content', () => {
      const hash1 = hashContent('same content');
      const hash2 = hashContent('same content');
      expect(hash1).toBe(hash2);
    });
  });

  // --------------------------------------------------------------------------
  // extractGitHubSha
  // --------------------------------------------------------------------------

  describe('extractGitHubSha', () => {
    it('should extract SHA from first result', () => {
      const results = [{ sha: 'abc123' }, { sha: 'def456' }];
      expect(extractGitHubSha(results)).toBe('abc123');
    });

    it('should return undefined for empty array', () => {
      expect(extractGitHubSha([])).toBeUndefined();
    });
  });

  // --------------------------------------------------------------------------
  // extractWebsiteHash
  // --------------------------------------------------------------------------

  describe('extractWebsiteHash', () => {
    it('should compute hash of content', () => {
      const hash = extractWebsiteHash('website content');
      expect(hash).toHaveLength(16);
    });
  });

  // --------------------------------------------------------------------------
  // checkGitHubUpdate
  // --------------------------------------------------------------------------

  describe('checkGitHubUpdate', () => {
    it('should return hasUpdate=true when no previous SHA', async () => {
      const result = await checkGitHubUpdate({
        owner: 'test',
        repo: 'repo',
        branch: 'main',
      });

      expect(result.hasUpdate).toBe(true);
      expect(result.reason).toContain('No previous version');
    });

    it('should return hasUpdate=false when SHA matches', async () => {
      const mockFetch = createMockFetch({ sha: 'abc123' });

      const result = await checkGitHubUpdate(
        {
          owner: 'test',
          repo: 'repo',
          branch: 'main',
          previousSha: 'abc123',
        },
        { fetchFn: mockFetch },
      );

      expect(result.hasUpdate).toBe(false);
      expect(result.currentVersion).toBe('abc123');
      expect(result.previousVersion).toBe('abc123');
      expect(result.reason).toContain('No new commits');
    });

    it('should return hasUpdate=true when SHA differs', async () => {
      const mockFetch = createMockFetch({ sha: 'xyz789' });

      const result = await checkGitHubUpdate(
        {
          owner: 'test',
          repo: 'repo',
          branch: 'main',
          previousSha: 'abc123',
        },
        { fetchFn: mockFetch },
      );

      expect(result.hasUpdate).toBe(true);
      expect(result.currentVersion).toBe('xyz789');
      expect(result.previousVersion).toBe('abc123');
      expect(result.reason).toContain('New commits detected');
    });

    it('should handle API errors gracefully', async () => {
      const mockFetch = createMockFetch({}, 404);

      const result = await checkGitHubUpdate(
        {
          owner: 'test',
          repo: 'repo',
          branch: 'main',
          previousSha: 'abc123',
        },
        { fetchFn: mockFetch },
      );

      expect(result.hasUpdate).toBe(false);
      expect(result.reason).toContain('GitHub API error');
    });

    it('should handle network errors gracefully', async () => {
      const mockFetch = createErrorFetch('Network error');

      const result = await checkGitHubUpdate(
        {
          owner: 'test',
          repo: 'repo',
          branch: 'main',
          previousSha: 'abc123',
        },
        { fetchFn: mockFetch },
      );

      expect(result.hasUpdate).toBe(false);
      expect(result.reason).toContain('Update check failed');
    });
  });

  // --------------------------------------------------------------------------
  // checkWebsiteUpdate
  // --------------------------------------------------------------------------

  describe('checkWebsiteUpdate', () => {
    it('should return hasUpdate=true when no previous hash', async () => {
      const result = await checkWebsiteUpdate({
        url: 'https://example.com',
      });

      expect(result.hasUpdate).toBe(true);
      expect(result.reason).toContain('No previous version');
    });

    it('should use Last-Modified header when available', async () => {
      const timestamp = new Date('2024-01-01').toISOString();
      const mockFetch = createMockFetch('', 200, {
        'last-modified': new Date('2024-01-01').toUTCString(),
      });

      const result = await checkWebsiteUpdate(
        {
          url: 'https://example.com',
          previousHash: timestamp,
        },
        { fetchFn: mockFetch },
      );

      expect(result.hasUpdate).toBe(false);
      expect(result.reason).toContain('Last-Modified unchanged');
    });

    it('should detect change via Last-Modified header', async () => {
      const oldTimestamp = new Date('2024-01-01').toISOString();
      const mockFetch = createMockFetch('', 200, {
        'last-modified': new Date('2024-01-02').toUTCString(),
      });

      const result = await checkWebsiteUpdate(
        {
          url: 'https://example.com',
          previousHash: oldTimestamp,
        },
        { fetchFn: mockFetch },
      );

      expect(result.hasUpdate).toBe(true);
      expect(result.reason).toContain('Last-Modified changed');
    });

    it('should fallback to content hash when Last-Modified unavailable', async () => {
      const content = 'website content';
      const hash = hashContent(content);

      const mockFetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => null },
        })
        .mockResolvedValueOnce({
          ok: true,
          text: () => Promise.resolve(content),
        }) as unknown as typeof fetch;

      const result = await checkWebsiteUpdate(
        {
          url: 'https://example.com',
          previousHash: hash,
        },
        { fetchFn: mockFetch },
      );

      expect(result.hasUpdate).toBe(false);
      expect(result.reason).toContain('Content unchanged');
    });

    it('should detect content change via hash', async () => {
      const oldContent = 'old content';
      const newContent = 'new content';
      const oldHash = hashContent(oldContent);

      const mockFetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => null },
        })
        .mockResolvedValueOnce({
          ok: true,
          text: () => Promise.resolve(newContent),
        }) as unknown as typeof fetch;

      const result = await checkWebsiteUpdate(
        {
          url: 'https://example.com',
          previousHash: oldHash,
        },
        { fetchFn: mockFetch },
      );

      expect(result.hasUpdate).toBe(true);
      expect(result.reason).toContain('Content changed');
    });

    it('should handle HTTP errors gracefully', async () => {
      const mockFetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => null },
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
        }) as unknown as typeof fetch;

      const result = await checkWebsiteUpdate(
        {
          url: 'https://example.com',
          previousHash: 'abc123',
        },
        { fetchFn: mockFetch },
      );

      expect(result.hasUpdate).toBe(false);
      expect(result.reason).toContain('HTTP 404');
    });

    it('should handle network errors gracefully', async () => {
      const mockFetch = createErrorFetch('Network error');

      const result = await checkWebsiteUpdate(
        {
          url: 'https://example.com',
          previousHash: 'abc123',
        },
        { fetchFn: mockFetch },
      );

      expect(result.hasUpdate).toBe(false);
      expect(result.reason).toContain('Update check failed');
    });
  });
});
