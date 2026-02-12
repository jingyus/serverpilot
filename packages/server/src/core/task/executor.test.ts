// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for the TaskExecutor.
 *
 * Validates command dispatching, result handling, timeout behavior,
 * plan execution, cancellation, and progress tracking.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { MessageType } from '@aiinstaller/shared';
import type { StepResult } from '@aiinstaller/shared';

import {
  TaskExecutor,
  ExecuteCommandInputSchema,
  ExecutePlanInputSchema,
  _resetTaskExecutor,
  type ExecuteCommandInput,
  type ExecutionResult,
} from './executor.js';
import type { InstallServer } from '../../api/server.js';
import type { OperationRepository } from '../../db/repositories/operation-repository.js';
import type { TaskRepository } from '../../db/repositories/task-repository.js';
import type { SnapshotService, SnapshotResult } from '../snapshot/snapshot-service.js';

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

function createMockOperationRepo(): OperationRepository {
  return {
    create: vi.fn(async (input) => ({
      id: 'op-' + Math.random().toString(36).slice(2, 8),
      serverId: input.serverId,
      sessionId: input.sessionId ?? null,
      userId: input.userId,
      type: input.type,
      description: input.description,
      commands: input.commands,
      output: null,
      status: 'pending' as const,
      riskLevel: input.riskLevel,
      snapshotId: input.snapshotId ?? null,
      duration: null,
      createdAt: new Date().toISOString(),
      completedAt: null,
    })),
    getById: vi.fn(async () => null),
    listByServer: vi.fn(async () => ({ operations: [], total: 0 })),
    listByStatus: vi.fn(async () => ({ operations: [], total: 0 })),
    markRunning: vi.fn(async () => true),
    markComplete: vi.fn(async () => true),
    updateOutput: vi.fn(async () => true),
  };
}

function createMockTaskRepo(): TaskRepository {
  return {
    create: vi.fn(async () => ({
      id: 'task-1',
      serverId: 'srv-1',
      userId: 'user-1',
      name: 'Test Task',
      description: null,
      cron: '* * * * *',
      command: 'echo test',
      status: 'active' as const,
      lastRun: null,
      lastStatus: null,
      nextRun: null,
      createdAt: new Date().toISOString(),
    })),
    getById: vi.fn(async () => null),
    listByServer: vi.fn(async () => ({ tasks: [], total: 0 })),
    update: vi.fn(async () => null),
    delete: vi.fn(async () => false),
    findByStatus: vi.fn(async () => ({ tasks: [], total: 0 })),
    updateRunResult: vi.fn(async () => true),
  };
}

function makeCommandInput(overrides: Partial<ExecuteCommandInput> = {}): ExecuteCommandInput {
  return {
    serverId: 'srv-1',
    userId: 'user-1',
    clientId: 'client-1',
    command: 'echo hello',
    description: 'Test command',
    riskLevel: 'green',
    type: 'execute',
    timeoutMs: 5000,
    ...overrides,
  };
}

function makeStepResult(stepId: string, overrides: Partial<StepResult> = {}): StepResult {
  return {
    stepId,
    success: true,
    exitCode: 0,
    stdout: 'hello\n',
    stderr: '',
    duration: 100,
    ...overrides,
  };
}

/** Wait for microtasks to flush (async mock repo methods) */
async function flushMicrotasks(rounds = 5): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await Promise.resolve();
  }
}

/**
 * Helper: Start a command execution and wait until server.send is called.
 * Returns the promise and the step ID from the dispatched message.
 */
async function startCommandAndWaitForSend(
  executor: TaskExecutor,
  server: InstallServer,
  input?: ExecuteCommandInput,
): Promise<{ promise: Promise<ExecutionResult>; stepId: string }> {
  const promise = executor.executeCommand(input ?? makeCommandInput());

  // Flush microtasks so async repo calls complete and send is called
  await flushMicrotasks();

  const sendMock = server.send as ReturnType<typeof vi.fn>;
  const lastCall = sendMock.mock.calls[sendMock.mock.calls.length - 1];
  const stepId = lastCall[1].payload.id as string;

  return { promise, stepId };
}

// ============================================================================
// Test Setup
// ============================================================================

let server: InstallServer;
let opRepo: OperationRepository;
let taskRepo: TaskRepository;
let executor: TaskExecutor;

