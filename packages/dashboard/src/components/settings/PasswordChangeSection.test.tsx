// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  PasswordChangeSection,
  evaluatePasswordStrength,
  validatePasswordForm,
} from './PasswordChangeSection';
import { useAuthStore } from '@/stores/auth';
import { ApiError } from '@/api/client';

vi.mock('@/stores/auth');
const mockUseAuthStore = vi.mocked(useAuthStore);

// Default mock: selector-based usage
const mockChangePassword = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  mockChangePassword.mockReset();

  // useAuthStore is called with a selector function
  mockUseAuthStore.mockImplementation((selector: unknown) => {
    const state = {
      changePassword: mockChangePassword,
      user: { id: 'user-1', email: 'test@example.com', name: 'Test' },
      isAuthenticated: true,
      isLoading: false,
      error: null,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      clearError: vi.fn(),
      restoreSession: vi.fn(),
    };
    if (typeof selector === 'function') {
      return (selector as (s: typeof state) => unknown)(state);
    }
    return state;
  });
});

describe('evaluatePasswordStrength', () => {
  it('returns weak for empty password', () => {
    expect(evaluatePasswordStrength('')).toEqual({ level: 'weak', score: 0 });
  });

  it('returns weak for short lowercase-only password', () => {
    expect(evaluatePasswordStrength('abc').level).toBe('weak');
  });

  it('returns fair for password meeting 2 criteria', () => {
    // 8+ chars and lowercase
    expect(evaluatePasswordStrength('abcdefgh').level).toBe('fair');
  });

  it('returns good for password meeting 3 criteria', () => {
    // 8+ chars, lowercase, uppercase
    expect(evaluatePasswordStrength('Abcdefgh').level).toBe('good');
  });

  it('returns strong for password meeting all 4 criteria', () => {
    expect(evaluatePasswordStrength('Abcdefg1').level).toBe('strong');
    expect(evaluatePasswordStrength('Abcdefg1').score).toBe(4);
  });
});

describe('validatePasswordForm', () => {
  it('returns error for empty current password', () => {
    const errors = validatePasswordForm('', 'Abcdefg1', 'Abcdefg1');
    expect(errors).toContain('settings.passwordCurrentRequired');
  });

  it('returns error for short new password', () => {
    const errors = validatePasswordForm('old', 'Ab1', 'Ab1');
    expect(errors).toContain('settings.passwordMinLength');
  });

  it('returns error for missing uppercase', () => {
    const errors = validatePasswordForm('old', 'abcdefg1', 'abcdefg1');
    expect(errors).toContain('settings.passwordUppercase');
  });

  it('returns error for missing lowercase', () => {
    const errors = validatePasswordForm('old', 'ABCDEFG1', 'ABCDEFG1');
    expect(errors).toContain('settings.passwordLowercase');
  });

  it('returns error for missing digit', () => {
    const errors = validatePasswordForm('old', 'Abcdefgh', 'Abcdefgh');
    expect(errors).toContain('settings.passwordDigit');
  });

  it('returns error for mismatching passwords', () => {
    const errors = validatePasswordForm('old', 'Abcdefg1', 'Abcdefg2');
    expect(errors).toContain('settings.passwordMismatch');
  });

  it('returns empty array for valid input', () => {
    const errors = validatePasswordForm('current', 'Abcdefg1', 'Abcdefg1');
    expect(errors).toEqual([]);
  });
});

