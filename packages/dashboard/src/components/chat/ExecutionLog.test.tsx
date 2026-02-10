import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
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
});
