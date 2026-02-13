// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  useNotificationHistoryStore,
  getUnreadCount,
  getFilteredItems,
} from './notification-history';
import type { NotificationItem } from '@/types/notification-history';

vi.mock('@/api/client', () => ({
  apiRequest: vi.fn(),
  ApiError: class extends Error {
    status: number;
    code: string;
    constructor(status: number, code: string, message: string) {
      super(message);
      this.status = status;
      this.code = code;
    }
  },
}));

const { apiRequest } = await import('@/api/client');
const mockApiRequest = vi.mocked(apiRequest);

const mockItems: NotificationItem[] = [
  {
    id: 'alert-1',
    category: 'alert',
    title: 'CPU Alert',
    message: 'CPU usage above 90%',
    timestamp: '2026-02-13T10:00:00Z',
    read: false,
    severity: 'critical',
  },
  {
    id: 'webhook-1',
    category: 'webhook',
    title: 'Webhook: task.completed',
    message: 'Delivery delivered (1 attempt)',
    timestamp: '2026-02-13T09:00:00Z',
    read: true,
  },
  {
    id: 'alert-2',
    category: 'alert',
    title: 'DISK Alert',
    message: 'Disk usage above 80%',
    timestamp: '2026-02-13T08:00:00Z',
    read: false,
    severity: 'warning',
  },
];

function resetStore(overrides: Partial<ReturnType<typeof useNotificationHistoryStore.getState>> = {}) {
  useNotificationHistoryStore.setState({
    items: [],
    isLoading: false,
    error: null,
    filter: 'all',
    readIds: new Set(),
    ...overrides,
  });
}

describe('useNotificationHistoryStore', () => {
  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();
    localStorage.clear();
  });

  describe('fetchNotifications', () => {
    it('fetches and merges alerts and deliveries', async () => {
      mockApiRequest.mockResolvedValueOnce({
        alerts: [
          {
            id: 'a1',
            serverId: 's1',
            type: 'cpu',
            severity: 'critical',
            message: 'High CPU',
            resolved: false,
            createdAt: '2026-02-13T10:00:00Z',
          },
        ],
        total: 1,
      }).mockResolvedValueOnce({
        deliveries: [
          {
            id: 'd1',
            webhookId: 'wh1',
            eventType: 'task.completed',
            payload: {},
            status: 'success',
            httpStatus: 200,
            responseBody: null,
            attempts: 1,
            lastAttemptAt: null,
            nextRetryAt: null,
            createdAt: '2026-02-13T09:00:00Z',
          },
        ],
        total: 1,
      });

      await useNotificationHistoryStore.getState().fetchNotifications();

      const { items, isLoading } = useNotificationHistoryStore.getState();
      expect(isLoading).toBe(false);
      expect(items).toHaveLength(2);
      expect(items[0].id).toBe('alert-a1');
      expect(items[1].id).toBe('webhook-d1');
    });

    it('sets error on fetch failure', async () => {
      mockApiRequest.mockRejectedValueOnce(new Error('Network error'));

      await useNotificationHistoryStore.getState().fetchNotifications();

      const { error, isLoading } = useNotificationHistoryStore.getState();
      expect(isLoading).toBe(false);
      expect(error).toBe('Failed to load notifications');
    });

    it('sets isLoading while fetching', async () => {
      let resolvePromise: (v: unknown) => void;
      mockApiRequest.mockImplementation(() => new Promise((r) => { resolvePromise = r; }));

      const promise = useNotificationHistoryStore.getState().fetchNotifications();
      expect(useNotificationHistoryStore.getState().isLoading).toBe(true);

      resolvePromise!({ alerts: [], total: 0 });
      await promise;
    });
  });

  describe('markAsRead', () => {
    it('marks a single item as read', () => {
      resetStore({ items: [...mockItems] });

      useNotificationHistoryStore.getState().markAsRead('alert-1');

      const { items, readIds } = useNotificationHistoryStore.getState();
      expect(items[0].read).toBe(true);
      expect(readIds.has('alert-1')).toBe(true);
    });

    it('persists read state to localStorage', () => {
      resetStore({ items: [...mockItems] });

      useNotificationHistoryStore.getState().markAsRead('alert-1');

      const stored = JSON.parse(localStorage.getItem('serverpilot_read_notifications') ?? '[]');
      expect(stored).toContain('alert-1');
    });
  });

  describe('markAllAsRead', () => {
    it('marks all items as read', () => {
      resetStore({ items: [...mockItems] });

      useNotificationHistoryStore.getState().markAllAsRead();

      const { items } = useNotificationHistoryStore.getState();
      expect(items.every((i) => i.read)).toBe(true);
    });

    it('persists all ids to localStorage', () => {
      resetStore({ items: [...mockItems] });

      useNotificationHistoryStore.getState().markAllAsRead();

      const stored = JSON.parse(localStorage.getItem('serverpilot_read_notifications') ?? '[]');
      expect(stored).toHaveLength(3);
    });
  });

  describe('setFilter', () => {
    it('updates the filter', () => {
      useNotificationHistoryStore.getState().setFilter('alert');
      expect(useNotificationHistoryStore.getState().filter).toBe('alert');
    });
  });

  describe('clearError', () => {
    it('clears the error', () => {
      resetStore({ error: 'something failed' });
      useNotificationHistoryStore.getState().clearError();
      expect(useNotificationHistoryStore.getState().error).toBeNull();
    });
  });

  describe('getUnreadCount', () => {
    it('returns number of unread items', () => {
      resetStore({ items: [...mockItems] });
      const state = useNotificationHistoryStore.getState();
      expect(getUnreadCount(state)).toBe(2);
    });

    it('returns 0 when all are read', () => {
      const allRead = mockItems.map((i) => ({ ...i, read: true }));
      resetStore({ items: allRead });
      expect(getUnreadCount(useNotificationHistoryStore.getState())).toBe(0);
    });
  });

  describe('getFilteredItems', () => {
    it('returns all items when filter is all', () => {
      resetStore({ items: [...mockItems], filter: 'all' });
      const result = getFilteredItems(useNotificationHistoryStore.getState());
      expect(result).toHaveLength(3);
    });

    it('returns only alert items when filter is alert', () => {
      resetStore({ items: [...mockItems], filter: 'alert' });
      const result = getFilteredItems(useNotificationHistoryStore.getState());
      expect(result).toHaveLength(2);
      expect(result.every((i) => i.category === 'alert')).toBe(true);
    });

    it('returns only webhook items when filter is webhook', () => {
      resetStore({ items: [...mockItems], filter: 'webhook' });
      const result = getFilteredItems(useNotificationHistoryStore.getState());
      expect(result).toHaveLength(1);
      expect(result[0].category).toBe('webhook');
    });
  });
});
