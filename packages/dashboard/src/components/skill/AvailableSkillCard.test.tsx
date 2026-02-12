// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AvailableSkillCard } from './AvailableSkillCard';
import type { AvailableSkill } from '@/types/skill';

const makeSkill = (overrides: Partial<AvailableSkill> = {}): AvailableSkill => ({
  manifest: {
    name: 'disk-cleanup',
    displayName: 'Disk Cleanup',
    version: '1.0.0',
    description: 'Cleans up old files from disk',
    author: 'ServerPilot Team',
    tags: ['maintenance', 'disk'],
  },
  source: 'official',
  dirPath: '/skills/disk-cleanup',
  installed: false,
  ...overrides,
});

describe('AvailableSkillCard', () => {
  const defaultProps = {
    skill: makeSkill(),
    onInstall: vi.fn(),
  };

  it('renders display name, version, and description', () => {
    render(<AvailableSkillCard {...defaultProps} />);

    expect(screen.getByText('Disk Cleanup')).toBeInTheDocument();
    expect(screen.getByText('v1.0.0')).toBeInTheDocument();
    expect(screen.getByText('Cleans up old files from disk')).toBeInTheDocument();
  });

  it('renders author', () => {
    render(<AvailableSkillCard {...defaultProps} />);

    expect(screen.getByText(/ServerPilot Team/)).toBeInTheDocument();
  });

  it('renders tags as badges', () => {
    render(<AvailableSkillCard {...defaultProps} />);

    expect(screen.getByText('maintenance')).toBeInTheDocument();
    expect(screen.getByText('disk')).toBeInTheDocument();
  });

  it('does not render tags section when tags array is empty', () => {
    const skill = makeSkill({
      manifest: { ...makeSkill().manifest, tags: [] },
    });
    render(<AvailableSkillCard {...defaultProps} skill={skill} />);

    // Only version and source badges should exist, no tag badges
    expect(screen.queryByText('maintenance')).not.toBeInTheDocument();
    expect(screen.queryByText('disk')).not.toBeInTheDocument();
  });

  it('renders source badge', () => {
    render(<AvailableSkillCard {...defaultProps} />);

    expect(screen.getByText('Official')).toBeInTheDocument();
  });

  it('calls onInstall when install button is clicked', async () => {
    const user = userEvent.setup();
    const onInstall = vi.fn();
    render(<AvailableSkillCard {...defaultProps} onInstall={onInstall} />);

    await user.click(screen.getByText('Install'));
    expect(onInstall).toHaveBeenCalledOnce();
  });

  it('disables install button and shows installed text when already installed', () => {
    const skill = makeSkill({ installed: true });
    render(<AvailableSkillCard {...defaultProps} skill={skill} />);

    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
    expect(screen.getByText('Installed')).toBeInTheDocument();
  });
});
