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
  SkillsResponse,
  AvailableSkillsResponse,
  SkillResponse,
  ExecutionResponse,
  ExecutionsResponse,
  SkillExecutionEvent,
} from '@/types/skill';

interface SkillsState {
  skills: InstalledSkill[];
  available: AvailableSkill[];
  executions: SkillExecution[];
  executionEvents: SkillExecutionEvent[];
  isStreaming: boolean;
  isLoading: boolean;
  error: string | null;

  fetchSkills: () => Promise<void>;
  fetchAvailable: () => Promise<void>;
  installSkill: (skillDir: string, source: SkillSource) => Promise<InstalledSkill>;
  uninstallSkill: (id: string) => Promise<void>;
  configureSkill: (id: string, config: Record<string, unknown>) => Promise<void>;
  updateStatus: (id: string, status: SkillStatus) => Promise<void>;
  executeSkill: (id: string, serverId: string, config?: Record<string, unknown>) => Promise<SkillExecutionResult>;
  fetchExecutions: (id: string) => Promise<void>;
  startExecutionStream: (executionId: string) => void;
  stopExecutionStream: () => void;
  clearError: () => void;
}

export const useSkillsStore = create<SkillsState>((set, get) => ({
  skills: [],
  available: [],
  executions: [],
  isLoading: false,
  error: null,

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
          s.id === id ? { ...s, config, status: 'configured' as SkillStatus } : s,
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

  executeSkill: async (id, serverId, config) => {
    set({ error: null });
    try {
      const data = await apiRequest<ExecutionResponse>(`/skills/${id}/execute`, {
        method: 'POST',
        body: JSON.stringify({ serverId, ...(config ? { config } : {}) }),
      });
      return data.execution;
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to execute skill';
      set({ error: message });
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

  clearError: () => set({ error: null }),
}));
