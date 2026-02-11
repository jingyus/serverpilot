// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  generateSummary,
  displaySummary,
  exportMarkdown,
  exportJson,
  parseJsonSummary,
  formatDuration,
} from './summary.js';
import type {
  InstallationSummary,
  InstallProblem,
  GenerateSummaryOptions,
  StepSummary,
} from './summary.js';
import type { InstallProgressResult, StepProgressResult } from './progress.js';

// ============================================================================
// Helpers
// ============================================================================

function makeSuccessResult(): InstallProgressResult {
  return {
    success: true,
    completedSteps: 3,
    totalSteps: 3,
    duration: 65000,
    steps: [
      { id: 'check-node', description: 'Check Node.js', success: true, duration: 2000 },
      { id: 'install-pnpm', description: 'Install pnpm', success: true, duration: 30000 },
      { id: 'install-app', description: 'Install OpenClaw', success: true, duration: 33000 },
    ],
  };
}

function makePartialFailureResult(): InstallProgressResult {
  return {
    success: false,
    completedSteps: 1,
    totalSteps: 3,
    duration: 35000,
    steps: [
      { id: 'check-node', description: 'Check Node.js', success: true, duration: 2000 },
      {
        id: 'install-pnpm',
        description: 'Install pnpm',
        success: false,
        duration: 33000,
        error: 'EACCES: permission denied',
      },
    ],
  };
}

function makeAllFailureResult(): InstallProgressResult {
  return {
    success: false,
    completedSteps: 0,
    totalSteps: 2,
    duration: 5000,
    steps: [
      {
        id: 'check-node',
        description: 'Check Node.js',
        success: false,
        duration: 5000,
        error: 'Node.js not found',
      },
    ],
  };
}

function makeEmptyResult(): InstallProgressResult {
  return {
    success: true,
    completedSteps: 0,
    totalSteps: 0,
    duration: 0,
    steps: [],
  };
}

// ============================================================================
// formatDuration
// ============================================================================

describe('formatDuration', () => {
  it('returns "< 1s" for durations under 1 second', () => {
    expect(formatDuration(0)).toBe('< 1s');
    expect(formatDuration(500)).toBe('< 1s');
    expect(formatDuration(999)).toBe('< 1s');
  });

  it('returns seconds only for durations under 1 minute', () => {
    expect(formatDuration(1000)).toBe('1s');
    expect(formatDuration(5000)).toBe('5s');
    expect(formatDuration(59000)).toBe('59s');
  });

  it('returns minutes only when seconds are zero', () => {
    expect(formatDuration(60000)).toBe('1m');
    expect(formatDuration(120000)).toBe('2m');
  });

  it('returns minutes and seconds for mixed durations', () => {
    expect(formatDuration(90000)).toBe('1m 30s');
    expect(formatDuration(65000)).toBe('1m 5s');
    expect(formatDuration(150000)).toBe('2m 30s');
  });
});

// ============================================================================
// generateSummary
// ============================================================================

