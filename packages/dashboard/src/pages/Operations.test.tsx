// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Operations } from './Operations';
import { useOperationsStore } from '@/stores/operations';
import type { Operation, OperationStats } from '@/types/dashboard';

const mockOperations: Operation[] = [
  {
    id: 'op-1',
    serverId: 'srv-1',
    serverName: 'web-prod-01',
    type: 'install',
    description: 'Install nginx',
    commands: ['apt-get install nginx'],
    output: 'Successfully installed nginx 1.24',
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
    description: 'Restart MySQL',
    commands: ['systemctl restart mysql'],
    output: null,
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
    type: 'execute',
    description: 'Run security audit',
    commands: ['lynis audit system'],
    output: 'Audit completed',
    status: 'running',
    riskLevel: 'red',
    duration: null,
    createdAt: '2026-02-09T11:00:00Z',
    completedAt: null,
  },
];

const mockStats: OperationStats = {
  total: 42,
  byStatus: { pending: 2, running: 1, success: 35, failed: 3, rolled_back: 1 },
  byType: { install: 10, config: 15, restart: 8, execute: 7, backup: 2 },
  byRiskLevel: { green: 30, yellow: 8, red: 3, critical: 1 },
  avgDuration: 4500,
  successRate: 83.3,
};

function renderOperations() {
  return render(
    <MemoryRouter>
      <Operations />
    </MemoryRouter>
  );
}

function setupStore(overrides: Partial<ReturnType<typeof useOperationsStore.getState>> = {}) {
  useOperationsStore.setState({
    operations: mockOperations,
    total: mockOperations.length,
    stats: mockStats,
    selectedOperation: null,
    filters: {
      serverId: '',
      type: '',
      status: '',
      riskLevel: '',
      startDate: '',
      endDate: '',
    },
    page: 1,
    isLoading: false,
    isLoadingStats: false,
    error: null,
    statsError: null,
    fetchOperations: vi.fn().mockResolvedValue(undefined),
    fetchStats: vi.fn().mockResolvedValue(undefined),
    setFilters: vi.fn((partial) => {
      const current = useOperationsStore.getState().filters;
      useOperationsStore.setState({ filters: { ...current, ...partial }, page: 1 });
    }),
    resetFilters: vi.fn(() => {
      useOperationsStore.setState({
        filters: { serverId: '', type: '', status: '', riskLevel: '', startDate: '', endDate: '' },
        page: 1,
      });
    }),
    setPage: vi.fn((page: number) => {
      useOperationsStore.setState({ page });
    }),
    setSelectedOperation: vi.fn((op: Operation | null) => {
      useOperationsStore.setState({ selectedOperation: op });
    }),
    clearError: vi.fn(),
    ...overrides,
  });
}

