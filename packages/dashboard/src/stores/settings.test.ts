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
