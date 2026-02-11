// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for the RollbackService.
 *
 * Validates snapshot-based rollback orchestration, agent communication,
 * timeout handling, operation status updates, and error cases.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { MessageType } from '@aiinstaller/shared';

import {
  RollbackService,
  RollbackRequestSchema,
  _resetRollbackService,
  type RollbackRequest,
  type RollbackResult,
} from './rollback-service.js';
import type { InstallServer } from '../../api/server.js';
import type {
  SnapshotRepository,
  Snapshot,
} from '../../db/repositories/snapshot-repository.js';
import type { OperationRepository } from '../../db/repositories/operation-repository.js';

// ============================================================================
// Mock Factories
// ============================================================================

function createMockServer(): InstallServer {
  return {
    send: vi.fn(),
    broadcast: vi.fn(),
    on: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    getClientCount: vi.fn(() => 1),
    getSessionCount: vi.fn(() => 0),
    isRunning: vi.fn(() => true),
    createSession: vi.fn(),
    getSession: vi.fn(),
    updateSessionStatus: vi.fn(),
    getClientSessionId: vi.fn(),
    isClientAuthenticated: vi.fn(() => true),
    authenticateClient: vi.fn(),
    getClientAuth: vi.fn(),
    getMaxConnections: vi.fn(() => 100),
    getClientsByDeviceId: vi.fn(() => []),
  } as unknown as InstallServer;
}

const MOCK_SNAPSHOT: Snapshot = {
  id: 'snap-abc',
  serverId: 'srv-1',
  operationId: 'op-1',
  files: [
    { path: '/etc/nginx/nginx.conf', content: 'worker_processes 1;', mode: 0o644, owner: 'root' },
    { path: '/etc/nginx/conf.d/default.conf', content: 'server { }', mode: 0o644, owner: 'root' },
  ],
  configs: [
    { type: 'nginx', path: '/etc/nginx/nginx.conf', content: 'worker_processes 1;' },
  ],
  createdAt: new Date().toISOString(),
  expiresAt: null,
};

function createMockSnapshotRepo(): SnapshotRepository {
  return {
    create: vi.fn(),
    getById: vi.fn(async () => ({ ...MOCK_SNAPSHOT })),
    listByServer: vi.fn(async () => ({ snapshots: [], total: 0 })),
    listByOperation: vi.fn(async () => []),
    delete: vi.fn(async () => true),
    getExpired: vi.fn(async () => []),
    deleteExpired: vi.fn(async () => 0),
  };
}

function createMockOperationRepo(): OperationRepository {
  return {
    create: vi.fn(),
    getById: vi.fn(),
    listByServer: vi.fn(),
    listByStatus: vi.fn(),
    markRunning: vi.fn(async () => true),
    markComplete: vi.fn(async () => true),
    updateOutput: vi.fn(async () => true),
  };
}

function makeRollbackRequest(
  overrides: Partial<RollbackRequest> = {},
): RollbackRequest {
  return {
    snapshotId: 'snap-abc',
    userId: 'user-1',
    clientId: 'client-1',
    reason: 'Test rollback',
    timeoutMs: 5000,
    ...overrides,
  };
}

async function flushMicrotasks(rounds = 5): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await Promise.resolve();
  }
}

// ============================================================================
// Test Setup
// ============================================================================

let server: InstallServer;
let snapshotRepo: SnapshotRepository;
let operationRepo: OperationRepository;
let service: RollbackService;

beforeEach(() => {
  server = createMockServer();
  snapshotRepo = createMockSnapshotRepo();
  operationRepo = createMockOperationRepo();
  service = new RollbackService(server, snapshotRepo, operationRepo);
});

afterEach(() => {
  service.shutdown();
  _resetRollbackService();
});

// ============================================================================
// Schema Validation
// ============================================================================

