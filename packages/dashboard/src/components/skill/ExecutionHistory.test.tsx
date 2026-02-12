// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ExecutionHistory } from './ExecutionHistory';
import { useSkillsStore } from '@/stores/skills';
import type { SkillExecution } from '@/types/skill';

const makeExecution = (overrides: Partial<SkillExecution> = {}): SkillExecution => ({
  id: 'exec-1',
  skillId: 'sk-1',
  serverId: 'srv-1',
  userId: 'user-1',
  triggerType: 'manual',
  status: 'success',
  startedAt: '2026-01-15T10:00:00Z',
  completedAt: '2026-01-15T10:01:00Z',
  result: null,
  stepsExecuted: 3,
  duration: 60000,
  ...overrides,
});

function setupStore(overrides: Partial<ReturnType<typeof useSkillsStore.getState>> = {}) {
  useSkillsStore.setState({
    selectedExecution: null,
    isLoadingDetail: false,
    fetchExecutionDetail: vi.fn(),
    clearSelectedExecution: vi.fn(),
    ...overrides,
  });
}

describe('ExecutionHistory', () => {
  const onReExecute = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    setupStore();
  });

  it('shows empty state when executions array is empty', () => {
    render(<ExecutionHistory executions={[]} onReExecute={onReExecute} />);

    expect(screen.getByText('No executions yet.')).toBeInTheDocument();
  });

  it('renders execution rows for each execution', () => {
    const executions = [
      makeExecution({ id: 'exec-1' }),
      makeExecution({ id: 'exec-2', status: 'failed', triggerType: 'cron' }),
    ];
    render(<ExecutionHistory executions={executions} onReExecute={onReExecute} />);

    expect(screen.getByTestId('execution-row-exec-1')).toBeInTheDocument();
    expect(screen.getByTestId('execution-row-exec-2')).toBeInTheDocument();
  });

  it('displays trigger type and status badges', () => {
    render(
      <ExecutionHistory
        executions={[makeExecution({ triggerType: 'cron', status: 'failed' })]}
        onReExecute={onReExecute}
      />,
    );

    expect(screen.getByText('cron')).toBeInTheDocument();
    expect(screen.getByText('Failed')).toBeInTheDocument();
  });

  it('displays duration and step count', () => {
    render(
      <ExecutionHistory
        executions={[makeExecution({ duration: 5000, stepsExecuted: 7 })]}
        onReExecute={onReExecute}
      />,
    );

    expect(screen.getByText('5s')).toBeInTheDocument();
    expect(screen.getByText(/7/)).toBeInTheDocument();
  });

  it('calls fetchExecutionDetail when a row is clicked', async () => {
    const user = userEvent.setup();
    const fetchExecutionDetail = vi.fn();
    setupStore({ fetchExecutionDetail });

    render(
      <ExecutionHistory
        executions={[makeExecution({ id: 'exec-1', skillId: 'sk-42' })]}
        onReExecute={onReExecute}
      />,
    );

    await user.click(screen.getByTestId('execution-row-exec-1'));
    expect(fetchExecutionDetail).toHaveBeenCalledWith('sk-42', 'exec-1');
  });

  it('renders ExecutionDetail when selectedExecution is set', () => {
    const selected = makeExecution({ id: 'exec-detail', result: { output: 'Done.' } });
    setupStore({ selectedExecution: selected });

    render(
      <ExecutionHistory executions={[makeExecution()]} onReExecute={onReExecute} />,
    );

    // ExecutionDetail renders AI output
    expect(screen.getByTestId('ai-output')).toHaveTextContent('Done.');
    // List rows should not be visible
    expect(screen.queryByTestId('execution-row-exec-1')).not.toBeInTheDocument();
  });

  it('formats duration in minutes for longer durations', () => {
    render(
      <ExecutionHistory
        executions={[makeExecution({ duration: 125000 })]}
        onReExecute={onReExecute}
      />,
    );

    // 125000ms → 125s → 2m 5s
    expect(screen.getByText('2m 5s')).toBeInTheDocument();
  });

  it('hides duration when duration is null', () => {
    render(
      <ExecutionHistory
        executions={[makeExecution({ duration: null })]}
        onReExecute={onReExecute}
      />,
    );

    // No duration text rendered (no Clock icon sibling text)
    expect(screen.queryByText(/^\d+[ms]/)).not.toBeInTheDocument();
  });
});
