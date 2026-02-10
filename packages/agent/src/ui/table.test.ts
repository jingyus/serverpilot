import { describe, it, expect } from 'vitest';
import { renderTable, displayEnvironmentInfo, displayInstallPlan } from './table.js';
import type { EnvironmentInfo, InstallPlan } from '@aiinstaller/shared';

// ============================================================================
// renderTable
// ============================================================================

describe('renderTable', () => {
  const columns = [
    { key: 'name', header: 'Name' },
    { key: 'value', header: 'Value' },
  ];

  it('renders a basic unicode table', () => {
    const result = renderTable({
      columns,
      rows: [{ name: 'OS', value: 'macOS' }],
    });
    expect(result).toContain('┌');
    expect(result).toContain('┐');
    expect(result).toContain('└');
    expect(result).toContain('┘');
    expect(result).toContain('Name');
    expect(result).toContain('Value');
    expect(result).toContain('OS');
    expect(result).toContain('macOS');
    expect(result).toMatch(/\n$/);
  });

  it('renders an ascii border table', () => {
    const result = renderTable({
      columns,
      rows: [{ name: 'Arch', value: 'arm64' }],
      border: 'ascii',
    });
    expect(result).toContain('+');
    expect(result).toContain('-');
    expect(result).toContain('|');
    expect(result).not.toContain('┌');
    expect(result).toContain('Arch');
    expect(result).toContain('arm64');
  });

  it('renders a borderless table', () => {
    const result = renderTable({
      columns,
      rows: [{ name: 'Key', value: 'Val' }],
      border: 'none',
    });
    expect(result).not.toContain('┌');
    expect(result).not.toContain('+');
    expect(result).toContain('Name | Value');
    expect(result).toContain('Key | Val');
  });

  it('handles empty rows', () => {
    const result = renderTable({ columns, rows: [] });
    expect(result).toContain('Name');
    expect(result).toContain('Value');
    // Should still have header and border lines
    expect(result.split('\n').length).toBeGreaterThanOrEqual(4);
  });

  it('handles multiple rows', () => {
    const result = renderTable({
      columns,
      rows: [
        { name: 'A', value: '1' },
        { name: 'B', value: '2' },
        { name: 'C', value: '3' },
      ],
    });
    expect(result).toContain('A');
    expect(result).toContain('B');
    expect(result).toContain('C');
    expect(result).toContain('1');
    expect(result).toContain('2');
    expect(result).toContain('3');
  });

  it('handles missing cell values gracefully', () => {
    const result = renderTable({
      columns,
      rows: [{ name: 'Only Name' }],
    });
    expect(result).toContain('Only Name');
  });

  it('respects column alignment', () => {
    const cols = [
      { key: 'left', header: 'Left', align: 'left' as const },
      { key: 'right', header: 'Right', align: 'right' as const },
      { key: 'center', header: 'Center', align: 'center' as const },
    ];
    const result = renderTable({
      columns: cols,
      rows: [{ left: 'L', right: 'R', center: 'C' }],
    });
    expect(result).toContain('L');
    expect(result).toContain('R');
    expect(result).toContain('C');
  });

  it('respects minWidth', () => {
    const cols = [
      { key: 'a', header: 'A', minWidth: 30 },
      { key: 'b', header: 'B' },
    ];
    const result = renderTable({
      columns: cols,
      rows: [{ a: 'short', b: 'x' }],
    });
    // The header separator line for column 'a' should be at least 30 wide
    const lines = result.split('\n');
    const topBorder = lines[0];
    // The first column segment between box chars should be >= 30
    const segments = topBorder.slice(1, -1).split('┬');
    expect(segments[0].length).toBeGreaterThanOrEqual(30);
  });

  it('respects custom padding', () => {
    const result = renderTable({
      columns,
      rows: [{ name: 'Test', value: 'OK' }],
      padding: 3,
    });
    // With padding=3, each cell should have 3 spaces on each side
    expect(result).toContain('   Test   ');
  });
});

// ============================================================================
// displayEnvironmentInfo
// ============================================================================

