// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { create } from 'zustand';

import { apiRequest, ApiError } from '@/api/client';
import type {
  Alert,
  AlertsResponse,
  AlertRule,
  AlertRulesResponse,
  CreateAlertRuleInput,
  UpdateAlertRuleInput,
} from '@/types/dashboard';

export const PAGE_SIZE = 20;

interface AlertsState {
  // Alert history
  alerts: Alert[];
  alertsTotal: number;
  alertsPage: number;
  isLoadingAlerts: boolean;
  alertsError: string | null;

  // Alert rules
  rules: AlertRule[];
  rulesTotal: number;
  isLoadingRules: boolean;
  rulesError: string | null;

  // Unresolved count for header badge
  unresolvedCount: number;

  // UI state
  activeTab: 'rules' | 'history';
  successMessage: string | null;

  // Alert history actions
  fetchAlerts: () => Promise<void>;
  resolveAlert: (id: string) => Promise<void>;
  setAlertsPage: (page: number) => void;

  // Alert rule actions
  fetchRules: () => Promise<void>;
  createRule: (input: CreateAlertRuleInput) => Promise<void>;
  updateRule: (id: string, input: UpdateAlertRuleInput) => Promise<void>;
  deleteRule: (id: string) => Promise<void>;

  // Unresolved count
  fetchUnresolvedCount: () => Promise<void>;

  // UI actions
  setActiveTab: (tab: 'rules' | 'history') => void;
  clearError: () => void;
  clearSuccess: () => void;
}

export const useAlertsStore = create<AlertsState>((set, get) => ({
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

  fetchAlerts: async () => {
    const { alertsPage } = get();
    set({ isLoadingAlerts: true, alertsError: null });
    try {
      const limit = PAGE_SIZE;
      const offset = (alertsPage - 1) * PAGE_SIZE;
      const data = await apiRequest<AlertsResponse>(
        `/alerts?limit=${limit}&offset=${offset}`,
      );
      set({ alerts: data.alerts, alertsTotal: data.total, isLoadingAlerts: false });
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : 'Failed to load alerts';
      set({ alertsError: message, isLoadingAlerts: false });
    }
  },

  resolveAlert: async (id) => {
    set({ alertsError: null });
    try {
      await apiRequest(`/alerts/${id}/resolve`, { method: 'PATCH' });
      // Refresh both alerts list and unresolved count
      await Promise.all([get().fetchAlerts(), get().fetchUnresolvedCount()]);
      set({ successMessage: 'Alert resolved' });
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : 'Failed to resolve alert';
      set({ alertsError: message });
    }
  },

  setAlertsPage: (page) => set({ alertsPage: page }),

  fetchRules: async () => {
    set({ isLoadingRules: true, rulesError: null });
    try {
      const data = await apiRequest<AlertRulesResponse>('/alert-rules');
      set({ rules: data.rules, rulesTotal: data.total, isLoadingRules: false });
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : 'Failed to load alert rules';
      set({ rulesError: message, isLoadingRules: false });
    }
  },

  createRule: async (input) => {
    set({ rulesError: null });
    try {
      await apiRequest('/alert-rules', {
        method: 'POST',
        body: JSON.stringify(input),
      });
      await get().fetchRules();
      set({ successMessage: 'Alert rule created' });
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : 'Failed to create alert rule';
      set({ rulesError: message });
      throw err;
    }
  },

  updateRule: async (id, input) => {
    set({ rulesError: null });
    try {
      await apiRequest(`/alert-rules/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      });
      await get().fetchRules();
      set({ successMessage: 'Alert rule updated' });
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : 'Failed to update alert rule';
      set({ rulesError: message });
      throw err;
    }
  },

  deleteRule: async (id) => {
    set({ rulesError: null });
    try {
      await apiRequest(`/alert-rules/${id}`, { method: 'DELETE' });
      set({ rules: get().rules.filter((r) => r.id !== id) });
      set({ successMessage: 'Alert rule deleted' });
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : 'Failed to delete alert rule';
      set({ rulesError: message });
      throw err;
    }
  },

  fetchUnresolvedCount: async () => {
    try {
      const data = await apiRequest<AlertsResponse>(
        '/alerts?resolved=false&limit=1',
      );
      set({ unresolvedCount: data.total });
    } catch {
      // Silently fail — badge is non-critical
    }
  },

  setActiveTab: (tab) => set({ activeTab: tab }),
  clearError: () => set({ alertsError: null, rulesError: null }),
  clearSuccess: () => set({ successMessage: null }),
}));
