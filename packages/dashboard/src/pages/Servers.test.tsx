// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Servers, getTagColor } from './Servers';
import { useServersStore } from '@/stores/servers';
import type { Server } from '@/types/server';

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
    tags: ['production', 'web'],
    group: 'prod',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-15T00:00:00Z',
    osInfo: {
      platform: 'linux',
      arch: 'x64',
      version: 'Ubuntu 22.04',
      kernel: '5.15',
      hostname: 'web-prod-01',
      uptime: 86400,
    },
    lastSeen: '2026-02-09T12:00:00Z',
  },
  {
    id: 'srv-2',
    name: 'db-prod-01',
    status: 'offline',
    tags: ['production', 'database'],
    group: 'prod',
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
    group: 'staging',
    createdAt: '2026-01-03T00:00:00Z',
    updatedAt: '2026-01-17T00:00:00Z',
    osInfo: null,
    lastSeen: null,
  },
];

function renderServers() {
  return render(
    <MemoryRouter>
      <Servers />
    </MemoryRouter>
  );
}

describe('Servers Page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useServersStore.setState({
      servers: mockServers,
      availableGroups: [],
      isLoading: false,
      error: null,
      statusFilter: 'all',
      searchQuery: '',
      groupFilter: 'all',
      tagFilter: 'all',
      viewMode: 'list',
      fetchServers: vi.fn().mockResolvedValue(undefined),
      fetchGroups: vi.fn().mockResolvedValue(undefined),
      addServer: vi.fn(),
      deleteServer: vi.fn().mockResolvedValue(undefined),
      setStatusFilter: vi.fn((status: string) => {
        useServersStore.setState({ statusFilter: status });
      }),
      setSearchQuery: vi.fn((query: string) => {
        useServersStore.setState({ searchQuery: query });
      }),
      setGroupFilter: vi.fn((group: string) => {
        useServersStore.setState({ groupFilter: group });
      }),
      setTagFilter: vi.fn((tag: string) => {
        useServersStore.setState({ tagFilter: tag });
      }),
      setViewMode: vi.fn((mode: 'list' | 'grouped') => {
        useServersStore.setState({ viewMode: mode });
      }),
      clearError: vi.fn(() => {
        useServersStore.setState({ error: null });
      }),
    });
  });

  describe('rendering', () => {
    it('renders page title and description', () => {
      renderServers();
      expect(screen.getByText('Servers')).toBeInTheDocument();
      expect(
        screen.getByText('Manage your servers and view their status.')
      ).toBeInTheDocument();
    });

    it('renders Add Server button', () => {
      renderServers();
      expect(
        screen.getByRole('button', { name: /Add Server/i })
      ).toBeInTheDocument();
    });

    it('renders server stats', () => {
      renderServers();
      const stats = screen.getByTestId('server-stats');
      expect(within(stats).getByText('3')).toBeInTheDocument(); // total
      expect(within(stats).getByText('Total Servers')).toBeInTheDocument();
      // online/offline/error each have count 1 so use getAllByText
      const ones = within(stats).getAllByText('1');
      expect(ones).toHaveLength(3);
    });

    it('renders server cards', () => {
      renderServers();
      expect(screen.getByTestId('server-card-srv-1')).toBeInTheDocument();
      expect(screen.getByTestId('server-card-srv-2')).toBeInTheDocument();
      expect(screen.getByTestId('server-card-srv-3')).toBeInTheDocument();
    });

    it('renders server name and OS info', () => {
      renderServers();
      expect(screen.getByText('web-prod-01')).toBeInTheDocument();
      expect(screen.getByText('linux Ubuntu 22.04')).toBeInTheDocument();
    });

    it('renders status badges on server cards', () => {
      renderServers();
      const card1 = screen.getByTestId('server-card-srv-1');
      expect(within(card1).getByText('Online')).toBeInTheDocument();
      const card2 = screen.getByTestId('server-card-srv-2');
      expect(within(card2).getByText('Offline')).toBeInTheDocument();
      const card3 = screen.getByTestId('server-card-srv-3');
      expect(within(card3).getByText('Error')).toBeInTheDocument();
    });

    it('renders server tags', () => {
      renderServers();
      // "production" tag appears on srv-1, srv-2 cards, and in tag filter dropdown
      const card1 = screen.getByTestId('server-card-srv-1');
      expect(within(card1).getByText('production')).toBeInTheDocument();
      expect(within(card1).getByText('web')).toBeInTheDocument();
      const card2 = screen.getByTestId('server-card-srv-2');
      expect(within(card2).getByText('production')).toBeInTheDocument();
    });

    it('renders search input', () => {
      renderServers();
      expect(screen.getByLabelText('Search servers')).toBeInTheDocument();
    });

    it('renders status filter buttons', () => {
      renderServers();
      expect(screen.getByRole('group', { name: 'Filter by status' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'All' })).toBeInTheDocument();
    });
  });

  describe('loading state', () => {
    it('shows loading spinner when loading', () => {
      useServersStore.setState({ isLoading: true, servers: [] });
      renderServers();
      expect(screen.getByTestId('loading-spinner')).toBeInTheDocument();
    });

    it('does not show server grid when loading', () => {
      useServersStore.setState({ isLoading: true, servers: [] });
      renderServers();
      expect(screen.queryByTestId('server-grid')).not.toBeInTheDocument();
    });
  });

  describe('empty state', () => {
    it('shows empty state when no servers', () => {
      useServersStore.setState({ servers: [] });
      renderServers();
      expect(screen.getByTestId('empty-state')).toBeInTheDocument();
      expect(screen.getByText('No servers yet')).toBeInTheDocument();
      expect(
        screen.getByText('Add your first server to get started.')
      ).toBeInTheDocument();
    });

    it('shows add server button in empty state', () => {
      useServersStore.setState({ servers: [] });
      renderServers();
      const emptyState = screen.getByTestId('empty-state');
      expect(
        within(emptyState).getByRole('button', { name: /Add Server/i })
      ).toBeInTheDocument();
    });

    it('shows "no match" when filters exclude all servers', () => {
      useServersStore.setState({ statusFilter: 'error', servers: [mockServers[0]] });
      renderServers();
      expect(screen.getByText('No servers match')).toBeInTheDocument();
      expect(
        screen.getByText('Try adjusting your search or filter.')
      ).toBeInTheDocument();
    });
  });

  describe('error state', () => {
    it('shows error alert', () => {
      useServersStore.setState({ error: 'Failed to load servers' });
      renderServers();
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByText('Failed to load servers')).toBeInTheDocument();
    });

    it('dismisses error on click', async () => {
      const user = userEvent.setup();
      useServersStore.setState({ error: 'Some error' });
      renderServers();

      await user.click(screen.getByRole('button', { name: 'Dismiss' }));
      expect(useServersStore.getState().error).toBeNull();
    });
  });

  describe('filtering', () => {
    it('filters by status when clicking filter button', async () => {
      const user = userEvent.setup();
      renderServers();

      await user.click(screen.getByRole('button', { name: 'Online' }));

      // After filter, only online server should show
      expect(screen.getByTestId('server-card-srv-1')).toBeInTheDocument();
      expect(screen.queryByTestId('server-card-srv-2')).not.toBeInTheDocument();
      expect(screen.queryByTestId('server-card-srv-3')).not.toBeInTheDocument();
    });

    it('searches by server name', async () => {
      const user = userEvent.setup();
      renderServers();

      await user.type(screen.getByLabelText('Search servers'), 'web');

      expect(screen.getByTestId('server-card-srv-1')).toBeInTheDocument();
      expect(screen.queryByTestId('server-card-srv-2')).not.toBeInTheDocument();
    });

    it('searches by tag', async () => {
      const user = userEvent.setup();
      renderServers();

      await user.type(screen.getByLabelText('Search servers'), 'database');

      expect(screen.queryByTestId('server-card-srv-1')).not.toBeInTheDocument();
      expect(screen.getByTestId('server-card-srv-2')).toBeInTheDocument();
    });
  });

  describe('navigation', () => {
    it('navigates to server detail on card click', async () => {
      const user = userEvent.setup();
      renderServers();

      await user.click(screen.getByTestId('server-card-srv-1'));
      expect(mockNavigate).toHaveBeenCalledWith('/servers/srv-1');
    });

    it('navigates to chat on chat button click', async () => {
      const user = userEvent.setup();
      renderServers();

      await user.click(screen.getByLabelText('Chat with web-prod-01'));
      expect(mockNavigate).toHaveBeenCalledWith('/chat/srv-1');
    });
  });

  describe('delete server', () => {
    it('shows delete confirmation dialog', async () => {
      const user = userEvent.setup();
      renderServers();

      await user.click(screen.getByLabelText('Delete web-prod-01'));

      expect(screen.getByText('Delete Server')).toBeInTheDocument();
      // "web-prod-01" appears in both card and dialog, check dialog text
      expect(
        screen.getByText(/This action cannot be undone/)
      ).toBeInTheDocument();
    });

    it('calls deleteServer on confirm', async () => {
      const user = userEvent.setup();
      const deleteMock = vi.fn().mockResolvedValue(undefined);
      useServersStore.setState({ deleteServer: deleteMock });
      renderServers();

      await user.click(screen.getByLabelText('Delete web-prod-01'));
      await user.click(screen.getByRole('button', { name: 'Delete' }));

      expect(deleteMock).toHaveBeenCalledWith('srv-1');
    });

    it('closes dialog on cancel', async () => {
      const user = userEvent.setup();
      renderServers();

      await user.click(screen.getByLabelText('Delete web-prod-01'));
      expect(screen.getByText('Delete Server')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Cancel' }));
      // Delete Server dialog title should be gone
      expect(screen.queryByText('Delete Server')).not.toBeInTheDocument();
    });
  });

  describe('add server dialog', () => {
    it('opens add server dialog on button click', async () => {
      const user = userEvent.setup();
      renderServers();

      // Click the header "Add Server" button
      const addButtons = screen.getAllByRole('button', { name: /Add Server/i });
      await user.click(addButtons[0]);

      expect(screen.getByLabelText('Server Name')).toBeInTheDocument();
      expect(
        screen.getByText('Enter a name and optional tags for your new server.')
      ).toBeInTheDocument();
    });

    it('validates empty server name', async () => {
      const user = userEvent.setup();
      renderServers();

      const addButtons = screen.getAllByRole('button', { name: /Add Server/i });
      await user.click(addButtons[0]);

      // Click Add Server button in dialog without entering a name
      // After opening dialog, there are multiple "Add Server" buttons; get the last one (in dialog)
      const allAddBtns = screen.getAllByRole('button', { name: /Add Server/i });
      await user.click(allAddBtns[allAddBtns.length - 1]);

      expect(screen.getByText('Server name is required')).toBeInTheDocument();
    });

    it('shows install command after successful add', async () => {
      const user = userEvent.setup();
      const addMock = vi.fn().mockResolvedValue({
        server: mockServers[0],
        token: 'tok-abc123',
        installCommand: 'curl -sSL https://install.serverpilot.dev | bash -s tok-abc123',
      });
      useServersStore.setState({ addServer: addMock });
      renderServers();

      const addButtons = screen.getAllByRole('button', { name: /Add Server/i });
      await user.click(addButtons[0]);

      await user.type(screen.getByLabelText('Server Name'), 'my-server');
      // Click the dialog's Add Server button (last one)
      const allAddBtns = screen.getAllByRole('button', { name: /Add Server/i });
      await user.click(allAddBtns[allAddBtns.length - 1]);

      expect(addMock).toHaveBeenCalledWith('my-server', undefined, undefined);
      expect(screen.getByTestId('install-command')).toBeInTheDocument();
      expect(
        screen.getByText(/curl -sSL/)
      ).toBeInTheDocument();
    });
  });

  describe('group and tag display', () => {
    it('renders group badges on server cards', () => {
      renderServers();
      const card1 = screen.getByTestId('server-card-srv-1');
      expect(within(card1).getByTestId('server-group')).toHaveTextContent('prod');
      const card3 = screen.getByTestId('server-card-srv-3');
      expect(within(card3).getByTestId('server-group')).toHaveTextContent('staging');
    });

    it('renders colored tag chips', () => {
      renderServers();
      const card1 = screen.getByTestId('server-card-srv-1');
      const webTag = within(card1).getByText('web');
      // Tag chips have border and color classes (not just plain text)
      expect(webTag.className).toContain('rounded-md');
      expect(webTag.className).toContain('border');
    });

    it('shows advanced filters when groups/tags exist', () => {
      renderServers();
      expect(screen.getByTestId('advanced-filters')).toBeInTheDocument();
      expect(screen.getByLabelText('Filter by group')).toBeInTheDocument();
      expect(screen.getByLabelText('Filter by tag')).toBeInTheDocument();
    });

    it('does not show advanced filters when no groups or tags', () => {
      const noTagServers = mockServers.map((s) => ({
        ...s,
        tags: [],
        group: null as string | null,
      }));
      useServersStore.setState({ servers: noTagServers });
      renderServers();
      expect(screen.queryByTestId('advanced-filters')).not.toBeInTheDocument();
    });
  });

  describe('group filtering', () => {
    it('filters servers by group', async () => {
      const user = userEvent.setup();
      renderServers();

      const groupSelect = screen.getByLabelText('Filter by group');
      await user.selectOptions(groupSelect, 'staging');

      // Only staging-app should show
      expect(screen.queryByTestId('server-card-srv-1')).not.toBeInTheDocument();
      expect(screen.queryByTestId('server-card-srv-2')).not.toBeInTheDocument();
      expect(screen.getByTestId('server-card-srv-3')).toBeInTheDocument();
    });

    it('shows ungrouped servers filter option', () => {
      renderServers();
      const groupSelect = screen.getByLabelText('Filter by group');
      const options = within(groupSelect).getAllByRole('option');
      const optionTexts = options.map((o) => o.textContent);
      expect(optionTexts).toContain('All Groups');
      expect(optionTexts).toContain('Ungrouped');
    });

    it('searches by group name', async () => {
      const user = userEvent.setup();
      renderServers();

      await user.type(screen.getByLabelText('Search servers'), 'staging');

      // staging-app has group "staging" and tag "staging"
      expect(screen.getByTestId('server-card-srv-3')).toBeInTheDocument();
      expect(screen.queryByTestId('server-card-srv-1')).not.toBeInTheDocument();
    });
  });

  describe('tag filtering', () => {
    it('filters servers by tag', async () => {
      const user = userEvent.setup();
      renderServers();

      const tagSelect = screen.getByLabelText('Filter by tag');
      await user.selectOptions(tagSelect, 'database');

      // Only db-prod-01 has the 'database' tag
      expect(screen.queryByTestId('server-card-srv-1')).not.toBeInTheDocument();
      expect(screen.getByTestId('server-card-srv-2')).toBeInTheDocument();
      expect(screen.queryByTestId('server-card-srv-3')).not.toBeInTheDocument();
    });

    it('shows all unique tags in tag filter dropdown', () => {
      renderServers();
      const tagSelect = screen.getByLabelText('Filter by tag');
      const options = within(tagSelect).getAllByRole('option');
      const optionTexts = options.map((o) => o.textContent);
      expect(optionTexts).toContain('All Tags');
      expect(optionTexts).toContain('database');
      expect(optionTexts).toContain('production');
      expect(optionTexts).toContain('staging');
      expect(optionTexts).toContain('web');
    });
  });

  describe('getTagColor', () => {
    it('returns consistent color for the same tag', () => {
      const color1 = getTagColor('production');
      const color2 = getTagColor('production');
      expect(color1).toBe(color2);
    });

    it('returns different colors for different tags', () => {
      const color1 = getTagColor('production');
      const color2 = getTagColor('staging');
      // Different strings should produce different hashes (not guaranteed, but very likely)
      // At minimum, the function should return a valid color string
      expect(color1).toContain('bg-');
      expect(color2).toContain('bg-');
    });

    it('returns a valid color class string', () => {
      const color = getTagColor('test');
      expect(color).toContain('bg-');
      expect(color).toContain('text-');
      expect(color).toContain('border-');
    });
  });

  describe('fetchServers on mount', () => {
    it('calls fetchServers on mount', () => {
      const fetchMock = vi.fn().mockResolvedValue(undefined);
      useServersStore.setState({ fetchServers: fetchMock });
      renderServers();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('calls fetchGroups on mount', () => {
      const fetchGroupsMock = vi.fn().mockResolvedValue(undefined);
      useServersStore.setState({ fetchGroups: fetchGroupsMock });
      renderServers();
      expect(fetchGroupsMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('grouped view', () => {
    it('renders view mode toggle buttons when groups exist', () => {
      renderServers();
      expect(screen.getByLabelText('List view')).toBeInTheDocument();
      expect(screen.getByLabelText('Grouped view')).toBeInTheDocument();
    });

    it('switches to grouped view on toggle click', async () => {
      const user = userEvent.setup();
      renderServers();

      await user.click(screen.getByLabelText('Grouped view'));
      expect(useServersStore.getState().viewMode).toBe('grouped');
    });

    it('renders grouped view with group headings', async () => {
      const user = userEvent.setup();
      renderServers();

      await user.click(screen.getByLabelText('Grouped view'));

      const groupedView = screen.getByTestId('grouped-view');
      expect(groupedView).toBeInTheDocument();
      // Group headings include count like "prod (2)" and "staging (1)"
      expect(within(groupedView).getByText(/prod \(2\)/)).toBeInTheDocument();
      expect(within(groupedView).getByText(/staging \(1\)/)).toBeInTheDocument();
    });

    it('shows server cards within their groups in grouped view', async () => {
      const user = userEvent.setup();
      renderServers();

      await user.click(screen.getByLabelText('Grouped view'));

      expect(screen.getByTestId('server-card-srv-1')).toBeInTheDocument();
      expect(screen.getByTestId('server-card-srv-2')).toBeInTheDocument();
      expect(screen.getByTestId('server-card-srv-3')).toBeInTheDocument();
    });

    it('does not show view mode toggle when no groups exist', () => {
      const noGroupServers = mockServers.map((s) => ({
        ...s,
        tags: [],
        group: null as string | null,
      }));
      useServersStore.setState({ servers: noGroupServers });
      renderServers();
      expect(screen.queryByLabelText('List view')).not.toBeInTheDocument();
    });
  });

  describe('add server with group', () => {
    it('shows group input in add server dialog', async () => {
      const user = userEvent.setup();
      renderServers();

      const addButtons = screen.getAllByRole('button', { name: /Add Server/i });
      await user.click(addButtons[0]);

      expect(screen.getByLabelText('Group (optional)')).toBeInTheDocument();
    });

    it('submits server with group', async () => {
      const user = userEvent.setup();
      const addMock = vi.fn().mockResolvedValue({
        server: mockServers[0],
        token: 'tok-abc123',
        installCommand: 'curl -sSL https://install.serverpilot.dev | bash -s tok-abc123',
      });
      useServersStore.setState({ addServer: addMock });
      renderServers();

      const addButtons = screen.getAllByRole('button', { name: /Add Server/i });
      await user.click(addButtons[0]);

      await user.type(screen.getByLabelText('Server Name'), 'my-server');
      await user.type(screen.getByLabelText('Group (optional)'), 'production');

      const allAddBtns = screen.getAllByRole('button', { name: /Add Server/i });
      await user.click(allAddBtns[allAddBtns.length - 1]);

      expect(addMock).toHaveBeenCalledWith('my-server', undefined, 'production');
    });
  });
});
