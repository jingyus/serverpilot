// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Knowledge base search store
 */

import { create } from 'zustand';
import { apiRequest } from '@/api/client';
import type { Knowledge, KnowledgeSource } from '@/types/knowledge';

interface KnowledgeState {
  // Search state
  query: string;
  results: Knowledge[];
  isSearching: boolean;
  error: string | null;
  selectedSource: KnowledgeSource | 'all';

  // Selected knowledge
  selectedKnowledge: Knowledge | null;

  // Actions
  setQuery: (query: string) => void;
  setSelectedSource: (source: KnowledgeSource | 'all') => void;
  search: (query: string) => Promise<void>;
  selectKnowledge: (knowledge: Knowledge | null) => void;
  clearError: () => void;
  reset: () => void;
}

const initialState = {
  query: '',
  results: [],
  isSearching: false,
  error: null,
  selectedSource: 'all' as const,
  selectedKnowledge: null,
};

export const useKnowledgeStore = create<KnowledgeState>((set, get) => ({
  ...initialState,

  setQuery: (query: string) => set({ query }),

  setSelectedSource: (source: KnowledgeSource | 'all') =>
    set({ selectedSource: source }),

  search: async (searchQuery: string) => {
    const trimmedQuery = searchQuery.trim();
    if (!trimmedQuery) {
      set({ results: [], query: trimmedQuery });
      return;
    }

    set({ isSearching: true, error: null, query: trimmedQuery });

    try {
      const source = get().selectedSource;
      const params = new URLSearchParams({ q: trimmedQuery });
      if (source !== 'all') {
        params.append('source', source);
      }

      const response = await apiRequest<{
        query: string;
        count: number;
        results: Knowledge[];
      }>(`/knowledge/search?${params.toString()}`);

      set({ results: response.results, isSearching: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Search failed',
        isSearching: false,
        results: [],
      });
    }
  },

  selectKnowledge: (knowledge: Knowledge | null) =>
    set({ selectedKnowledge: knowledge }),

  clearError: () => set({ error: null }),

  reset: () => set(initialState),
}));
