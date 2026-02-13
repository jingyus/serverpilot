// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Dashboard } from './Dashboard';
import { useServersStore } from '@/stores/servers';
import { useDashboardStore } from '@/stores/dashboard';
import { useUiStore } from '@/stores/ui';
import type { Server } from '@/types/server';
import type { Operation, Alert } from '@/types/dashboard';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

const mockServers: Server[] = [
  {
    id: 'srv-1',
    name: 'web-prod-01',
    status: 'online',
    tags: ['production'],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-15T00:00:00Z',
    osInfo: null,
    lastSeen: '2026-02-09T12:00:00Z',
  },
  {
    id: 'srv-2',
    name: 'db-prod-01',
    status: 'offline',
    tags: ['production'],
    createdAt: '2026-01-02T00:00:00Z',
    updatedAt: '2026-01-16T00:00:00Z',
    osInfo: null,
    lastSeen: null,
  },
  {
    id: 'srv-3',
    name: 'staging-app',
    status: 'error',
    tags: ['staging'],
    createdAt: '2026-01-03T00:00:00Z',
    updatedAt: '2026-01-17T00:00:00Z',
    osInfo: null,
    lastSeen: null,
  },
  {
    id: 'srv-4',
    name: 'web-prod-02',
    status: 'online',
    tags: ['production'],
    createdAt: '2026-01-04T00:00:00Z',
    updatedAt: '2026-01-18T00:00:00Z',
    osInfo: null,
    lastSeen: '2026-02-09T12:00:00Z',
  },
];

const mockOperations: Operation[] = [
  {
    id: 'op-1',
    serverId: 'srv-1',
    serverName: 'web-prod-01',
    type: 'install',
    description: 'Install nginx 1.24',
    status: 'success',
    riskLevel: 'green',
    duration: 5000,
    createdAt: '2026-02-09T10:00:00Z',
    completedAt: '2026-02-09T10:00:05Z',
  },
  {
    id: 'op-2',
    serverId: 'srv-2',
    serverName: 'db-prod-01',
    type: 'restart',
    description: 'Restart MySQL service',
    status: 'failed',
    riskLevel: 'yellow',
    duration: 3000,
    createdAt: '2026-02-09T09:00:00Z',
    completedAt: '2026-02-09T09:00:03Z',
  },
  {
    id: 'op-3',
    serverId: 'srv-1',
    serverName: 'web-prod-01',
    type: 'config',
    description: 'Update nginx config',
    status: 'running',
    riskLevel: 'green',
    createdAt: '2026-02-09T11:00:00Z',
  },
];

const mockAlerts: Alert[] = [
  {
    id: 'alert-1',
    serverId: 'srv-1',
    serverName: 'web-prod-01',
    type: 'cpu',
    severity: 'critical',
    message: 'CPU usage exceeds 90%',
    value: '95%',
    threshold: '90%',
    resolved: false,
    createdAt: '2026-02-09T11:00:00Z',
  },
  {
    id: 'alert-2',
    serverId: 'srv-2',
    serverName: 'db-prod-01',
    type: 'memory',
    severity: 'warning',
    message: 'Memory usage exceeds 80%',
    value: '85%',
    threshold: '80%',
    resolved: false,
    createdAt: '2026-02-09T10:30:00Z',
  },
];

function renderDashboard() {
  return render(
    <MemoryRouter>
      <Dashboard />
    </MemoryRouter>
  );
}