describe('generateSummary', () => {
  it('generates a summary from a successful installation', () => {
    const result = makeSuccessResult();
    const summary = generateSummary({ software: 'OpenClaw', result });

    expect(summary.success).toBe(true);
    expect(summary.software).toBe('OpenClaw');
    expect(summary.totalDurationMs).toBe(65000);
    expect(summary.steps).toHaveLength(3);
    expect(summary.successCount).toBe(3);
    expect(summary.failureCount).toBe(0);
    expect(summary.totalSteps).toBe(3);
    expect(summary.successRate).toBe(100);
    expect(summary.problems).toEqual([]);
  });

  it('generates a summary from a partial failure', () => {
    const result = makePartialFailureResult();
    const summary = generateSummary({ software: 'OpenClaw', result });

    expect(summary.success).toBe(false);
    expect(summary.successCount).toBe(1);
    expect(summary.failureCount).toBe(1);
    expect(summary.totalSteps).toBe(3);
    // successRate is based on steps that were executed (2 steps in result.steps, 1 success)
    // But totalSteps is 3, so successRate = 1/3 = 33%
    expect(summary.successRate).toBe(33);
  });

  it('includes problems when provided', () => {
    const result = makePartialFailureResult();
    const problems: InstallProblem[] = [
      {
        stepId: 'install-pnpm',
        description: 'Permission denied when installing globally',
        solution: 'Used pnpm setup instead',
      },
    ];
    const summary = generateSummary({ software: 'OpenClaw', result, problems });

    expect(summary.problems).toHaveLength(1);
    expect(summary.problems[0].stepId).toBe('install-pnpm');
    expect(summary.problems[0].solution).toBe('Used pnpm setup instead');
  });

  it('handles empty steps list', () => {
    const result = makeEmptyResult();
    const summary = generateSummary({ software: 'TestApp', result });

    expect(summary.success).toBe(true);
    expect(summary.steps).toHaveLength(0);
    expect(summary.successRate).toBe(0);
    expect(summary.totalSteps).toBe(0);
  });

  it('uses provided startedAt timestamp', () => {
    const result = makeSuccessResult();
    const startedAt = '2026-02-07T10:00:00.000Z';
    const summary = generateSummary({ software: 'OpenClaw', result, startedAt });

    expect(summary.startedAt).toBe(startedAt);
  });

  it('calculates startedAt from duration when not provided', () => {
    const result = makeSuccessResult();
    const before = Date.now() - result.duration;
    const summary = generateSummary({ software: 'OpenClaw', result });

    const parsedStart = new Date(summary.startedAt).getTime();
    // Allow 1 second tolerance for timing
    expect(parsedStart).toBeGreaterThanOrEqual(before - 1000);
    expect(parsedStart).toBeLessThanOrEqual(before + 1000);
  });

  it('sets finishedAt to approximately now', () => {
    const before = Date.now();
    const result = makeSuccessResult();
    const summary = generateSummary({ software: 'OpenClaw', result });
    const after = Date.now();

    const finishedMs = new Date(summary.finishedAt).getTime();
    expect(finishedMs).toBeGreaterThanOrEqual(before);
    expect(finishedMs).toBeLessThanOrEqual(after + 100);
  });

  it('maps step errors correctly', () => {
    const result = makeAllFailureResult();
    const summary = generateSummary({ software: 'OpenClaw', result });

    expect(summary.steps[0].error).toBe('Node.js not found');
    expect(summary.failureCount).toBe(1);
  });
});

// ============================================================================
// displaySummary
// ============================================================================

