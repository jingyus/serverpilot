// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useServerDetailStore } from './server-detail';
import { ApiError } from '@/api/client';

vi.mock('@/api/client', () => ({
  apiRequest: vi.fn(),
  ApiError: class ApiError extends Error {
    status: number;
    code: string;
    constructor(status: number, code: string, message: string) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.code = code;
    }
  },
}));

const mockAbort = vi.fn();
vi.mock('@/api/sse', () => ({
  createMetricsSSE: vi.fn(() => ({ abort: mockAbort })),
}));

const { apiRequest } = await import('@/api/client');
const mockApiRequest = vi.mocked(apiRequest);
const { createMetricsSSE } = await import('@/api/sse');
const mockCreateMetricsSSE = vi.mocked(createMetricsSSE);

const mockServer = {
  id: 'srv-1',
  name: 'web-prod-01',
  status: 'online' as const,
  tags: ['production'],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-15T00:00:00Z',
  osInfo: {
    platform: 'linux',
    arch: 'x64',
    version: 'Ubuntu 22.04',
    kernel: '5.15',
    hostname: 'web-prod-01',
    uptime: 86400,
  },
  lastSeen: '2026-02-09T12:00:00Z',
};

const mockProfile = {
  services: [
    { name: 'nginx', status: 'running' as const, ports: [80, 443], manager: 'systemd' as const },
  ],
  software: [
    { name: 'Node.js', version: '22.0.0', configPath: '/etc/nodejs' },
  ],
  preferences: null,
};

const mockMetricsHistory = [
  {
    id: 'm-1',
    serverId: 'srv-1',
    cpuUsage: 30.0,
    memoryUsage: 2147483648,
    memoryTotal: 8589934592,
    diskUsage: 53687091200,
    diskTotal: 107374182400,
    networkIn: 524288,
    networkOut: 262144,
    timestamp: '2026-02-09T11:00:00Z',
  },
  {
    id: 'm-2',
    serverId: 'srv-1',
    cpuUsage: 45.2,
    memoryUsage: 4294967296,
    memoryTotal: 8589934592,
    diskUsage: 53687091200,
    diskTotal: 107374182400,
    networkIn: 1048576,
    networkOut: 524288,
    timestamp: '2026-02-09T12:00:00Z',
  },
];

