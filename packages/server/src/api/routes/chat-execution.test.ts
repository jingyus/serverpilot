// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Unit tests for chat-execution.ts public helpers and stream abort behavior.
 *
 * Validates:
 * 1. Active execution tracking, including the edge case where
 *    executionId has not yet been assigned (empty string initial value).
 * 2. executePlanSteps aborts when SSE stream is closed by client.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { SSEStreamingApi } from 'hono/streaming';

// ============================================================================
// Module Mocks — must be before imports of the module under test
// ============================================================================

vi.mock('../../core/task/executor.js', () => {
  const mockExecutor = {
    executeCommand: vi.fn(async () => ({
      stdout: 'ok\n', stderr: '', exitCode: 0, success: true,
      operationId: 'op-1', duration: 100, error: null,
    })),
    addProgressListener: vi.fn(),
    removeProgressListener: vi.fn(),
  };
  return { getTaskExecutor: vi.fn(() => mockExecutor), _mockExecutor: mockExecutor };
});

vi.mock('../../core/session/manager.js', () => {
  const mockSessionMgr = {
    addMessage: vi.fn(async () => undefined),
    removePlan: vi.fn(),
  };
  return { getSessionManager: vi.fn(() => mockSessionMgr), _mockSessionMgr: mockSessionMgr };
});

vi.mock('../../core/security/audit-logger.js', () => {
  const mockAuditLogger = {
    log: vi.fn(async () => ({ id: 'audit-1' })),
    updateExecutionResult: vi.fn(async () => true),
  };
  return { getAuditLogger: vi.fn(() => mockAuditLogger), _mockAuditLogger: mockAuditLogger };
});

vi.mock('../../ai/error-diagnosis-service.js', () => ({
  autoDiagnoseStepFailure: vi.fn(async () => ({
    success: true, rootCause: 'test', fixSuggestions: [],
  })),
}));

vi.mock('./chat-ai.js', () => ({
  getChatAIAgent: vi.fn(() => null),
}));

vi.mock('../../core/security/command-validator.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../core/security/command-validator.js')>();
  return {
    ...original,
    validateCommand: vi.fn(original.validateCommand),
    validatePlan: vi.fn(original.validatePlan),
  };
});

import {
  getActiveExecution,
  hasActiveExecution,
  removeActiveExecution,
  _setActiveExecution,
  _resetActiveExecutions,
  executePlanSteps,
  STEP_DECISION_TIMEOUT_MS,
  resolveStepDecision,
  type StoredPlan,
  type ExecutePlanStepsOptions,
} from './chat-execution.js';
import { validateCommand } from '../../core/security/command-validator.js';

beforeEach(() => {
  _resetActiveExecutions();
  vi.clearAllMocks();
});

describe('getActiveExecution', () => {
  it('should return undefined when no execution is tracked', () => {
    expect(getActiveExecution('plan-1')).toBeUndefined();
  });

  it('should return the executionId when a real ID is set', () => {
    _setActiveExecution('plan-1', 'exec-abc');
    expect(getActiveExecution('plan-1')).toBe('exec-abc');
  });

  it('should return undefined when executionId is empty string', () => {
    _setActiveExecution('plan-1', '');
    expect(getActiveExecution('plan-1')).toBeUndefined();
  });
});

describe('hasActiveExecution', () => {
  it('should return false when no execution is tracked', () => {
    expect(hasActiveExecution('plan-1')).toBe(false);
  });

  it('should return true when a real executionId is set', () => {
    _setActiveExecution('plan-1', 'exec-abc');
    expect(hasActiveExecution('plan-1')).toBe(true);
  });

  it('should return true when executionId is empty string (just started)', () => {
    _setActiveExecution('plan-1', '');
    expect(hasActiveExecution('plan-1')).toBe(true);
  });
});

describe('removeActiveExecution', () => {
  it('should return false when no execution exists', () => {
    expect(removeActiveExecution('plan-1')).toBe(false);
  });

  it('should return true and remove the entry', () => {
    _setActiveExecution('plan-1', 'exec-abc');
    expect(removeActiveExecution('plan-1')).toBe(true);
    expect(hasActiveExecution('plan-1')).toBe(false);
  });

  it('should remove entry even with empty executionId', () => {
    _setActiveExecution('plan-1', '');
    expect(removeActiveExecution('plan-1')).toBe(true);
    expect(hasActiveExecution('plan-1')).toBe(false);
  });
});

