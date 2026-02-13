// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AnalyticsTab } from './AnalyticsTab';
import type { SkillStats } from '@/types/skill';

const makeStats = (overrides: Partial<SkillStats> = {}): SkillStats => ({
  totalExecutions: 120,
  successRate: 0.85,
  avgDuration: 3500,
  topSkills: [
    { skillId: 'sk-1', skillName: 'disk-cleanup', executionCount: 50, successCount: 45 },
    { skillId: 'sk-2', skillName: 'log-rotate', executionCount: 40, successCount: 38 },
    { skillId: 'sk-3', skillName: 'cert-renew', executionCount: 30, successCount: 28 },
  ],
  dailyTrend: [
    { date: '2026-02-10', total: 10, success: 8, failed: 2 },
    { date: '2026-02-11', total: 15, success: 12, failed: 3 },
    { date: '2026-02-12', total: 8, success: 7, failed: 1 },
  ],
  triggerDistribution: [
    { triggerType: 'manual', count: 60 },
    { triggerType: 'cron', count: 40 },
    { triggerType: 'event', count: 20 },
  ],
  ...overrides,
});

describe('AnalyticsTab', () => {
  // --------------------------------------------------------------------------
  // Loading state
  // --------------------------------------------------------------------------

  it('shows spinner when isLoading is true', () => {
    const { container } = render(<AnalyticsTab stats={null} isLoading={true} />);

    const spinner = container.querySelector('.animate-spin');
    expect(spinner).toBeInTheDocument();
  });

  // --------------------------------------------------------------------------
  // Empty state
  // --------------------------------------------------------------------------

  it('shows empty state when stats is null', () => {
    render(<AnalyticsTab stats={null} isLoading={false} />);

    expect(screen.getByText('No execution data yet.')).toBeInTheDocument();
    expect(screen.getByText('Execute some skills to see analytics here.')).toBeInTheDocument();
  });

  it('shows empty state when totalExecutions is 0', () => {
    const emptyStats = makeStats({ totalExecutions: 0 });
    render(<AnalyticsTab stats={emptyStats} isLoading={false} />);

    expect(screen.getByText('No execution data yet.')).toBeInTheDocument();
  });

  // --------------------------------------------------------------------------
  // Summary cards
  // --------------------------------------------------------------------------

  it('renders summary cards with correct values', () => {
    render(<AnalyticsTab stats={makeStats()} isLoading={false} />);

    expect(screen.getByText('Total Executions')).toBeInTheDocument();
    expect(screen.getByText('120')).toBeInTheDocument();

    expect(screen.getByText('Success Rate')).toBeInTheDocument();
    expect(screen.getByText('85%')).toBeInTheDocument();

    expect(screen.getByText('Avg Duration')).toBeInTheDocument();
    expect(screen.getByText('3.5s')).toBeInTheDocument();
  });

  it('formats duration in milliseconds for values < 1s', () => {
    render(<AnalyticsTab stats={makeStats({ avgDuration: 450 })} isLoading={false} />);

    expect(screen.getByText('450ms')).toBeInTheDocument();
  });

  it('formats duration in minutes for values >= 60s', () => {
    render(<AnalyticsTab stats={makeStats({ avgDuration: 150_000 })} isLoading={false} />);

    expect(screen.getByText('2.5m')).toBeInTheDocument();
  });

  // --------------------------------------------------------------------------
  // Success rate accent color
  // --------------------------------------------------------------------------

  it('applies green accent for success rate >= 80%', () => {
    const { container } = render(<AnalyticsTab stats={makeStats({ successRate: 0.95 })} isLoading={false} />);

    const summaryCards = container.querySelectorAll('.rounded-lg.border.bg-card');
    const successCard = summaryCards[1]; // second card is success rate
    const valueEl = successCard?.querySelector('.text-2xl');
    expect(valueEl?.className).toContain('text-green-600');
  });

  it('applies yellow accent for success rate 50-79%', () => {
    const { container } = render(<AnalyticsTab stats={makeStats({ successRate: 0.65 })} isLoading={false} />);

    const summaryCards = container.querySelectorAll('.rounded-lg.border.bg-card');
    const successCard = summaryCards[1];
    const valueEl = successCard?.querySelector('.text-2xl');
    expect(valueEl?.className).toContain('text-yellow-600');
  });

  it('applies red accent for success rate < 50%', () => {
    const { container } = render(<AnalyticsTab stats={makeStats({ successRate: 0.3 })} isLoading={false} />);

    const summaryCards = container.querySelectorAll('.rounded-lg.border.bg-card');
    const successCard = summaryCards[1];
    const valueEl = successCard?.querySelector('.text-2xl');
    expect(valueEl?.className).toContain('text-red-600');
  });

  // --------------------------------------------------------------------------
  // Top Skills section
  // --------------------------------------------------------------------------

  it('renders top skills with execution counts', () => {
    render(<AnalyticsTab stats={makeStats()} isLoading={false} />);

    expect(screen.getByText('Top Skills')).toBeInTheDocument();
    expect(screen.getByText('disk-cleanup')).toBeInTheDocument();
    expect(screen.getByText('log-rotate')).toBeInTheDocument();
    expect(screen.getByText('cert-renew')).toBeInTheDocument();

    expect(screen.getByText('50 executions')).toBeInTheDocument();
    expect(screen.getByText('45 succeeded')).toBeInTheDocument();
  });

  it('hides top skills section when list is empty', () => {
    render(<AnalyticsTab stats={makeStats({ topSkills: [] })} isLoading={false} />);

    expect(screen.queryByText('Top Skills')).not.toBeInTheDocument();
  });

  // --------------------------------------------------------------------------
  // Daily Trend section
  // --------------------------------------------------------------------------

  it('renders daily trend chart section', () => {
    render(<AnalyticsTab stats={makeStats()} isLoading={false} />);

    expect(screen.getByText('Daily Trend (Last 30 Days)')).toBeInTheDocument();
  });

  it('hides daily trend section when data is empty', () => {
    render(<AnalyticsTab stats={makeStats({ dailyTrend: [] })} isLoading={false} />);

    expect(screen.queryByText('Daily Trend (Last 30 Days)')).not.toBeInTheDocument();
  });

  it('renders bar chart tooltip with day details', () => {
    render(<AnalyticsTab stats={makeStats()} isLoading={false} />);

    // Tooltips are rendered hidden (group-hover), but present in DOM
    expect(screen.getByText('2026-02-10: 10 total, 8 ok, 2 fail')).toBeInTheDocument();
    expect(screen.getByText('2026-02-11: 15 total, 12 ok, 3 fail')).toBeInTheDocument();
  });

  // --------------------------------------------------------------------------
  // Trigger Distribution section
  // --------------------------------------------------------------------------

  it('renders trigger distribution with labels and counts', () => {
    render(<AnalyticsTab stats={makeStats()} isLoading={false} />);

    expect(screen.getByText('Trigger Distribution')).toBeInTheDocument();
    expect(screen.getByText('Manual')).toBeInTheDocument();
    expect(screen.getByText('60')).toBeInTheDocument();
    expect(screen.getByText('Cron')).toBeInTheDocument();
    expect(screen.getByText('40')).toBeInTheDocument();
    expect(screen.getByText('Event')).toBeInTheDocument();
    expect(screen.getByText('20')).toBeInTheDocument();
  });

  it('hides trigger distribution section when data is empty', () => {
    render(<AnalyticsTab stats={makeStats({ triggerDistribution: [] })} isLoading={false} />);

    expect(screen.queryByText('Trigger Distribution')).not.toBeInTheDocument();
  });

  // --------------------------------------------------------------------------
  // Edge cases
  // --------------------------------------------------------------------------

  it('handles 100% success rate correctly', () => {
    render(<AnalyticsTab stats={makeStats({ successRate: 1.0 })} isLoading={false} />);

    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  it('handles 0% success rate correctly', () => {
    render(
      <AnalyticsTab
        stats={makeStats({ totalExecutions: 5, successRate: 0 })}
        isLoading={false}
      />,
    );

    expect(screen.getByText('0%')).toBeInTheDocument();
  });

  it('loading state takes priority over stats', () => {
    const { container } = render(<AnalyticsTab stats={makeStats()} isLoading={true} />);

    // Should show spinner, not stats
    expect(container.querySelector('.animate-spin')).toBeInTheDocument();
    expect(screen.queryByText('Total Executions')).not.toBeInTheDocument();
  });
});
