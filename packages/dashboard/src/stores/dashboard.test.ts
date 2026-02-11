// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useDashboardStore } from './dashboard';

const mockOperations = [
  {
    id: 'op-1',
    serverId: 'srv-1',
    serverName: 'web-prod-01',
    type: 'install' as const,
    description: 'Install nginx',
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
    status: 'failed' as const,
    riskLevel: 'yellow' as const,
    duration: 3000,
    createdAt: '2026-02-09T09:00:00Z',
    completedAt: '2026-02-09T09:00:03Z',
  },
];

const mockAlerts = [
  {
    id: 'alert-1',
    serverId: 'srv-1',
    serverName: 'web-prod-01',
    type: 'cpu' as const,
    severity: 'critical' as const,
    message: 'CPU usage exceeds 90%',
    value: '95%',
    threshold: '90%',
    resolved: false,
    createdAt: '2026-02-09T11:00:00Z',
  },
  {
    id: 'alert-2',
    serverId: 'srv-2',
    serverName: 'db-prod-01',
    type: 'memory' as const,
    severity: 'warning' as const,
    message: 'Memory usage exceeds 80%',
    value: '85%',
    threshold: '80%',
    resolved: false,
    createdAt: '2026-02-09T10:30:00Z',
  },
];

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

describe('useDashboardStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useDashboardStore.setState({
      operations: [],
      alerts: [],
      isLoadingOperations: false,
      isLoadingAlerts: false,
      operationsError: null,
      alertsError: null,
    });
  });

  describe('initial state', () => {
    it('has correct initial state', () => {
      const state = useDashboardStore.getState();
      expect(state.operations).toEqual([]);
      expect(state.alerts).toEqual([]);
      expect(state.isLoadingOperations).toBe(false);
      expect(state.isLoadingAlerts).toBe(false);
      expect(state.operationsError).toBeNull();
      expect(state.alertsError).toBeNull();
    });
  });

  describe('fetchRecentOperations', () => {
    it('fetches operations successfully', async () => {
      const { apiRequest } = await import('@/api/client');
      vi.mocked(apiRequest).mockResolvedValueOnce({
        operations: mockOperations,
        total: 2,
      });

      await useDashboardStore.getState().fetchRecentOperations();

      const state = useDashboardStore.getState();
      expect(state.operations).toEqual(mockOperations);
      expect(state.isLoadingOperations).toBe(false);
      expect(state.operationsError).toBeNull();
      expect(apiRequest).toHaveBeenCalledWith('/operations?limit=5');
    });

    it('sets loading state during fetch', async () => {
      const { apiRequest } = await import('@/api/client');
      let resolvePromise: (value: unknown) => void;
      vi.mocked(apiRequest).mockReturnValueOnce(
        new Promise((resolve) => {
          resolvePromise = resolve;
        })
      );

      const promise = useDashboardStore.getState().fetchRecentOperations();
      expect(useDashboardStore.getState().isLoadingOperations).toBe(true);

      resolvePromise!({ operations: [], total: 0 });
      await promise;
      expect(useDashboardStore.getState().isLoadingOperations).toBe(false);
    });

    it('handles API error', async () => {
      const { apiRequest, ApiError } = await import('@/api/client');
      vi.mocked(apiRequest).mockRejectedValueOnce(
        new ApiError(500, 'INTERNAL_ERROR', 'Server error')
      );

      await useDashboardStore.getState().fetchRecentOperations();

      const state = useDashboardStore.getState();
      expect(state.operationsError).toBe('Server error');
      expect(state.isLoadingOperations).toBe(false);
    });

    it('handles generic error', async () => {
      const { apiRequest } = await import('@/api/client');
      vi.mocked(apiRequest).mockRejectedValueOnce(new Error('Network error'));

      await useDashboardStore.getState().fetchRecentOperations();

      const state = useDashboardStore.getState();
      expect(state.operationsError).toBe('Failed to load operations');
      expect(state.isLoadingOperations).toBe(false);
    });
  });

  describe('fetchAlerts', () => {
    it('fetches alerts successfully', async () => {
      const { apiRequest } = await import('@/api/client');
      vi.mocked(apiRequest).mockResolvedValueOnce({
        alerts: mockAlerts,
        total: 2,
      });

      await useDashboardStore.getState().fetchAlerts();

      const state = useDashboardStore.getState();
      expect(state.alerts).toEqual(mockAlerts);
      expect(state.isLoadingAlerts).toBe(false);
      expect(state.alertsError).toBeNull();
      expect(apiRequest).toHaveBeenCalledWith('/alerts?resolved=false');
    });

    it('sets loading state during fetch', async () => {
      const { apiRequest } = await import('@/api/client');
      let resolvePromise: (value: unknown) => void;
      vi.mocked(apiRequest).mockReturnValueOnce(
        new Promise((resolve) => {
          resolvePromise = resolve;
        })
      );

      const promise = useDashboardStore.getState().fetchAlerts();
      expect(useDashboardStore.getState().isLoadingAlerts).toBe(true);

      resolvePromise!({ alerts: [], total: 0 });
      await promise;
      expect(useDashboardStore.getState().isLoadingAlerts).toBe(false);
    });

    it('handles API error', async () => {
      const { apiRequest, ApiError } = await import('@/api/client');
      vi.mocked(apiRequest).mockRejectedValueOnce(
        new ApiError(500, 'INTERNAL_ERROR', 'Alert service down')
      );

      await useDashboardStore.getState().fetchAlerts();

      const state = useDashboardStore.getState();
      expect(state.alertsError).toBe('Alert service down');
      expect(state.isLoadingAlerts).toBe(false);
    });

    it('handles generic error', async () => {
      const { apiRequest } = await import('@/api/client');
      vi.mocked(apiRequest).mockRejectedValueOnce(new Error('Network error'));

      await useDashboardStore.getState().fetchAlerts();

      const state = useDashboardStore.getState();
      expect(state.alertsError).toBe('Failed to load alerts');
      expect(state.isLoadingAlerts).toBe(false);
    });
  });

  describe('clearErrors', () => {
    it('clears both errors', () => {
      useDashboardStore.setState({
        operationsError: 'Operations failed',
        alertsError: 'Alerts failed',
      });

      useDashboardStore.getState().clearErrors();

      const state = useDashboardStore.getState();
      expect(state.operationsError).toBeNull();
      expect(state.alertsError).toBeNull();
    });
  });
});