// ============================================================================
// executePlanSteps — stream abort behavior
// ============================================================================

/**
 * Create a mock SSEStreamingApi with an onAbort trigger.
 *
 * If `simulateAbort()` is called before `onAbort()` registers, the callback
 * fires immediately on registration (matching Hono's behavior when the
 * underlying ReadableStream is already cancelled).
 */
function createMockStream() {
  let abortCallback: (() => void) | null = null;
  let preAborted = false;
  const sseEvents: Array<{ event?: string; data: string }> = [];

  const stream = {
    writeSSE: vi.fn(async (msg: { event?: string; data: string }) => {
      sseEvents.push(msg);
    }),
    onAbort: vi.fn((cb: () => void) => {
      abortCallback = cb;
      // If abort was requested before callback registered, fire immediately
      if (preAborted) cb();
    }),
    aborted: false,
  } as unknown as SSEStreamingApi;

  return {
    stream,
    sseEvents,
    simulateAbort: () => {
      preAborted = true;
      (stream as unknown as { aborted: boolean }).aborted = true;
      if (abortCallback) abortCallback();
    },
  };
}

function makeTestPlan(stepCount: number): StoredPlan {
  return {
    planId: 'plan-test',
    description: 'Test plan',
    steps: Array.from({ length: stepCount }, (_, i) => ({
      id: `step-${i + 1}`,
      description: `Step ${i + 1}`,
      command: `echo step${i + 1}`,
      riskLevel: 'green' as const,
      timeout: 5000,
      canRollback: false,
    })),
    totalRisk: 'green' as const,
    requiresConfirmation: false,
  };
}

function makeExecOpts(
  plan: StoredPlan,
  stream: SSEStreamingApi,
): ExecutePlanStepsOptions {
  return {
    plan,
    serverId: 'srv-1',
    userId: 'usr-1',
    sessionId: 'sess-1',
    clientId: 'client-1',
    stream,
    serverProfile: null,
    planId: plan.planId,
    mode: 'auto',
  };
}

