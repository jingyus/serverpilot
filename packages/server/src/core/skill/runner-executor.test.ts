// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for SkillToolExecutor — shell, file, audit & dispatch methods.
 *
 * Covers: executeShell, executeReadFile, executeWriteFile, auditShell,
 * and executeTool dispatch (unknown tool).
 * Security-critical: verifies classifyCommand + exceedsRiskLimit linkage.
 *
 * Network & storage tools (executeNotify, executeHttp, executeStore) are
 * in runner-executor-network.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { SkillToolExecutor } from './runner-executor.js';
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

/** Create a tool_use block. */
function toolUse(
  name: string,
  input: Record<string, unknown>,
  id = 'tc-1',
): ToolUseBlock {
  return { type: 'tool_use', id, name, input };
}

/** Default params for executeTool. */
const DEFAULTS = {
  skillId: 'skill-1',
  serverId: 'server-1',
  userId: 'user-1',
  executionId: 'exec-1',
  riskLevelMax: 'yellow',
  skillName: 'test-skill',
};

/** Shortcut to call executeTool with defaults. */
function callTool(
  executor: SkillToolExecutor,
  tool: ToolUseBlock,
  overrides: Partial<typeof DEFAULTS> = {},
) {
  const p = { ...DEFAULTS, ...overrides };
  return executor.executeTool(
    tool,
    p.skillId,
    p.serverId,
    p.userId,
    p.executionId,
    p.riskLevelMax,
    p.skillName,
  );
}

// ============================================================================
// Setup
// ============================================================================

let executor: SkillToolExecutor;

