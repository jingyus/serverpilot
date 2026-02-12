// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for SkillToolExecutor — the 6 tool execution methods + auditShell.
 *
 * Covers: executeShell, executeReadFile, executeWriteFile, executeNotify,
 * executeHttp, executeStore, plus the auditShell audit helper.
 * Security-critical: verifies classifyCommand + exceedsRiskLimit linkage.
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

vi.mock('../webhook/dispatcher.js', () => {
  const mockDispatcher = {
    dispatch: vi.fn().mockResolvedValue(undefined),
  };
  return {
    getWebhookDispatcher: vi.fn(() => mockDispatcher),
  };
});

vi.mock('./store.js', () => {
  const mockStore = {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue({}),
  };
  return {
    getSkillKVStore: vi.fn(() => mockStore),
  };
});

// Access mocks for assertion
const { getTaskExecutor } = await import('../task/executor.js');
const { findConnectedAgent } = await import('../agent/agent-connector.js');
const { getAuditLogger } = await import('../security/audit-logger.js');
const { getWebhookDispatcher } = await import('../webhook/dispatcher.js');
const { getSkillKVStore } = await import('./store.js');

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

function getMockDispatcher() {
  return (getWebhookDispatcher as ReturnType<typeof vi.fn>)() as {
    dispatch: ReturnType<typeof vi.fn>;
  };
}

function getMockStore() {
  return (getSkillKVStore as ReturnType<typeof vi.fn>)() as {
    get: ReturnType<typeof vi.fn>;
    set: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    list: ReturnType<typeof vi.fn>;
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

  // Default: store mocks
  getMockStore().get.mockResolvedValue(null);
  getMockStore().set.mockResolvedValue(undefined);
  getMockStore().delete.mockResolvedValue(undefined);
  getMockStore().list.mockResolvedValue({});
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
// executeNotify
// ============================================================================

describe('executeNotify', () => {
  it('dispatches notification successfully', async () => {
    const result = await callTool(
      executor,
      toolUse('notify', { title: 'Disk Full', message: '90% used', level: 'warning' }),
    );

    expect(result.success).toBe(true);
    expect(result.result).toContain('Notification sent');
    expect(result.result).toContain('Disk Full');
    expect(getMockDispatcher().dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'alert.triggered',
        userId: 'user-1',
        data: expect.objectContaining({
          title: 'Disk Full',
          message: '90% used',
          level: 'warning',
          source: 'skill:test-skill',
        }),
      }),
    );
  });

  it('uses default level "info" when not specified', async () => {
    await callTool(
      executor,
      toolUse('notify', { title: 'Update', message: 'Done' }),
    );

    expect(getMockDispatcher().dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ level: 'info' }),
      }),
    );
  });

  it('handles dispatcher exception gracefully', async () => {
    getMockDispatcher().dispatch.mockRejectedValue(
      new Error('Webhook endpoint unreachable'),
    );

    const result = await callTool(
      executor,
      toolUse('notify', { title: 'Alert', message: 'Test' }),
    );

    expect(result.success).toBe(false);
    expect(result.result).toContain('Notify error');
    expect(result.result).toContain('Webhook endpoint unreachable');
  });
});

// ============================================================================
// executeHttp
// ============================================================================

describe('executeHttp', () => {
  it('makes a successful GET request', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: vi.fn().mockResolvedValue('{"status":"healthy"}'),
    }));

    const result = await callTool(
      executor,
      toolUse('http', { url: 'https://api.example.com/health' }),
    );

    expect(result.success).toBe(true);
    expect(result.result).toContain('HTTP 200 OK');
    expect(result.result).toContain('healthy');
    expect(fetch).toHaveBeenCalledWith(
      'https://api.example.com/health',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('makes a successful POST request with body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      statusText: 'Created',
      text: vi.fn().mockResolvedValue('{"id":"123"}'),
    }));

    const result = await callTool(
      executor,
      toolUse('http', {
        url: 'https://api.example.com/items',
        method: 'POST',
        body: '{"name":"test"}',
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    expect(result.success).toBe(true);
    expect(result.result).toContain('HTTP 201 Created');
    expect(fetch).toHaveBeenCalledWith(
      'https://api.example.com/items',
      expect.objectContaining({
        method: 'POST',
        body: '{"name":"test"}',
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  });

  it('reports non-200 responses as failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: vi.fn().mockResolvedValue('server error'),
    }));

    const result = await callTool(
      executor,
      toolUse('http', { url: 'https://api.example.com/fail' }),
    );

    expect(result.success).toBe(false);
    expect(result.result).toContain('HTTP 500');
    expect(result.result).toContain('server error');
  });

  it('handles fetch timeout/error gracefully', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(
      new Error('The operation was aborted due to timeout'),
    ));

    const result = await callTool(
      executor,
      toolUse('http', { url: 'https://api.example.com/slow' }),
    );

    expect(result.success).toBe(false);
    expect(result.result).toContain('HTTP error');
    expect(result.result).toContain('timeout');
  });

  it('truncates response body exceeding 10k characters', async () => {
    const longBody = 'x'.repeat(15_000);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: vi.fn().mockResolvedValue(longBody),
    }));

    const result = await callTool(
      executor,
      toolUse('http', { url: 'https://api.example.com/big' }),
    );

    expect(result.success).toBe(true);
    expect(result.result).toContain('...(truncated)');
    // 10000 chars of body + HTTP header line + truncation marker
    expect(result.result.length).toBeLessThan(15_000);
  });
});

