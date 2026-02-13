// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for SkillRunner — basic execution, security, audit, and tool routing.
 *
 * Agentic loop tests (multi-step, timeout, step limits, outputs) → runner-agentic-loop.test.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { SkillRunner } from './runner.js';
import type { RunnerParams } from './runner.js';
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

vi.mock('./store.js', () => {
  const mockStore = {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    deleteAll: vi.fn().mockResolvedValue(0),
    list: vi.fn().mockResolvedValue({}),
  };
  return {
    getSkillKVStore: vi.fn(() => mockStore),
    _mockStore: mockStore,
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
    skillId: 'skill-1',
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
    contextWindowSize: 200_000,
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
// Tests: SkillRunner — basic execution, security, audit, tool routing, errors
// (Agentic loop tests: multi-step, timeout, step limits, outputs → runner-agentic-loop.test.ts)
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
  // Graceful degradation: no AI provider
  // --------------------------------------------------------------------------

  it('constructs without provider and does not throw', () => {
    expect(() => new SkillRunner()).not.toThrow();
  });

  it('returns failed result when no AI provider is available at run time', async () => {
    const runner = new SkillRunner();
    const result = await runner.run(createRunnerParams());

    expect(result.success).toBe(false);
    expect(result.status).toBe('failed');
    expect(result.stepsExecuted).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('No AI provider available');
    expect(result.toolResults).toHaveLength(0);
  });

  it('auto-acquires provider when it becomes available after construction', async () => {
    const { getActiveProvider } = await import('../../ai/providers/provider-factory.js');
    const mockGetActiveProvider = getActiveProvider as ReturnType<typeof vi.fn>;

    // First call: no provider available
    const runner = new SkillRunner();

    // Provider becomes available before run()
    const provider = createMockProvider([
      {
        content: 'Task done.',
        usage: { inputTokens: 100, outputTokens: 50 },
        stopReason: 'end_turn',
      },
    ]);
    mockGetActiveProvider.mockReturnValue(provider);

    const result = await runner.run(createRunnerParams());

    expect(result.success).toBe(true);
    expect(result.status).toBe('success');
    expect(result.output).toContain('Task done');

    // Reset mock
    mockGetActiveProvider.mockReturnValue(null);
  });

  it('reuses cached provider on subsequent run() calls', async () => {
    const provider = createMockProvider([
      {
        content: 'First run done.',
        usage: { inputTokens: 100, outputTokens: 50 },
        stopReason: 'end_turn',
      },
      {
        content: 'Second run done.',
        usage: { inputTokens: 100, outputTokens: 50 },
        stopReason: 'end_turn',
      },
    ]);

    const runner = new SkillRunner(provider);
    const result1 = await runner.run(createRunnerParams());
    const result2 = await runner.run(createRunnerParams());

    expect(result1.success).toBe(true);
    expect(result2.success).toBe(true);
    // Provider's chat should have been called twice (once per run)
    expect(provider.chat).toHaveBeenCalledTimes(2);
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
