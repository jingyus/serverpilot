// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Tasks } from './Tasks';
import { useTasksStore } from '@/stores/tasks';
import { useServersStore } from '@/stores/servers';
import type { Task } from '@/types/dashboard';

const mockTasks: Task[] = [
  {
    id: 'task-1',
    serverId: 'srv-1',
    serverName: 'web-prod-01',
    userId: 'user-1',
    name: 'MySQL Daily Backup',
    description: 'Daily backup of MySQL database',
    cron: '0 2 * * *',
    command: 'mysqldump -u root mydb > /backup/db.sql',
    status: 'active',
    lastRun: '2026-02-09T02:00:00Z',
    lastStatus: 'success',
    nextRun: '2026-02-10T02:00:00Z',
    createdAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 'task-2',
    serverId: 'srv-2',
    serverName: 'db-prod-01',
    userId: 'user-1',
    name: 'Log Cleanup',
    description: null,
    cron: '0 3 * * 0',
    command: 'find /var/log -name "*.log" -mtime +30 -delete',
    status: 'paused',
    lastRun: '2026-02-02T03:00:00Z',
    lastStatus: 'failed',
    nextRun: null,
    createdAt: '2026-01-15T00:00:00Z',
  },
  {
    id: 'task-3',
    serverId: 'srv-1',
    serverName: 'web-prod-01',
    userId: 'user-1',
    name: 'Health Check',
    description: null,
    cron: '*/5 * * * *',
    command: 'curl -s http://localhost/health',
    status: 'active',
    lastRun: null,
    lastStatus: null,
    nextRun: '2026-02-10T00:05:00Z',
    createdAt: '2026-02-01T00:00:00Z',
  },
];