describe('executePlanSteps — stream abort', () => {
  it('should register an onAbort handler on the stream', async () => {
    const { stream } = createMockStream();
    const plan = makeTestPlan(1);

    await executePlanSteps(makeExecOpts(plan, stream));

    expect(stream.onAbort).toHaveBeenCalledOnce();
  });

  it('should stop executing steps when aborted before first step', async () => {
    const { _mockExecutor } = await import('../../core/task/executor.js') as { _mockExecutor: { executeCommand: ReturnType<typeof vi.fn> } };

    const { stream, simulateAbort } = createMockStream();
    const plan = makeTestPlan(5);

    // Abort before calling executePlanSteps — simulates immediate disconnect
    simulateAbort();

    const result = await executePlanSteps(makeExecOpts(plan, stream));

    expect(result.cancelled).toBe(true);
    expect(result.success).toBe(false);
    // No steps should have been executed
    expect(_mockExecutor.executeCommand).not.toHaveBeenCalled();
  });

  it('should stop after first step when aborted during execution', async () => {
    const { _mockExecutor } = await import('../../core/task/executor.js') as { _mockExecutor: { executeCommand: ReturnType<typeof vi.fn> } };

    const { stream, simulateAbort } = createMockStream();
    const plan = makeTestPlan(5);

    // First step triggers abort synchronously during executeCommand
    let execCount = 0;
    _mockExecutor.executeCommand.mockImplementation(async () => {
      execCount++;
      if (execCount === 1) {
        // Abort during first step — before it returns
        simulateAbort();
      }
      return { stdout: 'ok\n', stderr: '', exitCode: 0, success: true, operationId: 'op-1', duration: 10, error: null };
    });

    const result = await executePlanSteps(makeExecOpts(plan, stream));

    expect(result.cancelled).toBe(true);
    expect(result.success).toBe(false);
    // Only the first step should execute; abort is detected before step 2
    expect(execCount).toBe(1);
  });

  it('should log audit entry for client disconnect abort', async () => {
    const { _mockAuditLogger } = await import('../../core/security/audit-logger.js') as { _mockAuditLogger: { log: ReturnType<typeof vi.fn> } };

    const { stream, simulateAbort } = createMockStream();
    const plan = makeTestPlan(3);

    // Abort immediately
    simulateAbort();

    await executePlanSteps(makeExecOpts(plan, stream));

    // Should have an audit log entry mentioning "client disconnected"
    const abortCall = _mockAuditLogger.log.mock.calls.find(
      (call: unknown[]) => typeof call[0] === 'object' && call[0] !== null &&
        typeof (call[0] as Record<string, unknown>).command === 'string' &&
        ((call[0] as Record<string, unknown>).command as string).includes('client disconnected'),
    );
    expect(abortCall).toBeDefined();
  });

  it('should skip post-execution AI summary when stream is aborted', async () => {
    const { getChatAIAgent } = await import('./chat-ai.js') as { getChatAIAgent: ReturnType<typeof vi.fn> };
    const { _mockExecutor } = await import('../../core/task/executor.js') as { _mockExecutor: { executeCommand: ReturnType<typeof vi.fn> } };

    const mockChat = vi.fn();
    getChatAIAgent.mockReturnValue({ chat: mockChat });

    const { stream, simulateAbort } = createMockStream();
    const plan = makeTestPlan(3);

    // Abort during first step
    _mockExecutor.executeCommand.mockImplementationOnce(async () => {
      simulateAbort();
      return { stdout: 'ok\n', stderr: '', exitCode: 0, success: true, operationId: 'op-1', duration: 10, error: null };
    });

    await executePlanSteps(makeExecOpts(plan, stream));

    // AI summary should NOT have been called since execution was aborted (cancelled=true)
    expect(mockChat).not.toHaveBeenCalled();
  });

  it('should skip final SSE complete event when stream is aborted', async () => {
    const { stream, sseEvents, simulateAbort } = createMockStream();
    const plan = makeTestPlan(2);

    // Abort before any step
    simulateAbort();

    await executePlanSteps(makeExecOpts(plan, stream));

    // Should NOT have a 'complete' event sent to the stream
    const completeEvent = sseEvents.find((e) => e.event === 'complete');
    expect(completeEvent).toBeUndefined();
  });

  it('should record session message mentioning client disconnected', async () => {
    const { _mockSessionMgr } = await import('../../core/session/manager.js') as { _mockSessionMgr: { addMessage: ReturnType<typeof vi.fn> } };

    const { stream, simulateAbort } = createMockStream();
    const plan = makeTestPlan(2);

    simulateAbort();
    await executePlanSteps(makeExecOpts(plan, stream));

    // Session message should mention "client disconnected"
    const addMsgCall = _mockSessionMgr.addMessage.mock.calls.find(
      (call: unknown[]) => typeof call[3] === 'string' && (call[3] as string).includes('client disconnected'),
    );
    expect(addMsgCall).toBeDefined();
  });

  it('should detect abort via progress listener writeSSE failure', async () => {
    const { _mockExecutor } = await import('../../core/task/executor.js') as {
      _mockExecutor: {
        executeCommand: ReturnType<typeof vi.fn>;
        addProgressListener: ReturnType<typeof vi.fn>;
      }
    };

    // Capture the progress listener
    let progressCb: ((execId: string, status: string, output?: string) => void) | null = null;
    _mockExecutor.addProgressListener.mockImplementation((_id: string, cb: (execId: string, status: string, output?: string) => void) => {
      progressCb = cb;
    });

    const { stream, sseEvents } = createMockStream();
    const plan = makeTestPlan(3);

    // Make writeSSE fail after initial writes (simulating stream closure)
    let writeCount = 0;
    (stream.writeSSE as ReturnType<typeof vi.fn>).mockImplementation(async (msg: { event?: string; data: string }) => {
      writeCount++;
      if (writeCount > 2) {
        throw new Error('stream closed');
      }
      sseEvents.push(msg);
    });

    // Executor calls progress during execution, then completes
    _mockExecutor.executeCommand.mockImplementation(async () => {
      // Trigger progress output — writeSSE in the progress listener will fail
      // and set streamAborted = true
      if (progressCb) progressCb('exec-1', 'running', 'output line');
      // Wait a tick for the catch in the progress listener to set the flag
      await new Promise((r) => setTimeout(r, 5));
      return { stdout: 'ok\n', stderr: '', exitCode: 0, success: true, operationId: 'op-1', duration: 10, error: null };
    });

    const result = await executePlanSteps(makeExecOpts(plan, stream));

    // Since writeSSE throws in the main flow too (after progress listener set
    // the flag), the step's remaining writes throw and are caught, causing abort
    expect(result.cancelled).toBe(true);
  });
});

