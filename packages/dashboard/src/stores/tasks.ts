// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { create } from 'zustand';

import { apiRequest, ApiError } from '@/api/client';
import type {
  Task,
  TasksResponse,
  CreateTaskInput,
  UpdateTaskInput,
} from '@/types/dashboard';

export interface TaskFilters {
  serverId: string;
  status: string;
}

const DEFAULT_FILTERS: TaskFilters = {
  serverId: '',
  status: '',
};

interface TasksState {
  tasks: Task[];
  total: number;
  selectedTask: Task | null;
  filters: TaskFilters;
  isLoading: boolean;
  isSubmitting: boolean;
  error: string | null;

  fetchTasks: () => Promise<void>;
  createTask: (input: CreateTaskInput) => Promise<void>;
  updateTask: (id: string, input: UpdateTaskInput) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  runTask: (id: string) => Promise<void>;
  setFilters: (filters: Partial<TaskFilters>) => void;
  resetFilters: () => void;
  setSelectedTask: (task: Task | null) => void;
  clearError: () => void;
}

function buildQueryString(filters: TaskFilters): string {
  const params = new URLSearchParams();
  if (filters.serverId) params.set('serverId', filters.serverId);
  if (filters.status) params.set('status', filters.status);
  return params.toString();
}

export const useTasksStore = create<TasksState>((set, get) => ({
  tasks: [],
  total: 0,
  selectedTask: null,
  filters: { ...DEFAULT_FILTERS },
  isLoading: false,
  isSubmitting: false,
  error: null,

  fetchTasks: async () => {
    const { filters } = get();
    set({ isLoading: true, error: null });
    try {
      const qs = buildQueryString(filters);
      const path = qs ? `/tasks?${qs}` : '/tasks';
      const data = await apiRequest<TasksResponse>(path);
      set({ tasks: data.tasks, total: data.total, isLoading: false });
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : 'Failed to load tasks';
      set({ error: message, isLoading: false });
    }
  },

  createTask: async (input) => {
    set({ isSubmitting: true, error: null });
    try {
      const data = await apiRequest<{ task: Task }>('/tasks', {
        method: 'POST',
        body: JSON.stringify(input),
      });
      set({ tasks: [...get().tasks, data.task], total: get().total + 1, isSubmitting: false });
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : 'Failed to create task';
      set({ error: message, isSubmitting: false });
      throw err;
    }
  },

  updateTask: async (id, input) => {
    set({ isSubmitting: true, error: null });
    try {
      const data = await apiRequest<{ task: Task }>(`/tasks/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      });
      set({
        tasks: get().tasks.map((t) => (t.id === id ? data.task : t)),
        isSubmitting: false,
      });
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : 'Failed to update task';
      set({ error: message, isSubmitting: false });
      throw err;
    }
  },

  deleteTask: async (id) => {
    set({ isSubmitting: true, error: null });
    try {
      await apiRequest(`/tasks/${id}`, { method: 'DELETE' });
      set({
        tasks: get().tasks.filter((t) => t.id !== id),
        total: get().total - 1,
        isSubmitting: false,
      });
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : 'Failed to delete task';
      set({ error: message, isSubmitting: false });
      throw err;
    }
  },

  runTask: async (id) => {
    set({ error: null });
    try {
      await apiRequest(`/tasks/${id}/run`, { method: 'POST' });
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : 'Failed to run task';
      set({ error: message });
      throw err;
    }
  },

  setFilters: (partial) => {
    const { filters } = get();
    set({ filters: { ...filters, ...partial } });
  },

  resetFilters: () => {
    set({ filters: { ...DEFAULT_FILTERS } });
  },

  setSelectedTask: (task) => {
    set({ selectedTask: task });
  },

  clearError: () => set({ error: null }),
}));
