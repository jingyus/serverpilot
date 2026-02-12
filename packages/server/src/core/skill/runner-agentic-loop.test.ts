// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for SkillRunner — agentic loop behavior.
 *
 * Covers: multi-step execution, timeout termination, step limits,
 * multiple tool calls per response, and structured output parsing.
 *
 * Basic execution, security, audit, and tool routing tests → runner.test.ts
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

function toolUse(name: string, input: Record<string, unknown>, id = 'tc-1'): ToolUseBlock {
  return { type: 'tool_use', id, name, input };
}

const DONE_RESPONSE: ChatResponse = {
  content: 'Done.', usage: { inputTokens: 200, outputTokens: 30 }, stopReason: 'end_turn',
};

/** Run a single tool call through the runner and return the result. */
async function runSingleTool(
  tool: string, input: Record<string, unknown>, tools?: string[],
) {
  const manifest = createManifest({ tools: (tools ?? [tool]) as SkillManifest['tools'] });
  const provider = createMockProvider([
    {
      content: 'Executing tool.',
      usage: { inputTokens: 100, outputTokens: 50 },
      stopReason: 'tool_use',
      toolCalls: [toolUse(tool, input)],
    },
    DONE_RESPONSE,
  ]);
  const runner = new SkillRunner(provider);
  return runner.run(createRunnerParams({ manifest }));
}

// ============================================================================
// Tests: SkillRunner — agentic loop
// ============================================================================

