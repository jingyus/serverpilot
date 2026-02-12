// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * AI chat routes — message handling, session CRUD, plan execution triggers.
 * Execution engine logic lives in chat-execution.ts.
 * @module api/routes/chat
 */

import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { randomUUID } from 'node:crypto';
import {
  ChatMessageBodySchema,
  ExecutePlanBodySchema,
  CancelExecutionBodySchema,
  StepDecisionBodySchema,
  ConfirmBodySchema,
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
import { findConnectedAgent } from '../../core/agent/agent-connector.js';
import { getAgenticEngine } from '../../ai/agentic-chat.js';
import {
  executePlanSteps,
  buildStoredPlan,
  resolveStepDecision,
  rejectAllPendingDecisions,
  getActiveExecution,
  hasActiveExecution,
  removeActiveExecution,
} from './chat-execution.js';
import type { StoredPlan } from './chat-execution.js';
import type { ChatMessageBody, ExecutePlanBody, CancelExecutionBody, StepDecisionBody, ConfirmBody } from './schemas.js';
import type { ApiEnv } from './types.js';
import { getTaskExecutor } from '../../core/task/executor.js';

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
 * Clean up all pending confirmations for a given session.
 * Clears timers and resolves promises with `false` so the agentic loop unblocks.
 * Called when the SSE stream ends (normal completion or client disconnect).
 */
function cleanupSessionConfirmations(sessionId: string): number {
  let cleaned = 0;
  for (const [confirmId, pending] of pendingConfirmations) {
    if (confirmId.startsWith(`${sessionId}:`)) {
      clearTimeout(pending.timer);
      pending.resolve(false);
      pendingConfirmations.delete(confirmId);
      cleaned++;
    }
  }
  if (cleaned > 0) {
    logger.info(
      { operation: 'confirm_cleanup', sessionId, cleaned },
      `Cleaned up ${cleaned} pending confirmation(s) for disconnected session`,
    );
  }
  return cleaned;
}

const chat = new Hono<ApiEnv>();

// All chat routes require authentication
chat.use('*', requireAuth, resolveRole);

// POST /chat/:serverId — Send message, AI generates plan (SSE)
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

  // SSE reconnection: resume session without re-processing the user message
  if (body.reconnect) {
    if (!body.sessionId) {
      throw ApiError.badRequest('sessionId is required for reconnect');
    }
    const session = await sessionMgr.getSession(body.sessionId, userId);
    if (!session || session.serverId !== serverId) {
      throw ApiError.notFound('Session');
    }

    logger.info(
      { operation: 'chat_reconnect', serverId, sessionId: session.id, userId },
      `SSE reconnect for server ${server.name}`,
    );

    return streamSSE(c, async (stream) => {
      await stream.writeSSE({
        event: 'message',
        data: JSON.stringify({ sessionId: session.id, reconnected: true }),
      });
      await stream.writeSSE({
        event: 'complete',
        data: JSON.stringify({ success: true, reconnected: true }),
      });
    });
  }

  const session = await sessionMgr.getOrCreate(serverId, userId, body.sessionId);

  try {
    await sessionMgr.addMessage(session.id, userId, 'user', body.message!);
  } catch {
    throw ApiError.internal('Failed to save message — please try again');
  }
  logger.info({ operation: 'chat_message', serverId, sessionId: session.id, userId }, `Chat message received for server ${server.name}`);

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
      try {
        const history = sessionMgr.buildHistoryWithLimit(session.id, 40000);

        const result = await agenticEngine.run({
          userMessage: body.message!,
          serverId,
          userId,
          sessionId: session.id,
          stream,
          conversationHistory: history,
          serverProfile: fullProfile,
          serverName: server.name,
          onConfirmRequired: (command, riskLevel, description) => {
            const confirmId = `${session.id}:${randomUUID()}`;
            const approved = new Promise<boolean>((resolve) => {
              const timer = setTimeout(() => {
                pendingConfirmations.delete(confirmId);
                resolve(false);
              }, CONFIRM_TIMEOUT_MS);
              pendingConfirmations.set(confirmId, { resolve, timer });
            });
            return { confirmId, approved };
          },
        });

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
      } finally {
        // Clean up any pending confirmations for this session.
        // Handles: (1) client disconnect while confirmation is pending,
        // (2) agentic loop ended with unresolved confirmations.
        cleanupSessionConfirmations(session.id);
      }
      return;
    }

    // ====== LEGACY MODE (non-Claude providers) ======
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
      const conversationContext = sessionMgr.buildContextWithLimit(session.id, 8000);
      const serverLabel = `Server: ${server.name}`;

      // Search knowledge base
      let knowledgeContext: string | undefined;
      const ragPipeline = getRagPipeline();
      if (ragPipeline) {
        const ragResult = await ragPipeline.search(body.message!);
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
          body.message!, serverLabel, conversationContext,
          chatCallbacks, profileCtx.text, caveats, knowledgeContext,
        );
      } catch (retryErr) {
        if (retryErr instanceof ChatRetryExhaustedError) {
          fullResponse = '';
          const fallbackResult = await agent.chatWithFallback(
            body.message!, serverLabel, conversationContext,
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
        const { storedPlan, validation: planValidation } = buildStoredPlan(
          planId,
          result.plan.steps,
          result.plan.description ?? 'Execution plan',
          result.plan.estimatedTime,
        );
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

// POST /chat/:serverId/step-decision — User decision on a step
chat.post('/:serverId/step-decision', requirePermission('chat:use'), validateBody(StepDecisionBodySchema), async (c) => {
  const body = c.get('validatedBody') as StepDecisionBody;

  const found = resolveStepDecision(body.planId, body.stepId, body.decision);
  if (!found) {
    return c.json({ success: false, message: 'No pending decision for this step' }, 404);
  }

  logger.info(
    { operation: 'step_decision', planId: body.planId, stepId: body.stepId, decision: body.decision },
    `User decision: ${body.decision}`,
  );

  return c.json({ success: true });
});

// POST /chat/:serverId/confirm — User confirms/rejects a risky command (agentic)
chat.post('/:serverId/confirm', requirePermission('chat:use'), validateBody(ConfirmBodySchema), async (c) => {
  const body = c.get('validatedBody') as ConfirmBody;

  const pending = pendingConfirmations.get(body.confirmId);
  if (!pending) {
    return c.json({ success: false, message: 'No pending confirmation found' }, 404);
  }

  clearTimeout(pending.timer);
  pending.resolve(body.approved);
  pendingConfirmations.delete(body.confirmId);

  logger.info(
    { operation: 'agentic_confirm', confirmId: body.confirmId, approved: body.approved },
    `User ${body.approved ? 'approved' : 'rejected'} command`,
  );

  return c.json({ success: true });
});

// POST /chat/:serverId/execute — Execute confirmed plan (SSE) [legacy]
chat.post('/:serverId/execute', requirePermission('chat:use'), validateBody(ExecutePlanBodySchema), async (c) => {
  const { serverId } = c.req.param();
  const userId = c.get('userId');
  const body = c.get('validatedBody') as ExecutePlanBody;

  const repo = getServerRepository();
  const server = await repo.findById(serverId, userId);
  if (!server) {
    throw ApiError.notFound('Server');
  }

  const sessionMgr = getSessionManager();
  const plan = sessionMgr.getPlan(body.sessionId, body.planId) as StoredPlan | undefined;
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

// POST /chat/:serverId/execute/cancel — Emergency stop running execution
chat.post('/:serverId/execute/cancel', requirePermission('chat:use'), validateBody(CancelExecutionBodySchema), async (c) => {
  const { serverId } = c.req.param();
  const userId = c.get('userId');
  const body = c.get('validatedBody') as CancelExecutionBody;

  const repo = getServerRepository();
  const server = await repo.findById(serverId, userId);
  if (!server) {
    throw ApiError.notFound('Server');
  }

  const isTracked = hasActiveExecution(body.planId);

  // Resolve any pending step decisions as 'reject'
  rejectAllPendingDecisions(body.planId);

  if (!isTracked) {
    return c.json({ success: false, message: 'No active execution found for this plan' }, 404);
  }

  // Get executionId before removing (may be undefined if not yet assigned)
  const executionId = getActiveExecution(body.planId);

  // Remove from tracking map so the step loop breaks on next iteration
  removeActiveExecution(body.planId);

  let cancelled = true;

  if (executionId) {
    // ExecutionId is available — cancel the running command in the executor
    const executor = getTaskExecutor();
    cancelled = executor.cancelExecution(executionId);
  }
  // If executionId was not yet assigned, the execution just started and hasn't
  // dispatched a command yet. Removing from the tracking map is sufficient —
  // the step loop will detect the removal and break with cancelled=true.

  logger.info(
    { operation: 'plan_cancel', serverId, planId: body.planId, executionId: executionId ?? '(not yet assigned)', userId, cancelled },
    `Emergency stop: plan execution ${cancelled ? 'cancelled' : 'not found'}`,
  );

  return c.json({ success: cancelled });
});

// GET /chat/:serverId/sessions — List chat sessions
chat.get('/:serverId/sessions', requirePermission('chat:use'), async (c) => {
  const { serverId } = c.req.param();
  const userId = c.get('userId');

  const repo = getServerRepository();
  const server = await repo.findById(serverId, userId);
  if (!server) {
    throw ApiError.notFound('Server');
  }

  const sessions = await getSessionManager().listSessions(serverId, userId);
  return c.json({ sessions });
});

// GET /chat/:serverId/sessions/:sessionId — Get session details
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

// DELETE /chat/:serverId/sessions/:sessionId — Delete session
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

/** @internal Test helper — inject a pending confirmation directly. */
export function _setPendingConfirmation(
  confirmId: string,
  resolve: (approved: boolean) => void,
  timer: ReturnType<typeof setTimeout>,
): void {
  pendingConfirmations.set(confirmId, { resolve, timer });
}

/** @internal Test helper — clear all pending confirmations. */
export function _resetPendingConfirmations(): void {
  for (const pending of pendingConfirmations.values()) {
    clearTimeout(pending.timer);
  }
  pendingConfirmations.clear();
}

/** @internal Test helper — check if a confirmation is pending. */
export function _hasPendingConfirmation(confirmId: string): boolean {
  return pendingConfirmations.has(confirmId);
}

/** @internal Exported for testing. */
export { CONFIRM_TIMEOUT_MS, cleanupSessionConfirmations };
