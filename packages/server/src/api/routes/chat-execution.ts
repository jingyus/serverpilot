// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Plan execution engine — executes validated plan steps via SSE streaming.
 *
 * Extracted from chat.ts to keep the route file focused on HTTP handling.
 * Handles step-by-step execution with real-time output, confirmation flow,
 * audit logging, error auto-diagnosis, and post-execution AI summary.
 *
 * @module api/routes/chat-execution
 */

import { randomUUID } from 'node:crypto';
import type { SSEStreamingApi } from 'hono/streaming';
import type { RiskLevel, InstallStep, InstallPlan } from '@aiinstaller/shared';
import type { FullServerProfile } from '../../core/profile/manager.js';
import type { ServerProfile } from '../../db/repositories/server-repository.js';
import type { ValidationAction } from '../../core/security/command-validator.js';
import { getSessionManager } from '../../core/session/manager.js';
import { getTaskExecutor } from '../../core/task/executor.js';
import { validateCommand, validatePlan } from '../../core/security/command-validator.js';
import type { PlanValidationResult } from '../../core/security/command-validator.js';
import { getAuditLogger } from '../../core/security/audit-logger.js';
import { autoDiagnoseStepFailure } from '../../ai/error-diagnosis-service.js';
import { getChatAIAgent } from './chat-ai.js';
import { logger } from '../../utils/logger.js';

// ============================================================================
// Types
// ============================================================================

/** A single step in a stored plan, enriched with validation results. */
export interface StoredPlanStep {
  id: string;
  description: string;
  command: string;
  riskLevel: RiskLevel;
  rollbackCommand?: string;
  timeout: number;
  canRollback: boolean;
  validationAction?: ValidationAction;
  validationReasons?: string[];
}

/** A blocked step summary included in the stored plan. */
export interface BlockedStepInfo {
  stepId: string;
  command: string;
  reason: string;
}

/** A validated plan stored in the session, ready for execution. */
export interface StoredPlan {
  planId: string;
  description: string;
  steps: StoredPlanStep[];
  totalRisk: RiskLevel;
  requiresConfirmation: boolean;
  blocked?: boolean;
  blockedSteps?: BlockedStepInfo[];
  estimatedTime?: number;
}

/** Completed step result tracked during execution. */
export interface CompletedStep {
  stepId: string;
  success: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  duration: number;
}

/** Result returned after plan execution completes. */
export interface ExecutionResult {
  success: boolean;
  operationId: string;
  failedAtStep: string | null;
  cancelled: boolean;
}

/** Options for executePlanSteps. */
export interface ExecutePlanStepsOptions {
  plan: StoredPlan;
  serverId: string;
  userId: string;
  sessionId: string;
  clientId: string;
  stream: SSEStreamingApi;
  serverProfile: FullServerProfile | ServerProfile | null;
  planId: string;
  mode: 'auto' | 'step_confirm';
}

// ============================================================================
// Shared execution infrastructure
// ============================================================================

/**
 * Tracks active plan executions: `planId → executionId`.
 * Used by the cancel endpoint to find and stop running executions.
 */
const activePlanExecutions = new Map<string, string>();

/**
 * Tracks pending step decisions for the step-confirm flow.
 * Key: `planId:stepId` → resolve callback for the awaiting Promise.
 */
const pendingDecisions = new Map<string, {
  resolve: (decision: 'allow' | 'allow_all' | 'reject') => void;
  timer: ReturnType<typeof setTimeout>;
}>();

/** Decision timeout: 5 minutes of inactivity auto-rejects. */
const STEP_DECISION_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Wait for a user decision on a specific step.
 * Returns a promise that resolves when the user calls the step-decision API.
 */
function waitForStepDecision(
  planId: string,
  stepId: string,
): Promise<'allow' | 'allow_all' | 'reject'> {
  return new Promise((resolve) => {
    const key = `${planId}:${stepId}`;
    const timer = setTimeout(() => {
      pendingDecisions.delete(key);
      resolve('reject');
    }, STEP_DECISION_TIMEOUT_MS);
    pendingDecisions.set(key, { resolve, timer });
  });
}

// ============================================================================
// Public API for pending decisions (used by chat.ts routes)
// ============================================================================

