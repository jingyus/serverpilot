// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { StepConfirmBar } from './StepConfirmBar';
import type { PendingConfirm } from '@/stores/chat-types';

describe('StepConfirmBar', () => {
  const baseStep: PendingConfirm = {
    stepId: 'step-1',
    command: 'rm -rf /tmp/test',
    description: 'Remove temp directory',
    riskLevel: 'yellow',
  };

  const handlers = {
    onAllow: vi.fn(),
    onAllowAll: vi.fn(),
    onReject: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders command and description', () => {
    render(<StepConfirmBar step={baseStep} {...handlers} />);

    expect(screen.getByText('Remove temp directory')).toBeInTheDocument();
    expect(screen.getByText(/rm -rf \/tmp\/test/)).toBeInTheDocument();
  });

  it('renders Allow, Allow All, and Reject buttons', () => {
    render(<StepConfirmBar step={baseStep} {...handlers} />);

    expect(screen.getByTestId('step-allow-btn')).toBeInTheDocument();
    expect(screen.getByTestId('step-allow-all-btn')).toBeInTheDocument();
    expect(screen.getByTestId('step-reject-btn')).toBeInTheDocument();
  });

  it('calls onAllow when Allow button is clicked', async () => {
    const user = userEvent.setup();
    render(<StepConfirmBar step={baseStep} {...handlers} />);

    await user.click(screen.getByTestId('step-allow-btn'));
    expect(handlers.onAllow).toHaveBeenCalledOnce();
  });

  it('does not show countdown when no timeoutMs', () => {
    render(<StepConfirmBar step={baseStep} {...handlers} />);

    expect(screen.queryByTestId('step-countdown')).not.toBeInTheDocument();
  });

  it('shows countdown timer when timeoutMs is provided', () => {
    const step = { ...baseStep, timeoutMs: 300_000 }; // 5 minutes
    render(<StepConfirmBar step={step} {...handlers} />);

    const countdown = screen.getByTestId('step-countdown');
    expect(countdown).toBeInTheDocument();
    expect(countdown.textContent).toBe('5:00');
  });

  it('countdown decrements over time', () => {
    vi.useFakeTimers();
    const step = { ...baseStep, timeoutMs: 60_000 }; // 1 minute
    render(<StepConfirmBar step={step} {...handlers} />);

    const countdown = screen.getByTestId('step-countdown');
    expect(countdown.textContent).toBe('1:00');

    act(() => { vi.advanceTimersByTime(1000); });
    expect(countdown.textContent).toBe('0:59');

    act(() => { vi.advanceTimersByTime(29_000); });
    expect(countdown.textContent).toBe('0:30');

    vi.useRealTimers();
  });

  it('countdown stops at 0:00', () => {
    vi.useFakeTimers();
    const step = { ...baseStep, timeoutMs: 3_000 }; // 3 seconds
    render(<StepConfirmBar step={step} {...handlers} />);

    act(() => { vi.advanceTimersByTime(5_000); });

    const countdown = screen.getByTestId('step-countdown');
    expect(countdown.textContent).toBe('0:00');

    vi.useRealTimers();
  });

  it('countdown uses destructive color when under 30 seconds', () => {
    vi.useFakeTimers();
    const step = { ...baseStep, timeoutMs: 60_000 };
    render(<StepConfirmBar step={step} {...handlers} />);

    const countdown = screen.getByTestId('step-countdown');

    // At 60s remaining, should NOT have destructive color
    expect(countdown.className).toContain('text-muted-foreground');
    expect(countdown.className).not.toContain('text-destructive');

    // Advance to 29s remaining
    act(() => { vi.advanceTimersByTime(31_000); });
    expect(countdown.className).toContain('text-destructive');

    vi.useRealTimers();
  });

  describe('critical risk double-confirm', () => {
    it('shows second confirm button for Allow All on critical risk', async () => {
      const user = userEvent.setup();
      const criticalStep = { ...baseStep, riskLevel: 'critical' };
      render(<StepConfirmBar step={criticalStep} {...handlers} />);

      // First click shows confirm button
      await user.click(screen.getByTestId('step-allow-all-btn'));
      expect(handlers.onAllowAll).not.toHaveBeenCalled();
      expect(screen.getByTestId('step-allow-all-confirm-btn')).toBeInTheDocument();

      // Second click actually triggers allow all
      await user.click(screen.getByTestId('step-allow-all-confirm-btn'));
      expect(handlers.onAllowAll).toHaveBeenCalledOnce();
    });
  });
});
