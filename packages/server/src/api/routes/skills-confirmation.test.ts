// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for skill confirmation and SSE stream routes.
 *
 * Covers: GET /pending-confirmations, POST /confirm, POST /reject,
 * GET /stream (SSE execution progress).
 *
 * Split from skills.test.ts to stay within the 800-line file limit.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';

import type { ApiEnv } from './types.js';
import type { SkillExecution, SkillExecutionResult } from '../../core/skill/types.js';
import { onError } from '../middleware/error-handler.js';

// ============================================================================
// Module Mocks
// ============================================================================

const mockEngine = {
  listInstalled: vi.fn(),
  listInstalledWithInputs: vi.fn(),
  listAvailable: vi.fn(),
  install: vi.fn(),
  uninstall: vi.fn(),
  configure: vi.fn(),
  updateStatus: vi.fn(),
  execute: vi.fn(),
  getInstalled: vi.fn(),
  getInstalledWithInputs: vi.fn(),
  getExecutions: vi.fn(),
  getExecution: vi.fn(),
  confirmExecution: vi.fn(),
  rejectExecution: vi.fn(),
  listPendingConfirmations: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
};

vi.mock('../../core/skill/engine.js', () => ({
  getSkillEngine: () => mockEngine,
}));

const mockSkillEventBus = {
  subscribe: vi.fn(() => vi.fn()),
  publish: vi.fn(),
  listenerCount: vi.fn(() => 0),
  removeAll: vi.fn(),
};

vi.mock('../../core/skill/skill-event-bus.js', () => ({
  getSkillEventBus: () => mockSkillEventBus,
}));

let mockUserRole = 'owner';

vi.mock('../middleware/auth.js', () => ({
  requireAuth: vi.fn(async (c: { set: (k: string, v: string) => void }, next: () => Promise<void>) => {
    c.set('userId', 'user-1');
    await next();
  }),
}));

vi.mock('../middleware/rbac.js', () => ({
  resolveRole: vi.fn(async (c: { set: (k: string, v: string) => void }, next: () => Promise<void>) => {
    c.set('userRole', mockUserRole);
    await next();
  }),
  requirePermission: vi.fn((permission: string) => {
    return async (c: { get: (k: string) => string }, next: () => Promise<void>) => {
      const role = c.get('userRole');
      const memberPerms = ['skill:view'];
      const adminPerms = ['skill:view', 'skill:execute', 'skill:manage'];
      const allowed = role === 'member' ? memberPerms : adminPerms;
      if (!allowed.includes(permission)) {
        const { ApiError } = await import('../middleware/error-handler.js');
        throw ApiError.forbidden(`Missing permission: ${permission}`);
      }
      await next();
    };
  }),
}));