/** Resolve a pending step decision. Returns true if a pending decision was found. */
export function resolveStepDecision(
  planId: string,
  stepId: string,
  decision: 'allow' | 'allow_all' | 'reject',
): boolean {
  const key = `${planId}:${stepId}`;
  const pending = pendingDecisions.get(key);
  if (!pending) return false;
  clearTimeout(pending.timer);
  pending.resolve(decision);
  pendingDecisions.delete(key);
  return true;
}

/** Reject all pending decisions for a given plan (used by cancel). */
export function rejectAllPendingDecisions(planId: string): void {
  for (const [key, pending] of pendingDecisions.entries()) {
    if (key.startsWith(`${planId}:`)) {
      clearTimeout(pending.timer);
      pending.resolve('reject');
      pendingDecisions.delete(key);
    }
  }
}

/** Get the active execution ID for a plan, or undefined. */
export function getActiveExecution(planId: string): string | undefined {
  return activePlanExecutions.get(planId);
}

/** Remove an active execution and return whether it existed. */
export function removeActiveExecution(planId: string): boolean {
  return activePlanExecutions.delete(planId);
}

// ============================================================================
// Plan Building
// ============================================================================

/** Result of building a stored plan from AI-generated install steps. */
export interface BuildPlanResult {
  storedPlan: StoredPlan;
  validation: PlanValidationResult;
}

/**
 * Build a StoredPlan from AI-generated InstallStep array.
 *
 * Validates each step through the security engine, classifies risk levels,
 * and produces a plan structure ready for storage and execution.
 */
export function buildStoredPlan(
  planId: string,
  steps: InstallStep[],
  description: string,
  estimatedTime?: number,
): BuildPlanResult {
  const planSteps = steps.map((step, i) => ({
    id: step.id ?? `step-${i + 1}`,
    description: step.description,
    command: step.command,
    timeout: step.timeout ?? 30000,
    canRollback: step.canRollback ?? false,
  }));

  const planValidation = validatePlan(planSteps);

  const storedPlan: StoredPlan = {
    planId,
    description,
    steps: planValidation.steps.map((sv) => ({
      id: sv.stepId, description: sv.description, command: sv.command,
      riskLevel: sv.validation.classification.riskLevel,
      rollbackCommand: undefined,
      timeout: planSteps.find((s) => s.id === sv.stepId)?.timeout ?? 30000,
      canRollback: planSteps.find((s) => s.id === sv.stepId)?.canRollback ?? false,
      validationAction: sv.validation.action,
      validationReasons: sv.validation.reasons,
    })),
    totalRisk: planValidation.maxRiskLevel,
    requiresConfirmation: planValidation.action !== 'allowed',
    blocked: planValidation.action === 'blocked',
    blockedSteps: planValidation.blockedSteps.map((s) => ({
      stepId: s.stepId, command: s.command,
      reason: s.validation.classification.reason,
    })),
    estimatedTime,
  };

  return { storedPlan, validation: planValidation };
}

// ============================================================================
// Execute Plan Steps
// ============================================================================

/**
 * Execute plan steps with streaming output via SSE.
 *
 * Shared by both auto-execute (all-GREEN) and manual-execute flows.
 *
 * @param opts.mode - 'auto': run all steps without confirmation.
 *                    'step_confirm': pause before each non-GREEN step and wait for user decision.
 */
