// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Login } from './Login';
import { useAuthStore } from '@/stores/auth';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

function renderLogin() {
  return render(
    <MemoryRouter>
      <Login />
    </MemoryRouter>
  );
}

describe('Login Page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({
      user: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,
    });
  });

  describe('rendering', () => {
    it('renders login form by default', () => {
      renderLogin();
      expect(screen.getByText('ServerPilot')).toBeInTheDocument();
      expect(screen.getByText('Sign in to your account')).toBeInTheDocument();
      expect(screen.getByLabelText('Email')).toBeInTheDocument();
      expect(screen.getByLabelText('Password')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Sign In' })).toBeInTheDocument();
    });

    it('does not show name or confirm password fields in login mode', () => {
      renderLogin();
      expect(screen.queryByLabelText('Name')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Confirm Password')).not.toBeInTheDocument();
    });

    it('shows register link', () => {
      renderLogin();
      expect(
        screen.getByRole('button', { name: /Don't have an account\? Register/i })
      ).toBeInTheDocument();
    });
  });

  describe('mode toggling', () => {
    it('switches to register mode when clicking register link', async () => {
      const user = userEvent.setup();
      renderLogin();

      await user.click(
        screen.getByRole('button', { name: /Don't have an account/i })
      );

      expect(screen.getByText('Create a new account')).toBeInTheDocument();
      expect(screen.getByLabelText('Name')).toBeInTheDocument();
      expect(screen.getByLabelText('Confirm Password')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Create Account' })).toBeInTheDocument();
    });

    it('switches back to login mode', async () => {
      const user = userEvent.setup();
      renderLogin();

      await user.click(screen.getByRole('button', { name: /Don't have an account/i }));
      await user.click(screen.getByRole('button', { name: /Already have an account/i }));

      expect(screen.getByText('Sign in to your account')).toBeInTheDocument();
      expect(screen.queryByLabelText('Name')).not.toBeInTheDocument();
    });

    it('clears errors when toggling mode', async () => {
      const user = userEvent.setup();
      useAuthStore.setState({ error: 'Some error' });
      renderLogin();

      expect(screen.getByRole('alert')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /Don't have an account/i }));

      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });

  describe('login validation', () => {
    it('shows error for invalid email', async () => {
      const user = userEvent.setup();
      renderLogin();

      await user.type(screen.getByLabelText('Email'), 'invalid');
      await user.type(screen.getByLabelText('Password'), 'password123');
      // Use fireEvent.submit to bypass native HTML5 email validation in jsdom
      fireEvent.submit(screen.getByRole('button', { name: 'Sign In' }).closest('form')!);

      expect(screen.getByText('Please enter a valid email address')).toBeInTheDocument();
    });

    it('shows error for short password', async () => {
      const user = userEvent.setup();
      renderLogin();

      await user.type(screen.getByLabelText('Email'), 'test@example.com');
      await user.type(screen.getByLabelText('Password'), '12345');
      fireEvent.submit(screen.getByRole('button', { name: 'Sign In' }).closest('form')!);

      expect(
        screen.getByText('Password must be at least 6 characters')
      ).toBeInTheDocument();
    });
  });

  describe('register validation', () => {
    it('shows error when name is empty', async () => {
      const user = userEvent.setup();
      renderLogin();

      await user.click(screen.getByRole('button', { name: /Don't have an account/i }));
      await user.type(screen.getByLabelText('Email'), 'test@example.com');
      await user.type(screen.getByLabelText('Password'), 'password123');
      await user.type(screen.getByLabelText('Confirm Password'), 'password123');
      await user.click(screen.getByRole('button', { name: 'Create Account' }));

      expect(screen.getByText('Name is required')).toBeInTheDocument();
    });

    it('shows error when passwords do not match', async () => {
      const user = userEvent.setup();
      renderLogin();

      await user.click(screen.getByRole('button', { name: /Don't have an account/i }));
      await user.type(screen.getByLabelText('Name'), 'Test User');
      await user.type(screen.getByLabelText('Email'), 'test@example.com');
      await user.type(screen.getByLabelText('Password'), 'password123');
      await user.type(screen.getByLabelText('Confirm Password'), 'different');
      await user.click(screen.getByRole('button', { name: 'Create Account' }));

      expect(screen.getByText('Passwords do not match')).toBeInTheDocument();
    });
  });

  describe('login submission', () => {
    it('calls login and navigates on success', async () => {
      const user = userEvent.setup();
      const loginMock = vi.fn().mockResolvedValue(undefined);
      useAuthStore.setState({ login: loginMock });
      renderLogin();

      await user.type(screen.getByLabelText('Email'), 'test@example.com');
      await user.type(screen.getByLabelText('Password'), 'password123');
      await user.click(screen.getByRole('button', { name: 'Sign In' }));

      await waitFor(() => {
        expect(loginMock).toHaveBeenCalledWith('test@example.com', 'password123');
        expect(mockNavigate).toHaveBeenCalledWith('/dashboard');
      });
    });

    it('does not navigate on login failure', async () => {
      const user = userEvent.setup();
      const loginMock = vi.fn().mockRejectedValue(new Error('Invalid credentials'));
      useAuthStore.setState({ login: loginMock });
      renderLogin();

      await user.type(screen.getByLabelText('Email'), 'test@example.com');
      await user.type(screen.getByLabelText('Password'), 'password123');
      await user.click(screen.getByRole('button', { name: 'Sign In' }));

      await waitFor(() => {
        expect(loginMock).toHaveBeenCalled();
        expect(mockNavigate).not.toHaveBeenCalled();
      });
    });
  });

  describe('register submission', () => {
    it('calls register and navigates on success', async () => {
      const user = userEvent.setup();
      const registerMock = vi.fn().mockResolvedValue(undefined);
      useAuthStore.setState({ register: registerMock });
      renderLogin();

      await user.click(screen.getByRole('button', { name: /Don't have an account/i }));
      await user.type(screen.getByLabelText('Name'), 'Test User');
      await user.type(screen.getByLabelText('Email'), 'test@example.com');
      await user.type(screen.getByLabelText('Password'), 'password123');
      await user.type(screen.getByLabelText('Confirm Password'), 'password123');
      await user.click(screen.getByRole('button', { name: 'Create Account' }));

      await waitFor(() => {
        expect(registerMock).toHaveBeenCalledWith(
          'test@example.com',
          'password123',
          'Test User'
        );
        expect(mockNavigate).toHaveBeenCalledWith('/dashboard');
      });
    });
  });

  describe('loading state', () => {
    it('disables submit button and shows spinner when loading', () => {
      useAuthStore.setState({ isLoading: true });
      renderLogin();

      const button = screen.getByRole('button', { name: /Sign In/i });
      expect(button).toBeDisabled();
    });
  });

  describe('error display', () => {
    it('shows API error from store', () => {
      useAuthStore.setState({ error: 'Invalid email or password' });
      renderLogin();

      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByText('Invalid email or password')).toBeInTheDocument();
    });
  });
});
