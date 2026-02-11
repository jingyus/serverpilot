// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MetricsChart } from './MetricsChart';
import type { MetricPoint } from '@/types/server';

// Mock recharts to avoid rendering issues in jsdom
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div data-testid="responsive-container">{children}</div>,
  LineChart: ({ children }: { children: React.ReactNode }) => <div data-testid="line-chart">{children}</div>,
  Line: ({ name }: { name: string }) => <div data-testid={`chart-line-${name}`} />,
  XAxis: () => <div data-testid="x-axis" />,
  YAxis: () => <div data-testid="y-axis" />,
  CartesianGrid: () => <div data-testid="cartesian-grid" />,
  Tooltip: () => <div data-testid="tooltip" />,
  Legend: () => <div data-testid="legend" />,
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

describe('MetricsChart', () => {
  it('renders empty state when data is empty', () => {
    render(<MetricsChart data={[]} type="cpu" />);
    expect(screen.getByTestId('chart-empty-cpu')).toBeInTheDocument();
    expect(screen.getByText('No data available for this time range.')).toBeInTheDocument();
  });

  it('renders empty state for memory chart', () => {
    render(<MetricsChart data={[]} type="memory" />);
    expect(screen.getByTestId('chart-empty-memory')).toBeInTheDocument();
  });

  it('renders empty state for disk chart', () => {
    render(<MetricsChart data={[]} type="disk" />);
    expect(screen.getByTestId('chart-empty-disk')).toBeInTheDocument();
  });

  it('renders empty state for network chart', () => {
    render(<MetricsChart data={[]} type="network" />);
    expect(screen.getByTestId('chart-empty-network')).toBeInTheDocument();
  });

  it('renders CPU chart with data', () => {
    render(<MetricsChart data={mockData} type="cpu" />);
    expect(screen.getByTestId('chart-cpu')).toBeInTheDocument();
    expect(screen.getByTestId('line-chart')).toBeInTheDocument();
  });

  it('renders memory chart with data', () => {
    render(<MetricsChart data={mockData} type="memory" />);
    expect(screen.getByTestId('chart-memory')).toBeInTheDocument();
    expect(screen.getByTestId('line-chart')).toBeInTheDocument();
  });

  it('renders disk chart with data', () => {
    render(<MetricsChart data={mockData} type="disk" />);
    expect(screen.getByTestId('chart-disk')).toBeInTheDocument();
    expect(screen.getByTestId('line-chart')).toBeInTheDocument();
  });

  it('renders network chart with data', () => {
    render(<MetricsChart data={mockData} type="network" />);
    expect(screen.getByTestId('chart-network')).toBeInTheDocument();
    expect(screen.getByTestId('line-chart')).toBeInTheDocument();
  });
});
