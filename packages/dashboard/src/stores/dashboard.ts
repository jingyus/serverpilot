// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { create } from 'zustand';

import { apiRequest, ApiError } from '@/api/client';
import type {
  Operation,
  OperationsResponse,
  OperationStats,
  Alert,
  AlertsResponse,
} from '@/types/dashboard';

export interface TrendPoint {
  date: string;
  count: number;
}

interface DashboardState {
  operations: Operation[];
  alerts: Alert[];
  stats: OperationStats | null;
  weekOperations: Operation[];
  isLoadingOperations: boolean;
  isLoadingAlerts: boolean;
  isLoadingStats: boolean;
  isLoadingWeekOps: boolean;
  operationsError: string | null;
  alertsError: string | null;
  fetchRecentOperations: () => Promise<void>;
  fetchAlerts: () => Promise<void>;
  fetchOperationStats: () => Promise<void>;
  fetchWeekOperations: () => Promise<void>;
  clearErrors: () => void;
}

/** Build 7-day trend data from a list of operations. */
export function buildTrendData(operations: Operation[]): TrendPoint[] {
  const now = new Date();
  const points: TrendPoint[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    points.push({ date: d.toISOString().slice(0, 10), count: 0 });
  }
  for (const op of operations) {
    const day = op.createdAt.slice(0, 10);
    const point = points.find((p) => p.date === day);
    if (point) point.count++;
  }
  return points;
}

export const useDashboardStore = create<DashboardState>((set) => ({
  operations: [],
  alerts: [],
  stats: null,
  weekOperations: [],
  isLoadingOperations: false,
  isLoadingAlerts: false,
  isLoadingStats: false,
  isLoadingWeekOps: false,
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

  fetchOperationStats: async () => {
    set({ isLoadingStats: true });
    try {
      const data = await apiRequest<{ stats: OperationStats }>('/operations/stats');
      set({ stats: data.stats, isLoadingStats: false });
    } catch {
      set({ isLoadingStats: false });
    }
  },

  fetchWeekOperations: async () => {
    set({ isLoadingWeekOps: true });
    try {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 6);
      const qs = `startDate=${startDate.toISOString()}&limit=100`;
      const data = await apiRequest<OperationsResponse>(`/operations?${qs}`);
      set({ weekOperations: data.operations, isLoadingWeekOps: false });
    } catch {
      set({ isLoadingWeekOps: false });
    }
  },

  clearErrors: () => set({ operationsError: null, alertsError: null }),
}));
