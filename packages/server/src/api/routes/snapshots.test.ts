// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for snapshot management routes.
 *
 * Validates list, get, delete, and rollback endpoints including
 * error handling for not-found and rollback-failure scenarios.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';

import type { ApiEnv } from './types.js';
import type { Snapshot } from '../../db/repositories/snapshot-repository.js';
import { onError } from '../middleware/error-handler.js';

// ============================================================================
// Module Mocks (BEFORE route import)
// ============================================================================

vi.mock('../middleware/auth.js', () => ({
  requireAuth: vi.fn(async (c: { set: (k: string, v: string) => void }, next: () => Promise<void>) => {
    c.set('userId', 'user-1');
    await next();
  }),
}));

vi.mock('../middleware/rbac.js', () => ({
  resolveRole: vi.fn(async (c: Record<string, (k: string, v: string) => void>, next: () => Promise<void>) => {
    c.set('userRole', 'owner');
    await next();
  }),
  requirePermission: vi.fn(() => {
    return async (_c: unknown, next: () => Promise<void>) => {
      await next();
    };
  }),
}));

vi.mock('../middleware/validate.js', () => ({
  validateQuery: vi.fn(() => {
    return async (c: { req: { query: () => Record<string, string> }; set: (k: string, v: unknown) => void }, next: () => Promise<void>) => {
      c.set('validatedQuery', c.req.query());
      await next();
    };
  }),
  validateBody: vi.fn(() => {
    return async (c: { req: { json: () => Promise<unknown> }; set: (k: string, v: unknown) => void }, next: () => Promise<void>) => {
      const body = await c.req.json();
      c.set('validatedBody', body);
      await next();
    };
  }),
}));

const mockSnapshotRepo = {
  listByServer: vi.fn(),
  getById: vi.fn(),
  delete: vi.fn(),
  create: vi.fn(),
  listByOperation: vi.fn(),
  getExpired: vi.fn(),
  deleteExpired: vi.fn(),
};

vi.mock('../../db/repositories/snapshot-repository.js', () => ({
  getSnapshotRepository: () => mockSnapshotRepo,
}));

const mockRollbackService = {
  rollback: vi.fn(),
};

vi.mock('../../core/rollback/rollback-service.js', () => ({
  getRollbackService: () => mockRollbackService,
}));

vi.mock('../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Import after mocks
import { snapshots } from './snapshots.js';

// ============================================================================
// Test App Setup
// ============================================================================

function createTestApp() {
  const app = new Hono<ApiEnv>();
  app.route('/servers/:serverId/snapshots', snapshots);
  app.onError(onError);
  return app;
}

function makeSnapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    id: 'snap-1',
    serverId: 'server-1',
    operationId: 'op-1',
    files: [
      { path: '/etc/nginx/nginx.conf', content: 'worker_processes 1;', mode: '0644', owner: 'root' },
    ],
    configs: [],
    createdAt: '2026-02-10T00:00:00.000Z',
    expiresAt: '2026-03-10T00:00:00.000Z',
    ...overrides,
  };
}

// ============================================================================
// Setup
// ============================================================================

let app: ReturnType<typeof createTestApp>;

beforeEach(() => {
  app = createTestApp();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ============================================================================
// GET /servers/:serverId/snapshots — List snapshots
// ============================================================================

describe('GET /servers/:serverId/snapshots', () => {
  it('should return a list of snapshots', async () => {
    const snapshotData = makeSnapshot();
    (mockSnapshotRepo.listByServer as ReturnType<typeof vi.fn>).mockResolvedValue({
      snapshots: [snapshotData],
      total: 1,
    });

    const res = await app.request('/servers/server-1/snapshots');
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.snapshots).toHaveLength(1);
    expect(body.total).toBe(1);
    expect(body.snapshots[0].id).toBe('snap-1');
    expect(body.snapshots[0].serverId).toBe('server-1');
  });

  it('should return an empty list when no snapshots exist', async () => {
    (mockSnapshotRepo.listByServer as ReturnType<typeof vi.fn>).mockResolvedValue({
      snapshots: [],
      total: 0,
    });

    const res = await app.request('/servers/server-1/snapshots');
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.snapshots).toHaveLength(0);
    expect(body.total).toBe(0);
  });

  it('should pass pagination query params to repository', async () => {
    (mockSnapshotRepo.listByServer as ReturnType<typeof vi.fn>).mockResolvedValue({
      snapshots: [],
      total: 0,
    });

    await app.request('/servers/server-1/snapshots?limit=10&offset=20');

    expect(mockSnapshotRepo.listByServer).toHaveBeenCalledWith(
      'server-1',
      'user-1',
      expect.objectContaining({ limit: '10', offset: '20' }),
    );
  });

  it('should pass the serverId path parameter to repository', async () => {
    (mockSnapshotRepo.listByServer as ReturnType<typeof vi.fn>).mockResolvedValue({
      snapshots: [],
      total: 0,
    });

    await app.request('/servers/my-server-42/snapshots');

    expect(mockSnapshotRepo.listByServer).toHaveBeenCalledWith(
      'my-server-42',
      'user-1',
      expect.any(Object),
    );
  });
});

