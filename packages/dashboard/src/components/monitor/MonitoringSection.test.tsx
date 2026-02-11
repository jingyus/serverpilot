// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { MonitoringSection } from './MonitoringSection';
import type { MetricPoint, MetricsRange } from '@/types/server';

// Mock recharts
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  LineChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Line: () => <div />,
  XAxis: () => <div />,
  YAxis: () => <div />,
  CartesianGrid: () => <div />,
  Tooltip: () => <div />,
  Legend: () => <div />,
}));

const mockData: MetricPoint[] = [
  {
    id: 'm-1',
    serverId: 'srv-1',
    cpuUsage: 30.5,
    memoryUsage: 2147483648,
    memoryTotal: 8589934592,
    diskUsage: 53687091200,
    diskTotal: 107374182400,
    networkIn: 524288,
    networkOut: 262144,
    timestamp: '2026-02-09T11:00:00Z',
  },
  {
    id: 'm-2',
    serverId: 'srv-1',
    cpuUsage: 65.2,
    memoryUsage: 4294967296,
    memoryTotal: 8589934592,
    diskUsage: 53687091200,
    diskTotal: 107374182400,
    networkIn: 1048576,
    networkOut: 524288,
    timestamp: '2026-02-09T12:00:00Z',
  },
];

describe('MonitoringSection', () => {
  const defaultProps = {
    metricsHistory: mockData,
    metricsRange: '1h' as MetricsRange,
    serverId: 'srv-1',
    onRangeChange: vi.fn(),
  };

  it('renders monitoring section', () => {
    render(<MonitoringSection {...defaultProps} />);
    expect(screen.getByTestId('monitoring-section')).toBeInTheDocument();
  });

  it('renders range selector buttons', () => {
    render(<MonitoringSection {...defaultProps} />);
    expect(screen.getByTestId('range-selector')).toBeInTheDocument();
    expect(screen.getByTestId('range-1h')).toBeInTheDocument();
    expect(screen.getByTestId('range-24h')).toBeInTheDocument();
    expect(screen.getByTestId('range-7d')).toBeInTheDocument();
  });

  it('renders range labels correctly', () => {
    render(<MonitoringSection {...defaultProps} />);
    expect(screen.getByText('1 Hour')).toBeInTheDocument();
    expect(screen.getByText('24 Hours')).toBeInTheDocument();
    expect(screen.getByText('7 Days')).toBeInTheDocument();
  });

  it('renders chart section titles', () => {
    render(<MonitoringSection {...defaultProps} />);
    expect(screen.getByText('CPU Usage')).toBeInTheDocument();
    expect(screen.getByText('Memory Usage')).toBeInTheDocument();
    expect(screen.getByText('Disk Usage')).toBeInTheDocument();
    expect(screen.getByText('Network I/O')).toBeInTheDocument();
  });

  it('calls onRangeChange when range button is clicked', async () => {
    const onRangeChange = vi.fn();
    const user = userEvent.setup();
    render(<MonitoringSection {...defaultProps} onRangeChange={onRangeChange} />);

    await user.click(screen.getByTestId('range-24h'));
    expect(onRangeChange).toHaveBeenCalledWith('24h');
  });

  it('calls onRangeChange for 7d range', async () => {
    const onRangeChange = vi.fn();
    const user = userEvent.setup();
    render(<MonitoringSection {...defaultProps} onRangeChange={onRangeChange} />);

    await user.click(screen.getByTestId('range-7d'));
    expect(onRangeChange).toHaveBeenCalledWith('7d');
  });

  it('shows empty state for all charts when no data', () => {
    render(<MonitoringSection {...defaultProps} metricsHistory={[]} />);
    expect(screen.getByTestId('chart-empty-cpu')).toBeInTheDocument();
    expect(screen.getByTestId('chart-empty-memory')).toBeInTheDocument();
    expect(screen.getByTestId('chart-empty-disk')).toBeInTheDocument();
    expect(screen.getByTestId('chart-empty-network')).toBeInTheDocument();
  });

  it('renders charts when data is available', () => {
    render(<MonitoringSection {...defaultProps} />);
    expect(screen.getByTestId('chart-cpu')).toBeInTheDocument();
    expect(screen.getByTestId('chart-memory')).toBeInTheDocument();
    expect(screen.getByTestId('chart-disk')).toBeInTheDocument();
    expect(screen.getByTestId('chart-network')).toBeInTheDocument();
  });

  it('shows offline message when server is offline and no data', () => {
    render(
      <MonitoringSection
        {...defaultProps}
        metricsHistory={[]}
        serverStatus="offline"
      />,
    );
    const empties = screen.getAllByText(
      'Server is offline. Metrics will resume when the agent reconnects.',
    );
    expect(empties).toHaveLength(4);
  });

  it('shows awaiting-first-report message for new server', () => {
    render(
      <MonitoringSection
        {...defaultProps}
        metricsHistory={[]}
        serverStatus="online"
        hasEverReported={false}
      />,
    );
    const empties = screen.getAllByText(
      'Waiting for the first metrics report from the agent.',
    );
    expect(empties).toHaveLength(4);
  });

  it('shows generic no-data message when online with history', () => {
    render(
      <MonitoringSection
        {...defaultProps}
        metricsHistory={[]}
        serverStatus="online"
        hasEverReported={true}
      />,
    );
    const empties = screen.getAllByText(
      'No data available for this time range.',
    );
    expect(empties).toHaveLength(4);
  });
});