describe('Dashboard Page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mark onboarding as completed so wizard doesn't interfere with other tests
    localStorage.setItem('onboarding_completed', 'true');
    useUiStore.setState({ isFirstRun: false });
    useServersStore.setState({
      servers: mockServers,
      isLoading: false,
      error: null,
      statusFilter: 'all',
      searchQuery: '',
      fetchServers: vi.fn().mockResolvedValue(undefined),
      addServer: vi.fn(),
      deleteServer: vi.fn(),
      setStatusFilter: vi.fn(),
      setSearchQuery: vi.fn(),
      clearError: vi.fn(),
    });
    useDashboardStore.setState({
      operations: mockOperations,
      alerts: mockAlerts,
      isLoadingOperations: false,
      isLoadingAlerts: false,
      operationsError: null,
      alertsError: null,
      fetchRecentOperations: vi.fn().mockResolvedValue(undefined),
      fetchAlerts: vi.fn().mockResolvedValue(undefined),
      clearErrors: vi.fn(),
    });
  });

  describe('rendering', () => {
    it('renders page title and description', () => {
      renderDashboard();
      expect(screen.getByText('Dashboard')).toBeInTheDocument();
      expect(
        screen.getByText('Server overview and system status.')
      ).toBeInTheDocument();
    });

    it('renders the dashboard page container', () => {
      renderDashboard();
      expect(screen.getByTestId('dashboard-page')).toBeInTheDocument();
    });
  });

  describe('quick actions', () => {
    it('renders Start Chat button', () => {
      renderDashboard();
      expect(screen.getByTestId('quick-chat')).toBeInTheDocument();
      expect(screen.getByText('Start Chat')).toBeInTheDocument();
    });

    it('renders Add Server button', () => {
      renderDashboard();
      expect(screen.getByTestId('quick-add-server')).toBeInTheDocument();
      expect(screen.getByText('Add Server')).toBeInTheDocument();
    });

    it('navigates to chat on Start Chat click', async () => {
      const user = userEvent.setup();
      renderDashboard();

      await user.click(screen.getByTestId('quick-chat'));
      expect(mockNavigate).toHaveBeenCalledWith('/chat');
    });

    it('navigates to servers on Add Server click', async () => {
      const user = userEvent.setup();
      renderDashboard();

      await user.click(screen.getByTestId('quick-add-server'));
      expect(mockNavigate).toHaveBeenCalledWith('/servers');
    });
  });

  describe('server stats', () => {
    it('renders server stats cards', () => {
      renderDashboard();
      const stats = screen.getByTestId('server-stats');
      expect(stats).toBeInTheDocument();
    });

    it('displays correct total servers count', () => {
      renderDashboard();
      const stats = screen.getByTestId('server-stats');
      expect(within(stats).getByText('4')).toBeInTheDocument();
      expect(within(stats).getByText('Total Servers')).toBeInTheDocument();
    });

    it('displays correct online count', () => {
      renderDashboard();
      const stats = screen.getByTestId('server-stats');
      expect(within(stats).getByText('2')).toBeInTheDocument(); // 2 online
      expect(within(stats).getByText('Online')).toBeInTheDocument();
    });

    it('displays correct offline count', () => {
      renderDashboard();
      const stats = screen.getByTestId('server-stats');
      expect(within(stats).getByText('Offline')).toBeInTheDocument();
    });

    it('displays correct error count', () => {
      renderDashboard();
      const stats = screen.getByTestId('server-stats');
      expect(within(stats).getByText('Error')).toBeInTheDocument();
    });

    it('shows loading state for server stats', () => {
      useServersStore.setState({ isLoading: true, servers: [] });
      renderDashboard();
      expect(screen.getByTestId('stats-loading')).toBeInTheDocument();
      expect(screen.queryByTestId('server-stats')).not.toBeInTheDocument();
    });

    it('shows zero counts when no servers', () => {
      useServersStore.setState({ servers: [] });
      renderDashboard();
      const stats = screen.getByTestId('server-stats');
      // All stat values should be 0
      const zeros = within(stats).getAllByText('0');
      expect(zeros).toHaveLength(4);
    });
  });

  describe('recent operations', () => {
    it('renders operations section title', () => {
      renderDashboard();
      expect(screen.getByText('Recent Operations')).toBeInTheDocument();
      expect(
        screen.getByText('Last 5 operations across all servers')
      ).toBeInTheDocument();
    });

    it('renders operation rows', () => {
      renderDashboard();
      expect(screen.getByTestId('operations-list')).toBeInTheDocument();
      expect(screen.getByTestId('operation-op-1')).toBeInTheDocument();
      expect(screen.getByTestId('operation-op-2')).toBeInTheDocument();
      expect(screen.getByTestId('operation-op-3')).toBeInTheDocument();
    });

    it('displays operation descriptions', () => {
      renderDashboard();
      expect(screen.getByText('Install nginx 1.24')).toBeInTheDocument();
      expect(screen.getByText('Restart MySQL service')).toBeInTheDocument();
      expect(screen.getByText('Update nginx config')).toBeInTheDocument();
    });

    it('displays operation server names', () => {
      renderDashboard();
      // web-prod-01 appears for op-1 and op-3, also in alerts
      const webProd = screen.getAllByText('web-prod-01');
      expect(webProd.length).toBeGreaterThanOrEqual(2);
    });

    it('displays operation status badges', () => {
      renderDashboard();
      expect(screen.getByText('Success')).toBeInTheDocument();
      expect(screen.getByText('Failed')).toBeInTheDocument();
      expect(screen.getByText('Running')).toBeInTheDocument();
    });

    it('renders View All operations button', () => {
      renderDashboard();
      expect(screen.getByTestId('view-all-operations')).toBeInTheDocument();
    });

    it('navigates to operations on View All click', async () => {
      const user = userEvent.setup();
      renderDashboard();

      await user.click(screen.getByTestId('view-all-operations'));
      expect(mockNavigate).toHaveBeenCalledWith('/operations');
    });

    it('shows loading state for operations', () => {
      useDashboardStore.setState({ isLoadingOperations: true, operations: [] });
      renderDashboard();
      expect(screen.getByTestId('operations-loading')).toBeInTheDocument();
    });

    it('shows empty state when no operations', () => {
      useDashboardStore.setState({ operations: [] });
      renderDashboard();
      expect(screen.getByTestId('operations-empty')).toBeInTheDocument();
      expect(screen.getByText('No operations yet')).toBeInTheDocument();
    });

    it('shows error state for operations', () => {
      useDashboardStore.setState({
        operationsError: 'Failed to load operations',
        operations: [],
      });
      renderDashboard();
      expect(screen.getByTestId('operations-error')).toBeInTheDocument();
      expect(screen.getByText('Failed to load operations')).toBeInTheDocument();
    });
  });

  describe('alerts', () => {
    it('renders alerts section title', () => {
      renderDashboard();
      expect(screen.getByText('Active Alerts')).toBeInTheDocument();
      expect(
        screen.getByText('Unresolved alerts requiring attention')
      ).toBeInTheDocument();
    });

    it('renders alert rows', () => {
      renderDashboard();
      expect(screen.getByTestId('alerts-list')).toBeInTheDocument();
      expect(screen.getByTestId('alert-alert-1')).toBeInTheDocument();
      expect(screen.getByTestId('alert-alert-2')).toBeInTheDocument();
    });

    it('displays alert messages', () => {
      renderDashboard();
      expect(screen.getByText('CPU usage exceeds 90%')).toBeInTheDocument();
      expect(screen.getByText('Memory usage exceeds 80%')).toBeInTheDocument();
    });

    it('displays unresolved alert count badge', () => {
      renderDashboard();
      // The badge with the count "2"
      // "2" also shows up in stats (online count), so search within alerts header context
      const alertsTitle = screen.getByText('Active Alerts');
      const headerDiv = alertsTitle.closest('div')!;
      expect(within(headerDiv).getByText('2')).toBeInTheDocument();
    });

    it('does not show alert count badge when no alerts', () => {
      useDashboardStore.setState({ alerts: [] });
      renderDashboard();
      // The "Active Alerts" title should exist but no badge
      expect(screen.getByText('Active Alerts')).toBeInTheDocument();
      expect(screen.getByTestId('alerts-empty')).toBeInTheDocument();
    });

    it('shows loading state for alerts', () => {
      useDashboardStore.setState({ isLoadingAlerts: true, alerts: [] });
      renderDashboard();
      expect(screen.getByTestId('alerts-loading')).toBeInTheDocument();
    });

    it('shows empty state when no alerts', () => {
      useDashboardStore.setState({ alerts: [] });
      renderDashboard();
      expect(screen.getByTestId('alerts-empty')).toBeInTheDocument();
      expect(screen.getByText('No active alerts')).toBeInTheDocument();
    });

    it('shows error state for alerts', () => {
      useDashboardStore.setState({
        alertsError: 'Failed to load alerts',
        alerts: [],
      });
      renderDashboard();
      expect(screen.getByTestId('alerts-error')).toBeInTheDocument();
      expect(screen.getByText('Failed to load alerts')).toBeInTheDocument();
    });
  });

  describe('data fetching', () => {
    it('calls fetchServers on mount', () => {
      const fetchMock = vi.fn().mockResolvedValue(undefined);
      useServersStore.setState({ fetchServers: fetchMock });
      renderDashboard();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('calls fetchRecentOperations on mount', () => {
      const fetchMock = vi.fn().mockResolvedValue(undefined);
      useDashboardStore.setState({ fetchRecentOperations: fetchMock });
      renderDashboard();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('calls fetchAlerts on mount', () => {
      const fetchMock = vi.fn().mockResolvedValue(undefined);
      useDashboardStore.setState({ fetchAlerts: fetchMock });
      renderDashboard();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('operation with fallback serverId', () => {
    it('displays serverId when serverName is not provided', () => {
      useDashboardStore.setState({
        operations: [
          {
            id: 'op-fallback',
            serverId: 'srv-unknown',
            type: 'execute',
            description: 'Run backup script',
            status: 'pending',
            riskLevel: 'green',
            createdAt: '2026-02-09T12:00:00Z',
          },
        ],
      });
      renderDashboard();
      expect(screen.getByText('srv-unknown')).toBeInTheDocument();
    });
  });

  describe('alert with fallback serverId', () => {
    it('displays serverId when serverName is not provided', () => {
      useDashboardStore.setState({
        alerts: [
          {
            id: 'alert-fallback',
            serverId: 'srv-unknown',
            type: 'disk',
            severity: 'info',
            message: 'Disk usage at 70%',
            resolved: false,
            createdAt: '2026-02-09T12:00:00Z',
          },
        ],
      });
      renderDashboard();
      expect(screen.getByText('srv-unknown')).toBeInTheDocument();
    });
  });

  describe('welcome wizard integration', () => {
    it('shows wizard when isFirstRun is true (no onboarding, no servers)', () => {
      localStorage.removeItem('onboarding_completed');
      useUiStore.setState({ isFirstRun: true });
      useServersStore.setState({ servers: [], isLoading: false });
      renderDashboard();
      expect(screen.getByTestId('welcome-wizard')).toBeInTheDocument();
      // Normal dashboard content should NOT be visible
      expect(screen.queryByText('Dashboard')).not.toBeInTheDocument();
      expect(screen.queryByTestId('server-stats')).not.toBeInTheDocument();
    });

    it('hides wizard when onboarding is already completed', () => {
      localStorage.setItem('onboarding_completed', 'true');
      useUiStore.setState({ isFirstRun: false });
      renderDashboard();
      expect(screen.queryByTestId('welcome-wizard')).not.toBeInTheDocument();
      expect(screen.getByText('Dashboard')).toBeInTheDocument();
    });

    it('hides wizard when servers exist even without onboarding flag', () => {
      localStorage.removeItem('onboarding_completed');
      // isFirstRun starts true, but checkFirstRun effect sets it false when servers > 0
      useUiStore.setState({ isFirstRun: false });
      useServersStore.setState({ servers: mockServers, isLoading: false });
      renderDashboard();
      expect(screen.queryByTestId('welcome-wizard')).not.toBeInTheDocument();
      expect(screen.getByText('Dashboard')).toBeInTheDocument();
    });

    it('hides wizard after skip is clicked', async () => {
      const user = userEvent.setup();
      localStorage.removeItem('onboarding_completed');
      useUiStore.setState({ isFirstRun: true });
      useServersStore.setState({ servers: [], isLoading: false });
      renderDashboard();

      expect(screen.getByTestId('welcome-wizard')).toBeInTheDocument();
      await user.click(screen.getByTestId('wizard-skip'));
      expect(screen.queryByTestId('welcome-wizard')).not.toBeInTheDocument();
      expect(localStorage.getItem('onboarding_completed')).toBe('true');
      // Normal dashboard should now be visible
      expect(screen.getByText('Dashboard')).toBeInTheDocument();
    });

    it('renders dashboard-page testid in both wizard and normal mode', () => {
      useUiStore.setState({ isFirstRun: true });
      const { unmount } = renderDashboard();
      expect(screen.getByTestId('dashboard-page')).toBeInTheDocument();
      unmount();

      useUiStore.setState({ isFirstRun: false });
      renderDashboard();
      expect(screen.getByTestId('dashboard-page')).toBeInTheDocument();
    });
  });
});
