// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAlertsStore } from './alerts';

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

const mockRules = [
  {
    id: 'rule-1',
    serverId: 'srv-1',
    userId: 'user-1',
    name: 'High CPU Alert',
    metricType: 'cpu' as const,
    operator: 'gt' as const,
    threshold: 90,
    severity: 'critical' as const,
    enabled: true,
    emailRecipients: null,
    cooldownMinutes: 5,
    lastTriggeredAt: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 'rule-2',
    serverId: 'srv-1',
    userId: 'user-1',
    name: 'Low Disk Space',
    metricType: 'disk' as const,
    operator: 'gt' as const,
    threshold: 80,
    severity: 'warning' as const,
    enabled: false,
    emailRecipients: null,
    cooldownMinutes: 10,
    lastTriggeredAt: null,
    createdAt: '2026-01-02T00:00:00Z',
    updatedAt: '2026-01-02T00:00:00Z',
  },
];

const mockAlerts = [
  {
    id: 'alert-1',
    serverId: 'srv-1',
    serverName: 'web-prod-01',
    type: 'cpu' as const,
    severity: 'critical' as const,
    message: 'CPU usage exceeded 90%',
    value: '95',
    threshold: '90',
    resolved: false,
    createdAt: '2026-02-09T10:00:00Z',
  },
  {
    id: 'alert-2',
    serverId: 'srv-1',
    serverName: 'web-prod-01',
    type: 'memory' as const,
    severity: 'warning' as const,
    message: 'Memory usage exceeded 80%',
    value: '85',
    threshold: '80',
    resolved: true,
    resolvedAt: '2026-02-09T10:30:00Z',
    createdAt: '2026-02-09T09:00:00Z',
  },
];

function resetStore() {
  useAlertsStore.setState({
    alerts: [],
    alertsTotal: 0,
    alertsPage: 1,
    isLoadingAlerts: false,
    alertsError: null,
    rules: [],
    rulesTotal: 0,
    isLoadingRules: false,
    rulesError: null,
    unresolvedCount: 0,
    activeTab: 'rules',
    successMessage: null,
  });
}

