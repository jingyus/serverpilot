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
  getActiveExecutionCount,
  _setActiveExecution,
  _setActiveExecutionWithTime,
  _resetActiveExecutions,
  _setPendingDecision,
  _resetPendingDecisions,
  _hasPendingDecision,
  executePlanSteps,
  STEP_DECISION_TIMEOUT_MS,
  EXECUTION_TTL_MS,
  EXECUTION_SWEEP_INTERVAL_MS,
  sweepExpiredExecutions,
  startExecutionSweep,
  stopExecutionSweep,
  shutdownExecutionTracking,
  resolveStepDecision,
  type StoredPlan,
  type ExecutePlanStepsOptions,
} from './chat-execution.js';
import { validateCommand } from '../../core/security/command-validator.js';

/** Return a green 'allowed' validation for any command — used to reset validateCommand mock. */
function allowedValidation() {
  return {
    action: 'allowed' as const,
    reasons: [] as string[],
    classification: {
      riskLevel: 'green' as const,
      reason: 'safe command',
      command: 'echo test',
      type: 'system' as const,
      matchedPattern: '',
    },
  };
}

beforeEach(() => {
  _resetActiveExecutions();
  _resetPendingDecisions();
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

// ============================================================================
// resolveStepDecision — success path (chat-046)
// ============================================================================

describe('resolveStepDecision success path', () => {
  it('should resolve pending decision and return true', () => {
    let resolvedDecision: string | undefined;

    _setPendingDecision(
      'plan-x', 'step-1',
      (decision) => { resolvedDecision = decision; },
      setTimeout(() => {}, 60000),
    );

    const found = resolveStepDecision('plan-x', 'step-1', 'allow');
    expect(found).toBe(true);
    expect(resolvedDecision).toBe('allow');
    expect(_hasPendingDecision('plan-x', 'step-1')).toBe(false);
  });

  it('should clear the timeout when resolving', () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    const timer = setTimeout(() => {}, 60000);

    _setPendingDecision(
      'plan-y', 'step-2',
      () => {},
      timer,
    );

    resolveStepDecision('plan-y', 'step-2', 'allow_all');
    expect(clearTimeoutSpy).toHaveBeenCalledWith(timer);
    clearTimeoutSpy.mockRestore();
  });

  it('should return false when no pending decision exists', () => {
    const found = resolveStepDecision('no-plan', 'no-step', 'reject');
    expect(found).toBe(false);
  });

  it('should handle allow_all decision correctly', () => {
    let resolvedDecision: string | undefined;

    _setPendingDecision(
      'plan-z', 'step-3',
      (decision) => { resolvedDecision = decision; },
      setTimeout(() => {}, 60000),
    );

    resolveStepDecision('plan-z', 'step-3', 'allow_all');
    expect(resolvedDecision).toBe('allow_all');
  });

  it('should handle reject decision correctly', () => {
    let resolvedDecision: string | undefined;

    _setPendingDecision(
      'plan-w', 'step-4',
      (decision) => { resolvedDecision = decision; },
      setTimeout(() => {}, 60000),
    );

    resolveStepDecision('plan-w', 'step-4', 'reject');
    expect(resolvedDecision).toBe('reject');
  });
});

// ============================================================================
// executePlanSteps — blocked command path (chat-047)
// ============================================================================

describe('executePlanSteps — blocked command path', () => {
  it('should emit step_start, BLOCKED output, and step_complete for a blocked command', async () => {
    const mockValidateCommand = vi.mocked(validateCommand);
    mockValidateCommand.mockReturnValue({
      action: 'blocked' as const,
      reasons: ['forbidden command'],
      classification: {
        riskLevel: 'critical' as const,
        reason: 'Command is forbidden',
        command: 'rm -rf /',
        type: 'system',
        matchedPattern: 'rm -rf /',
      },
    });

    const { stream, sseEvents } = createMockStream();
    const plan: StoredPlan = {
      planId: 'plan-blocked',
      description: 'Blocked plan',
      steps: [
        { id: 'step-1', description: 'Dangerous step', command: 'rm -rf /', riskLevel: 'critical' as const, timeout: 5000, canRollback: false },
        { id: 'step-2', description: 'Next step', command: 'echo done', riskLevel: 'green' as const, timeout: 5000, canRollback: false },
      ],
      totalRisk: 'critical' as const,
      requiresConfirmation: true,
    };

    const result = await executePlanSteps(makeExecOpts(plan, stream));

    expect(result.success).toBe(false);
    expect(result.failedAtStep).toBe('step-1');

    // Verify SSE event sequence: step_start → output (BLOCKED) → step_complete
    const stepEvents = sseEvents.filter((e) => e.event === 'step_start' || e.event === 'output' || e.event === 'step_complete');
    expect(stepEvents.length).toBeGreaterThanOrEqual(3);

    const startEvt = sseEvents.find((e) => e.event === 'step_start');
    expect(startEvt).toBeDefined();
    expect(JSON.parse(startEvt!.data).stepId).toBe('step-1');

    const blockedOutput = sseEvents.find((e) => e.event === 'output' && e.data.includes('[BLOCKED]'));
    expect(blockedOutput).toBeDefined();
    expect(JSON.parse(blockedOutput!.data).content).toContain('Command is forbidden');

    const completeEvt = sseEvents.find((e) => e.event === 'step_complete');
    expect(completeEvt).toBeDefined();
    const completeData = JSON.parse(completeEvt!.data);
    expect(completeData.stepId).toBe('step-1');
    expect(completeData.exitCode).toBe(-1);
    expect(completeData.success).toBe(false);
    expect(completeData.blocked).toBe(true);
  });

  it('should break after blocked step — subsequent steps are not executed', async () => {
    const { _mockExecutor } = await import('../../core/task/executor.js') as { _mockExecutor: { executeCommand: ReturnType<typeof vi.fn> } };
    const mockValidateCommand = vi.mocked(validateCommand);
    mockValidateCommand.mockReturnValue({
      action: 'blocked' as const,
      reasons: ['forbidden'],
      classification: {
        riskLevel: 'critical' as const,
        reason: 'Forbidden',
        command: 'rm -rf /',
        type: 'system',
        matchedPattern: 'rm -rf /',
      },
    });

    const { stream } = createMockStream();
    const plan: StoredPlan = {
      planId: 'plan-blocked2',
      description: 'Blocked plan',
      steps: [
        { id: 'step-1', description: 'Blocked', command: 'rm -rf /', riskLevel: 'critical' as const, timeout: 5000, canRollback: false },
        { id: 'step-2', description: 'Never', command: 'echo never', riskLevel: 'green' as const, timeout: 5000, canRollback: false },
      ],
      totalRisk: 'critical' as const,
      requiresConfirmation: true,
    };

    await executePlanSteps(makeExecOpts(plan, stream));

    expect(_mockExecutor.executeCommand).not.toHaveBeenCalled();
  });
});

// ============================================================================
// executePlanSteps — step-confirm mode branches (chat-047)
// ============================================================================

describe('executePlanSteps — step-confirm mode', () => {
  function setupConfirmMocks(): void {
    const mockValidateCommand = vi.mocked(validateCommand);
    mockValidateCommand.mockReturnValue({
      action: 'requires_confirmation' as const,
      reasons: ['yellow risk'],
      classification: {
        riskLevel: 'yellow' as const,
        reason: 'requires confirmation',
        command: 'systemctl restart nginx',
        type: 'system',
        matchedPattern: 'systemctl restart',
      },
    });
  }

  function makeConfirmPlan(stepCount: number): StoredPlan {
    return {
      planId: 'plan-confirm',
      description: 'Confirm plan',
      steps: Array.from({ length: stepCount }, (_, i) => ({
        id: `step-${i + 1}`,
        description: `Risky step ${i + 1}`,
        command: `systemctl restart nginx${i + 1}`,
        riskLevel: 'yellow' as const,
        timeout: 5000,
        canRollback: false,
      })),
      totalRisk: 'yellow' as const,
      requiresConfirmation: true,
    };
  }

  it('should cancel execution when user rejects a step', async () => {
    setupConfirmMocks();

    const { stream, sseEvents } = createMockStream();
    const plan = makeConfirmPlan(2);
    const opts = makeExecOpts(plan, stream);
    opts.mode = 'step_confirm';

    const execPromise = executePlanSteps(opts);
    await new Promise((r) => setTimeout(r, 50));

    // User rejects the step
    resolveStepDecision('plan-confirm', 'step-1', 'reject');
    const result = await execPromise;

    expect(result.cancelled).toBe(true);
    expect(result.success).toBe(false);
    expect(result.failedAtStep).toBe('step-1');

    // Should have emitted step_confirm event
    const confirmEvent = sseEvents.find((e) => e.event === 'step_confirm');
    expect(confirmEvent).toBeDefined();
  });

  it('should allow individual step and continue to next step', async () => {
    const { _mockExecutor } = await import('../../core/task/executor.js') as { _mockExecutor: { executeCommand: ReturnType<typeof vi.fn> } };
    setupConfirmMocks();

    const { stream, sseEvents } = createMockStream();
    const plan = makeConfirmPlan(2);
    const opts = makeExecOpts(plan, stream);
    opts.mode = 'step_confirm';

    const execPromise = executePlanSteps(opts);

    // Allow step-1
    await new Promise((r) => setTimeout(r, 50));
    resolveStepDecision('plan-confirm', 'step-1', 'allow');

    // Step-2 should also pause for confirmation
    await new Promise((r) => setTimeout(r, 50));
    resolveStepDecision('plan-confirm', 'step-2', 'allow');

    const result = await execPromise;

    expect(result.success).toBe(true);
    expect(_mockExecutor.executeCommand).toHaveBeenCalledTimes(2);

    // Both step_confirm events should have been emitted
    const confirmEvents = sseEvents.filter((e) => e.event === 'step_confirm');
    expect(confirmEvents).toHaveLength(2);
  });

  it('should skip subsequent confirmations when user chooses allow_all', async () => {
    const { _mockExecutor } = await import('../../core/task/executor.js') as { _mockExecutor: { executeCommand: ReturnType<typeof vi.fn> } };
    setupConfirmMocks();

    const { stream, sseEvents } = createMockStream();
    const plan = makeConfirmPlan(3);
    const opts = makeExecOpts(plan, stream);
    opts.mode = 'step_confirm';

    const execPromise = executePlanSteps(opts);

    // allow_all on step-1 — steps 2 and 3 should execute without confirmation
    await new Promise((r) => setTimeout(r, 50));
    resolveStepDecision('plan-confirm', 'step-1', 'allow_all');

    const result = await execPromise;

    expect(result.success).toBe(true);
    expect(_mockExecutor.executeCommand).toHaveBeenCalledTimes(3);

    // Only one step_confirm event (step-1); steps 2 and 3 skip confirmation
    const confirmEvents = sseEvents.filter((e) => e.event === 'step_confirm');
    expect(confirmEvents).toHaveLength(1);
    expect(JSON.parse(confirmEvents[0].data).stepId).toBe('step-1');
  });

  it('should not pause for confirmation on green steps in step_confirm mode', async () => {
    const { _mockExecutor } = await import('../../core/task/executor.js') as { _mockExecutor: { executeCommand: ReturnType<typeof vi.fn> } };
    const mockValidateCommand = vi.mocked(validateCommand);

    // Return 'allowed' (green) for all steps
    mockValidateCommand.mockReturnValue({
      action: 'allowed' as const,
      reasons: [],
      classification: {
        riskLevel: 'green' as const,
        reason: 'safe command',
        command: 'echo test',
        type: 'system',
        matchedPattern: '',
      },
    });

    const { stream, sseEvents } = createMockStream();
    const plan = makeTestPlan(2);
    const opts = makeExecOpts(plan, stream);
    opts.mode = 'step_confirm';

    const result = await executePlanSteps(opts);

    expect(result.success).toBe(true);
    expect(_mockExecutor.executeCommand).toHaveBeenCalledTimes(2);

    // No step_confirm events for green steps
    const confirmEvents = sseEvents.filter((e) => e.event === 'step_confirm');
    expect(confirmEvents).toHaveLength(0);
  });
});

// ============================================================================
// executePlanSteps — AI summary generation (chat-047)
// ============================================================================

describe('executePlanSteps — AI summary generation', () => {
  beforeEach(() => {
    // Reset validateCommand to return 'allowed' so echo/test commands pass
    vi.mocked(validateCommand).mockReturnValue(allowedValidation());
  });

  it('should call AI agent for summary when steps complete successfully', async () => {
    const { getChatAIAgent } = await import('./chat-ai.js') as { getChatAIAgent: ReturnType<typeof vi.fn> };
    const mockChat = vi.fn(async (_msg: string, _ctx: string, _hist: string, callbacks?: { onToken?: (t: string) => Promise<void> }) => {
      if (callbacks?.onToken) {
        await callbacks.onToken('Summary');
      }
      return { text: 'Summary', plan: null };
    });
    getChatAIAgent.mockReturnValue({ chat: mockChat });

    const { stream, sseEvents } = createMockStream();
    const plan = makeTestPlan(1);

    await executePlanSteps(makeExecOpts(plan, stream));

    expect(mockChat).toHaveBeenCalledOnce();

    // Verify summary prompt mentions "successfully"
    const promptArg = mockChat.mock.calls[0][0] as string;
    expect(promptArg).toContain('executed successfully');

    // Verify AI summary tokens are streamed as 'message' events
    const messageEvents = sseEvents.filter((e) => e.event === 'message');
    expect(messageEvents.length).toBeGreaterThan(0);
    expect(JSON.parse(messageEvents[0].data).content).toBe('Summary');
  });

  it('should include failure context in summary prompt when steps fail', async () => {
    const { getChatAIAgent } = await import('./chat-ai.js') as { getChatAIAgent: ReturnType<typeof vi.fn> };
    const { _mockExecutor } = await import('../../core/task/executor.js') as { _mockExecutor: { executeCommand: ReturnType<typeof vi.fn> } };

    const mockChat = vi.fn(async () => ({ text: 'Failure summary', plan: null }));
    getChatAIAgent.mockReturnValue({ chat: mockChat });

    _mockExecutor.executeCommand.mockResolvedValueOnce({
      stdout: 'output', stderr: 'error msg', exitCode: 1, success: false,
      operationId: 'op-1', duration: 100, error: null, timedOut: false, executionId: 'exec-1',
    });

    const { stream } = createMockStream();
    const plan = makeTestPlan(1);

    await executePlanSteps(makeExecOpts(plan, stream));

    expect(mockChat).toHaveBeenCalledOnce();
    const promptArg = mockChat.mock.calls[0][0] as string;
    expect(promptArg).toContain('some failed');
    expect(promptArg).toContain('Exit code: 1');
  });

  it('should skip AI summary when cancelled', async () => {
    const { getChatAIAgent } = await import('./chat-ai.js') as { getChatAIAgent: ReturnType<typeof vi.fn> };
    const { _mockExecutor } = await import('../../core/task/executor.js') as { _mockExecutor: { executeCommand: ReturnType<typeof vi.fn> } };

    const mockChat = vi.fn(async () => ({ text: 'Summary', plan: null }));
    getChatAIAgent.mockReturnValue({ chat: mockChat });

    // Simulate cancellation via error='Cancelled'
    _mockExecutor.executeCommand.mockResolvedValueOnce({
      stdout: '', stderr: '', exitCode: 0, success: true,
      operationId: 'op-1', duration: 10, error: 'Cancelled',
      timedOut: false, executionId: 'exec-1',
    });

    const { stream } = createMockStream();
    const plan = makeTestPlan(1);

    await executePlanSteps(makeExecOpts(plan, stream));

    expect(mockChat).not.toHaveBeenCalled();
  });

  it('should skip AI summary when no steps completed', async () => {
    const { getChatAIAgent } = await import('./chat-ai.js') as { getChatAIAgent: ReturnType<typeof vi.fn> };
    const mockChat = vi.fn(async () => ({ text: 'Summary', plan: null }));
    getChatAIAgent.mockReturnValue({ chat: mockChat });

    // Blocked step → 0 completed steps
    vi.mocked(validateCommand).mockReturnValue({
      action: 'blocked' as const,
      reasons: ['forbidden'],
      classification: {
        riskLevel: 'critical' as const, reason: 'forbidden', command: 'rm -rf /',
        type: 'system', matchedPattern: 'rm -rf /',
      },
    });

    const { stream } = createMockStream();
    const plan: StoredPlan = {
      planId: 'plan-nosummary',
      description: 'No summary plan',
      steps: [{ id: 'step-1', description: 'Blocked', command: 'rm -rf /', riskLevel: 'critical' as const, timeout: 5000, canRollback: false }],
      totalRisk: 'critical' as const,
      requiresConfirmation: true,
    };

    await executePlanSteps(makeExecOpts(plan, stream));

    expect(mockChat).not.toHaveBeenCalled();
  });

  it('should gracefully handle AI summary errors', async () => {
    const { getChatAIAgent } = await import('./chat-ai.js') as { getChatAIAgent: ReturnType<typeof vi.fn> };
    getChatAIAgent.mockReturnValue({
      chat: vi.fn(async () => { throw new Error('AI unavailable'); }),
    });

    const { stream, sseEvents } = createMockStream();
    const plan = makeTestPlan(1);

    // Should not throw
    const result = await executePlanSteps(makeExecOpts(plan, stream));

    expect(result.success).toBe(true);
    // complete event should still be emitted
    const completeEvent = sseEvents.find((e) => e.event === 'complete');
    expect(completeEvent).toBeDefined();
  });

  it('should skip AI summary when getChatAIAgent returns null', async () => {
    const { getChatAIAgent } = await import('./chat-ai.js') as { getChatAIAgent: ReturnType<typeof vi.fn> };
    getChatAIAgent.mockReturnValue(null);

    const { stream, sseEvents } = createMockStream();
    const plan = makeTestPlan(1);

    const result = await executePlanSteps(makeExecOpts(plan, stream));

    expect(result.success).toBe(true);
    // No message events from AI summary
    const messageEvents = sseEvents.filter((e) => e.event === 'message');
    expect(messageEvents).toHaveLength(0);
  });
});

// ============================================================================
// executePlanSteps — auto-diagnosis SSE events (chat-047)
// ============================================================================

describe('executePlanSteps — auto-diagnosis on step failure', () => {
  beforeEach(() => {
    // Reset validateCommand to return 'allowed' so echo/test commands pass
    vi.mocked(validateCommand).mockReturnValue(allowedValidation());
  });

  it('should emit diagnosis SSE event when step fails with non-zero exit code', async () => {
    const { _mockExecutor } = await import('../../core/task/executor.js') as { _mockExecutor: { executeCommand: ReturnType<typeof vi.fn> } };
    const { autoDiagnoseStepFailure } = await import('../../ai/error-diagnosis-service.js') as { autoDiagnoseStepFailure: ReturnType<typeof vi.fn> };

    _mockExecutor.executeCommand.mockResolvedValueOnce({
      stdout: '', stderr: 'command not found', exitCode: 127, success: false,
      operationId: 'op-1', duration: 50, error: null, timedOut: false, executionId: 'exec-1',
    });

    autoDiagnoseStepFailure.mockResolvedValueOnce({
      success: true, errorType: 'command_not_found', rootCause: 'nginx not installed',
      explanation: 'The command was not found', severity: 'medium',
      fixSuggestions: [{ description: 'Install nginx', commands: ['apt install nginx'], confidence: 0.9, risk: 'low', requiresSudo: true }],
      usedRuleLibrary: true,
    });

    const { stream, sseEvents } = createMockStream();
    const plan = makeTestPlan(1);

    const result = await executePlanSteps(makeExecOpts(plan, stream));

    expect(result.success).toBe(false);
    expect(result.failedAtStep).toBe('step-1');

    // Verify diagnosis was called with correct parameters
    expect(autoDiagnoseStepFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        stepId: 'step-1',
        exitCode: 127,
        stderr: 'command not found',
        serverId: 'srv-1',
        previousSteps: [], // First step has no predecessors
      }),
    );

    // Verify diagnosis SSE event
    const diagEvent = sseEvents.find((e) => e.event === 'diagnosis');
    expect(diagEvent).toBeDefined();
    const diagData = JSON.parse(diagEvent!.data);
    expect(diagData.success).toBe(true);
    expect(diagData.rootCause).toBe('nginx not installed');
    expect(diagData.fixSuggestions).toHaveLength(1);
  });

  it('should store diagnosis in session when diagnosis succeeds', async () => {
    const { _mockExecutor } = await import('../../core/task/executor.js') as { _mockExecutor: { executeCommand: ReturnType<typeof vi.fn> } };
    const { _mockSessionMgr } = await import('../../core/session/manager.js') as { _mockSessionMgr: { addMessage: ReturnType<typeof vi.fn> } };
    const { autoDiagnoseStepFailure } = await import('../../ai/error-diagnosis-service.js') as { autoDiagnoseStepFailure: ReturnType<typeof vi.fn> };

    _mockExecutor.executeCommand.mockResolvedValueOnce({
      stdout: '', stderr: 'permission denied', exitCode: 1, success: false,
      operationId: 'op-1', duration: 50, error: null, timedOut: false, executionId: 'exec-1',
    });

    autoDiagnoseStepFailure.mockResolvedValueOnce({
      success: true, errorType: 'permission_error', rootCause: 'insufficient permissions',
      explanation: 'Need sudo', severity: 'medium',
      fixSuggestions: [{ description: 'Run with sudo', commands: ['sudo echo step1'], confidence: 0.8, risk: 'low', requiresSudo: true }],
      usedRuleLibrary: true,
    });

    const { stream } = createMockStream();
    const plan = makeTestPlan(1);

    await executePlanSteps(makeExecOpts(plan, stream));

    // Session message should include diagnosis info
    const diagCall = _mockSessionMgr.addMessage.mock.calls.find(
      (call: unknown[]) => typeof call[3] === 'string' && (call[3] as string).includes('Error diagnosis'),
    );
    expect(diagCall).toBeDefined();
    expect((diagCall![3] as string)).toContain('insufficient permissions');
    expect((diagCall![3] as string)).toContain('Suggested fix');
  });

  it('should emit diagnosis SSE event on exception (catch block)', async () => {
    const { _mockExecutor } = await import('../../core/task/executor.js') as { _mockExecutor: { executeCommand: ReturnType<typeof vi.fn> } };
    const { autoDiagnoseStepFailure } = await import('../../ai/error-diagnosis-service.js') as { autoDiagnoseStepFailure: ReturnType<typeof vi.fn> };

    // Executor throws instead of returning result
    _mockExecutor.executeCommand.mockRejectedValueOnce(new Error('Connection timeout'));

    autoDiagnoseStepFailure.mockResolvedValueOnce({
      success: true, errorType: 'connection_error', rootCause: 'Agent connection lost',
      explanation: 'Timeout', severity: 'high',
      fixSuggestions: [], usedRuleLibrary: false,
    });

    const { stream, sseEvents } = createMockStream();
    const plan = makeTestPlan(1);

    const result = await executePlanSteps(makeExecOpts(plan, stream));

    expect(result.success).toBe(false);

    // Verify diagnosis called with exitCode: -1 and error in stderr
    expect(autoDiagnoseStepFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        exitCode: -1,
        stderr: 'Connection timeout',
        stdout: '',
      }),
    );

    // Verify diagnosis SSE event
    const diagEvent = sseEvents.find((e) => e.event === 'diagnosis');
    expect(diagEvent).toBeDefined();
    expect(JSON.parse(diagEvent!.data).rootCause).toBe('Agent connection lost');

    // Verify error output was emitted
    const errorOutput = sseEvents.find((e) => e.event === 'output' && e.data.includes('[ERROR]'));
    expect(errorOutput).toBeDefined();
  });

  it('should gracefully handle diagnosis failure without crashing', async () => {
    const { _mockExecutor } = await import('../../core/task/executor.js') as { _mockExecutor: { executeCommand: ReturnType<typeof vi.fn> } };
    const { autoDiagnoseStepFailure } = await import('../../ai/error-diagnosis-service.js') as { autoDiagnoseStepFailure: ReturnType<typeof vi.fn> };

    _mockExecutor.executeCommand.mockResolvedValueOnce({
      stdout: '', stderr: 'error', exitCode: 1, success: false,
      operationId: 'op-1', duration: 50, error: null, timedOut: false, executionId: 'exec-1',
    });

    // Diagnosis itself throws
    autoDiagnoseStepFailure.mockRejectedValueOnce(new Error('Diagnosis service down'));

    const { stream, sseEvents } = createMockStream();
    const plan = makeTestPlan(1);

    // Should NOT throw
    const result = await executePlanSteps(makeExecOpts(plan, stream));

    expect(result.success).toBe(false);

    // No diagnosis event emitted (it threw)
    const diagEvent = sseEvents.find((e) => e.event === 'diagnosis');
    expect(diagEvent).toBeUndefined();

    // Complete event should still be emitted
    const completeEvent = sseEvents.find((e) => e.event === 'complete');
    expect(completeEvent).toBeDefined();
  });

  it('should pass previousSteps context to diagnosis when later step fails', async () => {
    const { _mockExecutor } = await import('../../core/task/executor.js') as { _mockExecutor: { executeCommand: ReturnType<typeof vi.fn> } };
    const { autoDiagnoseStepFailure } = await import('../../ai/error-diagnosis-service.js') as { autoDiagnoseStepFailure: ReturnType<typeof vi.fn> };

    // Step 1 succeeds, step 2 fails
    _mockExecutor.executeCommand
      .mockResolvedValueOnce({
        stdout: 'step1 ok', stderr: '', exitCode: 0, success: true,
        operationId: 'op-1', duration: 100, error: null, timedOut: false, executionId: 'exec-1',
      })
      .mockResolvedValueOnce({
        stdout: '', stderr: 'step2 failed', exitCode: 2, success: false,
        operationId: 'op-2', duration: 50, error: null, timedOut: false, executionId: 'exec-2',
      });

    autoDiagnoseStepFailure.mockResolvedValueOnce({
      success: true, errorType: 'generic', rootCause: 'dependency issue',
      explanation: 'Step 2 failed because step 1 output was unexpected', severity: 'medium',
      fixSuggestions: [], usedRuleLibrary: true,
    });

    const { stream } = createMockStream();
    const plan = makeTestPlan(2);

    await executePlanSteps(makeExecOpts(plan, stream));

    // The diagnosis call should receive step-1 as a previousStep
    const diagCall = autoDiagnoseStepFailure.mock.calls[0][0] as Record<string, unknown>;
    expect(diagCall.stepId).toBe('step-2');
    const prevSteps = diagCall.previousSteps as Array<{ stepId: string; success: boolean }>;
    expect(prevSteps).toHaveLength(1);
    expect(prevSteps[0].stepId).toBe('step-1');
    expect(prevSteps[0].success).toBe(true);
  });
});