beforeEach(() => {
  vi.clearAllMocks();
  executor = new SkillToolExecutor();

  // Restore default mock implementations after clearAllMocks
  getMockAuditLogger().log.mockResolvedValue({ id: 'audit-1' });
  getMockAuditLogger().updateExecutionResult.mockResolvedValue(true);

  // Default executor result: success
  getMockExecutor().executeCommand.mockResolvedValue({
    success: true,
    executionId: 'exec-cmd-1',
    operationId: 'op-1',
    exitCode: 0,
    stdout: 'command output',
    stderr: '',
    duration: 100,
    timedOut: false,
  });

  // Default: agent connected
  (findConnectedAgent as ReturnType<typeof vi.fn>).mockReturnValue('client-123');
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ============================================================================
// executeShell
// ============================================================================

describe('executeShell', () => {
  it('executes a green command successfully', async () => {
    const result = await callTool(
      executor,
      toolUse('shell', { command: 'df -h', description: 'Check disk' }),
    );

    expect(result.success).toBe(true);
    expect(result.result).toContain('Exit code: 0');
    expect(result.result).toContain('command output');
    expect(getMockExecutor().executeCommand).toHaveBeenCalledOnce();
    expect(getMockExecutor().executeCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        serverId: 'server-1',
        userId: 'user-1',
        clientId: 'client-123',
        command: 'df -h',
        description: 'Check disk',
      }),
    );
  });

  it('uses skill name as fallback description', async () => {
    const result = await callTool(
      executor,
      toolUse('shell', { command: 'uptime' }),
    );

    expect(result.success).toBe(true);
    expect(getMockExecutor().executeCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        description: 'Skill: test-skill',
      }),
    );
  });

  it('blocks forbidden commands (rm -rf /)', async () => {
    const result = await callTool(
      executor,
      toolUse('shell', { command: 'rm -rf /' }),
    );

    expect(result.success).toBe(false);
    expect(result.result).toContain('BLOCKED');
    expect(result.result).toContain('forbidden');
    expect(getMockExecutor().executeCommand).not.toHaveBeenCalled();
  });

  it('rejects commands exceeding risk_level_max (red > yellow)', async () => {
    // iptables is classified as red; max is yellow
    const result = await callTool(
      executor,
      toolUse('shell', { command: 'iptables -A INPUT -p tcp --dport 80 -j ACCEPT' }),
    );

    expect(result.success).toBe(false);
    expect(result.result).toContain('REJECTED');
    expect(result.result).toContain('exceeds');
    expect(getMockExecutor().executeCommand).not.toHaveBeenCalled();
  });

  it('allows red commands when risk_level_max is red', async () => {
    const result = await callTool(
      executor,
      toolUse('shell', { command: 'iptables -L' }),
      { riskLevelMax: 'red' },
    );

    expect(result.success).toBe(true);
    expect(getMockExecutor().executeCommand).toHaveBeenCalledOnce();
  });

  it('records audit log for every shell call', async () => {
    await callTool(
      executor,
      toolUse('shell', { command: 'ls -la /tmp' }),
    );

    const auditLogger = getMockAuditLogger();
    expect(auditLogger.log).toHaveBeenCalledOnce();

    const logCall = auditLogger.log.mock.calls[0][0];
    expect(logCall.command).toBe('ls -la /tmp');
    expect(logCall.serverId).toBe('server-1');
    expect(logCall.userId).toBe('user-1');
    expect(logCall.sessionId).toBe('exec-1');
    expect(logCall.validation.policy).toContain('skill-runner');
  });

  it('updates audit result to success after execution', async () => {
    await callTool(
      executor,
      toolUse('shell', { command: 'echo hello' }),
    );

    const auditLogger = getMockAuditLogger();
    expect(auditLogger.updateExecutionResult).toHaveBeenCalledWith(
      'audit-1',
      'success',
      'op-1',
    );
  });

  it('returns error when no agent connected', async () => {
    (findConnectedAgent as ReturnType<typeof vi.fn>).mockReturnValue(null);

    const result = await callTool(
      executor,
      toolUse('shell', { command: 'echo hello' }),
    );

    expect(result.success).toBe(false);
    expect(result.result).toContain('No agent connected');
    expect(getMockExecutor().executeCommand).not.toHaveBeenCalled();
  });

  it('updates audit to failed when no agent connected', async () => {
    (findConnectedAgent as ReturnType<typeof vi.fn>).mockReturnValue(null);

    await callTool(executor, toolUse('shell', { command: 'echo test' }));

    const auditLogger = getMockAuditLogger();
    expect(auditLogger.updateExecutionResult).toHaveBeenCalledWith('audit-1', 'failed');
  });

  it('handles executor exception gracefully', async () => {
    getMockExecutor().executeCommand.mockRejectedValue(
      new Error('WebSocket disconnected'),
    );

    const result = await callTool(
      executor,
      toolUse('shell', { command: 'echo test' }),
    );

    expect(result.success).toBe(false);
    expect(result.result).toContain('Execution error');
    expect(result.result).toContain('WebSocket disconnected');
  });

  it('updates audit to failed on executor exception', async () => {
    getMockExecutor().executeCommand.mockRejectedValue(new Error('timeout'));

    await callTool(executor, toolUse('shell', { command: 'echo test' }));

    expect(getMockAuditLogger().updateExecutionResult).toHaveBeenCalledWith(
      'audit-1',
      'failed',
    );
  });

  it('records audit for blocked commands with blocked action', async () => {
    await callTool(executor, toolUse('shell', { command: 'rm -rf /' }));

    const logCall = getMockAuditLogger().log.mock.calls[0][0];
    expect(logCall.validation.action).toBe('blocked');
  });

  it('records audit for rejected commands with rejected action', async () => {
    // iptables = red, max = yellow → rejected
    await callTool(
      executor,
      toolUse('shell', { command: 'iptables -A INPUT -j DROP' }),
    );

    const logCall = getMockAuditLogger().log.mock.calls[0][0];
    expect(logCall.validation.action).toBe('rejected');
  });

  it('includes stderr in output on command failure', async () => {
    getMockExecutor().executeCommand.mockResolvedValue({
      success: false,
      executionId: 'exec-1',
      operationId: 'op-1',
      exitCode: 1,
      stdout: '',
      stderr: 'permission denied',
      duration: 50,
      timedOut: false,
    });

    const result = await callTool(
      executor,
      toolUse('shell', { command: 'ls /root' }),
    );

    expect(result.success).toBe(false);
    expect(result.result).toContain('stderr');
    expect(result.result).toContain('permission denied');
  });
});

// ============================================================================
// executeReadFile
// ============================================================================

