// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { create } from 'zustand';
import { apiRequest, ApiError } from '@/api/client';

export type AIProvider = 'claude' | 'openai' | 'ollama' | 'deepseek' | 'custom-openai';

export interface AIProviderConfig {
  provider: AIProvider;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
}

export interface UserProfile {
  name: string;
  email: string;
  timezone: string;
}

export interface NotificationPreferences {
  emailNotifications: boolean;
  taskCompletion: boolean;
  systemAlerts: boolean;
  operationReports: boolean;
}

export interface KnowledgeBaseConfig {
  autoLearning: boolean;
  documentSources: string[];
}

export interface SettingsData {
  aiProvider: AIProviderConfig;
  userProfile: UserProfile;
  notifications: NotificationPreferences;
  knowledgeBase: KnowledgeBaseConfig;
}

export interface ProviderHealthStatus {
  provider: AIProvider | null;
  available: boolean;
  tier?: 1 | 2 | 3;
  error?: string;
}

interface SettingsState {
  settings: SettingsData | null;
  isLoading: boolean;
  error: string | null;
  isSaving: boolean;
  healthStatus: ProviderHealthStatus | null;
  isCheckingHealth: boolean;
  fetchSettings: () => Promise<void>;
  updateAIProvider: (config: AIProviderConfig) => Promise<void>;
  updateUserProfile: (profile: UserProfile) => Promise<void>;
  updateNotifications: (prefs: NotificationPreferences) => Promise<void>;
  updateKnowledgeBase: (config: KnowledgeBaseConfig) => Promise<void>;
  checkProviderHealth: () => Promise<void>;
  clearError: () => void;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: null,
  isLoading: false,
  error: null,
  isSaving: false,
  healthStatus: null,
  isCheckingHealth: false,

  fetchSettings: async () => {
    set({ isLoading: true, error: null });
    try {
      const data = await apiRequest<SettingsData>('/settings');
      set({ settings: data, isLoading: false });
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : 'Failed to load settings';
      set({ error: message, isLoading: false });
    }
  },

  updateAIProvider: async (config: AIProviderConfig) => {
    set({ isSaving: true, error: null });
    try {
      const data = await apiRequest<SettingsData>('/settings/ai-provider', {
        method: 'PUT',
        body: JSON.stringify(config),
      });
      set({ settings: data, isSaving: false });
      // Auto-check health after provider switch
      get().checkProviderHealth();
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : 'Failed to update AI provider settings';
      set({ error: message, isSaving: false });
      throw err;
    }
  },

  updateUserProfile: async (profile: UserProfile) => {
    set({ isSaving: true, error: null });
    try {
      const data = await apiRequest<SettingsData>('/settings/profile', {
        method: 'PUT',
        body: JSON.stringify(profile),
      });
      set({ settings: data, isSaving: false });
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : 'Failed to update profile';
      set({ error: message, isSaving: false });
      throw err;
    }
  },

  updateNotifications: async (prefs: NotificationPreferences) => {
    set({ isSaving: true, error: null });
    try {
      const data = await apiRequest<SettingsData>('/settings/notifications', {
        method: 'PUT',
        body: JSON.stringify(prefs),
      });
      set({ settings: data, isSaving: false });
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : 'Failed to update notification preferences';
      set({ error: message, isSaving: false });
      throw err;
    }
  },

  updateKnowledgeBase: async (config: KnowledgeBaseConfig) => {
    set({ isSaving: true, error: null });
    try {
      const data = await apiRequest<SettingsData>('/settings/knowledge-base', {
        method: 'PUT',
        body: JSON.stringify(config),
      });
      set({ settings: data, isSaving: false });
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : 'Failed to update knowledge base settings';
      set({ error: message, isSaving: false });
      throw err;
    }
  },

  checkProviderHealth: async () => {
    set({ isCheckingHealth: true });
    try {
      const data = await apiRequest<ProviderHealthStatus>(
        '/settings/ai-provider/health'
      );
      set({ healthStatus: data, isCheckingHealth: false });
    } catch {
      set({
        healthStatus: { provider: null, available: false, error: 'Health check failed' },
        isCheckingHealth: false,
      });
    }
  },

  clearError: () => set({ error: null }),
}));
