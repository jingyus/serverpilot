// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SkillConfigModal } from './SkillConfigModal';
import type { SkillInputDef } from './SkillConfigModal';
import type { InstalledSkill } from '@/types/skill';

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

const stringInput: SkillInputDef = {
  name: 'path',
  type: 'string',
  required: true,
  default: '/tmp',
  description: 'Directory path to clean',
};

const numberInput: SkillInputDef = {
  name: 'maxAge',
  type: 'number',
  required: false,
  default: 30,
  description: 'Max file age in days',
};

const booleanInput: SkillInputDef = {
  name: 'dryRun',
  type: 'boolean',
  required: false,
  default: true,
  description: 'Simulate without deleting',
};

const enumInput: SkillInputDef = {
  name: 'mode',
  type: 'enum',
  required: true,
  description: 'Cleanup mode',
  options: ['safe', 'aggressive', 'custom'],
};

const stringArrayInput: SkillInputDef = {
  name: 'excludeDirs',
  type: 'string[]',
  required: false,
  default: ['node_modules', '.git'],
  description: 'Directories to exclude',
};

describe('SkillConfigModal', () => {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  const onOpenChange = vi.fn();

  const defaultProps = {
    open: true,
    onOpenChange,
    skill: makeSkill(),
    inputs: [stringInput, numberInput, booleanInput, enumInput, stringArrayInput],
    onSubmit,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders dialog title and skill name', () => {
    render(<SkillConfigModal {...defaultProps} />);

    expect(screen.getByText('Configure Skill')).toBeInTheDocument();
    expect(screen.getByText('Disk Cleanup')).toBeInTheDocument();
  });

  it('renders string input with default value', () => {
    render(<SkillConfigModal {...defaultProps} />);

    const input = screen.getByLabelText('path *');
    expect(input).toHaveValue('/tmp');
  });

  it('renders number input with default value', () => {
    render(<SkillConfigModal {...defaultProps} />);

    const input = screen.getByLabelText('maxAge');
    expect(input).toHaveValue(30);
  });

  it('renders boolean input as switch', () => {
    render(<SkillConfigModal {...defaultProps} />);

    // Switch renders with role=switch
    const switchEl = screen.getByRole('switch');
    expect(switchEl).toBeInTheDocument();
    expect(screen.getByText('Simulate without deleting')).toBeInTheDocument();
  });

  it('renders enum input as select with options', () => {
    render(<SkillConfigModal {...defaultProps} />);

    const select = screen.getByLabelText('mode *');
    expect(select.tagName).toBe('SELECT');
    expect(screen.getByText('safe')).toBeInTheDocument();
    expect(screen.getByText('aggressive')).toBeInTheDocument();
    expect(screen.getByText('custom')).toBeInTheDocument();
  });

  it('renders string[] input with comma-separated default', () => {
    render(<SkillConfigModal {...defaultProps} />);

    const input = screen.getByLabelText('excludeDirs');
    expect(input).toHaveValue('node_modules, .git');
  });

  it('shows "no inputs" message when inputs array is empty', () => {
    render(<SkillConfigModal {...defaultProps} inputs={[]} />);

    expect(screen.getByText('This skill has no configurable inputs.')).toBeInTheDocument();
  });

  it('uses existing config values over defaults', () => {
    const skill = makeSkill({ config: { path: '/var/log', maxAge: 7 } });
    render(<SkillConfigModal {...defaultProps} skill={skill} />);

    expect(screen.getByLabelText('path *')).toHaveValue('/var/log');
    expect(screen.getByLabelText('maxAge')).toHaveValue(7);
  });

  it('calls onSubmit with skill id and current values', async () => {
    const user = userEvent.setup();
    render(<SkillConfigModal {...defaultProps} />);

    await user.click(screen.getByText('Save Configuration'));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith('sk-1', expect.objectContaining({
        path: '/tmp',
        maxAge: 30,
        dryRun: true,
        excludeDirs: ['node_modules', '.git'],
      }));
    });
  });

  it('closes dialog after successful submit', async () => {
    const user = userEvent.setup();
    render(<SkillConfigModal {...defaultProps} />);

    await user.click(screen.getByText('Save Configuration'));

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it('closes dialog when cancel button is clicked', async () => {
    const user = userEvent.setup();
    render(<SkillConfigModal {...defaultProps} />);

    await user.click(screen.getByText('Cancel'));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