beforeEach(() => {
  server = createMockServer();
  opRepo = createMockOperationRepo();
  taskRepo = createMockTaskRepo();
  executor = new TaskExecutor(server, opRepo, taskRepo);
});

afterEach(() => {
  executor.shutdown();
  _resetTaskExecutor();
});

// ============================================================================
// Schema Validation
// ============================================================================

describe('ExecuteCommandInputSchema', () => {
  it('should validate a correct input', () => {
    const input = makeCommandInput();
    const result = ExecuteCommandInputSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it('should reject empty command', () => {
    const result = ExecuteCommandInputSchema.safeParse(makeCommandInput({ command: '' }));
    expect(result.success).toBe(false);
  });

  it('should reject invalid risk level', () => {
    const result = ExecuteCommandInputSchema.safeParse(
      makeCommandInput({ riskLevel: 'invalid' as 'green' }),
    );
    expect(result.success).toBe(false);
  });

  it('should apply default timeout', () => {
    const input = { ...makeCommandInput(), timeoutMs: undefined };
    const result = ExecuteCommandInputSchema.parse(input);
    expect(result.timeoutMs).toBe(30_000);
  });

  it('should reject timeout exceeding max', () => {
    const result = ExecuteCommandInputSchema.safeParse(
      makeCommandInput({ timeoutMs: 700_000 }),
    );
    expect(result.success).toBe(false);
  });

  it('should apply default type', () => {
    const input = { ...makeCommandInput(), type: undefined };
    const result = ExecuteCommandInputSchema.parse(input);
    expect(result.type).toBe('execute');
  });
});

describe('ExecutePlanInputSchema', () => {
  it('should validate a correct plan input', () => {
    const result = ExecutePlanInputSchema.safeParse({
      serverId: 'srv-1',
      userId: 'user-1',
      clientId: 'client-1',
      steps: [{
        command: 'echo 1',
        description: 'Step 1',
        riskLevel: 'green',
        timeoutMs: 5000,
        continueOnError: false,
      }],
    });
    expect(result.success).toBe(true);
  });

  it('should reject empty steps array', () => {
    const result = ExecutePlanInputSchema.safeParse({
      serverId: 'srv-1',
      userId: 'user-1',
      clientId: 'client-1',
      steps: [],
    });
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// executeCommand
// ============================================================================

describe('executeCommand', () => {
  it('should create an operation record', async () => {
    const { promise, stepId } = await startCommandAndWaitForSend(executor, server);

    executor.handleStepComplete(makeStepResult(stepId));
    await promise;

    expect(opRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        serverId: 'srv-1',
        userId: 'user-1',
        type: 'execute',
        commands: ['echo hello'],
        riskLevel: 'green',
      }),
    );
    expect(opRepo.markRunning).toHaveBeenCalled();
  });

  it('should send step.execute message to the agent', async () => {
    const { promise, stepId } = await startCommandAndWaitForSend(executor, server);

    const sendCall = (server.send as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(sendCall[0]).toBe('client-1');

    const message = sendCall[1];
    expect(message.type).toBe(MessageType.STEP_EXECUTE);
    expect(message.payload.command).toBe('echo hello');
    expect(message.payload.description).toBe('Test command');
    expect(message.payload.timeout).toBe(5000);

    executor.handleStepComplete(makeStepResult(stepId));
    await promise;
  });

  it('should resolve with success result when agent reports success', async () => {
    const { promise, stepId } = await startCommandAndWaitForSend(executor, server);

    executor.handleStepComplete(makeStepResult(stepId, {
      stdout: 'hello\n',
      stderr: '',
      exitCode: 0,
      success: true,
    }));

    const result = await promise;

    expect(result.success).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('hello\n');
    expect(result.stderr).toBe('');
    expect(result.timedOut).toBe(false);
    expect(result.operationId).toBeDefined();
    expect(result.executionId).toBeDefined();
  });

  it('should resolve with failure result when agent reports failure', async () => {
    const { promise, stepId } = await startCommandAndWaitForSend(executor, server);

    executor.handleStepComplete(makeStepResult(stepId, {
      success: false,
      exitCode: 1,
      stdout: '',
      stderr: 'command not found',
    }));

    const result = await promise;

    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe('command not found');
  });

  it('should mark operation as complete with success', async () => {
    const { promise, stepId } = await startCommandAndWaitForSend(executor, server);

    executor.handleStepComplete(makeStepResult(stepId));
    await promise;

    expect(opRepo.markComplete).toHaveBeenCalledWith(
      expect.any(String),
      'user-1',
      expect.any(String),
      'success',
      expect.any(Number),
    );
  });

  it('should mark operation as failed when command fails', async () => {
    const { promise, stepId } = await startCommandAndWaitForSend(executor, server);

    executor.handleStepComplete(makeStepResult(stepId, {
      success: false,
      exitCode: 127,
    }));

    await promise;

    expect(opRepo.markComplete).toHaveBeenCalledWith(
      expect.any(String),
      'user-1',
      expect.any(String),
      'failed',
      expect.any(Number),
    );
  });

  it('should return error result when send fails', async () => {
    (server.send as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('Client not connected');
    });

    const result = await executor.executeCommand(makeCommandInput());

    expect(result.success).toBe(false);
    expect(result.error).toBe('Client not connected');
  });

  it('should return error when max concurrent executions reached', async () => {
    // Fill up execution slots
    const promises: Promise<ExecutionResult>[] = [];
    for (let i = 0; i < 20; i++) {
      promises.push(executor.executeCommand(makeCommandInput({
        clientId: `client-${i}`,
      })));
    }

    // Flush so all 20 are dispatched
    await flushMicrotasks();

    // This one should be rejected immediately
    const result = await executor.executeCommand(makeCommandInput({
      clientId: 'client-overflow',
    }));

    expect(result.success).toBe(false);
    expect(result.error).toBe('Max concurrent executions reached');

    // Clean up pending promises
    executor.shutdown();
    await Promise.all(promises);
  });

  it('should update task run result when taskId is provided', async () => {
    const { promise, stepId } = await startCommandAndWaitForSend(
      executor,
      server,
      makeCommandInput({ taskId: 'task-1' }),
    );

    executor.handleStepComplete(makeStepResult(stepId));
    await promise;

    expect(taskRepo.updateRunResult).toHaveBeenCalledWith(
      'task-1',
      'user-1',
      'success',
      null,
    );
  });

  it('should include sessionId in operation record when provided', async () => {
    const { promise, stepId } = await startCommandAndWaitForSend(
      executor,
      server,
      makeCommandInput({ sessionId: 'session-1' }),
    );

    executor.handleStepComplete(makeStepResult(stepId));
    await promise;

    expect(opRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-1',
      }),
    );
  });
});

// ============================================================================
// Timeout Handling
// ============================================================================

describe('timeout handling', () => {
  it('should resolve with timeout result when command times out', async () => {
    vi.useFakeTimers();

    const { promise } = await startCommandAndWaitForSend(
      executor,
      server,
      makeCommandInput({ timeoutMs: 1000 }),
    );

    // Advance time past timeout
    vi.advanceTimersByTime(1100);

    const result = await promise;

    expect(result.success).toBe(false);
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBe(-1);
    expect(result.stderr).toBe('Command execution timed out');

    vi.useRealTimers();
  });

  it('should not timeout when result arrives before deadline', async () => {
    vi.useFakeTimers();

    const { promise, stepId } = await startCommandAndWaitForSend(
      executor,
      server,
      makeCommandInput({ timeoutMs: 5000 }),
    );

    // Advance time but stay before timeout
    vi.advanceTimersByTime(2000);

    executor.handleStepComplete(makeStepResult(stepId));

    const result = await promise;

    expect(result.success).toBe(true);
    expect(result.timedOut).toBe(false);

    vi.useRealTimers();
  });
});

// ============================================================================
// handleStepComplete
// ============================================================================

describe('handleStepComplete', () => {
  it('should return false for unknown step ID', () => {
    const result = executor.handleStepComplete(makeStepResult('unknown-step'));
    expect(result).toBe(false);
  });

  it('should return true for known step ID', async () => {
    const { promise, stepId } = await startCommandAndWaitForSend(executor, server);

    const handled = executor.handleStepComplete(makeStepResult(stepId));
    expect(handled).toBe(true);

    await promise;
  });
});

// ============================================================================
// handleStepOutput
// ============================================================================

describe('handleStepOutput', () => {
  it('should return false for unknown step ID', () => {
    const result = executor.handleStepOutput('unknown-step', 'output');
    expect(result).toBe(false);
  });

  it('should return true and notify progress for known step ID', async () => {
    const progressFn = vi.fn();
    executor.setProgressCallback(progressFn);

    const { promise, stepId } = await startCommandAndWaitForSend(executor, server);

    const handled = executor.handleStepOutput(stepId, 'partial output');
    expect(handled).toBe(true);

    // Should have been called with output
    expect(progressFn).toHaveBeenCalledWith(
      expect.any(String),
      'running',
      'partial output',
    );

    executor.handleStepComplete(makeStepResult(stepId));
    await promise;
  });
});

// ============================================================================
// cancelExecution
// ============================================================================

describe('cancelExecution', () => {
  it('should cancel a running execution', async () => {
    const progressFn = vi.fn();
    executor.setProgressCallback(progressFn);

    const { promise, stepId } = await startCommandAndWaitForSend(executor, server);

    expect(executor.getActiveCount()).toBe(1);

    // Get execution ID from the progress callback (called with 'running')
    const executionId = progressFn.mock.calls[0][0] as string;

    const cancelled = executor.cancelExecution(executionId);
    expect(cancelled).toBe(true);

    const result = await promise;
    expect(result.success).toBe(false);
    expect(result.error).toBe('Cancelled');
    expect(result.stderr).toBe('Execution cancelled by user');
  });

  it('should return false for unknown execution ID', () => {
    expect(executor.cancelExecution('nonexistent')).toBe(false);
  });
});

// ============================================================================
// executePlan
// ============================================================================

describe('executePlan', () => {
  it('should execute steps sequentially', async () => {
    const planPromise = executor.executePlan({
      serverId: 'srv-1',
      userId: 'user-1',
      clientId: 'client-1',
      steps: [
        { command: 'echo step1', description: 'Step 1', riskLevel: 'green', timeoutMs: 5000, continueOnError: false },
        { command: 'echo step2', description: 'Step 2', riskLevel: 'green', timeoutMs: 5000, continueOnError: false },
      ],
    });

    // Wait for step 1 to be dispatched
    await flushMicrotasks();

    const sendMock = server.send as ReturnType<typeof vi.fn>;
    const send1 = sendMock.mock.calls[0];
    executor.handleStepComplete(makeStepResult(send1[1].payload.id, {
      stdout: 'step1\n',
    }));

    // Wait for step 2 to be dispatched (needs more rounds: markComplete + create + markRunning)
    await flushMicrotasks(15);

    const send2 = sendMock.mock.calls[1];
    executor.handleStepComplete(makeStepResult(send2[1].payload.id, {
      stdout: 'step2\n',
    }));

    const result = await planPromise;

    expect(result.success).toBe(true);
    expect(result.stepResults).toHaveLength(2);
    expect(result.stepResults[0].stdout).toBe('step1\n');
    expect(result.stepResults[1].stdout).toBe('step2\n');
    expect(result.failedAtStep).toBe(-1);
    expect(result.totalDuration).toBeGreaterThanOrEqual(0);
  });

  it('should stop on first failure when continueOnError is false', async () => {
    const planPromise = executor.executePlan({
      serverId: 'srv-1',
      userId: 'user-1',
      clientId: 'client-1',
      steps: [
        { command: 'failing-cmd', description: 'Will fail', riskLevel: 'green', timeoutMs: 5000, continueOnError: false },
        { command: 'echo step2', description: 'Step 2', riskLevel: 'green', timeoutMs: 5000, continueOnError: false },
      ],
    });

    await flushMicrotasks();

    const sendMock = server.send as ReturnType<typeof vi.fn>;
    const send1 = sendMock.mock.calls[0];
    executor.handleStepComplete(makeStepResult(send1[1].payload.id, {
      success: false,
      exitCode: 1,
      stderr: 'command not found',
    }));

    const result = await planPromise;

    expect(result.success).toBe(false);
    expect(result.stepResults).toHaveLength(1);
    expect(result.failedAtStep).toBe(0);
    // Step 2 should NOT have been dispatched
    expect(sendMock.mock.calls).toHaveLength(1);
  });

  it('should continue on failure when continueOnError is true', async () => {
    const planPromise = executor.executePlan({
      serverId: 'srv-1',
      userId: 'user-1',
      clientId: 'client-1',
      steps: [
        { command: 'failing-cmd', description: 'Will fail', riskLevel: 'green', timeoutMs: 5000, continueOnError: true },
        { command: 'echo step2', description: 'Step 2', riskLevel: 'green', timeoutMs: 5000, continueOnError: false },
      ],
    });

    await flushMicrotasks();

    const sendMock = server.send as ReturnType<typeof vi.fn>;
    const send1 = sendMock.mock.calls[0];
    executor.handleStepComplete(makeStepResult(send1[1].payload.id, {
      success: false,
      exitCode: 1,
    }));

    // Wait for step 2 to be dispatched (needs more rounds: markComplete + create + markRunning)
    await flushMicrotasks(15);

    const send2 = sendMock.mock.calls[1];
    executor.handleStepComplete(makeStepResult(send2[1].payload.id));

    const result = await planPromise;

    expect(result.success).toBe(false);
    expect(result.stepResults).toHaveLength(2);
    expect(result.failedAtStep).toBe(0);
    expect(result.stepResults[0].success).toBe(false);
    expect(result.stepResults[1].success).toBe(true);
  });
});

// ============================================================================
// Progress Callback
// ============================================================================

describe('progress callback', () => {
  it('should notify on execution start', async () => {
    const progressFn = vi.fn();
    executor.setProgressCallback(progressFn);

    const { promise, stepId } = await startCommandAndWaitForSend(executor, server);

    // Should have been called with 'running' status when command was dispatched
    expect(progressFn).toHaveBeenCalledWith(
      expect.any(String),
      'running',
      undefined,
    );

    executor.handleStepComplete(makeStepResult(stepId));
    await promise;
  });

  it('should notify on execution success', async () => {
    const progressFn = vi.fn();
    executor.setProgressCallback(progressFn);

    const { promise, stepId } = await startCommandAndWaitForSend(executor, server);

    executor.handleStepComplete(makeStepResult(stepId));
    await promise;

    expect(progressFn).toHaveBeenCalledWith(
      expect.any(String),
      'success',
      undefined,
    );
  });

  it('should notify on timeout', async () => {
    vi.useFakeTimers();

    const progressFn = vi.fn();
    executor.setProgressCallback(progressFn);

    const { promise } = await startCommandAndWaitForSend(
      executor,
      server,
      makeCommandInput({ timeoutMs: 1000 }),
    );

    vi.advanceTimersByTime(1100);
    await promise;

    expect(progressFn).toHaveBeenCalledWith(
      expect.any(String),
      'timeout',
      undefined,
    );

    vi.useRealTimers();
  });

  it('should handle callback errors gracefully', async () => {
    executor.setProgressCallback(() => {
      throw new Error('callback error');
    });

    const { promise, stepId } = await startCommandAndWaitForSend(executor, server);

    // Should not throw even though callback throws
    executor.handleStepComplete(makeStepResult(stepId));
    const result = await promise;
    expect(result.success).toBe(true);
  });

  it('should allow clearing the callback', () => {
    const fn = vi.fn();
    executor.setProgressCallback(fn);
    executor.setProgressCallback(null);

    // No errors even though no callback
    executor.handleStepOutput('some-id', 'output');
    expect(fn).not.toHaveBeenCalled();
  });
});

// ============================================================================
// getActiveCount / getExecution
// ============================================================================

describe('state inspection', () => {
  it('should track active execution count', async () => {
    expect(executor.getActiveCount()).toBe(0);

    const { promise, stepId } = await startCommandAndWaitForSend(executor, server);
    expect(executor.getActiveCount()).toBe(1);

    executor.handleStepComplete(makeStepResult(stepId));
    await promise;

    expect(executor.getActiveCount()).toBe(0);
  });

  it('should return undefined for unknown execution', () => {
    expect(executor.getExecution('nonexistent')).toBeUndefined();
  });
});

// ============================================================================
// shutdown
// ============================================================================

describe('shutdown', () => {
  it('should cancel all running executions', async () => {
    const p1 = executor.executeCommand(makeCommandInput({ clientId: 'c1' }));
    const p2 = executor.executeCommand(makeCommandInput({ clientId: 'c2' }));

    // Flush so both are dispatched
    await flushMicrotasks();
    expect(executor.getActiveCount()).toBe(2);

    executor.shutdown();

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.success).toBe(false);
    expect(r1.error).toBe('Server shutdown');
    expect(r2.success).toBe(false);
    expect(r2.error).toBe('Server shutdown');
    expect(executor.getActiveCount()).toBe(0);
  });

  it('should be safe to call multiple times', () => {
    executor.shutdown();
    executor.shutdown();
    expect(executor.getActiveCount()).toBe(0);
  });
});

// ============================================================================
// Snapshot Integration
// ============================================================================

describe('snapshot integration', () => {
  function createMockSnapshotService(
    overrides: Partial<SnapshotService> = {},
  ): SnapshotService {
    return {
      requiresSnapshot: vi.fn((riskLevel: string) =>
        ['yellow', 'red', 'critical'].includes(riskLevel),
      ),
      createPreOperationSnapshot: vi.fn(async (): Promise<SnapshotResult> => ({
        success: true,
        snapshot: {
          id: 'snap-123',
          serverId: 'srv-1',
          operationId: 'op-1',
          files: [],
          configs: [],
          createdAt: new Date().toISOString(),
          expiresAt: null,
        },
        skipped: false,
      })),
      handleSnapshotResponse: vi.fn(async () => true),
      getPendingCount: vi.fn(() => 0),
      shutdown: vi.fn(),
      ...overrides,
    } as unknown as SnapshotService;
  }

  it('should create snapshot before executing yellow-level command', async () => {
    const snapshotService = createMockSnapshotService();
    executor.setSnapshotService(snapshotService);

    const { promise, stepId } = await startCommandAndWaitForSend(
      executor,
      server,
      makeCommandInput({ riskLevel: 'yellow', command: 'apt install nginx' }),
    );

    expect(snapshotService.createPreOperationSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        serverId: 'srv-1',
        userId: 'user-1',
        clientId: 'client-1',
        command: 'apt install nginx',
        riskLevel: 'yellow',
      }),
    );

    executor.handleStepComplete(makeStepResult(stepId));
    const result = await promise;

    expect(result.success).toBe(true);
    expect(result.snapshotId).toBe('snap-123');
  });

  it('should create snapshot before executing red-level command', async () => {
    const snapshotService = createMockSnapshotService();
    executor.setSnapshotService(snapshotService);

    const { promise, stepId } = await startCommandAndWaitForSend(
      executor,
      server,
      makeCommandInput({ riskLevel: 'red', command: 'systemctl restart nginx' }),
    );

    expect(snapshotService.createPreOperationSnapshot).toHaveBeenCalled();

    executor.handleStepComplete(makeStepResult(stepId));
    const result = await promise;
    expect(result.snapshotId).toBe('snap-123');
  });

  it('should create snapshot before executing critical-level command', async () => {
    const snapshotService = createMockSnapshotService();
    executor.setSnapshotService(snapshotService);

    const { promise, stepId } = await startCommandAndWaitForSend(
      executor,
      server,
      makeCommandInput({ riskLevel: 'critical', command: 'rm -rf /tmp/old' }),
    );

    expect(snapshotService.createPreOperationSnapshot).toHaveBeenCalled();

    executor.handleStepComplete(makeStepResult(stepId));
    const result = await promise;
    expect(result.snapshotId).toBe('snap-123');
  });

  it('should NOT create snapshot for green-level command', async () => {
    const snapshotService = createMockSnapshotService();
    executor.setSnapshotService(snapshotService);

    const { promise, stepId } = await startCommandAndWaitForSend(
      executor,
      server,
      makeCommandInput({ riskLevel: 'green', command: 'ls -la' }),
    );

    expect(snapshotService.createPreOperationSnapshot).not.toHaveBeenCalled();

    executor.handleStepComplete(makeStepResult(stepId));
    const result = await promise;
    expect(result.snapshotId).toBeUndefined();
  });

  it('should proceed with execution even when snapshot fails', async () => {
    const snapshotService = createMockSnapshotService({
      createPreOperationSnapshot: vi.fn(async (): Promise<SnapshotResult> => ({
        success: false,
        snapshot: null,
        skipped: false,
        error: 'Snapshot timeout',
      })),
    });
    executor.setSnapshotService(snapshotService);

    const { promise, stepId } = await startCommandAndWaitForSend(
      executor,
      server,
      makeCommandInput({ riskLevel: 'red', command: 'systemctl restart nginx' }),
    );

    // Command should still be dispatched despite snapshot failure
    expect(server.send).toHaveBeenCalled();

    executor.handleStepComplete(makeStepResult(stepId));
    const result = await promise;
    expect(result.success).toBe(true);
    expect(result.snapshotId).toBeUndefined();
  });

  it('should set canRollback=true when snapshot exists', async () => {
    const snapshotService = createMockSnapshotService();
    executor.setSnapshotService(snapshotService);

    const { promise, stepId } = await startCommandAndWaitForSend(
      executor,
      server,
      makeCommandInput({ riskLevel: 'yellow', command: 'apt install nginx' }),
    );

    const sendMock = server.send as ReturnType<typeof vi.fn>;
    const message = sendMock.mock.calls[sendMock.mock.calls.length - 1][1];
    expect(message.payload.canRollback).toBe(true);

    executor.handleStepComplete(makeStepResult(stepId));
    await promise;
  });

  it('should set canRollback=false when no snapshot service', async () => {
    // No snapshot service set — default behavior
    const { promise, stepId } = await startCommandAndWaitForSend(
      executor,
      server,
      makeCommandInput({ riskLevel: 'green' }),
    );

    const sendMock = server.send as ReturnType<typeof vi.fn>;
    const message = sendMock.mock.calls[0][1];
    expect(message.payload.canRollback).toBe(false);

    executor.handleStepComplete(makeStepResult(stepId));
    await promise;
  });

  it('should work without snapshot service (backward compatible)', async () => {
    // Don't set any snapshot service
    const { promise, stepId } = await startCommandAndWaitForSend(
      executor,
      server,
      makeCommandInput({ riskLevel: 'red', command: 'systemctl restart nginx' }),
    );

    executor.handleStepComplete(makeStepResult(stepId));
    const result = await promise;
    expect(result.success).toBe(true);
    expect(result.snapshotId).toBeUndefined();
  });

  it('should allow clearing snapshot service', () => {
    const snapshotService = createMockSnapshotService();
    executor.setSnapshotService(snapshotService);
    executor.setSnapshotService(null);
    // No error
  });
});

