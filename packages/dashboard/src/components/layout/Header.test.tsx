// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Header } from './Header';
import { useAuthStore } from '@/stores/auth';
import { useUiStore } from '@/stores/ui';
import { useWebSocketStore } from '@/stores/websocket';

function renderHeader(route = '/dashboard') {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Header />
    </MemoryRouter>,
  );
}

describe('Header', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({
      user: { id: '1', email: 'admin@example.com', name: 'Admin' },
      isAuthenticated: true,
      isLoading: false,
      error: null,
    });
    useUiStore.setState({ sidebarCollapsed: false });
    useWebSocketStore.setState({ status: 'connected' });
  });

  describe('page title', () => {
    it('shows Dashboard title on /dashboard', () => {
      renderHeader('/dashboard');
      expect(screen.getByText('Dashboard')).toBeInTheDocument();
    });

    it('shows Servers title on /servers', () => {
      renderHeader('/servers');
      expect(screen.getByText('Servers')).toBeInTheDocument();
    });

    it('shows AI Chat title on /chat', () => {
      renderHeader('/chat');
      expect(screen.getByText('AI Chat')).toBeInTheDocument();
    });

    it('shows Server Detail for /servers/:id', () => {
      renderHeader('/servers/abc-123');
      expect(screen.getByText('Server Detail')).toBeInTheDocument();
    });

    it('shows AI Chat for /chat/:serverId', () => {
      renderHeader('/chat/srv-1');
      expect(screen.getByText('AI Chat')).toBeInTheDocument();
    });

    it('shows Tasks title on /tasks', () => {
      renderHeader('/tasks');
      expect(screen.getByText('Tasks')).toBeInTheDocument();
    });

    it('shows Operations title on /operations', () => {
      renderHeader('/operations');
      expect(screen.getByText('Operations')).toBeInTheDocument();
    });

    it('shows Settings title on /settings', () => {
      renderHeader('/settings');
      expect(screen.getByText('Settings')).toBeInTheDocument();
    });
  });

  describe('user info', () => {
    it('displays user name', () => {
      renderHeader();
      expect(screen.getByText('Admin')).toBeInTheDocument();
    });

    it('displays user initial in avatar', () => {
      renderHeader();
      expect(screen.getByLabelText('User avatar')).toHaveTextContent('A');
    });

    it('falls back to email when no name', () => {
      useAuthStore.setState({
        user: { id: '1', email: 'test@example.com' },
      });
      renderHeader();
      expect(screen.getByText('test@example.com')).toBeInTheDocument();
      expect(screen.getByLabelText('User avatar')).toHaveTextContent('T');
    });

    it('falls back to defaults when no user', () => {
      useAuthStore.setState({ user: null });
      renderHeader();
      expect(screen.getByText('User')).toBeInTheDocument();
      expect(screen.getByLabelText('User avatar')).toHaveTextContent('U');
    });
  });

  describe('sidebar toggle', () => {
    it('renders toggle sidebar button', () => {
      renderHeader();
      expect(
        screen.getByRole('button', { name: 'Toggle sidebar' }),
      ).toBeInTheDocument();
    });

    it('toggles mobile sidebar on click', async () => {
      const user = userEvent.setup();
      renderHeader();

      await user.click(
        screen.getByRole('button', { name: 'Toggle sidebar' }),
      );
      expect(useUiStore.getState().mobileSidebarOpen).toBe(true);
    });
  });

  describe('notifications', () => {
    it('renders notification bell button', () => {
      renderHeader();
      expect(
        screen.getByRole('button', { name: 'Notifications' }),
      ).toBeInTheDocument();
    });
  });

  describe('theme toggle', () => {
    it('renders theme toggle button', () => {
      renderHeader();
      expect(screen.getByTestId('theme-toggle')).toBeInTheDocument();
    });

    it('cycles theme from system to light on click', async () => {
      useUiStore.setState({ theme: 'system' });
      const user = userEvent.setup();
      renderHeader();

      // system -> light (next in cycle: light -> dark -> system)
      // Actually cycle is light -> dark -> system, so system + 1 = light
      await user.click(screen.getByTestId('theme-toggle'));
      expect(useUiStore.getState().theme).toBe('light');
    });

    it('cycles theme from light to dark on click', async () => {
      useUiStore.setState({ theme: 'light' });
      const user = userEvent.setup();
      renderHeader();

      await user.click(screen.getByTestId('theme-toggle'));
      expect(useUiStore.getState().theme).toBe('dark');
    });

    it('cycles theme from dark to system on click', async () => {
      useUiStore.setState({ theme: 'dark' });
      const user = userEvent.setup();
      renderHeader();

      await user.click(screen.getByTestId('theme-toggle'));
      expect(useUiStore.getState().theme).toBe('system');
    });

    it('persists theme to localStorage', async () => {
      useUiStore.setState({ theme: 'light' });
      const user = userEvent.setup();
      renderHeader();

      await user.click(screen.getByTestId('theme-toggle'));
      expect(localStorage.getItem('ui_theme')).toBe('dark');
    });
  });

  describe('connection status', () => {
    it('shows connection indicator', () => {
      renderHeader();
      expect(screen.getByTestId('connection-indicator')).toBeInTheDocument();
    });

    it('shows connected status', () => {
      useWebSocketStore.setState({ status: 'connected' });
      renderHeader();
      expect(screen.getByText('Connected')).toBeInTheDocument();
    });

    it('shows disconnected status', () => {
      useWebSocketStore.setState({ status: 'disconnected' });
      renderHeader();
      expect(screen.getByText('Disconnected')).toBeInTheDocument();
    });
  });
});
