// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useWebhooksStore } from './webhooks';
import type { WebhookEventType } from '@/types/webhook';

// Mock the API client module
const mockApiRequest = vi.fn();
vi.mock('@/api/client', () => ({
  ApiError: class ApiError extends Error {
    constructor(public status: number, public code: string, message: string) {
      super(message);
      this.name = 'ApiError';
    }
  },
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
}));

const makeWebhook = (overrides: Record<string, unknown> = {}) => ({
  id: 'wh-1',
  userId: 'user-1',
  tenantId: 'tenant-1',
  name: 'My Webhook',
  url: 'https://example.com/hook',
  secret: '***',
  events: ['task.completed'] as WebhookEventType[],
  enabled: true,
  maxRetries: 3,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...overrides,
});

describe('useWebhooksStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useWebhooksStore.setState({
      webhooks: [],
      isLoading: false,
      error: null,
    });
  });

  describe('fetchWebhooks', () => {
    it('should fetch webhooks successfully and update state', async () => {
      const webhooks = [makeWebhook(), makeWebhook({ id: 'wh-2', name: 'Second' })];
      mockApiRequest.mockResolvedValueOnce({ webhooks, total: 2 });

      await useWebhooksStore.getState().fetchWebhooks();

      const state = useWebhooksStore.getState();
      expect(state.webhooks).toEqual(webhooks);
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
      expect(mockApiRequest).toHaveBeenCalledWith('/webhooks');
    });

    it('should set isLoading to true while fetching', async () => {
      let resolvePromise: (v: unknown) => void;
      const pendingPromise = new Promise((resolve) => {
        resolvePromise = resolve;
      });
      mockApiRequest.mockReturnValueOnce(pendingPromise);

      const fetchPromise = useWebhooksStore.getState().fetchWebhooks();

      expect(useWebhooksStore.getState().isLoading).toBe(true);

      resolvePromise!({ webhooks: [], total: 0 });
      await fetchPromise;

      expect(useWebhooksStore.getState().isLoading).toBe(false);
    });

    it('should handle ApiError on fetch', async () => {
      const { ApiError } = await import('@/api/client');
      mockApiRequest.mockRejectedValueOnce(
        new ApiError(500, 'INTERNAL_ERROR', 'Server exploded'),
      );

      await useWebhooksStore.getState().fetchWebhooks();

      const state = useWebhooksStore.getState();
      expect(state.error).toBe('Server exploded');
      expect(state.isLoading).toBe(false);
      expect(state.webhooks).toEqual([]);
    });

    it('should use fallback message for non-ApiError failures', async () => {
      mockApiRequest.mockRejectedValueOnce(new Error('Network error'));

      await useWebhooksStore.getState().fetchWebhooks();

      expect(useWebhooksStore.getState().error).toBe('Failed to load webhooks');
    });

    it('should clear previous error before fetching', async () => {
      useWebhooksStore.setState({ error: 'old error' });
      mockApiRequest.mockResolvedValueOnce({ webhooks: [], total: 0 });

      await useWebhooksStore.getState().fetchWebhooks();

      expect(useWebhooksStore.getState().error).toBeNull();
    });
  });

  describe('createWebhook', () => {
    it('should create a webhook and append it to the list', async () => {
      const existing = makeWebhook({ id: 'wh-existing' });
      useWebhooksStore.setState({ webhooks: [existing] });

      const newWebhook = makeWebhook({ id: 'wh-new', name: 'New Hook' });
      mockApiRequest.mockResolvedValueOnce({ webhook: newWebhook });

      const result = await useWebhooksStore.getState().createWebhook(
        'New Hook',
        'https://example.com/new',
        ['task.completed'],
      );

      expect(result).toEqual(newWebhook);
      expect(useWebhooksStore.getState().webhooks).toHaveLength(2);
      expect(useWebhooksStore.getState().webhooks[1]).toEqual(newWebhook);
      expect(mockApiRequest).toHaveBeenCalledWith('/webhooks', {
        method: 'POST',
        body: JSON.stringify({
          name: 'New Hook',
          url: 'https://example.com/new',
          events: ['task.completed'],
        }),
      });
    });

    it('should handle ApiError on create and re-throw', async () => {
      const { ApiError } = await import('@/api/client');
      const error = new ApiError(400, 'VALIDATION_ERROR', 'URL is invalid');
      mockApiRequest.mockRejectedValueOnce(error);

      await expect(
        useWebhooksStore.getState().createWebhook('Bad', 'not-a-url', ['task.completed']),
      ).rejects.toThrow();

      expect(useWebhooksStore.getState().error).toBe('URL is invalid');
    });

    it('should use fallback message for non-ApiError on create', async () => {
      mockApiRequest.mockRejectedValueOnce(new TypeError('fetch failed'));

      await expect(
        useWebhooksStore.getState().createWebhook('Test', 'https://x.com', ['task.completed']),
      ).rejects.toThrow();

      expect(useWebhooksStore.getState().error).toBe('Failed to create webhook');
    });
  });

  describe('updateWebhook', () => {
    it('should update an existing webhook in the list', async () => {
      const original = makeWebhook({ id: 'wh-1', name: 'Original' });
      useWebhooksStore.setState({ webhooks: [original] });

      const updated = makeWebhook({ id: 'wh-1', name: 'Updated', enabled: false });
      mockApiRequest.mockResolvedValueOnce({ webhook: updated });

      await useWebhooksStore.getState().updateWebhook('wh-1', {
        name: 'Updated',
        enabled: false,
      });

      const state = useWebhooksStore.getState();
      expect(state.webhooks).toHaveLength(1);
      expect(state.webhooks[0].name).toBe('Updated');
      expect(state.webhooks[0].enabled).toBe(false);
      expect(mockApiRequest).toHaveBeenCalledWith('/webhooks/wh-1', {
        method: 'PATCH',
        body: JSON.stringify({ name: 'Updated', enabled: false }),
      });
    });

    it('should not modify other webhooks when updating one', async () => {
      const wh1 = makeWebhook({ id: 'wh-1', name: 'First' });
      const wh2 = makeWebhook({ id: 'wh-2', name: 'Second' });
      useWebhooksStore.setState({ webhooks: [wh1, wh2] });

      const updatedWh1 = makeWebhook({ id: 'wh-1', name: 'First Updated' });
      mockApiRequest.mockResolvedValueOnce({ webhook: updatedWh1 });

      await useWebhooksStore.getState().updateWebhook('wh-1', { name: 'First Updated' });

      const state = useWebhooksStore.getState();
      expect(state.webhooks[0].name).toBe('First Updated');
      expect(state.webhooks[1]).toEqual(wh2);
    });

    it('should handle ApiError on update and re-throw', async () => {
      const { ApiError } = await import('@/api/client');
      useWebhooksStore.setState({ webhooks: [makeWebhook()] });
      mockApiRequest.mockRejectedValueOnce(
        new ApiError(404, 'NOT_FOUND', 'Webhook not found'),
      );

      await expect(
        useWebhooksStore.getState().updateWebhook('wh-1', { name: 'Fail' }),
      ).rejects.toThrow();

      expect(useWebhooksStore.getState().error).toBe('Webhook not found');
    });

    it('should use fallback message for non-ApiError on update', async () => {
      useWebhooksStore.setState({ webhooks: [makeWebhook()] });
      mockApiRequest.mockRejectedValueOnce(new Error('timeout'));

      await expect(
        useWebhooksStore.getState().updateWebhook('wh-1', { name: 'x' }),
      ).rejects.toThrow();

      expect(useWebhooksStore.getState().error).toBe('Failed to update webhook');
    });
  });

  describe('deleteWebhook', () => {
    it('should remove the webhook from the list', async () => {
      const wh1 = makeWebhook({ id: 'wh-1' });
      const wh2 = makeWebhook({ id: 'wh-2' });
      useWebhooksStore.setState({ webhooks: [wh1, wh2] });

      mockApiRequest.mockResolvedValueOnce(undefined);

      await useWebhooksStore.getState().deleteWebhook('wh-1');

      const state = useWebhooksStore.getState();
      expect(state.webhooks).toHaveLength(1);
      expect(state.webhooks[0].id).toBe('wh-2');
      expect(mockApiRequest).toHaveBeenCalledWith('/webhooks/wh-1', { method: 'DELETE' });
    });

    it('should handle ApiError on delete and re-throw', async () => {
      const { ApiError } = await import('@/api/client');
      useWebhooksStore.setState({ webhooks: [makeWebhook()] });
      mockApiRequest.mockRejectedValueOnce(
        new ApiError(403, 'FORBIDDEN', 'Not allowed'),
      );

      await expect(
        useWebhooksStore.getState().deleteWebhook('wh-1'),
      ).rejects.toThrow();

      expect(useWebhooksStore.getState().error).toBe('Not allowed');
    });

    it('should use fallback message for non-ApiError on delete', async () => {
      useWebhooksStore.setState({ webhooks: [makeWebhook()] });
      mockApiRequest.mockRejectedValueOnce(new Error('network'));

      await expect(
        useWebhooksStore.getState().deleteWebhook('wh-1'),
      ).rejects.toThrow();

      expect(useWebhooksStore.getState().error).toBe('Failed to delete webhook');
    });
  });

  describe('testWebhook', () => {
    it('should send a test event successfully', async () => {
      mockApiRequest.mockResolvedValueOnce(undefined);

      await useWebhooksStore.getState().testWebhook('wh-1', 'alert.triggered');

      expect(mockApiRequest).toHaveBeenCalledWith('/webhooks/wh-1/test', {
        method: 'POST',
        body: JSON.stringify({ eventType: 'alert.triggered' }),
      });
      expect(useWebhooksStore.getState().error).toBeNull();
    });

    it('should handle ApiError on test and re-throw', async () => {
      const { ApiError } = await import('@/api/client');
      mockApiRequest.mockRejectedValueOnce(
        new ApiError(502, 'BAD_GATEWAY', 'Target unreachable'),
      );

      await expect(
        useWebhooksStore.getState().testWebhook('wh-1', 'server.offline'),
      ).rejects.toThrow();

      expect(useWebhooksStore.getState().error).toBe('Target unreachable');
    });

    it('should use fallback message for non-ApiError on test', async () => {
      mockApiRequest.mockRejectedValueOnce(new Error('connection refused'));

      await expect(
        useWebhooksStore.getState().testWebhook('wh-1', 'task.completed'),
      ).rejects.toThrow();

      expect(useWebhooksStore.getState().error).toBe('Failed to send test event');
    });
  });

  describe('clearError', () => {
    it('should clear the error state', () => {
      useWebhooksStore.setState({ error: 'Some error message' });

      useWebhooksStore.getState().clearError();

      expect(useWebhooksStore.getState().error).toBeNull();
    });

    it('should be a no-op when error is already null', () => {
      useWebhooksStore.setState({ error: null });

      useWebhooksStore.getState().clearError();

      expect(useWebhooksStore.getState().error).toBeNull();
    });
  });
});
