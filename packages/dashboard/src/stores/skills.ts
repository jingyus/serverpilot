// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { create } from 'zustand';
import { apiRequest, ApiError } from '@/api/client';
import { createSkillExecutionSSE } from '@/api/sse';
import type {
  InstalledSkill,
  AvailableSkill,
  SkillExecution,
  SkillExecutionResult,
  SkillStatus,
  SkillSource,
  SkillStats,
  SkillsResponse,
  AvailableSkillsResponse,
  SkillResponse,
  ExecutionResponse,
  DryRunResponse,
  ExecutionsResponse,
  ExecutionDetailResponse,
  PendingConfirmationsResponse,
  SkillStatsResponse,
  SkillExecutionEvent,
} from '@/types/skill';

interface SkillsState {
  skills: InstalledSkill[];
  available: AvailableSkill[];
  executions: SkillExecution[];
  selectedExecution: SkillExecution | null;
  isLoadingDetail: boolean;
  executionEvents: SkillExecutionEvent[];
  isStreaming: boolean;
  isLoading: boolean;
  isUpgrading: string | null;
  isCancelling: string | null;
  error: string | null;
  pendingConfirmations: SkillExecution[];
  stats: SkillStats | null;
  isLoadingStats: boolean;
  dryRunResult: SkillExecutionResult | null;
  isDryRunning: boolean;

  fetchSkills: () => Promise<void>;
  fetchAvailable: () => Promise<void>;
  fetchStats: () => Promise<void>;
  installSkill: (skillDir: string, source: SkillSource) => Promise<InstalledSkill>;
  uninstallSkill: (id: string) => Promise<void>;
  configureSkill: (id: string, config: Record<string, unknown>) => Promise<void>;
  updateStatus: (id: string, status: SkillStatus) => Promise<void>;
  executeSkill: (id: string, serverId: string, config?: Record<string, unknown>, dryRun?: boolean) => Promise<SkillExecutionResult>;
  dryRunSkill: (id: string, serverId: string, inputs?: Record<string, unknown>) => Promise<SkillExecutionResult>;
  upgradeSkill: (id: string) => Promise<void>;
  cancelExecution: (eid: string) => Promise<void>;
  fetchExecutions: (id: string) => Promise<void>;
  fetchExecutionDetail: (skillId: string, executionId: string) => Promise<void>;
  fetchPendingConfirmations: () => Promise<void>;
  confirmExecution: (executionId: string) => Promise<SkillExecutionResult>;
  rejectExecution: (executionId: string) => Promise<void>;
  clearSelectedExecution: () => void;
  clearDryRunResult: () => void;
  startExecutionStream: (executionId: string) => void;
  stopExecutionStream: () => void;
  clearError: () => void;
}

let streamHandle: { abort: () => void } | null = null;

