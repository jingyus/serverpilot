// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * AI chat routes — message handling, session CRUD, plan execution triggers.
 * Execution engine logic lives in chat-execution.ts.
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
  ConfirmBodySchema,
  RenameSessionBodySchema,
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
import type { ChatMessageBody, ExecutePlanBody, CancelExecutionBody, StepDecisionBody, ConfirmBody, RenameSessionBody } from './schemas.js';
import type { ApiEnv } from './types.js';
import { getTaskExecutor } from '../../core/task/executor.js';
import { generateChatFallback } from '../../ai/chat-fallback.js';

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
 * Tracks confirmIds that were recently expired by timeout.
 * When the timeout fires, the confirmId is moved here so the confirm endpoint
 * can distinguish "just expired" from "never existed" — avoiding a confusing
 * 404 when the user clicks approve right at the timeout boundary.
 * Entries auto-clean after RECENTLY_EXPIRED_TTL_MS.
 */
const recentlyExpired = new Set<string>();

/** How long to keep expired confirmIds in the recently-expired set (10 seconds). */
const RECENTLY_EXPIRED_TTL_MS = 10_000;

/** Lock timeout — prevents deadlocks if a request hangs (30 seconds). */
const SESSION_LOCK_TIMEOUT_MS = 30_000;

/**
 * Per-session serialization lock. Each entry is a Promise that resolves when
 * the current request for that session finishes its SSE stream.
 */
const sessionLocks = new Map<string, Promise<void>>();

/**
 * Acquire a per-session lock. Returns a `release` function that MUST be
 * called when the request finishes. Same-session requests are serialized;
 * different sessions are unaffected.
 */
async function acquireSessionLock(sessionId: string): Promise<() => void> {
  const currentLock = sessionLocks.get(sessionId);
  if (currentLock) {
    let timedOut = false;
    await Promise.race([
      currentLock,
      new Promise<void>((resolve) => setTimeout(() => { timedOut = true; resolve(); }, SESSION_LOCK_TIMEOUT_MS)),
    ]);
    if (timedOut) {
      // Previous lock holder hung — clean up the stale entry so future
      // requests don't wait on a Promise that will never resolve.
      sessionLocks.delete(sessionId);
      logger.warn(
        { operation: 'session_lock_timeout', sessionId },
        `Session lock timed out after ${SESSION_LOCK_TIMEOUT_MS}ms — forcing acquisition`,
      );
    }
  }

  let releaseFn!: () => void;
  const newLock = new Promise<void>((resolve) => {
    releaseFn = resolve;
  });
  sessionLocks.set(sessionId, newLock);

  let released = false;
  return () => {
    if (released) return;
    released = true;
    // Only delete if the Map still points to OUR lock.
    // Another request may have already replaced it after a timeout.
    if (sessionLocks.get(sessionId) === newLock) {
      sessionLocks.delete(sessionId);
    }
    releaseFn();
  };
}

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

/**
 * Check whether a session has any active work (running plan executions or
 * pending agentic confirmations). Used by the DELETE route to prevent
 * deleting a session with in-flight executions.
 */
