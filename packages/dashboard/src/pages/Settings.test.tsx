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

    mockUseSettingsStore.mockReturnValue({
      settings: mockSettings,
      isLoading: false,
      error: null,
      isSaving: false,
      fetchSettings: vi.fn(),
      updateAIProvider: vi.fn(),
      updateUserProfile: vi.fn(),
      updateNotifications: vi.fn(),
      updateKnowledgeBase: vi.fn(),
      clearError: vi.fn(),
    });
  });

  it('should render loading state', () => {
    mockUseSettingsStore.mockReturnValue({
      settings: null,
      isLoading: true,
      error: null,
      isSaving: false,
      fetchSettings: vi.fn(),
      updateAIProvider: vi.fn(),
      updateUserProfile: vi.fn(),
      updateNotifications: vi.fn(),
      updateKnowledgeBase: vi.fn(),
      clearError: vi.fn(),
    });

    const { container } = render(<Settings />);
    // The loading spinner is rendered as an SVG with animate-spin class
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
      settings: mockSettings,
      isLoading: false,
      error: 'Failed to load settings',
      isSaving: false,
      fetchSettings: vi.fn(),
      updateAIProvider: vi.fn(),
      updateUserProfile: vi.fn(),
      updateNotifications: vi.fn(),
      updateKnowledgeBase: vi.fn(),
      clearError: vi.fn(),
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
      settings: mockSettings,
      isLoading: false,
      error: null,
      isSaving: false,
      fetchSettings: vi.fn(),
      updateAIProvider,
      updateUserProfile: vi.fn(),
      updateNotifications: vi.fn(),
      updateKnowledgeBase: vi.fn(),
      clearError: vi.fn(),
    });

    render(<Settings />);

    const providerSelect = screen.getByLabelText('Provider');
    await user.selectOptions(providerSelect, 'openai');

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

  it('should handle profile save', async () => {
    const user = userEvent.setup();
    const updateUserProfile = vi.fn().mockResolvedValue(undefined);

    mockUseSettingsStore.mockReturnValue({
      settings: mockSettings,
      isLoading: false,
      error: null,
      isSaving: false,
      fetchSettings: vi.fn(),
      updateAIProvider: vi.fn(),
      updateUserProfile,
      updateNotifications: vi.fn(),
      updateKnowledgeBase: vi.fn(),
      clearError: vi.fn(),
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
      settings: mockSettings,
      isLoading: false,
      error: null,
      isSaving: false,
      fetchSettings: vi.fn(),
      updateAIProvider: vi.fn(),
      updateUserProfile: vi.fn(),
      updateNotifications,
      updateKnowledgeBase: vi.fn(),
      clearError: vi.fn(),
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
      settings: mockSettings,
      isLoading: false,
      error: null,
      isSaving: false,
      fetchSettings: vi.fn(),
      updateAIProvider: vi.fn(),
      updateUserProfile: vi.fn(),
      updateNotifications: vi.fn(),
      updateKnowledgeBase,
      clearError: vi.fn(),
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
      settings: mockSettings,
      isLoading: false,
      error: null,
      isSaving: false,
      fetchSettings: vi.fn(),
      updateAIProvider: vi.fn(),
      updateUserProfile,
      updateNotifications: vi.fn(),
      updateKnowledgeBase: vi.fn(),
      clearError: vi.fn(),
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
      settings: mockSettings,
      isLoading: false,
      error: null,
      isSaving: false,
      fetchSettings,
      updateAIProvider: vi.fn(),
      updateUserProfile: vi.fn(),
      updateNotifications: vi.fn(),
      updateKnowledgeBase: vi.fn(),
      clearError: vi.fn(),
    });

    render(<Settings />);

    expect(fetchSettings).toHaveBeenCalledTimes(1);
  });

  it('should show saving state on button', async () => {
    const user = userEvent.setup();
    const updateUserProfile = vi.fn().mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 1000))
    );

    mockUseSettingsStore.mockReturnValue({
      settings: mockSettings,
      isLoading: false,
      error: null,
      isSaving: true,
      fetchSettings: vi.fn(),
      updateAIProvider: vi.fn(),
      updateUserProfile,
      updateNotifications: vi.fn(),
      updateKnowledgeBase: vi.fn(),
      clearError: vi.fn(),
    });

    render(<Settings />);

    const saveButton = screen.getAllByRole('button', { name: /Saving/i })[0];
    expect(saveButton).toBeDisabled();
  });
});
