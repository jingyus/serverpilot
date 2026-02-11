// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Settings } from './Settings';
import { useSettingsStore } from '@/stores/settings';
import { useAuthStore } from '@/stores/auth';

vi.mock('@/stores/settings');
vi.mock('@/stores/auth');
vi.mock('@/components/knowledge/DocSourceSection', () => ({
  DocSourceSection: () => <div data-testid="doc-source-section">DocSourceSection</div>,
}));

const mockUseSettingsStore = vi.mocked(useSettingsStore);
const mockUseAuthStore = vi.mocked(useAuthStore);

describe('Settings', () => {
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

  const mockUser = {
    id: 'user-1',
    email: 'test@example.com',
    name: 'Test User',
    timezone: 'UTC',
  };

  const defaultStoreValue = {
    settings: mockSettings,
    isLoading: false,
    error: null,
    isSaving: false,
    healthStatus: null,
    isCheckingHealth: false,
    fetchSettings: vi.fn(),
    updateAIProvider: vi.fn(),
    updateUserProfile: vi.fn(),
    updateNotifications: vi.fn(),
    updateKnowledgeBase: vi.fn(),
    checkProviderHealth: vi.fn(),
    clearError: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockUseAuthStore.mockReturnValue({
      user: mockUser,
      isAuthenticated: true,
      isLoading: false,
      error: null,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      clearError: vi.fn(),
      restoreSession: vi.fn(),
    });

    mockUseSettingsStore.mockReturnValue({ ...defaultStoreValue });
  });

  it('should render loading state', () => {
    mockUseSettingsStore.mockReturnValue({
      ...defaultStoreValue,
      settings: null,
      isLoading: true,
    });

    const { container } = render(<Settings />);
    const spinner = container.querySelector('.animate-spin');
    expect(spinner).toBeInTheDocument();
  });

  it('should render settings page with all sections', () => {
    render(<Settings />);

    expect(screen.getByText('Settings')).toBeInTheDocument();
    expect(screen.getByText('AI Provider')).toBeInTheDocument();
    expect(screen.getByText('User Profile')).toBeInTheDocument();
    expect(screen.getByText('Notifications')).toBeInTheDocument();
    expect(screen.getByText('Security')).toBeInTheDocument();
    expect(screen.getByText('Knowledge Base')).toBeInTheDocument();
  });

  it('should display error message', () => {
    mockUseSettingsStore.mockReturnValue({
      ...defaultStoreValue,
      error: 'Failed to load settings',
    });

    render(<Settings />);
    expect(screen.getByRole('alert')).toHaveTextContent('Failed to load settings');
  });

  it('should populate AI provider form with existing settings', () => {
    render(<Settings />);

    const providerSelect = screen.getByLabelText('Provider') as HTMLSelectElement;
    expect(providerSelect.value).toBe('claude');

    const modelInput = screen.getByLabelText('Model (optional)') as HTMLInputElement;
    expect(modelInput.value).toBe('claude-3-opus-20240229');
  });

  it('should list all 5 AI providers including custom-openai', () => {
    render(<Settings />);

    const providerSelect = screen.getByLabelText('Provider') as HTMLSelectElement;
    const options = Array.from(providerSelect.options).map((o) => o.value);
    expect(options).toEqual(['claude', 'openai', 'deepseek', 'ollama', 'custom-openai']);
  });

  it('should populate user profile form with existing settings', () => {
    render(<Settings />);

    const nameInput = screen.getByLabelText('Name') as HTMLInputElement;
    expect(nameInput.value).toBe('Test User');

    const emailInput = screen.getByLabelText('Email') as HTMLInputElement;
    expect(emailInput.value).toBe('test@example.com');

    const timezoneSelect = screen.getByLabelText('Timezone') as HTMLSelectElement;
    expect(timezoneSelect.value).toBe('UTC');
  });

  it('should handle AI provider save', async () => {
    const user = userEvent.setup();
    const updateAIProvider = vi.fn().mockResolvedValue(undefined);

    mockUseSettingsStore.mockReturnValue({
      ...defaultStoreValue,
      updateAIProvider,
    });

    render(<Settings />);

    const providerSelect = screen.getByLabelText('Provider');
    await user.selectOptions(providerSelect, 'openai');

    // Need to type API key since openai requires it
    const apiKeyInput = screen.getByLabelText('API Key');
    await user.clear(apiKeyInput);
    await user.type(apiKeyInput, 'sk-openai-test');

    const saveButton = screen.getAllByRole('button', { name: /Save AI Provider/i })[0];
    await user.click(saveButton);

    await waitFor(() => {
      expect(updateAIProvider).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'openai',
        })
      );
    });
  });

  it('should show API key field for DeepSeek', async () => {
    const user = userEvent.setup();
    render(<Settings />);

    const providerSelect = screen.getByLabelText('Provider');
    await user.selectOptions(providerSelect, 'deepseek');

    expect(screen.getByLabelText('API Key')).toBeInTheDocument();
  });

  it('should hide API key field for Ollama', async () => {
    const user = userEvent.setup();
    render(<Settings />);

    const providerSelect = screen.getByLabelText('Provider');
    await user.selectOptions(providerSelect, 'ollama');

    expect(screen.queryByLabelText('API Key')).not.toBeInTheDocument();
  });

  it('should show base URL field for Ollama', async () => {
    const user = userEvent.setup();
    render(<Settings />);

    const providerSelect = screen.getByLabelText('Provider');
    await user.selectOptions(providerSelect, 'ollama');

    expect(screen.getByLabelText('Base URL')).toBeInTheDocument();
  });

  it('should show base URL field for DeepSeek', async () => {
    const user = userEvent.setup();
    render(<Settings />);

    const providerSelect = screen.getByLabelText('Provider');
    await user.selectOptions(providerSelect, 'deepseek');

    expect(screen.getByLabelText('Base URL (optional)')).toBeInTheDocument();
  });

  it('should validate API key is required for providers needing one', async () => {
    const user = userEvent.setup();
    const updateAIProvider = vi.fn().mockResolvedValue(undefined);

    mockUseSettingsStore.mockReturnValue({
      ...defaultStoreValue,
      settings: {
        ...mockSettings,
        aiProvider: { provider: 'claude' as const, apiKey: '' },
      },
      updateAIProvider,
    });

    render(<Settings />);

    // Clear the API key field
    const apiKeyInput = screen.getByLabelText('API Key');
    await user.clear(apiKeyInput);

    const saveButton = screen.getAllByRole('button', { name: /Save AI Provider/i })[0];
    await user.click(saveButton);

    // Should NOT have called updateAIProvider since key is empty
    expect(updateAIProvider).not.toHaveBeenCalled();
  });

  it('should display health status when available (connected)', () => {
    mockUseSettingsStore.mockReturnValue({
      ...defaultStoreValue,
      healthStatus: { provider: 'claude', available: true, tier: 1 },
    });

    render(<Settings />);

    const healthStatus = screen.getByTestId('health-status');
    expect(healthStatus).toHaveTextContent('claude is connected');
  });

  it('should display health status when unavailable', () => {
    mockUseSettingsStore.mockReturnValue({
      ...defaultStoreValue,
      healthStatus: { provider: null, available: false, error: 'No API key configured' },
    });

    render(<Settings />);

    const healthStatus = screen.getByTestId('health-status');
    expect(healthStatus).toHaveTextContent('No API key configured');
  });

  it('should call checkProviderHealth on mount', () => {
    const checkProviderHealth = vi.fn();

    mockUseSettingsStore.mockReturnValue({
      ...defaultStoreValue,
      checkProviderHealth,
    });

    render(<Settings />);

    expect(checkProviderHealth).toHaveBeenCalledTimes(1);
  });

  it('should have refresh button for health status', async () => {
    const user = userEvent.setup();
    const checkProviderHealth = vi.fn();

    mockUseSettingsStore.mockReturnValue({
      ...defaultStoreValue,
      healthStatus: { provider: 'claude', available: true, tier: 1 },
      checkProviderHealth,
    });

    render(<Settings />);

    const refreshButton = screen.getByRole('button', { name: /Refresh health status/i });
    // One call from mount
    expect(checkProviderHealth).toHaveBeenCalledTimes(1);

    await user.click(refreshButton);
    expect(checkProviderHealth).toHaveBeenCalledTimes(2);
  });

  it('should handle profile save', async () => {
    const user = userEvent.setup();
    const updateUserProfile = vi.fn().mockResolvedValue(undefined);

    mockUseSettingsStore.mockReturnValue({
      ...defaultStoreValue,
      updateUserProfile,
    });

    render(<Settings />);

    const nameInput = screen.getByLabelText('Name');
    await user.clear(nameInput);
    await user.type(nameInput, 'Updated Name');

    const saveButton = screen.getAllByRole('button', { name: /Save Profile/i })[0];
    await user.click(saveButton);

    await waitFor(() => {
      expect(updateUserProfile).toHaveBeenCalledWith({
        name: 'Updated Name',
        email: 'test@example.com',
        timezone: 'UTC',
      });
    });
  });

  it('should handle notification toggle', async () => {
    const user = userEvent.setup();
    render(<Settings />);

    const emailSwitch = screen.getByLabelText('Email Notifications');
    expect(emailSwitch).toBeChecked();

    await user.click(emailSwitch);
    expect(emailSwitch).not.toBeChecked();
  });

  it('should handle notification preferences save', async () => {
    const user = userEvent.setup();
    const updateNotifications = vi.fn().mockResolvedValue(undefined);

    mockUseSettingsStore.mockReturnValue({
      ...defaultStoreValue,
      updateNotifications,
    });

    render(<Settings />);

    const saveButton = screen.getAllByRole('button', { name: /Save Preferences/i })[0];
    await user.click(saveButton);

    await waitFor(() => {
      expect(updateNotifications).toHaveBeenCalledWith({
        emailNotifications: true,
        taskCompletion: true,
        systemAlerts: true,
        operationReports: false,
      });
    });
  });

  it('should handle knowledge base toggle', async () => {
    const user = userEvent.setup();
    render(<Settings />);

    const autoLearningSwitch = screen.getByLabelText('Automatic Learning');
    expect(autoLearningSwitch).not.toBeChecked();

    await user.click(autoLearningSwitch);
    expect(autoLearningSwitch).toBeChecked();
  });

  it('should handle knowledge base settings save', async () => {
    const user = userEvent.setup();
    const updateKnowledgeBase = vi.fn().mockResolvedValue(undefined);

    mockUseSettingsStore.mockReturnValue({
      ...defaultStoreValue,
      updateKnowledgeBase,
    });

    render(<Settings />);

    const autoLearningSwitch = screen.getByLabelText('Automatic Learning');
    await user.click(autoLearningSwitch);

    const saveButton = screen.getAllByRole('button', { name: /Save Settings/i })[0];
    await user.click(saveButton);

    await waitFor(() => {
      expect(updateKnowledgeBase).toHaveBeenCalledWith({
        autoLearning: true,
        documentSources: [],
      });
    });
  });

  it('should show success message after save', async () => {
    const user = userEvent.setup();
    const updateUserProfile = vi.fn().mockResolvedValue(undefined);

    mockUseSettingsStore.mockReturnValue({
      ...defaultStoreValue,
      updateUserProfile,
    });

    render(<Settings />);

    const saveButton = screen.getAllByRole('button', { name: /Save Profile/i })[0];
    await user.click(saveButton);

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('Profile updated successfully');
    });
  });

  it('should call fetchSettings on mount', () => {
    const fetchSettings = vi.fn();

    mockUseSettingsStore.mockReturnValue({
      ...defaultStoreValue,
      fetchSettings,
    });

    render(<Settings />);

    expect(fetchSettings).toHaveBeenCalledTimes(1);
  });

  it('should show saving state on button', () => {
    mockUseSettingsStore.mockReturnValue({
      ...defaultStoreValue,
      isSaving: true,
    });

    render(<Settings />);

    const saveButton = screen.getAllByRole('button', { name: /Saving/i })[0];
    expect(saveButton).toBeDisabled();
  });
});
