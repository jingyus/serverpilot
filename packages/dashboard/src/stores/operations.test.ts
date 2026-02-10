import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useOperationsStore, PAGE_SIZE } from './operations';

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

const mockOperations = [
  {
    id: 'op-1',
    serverId: 'srv-1',
    serverName: 'web-prod-01',
    type: 'install' as const,
    description: 'Install nginx',
    commands: ['apt-get install nginx'],
    output: 'nginx installed',
    status: 'success' as const,
    riskLevel: 'green' as const,
    duration: 5000,
    createdAt: '2026-02-09T10:00:00Z',
    completedAt: '2026-02-09T10:00:05Z',
  },
  {
    id: 'op-2',
    serverId: 'srv-2',
    serverName: 'db-prod-01',
    type: 'restart' as const,
    description: 'Restart MySQL',
    commands: ['systemctl restart mysql'],
    output: null,
    status: 'failed' as const,
    riskLevel: 'yellow' as const,
    duration: 3000,
    createdAt: '2026-02-09T09:00:00Z',
    completedAt: '2026-02-09T09:00:03Z',
  },
];

const mockStats = {
  total: 42,
  byStatus: { pending: 2, running: 1, success: 35, failed: 3, rolled_back: 1 },
  byType: { install: 10, config: 15, restart: 8, execute: 7, backup: 2 },
  byRiskLevel: { green: 30, yellow: 8, red: 3, critical: 1 },
  avgDuration: 4500,
  successRate: 83.3,
};

function resetStore() {
  useOperationsStore.setState({
    operations: [],
    total: 0,
    stats: null,
    selectedOperation: null,
    filters: {
      serverId: '',
      type: '',
      status: '',
      riskLevel: '',
      startDate: '',
      endDate: '',
    },
    page: 1,
    isLoading: false,
    isLoadingStats: false,
    error: null,
    statsError: null,
  });
}

