/**
 * Tests for the SnapshotService.
 *
 * Validates pre-operation snapshot creation, agent communication,
 * timeout handling, file resolution, and config classification.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { MessageType } from '@aiinstaller/shared';

import {
  SnapshotService,
  CreateSnapshotRequestSchema,
  _resetSnapshotService,
  type CreateSnapshotRequest,
  type SnapshotResult,
} from './snapshot-service.js';
import type { InstallServer } from '../../api/server.js';
import type {
  SnapshotRepository,
  Snapshot,
  CreateSnapshotInput,
} from '../../db/repositories/snapshot-repository.js';

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
  } as unknown as InstallServer;
}

function createMockSnapshotRepo(): SnapshotRepository {
  return {
    create: vi.fn(async (input: CreateSnapshotInput): Promise<Snapshot> => ({
      id: 'snap-' + Math.random().toString(36).slice(2, 8),
      serverId: input.serverId,
      operationId: input.operationId ?? null,
      files: input.files,
      configs: input.configs,
      createdAt: new Date().toISOString(),
      expiresAt: input.expiresAt ? input.expiresAt.toISOString() : null,
    })),
    getById: vi.fn(async () => null),
    listByServer: vi.fn(async () => ({ snapshots: [], total: 0 })),
    listByOperation: vi.fn(async () => []),
    delete: vi.fn(async () => true),
    getExpired: vi.fn(async () => []),
    deleteExpired: vi.fn(async () => 0),
  };
}

function makeSnapshotRequest(
  overrides: Partial<CreateSnapshotRequest> = {},
): CreateSnapshotRequest {
  return {
    serverId: 'srv-1',
    userId: 'user-1',
    clientId: 'client-1',
    command: 'systemctl restart nginx',
    riskLevel: 'red',
    operationId: 'op-1',
    timeoutMs: 5000,
    expirationMs: 86400000,
    ...overrides,
  };
}

/** Wait for microtasks to flush */
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
let service: SnapshotService;

beforeEach(() => {
  server = createMockServer();
  snapshotRepo = createMockSnapshotRepo();
  service = new SnapshotService(server, snapshotRepo);
});

afterEach(() => {
  service.shutdown();
  _resetSnapshotService();
});

// ============================================================================
// Schema Validation
// ============================================================================

describe('CreateSnapshotRequestSchema', () => {
  it('should validate a correct input', () => {
    const result = CreateSnapshotRequestSchema.safeParse(makeSnapshotRequest());
    expect(result.success).toBe(true);
  });

  it('should reject empty serverId', () => {
    const result = CreateSnapshotRequestSchema.safeParse(
      makeSnapshotRequest({ serverId: '' }),
    );
    expect(result.success).toBe(false);
  });

  it('should reject invalid risk level', () => {
    const result = CreateSnapshotRequestSchema.safeParse(
      makeSnapshotRequest({ riskLevel: 'invalid' as 'green' }),
    );
    expect(result.success).toBe(false);
  });

  it('should apply default timeout', () => {
    const input = { ...makeSnapshotRequest(), timeoutMs: undefined };
    const result = CreateSnapshotRequestSchema.parse(input);
    expect(result.timeoutMs).toBe(15_000);
  });

  it('should apply default expiration', () => {
    const input = { ...makeSnapshotRequest(), expirationMs: undefined };
    const result = CreateSnapshotRequestSchema.parse(input);
    expect(result.expirationMs).toBe(7 * 24 * 60 * 60 * 1000);
  });
});

// ============================================================================
// requiresSnapshot
// ============================================================================

describe('requiresSnapshot', () => {
  it('should return false for green risk level', () => {
    expect(service.requiresSnapshot('green')).toBe(false);
  });

  it('should return true for yellow risk level', () => {
    expect(service.requiresSnapshot('yellow')).toBe(true);
  });

  it('should return true for red risk level', () => {
    expect(service.requiresSnapshot('red')).toBe(true);
  });

  it('should return true for critical risk level', () => {
    expect(service.requiresSnapshot('critical')).toBe(true);
  });
});

// ============================================================================
// createPreOperationSnapshot - skip for GREEN
// ============================================================================