describe('RollbackRequestSchema', () => {
  it('should validate a correct input', () => {
    const result = RollbackRequestSchema.safeParse(makeRollbackRequest());
    expect(result.success).toBe(true);
  });

  it('should apply default reason', () => {
    const result = RollbackRequestSchema.safeParse({
      snapshotId: 'snap-1',
      userId: 'u-1',
      clientId: 'c-1',
      timeoutMs: 5000,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.reason).toBe('User-initiated rollback');
    }
  });

  it('should apply default timeoutMs', () => {
    const result = RollbackRequestSchema.safeParse({
      snapshotId: 'snap-1',
      userId: 'u-1',
      clientId: 'c-1',
      reason: 'test',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.timeoutMs).toBe(30_000);
    }
  });

  it('should reject empty snapshotId', () => {
    const result = RollbackRequestSchema.safeParse({
      snapshotId: '',
      userId: 'u-1',
      clientId: 'c-1',
    });
    expect(result.success).toBe(false);
  });

  it('should reject timeoutMs exceeding max', () => {
    const result = RollbackRequestSchema.safeParse({
      ...makeRollbackRequest(),
      timeoutMs: 200_000,
    });
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// Rollback - snapshot not found
// ============================================================================

describe('rollback — snapshot not found', () => {
  it('should return error when snapshot does not exist', async () => {
    vi.mocked(snapshotRepo.getById).mockResolvedValue(null);

    const result = await service.rollback(makeRollbackRequest());

    expect(result.success).toBe(false);
    expect(result.error).toBe('Snapshot not found or access denied');
    expect(server.send).not.toHaveBeenCalled();
  });

  it('should return error when snapshot has no files', async () => {
    vi.mocked(snapshotRepo.getById).mockResolvedValue({
      ...MOCK_SNAPSHOT,
      files: [],
    });

    const result = await service.rollback(makeRollbackRequest());

    expect(result.success).toBe(false);
    expect(result.error).toBe('Snapshot contains no files to restore');
  });
});

// ============================================================================
// Rollback - success flow
// ============================================================================

describe('rollback — success', () => {
  it('should send rollback request to agent and handle success response', async () => {
    const rollbackPromise = service.rollback(makeRollbackRequest());

    await flushMicrotasks();

    // Verify request was sent to the agent
    expect(server.send).toHaveBeenCalledOnce();
    const sentMsg = vi.mocked(server.send).mock.calls[0][1];
    expect(sentMsg.type).toBe(MessageType.ROLLBACK_REQUEST);

    const payload = sentMsg.payload as {
      rollbackRequestId: string;
      snapshotId: string;
      files: Array<{ path: string; content: string; mode: number; owner: string; existed: boolean }>;
      reason: string;
    };
    expect(payload.snapshotId).toBe('snap-abc');
    expect(payload.files).toHaveLength(2);
    expect(payload.files[0].path).toBe('/etc/nginx/nginx.conf');
    expect(payload.reason).toBe('Test rollback');

    // Simulate agent response
    await service.handleRollbackResponse({
      rollbackRequestId: payload.rollbackRequestId,
      success: true,
      fileResults: [
        { path: '/etc/nginx/nginx.conf', success: true },
        { path: '/etc/nginx/conf.d/default.conf', success: true },
      ],
    });

    const result = await rollbackPromise;
    expect(result.success).toBe(true);
    expect(result.restoredCount).toBe(2);
    expect(result.failedCount).toBe(0);
    expect(result.snapshotId).toBe('snap-abc');
  });

  it('should mark operation as rolled_back on success', async () => {
    const rollbackPromise = service.rollback(makeRollbackRequest());

    await flushMicrotasks();

    const sentMsg = vi.mocked(server.send).mock.calls[0][1];
    const payload = sentMsg.payload as { rollbackRequestId: string };

    await service.handleRollbackResponse({
      rollbackRequestId: payload.rollbackRequestId,
      success: true,
      fileResults: [
        { path: '/etc/nginx/nginx.conf', success: true },
      ],
    });

    const result = await rollbackPromise;
    expect(result.success).toBe(true);
    expect(result.operationId).toBe('op-1');

    expect(operationRepo.markComplete).toHaveBeenCalledWith(
      'op-1',
      'user-1',
      expect.stringContaining('Rolled back via snapshot snap-abc'),
      'rolled_back',
      0,
    );
  });

  it('should not mark operation if snapshot has no operationId', async () => {
    vi.mocked(snapshotRepo.getById).mockResolvedValue({
      ...MOCK_SNAPSHOT,
      operationId: null,
    });

    const rollbackPromise = service.rollback(makeRollbackRequest());

    await flushMicrotasks();

    const sentMsg = vi.mocked(server.send).mock.calls[0][1];
    const payload = sentMsg.payload as { rollbackRequestId: string };

    await service.handleRollbackResponse({
      rollbackRequestId: payload.rollbackRequestId,
      success: true,
      fileResults: [],
    });

    const result = await rollbackPromise;
    expect(result.success).toBe(true);
    expect(operationRepo.markComplete).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Rollback - partial failure
// ============================================================================

describe('rollback — partial failure', () => {
  it('should report partial failure with per-file results', async () => {
    const rollbackPromise = service.rollback(makeRollbackRequest());

    await flushMicrotasks();

    const sentMsg = vi.mocked(server.send).mock.calls[0][1];
    const payload = sentMsg.payload as { rollbackRequestId: string };

    await service.handleRollbackResponse({
      rollbackRequestId: payload.rollbackRequestId,
      success: false,
      fileResults: [
        { path: '/etc/nginx/nginx.conf', success: true },
        { path: '/etc/nginx/conf.d/default.conf', success: false, error: 'Permission denied' },
      ],
      error: 'Some files failed to restore',
    });

    const result = await rollbackPromise;
    expect(result.success).toBe(false);
    expect(result.restoredCount).toBe(1);
    expect(result.failedCount).toBe(1);
    expect(result.fileResults).toHaveLength(2);
    expect(result.fileResults[1].error).toBe('Permission denied');
  });
});

// ============================================================================
// Rollback - timeout
// ============================================================================

describe('rollback — timeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should timeout when agent does not respond', async () => {
    const rollbackPromise = service.rollback(
      makeRollbackRequest({ timeoutMs: 3000 }),
    );

    await flushMicrotasks();

    expect(server.send).toHaveBeenCalledOnce();

    // Advance past timeout
    vi.advanceTimersByTime(4000);

    const result = await rollbackPromise;
    expect(result.success).toBe(false);
    expect(result.error).toBe('Rollback request timed out');
    expect(result.restoredCount).toBe(0);
  });
});

// ============================================================================
// Rollback - send failure
// ============================================================================

describe('rollback — send failure', () => {
  it('should return error when send throws', async () => {
    vi.mocked(server.send).mockImplementation(() => {
      throw new Error('Connection closed');
    });

    const result = await service.rollback(makeRollbackRequest());

    expect(result.success).toBe(false);
    expect(result.error).toBe('Connection closed');
  });
});

// ============================================================================
// handleRollbackResponse - unmatched
// ============================================================================

describe('handleRollbackResponse', () => {
  it('should return false for unmatched rollback request IDs', async () => {
    const handled = await service.handleRollbackResponse({
      rollbackRequestId: 'unknown-id',
      success: true,
      fileResults: [],
    });
    expect(handled).toBe(false);
  });
});

// ============================================================================
// Lifecycle
// ============================================================================

describe('lifecycle', () => {
  it('should report pending count', async () => {
    expect(service.getPendingCount()).toBe(0);

    // Start a rollback (will be pending)
    const promise = service.rollback(makeRollbackRequest());
    await flushMicrotasks();

    expect(service.getPendingCount()).toBe(1);

    // Respond to clear it
    const sentMsg = vi.mocked(server.send).mock.calls[0][1];
    const payload = sentMsg.payload as { rollbackRequestId: string };
    await service.handleRollbackResponse({
      rollbackRequestId: payload.rollbackRequestId,
      success: true,
      fileResults: [],
    });

    await promise;
    expect(service.getPendingCount()).toBe(0);
  });

  it('should cancel pending requests on shutdown', async () => {
    const promise = service.rollback(makeRollbackRequest());
    await flushMicrotasks();

    service.shutdown();

    const result = await promise;
    expect(result.success).toBe(false);
    expect(result.error).toBe('Service shutting down');
  });
});