describe('useAlertsStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
  });

  describe('fetchRules', () => {
    it('fetches and stores alert rules', async () => {
      mockApiRequest.mockResolvedValueOnce({ rules: mockRules, total: 2 });

      await useAlertsStore.getState().fetchRules();

      expect(mockApiRequest).toHaveBeenCalledWith('/alert-rules');
      expect(useAlertsStore.getState().rules).toEqual(mockRules);
      expect(useAlertsStore.getState().rulesTotal).toBe(2);
      expect(useAlertsStore.getState().isLoadingRules).toBe(false);
    });

    it('sets loading state during fetch', async () => {
      let resolve: (value: unknown) => void;
      const pending = new Promise((r) => { resolve = r; });
      mockApiRequest.mockReturnValueOnce(pending as Promise<unknown>);

      const p = useAlertsStore.getState().fetchRules();
      expect(useAlertsStore.getState().isLoadingRules).toBe(true);

      resolve!({ rules: [], total: 0 });
      await p;
      expect(useAlertsStore.getState().isLoadingRules).toBe(false);
    });

    it('handles fetch error', async () => {
      mockApiRequest.mockRejectedValueOnce(new Error('Network error'));

      await useAlertsStore.getState().fetchRules();

      expect(useAlertsStore.getState().rulesError).toBe('Failed to load alert rules');
      expect(useAlertsStore.getState().isLoadingRules).toBe(false);
    });

    it('handles ApiError with custom message', async () => {
      mockApiRequest.mockRejectedValueOnce(
        new ApiError(500, 'SERVER_ERROR', 'Internal server error'),
      );

      await useAlertsStore.getState().fetchRules();

      expect(useAlertsStore.getState().rulesError).toBe('Internal server error');
    });
  });

  describe('createRule', () => {
    it('creates a rule and refreshes list', async () => {
      const input = {
        serverId: 'srv-1',
        name: 'New Rule',
        metricType: 'cpu' as const,
        operator: 'gt' as const,
        threshold: 85,
        severity: 'warning' as const,
      };
      // First call: create, second call: fetchRules
      mockApiRequest
        .mockResolvedValueOnce({ rule: { id: 'rule-3', ...input } })
        .mockResolvedValueOnce({ rules: mockRules, total: 2 });

      await useAlertsStore.getState().createRule(input);

      expect(mockApiRequest).toHaveBeenCalledWith('/alert-rules', {
        method: 'POST',
        body: JSON.stringify(input),
      });
      expect(useAlertsStore.getState().successMessage).toBe('Alert rule created');
    });

    it('handles create error and re-throws', async () => {
      mockApiRequest.mockRejectedValueOnce(new Error('Create failed'));

      await expect(
        useAlertsStore.getState().createRule({
          serverId: 'srv-1',
          name: 'Bad Rule',
          metricType: 'cpu',
          operator: 'gt',
          threshold: 80,
          severity: 'info',
        }),
      ).rejects.toThrow('Create failed');
      expect(useAlertsStore.getState().rulesError).toBe('Failed to create alert rule');
    });
  });

  describe('updateRule', () => {
    it('updates a rule and refreshes list', async () => {
      mockApiRequest
        .mockResolvedValueOnce({ rule: { ...mockRules[0], name: 'Updated' } })
        .mockResolvedValueOnce({ rules: mockRules, total: 2 });

      await useAlertsStore.getState().updateRule('rule-1', { name: 'Updated' });

      expect(mockApiRequest).toHaveBeenCalledWith('/alert-rules/rule-1', {
        method: 'PATCH',
        body: JSON.stringify({ name: 'Updated' }),
      });
      expect(useAlertsStore.getState().successMessage).toBe('Alert rule updated');
    });

    it('handles update error and re-throws', async () => {
      mockApiRequest.mockRejectedValueOnce(new Error('Update failed'));

      await expect(
        useAlertsStore.getState().updateRule('rule-1', { name: 'Bad' }),
      ).rejects.toThrow('Update failed');
      expect(useAlertsStore.getState().rulesError).toBe('Failed to update alert rule');
    });
  });

  describe('deleteRule', () => {
    it('deletes a rule and removes from list', async () => {
      useAlertsStore.setState({ rules: [...mockRules] });
      mockApiRequest.mockResolvedValueOnce({ success: true });

      await useAlertsStore.getState().deleteRule('rule-1');

      expect(mockApiRequest).toHaveBeenCalledWith('/alert-rules/rule-1', { method: 'DELETE' });
      expect(useAlertsStore.getState().rules).toHaveLength(1);
      expect(useAlertsStore.getState().rules[0].id).toBe('rule-2');
      expect(useAlertsStore.getState().successMessage).toBe('Alert rule deleted');
    });

    it('handles delete error and re-throws', async () => {
      useAlertsStore.setState({ rules: [...mockRules] });
      mockApiRequest.mockRejectedValueOnce(new Error('Delete failed'));

      await expect(
        useAlertsStore.getState().deleteRule('rule-1'),
      ).rejects.toThrow('Delete failed');
      expect(useAlertsStore.getState().rulesError).toBe('Failed to delete alert rule');
      expect(useAlertsStore.getState().rules).toHaveLength(2);
    });
  });

  describe('fetchAlerts', () => {
    it('fetches and stores alerts', async () => {
      mockApiRequest.mockResolvedValueOnce({ alerts: mockAlerts, total: 2 });

      await useAlertsStore.getState().fetchAlerts();

      expect(mockApiRequest).toHaveBeenCalledWith('/alerts?limit=20&offset=0');
      expect(useAlertsStore.getState().alerts).toEqual(mockAlerts);
      expect(useAlertsStore.getState().alertsTotal).toBe(2);
    });

    it('uses correct offset for page 2', async () => {
      useAlertsStore.setState({ alertsPage: 2 });
      mockApiRequest.mockResolvedValueOnce({ alerts: [], total: 0 });

      await useAlertsStore.getState().fetchAlerts();

      expect(mockApiRequest).toHaveBeenCalledWith('/alerts?limit=20&offset=20');
    });

    it('handles fetch error', async () => {
      mockApiRequest.mockRejectedValueOnce(new Error('Network error'));

      await useAlertsStore.getState().fetchAlerts();

      expect(useAlertsStore.getState().alertsError).toBe('Failed to load alerts');
    });
  });

  describe('resolveAlert', () => {
    it('resolves alert and refreshes', async () => {
      useAlertsStore.setState({ alerts: [mockAlerts[0]] });
      // resolve call, then fetchAlerts, then fetchUnresolvedCount
      mockApiRequest
        .mockResolvedValueOnce({ success: true })
        .mockResolvedValueOnce({ alerts: [], total: 0 })
        .mockResolvedValueOnce({ alerts: [], total: 0 });

      await useAlertsStore.getState().resolveAlert('alert-1');

      expect(mockApiRequest).toHaveBeenCalledWith('/alerts/alert-1/resolve', { method: 'PATCH' });
      expect(useAlertsStore.getState().successMessage).toBe('Alert resolved');
    });

    it('handles resolve error', async () => {
      mockApiRequest.mockRejectedValueOnce(new Error('Resolve failed'));

      await useAlertsStore.getState().resolveAlert('alert-1');

      expect(useAlertsStore.getState().alertsError).toBe('Failed to resolve alert');
    });
  });

  describe('fetchUnresolvedCount', () => {
    it('fetches unresolved count', async () => {
      mockApiRequest.mockResolvedValueOnce({ alerts: [mockAlerts[0]], total: 3 });

      await useAlertsStore.getState().fetchUnresolvedCount();

      expect(mockApiRequest).toHaveBeenCalledWith('/alerts?resolved=false&limit=1');
      expect(useAlertsStore.getState().unresolvedCount).toBe(3);
    });

    it('silently ignores errors', async () => {
      mockApiRequest.mockRejectedValueOnce(new Error('Fail'));

      await useAlertsStore.getState().fetchUnresolvedCount();

      expect(useAlertsStore.getState().unresolvedCount).toBe(0);
    });
  });

  describe('UI actions', () => {
    it('sets active tab', () => {
      useAlertsStore.getState().setActiveTab('history');
      expect(useAlertsStore.getState().activeTab).toBe('history');
    });

    it('sets alerts page', () => {
      useAlertsStore.getState().setAlertsPage(3);
      expect(useAlertsStore.getState().alertsPage).toBe(3);
    });

    it('clears error', () => {
      useAlertsStore.setState({ alertsError: 'err1', rulesError: 'err2' });
      useAlertsStore.getState().clearError();
      expect(useAlertsStore.getState().alertsError).toBeNull();
      expect(useAlertsStore.getState().rulesError).toBeNull();
    });

    it('clears success message', () => {
      useAlertsStore.setState({ successMessage: 'Done' });
      useAlertsStore.getState().clearSuccess();
      expect(useAlertsStore.getState().successMessage).toBeNull();
    });
  });
});