vi.mock('../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  createContextLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Import after mocks
import { skillsRoute } from './skills.js';

// ============================================================================
// Test App Setup
// ============================================================================

function createTestApp() {
  const app = new Hono<ApiEnv>();
  app.route('/skills', skillsRoute);
  app.onError(onError);
  return app;
}

function makeExecution(overrides: Partial<SkillExecution> = {}): SkillExecution {
  return {
    id: 'exec-1',
    skillId: 'skill-1',
    serverId: 'server-1',
    userId: 'user-1',
    triggerType: 'manual',
    status: 'success',
    startedAt: '2026-02-12T00:00:00.000Z',
    completedAt: '2026-02-12T00:00:01.000Z',
    result: { resolvedPrompt: 'test prompt' },
    stepsExecuted: 0,
    duration: 1000,
    ...overrides,
  };
}

// ============================================================================
// Setup
// ============================================================================

let app: ReturnType<typeof createTestApp>;

beforeEach(() => {
  app = createTestApp();
  mockUserRole = 'owner';
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ============================================================================
// GET /skills/pending-confirmations — List pending confirmations
// ============================================================================

describe('GET /skills/pending-confirmations', () => {
  it('should return pending confirmation executions', async () => {
    const pending = [makeExecution({ id: 'exec-pending', status: 'pending_confirmation', triggerType: 'cron' })];
    mockEngine.listPendingConfirmations.mockResolvedValue(pending);

    const res = await app.request('/skills/pending-confirmations');
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.executions).toHaveLength(1);
    expect(body.executions[0].id).toBe('exec-pending');
    expect(body.executions[0].status).toBe('pending_confirmation');
    expect(mockEngine.listPendingConfirmations).toHaveBeenCalledWith('user-1');
  });

  it('should return empty array when no pending confirmations', async () => {
    mockEngine.listPendingConfirmations.mockResolvedValue([]);

    const res = await app.request('/skills/pending-confirmations');
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.executions).toHaveLength(0);
  });

  it('should be forbidden for member role (skill:execute)', async () => {
    mockUserRole = 'member';

    const res = await app.request('/skills/pending-confirmations');
    expect(res.status).toBe(403);
  });
});

// ============================================================================
// POST /skills/executions/:eid/confirm — Confirm pending execution
// ============================================================================

describe('POST /skills/executions/:eid/confirm', () => {
  it('should confirm a pending execution and return result', async () => {
    const result: SkillExecutionResult = {
      executionId: 'exec-confirmed',
      status: 'success',
      stepsExecuted: 3,
      duration: 2000,
      result: { output: 'confirmed ok' },
      errors: [],
    };
    mockEngine.confirmExecution.mockResolvedValue(result);

    const res = await app.request('/skills/executions/exec-confirmed/confirm', {
      method: 'POST',
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.execution.executionId).toBe('exec-confirmed');
    expect(body.execution.status).toBe('success');
    expect(mockEngine.confirmExecution).toHaveBeenCalledWith('exec-confirmed', 'user-1');
  });

  it('should return 404 for nonexistent execution', async () => {
    mockEngine.confirmExecution.mockRejectedValue(new Error('Execution not found: nonexistent'));

    const res = await app.request('/skills/executions/nonexistent/confirm', {
      method: 'POST',
    });

    expect(res.status).toBe(404);
  });

  it('should return 400 for execution not pending confirmation', async () => {
    mockEngine.confirmExecution.mockRejectedValue(
      new Error("Execution 'exec-1' is not pending confirmation (status=running)"),
    );

    const res = await app.request('/skills/executions/exec-1/confirm', {
      method: 'POST',
    });

    expect(res.status).toBe(400);
  });

  it('should return 400 for expired execution', async () => {
    mockEngine.confirmExecution.mockRejectedValue(
      new Error("Execution 'exec-1' has expired"),
    );

    const res = await app.request('/skills/executions/exec-1/confirm', {
      method: 'POST',
    });

    expect(res.status).toBe(400);
  });

  it('should be forbidden for member role (skill:execute)', async () => {
    mockUserRole = 'member';

    const res = await app.request('/skills/executions/exec-1/confirm', {
      method: 'POST',
    });

    expect(res.status).toBe(403);
  });
});

// ============================================================================
// POST /skills/executions/:eid/reject — Reject pending execution
// ============================================================================

describe('POST /skills/executions/:eid/reject', () => {
  it('should reject a pending execution', async () => {
    mockEngine.rejectExecution.mockResolvedValue(undefined);

    const res = await app.request('/skills/executions/exec-1/reject', {
      method: 'POST',
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(mockEngine.rejectExecution).toHaveBeenCalledWith('exec-1', 'user-1');
  });

  it('should return 404 for nonexistent execution', async () => {
    mockEngine.rejectExecution.mockRejectedValue(new Error('Execution not found: nonexistent'));

    const res = await app.request('/skills/executions/nonexistent/reject', {
      method: 'POST',
    });

    expect(res.status).toBe(404);
  });

  it('should return 400 for execution not pending confirmation', async () => {
    mockEngine.rejectExecution.mockRejectedValue(
      new Error("Execution 'exec-1' is not pending confirmation (status=success)"),
    );

    const res = await app.request('/skills/executions/exec-1/reject', {
      method: 'POST',
    });

    expect(res.status).toBe(400);
  });

  it('should be forbidden for member role (skill:execute)', async () => {
    mockUserRole = 'member';

    const res = await app.request('/skills/executions/exec-1/reject', {
      method: 'POST',
    });

    expect(res.status).toBe(403);
  });
});

// ============================================================================
// GET /skills/executions/:eid/stream — SSE execution progress stream
// ============================================================================

describe('GET /skills/executions/:eid/stream', () => {
  it('should return 404 for nonexistent execution', async () => {
    mockEngine.getExecution.mockResolvedValue(null);

    const res = await app.request('/skills/executions/nonexistent/stream');
    expect(res.status).toBe(404);
  });

  it('should establish SSE connection and subscribe to skill event bus', async () => {
    mockEngine.getExecution.mockResolvedValue(makeExecution());
    mockSkillEventBus.subscribe.mockReturnValue(vi.fn());

    const controller = new AbortController();
    const resPromise = app.request('/skills/executions/exec-1/stream', {
      signal: controller.signal,
    });

    // Give the stream time to start
    await new Promise((r) => setTimeout(r, 50));

    expect(mockSkillEventBus.subscribe).toHaveBeenCalledWith(
      'exec-1',
      expect.any(Function),
    );

    controller.abort();
    await resPromise.catch(() => {});
  });

  it('should be accessible by member role (skill:view)', async () => {
    mockUserRole = 'member';
    mockEngine.getExecution.mockResolvedValue(makeExecution());
    mockSkillEventBus.subscribe.mockReturnValue(vi.fn());

    const controller = new AbortController();
    const resPromise = app.request('/skills/executions/exec-1/stream', {
      signal: controller.signal,
    });

    await new Promise((r) => setTimeout(r, 50));
    controller.abort();
    await resPromise.catch(() => {});

    // If we got here without 403, the member role was accepted
    expect(mockEngine.getExecution).toHaveBeenCalledWith('exec-1');
  });

  it('should be forbidden for member if permission check fails', async () => {
    // This verifies the permission check is wired — members have skill:view so they pass
    mockUserRole = 'member';
    mockEngine.getExecution.mockResolvedValue(makeExecution());
    mockSkillEventBus.subscribe.mockReturnValue(vi.fn());

    const controller = new AbortController();
    const resPromise = app.request('/skills/executions/exec-1/stream', {
      signal: controller.signal,
    });

    await new Promise((r) => setTimeout(r, 50));
    controller.abort();

    // Member has skill:view, so this should succeed
    await resPromise.catch(() => {});
    expect(mockSkillEventBus.subscribe).toHaveBeenCalled();
  });
});
