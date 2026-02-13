// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for run_as execution identity constraint.
 *
 * Covers: sudo wrapping, risk level escalation for root,
 * audit log run_as recording, input validation, and
 * the wrapWithRunAs / escalateRiskLevel helper functions.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { SkillToolExecutor, wrapWithRunAs } from './runner-executor.js';
import { escalateRiskLevel } from './runner-tools.js';
import type { ToolUseBlock } from '../../ai/providers/base.js';

// ============================================================================
// Mocks
// ============================================================================

vi.mock('../task/executor.js', () => {
  const mockExecutor = {
    executeCommand: vi.fn(),
  };
  return {
    getTaskExecutor: vi.fn(() => mockExecutor),
  };
});

vi.mock('../agent/agent-connector.js', () => ({
  findConnectedAgent: vi.fn(() => 'client-123'),
}));

vi.mock('../security/audit-logger.js', () => {
  const mockAuditLogger = {
    log: vi.fn().mockResolvedValue({ id: 'audit-1' }),
    updateExecutionResult: vi.fn().mockResolvedValue(true),
  };
  return {
    getAuditLogger: vi.fn(() => mockAuditLogger),
  };
});

vi.mock('../webhook/dispatcher.js', () => ({
  getWebhookDispatcher: vi.fn(() => ({
    dispatch: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('./store.js', () => ({
  getSkillKVStore: vi.fn(() => ({
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    deleteAll: vi.fn().mockResolvedValue(0),
    list: vi.fn().mockResolvedValue({}),
  })),
}));

// Access mocks for assertion
const { getTaskExecutor } = await import('../task/executor.js');
const { findConnectedAgent } = await import('../agent/agent-connector.js');
const { getAuditLogger } = await import('../security/audit-logger.js');

function getMockExecutor() {
  return (getTaskExecutor as ReturnType<typeof vi.fn>)() as {
    executeCommand: ReturnType<typeof vi.fn>;
  };
}

function getMockAuditLogger() {
  return (getAuditLogger as ReturnType<typeof vi.fn>)() as {
    log: ReturnType<typeof vi.fn>;
    updateExecutionResult: ReturnType<typeof vi.fn>;
  };
}

// ============================================================================
// Helpers
// ============================================================================

function toolUse(
  name: string,
  input: Record<string, unknown>,
  id = 'tc-1',
): ToolUseBlock {
  return { type: 'tool_use', id, name, input };
}

const DEFAULTS = {
  skillId: 'skill-1',
  serverId: 'server-1',
  userId: 'user-1',
  executionId: 'exec-1',
  riskLevelMax: 'red',
  skillName: 'test-skill',
};

function callTool(
  executor: SkillToolExecutor,
  tool: ToolUseBlock,
  overrides: Partial<typeof DEFAULTS & { runAs: string }> = {},
) {
  const { runAs, ...rest } = overrides;
  const p = { ...DEFAULTS, ...rest };
  return executor.executeTool(
    tool,
    p.skillId,
    p.serverId,
    p.userId,
    p.executionId,
    p.riskLevelMax,
    p.skillName,
    runAs,
  );
}

// ============================================================================
// Setup
// ============================================================================

let executor: SkillToolExecutor;

beforeEach(() => {
  vi.clearAllMocks();
  executor = new SkillToolExecutor();

  getMockAuditLogger().log.mockResolvedValue({ id: 'audit-1' });
  getMockAuditLogger().updateExecutionResult.mockResolvedValue(true);

  getMockExecutor().executeCommand.mockResolvedValue({
    success: true,
    executionId: 'exec-cmd-1',
    operationId: 'op-1',
    exitCode: 0,
    stdout: 'ok',
    stderr: '',
    duration: 100,
    timedOut: false,
  });

  (findConnectedAgent as ReturnType<typeof vi.fn>).mockReturnValue('client-123');
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ============================================================================
// wrapWithRunAs (pure function)
// ============================================================================

describe('wrapWithRunAs', () => {
  it('wraps command with sudo -n -u <user> -- sh -c', () => {
    const result = wrapWithRunAs('systemctl restart nginx', 'root');
    expect(result).toBe('sudo -n -u root -- sh -c "systemctl restart nginx"');
  });

  it('wraps with non-root user', () => {
    const result = wrapWithRunAs('whoami', 'deploy');
    expect(result).toBe('sudo -n -u deploy -- sh -c "whoami"');
  });

  it('properly escapes quotes in command via JSON.stringify', () => {
    const result = wrapWithRunAs('echo "hello world"', 'app_user');
    expect(result).toBe('sudo -n -u app_user -- sh -c "echo \\"hello world\\""');
  });

  it('rejects invalid usernames with special characters', () => {
    expect(() => wrapWithRunAs('ls', 'root; rm -rf /')).toThrow('Invalid run_as user');
  });

  it('rejects usernames starting with a digit', () => {
    expect(() => wrapWithRunAs('ls', '0user')).toThrow('Invalid run_as user');
  });

  it('accepts usernames with underscores and hyphens', () => {
    const result = wrapWithRunAs('id', 'my_deploy-user');
    expect(result).toContain('sudo -n -u my_deploy-user');
  });

  it('rejects empty string', () => {
    expect(() => wrapWithRunAs('ls', '')).toThrow('Invalid run_as user');
  });
});

// ============================================================================
// escalateRiskLevel (pure function)
// ============================================================================

describe('escalateRiskLevel', () => {
  it('escalates green → yellow', () => {
    expect(escalateRiskLevel('green')).toBe('yellow');
  });

  it('escalates yellow → red', () => {
    expect(escalateRiskLevel('yellow')).toBe('red');
  });

  it('escalates red → critical', () => {
    expect(escalateRiskLevel('red')).toBe('critical');
  });

  it('caps at critical (does not go to forbidden)', () => {
    expect(escalateRiskLevel('critical')).toBe('critical');
  });
});

// ============================================================================
// executeShell with run_as
// ============================================================================

describe('executeShell with run_as', () => {
  it('wraps command with sudo when runAs is specified', async () => {
    await callTool(
      executor,
      toolUse('shell', { command: 'systemctl restart nginx' }),
      { runAs: 'root', riskLevelMax: 'critical' },
    );

    expect(getMockExecutor().executeCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'sudo -n -u root -- sh -c "systemctl restart nginx"',
      }),
    );
  });

  it('does not wrap command when runAs is undefined', async () => {
    await callTool(
      executor,
      toolUse('shell', { command: 'df -h' }),
    );

    expect(getMockExecutor().executeCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'df -h',
      }),
    );
  });

  it('wraps with non-root user without risk escalation', async () => {
    await callTool(
      executor,
      toolUse('shell', { command: 'whoami' }),
      { runAs: 'deploy' },
    );

    const callArgs = getMockExecutor().executeCommand.mock.calls[0][0];
    expect(callArgs.command).toBe('sudo -n -u deploy -- sh -c "whoami"');
    // Non-root user: risk level stays at green (whoami is green)
    expect(callArgs.riskLevel).toBe('green');
  });

  it('escalates risk level when runAs=root (green → yellow)', async () => {
    // df -h is green; with run_as=root it should become yellow
    await callTool(
      executor,
      toolUse('shell', { command: 'df -h' }),
      { runAs: 'root', riskLevelMax: 'red' },
    );

    expect(getMockExecutor().executeCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        riskLevel: 'yellow',
      }),
    );
  });

  it('rejects when escalated risk exceeds riskLevelMax', async () => {
    // df -h is green → escalated to yellow with root.
    // riskLevelMax = green → yellow exceeds green → REJECTED
    const result = await callTool(
      executor,
      toolUse('shell', { command: 'df -h' }),
      { runAs: 'root', riskLevelMax: 'green' },
    );

    expect(result.success).toBe(false);
    expect(result.result).toContain('REJECTED');
    expect(getMockExecutor().executeCommand).not.toHaveBeenCalled();
  });

  it('records run_as in audit log policy field', async () => {
    await callTool(
      executor,
      toolUse('shell', { command: 'ls /tmp' }),
      { runAs: 'deploy', riskLevelMax: 'red' },
    );

    const logCall = getMockAuditLogger().log.mock.calls[0][0];
    expect(logCall.validation.policy).toBe('skill-runner:allowed:run_as=deploy');
    expect(logCall.validation.reasons).toContain('run_as=deploy');
  });

  it('records run_as=root in audit log with escalation note', async () => {
    await callTool(
      executor,
      toolUse('shell', { command: 'df -h' }),
      { runAs: 'root', riskLevelMax: 'red' },
    );

    const logCall = getMockAuditLogger().log.mock.calls[0][0];
    expect(logCall.validation.policy).toContain('run_as=root');
    expect(logCall.validation.reasons).toContain('run_as=root');
  });

  it('audit logs wrapped command (not original) for allowed commands', async () => {
    await callTool(
      executor,
      toolUse('shell', { command: 'whoami' }),
      { runAs: 'deploy', riskLevelMax: 'red' },
    );

    const logCall = getMockAuditLogger().log.mock.calls[0][0];
    expect(logCall.command).toContain('sudo -n -u deploy');
  });

  it('does not include run_as in audit policy when runAs is undefined', async () => {
    await callTool(
      executor,
      toolUse('shell', { command: 'echo hello' }),
    );

    const logCall = getMockAuditLogger().log.mock.calls[0][0];
    expect(logCall.validation.policy).toBe('skill-runner:allowed');
    expect(logCall.validation.reasons).not.toContain(expect.stringContaining('run_as'));
  });
});
