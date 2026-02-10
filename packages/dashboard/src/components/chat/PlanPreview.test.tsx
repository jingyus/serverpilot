import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PlanPreview } from './PlanPreview';
import type { ExecutionPlan } from '@/types/chat';

const mockPlan: ExecutionPlan = {
  planId: 'plan-1',
  description: 'Install and configure nginx',
  steps: [
    {
      id: 'step-1',
      description: 'Install nginx',
      command: 'apt install -y nginx',
      riskLevel: 'green',
      timeout: 30000,
      canRollback: true,
      rollbackCommand: 'apt remove -y nginx',
    },
    {
      id: 'step-2',
      description: 'Configure firewall',
      command: 'ufw allow 80/tcp',
      riskLevel: 'yellow',
      timeout: 15000,
      canRollback: false,
    },
  ],
  totalRisk: 'yellow',
  requiresConfirmation: true,
  estimatedTime: 45000,
};

describe('PlanPreview', () => {
  const defaultProps = {
    plan: mockPlan,
    onConfirm: vi.fn(),
    onReject: vi.fn(),
    isExecuting: false,
  };

  it('renders the plan title and description', () => {
    render(<PlanPreview {...defaultProps} />);
    expect(screen.getByText('Execution Plan')).toBeInTheDocument();
    expect(
      screen.getByText('Install and configure nginx')
    ).toBeInTheDocument();
  });

  it('shows total risk badge', () => {
    render(<PlanPreview {...defaultProps} />);
    const badges = screen.getAllByTestId('risk-badge-yellow');
    expect(badges.length).toBeGreaterThan(0);
  });

  it('renders all steps', () => {
    render(<PlanPreview {...defaultProps} />);
    expect(screen.getByTestId('plan-step-step-1')).toBeInTheDocument();
    expect(screen.getByTestId('plan-step-step-2')).toBeInTheDocument();
    expect(screen.getByText('Install nginx')).toBeInTheDocument();
    expect(screen.getByText('Configure firewall')).toBeInTheDocument();
  });

  it('shows step numbers', () => {
    render(<PlanPreview {...defaultProps} />);
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('expands step to show command details', async () => {
    const user = userEvent.setup();
    render(<PlanPreview {...defaultProps} />);

    await user.click(screen.getByTestId('step-toggle-step-1'));
    expect(screen.getByTestId('step-command-step-1')).toHaveTextContent(
      'apt install -y nginx'
    );
  });

  it('shows rollback command for expandable steps', async () => {
    const user = userEvent.setup();
    render(<PlanPreview {...defaultProps} />);

    await user.click(screen.getByTestId('step-toggle-step-1'));
    expect(screen.getByText(/apt remove -y nginx/)).toBeInTheDocument();
  });

  it('shows estimated time', () => {
    render(<PlanPreview {...defaultProps} />);
    expect(screen.getByText(/45s/)).toBeInTheDocument();
  });

  it('calls onConfirm when execute button clicked', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<PlanPreview {...defaultProps} onConfirm={onConfirm} />);

    await user.click(screen.getByTestId('plan-confirm-btn'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('calls onReject when reject button clicked', async () => {
    const user = userEvent.setup();
    const onReject = vi.fn();
    render(<PlanPreview {...defaultProps} onReject={onReject} />);

    await user.click(screen.getByTestId('plan-reject-btn'));
    expect(onReject).toHaveBeenCalledTimes(1);
  });

  it('disables buttons when executing', () => {
    render(<PlanPreview {...defaultProps} isExecuting={true} />);
    expect(screen.getByTestId('plan-confirm-btn')).toBeDisabled();
    expect(screen.getByTestId('plan-reject-btn')).toBeDisabled();
  });

  it('shows "Executing..." text when executing', () => {
    render(<PlanPreview {...defaultProps} isExecuting={true} />);
    expect(screen.getByText('Executing...')).toBeInTheDocument();
  });

  it('hides action buttons when confirmation not required', () => {
    const plan: ExecutionPlan = {
      ...mockPlan,
      requiresConfirmation: false,
    };
    render(<PlanPreview {...defaultProps} plan={plan} />);
    expect(
      screen.queryByTestId('plan-confirm-btn')
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('plan-reject-btn')
    ).not.toBeInTheDocument();
  });

  it('shows risk badges per step', () => {
    render(<PlanPreview {...defaultProps} />);
    expect(screen.getByTestId('risk-badge-green')).toBeInTheDocument();
  });
});
