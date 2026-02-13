// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToolCallList } from './ToolCallList';
import type { ToolCallEntry } from '@/stores/chat-types';

function makeTool(overrides: Partial<ToolCallEntry> = {}): ToolCallEntry {
  return {
    id: 'tc-1',
    tool: 'bash',
    command: 'ls -la',
    status: 'completed',
    output: 'total 4\ndrwxr-xr-x 2 root root 4096 Jan 1 00:00 .',
    exitCode: 0,
    duration: 120,
    ...overrides,
  };
}

describe('ToolCallList', () => {
  it('returns null when toolCalls is empty', () => {
    const { container } = render(<ToolCallList toolCalls={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders tool-call-list container when toolCalls exist', () => {
    render(<ToolCallList toolCalls={[makeTool()]} />);
    expect(screen.getByTestId('tool-call-list')).toBeInTheDocument();
  });

  it('renders summary with correct counts', () => {
    const calls: ToolCallEntry[] = [
      makeTool({ id: '1', status: 'completed' }),
      makeTool({ id: '2', status: 'running', exitCode: undefined, duration: undefined }),
      makeTool({ id: '3', status: 'failed', exitCode: 1 }),
    ];
    render(<ToolCallList toolCalls={calls} />);

    const summary = screen.getByTestId('tool-call-summary');
    expect(summary.textContent).toContain('3 tool calls');
    expect(summary.textContent).toContain('1 running');
    expect(summary.textContent).toContain('1 done');
    expect(summary.textContent).toContain('1 failed');
  });

  it('renders singular "tool call" for single entry', () => {
    render(<ToolCallList toolCalls={[makeTool()]} />);
    const summary = screen.getByTestId('tool-call-summary');
    expect(summary.textContent).toContain('1 tool call');
    expect(summary.textContent).not.toContain('1 tool calls');
  });

  it('counts rejected entries in the failed total', () => {
    const calls: ToolCallEntry[] = [
      makeTool({ id: '1', status: 'rejected' }),
      makeTool({ id: '2', status: 'completed' }),
    ];
    render(<ToolCallList toolCalls={calls} />);
    const summary = screen.getByTestId('tool-call-summary');
    expect(summary.textContent).toContain('1 failed');
  });

  it('renders each tool call item with correct testid', () => {
    const calls: ToolCallEntry[] = [
      makeTool({ id: 'abc' }),
      makeTool({ id: 'def' }),
    ];
    render(<ToolCallList toolCalls={calls} />);
    expect(screen.getByTestId('tool-call-abc')).toBeInTheDocument();
    expect(screen.getByTestId('tool-call-def')).toBeInTheDocument();
  });

  it('displays command with $ prefix for bash tool calls', () => {
    render(<ToolCallList toolCalls={[makeTool({ command: 'apt update' })]} />);
    expect(screen.getByText('$ apt update')).toBeInTheDocument();
  });

  it('displays tool name when command is absent', () => {
    render(
      <ToolCallList
        toolCalls={[makeTool({ command: undefined, tool: 'file_read', description: 'Reading config' })]}
      />,
    );
    expect(screen.getByText('file_read: Reading config')).toBeInTheDocument();
  });

  it('displays tool name only when both command and description are absent', () => {
    render(
      <ToolCallList
        toolCalls={[makeTool({ command: undefined, tool: 'file_read', description: undefined })]}
      />,
    );
    expect(screen.getByText('file_read')).toBeInTheDocument();
  });

  it('shows exit code badge for completed tool call', () => {
    render(<ToolCallList toolCalls={[makeTool({ id: 't1', exitCode: 0 })]} />);
    expect(screen.getByTestId('tool-call-exit-t1')).toHaveTextContent('exit 0');
  });

  it('shows non-zero exit code for failed tool call', () => {
    render(<ToolCallList toolCalls={[makeTool({ id: 't2', status: 'failed', exitCode: 127 })]} />);
    expect(screen.getByTestId('tool-call-exit-t2')).toHaveTextContent('exit 127');
  });

  it('shows duration when tool call is done', () => {
    render(<ToolCallList toolCalls={[makeTool({ duration: 2500 })]} />);
    expect(screen.getByText('2s')).toBeInTheDocument();
  });

  it('does not show duration for running tool call', () => {
    render(
      <ToolCallList
        toolCalls={[makeTool({ status: 'running', duration: 500, exitCode: undefined })]}
      />,
    );
    expect(screen.queryByText('500ms')).not.toBeInTheDocument();
  });
});

describe('ToolCallList — status icons', () => {
  it('shows spinner for running status', () => {
    render(<ToolCallList toolCalls={[makeTool({ status: 'running', exitCode: undefined, duration: undefined })]} />);
    expect(screen.getByTestId('status-running')).toBeInTheDocument();
  });

  it('shows check for completed status', () => {
    render(<ToolCallList toolCalls={[makeTool({ status: 'completed' })]} />);
    expect(screen.getByTestId('status-completed')).toBeInTheDocument();
  });

  it('shows X for failed status', () => {
    render(<ToolCallList toolCalls={[makeTool({ status: 'failed', exitCode: 1 })]} />);
    expect(screen.getByTestId('status-failed')).toBeInTheDocument();
  });

  it('shows shield for blocked status', () => {
    render(<ToolCallList toolCalls={[makeTool({ status: 'blocked' })]} />);
    expect(screen.getByTestId('status-blocked')).toBeInTheDocument();
  });

  it('shows ban for rejected status', () => {
    render(<ToolCallList toolCalls={[makeTool({ status: 'rejected' })]} />);
    expect(screen.getByTestId('status-rejected')).toBeInTheDocument();
  });
});

describe('ToolCallList — collapsible output', () => {
  it('does not show output by default (collapsed)', () => {
    render(<ToolCallList toolCalls={[makeTool({ id: 'x1' })]} />);
    expect(screen.queryByTestId('tool-call-output-x1')).not.toBeInTheDocument();
  });

  it('expands output on click', async () => {
    const user = userEvent.setup();
    render(<ToolCallList toolCalls={[makeTool({ id: 'x2' })]} />);

    await user.click(screen.getByTestId('tool-call-toggle-x2'));
    expect(screen.getByTestId('tool-call-output-x2')).toBeInTheDocument();
    expect(screen.getByTestId('tool-call-output-x2').textContent).toContain('total 4');
  });

  it('collapses output on second click', async () => {
    const user = userEvent.setup();
    render(<ToolCallList toolCalls={[makeTool({ id: 'x3' })]} />);

    await user.click(screen.getByTestId('tool-call-toggle-x3'));
    expect(screen.getByTestId('tool-call-output-x3')).toBeInTheDocument();

    await user.click(screen.getByTestId('tool-call-toggle-x3'));
    expect(screen.queryByTestId('tool-call-output-x3')).not.toBeInTheDocument();
  });

  it('does not expand when output is empty', async () => {
    const user = userEvent.setup();
    render(<ToolCallList toolCalls={[makeTool({ id: 'x4', output: '' })]} />);

    await user.click(screen.getByTestId('tool-call-toggle-x4'));
    expect(screen.queryByTestId('tool-call-output-x4')).not.toBeInTheDocument();
  });
});
