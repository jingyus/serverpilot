import { create } from 'zustand';

import { apiRequest, ApiError } from '@/api/client';
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

interface ServerDetailState {
  server: Server | null;
  profile: ServerProfile | null;
  metrics: Metrics | null;
  metricsHistory: MetricPoint[];
  metricsRange: MetricsRange;
  isLoading: boolean;
  isProfileLoading: boolean;
  isMetricsLoading: boolean;
  error: string | null;
  fetchServer: (id: string) => Promise<void>;
  fetchProfile: (id: string) => Promise<void>;
  fetchMetrics: (id: string, range?: MetricsRange) => Promise<void>;
  setMetricsRange: (range: MetricsRange) => void;
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
  error: null,
};

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

  setMetricsRange: (range) => set({ metricsRange: range }),

  clearError: () => set({ error: null }),
  reset: () => set(initialState),
}));
