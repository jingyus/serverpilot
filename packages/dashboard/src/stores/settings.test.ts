// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useSettingsStore } from './settings';

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
  setToken: vi.fn(),
  clearToken: vi.fn(),
}));

describe('useSettingsStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSettingsStore.setState({
      settings: null,
      isLoading: false,
      error: null,
      isSaving: false,
      healthStatus: null,
      isCheckingHealth: false,
    });
  });

  describe('fetchSettings', () => {
    it('should fetch settings successfully', async () => {
      const mockSettings = {
        aiProvider: {
          provider: 'claude' as const,
          apiKey: 'sk-test',
          model: 'claude-3-opus-20240229',
        },
        userProfile: {
          name: 'Test User',
          email: 'test@example.com',
          timezone: 'UTC',
        },
        notifications: {
          emailNotifications: true,
          taskCompletion: true,
          systemAlerts: true,
          operationReports: false,
        },
        knowledgeBase: {
          autoLearning: false,
          documentSources: [],
        },
      };

      mockApiRequest.mockResolvedValueOnce(mockSettings);

      const { fetchSettings } = useSettingsStore.getState();
      await fetchSettings();

      const state = useSettingsStore.getState();
      expect(state.settings).toEqual(mockSettings);
      expect(state.isLoading).toBe(false);
      expect(state.error).toBe(null);
    });

    it('should handle fetch error', async () => {
      const { ApiError } = await import('@/api/client');
      const error = new ApiError(500, 'SERVER_ERROR', 'Internal server error');
      mockApiRequest.mockRejectedValueOnce(error);

      const { fetchSettings } = useSettingsStore.getState();
      await fetchSettings();

      const state = useSettingsStore.getState();
      expect(state.settings).toBe(null);
      expect(state.isLoading).toBe(false);
      expect(state.error).toBe('Internal server error');
    });
  });

  describe('updateAIProvider', () => {
    it('should update AI provider settings', async () => {
      const mockSettings = {
        aiProvider: {
          provider: 'openai' as const,
          apiKey: 'sk-new',
        },
        userProfile: {
          name: 'Test',
          email: 'test@test.com',
          timezone: 'UTC',
        },
        notifications: {
          emailNotifications: true,
          taskCompletion: true,
          systemAlerts: true,
          operationReports: false,
        },
        knowledgeBase: {
          autoLearning: false,
          documentSources: [],
        },
      };

      mockApiRequest.mockResolvedValueOnce(mockSettings);

      const { updateAIProvider } = useSettingsStore.getState();
      await updateAIProvider({
        provider: 'openai',
        apiKey: 'sk-new',
      });

      const state = useSettingsStore.getState();
      expect(state.settings?.aiProvider.provider).toBe('openai');
      expect(state.isSaving).toBe(false);
    });

    it('should handle update error', async () => {
      const { ApiError } = await import('@/api/client');
      const error = new ApiError(400, 'INVALID_API_KEY', 'Invalid API key');
      mockApiRequest.mockRejectedValueOnce(error);

      const { updateAIProvider } = useSettingsStore.getState();

      try {
        await updateAIProvider({
          provider: 'claude',
          apiKey: 'invalid',
        });
      } catch {
        // Error is expected and caught
      }

      const state = useSettingsStore.getState();
      expect(state.error).toBe('Invalid API key');
      expect(state.isSaving).toBe(false);
    });
  });

  describe('updateUserProfile', () => {
    it('should update user profile', async () => {
      const mockSettings = {
        aiProvider: {
          provider: 'claude' as const,
        },
        userProfile: {
          name: 'Updated Name',
          email: 'updated@test.com',
          timezone: 'America/New_York',
        },
        notifications: {
          emailNotifications: true,
          taskCompletion: true,
          systemAlerts: true,
          operationReports: false,
        },
        knowledgeBase: {
          autoLearning: false,
          documentSources: [],
        },
      };

      mockApiRequest.mockResolvedValueOnce(mockSettings);

      const { updateUserProfile } = useSettingsStore.getState();
      await updateUserProfile({
        name: 'Updated Name',
        email: 'updated@test.com',
        timezone: 'America/New_York',
      });

      const state = useSettingsStore.getState();
      expect(state.settings?.userProfile.name).toBe('Updated Name');
    });
  });

  describe('updateNotifications', () => {
    it('should update notification preferences', async () => {
      const mockSettings = {
        aiProvider: {
          provider: 'claude' as const,
        },
        userProfile: {
          name: 'Test',
          email: 'test@test.com',
          timezone: 'UTC',
        },
        notifications: {
          emailNotifications: false,
          taskCompletion: false,
          systemAlerts: true,
          operationReports: true,
        },
        knowledgeBase: {
          autoLearning: false,
          documentSources: [],
        },
      };

      mockApiRequest.mockResolvedValueOnce(mockSettings);

      const { updateNotifications } = useSettingsStore.getState();
      await updateNotifications({
        emailNotifications: false,
        taskCompletion: false,
        systemAlerts: true,
        operationReports: true,
      });

      const state = useSettingsStore.getState();
      expect(state.settings?.notifications.emailNotifications).toBe(false);
      expect(state.settings?.notifications.operationReports).toBe(true);
    });
  });

  describe('updateKnowledgeBase', () => {
    it('should update knowledge base settings', async () => {
      const mockSettings = {
        aiProvider: {
          provider: 'claude' as const,
        },
        userProfile: {
          name: 'Test',
          email: 'test@test.com',
          timezone: 'UTC',
        },
        notifications: {
          emailNotifications: true,
          taskCompletion: true,
          systemAlerts: true,
          operationReports: false,
        },
        knowledgeBase: {
          autoLearning: true,
          documentSources: ['https://docs.example.com'],
        },
      };

      mockApiRequest.mockResolvedValueOnce(mockSettings);

      const { updateKnowledgeBase } = useSettingsStore.getState();
      await updateKnowledgeBase({
        autoLearning: true,
        documentSources: ['https://docs.example.com'],
      });

      const state = useSettingsStore.getState();
      expect(state.settings?.knowledgeBase.autoLearning).toBe(true);
    });
  });

  describe('checkProviderHealth', () => {
    it('should fetch provider health status', async () => {
      const mockHealth = {
        provider: 'claude' as const,
        available: true,
        tier: 1 as const,
      };

      mockApiRequest.mockResolvedValueOnce(mockHealth);

      const { checkProviderHealth } = useSettingsStore.getState();
      await checkProviderHealth();

      const state = useSettingsStore.getState();
      expect(state.healthStatus).toEqual(mockHealth);
      expect(state.isCheckingHealth).toBe(false);
      expect(mockApiRequest).toHaveBeenCalledWith('/settings/ai-provider/health');
    });

    it('should handle health check failure', async () => {
      mockApiRequest.mockRejectedValueOnce(new Error('Network error'));

      const { checkProviderHealth } = useSettingsStore.getState();
      await checkProviderHealth();

      const state = useSettingsStore.getState();
      expect(state.healthStatus).toEqual({
        provider: null,
        available: false,
        error: 'Health check failed',
      });
      expect(state.isCheckingHealth).toBe(false);
    });
  });

  describe('updateAIProvider with health check', () => {
    it('should auto-check health after successful provider update', async () => {
      const mockSettings = {
        aiProvider: { provider: 'deepseek' as const, apiKey: 'sk-ds-test' },
        userProfile: { name: 'Test', email: 'test@test.com', timezone: 'UTC' },
        notifications: {
          emailNotifications: true,
          taskCompletion: true,
          systemAlerts: true,
          operationReports: false,
        },
        knowledgeBase: { autoLearning: false, documentSources: [] },
      };

      const mockHealth = {
        provider: 'deepseek' as const,
        available: true,
        tier: 2 as const,
      };

      // First call: updateAIProvider, second call: checkProviderHealth
      mockApiRequest
        .mockResolvedValueOnce(mockSettings)
        .mockResolvedValueOnce(mockHealth);

      const { updateAIProvider } = useSettingsStore.getState();
      await updateAIProvider({ provider: 'deepseek', apiKey: 'sk-ds-test' });

      const state = useSettingsStore.getState();
      expect(state.settings?.aiProvider.provider).toBe('deepseek');

      // Wait for the async health check triggered by updateAIProvider
      await vi.waitFor(() => {
        expect(mockApiRequest).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe('updateAIProvider with custom-openai', () => {
    it('should update to custom-openai with baseUrl, apiKey, and model', async () => {
      const mockSettings = {
        aiProvider: {
          provider: 'custom-openai' as const,
          apiKey: 'sk-custom-key',
          model: 'gpt-4o',
          baseUrl: 'https://api.example.com/v1',
        },
        userProfile: { name: 'Test', email: 'test@test.com', timezone: 'UTC' },
        notifications: {
          emailNotifications: true,
          taskCompletion: true,
          systemAlerts: true,
          operationReports: false,
        },
        knowledgeBase: { autoLearning: false, documentSources: [] },
      };

      const mockHealth = {
        provider: 'custom-openai' as const,
        available: true,
        tier: 2 as const,
      };

      mockApiRequest
        .mockResolvedValueOnce(mockSettings)
        .mockResolvedValueOnce(mockHealth);

      const { updateAIProvider } = useSettingsStore.getState();
      await updateAIProvider({
        provider: 'custom-openai',
        apiKey: 'sk-custom-key',
        model: 'gpt-4o',
        baseUrl: 'https://api.example.com/v1',
      });

      const state = useSettingsStore.getState();
      expect(state.settings?.aiProvider.provider).toBe('custom-openai');
      expect(state.settings?.aiProvider.baseUrl).toBe('https://api.example.com/v1');
      expect(state.settings?.aiProvider.model).toBe('gpt-4o');
      expect(state.isSaving).toBe(false);

      expect(mockApiRequest).toHaveBeenCalledWith('/settings/ai-provider', {
        method: 'PUT',
        body: JSON.stringify({
          provider: 'custom-openai',
          apiKey: 'sk-custom-key',
          model: 'gpt-4o',
          baseUrl: 'https://api.example.com/v1',
        }),
      });
    });
  });

  describe('clearError', () => {
    it('should clear error message', () => {
      useSettingsStore.setState({ error: 'Test error' });

      const { clearError } = useSettingsStore.getState();
      clearError();

      const state = useSettingsStore.getState();
      expect(state.error).toBe(null);
    });
  });
});
