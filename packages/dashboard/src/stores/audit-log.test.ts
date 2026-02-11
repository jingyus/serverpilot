// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useAuditLogStore, PAGE_SIZE } from './audit-log';

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

const mockLogs = [
  {
    id: 'al-1',
    serverId: 'srv-1',
    userId: 'user-1',
    sessionId: 'sess-1',
    command: 'ls -la /etc',
    riskLevel: 'green' as const,
    reason: 'Read-only command',
    matchedPattern: 'ls',
    action: 'allowed' as const,
    auditWarnings: [],
    auditBlockers: [],
    executionResult: 'success' as const,
    operationId: 'op-1',
    createdAt: '2026-02-09T10:00:00Z',
  },
  {
    id: 'al-2',
    serverId: 'srv-2',
    userId: 'user-1',
    sessionId: null,
    command: 'rm -rf /var/log',
    riskLevel: 'forbidden' as const,
    reason: 'Destructive command targeting system directory',
    matchedPattern: 'rm -rf',
    action: 'blocked' as const,
    auditWarnings: ['Targets system directory'],
    auditBlockers: ['Forbidden pattern: rm -rf on system path'],
    executionResult: null,
    operationId: null,
    createdAt: '2026-02-09T09:00:00Z',
  },
];

function resetStore() {
  useAuditLogStore.setState({
    logs: [],
    total: 0,
    selectedLog: null,
    filters: {
      serverId: '',
      riskLevel: '',
      action: '',
      startDate: '',
      endDate: '',
    },
    page: 1,
    isLoading: false,
    isExporting: false,
    error: null,
  });
}