describe('displaySummary', () => {
  function makeSummary(overrides: Partial<InstallationSummary> = {}): InstallationSummary {
    return {
      success: true,
      software: 'OpenClaw',
      totalDurationMs: 65000,
      startedAt: '2026-02-07T10:00:00.000Z',
      finishedAt: '2026-02-07T10:01:05.000Z',
      steps: [
        { id: 'check-node', description: 'Check Node.js', success: true, durationMs: 2000 },
        { id: 'install-pnpm', description: 'Install pnpm', success: true, durationMs: 30000 },
        { id: 'install-app', description: 'Install OpenClaw', success: true, durationMs: 33000 },
      ],
      problems: [],
      successRate: 100,
      successCount: 3,
      failureCount: 0,
      totalSteps: 3,
      ...overrides,
    };
  }

  it('includes the software name', () => {
    const output = displaySummary(makeSummary());
    expect(output).toContain('OpenClaw');
  });

  it('includes "Installation Summary" header', () => {
    const output = displaySummary(makeSummary());
    expect(output).toContain('Installation Summary');
  });

  it('displays total duration', () => {
    const output = displaySummary(makeSummary());
    expect(output).toContain('1m 5s');
  });

  it('displays success rate', () => {
    const output = displaySummary(makeSummary());
    expect(output).toContain('100%');
    expect(output).toContain('3/3');
  });

  it('shows PASS for successful steps', () => {
    const output = displaySummary(makeSummary());
    expect(output).toContain('PASS');
  });

  it('shows FAIL for failed steps', () => {
    const output = displaySummary(
      makeSummary({
        success: false,
        steps: [
          {
            id: 'check-node',
            description: 'Check Node.js',
            success: false,
            durationMs: 5000,
            error: 'Not found',
          },
        ],
        failureCount: 1,
        successCount: 0,
        successRate: 0,
      }),
    );
    expect(output).toContain('FAIL');
  });

  it('displays problems section when problems exist', () => {
    const output = displaySummary(
      makeSummary({
        problems: [
          { stepId: 'install-pnpm', description: 'Network timeout', solution: 'Used mirror' },
        ],
      }),
    );
    expect(output).toContain('Problems Encountered');
    expect(output).toContain('Network timeout');
    expect(output).toContain('Used mirror');
  });

  it('displays "Unresolved" for problems without solution', () => {
    const output = displaySummary(
      makeSummary({
        problems: [{ stepId: 'install-pnpm', description: 'Network error', solution: null }],
      }),
    );
    expect(output).toContain('Unresolved');
  });

  it('shows failed steps section when no problems provided', () => {
    const output = displaySummary(
      makeSummary({
        success: false,
        steps: [
          {
            id: 'install-pnpm',
            description: 'Install pnpm',
            success: false,
            durationMs: 5000,
            error: 'Permission denied',
          },
        ],
        problems: [],
        failureCount: 1,
        successCount: 0,
      }),
    );
    expect(output).toContain('Failed Steps');
    expect(output).toContain('Permission denied');
  });

  it('does not show failed steps section when problems are present', () => {
    const output = displaySummary(
      makeSummary({
        success: false,
        steps: [
          {
            id: 'install-pnpm',
            description: 'Install pnpm',
            success: false,
            durationMs: 5000,
            error: 'Permission denied',
          },
        ],
        problems: [
          {
            stepId: 'install-pnpm',
            description: 'Permission denied',
            solution: 'Used sudo',
          },
        ],
        failureCount: 1,
        successCount: 0,
      }),
    );
    expect(output).not.toContain('Failed Steps');
    expect(output).toContain('Problems Encountered');
  });
});

// ============================================================================
// exportMarkdown
// ============================================================================