export const useSkillsStore = create<SkillsState>((set, get) => ({
  skills: [],
  available: [],
  executions: [],
  selectedExecution: null,
  isLoadingDetail: false,
  executionEvents: [],
  isStreaming: false,
  isLoading: false,
  isUpgrading: null,
  isCancelling: null,
  error: null,
  pendingConfirmations: [],
  stats: null,
  isLoadingStats: false,
  dryRunResult: null,
  isDryRunning: false,

  fetchStats: async () => {
    set({ isLoadingStats: true, error: null });
    try {
      const data = await apiRequest<SkillStatsResponse>('/skills/stats');
      set({ stats: data.stats, isLoadingStats: false });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to load stats';
      set({ error: message, isLoadingStats: false });
    }
  },

  fetchSkills: async () => {
    set({ isLoading: true, error: null });
    try {
      const data = await apiRequest<SkillsResponse>('/skills');
      set({ skills: data.skills, isLoading: false });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to load skills';
      set({ error: message, isLoading: false });
    }
  },

  fetchAvailable: async () => {
    set({ isLoading: true, error: null });
    try {
      const data = await apiRequest<AvailableSkillsResponse>('/skills/available');
      set({ available: data.skills, isLoading: false });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to load available skills';
      set({ error: message, isLoading: false });
    }
  },

  installSkill: async (skillDir, source) => {
    set({ error: null });
    try {
      const data = await apiRequest<SkillResponse>('/skills/install', {
        method: 'POST',
        body: JSON.stringify({ skillDir, source }),
      });
      set({ skills: [...get().skills, data.skill] });
      return data.skill;
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to install skill';
      set({ error: message });
      throw err;
    }
  },

  uninstallSkill: async (id) => {
    set({ error: null });
    try {
      await apiRequest(`/skills/${id}`, { method: 'DELETE' });
      set({ skills: get().skills.filter((s) => s.id !== id) });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to uninstall skill';
      set({ error: message });
      throw err;
    }
  },

  configureSkill: async (id, config) => {
    set({ error: null });
    try {
      await apiRequest(`/skills/${id}/config`, {
        method: 'PUT',
        body: JSON.stringify({ config }),
      });
      set({
        skills: get().skills.map((s) =>
          s.id === id
            ? { ...s, config, ...(s.status === 'installed' ? { status: 'configured' as SkillStatus } : {}) }
            : s,
        ),
      });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to configure skill';
      set({ error: message });
      throw err;
    }
  },

  updateStatus: async (id, status) => {
    set({ error: null });
    try {
      await apiRequest(`/skills/${id}/status`, {
        method: 'PUT',
        body: JSON.stringify({ status }),
      });
      set({
        skills: get().skills.map((s) =>
          s.id === id ? { ...s, status } : s,
        ),
      });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to update skill status';
      set({ error: message });
      throw err;
    }
  },

  executeSkill: async (id, serverId, config, dryRun) => {
    set({ error: null });
    try {
      const data = await apiRequest<ExecutionResponse>(`/skills/${id}/execute`, {
        method: 'POST',
        body: JSON.stringify({ serverId, ...(config ? { config } : {}), ...(dryRun ? { dryRun } : {}) }),
      });
      return data.execution;
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to execute skill';
      set({ error: message });
      throw err;
    }
  },

  dryRunSkill: async (id, serverId, inputs) => {
    set({ isDryRunning: true, dryRunResult: null, error: null });
    try {
      const data = await apiRequest<DryRunResponse>(`/skills/${id}/dry-run`, {
        method: 'POST',
        body: JSON.stringify({ serverId, ...(inputs ? { config: inputs } : {}) }),
      });
      set({ dryRunResult: data.execution, isDryRunning: false });
      return data.execution;
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to preview skill';
      set({ error: message, isDryRunning: false });
      throw err;
    }
  },

  upgradeSkill: async (id) => {
    set({ isUpgrading: id, error: null });
    try {
      const data = await apiRequest<SkillResponse>(`/skills/${id}/upgrade`, {
        method: 'PUT',
      });
      set({
        skills: get().skills.map((s) => (s.id === id ? data.skill : s)),
        isUpgrading: null,
      });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to upgrade skill';
      set({ error: message, isUpgrading: null });
      throw err;
    }
  },

  cancelExecution: async (eid) => {
    set({ isCancelling: eid, error: null });
    try {
      await apiRequest(`/skills/executions/${eid}/cancel`, {
        method: 'POST',
      });
      set({
        isCancelling: null,
        isStreaming: false,
        executions: get().executions.map((e) =>
          e.id === eid ? { ...e, status: 'cancelled' as const } : e,
        ),
      });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to cancel execution';
      set({ error: message, isCancelling: null });
      throw err;
    }
  },

  fetchExecutions: async (id) => {
    set({ isLoading: true, error: null });
    try {
      const data = await apiRequest<ExecutionsResponse>(`/skills/${id}/executions`);
      set({ executions: data.executions, isLoading: false });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to load executions';
      set({ error: message, isLoading: false });
    }
  },

  fetchExecutionDetail: async (skillId, executionId) => {
    set({ isLoadingDetail: true, error: null });
    try {
      const data = await apiRequest<ExecutionDetailResponse>(
        `/skills/${skillId}/executions/${executionId}`,
      );
      set({ selectedExecution: data.execution, isLoadingDetail: false });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to load execution detail';
      set({ error: message, isLoadingDetail: false });
    }
  },

  fetchPendingConfirmations: async () => {
    try {
      const data = await apiRequest<PendingConfirmationsResponse>('/skills/pending-confirmations');
      set({ pendingConfirmations: data.executions });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to load pending confirmations';
      set({ error: message });
    }
  },

  confirmExecution: async (executionId) => {
    set({ error: null });
    try {
      const data = await apiRequest<ExecutionResponse>(`/skills/executions/${executionId}/confirm`, {
        method: 'POST',
      });
      set({
        pendingConfirmations: get().pendingConfirmations.filter((e) => e.id !== executionId),
      });
      return data.execution;
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to confirm execution';
      set({ error: message });
      throw err;
    }
  },

  rejectExecution: async (executionId) => {
    set({ error: null });
    try {
      await apiRequest(`/skills/executions/${executionId}/reject`, {
        method: 'POST',
      });
      set({
        pendingConfirmations: get().pendingConfirmations.filter((e) => e.id !== executionId),
      });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to reject execution';
      set({ error: message });
      throw err;
    }
  },

  clearSelectedExecution: () => set({ selectedExecution: null }),

  clearDryRunResult: () => set({ dryRunResult: null }),

  startExecutionStream: (executionId: string) => {
    // Stop any existing stream
    get().stopExecutionStream();

    set({ executionEvents: [], isStreaming: true });

    streamHandle = createSkillExecutionSSE(executionId, {
      onStep: (data) => {
        try {
          const event = JSON.parse(data) as SkillExecutionEvent;
          set({ executionEvents: [...get().executionEvents, event] });
        } catch { /* ignore parse errors */ }
      },
      onLog: (data) => {
        try {
          const event = JSON.parse(data) as SkillExecutionEvent;
          set({ executionEvents: [...get().executionEvents, event] });
        } catch { /* ignore parse errors */ }
      },
      onCompleted: (data) => {
        try {
          const event = JSON.parse(data) as SkillExecutionEvent;
          set({
            executionEvents: [...get().executionEvents, event],
            isStreaming: false,
          });
        } catch { /* ignore parse errors */ }
        streamHandle = null;
      },
      onError: (error) => {
        set({ error: error.message, isStreaming: false });
        streamHandle = null;
      },
    });
  },

  stopExecutionStream: () => {
    if (streamHandle) {
      streamHandle.abort();
      streamHandle = null;
    }
    set({ isStreaming: false });
  },

  clearError: () => set({ error: null }),
}));