export async function executePlanSteps(opts: ExecutePlanStepsOptions): Promise<ExecutionResult> {
  const { plan, serverId, userId, sessionId, clientId, stream, serverProfile, planId, mode } = opts;
  const operationId = randomUUID();
  const executor = getTaskExecutor();
  const sessionMgr = getSessionManager();
  const auditLogger = getAuditLogger();

  let allSucceeded = true;
  let firstFailedStep: string | null = null;
  let cancelled = false;
  let allowAll = mode === 'auto'; // In auto mode, skip all confirmations

  const completedSteps: CompletedStep[] = [];

  // Track this plan execution for the cancel endpoint
  activePlanExecutions.set(planId, '');

  // Track current step for real-time output routing
  let currentStepId: string | null = null;
  // Track whether real-time output was streamed (to avoid duplicate output on completion)
  let hasStreamedOutput = false;

  // Register a progress listener scoped to this plan execution.
  executor.addProgressListener(planId, (executionId, _status, output) => {
    activePlanExecutions.set(planId, executionId);
    if (output && currentStepId) {
      hasStreamedOutput = true;
      stream.writeSSE({ event: 'output', data: JSON.stringify({ stepId: currentStepId, content: output }) })
        .catch(() => { /* SSE write failed, stream likely closed */ });
    }
  });

  for (const step of plan.steps) {
    if (!activePlanExecutions.has(planId)) {
      cancelled = true;
      allSucceeded = false;
      firstFailedStep = step.id;
      break;
    }

    const startTime = Date.now();
    const validation = validateCommand(step.command);

    const auditEntry = await auditLogger.log({
      serverId, userId, sessionId,
      command: step.command,
      validation,
    });

    // Block FORBIDDEN commands
    if (validation.action === 'blocked') {
      logger.warn(
        { operation: 'plan_execute', serverId, stepId: step.id, reason: validation.classification.reason },
        `Step blocked: ${step.command}`,
      );
      await stream.writeSSE({ event: 'step_start', data: JSON.stringify({ stepId: step.id, command: step.command, description: step.description }) });
      await stream.writeSSE({ event: 'output', data: JSON.stringify({ stepId: step.id, content: `[BLOCKED] ${validation.classification.reason}\n` }) });
      await stream.writeSSE({ event: 'step_complete', data: JSON.stringify({ stepId: step.id, exitCode: -1, duration: Date.now() - startTime, success: false, blocked: true }) });
      allSucceeded = false;
      firstFailedStep = step.id;
      break;
    }

    // Step-confirm mode: pause for user decision on non-GREEN steps
    if (!allowAll && mode === 'step_confirm' && validation.action !== 'allowed') {
      await stream.writeSSE({
        event: 'step_confirm',
        data: JSON.stringify({
          stepId: step.id,
          command: step.command,
          description: step.description,
          riskLevel: validation.classification.riskLevel,
        }),
      });

      const decision = await waitForStepDecision(planId, step.id);

      if (decision === 'reject') {
        cancelled = true;
        allSucceeded = false;
        firstFailedStep = step.id;
        break;
      }
      if (decision === 'allow_all') {
        allowAll = true;
      }
    }

    currentStepId = step.id;
    hasStreamedOutput = false;
    await stream.writeSSE({ event: 'step_start', data: JSON.stringify({ stepId: step.id, command: step.command, description: step.description }) });
    await stream.writeSSE({ event: 'output', data: JSON.stringify({ stepId: step.id, content: `$ ${step.command}\n` }) });

    try {
      const validatedRiskLevel = validation.classification.riskLevel as 'green' | 'yellow' | 'red' | 'critical';

      const result = await executor.executeCommand({
        serverId, userId, clientId,
        command: step.command,
        description: step.description,
        riskLevel: validatedRiskLevel,
        type: 'execute',
        timeoutMs: step.timeout || 300000,
      });

      currentStepId = null;

      if (!hasStreamedOutput) {
        if (result.stdout) {
          await stream.writeSSE({ event: 'output', data: JSON.stringify({ stepId: step.id, content: result.stdout }) });
        }
        if (result.stderr) {
          await stream.writeSSE({ event: 'output', data: JSON.stringify({ stepId: step.id, content: result.stderr }) });
        }
      }

      const duration = Date.now() - startTime;
      await stream.writeSSE({ event: 'step_complete', data: JSON.stringify({ stepId: step.id, exitCode: result.exitCode, duration, success: result.success }) });

      await auditLogger.updateExecutionResult(auditEntry.id, result.success ? 'success' : 'failed', result.operationId);

      completedSteps.push({
        stepId: step.id, success: result.success, exitCode: result.exitCode,
        stdout: result.stdout, stderr: result.stderr, duration,
      });

      if (result.error === 'Cancelled') {
        cancelled = true;
        allSucceeded = false;
        firstFailedStep = step.id;
        break;
      }

      if (!result.success) {
        allSucceeded = false;
        firstFailedStep = step.id;
        logger.warn({ operation: 'plan_execute', serverId, planId, stepId: step.id, exitCode: result.exitCode }, `Step failed: ${step.description}`);

        try {
          const diagnosis = await autoDiagnoseStepFailure({
            stepId: step.id, command: step.command, exitCode: result.exitCode,
            stdout: result.stdout, stderr: result.stderr,
            serverId, serverProfile, previousSteps: completedSteps.slice(0, -1),
          });
          await stream.writeSSE({ event: 'diagnosis', data: JSON.stringify(diagnosis) });
          if (diagnosis.success) {
            await sessionMgr.addMessage(sessionId, userId, 'system',
              `Error diagnosis for "${step.command}": ${diagnosis.rootCause}` +
              (diagnosis.fixSuggestions.length > 0 ? `. Suggested fix: ${diagnosis.fixSuggestions[0].description}` : ''));
          }
        } catch (diagErr) {
          logger.error({ operation: 'auto_diagnosis', serverId, stepId: step.id, error: String(diagErr) }, 'Auto-diagnosis failed');
        }
        break;
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      logger.error({ operation: 'plan_execute', serverId, planId, stepId: step.id, error: errorMsg }, `Step execution error: ${step.description}`);

      await stream.writeSSE({ event: 'output', data: JSON.stringify({ stepId: step.id, content: `[ERROR] ${errorMsg}\n` }) });
      await stream.writeSSE({ event: 'step_complete', data: JSON.stringify({ stepId: step.id, exitCode: -1, duration: Date.now() - startTime, success: false }) });
      await auditLogger.updateExecutionResult(auditEntry.id, 'failed');

      try {
        const diagnosis = await autoDiagnoseStepFailure({
          stepId: step.id, command: step.command, exitCode: -1, stdout: '', stderr: errorMsg,
          serverId, serverProfile, previousSteps: completedSteps,
        });
        await stream.writeSSE({ event: 'diagnosis', data: JSON.stringify(diagnosis) });
      } catch (diagErr) {
        logger.error({ operation: 'auto_diagnosis', serverId, stepId: step.id, error: String(diagErr) }, 'Auto-diagnosis failed');
      }

      allSucceeded = false;
      firstFailedStep = step.id;
      break;
    }
  }

  // Clean up
  activePlanExecutions.delete(planId);
  executor.removeProgressListener(planId);

  // Post-execution AI summary
  if (completedSteps.length > 0 && !cancelled) {
    try {
      const agent = getChatAIAgent();
      if (agent) {
        const stepSummaries = completedSteps.map((s) => {
          const stepInfo = plan.steps.find((ps) => ps.id === s.stepId);
          const outputSnippet = (s.stdout || s.stderr || '').slice(0, 2000);
          return `Command: ${stepInfo?.command ?? s.stepId}\nExit code: ${s.exitCode}\nOutput:\n${outputSnippet}`;
        }).join('\n---\n');

        const summaryPrompt = allSucceeded
          ? `The following commands were executed successfully. Provide a brief, helpful summary of the results in Chinese. Focus on key findings. Do NOT repeat the raw output — just summarize what the user needs to know.\n\nCRITICAL: Do NOT generate any json-plan blocks. Do NOT suggest follow-up commands in code blocks. Just give a plain text summary.\n\n${stepSummaries}`
          : `The following commands were executed but some failed. Analyze what went wrong, explain the root cause in Chinese, and suggest what the user should do next.\n\nCRITICAL: Do NOT generate any json-plan blocks. Do NOT output code blocks with commands. Just explain in plain text what went wrong and what to do.\n\n${stepSummaries}`;

        await agent.chat(
          summaryPrompt,
          `Server: execution-summary`,
          '',
          {
            onToken: async (token: string) => {
              await stream.writeSSE({
                event: 'message',
                data: JSON.stringify({ content: token }),
              });
            },
            onRetry: async () => { /* ignore retries for summary */ },
          },
        );
      }
    } catch (summaryErr) {
      logger.debug({ operation: 'execution_summary', error: String(summaryErr) }, 'Post-execution summary failed (non-critical)');
    }
  }

  const resultMessage = cancelled
    ? `Plan execution cancelled at step ${firstFailedStep}: ${plan.description}`
    : allSucceeded
      ? `Plan executed successfully: ${plan.description}`
      : `Plan execution failed at step ${firstFailedStep}: ${plan.description}`;
  await sessionMgr.addMessage(sessionId, userId, 'system', resultMessage);

  await stream.writeSSE({
    event: 'complete',
    data: JSON.stringify({ success: allSucceeded, operationId, failedAtStep: firstFailedStep, cancelled }),
  });

  return { success: allSucceeded, operationId, failedAtStep: firstFailedStep, cancelled };
}