// ============================================================================
// GET /servers/:serverId/snapshots/:snapshotId — Get snapshot details
// ============================================================================

describe('GET /servers/:serverId/snapshots/:snapshotId', () => {
  it('should return snapshot details', async () => {
    const snapshotData = makeSnapshot();
    (mockSnapshotRepo.getById as ReturnType<typeof vi.fn>).mockResolvedValue(snapshotData);

    const res = await app.request('/servers/server-1/snapshots/snap-1');
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.snapshot).toBeDefined();
    expect(body.snapshot.id).toBe('snap-1');
    expect(body.snapshot.serverId).toBe('server-1');
    expect(body.snapshot.files).toHaveLength(1);
    expect(body.snapshot.files[0].path).toBe('/etc/nginx/nginx.conf');
  });

  it('should return 404 when snapshot is not found', async () => {
    (mockSnapshotRepo.getById as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const res = await app.request('/servers/server-1/snapshots/non-existent');
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.message).toContain('Snapshot');
  });

  it('should call getById with correct snapshotId and userId', async () => {
    (mockSnapshotRepo.getById as ReturnType<typeof vi.fn>).mockResolvedValue(makeSnapshot());

    await app.request('/servers/server-1/snapshots/snap-abc');

    expect(mockSnapshotRepo.getById).toHaveBeenCalledWith('snap-abc', 'user-1');
  });
});

// ============================================================================
// DELETE /servers/:serverId/snapshots/:snapshotId — Delete a snapshot
// ============================================================================

