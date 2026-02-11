// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Alerts } from './Alerts';
import { useAlertsStore } from '@/stores/alerts';
import { useServersStore } from '@/stores/servers';
import type { Alert, AlertRule } from '@/types/dashboard';

const mockRules: AlertRule[] = [
  {
    id: 'rule-1',
    serverId: 'srv-1',
    userId: 'user-1',
    name: 'High CPU Alert',
    metricType: 'cpu',
    operator: 'gt',
    threshold: 90,
    severity: 'critical',
    enabled: true,
    emailRecipients: null,
    cooldownMinutes: 5,
    lastTriggeredAt: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 'rule-2',
    serverId: 'srv-1',
    userId: 'user-1',
    name: 'Low Disk Space',
    metricType: 'disk',
    operator: 'gt',
    threshold: 80,
    severity: 'warning',
    enabled: false,
    emailRecipients: null,
    cooldownMinutes: 10,
    lastTriggeredAt: null,
    createdAt: '2026-01-02T00:00:00Z',
    updatedAt: '2026-01-02T00:00:00Z',
  },
];

const mockAlerts: Alert[] = [
  {
    id: 'alert-1',
    serverId: 'srv-1',
    serverName: 'web-prod-01',
    type: 'cpu',
    severity: 'critical',
    message: 'CPU usage exceeded 90%',
    value: '95',
    threshold: '90',
    resolved: false,
    createdAt: '2026-02-09T10:00:00Z',
  },
  {
    id: 'alert-2',
    serverId: 'srv-1',
    serverName: 'web-prod-01',
    type: 'memory',
    severity: 'warning',
    message: 'Memory usage exceeded 80%',
    value: '85',
    threshold: '80',
    resolved: true,
    resolvedAt: '2026-02-09T10:30:00Z',
    createdAt: '2026-02-09T09:00:00Z',
  },
];

function renderAlerts() {
  return render(
    <MemoryRouter>
      <Alerts />
    </MemoryRouter>,
  );
}

function setupStore(overrides: Partial<ReturnType<typeof useAlertsStore.getState>> = {}) {
  useAlertsStore.setState({
    alerts: mockAlerts,
    alertsTotal: mockAlerts.length,
    alertsPage: 1,
    isLoadingAlerts: false,
    alertsError: null,
    rules: mockRules,
    rulesTotal: mockRules.length,
    isLoadingRules: false,
    rulesError: null,
    unresolvedCount: 1,
    activeTab: 'rules',
    successMessage: null,
    fetchAlerts: vi.fn().mockResolvedValue(undefined),
    fetchRules: vi.fn().mockResolvedValue(undefined),
    fetchUnresolvedCount: vi.fn().mockResolvedValue(undefined),
    resolveAlert: vi.fn().mockResolvedValue(undefined),
    createRule: vi.fn().mockResolvedValue(undefined),
    updateRule: vi.fn().mockResolvedValue(undefined),
    deleteRule: vi.fn().mockResolvedValue(undefined),
    setActiveTab: vi.fn((tab: 'rules' | 'history') => {
      useAlertsStore.setState({ activeTab: tab });
    }),
    setAlertsPage: vi.fn((page: number) => {
      useAlertsStore.setState({ alertsPage: page });
    }),
    clearError: vi.fn(),
    clearSuccess: vi.fn(),
    ...overrides,
  });
}

