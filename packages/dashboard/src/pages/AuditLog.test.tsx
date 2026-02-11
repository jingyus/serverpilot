// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuditLog } from './AuditLog';
import { useAuditLogStore } from '@/stores/audit-log';
import type { AuditLogEntry } from '@/types/dashboard';

const mockLogs: AuditLogEntry[] = [
  {
    id: 'al-1',
    serverId: 'srv-1',
    userId: 'user-1',
    sessionId: 'sess-1',
    command: 'ls -la /etc',
    riskLevel: 'green',
    reason: 'Read-only command',
    matchedPattern: 'ls',
    action: 'allowed',
    auditWarnings: [],
    auditBlockers: [],
    executionResult: 'success',
    operationId: 'op-1',
    createdAt: '2026-02-09T10:00:00Z',
  },
  {
    id: 'al-2',
    serverId: 'srv-2',
    userId: 'user-1',
    sessionId: null,
    command: 'rm -rf /var/log',
    riskLevel: 'forbidden',
    reason: 'Destructive command',
    matchedPattern: 'rm -rf',
    action: 'blocked',
    auditWarnings: ['Targets system directory'],
    auditBlockers: ['Forbidden pattern: rm -rf on system path'],
    executionResult: null,
    operationId: null,
    createdAt: '2026-02-09T09:00:00Z',
  },
  {
    id: 'al-3',
    serverId: 'srv-1',
    userId: 'user-1',
    sessionId: 'sess-2',
    command: 'apt-get install nginx',
    riskLevel: 'yellow',
    reason: 'Installation command',
    matchedPattern: 'apt-get install',
    action: 'requires_confirmation',
    auditWarnings: ['Package installation'],
    auditBlockers: [],
    executionResult: 'success',
    operationId: 'op-2',
    createdAt: '2026-02-09T08:00:00Z',
  },
];

function renderAuditLog() {
  return render(
    <MemoryRouter>
      <AuditLog />
    </MemoryRouter>,
  );
}

function setupStore(overrides: Partial<ReturnType<typeof useAuditLogStore.getState>> = {}) {
  useAuditLogStore.setState({
    logs: mockLogs,
    total: mockLogs.length,
    selectedLog: null,
    filters: {
      serverId: '',
      riskLevel: '',
      action: '',
      startDate: '',
      endDate: '',
    },
    page: 1,
    isLoading: false,
    isExporting: false,
    error: null,
    fetchLogs: vi.fn().mockResolvedValue(undefined),
    exportCsv: vi.fn().mockResolvedValue(undefined),
    setFilters: vi.fn((partial) => {
      const current = useAuditLogStore.getState().filters;
      useAuditLogStore.setState({ filters: { ...current, ...partial }, page: 1 });
    }),
    resetFilters: vi.fn(() => {
      useAuditLogStore.setState({
        filters: { serverId: '', riskLevel: '', action: '', startDate: '', endDate: '' },
        page: 1,
      });
    }),
    setPage: vi.fn((page: number) => {
      useAuditLogStore.setState({ page });
    }),
    setSelectedLog: vi.fn((log: AuditLogEntry | null) => {
      useAuditLogStore.setState({ selectedLog: log });
    }),
    clearError: vi.fn(),
    ...overrides,
  });
}

