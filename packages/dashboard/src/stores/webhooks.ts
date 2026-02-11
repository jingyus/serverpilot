// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { create } from 'zustand';
import { apiRequest, ApiError } from '@/api/client';
import type { Webhook, WebhooksResponse, WebhookResponse, WebhookEventType } from '@/types/webhook';

interface WebhooksState {
  webhooks: Webhook[];
  isLoading: boolean;
  error: string | null;

  fetchWebhooks: () => Promise<void>;
  createWebhook: (name: string, url: string, events: WebhookEventType[]) => Promise<Webhook>;
  updateWebhook: (id: string, data: Partial<Pick<Webhook, 'name' | 'url' | 'events' | 'enabled' | 'secret'>>) => Promise<void>;
  deleteWebhook: (id: string) => Promise<void>;
  testWebhook: (id: string, eventType: WebhookEventType) => Promise<void>;
  clearError: () => void;
}

export const useWebhooksStore = create<WebhooksState>((set, get) => ({
  webhooks: [],
  isLoading: false,
  error: null,

  fetchWebhooks: async () => {
    set({ isLoading: true, error: null });
    try {
      const data = await apiRequest<WebhooksResponse>('/webhooks');
      set({ webhooks: data.webhooks, isLoading: false });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to load webhooks';
      set({ error: message, isLoading: false });
    }
  },

  createWebhook: async (name, url, events) => {
    set({ error: null });
    try {
      const data = await apiRequest<WebhookResponse>('/webhooks', {
        method: 'POST',
        body: JSON.stringify({ name, url, events }),
      });
      set({ webhooks: [...get().webhooks, data.webhook] });
      return data.webhook;
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to create webhook';
      set({ error: message });
      throw err;
    }
  },

  updateWebhook: async (id, data) => {
    set({ error: null });
    try {
      const resp = await apiRequest<WebhookResponse>(`/webhooks/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      });
      set({
        webhooks: get().webhooks.map((w) => (w.id === id ? resp.webhook : w)),
      });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to update webhook';
      set({ error: message });
      throw err;
    }
  },

  deleteWebhook: async (id) => {
    set({ error: null });
    try {
      await apiRequest(`/webhooks/${id}`, { method: 'DELETE' });
      set({ webhooks: get().webhooks.filter((w) => w.id !== id) });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to delete webhook';
      set({ error: message });
      throw err;
    }
  },

  testWebhook: async (id, eventType) => {
    set({ error: null });
    try {
      await apiRequest(`/webhooks/${id}/test`, {
        method: 'POST',
        body: JSON.stringify({ eventType }),
      });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to send test event';
      set({ error: message });
      throw err;
    }
  },

  clearError: () => set({ error: null }),
}));
