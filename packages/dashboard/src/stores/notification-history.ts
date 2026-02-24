// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { create } from "zustand";

import { apiRequest, ApiError } from "@/api/client";
import type { Alert, AlertsResponse } from "@/types/dashboard";
import type { WebhookDelivery, DeliveriesResponse } from "@/types/webhook";
import type {
  NotificationItem,
  NotificationCategory,
} from "@/types/notification-history";

const STORAGE_KEY = "serverpilot_read_notifications";

function loadReadIds(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) return new Set(parsed as string[]);
    return new Set();
  } catch {
    return new Set();
  }
}

function saveReadIds(ids: Set<string>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    // localStorage unavailable
  }
}

function alertToNotification(
  alert: Alert,
  readIds: Set<string>,
): NotificationItem {
  return {
    id: `alert-${alert.id}`,
    category: "alert",
    title: `${alert.type.toUpperCase()} Alert`,
    message: alert.message,
    timestamp: alert.createdAt,
    read: readIds.has(`alert-${alert.id}`),
    severity: alert.severity,
    meta: {
      serverId: alert.serverId,
      ...(alert.serverName ? { serverName: alert.serverName } : {}),
    },
  };
}

function deliveryToNotification(
  delivery: WebhookDelivery,
  readIds: Set<string>,
): NotificationItem {
  const statusLabel =
    delivery.status === "success" ? "delivered" : delivery.status;
  return {
    id: `webhook-${delivery.id}`,
    category: "webhook",
    title: `Webhook: ${delivery.eventType}`,
    message: `Delivery ${statusLabel} (${delivery.attempts} attempt${delivery.attempts !== 1 ? "s" : ""})`,
    timestamp: delivery.createdAt,
    read: readIds.has(`webhook-${delivery.id}`),
    severity: delivery.status === "failed" ? "warning" : "info",
    meta: { webhookId: delivery.webhookId },
  };
}

interface NotificationHistoryState {
  items: NotificationItem[];
  isLoading: boolean;
  error: string | null;
  filter: NotificationCategory | "all";
  readIds: Set<string>;
  _isFetching: boolean; // Internal flag to prevent concurrent fetches

  fetchNotifications: () => Promise<void>;
  setFilter: (filter: NotificationCategory | "all") => void;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  clearError: () => void;
}

export const useNotificationHistoryStore = create<NotificationHistoryState>(
  (set, get) => ({
    items: [],
    isLoading: false,
    error: null,
    filter: "all",
    readIds: loadReadIds(),
    _isFetching: false,

    fetchNotifications: async () => {
      // Prevent concurrent fetches
      const state = get();
      if (state._isFetching) {
        return;
      }

      set({ isLoading: true, error: null, _isFetching: true });
      try {
        // Fetch alerts and webhooks separately with graceful degradation
        // If either fails with 404 (feature not configured), continue with empty array
        const alertsPromise = apiRequest<AlertsResponse>(
          "/alerts?limit=50&offset=0",
        ).catch((err) => {
          if (err instanceof ApiError && err.status === 404) {
            return { alerts: [], total: 0 };
          }
          throw err;
        });

        const deliveriesPromise = apiRequest<DeliveriesResponse>(
          "/webhooks/deliveries?limit=50",
        ).catch((err) => {
          if (err instanceof ApiError && err.status === 404) {
            return { deliveries: [], total: 0 };
          }
          throw err;
        });

        const [alertsData, deliveriesData] = await Promise.all([
          alertsPromise,
          deliveriesPromise,
        ]);

        const readIds = get().readIds;
        const alertItems = alertsData.alerts.map((a) =>
          alertToNotification(a, readIds),
        );
        const deliveryItems = deliveriesData.deliveries.map((d) =>
          deliveryToNotification(d, readIds),
        );

        const merged = [...alertItems, ...deliveryItems].sort(
          (a, b) =>
            new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
        );

        set({ items: merged, isLoading: false, _isFetching: false });
      } catch (err) {
        const message =
          err instanceof ApiError
            ? err.message
            : "Failed to load notifications";
        set({ error: message, isLoading: false, _isFetching: false });
      }
    },

    setFilter: (filter) => set({ filter }),

    markAsRead: (id) => {
      const readIds = new Set(get().readIds);
      readIds.add(id);
      saveReadIds(readIds);
      set({
        readIds,
        items: get().items.map((item) =>
          item.id === id ? { ...item, read: true } : item,
        ),
      });
    },

    markAllAsRead: () => {
      const readIds = new Set(get().readIds);
      for (const item of get().items) {
        readIds.add(item.id);
      }
      saveReadIds(readIds);
      set({
        readIds,
        items: get().items.map((item) => ({ ...item, read: true })),
      });
    },

    clearError: () => set({ error: null }),
  }),
);

export function getUnreadCount(state: NotificationHistoryState): number {
  return state.items.filter((item) => !item.read).length;
}

export function getFilteredItems(
  state: NotificationHistoryState,
): NotificationItem[] {
  if (state.filter === "all") return state.items;
  return state.items.filter((item) => item.category === state.filter);
}
