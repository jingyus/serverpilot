import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useKnowledgeStore } from './knowledge';
import type { Knowledge } from '@/types/knowledge';

const mockKnowledge: Knowledge[] = [
  {
    id: 'k-1',
    software: 'nginx',
    platform: 'ubuntu-22.04',
    content: {
      commands: ['sudo apt update', 'sudo apt install nginx -y'],
      verification: 'nginx -v',
      notes: ['Nginx is a web server'],
    },
    source: 'builtin',
    successCount: 10,
    lastUsed: '2026-02-09T12:00:00Z',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-02-09T12:00:00Z',
  },
  {
    id: 'k-2',
    software: 'nginx',
    platform: 'centos-8',
    content: {
      commands: ['sudo yum install nginx -y'],
      verification: 'nginx -v',
    },
    source: 'auto_learn',
    successCount: 5,
    lastUsed: '2026-02-08T10:00:00Z',
    createdAt: '2026-01-05T00:00:00Z',
    updatedAt: '2026-02-08T10:00:00Z',
  },
];

vi.mock('@/api/client', () => ({
  apiRequest: vi.fn(),
}));

import { apiRequest } from '@/api/client';
const mockApiRequest = vi.mocked(apiRequest);

describe('useKnowledgeStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useKnowledgeStore.setState({
      query: '',
      results: [],
      isSearching: false,
      error: null,
      selectedSource: 'all',
      selectedKnowledge: null,
    });
  });

  describe('setQuery', () => {
    it('should update the query', () => {
      const store = useKnowledgeStore.getState();
      store.setQuery('nginx');
      expect(useKnowledgeStore.getState().query).toBe('nginx');
    });
  });

  describe('setSelectedSource', () => {
    it('should update the selected source filter', () => {
      const store = useKnowledgeStore.getState();
      store.setSelectedSource('builtin');
      expect(useKnowledgeStore.getState().selectedSource).toBe('builtin');
    });

    it('should allow setting to "all"', () => {
      const store = useKnowledgeStore.getState();
      store.setSelectedSource('all');
      expect(useKnowledgeStore.getState().selectedSource).toBe('all');
    });
  });

  describe('search', () => {
    it('should search successfully', async () => {
      mockApiRequest.mockResolvedValue({
        query: 'nginx',
        count: 2,
        results: mockKnowledge,
      });

      const store = useKnowledgeStore.getState();
      await store.search('nginx');

      expect(mockApiRequest).toHaveBeenCalledWith('/knowledge/search?q=nginx');
      expect(useKnowledgeStore.getState().results).toEqual(mockKnowledge);
      expect(useKnowledgeStore.getState().query).toBe('nginx');
      expect(useKnowledgeStore.getState().isSearching).toBe(false);
      expect(useKnowledgeStore.getState().error).toBeNull();
    });

    it('should include source filter in request when not "all"', async () => {
      mockApiRequest.mockResolvedValue({
        query: 'nginx',
        count: 1,
        results: [mockKnowledge[0]],
      });

      const store = useKnowledgeStore.getState();
      store.setSelectedSource('builtin');
      await store.search('nginx');

      expect(mockApiRequest).toHaveBeenCalledWith(
        '/knowledge/search?q=nginx&source=builtin'
      );
    });

    it('should not include source filter when "all"', async () => {
      mockApiRequest.mockResolvedValue({
        query: 'nginx',
        count: 2,
        results: mockKnowledge,
      });

      const store = useKnowledgeStore.getState();
      store.setSelectedSource('all');
      await store.search('nginx');

      expect(mockApiRequest).toHaveBeenCalledWith('/knowledge/search?q=nginx');
    });

    it('should clear results for empty query', async () => {
      useKnowledgeStore.setState({ results: mockKnowledge });

      const store = useKnowledgeStore.getState();
      await store.search('  ');

      expect(mockApiRequest).not.toHaveBeenCalled();
      expect(useKnowledgeStore.getState().results).toEqual([]);
      expect(useKnowledgeStore.getState().query).toBe('');
    });

    it('should handle search errors', async () => {
      mockApiRequest.mockRejectedValue(new Error('Network error'));

      const store = useKnowledgeStore.getState();
      await store.search('nginx');

      expect(useKnowledgeStore.getState().error).toBe('Network error');
      expect(useKnowledgeStore.getState().results).toEqual([]);
      expect(useKnowledgeStore.getState().isSearching).toBe(false);
    });

    it('should trim whitespace from query', async () => {
      mockApiRequest.mockResolvedValue({
        query: 'nginx',
        count: 2,
        results: mockKnowledge,
      });

      const store = useKnowledgeStore.getState();
      await store.search('  nginx  ');

      expect(mockApiRequest).toHaveBeenCalledWith('/knowledge/search?q=nginx');
      expect(useKnowledgeStore.getState().query).toBe('nginx');
    });
  });

  describe('selectKnowledge', () => {
    it('should select a knowledge entry', () => {
      const store = useKnowledgeStore.getState();
      store.selectKnowledge(mockKnowledge[0]);
      expect(useKnowledgeStore.getState().selectedKnowledge).toEqual(
        mockKnowledge[0]
      );
    });

    it('should deselect knowledge entry', () => {
      useKnowledgeStore.setState({ selectedKnowledge: mockKnowledge[0] });

      const store = useKnowledgeStore.getState();
      store.selectKnowledge(null);
      expect(useKnowledgeStore.getState().selectedKnowledge).toBeNull();
    });
  });

  describe('clearError', () => {
    it('should clear the error', () => {
      useKnowledgeStore.setState({ error: 'Some error' });

      const store = useKnowledgeStore.getState();
      store.clearError();
      expect(useKnowledgeStore.getState().error).toBeNull();
    });
  });

  describe('reset', () => {
    it('should reset to initial state', () => {
      useKnowledgeStore.setState({
        query: 'nginx',
        results: mockKnowledge,
        isSearching: true,
        error: 'Some error',
        selectedSource: 'builtin',
        selectedKnowledge: mockKnowledge[0],
      });

      const store = useKnowledgeStore.getState();
      store.reset();

      const state = useKnowledgeStore.getState();
      expect(state.query).toBe('');
      expect(state.results).toEqual([]);
      expect(state.isSearching).toBe(false);
      expect(state.error).toBeNull();
      expect(state.selectedSource).toBe('all');
      expect(state.selectedKnowledge).toBeNull();
    });
  });
});
