// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Zustand store for managing documentation sources.
 *
 * Provides state management and API integration for CRUD operations
 * on doc sources, manual fetch triggers, and status queries.
 */

import { create } from 'zustand';
import { apiRequest, ApiError } from '@/api/client';
import type {
  DocSource,
  CreateDocSourceInput,
  UpdateDocSourceInput,
  FetchTask,
} from '@/types/doc-source';

interface DocSourcesState {
  sources: DocSource[];
  isLoading: boolean;
  error: string | null;
  isSaving: boolean;
  fetchingSources: Set<string>;

  fetchSources: () => Promise<void>;
  createSource: (input: CreateDocSourceInput) => Promise<DocSource>;
  updateSource: (id: string, input: UpdateDocSourceInput) => Promise<void>;
  deleteSource: (id: string) => Promise<void>;
  triggerFetch: (id: string) => Promise<FetchTask>;
  clearError: () => void;
}

export const useDocSourcesStore = create<DocSourcesState>((set, get) => ({
  sources: [],
  isLoading: false,
  error: null,
  isSaving: false,
  fetchingSources: new Set(),

  fetchSources: async () => {
    set({ isLoading: true, error: null });
    try {
      const data = await apiRequest<{ sources: DocSource[] }>('/doc-sources');
      set({ sources: data.sources, isLoading: false });
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : 'Failed to load doc sources';
      set({ error: message, isLoading: false });
    }
  },

  createSource: async (input: CreateDocSourceInput) => {
    set({ isSaving: true, error: null });
    try {
      const data = await apiRequest<{ source: DocSource }>('/doc-sources', {
        method: 'POST',
        body: JSON.stringify(input),
      });
      set((state) => ({
        sources: [data.source, ...state.sources],
        isSaving: false,
      }));
      return data.source;
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : 'Failed to create doc source';
      set({ error: message, isSaving: false });
      throw err;
    }
  },

  updateSource: async (id: string, input: UpdateDocSourceInput) => {
    set({ isSaving: true, error: null });
    try {
      const data = await apiRequest<{ source: DocSource }>(`/doc-sources/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      });
      set((state) => ({
        sources: state.sources.map((s) => (s.id === id ? data.source : s)),
        isSaving: false,
      }));
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : 'Failed to update doc source';
      set({ error: message, isSaving: false });
      throw err;
    }
  },

  deleteSource: async (id: string) => {
    set({ error: null });
    try {
      await apiRequest<{ success: boolean }>(`/doc-sources/${id}`, {
        method: 'DELETE',
      });
      set((state) => ({
        sources: state.sources.filter((s) => s.id !== id),
      }));
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : 'Failed to delete doc source';
      set({ error: message });
      throw err;
    }
  },

  triggerFetch: async (id: string) => {
    const { fetchingSources } = get();
    const newSet = new Set(fetchingSources);
    newSet.add(id);
    set({ fetchingSources: newSet, error: null });

    try {
      const data = await apiRequest<{ success: boolean; task: FetchTask }>(
        `/doc-sources/${id}/fetch`,
        { method: 'POST' },
      );

      // Refresh sources to get updated counts/status
      await get().fetchSources();

      return data.task;
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : 'Failed to fetch documentation';
      set({ error: message });
      throw err;
    } finally {
      set((state) => {
        const updated = new Set(state.fetchingSources);
        updated.delete(id);
        return { fetchingSources: updated };
      });
    }
  },

  clearError: () => set({ error: null }),
}));