// ============================================================================
// Execution TTL + Sweep — memory leak prevention (task-062)
// ============================================================================

describe('EXECUTION_TTL_MS / EXECUTION_SWEEP_INTERVAL_MS constants', () => {
  it('should export EXECUTION_TTL_MS as 30 minutes', () => {
    expect(EXECUTION_TTL_MS).toBe(30 * 60 * 1000);
  });

  it('should export EXECUTION_SWEEP_INTERVAL_MS as 5 minutes', () => {
    expect(EXECUTION_SWEEP_INTERVAL_MS).toBe(5 * 60 * 1000);
  });
});

describe('getActiveExecutionCount', () => {
  it('should return 0 when no executions are tracked', () => {
    expect(getActiveExecutionCount()).toBe(0);
  });

  it('should return the number of tracked executions', () => {
    _setActiveExecution('plan-a', 'exec-1');
    _setActiveExecution('plan-b', 'exec-2');
    expect(getActiveExecutionCount()).toBe(2);
  });
});

describe('sweepExpiredExecutions', () => {
  it('should remove entries older than TTL', () => {
    const thirtyOneMinAgo = Date.now() - (31 * 60 * 1000);
    _setActiveExecutionWithTime('plan-old', 'exec-1', thirtyOneMinAgo);
    _setActiveExecution('plan-new', 'exec-2');

    const swept = sweepExpiredExecutions();

    expect(swept).toBe(1);
    expect(hasActiveExecution('plan-old')).toBe(false);
    expect(hasActiveExecution('plan-new')).toBe(true);
  });

  it('should keep entries within TTL', () => {
    _setActiveExecution('plan-recent', 'exec-1');

    const swept = sweepExpiredExecutions();

    expect(swept).toBe(0);
    expect(hasActiveExecution('plan-recent')).toBe(true);
  });

  it('should sweep all expired entries at once', () => {
    const oldTime = Date.now() - (35 * 60 * 1000);
    _setActiveExecutionWithTime('plan-a', 'exec-1', oldTime);
    _setActiveExecutionWithTime('plan-b', 'exec-2', oldTime);
    _setActiveExecutionWithTime('plan-c', 'exec-3', oldTime);

    const swept = sweepExpiredExecutions();

    expect(swept).toBe(3);
    expect(getActiveExecutionCount()).toBe(0);
  });

  it('should accept custom TTL parameter', () => {
    const fiveMinAgo = Date.now() - (5 * 60 * 1000);
    _setActiveExecutionWithTime('plan-short', 'exec-1', fiveMinAgo);

    // Custom 1-minute TTL
    const swept = sweepExpiredExecutions(60 * 1000);

    expect(swept).toBe(1);
    expect(hasActiveExecution('plan-short')).toBe(false);
  });

  it('should return 0 when map is empty', () => {
    const swept = sweepExpiredExecutions();
    expect(swept).toBe(0);
  });
});

