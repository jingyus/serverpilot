// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ServerDetail } from './ServerDetail';
import { useServerDetailStore } from '@/stores/server-detail';
import type { Server, ServerProfile, Metrics, MetricPoint } from '@/types/server';

// Mock recharts to avoid rendering issues in jsdom
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div data-testid="responsive-container">{children}</div>,
  LineChart: ({ children }: { children: React.ReactNode }) => <div data-testid="line-chart">{children}</div>,
  Line: () => <div data-testid="chart-line" />,
  XAxis: () => <div />,
  YAxis: () => <div />,
  CartesianGrid: () => <div />,
  Tooltip: () => <div />,
  Legend: () => <div />,
}));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

const mockServer: Server = {
  id: 'srv-1',
  name: 'web-prod-01',
  status: 'online',
  tags: ['production', 'web'],
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
};

const mockProfile: ServerProfile = {
  services: [
    { name: 'nginx', status: 'running', ports: [80, 443], manager: 'systemd', uptime: '5d 3h' },
    { name: 'postgresql', status: 'running', ports: [5432], manager: 'systemd' },
    { name: 'redis', status: 'stopped', ports: [6379], manager: 'systemd' },
    { name: 'cron-job', status: 'failed', ports: [] },
  ],
  software: [
    { name: 'Node.js', version: '22.0.0', configPath: '/etc/nodejs', ports: [3000] },
    { name: 'PostgreSQL', version: '16.1', configPath: '/etc/postgresql/16/main', dataPath: '/var/lib/postgresql/16/main' },
    { name: 'Nginx', version: '1.24.0', configPath: '/etc/nginx' },
  ],
  preferences: null,
};

const mockMetrics: Metrics = {
  cpuUsage: 45.2,
  memoryUsage: 4294967296,   // 4 GB
  memoryTotal: 8589934592,   // 8 GB
  diskUsage: 53687091200,    // 50 GB
  diskTotal: 107374182400,   // 100 GB
  networkIn: 1048576,        // 1 MB
  networkOut: 524288,         // 512 KB
  timestamp: '2026-02-09T12:00:00Z',
};

