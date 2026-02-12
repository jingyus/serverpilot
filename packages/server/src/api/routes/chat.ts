// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * AI chat routes with SSE streaming.
 *
 * Handles conversational AI interactions: message → plan generation (SSE),
 * plan execution (SSE), and session CRUD.
 *
 * Execution modes:
 * - GREEN plans: auto-execute immediately (read-only commands)
 * - YELLOW/RED/CRITICAL plans: step-by-step confirmation (allow / allow_all / reject)
 * - FORBIDDEN commands: blocked, never executed
 *
 * @module api/routes/chat
 */

import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { SSEStreamingApi } from 'hono/streaming';
import { randomUUID } from 'node:crypto';
import {
  ChatMessageBodySchema,
  ExecutePlanBodySchema,
  CancelExecutionBodySchema,
  StepDecisionBodySchema,
} from './schemas.js';
import { validateBody } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveRole, requirePermission } from '../middleware/rbac.js';
import { ApiError } from '../middleware/error-handler.js';
import { getSessionManager } from '../../core/session/manager.js';
import { getServerRepository } from '../../db/repositories/server-repository.js';
import { getProfileManager } from '../../core/profile/manager.js';
import { buildProfileContext, buildProfileCaveats } from '../../ai/profile-context.js';
import { getChatAIAgent, ChatRetryExhaustedError } from './chat-ai.js';
import type { ChatRetryEvent } from './chat-ai.js';
import { getRagPipeline } from '../../knowledge/rag-pipeline.js';
import { logger } from '../../utils/logger.js';
import { findConnectedAgent, isAgentConnected } from '../../core/agent/agent-connector.js';
import { getTaskExecutor } from '../../core/task/executor.js';
import { validateCommand, validatePlan } from '../../core/security/command-validator.js';
import { getAuditLogger } from '../../core/security/audit-logger.js';
import { autoDiagnoseStepFailure } from '../../ai/error-diagnosis-service.js';
import { getAgenticEngine } from '../../ai/agentic-chat.js';
import type { InstallStep } from '@aiinstaller/shared';
import type { ChatMessageBody, ExecutePlanBody, CancelExecutionBody, StepDecisionBody } from './schemas.js';
import type { ApiEnv } from './types.js';

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
 * Tracks pending agentic confirmations: `confirmId → resolve callback`.
 * Used by the agentic engine when a risky command needs user approval.
 */
const pendingConfirmations = new Map<string, {
  resolve: (approved: boolean) => void;
  timer: ReturnType<typeof setTimeout>;
}>();

/** Confirmation timeout for agentic mode (5 minutes). */
const CONFIRM_TIMEOUT_MS = 5 * 60 * 1000;

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type StoredPlan = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ServerProfile = any;

/**
 * Execute plan steps with streaming output via SSE.
 *
 * Shared by both auto-execute (all-GREEN) and manual-execute flows.
 *
 * @param mode - 'auto': run all steps without confirmation.
 *               'step_confirm': pause before each non-GREEN step and wait for user decision.
 */
