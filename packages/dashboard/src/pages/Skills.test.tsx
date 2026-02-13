// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Skills } from './Skills';
import { useSkillsStore } from '@/stores/skills';
import { useServersStore } from '@/stores/servers';
import type { InstalledSkill, AvailableSkill, SkillExecution } from '@/types/skill';
import type { Server } from '@/types/server';

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

const mockServers: Server[] = [
  { id: 'srv-1', name: 'Web Server', status: 'online', tags: [], group: null, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
  { id: 'srv-2', name: 'DB Server', status: 'offline', tags: [], group: null, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
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

function setupStore(
  overrides: Partial<ReturnType<typeof useSkillsStore.getState>> = {},
  serverOverrides: Partial<ReturnType<typeof useServersStore.getState>> = {},
) {
  useSkillsStore.setState({
    skills: mockSkills,
    available: mockAvailable,
    executions: [],
    pendingConfirmations: [],
    executionEvents: [],
    isStreaming: false,
    isLoading: false,
    error: null,
    stats: null,
    isLoadingStats: false,
    fetchSkills: vi.fn().mockResolvedValue(undefined),
    fetchAvailable: vi.fn().mockResolvedValue(undefined),
    fetchStats: vi.fn().mockResolvedValue(undefined),
    installSkill: vi.fn().mockResolvedValue(makeSkill()),
    uninstallSkill: vi.fn().mockResolvedValue(undefined),
    configureSkill: vi.fn().mockResolvedValue(undefined),
    updateStatus: vi.fn().mockResolvedValue(undefined),
    executeSkill: vi.fn().mockResolvedValue({ executionId: 'e1', status: 'success', stepsExecuted: 1, duration: 100, result: null, errors: [] }),
    fetchExecutions: vi.fn().mockResolvedValue(undefined),
    fetchPendingConfirmations: vi.fn().mockResolvedValue(undefined),
    confirmExecution: vi.fn().mockResolvedValue({ executionId: 'exec-p1', status: 'success', stepsExecuted: 1, duration: 100, result: null, errors: [] }),
    rejectExecution: vi.fn().mockResolvedValue(undefined),
    dryRunSkill: vi.fn().mockResolvedValue({ executionId: 'exec-dry-1', status: 'success', stepsExecuted: 0, duration: 800, result: { output: 'Step 1: shell — apt update' }, errors: [] }),
    clearDryRunResult: vi.fn(),
    dryRunResult: null,
    isDryRunning: false,
    startExecutionStream: vi.fn(),
    stopExecutionStream: vi.fn(),
    clearError: vi.fn(),
    exportSkill: vi.fn().mockResolvedValue(undefined),
    importSkill: vi.fn().mockResolvedValue(undefined),
    isExporting: null,
    isImporting: false,
    ...overrides,
  });

  useServersStore.setState({
    servers: mockServers,
    isLoading: false,
    error: null,
    fetchServers: vi.fn().mockResolvedValue(undefined),
    ...serverOverrides,
  });
}

// ============================================================================
// Tests
// ============================================================================

describe('Skills Page', () => {
  beforeEach(() => {
    setupStore();
    // jsdom doesn't implement scrollTo
    Element.prototype.scrollTo = vi.fn();
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

  // --------------------------------------------------------------------------
  // Manifest Inputs (skill-019)
  // --------------------------------------------------------------------------

  it('should render manifest inputs in config modal when available', async () => {
    setupStore({
      skills: [makeSkill({
        inputs: [
          { name: 'port', type: 'number', required: true, description: 'Server port', default: 80 },
          { name: 'enable_ssl', type: 'boolean', required: false, description: 'Enable SSL' },
        ],
      })],
    });
    const user = userEvent.setup();
    renderSkills();

    const configButtons = screen.getAllByTitle('Configure');
    await user.click(configButtons[0]);

    // Should show manifest input descriptions, not generic "Configuration for port"
    expect(screen.getByText('Server port')).toBeInTheDocument();
    expect(screen.getByText('Enable SSL')).toBeInTheDocument();
  });

  it('should render enum input as dropdown with options from manifest', async () => {
    setupStore({
      skills: [makeSkill({
        config: { log_level: 'info' },
        inputs: [
          { name: 'log_level', type: 'enum', required: false, description: 'Logging level', options: ['debug', 'info', 'warn', 'error'] },
        ],
      })],
    });
    const user = userEvent.setup();
    renderSkills();

    const configButtons = screen.getAllByTitle('Configure');
    await user.click(configButtons[0]);

    expect(screen.getByText('Logging level')).toBeInTheDocument();
    // Enum should render as a select with options
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.value);
    expect(options).toContain('debug');
    expect(options).toContain('info');
    expect(options).toContain('warn');
    expect(options).toContain('error');
  });

  it('should mark required inputs with asterisk in config modal', async () => {
    setupStore({
      skills: [makeSkill({
        inputs: [
          { name: 'api_key', type: 'string', required: true, description: 'API key for service' },
        ],
      })],
    });
    const user = userEvent.setup();
    renderSkills();

    const configButtons = screen.getAllByTitle('Configure');
    await user.click(configButtons[0]);

    // Required inputs should have " *" after their name
    expect(screen.getByText('api_key *')).toBeInTheDocument();
  });

  it('should fall back to config key inference when inputs are absent', async () => {
    setupStore({
      skills: [makeSkill({
        config: { port: 80, debug: true },
        inputs: undefined,
      })],
    });
    const user = userEvent.setup();
    renderSkills();

    const configButtons = screen.getAllByTitle('Configure');
    await user.click(configButtons[0]);

    // Fallback: generic descriptions from config key inference
    expect(screen.getByText('Configuration for port')).toBeInTheDocument();
    expect(screen.getByText('Configuration for debug')).toBeInTheDocument();
  });

  it('should show default values from manifest inputs', async () => {
    setupStore({
      skills: [makeSkill({
        config: null,
        inputs: [
          { name: 'timeout', type: 'number', required: false, description: 'Request timeout in seconds', default: 30 },
        ],
      })],
    });
    const user = userEvent.setup();
    renderSkills();

    const configButtons = screen.getAllByTitle('Configure');
    await user.click(configButtons[0]);

    expect(screen.getByText('Request timeout in seconds')).toBeInTheDocument();
    // Default value should be pre-filled in the input
    const input = screen.getByRole('spinbutton') as HTMLInputElement;
    expect(input.value).toBe('30');
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

  // --------------------------------------------------------------------------
  // Execute Skill Flow
  // --------------------------------------------------------------------------

  it('should open execute dialog with server selector when clicking execute', async () => {
    const user = userEvent.setup();
    renderSkills();

    // Click the execute (Zap) button on the first enabled skill
    const executeButtons = screen.getAllByTitle('Execute');
    await user.click(executeButtons[0]);

    expect(screen.getByText('Execute Skill')).toBeInTheDocument();
    // Dialog description also shows skill name (alongside card), so use getAllByText
    expect(screen.getAllByText('Nginx Setup').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByTestId('exec-server-select')).toBeInTheDocument();

    // Only online servers should appear in dropdown
    const select = screen.getByTestId('exec-server-select') as HTMLSelectElement;
    const options = Array.from(select.options);
    expect(options.some((o) => o.text === 'Web Server')).toBe(true);
    expect(options.some((o) => o.text === 'DB Server')).toBe(false);
  });

  it('should call executeSkill when selecting server and confirming execution', async () => {
    const executeSkill = vi.fn().mockResolvedValue({
      executionId: 'exec-new',
      status: 'success',
      stepsExecuted: 2,
      duration: 500,
      result: null,
      errors: [],
    });
    setupStore({ executeSkill });
    const user = userEvent.setup();
    renderSkills();

    // Open execute dialog
    const executeButtons = screen.getAllByTitle('Execute');
    await user.click(executeButtons[0]);

    // Select a server
    const select = screen.getByTestId('exec-server-select');
    await user.selectOptions(select, 'srv-1');

    // Click Execute button in dialog
    const confirmBtn = screen.getByRole('button', { name: 'Execute' });
    await user.click(confirmBtn);

    expect(executeSkill).toHaveBeenCalledWith('sk-1', 'srv-1', undefined, undefined);
  });

  it('should show no servers message when no online servers available', async () => {
    setupStore({}, { servers: [{ id: 'srv-3', name: 'Down Server', status: 'offline', tags: [], group: null, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }] });
    const user = userEvent.setup();
    renderSkills();

    const executeButtons = screen.getAllByTitle('Execute');
    await user.click(executeButtons[0]);

    expect(screen.getByText('No servers available')).toBeInTheDocument();
  });

  it('should disable execute confirm button when no server is selected', async () => {
    const user = userEvent.setup();
    renderSkills();

    const executeButtons = screen.getAllByTitle('Execute');
    await user.click(executeButtons[0]);

    const confirmBtn = screen.getByRole('button', { name: 'Execute' });
    expect(confirmBtn).toBeDisabled();
  });

  it('should show execution stream after triggering execution', async () => {
    const executeSkill = vi.fn().mockResolvedValue({
      executionId: 'exec-stream-1',
      status: 'running',
      stepsExecuted: 0,
      duration: 0,
      result: null,
      errors: [],
    });
    const startExecutionStream = vi.fn();
    setupStore({ executeSkill, startExecutionStream });
    const user = userEvent.setup();
    renderSkills();

    // Open execute dialog
    const executeButtons = screen.getAllByTitle('Execute');
    await user.click(executeButtons[0]);

    // Select server and execute
    await user.selectOptions(screen.getByTestId('exec-server-select'), 'srv-1');
    await user.click(screen.getByRole('button', { name: 'Execute' }));

    // After execution, the ExecutionStream component should be rendered
    // The dialog should now show Dismiss button instead of Cancel/Execute
    expect(screen.getByText('Dismiss')).toBeInTheDocument();
    expect(startExecutionStream).toHaveBeenCalledWith('exec-stream-1');
  });

  // --------------------------------------------------------------------------
  // Pending Confirmations UI
  // --------------------------------------------------------------------------

  it('should show pending confirmations banner when there are pending executions', () => {
    setupStore({
      pendingConfirmations: [
        makeExecution({ id: 'exec-p1', status: 'pending_confirmation', triggerType: 'cron', skillId: 'sk-1' }),
      ],
    });
    renderSkills();

    const banner = screen.getByTestId('pending-confirmations');
    expect(banner).toBeInTheDocument();
    expect(within(banner).getByText(/1 skill execution\(s\) awaiting confirmation/)).toBeInTheDocument();
    expect(within(banner).getByText('Nginx Setup')).toBeInTheDocument();
    expect(within(banner).getByText(/triggered by cron/)).toBeInTheDocument();
  });

  it('should not show pending confirmations banner when empty', () => {
    setupStore({ pendingConfirmations: [] });
    renderSkills();

    expect(screen.queryByTestId('pending-confirmations')).not.toBeInTheDocument();
  });

  it('should call confirmExecution when clicking confirm button', async () => {
    const confirmExecution = vi.fn().mockResolvedValue({
      executionId: 'exec-p1', status: 'success', stepsExecuted: 1, duration: 100, result: null, errors: [],
    });
    setupStore({
      pendingConfirmations: [
        makeExecution({ id: 'exec-p1', status: 'pending_confirmation', triggerType: 'cron', skillId: 'sk-1' }),
      ],
      confirmExecution,
    });
    const user = userEvent.setup();
    renderSkills();

    await user.click(screen.getByTestId('confirm-exec-p1'));
    expect(confirmExecution).toHaveBeenCalledWith('exec-p1');
  });

  it('should call rejectExecution when clicking reject button', async () => {
    const rejectExecution = vi.fn().mockResolvedValue(undefined);
    setupStore({
      pendingConfirmations: [
        makeExecution({ id: 'exec-p1', status: 'pending_confirmation', triggerType: 'event', skillId: 'sk-1' }),
      ],
      rejectExecution,
    });
    const user = userEvent.setup();
    renderSkills();

    await user.click(screen.getByTestId('reject-exec-p1'));
    expect(rejectExecution).toHaveBeenCalledWith('exec-p1');
  });

  it('should call fetchPendingConfirmations on mount', () => {
    const fetchPendingConfirmations = vi.fn().mockResolvedValue(undefined);
    setupStore({ fetchPendingConfirmations });
    renderSkills();
    expect(fetchPendingConfirmations).toHaveBeenCalled();
  });

  // --------------------------------------------------------------------------
  // Analytics Tab
  // --------------------------------------------------------------------------

  it('should render Analytics tab and show stats', async () => {
    setupStore({
      stats: {
        totalExecutions: 42,
        successRate: 0.85,
        avgDuration: 2500,
        topSkills: [{ skillId: 'sk-1', skillName: 'Nginx Setup', executionCount: 20, successCount: 18 }],
        dailyTrend: [{ date: '2026-02-12', total: 5, success: 4, failed: 1 }],
        triggerDistribution: [{ triggerType: 'manual', count: 30 }],
      },
    });
    const user = userEvent.setup();
    renderSkills();

    // Click Analytics tab
    await user.click(screen.getByText('Analytics'));

    // Should show summary stats - use getAllByText since '42' appears in both tab badge and card
    expect(screen.getByText('85%')).toBeInTheDocument();
    expect(screen.getByText('2.5s')).toBeInTheDocument();
    expect(screen.getByText('Total Executions')).toBeInTheDocument();
    expect(screen.getByText('Success Rate')).toBeInTheDocument();
  });

  it('should show empty state when no stats available', async () => {
    setupStore({ stats: null });
    const user = userEvent.setup();
    renderSkills();

    await user.click(screen.getByText('Analytics'));
    expect(screen.getByText('No execution data yet.')).toBeInTheDocument();
  });

  it('should call fetchStats on mount', () => {
    const fetchStats = vi.fn().mockResolvedValue(undefined);
    setupStore({ fetchStats });
    renderSkills();
    expect(fetchStats).toHaveBeenCalled();
  });

  // --------------------------------------------------------------------------
  // Dry-Run Preview Flow
  // --------------------------------------------------------------------------

  it('should show preview button in execute dialog and call dryRunSkill on click', async () => {
    const dryRunSkill = vi.fn().mockResolvedValue({
      executionId: 'exec-dry-1', status: 'success', stepsExecuted: 0,
      duration: 800, result: { output: 'Step 1: shell — apt update' }, errors: [],
    });
    setupStore({ dryRunSkill });
    const user = userEvent.setup();
    renderSkills();

    // Open execute dialog
    const executeButtons = screen.getAllByTitle('Execute');
    await user.click(executeButtons[0]);

    // Select a server
    await user.selectOptions(screen.getByTestId('exec-server-select'), 'srv-1');

    // Click Preview button
    const previewBtn = screen.getByTestId('preview-btn');
    expect(previewBtn).toBeInTheDocument();
    await user.click(previewBtn);

    expect(dryRunSkill).toHaveBeenCalledWith('sk-1', 'srv-1');
  });

  it('should disable preview button when no server is selected', async () => {
    setupStore();
    const user = userEvent.setup();
    renderSkills();

    const executeButtons = screen.getAllByTitle('Execute');
    await user.click(executeButtons[0]);

    const previewBtn = screen.getByTestId('preview-btn');
    expect(previewBtn).toBeDisabled();
  });

  it('should display dry-run result panel after preview completes', async () => {
    const dryRunResult = {
      executionId: 'exec-dry-1', status: 'success' as const, stepsExecuted: 0,
      duration: 800, result: { output: 'Step 1: shell — apt update\nStep 2: shell — apt upgrade' }, errors: [],
    };
    setupStore({ dryRunResult });
    const user = userEvent.setup();
    renderSkills();

    // Open execute dialog
    const executeButtons = screen.getAllByTitle('Execute');
    await user.click(executeButtons[0]);

    // Dry-run result should be visible
    expect(screen.getByTestId('dry-run-result')).toBeInTheDocument();
    expect(screen.getByTestId('dry-run-badge')).toHaveTextContent('DRY RUN');
    expect(screen.getByTestId('dry-run-output')).toHaveTextContent('Step 1: shell — apt update');
  });

  it('should allow execution after previewing dry-run result', async () => {
    const dryRunResult = {
      executionId: 'exec-dry-1', status: 'success' as const, stepsExecuted: 0,
      duration: 800, result: { output: 'Step 1: shell — apt update' }, errors: [],
    };
    const executeSkill = vi.fn().mockResolvedValue({
      executionId: 'exec-real-1', status: 'success', stepsExecuted: 2,
      duration: 1500, result: null, errors: [],
    });
    setupStore({ dryRunResult, executeSkill });
    const user = userEvent.setup();
    renderSkills();

    // Open execute dialog
    const executeButtons = screen.getAllByTitle('Execute');
    await user.click(executeButtons[0]);

    // Dry-run result is displayed — select server and execute
    await user.selectOptions(screen.getByTestId('exec-server-select'), 'srv-1');
    await user.click(screen.getByRole('button', { name: 'Execute' }));

    expect(executeSkill).toHaveBeenCalledWith('sk-1', 'srv-1', undefined, undefined);
  });

  it('should clear dry-run result when closing execute dialog', async () => {
    const clearDryRunResult = vi.fn();
    const dryRunResult = {
      executionId: 'exec-dry-1', status: 'success' as const, stepsExecuted: 0,
      duration: 800, result: { output: 'Step 1: shell — apt update' }, errors: [],
    };
    setupStore({ dryRunResult, clearDryRunResult });
    const user = userEvent.setup();
    renderSkills();

    // Open execute dialog
    const executeButtons = screen.getAllByTitle('Execute');
    await user.click(executeButtons[0]);

    // Close dialog
    await user.click(screen.getByText('Cancel'));

    expect(clearDryRunResult).toHaveBeenCalled();
  });

  it('should show previewing loading state when isDryRunning is true', async () => {
    setupStore({ isDryRunning: true });
    const user = userEvent.setup();
    renderSkills();

    // Open execute dialog
    const executeButtons = screen.getAllByTitle('Execute');
    await user.click(executeButtons[0]);

    const previewBtn = screen.getByTestId('preview-btn');
    expect(previewBtn).toBeDisabled();
    expect(previewBtn).toHaveTextContent('Previewing...');
  });

  // --------------------------------------------------------------------------
  // Export / Import
  // --------------------------------------------------------------------------

  it('should show export button on skill cards and call exportSkill', async () => {
    const exportSkill = vi.fn().mockResolvedValue(undefined);
    setupStore({ exportSkill });
    const user = userEvent.setup();
    renderSkills();

    const exportButtons = screen.getAllByTitle('Export');
    expect(exportButtons.length).toBeGreaterThanOrEqual(1);
    await user.click(exportButtons[0]);

    expect(exportSkill).toHaveBeenCalledWith('sk-1');
  });

  it('should show import skill button on installed tab', () => {
    renderSkills();

    const importBtn = screen.getByTestId('import-skill-btn');
    expect(importBtn).toBeInTheDocument();
    expect(importBtn).toHaveTextContent('Import Skill');
  });

  it('should call importSkill when a file is selected via import input', async () => {
    const importSkill = vi.fn().mockResolvedValue(undefined);
    setupStore({ importSkill });
    renderSkills();

    const fileInput = screen.getByTestId('import-file-input') as HTMLInputElement;
    const file = new File(['test-content'], 'my-skill.tar.gz', { type: 'application/gzip' });
    await userEvent.upload(fileInput, file);

    expect(importSkill).toHaveBeenCalledWith(file);
  });

  it('should disable import button when isImporting is true', () => {
    setupStore({ isImporting: true });
    renderSkills();

    const importBtn = screen.getByTestId('import-skill-btn');
    expect(importBtn).toBeDisabled();
  });
});