describe('Operations Page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupStore();
  });

  describe('rendering', () => {
    it('renders page title and description', () => {
      renderOperations();
      expect(screen.getByText('Operations')).toBeInTheDocument();
      expect(
        screen.getByText('Operation history and audit logs.')
      ).toBeInTheDocument();
    });

    it('renders the operations page container', () => {
      renderOperations();
      expect(screen.getByTestId('operations-page')).toBeInTheDocument();
    });

    it('calls fetchOperations and fetchStats on mount', () => {
      const fetchOperations = vi.fn().mockResolvedValue(undefined);
      const fetchStats = vi.fn().mockResolvedValue(undefined);
      setupStore({ fetchOperations, fetchStats });
      renderOperations();
      expect(fetchOperations).toHaveBeenCalled();
      expect(fetchStats).toHaveBeenCalled();
    });
  });

  describe('stats cards', () => {
    it('renders stats cards with correct data', () => {
      renderOperations();
      const statsCards = screen.getByTestId('stats-cards');
      expect(within(statsCards).getByText('42')).toBeInTheDocument();
      expect(within(statsCards).getByText('Total Operations')).toBeInTheDocument();
      expect(within(statsCards).getByText('83.3%')).toBeInTheDocument();
      expect(within(statsCards).getByText('Success Rate')).toBeInTheDocument();
      expect(within(statsCards).getByText('4s')).toBeInTheDocument();
      expect(within(statsCards).getByText('Avg Duration')).toBeInTheDocument();
      expect(within(statsCards).getByText('Risk Distribution')).toBeInTheDocument();
    });

    it('renders risk distribution numbers', () => {
      renderOperations();
      const statsCards = screen.getByTestId('stats-cards');
      expect(within(statsCards).getByText('30')).toBeInTheDocument(); // green
      expect(within(statsCards).getByText('8')).toBeInTheDocument(); // yellow
      expect(within(statsCards).getByText('3')).toBeInTheDocument(); // red
      expect(within(statsCards).getByText('1')).toBeInTheDocument(); // critical
    });

    it('shows loading state for stats', () => {
      setupStore({ isLoadingStats: true, stats: null });
      renderOperations();
      expect(screen.getByTestId('stats-loading')).toBeInTheDocument();
    });

    it('hides stats when stats is null and not loading', () => {
      setupStore({ stats: null, isLoadingStats: false });
      renderOperations();
      expect(screen.queryByTestId('stats-cards')).not.toBeInTheDocument();
    });
  });

  describe('filter bar', () => {
    it('renders filter controls', () => {
      renderOperations();
      expect(screen.getByTestId('filter-bar')).toBeInTheDocument();
      expect(screen.getByLabelText('Filter by type')).toBeInTheDocument();
      expect(screen.getByLabelText('Filter by status')).toBeInTheDocument();
      expect(screen.getByLabelText('Filter by risk level')).toBeInTheDocument();
      expect(screen.getByLabelText('Start date')).toBeInTheDocument();
      expect(screen.getByLabelText('End date')).toBeInTheDocument();
    });

    it('calls setFilters when type filter changes', async () => {
      const user = userEvent.setup();
      const setFilters = vi.fn((partial) => {
        const current = useOperationsStore.getState().filters;
        useOperationsStore.setState({ filters: { ...current, ...partial }, page: 1 });
      });
      setupStore({ setFilters });
      renderOperations();

      await user.selectOptions(screen.getByLabelText('Filter by type'), 'install');
      expect(setFilters).toHaveBeenCalledWith({ type: 'install' });
    });

    it('calls setFilters when status filter changes', async () => {
      const user = userEvent.setup();
      const setFilters = vi.fn((partial) => {
        const current = useOperationsStore.getState().filters;
        useOperationsStore.setState({ filters: { ...current, ...partial }, page: 1 });
      });
      setupStore({ setFilters });
      renderOperations();

      await user.selectOptions(screen.getByLabelText('Filter by status'), 'success');
      expect(setFilters).toHaveBeenCalledWith({ status: 'success' });
    });

    it('calls setFilters when risk level filter changes', async () => {
      const user = userEvent.setup();
      const setFilters = vi.fn((partial) => {
        const current = useOperationsStore.getState().filters;
        useOperationsStore.setState({ filters: { ...current, ...partial }, page: 1 });
      });
      setupStore({ setFilters });
      renderOperations();

      await user.selectOptions(screen.getByLabelText('Filter by risk level'), 'red');
      expect(setFilters).toHaveBeenCalledWith({ riskLevel: 'red' });
    });

    it('shows reset button only when filters are active', () => {
      renderOperations();
      expect(screen.queryByTestId('reset-filters')).not.toBeInTheDocument();
    });

    it('shows reset button when filters are active', () => {
      setupStore({
        filters: {
          serverId: '',
          type: 'install',
          status: '',
          riskLevel: '',
          startDate: '',
          endDate: '',
        },
      });
      renderOperations();
      expect(screen.getByTestId('reset-filters')).toBeInTheDocument();
    });

    it('calls resetFilters when reset button is clicked', async () => {
      const user = userEvent.setup();
      const resetFilters = vi.fn(() => {
        useOperationsStore.setState({
          filters: { serverId: '', type: '', status: '', riskLevel: '', startDate: '', endDate: '' },
          page: 1,
        });
      });
      setupStore({
        filters: { serverId: '', type: 'install', status: '', riskLevel: '', startDate: '', endDate: '' },
        resetFilters,
      });
      renderOperations();

      await user.click(screen.getByTestId('reset-filters'));
      expect(resetFilters).toHaveBeenCalled();
    });
  });

  describe('operations table', () => {
    it('renders operations in table rows', () => {
      renderOperations();
      expect(screen.getByTestId('operations-table')).toBeInTheDocument();
      expect(screen.getByTestId('operation-row-op-1')).toBeInTheDocument();
      expect(screen.getByTestId('operation-row-op-2')).toBeInTheDocument();
      expect(screen.getByTestId('operation-row-op-3')).toBeInTheDocument();
    });

    it('renders table headers', () => {
      renderOperations();
      expect(screen.getByText('Time')).toBeInTheDocument();
      expect(screen.getByText('Server')).toBeInTheDocument();
      expect(screen.getByText('Risk')).toBeInTheDocument();
      expect(screen.getByText('Status')).toBeInTheDocument();
    });

    it('renders server names', () => {
      renderOperations();
      const table = screen.getByTestId('operations-table-desktop');
      expect(within(table).getAllByText('web-prod-01')).toHaveLength(2);
      expect(within(table).getByText('db-prod-01')).toBeInTheDocument();
    });

    it('renders status badges', () => {
      renderOperations();
      const table = screen.getByTestId('operations-table-desktop');
      expect(within(table).getByTestId('status-badge-success')).toBeInTheDocument();
      expect(within(table).getByTestId('status-badge-failed')).toBeInTheDocument();
      expect(within(table).getByTestId('status-badge-running')).toBeInTheDocument();
    });

    it('renders risk badges', () => {
      renderOperations();
      const table = screen.getByTestId('operations-table-desktop');
      expect(within(table).getByTestId('risk-badge-green')).toBeInTheDocument();
      expect(within(table).getByTestId('risk-badge-yellow')).toBeInTheDocument();
      expect(within(table).getByTestId('risk-badge-red')).toBeInTheDocument();
    });

    it('shows loading state', () => {
      setupStore({ isLoading: true, operations: [] });
      renderOperations();
      expect(screen.getByTestId('table-loading')).toBeInTheDocument();
    });

    it('shows error state', () => {
      setupStore({ error: 'Failed to load', operations: [] });
      renderOperations();
      expect(screen.getByTestId('table-error')).toBeInTheDocument();
      expect(screen.getByText('Failed to load')).toBeInTheDocument();
    });

    it('shows empty state', () => {
      setupStore({ operations: [], total: 0 });
      renderOperations();
      expect(screen.getByTestId('table-empty')).toBeInTheDocument();
      expect(screen.getByText('No operations found')).toBeInTheDocument();
    });
  });

  describe('operation detail dialog', () => {
    it('opens detail dialog when clicking a row', async () => {
      const user = userEvent.setup();
      renderOperations();

      await user.click(screen.getByTestId('operation-row-op-1'));

      expect(screen.getByTestId('operation-detail')).toBeInTheDocument();
      expect(screen.getByText('Operation Detail')).toBeInTheDocument();
      const dialog = screen.getByTestId('operation-detail');
      expect(within(dialog).getByText('Install nginx')).toBeInTheDocument();
    });

    it('shows commands in detail dialog', async () => {
      const user = userEvent.setup();
      renderOperations();

      await user.click(screen.getByTestId('operation-row-op-1'));

      expect(screen.getByTestId('detail-commands')).toBeInTheDocument();
      expect(screen.getByText('apt-get install nginx')).toBeInTheDocument();
    });

    it('shows output in detail dialog', async () => {
      const user = userEvent.setup();
      renderOperations();

      await user.click(screen.getByTestId('operation-row-op-1'));

      expect(screen.getByTestId('detail-output')).toBeInTheDocument();
      expect(
        screen.getByText('Successfully installed nginx 1.24')
      ).toBeInTheDocument();
    });

    it('shows operation metadata in detail dialog', async () => {
      const user = userEvent.setup();
      renderOperations();

      await user.click(screen.getByTestId('operation-row-op-1'));

      const dialog = screen.getByTestId('operation-detail');
      expect(within(dialog).getByText('Install')).toBeInTheDocument();
      expect(within(dialog).getByText('5s')).toBeInTheDocument();
    });

    it('does not show output section when output is null', async () => {
      const user = userEvent.setup();
      renderOperations();

      await user.click(screen.getByTestId('operation-row-op-2'));

      expect(screen.queryByTestId('detail-output')).not.toBeInTheDocument();
    });
  });

  describe('pagination', () => {
    it('does not show pagination when total <= PAGE_SIZE', () => {
      setupStore({ total: 3 });
      renderOperations();
      expect(screen.queryByTestId('pagination')).not.toBeInTheDocument();
    });

    it('shows pagination when total > PAGE_SIZE', () => {
      setupStore({ total: 42 });
      renderOperations();
      expect(screen.getByTestId('pagination')).toBeInTheDocument();
      expect(screen.getByText('Showing 1-20 of 42')).toBeInTheDocument();
      expect(screen.getByText('1 / 3')).toBeInTheDocument();
    });

    it('navigates to next page', async () => {
      const user = userEvent.setup();
      const setPage = vi.fn((p: number) => {
        useOperationsStore.setState({ page: p });
      });
      setupStore({ total: 42, setPage });
      renderOperations();

      await user.click(screen.getByTestId('page-next'));
      expect(setPage).toHaveBeenCalledWith(2);
    });

    it('navigates to previous page', async () => {
      const user = userEvent.setup();
      const setPage = vi.fn((p: number) => {
        useOperationsStore.setState({ page: p });
      });
      setupStore({ total: 42, page: 2, setPage });
      renderOperations();

      await user.click(screen.getByTestId('page-prev'));
      expect(setPage).toHaveBeenCalledWith(1);
    });

    it('disables previous button on first page', () => {
      setupStore({ total: 42, page: 1 });
      renderOperations();
      expect(screen.getByTestId('page-prev')).toBeDisabled();
    });

    it('disables next button on last page', () => {
      setupStore({ total: 42, page: 3 });
      renderOperations();
      expect(screen.getByTestId('page-next')).toBeDisabled();
    });
  });
});