const mockServers = [
  { id: 'srv-1', name: 'web-prod-01', status: 'online' as const, tags: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
  { id: 'srv-2', name: 'db-prod-01', status: 'online' as const, tags: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
];

function renderTasks() {
  return render(
    <MemoryRouter>
      <Tasks />
    </MemoryRouter>
  );
}

function setupStores(
  taskOverrides: Partial<ReturnType<typeof useTasksStore.getState>> = {},
  serverOverrides: Partial<ReturnType<typeof useServersStore.getState>> = {},
) {
  useTasksStore.setState({
    tasks: mockTasks,
    total: mockTasks.length,
    selectedTask: null,
    filters: { serverId: '', status: '' },
    isLoading: false,
    isSubmitting: false,
    error: null,
    fetchTasks: vi.fn().mockResolvedValue(undefined),
    createTask: vi.fn().mockResolvedValue(undefined),
    updateTask: vi.fn().mockResolvedValue(undefined),
    deleteTask: vi.fn().mockResolvedValue(undefined),
    runTask: vi.fn().mockResolvedValue(undefined),
    setFilters: vi.fn((partial) => {
      const current = useTasksStore.getState().filters;
      useTasksStore.setState({ filters: { ...current, ...partial } });
    }),
    resetFilters: vi.fn(() => {
      useTasksStore.setState({ filters: { serverId: '', status: '' } });
    }),
    setSelectedTask: vi.fn((task: Task | null) => {
      useTasksStore.setState({ selectedTask: task });
    }),
    clearError: vi.fn(() => {
      useTasksStore.setState({ error: null });
    }),
    ...taskOverrides,
  });

  useServersStore.setState({
    servers: mockServers,
    isLoading: false,
    error: null,
    statusFilter: 'all',
    searchQuery: '',
    fetchServers: vi.fn().mockResolvedValue(undefined),
    addServer: vi.fn().mockResolvedValue({ server: mockServers[0], token: 'tok', installCommand: 'cmd' }),
    deleteServer: vi.fn().mockResolvedValue(undefined),
    setStatusFilter: vi.fn(),
    setSearchQuery: vi.fn(),
    clearError: vi.fn(),
    ...serverOverrides,
  });
}

describe('Tasks Page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupStores();
  });

  describe('rendering', () => {
    it('renders page title and description', () => {
      renderTasks();
      expect(screen.getByText('Scheduled Tasks')).toBeInTheDocument();
      expect(
        screen.getByText('Manage recurring scheduled tasks across your servers.')
      ).toBeInTheDocument();
    });

    it('renders the tasks page container', () => {
      renderTasks();
      expect(screen.getByTestId('tasks-page')).toBeInTheDocument();
    });

    it('renders create task button', () => {
      renderTasks();
      expect(screen.getByTestId('create-task-btn')).toBeInTheDocument();
      expect(screen.getByText('Create Task')).toBeInTheDocument();
    });

    it('calls fetchTasks and fetchServers on mount', () => {
      const fetchTasks = vi.fn().mockResolvedValue(undefined);
      const fetchServers = vi.fn().mockResolvedValue(undefined);
      setupStores({ fetchTasks }, { fetchServers });
      renderTasks();
      expect(fetchTasks).toHaveBeenCalled();
      expect(fetchServers).toHaveBeenCalled();
    });
  });

  describe('stats cards', () => {
    it('renders stats cards with correct counts', () => {
      renderTasks();
      const stats = screen.getByTestId('task-stats');
      expect(within(stats).getByText('3')).toBeInTheDocument(); // total
      expect(within(stats).getByText('Total Tasks')).toBeInTheDocument();
      expect(within(stats).getByText('Active')).toBeInTheDocument();
      expect(within(stats).getByText('Paused')).toBeInTheDocument();
      expect(within(stats).getByText('Last Run S/F')).toBeInTheDocument();
    });
  });

  describe('filter bar', () => {
    it('renders filter controls', () => {
      renderTasks();
      expect(screen.getByTestId('task-filter-bar')).toBeInTheDocument();
      expect(screen.getByLabelText('Filter by server')).toBeInTheDocument();
      expect(screen.getByLabelText('Filter by status')).toBeInTheDocument();
    });

    it('populates server filter with servers', () => {
      renderTasks();
      const serverFilter = screen.getByLabelText('Filter by server');
      expect(within(serverFilter).getByText('All Servers')).toBeInTheDocument();
      expect(within(serverFilter).getByText('web-prod-01')).toBeInTheDocument();
      expect(within(serverFilter).getByText('db-prod-01')).toBeInTheDocument();
    });

    it('calls setFilters when server filter changes', async () => {
      const user = userEvent.setup();
      const setFilters = vi.fn((partial) => {
        const current = useTasksStore.getState().filters;
        useTasksStore.setState({ filters: { ...current, ...partial } });
      });
      setupStores({ setFilters });
      renderTasks();

      await user.selectOptions(screen.getByLabelText('Filter by server'), 'srv-1');
      expect(setFilters).toHaveBeenCalledWith({ serverId: 'srv-1' });
    });

    it('calls setFilters when status filter changes', async () => {
      const user = userEvent.setup();
      const setFilters = vi.fn((partial) => {
        const current = useTasksStore.getState().filters;
        useTasksStore.setState({ filters: { ...current, ...partial } });
      });
      setupStores({ setFilters });
      renderTasks();

      await user.selectOptions(screen.getByLabelText('Filter by status'), 'active');
      expect(setFilters).toHaveBeenCalledWith({ status: 'active' });
    });

    it('does not show reset button when no filters active', () => {
      renderTasks();
      expect(screen.queryByTestId('reset-task-filters')).not.toBeInTheDocument();
    });

    it('shows reset button when filters are active', () => {
      setupStores({ filters: { serverId: 'srv-1', status: '' } });
      renderTasks();
      expect(screen.getByTestId('reset-task-filters')).toBeInTheDocument();
    });

    it('calls resetFilters when reset button clicked', async () => {
      const user = userEvent.setup();
      const resetFilters = vi.fn(() => {
        useTasksStore.setState({ filters: { serverId: '', status: '' } });
      });
      setupStores({
        filters: { serverId: 'srv-1', status: '' },
        resetFilters,
      });
      renderTasks();

      await user.click(screen.getByTestId('reset-task-filters'));
      expect(resetFilters).toHaveBeenCalled();
    });
  });

  describe('tasks table', () => {
    it('renders tasks in table rows', () => {
      renderTasks();
      expect(screen.getByTestId('tasks-table')).toBeInTheDocument();
      expect(screen.getByTestId('task-row-task-1')).toBeInTheDocument();
      expect(screen.getByTestId('task-row-task-2')).toBeInTheDocument();
      expect(screen.getByTestId('task-row-task-3')).toBeInTheDocument();
    });

    it('renders table headers', () => {
      renderTasks();
      expect(screen.getByText('Name')).toBeInTheDocument();
      expect(screen.getByText('Server')).toBeInTheDocument();
      expect(screen.getByText('Schedule')).toBeInTheDocument();
      expect(screen.getByText('Actions')).toBeInTheDocument();
    });

    it('renders task names', () => {
      renderTasks();
      const table = screen.getByTestId('tasks-table-desktop');
      expect(within(table).getByText('MySQL Daily Backup')).toBeInTheDocument();
      expect(within(table).getByText('Log Cleanup')).toBeInTheDocument();
      expect(within(table).getByText('Health Check')).toBeInTheDocument();
    });

    it('renders server names in table', () => {
      renderTasks();
      const table = screen.getByTestId('tasks-table');
      expect(within(table).getAllByText('web-prod-01')).toHaveLength(2);
      expect(within(table).getByText('db-prod-01')).toBeInTheDocument();
    });

    it('renders task status badges', () => {
      renderTasks();
      const table = screen.getByTestId('tasks-table-desktop');
      expect(within(table).getAllByTestId('task-status-active')).toHaveLength(2);
      expect(within(table).getByTestId('task-status-paused')).toBeInTheDocument();
    });

    it('renders last run badges', () => {
      renderTasks();
      const table = screen.getByTestId('tasks-table-desktop');
      expect(within(table).getByTestId('last-status-success')).toBeInTheDocument();
      expect(within(table).getByTestId('last-status-failed')).toBeInTheDocument();
      expect(within(table).getByTestId('last-status-none')).toBeInTheDocument();
    });

    it('renders cron expressions', () => {
      renderTasks();
      const table = screen.getByTestId('tasks-table-desktop');
      expect(within(table).getByText('0 2 * * *')).toBeInTheDocument();
      expect(within(table).getByText('Daily at 02:00')).toBeInTheDocument();
    });

    it('renders action buttons for each task', () => {
      renderTasks();
      expect(screen.getByTestId('run-task-task-1')).toBeInTheDocument();
      expect(screen.getByTestId('toggle-task-task-1')).toBeInTheDocument();
      expect(screen.getByTestId('edit-task-task-1')).toBeInTheDocument();
      expect(screen.getByTestId('delete-task-task-1')).toBeInTheDocument();
    });

    it('disables run button for paused tasks', () => {
      renderTasks();
      expect(screen.getByTestId('run-task-task-2')).toBeDisabled();
    });

    it('shows loading state', () => {
      setupStores({ isLoading: true, tasks: [] });
      renderTasks();
      expect(screen.getByTestId('tasks-loading')).toBeInTheDocument();
    });

    it('shows error state when tasks are empty and error exists', () => {
      setupStores({ error: 'Failed to load tasks', tasks: [], isLoading: false });
      renderTasks();
      const errorEl = screen.getByTestId('tasks-error');
      expect(errorEl).toBeInTheDocument();
      expect(within(errorEl).getByText('Failed to load tasks')).toBeInTheDocument();
    });

    it('shows empty state', () => {
      setupStores({ tasks: [], total: 0 });
      renderTasks();
      expect(screen.getByTestId('tasks-empty')).toBeInTheDocument();
      expect(screen.getByText('No scheduled tasks')).toBeInTheDocument();
    });
  });

  describe('task actions', () => {
    it('calls runTask when run button is clicked', async () => {
      const user = userEvent.setup();
      const runTask = vi.fn().mockResolvedValue(undefined);
      setupStores({ runTask });
      renderTasks();

      await user.click(screen.getByTestId('run-task-task-1'));
      expect(runTask).toHaveBeenCalledWith('task-1');
    });

    it('calls updateTask to pause when toggle button is clicked for active task', async () => {
      const user = userEvent.setup();
      const updateTask = vi.fn().mockResolvedValue(undefined);
      setupStores({ updateTask });
      renderTasks();

      await user.click(screen.getByTestId('toggle-task-task-1'));
      expect(updateTask).toHaveBeenCalledWith('task-1', { status: 'paused' });
    });

    it('calls updateTask to resume when toggle button is clicked for paused task', async () => {
      const user = userEvent.setup();
      const updateTask = vi.fn().mockResolvedValue(undefined);
      setupStores({ updateTask });
      renderTasks();

      await user.click(screen.getByTestId('toggle-task-task-2'));
      expect(updateTask).toHaveBeenCalledWith('task-2', { status: 'active' });
    });

    it('opens delete confirmation dialog', async () => {
      const user = userEvent.setup();
      renderTasks();

      await user.click(screen.getByTestId('delete-task-task-1'));
      expect(screen.getByTestId('delete-task-dialog')).toBeInTheDocument();
      const dialog = screen.getByTestId('delete-task-dialog');
      expect(within(dialog).getByText(/MySQL Daily Backup/)).toBeInTheDocument();
    });

    it('calls deleteTask on confirm delete', async () => {
      const user = userEvent.setup();
      const deleteTask = vi.fn().mockResolvedValue(undefined);
      setupStores({ deleteTask });
      renderTasks();

      await user.click(screen.getByTestId('delete-task-task-1'));
      await user.click(screen.getByTestId('confirm-delete'));
      expect(deleteTask).toHaveBeenCalledWith('task-1');
    });
  });

  describe('create task dialog', () => {
    it('opens create dialog when create button is clicked', async () => {
      const user = userEvent.setup();
      renderTasks();

      await user.click(screen.getByTestId('create-task-btn'));
      expect(screen.getByTestId('create-task-dialog')).toBeInTheDocument();
      expect(screen.getByText('Create Scheduled Task')).toBeInTheDocument();
    });

    it('renders all form fields', async () => {
      const user = userEvent.setup();
      renderTasks();

      await user.click(screen.getByTestId('create-task-btn'));
      expect(screen.getByTestId('input-task-name')).toBeInTheDocument();
      expect(screen.getByTestId('input-task-server')).toBeInTheDocument();
      expect(screen.getByTestId('input-task-cron')).toBeInTheDocument();
      expect(screen.getByTestId('input-task-command')).toBeInTheDocument();
      expect(screen.getByTestId('input-task-description')).toBeInTheDocument();
    });

    it('shows validation errors when submitting empty form', async () => {
      const user = userEvent.setup();
      renderTasks();

      await user.click(screen.getByTestId('create-task-btn'));
      await user.click(screen.getByTestId('submit-create-task'));

      expect(screen.getByText('Task name is required')).toBeInTheDocument();
      expect(screen.getByText('Server is required')).toBeInTheDocument();
      expect(screen.getByText('Cron expression is required')).toBeInTheDocument();
      expect(screen.getByText('Command is required')).toBeInTheDocument();
    });

    it('shows cron description when valid cron is entered', async () => {
      const user = userEvent.setup();
      renderTasks();

      await user.click(screen.getByTestId('create-task-btn'));
      await user.type(screen.getByTestId('input-task-cron'), '0 3 * * *');

      expect(screen.getByTestId('cron-description')).toBeInTheDocument();
      expect(screen.getByText('Daily at 03:00')).toBeInTheDocument();
    });

    it('calls createTask with correct data on submit', async () => {
      const user = userEvent.setup();
      const createTask = vi.fn().mockResolvedValue(undefined);
      setupStores({ createTask });
      renderTasks();

      await user.click(screen.getByTestId('create-task-btn'));
      await user.type(screen.getByTestId('input-task-name'), 'New Task');
      await user.selectOptions(screen.getByTestId('input-task-server'), 'srv-1');
      await user.type(screen.getByTestId('input-task-cron'), '0 2 * * *');
      await user.type(screen.getByTestId('input-task-command'), 'echo hello');
      await user.click(screen.getByTestId('submit-create-task'));

      expect(createTask).toHaveBeenCalledWith({
        name: 'New Task',
        serverId: 'srv-1',
        cron: '0 2 * * *',
        command: 'echo hello',
      });
    });

    it('populates server dropdown from servers store', async () => {
      const user = userEvent.setup();
      renderTasks();

      await user.click(screen.getByTestId('create-task-btn'));
      const serverSelect = screen.getByTestId('input-task-server');
      expect(within(serverSelect).getByText('web-prod-01')).toBeInTheDocument();
      expect(within(serverSelect).getByText('db-prod-01')).toBeInTheDocument();
    });
  });

  describe('edit task dialog', () => {
    it('opens edit dialog with pre-filled data', async () => {
      const user = userEvent.setup();
      renderTasks();

      await user.click(screen.getByTestId('edit-task-task-1'));
      expect(screen.getByTestId('edit-task-dialog')).toBeInTheDocument();
      expect(screen.getByTestId('edit-input-task-name')).toHaveValue('MySQL Daily Backup');
      expect(screen.getByTestId('edit-input-task-cron')).toHaveValue('0 2 * * *');
      expect(screen.getByTestId('edit-input-task-command')).toHaveValue(
        'mysqldump -u root mydb > /backup/db.sql'
      );
    });

    it('calls updateTask on submit', async () => {
      const user = userEvent.setup();
      const updateTask = vi.fn().mockResolvedValue(undefined);
      setupStores({ updateTask });
      renderTasks();

      await user.click(screen.getByTestId('edit-task-task-1'));
      const nameInput = screen.getByTestId('edit-input-task-name');
      await user.clear(nameInput);
      await user.type(nameInput, 'Updated Name');
      await user.click(screen.getByTestId('submit-edit-task'));

      expect(updateTask).toHaveBeenCalledWith('task-1', expect.objectContaining({
        name: 'Updated Name',
      }));
    });
  });

  describe('error banner', () => {
    it('shows error banner when page-level error exists', () => {
      setupStores({ error: 'Something went wrong', tasks: mockTasks });
      renderTasks();
      const errorBanner = screen.getByTestId('page-error');
      expect(errorBanner).toBeInTheDocument();
      expect(within(errorBanner).getByText('Something went wrong')).toBeInTheDocument();
    });

    it('calls clearError when dismiss button is clicked', async () => {
      const user = userEvent.setup();
      const clearError = vi.fn(() => {
        useTasksStore.setState({ error: null });
      });
      setupStores({ error: 'Some error', clearError });
      renderTasks();

      const errorBanner = screen.getByTestId('page-error');
      const dismissBtn = within(errorBanner).getByRole('button');
      await user.click(dismissBtn);
      expect(clearError).toHaveBeenCalled();
    });
  });
});
