// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Sidebar } from './Sidebar';
import { useAuthStore } from '@/stores/auth';
import { useUiStore } from '@/stores/ui';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

function mockDesktop() {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: query === '(min-width: 1024px)',
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

function mockMobile() {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

function renderSidebar(route = '/dashboard') {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Sidebar />
    </MemoryRouter>,
  );
}

describe('Sidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDesktop();
    useAuthStore.setState({
      user: { id: '1', email: 'test@example.com', name: 'Test User' },
      isAuthenticated: true,
      isLoading: false,
      error: null,
    });
    useUiStore.setState({ sidebarCollapsed: false, mobileSidebarOpen: false });
  });

  afterEach(() => {
    mockMobile(); // restore default
  });

  describe('rendering', () => {
    it('renders the app name', () => {
      renderSidebar();
      expect(screen.getByText('ServerPilot')).toBeInTheDocument();
    });

    it('renders all navigation links', () => {
      renderSidebar();
      expect(screen.getByText('Dashboard')).toBeInTheDocument();
      expect(screen.getByText('Servers')).toBeInTheDocument();
      expect(screen.getByText('AI Chat')).toBeInTheDocument();
      expect(screen.getByText('Knowledge')).toBeInTheDocument();
      expect(screen.getByText('Tasks')).toBeInTheDocument();
      expect(screen.getByText('Operations')).toBeInTheDocument();
      expect(screen.getByText('Alerts')).toBeInTheDocument();
      expect(screen.getByText('Audit Log')).toBeInTheDocument();
      expect(screen.getByText('Settings')).toBeInTheDocument();
    });

    it('renders logout button', () => {
      renderSidebar();
      expect(screen.getByText('Logout')).toBeInTheDocument();
    });

    it('renders collapse button on desktop', () => {
      renderSidebar();
      expect(
        screen.getByRole('button', { name: 'Collapse sidebar' }),
      ).toBeInTheDocument();
    });
  });

  describe('active state', () => {
    it('highlights active route', () => {
      renderSidebar('/servers');
      const serversLink = screen.getByText('Servers').closest('a');
      expect(serversLink?.className).toContain('bg-primary');
    });
  });

  describe('collapse (desktop)', () => {
    it('hides labels when collapsed', () => {
      useUiStore.setState({ sidebarCollapsed: true });
      renderSidebar();

      expect(screen.queryByText('ServerPilot')).not.toBeInTheDocument();
      expect(screen.queryByText('Dashboard')).not.toBeInTheDocument();
      expect(screen.queryByText('Logout')).not.toBeInTheDocument();
    });

    it('shows expand button when collapsed', () => {
      useUiStore.setState({ sidebarCollapsed: true });
      renderSidebar();

      expect(
        screen.getByRole('button', { name: 'Expand sidebar' }),
      ).toBeInTheDocument();
    });

    it('toggles sidebar on collapse button click', async () => {
      const user = userEvent.setup();
      renderSidebar();

      await user.click(
        screen.getByRole('button', { name: 'Collapse sidebar' }),
      );
      expect(useUiStore.getState().sidebarCollapsed).toBe(true);
    });

    it('shows tooltips on nav items when collapsed', () => {
      useUiStore.setState({ sidebarCollapsed: true });
      renderSidebar();

      const links = screen.getAllByRole('link');
      for (const link of links) {
        expect(link).toHaveAttribute('title');
      }
    });
  });

  describe('mobile mode', () => {
    beforeEach(() => {
      mockMobile();
    });

    it('always shows labels regardless of collapsed state', () => {
      useUiStore.setState({ sidebarCollapsed: true });
      renderSidebar();

      expect(screen.getByText('ServerPilot')).toBeInTheDocument();
      expect(screen.getByText('Dashboard')).toBeInTheDocument();
      expect(screen.getByText('Logout')).toBeInTheDocument();
    });

    it('renders close button instead of collapse/expand', () => {
      renderSidebar();
      expect(
        screen.getByRole('button', { name: 'Close sidebar' }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Collapse sidebar' }),
      ).not.toBeInTheDocument();
    });

    it('closes mobile sidebar on close button click', async () => {
      const user = userEvent.setup();
      useUiStore.setState({ mobileSidebarOpen: true });
      renderSidebar();

      await user.click(
        screen.getByRole('button', { name: 'Close sidebar' }),
      );
      expect(useUiStore.getState().mobileSidebarOpen).toBe(false);
    });
  });

  describe('logout', () => {
    it('calls logout and navigates to login', async () => {
      const user = userEvent.setup();
      const logoutMock = vi.fn();
      useAuthStore.setState({ logout: logoutMock });
      renderSidebar();

      await user.click(screen.getByText('Logout'));

      expect(logoutMock).toHaveBeenCalled();
      expect(mockNavigate).toHaveBeenCalledWith('/login');
    });
  });

  describe('navigation', () => {
    it('has correct href for each link', () => {
      renderSidebar();
      const expectedPaths = [
        '/dashboard',
        '/servers',
        '/chat',
        '/search',
        '/tasks',
        '/operations',
        '/alerts',
        '/audit-log',
        '/settings',
      ];
      const links = screen.getAllByRole('link');
      for (let i = 0; i < expectedPaths.length; i++) {
        expect(links[i]).toHaveAttribute('href', expectedPaths[i]);
      }
    });
  });
});