// ============================================================================
// waitForStepDecision — timeout sends SSE event (chat-039)
// ============================================================================

describe('step_confirm timeout sends SSE event (chat-039)', () => {
  function makeYellowPlan(): StoredPlan {
    return {
      planId: 'plan-timeout',
      description: 'Timeout test plan',
      steps: [{
        id: 'step-1',
        description: 'Risky step',
        command: 'rm -rf /tmp/test',
        riskLevel: 'yellow' as const,
        timeout: 5000,
        canRollback: false,
      }],
      totalRisk: 'yellow' as const,
      requiresConfirmation: true,
    };
  }

  it('should include timeoutMs in step_confirm SSE event', async () => {
    const mockValidateCommand = vi.mocked(validateCommand);
    mockValidateCommand.mockReturnValue({
      action: 'requires_confirmation' as const,
      reasons: ['yellow risk command'],
      classification: {
        riskLevel: 'yellow' as const,
        reason: 'potential destructive command',
        command: 'rm -rf /tmp/test',
        type: 'system',
        matchedPattern: 'rm -rf',
      },
    });

    const { stream, sseEvents } = createMockStream();
    const plan = makeYellowPlan();
    const opts = makeExecOpts(plan, stream);
    opts.mode = 'step_confirm';

    // Resolve the decision immediately so the test doesn't hang
    const execPromise = executePlanSteps(opts);
    // Wait for the step_confirm event to be written
    await new Promise((r) => setTimeout(r, 50));
    resolveStepDecision('plan-timeout', 'step-1', 'allow');
    await execPromise;

    const confirmEvent = sseEvents.find((e) => e.event === 'step_confirm');
    expect(confirmEvent).toBeDefined();
    const parsed = JSON.parse(confirmEvent!.data);
    expect(parsed.timeoutMs).toBe(STEP_DECISION_TIMEOUT_MS);
    expect(parsed.stepId).toBe('step-1');
  });

  it('should send step_decision_timeout SSE event on timeout and auto-reject', async () => {
    vi.useFakeTimers();

    const mockValidateCommand = vi.mocked(validateCommand);
    mockValidateCommand.mockReturnValue({
      action: 'requires_confirmation' as const,
      reasons: ['yellow risk command'],
      classification: {
        riskLevel: 'yellow' as const,
        reason: 'potential destructive command',
        command: 'rm -rf /tmp/test',
        type: 'system',
        matchedPattern: 'rm -rf',
      },
    });

    const { stream, sseEvents } = createMockStream();
    const plan = makeYellowPlan();
    const opts = makeExecOpts(plan, stream);
    opts.mode = 'step_confirm';

    const execPromise = executePlanSteps(opts);

    // Advance time past the timeout
    await vi.advanceTimersByTimeAsync(STEP_DECISION_TIMEOUT_MS + 100);

    const result = await execPromise;

    // Should have sent the timeout event
    const timeoutEvent = sseEvents.find((e) => e.event === 'step_decision_timeout');
    expect(timeoutEvent).toBeDefined();
    const parsed = JSON.parse(timeoutEvent!.data);
    expect(parsed.stepId).toBe('step-1');
    expect(parsed.timeoutMs).toBe(STEP_DECISION_TIMEOUT_MS);

    // Should have auto-rejected
    expect(result.cancelled).toBe(true);
    expect(result.success).toBe(false);

    vi.useRealTimers();
  });

  it('should NOT send step_decision_timeout when user decides before timeout', async () => {
    const mockValidateCommand = vi.mocked(validateCommand);
    mockValidateCommand.mockReturnValue({
      action: 'requires_confirmation' as const,
      reasons: ['yellow risk command'],
      classification: {
        riskLevel: 'yellow' as const,
        reason: 'potential destructive command',
        command: 'rm -rf /tmp/test',
        type: 'system',
        matchedPattern: 'rm -rf',
      },
    });

    const { stream, sseEvents } = createMockStream();
    const plan = makeYellowPlan();
    const opts = makeExecOpts(plan, stream);
    opts.mode = 'step_confirm';

    const execPromise = executePlanSteps(opts);
    // Resolve quickly before timeout
    await new Promise((r) => setTimeout(r, 50));
    resolveStepDecision('plan-timeout', 'step-1', 'reject');
    await execPromise;

    const timeoutEvent = sseEvents.find((e) => e.event === 'step_decision_timeout');
    expect(timeoutEvent).toBeUndefined();
  });
});
