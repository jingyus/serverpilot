// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AgenticConfirmBar } from './AgenticConfirmBar';
import type { AgenticConfirm } from '@/stores/chat';

function makeConfirm(overrides: Partial<AgenticConfirm> = {}): AgenticConfirm {
  return {
    confirmId: 'session:abc-123',
    command: 'apt install nginx',
    description: 'Install nginx web server',
    riskLevel: 'yellow',
    ...overrides,
  };
}

describe('AgenticConfirmBar', () => {
  const defaultProps = {
    confirm: makeConfirm(),
    onApprove: vi.fn(),
    onReject: vi.fn(),
  };

  it('renders command, description, and risk label', () => {
    render(<AgenticConfirmBar {...defaultProps} />);

    expect(screen.getByText('Install nginx web server')).toBeInTheDocument();
    expect(screen.getByText('$ apt install nginx')).toBeInTheDocument();
    expect(screen.getByText('YELLOW')).toBeInTheDocument();
  });

  it('renders Allow button enabled when confirmId is present', () => {
    render(<AgenticConfirmBar {...defaultProps} />);

    const allowBtn = screen.getByRole('button', { name: 'Allow' });
    expect(allowBtn).toBeEnabled();
  });

  it('calls onApprove when Allow is clicked', async () => {
    const user = userEvent.setup();
    const onApprove = vi.fn();
    render(<AgenticConfirmBar {...defaultProps} onApprove={onApprove} />);

    await user.click(screen.getByRole('button', { name: 'Allow' }));
    expect(onApprove).toHaveBeenCalledOnce();
  });

  it('calls onReject when Reject is clicked', async () => {
    const user = userEvent.setup();
    const onReject = vi.fn();
    render(<AgenticConfirmBar {...defaultProps} onReject={onReject} />);

    await user.click(screen.getByRole('button', { name: 'Reject' }));
    expect(onReject).toHaveBeenCalledOnce();
  });

  it('disables Allow button and shows "Waiting..." when confirmId is empty', () => {
    render(
      <AgenticConfirmBar
        {...defaultProps}
        confirm={makeConfirm({ confirmId: '' })}
      />,
    );

    const waitingBtn = screen.getByRole('button', { name: 'Waiting...' });
    expect(waitingBtn).toBeDisabled();
  });

  it('does not call onApprove when clicking disabled Waiting button', async () => {
    const user = userEvent.setup();
    const onApprove = vi.fn();
    render(
      <AgenticConfirmBar
        confirm={makeConfirm({ confirmId: '' })}
        onApprove={onApprove}
        onReject={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Waiting...' }));
    expect(onApprove).not.toHaveBeenCalled();
  });

  it('Reject button is always enabled even without confirmId', () => {
    render(
      <AgenticConfirmBar
        {...defaultProps}
        confirm={makeConfirm({ confirmId: '' })}
      />,
    );

    expect(screen.getByRole('button', { name: 'Reject' })).toBeEnabled();
  });

  it('shows timeout error after 5 seconds when confirmId stays empty', () => {
    vi.useFakeTimers();
    render(
      <AgenticConfirmBar
        {...defaultProps}
        confirm={makeConfirm({ confirmId: '' })}
      />,
    );

    // No error initially
    expect(screen.queryByTestId('confirm-timeout-error')).not.toBeInTheDocument();

    // Advance 5 seconds
    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(screen.getByTestId('confirm-timeout-error')).toBeInTheDocument();
    expect(screen.getByTestId('confirm-timeout-error').textContent).toContain(
      'Unable to receive confirmation ID',
    );

    vi.useRealTimers();
  });

  it('does not show timeout error when confirmId is present', () => {
    vi.useFakeTimers();
    render(<AgenticConfirmBar {...defaultProps} />);

    act(() => {
      vi.advanceTimersByTime(10000);
    });

    expect(screen.queryByTestId('confirm-timeout-error')).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  it('renders correct color classes for red risk level', () => {
    render(
      <AgenticConfirmBar
        {...defaultProps}
        confirm={makeConfirm({ riskLevel: 'red' })}
      />,
    );

    expect(screen.getByText('RED')).toBeInTheDocument();
  });

  it('renders correct color classes for critical risk level', () => {
    render(
      <AgenticConfirmBar
        {...defaultProps}
        confirm={makeConfirm({ riskLevel: 'critical' })}
      />,
    );

    expect(screen.getByText('CRITICAL')).toBeInTheDocument();
  });
});
