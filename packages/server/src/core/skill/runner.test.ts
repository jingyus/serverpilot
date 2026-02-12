// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for SkillRunner — AI autonomous execution layer.
 *
 * Covers: single-step execution, multi-step loops, security rejection,
 * timeout termination, step limits, audit logging, and tool routing.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { SkillRunner, parseTimeout, buildToolDefinitions } from './runner.js';
import type { RunnerParams, SkillRunResult } from './runner.js';
import type { SkillManifest } from '@aiinstaller/shared';
import type {
  AIProviderInterface,
  ChatOptions,
  ChatResponse,
  ToolUseBlock,
} from '../../ai/providers/base.js';

// ============================================================================
// Mocks
// ============================================================================

// Mock external dependencies
vi.mock('../../ai/providers/provider-factory.js', () => ({
  getActiveProvider: vi.fn(() => null),
}));

vi.mock('../task/executor.js', () => {
  const mockExecutor = {
    executeCommand: vi.fn(),
  };
  return {
    getTaskExecutor: vi.fn(() => mockExecutor),
    _mockExecutor: mockExecutor,
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
    _mockAuditLogger: mockAuditLogger,
  };
});

vi.mock('../webhook/dispatcher.js', () => {
  const mockDispatcher = {
    dispatch: vi.fn().mockResolvedValue(undefined),
  };
  return {
    getWebhookDispatcher: vi.fn(() => mockDispatcher),
    _mockDispatcher: mockDispatcher,
  };
});

// Access mocks
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

/** Create a minimal valid SkillManifest for testing. */
function createManifest(overrides: Partial<SkillManifest> = {}): SkillManifest {
  return {
    kind: 'skill',
    version: '1.0',
    metadata: {
      name: 'test-skill',
      displayName: 'Test Skill',
      version: '1.0.0',
    },
    triggers: [{ type: 'manual' }],
    tools: ['shell'],
    constraints: {
      risk_level_max: 'yellow',
      timeout: '30s',
      max_steps: 20,
      requires_confirmation: false,
      server_scope: 'single',
    },
    prompt: 'This is a test skill prompt that is long enough to meet minimum validation.',
    ...overrides,
  } as SkillManifest;
}

/** Create default RunnerParams. */
function createRunnerParams(overrides: Partial<RunnerParams> = {}): RunnerParams {
  return {
    manifest: createManifest(),
    resolvedPrompt: 'Execute the test task on the server.',
    serverId: 'server-1',
    userId: 'user-1',
    executionId: 'exec-1',
    ...overrides,
  };
}

/** Create a mock AI provider that returns specified responses in sequence. */
function createMockProvider(responses: ChatResponse[]): AIProviderInterface {
  let callIndex = 0;
  return {
    name: 'test-provider',
    tier: 1,
    chat: vi.fn(async (_options: ChatOptions): Promise<ChatResponse> => {
      if (callIndex >= responses.length) {
        return { content: 'Done', usage: { inputTokens: 0, outputTokens: 0 }, stopReason: 'end_turn' };
      }
      return responses[callIndex++];
    }),
    stream: vi.fn(),
    isAvailable: vi.fn(async () => true),
  };
}

/** Create a tool_use block. */
function toolUse(name: string, input: Record<string, unknown>, id = 'tc-1'): ToolUseBlock {
  return { type: 'tool_use', id, name, input };
}

// ============================================================================
// Tests: parseTimeout
// ============================================================================

describe('parseTimeout', () => {
  it('parses seconds correctly', () => {
    expect(parseTimeout('30s')).toBe(30_000);
    expect(parseTimeout('1s')).toBe(1_000);
    expect(parseTimeout('120s')).toBe(120_000);
  });

  it('parses minutes correctly', () => {
    expect(parseTimeout('5m')).toBe(300_000);
    expect(parseTimeout('1m')).toBe(60_000);
  });

  it('parses hours correctly', () => {
    expect(parseTimeout('1h')).toBe(3_600_000);
    expect(parseTimeout('2h')).toBe(7_200_000);
  });

  it('throws on invalid format', () => {
    expect(() => parseTimeout('30')).toThrow('Invalid timeout format');
    expect(() => parseTimeout('abc')).toThrow('Invalid timeout format');
    expect(() => parseTimeout('')).toThrow('Invalid timeout format');
    expect(() => parseTimeout('30d')).toThrow('Invalid timeout format');
  });
});

// ============================================================================
// Tests: buildToolDefinitions
// ============================================================================

