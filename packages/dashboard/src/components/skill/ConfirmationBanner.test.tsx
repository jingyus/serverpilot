// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PendingConfirmationsBanner } from './ConfirmationBanner';
import type { SkillExecution, InstalledSkill } from '@/types/skill';

const makeExecution = (overrides: Partial<SkillExecution> = {}): SkillExecution => ({
  id: 'exec-1',
  skillId: 'sk-1',
  serverId: 'srv-1',
  userId: 'user-1',
  triggerType: 'event',
  status: 'pending_confirmation',
  startedAt: '2026-01-15T10:00:00Z',
  completedAt: null,
  result: null,
  stepsExecuted: 0,
  duration: null,
  ...overrides,
});

const makeInstalledSkill = (overrides: Partial<InstalledSkill> = {}): InstalledSkill => ({
  id: 'sk-1',
  userId: 'user-1',
  tenantId: null,
  name: 'disk-cleanup',
  displayName: 'Disk Cleanup',
  version: '1.0.0',
  source: 'official',
  skillPath: '/skills/disk-cleanup',
  status: 'enabled',
  config: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...overrides,
});

describe('PendingConfirmationsBanner', () => {
  const defaultProps = {
    executions: [makeExecution()],
    skills: [makeInstalledSkill()],
    onConfirm: vi.fn(),
    onReject: vi.fn(),
  };

  it('renders pending confirmation count', () => {
    render(<PendingConfirmationsBanner {...defaultProps} />);

    expect(screen.getByText(/1 skill execution\(s\) awaiting confirmation/)).toBeInTheDocument();
  });

  it('renders skill display name and trigger type', () => {
    render(<PendingConfirmationsBanner {...defaultProps} />);

    expect(screen.getByText('Disk Cleanup')).toBeInTheDocument();
    expect(screen.getByText(/triggered by event/)).toBeInTheDocument();
  });

  it('falls back to skill name when displayName is null', () => {
    const skills = [makeInstalledSkill({ displayName: null })];
    render(<PendingConfirmationsBanner {...defaultProps} skills={skills} />);

    expect(screen.getByText('disk-cleanup')).toBeInTheDocument();
  });

  it('falls back to skillId when skill is not found', () => {
    render(<PendingConfirmationsBanner {...defaultProps} skills={[]} />);

    expect(screen.getByText('sk-1')).toBeInTheDocument();
  });

  it('calls onConfirm with execution id when confirm button is clicked', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<PendingConfirmationsBanner {...defaultProps} onConfirm={onConfirm} />);

    await user.click(screen.getByTestId('confirm-exec-1'));
    expect(onConfirm).toHaveBeenCalledWith('exec-1');
  });

  it('calls onReject with execution id when reject button is clicked', async () => {
    const user = userEvent.setup();
    const onReject = vi.fn();
    render(<PendingConfirmationsBanner {...defaultProps} onReject={onReject} />);

    await user.click(screen.getByTestId('reject-exec-1'));
    expect(onReject).toHaveBeenCalledWith('exec-1');
  });

  it('renders multiple executions', () => {
    const executions = [
      makeExecution({ id: 'exec-1', skillId: 'sk-1' }),
      makeExecution({ id: 'exec-2', skillId: 'sk-2', triggerType: 'cron' }),
    ];
    const skills = [
      makeInstalledSkill({ id: 'sk-1', displayName: 'Disk Cleanup' }),
      makeInstalledSkill({ id: 'sk-2', name: 'log-rotate', displayName: 'Log Rotate' }),
    ];
    render(
      <PendingConfirmationsBanner
        {...defaultProps}
        executions={executions}
        skills={skills}
      />,
    );

    expect(screen.getByText('Disk Cleanup')).toBeInTheDocument();
    expect(screen.getByText('Log Rotate')).toBeInTheDocument();
    expect(screen.getByText(/2 skill execution\(s\) awaiting confirmation/)).toBeInTheDocument();
  });
});
