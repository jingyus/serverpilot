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

const makeSettings = (overrides: Record<string, unknown> = {}) => ({
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
  ...overrides,
});

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
      const mockSettings = makeSettings();
      mockApiRequest.mockResolvedValueOnce(mockSettings);

      await useSettingsStore.getState().fetchSettings();

      const state = useSettingsStore.getState();
      expect(state.settings).toEqual(mockSettings);
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
      expect(mockApiRequest).toHaveBeenCalledWith('/settings');
    });

    it('should handle ApiError on fetch', async () => {
      const { ApiError } = await import('@/api/client');
      mockApiRequest.mockRejectedValueOnce(
        new ApiError(500, 'SERVER_ERROR', 'Internal server error'),
      );

      await useSettingsStore.getState().fetchSettings();

      const state = useSettingsStore.getState();
      expect(state.settings).toBeNull();
      expect(state.isLoading).toBe(false);
      expect(state.error).toBe('Internal server error');
    });

    it('should use fallback message for non-ApiError on fetch', async () => {
      mockApiRequest.mockRejectedValueOnce(new TypeError('Failed to fetch'));

      await useSettingsStore.getState().fetchSettings();

      expect(useSettingsStore.getState().error).toBe('Failed to load settings');
    });

    it('should set isLoading true during fetch and false after', async () => {
      let resolvePromise: (v: unknown) => void;
      const pendingPromise = new Promise((resolve) => {
        resolvePromise = resolve;
      });
      mockApiRequest.mockReturnValueOnce(pendingPromise);

      const fetchPromise = useSettingsStore.getState().fetchSettings();

      expect(useSettingsStore.getState().isLoading).toBe(true);
      expect(useSettingsStore.getState().error).toBeNull();

      resolvePromise!(makeSettings());
      await fetchPromise;

      expect(useSettingsStore.getState().isLoading).toBe(false);
    });

    it('should clear previous error before fetching', async () => {
      useSettingsStore.setState({ error: 'stale error' });
      mockApiRequest.mockResolvedValueOnce(makeSettings());

      await useSettingsStore.getState().fetchSettings();

      expect(useSettingsStore.getState().error).toBeNull();
    });
  });

  describe('updateAIProvider', () => {
    it('should update AI provider settings', async () => {
      const mockSettings = makeSettings({
        aiProvider: { provider: 'openai' as const, apiKey: 'sk-new' },
      });
      // First: update call, Second: auto health check
      mockApiRequest
        .mockResolvedValueOnce(mockSettings)
        .mockResolvedValueOnce({ provider: 'openai', available: true, tier: 2 });

      await useSettingsStore.getState().updateAIProvider({
        provider: 'openai',
        apiKey: 'sk-new',
      });

      const state = useSettingsStore.getState();
      expect(state.settings?.aiProvider.provider).toBe('openai');
      expect(state.isSaving).toBe(false);
      expect(mockApiRequest).toHaveBeenCalledWith('/settings/ai-provider', {
        method: 'PUT',
        body: JSON.stringify({ provider: 'openai', apiKey: 'sk-new' }),
      });
    });

    it('should handle ApiError on updateAIProvider and re-throw', async () => {
      const { ApiError } = await import('@/api/client');
      mockApiRequest.mockRejectedValueOnce(
        new ApiError(400, 'INVALID_API_KEY', 'Invalid API key'),
      );

      await expect(
        useSettingsStore.getState().updateAIProvider({ provider: 'claude', apiKey: 'invalid' }),
      ).rejects.toThrow();

      const state = useSettingsStore.getState();
      expect(state.error).toBe('Invalid API key');
      expect(state.isSaving).toBe(false);
    });

    it('should use fallback message for non-ApiError on updateAIProvider', async () => {
      mockApiRequest.mockRejectedValueOnce(new Error('Network timeout'));

      await expect(
        useSettingsStore.getState().updateAIProvider({ provider: 'claude' }),
      ).rejects.toThrow();

      expect(useSettingsStore.getState().error).toBe('Failed to update AI provider settings');
    });

    it('should auto-check health after successful provider update', async () => {
      const mockSettings = makeSettings({
        aiProvider: { provider: 'deepseek' as const, apiKey: 'sk-ds-test' },
      });
      const mockHealth = { provider: 'deepseek' as const, available: true, tier: 2 as const };

      mockApiRequest
        .mockResolvedValueOnce(mockSettings)
        .mockResolvedValueOnce(mockHealth);

      await useSettingsStore.getState().updateAIProvider({
        provider: 'deepseek',
        apiKey: 'sk-ds-test',
      });

      await vi.waitFor(() => {
        expect(mockApiRequest).toHaveBeenCalledTimes(2);
      });

      expect(mockApiRequest).toHaveBeenCalledWith('/settings/ai-provider/health');
    });

    it('should update to custom-openai with baseUrl, apiKey, and model', async () => {
      const mockSettings = makeSettings({
        aiProvider: {
          provider: 'custom-openai' as const,
          apiKey: 'sk-custom',
          model: 'gpt-4o',
          baseUrl: 'https://api.example.com/v1',
        },
      });
      const mockHealth = { provider: 'custom-openai' as const, available: true, tier: 2 };

      mockApiRequest
        .mockResolvedValueOnce(mockSettings)
        .mockResolvedValueOnce(mockHealth);

      await useSettingsStore.getState().updateAIProvider({
        provider: 'custom-openai',
        apiKey: 'sk-custom',
        model: 'gpt-4o',
        baseUrl: 'https://api.example.com/v1',
      });

      const state = useSettingsStore.getState();
      expect(state.settings?.aiProvider.provider).toBe('custom-openai');
      expect(state.settings?.aiProvider.baseUrl).toBe('https://api.example.com/v1');
      expect(state.settings?.aiProvider.model).toBe('gpt-4o');
      expect(state.isSaving).toBe(false);
    });
  });

  describe('updateUserProfile', () => {
    it('should update user profile successfully', async () => {
      const mockSettings = makeSettings({
        userProfile: {
          name: 'Updated Name',
          email: 'updated@test.com',
          timezone: 'America/New_York',
        },
      });
      mockApiRequest.mockResolvedValueOnce(mockSettings);

      await useSettingsStore.getState().updateUserProfile({
        name: 'Updated Name',
        email: 'updated@test.com',
        timezone: 'America/New_York',
      });

      const state = useSettingsStore.getState();
      expect(state.settings?.userProfile.name).toBe('Updated Name');
      expect(state.settings?.userProfile.email).toBe('updated@test.com');
      expect(state.isSaving).toBe(false);
      expect(mockApiRequest).toHaveBeenCalledWith('/settings/profile', {
        method: 'PUT',
        body: JSON.stringify({
          name: 'Updated Name',
          email: 'updated@test.com',
          timezone: 'America/New_York',
        }),
      });
    });

    it('should handle ApiError on updateUserProfile and re-throw', async () => {
      const { ApiError } = await import('@/api/client');
      mockApiRequest.mockRejectedValueOnce(
        new ApiError(422, 'VALIDATION_ERROR', 'Email already taken'),
      );

      await expect(
        useSettingsStore.getState().updateUserProfile({
          name: 'Test',
          email: 'taken@test.com',
          timezone: 'UTC',
        }),
      ).rejects.toThrow();

      expect(useSettingsStore.getState().error).toBe('Email already taken');
      expect(useSettingsStore.getState().isSaving).toBe(false);
    });

    it('should use fallback message for non-ApiError on updateUserProfile', async () => {
      mockApiRequest.mockRejectedValueOnce(new Error('Connection reset'));

      await expect(
        useSettingsStore.getState().updateUserProfile({
          name: 'Test',
          email: 'x@x.com',
          timezone: 'UTC',
        }),
      ).rejects.toThrow();

      expect(useSettingsStore.getState().error).toBe('Failed to update profile');
    });
  });

  describe('updateNotifications', () => {
    it('should update notification preferences successfully', async () => {
      const prefs = {
        emailNotifications: false,
        taskCompletion: false,
        systemAlerts: true,
        operationReports: true,
      };
      const mockSettings = makeSettings({ notifications: prefs });
      mockApiRequest.mockResolvedValueOnce(mockSettings);

      await useSettingsStore.getState().updateNotifications(prefs);

      const state = useSettingsStore.getState();
      expect(state.settings?.notifications.emailNotifications).toBe(false);
      expect(state.settings?.notifications.operationReports).toBe(true);
      expect(state.isSaving).toBe(false);
      expect(mockApiRequest).toHaveBeenCalledWith('/settings/notifications', {
        method: 'PUT',
        body: JSON.stringify(prefs),
      });
    });

    it('should handle ApiError on updateNotifications and re-throw', async () => {
      const { ApiError } = await import('@/api/client');
      mockApiRequest.mockRejectedValueOnce(
        new ApiError(500, 'INTERNAL_ERROR', 'Database write failed'),
      );

      await expect(
        useSettingsStore.getState().updateNotifications({
          emailNotifications: true,
          taskCompletion: true,
          systemAlerts: true,
          operationReports: true,
        }),
      ).rejects.toThrow();

      expect(useSettingsStore.getState().error).toBe('Database write failed');
      expect(useSettingsStore.getState().isSaving).toBe(false);
    });

    it('should use fallback message for non-ApiError on updateNotifications', async () => {
      mockApiRequest.mockRejectedValueOnce(new Error('unknown'));

      await expect(
        useSettingsStore.getState().updateNotifications({
          emailNotifications: true,
          taskCompletion: true,
          systemAlerts: true,
          operationReports: false,
        }),
      ).rejects.toThrow();

      expect(useSettingsStore.getState().error).toBe(
        'Failed to update notification preferences',
      );
    });
  });

  describe('updateKnowledgeBase', () => {
    it('should update knowledge base settings successfully', async () => {
      const config = {
        autoLearning: true,
        documentSources: ['https://docs.example.com', 'https://wiki.example.com'],
      };
      const mockSettings = makeSettings({ knowledgeBase: config });
      mockApiRequest.mockResolvedValueOnce(mockSettings);

      await useSettingsStore.getState().updateKnowledgeBase(config);

      const state = useSettingsStore.getState();
      expect(state.settings?.knowledgeBase.autoLearning).toBe(true);
      expect(state.settings?.knowledgeBase.documentSources).toHaveLength(2);
      expect(state.isSaving).toBe(false);
      expect(mockApiRequest).toHaveBeenCalledWith('/settings/knowledge-base', {
        method: 'PUT',
        body: JSON.stringify(config),
      });
    });

    it('should handle ApiError on updateKnowledgeBase and re-throw', async () => {
      const { ApiError } = await import('@/api/client');
      mockApiRequest.mockRejectedValueOnce(
        new ApiError(400, 'VALIDATION_ERROR', 'Invalid document URL'),
      );

      await expect(
        useSettingsStore.getState().updateKnowledgeBase({
          autoLearning: true,
          documentSources: ['not-a-url'],
        }),
      ).rejects.toThrow();

      expect(useSettingsStore.getState().error).toBe('Invalid document URL');
      expect(useSettingsStore.getState().isSaving).toBe(false);
    });

    it('should use fallback message for non-ApiError on updateKnowledgeBase', async () => {
      mockApiRequest.mockRejectedValueOnce(new Error('abort'));

      await expect(
        useSettingsStore.getState().updateKnowledgeBase({
          autoLearning: false,
          documentSources: [],
        }),
      ).rejects.toThrow();

      expect(useSettingsStore.getState().error).toBe(
        'Failed to update knowledge base settings',
      );
    });
  });

  describe('checkProviderHealth', () => {
    it('should fetch provider health status successfully', async () => {
      const mockHealth = { provider: 'claude' as const, available: true, tier: 1 as const };
      mockApiRequest.mockResolvedValueOnce(mockHealth);

      await useSettingsStore.getState().checkProviderHealth();

      const state = useSettingsStore.getState();
      expect(state.healthStatus).toEqual(mockHealth);
      expect(state.isCheckingHealth).toBe(false);
      expect(mockApiRequest).toHaveBeenCalledWith('/settings/ai-provider/health');
    });

    it('should handle health check failure gracefully', async () => {
      mockApiRequest.mockRejectedValueOnce(new Error('Network error'));

      await useSettingsStore.getState().checkProviderHealth();

      const state = useSettingsStore.getState();
      expect(state.healthStatus).toEqual({
        provider: null,
        available: false,
        error: 'Health check failed',
      });
      expect(state.isCheckingHealth).toBe(false);
    });

    it('should set isCheckingHealth true during the check', async () => {
      let resolvePromise: (v: unknown) => void;
      const pendingPromise = new Promise((resolve) => {
        resolvePromise = resolve;
      });
      mockApiRequest.mockReturnValueOnce(pendingPromise);

      const checkPromise = useSettingsStore.getState().checkProviderHealth();

      expect(useSettingsStore.getState().isCheckingHealth).toBe(true);

      resolvePromise!({ provider: 'claude', available: true, tier: 1 });
      await checkPromise;

      expect(useSettingsStore.getState().isCheckingHealth).toBe(false);
    });
  });

  describe('clearError', () => {
    it('should clear error message', () => {
      useSettingsStore.setState({ error: 'Test error' });

      useSettingsStore.getState().clearError();

      expect(useSettingsStore.getState().error).toBeNull();
    });

    it('should be a no-op when error is already null', () => {
      useSettingsStore.setState({ error: null });

      useSettingsStore.getState().clearError();

      expect(useSettingsStore.getState().error).toBeNull();
    });
  });

  describe('isSaving state transitions', () => {
    it('should set isSaving true while update is in progress', async () => {
      let resolvePromise: (v: unknown) => void;
      const pendingPromise = new Promise((resolve) => {
        resolvePromise = resolve;
      });
      mockApiRequest.mockReturnValueOnce(pendingPromise);

      const updatePromise = useSettingsStore.getState().updateUserProfile({
        name: 'Test',
        email: 'test@test.com',
        timezone: 'UTC',
      });

      expect(useSettingsStore.getState().isSaving).toBe(true);
      expect(useSettingsStore.getState().error).toBeNull();

      resolvePromise!(makeSettings());
      await updatePromise;

      expect(useSettingsStore.getState().isSaving).toBe(false);
    });
  });
});
