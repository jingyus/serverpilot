// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ExecutionDetail } from './ExecutionDetail';
import type { SkillExecution, ToolCallRecord } from '@/types/skill';

const makeToolCall = (overrides: Partial<ToolCallRecord> = {}): ToolCallRecord => ({
  toolName: 'shell',
  input: { command: 'df -h' },
  result: 'Filesystem      Size  Used\n/dev/sda1       50G   20G',
  success: true,
  duration: 1500,
  ...overrides,
});

const makeExecution = (overrides: Partial<SkillExecution> = {}): SkillExecution => ({
  id: 'exec-1',
  skillId: 'sk-1',
  serverId: 'srv-1',
  userId: 'user-1',
  triggerType: 'manual',
  status: 'success',
  startedAt: '2026-01-15T10:00:00Z',
  completedAt: '2026-01-15T10:01:00Z',
  result: {
    output: 'All tasks completed successfully.',
    toolResults: [makeToolCall(), makeToolCall({ toolName: 'read_file', input: { path: '/etc/nginx/nginx.conf' }, success: true, duration: 200 })],
    errors: [],
  },
  stepsExecuted: 2,
  duration: 60000,
  ...overrides,
});

describe('ExecutionDetail', () => {
  const defaultProps = {
    execution: makeExecution(),
    isLoading: false,
    onBack: vi.fn(),
    onReExecute: vi.fn(),
  };

  it('shows loading spinner when isLoading is true', () => {
    render(<ExecutionDetail {...defaultProps} isLoading={true} />);

    // Should not render detail content
    expect(screen.queryByTestId('ai-output')).not.toBeInTheDocument();
    expect(screen.queryByTestId('re-execute-btn')).not.toBeInTheDocument();
  });

  it('renders AI output text', () => {
    render(<ExecutionDetail {...defaultProps} />);

    expect(screen.getByTestId('ai-output')).toHaveTextContent('All tasks completed successfully.');
  });

  it('renders tool calls list', () => {
    render(<ExecutionDetail {...defaultProps} />);

    const toolList = screen.getByTestId('tool-calls-list');
    expect(toolList).toBeInTheDocument();
    expect(screen.getByText('shell')).toBeInTheDocument();
    expect(screen.getByText('read_file')).toBeInTheDocument();
  });

  it('expands tool call to show input and result on click', async () => {
    const user = userEvent.setup();
    render(<ExecutionDetail {...defaultProps} />);

    const toggleButtons = screen.getAllByTestId('tool-call-toggle');
    await user.click(toggleButtons[0]);

    // Input shows command in shell shorthand
    expect(screen.getByText('$ df -h')).toBeInTheDocument();
    // Result shows output
    expect(screen.getByText(/Filesystem/)).toBeInTheDocument();
  });

  it('renders errors when present', () => {
    const exec = makeExecution({
      status: 'failed',
      result: {
        output: '',
        toolResults: [],
        errors: ['Permission denied', 'Command not found'],
      },
    });
    render(<ExecutionDetail {...defaultProps} execution={exec} />);

    const errorList = screen.getByTestId('error-list');
    expect(errorList).toBeInTheDocument();
    expect(screen.getByText('Permission denied')).toBeInTheDocument();
    expect(screen.getByText('Command not found')).toBeInTheDocument();
  });

  it('calls onBack when back button is clicked', async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    render(<ExecutionDetail {...defaultProps} onBack={onBack} />);

    await user.click(screen.getByTestId('detail-back'));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it('calls onReExecute with skillId and serverId when re-execute button is clicked', async () => {
    const user = userEvent.setup();
    const onReExecute = vi.fn();
    render(<ExecutionDetail {...defaultProps} onReExecute={onReExecute} />);

    await user.click(screen.getByTestId('re-execute-btn'));
    expect(onReExecute).toHaveBeenCalledWith('sk-1', 'srv-1');
  });

  it('handles null result gracefully', () => {
    const exec = makeExecution({ result: null });
    render(<ExecutionDetail {...defaultProps} execution={exec} />);

    expect(screen.queryByTestId('ai-output')).not.toBeInTheDocument();
    expect(screen.queryByTestId('tool-calls-list')).not.toBeInTheDocument();
    expect(screen.queryByTestId('error-list')).not.toBeInTheDocument();
  });
});