describe('startExecutionSweep / stopExecutionSweep', () => {
  it('should start and stop without errors', () => {
    startExecutionSweep(60000);
    stopExecutionSweep();
  });

  it('should stop idempotently (safe to call multiple times)', () => {
    stopExecutionSweep();
    stopExecutionSweep();
  });

  it('should replace the timer when called twice', () => {
    startExecutionSweep(60000);
    startExecutionSweep(60000);
    stopExecutionSweep();
  });

  it('should use unref so timer does not block process exit', () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');

    startExecutionSweep(60000);

    expect(setIntervalSpy).toHaveBeenCalled();
    // The return value should have had .unref() called
    const timer = setIntervalSpy.mock.results[0].value as NodeJS.Timeout;
    expect(timer.hasRef()).toBe(false);

    stopExecutionSweep();
    setIntervalSpy.mockRestore();
  });

  it('should periodically sweep expired executions', async () => {
    vi.useFakeTimers();

    const oldTime = Date.now() - (31 * 60 * 1000);
    _setActiveExecutionWithTime('plan-stale', 'exec-1', oldTime);

    startExecutionSweep(100); // 100ms interval for fast test

    vi.advanceTimersByTime(150);

    expect(hasActiveExecution('plan-stale')).toBe(false);

    stopExecutionSweep();
    vi.useRealTimers();
  });
});