async function executePlanSteps(opts: {
  plan: StoredPlan;
  serverId: string;
  userId: string;
  sessionId: string;
  clientId: string;
  stream: SSEStreamingApi;
  serverProfile: ServerProfile;
  planId: string;
  mode: 'auto' | 'step_confirm';
}): Promise<{ success: boolean; operationId: string; failedAtStep: string | null; cancelled: boolean }> {
  const { plan, serverId, userId, sessionId, clientId, stream, serverProfile, planId, mode } = opts;
  const operationId = randomUUID();
  const executor = getTaskExecutor();
  const sessionMgr = getSessionManager();
  const auditLogger = getAuditLogger();

  let allSucceeded = true;
  let firstFailedStep: string | null = null;
  let cancelled = false;
  let allowAll = mode === 'auto'; // In auto mode, skip all confirmations

  const completedSteps: Array<{
    stepId: string; success: boolean; exitCode: number;
    stdout: string; stderr: string; duration: number;
  }> = [];

  // Track this plan execution for the cancel endpoint
  activePlanExecutions.set(planId, '');

  // Track current step for real-time output routing
  let currentStepId: string | null = null;
  // Track whether real-time output was streamed (to avoid duplicate output on completion)
  let hasStreamedOutput = false;

  executor.setProgressCallback((executionId, _status, output) => {
    activePlanExecutions.set(planId, executionId);
    // Stream real-time output from agent directly to SSE (SSH-like experience)
    if (output && currentStepId) {
      hasStreamedOutput = true;
      stream.writeSSE({ event: 'output', data: JSON.stringify({ stepId: currentStepId, content: output }) })
        .catch(() => { /* SSE write failed, stream likely closed */ });
    }
  });

  for (const step of plan.steps) {
    // Check if execution was cancelled between steps
    if (!activePlanExecutions.has(planId)) {
      cancelled = true;
      allSucceeded = false;
      firstFailedStep = step.id;
      break;
    }

    const startTime = Date.now();
    const validation = validateCommand(step.command);

    // Log to audit trail
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
      // 'allow' or 'allow_all': proceed to execute this step
    }

    // Notify step start
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
        // sessionId omitted from operation — operations FK to sessions table
        // is optional and not required for chat-initiated commands.
        timeoutMs: step.timeout || 300000,
      });

      currentStepId = null;

      // Only send post-completion output if no real-time streaming occurred.
      // When the agent streams step.output messages, the progress callback already
      // forwarded them to SSE. Sending result.stdout again would duplicate output.
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
  executor.setProgressCallback(null);

  // Post-execution AI summary: analyze results and provide natural language summary
  // This is what makes it feel like Claude Code — not just raw output, but intelligent analysis
  if (completedSteps.length > 0 && !cancelled) {
    try {
      const agent = getChatAIAgent();
      if (agent) {
        // Build execution context for AI analysis
        const stepSummaries = completedSteps.map((s) => {
          const stepInfo = plan.steps.find((ps: { id: string }) => ps.id === s.stepId);
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

// ============================================================================
// Routes
// ============================================================================

const chat = new Hono<ApiEnv>();

// All chat routes require authentication
chat.use('*', requireAuth, resolveRole);

// ============================================================================
// POST /chat/:serverId — Send message, AI generates plan (SSE)
// ============================================================================

chat.post('/:serverId', requirePermission('chat:use'), validateBody(ChatMessageBodySchema), async (c) => {
  const { serverId } = c.req.param();
  const userId = c.get('userId');
  const body = c.get('validatedBody') as ChatMessageBody;

  // Verify server exists and belongs to user
  const repo = getServerRepository();
  const server = await repo.findById(serverId, userId);
  if (!server) {
    throw ApiError.notFound('Server');
  }

  const sessionMgr = getSessionManager();
  const session = await sessionMgr.getOrCreate(serverId, userId, body.sessionId);

  // Store user message
  await sessionMgr.addMessage(session.id, userId, 'user', body.message);

  logger.info(
    { operation: 'chat_message', serverId, sessionId: session.id, userId },
    `Chat message received for server ${server.name}`,
  );

  // Get full server profile via ProfileManager for rich AI context
  const profileMgr = getProfileManager();
  const fullProfile = await profileMgr.getProfile(serverId, userId);

  return streamSSE(c, async (stream) => {
    // Send sessionId to client so it can track the conversation
    await stream.writeSSE({
      event: 'message',
      data: JSON.stringify({ sessionId: session.id }),
    });

    // Try agentic mode first (Claude provider with tool_use support)
    const agenticEngine = getAgenticEngine();

    if (agenticEngine) {
      // ====== AGENTIC MODE ======
      // AI autonomously calls tools, observes results, and adapts
      try {
        // Build conversation history from session (already in cache from getOrCreate)
        const history = (session.messages ?? [])
          .filter((m) => m.role === 'user' || m.role === 'assistant')
          .slice(0, -1) // Exclude the current message (already in userMessage)
          .map((m) => ({
            role: m.role as 'user' | 'assistant',
            content: m.content,
          }));

        const result = await agenticEngine.run({
          userMessage: body.message,
          serverId,
          userId,
          sessionId: session.id,
          stream,
          conversationHistory: history,
          serverProfile: fullProfile,
          serverName: server.name,
          onConfirmRequired: async (command, riskLevel, description) => {
            // Wait for user confirmation via HTTP POST to /confirm endpoint
            const confirmId = `${session.id}:${randomUUID()}`;
            return new Promise<boolean>((resolve) => {
              const timer = setTimeout(() => {
                pendingConfirmations.delete(confirmId);
                resolve(false);
              }, CONFIRM_TIMEOUT_MS);
              pendingConfirmations.set(confirmId, { resolve, timer });

              // Send the confirmId to frontend so it can respond
              stream.writeSSE({
                event: 'confirm_id',
                data: JSON.stringify({ confirmId }),
              }).catch(() => {});
            });
          },
        });

        // Store the AI's final text as assistant message
        if (result.finalText) {
          await sessionMgr.addMessage(session.id, userId, 'assistant', result.finalText);
        }

        logger.info(
          {
            operation: 'agentic_chat_complete',
            serverId, sessionId: session.id,
            turns: result.turns, toolCalls: result.toolCallCount,
            success: result.success,
          },
          `Agentic chat: ${result.turns} turns, ${result.toolCallCount} tool calls`,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : 'AI request failed';
        logger.error(
          { operation: 'agentic_chat_error', serverId, sessionId: session.id, error: message },
          'Agentic chat error',
        );
        await stream.writeSSE({
          event: 'message',
          data: JSON.stringify({ content: `\n错误: ${message}` }),
        });
        await stream.writeSSE({
          event: 'complete',
          data: JSON.stringify({ success: false }),
        });
      }
      return;
    }

    // ====== LEGACY MODE (non-Claude providers) ======
    // Falls back to json-plan generation + execution
    const agent = getChatAIAgent();
    if (!agent) {
      await stream.writeSSE({
        event: 'message',
        data: JSON.stringify({
          content: 'AI service is not configured. Please set AI_PROVIDER and the corresponding API key.',
        }),
      });
      await stream.writeSSE({
        event: 'complete',
        data: JSON.stringify({ success: false }),
      });
      return;
    }

    try {
      const profileCtx = buildProfileContext(fullProfile, server.name);
      const caveats = buildProfileCaveats(fullProfile);
      const conversationContext = sessionMgr.buildContext(session.id);
      const serverLabel = `Server: ${server.name}`;

      // Search knowledge base
      let knowledgeContext: string | undefined;
      const ragPipeline = getRagPipeline();
      if (ragPipeline) {
        const ragResult = await ragPipeline.search(body.message);
        if (ragResult.hasResults) {
          knowledgeContext = ragResult.contextText;
        }
      }

      let fullResponse = '';
      const chatCallbacks = {
        onToken: async (token: string) => {
          fullResponse += token;
          await stream.writeSSE({
            event: 'message',
            data: JSON.stringify({ content: token }),
          });
        },
        onRetry: async (retryEvent: ChatRetryEvent) => {
          await stream.writeSSE({
            event: 'retry',
            data: JSON.stringify(retryEvent),
          });
        },
      };

      let result;
      try {
        result = await agent.chat(
          body.message, serverLabel, conversationContext,
          chatCallbacks, profileCtx.text, caveats, knowledgeContext,
        );
      } catch (retryErr) {
        if (retryErr instanceof ChatRetryExhaustedError) {
          fullResponse = '';
          const fallbackResult = await agent.chatWithFallback(
            body.message, serverLabel, conversationContext,
            chatCallbacks, profileCtx.text, caveats, knowledgeContext,
          );
          if (!fallbackResult) throw retryErr;
          result = fallbackResult;
        } else {
          throw retryErr;
        }
      }

      if (fullResponse) {
        await sessionMgr.addMessage(session.id, userId, 'assistant', fullResponse);
      }

      // Legacy plan execution (for non-Claude providers)
      let autoExecuted = false;
      if (result.plan) {
        const planId = randomUUID();
        const planSteps = result.plan.steps.map((step: InstallStep, i: number) => ({
          id: step.id ?? `step-${i + 1}`,
          description: step.description,
          command: step.command,
          timeout: step.timeout ?? 30000,
          canRollback: step.canRollback ?? false,
        }));

        const planValidation = validatePlan(planSteps);
        const storedPlan = {
          planId,
          description: result.plan.description ?? 'Execution plan',
          steps: planValidation.steps.map((sv) => ({
            id: sv.stepId, description: sv.description, command: sv.command,
            riskLevel: sv.validation.classification.riskLevel,
            rollbackCommand: undefined,
            timeout: planSteps.find((s: { id: string }) => s.id === sv.stepId)?.timeout ?? 30000,
            canRollback: planSteps.find((s: { id: string }) => s.id === sv.stepId)?.canRollback ?? false,
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
          estimatedTime: result.plan.estimatedTime,
        };
        sessionMgr.storePlan(session.id, storedPlan);

        const clientId = findConnectedAgent(serverId);
        if (clientId && planValidation.action !== 'blocked') {
          autoExecuted = true;
          const mode = planValidation.action === 'allowed' ? 'auto' : 'step_confirm';
          await stream.writeSSE({
            event: 'auto_execute',
            data: JSON.stringify({ planId, plan: storedPlan }),
          });
          await executePlanSteps({
            plan: storedPlan, serverId, userId,
            sessionId: session.id, clientId, stream,
            serverProfile: fullProfile, planId, mode,
          });
        } else {
          await stream.writeSSE({ event: 'plan', data: JSON.stringify(storedPlan) });
          if (!clientId) {
            await stream.writeSSE({
              event: 'message',
              data: JSON.stringify({ content: '\n⚠️ Agent 未连接，无法执行。' }),
            });
          }
        }
      }

      if (!autoExecuted) {
        await stream.writeSSE({
          event: 'complete',
          data: JSON.stringify({ success: true }),
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'AI request failed';
      logger.error(
        { operation: 'chat_ai_error', serverId, sessionId: session.id, error: message },
        'AI chat error',
      );
      await stream.writeSSE({
        event: 'message',
        data: JSON.stringify({ content: `Error: ${message}` }),
      });
      await stream.writeSSE({
        event: 'complete',
        data: JSON.stringify({ success: false }),
      });
    }
  });
});

// ============================================================================
// POST /chat/:serverId/step-decision — User decision on a step (allow/allow_all/reject)
// ============================================================================

chat.post('/:serverId/step-decision', requirePermission('chat:use'), validateBody(StepDecisionBodySchema), async (c) => {
  const body = c.get('validatedBody') as StepDecisionBody;

  const key = `${body.planId}:${body.stepId}`;
  const pending = pendingDecisions.get(key);

  if (!pending) {
    return c.json({ success: false, message: 'No pending decision for this step' }, 404);
  }

  clearTimeout(pending.timer);
  pending.resolve(body.decision);
  pendingDecisions.delete(key);

  logger.info(
    { operation: 'step_decision', planId: body.planId, stepId: body.stepId, decision: body.decision },
    `User decision: ${body.decision}`,
  );

  return c.json({ success: true });
});

// ============================================================================
// POST /chat/:serverId/confirm — User confirms/rejects a risky command (agentic mode)
// ============================================================================

chat.post('/:serverId/confirm', requirePermission('chat:use'), async (c) => {
  const body = await c.req.json<{ confirmId: string; approved: boolean }>();

  if (!body.confirmId) {
    return c.json({ success: false, message: 'Missing confirmId' }, 400);
  }

  const pending = pendingConfirmations.get(body.confirmId);
  if (!pending) {
    return c.json({ success: false, message: 'No pending confirmation found' }, 404);
  }

  clearTimeout(pending.timer);
  pending.resolve(body.approved ?? false);
  pendingConfirmations.delete(body.confirmId);

  logger.info(
    { operation: 'agentic_confirm', confirmId: body.confirmId, approved: body.approved },
    `User ${body.approved ? 'approved' : 'rejected'} command`,
  );

  return c.json({ success: true });
});

// ============================================================================
// POST /chat/:serverId/execute — Execute confirmed plan (SSE) [legacy]
// ============================================================================

chat.post('/:serverId/execute', requirePermission('chat:use'), validateBody(ExecutePlanBodySchema), async (c) => {
  const { serverId } = c.req.param();
  const userId = c.get('userId');
  const body = c.get('validatedBody') as ExecutePlanBody;

  // Verify server exists
  const repo = getServerRepository();
  const server = await repo.findById(serverId, userId);
  if (!server) {
    throw ApiError.notFound('Server');
  }

  // Retrieve the plan from session
  const sessionMgr = getSessionManager();
  const plan = sessionMgr.getPlan(body.sessionId, body.planId);
  if (!plan) {
    throw ApiError.notFound('Plan');
  }

  logger.info(
    { operation: 'plan_execute', serverId, planId: body.planId, sessionId: body.sessionId, userId },
    `Executing plan: ${plan.description}`,
  );

  return streamSSE(c, async (stream) => {
    const clientId = findConnectedAgent(serverId);
    if (!clientId) {
      await stream.writeSSE({
        event: 'output',
        data: JSON.stringify({ stepId: 'connection-check', content: '[ERROR] No agent connected.\n' }),
      });
      await stream.writeSSE({
        event: 'complete',
        data: JSON.stringify({ success: false, operationId: randomUUID(), error: 'Agent not connected' }),
      });
      return;
    }

    const profileMgr = getProfileManager();
    const serverProfile = await profileMgr.getProfile(serverId, userId);

    await executePlanSteps({
      plan, serverId, userId,
      sessionId: body.sessionId, clientId, stream,
      serverProfile, planId: body.planId, mode: 'auto',
    });
  });
});

// ============================================================================
// POST /chat/:serverId/execute/cancel — Emergency stop running execution
// ============================================================================

chat.post('/:serverId/execute/cancel', requirePermission('chat:use'), validateBody(CancelExecutionBodySchema), async (c) => {
  const { serverId } = c.req.param();
  const userId = c.get('userId');
  const body = c.get('validatedBody') as CancelExecutionBody;

  // Verify server exists
  const repo = getServerRepository();
  const server = await repo.findById(serverId, userId);
  if (!server) {
    throw ApiError.notFound('Server');
  }

  const executionId = activePlanExecutions.get(body.planId);

  // Also resolve any pending step decisions
  for (const [key, pending] of pendingDecisions.entries()) {
    if (key.startsWith(`${body.planId}:`)) {
      clearTimeout(pending.timer);
      pending.resolve('reject');
      pendingDecisions.delete(key);
    }
  }

  if (!executionId) {
    return c.json({ success: false, message: 'No active execution found for this plan' }, 404);
  }

  const executor = getTaskExecutor();
  const cancelled = executor.cancelExecution(executionId);

  // Remove from tracking map so the step loop breaks
  activePlanExecutions.delete(body.planId);

  logger.info(
    { operation: 'plan_cancel', serverId, planId: body.planId, executionId, userId, cancelled },
    `Emergency stop: plan execution ${cancelled ? 'cancelled' : 'not found'}`,
  );

  return c.json({ success: cancelled });
});

// ============================================================================
// GET /chat/:serverId/sessions — List chat sessions
// ============================================================================

chat.get('/:serverId/sessions', requirePermission('chat:use'), async (c) => {
  const { serverId } = c.req.param();
  const userId = c.get('userId');

  // Verify server access
  const repo = getServerRepository();
  const server = await repo.findById(serverId, userId);
  if (!server) {
    throw ApiError.notFound('Server');
  }

  const sessions = await getSessionManager().listSessions(serverId, userId);
  return c.json({ sessions });
});

// ============================================================================
// GET /chat/:serverId/sessions/:sessionId — Get session details
// ============================================================================

chat.get('/:serverId/sessions/:sessionId', requirePermission('chat:use'), async (c) => {
  const { serverId, sessionId } = c.req.param();
  const userId = c.get('userId');

  const repo = getServerRepository();
  const server = await repo.findById(serverId, userId);
  if (!server) {
    throw ApiError.notFound('Server');
  }

  const session = await getSessionManager().getSession(sessionId, userId);
  if (!session || session.serverId !== serverId) {
    throw ApiError.notFound('Session');
  }

  return c.json({
    session: {
      id: session.id,
      messages: session.messages,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    },
  });
});

// ============================================================================
// DELETE /chat/:serverId/sessions/:sessionId — Delete session
// ============================================================================

chat.delete('/:serverId/sessions/:sessionId', requirePermission('chat:use'), async (c) => {
  const { serverId, sessionId } = c.req.param();
  const userId = c.get('userId');

  const repo = getServerRepository();
  const server = await repo.findById(serverId, userId);
  if (!server) {
    throw ApiError.notFound('Server');
  }

  const deleted = await getSessionManager().deleteSession(sessionId, serverId, userId);
  if (!deleted) {
    throw ApiError.notFound('Session');
  }

  logger.info(
    { operation: 'session_delete', serverId, sessionId, userId },
    'Chat session deleted',
  );

  return c.json({ success: true });
});

export { chat };
