// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Skills } from './Skills';
import { useSkillsStore } from '@/stores/skills';
import type { InstalledSkill, AvailableSkill, SkillExecution } from '@/types/skill';

// ============================================================================
// Mock Data
// ============================================================================

const makeSkill = (overrides: Partial<InstalledSkill> = {}): InstalledSkill => ({
  id: 'sk-1',
  userId: 'user-1',
  tenantId: null,
  name: 'nginx-setup',
  displayName: 'Nginx Setup',
  version: '1.0.0',
  source: 'official',
  skillPath: '/skills/official/nginx-setup',
  status: 'enabled',
  config: { port: 80 },
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...overrides,
});

const makeAvailable = (overrides: Partial<AvailableSkill> = {}): AvailableSkill => ({
  manifest: {
    name: 'redis-setup',
    displayName: 'Redis Setup',
    version: '1.0.0',
    description: 'Install and configure Redis',
    author: 'ServerPilot',
    tags: ['database', 'cache'],
  },
  source: 'official',
  dirPath: '/skills/official/redis-setup',
  installed: false,
  ...overrides,
});

const makeExecution = (overrides: Partial<SkillExecution> = {}): SkillExecution => ({
  id: 'exec-1',
  skillId: 'sk-1',
  serverId: 'srv-1',
  userId: 'user-1',
  triggerType: 'manual',
  status: 'success',
  startedAt: '2026-01-01T00:00:00Z',
  completedAt: '2026-01-01T00:01:00Z',
  result: { output: 'done' },
  stepsExecuted: 3,
  duration: 60000,
  ...overrides,
});

const mockSkills = [
  makeSkill(),
  makeSkill({ id: 'sk-2', name: 'ssl-cert', displayName: 'SSL Certificate', status: 'paused', config: null }),
];

const mockAvailable = [
  makeAvailable(),
  makeAvailable({
    manifest: { name: 'docker-setup', displayName: 'Docker Setup', version: '2.0.0', description: 'Install Docker', author: 'Community', tags: ['container'] },
    source: 'community',
    dirPath: '/skills/community/docker-setup',
    installed: true,
  }),
];

// ============================================================================
// Helpers
// ============================================================================

function renderSkills() {
  return render(
    <MemoryRouter>
      <Skills />
    </MemoryRouter>,
  );
}

function setupStore(overrides: Partial<ReturnType<typeof useSkillsStore.getState>> = {}) {
  useSkillsStore.setState({
    skills: mockSkills,
    available: mockAvailable,
    executions: [],
    isLoading: false,
    error: null,
    fetchSkills: vi.fn().mockResolvedValue(undefined),
    fetchAvailable: vi.fn().mockResolvedValue(undefined),
    installSkill: vi.fn().mockResolvedValue(makeSkill()),
    uninstallSkill: vi.fn().mockResolvedValue(undefined),
    configureSkill: vi.fn().mockResolvedValue(undefined),
    updateStatus: vi.fn().mockResolvedValue(undefined),
    executeSkill: vi.fn().mockResolvedValue({ executionId: 'e1', status: 'success', stepsExecuted: 1, duration: 100, result: null, errors: [] }),
    fetchExecutions: vi.fn().mockResolvedValue(undefined),
    clearError: vi.fn(),
    ...overrides,
  });
}

// ============================================================================
// Tests
// ============================================================================

