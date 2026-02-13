// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ExecuteDialog } from './ExecuteDialog';
import type { SkillExecutionResult } from '@/types/skill';

// Mock ExecutionStream to avoid SSE/streaming complexity
vi.mock('@/components/skill/ExecutionStream', () => ({
  ExecutionStream: ({ executionId }: { executionId: string }) => (
    <div data-testid="execution-stream">Stream: {executionId}</div>
  ),
}));

const onlineServers = [
  { id: 'srv-1', name: 'Production', status: 'online' },
  { id: 'srv-2', name: 'Staging', status: 'online' },
];

const mixedServers = [
  ...onlineServers,
  { id: 'srv-3', name: 'Offline Box', status: 'offline' },
];

describe('ExecuteDialog', () => {
  const defaultProps = {
    open: true,
    skillName: 'Disk Cleanup',
    servers: mixedServers,
    selectedServerId: '',
    onServerChange: vi.fn(),
    executionId: null,
    isExecuting: false,
    onExecute: vi.fn(),
    onClose: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders dialog title and skill name', () => {
    render(<ExecuteDialog {...defaultProps} />);

    expect(screen.getByText('Execute Skill')).toBeInTheDocument();
    expect(screen.getByText('Disk Cleanup')).toBeInTheDocument();
  });

  it('renders server select with only online servers', () => {
    render(<ExecuteDialog {...defaultProps} />);

    const select = screen.getByTestId('exec-server-select');
    const options = select.querySelectorAll('option');
    // placeholder + 2 online servers
    expect(options).toHaveLength(3);
    expect(screen.getByText('Production')).toBeInTheDocument();
    expect(screen.getByText('Staging')).toBeInTheDocument();
    // Offline server should not appear
    expect(screen.queryByText('Offline Box')).not.toBeInTheDocument();
  });

  it('calls onServerChange when server is selected', async () => {
    const user = userEvent.setup();
    const onServerChange = vi.fn();
    render(<ExecuteDialog {...defaultProps} onServerChange={onServerChange} />);

    const select = screen.getByTestId('exec-server-select');
    await user.selectOptions(select, 'srv-1');
    expect(onServerChange).toHaveBeenCalledWith('srv-1');
  });

  it('disables execute button when no server is selected', () => {
    render(<ExecuteDialog {...defaultProps} />);

    const executeBtn = screen.getByText('Execute');
    expect(executeBtn).toBeDisabled();
  });

  it('enables execute button when a server is selected', () => {
    render(<ExecuteDialog {...defaultProps} selectedServerId="srv-1" />);

    const executeBtn = screen.getByText('Execute');
    expect(executeBtn).not.toBeDisabled();
  });

  it('calls onExecute when execute button is clicked', async () => {
    const user = userEvent.setup();
    const onExecute = vi.fn();
    render(
      <ExecuteDialog {...defaultProps} selectedServerId="srv-1" onExecute={onExecute} />,
    );

    await user.click(screen.getByText('Execute'));
    expect(onExecute).toHaveBeenCalledOnce();
  });

  it('shows loading state when isExecuting is true', () => {
    render(
      <ExecuteDialog {...defaultProps} selectedServerId="srv-1" isExecuting={true} />,
    );

    expect(screen.getByText('Executing...')).toBeInTheDocument();
    // The executing button should be disabled
    const executingBtn = screen.getByText('Executing...').closest('button');
    expect(executingBtn).toBeDisabled();
  });

  it('shows ExecutionStream when executionId is set', () => {
    render(<ExecuteDialog {...defaultProps} executionId="exec-123" />);

    expect(screen.getByTestId('execution-stream')).toBeInTheDocument();
    expect(screen.getByText('Stream: exec-123')).toBeInTheDocument();
    // Server select should not be visible
    expect(screen.queryByTestId('exec-server-select')).not.toBeInTheDocument();
  });

  it('shows dismiss button instead of execute/cancel when executionId is set', () => {
    render(<ExecuteDialog {...defaultProps} executionId="exec-123" />);

    expect(screen.getByText('Dismiss')).toBeInTheDocument();
    expect(screen.queryByText('Execute')).not.toBeInTheDocument();
    expect(screen.queryByText('Cancel')).not.toBeInTheDocument();
  });

  it('calls onClose when cancel button is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<ExecuteDialog {...defaultProps} onClose={onClose} />);

    await user.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('shows no servers message when all servers are offline', () => {
    const offlineOnly = [{ id: 'srv-3', name: 'Offline Box', status: 'offline' }];
    render(<ExecuteDialog {...defaultProps} servers={offlineOnly} />);

    expect(screen.getByText('No servers available')).toBeInTheDocument();
    expect(screen.queryByTestId('exec-server-select')).not.toBeInTheDocument();
  });

  it('renders dry-run toggle when onDryRunChange is provided', () => {
    const onDryRunChange = vi.fn();
    render(
      <ExecuteDialog {...defaultProps} dryRun={false} onDryRunChange={onDryRunChange} />,
    );

    const toggle = screen.getByTestId('dry-run-toggle');
    expect(toggle).toBeInTheDocument();
    expect(screen.getByText('Dry Run')).toBeInTheDocument();
  });

  it('does not render dry-run toggle when onDryRunChange is absent', () => {
    render(<ExecuteDialog {...defaultProps} />);

    expect(screen.queryByTestId('dry-run-toggle')).not.toBeInTheDocument();
  });

  it('calls onDryRunChange when checkbox is toggled', async () => {
    const user = userEvent.setup();
    const onDryRunChange = vi.fn();
    render(
      <ExecuteDialog {...defaultProps} dryRun={false} onDryRunChange={onDryRunChange} />,
    );

    const checkbox = screen.getByTestId('dry-run-toggle').querySelector('input')!;
    await user.click(checkbox);
    expect(onDryRunChange).toHaveBeenCalledWith(true);
  });

  it('shows "Dry Run" button text when dryRun is true', () => {
    render(
      <ExecuteDialog
        {...defaultProps}
        selectedServerId="srv-1"
        dryRun={true}
        onDryRunChange={vi.fn()}
      />,
    );

    const buttons = screen.getAllByRole('button');
    const dryRunBtn = buttons.find((b) => b.textContent === 'Dry Run');
    expect(dryRunBtn).toBeDefined();
    expect(dryRunBtn).not.toBeDisabled();
  });

  // ==========================================================================
  // Preview button tests
  // ==========================================================================

  it('renders Preview button when onPreview is provided', () => {
    render(
      <ExecuteDialog
        {...defaultProps}
        selectedServerId="srv-1"
        onPreview={vi.fn()}
      />,
    );

    const previewBtn = screen.getByTestId('preview-btn');
    expect(previewBtn).toBeInTheDocument();
    expect(previewBtn).toHaveTextContent('Preview');
    expect(previewBtn).not.toBeDisabled();
  });

  it('does not render Preview button when onPreview is absent', () => {
    render(<ExecuteDialog {...defaultProps} selectedServerId="srv-1" />);

    expect(screen.queryByTestId('preview-btn')).not.toBeInTheDocument();
  });

  it('calls onPreview when Preview button is clicked', async () => {
    const user = userEvent.setup();
    const onPreview = vi.fn();
    render(
      <ExecuteDialog
        {...defaultProps}
        selectedServerId="srv-1"
        onPreview={onPreview}
      />,
    );

    await user.click(screen.getByTestId('preview-btn'));
    expect(onPreview).toHaveBeenCalledOnce();
  });

  it('disables Preview button when no server is selected', () => {
    render(
      <ExecuteDialog
        {...defaultProps}
        onPreview={vi.fn()}
      />,
    );

    expect(screen.getByTestId('preview-btn')).toBeDisabled();
  });

  it('shows loading state on Preview button when isPreviewing is true', () => {
    render(
      <ExecuteDialog
        {...defaultProps}
        selectedServerId="srv-1"
        onPreview={vi.fn()}
        isPreviewing={true}
      />,
    );

    const previewBtn = screen.getByTestId('preview-btn');
    expect(previewBtn).toBeDisabled();
    expect(previewBtn).toHaveTextContent('Previewing...');
  });

  // ==========================================================================
  // Dry-run result display tests
  // ==========================================================================

  it('displays dry-run result with DRY RUN badge when dryRunResult is provided', () => {
    const dryRunResult: SkillExecutionResult = {
      executionId: 'exec-dry-1',
      status: 'success',
      stepsExecuted: 0,
      duration: 1200,
      result: { output: 'Step 1: run_command — apt update\nStep 2: run_command — apt upgrade' },
      errors: [],
    };

    render(
      <ExecuteDialog
        {...defaultProps}
        selectedServerId="srv-1"
        onPreview={vi.fn()}
        dryRunResult={dryRunResult}
      />,
    );

    expect(screen.getByTestId('dry-run-result')).toBeInTheDocument();
    expect(screen.getByTestId('dry-run-badge')).toHaveTextContent('DRY RUN');
    expect(screen.getByTestId('dry-run-output')).toHaveTextContent('Step 1: run_command');
  });

  it('does not display dry-run result panel when dryRunResult is null', () => {
    render(
      <ExecuteDialog
        {...defaultProps}
        selectedServerId="srv-1"
        onPreview={vi.fn()}
        dryRunResult={null}
      />,
    );

    expect(screen.queryByTestId('dry-run-result')).not.toBeInTheDocument();
  });

  it('displays dry-run errors when result has errors', () => {
    const dryRunResult: SkillExecutionResult = {
      executionId: 'exec-dry-2',
      status: 'failed',
      stepsExecuted: 0,
      duration: 500,
      result: null,
      errors: ['Permission denied', 'Server unreachable'],
    };

    render(
      <ExecuteDialog
        {...defaultProps}
        selectedServerId="srv-1"
        onPreview={vi.fn()}
        dryRunResult={dryRunResult}
      />,
    );

    expect(screen.getByTestId('dry-run-result')).toBeInTheDocument();
    expect(screen.getByText('Permission denied')).toBeInTheDocument();
    expect(screen.getByText('Server unreachable')).toBeInTheDocument();
  });
});