describe('DELETE /servers/:serverId/snapshots/:snapshotId', () => {
  it('should delete a snapshot successfully', async () => {
    (mockSnapshotRepo.delete as ReturnType<typeof vi.fn>).mockResolvedValue(true);

    const res = await app.request('/servers/server-1/snapshots/snap-1', {
      method: 'DELETE',
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it('should return 404 when snapshot to delete is not found', async () => {
    (mockSnapshotRepo.delete as ReturnType<typeof vi.fn>).mockResolvedValue(false);

    const res = await app.request('/servers/server-1/snapshots/non-existent', {
      method: 'DELETE',
    });
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.message).toContain('Snapshot');
  });

  it('should call delete with correct snapshotId and userId', async () => {
    (mockSnapshotRepo.delete as ReturnType<typeof vi.fn>).mockResolvedValue(true);

    await app.request('/servers/server-1/snapshots/snap-xyz', {
      method: 'DELETE',
    });

    expect(mockSnapshotRepo.delete).toHaveBeenCalledWith('snap-xyz', 'user-1');
  });
});

// ============================================================================
// POST /servers/:serverId/snapshots/:snapshotId/rollback — One-click rollback
// ============================================================================

describe('POST /servers/:serverId/snapshots/:snapshotId/rollback', () => {
  const rollbackBody = {
    clientId: 'ws-client-1',
    reason: 'Rolling back broken config',
    timeoutMs: 15000,
  };

  it('should perform rollback successfully', async () => {
    (mockRollbackService.rollback as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      snapshotId: 'snap-1',
      fileResults: [
        { path: '/etc/nginx/nginx.conf', success: true },
      ],
      restoredCount: 1,
      failedCount: 0,
      operationId: 'op-1',
    });

    const res = await app.request('/servers/server-1/snapshots/snap-1/rollback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rollbackBody),
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.snapshotId).toBe('snap-1');
    expect(body.restoredCount).toBe(1);
    expect(body.failedCount).toBe(0);
    expect(body.fileResults).toHaveLength(1);
    expect(body.operationId).toBe('op-1');
  });

  it('should pass correct arguments to rollback service', async () => {
    (mockRollbackService.rollback as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      snapshotId: 'snap-42',
      fileResults: [],
      restoredCount: 0,
      failedCount: 0,
    });

    await app.request('/servers/server-1/snapshots/snap-42/rollback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rollbackBody),
    });

    expect(mockRollbackService.rollback).toHaveBeenCalledWith({
      snapshotId: 'snap-42',
      userId: 'user-1',
      clientId: 'ws-client-1',
      reason: 'Rolling back broken config',
      timeoutMs: 15000,
    });
  });

  it('should use default timeout when timeoutMs is not provided', async () => {
    (mockRollbackService.rollback as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      snapshotId: 'snap-1',
      fileResults: [],
      restoredCount: 0,
      failedCount: 0,
    });

    await app.request('/servers/server-1/snapshots/snap-1/rollback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: 'ws-client-1' }),
    });

    expect(mockRollbackService.rollback).toHaveBeenCalledWith(
      expect.objectContaining({
        snapshotId: 'snap-1',
        userId: 'user-1',
        clientId: 'ws-client-1',
        timeoutMs: 30000,
      }),
    );
  });

  it('should return 404 when snapshot not found during rollback', async () => {
    (mockRollbackService.rollback as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: false,
      snapshotId: 'snap-missing',
      fileResults: [],
      restoredCount: 0,
      failedCount: 0,
      error: 'Snapshot not found or access denied',
    });

    const res = await app.request('/servers/server-1/snapshots/snap-missing/rollback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rollbackBody),
    });
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.message).toContain('Snapshot');
  });

  it('should return 502 when rollback fails with generic error', async () => {
    (mockRollbackService.rollback as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: false,
      snapshotId: 'snap-1',
      fileResults: [],
      restoredCount: 0,
      failedCount: 0,
      error: 'Agent connection lost during rollback',
    });

    const res = await app.request('/servers/server-1/snapshots/snap-1/rollback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rollbackBody),
    });
    expect(res.status).toBe(502);

    const body = await res.json();
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).toBe('Agent connection lost during rollback');
  });

  it('should return 502 with default message when rollback fails without error', async () => {
    (mockRollbackService.rollback as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: false,
      snapshotId: 'snap-1',
      fileResults: [],
      restoredCount: 0,
      failedCount: 0,
      error: undefined,
    });

    const res = await app.request('/servers/server-1/snapshots/snap-1/rollback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rollbackBody),
    });
    expect(res.status).toBe(502);

    const body = await res.json();
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).toBe('Rollback failed');
  });

  it('should return 502 when rollback times out', async () => {
    (mockRollbackService.rollback as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: false,
      snapshotId: 'snap-1',
      fileResults: [],
      restoredCount: 0,
      failedCount: 0,
      error: 'Rollback request timed out',
    });

    const res = await app.request('/servers/server-1/snapshots/snap-1/rollback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rollbackBody),
    });
    expect(res.status).toBe(502);

    const body = await res.json();
    expect(body.error.message).toBe('Rollback request timed out');
  });

  it('should include partial results on successful rollback with some failures', async () => {
    (mockRollbackService.rollback as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      snapshotId: 'snap-1',
      fileResults: [
        { path: '/etc/nginx/nginx.conf', success: true },
        { path: '/etc/nginx/sites-enabled/default', success: false, error: 'Permission denied' },
      ],
      restoredCount: 1,
      failedCount: 1,
      operationId: 'op-1',
    });

    const res = await app.request('/servers/server-1/snapshots/snap-1/rollback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rollbackBody),
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.restoredCount).toBe(1);
    expect(body.failedCount).toBe(1);
    expect(body.fileResults).toHaveLength(2);
    expect(body.fileResults[0].success).toBe(true);
    expect(body.fileResults[1].success).toBe(false);
  });
});