describe('AuditLog Page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupStore();
  });

  describe('rendering', () => {
    it('renders page title and description', () => {
      renderAuditLog();
      expect(screen.getByText('Audit Log')).toBeInTheDocument();
      expect(
        screen.getByText('Security audit trail — command validation history.'),
      ).toBeInTheDocument();
    });

    it('renders the audit log page container', () => {
      renderAuditLog();
      expect(screen.getByTestId('audit-log-page')).toBeInTheDocument();
    });

    it('calls fetchLogs on mount', () => {
      const fetchLogs = vi.fn().mockResolvedValue(undefined);
      setupStore({ fetchLogs });
      renderAuditLog();
      expect(fetchLogs).toHaveBeenCalled();
    });
  });

  describe('stats cards', () => {
    it('renders stats cards with correct data', () => {
      renderAuditLog();
      const statsCards = screen.getByTestId('stats-cards');
      expect(within(statsCards).getByText('3')).toBeInTheDocument(); // total
      expect(within(statsCards).getByText('Total Records')).toBeInTheDocument();
      expect(within(statsCards).getByText('Allowed')).toBeInTheDocument();
      expect(within(statsCards).getByText('Blocked')).toBeInTheDocument();
      expect(within(statsCards).getByText('High Risk')).toBeInTheDocument();
      // allowed=1, blocked=1, high risk=1 — three cards show "1"
      expect(within(statsCards).getAllByText('1')).toHaveLength(3);
    });
  });

  describe('filter bar', () => {
    it('renders filter controls', () => {
      renderAuditLog();
      expect(screen.getByTestId('filter-bar')).toBeInTheDocument();
      expect(screen.getByLabelText('Filter by risk level')).toBeInTheDocument();
      expect(screen.getByLabelText('Filter by action')).toBeInTheDocument();
      expect(screen.getByLabelText('Start date')).toBeInTheDocument();
      expect(screen.getByLabelText('End date')).toBeInTheDocument();
    });

    it('calls setFilters when risk level filter changes', async () => {
      const user = userEvent.setup();
      const setFilters = vi.fn((partial) => {
        const current = useAuditLogStore.getState().filters;
        useAuditLogStore.setState({ filters: { ...current, ...partial }, page: 1 });
      });
      setupStore({ setFilters });
      renderAuditLog();

      await user.selectOptions(screen.getByLabelText('Filter by risk level'), 'critical');
      expect(setFilters).toHaveBeenCalledWith({ riskLevel: 'critical' });
    });

    it('calls setFilters when action filter changes', async () => {
      const user = userEvent.setup();
      const setFilters = vi.fn((partial) => {
        const current = useAuditLogStore.getState().filters;
        useAuditLogStore.setState({ filters: { ...current, ...partial }, page: 1 });
      });
      setupStore({ setFilters });
      renderAuditLog();

      await user.selectOptions(screen.getByLabelText('Filter by action'), 'blocked');
      expect(setFilters).toHaveBeenCalledWith({ action: 'blocked' });
    });

    it('shows reset button only when filters are active', () => {
      renderAuditLog();
      expect(screen.queryByTestId('reset-filters')).not.toBeInTheDocument();
    });

    it('shows reset button when filters are active', () => {
      setupStore({
        filters: {
          serverId: '',
          riskLevel: 'critical',
          action: '',
          startDate: '',
          endDate: '',
        },
      });
      renderAuditLog();
      expect(screen.getByTestId('reset-filters')).toBeInTheDocument();
    });

    it('calls resetFilters when reset button is clicked', async () => {
      const user = userEvent.setup();
      const resetFilters = vi.fn(() => {
        useAuditLogStore.setState({
          filters: { serverId: '', riskLevel: '', action: '', startDate: '', endDate: '' },
          page: 1,
        });
      });
      setupStore({
        filters: { serverId: '', riskLevel: 'critical', action: '', startDate: '', endDate: '' },
        resetFilters,
      });
      renderAuditLog();

      await user.click(screen.getByTestId('reset-filters'));
      expect(resetFilters).toHaveBeenCalled();
    });
  });

  describe('audit log table', () => {
    it('renders logs in table rows', () => {
      renderAuditLog();
      expect(screen.getByTestId('audit-table')).toBeInTheDocument();
      expect(screen.getByTestId('audit-row-al-1')).toBeInTheDocument();
      expect(screen.getByTestId('audit-row-al-2')).toBeInTheDocument();
      expect(screen.getByTestId('audit-row-al-3')).toBeInTheDocument();
    });

    it('renders table headers', () => {
      renderAuditLog();
      expect(screen.getByText('Time')).toBeInTheDocument();
      expect(screen.getByText('Command')).toBeInTheDocument();
      expect(screen.getByText('Risk')).toBeInTheDocument();
    });

    it('renders command text', () => {
      renderAuditLog();
      expect(screen.getByText('ls -la /etc')).toBeInTheDocument();
      expect(screen.getByText('rm -rf /var/log')).toBeInTheDocument();
    });

    it('renders risk badges', () => {
      renderAuditLog();
      expect(screen.getByTestId('risk-badge-green')).toBeInTheDocument();
      expect(screen.getByTestId('risk-badge-forbidden')).toBeInTheDocument();
      expect(screen.getByTestId('risk-badge-yellow')).toBeInTheDocument();
    });

    it('renders action badges', () => {
      renderAuditLog();
      expect(screen.getByTestId('action-badge-allowed')).toBeInTheDocument();
      expect(screen.getByTestId('action-badge-blocked')).toBeInTheDocument();
      expect(screen.getByTestId('action-badge-requires_confirmation')).toBeInTheDocument();
    });

    it('shows loading state', () => {
      setupStore({ isLoading: true, logs: [] });
      renderAuditLog();
      expect(screen.getByTestId('table-loading')).toBeInTheDocument();
    });

    it('shows error state', () => {
      setupStore({ error: 'Failed to load', logs: [] });
      renderAuditLog();
      expect(screen.getByTestId('table-error')).toBeInTheDocument();
      expect(screen.getByText('Failed to load')).toBeInTheDocument();
    });

    it('shows empty state', () => {
      setupStore({ logs: [], total: 0 });
      renderAuditLog();
      expect(screen.getByTestId('table-empty')).toBeInTheDocument();
      expect(screen.getByText('No audit logs found')).toBeInTheDocument();
    });
  });

  describe('audit detail dialog', () => {
    it('opens detail dialog when clicking a row', async () => {
      const user = userEvent.setup();
      renderAuditLog();

      await user.click(screen.getByTestId('audit-row-al-1'));

      expect(screen.getByTestId('audit-detail')).toBeInTheDocument();
      expect(screen.getByText('Audit Detail')).toBeInTheDocument();
    });

    it('shows command in detail dialog', async () => {
      const user = userEvent.setup();
      renderAuditLog();

      await user.click(screen.getByTestId('audit-row-al-1'));

      expect(screen.getByTestId('detail-command')).toBeInTheDocument();
    });

    it('shows warnings in detail dialog', async () => {
      const user = userEvent.setup();
      renderAuditLog();

      await user.click(screen.getByTestId('audit-row-al-2'));

      expect(screen.getByText('Targets system directory')).toBeInTheDocument();
    });

    it('shows blockers in detail dialog', async () => {
      const user = userEvent.setup();
      renderAuditLog();

      await user.click(screen.getByTestId('audit-row-al-2'));

      expect(screen.getByText('Forbidden pattern: rm -rf on system path')).toBeInTheDocument();
    });

    it('shows matched pattern in detail dialog', async () => {
      const user = userEvent.setup();
      renderAuditLog();

      await user.click(screen.getByTestId('audit-row-al-1'));

      const dialog = screen.getByTestId('audit-detail');
      expect(within(dialog).getByText('ls')).toBeInTheDocument();
    });
  });

  describe('export buttons', () => {
    it('renders export buttons when logs exist', () => {
      renderAuditLog();
      expect(screen.getByTestId('export-buttons')).toBeInTheDocument();
      expect(screen.getByTestId('export-csv')).toBeInTheDocument();
      expect(screen.getByTestId('export-json')).toBeInTheDocument();
    });

    it('hides export buttons when no logs', () => {
      setupStore({ logs: [], total: 0 });
      renderAuditLog();
      expect(screen.queryByTestId('export-buttons')).not.toBeInTheDocument();
    });

    it('triggers server-side CSV export on click', async () => {
      const user = userEvent.setup();
      const exportCsv = vi.fn().mockResolvedValue(undefined);
      setupStore({ exportCsv });

      renderAuditLog();
      await user.click(screen.getByTestId('export-csv'));

      expect(exportCsv).toHaveBeenCalled();
    });

    it('disables CSV button while exporting', () => {
      setupStore({ isExporting: true });
      renderAuditLog();
      expect(screen.getByTestId('export-csv')).toBeDisabled();
    });

    it('triggers JSON export on click', async () => {
      const user = userEvent.setup();
      const createObjectURL = vi.fn().mockReturnValue('blob:test');
      const revokeObjectURL = vi.fn();
      global.URL.createObjectURL = createObjectURL;
      global.URL.revokeObjectURL = revokeObjectURL;

      renderAuditLog();
      await user.click(screen.getByTestId('export-json'));

      expect(createObjectURL).toHaveBeenCalled();
      expect(revokeObjectURL).toHaveBeenCalled();
    });
  });

  describe('pagination', () => {
    it('does not show pagination when total <= PAGE_SIZE', () => {
      setupStore({ total: 3 });
      renderAuditLog();
      expect(screen.queryByTestId('pagination')).not.toBeInTheDocument();
    });

    it('shows pagination when total > PAGE_SIZE', () => {
      setupStore({ total: 42 });
      renderAuditLog();
      expect(screen.getByTestId('pagination')).toBeInTheDocument();
      expect(screen.getByText('Showing 1-20 of 42')).toBeInTheDocument();
      expect(screen.getByText('1 / 3')).toBeInTheDocument();
    });

    it('navigates to next page', async () => {
      const user = userEvent.setup();
      const setPage = vi.fn((p: number) => {
        useAuditLogStore.setState({ page: p });
      });
      setupStore({ total: 42, setPage });
      renderAuditLog();

      await user.click(screen.getByTestId('page-next'));
      expect(setPage).toHaveBeenCalledWith(2);
    });

    it('navigates to previous page', async () => {
      const user = userEvent.setup();
      const setPage = vi.fn((p: number) => {
        useAuditLogStore.setState({ page: p });
      });
      setupStore({ total: 42, page: 2, setPage });
      renderAuditLog();

      await user.click(screen.getByTestId('page-prev'));
      expect(setPage).toHaveBeenCalledWith(1);
    });

    it('disables previous button on first page', () => {
      setupStore({ total: 42, page: 1 });
      renderAuditLog();
      expect(screen.getByTestId('page-prev')).toBeDisabled();
    });

    it('disables next button on last page', () => {
      setupStore({ total: 42, page: 3 });
      renderAuditLog();
      expect(screen.getByTestId('page-next')).toBeDisabled();
    });
  });
});