describe('PasswordChangeSection', () => {
  it('renders the form with all 3 password inputs', () => {
    render(<PasswordChangeSection />);

    expect(screen.getByLabelText('Current Password')).toBeInTheDocument();
    expect(screen.getByLabelText('New Password')).toBeInTheDocument();
    expect(screen.getByLabelText('Confirm New Password')).toBeInTheDocument();
    expect(screen.getByTestId('change-password-btn')).toBeInTheDocument();
  });

  it('shows validation errors when submitting empty form', async () => {
    const user = userEvent.setup();
    render(<PasswordChangeSection />);

    await user.click(screen.getByTestId('change-password-btn'));

    expect(screen.getByTestId('password-validation-errors')).toBeInTheDocument();
    expect(mockChangePassword).not.toHaveBeenCalled();
  });

  it('shows password strength indicator when typing new password', async () => {
    const user = userEvent.setup();
    render(<PasswordChangeSection />);

    const newPasswordInput = screen.getByLabelText('New Password');
    await user.type(newPasswordInput, 'Abcdefg1');

    expect(screen.getByTestId('password-strength')).toBeInTheDocument();
    expect(screen.getByText('Strong')).toBeInTheDocument();
  });

  it('submits successfully with valid input', async () => {
    mockChangePassword.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<PasswordChangeSection />);

    await user.type(screen.getByLabelText('Current Password'), 'OldPass1');
    await user.type(screen.getByLabelText('New Password'), 'NewPass1!');
    await user.type(screen.getByLabelText('Confirm New Password'), 'NewPass1!');
    await user.click(screen.getByTestId('change-password-btn'));

    await waitFor(() => {
      expect(mockChangePassword).toHaveBeenCalledWith({
        currentPassword: 'OldPass1',
        newPassword: 'NewPass1!',
        confirmPassword: 'NewPass1!',
      });
    });

    expect(screen.getByTestId('password-success')).toBeInTheDocument();
  });

  it('shows server error on API failure', async () => {
    mockChangePassword.mockRejectedValue(
      new ApiError(400, 'BAD_REQUEST', 'Current password is incorrect'),
    );
    const user = userEvent.setup();
    render(<PasswordChangeSection />);

    await user.type(screen.getByLabelText('Current Password'), 'WrongPass1');
    await user.type(screen.getByLabelText('New Password'), 'NewPass1!');
    await user.type(screen.getByLabelText('Confirm New Password'), 'NewPass1!');
    await user.click(screen.getByTestId('change-password-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('password-error')).toHaveTextContent(
        'Current password is incorrect',
      );
    });
  });

  it('shows OAuth error when server rejects OAuth account', async () => {
    mockChangePassword.mockRejectedValue(
      new ApiError(
        400,
        'BAD_REQUEST',
        'OAuth-only accounts cannot change password. Use your OAuth provider to manage credentials.',
      ),
    );
    const user = userEvent.setup();
    render(<PasswordChangeSection />);

    await user.type(screen.getByLabelText('Current Password'), 'anything');
    await user.type(screen.getByLabelText('New Password'), 'NewPass1!');
    await user.type(screen.getByLabelText('Confirm New Password'), 'NewPass1!');
    await user.click(screen.getByTestId('change-password-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('password-error')).toHaveTextContent(
        'OAuth-only accounts cannot change password',
      );
    });
  });

  it('toggles password visibility for current password', async () => {
    const user = userEvent.setup();
    render(<PasswordChangeSection />);

    const input = screen.getByLabelText('Current Password') as HTMLInputElement;
    expect(input.type).toBe('password');

    const toggleBtns = screen.getAllByLabelText('Show password');
    await user.click(toggleBtns[0]);

    expect(input.type).toBe('text');
  });

  it('clears form after successful submission', async () => {
    mockChangePassword.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<PasswordChangeSection />);

    const currentInput = screen.getByLabelText('Current Password') as HTMLInputElement;
    const newInput = screen.getByLabelText('New Password') as HTMLInputElement;
    const confirmInput = screen.getByLabelText('Confirm New Password') as HTMLInputElement;

    await user.type(currentInput, 'OldPass1');
    await user.type(newInput, 'NewPass1!');
    await user.type(confirmInput, 'NewPass1!');
    await user.click(screen.getByTestId('change-password-btn'));

    await waitFor(() => {
      expect(currentInput.value).toBe('');
      expect(newInput.value).toBe('');
      expect(confirmInput.value).toBe('');
    });
  });

  it('shows generic error for non-ApiError failures', async () => {
    mockChangePassword.mockRejectedValue(new Error('Network failure'));
    const user = userEvent.setup();
    render(<PasswordChangeSection />);

    await user.type(screen.getByLabelText('Current Password'), 'OldPass1');
    await user.type(screen.getByLabelText('New Password'), 'NewPass1!');
    await user.type(screen.getByLabelText('Confirm New Password'), 'NewPass1!');
    await user.click(screen.getByTestId('change-password-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('password-error')).toHaveTextContent(
        'Failed to change password',
      );
    });
  });
});