function setupServersStore() {
  useServersStore.setState({
    servers: [
      {
        id: 'srv-1',
        name: 'web-prod-01',
        status: 'online',
        tags: [],
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
    ],
    isLoading: false,
    error: null,
    statusFilter: 'all',
    searchQuery: '',
    fetchServers: vi.fn().mockResolvedValue(undefined),
    addServer: vi.fn().mockResolvedValue(undefined),
    deleteServer: vi.fn().mockResolvedValue(undefined),
    setStatusFilter: vi.fn(),
    setSearchQuery: vi.fn(),
    clearError: vi.fn(),
  });
}

describe('Alerts Page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupStore();
    setupServersStore();
  });

  describe('rendering', () => {
    it('renders page title and description', () => {
      renderAlerts();
      expect(screen.getByText('Alerts')).toBeInTheDocument();
      expect(screen.getByText('Manage alert rules and view alert history.')).toBeInTheDocument();
    });

    it('renders the alerts page container', () => {
      renderAlerts();
      expect(screen.getByTestId('alerts-page')).toBeInTheDocument();
    });

    it('calls fetch functions on mount', () => {
      const fetchRules = vi.fn().mockResolvedValue(undefined);
      const fetchAlerts = vi.fn().mockResolvedValue(undefined);
      const fetchUnresolvedCount = vi.fn().mockResolvedValue(undefined);
      setupStore({ fetchRules, fetchAlerts, fetchUnresolvedCount });
      renderAlerts();
      expect(fetchRules).toHaveBeenCalled();
      expect(fetchAlerts).toHaveBeenCalled();
      expect(fetchUnresolvedCount).toHaveBeenCalled();
    });
  });

  describe('stats cards', () => {
    it('renders stats cards with correct data', () => {
      renderAlerts();
      const stats = screen.getByTestId('alert-stats');
      expect(within(stats).getByText('2')).toBeInTheDocument(); // total rules
      expect(within(stats).getByText('Total Rules')).toBeInTheDocument();
      expect(within(stats).getAllByText('1')).toHaveLength(2); // active rules + unresolved count both = 1
      expect(within(stats).getByText('Active Rules')).toBeInTheDocument();
      expect(within(stats).getByText('Unresolved Alerts')).toBeInTheDocument();
    });
  });

  describe('tab bar', () => {
    it('renders tab bar', () => {
      renderAlerts();
      expect(screen.getByTestId('tab-bar')).toBeInTheDocument();
      expect(screen.getByText('Alert Rules')).toBeInTheDocument();
      expect(screen.getByText('Alert History')).toBeInTheDocument();
    });

    it('switches to history tab', async () => {
      const user = userEvent.setup();
      const setActiveTab = vi.fn((tab: 'rules' | 'history') => {
        useAlertsStore.setState({ activeTab: tab });
      });
      setupStore({ setActiveTab });
      renderAlerts();

      await user.click(screen.getByText('Alert History'));
      expect(setActiveTab).toHaveBeenCalledWith('history');
    });
  });

  describe('rules tab', () => {
    it('renders alert rules list', () => {
      renderAlerts();
      expect(screen.getByTestId('rules-list')).toBeInTheDocument();
      expect(screen.getByTestId('rule-card-rule-1')).toBeInTheDocument();
      expect(screen.getByTestId('rule-card-rule-2')).toBeInTheDocument();
    });

    it('renders rule names and details', () => {
      renderAlerts();
      expect(screen.getByText('High CPU Alert')).toBeInTheDocument();
      expect(screen.getByText('Low Disk Space')).toBeInTheDocument();
      expect(screen.getByText(/CPU > 90%/)).toBeInTheDocument();
      expect(screen.getByText(/Disk > 80%/)).toBeInTheDocument();
    });

    it('renders severity badges', () => {
      renderAlerts();
      expect(screen.getByTestId('severity-critical')).toBeInTheDocument();
      expect(screen.getByTestId('severity-warning')).toBeInTheDocument();
    });

    it('renders disabled badge for disabled rules', () => {
      renderAlerts();
      expect(screen.getByText('Disabled')).toBeInTheDocument();
    });

    it('renders create rule button', () => {
      renderAlerts();
      expect(screen.getByTestId('create-rule-btn')).toBeInTheDocument();
    });

    it('shows loading state for rules', () => {
      setupStore({ isLoadingRules: true, rules: [] });
      renderAlerts();
      expect(screen.getByTestId('rules-loading')).toBeInTheDocument();
    });

    it('shows error state for rules', () => {
      setupStore({ rulesError: 'Failed to load', rules: [] });
      renderAlerts();
      expect(screen.getByTestId('rules-error')).toBeInTheDocument();
      expect(screen.getByText('Failed to load')).toBeInTheDocument();
    });

    it('shows empty state when no rules', () => {
      setupStore({ rules: [], rulesTotal: 0 });
      renderAlerts();
      expect(screen.getByTestId('rules-empty')).toBeInTheDocument();
      expect(screen.getByText('No alert rules configured')).toBeInTheDocument();
    });
  });

  describe('rule form dialog', () => {
    it('opens create rule dialog when clicking New Rule button', async () => {
      const user = userEvent.setup();
      renderAlerts();

      await user.click(screen.getByTestId('create-rule-btn'));
      expect(screen.getByTestId('rule-form-dialog')).toBeInTheDocument();
      expect(screen.getByText('Create Alert Rule')).toBeInTheDocument();
    });

    it('shows server dropdown in form', async () => {
      const user = userEvent.setup();
      renderAlerts();

      await user.click(screen.getByTestId('create-rule-btn'));
      expect(screen.getByLabelText('Server')).toBeInTheDocument();
      expect(screen.getByText('web-prod-01')).toBeInTheDocument();
    });

    it('shows form fields', async () => {
      const user = userEvent.setup();
      renderAlerts();

      await user.click(screen.getByTestId('create-rule-btn'));
      expect(screen.getByLabelText('Rule Name')).toBeInTheDocument();
      expect(screen.getByLabelText('Metric')).toBeInTheDocument();
      expect(screen.getByLabelText('Operator')).toBeInTheDocument();
      expect(screen.getByLabelText('Threshold %')).toBeInTheDocument();
      expect(screen.getByLabelText('Severity')).toBeInTheDocument();
      expect(screen.getByLabelText('Cooldown (min)')).toBeInTheDocument();
    });

    it('shows validation error when fields are empty', async () => {
      const user = userEvent.setup();
      renderAlerts();

      await user.click(screen.getByTestId('create-rule-btn'));
      await user.click(screen.getByText('Create Rule'));

      expect(screen.getByText('Server and rule name are required')).toBeInTheDocument();
    });
  });

  describe('delete rule dialog', () => {
    it('opens delete confirmation when clicking delete button', async () => {
      const user = userEvent.setup();
      renderAlerts();

      const deleteButtons = screen.getAllByTitle('Delete');
      await user.click(deleteButtons[0]);

      const dialog = screen.getByTestId('delete-rule-dialog');
      expect(dialog).toBeInTheDocument();
      expect(within(dialog).getByText(/High CPU Alert/)).toBeInTheDocument();
    });
  });

  describe('history tab', () => {
    it('renders alerts table when on history tab', () => {
      setupStore({ activeTab: 'history' });
      renderAlerts();
      expect(screen.getByTestId('alerts-table')).toBeInTheDocument();
    });

    it('renders alert rows', () => {
      setupStore({ activeTab: 'history' });
      renderAlerts();
      expect(screen.getByTestId('alert-row-alert-1')).toBeInTheDocument();
      expect(screen.getByTestId('alert-row-alert-2')).toBeInTheDocument();
    });

    it('renders alert type badges', () => {
      setupStore({ activeTab: 'history' });
      renderAlerts();
      expect(screen.getByText('CPU')).toBeInTheDocument();
      expect(screen.getByText('MEMORY')).toBeInTheDocument();
    });

    it('renders alert status badges', () => {
      setupStore({ activeTab: 'history' });
      renderAlerts();
      expect(screen.getByText('Active')).toBeInTheDocument();
      expect(screen.getByText('Resolved')).toBeInTheDocument();
    });

    it('renders resolve button for unresolved alerts', () => {
      setupStore({ activeTab: 'history' });
      renderAlerts();
      expect(screen.getByTestId('resolve-btn-alert-1')).toBeInTheDocument();
    });

    it('calls resolveAlert when clicking resolve', async () => {
      const user = userEvent.setup();
      const resolveAlert = vi.fn().mockResolvedValue(undefined);
      setupStore({ activeTab: 'history', resolveAlert });
      renderAlerts();

      await user.click(screen.getByTestId('resolve-btn-alert-1'));
      expect(resolveAlert).toHaveBeenCalledWith('alert-1');
    });

    it('shows loading state for history', () => {
      setupStore({ activeTab: 'history', isLoadingAlerts: true, alerts: [] });
      renderAlerts();
      expect(screen.getByTestId('history-loading')).toBeInTheDocument();
    });

    it('shows error state for history', () => {
      setupStore({ activeTab: 'history', alertsError: 'Load failed', alerts: [] });
      renderAlerts();
      expect(screen.getByTestId('history-error')).toBeInTheDocument();
      expect(screen.getByText('Load failed')).toBeInTheDocument();
    });

    it('shows empty state for history', () => {
      setupStore({ activeTab: 'history', alerts: [], alertsTotal: 0 });
      renderAlerts();
      expect(screen.getByTestId('history-empty')).toBeInTheDocument();
      expect(screen.getByText('No alerts triggered')).toBeInTheDocument();
    });

    it('shows table headers', () => {
      setupStore({ activeTab: 'history' });
      renderAlerts();
      expect(screen.getByText('Time')).toBeInTheDocument();
      expect(screen.getByText('Type')).toBeInTheDocument();
      expect(screen.getByText('Severity')).toBeInTheDocument();
      expect(screen.getByText('Status')).toBeInTheDocument();
      expect(screen.getByText('Action')).toBeInTheDocument();
    });
  });

  describe('success message', () => {
    it('shows success message when present', () => {
      setupStore({ successMessage: 'Alert rule created' });
      renderAlerts();
      expect(screen.getByTestId('success-message')).toBeInTheDocument();
      expect(screen.getByText('Alert rule created')).toBeInTheDocument();
    });

    it('dismisses success message on click', async () => {
      const user = userEvent.setup();
      const clearSuccess = vi.fn();
      setupStore({ successMessage: 'Done', clearSuccess });
      renderAlerts();

      const dismissBtn = within(screen.getByTestId('success-message')).getByRole('button');
      await user.click(dismissBtn);
      expect(clearSuccess).toHaveBeenCalled();
    });
  });
});
