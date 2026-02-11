// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ExecutionLog } from './ExecutionLog';
import type { ExecutionPlan } from '@/types/chat';

const mockPlan: ExecutionPlan = {
  planId: 'plan-1',
  description: 'Install web server',
  steps: [
    {
      id: 'step-1',
      description: 'Install nginx',
      command: 'apt install -y nginx',
      riskLevel: 'green',
      timeout: 30000,
      canRollback: false,
    },
    {
      id: 'step-2',
      description: 'Start service',
      command: 'systemctl start nginx',
      riskLevel: 'green',
      timeout: 15000,
      canRollback: false,
    },
    {
      id: 'step-3',
      description: 'Enable on boot',
      command: 'systemctl enable nginx',
      riskLevel: 'green',
      timeout: 15000,
      canRollback: false,
    },
  ],
  totalRisk: 'green',
  requiresConfirmation: true,
};

describe('ExecutionLog', () => {
  const defaultProps = {
    plan: mockPlan,
    activeStepId: null,
    outputs: {} as Record<string, string>,
    completedSteps: {} as Record<string, { exitCode: number; duration: number }>,
    success: null,
  };

  it('renders the execution log header', () => {
    render(<ExecutionLog {...defaultProps} />);
    expect(screen.getByText('Execution Progress')).toBeInTheDocument();
  });

  it('renders all steps', () => {
    render(<ExecutionLog {...defaultProps} />);
    expect(screen.getByTestId('exec-step-step-1')).toBeInTheDocument();
    expect(screen.getByTestId('exec-step-step-2')).toBeInTheDocument();
    expect(screen.getByTestId('exec-step-step-3')).toBeInTheDocument();
  });

  it('highlights the active step', () => {
    render(<ExecutionLog {...defaultProps} activeStepId="step-1" />);
    const step = screen.getByTestId('exec-step-step-1');
    expect(step).toHaveClass('border-blue-300');
  });

  it('shows output for active step', () => {
    render(
      <ExecutionLog
        {...defaultProps}
        activeStepId="step-1"
        outputs={{ 'step-1': 'Reading package lists...' }}
      />
    );
    expect(screen.getByTestId('exec-output-step-1')).toHaveTextContent(
      'Reading package lists...'
    );
  });

  it('shows completed step with success', () => {
    render(
      <ExecutionLog
        {...defaultProps}
        completedSteps={{ 'step-1': { exitCode: 0, duration: 5000 } }}
      />
    );
    expect(screen.getByText('Exit: 0')).toBeInTheDocument();
    expect(screen.getByText('5s')).toBeInTheDocument();
  });

  it('shows completed step with failure', () => {
    render(
      <ExecutionLog
        {...defaultProps}
        completedSteps={{ 'step-1': { exitCode: 1, duration: 2000 } }}
      />
    );
    expect(screen.getByText('Exit: 1')).toBeInTheDocument();
  });

  it('shows success badge on completion', () => {
    render(<ExecutionLog {...defaultProps} success={true} />);
    expect(screen.getByTestId('exec-result-badge')).toHaveTextContent(
      'Completed'
    );
  });

  it('shows failed badge on failure', () => {
    render(<ExecutionLog {...defaultProps} success={false} />);
    expect(screen.getByTestId('exec-result-badge')).toHaveTextContent(
      'Failed'
    );
  });

  it('does not show result badge while in progress', () => {
    render(<ExecutionLog {...defaultProps} />);
    expect(
      screen.queryByTestId('exec-result-badge')
    ).not.toBeInTheDocument();
  });

  it('shows waiting message for active step without output', () => {
    render(<ExecutionLog {...defaultProps} activeStepId="step-1" />);
    expect(
      screen.getByText('Waiting for output...')
    ).toBeInTheDocument();
  });

  it('applies green styling for completed success step', () => {
    render(
      <ExecutionLog
        {...defaultProps}
        completedSteps={{ 'step-1': { exitCode: 0, duration: 1000 } }}
      />
    );
    const step = screen.getByTestId('exec-step-step-1');
    expect(step).toHaveClass('border-green-200');
  });

  it('applies red styling for failed step', () => {
    render(
      <ExecutionLog
        {...defaultProps}
        completedSteps={{ 'step-1': { exitCode: 127, duration: 500 } }}
      />
    );
    const step = screen.getByTestId('exec-step-step-1');
    expect(step).toHaveClass('border-red-200');
  });

  describe('step progress indicator', () => {
    it('shows [X/N] for each step', () => {
      render(<ExecutionLog {...defaultProps} />);
      expect(screen.getByTestId('step-progress-step-1')).toHaveTextContent('[1/3]');
      expect(screen.getByTestId('step-progress-step-2')).toHaveTextContent('[2/3]');
      expect(screen.getByTestId('step-progress-step-3')).toHaveTextContent('[3/3]');
    });
  });

  describe('emergency stop button', () => {
    it('shows when executing with handler', () => {
      const onStop = vi.fn();
      render(
        <ExecutionLog
          {...defaultProps}
          activeStepId="step-1"
          isExecuting={true}
          onEmergencyStop={onStop}
        />
      );
      expect(screen.getByTestId('emergency-stop-btn')).toBeInTheDocument();
    });

    it('calls onEmergencyStop when clicked', () => {
      const onStop = vi.fn();
      render(
        <ExecutionLog
          {...defaultProps}
          activeStepId="step-1"
          isExecuting={true}
          onEmergencyStop={onStop}
        />
      );
      fireEvent.click(screen.getByTestId('emergency-stop-btn'));
      expect(onStop).toHaveBeenCalledOnce();
    });

    it('hides when not executing', () => {
      const onStop = vi.fn();
      render(
        <ExecutionLog
          {...defaultProps}
          success={true}
          isExecuting={false}
          onEmergencyStop={onStop}
        />
      );
      expect(screen.queryByTestId('emergency-stop-btn')).not.toBeInTheDocument();
    });

    it('hides when no handler provided', () => {
      render(
        <ExecutionLog
          {...defaultProps}
          activeStepId="step-1"
          isExecuting={true}
        />
      );
      expect(screen.queryByTestId('emergency-stop-btn')).not.toBeInTheDocument();
    });
  });

  describe('cancelled state', () => {
    it('shows Stopped badge', () => {
      render(
        <ExecutionLog
          {...defaultProps}
          success={false}
          cancelled={true}
        />
      );
      expect(screen.getByTestId('exec-result-badge')).toHaveTextContent('Stopped');
    });
  });

  describe('execution summary', () => {
    it('shows on success with correct counts', () => {
      render(
        <ExecutionLog
          {...defaultProps}
          success={true}
          startTime={Date.now() - 10000}
          completedSteps={{
            'step-1': { exitCode: 0, duration: 3000 },
            'step-2': { exitCode: 0, duration: 2000 },
            'step-3': { exitCode: 0, duration: 5000 },
          }}
        />
      );
      expect(screen.getByTestId('execution-summary')).toBeInTheDocument();
      expect(screen.getByText('Execution Complete')).toBeInTheDocument();
      expect(screen.getByTestId('summary-success')).toHaveTextContent('3 passed');
      expect(screen.getByTestId('summary-failed')).toHaveTextContent('0 failed');
      expect(screen.getByTestId('summary-skipped')).toHaveTextContent('0 skipped');
    });

    it('shows on failure with failed and skipped counts', () => {
      render(
        <ExecutionLog
          {...defaultProps}
          success={false}
          startTime={Date.now() - 5000}
          completedSteps={{
            'step-1': { exitCode: 0, duration: 3000 },
            'step-2': { exitCode: 1, duration: 2000 },
          }}
        />
      );
      expect(screen.getByText('Execution Failed')).toBeInTheDocument();
      expect(screen.getByTestId('summary-success')).toHaveTextContent('1 passed');
      expect(screen.getByTestId('summary-failed')).toHaveTextContent('1 failed');
      expect(screen.getByTestId('summary-skipped')).toHaveTextContent('1 skipped');
      expect(screen.getByText(/stopped at the first failed step/)).toBeInTheDocument();
    });

    it('shows on cancellation', () => {
      render(
        <ExecutionLog
          {...defaultProps}
          success={false}
          cancelled={true}
          startTime={Date.now() - 3000}
          completedSteps={{
            'step-1': { exitCode: 0, duration: 3000 },
          }}
        />
      );
      expect(screen.getByText('Execution Stopped')).toBeInTheDocument();
      expect(screen.getByTestId('summary-skipped')).toHaveTextContent('2 skipped');
      expect(screen.getByText(/stopped by user/)).toBeInTheDocument();
    });

    it('hidden while in progress', () => {
      render(
        <ExecutionLog
          {...defaultProps}
          activeStepId="step-1"
          isExecuting={true}
        />
      );
      expect(screen.queryByTestId('execution-summary')).not.toBeInTheDocument();
    });

    it('shows total duration', () => {
      render(
        <ExecutionLog
          {...defaultProps}
          success={true}
          startTime={Date.now() - 15000}
          completedSteps={{
            'step-1': { exitCode: 0, duration: 5000 },
            'step-2': { exitCode: 0, duration: 5000 },
            'step-3': { exitCode: 0, duration: 5000 },
          }}
        />
      );
      expect(screen.getByTestId('summary-duration')).toBeInTheDocument();
      expect(screen.getByTestId('summary-duration').textContent).toMatch(/\d+s/);
    });
  });

  describe('progress bar', () => {
    it('renders progress bar', () => {
      render(<ExecutionLog {...defaultProps} />);
      expect(screen.getByTestId('execution-progress-bar')).toBeInTheDocument();
    });

    it('shows 0/3 when no steps completed', () => {
      render(<ExecutionLog {...defaultProps} />);
      expect(screen.getByText('0/3 steps completed')).toBeInTheDocument();
      expect(screen.getByText('0%')).toBeInTheDocument();
    });

    it('shows progress when some steps completed', () => {
      render(
        <ExecutionLog
          {...defaultProps}
          completedSteps={{
            'step-1': { exitCode: 0, duration: 1000 },
            'step-2': { exitCode: 0, duration: 1000 },
          }}
        />
      );
      expect(screen.getByText('2/3 steps completed')).toBeInTheDocument();
      expect(screen.getByText('67%')).toBeInTheDocument();
    });

    it('shows 100% when all steps completed', () => {
      render(
        <ExecutionLog
          {...defaultProps}
          success={true}
          completedSteps={{
            'step-1': { exitCode: 0, duration: 1000 },
            'step-2': { exitCode: 0, duration: 1000 },
            'step-3': { exitCode: 0, duration: 1000 },
          }}
        />
      );
      expect(screen.getByText('3/3 steps completed')).toBeInTheDocument();
      expect(screen.getByText('100%')).toBeInTheDocument();
    });

    it('uses red color for progress bar when a step failed', () => {
      render(
        <ExecutionLog
          {...defaultProps}
          completedSteps={{
            'step-1': { exitCode: 1, duration: 1000 },
          }}
        />
      );
      const bar = screen.getByTestId('execution-progress-bar');
      const fill = bar.querySelector('[class*="bg-red"]');
      expect(fill).toBeInTheDocument();
    });

    it('uses green color for progress bar when all steps pass', () => {
      render(
        <ExecutionLog
          {...defaultProps}
          completedSteps={{
            'step-1': { exitCode: 0, duration: 1000 },
          }}
        />
      );
      const bar = screen.getByTestId('execution-progress-bar');
      const fill = bar.querySelector('[class*="bg-green"]');
      expect(fill).toBeInTheDocument();
    });
  });

  describe('ANSI output rendering', () => {
    it('renders ANSI colored output with span elements', () => {
      render(
        <ExecutionLog
          {...defaultProps}
          activeStepId="step-1"
          outputs={{ 'step-1': '\x1b[32mSuccess\x1b[0m' }}
        />
      );
      const output = screen.getByTestId('exec-output-step-1');
      const span = output.querySelector('span.text-green-400');
      expect(span).toBeInTheDocument();
      expect(span?.textContent).toBe('Success');
    });

    it('renders plain text output without spans', () => {
      render(
        <ExecutionLog
          {...defaultProps}
          activeStepId="step-1"
          outputs={{ 'step-1': 'plain text output' }}
        />
      );
      const output = screen.getByTestId('exec-output-step-1');
      expect(output.textContent).toBe('plain text output');
    });
  });
});
