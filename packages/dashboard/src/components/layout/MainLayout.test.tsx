import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MainLayout } from './MainLayout';
import { useAuthStore } from '@/stores/auth';
import { useUiStore } from '@/stores/ui';

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

function renderMainLayout(route = '/dashboard') {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route path="/login" element={<div>Login Page</div>} />
        <Route path="/" element={<MainLayout />}>
          <Route path="dashboard" element={<div>Dashboard Content</div>} />
          <Route path="servers" element={<div>Servers Content</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('MainLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockDesktop();
    useUiStore.setState({ sidebarCollapsed: false, mobileSidebarOpen: false });
  });

  afterEach(() => {
    mockMobile();
  });

  describe('auth guard', () => {
    it('redirects to /login when not authenticated', () => {
      useAuthStore.setState({
        user: null,
        isAuthenticated: false,
      });
      renderMainLayout('/dashboard');

      expect(screen.getByText('Login Page')).toBeInTheDocument();
      expect(screen.queryByText('Dashboard Content')).not.toBeInTheDocument();
    });

    it('renders content when authenticated', () => {
      useAuthStore.setState({
        user: { id: '1', email: 'test@example.com', name: 'Test' },
        isAuthenticated: true,
      });
      renderMainLayout('/dashboard');

      expect(screen.getByText('Dashboard Content')).toBeInTheDocument();
      expect(screen.queryByText('Login Page')).not.toBeInTheDocument();
    });
  });

  describe('session restore', () => {
    it('calls restoreSession on mount', () => {
      const restoreMock = vi.fn();
      useAuthStore.setState({
        isAuthenticated: false,
        restoreSession: restoreMock,
      });
      renderMainLayout('/dashboard');

      expect(restoreMock).toHaveBeenCalledOnce();
    });

    it('shows layout when session is restored from localStorage', () => {
      localStorage.setItem('auth_token', 'test-token');
      localStorage.setItem(
        'auth_user',
        JSON.stringify({ id: '1', email: 'test@example.com', name: 'Test' }),
      );

      useAuthStore.setState({
        user: null,
        isAuthenticated: false,
      });

      renderMainLayout('/dashboard');

      expect(screen.getByText('Login Page')).toBeInTheDocument();
    });
  });

  describe('layout structure', () => {
    it('renders sidebar and header when authenticated', () => {
      useAuthStore.setState({
        user: { id: '1', email: 'test@example.com', name: 'Test' },
        isAuthenticated: true,
      });
      renderMainLayout('/dashboard');

      expect(screen.getByTestId('sidebar')).toBeInTheDocument();
      expect(screen.getByTestId('header')).toBeInTheDocument();
    });

    it('renders child route content', () => {
      useAuthStore.setState({
        user: { id: '1', email: 'test@example.com', name: 'Test' },
        isAuthenticated: true,
      });
      renderMainLayout('/servers');

      expect(screen.getByText('Servers Content')).toBeInTheDocument();
    });
  });

  describe('responsive: mobile sidebar', () => {
    beforeEach(() => {
      mockMobile();
      useAuthStore.setState({
        user: { id: '1', email: 'test@example.com', name: 'Test' },
        isAuthenticated: true,
      });
    });

    it('does not show sidebar overlay when mobileSidebarOpen is false', () => {
      useUiStore.setState({ mobileSidebarOpen: false });
      renderMainLayout('/dashboard');

      expect(screen.queryByTestId('mobile-sidebar-overlay')).not.toBeInTheDocument();
      expect(screen.queryByTestId('mobile-sidebar')).not.toBeInTheDocument();
    });

    it('shows sidebar overlay when mobileSidebarOpen is true', () => {
      useUiStore.setState({ mobileSidebarOpen: true });
      renderMainLayout('/dashboard');

      expect(screen.getByTestId('mobile-sidebar-overlay')).toBeInTheDocument();
      expect(screen.getByTestId('mobile-sidebar')).toBeInTheDocument();
    });

    it('closes sidebar overlay on overlay click', async () => {
      const user = userEvent.setup();
      useUiStore.setState({ mobileSidebarOpen: true });
      renderMainLayout('/dashboard');

      await user.click(screen.getByTestId('mobile-sidebar-overlay'));

      expect(useUiStore.getState().mobileSidebarOpen).toBe(false);
    });
  });
});