describe('displayEnvironmentInfo', () => {
  const baseEnv: EnvironmentInfo = {
    os: { platform: 'darwin', version: '14.0', arch: 'arm64' },
    shell: { type: 'zsh', version: '5.9' },
    runtime: { node: 'v22.0.0' },
    packageManagers: { npm: '10.0.0', pnpm: '9.0.0' },
    network: { canAccessNpm: true, canAccessGithub: true },
    permissions: { hasSudo: true, canWriteTo: ['/usr/local'] },
  };

  it('includes all OS information', () => {
    const result = displayEnvironmentInfo(baseEnv);
    expect(result).toContain('darwin');
    expect(result).toContain('14.0');
    expect(result).toContain('arm64');
  });

  it('includes shell information', () => {
    const result = displayEnvironmentInfo(baseEnv);
    expect(result).toContain('zsh');
    expect(result).toContain('5.9');
  });

  it('includes runtime versions', () => {
    const result = displayEnvironmentInfo(baseEnv);
    expect(result).toContain('Node.js');
    expect(result).toContain('v22.0.0');
  });

  it('includes Python runtime when present', () => {
    const env = { ...baseEnv, runtime: { node: 'v22.0.0', python: '3.12.0' } };
    const result = displayEnvironmentInfo(env);
    expect(result).toContain('Python');
    expect(result).toContain('3.12.0');
  });

  it('omits Python when not present', () => {
    const result = displayEnvironmentInfo(baseEnv);
    expect(result).not.toContain('Python');
  });

  it('includes detected package managers', () => {
    const result = displayEnvironmentInfo(baseEnv);
    expect(result).toContain('npm');
    expect(result).toContain('10.0.0');
    expect(result).toContain('pnpm');
    expect(result).toContain('9.0.0');
  });

  it('omits undetected package managers', () => {
    const result = displayEnvironmentInfo(baseEnv);
    expect(result).not.toContain('yarn');
    expect(result).not.toContain('brew');
  });

  it('shows network reachability', () => {
    const result = displayEnvironmentInfo(baseEnv);
    expect(result).toContain('Reachable');
  });

  it('shows unreachable network status', () => {
    const env = {
      ...baseEnv,
      network: { canAccessNpm: false, canAccessGithub: false },
    };
    const result = displayEnvironmentInfo(env);
    expect(result).toContain('Unreachable');
  });

  it('shows permission info', () => {
    const result = displayEnvironmentInfo(baseEnv);
    expect(result).toContain('sudo');
    expect(result).toContain('Yes');
    expect(result).toContain('/usr/local');
  });

  it('shows sudo as No when unavailable', () => {
    const env = {
      ...baseEnv,
      permissions: { hasSudo: false, canWriteTo: [] },
    };
    const result = displayEnvironmentInfo(env);
    expect(result).toContain('No');
  });

  it('omits writable paths row when empty', () => {
    const env = {
      ...baseEnv,
      permissions: { hasSudo: true, canWriteTo: [] },
    };
    const result = displayEnvironmentInfo(env);
    expect(result).not.toContain('Writable Paths');
  });

  it('includes title header', () => {
    const result = displayEnvironmentInfo(baseEnv);
    expect(result).toContain('Environment Information');
  });
});

// ============================================================================
// displayInstallPlan
// ============================================================================

describe('displayInstallPlan', () => {
  const basePlan: InstallPlan = {
    steps: [
      {
        id: 'check-node',
        description: 'Check Node.js version',
        command: 'node --version',
        timeout: 30000,
        canRollback: false,
        onError: 'abort',
      },
      {
        id: 'install-pnpm',
        description: 'Install pnpm',
        command: 'npm install -g pnpm',
        timeout: 60000,
        canRollback: true,
        onError: 'retry',
      },
    ],
    estimatedTime: 90000,
    risks: [
      { level: 'low', description: 'Network speed may vary' },
    ],
  };

  it('includes title', () => {
    const result = displayInstallPlan(basePlan);
    expect(result).toContain('Install Plan');
  });

  it('shows step numbers', () => {
    const result = displayInstallPlan(basePlan);
    expect(result).toContain('1');
    expect(result).toContain('2');
  });

  it('shows step descriptions', () => {
    const result = displayInstallPlan(basePlan);
    expect(result).toContain('Check Node.js version');
    expect(result).toContain('Install pnpm');
  });

  it('shows step commands', () => {
    const result = displayInstallPlan(basePlan);
    expect(result).toContain('node --version');
    expect(result).toContain('npm install -g pnpm');
  });

  it('shows timeout in seconds', () => {
    const result = displayInstallPlan(basePlan);
    expect(result).toContain('30s');
    expect(result).toContain('60s');
  });

  it('shows rollback support', () => {
    const result = displayInstallPlan(basePlan);
    expect(result).toContain('Yes');
    expect(result).toContain('No');
  });

  it('shows error handling strategy', () => {
    const result = displayInstallPlan(basePlan);
    expect(result).toContain('abort');
    expect(result).toContain('retry');
  });

  it('shows estimated time and step count', () => {
    const result = displayInstallPlan(basePlan);
    expect(result).toContain('Estimated time: 90s');
    expect(result).toContain('Steps: 2');
  });

  it('shows risks with level', () => {
    const result = displayInstallPlan(basePlan);
    expect(result).toContain('Risks:');
    expect(result).toContain('low');
    expect(result).toContain('Network speed may vary');
  });

  it('handles plan with no risks', () => {
    const plan = { ...basePlan, risks: [] };
    const result = displayInstallPlan(plan);
    expect(result).not.toContain('Risks:');
  });

  it('handles plan with high risk', () => {
    const plan = {
      ...basePlan,
      risks: [{ level: 'high' as const, description: 'Dangerous operation' }],
    };
    const result = displayInstallPlan(plan);
    expect(result).toContain('high');
    expect(result).toContain('Dangerous operation');
  });

  it('handles plan with medium risk', () => {
    const plan = {
      ...basePlan,
      risks: [{ level: 'medium' as const, description: 'May affect config' }],
    };
    const result = displayInstallPlan(plan);
    expect(result).toContain('medium');
    expect(result).toContain('May affect config');
  });

  it('handles single step plan', () => {
    const plan = {
      steps: [basePlan.steps[0]],
      estimatedTime: 30000,
      risks: [],
    };
    const result = displayInstallPlan(plan);
    expect(result).toContain('Steps: 1');
    expect(result).toContain('Estimated time: 30s');
  });

  it('handles empty steps', () => {
    const plan: InstallPlan = {
      steps: [],
      estimatedTime: 0,
      risks: [],
    };
    const result = displayInstallPlan(plan);
    expect(result).toContain('Steps: 0');
    expect(result).toContain('Estimated time: 0s');
  });
});
