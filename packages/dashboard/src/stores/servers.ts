// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { create } from 'zustand';

import { apiRequest, ApiError } from '@/api/client';
import { createServerStatusSSE } from '@/api/sse';
import type { Server, ServerListResponse, AddServerResponse, ServerStatus } from '@/types/server';

interface UpdateServerInput {
  name?: string;
  tags?: string[];
  group?: string | null;
}

interface ServerStatusEvent {
  serverId: string;
  status: ServerStatus;
  timestamp: string;
}

interface ServersState {
  servers: Server[];
  availableGroups: string[];
  isLoading: boolean;
  error: string | null;
  statusFilter: string;
  searchQuery: string;
  groupFilter: string;
  tagFilter: string;
  viewMode: 'list' | 'grouped';
  fetchServers: () => Promise<void>;
  fetchGroups: () => Promise<void>;
  addServer: (name: string, tags?: string[], group?: string) => Promise<AddServerResponse>;
  updateServer: (id: string, input: UpdateServerInput) => Promise<Server>;
  deleteServer: (id: string) => Promise<void>;
  startStatusStream: () => void;
  stopStatusStream: () => void;
  setStatusFilter: (status: string) => void;
  setSearchQuery: (query: string) => void;
  setGroupFilter: (group: string) => void;
  setTagFilter: (tag: string) => void;
  setViewMode: (mode: 'list' | 'grouped') => void;
  clearError: () => void;
}

let statusStreamHandle: { abort: () => void } | null = null;

export const useServersStore = create<ServersState>((set, get) => ({
  servers: [],
  availableGroups: [],
  isLoading: false,
  error: null,
  statusFilter: 'all',
  searchQuery: '',
  groupFilter: 'all',
  tagFilter: 'all',
  viewMode: 'list',

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

  fetchGroups: async () => {
    try {
      const data = await apiRequest<{ groups: string[] }>('/servers/groups');
      set({ availableGroups: data.groups });
    } catch {
      // Non-critical — groups dropdown just won't show server-side groups
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

  startStatusStream: () => {
    // Prevent duplicate streams
    if (statusStreamHandle) return;

    statusStreamHandle = createServerStatusSSE({
      onStatus: (data) => {
        try {
          const event = JSON.parse(data) as ServerStatusEvent;
          set({
            servers: get().servers.map((s) =>
              s.id === event.serverId ? { ...s, status: event.status } : s,
            ),
          });
        } catch {
          // Ignore malformed status events
        }
      },
      onError: () => {
        // SSE has built-in reconnect; no action needed here
      },
    });
  },

  stopStatusStream: () => {
    if (statusStreamHandle) {
      statusStreamHandle.abort();
      statusStreamHandle = null;
    }
  },

  setStatusFilter: (status) => set({ statusFilter: status }),
  setSearchQuery: (query) => set({ searchQuery: query }),
  setGroupFilter: (group) => set({ groupFilter: group }),
  setTagFilter: (tag) => set({ tagFilter: tag }),
  setViewMode: (mode) => set({ viewMode: mode }),
  clearError: () => set({ error: null }),
}));
