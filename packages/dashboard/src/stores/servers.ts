// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { create } from 'zustand';

import { apiRequest, ApiError } from '@/api/client';
import type { Server, ServerListResponse, AddServerResponse } from '@/types/server';

interface UpdateServerInput {
  name?: string;
  tags?: string[];
  group?: string | null;
}

interface ServersState {
  servers: Server[];
  isLoading: boolean;
  error: string | null;
  statusFilter: string;
  searchQuery: string;
  groupFilter: string;
  tagFilter: string;
  fetchServers: () => Promise<void>;
  addServer: (name: string, tags?: string[], group?: string) => Promise<AddServerResponse>;
  updateServer: (id: string, input: UpdateServerInput) => Promise<Server>;
  deleteServer: (id: string) => Promise<void>;
  setStatusFilter: (status: string) => void;
  setSearchQuery: (query: string) => void;
  setGroupFilter: (group: string) => void;
  setTagFilter: (tag: string) => void;
  clearError: () => void;
}

export const useServersStore = create<ServersState>((set, get) => ({
  servers: [],
  isLoading: false,
  error: null,
  statusFilter: 'all',
  searchQuery: '',
  groupFilter: 'all',
  tagFilter: 'all',

  fetchServers: async () => {
    set({ isLoading: true, error: null });
    try {
      const data = await apiRequest<ServerListResponse>('/servers');
      set({ servers: data.servers, isLoading: false });
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : 'Failed to load servers';
      set({ error: message, isLoading: false });
    }
  },

  addServer: async (name, tags, group) => {
    set({ error: null });
    try {
      const data = await apiRequest<AddServerResponse>('/servers', {
        method: 'POST',
        body: JSON.stringify({ name, tags, group }),
      });
      set({ servers: [...get().servers, data.server] });
      return data;
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : 'Failed to add server';
      set({ error: message });
      throw err;
    }
  },

  updateServer: async (id, input) => {
    set({ error: null });
    try {
      const data = await apiRequest<{ server: Server }>(`/servers/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      });
      set({
        servers: get().servers.map((s) =>
          s.id === id ? data.server : s,
        ),
      });
      return data.server;
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : 'Failed to update server';
      set({ error: message });
      throw err;
    }
  },

  deleteServer: async (id) => {
    set({ error: null });
    try {
      await apiRequest(`/servers/${id}`, { method: 'DELETE' });
      set({ servers: get().servers.filter((s) => s.id !== id) });
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : 'Failed to delete server';
      set({ error: message });
      throw err;
    }
  },

  setStatusFilter: (status) => set({ statusFilter: status }),
  setSearchQuery: (query) => set({ searchQuery: query }),
  setGroupFilter: (group) => set({ groupFilter: group }),
  setTagFilter: (tag) => set({ tagFilter: tag }),
  clearError: () => set({ error: null }),
}));
