// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SkillCard } from './SkillCard';
import type { InstalledSkill, SkillStatus } from '@/types/skill';

const makeSkill = (overrides: Partial<InstalledSkill> = {}): InstalledSkill => ({
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

describe('SkillCard', () => {
  const defaultProps = {
    skill: makeSkill(),
    onToggle: vi.fn(),
    onConfigure: vi.fn(),
    onExecute: vi.fn(),
    onUninstall: vi.fn(),
  };

  it('renders skill display name, version, and name', () => {
    render(<SkillCard {...defaultProps} />);

    expect(screen.getByText('Disk Cleanup')).toBeInTheDocument();
    expect(screen.getByText(/v1\.0\.0/)).toBeInTheDocument();
    expect(screen.getByText(/disk-cleanup/)).toBeInTheDocument();
  });

  it('falls back to skill.name when displayName is null', () => {
    render(<SkillCard {...defaultProps} skill={makeSkill({ displayName: null })} />);

    // The heading should show the raw name
    expect(screen.getByText('disk-cleanup')).toBeInTheDocument();
  });

  it('renders status and source badges', () => {
    render(<SkillCard {...defaultProps} />);

    expect(screen.getByText('Enabled')).toBeInTheDocument();
    expect(screen.getByText('Official')).toBeInTheDocument();
  });

  it('calls onExecute when execute button is clicked', async () => {
    const user = userEvent.setup();
    const onExecute = vi.fn();
    render(<SkillCard {...defaultProps} onExecute={onExecute} />);

    const executeBtn = screen.getByTitle('Execute');
    await user.click(executeBtn);
    expect(onExecute).toHaveBeenCalledOnce();
  });

  it('disables execute button when skill is not enabled', () => {
    render(<SkillCard {...defaultProps} skill={makeSkill({ status: 'paused' })} />);

    const executeBtn = screen.getByTitle('Execute');
    expect(executeBtn).toBeDisabled();
  });

  it('shows toggle button for toggleable statuses and calls onToggle', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(<SkillCard {...defaultProps} onToggle={onToggle} />);

    // Enabled → Pause title
    const toggleBtn = screen.getByTitle('Pause');
    await user.click(toggleBtn);
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it('shows Play title on toggle button when skill is paused', () => {
    render(<SkillCard {...defaultProps} skill={makeSkill({ status: 'paused' })} />);

    expect(screen.getByTitle('Enable')).toBeInTheDocument();
  });

  it('hides toggle button for non-toggleable statuses', () => {
    const statuses: SkillStatus[] = ['installed', 'error'];
    for (const status of statuses) {
      const { unmount } = render(
        <SkillCard {...defaultProps} skill={makeSkill({ status })} />,
      );
      expect(screen.queryByTitle('Pause')).not.toBeInTheDocument();
      expect(screen.queryByTitle('Enable')).not.toBeInTheDocument();
      unmount();
    }
  });

  it('calls onConfigure when configure button is clicked', async () => {
    const user = userEvent.setup();
    const onConfigure = vi.fn();
    render(<SkillCard {...defaultProps} onConfigure={onConfigure} />);

    await user.click(screen.getByTitle('Configure'));
    expect(onConfigure).toHaveBeenCalledOnce();
  });

  it('calls onUninstall when uninstall button is clicked', async () => {
    const user = userEvent.setup();
    const onUninstall = vi.fn();
    render(<SkillCard {...defaultProps} onUninstall={onUninstall} />);

    await user.click(screen.getByTitle('Uninstall'));
    expect(onUninstall).toHaveBeenCalledOnce();
  });
});
