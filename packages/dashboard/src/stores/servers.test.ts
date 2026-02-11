// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useServersStore } from './servers';

const mockServers = [
  {
    id: 'srv-1',
    name: 'web-prod-01',
    status: 'online' as const,
    tags: ['production', 'web'],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-15T00:00:00Z',
    osInfo: { platform: 'linux', arch: 'x64', version: 'Ubuntu 22.04', kernel: '5.15', hostname: 'web-prod-01', uptime: 86400 },
    lastSeen: '2026-02-09T12:00:00Z',
  },
  {
    id: 'srv-2',
    name: 'db-prod-01',
    status: 'offline' as const,
    tags: ['production', 'database'],
    createdAt: '2026-01-02T00:00:00Z',
    updatedAt: '2026-01-16T00:00:00Z',
    osInfo: null,
    lastSeen: null,
  },
];

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

import { apiRequest, ApiError } from '@/api/client';
const mockApiRequest = vi.mocked(apiRequest);

describe('useServersStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useServersStore.setState({
      servers: [],
      isLoading: false,
      error: null,
      statusFilter: 'all',
      searchQuery: '',
      groupFilter: 'all',
      tagFilter: 'all',
    });
  });

  describe('fetchServers', () => {
    it('fetches and stores servers', async () => {
      mockApiRequest.mockResolvedValueOnce({ servers: mockServers, total: 2 });

      await useServersStore.getState().fetchServers();

      expect(mockApiRequest).toHaveBeenCalledWith('/servers');
      expect(useServersStore.getState().servers).toEqual(mockServers);
      expect(useServersStore.getState().isLoading).toBe(false);
    });

    it('sets loading state during fetch', async () => {
      let resolvePromise: (value: unknown) => void;
      const pending = new Promise((resolve) => { resolvePromise = resolve; });
      mockApiRequest.mockReturnValueOnce(pending as Promise<unknown>);

      const fetchPromise = useServersStore.getState().fetchServers();
      expect(useServersStore.getState().isLoading).toBe(true);

      resolvePromise!({ servers: [], total: 0 });
      await fetchPromise;
      expect(useServersStore.getState().isLoading).toBe(false);
    });

    it('handles fetch error', async () => {
      mockApiRequest.mockRejectedValueOnce(new Error('Network error'));

      await useServersStore.getState().fetchServers();

      expect(useServersStore.getState().error).toBe('Failed to load servers');
      expect(useServersStore.getState().isLoading).toBe(false);
    });

    it('handles ApiError with custom message', async () => {
      mockApiRequest.mockRejectedValueOnce(
        new ApiError(500, 'SERVER_ERROR', 'Internal server error')
      );

      await useServersStore.getState().fetchServers();

      expect(useServersStore.getState().error).toBe('Internal server error');
    });
  });

  describe('addServer', () => {
    it('adds server and returns response', async () => {
      const response = {
        server: mockServers[0],
        token: 'tok-abc123',
        installCommand: 'curl -sSL https://install.serverpilot.dev | bash -s tok-abc123',
      };
      mockApiRequest.mockResolvedValueOnce(response);

      const result = await useServersStore.getState().addServer('web-prod-01');

      expect(mockApiRequest).toHaveBeenCalledWith('/servers', {
        method: 'POST',
        body: JSON.stringify({ name: 'web-prod-01', tags: undefined }),
      });
      expect(result).toEqual(response);
      expect(useServersStore.getState().servers).toHaveLength(1);
    });

    it('appends new server to existing list', async () => {
      useServersStore.setState({ servers: [mockServers[0]] });
      const response = {
        server: mockServers[1],
        token: 'tok-def456',
        installCommand: 'curl ...',
      };
      mockApiRequest.mockResolvedValueOnce(response);

      await useServersStore.getState().addServer('db-prod-01');

      expect(useServersStore.getState().servers).toHaveLength(2);
    });

    it('handles add error', async () => {
      mockApiRequest.mockRejectedValueOnce(new Error('Failed'));

      await expect(
        useServersStore.getState().addServer('test')
      ).rejects.toThrow('Failed');
      expect(useServersStore.getState().error).toBe('Failed to add server');
    });
  });

  describe('deleteServer', () => {
    it('removes server from list', async () => {
      useServersStore.setState({ servers: [...mockServers] });
      mockApiRequest.mockResolvedValueOnce(undefined);

      await useServersStore.getState().deleteServer('srv-1');

      expect(mockApiRequest).toHaveBeenCalledWith('/servers/srv-1', { method: 'DELETE' });
      expect(useServersStore.getState().servers).toHaveLength(1);
      expect(useServersStore.getState().servers[0].id).toBe('srv-2');
    });

    it('handles delete error', async () => {
      useServersStore.setState({ servers: [...mockServers] });
      mockApiRequest.mockRejectedValueOnce(new Error('Failed'));

      await expect(
        useServersStore.getState().deleteServer('srv-1')
      ).rejects.toThrow('Failed');
      expect(useServersStore.getState().error).toBe('Failed to delete server');
      expect(useServersStore.getState().servers).toHaveLength(2);
    });
  });

  describe('updateServer', () => {
    it('updates server and replaces in list', async () => {
      useServersStore.setState({ servers: [...mockServers] });
      const updatedServer = { ...mockServers[0], name: 'renamed', group: 'staging' };
      mockApiRequest.mockResolvedValueOnce({ server: updatedServer });

      const result = await useServersStore.getState().updateServer('srv-1', {
        name: 'renamed',
        group: 'staging',
      });

      expect(mockApiRequest).toHaveBeenCalledWith('/servers/srv-1', {
        method: 'PATCH',
        body: JSON.stringify({ name: 'renamed', group: 'staging' }),
      });
      expect(result).toEqual(updatedServer);
      expect(useServersStore.getState().servers[0].name).toBe('renamed');
      expect(useServersStore.getState().servers[0].group).toBe('staging');
    });

    it('updates server tags', async () => {
      useServersStore.setState({ servers: [...mockServers] });
      const updatedServer = { ...mockServers[0], tags: ['web', 'v2'] };
      mockApiRequest.mockResolvedValueOnce({ server: updatedServer });

      await useServersStore.getState().updateServer('srv-1', {
        tags: ['web', 'v2'],
      });

      expect(useServersStore.getState().servers[0].tags).toEqual(['web', 'v2']);
    });

    it('handles update error', async () => {
      useServersStore.setState({ servers: [...mockServers] });
      mockApiRequest.mockRejectedValueOnce(new Error('Failed'));

      await expect(
        useServersStore.getState().updateServer('srv-1', { name: 'new' })
      ).rejects.toThrow('Failed');
      expect(useServersStore.getState().error).toBe('Failed to update server');
    });

    it('handles ApiError on update', async () => {
      useServersStore.setState({ servers: [...mockServers] });
      mockApiRequest.mockRejectedValueOnce(
        new ApiError(404, 'NOT_FOUND', 'Server not found')
      );

      await expect(
        useServersStore.getState().updateServer('srv-1', { name: 'new' })
      ).rejects.toThrow();
      expect(useServersStore.getState().error).toBe('Server not found');
    });
  });

  describe('filters', () => {
    it('sets status filter', () => {
      useServersStore.getState().setStatusFilter('online');
      expect(useServersStore.getState().statusFilter).toBe('online');
    });

    it('sets search query', () => {
      useServersStore.getState().setSearchQuery('web');
      expect(useServersStore.getState().searchQuery).toBe('web');
    });

    it('sets group filter', () => {
      useServersStore.getState().setGroupFilter('production');
      expect(useServersStore.getState().groupFilter).toBe('production');
    });

    it('sets tag filter', () => {
      useServersStore.getState().setTagFilter('web');
      expect(useServersStore.getState().tagFilter).toBe('web');
    });

    it('resets group filter to all', () => {
      useServersStore.setState({ groupFilter: 'production' });
      useServersStore.getState().setGroupFilter('all');
      expect(useServersStore.getState().groupFilter).toBe('all');
    });

    it('resets tag filter to all', () => {
      useServersStore.setState({ tagFilter: 'web' });
      useServersStore.getState().setTagFilter('all');
      expect(useServersStore.getState().tagFilter).toBe('all');
    });
  });

  describe('clearError', () => {
    it('clears error', () => {
      useServersStore.setState({ error: 'Some error' });
      useServersStore.getState().clearError();
      expect(useServersStore.getState().error).toBeNull();
    });
  });
});