describe('SkillRunner agentic loop', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    getMockAuditLogger().log.mockResolvedValue({ id: 'audit-1' });
    getMockAuditLogger().updateExecutionResult.mockResolvedValue(true);

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

    (findConnectedAgent as ReturnType<typeof vi.fn>).mockReturnValue('client-123');

    getMockStore().get.mockResolvedValue(null);
    getMockStore().set.mockResolvedValue(undefined);
    getMockStore().delete.mockResolvedValue(undefined);
    getMockStore().list.mockResolvedValue({});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // --------------------------------------------------------------------------
  // Multi-step loop
  // --------------------------------------------------------------------------

  it('executes a multi-step loop (read_file → shell → notify)', async () => {
    const manifest = createManifest({ tools: ['shell', 'read_file', 'notify'] });

    const provider = createMockProvider([
      {
        content: 'Reading config file first.',
        usage: { inputTokens: 100, outputTokens: 50 },
        stopReason: 'tool_use',
        toolCalls: [toolUse('read_file', { path: '/etc/nginx/nginx.conf' }, 'tc-1')],
      },
      {
        content: 'Now checking nginx status.',
        usage: { inputTokens: 200, outputTokens: 40 },
        stopReason: 'tool_use',
        toolCalls: [toolUse('shell', { command: 'systemctl status nginx' }, 'tc-2')],
      },
      {
        content: 'Sending notification.',
        usage: { inputTokens: 300, outputTokens: 30 },
        stopReason: 'tool_use',
        toolCalls: [toolUse('notify', { title: 'Nginx checked', message: 'All good' }, 'tc-3')],
      },
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
  // Timeout termination
  // --------------------------------------------------------------------------

  it('terminates on timeout', async () => {
    const manifest = createManifest({
      constraints: {
        risk_level_max: 'yellow',
        timeout: '1s',
        max_steps: 100,
        requires_confirmation: false,
        server_scope: 'single',
      },
    });

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

    expect(result.stepsExecuted).toBe(2);
    expect(result.toolResults).toHaveLength(2);
  });

  // --------------------------------------------------------------------------
  // Output schema validation
  // --------------------------------------------------------------------------

  it('parses structured outputs from AI text when manifest declares outputs', async () => {
    const manifest = createManifest({
      outputs: [
        { name: 'report', type: 'string', description: 'Summary' },
        { name: 'count', type: 'number', description: 'Count' },
      ],
    });

    const provider = createMockProvider([
      {
        content: 'Task done.\n```json\n{"report": "All healthy", "count": 42}\n```',
        usage: { inputTokens: 100, outputTokens: 50 },
        stopReason: 'end_turn',
      },
    ]);

    const runner = new SkillRunner(provider);
    const result = await runner.run(createRunnerParams({ manifest }));

    expect(result.success).toBe(true);
    expect(result.parsedOutputs).toBeDefined();
    expect(result.parsedOutputs!.values).toEqual({
      report: 'All healthy',
      count: 42,
    });
    expect(result.parsedOutputs!.warnings).toHaveLength(0);
  });

  it('includes warnings when AI output is missing declared fields', async () => {
    const manifest = createManifest({
      outputs: [
        { name: 'report', type: 'string', description: 'Summary' },
        { name: 'missing_field', type: 'boolean', description: 'Nope' },
      ],
    });

    const provider = createMockProvider([
      {
        content: '```json\n{"report": "Partial"}\n```',
        usage: { inputTokens: 100, outputTokens: 50 },
        stopReason: 'end_turn',
      },
    ]);

    const runner = new SkillRunner(provider);
    const result = await runner.run(createRunnerParams({ manifest }));

    expect(result.parsedOutputs).toBeDefined();
    expect(result.parsedOutputs!.values.report).toBe('Partial');
    expect(result.parsedOutputs!.warnings.length).toBeGreaterThan(0);
    expect(result.parsedOutputs!.warnings[0]).toContain('missing_field');
  });

  it('omits parsedOutputs when manifest has no outputs declared', async () => {
    const provider = createMockProvider([
      {
        content: 'Done.',
        usage: { inputTokens: 100, outputTokens: 50 },
        stopReason: 'end_turn',
      },
    ]);

    const runner = new SkillRunner(provider);
    const result = await runner.run(createRunnerParams());

    expect(result.parsedOutputs).toBeUndefined();
  });

  it('includes output instructions in system prompt when outputs are declared', async () => {
    const manifest = createManifest({
      outputs: [
        { name: 'status', type: 'string', description: 'Health status' },
      ],
    });

    const provider = createMockProvider([
      {
        content: '```json\n{"status": "ok"}\n```',
        usage: { inputTokens: 100, outputTokens: 50 },
        stopReason: 'end_turn',
      },
    ]);

    const runner = new SkillRunner(provider);
    await runner.run(createRunnerParams({ manifest }));

    const chatCall = (provider.chat as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(chatCall.system).toContain('IMPORTANT');
    expect(chatCall.system).toContain('"status"');
    expect(chatCall.system).toContain('<string>');
  });

  it('still returns parsedOutputs on timeout when outputs are declared', async () => {
    const manifest = createManifest({
      outputs: [
        { name: 'partial', type: 'string', description: 'Partial result' },
      ],
      constraints: {
        risk_level_max: 'yellow',
        timeout: '1s',
        max_steps: 100,
        requires_confirmation: false,
        server_scope: 'single',
      },
    });

    const provider: AIProviderInterface = {
      name: 'slow-provider',
      tier: 1,
      chat: vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        return {
          content: 'Still working...',
          usage: { inputTokens: 100, outputTokens: 50 },
          stopReason: 'end_turn',
        };
      }),
      stream: vi.fn(),
      isAvailable: vi.fn(async () => true),
    };

    const runner = new SkillRunner(provider);
    const result = await runner.run(createRunnerParams({ manifest }));

    expect(result.status).toBe('timeout');
    expect(result.parsedOutputs).toBeDefined();
    expect(result.parsedOutputs!.warnings.length).toBeGreaterThan(0);
  }, 10_000);

  // --------------------------------------------------------------------------
  // Tool dispatch: read_file, write_file, notify
  // --------------------------------------------------------------------------

  it('executes read_file tool via cat command', async () => {
    getMockExecutor().executeCommand.mockResolvedValue({
      success: true, executionId: 'exec-1', operationId: 'op-1',
      exitCode: 0, stdout: 'server { listen 80; }', stderr: '', duration: 50, timedOut: false,
    });
    const result = await runSingleTool('read_file', { path: '/etc/nginx/nginx.conf' });
    expect(result.toolResults[0].success).toBe(true);
    expect(result.toolResults[0].result).toContain('server { listen 80; }');
    expect(getMockExecutor().executeCommand).toHaveBeenCalledWith(
      expect.objectContaining({ riskLevel: 'green', description: expect.stringContaining('Read file') }),
    );
  });

  it('executes write_file tool', async () => {
    const result = await runSingleTool('write_file', { path: '/tmp/test.conf', content: 'key=value' });
    expect(result.toolResults[0].success).toBe(true);
    expect(result.toolResults[0].result).toContain('File written');
    expect(getMockExecutor().executeCommand).toHaveBeenCalledWith(
      expect.objectContaining({ riskLevel: 'yellow' }),
    );
  });

  it('executes notify tool via webhook dispatcher', async () => {
    const result = await runSingleTool('notify', { title: 'Disk Full', message: '90% used', level: 'warning' });
    expect(result.toolResults[0].success).toBe(true);
    expect(result.toolResults[0].result).toContain('Notification sent');
  });

  // --------------------------------------------------------------------------
  // Tool dispatch: store
  // --------------------------------------------------------------------------

  it('executes store set action', async () => {
    const result = await runSingleTool('store', { action: 'set', key: 'last_check', value: '2026-01-01' });
    expect(result.toolResults[0].success).toBe(true);
    expect(result.toolResults[0].result).toContain('Stored key');
    expect(getMockStore().set).toHaveBeenCalledWith('skill-1', 'last_check', '2026-01-01');
  });

  it('executes store get action', async () => {
    getMockStore().get.mockResolvedValue('some-value');
    const result = await runSingleTool('store', { action: 'get', key: 'my_key' });
    expect(result.toolResults[0].success).toBe(true);
    expect(result.toolResults[0].result).toBe('some-value');
    expect(getMockStore().get).toHaveBeenCalledWith('skill-1', 'my_key');
  });

  it('executes store list action', async () => {
    getMockStore().list.mockResolvedValue({ last_check: '2026-01-01', version: '3.0' });
    const result = await runSingleTool('store', { action: 'list' });
    expect(result.toolResults[0].success).toBe(true);
    expect(JSON.parse(result.toolResults[0].result)).toEqual({ last_check: '2026-01-01', version: '3.0' });
    expect(getMockStore().list).toHaveBeenCalledWith('skill-1');
  });

  it.each([
    { action: 'get', input: { action: 'get' } },
    { action: 'delete', input: { action: 'delete' } },
    { action: 'set', input: { action: 'set', value: 'v' } },
  ])('returns error for store $action without key', async ({ input }) => {
    const result = await runSingleTool('store', input);
    expect(result.toolResults[0].success).toBe(false);
    expect(result.toolResults[0].result).toContain('Missing "key"');
  });

  it('returns not found for store get with missing key', async () => {
    getMockStore().get.mockResolvedValue(null);
    const result = await runSingleTool('store', { action: 'get', key: 'missing' });
    expect(result.toolResults[0].success).toBe(false);
    expect(result.toolResults[0].result).toContain('not found');
  });

  // --------------------------------------------------------------------------
  // Unknown tool
  // --------------------------------------------------------------------------

  it('handles unknown tool names', async () => {
    const result = await runSingleTool('unknown_tool', { foo: 'bar' }, ['shell']);
    expect(result.toolResults[0].success).toBe(false);
    expect(result.toolResults[0].result).toContain('Unknown tool');
  });
});
