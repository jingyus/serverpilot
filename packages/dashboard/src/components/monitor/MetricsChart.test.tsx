// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MetricsChart, sampleData } from './MetricsChart';
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

  it('shows offline message when emptyReason is offline', () => {
    render(<MetricsChart data={[]} type="cpu" emptyReason="offline" />);
    expect(screen.getByText('Server is offline. Metrics will resume when the agent reconnects.')).toBeInTheDocument();
  });

  it('shows awaiting first report message', () => {
    render(<MetricsChart data={[]} type="cpu" emptyReason="awaiting-first-report" />);
    expect(screen.getByText('Waiting for the first metrics report from the agent.')).toBeInTheDocument();
  });

  it('shows default no-data message when emptyReason is not provided', () => {
    render(<MetricsChart data={[]} type="cpu" />);
    expect(screen.getByText('No data available for this time range.')).toBeInTheDocument();
  });
});

describe('sampleData', () => {
  it('returns original data when within max points', () => {
    const data = [1, 2, 3, 4, 5];
    expect(sampleData(data, 10)).toBe(data);
  });

  it('returns original data when exactly at max points', () => {
    const data = [1, 2, 3, 4, 5];
    expect(sampleData(data, 5)).toBe(data);
  });

  it('down-samples data exceeding max points', () => {
    const data = Array.from({ length: 10 }, (_, i) => i);
    const sampled = sampleData(data, 5);
    expect(sampled).toHaveLength(5);
    expect(sampled[0]).toBe(0);
    expect(sampled[sampled.length - 1]).toBe(9);
  });

  it('preserves first and last elements', () => {
    const data = Array.from({ length: 500 }, (_, i) => i);
    const sampled = sampleData(data, 100);
    expect(sampled).toHaveLength(100);
    expect(sampled[0]).toBe(0);
    expect(sampled[99]).toBe(499);
  });

  it('handles large datasets efficiently', () => {
    const data = Array.from({ length: 10000 }, (_, i) => i);
    const sampled = sampleData(data, 200);
    expect(sampled).toHaveLength(200);
  });
});
