// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Task Executor — dispatches commands to agents and processes results.
 *
 * Orchestrates command execution on remote agents via WebSocket:
 * 1. Validates the command and risk level
 * 2. Creates an operation record for audit trail
 * 3. Sends the command to the target agent
 * 4. Tracks execution state and collects results
 * 5. Updates operation and task records with outcomes
 *
 * @module core/task/executor
 */

import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import type { InstallServer } from '../../api/server.js';
import { createMessage, MessageType } from '@aiinstaller/shared';
import type { StepResult } from '@aiinstaller/shared';
import {
  getOperationRepository,
  type OperationRepository,
  type RiskLevel,
  type OperationType,
} from '../../db/repositories/operation-repository.js';
import {
  getTaskRepository,
  type TaskRepository,
  type TaskRunStatus,
} from '../../db/repositories/task-repository.js';
import type { SnapshotService } from '../snapshot/snapshot-service.js';
import { createContextLogger, logError } from '../../utils/logger.js';
import { getWebhookDispatcher } from '../webhook/dispatcher.js';

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 600_000;
const MAX_CONCURRENT_EXECUTIONS = 20;

// ============================================================================
// Zod Schemas
// ============================================================================

export const ExecuteCommandInputSchema = z.object({
  /** Target server ID */
  serverId: z.string().min(1),
  /** User who initiated the command */
  userId: z.string().min(1),
  /** WebSocket client ID of the target agent */
  clientId: z.string().min(1),
  /** Command to execute */
  command: z.string().min(1),
  /** Human-readable description */
  description: z.string().min(1),
  /** Risk level classification */
  riskLevel: z.enum(['green', 'yellow', 'red', 'critical']),
  /** Operation type */
  type: z.enum(['install', 'config', 'restart', 'execute', 'backup']).default('execute'),
  /** Session ID (if triggered from a chat session) */
  sessionId: z.string().optional(),
  /** Task ID (if triggered from a scheduled task) */
  taskId: z.string().optional(),
  /** Timeout in milliseconds */
  timeoutMs: z.number().int().positive().max(MAX_TIMEOUT_MS).default(DEFAULT_TIMEOUT_MS),
});

export type ExecuteCommandInput = z.infer<typeof ExecuteCommandInputSchema>;

export const ExecutePlanInputSchema = z.object({
  /** Target server ID */
  serverId: z.string().min(1),
  /** User who initiated the plan */
  userId: z.string().min(1),
  /** WebSocket client ID of the target agent */
  clientId: z.string().min(1),
  /** Session ID */
  sessionId: z.string().optional(),
  /** Steps to execute sequentially */
  steps: z.array(z.object({
    command: z.string().min(1),
    description: z.string().min(1),
    riskLevel: z.enum(['green', 'yellow', 'red', 'critical']),
    timeoutMs: z.number().int().positive().max(MAX_TIMEOUT_MS).default(DEFAULT_TIMEOUT_MS),
    /** Whether to continue if this step fails */
    continueOnError: z.boolean().default(false),
  })).min(1),
});

export type ExecutePlanInput = z.infer<typeof ExecutePlanInputSchema>;

// ============================================================================
// Types
// ============================================================================

/** Status of a single command execution */
export type ExecutionStatus = 'pending' | 'running' | 'success' | 'failed' | 'timeout' | 'cancelled';

/** Tracked state of a command in flight */
export interface ExecutionState {
  /** Unique execution ID */
  id: string;
  /** Operation record ID in the database */
  operationId: string;
  /** Target agent client ID */
  clientId: string;
  /** Server ID */
  serverId: string;
  /** User ID */
  userId: string;
  /** The command being executed */
  command: string;
  /** Current status */
  status: ExecutionStatus;
  /** When execution started */
  startedAt: number;
  /** Timeout timer handle */
  timeoutHandle: ReturnType<typeof setTimeout> | null;
  /** Resolve function for the execution promise */
  resolve: (result: ExecutionResult) => void;
  /** Task ID if from a scheduled task */
  taskId?: string;
}

/** Result returned after command execution completes */
export interface ExecutionResult {
  /** Whether the command succeeded (exit code 0, no timeout) */
  success: boolean;
  /** Unique execution ID */
  executionId: string;
  /** Operation record ID */
  operationId: string;
  /** Process exit code (-1 for timeout/error) */
  exitCode: number;
  /** Standard output */
  stdout: string;
  /** Standard error */
  stderr: string;
  /** Duration in milliseconds */
  duration: number;
  /** Whether the command timed out */
  timedOut: boolean;
  /** Error message if execution failed before reaching the agent */
  error?: string;
  /** Snapshot ID created before execution (if any) */
  snapshotId?: string;
}