function hasActiveSessionWork(sessionId: string): boolean {
  // Check pending agentic confirmations (keyed as `${sessionId}:${uuid}`)
  for (const confirmId of pendingConfirmations.keys()) {
    if (confirmId.startsWith(`${sessionId}:`)) {
      return true;
    }
  }

  // Check active plan executions — plans are in-memory, tied to the cached session
  const session = getSessionManager().getSessionFromCache(sessionId);
  if (session) {
    for (const planId of session.plans.keys()) {
      if (hasActiveExecution(planId)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Write an SSE event, swallowing errors if the stream is already closed
 * (e.g. client disconnected). Failures are logged but never re-thrown,
 * preventing exceptions from escaping catch blocks.
 */
async function safeWriteSSE(
  stream: SSEStreamingApi,
  event: string,
  data: string,
): Promise<boolean> {
  try {
    await stream.writeSSE({ event, data });
    return true;
  } catch (writeErr) {
    logger.warn(
      { operation: 'safe_write_sse', event, error: writeErr instanceof Error ? writeErr.message : String(writeErr) },
      `Failed to write SSE event "${event}" — stream likely closed`,
    );
    return false;
  }
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

  // Acquire per-session lock — serializes concurrent requests for the same session
  const releaseSessionLock = await acquireSessionLock(session.id);

  try {
    await sessionMgr.addMessage(session.id, userId, 'user', body.message!);
  } catch {
    releaseSessionLock();
    throw ApiError.internal('Failed to save message — please try again');
  }
  logger.info({ operation: 'chat_message', serverId, sessionId: session.id, userId }, `Chat message received for server ${server.name}`);

  return streamSSE(c, async (stream) => {
    try {
      // Send sessionId to client so it can track the conversation
      await stream.writeSSE({
        event: 'message',
        data: JSON.stringify({ sessionId: session.id }),
      });

      // Load profile inside SSE stream so failures emit SSE error events
      // instead of HTTP 500 (graceful degradation: continue without profile)
      let fullProfile = null;
      try {
        const profileMgr = getProfileManager();
        fullProfile = await profileMgr.getProfile(serverId, userId);
      } catch (profileErr) {
        logger.error(
          { operation: 'profile_load', serverId, error: profileErr instanceof Error ? profileErr.message : String(profileErr) },
          'Failed to load server profile for chat',
        );
        await safeWriteSSE(stream, 'message', JSON.stringify({
          content: '⚠️ Failed to load server profile — continuing without profile context.',
        }));
      }

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
                  recentlyExpired.add(confirmId);
                  setTimeout(() => { recentlyExpired.delete(confirmId); }, RECENTLY_EXPIRED_TTL_MS);
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
          await safeWriteSSE(stream, 'error', JSON.stringify({ error: message, reason: 'ai_unavailable' }));
          const fallback = generateChatFallback(body.message!);
          await safeWriteSSE(stream, 'message', JSON.stringify({ content: `${message}\n\n${fallback}` }));
          await safeWriteSSE(stream, 'complete', JSON.stringify({ success: false }));
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
          event: 'error',
          data: JSON.stringify({ error: 'AI service is not configured', reason: 'ai_not_configured' }),
        });
        const fallback = generateChatFallback(body.message!);
        await stream.writeSSE({ event: 'message', data: JSON.stringify({ content: `AI service is not configured\n\n${fallback}` }) });
        await stream.writeSSE({ event: 'complete', data: JSON.stringify({ success: false }) });
        return;
      }

      try {
        const profileCtx = buildProfileContext(fullProfile, server.name);
        const caveats = buildProfileCaveats(fullProfile);
        const conversationContext = sessionMgr.buildContextWithLimit(session.id, 8000);
        const serverLabel = `Server: ${server.name}`;

        // Search knowledge base (graceful degradation — never blocks chat)
        let knowledgeContext: string | undefined;
        try {
          const ragPipeline = getRagPipeline();
          if (ragPipeline) {
            const ragResult = await ragPipeline.search(body.message!);
            if (ragResult.hasResults) {
              knowledgeContext = ragResult.contextText;
            }
          }
        } catch (ragErr) {
          logger.warn(
            { operation: 'rag_search', error: ragErr instanceof Error ? ragErr.message : String(ragErr) },
            'RAG search failed, continuing without knowledge context',
          );
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
        await safeWriteSSE(stream, 'error', JSON.stringify({ error: message, reason: 'ai_unavailable' }));
        const fallback = generateChatFallback(body.message!);
        await safeWriteSSE(stream, 'message', JSON.stringify({ content: `${message}\n\n${fallback}` }));
        await safeWriteSSE(stream, 'complete', JSON.stringify({ success: false }));
      }
    } finally {
      releaseSessionLock();
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
    if (recentlyExpired.has(body.confirmId)) {
      return c.json({ success: false, expired: true, message: 'Confirmation expired' }, 410);
    }
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

    let serverProfile;
    try {
      const profileMgr = getProfileManager();
      serverProfile = await profileMgr.getProfile(serverId, userId);
    } catch (profileErr) {
      logger.error(
        { operation: 'profile_load', serverId, error: profileErr instanceof Error ? profileErr.message : String(profileErr) },
        'Failed to load server profile for plan execution',
      );
      await safeWriteSSE(stream, 'complete', JSON.stringify({
        success: false,
        error: 'Failed to load server profile',
      }));
      return;
    }

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

// GET /chat/:serverId/sessions — List chat sessions (paginated)
chat.get('/:serverId/sessions', requirePermission('chat:use'), async (c) => {
  const { serverId } = c.req.param();
  const userId = c.get('userId');

  const repo = getServerRepository();
  const server = await repo.findById(serverId, userId);
  if (!server) {
    throw ApiError.notFound('Server');
  }

  const limitRaw = c.req.query('limit');
  const offsetRaw = c.req.query('offset');

  const limit = limitRaw ? Math.max(1, Math.min(200, parseInt(limitRaw, 10) || 100)) : 100;
  const offset = offsetRaw ? Math.max(0, parseInt(offsetRaw, 10) || 0) : 0;

  const result = await getSessionManager().listSessions(serverId, userId, { limit, offset });
  return c.json({ sessions: result.sessions, total: result.total });
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

// PATCH /chat/:serverId/sessions/:sessionId — Rename session
chat.patch('/:serverId/sessions/:sessionId', requirePermission('chat:use'), validateBody(RenameSessionBodySchema), async (c) => {
  const { serverId, sessionId } = c.req.param();
  const userId = c.get('userId');
  const { name } = c.get('validatedBody') as RenameSessionBody;

  const repo = getServerRepository();
  const server = await repo.findById(serverId, userId);
  if (!server) {
    throw ApiError.notFound('Server');
  }

  const updated = await getSessionManager().renameSession(sessionId, serverId, userId, name);
  if (!updated) {
    throw ApiError.notFound('Session');
  }

  logger.info(
    { operation: 'session_rename', serverId, sessionId, userId },
    'Chat session renamed',
  );

  return c.json({ success: true });
});

// GET /chat/:serverId/sessions/:sessionId/export — Export session as JSON or Markdown
chat.get('/:serverId/sessions/:sessionId/export', requirePermission('chat:use'), async (c) => {
  const { serverId, sessionId } = c.req.param();
  const userId = c.get('userId');
  const query = ExportSessionQuerySchema.parse(c.req.query());

  const server = await getServerRepository().findById(serverId, userId);
  if (!server) throw ApiError.notFound('Server');

  const session = await getSessionManager().getSession(sessionId, userId);
  if (!session || session.serverId !== serverId) throw ApiError.notFound('Session');

  const messages: ExportMessage[] = session.messages.map((m) => ({
    role: m.role, content: m.content, timestamp: m.timestamp,
  }));
  const exportedAt = new Date().toISOString();
  const title = session.name ?? 'Chat Session';
  const exportData: ConversationExport = {
    id: session.id, title, serverId, createdAt: session.createdAt,
    exportedAt, format: query.format, messages,
  };

  const date = exportedAt.slice(0, 10);
  const safeName = session.name
    ? session.name.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '_').slice(0, 50)
    : 'chat';
  const ext = query.format === 'markdown' ? 'md' : 'json';
  const filename = `${safeName}-${date}.${ext}`;
  const contentType = query.format === 'markdown' ? 'text/markdown; charset=utf-8' : 'application/json; charset=utf-8';

  c.header('Content-Type', contentType);
  c.header('Content-Disposition', `attachment; filename="${filename}"`);
  c.header('Cache-Control', 'no-cache');

  if (query.format === 'markdown') {
    return c.text(buildExportMarkdown(title, server.name, exportedAt, messages));
  }
  return c.json(exportData);
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

  // Prevent deleting a session with active plan executions or pending confirmations
  if (hasActiveSessionWork(sessionId)) {
    return c.json(
      { error: 'Session has active executions — cancel them before deleting' },
      409,
    );
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

/** @internal Test helper — clear all pending confirmations and recently-expired entries. */
export function _resetPendingConfirmations(): void {
  for (const pending of pendingConfirmations.values()) {
    clearTimeout(pending.timer);
  }
  pendingConfirmations.clear();
  recentlyExpired.clear();
}

/** @internal Test helper — check if a confirmation is pending. */
export function _hasPendingConfirmation(confirmId: string): boolean {
  return pendingConfirmations.has(confirmId);
}

/** @internal Test helper — add a confirmId to the recently-expired set. */
export function _addRecentlyExpired(confirmId: string): void {
  recentlyExpired.add(confirmId);
}

/** @internal Test helper — check if a confirmId is in the recently-expired set. */
export function _hasRecentlyExpired(confirmId: string): boolean {
  return recentlyExpired.has(confirmId);
}

/** @internal Test helper — clear all session locks. */
export function _resetSessionLocks(): void {
  sessionLocks.clear();
}

/** @internal Test helper — check if a session lock exists. */
export function _hasSessionLock(sessionId: string): boolean {
  return sessionLocks.has(sessionId);
}

/** @internal Test helper — get the raw lock Promise for identity checks. */
export function _getSessionLock(sessionId: string): Promise<void> | undefined {
  return sessionLocks.get(sessionId);
}

/** @internal Exported for testing. */
export {
  CONFIRM_TIMEOUT_MS, SESSION_LOCK_TIMEOUT_MS, RECENTLY_EXPIRED_TTL_MS,
  cleanupSessionConfirmations, hasActiveSessionWork, safeWriteSSE,
  acquireSessionLock,
};
