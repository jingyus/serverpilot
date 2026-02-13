// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for Skill Dry-Run preview mode.
 *
 * Covers: runner dry-run prompt/tools, executor safety guard,
 * engine triggerType override, webhook/trigger skip, and API schema.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { SkillRunner } from './runner.js';
import type { RunnerParams } from './runner.js';
import { SkillToolExecutor } from './runner-executor.js';
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
    deleteAll: vi.fn().mockResolvedValue(0),
    list: vi.fn().mockResolvedValue({}),
  };
  return {
    getSkillKVStore: vi.fn(() => mockStore),
    _mockStore: mockStore,
  };
});

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
    tools: ['shell', 'read_file', 'write_file'],
    constraints: {
      risk_level_max: 'yellow',
      timeout: '30s',
      max_steps: 20,
      requires_confirmation: false,
      server_scope: 'single',
    },
    prompt: 'Check server health and report status. This prompt is long enough for validation.',
    ...overrides,
  } as SkillManifest;
}

function createRunnerParams(overrides: Partial<RunnerParams> = {}): RunnerParams {
  return {
    manifest: createManifest(),
    resolvedPrompt: 'Check server health and report status.',
    skillId: 'skill-1',
    serverId: 'server-1',
    userId: 'user-1',
    executionId: 'exec-dry-1',
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

// ============================================================================
// Tests: SkillRunner — dry-run mode
// ============================================================================

describe('SkillRunner dry-run mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('appends DRY RUN instructions to system prompt', async () => {
    const provider = createMockProvider([
      {
        content: 'Step 1: shell — systemctl status nginx\nStep 2: read_file — /etc/nginx/nginx.conf',
        usage: { inputTokens: 100, outputTokens: 80 },
        stopReason: 'end_turn',
      },
    ]);

    const runner = new SkillRunner(provider);
    await runner.run(createRunnerParams({ dryRun: true }));

    const chatCall = (provider.chat as ReturnType<typeof vi.fn>).mock.calls[0][0] as ChatOptions;
    expect(chatCall.system).toContain('DRY RUN MODE');
    expect(chatCall.system).toContain('Do NOT call any tools');
  });

  it('passes empty tools array in dry-run mode', async () => {
    const provider = createMockProvider([
      {
        content: 'Planned steps listed.',
        usage: { inputTokens: 100, outputTokens: 40 },
        stopReason: 'end_turn',
      },
    ]);

    const runner = new SkillRunner(provider);
    await runner.run(createRunnerParams({ dryRun: true }));

    const chatCall = (provider.chat as ReturnType<typeof vi.fn>).mock.calls[0][0] as ChatOptions;
    expect(chatCall.tools).toEqual([]);
  });

  it('sends dry-run specific user message', async () => {
    const provider = createMockProvider([
      {
        content: 'Plan output.',
        usage: { inputTokens: 100, outputTokens: 30 },
        stopReason: 'end_turn',
      },
    ]);

    const runner = new SkillRunner(provider);
    await runner.run(createRunnerParams({ dryRun: true }));

    const chatCall = (provider.chat as ReturnType<typeof vi.fn>).mock.calls[0][0] as ChatOptions;
    const userMessage = chatCall.messages[0];
    expect(userMessage.content).toContain('dry-run');
    expect(userMessage.content).toContain('do NOT call any tools');
  });

  it('returns AI plan text as output without tool execution', async () => {
    const planText = 'Step 1: shell — systemctl status nginx\nStep 2: read_file — /etc/nginx/nginx.conf\nStep 3: notify — send health report';
    const provider = createMockProvider([
      {
        content: planText,
        usage: { inputTokens: 100, outputTokens: 80 },
        stopReason: 'end_turn',
      },
    ]);

    const runner = new SkillRunner(provider);
    const result = await runner.run(createRunnerParams({ dryRun: true }));

    expect(result.success).toBe(true);
    expect(result.status).toBe('success');
    expect(result.output).toBe(planText);
    expect(result.stepsExecuted).toBe(0);
    expect(result.toolResults).toHaveLength(0);
  });

  it('does not include DRY RUN prompt in normal execution', async () => {
    const provider = createMockProvider([
      {
        content: 'Done.',
        usage: { inputTokens: 100, outputTokens: 30 },
        stopReason: 'end_turn',
      },
    ]);

    const runner = new SkillRunner(provider);
    await runner.run(createRunnerParams({ dryRun: false }));

    const chatCall = (provider.chat as ReturnType<typeof vi.fn>).mock.calls[0][0] as ChatOptions;
    expect(chatCall.system).not.toContain('DRY RUN MODE');
    expect(chatCall.tools!.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// Tests: SkillToolExecutor — dry-run safety guard
// ============================================================================

describe('SkillToolExecutor dry-run guard', () => {
  let executor: SkillToolExecutor;

  beforeEach(() => {
    vi.clearAllMocks();
    executor = new SkillToolExecutor();
    executor.setDryRun(true);
  });

  it('blocks shell tool and returns DRY RUN message', async () => {
    const result = await executor.executeTool(
      toolUse('shell', { command: 'rm -rf /tmp/test' }),
      'skill-1', 'server-1', 'user-1', 'exec-1', 'yellow', 'test-skill',
    );

    expect(result.success).toBe(true);
    expect(result.result).toContain('[DRY RUN]');
    expect(result.result).toContain('shell');
    expect(result.result).toContain('rm -rf /tmp/test');
  });

  it('blocks write_file tool in dry-run mode', async () => {
    const result = await executor.executeTool(
      toolUse('write_file', { path: '/etc/config.conf', content: 'new content' }),
      'skill-1', 'server-1', 'user-1', 'exec-1', 'yellow', 'test-skill',
    );

    expect(result.success).toBe(true);
    expect(result.result).toContain('[DRY RUN]');
    expect(result.result).toContain('write_file');
  });

  it('blocks read_file tool in dry-run mode', async () => {
    const result = await executor.executeTool(
      toolUse('read_file', { path: '/etc/hostname' }),
      'skill-1', 'server-1', 'user-1', 'exec-1', 'yellow', 'test-skill',
    );

    expect(result.success).toBe(true);
    expect(result.result).toContain('[DRY RUN]');
    expect(result.result).toContain('read_file');
  });

  it('blocks notify tool in dry-run mode', async () => {
    const result = await executor.executeTool(
      toolUse('notify', { title: 'Alert', message: 'Test' }),
      'skill-1', 'server-1', 'user-1', 'exec-1', 'yellow', 'test-skill',
    );

    expect(result.success).toBe(true);
    expect(result.result).toContain('[DRY RUN]');
    expect(result.result).toContain('notify');
  });

  it('blocks http tool in dry-run mode', async () => {
    const result = await executor.executeTool(
      toolUse('http', { url: 'https://example.com/api' }),
      'skill-1', 'server-1', 'user-1', 'exec-1', 'yellow', 'test-skill',
    );

    expect(result.success).toBe(true);
    expect(result.result).toContain('[DRY RUN]');
    expect(result.result).toContain('http');
  });

  it('blocks store tool in dry-run mode', async () => {
    const result = await executor.executeTool(
      toolUse('store', { action: 'set', key: 'foo', value: 'bar' }),
      'skill-1', 'server-1', 'user-1', 'exec-1', 'yellow', 'test-skill',
    );

    expect(result.success).toBe(true);
    expect(result.result).toContain('[DRY RUN]');
    expect(result.result).toContain('store');
  });

  it('does not block tools when dry-run is disabled', async () => {
    executor.setDryRun(false);

    // unknown_tool should fall through to the default case (not blocked by dry-run)
    const result = await executor.executeTool(
      toolUse('unknown_tool', { foo: 'bar' }),
      'skill-1', 'server-1', 'user-1', 'exec-1', 'yellow', 'test-skill',
    );

    expect(result.result).not.toContain('[DRY RUN]');
    expect(result.result).toContain('Unknown tool');
  });
});

// ============================================================================
// Tests: ExecuteSkillBodySchema — dryRun field
// ============================================================================

describe('ExecuteSkillBodySchema dryRun field', () => {
  // Import dynamically to avoid issues with module resolution in test
  it('accepts dryRun: true', async () => {
    const { ExecuteSkillBodySchema } = await import('../../api/routes/schemas.js');
    const result = ExecuteSkillBodySchema.safeParse({
      serverId: 'server-1',
      dryRun: true,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.dryRun).toBe(true);
    }
  });

  it('accepts request without dryRun (defaults to undefined)', async () => {
    const { ExecuteSkillBodySchema } = await import('../../api/routes/schemas.js');
    const result = ExecuteSkillBodySchema.safeParse({
      serverId: 'server-1',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.dryRun).toBeUndefined();
    }
  });

  it('rejects non-boolean dryRun value', async () => {
    const { ExecuteSkillBodySchema } = await import('../../api/routes/schemas.js');
    const result = ExecuteSkillBodySchema.safeParse({
      serverId: 'server-1',
      dryRun: 'yes',
    });
    expect(result.success).toBe(false);
  });
});