describe('exportMarkdown', () => {
  function makeSummary(overrides: Partial<InstallationSummary> = {}): InstallationSummary {
    return {
      success: true,
      software: 'OpenClaw',
      totalDurationMs: 65000,
      startedAt: '2026-02-07T10:00:00.000Z',
      finishedAt: '2026-02-07T10:01:05.000Z',
      steps: [
        { id: 'check-node', description: 'Check Node.js', success: true, durationMs: 2000 },
        { id: 'install-pnpm', description: 'Install pnpm', success: true, durationMs: 30000 },
      ],
      problems: [],
      successRate: 100,
      successCount: 2,
      failureCount: 0,
      totalSteps: 2,
      ...overrides,
    };
  }

  it('starts with a heading including the software name', () => {
    const md = exportMarkdown(makeSummary());
    expect(md).toMatch(/^# Installation Report: OpenClaw/);
  });

  it('includes status, duration, timestamps, and success rate', () => {
    const md = exportMarkdown(makeSummary());
    expect(md).toContain('**Status**: SUCCESS');
    expect(md).toContain('**Duration**: 1m 5s');
    expect(md).toContain('**Started**: 2026-02-07T10:00:00.000Z');
    expect(md).toContain('**Finished**: 2026-02-07T10:01:05.000Z');
    expect(md).toContain('**Success Rate**: 100%');
  });

  it('renders a Markdown table with steps', () => {
    const md = exportMarkdown(makeSummary());
    expect(md).toContain('| # | Step | Status | Duration |');
    expect(md).toContain('| 1 | Check Node.js | PASS | 2s |');
    expect(md).toContain('| 2 | Install pnpm | PASS | 30s |');
  });

  it('shows FAILED status for unsuccessful installation', () => {
    const md = exportMarkdown(makeSummary({ success: false }));
    expect(md).toContain('**Status**: FAILED');
  });

  it('includes problems section in Markdown', () => {
    const md = exportMarkdown(
      makeSummary({
        problems: [
          { stepId: 'install-pnpm', description: 'Timeout error', solution: 'Retried with mirror' },
        ],
      }),
    );
    expect(md).toContain('## Problems Encountered');
    expect(md).toContain('### install-pnpm');
    expect(md).toContain('- **Problem**: Timeout error');
    expect(md).toContain('- **Solution**: Retried with mirror');
  });

  it('shows unresolved problem solution', () => {
    const md = exportMarkdown(
      makeSummary({
        problems: [
          { stepId: 'install-pnpm', description: 'Unknown error', solution: null },
        ],
      }),
    );
    expect(md).toContain('- **Solution**: Unresolved');
  });

  it('includes failed steps section when no problems', () => {
    const md = exportMarkdown(
      makeSummary({
        success: false,
        steps: [
          {
            id: 'install-pnpm',
            description: 'Install pnpm',
            success: false,
            durationMs: 5000,
            error: 'EACCES',
          },
        ],
        problems: [],
        failureCount: 1,
        successCount: 0,
      }),
    );
    expect(md).toContain('## Failed Steps');
    expect(md).toContain('- **Install pnpm**: EACCES');
  });

  it('ends with a generation footer', () => {
    const md = exportMarkdown(makeSummary());
    expect(md).toContain('*Generated by AI Installer*');
  });
});

// ============================================================================
// exportJson / parseJsonSummary
// ============================================================================

describe('exportJson', () => {
  it('produces valid JSON', () => {
    const result = makeSuccessResult();
    const summary = generateSummary({ software: 'OpenClaw', result });
    const json = exportJson(summary);

    expect(() => JSON.parse(json)).not.toThrow();
  });

  it('preserves all fields in JSON', () => {
    const result = makeSuccessResult();
    const problems: InstallProblem[] = [
      { stepId: 'check-node', description: 'Node too old', solution: 'Upgraded' },
    ];
    const summary = generateSummary({ software: 'OpenClaw', result, problems });
    const json = exportJson(summary);
    const parsed = JSON.parse(json);

    expect(parsed.success).toBe(true);
    expect(parsed.software).toBe('OpenClaw');
    expect(parsed.totalDurationMs).toBe(65000);
    expect(parsed.steps).toHaveLength(3);
    expect(parsed.problems).toHaveLength(1);
    expect(parsed.successRate).toBe(100);
  });

  it('is pretty-printed with 2-space indentation', () => {
    const result = makeSuccessResult();
    const summary = generateSummary({ software: 'TestApp', result });
    const json = exportJson(summary);
    // Pretty-printed JSON has newlines and indentation
    expect(json).toContain('\n');
    expect(json).toContain('  "success"');
  });
});

describe('parseJsonSummary', () => {
  it('round-trips through export and parse', () => {
    const result = makeSuccessResult();
    const original = generateSummary({ software: 'OpenClaw', result });
    const json = exportJson(original);
    const parsed = parseJsonSummary(json);

    expect(parsed.success).toBe(original.success);
    expect(parsed.software).toBe(original.software);
    expect(parsed.totalDurationMs).toBe(original.totalDurationMs);
    expect(parsed.steps).toEqual(original.steps);
    expect(parsed.successRate).toBe(original.successRate);
  });

  it('throws on invalid JSON', () => {
    expect(() => parseJsonSummary('not json')).toThrow();
  });
});