/** Result of executing a multi-step plan */
export interface PlanExecutionResult {
  /** Whether all steps succeeded */
  success: boolean;
  /** Results for each step */
  stepResults: ExecutionResult[];
  /** Total duration in milliseconds */
  totalDuration: number;
  /** Index of the first failed step (-1 if all succeeded) */
  failedAtStep: number;
}

/** Callback for receiving execution progress updates */
export type ExecutionProgressCallback = (
  executionId: string,
  status: ExecutionStatus,
  output?: string,
) => void;

// ============================================================================
// TaskExecutor
// ============================================================================

export class TaskExecutor {
  /** In-flight executions keyed by execution ID */
  private executions = new Map<string, ExecutionState>();

  /** Maps step IDs to execution IDs for result routing */
  private stepToExecution = new Map<string, string>();

  /** Optional progress callback */
  private onProgress: ExecutionProgressCallback | null = null;

  /** Optional snapshot service for pre-operation snapshots */
  private snapshotService: SnapshotService | null = null;

  constructor(
    private server: InstallServer,
    private operationRepo: OperationRepository = getOperationRepository(),
    private taskRepo: TaskRepository = getTaskRepository(),
  ) {}

  /**
   * Set the snapshot service for automatic pre-operation snapshots.
   *
   * When set, the executor will automatically create a snapshot before
   * executing commands with YELLOW or higher risk level.
   */
  setSnapshotService(service: SnapshotService | null): void {
    this.snapshotService = service;
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  /**
   * Execute a single command on a remote agent.
   *
   * Creates an operation record, sends the command via WebSocket,
   * and waits for the result within the specified timeout.
   *
   * @param rawInput - Command execution parameters
   * @returns The execution result
   */
  async executeCommand(rawInput: ExecuteCommandInput): Promise<ExecutionResult> {
    const input = ExecuteCommandInputSchema.parse(rawInput);

    if (this.executions.size >= MAX_CONCURRENT_EXECUTIONS) {
      return this.createErrorResult('Max concurrent executions reached');
    }

    const logger = createContextLogger({
      serverId: input.serverId,
      clientId: input.clientId,
      userId: input.userId,
    });

    // 1. Create operation record for audit trail
    const operation = await this.operationRepo.create({
      serverId: input.serverId,
      userId: input.userId,
      sessionId: input.sessionId,
      type: input.type as OperationType,
      description: input.description,
      commands: [input.command],
      riskLevel: input.riskLevel as RiskLevel,
    });

    // 2. Create pre-operation snapshot if needed (YELLOW+ risk level)
    let snapshotId: string | undefined;
    if (this.snapshotService && this.snapshotService.requiresSnapshot(input.riskLevel)) {
      logger.info(
        { command: input.command, riskLevel: input.riskLevel },
        'Creating pre-operation snapshot',
      );

      const snapshotResult = await this.snapshotService.createPreOperationSnapshot({
        serverId: input.serverId,
        userId: input.userId,
        clientId: input.clientId,
        command: input.command,
        riskLevel: input.riskLevel,
        operationId: operation.id,
      });

      if (snapshotResult.success && snapshotResult.snapshot) {
        snapshotId = snapshotResult.snapshot.id;
        logger.info({ snapshotId }, 'Pre-operation snapshot created');
      } else if (!snapshotResult.skipped) {
        // Snapshot failed but was required — log warning, continue execution
        logger.warn(
          { error: snapshotResult.error },
          'Pre-operation snapshot failed, proceeding without snapshot',
        );
      }
    }

    await this.operationRepo.markRunning(operation.id, input.userId);

    // 3. Create execution tracking state
    const executionId = randomUUID();
    const stepId = randomUUID();

    logger.info({
      executionId,
      operationId: operation.id,
      command: input.command,
      riskLevel: input.riskLevel,
      timeoutMs: input.timeoutMs,
      snapshotId,
    }, 'Dispatching command to agent');

    // 4. Send command to agent and wait for result
    const result = await new Promise<ExecutionResult>((resolve) => {
      const state: ExecutionState = {
        id: executionId,
        operationId: operation.id,
        clientId: input.clientId,
        serverId: input.serverId,
        userId: input.userId,
        command: input.command,
        status: 'running',
        startedAt: Date.now(),
        timeoutHandle: null,
        resolve,
        taskId: input.taskId,
      };

      // Set up timeout
      state.timeoutHandle = setTimeout(() => {
        this.handleTimeout(executionId);
      }, input.timeoutMs);

      this.executions.set(executionId, state);
      this.stepToExecution.set(stepId, executionId);

      // Send step.execute message to the agent
      try {
        this.server.send(input.clientId, createMessage(
          MessageType.STEP_EXECUTE,
          {
            id: stepId,
            description: input.description,
            command: input.command,
            timeout: input.timeoutMs,
            canRollback: !!snapshotId,
            onError: 'abort',
          },
        ));
        this.notifyProgress(executionId, 'running');
      } catch (err) {
        this.cleanup(executionId);
        resolve(this.createErrorResult(
          err instanceof Error ? err.message : 'Failed to send command to agent',
          executionId,
          operation.id,
        ));
      }
    });

    // Attach snapshot ID to result
    result.snapshotId = snapshotId;

    // 5. Update operation record with result
    const opStatus = result.success ? 'success' as const : 'failed' as const;
    const output = this.formatOutput(result);
    await this.operationRepo.markComplete(
      operation.id,
      input.userId,
      output,
      opStatus,
      result.duration,
    );

    // 6. Update task run result if triggered from a scheduled task
    if (input.taskId) {
      await this.taskRepo.updateRunResult(
        input.taskId,
        input.userId,
        result.success ? 'success' : 'failed',
        null,
      );
    }

    // 7. Dispatch webhook events
    try {
      const dispatcher = getWebhookDispatcher();
      if (input.taskId) {
        await dispatcher.dispatch({
          type: 'task.completed',
          userId: input.userId,
          data: {
            taskId: input.taskId,
            operationId: operation.id,
            serverId: input.serverId,
            success: result.success,
            exitCode: result.exitCode,
            duration: result.duration,
          },
        });
      }
      if (!result.success) {
        await dispatcher.dispatch({
          type: 'operation.failed',
          userId: input.userId,
          data: {
            operationId: operation.id,
            serverId: input.serverId,
            type: input.type,
            description: input.description,
            exitCode: result.exitCode,
            duration: result.duration,
          },
        });
      }
    } catch (webhookErr) {
      logError(webhookErr as Error, { executionId }, 'Failed to dispatch webhook event');
    }

    logger.info({
      executionId,
      success: result.success,
      exitCode: result.exitCode,
      duration: result.duration,
    }, 'Command execution completed');

    return result;
  }

  /**
   * Execute a multi-step plan sequentially on a remote agent.
   *
   * Each step is executed one at a time. If a step fails and
   * `continueOnError` is false, execution stops.
   *
   * @param rawInput - Plan execution parameters
   * @returns Results for all executed steps
   */
  async executePlan(rawInput: ExecutePlanInput): Promise<PlanExecutionResult> {
    const input = ExecutePlanInputSchema.parse(rawInput);
    const startTime = Date.now();
    const stepResults: ExecutionResult[] = [];
    let failedAtStep = -1;

    for (let i = 0; i < input.steps.length; i++) {
      const step = input.steps[i];

      const result = await this.executeCommand({
        serverId: input.serverId,
        userId: input.userId,
        clientId: input.clientId,
        sessionId: input.sessionId,
        command: step.command,
        description: step.description,
        riskLevel: step.riskLevel,
        type: 'execute',
        timeoutMs: step.timeoutMs,
      });

      stepResults.push(result);

      if (!result.success) {
        failedAtStep = i;
        if (!step.continueOnError) {
          break;
        }
      }
    }

    return {
      success: failedAtStep === -1,
      stepResults,
      totalDuration: Date.now() - startTime,
      failedAtStep,
    };
  }

  /**
   * Handle a step completion message from an agent.
   *
   * Called by the WebSocket message router when a `step.complete`
   * message is received. Routes the result to the waiting execution.
   *
   * @param stepResult - The step result from the agent
   * @returns True if the result was matched to a pending execution
   */
  handleStepComplete(stepResult: StepResult): boolean {
    const executionId = this.stepToExecution.get(stepResult.stepId);
    if (!executionId) return false;

    const state = this.executions.get(executionId);
    if (!state) return false;

    const duration = Date.now() - state.startedAt;

    const result: ExecutionResult = {
      success: stepResult.success && stepResult.exitCode === 0,
      executionId,
      operationId: state.operationId,
      exitCode: stepResult.exitCode,
      stdout: stepResult.stdout,
      stderr: stepResult.stderr,
      duration,
      timedOut: false,
    };

    state.status = result.success ? 'success' : 'failed';
    this.notifyProgress(executionId, state.status);
    this.cleanup(executionId);
    state.resolve(result);

    return true;
  }

  /**
   * Handle streaming output from an agent.
   *
   * Called by the WebSocket message router when a `step.output`
   * message is received. Forwards the output to progress listeners.
   *
   * @param stepId - The step ID
   * @param output - The output text
   * @returns True if the output was matched to a pending execution
   */
  handleStepOutput(stepId: string, output: string): boolean {
    const executionId = this.stepToExecution.get(stepId);
    if (!executionId) return false;

    this.notifyProgress(executionId, 'running', output);
    return true;
  }

  /**
   * Cancel a running execution.
   *
   * @param executionId - The execution to cancel
   * @returns True if the execution was found and cancelled
   */
  cancelExecution(executionId: string): boolean {
    const state = this.executions.get(executionId);
    if (!state || state.status !== 'running') return false;

    state.status = 'cancelled';
    const duration = Date.now() - state.startedAt;

    const result: ExecutionResult = {
      success: false,
      executionId,
      operationId: state.operationId,
      exitCode: -1,
      stdout: '',
      stderr: 'Execution cancelled by user',
      duration,
      timedOut: false,
      error: 'Cancelled',
    };

    this.notifyProgress(executionId, 'cancelled');
    this.cleanup(executionId);
    state.resolve(result);
    return true;
  }

  /**
   * Set a callback for receiving execution progress updates.
   *
   * @param callback - Progress callback function
   */
  setProgressCallback(callback: ExecutionProgressCallback | null): void {
    this.onProgress = callback;
  }

  /**
   * Get the current number of in-flight executions.
   */
  getActiveCount(): number {
    return this.executions.size;
  }

  /**
   * Get the state of a specific execution.
   */
  getExecution(executionId: string): ExecutionState | undefined {
    return this.executions.get(executionId);
  }

  /**
   * Cancel all running executions and clean up resources.
   * Should be called when the server is shutting down.
   */
  shutdown(): void {
    for (const [executionId, state] of this.executions.entries()) {
      if (state.status === 'running') {
        state.status = 'cancelled';
        const duration = Date.now() - state.startedAt;

        state.resolve({
          success: false,
          executionId,
          operationId: state.operationId,
          exitCode: -1,
          stdout: '',
          stderr: 'Server shutting down',
          duration,
          timedOut: false,
          error: 'Server shutdown',
        });
      }
      this.cleanup(executionId);
    }
  }

  // --------------------------------------------------------------------------
  // Private methods
  // --------------------------------------------------------------------------

  private handleTimeout(executionId: string): void {
    const state = this.executions.get(executionId);
    if (!state || state.status !== 'running') return;

    state.status = 'timeout';
    const duration = Date.now() - state.startedAt;

    const logger = createContextLogger({
      executionId,
      clientId: state.clientId,
      serverId: state.serverId,
    });

    logger.warn({
      command: state.command,
      duration,
    }, 'Command execution timed out');

    const result: ExecutionResult = {
      success: false,
      executionId,
      operationId: state.operationId,
      exitCode: -1,
      stdout: '',
      stderr: 'Command execution timed out',
      duration,
      timedOut: true,
    };

    this.notifyProgress(executionId, 'timeout');
    this.cleanup(executionId);
    state.resolve(result);
  }

  private cleanup(executionId: string): void {
    const state = this.executions.get(executionId);
    if (!state) return;

    if (state.timeoutHandle) {
      clearTimeout(state.timeoutHandle);
      state.timeoutHandle = null;
    }

    // Clean up step mapping
    for (const [stepId, execId] of this.stepToExecution.entries()) {
      if (execId === executionId) {
        this.stepToExecution.delete(stepId);
        break;
      }
    }

    this.executions.delete(executionId);
  }

  private notifyProgress(
    executionId: string,
    status: ExecutionStatus,
    output?: string,
  ): void {
    if (this.onProgress) {
      try {
        this.onProgress(executionId, status, output);
      } catch {
        // Ignore callback errors
      }
    }
  }

  private formatOutput(result: ExecutionResult): string {
    const parts: string[] = [];
    if (result.stdout) parts.push(`[stdout]\n${result.stdout}`);
    if (result.stderr) parts.push(`[stderr]\n${result.stderr}`);
    if (result.error) parts.push(`[error]\n${result.error}`);
    if (result.timedOut) parts.push('[timed out]');
    return parts.join('\n\n') || '(no output)';
  }

  private createErrorResult(
    error: string,
    executionId?: string,
    operationId?: string,
  ): ExecutionResult {
    return {
      success: false,
      executionId: executionId ?? '',
      operationId: operationId ?? '',
      exitCode: -1,
      stdout: '',
      stderr: error,
      duration: 0,
      timedOut: false,
      error,
    };
  }
}

// ============================================================================
// Singleton
// ============================================================================

let _instance: TaskExecutor | null = null;

/**
 * Get the global TaskExecutor instance.
 *
 * @param server - The WebSocket server (required on first call)
 * @returns The TaskExecutor singleton
 */
export function getTaskExecutor(server?: InstallServer): TaskExecutor {
  if (!_instance) {
    if (!server) {
      throw new Error('TaskExecutor not initialized — provide an InstallServer on first call');
    }
    _instance = new TaskExecutor(server);
  }
  return _instance;
}

/** Set a custom TaskExecutor instance (for testing). */
export function setTaskExecutor(executor: TaskExecutor): void {
  _instance = executor;
}

/** Reset the singleton (for testing). */
export function _resetTaskExecutor(): void {
  if (_instance) {
    _instance.shutdown();
  }
  _instance = null;
}
