// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for SkillToolExecutor — network & storage tool execution methods.
 *
 * Covers: executeNotify, executeHttp, executeStore.
 * Split from runner-executor.test.ts to stay within file-size limits.
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
const { getWebhookDispatcher } = await import('../webhook/dispatcher.js');
const { getSkillKVStore } = await import('./store.js');

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
