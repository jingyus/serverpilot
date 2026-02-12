// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { create } from 'zustand';

import { apiRequest, ApiError } from '@/api/client';
import { createMetricsSSE } from '@/api/sse';
import type {
  Server,
  ServerProfile,
  Metrics,
  MetricPoint,
  MetricsRange,
  ServerDetailResponse,
  ServerProfileResponse,
  MetricsHistoryResponse,
} from '@/types/server';

/** Sliding window durations in milliseconds. */
const WINDOW_MS: Record<MetricsRange, number> = {
  '1h': 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
};

interface ServerDetailState {
  server: Server | null;
  profile: ServerProfile | null;
  metrics: Metrics | null;
  metricsHistory: MetricPoint[];
  metricsRange: MetricsRange;
  isLoading: boolean;
  isProfileLoading: boolean;
  isMetricsLoading: boolean;
  isStreaming: boolean;
  isUpdatingTags: boolean;
  error: string | null;
  fetchServer: (id: string) => Promise<void>;
  fetchProfile: (id: string) => Promise<void>;
  fetchMetrics: (id: string, range?: MetricsRange) => Promise<void>;
  updateTags: (id: string, tags: string[]) => Promise<void>;
  setMetricsRange: (range: MetricsRange) => void;
  startMetricsStream: (serverId: string) => void;
  stopMetricsStream: () => void;
  clearError: () => void;
  reset: () => void;
}

const initialState = {
  server: null,
  profile: null,
  metrics: null,
  metricsHistory: [] as MetricPoint[],
  metricsRange: '1h' as MetricsRange,
  isLoading: false,
  isProfileLoading: false,
  isMetricsLoading: false,
  isStreaming: false,
  isUpdatingTags: false,
  error: null,
};

// Module-level SSE handle (not in Zustand state to avoid serialization issues)
let activeStream: { abort: () => void } | null = null;

export const useServerDetailStore = create<ServerDetailState>((set, get) => ({
  ...initialState,

  fetchServer: async (id) => {
    set({ isLoading: true, error: null });
    try {
      const data = await apiRequest<ServerDetailResponse>(`/servers/${id}`);
      set({ server: data.server, isLoading: false });
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : 'Failed to load server details';
      set({ error: message, isLoading: false });
    }
  },

  fetchProfile: async (id) => {
    set({ isProfileLoading: true });
    try {
      const data = await apiRequest<ServerProfileResponse>(`/servers/${id}/profile`);
      set({ profile: data.profile, isProfileLoading: false });
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : 'Failed to load server profile';
      set({ error: message, isProfileLoading: false });
    }
  },

  fetchMetrics: async (id, range) => {
    const activeRange = range ?? get().metricsRange;
    set({ isMetricsLoading: true });
    try {
      const data = await apiRequest<MetricsHistoryResponse>(
        `/servers/${id}/metrics?range=${activeRange}`,
      );
      const history = data.metrics;
      const latest = history.length > 0 ? history[history.length - 1] : null;
      set({
        metricsHistory: history,
        metricsRange: activeRange,
        metrics: latest ? {
          cpuUsage: latest.cpuUsage,
          memoryUsage: latest.memoryUsage,
          memoryTotal: latest.memoryTotal,
          diskUsage: latest.diskUsage,
          diskTotal: latest.diskTotal,
          networkIn: latest.networkIn,
          networkOut: latest.networkOut,
          timestamp: latest.timestamp,
        } : null,
        isMetricsLoading: false,
      });
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : 'Failed to load server metrics';
      set({ error: message, isMetricsLoading: false });
    }
  },

  updateTags: async (id, tags) => {
    set({ isUpdatingTags: true, error: null });
    try {
      const data = await apiRequest<ServerDetailResponse>(`/servers/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ tags }),
      });
      set({ server: data.server, isUpdatingTags: false });
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : 'Failed to update tags';
      set({ error: message, isUpdatingTags: false });
    }
  },

  setMetricsRange: (range) => set({ metricsRange: range }),

  startMetricsStream: (serverId) => {
    // Close existing stream if any
    activeStream?.abort();

    set({ isStreaming: true });

    activeStream = createMetricsSSE(
      `/metrics/stream?serverId=${encodeURIComponent(serverId)}`,
      {
        onMetric: (data) => {
          try {
            const metric = JSON.parse(data) as MetricPoint;
            set((state) => {
              const windowMs = WINDOW_MS[state.metricsRange];
              const cutoff = new Date(Date.now() - windowMs).toISOString();
              // Append new point and trim outside window
              const updated = [...state.metricsHistory, metric]
                .filter((p) => p.timestamp >= cutoff);
              return {
                metricsHistory: updated,
                metrics: {
                  cpuUsage: metric.cpuUsage,
                  memoryUsage: metric.memoryUsage,
                  memoryTotal: metric.memoryTotal,
                  diskUsage: metric.diskUsage,
                  diskTotal: metric.diskTotal,
                  networkIn: metric.networkIn,
                  networkOut: metric.networkOut,
                  timestamp: metric.timestamp,
                },
              };
            });
          } catch {
            // Ignore parse errors
          }
        },
        onError: () => {
          // Reconnect is handled internally by createMetricsSSE
        },
      },
    );
  },

  stopMetricsStream: () => {
    activeStream?.abort();
    activeStream = null;
    set({ isStreaming: false });
  },

  clearError: () => set({ error: null }),
  reset: () => {
    activeStream?.abort();
    activeStream = null;
    set(initialState);
  },
}));