describe('useAuditLogStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
  });

  describe('initial state', () => {
    it('has correct initial state', () => {
      const state = useAuditLogStore.getState();
      expect(state.logs).toEqual([]);
      expect(state.total).toBe(0);
      expect(state.selectedLog).toBeNull();
      expect(state.page).toBe(1);
      expect(state.isLoading).toBe(false);
      expect(state.isExporting).toBe(false);
      expect(state.error).toBeNull();
      expect(state.filters).toEqual({
        serverId: '',
        riskLevel: '',
        action: '',
        startDate: '',
        endDate: '',
      });
    });
  });

  describe('fetchLogs', () => {
    it('fetches logs successfully', async () => {
      const { apiRequest } = await import('@/api/client');
      vi.mocked(apiRequest).mockResolvedValueOnce({
        logs: mockLogs,
        total: 2,
        limit: 20,
        offset: 0,
      });

      await useAuditLogStore.getState().fetchLogs();

      const state = useAuditLogStore.getState();
      expect(state.logs).toEqual(mockLogs);
      expect(state.total).toBe(2);
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
      expect(apiRequest).toHaveBeenCalledWith(
        expect.stringContaining('/audit-log?'),
      );
    });

    it('sets loading state during fetch', async () => {
      const { apiRequest } = await import('@/api/client');
      let resolvePromise: (value: unknown) => void;
      vi.mocked(apiRequest).mockReturnValueOnce(
        new Promise((resolve) => {
          resolvePromise = resolve;
        }),
      );

      const promise = useAuditLogStore.getState().fetchLogs();
      expect(useAuditLogStore.getState().isLoading).toBe(true);

      resolvePromise!({ logs: [], total: 0, limit: 20, offset: 0 });
      await promise;
      expect(useAuditLogStore.getState().isLoading).toBe(false);
    });

    it('handles API error', async () => {
      const { apiRequest, ApiError } = await import('@/api/client');
      vi.mocked(apiRequest).mockRejectedValueOnce(
        new ApiError(500, 'INTERNAL_ERROR', 'Server error'),
      );

      await useAuditLogStore.getState().fetchLogs();

      const state = useAuditLogStore.getState();
      expect(state.error).toBe('Server error');
      expect(state.isLoading).toBe(false);
    });

    it('handles generic error', async () => {
      const { apiRequest } = await import('@/api/client');
      vi.mocked(apiRequest).mockRejectedValueOnce(new Error('Network error'));

      await useAuditLogStore.getState().fetchLogs();

      const state = useAuditLogStore.getState();
      expect(state.error).toBe('Failed to load audit logs');
      expect(state.isLoading).toBe(false);
    });

    it('includes filters in query string', async () => {
      const { apiRequest } = await import('@/api/client');
      vi.mocked(apiRequest).mockResolvedValueOnce({
        logs: [],
        total: 0,
        limit: 20,
        offset: 0,
      });

      useAuditLogStore.setState({
        filters: {
          serverId: 'srv-1',
          riskLevel: 'critical',
          action: 'blocked',
          startDate: '2026-01-01',
          endDate: '2026-02-01',
        },
        page: 2,
      });

      await useAuditLogStore.getState().fetchLogs();

      const callArg = vi.mocked(apiRequest).mock.calls[0][0];
      expect(callArg).toContain('serverId=srv-1');
      expect(callArg).toContain('riskLevel=critical');
      expect(callArg).toContain('action=blocked');
      expect(callArg).toContain('startDate=');
      expect(callArg).toContain('endDate=');
      expect(callArg).toContain(`offset=${PAGE_SIZE}`);
    });
  });

  describe('filters', () => {
    it('setFilters merges partial filters and resets page', () => {
      useAuditLogStore.setState({ page: 3 });
      useAuditLogStore.getState().setFilters({ riskLevel: 'critical' });

      const state = useAuditLogStore.getState();
      expect(state.filters.riskLevel).toBe('critical');
      expect(state.page).toBe(1);
    });

    it('resetFilters clears all filters and resets page', () => {
      useAuditLogStore.setState({
        filters: {
          serverId: 'srv-1',
          riskLevel: 'critical',
          action: 'blocked',
          startDate: '2026-01-01',
          endDate: '2026-02-01',
        },
        page: 5,
      });

      useAuditLogStore.getState().resetFilters();

      const state = useAuditLogStore.getState();
      expect(state.filters).toEqual({
        serverId: '',
        riskLevel: '',
        action: '',
        startDate: '',
        endDate: '',
      });
      expect(state.page).toBe(1);
    });
  });

  describe('pagination', () => {
    it('setPage updates the page', () => {
      useAuditLogStore.getState().setPage(3);
      expect(useAuditLogStore.getState().page).toBe(3);
    });
  });

  describe('selectedLog', () => {
    it('sets and clears selected log', () => {
      useAuditLogStore.getState().setSelectedLog(mockLogs[0]);
      expect(useAuditLogStore.getState().selectedLog).toEqual(mockLogs[0]);

      useAuditLogStore.getState().setSelectedLog(null);
      expect(useAuditLogStore.getState().selectedLog).toBeNull();
    });
  });

  describe('clearError', () => {
    it('clears error', () => {
      useAuditLogStore.setState({ error: 'Some error' });

      useAuditLogStore.getState().clearError();

      expect(useAuditLogStore.getState().error).toBeNull();
    });
  });

  describe('exportCsv', () => {
    let originalFetch: typeof global.fetch;

    beforeEach(() => {
      originalFetch = global.fetch;
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it('calls export endpoint and triggers download', async () => {
      const mockBlob = new Blob(['csv-data'], { type: 'text/csv' });
      const mockResponse = {
        ok: true,
        blob: vi.fn().mockResolvedValue(mockBlob),
        headers: new Headers({
          'Content-Disposition': 'attachment; filename="audit-log-2026-02-01-2026-02-09.csv"',
        }),
      };
      global.fetch = vi.fn().mockResolvedValue(mockResponse);

      const createObjectURL = vi.fn().mockReturnValue('blob:test');
      const revokeObjectURL = vi.fn();
      global.URL.createObjectURL = createObjectURL;
      global.URL.revokeObjectURL = revokeObjectURL;

      await useAuditLogStore.getState().exportCsv();

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/audit-log/export?'),
        expect.objectContaining({ headers: expect.any(Object) }),
      );

      const state = useAuditLogStore.getState();
      expect(state.isExporting).toBe(false);
      expect(state.error).toBeNull();
      expect(createObjectURL).toHaveBeenCalled();
      expect(revokeObjectURL).toHaveBeenCalled();
    });

    it('sets isExporting during export', async () => {
      let resolvePromise: (value: unknown) => void;
      global.fetch = vi.fn().mockReturnValue(
        new Promise((resolve) => {
          resolvePromise = resolve;
        }),
      );

      const promise = useAuditLogStore.getState().exportCsv();
      expect(useAuditLogStore.getState().isExporting).toBe(true);

      const mockBlob = new Blob(['csv-data'], { type: 'text/csv' });
      resolvePromise!({
        ok: true,
        blob: vi.fn().mockResolvedValue(mockBlob),
        headers: new Headers(),
      });

      global.URL.createObjectURL = vi.fn().mockReturnValue('blob:test');
      global.URL.revokeObjectURL = vi.fn();

      await promise;
      expect(useAuditLogStore.getState().isExporting).toBe(false);
    });

    it('handles export error', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      });

      await useAuditLogStore.getState().exportCsv();

      const state = useAuditLogStore.getState();
      expect(state.error).toBe('Failed to export audit logs');
      expect(state.isExporting).toBe(false);
    });

    it('includes filters in export params', async () => {
      useAuditLogStore.setState({
        filters: {
          serverId: 'srv-1',
          riskLevel: 'critical',
          action: 'blocked',
          startDate: '2026-02-01',
          endDate: '2026-02-09',
        },
      });

      const mockBlob = new Blob(['csv-data'], { type: 'text/csv' });
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        blob: vi.fn().mockResolvedValue(mockBlob),
        headers: new Headers(),
      });
      global.URL.createObjectURL = vi.fn().mockReturnValue('blob:test');
      global.URL.revokeObjectURL = vi.fn();

      await useAuditLogStore.getState().exportCsv();

      const fetchUrl = vi.mocked(global.fetch).mock.calls[0][0] as string;
      expect(fetchUrl).toContain('format=csv');
      expect(fetchUrl).toContain('serverId=srv-1');
      expect(fetchUrl).toContain('riskLevel=critical');
      expect(fetchUrl).toContain('from=');
      expect(fetchUrl).toContain('to=');
    });

    it('uses fallback filename when Content-Disposition missing', async () => {
      const mockBlob = new Blob(['csv-data'], { type: 'text/csv' });
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        blob: vi.fn().mockResolvedValue(mockBlob),
        headers: new Headers(),
      });

      const createObjectURL = vi.fn().mockReturnValue('blob:test');
      global.URL.createObjectURL = createObjectURL;
      global.URL.revokeObjectURL = vi.fn();

      await useAuditLogStore.getState().exportCsv();

      // Should not throw and should complete successfully
      expect(useAuditLogStore.getState().isExporting).toBe(false);
      expect(createObjectURL).toHaveBeenCalled();
    });
  });

  describe('PAGE_SIZE', () => {
    it('is 20', () => {
      expect(PAGE_SIZE).toBe(20);
    });
  });
});