describe('Skills Page', () => {
  beforeEach(() => {
    setupStore();
  });

  // --------------------------------------------------------------------------
  // Rendering
  // --------------------------------------------------------------------------

  it('should render the page title and description', () => {
    renderSkills();
    expect(screen.getByText('Skills')).toBeInTheDocument();
    expect(screen.getByText('Manage automation skills and plugins.')).toBeInTheDocument();
  });

  it('should render installed skills list', () => {
    renderSkills();
    expect(screen.getByText('Nginx Setup')).toBeInTheDocument();
    expect(screen.getByText('SSL Certificate')).toBeInTheDocument();
  });

  it('should show status badges on skill cards', () => {
    renderSkills();
    expect(screen.getByText('Enabled')).toBeInTheDocument();
    expect(screen.getByText('Paused')).toBeInTheDocument();
  });

  it('should show source badges on skill cards', () => {
    renderSkills();
    const officialBadges = screen.getAllByText('Official');
    expect(officialBadges.length).toBeGreaterThanOrEqual(2);
  });

  it('should show tab buttons with counts', () => {
    renderSkills();
    expect(screen.getByText('Installed')).toBeInTheDocument();
    expect(screen.getByText('Available')).toBeInTheDocument();
    const countBadges = screen.getAllByText('2');
    expect(countBadges.length).toBe(2); // 2 installed, 2 available
  });

  it('should show loading spinner when loading', () => {
    setupStore({ isLoading: true });
    renderSkills();
    const loader = document.querySelector('.animate-spin');
    expect(loader).toBeInTheDocument();
  });

  it('should show empty state when no skills installed', () => {
    setupStore({ skills: [] });
    renderSkills();
    expect(screen.getByText('No skills installed yet.')).toBeInTheDocument();
    expect(screen.getByText('Browse the available tab to discover and install skills.')).toBeInTheDocument();
  });

  it('should show error message with dismiss button', () => {
    const clearError = vi.fn();
    setupStore({ error: 'Failed to load skills', clearError });
    renderSkills();
    expect(screen.getByText('Failed to load skills')).toBeInTheDocument();
    expect(screen.getByText('Dismiss')).toBeInTheDocument();
  });

  // --------------------------------------------------------------------------
  // Interactions
  // --------------------------------------------------------------------------

  it('should call fetchSkills and fetchAvailable on mount', () => {
    const fetchSkills = vi.fn().mockResolvedValue(undefined);
    const fetchAvailable = vi.fn().mockResolvedValue(undefined);
    setupStore({ fetchSkills, fetchAvailable });
    renderSkills();
    expect(fetchSkills).toHaveBeenCalled();
    expect(fetchAvailable).toHaveBeenCalled();
  });

  it('should dismiss error on click', async () => {
    const clearError = vi.fn();
    setupStore({ error: 'Something went wrong', clearError });
    const user = userEvent.setup();
    renderSkills();
    await user.click(screen.getByText('Dismiss'));
    expect(clearError).toHaveBeenCalled();
  });

  it('should switch to available tab and show available skills', async () => {
    const user = userEvent.setup();
    renderSkills();

    await user.click(screen.getByText('Available'));

    expect(screen.getByText('Redis Setup')).toBeInTheDocument();
    expect(screen.getByText('Install and configure Redis')).toBeInTheDocument();
    expect(screen.getByText('Docker Setup')).toBeInTheDocument();
  });

  it('should show tags on available skill cards', async () => {
    const user = userEvent.setup();
    renderSkills();
    await user.click(screen.getByText('Available'));

    expect(screen.getByText('database')).toBeInTheDocument();
    expect(screen.getByText('cache')).toBeInTheDocument();
    expect(screen.getByText('container')).toBeInTheDocument();
  });

  it('should show empty state for available tab when no skills available', async () => {
    setupStore({ available: [] });
    const user = userEvent.setup();
    renderSkills();
    await user.click(screen.getByText('Available'));
    expect(screen.getByText('No skills available')).toBeInTheDocument();
  });

  it('should disable install button for already-installed skills', async () => {
    const user = userEvent.setup();
    renderSkills();
    await user.click(screen.getByText('Available'));

    // Docker Setup is already installed — find its card container
    const dockerCard = screen.getByText('Docker Setup').closest('[class*="rounded-lg"]')!;
    const installedBtn = within(dockerCard as HTMLElement).getByRole('button');
    expect(installedBtn).toBeDisabled();
  });

  it('should open uninstall confirmation dialog', async () => {
    const user = userEvent.setup();
    renderSkills();

    // Click the first uninstall (trash) button
    const uninstallButtons = screen.getAllByTitle('Uninstall');
    await user.click(uninstallButtons[0]);

    expect(screen.getByText('Uninstall Skill')).toBeInTheDocument();
    expect(screen.getByText(/Are you sure you want to uninstall/)).toBeInTheDocument();
  });

  it('should call uninstallSkill when confirming deletion', async () => {
    const uninstallSkill = vi.fn().mockResolvedValue(undefined);
    setupStore({ uninstallSkill });
    const user = userEvent.setup();
    renderSkills();

    const uninstallButtons = screen.getAllByTitle('Uninstall');
    await user.click(uninstallButtons[0]);

    // Confirm deletion
    const confirmBtn = screen.getByRole('button', { name: 'Uninstall' });
    await user.click(confirmBtn);
    expect(uninstallSkill).toHaveBeenCalledWith('sk-1');
  });

  it('should open configure modal when clicking configure button', async () => {
    const user = userEvent.setup();
    renderSkills();

    const configButtons = screen.getAllByTitle('Configure');
    await user.click(configButtons[0]);

    expect(screen.getByText('Configure Skill')).toBeInTheDocument();
    expect(screen.getByText('Save Configuration')).toBeInTheDocument();
  });

  it('should call updateStatus when toggling skill', async () => {
    const updateStatus = vi.fn().mockResolvedValue(undefined);
    setupStore({ updateStatus });
    const user = userEvent.setup();
    renderSkills();

    // First skill (enabled) → should pause it
    const pauseButton = screen.getByTitle('Pause');
    await user.click(pauseButton);
    expect(updateStatus).toHaveBeenCalledWith('sk-1', 'paused');
  });

  it('should open execution history dialog when clicking history', async () => {
    const fetchExecutions = vi.fn().mockResolvedValue(undefined);
    setupStore({ fetchExecutions, executions: [makeExecution()] });
    const user = userEvent.setup();
    renderSkills();

    const historyButtons = screen.getAllByText('History');
    await user.click(historyButtons[0]);

    expect(screen.getByText('Execution History')).toBeInTheDocument();
    expect(fetchExecutions).toHaveBeenCalledWith('sk-1');
  });

  it('should show execution details in history dialog', async () => {
    const fetchExecutions = vi.fn().mockResolvedValue(undefined);
    setupStore({ fetchExecutions, executions: [makeExecution()] });
    const user = userEvent.setup();
    renderSkills();

    const historyButtons = screen.getAllByText('History');
    await user.click(historyButtons[0]);

    expect(screen.getByText('Success')).toBeInTheDocument();
    expect(screen.getByText('manual')).toBeInTheDocument();
    expect(screen.getByText('3 steps')).toBeInTheDocument();
  });
});