describe('useServerDetailStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useServerDetailStore.getState().reset();
  });

  describe('fetchServer', () => {
    it('fetches and stores server data', async () => {
      mockApiRequest.mockResolvedValueOnce({ server: mockServer });

      await useServerDetailStore.getState().fetchServer('srv-1');

      expect(mockApiRequest).toHaveBeenCalledWith('/servers/srv-1');
      expect(useServerDetailStore.getState().server).toEqual(mockServer);
      expect(useServerDetailStore.getState().isLoading).toBe(false);
    });

    it('sets isLoading during fetch', async () => {
      let resolvePromise: (value: unknown) => void;
      mockApiRequest.mockReturnValueOnce(new Promise((resolve) => { resolvePromise = resolve; }));

      const promise = useServerDetailStore.getState().fetchServer('srv-1');
      expect(useServerDetailStore.getState().isLoading).toBe(true);

      resolvePromise!({ server: mockServer });
      await promise;
      expect(useServerDetailStore.getState().isLoading).toBe(false);
    });

    it('handles ApiError', async () => {
      mockApiRequest.mockRejectedValueOnce(
        new ApiError(404, 'NOT_FOUND', 'Server not found')
      );

      await useServerDetailStore.getState().fetchServer('srv-999');

      expect(useServerDetailStore.getState().error).toBe('Server not found');
      expect(useServerDetailStore.getState().isLoading).toBe(false);
    });

    it('handles generic error', async () => {
      mockApiRequest.mockRejectedValueOnce(new Error('Network error'));

      await useServerDetailStore.getState().fetchServer('srv-1');

      expect(useServerDetailStore.getState().error).toBe('Failed to load server details');
      expect(useServerDetailStore.getState().isLoading).toBe(false);
    });
  });

  describe('fetchProfile', () => {
    it('fetches and stores profile data', async () => {
      mockApiRequest.mockResolvedValueOnce({ profile: mockProfile });

      await useServerDetailStore.getState().fetchProfile('srv-1');

      expect(mockApiRequest).toHaveBeenCalledWith('/servers/srv-1/profile');
      expect(useServerDetailStore.getState().profile).toEqual(mockProfile);
      expect(useServerDetailStore.getState().isProfileLoading).toBe(false);
    });

    it('handles profile fetch error', async () => {
      mockApiRequest.mockRejectedValueOnce(
        new ApiError(500, 'INTERNAL_ERROR', 'Profile unavailable')
      );

      await useServerDetailStore.getState().fetchProfile('srv-1');

      expect(useServerDetailStore.getState().error).toBe('Profile unavailable');
      expect(useServerDetailStore.getState().isProfileLoading).toBe(false);
    });
  });

  describe('fetchMetrics', () => {
    it('fetches and stores metrics history data', async () => {
      mockApiRequest.mockResolvedValueOnce({
        metrics: mockMetricsHistory,
        range: '1h',
      });

      await useServerDetailStore.getState().fetchMetrics('srv-1');

      expect(mockApiRequest).toHaveBeenCalledWith('/servers/srv-1/metrics?range=1h');

      const state = useServerDetailStore.getState();
      expect(state.metricsHistory).toEqual(mockMetricsHistory);
      expect(state.metricsRange).toBe('1h');
      expect(state.isMetricsLoading).toBe(false);
    });

    it('derives latest metrics from history', async () => {
      mockApiRequest.mockResolvedValueOnce({
        metrics: mockMetricsHistory,
        range: '1h',
      });

      await useServerDetailStore.getState().fetchMetrics('srv-1');

      const state = useServerDetailStore.getState();
      expect(state.metrics).not.toBeNull();
      expect(state.metrics!.cpuUsage).toBe(45.2);
      expect(state.metrics!.memoryUsage).toBe(4294967296);
    });

    it('sets metrics to null when history is empty', async () => {
      mockApiRequest.mockResolvedValueOnce({
        metrics: [],
        range: '1h',
      });

      await useServerDetailStore.getState().fetchMetrics('srv-1');

      const state = useServerDetailStore.getState();
      expect(state.metrics).toBeNull();
      expect(state.metricsHistory).toEqual([]);
    });

    it('fetches with specified range', async () => {
      mockApiRequest.mockResolvedValueOnce({
        metrics: mockMetricsHistory,
        range: '24h',
      });

      await useServerDetailStore.getState().fetchMetrics('srv-1', '24h');

      expect(mockApiRequest).toHaveBeenCalledWith('/servers/srv-1/metrics?range=24h');
      expect(useServerDetailStore.getState().metricsRange).toBe('24h');
    });

    it('handles metrics fetch error', async () => {
      mockApiRequest.mockRejectedValueOnce(new Error('Network error'));

      await useServerDetailStore.getState().fetchMetrics('srv-1');

      expect(useServerDetailStore.getState().error).toBe('Failed to load server metrics');
      expect(useServerDetailStore.getState().isMetricsLoading).toBe(false);
    });
  });

  describe('setMetricsRange', () => {
    it('updates the metrics range', () => {
      useServerDetailStore.getState().setMetricsRange('7d');
      expect(useServerDetailStore.getState().metricsRange).toBe('7d');
    });
  });

  describe('clearError', () => {
    it('clears the error', () => {
      useServerDetailStore.setState({ error: 'Some error' });
      useServerDetailStore.getState().clearError();
      expect(useServerDetailStore.getState().error).toBeNull();
    });
  });

  describe('reset', () => {
    it('resets all state to initial values', () => {
      useServerDetailStore.setState({
        server: mockServer,
        profile: mockProfile,
        metrics: {
          cpuUsage: 45.2,
          memoryUsage: 4294967296,
          memoryTotal: 8589934592,
          diskUsage: 53687091200,
          diskTotal: 107374182400,
          networkIn: 1048576,
          networkOut: 524288,
          timestamp: '2026-02-09T12:00:00Z',
        },
        metricsHistory: mockMetricsHistory,
        metricsRange: '24h',
        isLoading: true,
        error: 'Some error',
      });

      useServerDetailStore.getState().reset();

      const state = useServerDetailStore.getState();
      expect(state.server).toBeNull();
      expect(state.profile).toBeNull();
      expect(state.metrics).toBeNull();
      expect(state.metricsHistory).toEqual([]);
      expect(state.metricsRange).toBe('1h');
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
    });

    it('aborts active stream on reset', () => {
      useServerDetailStore.getState().startMetricsStream('srv-1');
      useServerDetailStore.getState().reset();

      expect(mockAbort).toHaveBeenCalled();
    });
  });

  describe('startMetricsStream', () => {
    it('creates SSE connection with correct path', () => {
      useServerDetailStore.getState().startMetricsStream('srv-1');

      expect(mockCreateMetricsSSE).toHaveBeenCalledWith(
        '/metrics/stream?serverId=srv-1',
        expect.objectContaining({
          onMetric: expect.any(Function),
          onError: expect.any(Function),
        }),
      );
    });

    it('sets isStreaming to true', () => {
      useServerDetailStore.getState().startMetricsStream('srv-1');
      expect(useServerDetailStore.getState().isStreaming).toBe(true);
    });

    it('aborts previous stream when starting a new one', () => {
      useServerDetailStore.getState().startMetricsStream('srv-1');
      const firstAbort = mockAbort;

      const secondAbort = vi.fn();
      mockCreateMetricsSSE.mockReturnValueOnce({ abort: secondAbort });

      useServerDetailStore.getState().startMetricsStream('srv-2');

      expect(firstAbort).toHaveBeenCalled();
    });

    it('appends incoming metric and updates latest metrics', () => {
      useServerDetailStore.getState().startMetricsStream('srv-1');

      // Get the onMetric callback
      const calls = mockCreateMetricsSSE.mock.calls;
      const callbacks = calls[0][1];

      const newMetric = {
        id: 'm-3',
        serverId: 'srv-1',
        cpuUsage: 65.0,
        memoryUsage: 5368709120,
        memoryTotal: 8589934592,
        diskUsage: 53687091200,
        diskTotal: 107374182400,
        networkIn: 2097152,
        networkOut: 1048576,
        timestamp: new Date().toISOString(),
      };

      callbacks.onMetric!(JSON.stringify(newMetric));

      const state = useServerDetailStore.getState();
      expect(state.metricsHistory).toContainEqual(newMetric);
      expect(state.metrics?.cpuUsage).toBe(65.0);
      expect(state.metrics?.memoryUsage).toBe(5368709120);
    });

    it('trims old metrics outside the sliding window', () => {
      // Set range to 1h and pre-populate with old data
      useServerDetailStore.setState({
        metricsRange: '1h',
        metricsHistory: [
          {
            id: 'm-old',
            serverId: 'srv-1',
            cpuUsage: 10,
            memoryUsage: 1024,
            memoryTotal: 8192,
            diskUsage: 5000,
            diskTotal: 10000,
            networkIn: 100,
            networkOut: 200,
            timestamp: '2020-01-01T00:00:00Z', // very old
          },
        ],
      });

      useServerDetailStore.getState().startMetricsStream('srv-1');

      const calls = mockCreateMetricsSSE.mock.calls;
      const callbacks = calls[0][1];

      const freshMetric = {
        id: 'm-new',
        serverId: 'srv-1',
        cpuUsage: 50,
        memoryUsage: 4096,
        memoryTotal: 8192,
        diskUsage: 5000,
        diskTotal: 10000,
        networkIn: 500,
        networkOut: 600,
        timestamp: new Date().toISOString(),
      };

      callbacks.onMetric!(JSON.stringify(freshMetric));

      const history = useServerDetailStore.getState().metricsHistory;
      // Old metric should be filtered out
      expect(history.find(m => m.id === 'm-old')).toBeUndefined();
      expect(history.find(m => m.id === 'm-new')).toBeDefined();
    });

    it('encodes serverId in the URL', () => {
      useServerDetailStore.getState().startMetricsStream('srv with spaces');

      expect(mockCreateMetricsSSE).toHaveBeenCalledWith(
        '/metrics/stream?serverId=srv%20with%20spaces',
        expect.any(Object),
      );
    });
  });

  describe('stopMetricsStream', () => {
    it('aborts active stream', () => {
      useServerDetailStore.getState().startMetricsStream('srv-1');
      useServerDetailStore.getState().stopMetricsStream();

      expect(mockAbort).toHaveBeenCalled();
    });

    it('sets isStreaming to false', () => {
      useServerDetailStore.getState().startMetricsStream('srv-1');
      expect(useServerDetailStore.getState().isStreaming).toBe(true);

      useServerDetailStore.getState().stopMetricsStream();
      expect(useServerDetailStore.getState().isStreaming).toBe(false);
    });
  });
});
