// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
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

  describe('risk level color indicators', () => {
    it('applies green border for green risk plan', () => {
      const plan: ExecutionPlan = {
        ...mockPlan,
        totalRisk: 'green',
        steps: [{ ...mockPlan.steps[0], riskLevel: 'green' }],
      };
      render(<PlanPreview {...defaultProps} plan={plan} />);
      const card = screen.getByTestId('plan-preview');
      expect(card.className).toContain('border-green');
    });

    it('applies yellow border for yellow risk plan', () => {
      render(<PlanPreview {...defaultProps} />);
      const card = screen.getByTestId('plan-preview');
      expect(card.className).toContain('border-yellow');
    });

    it('applies red border for red risk plan', () => {
      const plan: ExecutionPlan = {
        ...mockPlan,
        totalRisk: 'red',
        steps: [{ ...mockPlan.steps[0], riskLevel: 'red' }],
      };
      render(<PlanPreview {...defaultProps} plan={plan} />);
      const card = screen.getByTestId('plan-preview');
      expect(card.className).toContain('border-red');
    });

    it('applies animate-pulse for critical risk plan', () => {
      const plan: ExecutionPlan = {
        ...mockPlan,
        totalRisk: 'critical',
        steps: [{ ...mockPlan.steps[0], riskLevel: 'critical' }],
      };
      render(<PlanPreview {...defaultProps} plan={plan} />);
      const card = screen.getByTestId('plan-preview');
      expect(card.className).toContain('animate-pulse');
    });

    it('applies risk-colored borders on individual steps', () => {
      const plan: ExecutionPlan = {
        ...mockPlan,
        totalRisk: 'red',
        steps: [
          { ...mockPlan.steps[0], riskLevel: 'red' },
          { ...mockPlan.steps[1], riskLevel: 'green' },
        ],
      };
      render(<PlanPreview {...defaultProps} plan={plan} />);
      const step1 = screen.getByTestId('plan-step-step-1');
      const step2 = screen.getByTestId('plan-step-step-2');
      expect(step1.className).toContain('border-red');
      expect(step2.className).toContain('border-green');
    });

    it('shows warning banner for RED risk plan', () => {
      const plan: ExecutionPlan = {
        ...mockPlan,
        totalRisk: 'red',
        steps: [{ ...mockPlan.steps[0], riskLevel: 'red' }],
      };
      render(<PlanPreview {...defaultProps} plan={plan} />);
      expect(screen.getByTestId('risk-warning')).toBeInTheDocument();
      expect(screen.getByText(/high-risk commands/)).toBeInTheDocument();
    });

    it('shows warning banner for CRITICAL risk plan', () => {
      const plan: ExecutionPlan = {
        ...mockPlan,
        totalRisk: 'critical',
        steps: [{ ...mockPlan.steps[0], riskLevel: 'critical' }],
      };
      render(<PlanPreview {...defaultProps} plan={plan} />);
      expect(screen.getByTestId('risk-warning')).toBeInTheDocument();
    });

    it('does not show warning banner for green/yellow risk', () => {
      render(<PlanPreview {...defaultProps} />);
      expect(screen.queryByTestId('risk-warning')).not.toBeInTheDocument();
    });
  });

  describe('confirmation dialog for high-risk plans', () => {
    const highRiskPlan: ExecutionPlan = {
      planId: 'plan-hr',
      description: 'Remove old packages',
      steps: [
        {
          id: 'hr-1',
          description: 'Remove package',
          command: 'apt remove -y old-pkg',
          riskLevel: 'red',
          timeout: 30000,
          canRollback: false,
        },
        {
          id: 'hr-2',
          description: 'Check status',
          command: 'systemctl status app',
          riskLevel: 'green',
          timeout: 10000,
          canRollback: false,
        },
      ],
      totalRisk: 'red',
      requiresConfirmation: true,
    };

    it('shows confirmation dialog when confirming high-risk plan', async () => {
      const user = userEvent.setup();
      const onConfirm = vi.fn();
      render(<PlanPreview plan={highRiskPlan} onConfirm={onConfirm} onReject={vi.fn()} isExecuting={false} />);

      await user.click(screen.getByTestId('plan-confirm-btn'));
      expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument();
      expect(screen.getByText('Confirm High-Risk Execution')).toBeInTheDocument();
      expect(onConfirm).not.toHaveBeenCalled();
    });

    it('lists only high-risk steps in confirmation dialog', async () => {
      const user = userEvent.setup();
      render(<PlanPreview plan={highRiskPlan} onConfirm={vi.fn()} onReject={vi.fn()} isExecuting={false} />);

      await user.click(screen.getByTestId('plan-confirm-btn'));
      expect(screen.getByTestId('confirm-step-hr-1')).toBeInTheDocument();
      expect(screen.queryByTestId('confirm-step-hr-2')).not.toBeInTheDocument();
    });

    it('calls onConfirm after confirming in dialog', async () => {
      const user = userEvent.setup();
      const onConfirm = vi.fn();
      render(<PlanPreview plan={highRiskPlan} onConfirm={onConfirm} onReject={vi.fn()} isExecuting={false} />);

      await user.click(screen.getByTestId('plan-confirm-btn'));
      await user.click(screen.getByTestId('confirm-execute-btn'));
      expect(onConfirm).toHaveBeenCalledOnce();
    });

    it('directly confirms low-risk plan without dialog', async () => {
      const user = userEvent.setup();
      const onConfirm = vi.fn();
      render(<PlanPreview {...defaultProps} onConfirm={onConfirm} />);

      await user.click(screen.getByTestId('plan-confirm-btn'));
      expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument();
      expect(onConfirm).toHaveBeenCalledOnce();
    });

    it('uses destructive button variant for high-risk plans', () => {
      render(<PlanPreview plan={highRiskPlan} onConfirm={vi.fn()} onReject={vi.fn()} isExecuting={false} />);
      const btn = screen.getByTestId('plan-confirm-btn');
      // destructive variant typically has specific class
      expect(btn.className).toContain('destructive');
    });
  });
});