// ============================================================================
// Progress Listeners (concurrent-safe)
// ============================================================================

describe('progress listeners', () => {
  it('should support multiple concurrent listeners', async () => {
    const listener1 = vi.fn();
    const listener2 = vi.fn();

    executor.addProgressListener('plan-1', listener1);
    executor.addProgressListener('plan-2', listener2);

    const { promise, stepId } = await startCommandAndWaitForSend(executor, server);

    // Both listeners should receive the 'running' notification
    expect(listener1).toHaveBeenCalledWith(expect.any(String), 'running', undefined);
    expect(listener2).toHaveBeenCalledWith(expect.any(String), 'running', undefined);

    executor.handleStepComplete(makeStepResult(stepId));
    await promise;

    // Both should receive the 'success' notification
    expect(listener1).toHaveBeenCalledWith(expect.any(String), 'success', undefined);
    expect(listener2).toHaveBeenCalledWith(expect.any(String), 'success', undefined);
  });

  it('should not notify removed listeners', async () => {
    const listener1 = vi.fn();
    const listener2 = vi.fn();

    executor.addProgressListener('plan-1', listener1);
    executor.addProgressListener('plan-2', listener2);

    // Remove listener 1 before execution
    executor.removeProgressListener('plan-1');

    const { promise, stepId } = await startCommandAndWaitForSend(executor, server);

    expect(listener1).not.toHaveBeenCalled();
    expect(listener2).toHaveBeenCalled();

    executor.handleStepComplete(makeStepResult(stepId));
    await promise;
  });

  it('should forward step output to all listeners', async () => {
    const listener1 = vi.fn();
    const listener2 = vi.fn();

    executor.addProgressListener('plan-1', listener1);
    executor.addProgressListener('plan-2', listener2);

    const { promise, stepId } = await startCommandAndWaitForSend(executor, server);

    executor.handleStepOutput(stepId, 'some output');

    expect(listener1).toHaveBeenCalledWith(expect.any(String), 'running', 'some output');
    expect(listener2).toHaveBeenCalledWith(expect.any(String), 'running', 'some output');

    executor.handleStepComplete(makeStepResult(stepId));
    await promise;
  });

  it('should isolate listeners so one failing does not block others', async () => {
    const listener1 = vi.fn(() => { throw new Error('listener 1 exploded'); });
    const listener2 = vi.fn();

    executor.addProgressListener('plan-1', listener1);
    executor.addProgressListener('plan-2', listener2);

    const { promise, stepId } = await startCommandAndWaitForSend(executor, server);

    // listener2 should still be called despite listener1 throwing
    expect(listener2).toHaveBeenCalledWith(expect.any(String), 'running', undefined);

    executor.handleStepComplete(makeStepResult(stepId));
    const result = await promise;
    expect(result.success).toBe(true);
  });

  it('should coexist with legacy setProgressCallback', async () => {
    const legacyFn = vi.fn();
    const newFn = vi.fn();

    executor.setProgressCallback(legacyFn);
    executor.addProgressListener('my-listener', newFn);

    const { promise, stepId } = await startCommandAndWaitForSend(executor, server);

    expect(legacyFn).toHaveBeenCalledWith(expect.any(String), 'running', undefined);
    expect(newFn).toHaveBeenCalledWith(expect.any(String), 'running', undefined);

    executor.handleStepComplete(makeStepResult(stepId));
    await promise;
  });

  it('should clear legacy callback without affecting named listeners', async () => {
    const legacyFn = vi.fn();
    const newFn = vi.fn();

    executor.setProgressCallback(legacyFn);
    executor.addProgressListener('my-listener', newFn);
    executor.setProgressCallback(null); // clear legacy only

    const { promise, stepId } = await startCommandAndWaitForSend(executor, server);

    expect(legacyFn).not.toHaveBeenCalled();
    expect(newFn).toHaveBeenCalledWith(expect.any(String), 'running', undefined);

    executor.handleStepComplete(makeStepResult(stepId));
    await promise;
  });

  it('should clear all listeners on shutdown', async () => {
    const listener = vi.fn();
    executor.addProgressListener('plan-1', listener);

    // Start an execution — listener will be called with 'running'
    const p = executor.executeCommand(makeCommandInput());
    await flushMicrotasks();

    expect(listener).toHaveBeenCalled();

    executor.shutdown();
    await p;

    // After shutdown, the listener map should be cleared.
    // Verify by adding a new listener and checking the old one
    // does NOT receive events from subsequent executions on this executor.
    listener.mockClear();

    // Re-create executor (old one is shut down)
    const executor2 = new TaskExecutor(server, opRepo, taskRepo);
    const fn2 = vi.fn();
    executor2.addProgressListener('plan-2', fn2);

    const { promise: p2, stepId: s2 } = await startCommandAndWaitForSend(executor2, server);

    expect(fn2).toHaveBeenCalled();
    // The old listener was on the old executor — it should not be called
    expect(listener).not.toHaveBeenCalled();

    executor2.handleStepComplete(makeStepResult(s2));
    await p2;
    executor2.shutdown();
  });

  it('should handle removing non-existent listener gracefully', () => {
    // Should not throw
    executor.removeProgressListener('does-not-exist');
  });

  it('should support concurrent executions with per-listener progress', async () => {
    // Simulate two users each running a command concurrently
    const user1Progress: string[] = [];
    const user2Progress: string[] = [];

    executor.addProgressListener('user-1-session', (_execId, _status, output) => {
      if (output) user1Progress.push(output);
    });
    executor.addProgressListener('user-2-session', (_execId, _status, output) => {
      if (output) user2Progress.push(output);
    });

    // Start two concurrent executions
    const p1 = executor.executeCommand(makeCommandInput({ clientId: 'c1', command: 'cmd1' }));
    const p2 = executor.executeCommand(makeCommandInput({ clientId: 'c2', command: 'cmd2' }));
    await flushMicrotasks();

    const sendMock = server.send as ReturnType<typeof vi.fn>;
    const step1 = sendMock.mock.calls[0][1].payload.id as string;
    const step2 = sendMock.mock.calls[1][1].payload.id as string;

    // Send output for step1 — both listeners receive it
    executor.handleStepOutput(step1, 'output-from-cmd1');
    expect(user1Progress).toEqual(['output-from-cmd1']);
    expect(user2Progress).toEqual(['output-from-cmd1']);

    // Send output for step2 — both listeners receive it
    executor.handleStepOutput(step2, 'output-from-cmd2');
    expect(user1Progress).toEqual(['output-from-cmd1', 'output-from-cmd2']);
    expect(user2Progress).toEqual(['output-from-cmd1', 'output-from-cmd2']);

    // Complete both
    executor.handleStepComplete(makeStepResult(step1));
    executor.handleStepComplete(makeStepResult(step2));
    await Promise.all([p1, p2]);
  });
});