function renderServerDetail(id = 'srv-1') {
  return render(
    <MemoryRouter initialEntries={[`/servers/${id}`]}>
      <Routes>
        <Route path="/servers/:id" element={<ServerDetail />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('ServerDetail Page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useServerDetailStore.setState({
      server: mockServer,
      profile: mockProfile,
      metrics: mockMetrics,
      metricsHistory: [],
      metricsRange: '1h',
      isLoading: false,
      isProfileLoading: false,
      isMetricsLoading: false,
      error: null,
      fetchServer: vi.fn(),
      fetchProfile: vi.fn(),
      fetchMetrics: vi.fn(),
      setMetricsRange: vi.fn(),
      clearError: vi.fn(() => useServerDetailStore.setState({ error: null })),
      reset: vi.fn(),
    });
  });

  describe('rendering', () => {
    it('renders server name and status', () => {
      renderServerDetail();
      expect(screen.getByText('web-prod-01')).toBeInTheDocument();
      expect(screen.getByText('Online')).toBeInTheDocument();
    });

    it('renders OS info', () => {
      renderServerDetail();
      expect(screen.getByText(/linux Ubuntu 22\.04/)).toBeInTheDocument();
      expect(screen.getByText(/x64/)).toBeInTheDocument();
    });

    it('renders server tags', () => {
      renderServerDetail();
      expect(screen.getByText('production')).toBeInTheDocument();
      expect(screen.getByText('web')).toBeInTheDocument();
    });

    it('renders server info summary', () => {
      renderServerDetail();
      const info = screen.getByTestId('server-info');
      expect(within(info).getByText(/Kernel: 5\.15/)).toBeInTheDocument();
      expect(within(info).getByText(/Hostname: web-prod-01/)).toBeInTheDocument();
    });

    it('renders Chat with AI button', () => {
      renderServerDetail();
      expect(screen.getByRole('button', { name: /Chat with AI/i })).toBeInTheDocument();
    });

    it('renders back button', () => {
      renderServerDetail();
      expect(screen.getByRole('button', { name: 'Back to servers' })).toBeInTheDocument();
    });

    it('renders section titles', () => {
      renderServerDetail();
      expect(screen.getByText('Monitoring')).toBeInTheDocument();
      expect(screen.getByText('Services')).toBeInTheDocument();
      expect(screen.getByText('Software Inventory')).toBeInTheDocument();
    });
  });

  describe('monitoring section', () => {
    it('renders CPU metric', () => {
      renderServerDetail();
      const cpu = screen.getByTestId('metric-cpu');
      expect(within(cpu).getByText('CPU Usage')).toBeInTheDocument();
      expect(within(cpu).getByText('45.2%')).toBeInTheDocument();
    });

    it('renders memory metric', () => {
      renderServerDetail();
      const mem = screen.getByTestId('metric-memory');
      expect(within(mem).getByText('Memory')).toBeInTheDocument();
      expect(within(mem).getByText('50.0%')).toBeInTheDocument();
    });

    it('renders disk metric', () => {
      renderServerDetail();
      const disk = screen.getByTestId('metric-disk');
      expect(within(disk).getByText('Disk')).toBeInTheDocument();
      expect(within(disk).getByText('50.0%')).toBeInTheDocument();
    });

    it('renders network metric', () => {
      renderServerDetail();
      const net = screen.getByTestId('metric-network');
      expect(within(net).getByText('Network')).toBeInTheDocument();
    });

    it('shows no metrics message when metrics is null', () => {
      useServerDetailStore.setState({ metrics: null });
      renderServerDetail();
      expect(screen.getByTestId('no-metrics')).toBeInTheDocument();
      expect(screen.getByText(/No metrics data available/)).toBeInTheDocument();
    });

    it('shows metrics loading state', () => {
      useServerDetailStore.setState({ isMetricsLoading: true });
      renderServerDetail();
      expect(screen.getByTestId('metrics-loading')).toBeInTheDocument();
    });
  });

  describe('services section', () => {
    it('renders services list', () => {
      renderServerDetail();
      expect(screen.getByTestId('services-list')).toBeInTheDocument();
      expect(screen.getByTestId('service-nginx')).toBeInTheDocument();
      expect(screen.getByTestId('service-postgresql')).toBeInTheDocument();
      expect(screen.getByTestId('service-redis')).toBeInTheDocument();
    });

    it('renders service status summary', () => {
      renderServerDetail();
      const summary = screen.getByTestId('services-summary');
      expect(within(summary).getByText('2 running')).toBeInTheDocument();
      expect(within(summary).getByText('1 stopped')).toBeInTheDocument();
      expect(within(summary).getByText('1 failed')).toBeInTheDocument();
    });

    it('renders service details', () => {
      renderServerDetail();
      const nginx = screen.getByTestId('service-nginx');
      expect(within(nginx).getByText('nginx')).toBeInTheDocument();
      expect(within(nginx).getByText('systemd')).toBeInTheDocument();
      expect(within(nginx).getByText('Running')).toBeInTheDocument();
      expect(within(nginx).getByText(':80, :443')).toBeInTheDocument();
      expect(within(nginx).getByText('5d 3h')).toBeInTheDocument();
    });

    it('shows no services message when empty', () => {
      useServerDetailStore.setState({
        profile: { services: [], software: [], preferences: null },
      });
      renderServerDetail();
      expect(screen.getByTestId('no-services')).toBeInTheDocument();
      expect(screen.getByText('No services detected.')).toBeInTheDocument();
    });

    it('shows profile loading state', () => {
      useServerDetailStore.setState({ isProfileLoading: true });
      renderServerDetail();
      expect(screen.getByTestId('profile-loading')).toBeInTheDocument();
    });
  });

  describe('software section', () => {
    it('renders software list', () => {
      renderServerDetail();
      expect(screen.getByTestId('software-list')).toBeInTheDocument();
      expect(screen.getByTestId('software-Node.js')).toBeInTheDocument();
      expect(screen.getByTestId('software-PostgreSQL')).toBeInTheDocument();
      expect(screen.getByTestId('software-Nginx')).toBeInTheDocument();
    });

    it('renders software details', () => {
      renderServerDetail();
      const node = screen.getByTestId('software-Node.js');
      expect(within(node).getByText('Node.js')).toBeInTheDocument();
      expect(within(node).getByText('22.0.0')).toBeInTheDocument();
      expect(within(node).getByText('Config: /etc/nodejs')).toBeInTheDocument();
      expect(within(node).getByText(':3000')).toBeInTheDocument();
    });

    it('shows no software message when empty', () => {
      useServerDetailStore.setState({
        profile: { services: [], software: [], preferences: null },
      });
      renderServerDetail();
      expect(screen.getByTestId('no-software')).toBeInTheDocument();
      expect(screen.getByText('No software inventory available.')).toBeInTheDocument();
    });
  });

  describe('loading state', () => {
    it('shows loading spinner when loading', () => {
      useServerDetailStore.setState({ isLoading: true, server: null });
      renderServerDetail();
      expect(screen.getByTestId('loading-spinner')).toBeInTheDocument();
    });

    it('does not show server detail when loading', () => {
      useServerDetailStore.setState({ isLoading: true, server: null });
      renderServerDetail();
      expect(screen.queryByTestId('server-detail')).not.toBeInTheDocument();
    });
  });

  describe('error state', () => {
    it('shows error state when error and no server', () => {
      useServerDetailStore.setState({ error: 'Server not found', server: null });
      renderServerDetail();
      expect(screen.getByTestId('error-state')).toBeInTheDocument();
      expect(screen.getByText('Server not found')).toBeInTheDocument();
    });

    it('shows back button in error state', () => {
      useServerDetailStore.setState({ error: 'Server not found', server: null });
      renderServerDetail();
      expect(screen.getByRole('button', { name: /Back to Servers/i })).toBeInTheDocument();
    });

    it('shows error alert when error exists but server is loaded', () => {
      useServerDetailStore.setState({ error: 'Failed to load metrics' });
      renderServerDetail();
      expect(screen.getByTestId('server-detail')).toBeInTheDocument();
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByText('Failed to load metrics')).toBeInTheDocument();
    });

    it('dismisses error on click', async () => {
      const user = userEvent.setup();
      useServerDetailStore.setState({ error: 'Some error' });
      renderServerDetail();

      await user.click(screen.getByRole('button', { name: 'Dismiss' }));
      expect(useServerDetailStore.getState().error).toBeNull();
    });
  });

  describe('navigation', () => {
    it('navigates back to servers list', async () => {
      const user = userEvent.setup();
      renderServerDetail();

      await user.click(screen.getByRole('button', { name: 'Back to servers' }));
      expect(mockNavigate).toHaveBeenCalledWith('/servers');
    });

    it('navigates to chat on button click', async () => {
      const user = userEvent.setup();
      renderServerDetail();

      await user.click(screen.getByRole('button', { name: /Chat with AI/i }));
      expect(mockNavigate).toHaveBeenCalledWith('/chat/srv-1');
    });

    it('navigates back from error state', async () => {
      const user = userEvent.setup();
      useServerDetailStore.setState({ error: 'Server not found', server: null });
      renderServerDetail();

      await user.click(screen.getByRole('button', { name: /Back to Servers/i }));
      expect(mockNavigate).toHaveBeenCalledWith('/servers');
    });
  });

  describe('data fetching', () => {
    it('calls fetch methods on mount', () => {
      const fetchServer = vi.fn();
      const fetchProfile = vi.fn();
      const fetchMetrics = vi.fn();
      useServerDetailStore.setState({ fetchServer, fetchProfile, fetchMetrics });

      renderServerDetail();

      expect(fetchServer).toHaveBeenCalledWith('srv-1');
      expect(fetchProfile).toHaveBeenCalledWith('srv-1');
      expect(fetchMetrics).toHaveBeenCalledWith('srv-1');
    });

    it('calls reset on unmount', () => {
      const resetMock = vi.fn();
      useServerDetailStore.setState({ reset: resetMock });

      const { unmount } = renderServerDetail();
      unmount();

      expect(resetMock).toHaveBeenCalled();
    });
  });

  describe('server without optional data', () => {
    it('renders server without osInfo', () => {
      useServerDetailStore.setState({
        server: { ...mockServer, osInfo: null },
      });
      renderServerDetail();
      expect(screen.getByText('web-prod-01')).toBeInTheDocument();
      expect(screen.queryByText(/Kernel:/)).not.toBeInTheDocument();
    });

    it('renders server without tags', () => {
      useServerDetailStore.setState({
        server: { ...mockServer, tags: [] },
      });
      renderServerDetail();
      expect(screen.getByText('web-prod-01')).toBeInTheDocument();
      expect(screen.queryByText('production')).not.toBeInTheDocument();
    });

    it('renders server without lastSeen', () => {
      useServerDetailStore.setState({
        server: { ...mockServer, lastSeen: null },
      });
      renderServerDetail();
      expect(screen.queryByText(/Last seen:/)).not.toBeInTheDocument();
    });
  });
});
