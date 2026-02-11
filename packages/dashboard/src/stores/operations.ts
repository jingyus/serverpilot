// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { create } from 'zustand';

import { apiRequest, ApiError } from '@/api/client';
import type {
  Operation,
  OperationsResponse,
  OperationStats,
  OperationType,
  OperationStatus,
  RiskLevel,
} from '@/types/dashboard';

export interface OperationFilters {
  serverId: string;
  type: string;
  status: string;
  riskLevel: string;
  startDate: string;
  endDate: string;
}

const DEFAULT_FILTERS: OperationFilters = {
  serverId: '',
  type: '',
  status: '',
  riskLevel: '',
  startDate: '',
  endDate: '',
};

const PAGE_SIZE = 20;

interface OperationsState {
  operations: Operation[];
  total: number;
  stats: OperationStats | null;
  selectedOperation: Operation | null;
  filters: OperationFilters;
  page: number;
  isLoading: boolean;
  isLoadingStats: boolean;
  error: string | null;
  statsError: string | null;

  fetchOperations: () => Promise<void>;
  fetchStats: () => Promise<void>;
  setFilters: (filters: Partial<OperationFilters>) => void;
  resetFilters: () => void;
  setPage: (page: number) => void;
  setSelectedOperation: (operation: Operation | null) => void;
  clearError: () => void;
}

function buildQueryString(filters: OperationFilters, page: number): string {
  const params = new URLSearchParams();
  params.set('limit', String(PAGE_SIZE));
  params.set('offset', String((page - 1) * PAGE_SIZE));

  if (filters.serverId) params.set('serverId', filters.serverId);
  if (filters.type) params.set('type', filters.type);
  if (filters.status) params.set('status', filters.status);
  if (filters.riskLevel) params.set('riskLevel', filters.riskLevel);
  if (filters.startDate) params.set('startDate', filters.startDate);
  if (filters.endDate) params.set('endDate', filters.endDate);

  return params.toString();
}

export const useOperationsStore = create<OperationsState>((set, get) => ({
  operations: [],
  total: 0,
  stats: null,
  selectedOperation: null,
  filters: { ...DEFAULT_FILTERS },
  page: 1,
  isLoading: false,
  isLoadingStats: false,
  error: null,
  statsError: null,

  fetchOperations: async () => {
    const { filters, page } = get();
    set({ isLoading: true, error: null });
    try {
      const qs = buildQueryString(filters, page);
      const data = await apiRequest<OperationsResponse>(`/operations?${qs}`);
      set({ operations: data.operations, total: data.total, isLoading: false });
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : 'Failed to load operations';
      set({ error: message, isLoading: false });
    }
  },

  fetchStats: async () => {
    const { filters } = get();
    set({ isLoadingStats: true, statsError: null });
    try {
      const params = filters.serverId
        ? `?serverId=${filters.serverId}`
        : '';
      const data = await apiRequest<OperationStats>(
        `/operations/stats${params}`
      );
      set({ stats: data, isLoadingStats: false });
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : 'Failed to load stats';
      set({ statsError: message, isLoadingStats: false });
    }
  },

  setFilters: (partial) => {
    const { filters } = get();
    set({ filters: { ...filters, ...partial }, page: 1 });
  },

  resetFilters: () => {
    set({ filters: { ...DEFAULT_FILTERS }, page: 1 });
  },

  setPage: (page) => {
    set({ page });
  },

  setSelectedOperation: (operation) => {
    set({ selectedOperation: operation });
  },

  clearError: () => set({ error: null, statsError: null }),
}));

export { PAGE_SIZE };