describe('createPreOperationSnapshot - skip for green', () => {
  it('should skip snapshot for green risk level', async () => {
    const result = await service.createPreOperationSnapshot(
      makeSnapshotRequest({ riskLevel: 'green' }),
    );

    expect(result.success).toBe(true);
    expect(result.skipped).toBe(true);
    expect(result.snapshot).toBeNull();
    expect(server.send).not.toHaveBeenCalled();
  });
});

// ============================================================================
// createPreOperationSnapshot - send request to agent
// ============================================================================

describe('createPreOperationSnapshot - agent communication', () => {
  it('should send snapshot.request message to agent for nginx command', async () => {
    const promise = service.createPreOperationSnapshot(
      makeSnapshotRequest({ command: 'systemctl restart nginx' }),
    );

    await flushMicrotasks();

    const sendMock = server.send as ReturnType<typeof vi.fn>;
    expect(sendMock).toHaveBeenCalledTimes(1);

    const [clientId, message] = sendMock.mock.calls[0];
    expect(clientId).toBe('client-1');
    expect(message.type).toBe(MessageType.SNAPSHOT_REQUEST);
    expect(message.payload.snapshotRequestId).toBeTruthy();
    expect(message.payload.files).toContain('/etc/nginx/nginx.conf');
    expect(message.payload.label).toContain('systemctl restart nginx');

    // Respond to complete the promise
    await service.handleSnapshotResponse({
      snapshotRequestId: message.payload.snapshotRequestId,
      success: true,
      files: [
        {
          path: '/etc/nginx/nginx.conf',
          content: 'worker_processes auto;',
          mode: 0o644,
          owner: 'root',
          existed: true,
        },
      ],
    });

    const result = await promise;
    expect(result.success).toBe(true);
    expect(result.skipped).toBe(false);
    expect(result.snapshot).not.toBeNull();
  });

  it('should include mysql config files for mysql commands', async () => {
    const promise = service.createPreOperationSnapshot(
      makeSnapshotRequest({ command: 'systemctl restart mysql' }),
    );

    await flushMicrotasks();

    const sendMock = server.send as ReturnType<typeof vi.fn>;
    const message = sendMock.mock.calls[0][1];
    expect(message.payload.files).toContain('/etc/mysql/my.cnf');

    // Complete
    await service.handleSnapshotResponse({
      snapshotRequestId: message.payload.snapshotRequestId,
      success: true,
      files: [],
    });
    await promise;
  });

  it('should include redis config for redis commands', async () => {
    const promise = service.createPreOperationSnapshot(
      makeSnapshotRequest({ command: 'apt install redis-server' }),
    );

    await flushMicrotasks();

    const sendMock = server.send as ReturnType<typeof vi.fn>;
    const message = sendMock.mock.calls[0][1];
    expect(message.payload.files).toContain('/etc/redis/redis.conf');
    expect(message.payload.files).toContain('/etc/apt/sources.list');

    await service.handleSnapshotResponse({
      snapshotRequestId: message.payload.snapshotRequestId,
      success: true,
      files: [],
    });
    await promise;
  });

  it('should extract config file paths from the command', async () => {
    const promise = service.createPreOperationSnapshot(
      makeSnapshotRequest({ command: 'cp /etc/custom/app.conf /tmp/backup' }),
    );

    await flushMicrotasks();

    const sendMock = server.send as ReturnType<typeof vi.fn>;
    const message = sendMock.mock.calls[0][1];
    expect(message.payload.files).toContain('/etc/custom/app.conf');

    await service.handleSnapshotResponse({
      snapshotRequestId: message.payload.snapshotRequestId,
      success: true,
      files: [
        {
          path: '/etc/custom/app.conf',
          content: 'key=value',
          mode: 0o644,
          owner: 'root',
          existed: true,
        },
      ],
    });
    await promise;
  });

  it('should include additional files', async () => {
    const promise = service.createPreOperationSnapshot(
      makeSnapshotRequest({
        command: 'systemctl restart nginx',
        additionalFiles: ['/custom/path.conf'],
      }),
    );

    await flushMicrotasks();

    const sendMock = server.send as ReturnType<typeof vi.fn>;
    const message = sendMock.mock.calls[0][1];
    expect(message.payload.files).toContain('/custom/path.conf');
    expect(message.payload.files).toContain('/etc/nginx/nginx.conf');

    await service.handleSnapshotResponse({
      snapshotRequestId: message.payload.snapshotRequestId,
      success: true,
      files: [],
    });
    await promise;
  });
});

