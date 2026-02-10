import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useDocSourcesStore } from './doc-sources';

vi.mock('@/api/client', () => ({
  apiRequest: vi.fn(),
  ApiError: class ApiError extends Error {
    status: number;
    code: string;
    constructor(status: number, code: string, message: string) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.code = code;
    }
  },
}));

import { apiRequest, ApiError } from '@/api/client';
const mockApiRequest = vi.mocked(apiRequest);

const MOCK_SOURCE = {
  id: 'ds-1',
  name: 'Nginx Docs',
  software: 'nginx',
  type: 'github' as const,
  enabled: true,
  autoUpdate: false,
  updateFrequencyHours: 168,
  lastFetchedAt: null,
  lastFetchStatus: null,
  documentCount: 0,
  createdAt: '2025-01-01T00:00:00Z',
};

describe('useDocSourcesStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useDocSourcesStore.setState({
      sources: [],
      isLoading: false,
      error: null,
      isSaving: false,
      fetchingSources: new Set(),
    });
  });

  describe('fetchSources', () => {
    it('fetches and stores sources', async () => {
      mockApiRequest.mockResolvedValueOnce({ sources: [MOCK_SOURCE] });

      await useDocSourcesStore.getState().fetchSources();

      expect(mockApiRequest).toHaveBeenCalledWith('/doc-sources');
      expect(useDocSourcesStore.getState().sources).toEqual([MOCK_SOURCE]);
      expect(useDocSourcesStore.getState().isLoading).toBe(false);
    });

    it('sets loading state during fetch', async () => {
      let resolvePromise: (value: unknown) => void;
      const pending = new Promise((resolve) => { resolvePromise = resolve; });
      mockApiRequest.mockReturnValueOnce(pending as Promise<unknown>);

      const fetchPromise = useDocSourcesStore.getState().fetchSources();
      expect(useDocSourcesStore.getState().isLoading).toBe(true);

      resolvePromise!({ sources: [] });
      await fetchPromise;
      expect(useDocSourcesStore.getState().isLoading).toBe(false);
    });

    it('handles fetch error', async () => {
      mockApiRequest.mockRejectedValueOnce(
        new ApiError(500, 'SERVER_ERROR', 'Internal error'),
      );

      await useDocSourcesStore.getState().fetchSources();

      expect(useDocSourcesStore.getState().error).toBe('Internal error');
      expect(useDocSourcesStore.getState().isLoading).toBe(false);
    });
  });

  describe('createSource', () => {
    it('creates a source and adds to list', async () => {
      mockApiRequest.mockResolvedValueOnce({ source: MOCK_SOURCE });

      const result = await useDocSourcesStore.getState().createSource({
        name: 'Nginx Docs',
        software: 'nginx',
        type: 'github',
        githubConfig: { owner: 'nginx', repo: 'nginx' },
      });

      expect(mockApiRequest).toHaveBeenCalledWith('/doc-sources', {
        method: 'POST',
        body: expect.any(String),
      });
      expect(result).toEqual(MOCK_SOURCE);
      expect(useDocSourcesStore.getState().sources).toContainEqual(MOCK_SOURCE);
      expect(useDocSourcesStore.getState().isSaving).toBe(false);
    });

    it('handles create error', async () => {
      mockApiRequest.mockRejectedValueOnce(
        new ApiError(400, 'VALIDATION_ERROR', 'Invalid input'),
      );

      await expect(
        useDocSourcesStore.getState().createSource({
          name: '',
          software: 'nginx',
          type: 'github',
        }),
      ).rejects.toThrow();

      expect(useDocSourcesStore.getState().error).toBe('Invalid input');
      expect(useDocSourcesStore.getState().isSaving).toBe(false);
    });
  });

  describe('updateSource', () => {
    it('updates a source in the list', async () => {
      const updated = { ...MOCK_SOURCE, name: 'Updated' };
      useDocSourcesStore.setState({ sources: [MOCK_SOURCE] });
      mockApiRequest.mockResolvedValueOnce({ source: updated });

      await useDocSourcesStore.getState().updateSource('ds-1', { name: 'Updated' });

      expect(useDocSourcesStore.getState().sources[0].name).toBe('Updated');
    });
  });

  describe('deleteSource', () => {
    it('removes source from list', async () => {
      useDocSourcesStore.setState({ sources: [MOCK_SOURCE] });
      mockApiRequest.mockResolvedValueOnce({ success: true });

      await useDocSourcesStore.getState().deleteSource('ds-1');

      expect(useDocSourcesStore.getState().sources).toHaveLength(0);
    });

    it('handles delete error', async () => {
      useDocSourcesStore.setState({ sources: [MOCK_SOURCE] });
      mockApiRequest.mockRejectedValueOnce(
        new ApiError(404, 'NOT_FOUND', 'Source not found'),
      );

      await expect(
        useDocSourcesStore.getState().deleteSource('bad-id'),
      ).rejects.toThrow();

      expect(useDocSourcesStore.getState().error).toBe('Source not found');
    });
  });

  describe('triggerFetch', () => {
    it('triggers fetch and refreshes sources', async () => {
      useDocSourcesStore.setState({ sources: [MOCK_SOURCE] });
      const fetchedSource = { ...MOCK_SOURCE, documentCount: 5, lastFetchStatus: 'success' as const };

      mockApiRequest
        .mockResolvedValueOnce({
          success: true,
          task: { id: 'task-1', status: 'completed' },
        })
        .mockResolvedValueOnce({ sources: [fetchedSource] });

      const task = await useDocSourcesStore.getState().triggerFetch('ds-1');

      expect(task.status).toBe('completed');
      expect(useDocSourcesStore.getState().sources[0].documentCount).toBe(5);
    });

    it('tracks fetching state per source', async () => {
      useDocSourcesStore.setState({ sources: [MOCK_SOURCE] });

      let resolvePromise: (value: unknown) => void;
      const pending = new Promise((resolve) => { resolvePromise = resolve; });
      mockApiRequest.mockReturnValueOnce(pending as Promise<unknown>);

      const fetchPromise = useDocSourcesStore.getState().triggerFetch('ds-1');
      expect(useDocSourcesStore.getState().fetchingSources.has('ds-1')).toBe(true);

      resolvePromise!({ success: true, task: { id: 'task-1', status: 'completed' } });
      mockApiRequest.mockResolvedValueOnce({ sources: [MOCK_SOURCE] });
      await fetchPromise;

      expect(useDocSourcesStore.getState().fetchingSources.has('ds-1')).toBe(false);
    });
  });

  describe('clearError', () => {
    it('clears error state', () => {
      useDocSourcesStore.setState({ error: 'Some error' });
      useDocSourcesStore.getState().clearError();
      expect(useDocSourcesStore.getState().error).toBeNull();
    });
  });
});
