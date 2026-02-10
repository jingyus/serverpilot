import { create } from 'zustand';

import { apiRequest, ApiError } from '@/api/client';
import type { Operation, OperationsResponse, Alert, AlertsResponse } from '@/types/dashboard';

interface DashboardState {
  operations: Operation[];
  alerts: Alert[];
  isLoadingOperations: boolean;
  isLoadingAlerts: boolean;
  operationsError: string | null;
  alertsError: string | null;
  fetchRecentOperations: () => Promise<void>;
  fetchAlerts: () => Promise<void>;
  clearErrors: () => void;
}

export const useDashboardStore = create<DashboardState>((set) => ({
  operations: [],
  alerts: [],
  isLoadingOperations: false,
  isLoadingAlerts: false,
  operationsError: null,
  alertsError: null,

  fetchRecentOperations: async () => {
    set({ isLoadingOperations: true, operationsError: null });
    try {
      const data = await apiRequest<OperationsResponse>('/operations?limit=5');
      set({ operations: data.operations, isLoadingOperations: false });
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : 'Failed to load operations';
      set({ operationsError: message, isLoadingOperations: false });
    }
  },

  fetchAlerts: async () => {
    set({ isLoadingAlerts: true, alertsError: null });
    try {
      const data = await apiRequest<AlertsResponse>('/alerts?resolved=false');
      set({ alerts: data.alerts, isLoadingAlerts: false });
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : 'Failed to load alerts';
      set({ alertsError: message, isLoadingAlerts: false });
    }
  },

  clearErrors: () => set({ operationsError: null, alertsError: null }),
}));