describe('buildToolDefinitions', () => {
  it('builds shell tool definition', () => {
    const tools = buildToolDefinitions(['shell']);
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('shell');
    expect(tools[0].input_schema).toHaveProperty('properties');
  });

  it('builds multiple tool definitions', () => {
    const tools = buildToolDefinitions(['shell', 'read_file', 'write_file', 'notify', 'http', 'store']);
    expect(tools).toHaveLength(6);
    const names = tools.map((t) => t.name);
    expect(names).toContain('shell');
    expect(names).toContain('read_file');
    expect(names).toContain('write_file');
    expect(names).toContain('notify');
    expect(names).toContain('http');
    expect(names).toContain('store');
  });

  it('skips unsupported tools', () => {
    const tools = buildToolDefinitions(['shell']);
    expect(tools).toHaveLength(1);
  });
});

// ============================================================================
// Tests: SkillRunner
// ============================================================================

describe('SkillRunner', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Re-setup mock implementations after clearAllMocks
    getMockAuditLogger().log.mockResolvedValue({ id: 'audit-1' });
    getMockAuditLogger().updateExecutionResult.mockResolvedValue(true);

    // Default mock: executor returns success
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

    // Default: agent is connected
    (findConnectedAgent as ReturnType<typeof vi.fn>).mockReturnValue('client-123');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // --------------------------------------------------------------------------
  // Single-step execution
  // --------------------------------------------------------------------------

  it('executes a single shell command and returns success', async () => {
    const provider = createMockProvider([
      {
        content: 'I will check disk usage.',
        usage: { inputTokens: 100, outputTokens: 50 },
        stopReason: 'tool_use',
        toolCalls: [toolUse('shell', { command: 'df -h', description: 'Check disk' })],
      },
      {
        content: 'Disk usage looks healthy.',
        usage: { inputTokens: 200, outputTokens: 30 },
        stopReason: 'end_turn',
      },
    ]);

    const runner = new SkillRunner(provider);
    const result = await runner.run(createRunnerParams());

    expect(result.success).toBe(true);
    expect(result.status).toBe('success');
    expect(result.stepsExecuted).toBe(1);
    expect(result.toolResults).toHaveLength(1);
    expect(result.toolResults[0].toolName).toBe('shell');
    expect(result.toolResults[0].success).toBe(true);
    expect(result.output).toContain('Disk usage looks healthy');
  });

  // --------------------------------------------------------------------------
  // Multi-step loop
  // --------------------------------------------------------------------------

  it('executes a multi-step loop (read_file → shell → notify)', async () => {
    const manifest = createManifest({ tools: ['shell', 'read_file', 'notify'] });

    const provider = createMockProvider([
      // Step 1: read_file
      {
        content: 'Reading config file first.',
        usage: { inputTokens: 100, outputTokens: 50 },
        stopReason: 'tool_use',
        toolCalls: [toolUse('read_file', { path: '/etc/nginx/nginx.conf' }, 'tc-1')],
      },
      // Step 2: shell (use a green command so it passes yellow max)
      {
        content: 'Now checking nginx status.',
        usage: { inputTokens: 200, outputTokens: 40 },
        stopReason: 'tool_use',
        toolCalls: [toolUse('shell', { command: 'systemctl status nginx' }, 'tc-2')],
      },
      // Step 3: notify
      {
        content: 'Sending notification.',
        usage: { inputTokens: 300, outputTokens: 30 },
        stopReason: 'tool_use',
        toolCalls: [toolUse('notify', { title: 'Nginx checked', message: 'All good' }, 'tc-3')],
      },
      // Done
      {
        content: 'Task complete.',
        usage: { inputTokens: 400, outputTokens: 20 },
        stopReason: 'end_turn',
      },
    ]);

    const runner = new SkillRunner(provider);
    const result = await runner.run(createRunnerParams({ manifest }));

    expect(result.success).toBe(true);
    expect(result.stepsExecuted).toBe(3);
    expect(result.toolResults).toHaveLength(3);
    expect(result.toolResults[0].toolName).toBe('read_file');
    expect(result.toolResults[1].toolName).toBe('shell');
    expect(result.toolResults[2].toolName).toBe('notify');
  });

  // --------------------------------------------------------------------------
  // Security: forbidden command rejection
  // --------------------------------------------------------------------------

  it('rejects forbidden commands (rm -rf /)', async () => {
    const provider = createMockProvider([
      {
        content: 'Cleaning up.',
        usage: { inputTokens: 100, outputTokens: 50 },
        stopReason: 'tool_use',
        toolCalls: [toolUse('shell', { command: 'rm -rf /' })],
      },
      {
        content: 'The command was blocked.',
        usage: { inputTokens: 200, outputTokens: 30 },
        stopReason: 'end_turn',
      },
    ]);

    const runner = new SkillRunner(provider);
    const result = await runner.run(createRunnerParams());

    expect(result.stepsExecuted).toBe(1);
    expect(result.toolResults[0].success).toBe(false);
    expect(result.toolResults[0].result).toContain('BLOCKED');

    // Should NOT call executor
    expect(getMockExecutor().executeCommand).not.toHaveBeenCalled();
  });

  // --------------------------------------------------------------------------
  // Security: risk level exceeds max
  // --------------------------------------------------------------------------

  it('rejects commands exceeding risk_level_max (red command + yellow max)', async () => {
    // iptables is classified as RED, skill max is yellow
    const manifest = createManifest({
      constraints: {
        risk_level_max: 'yellow',
        timeout: '30s',
        max_steps: 20,
        requires_confirmation: false,
        server_scope: 'single',
      },
    });

    const provider = createMockProvider([
      {
        content: 'Configuring firewall.',
        usage: { inputTokens: 100, outputTokens: 50 },
        stopReason: 'tool_use',
        toolCalls: [toolUse('shell', { command: 'iptables -A INPUT -p tcp --dport 80 -j ACCEPT' })],
      },
      {
        content: 'Command was rejected.',
        usage: { inputTokens: 200, outputTokens: 30 },
        stopReason: 'end_turn',
      },
    ]);

    const runner = new SkillRunner(provider);
    const result = await runner.run(createRunnerParams({ manifest }));

    expect(result.toolResults[0].success).toBe(false);
    expect(result.toolResults[0].result).toContain('REJECTED');
    expect(result.toolResults[0].result).toContain('exceeds');
    expect(getMockExecutor().executeCommand).not.toHaveBeenCalled();
  });

  // --------------------------------------------------------------------------
  // Security: green commands auto-allowed
  // --------------------------------------------------------------------------

  it('allows green commands with yellow max', async () => {
    const provider = createMockProvider([
      {
        content: 'Checking uptime.',
        usage: { inputTokens: 100, outputTokens: 50 },
        stopReason: 'tool_use',
        toolCalls: [toolUse('shell', { command: 'uptime' })],
      },
      {
        content: 'Server has been up for 30 days.',
        usage: { inputTokens: 200, outputTokens: 30 },
        stopReason: 'end_turn',
      },
    ]);

    const runner = new SkillRunner(provider);
    const result = await runner.run(createRunnerParams());

    expect(result.toolResults[0].success).toBe(true);
    expect(getMockExecutor().executeCommand).toHaveBeenCalledOnce();
  });

  // --------------------------------------------------------------------------
  // Timeout termination
  // --------------------------------------------------------------------------

  it('terminates on timeout', async () => {
    const manifest = createManifest({
      constraints: {
        risk_level_max: 'yellow',
        timeout: '1s', // 1 second timeout
        max_steps: 100,
        requires_confirmation: false,
        server_scope: 'single',
      },
    });

    // Simulate slow AI that takes longer than 1s
    const provider: AIProviderInterface = {
      name: 'slow-provider',
      tier: 1,
      chat: vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        return {
          content: 'Still thinking...',
          usage: { inputTokens: 100, outputTokens: 50 },
          stopReason: 'tool_use',
          toolCalls: [toolUse('shell', { command: 'echo hello' })],
        };
      }),
      stream: vi.fn(),
      isAvailable: vi.fn(async () => true),
    };

    const runner = new SkillRunner(provider);
    const result = await runner.run(createRunnerParams({ manifest }));

    expect(result.status).toBe('timeout');
    expect(result.success).toBe(false);
    expect(result.errors.some((e) => e.includes('Timeout'))).toBe(true);
  }, 10_000);

  // --------------------------------------------------------------------------
  // Step limit
  // --------------------------------------------------------------------------

  it('stops at max_steps limit', async () => {
    const manifest = createManifest({
      constraints: {
        risk_level_max: 'yellow',
        timeout: '30s',
        max_steps: 2,
        requires_confirmation: false,
        server_scope: 'single',
      },
    });

    // Provider always returns a tool call — should be stopped by step limit
    const provider = createMockProvider([
      {
        content: 'Step 1',
        usage: { inputTokens: 100, outputTokens: 50 },
        stopReason: 'tool_use',
        toolCalls: [toolUse('shell', { command: 'echo step1' }, 'tc-1')],
      },
      {
        content: 'Step 2',
        usage: { inputTokens: 200, outputTokens: 50 },
        stopReason: 'tool_use',
        toolCalls: [toolUse('shell', { command: 'echo step2' }, 'tc-2')],
      },
      {
        content: 'Step 3 — should not execute',
        usage: { inputTokens: 300, outputTokens: 50 },
        stopReason: 'tool_use',
        toolCalls: [toolUse('shell', { command: 'echo step3' }, 'tc-3')],
      },
    ]);

    const runner = new SkillRunner(provider);
    const result = await runner.run(createRunnerParams({ manifest }));

    // Only 2 steps should have executed
    expect(result.stepsExecuted).toBe(2);
    expect(result.toolResults).toHaveLength(2);
  });

  // --------------------------------------------------------------------------
  // Audit logging
  // --------------------------------------------------------------------------

  it('logs shell commands to audit trail', async () => {
    const provider = createMockProvider([
      {
        content: 'Running ls.',
        usage: { inputTokens: 100, outputTokens: 50 },
        stopReason: 'tool_use',
        toolCalls: [toolUse('shell', { command: 'ls -la /tmp' })],
      },
      {
        content: 'Done.',
        usage: { inputTokens: 200, outputTokens: 30 },
        stopReason: 'end_turn',
      },
    ]);

    const runner = new SkillRunner(provider);
    await runner.run(createRunnerParams());

    const auditLogger = getMockAuditLogger();
    expect(auditLogger.log).toHaveBeenCalledOnce();

    const logCall = auditLogger.log.mock.calls[0][0];
    expect(logCall.command).toBe('ls -la /tmp');
    expect(logCall.serverId).toBe('server-1');
    expect(logCall.userId).toBe('user-1');
    expect(logCall.sessionId).toBe('exec-1');

    // Should update result after execution
    expect(auditLogger.updateExecutionResult).toHaveBeenCalledOnce();
    expect(auditLogger.updateExecutionResult).toHaveBeenCalledWith('audit-1', 'success', 'op-1');
  });

  it('logs audit for rejected commands too', async () => {
    const provider = createMockProvider([
      {
        content: 'Trying dangerous command.',
        usage: { inputTokens: 100, outputTokens: 50 },
        stopReason: 'tool_use',
        toolCalls: [toolUse('shell', { command: 'rm -rf /' })],
      },
      {
        content: 'Blocked.',
        usage: { inputTokens: 200, outputTokens: 30 },
        stopReason: 'end_turn',
      },
    ]);

    const runner = new SkillRunner(provider);
    await runner.run(createRunnerParams());

    const auditLogger = getMockAuditLogger();
    expect(auditLogger.log).toHaveBeenCalled();
    const logCall = auditLogger.log.mock.calls[0][0];
    expect(logCall.validation.action).toBe('blocked');
  });

  // --------------------------------------------------------------------------
  // No agent connected
  // --------------------------------------------------------------------------

  it('handles no agent connected gracefully', async () => {
    (findConnectedAgent as ReturnType<typeof vi.fn>).mockReturnValue(null);

    const provider = createMockProvider([
      {
        content: 'Trying a command.',
        usage: { inputTokens: 100, outputTokens: 50 },
        stopReason: 'tool_use',
        toolCalls: [toolUse('shell', { command: 'echo hello' })],
      },
      {
        content: 'No agent available.',
        usage: { inputTokens: 200, outputTokens: 30 },
        stopReason: 'end_turn',
      },
    ]);

    const runner = new SkillRunner(provider);
    const result = await runner.run(createRunnerParams());

    expect(result.toolResults[0].success).toBe(false);
    expect(result.toolResults[0].result).toContain('No agent connected');
  });

  // --------------------------------------------------------------------------
  // AI returns no tool calls (immediate completion)
  // --------------------------------------------------------------------------

  it('handles AI completing without any tool calls', async () => {
    const provider = createMockProvider([
      {
        content: 'The task is already complete based on current state.',
        usage: { inputTokens: 100, outputTokens: 50 },
        stopReason: 'end_turn',
      },
    ]);

    const runner = new SkillRunner(provider);
    const result = await runner.run(createRunnerParams());

    expect(result.success).toBe(true);
    expect(result.stepsExecuted).toBe(0);
    expect(result.toolResults).toHaveLength(0);
    expect(result.output).toContain('already complete');
  });

  // --------------------------------------------------------------------------
  // Tool execution failure
  // --------------------------------------------------------------------------

  it('records errors when command execution fails', async () => {
    getMockExecutor().executeCommand.mockResolvedValue({
      success: false,
      executionId: 'exec-cmd-1',
      operationId: 'op-1',
      exitCode: 1,
      stdout: '',
      stderr: 'permission denied',
      duration: 50,
      timedOut: false,
    });

    const provider = createMockProvider([
      {
        content: 'Checking disk.',
        usage: { inputTokens: 100, outputTokens: 50 },
        stopReason: 'tool_use',
        // Use a green command that will pass security checks
        toolCalls: [toolUse('shell', { command: 'df -h' })],
      },
      {
        content: 'The command failed.',
        usage: { inputTokens: 200, outputTokens: 30 },
        stopReason: 'end_turn',
      },
    ]);

    const runner = new SkillRunner(provider);
    const result = await runner.run(createRunnerParams());

    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.toolResults[0].success).toBe(false);
    expect(result.toolResults[0].result).toContain('permission denied');
  });

  // --------------------------------------------------------------------------
  // Executor throws exception
  // --------------------------------------------------------------------------

  it('handles executor exception gracefully', async () => {
    getMockExecutor().executeCommand.mockRejectedValue(new Error('WebSocket disconnected'));

    const provider = createMockProvider([
      {
        content: 'Running command.',
        usage: { inputTokens: 100, outputTokens: 50 },
        stopReason: 'tool_use',
        toolCalls: [toolUse('shell', { command: 'echo test' })],
      },
      {
        content: 'Failed.',
        usage: { inputTokens: 200, outputTokens: 30 },
        stopReason: 'end_turn',
      },
    ]);

    const runner = new SkillRunner(provider);
    const result = await runner.run(createRunnerParams());

    expect(result.toolResults[0].success).toBe(false);
    expect(result.toolResults[0].result).toContain('Execution error');
    expect(result.toolResults[0].result).toContain('WebSocket disconnected');
  });

  // --------------------------------------------------------------------------
  // read_file tool
  // --------------------------------------------------------------------------

  it('executes read_file tool via cat command', async () => {
    const manifest = createManifest({ tools: ['read_file'] });

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

    const provider = createMockProvider([
      {
        content: 'Reading config.',
        usage: { inputTokens: 100, outputTokens: 50 },
        stopReason: 'tool_use',
        toolCalls: [toolUse('read_file', { path: '/etc/nginx/nginx.conf' })],
      },
      {
        content: 'Config looks good.',
        usage: { inputTokens: 200, outputTokens: 30 },
        stopReason: 'end_turn',
      },
    ]);

    const runner = new SkillRunner(provider);
    const result = await runner.run(createRunnerParams({ manifest }));

    expect(result.toolResults[0].success).toBe(true);
    expect(result.toolResults[0].result).toContain('server { listen 80; }');
    expect(getMockExecutor().executeCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        riskLevel: 'green',
        description: expect.stringContaining('Read file'),
      }),
    );
  });

  // --------------------------------------------------------------------------
  // write_file tool
  // --------------------------------------------------------------------------

  it('executes write_file tool', async () => {
    const manifest = createManifest({ tools: ['write_file'] });

    const provider = createMockProvider([
      {
        content: 'Writing config.',
        usage: { inputTokens: 100, outputTokens: 50 },
        stopReason: 'tool_use',
        toolCalls: [toolUse('write_file', { path: '/tmp/test.conf', content: 'key=value' })],
      },
      {
        content: 'Done.',
        usage: { inputTokens: 200, outputTokens: 30 },
        stopReason: 'end_turn',
      },
    ]);

    const runner = new SkillRunner(provider);
    const result = await runner.run(createRunnerParams({ manifest }));

    expect(result.toolResults[0].success).toBe(true);
    expect(result.toolResults[0].result).toContain('File written');
    expect(getMockExecutor().executeCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        riskLevel: 'yellow',
      }),
    );
  });

  // --------------------------------------------------------------------------
  // notify tool
  // --------------------------------------------------------------------------

  it('executes notify tool via webhook dispatcher', async () => {
    const manifest = createManifest({ tools: ['notify'] });

    const provider = createMockProvider([
      {
        content: 'Sending alert.',
        usage: { inputTokens: 100, outputTokens: 50 },
        stopReason: 'tool_use',
        toolCalls: [toolUse('notify', { title: 'Disk Full', message: '90% used', level: 'warning' })],
      },
      {
        content: 'Notification sent.',
        usage: { inputTokens: 200, outputTokens: 30 },
        stopReason: 'end_turn',
      },
    ]);

    const runner = new SkillRunner(provider);
    const result = await runner.run(createRunnerParams({ manifest }));

    expect(result.toolResults[0].success).toBe(true);
    expect(result.toolResults[0].result).toContain('Notification sent');
  });

  // --------------------------------------------------------------------------
  // store tool (placeholder)
  // --------------------------------------------------------------------------

  it('returns not-implemented for store tool', async () => {
    const manifest = createManifest({ tools: ['store'] });

    const provider = createMockProvider([
      {
        content: 'Storing data.',
        usage: { inputTokens: 100, outputTokens: 50 },
        stopReason: 'tool_use',
        toolCalls: [toolUse('store', { action: 'set', key: 'last_check', value: '2026-01-01' })],
      },
      {
        content: 'Done.',
        usage: { inputTokens: 200, outputTokens: 30 },
        stopReason: 'end_turn',
      },
    ]);

    const runner = new SkillRunner(provider);
    const result = await runner.run(createRunnerParams({ manifest }));

    expect(result.toolResults[0].success).toBe(false);
    expect(result.toolResults[0].result).toContain('not yet implemented');
  });

  // --------------------------------------------------------------------------
  // Unknown tool
  // --------------------------------------------------------------------------

  it('handles unknown tool names', async () => {
    const provider = createMockProvider([
      {
        content: 'Trying unknown tool.',
        usage: { inputTokens: 100, outputTokens: 50 },
        stopReason: 'tool_use',
        toolCalls: [toolUse('unknown_tool', { foo: 'bar' })],
      },
      {
        content: 'Failed.',
        usage: { inputTokens: 200, outputTokens: 30 },
        stopReason: 'end_turn',
      },
    ]);

    const runner = new SkillRunner(provider);
    const result = await runner.run(createRunnerParams());

    expect(result.toolResults[0].success).toBe(false);
    expect(result.toolResults[0].result).toContain('Unknown tool');
  });

  // --------------------------------------------------------------------------
  // Constructor throws without provider
  // --------------------------------------------------------------------------

  it('throws if no AI provider available', () => {
    expect(() => new SkillRunner()).toThrow('No AI provider available');
  });

  // --------------------------------------------------------------------------
  // Multiple tool calls in single response
  // --------------------------------------------------------------------------

  it('handles multiple tool calls in a single AI response', async () => {
    const manifest = createManifest({ tools: ['shell', 'read_file'] });

    const provider = createMockProvider([
      {
        content: 'Running two checks.',
        usage: { inputTokens: 100, outputTokens: 50 },
        stopReason: 'tool_use',
        toolCalls: [
          toolUse('shell', { command: 'uptime' }, 'tc-1'),
          toolUse('read_file', { path: '/etc/hostname' }, 'tc-2'),
        ],
      },
      {
        content: 'Both checks passed.',
        usage: { inputTokens: 200, outputTokens: 30 },
        stopReason: 'end_turn',
      },
    ]);

    const runner = new SkillRunner(provider);
    const result = await runner.run(createRunnerParams({ manifest }));

    expect(result.stepsExecuted).toBe(2);
    expect(result.toolResults).toHaveLength(2);
    expect(result.toolResults[0].toolName).toBe('shell');
    expect(result.toolResults[1].toolName).toBe('read_file');
  });

  // --------------------------------------------------------------------------
  // Risk level: red allowed when max is red
  // --------------------------------------------------------------------------

  it('allows red commands when risk_level_max is red', async () => {
    const manifest = createManifest({
      constraints: {
        risk_level_max: 'red',
        timeout: '30s',
        max_steps: 20,
        requires_confirmation: false,
        server_scope: 'single',
      },
    });

    const provider = createMockProvider([
      {
        content: 'Modifying config.',
        usage: { inputTokens: 100, outputTokens: 50 },
        stopReason: 'tool_use',
        // iptables is RED
        toolCalls: [toolUse('shell', { command: 'iptables -L' })],
      },
      {
        content: 'Done.',
        usage: { inputTokens: 200, outputTokens: 30 },
        stopReason: 'end_turn',
      },
    ]);

    const runner = new SkillRunner(provider);
    const result = await runner.run(createRunnerParams({ manifest }));

    expect(result.toolResults[0].success).toBe(true);
    expect(getMockExecutor().executeCommand).toHaveBeenCalled();
  });
});