// ============================================================================
// executeStore
// ============================================================================

describe('executeStore', () => {
  it('gets a value from store', async () => {
    getMockStore().get.mockResolvedValue('stored-value');

    const result = await callTool(
      executor,
      toolUse('store', { action: 'get', key: 'my_key' }),
    );

    expect(result.success).toBe(true);
    expect(result.result).toBe('stored-value');
    expect(getMockStore().get).toHaveBeenCalledWith('skill-1', 'my_key');
  });

  it('reports not found for missing key on get', async () => {
    getMockStore().get.mockResolvedValue(null);

    const result = await callTool(
      executor,
      toolUse('store', { action: 'get', key: 'missing' }),
    );

    expect(result.success).toBe(false);
    expect(result.result).toContain('not found');
  });

  it('sets a value in store', async () => {
    const result = await callTool(
      executor,
      toolUse('store', { action: 'set', key: 'last_check', value: '2026-02-13' }),
    );

    expect(result.success).toBe(true);
    expect(result.result).toContain('Stored key');
    expect(getMockStore().set).toHaveBeenCalledWith('skill-1', 'last_check', '2026-02-13');
  });

  it('deletes a key from store', async () => {
    const result = await callTool(
      executor,
      toolUse('store', { action: 'delete', key: 'old_key' }),
    );

    expect(result.success).toBe(true);
    expect(result.result).toContain('Deleted key');
    expect(getMockStore().delete).toHaveBeenCalledWith('skill-1', 'old_key');
  });

  it('lists all entries in store', async () => {
    getMockStore().list.mockResolvedValue({ a: '1', b: '2' });

    const result = await callTool(
      executor,
      toolUse('store', { action: 'list' }),
    );

    expect(result.success).toBe(true);
    expect(JSON.parse(result.result)).toEqual({ a: '1', b: '2' });
    expect(getMockStore().list).toHaveBeenCalledWith('skill-1');
  });

  it('returns error for get without key', async () => {
    const result = await callTool(
      executor,
      toolUse('store', { action: 'get' }),
    );

    expect(result.success).toBe(false);
    expect(result.result).toContain('Missing "key"');
  });

  it('returns error for set without key', async () => {
    const result = await callTool(
      executor,
      toolUse('store', { action: 'set', value: 'val' }),
    );

    expect(result.success).toBe(false);
    expect(result.result).toContain('Missing "key"');
  });

  it('returns error for set without value', async () => {
    const result = await callTool(
      executor,
      toolUse('store', { action: 'set', key: 'k' }),
    );

    expect(result.success).toBe(false);
    expect(result.result).toContain('Missing "value"');
  });

  it('returns error for delete without key', async () => {
    const result = await callTool(
      executor,
      toolUse('store', { action: 'delete' }),
    );

    expect(result.success).toBe(false);
    expect(result.result).toContain('Missing "key"');
  });

  it('returns error for unknown store action', async () => {
    const result = await callTool(
      executor,
      toolUse('store', { action: 'purge' }),
    );

    expect(result.success).toBe(false);
    expect(result.result).toContain('Unknown store action');
  });

  it('handles store exception gracefully', async () => {
    getMockStore().set.mockRejectedValue(new Error('DB connection lost'));

    const result = await callTool(
      executor,
      toolUse('store', { action: 'set', key: 'k', value: 'v' }),
    );

    expect(result.success).toBe(false);
    expect(result.result).toContain('Store error');
    expect(result.result).toContain('DB connection lost');
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