describe('executeReadFile', () => {
  it('reads a file successfully via cat', async () => {
    getMockExecutor().executeCommand.mockResolvedValue({
      success: true,
      executionId: 'exec-1',
      operationId: 'op-1',
      exitCode: 0,
      stdout: 'server { listen 80; }',
      stderr: '',
      duration: 50,
      timedOut: false,
    });

    const result = await callTool(
      executor,
      toolUse('read_file', { path: '/etc/nginx/nginx.conf' }),
    );

    expect(result.success).toBe(true);
    expect(result.result).toBe('server { listen 80; }');
    expect(getMockExecutor().executeCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        riskLevel: 'green',
        description: expect.stringContaining('Read file'),
      }),
    );
  });

  it('returns error when no agent connected', async () => {
    (findConnectedAgent as ReturnType<typeof vi.fn>).mockReturnValue(null);

    const result = await callTool(
      executor,
      toolUse('read_file', { path: '/etc/hosts' }),
    );

    expect(result.success).toBe(false);
    expect(result.result).toContain('No agent connected');
  });

  it('returns stderr on read failure', async () => {
    getMockExecutor().executeCommand.mockResolvedValue({
      success: false,
      executionId: 'exec-1',
      operationId: 'op-1',
      exitCode: 1,
      stdout: '',
      stderr: 'No such file or directory',
      duration: 50,
      timedOut: false,
    });

    const result = await callTool(
      executor,
      toolUse('read_file', { path: '/nonexistent' }),
    );

    expect(result.success).toBe(false);
    expect(result.result).toContain('Failed to read');
    expect(result.result).toContain('No such file or directory');
  });
});

// ============================================================================
// executeWriteFile
// ============================================================================

describe('executeWriteFile', () => {
  it('writes a file successfully', async () => {
    const result = await callTool(
      executor,
      toolUse('write_file', { path: '/tmp/test.conf', content: 'key=value' }),
    );

    expect(result.success).toBe(true);
    expect(result.result).toContain('File written');
    expect(result.result).toContain('/tmp/test.conf');
    expect(getMockExecutor().executeCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        riskLevel: 'yellow',
        description: expect.stringContaining('Write file'),
      }),
    );
  });

  it('returns error when no agent connected', async () => {
    (findConnectedAgent as ReturnType<typeof vi.fn>).mockReturnValue(null);

    const result = await callTool(
      executor,
      toolUse('write_file', { path: '/tmp/test.conf', content: 'data' }),
    );

    expect(result.success).toBe(false);
    expect(result.result).toContain('No agent connected');
  });

  it('returns error on write failure', async () => {
    getMockExecutor().executeCommand.mockResolvedValue({
      success: false,
      executionId: 'exec-1',
      operationId: 'op-1',
      exitCode: 1,
      stdout: '',
      stderr: 'Permission denied',
      duration: 50,
      timedOut: false,
    });

    const result = await callTool(
      executor,
      toolUse('write_file', { path: '/etc/readonly', content: 'data' }),
    );

    expect(result.success).toBe(false);
    expect(result.result).toContain('Write failed');
    expect(result.result).toContain('Permission denied');
  });
});

// ============================================================================
// auditShell (tested indirectly via executeShell)
// ============================================================================

describe('auditShell', () => {
  it('audit log entry contains skillId-related sessionId and serverId', async () => {
    await callTool(
      executor,
      toolUse('shell', { command: 'whoami' }),
      { serverId: 'srv-42', executionId: 'run-99' },
    );

    const logCall = getMockAuditLogger().log.mock.calls[0][0];
    expect(logCall.serverId).toBe('srv-42');
    expect(logCall.sessionId).toBe('run-99');
    expect(logCall.command).toBe('whoami');
    expect(logCall.validation.classification.command).toBe('whoami');
    expect(logCall.validation.classification.riskLevel).toBeDefined();
    expect(logCall.validation.classification.reason).toBeDefined();
  });

  it('continues execution when audit log fails', async () => {
    getMockAuditLogger().log.mockRejectedValue(new Error('audit DB down'));

    const result = await callTool(
      executor,
      toolUse('shell', { command: 'echo hello' }),
    );

    // Execution should still proceed — auditShell returns null on error
    expect(result.success).toBe(true);
    expect(getMockExecutor().executeCommand).toHaveBeenCalledOnce();
  });
});

// ============================================================================
// executeTool dispatch — unknown tool
// ============================================================================

describe('executeTool dispatch', () => {
  it('returns error for unknown tool name', async () => {
    const result = await callTool(
      executor,
      toolUse('unknown_tool', { foo: 'bar' }),
    );

    expect(result.success).toBe(false);
    expect(result.result).toContain('Unknown tool');
    expect(result.result).toContain('unknown_tool');
  });
});