// ============================================================================
// handleSnapshotResponse - success
// ============================================================================

describe('handleSnapshotResponse - success', () => {
  it('should store snapshot in database on successful response', async () => {
    const promise = service.createPreOperationSnapshot(
      makeSnapshotRequest({ command: 'systemctl restart nginx' }),
    );

    await flushMicrotasks();

    const sendMock = server.send as ReturnType<typeof vi.fn>;
    const requestId = sendMock.mock.calls[0][1].payload.snapshotRequestId;

    await service.handleSnapshotResponse({
      snapshotRequestId: requestId,
      success: true,
      files: [
        {
          path: '/etc/nginx/nginx.conf',
          content: 'worker_processes auto;',
          mode: 0o644,
          owner: 'root',
          existed: true,
        },
      ],
    });

    const result = await promise;

    expect(result.success).toBe(true);
    expect(result.snapshot).not.toBeNull();
    expect(snapshotRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        serverId: 'srv-1',
        userId: 'user-1',
        operationId: 'op-1',
        files: expect.arrayContaining([
          expect.objectContaining({
            path: '/etc/nginx/nginx.conf',
            content: 'worker_processes auto;',
          }),
        ]),
      }),
    );
  });

  it('should exclude non-existent files from snapshot', async () => {
    const promise = service.createPreOperationSnapshot(
      makeSnapshotRequest({ command: 'systemctl restart nginx' }),
    );

    await flushMicrotasks();

    const sendMock = server.send as ReturnType<typeof vi.fn>;
    const requestId = sendMock.mock.calls[0][1].payload.snapshotRequestId;

    await service.handleSnapshotResponse({
      snapshotRequestId: requestId,
      success: true,
      files: [
        {
          path: '/etc/nginx/nginx.conf',
          content: 'worker_processes auto;',
          mode: 0o644,
          owner: 'root',
          existed: true,
        },
        {
          path: '/etc/nginx/conf.d/default.conf',
          existed: false,
        },
      ],
    });

    const result = await promise;

    expect(result.success).toBe(true);
    const createCall = (snapshotRepo.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(createCall.files).toHaveLength(1);
    expect(createCall.files[0].path).toBe('/etc/nginx/nginx.conf');
  });

  it('should classify config types correctly', async () => {
    const promise = service.createPreOperationSnapshot(
      makeSnapshotRequest({ command: 'systemctl restart nginx' }),
    );

    await flushMicrotasks();

    const sendMock = server.send as ReturnType<typeof vi.fn>;
    const requestId = sendMock.mock.calls[0][1].payload.snapshotRequestId;

    await service.handleSnapshotResponse({
      snapshotRequestId: requestId,
      success: true,
      files: [
        {
          path: '/etc/nginx/nginx.conf',
          content: 'worker_processes auto;',
          mode: 0o644,
          owner: 'root',
          existed: true,
        },
      ],
    });

    await promise;

    const createCall = (snapshotRepo.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(createCall.configs).toHaveLength(1);
    expect(createCall.configs[0].type).toBe('nginx');
    expect(createCall.configs[0].path).toBe('/etc/nginx/nginx.conf');
  });

  it('should set snapshot expiration', async () => {
    const expirationMs = 86400000;
    const promise = service.createPreOperationSnapshot(
      makeSnapshotRequest({
        command: 'systemctl restart nginx',
        expirationMs,
      }),
    );

    await flushMicrotasks();

    const sendMock = server.send as ReturnType<typeof vi.fn>;
    const requestId = sendMock.mock.calls[0][1].payload.snapshotRequestId;

    await service.handleSnapshotResponse({
      snapshotRequestId: requestId,
      success: true,
      files: [
        {
          path: '/etc/nginx/nginx.conf',
          content: 'conf',
          mode: 0o644,
          owner: 'root',
          existed: true,
        },
      ],
    });

    await promise;

    const createCall = (snapshotRepo.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(createCall.expiresAt).toBeInstanceOf(Date);
  });
});

// ============================================================================
// handleSnapshotResponse - failure
// ============================================================================

describe('handleSnapshotResponse - failure', () => {
  it('should return failure when agent reports error', async () => {
    const promise = service.createPreOperationSnapshot(
      makeSnapshotRequest({ command: 'systemctl restart nginx' }),
    );

    await flushMicrotasks();

    const sendMock = server.send as ReturnType<typeof vi.fn>;
    const requestId = sendMock.mock.calls[0][1].payload.snapshotRequestId;

    await service.handleSnapshotResponse({
      snapshotRequestId: requestId,
      success: false,
      files: [],
      error: 'Permission denied',
    });

    const result = await promise;

    expect(result.success).toBe(false);
    expect(result.snapshot).toBeNull();
    expect(result.error).toBe('Permission denied');
    expect(snapshotRepo.create).not.toHaveBeenCalled();
  });

  it('should return false for unknown snapshotRequestId', async () => {
    const handled = await service.handleSnapshotResponse({
      snapshotRequestId: 'unknown-id',
      success: true,
      files: [],
    });

    expect(handled).toBe(false);
  });

  it('should return failure when database save fails', async () => {
    (snapshotRepo.create as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('Database error'),
    );

    const promise = service.createPreOperationSnapshot(
      makeSnapshotRequest({ command: 'systemctl restart nginx' }),
    );

    await flushMicrotasks();

    const sendMock = server.send as ReturnType<typeof vi.fn>;
    const requestId = sendMock.mock.calls[0][1].payload.snapshotRequestId;

    await service.handleSnapshotResponse({
      snapshotRequestId: requestId,
      success: true,
      files: [
        {
          path: '/etc/nginx/nginx.conf',
          content: 'conf',
          mode: 0o644,
          owner: 'root',
          existed: true,
        },
      ],
    });

    const result = await promise;

    expect(result.success).toBe(false);
    expect(result.error).toBe('Database error');
  });
});

// ============================================================================
// Timeout
// ============================================================================

describe('timeout handling', () => {
  it('should return failure when snapshot request times out', async () => {
    vi.useFakeTimers();

    const promise = service.createPreOperationSnapshot(
      makeSnapshotRequest({
        command: 'systemctl restart nginx',
        timeoutMs: 2000,
      }),
    );

    await flushMicrotasks();

    vi.advanceTimersByTime(2100);

    const result = await promise;

    expect(result.success).toBe(false);
    expect(result.error).toBe('Snapshot request timed out');
    expect(result.skipped).toBe(false);

    vi.useRealTimers();
  });
});

// ============================================================================
// Send failure
// ============================================================================

describe('send failure', () => {
  it('should return failure when server.send throws', async () => {
    (server.send as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('Client disconnected');
    });

    const result = await service.createPreOperationSnapshot(
      makeSnapshotRequest({ command: 'systemctl restart nginx' }),
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe('Client disconnected');
  });
});

// ============================================================================
// Skip when no files identified
// ============================================================================

describe('no files identified', () => {
  it('should skip snapshot when command has no matching rules or file paths', async () => {
    const result = await service.createPreOperationSnapshot(
      makeSnapshotRequest({
        command: 'echo hello world',
        riskLevel: 'yellow',
      }),
    );

    expect(result.success).toBe(true);
    expect(result.skipped).toBe(true);
    expect(server.send).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Pending count & shutdown
// ============================================================================

describe('pending count and shutdown', () => {
  it('should track pending requests', async () => {
    expect(service.getPendingCount()).toBe(0);

    const promise = service.createPreOperationSnapshot(
      makeSnapshotRequest({ command: 'systemctl restart nginx' }),
    );

    await flushMicrotasks();
    expect(service.getPendingCount()).toBe(1);

    // Respond to clear
    const sendMock = server.send as ReturnType<typeof vi.fn>;
    const requestId = sendMock.mock.calls[0][1].payload.snapshotRequestId;

    await service.handleSnapshotResponse({
      snapshotRequestId: requestId,
      success: true,
      files: [],
    });

    await promise;
    expect(service.getPendingCount()).toBe(0);
  });

  it('should cancel all pending requests on shutdown', async () => {
    const promise = service.createPreOperationSnapshot(
      makeSnapshotRequest({ command: 'systemctl restart nginx' }),
    );

    await flushMicrotasks();
    expect(service.getPendingCount()).toBe(1);

    service.shutdown();

    const result = await promise;
    expect(result.success).toBe(false);
    expect(result.error).toBe('Service shutting down');
    expect(service.getPendingCount()).toBe(0);
  });
});