describe('shutdownExecutionTracking', () => {
  it('should clear all active executions', () => {
    _setActiveExecution('plan-1', 'exec-1');
    _setActiveExecution('plan-2', 'exec-2');

    shutdownExecutionTracking();

    expect(getActiveExecutionCount()).toBe(0);
  });

  it('should clear all pending decisions and resolve with reject', () => {
    let resolved1: string | undefined;
    let resolved2: string | undefined;

    _setPendingDecision('plan-1', 'step-1', (d) => { resolved1 = d; }, setTimeout(() => {}, 60000));
    _setPendingDecision('plan-2', 'step-1', (d) => { resolved2 = d; }, setTimeout(() => {}, 60000));

    shutdownExecutionTracking();

    expect(resolved1).toBe('reject');
    expect(resolved2).toBe('reject');
    expect(_hasPendingDecision('plan-1', 'step-1')).toBe(false);
    expect(_hasPendingDecision('plan-2', 'step-1')).toBe(false);
  });

  it('should stop the sweep timer', () => {
    startExecutionSweep(60000);

    shutdownExecutionTracking();

    // Starting a new sweep should work (proving the old one was stopped)
    startExecutionSweep(60000);
    stopExecutionSweep();
  });

  it('should be safe to call when nothing is tracked', () => {
    shutdownExecutionTracking();
    expect(getActiveExecutionCount()).toBe(0);
  });

  it('should clear decision timers to prevent leaks', () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    const timer = setTimeout(() => {}, 60000);
    _setPendingDecision('plan-z', 'step-z', () => {}, timer);

    shutdownExecutionTracking();

    expect(clearTimeoutSpy).toHaveBeenCalledWith(timer);
    clearTimeoutSpy.mockRestore();
  });
});