describe('useOperationsStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
  });

  describe('initial state', () => {
    it('has correct initial state', () => {
      const state = useOperationsStore.getState();
      expect(state.operations).toEqual([]);
      expect(state.total).toBe(0);
      expect(state.stats).toBeNull();
      expect(state.selectedOperation).toBeNull();
      expect(state.page).toBe(1);
      expect(state.isLoading).toBe(false);
      expect(state.isLoadingStats).toBe(false);
      expect(state.error).toBeNull();
      expect(state.statsError).toBeNull();
      expect(state.filters).toEqual({
        serverId: '',
        type: '',
        status: '',
        riskLevel: '',
        startDate: '',
        endDate: '',
      });
    });
  });

  describe('fetchOperations', () => {
    it('fetches operations successfully', async () => {
      const { apiRequest } = await import('@/api/client');
      vi.mocked(apiRequest).mockResolvedValueOnce({
        operations: mockOperations,
        total: 2,
      });

      await useOperationsStore.getState().fetchOperations();

      const state = useOperationsStore.getState();
      expect(state.operations).toEqual(mockOperations);
      expect(state.total).toBe(2);
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
      expect(apiRequest).toHaveBeenCalledWith(
        expect.stringContaining('/operations?')
      );
    });

    it('sets loading state during fetch', async () => {
      const { apiRequest } = await import('@/api/client');
      let resolvePromise: (value: unknown) => void;
      vi.mocked(apiRequest).mockReturnValueOnce(
        new Promise((resolve) => {
          resolvePromise = resolve;
        })
      );

      const promise = useOperationsStore.getState().fetchOperations();
      expect(useOperationsStore.getState().isLoading).toBe(true);

      resolvePromise!({ operations: [], total: 0 });
      await promise;
      expect(useOperationsStore.getState().isLoading).toBe(false);
    });

    it('handles API error', async () => {
      const { apiRequest, ApiError } = await import('@/api/client');
      vi.mocked(apiRequest).mockRejectedValueOnce(
        new ApiError(500, 'INTERNAL_ERROR', 'Server error')
      );

      await useOperationsStore.getState().fetchOperations();

      const state = useOperationsStore.getState();
      expect(state.error).toBe('Server error');
      expect(state.isLoading).toBe(false);
    });

    it('handles generic error', async () => {
      const { apiRequest } = await import('@/api/client');
      vi.mocked(apiRequest).mockRejectedValueOnce(new Error('Network error'));

      await useOperationsStore.getState().fetchOperations();

      const state = useOperationsStore.getState();
      expect(state.error).toBe('Failed to load operations');
      expect(state.isLoading).toBe(false);
    });

    it('includes filters in query string', async () => {
      const { apiRequest } = await import('@/api/client');
      vi.mocked(apiRequest).mockResolvedValueOnce({
        operations: [],
        total: 0,
      });

      useOperationsStore.setState({
        filters: {
          serverId: 'srv-1',
          type: 'install',
          status: 'success',
          riskLevel: 'green',
          startDate: '2026-01-01',
          endDate: '2026-02-01',
        },
        page: 2,
      });

      await useOperationsStore.getState().fetchOperations();

      const callArg = vi.mocked(apiRequest).mock.calls[0][0];
      expect(callArg).toContain('serverId=srv-1');
      expect(callArg).toContain('type=install');
      expect(callArg).toContain('status=success');
      expect(callArg).toContain('riskLevel=green');
      expect(callArg).toContain('startDate=2026-01-01');
      expect(callArg).toContain('endDate=2026-02-01');
      expect(callArg).toContain(`offset=${PAGE_SIZE}`);
    });
  });

  describe('fetchStats', () => {
    it('fetches stats successfully', async () => {
      const { apiRequest } = await import('@/api/client');
      vi.mocked(apiRequest).mockResolvedValueOnce(mockStats);

      await useOperationsStore.getState().fetchStats();

      const state = useOperationsStore.getState();
      expect(state.stats).toEqual(mockStats);
      expect(state.isLoadingStats).toBe(false);
      expect(state.statsError).toBeNull();
    });

    it('sets loading state during fetch', async () => {
      const { apiRequest } = await import('@/api/client');
      let resolvePromise: (value: unknown) => void;
      vi.mocked(apiRequest).mockReturnValueOnce(
        new Promise((resolve) => {
          resolvePromise = resolve;
        })
      );

      const promise = useOperationsStore.getState().fetchStats();
      expect(useOperationsStore.getState().isLoadingStats).toBe(true);

      resolvePromise!(mockStats);
      await promise;
      expect(useOperationsStore.getState().isLoadingStats).toBe(false);
    });

    it('handles API error', async () => {
      const { apiRequest, ApiError } = await import('@/api/client');
      vi.mocked(apiRequest).mockRejectedValueOnce(
        new ApiError(500, 'INTERNAL_ERROR', 'Stats error')
      );

      await useOperationsStore.getState().fetchStats();

      const state = useOperationsStore.getState();
      expect(state.statsError).toBe('Stats error');
      expect(state.isLoadingStats).toBe(false);
    });

    it('handles generic error', async () => {
      const { apiRequest } = await import('@/api/client');
      vi.mocked(apiRequest).mockRejectedValueOnce(new Error('Network'));

      await useOperationsStore.getState().fetchStats();

      const state = useOperationsStore.getState();
      expect(state.statsError).toBe('Failed to load stats');
      expect(state.isLoadingStats).toBe(false);
    });

    it('includes serverId in stats query when filtered', async () => {
      const { apiRequest } = await import('@/api/client');
      vi.mocked(apiRequest).mockResolvedValueOnce(mockStats);

      useOperationsStore.setState({
        filters: {
          serverId: 'srv-1',
          type: '',
          status: '',
          riskLevel: '',
          startDate: '',
          endDate: '',
        },
      });

      await useOperationsStore.getState().fetchStats();

      expect(apiRequest).toHaveBeenCalledWith('/operations/stats?serverId=srv-1');
    });
  });

  describe('filters', () => {
    it('setFilters merges partial filters and resets page', () => {
      useOperationsStore.setState({ page: 3 });
      useOperationsStore.getState().setFilters({ type: 'install' });

      const state = useOperationsStore.getState();
      expect(state.filters.type).toBe('install');
      expect(state.page).toBe(1);
    });

    it('resetFilters clears all filters and resets page', () => {
      useOperationsStore.setState({
        filters: {
          serverId: 'srv-1',
          type: 'install',
          status: 'success',
          riskLevel: 'green',
          startDate: '2026-01-01',
          endDate: '2026-02-01',
        },
        page: 5,
      });

      useOperationsStore.getState().resetFilters();

      const state = useOperationsStore.getState();
      expect(state.filters).toEqual({
        serverId: '',
        type: '',
        status: '',
        riskLevel: '',
        startDate: '',
        endDate: '',
      });
      expect(state.page).toBe(1);
    });
  });

  describe('pagination', () => {
    it('setPage updates the page', () => {
      useOperationsStore.getState().setPage(3);
      expect(useOperationsStore.getState().page).toBe(3);
    });
  });

  describe('selectedOperation', () => {
    it('sets and clears selected operation', () => {
      useOperationsStore.getState().setSelectedOperation(mockOperations[0]);
      expect(useOperationsStore.getState().selectedOperation).toEqual(
        mockOperations[0]
      );

      useOperationsStore.getState().setSelectedOperation(null);
      expect(useOperationsStore.getState().selectedOperation).toBeNull();
    });
  });

  describe('clearError', () => {
    it('clears both errors', () => {
      useOperationsStore.setState({
        error: 'Some error',
        statsError: 'Stats error',
      });

      useOperationsStore.getState().clearError();

      const state = useOperationsStore.getState();
      expect(state.error).toBeNull();
      expect(state.statsError).toBeNull();
    });
  });

  describe('PAGE_SIZE', () => {
    it('is 20', () => {
      expect(PAGE_SIZE).toBe(20);
    });
  });
});
