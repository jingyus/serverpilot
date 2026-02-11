// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { create } from 'zustand';

import { apiRequest, ApiError } from '@/api/client';
import { API_BASE_URL } from '@/utils/constants';
import type { AuditLogEntry, AuditLogsResponse } from '@/types/dashboard';

export interface AuditLogFilters {
  serverId: string;
  riskLevel: string;
  action: string;
  startDate: string;
  endDate: string;
}

const DEFAULT_FILTERS: AuditLogFilters = {
  serverId: '',
  riskLevel: '',
  action: '',
  startDate: '',
  endDate: '',
};

const PAGE_SIZE = 20;

interface AuditLogState {
  logs: AuditLogEntry[];
  total: number;
  selectedLog: AuditLogEntry | null;
  filters: AuditLogFilters;
  page: number;
  isLoading: boolean;
  isExporting: boolean;
  error: string | null;

  fetchLogs: () => Promise<void>;
  exportCsv: () => Promise<void>;
  setFilters: (filters: Partial<AuditLogFilters>) => void;
  resetFilters: () => void;
  setPage: (page: number) => void;
  setSelectedLog: (log: AuditLogEntry | null) => void;
  clearError: () => void;
}

function buildQueryString(filters: AuditLogFilters, page: number): string {
  const params = new URLSearchParams();
  params.set('limit', String(PAGE_SIZE));
  params.set('offset', String((page - 1) * PAGE_SIZE));

  if (filters.serverId) params.set('serverId', filters.serverId);
  if (filters.riskLevel) params.set('riskLevel', filters.riskLevel);
  if (filters.action) params.set('action', filters.action);
  if (filters.startDate) params.set('startDate', new Date(filters.startDate).toISOString());
  if (filters.endDate) params.set('endDate', new Date(filters.endDate).toISOString());

  return params.toString();
}

function buildExportParams(filters: AuditLogFilters): string {
  const params = new URLSearchParams();
  params.set('format', 'csv');
  if (filters.startDate) params.set('from', new Date(filters.startDate).toISOString());
  if (filters.endDate) params.set('to', new Date(filters.endDate).toISOString());
  if (filters.serverId) params.set('serverId', filters.serverId);
  if (filters.riskLevel) params.set('riskLevel', filters.riskLevel);
  return params.toString();
}

export const useAuditLogStore = create<AuditLogState>((set, get) => ({
  logs: [],
  total: 0,
  selectedLog: null,
  filters: { ...DEFAULT_FILTERS },
  page: 1,
  isLoading: false,
  isExporting: false,
  error: null,

  fetchLogs: async () => {
    const { filters, page } = get();
    set({ isLoading: true, error: null });
    try {
      const qs = buildQueryString(filters, page);
      const data = await apiRequest<AuditLogsResponse>(`/audit-log?${qs}`);
      set({ logs: data.logs, total: data.total, isLoading: false });
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : 'Failed to load audit logs';
      set({ error: message, isLoading: false });
    }
  },

  exportCsv: async () => {
    const { filters } = get();
    set({ isExporting: true, error: null });
    try {
      const qs = buildExportParams(filters);
      const token = localStorage.getItem('auth_token');
      const response = await fetch(`${API_BASE_URL}/audit-log/export?${qs}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      if (!response.ok) {
        throw new Error(`Export failed with status ${response.status}`);
      }

      const blob = await response.blob();
      const disposition = response.headers.get('Content-Disposition') ?? '';
      const match = disposition.match(/filename="(.+?)"/);
      const filename = match?.[1] ?? 'audit-log-export.csv';

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);

      set({ isExporting: false });
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : 'Failed to export audit logs';
      set({ error: message, isExporting: false });
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

  setSelectedLog: (log) => {
    set({ selectedLog: log });
  },

  clearError: () => set({ error: null }),
}));

export { PAGE_SIZE };
