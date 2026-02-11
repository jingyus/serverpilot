// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * AI chat routes with SSE streaming.
 *
 * Handles conversational AI interactions: message → plan generation (SSE),
 * plan execution (SSE), and session CRUD.
 *
 * @module api/routes/chat
 */

import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { randomUUID } from 'node:crypto';
import {
  ChatMessageBodySchema,
  ExecutePlanBodySchema,
  CancelExecutionBodySchema,
} from './schemas.js';
import { validateBody } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveRole, requirePermission } from '../middleware/rbac.js';
import { ApiError } from '../middleware/error-handler.js';
import { getSessionManager } from '../../core/session/manager.js';
import { getServerRepository } from '../../db/repositories/server-repository.js';
import { getProfileManager } from '../../core/profile/manager.js';
import { buildProfileContext, buildProfileCaveats } from '../../ai/profile-context.js';
import { getChatAIAgent } from './chat-ai.js';
import { getRagPipeline } from '../../knowledge/rag-pipeline.js';
import { logger } from '../../utils/logger.js';
import { findConnectedAgent } from '../../core/agent/agent-connector.js';
import { getTaskExecutor } from '../../core/task/executor.js';
import { validateCommand, validatePlan } from '../../core/security/command-validator.js';
import { getAuditLogger } from '../../core/security/audit-logger.js';
import type { InstallStep } from '@aiinstaller/shared';
import type { ChatMessageBody, ExecutePlanBody, CancelExecutionBody } from './schemas.js';
import type { ApiEnv } from './types.js';

/**
 * Tracks active plan executions: `planId → executionId`.
 * Used by the cancel endpoint to find and stop running executions.
 */
const activePlanExecutions = new Map<string, string>();

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
  const session = sessionMgr.getOrCreate(serverId, body.sessionId);

  // Store user message
  sessionMgr.addMessage(session.id, 'user', body.message);

  logger.info(
    { operation: 'chat_message', serverId, sessionId: session.id, userId },
    `Chat message received for server ${server.name}`,
  );

  // Get full server profile via ProfileManager for rich AI context
  const profileMgr = getProfileManager();
  const fullProfile = await profileMgr.getProfile(serverId, userId);

  // Build structured profile context with token budget management
  const profileCtx = buildProfileContext(fullProfile, server.name);
  const caveats = buildProfileCaveats(fullProfile);

  return streamSSE(c, async (stream) => {
    // Send sessionId to client so it can track the conversation
    await stream.writeSSE({
      event: 'message',
      data: JSON.stringify({ sessionId: session.id }),
    });

    const agent = getChatAIAgent();
    if (!agent) {
      await stream.writeSSE({
        event: 'message',
        data: JSON.stringify({
          content: 'AI service is not configured. Please set AI_PROVIDER and the corresponding API key (e.g. ANTHROPIC_API_KEY, OPENAI_API_KEY).',
        }),
      });
      await stream.writeSSE({
        event: 'complete',
        data: JSON.stringify({ success: false }),
      });
      return;
    }

    try {
      const conversationContext = sessionMgr.buildContext(session.id);
      const serverLabel = `Server: ${server.name}`;

      logger.debug(
        {
          operation: 'profile_context_inject',
          serverId,
          estimatedTokens: profileCtx.estimatedTokens,
          wasTrimmed: profileCtx.wasTrimmed,
          includedSections: profileCtx.includedSections,
          omittedSections: profileCtx.omittedSections,
          caveatsCount: caveats.length,
        },
        `Profile context: ${profileCtx.estimatedTokens} tokens, ${profileCtx.includedSections.length} sections`,
      );

      // Search knowledge base for relevant context (RAG)
      let knowledgeContext: string | undefined;
      const ragPipeline = getRagPipeline();
      if (ragPipeline) {
        const ragResult = await ragPipeline.search(body.message);
        if (ragResult.hasResults) {
          knowledgeContext = ragResult.contextText;
          logger.debug(
            {
              operation: 'rag_context_inject',
              serverId,
              resultCount: ragResult.resultCount,
              estimatedTokens: ragResult.estimatedTokens,
              durationMs: ragResult.durationMs,
            },
            `RAG context: ${ragResult.resultCount} results, ${ragResult.estimatedTokens} tokens, ${ragResult.durationMs}ms`,
          );
        }
      }

      // Stream AI response
      let fullResponse = '';

      const result = await agent.chat(
        body.message,
        serverLabel,
        conversationContext,
        {
          onToken: async (token) => {
            fullResponse += token;
            await stream.writeSSE({
              event: 'message',
              data: JSON.stringify({ content: token }),
            });
          },
        },
        profileCtx.text,
        caveats,
        knowledgeContext,
      );

      // If AI generated a plan, validate and send it as a plan event
      if (result.plan) {
        const planId = randomUUID();
        const planSteps = result.plan.steps.map((step: InstallStep, i: number) => ({
          id: step.id ?? `step-${i + 1}`,
          description: step.description,
          command: step.command,
          timeout: step.timeout ?? 30000,
          canRollback: step.canRollback ?? false,
        }));

        // Validate the entire plan using the shared security engine
        const planValidation = validatePlan(planSteps);

        const storedPlan = {
          planId,
          description: result.plan.description ?? 'Execution plan',
          steps: planValidation.steps.map((sv) => ({
            id: sv.stepId,
            description: sv.description,
            command: sv.command,
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
            stepId: s.stepId,
            command: s.command,
            reason: s.validation.classification.reason,
          })),
          estimatedTime: result.plan.estimatedTime,
        };

        sessionMgr.storePlan(session.id, storedPlan);

        await stream.writeSSE({
          event: 'plan',
          data: JSON.stringify(storedPlan),
        });

        // If plan is blocked, send a warning
        if (planValidation.action === 'blocked') {
          const blockedCmds = planValidation.blockedSteps.map(
            (s) => `  - ${s.command}: ${s.validation.classification.reason}`,
          ).join('\n');
          await stream.writeSSE({
            event: 'message',
            data: JSON.stringify({
              content: `\n⚠️ Plan contains blocked commands:\n${blockedCmds}\nThese steps will not be executed.`,
            }),
          });
        }
      }

      // Store assistant response
      if (fullResponse) {
        sessionMgr.addMessage(session.id, 'assistant', fullResponse);
      }

      await stream.writeSSE({
        event: 'complete',
        data: JSON.stringify({ success: true }),
      });
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
// POST /chat/:serverId/execute — Execute confirmed plan (SSE)
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
    const operationId = randomUUID();

    // Check if agent is connected
    const clientId = findConnectedAgent(serverId);
    if (!clientId) {
      await stream.writeSSE({
        event: 'output',
        data: JSON.stringify({
          stepId: 'connection-check',
          content: '[ERROR] No agent connected for this server. Please start the agent and try again.\n',
        }),
      });

      await stream.writeSSE({
        event: 'complete',
        data: JSON.stringify({
          success: false,
          operationId,
          error: 'Agent not connected',
        }),
      });

      return;
    }

    const executor = getTaskExecutor();
    let allSucceeded = true;
    let firstFailedStep: string | null = null;
    let cancelled = false;

    // Track this plan execution for the cancel endpoint
    activePlanExecutions.set(body.planId, '');

    // Set up progress callback for real-time output
    const executionOutputMap = new Map<string, string>();

    executor.setProgressCallback((executionId, status, output) => {
      // Track the current executionId so cancel endpoint can find it
      activePlanExecutions.set(body.planId, executionId);
      if (output) {
        const current = executionOutputMap.get(executionId) || '';
        executionOutputMap.set(executionId, current + output);
      }
    });

    const auditLogger = getAuditLogger();

    // Execute each step sequentially
    for (const step of plan.steps) {
      // Check if execution was cancelled between steps
      if (!activePlanExecutions.has(body.planId)) {
        cancelled = true;
        allSucceeded = false;
        firstFailedStep = step.id;
        break;
      }

      const startTime = Date.now();

      // Re-validate command before execution (defense-in-depth)
      const validation = validateCommand(step.command);

      // Log the validation to audit trail
      const auditEntry = await auditLogger.log({
        serverId,
        userId,
        sessionId: body.sessionId,
        command: step.command,
        validation,
      });

      // Block FORBIDDEN commands
      if (validation.action === 'blocked') {
        logger.warn(
          {
            operation: 'plan_execute',
            serverId,
            stepId: step.id,
            riskLevel: validation.classification.riskLevel,
            reason: validation.classification.reason,
          },
          `Step blocked by security validator: ${step.command}`,
        );

        await stream.writeSSE({
          event: 'step_start',
          data: JSON.stringify({
            stepId: step.id,
            command: step.command,
            description: step.description,
          }),
        });

        await stream.writeSSE({
          event: 'output',
          data: JSON.stringify({
            stepId: step.id,
            content: `[BLOCKED] Command rejected by security validator: ${validation.classification.reason}\n`,
          }),
        });

        await stream.writeSSE({
          event: 'step_complete',
          data: JSON.stringify({
            stepId: step.id,
            exitCode: -1,
            duration: Date.now() - startTime,
            success: false,
            blocked: true,
          }),
        });

        allSucceeded = false;
        firstFailedStep = step.id;
        break;
      }

      // Notify step start
      await stream.writeSSE({
        event: 'step_start',
        data: JSON.stringify({
          stepId: step.id,
          command: step.command,
          description: step.description,
        }),
      });

      // Show command about to execute
      await stream.writeSSE({
        event: 'output',
        data: JSON.stringify({
          stepId: step.id,
          content: `$ ${step.command}\n`,
        }),
      });

      try {
        // Use the validated risk level from the shared security engine
        const validatedRiskLevel = validation.classification.riskLevel as 'green' | 'yellow' | 'red' | 'critical';

        // Execute command through WebSocket
        const result = await executor.executeCommand({
          serverId,
          userId,
          clientId,
          command: step.command,
          description: step.description,
          riskLevel: validatedRiskLevel,
          type: 'execute',
          sessionId: body.sessionId,
          timeoutMs: step.timeout || 300000, // Default 5 minutes
        });

        // Stream any accumulated output
        if (result.stdout) {
          await stream.writeSSE({
            event: 'output',
            data: JSON.stringify({
              stepId: step.id,
              content: result.stdout,
            }),
          });
        }

        if (result.stderr) {
          await stream.writeSSE({
            event: 'output',
            data: JSON.stringify({
              stepId: step.id,
              content: result.stderr,
            }),
          });
        }

        const duration = Date.now() - startTime;

        // Send step completion
        await stream.writeSSE({
          event: 'step_complete',
          data: JSON.stringify({
            stepId: step.id,
            exitCode: result.exitCode,
            duration,
            success: result.success,
          }),
        });

        // Update audit log with execution result
        await auditLogger.updateExecutionResult(
          auditEntry.id,
          result.success ? 'success' : 'failed',
          result.operationId,
        );

        if (result.error === 'Cancelled') {
          cancelled = true;
          allSucceeded = false;
          firstFailedStep = step.id;
          break;
        }

        if (!result.success) {
          allSucceeded = false;
          firstFailedStep = step.id;
          logger.warn(
            {
              operation: 'plan_execute',
              serverId,
              planId: body.planId,
              stepId: step.id,
              exitCode: result.exitCode,
            },
            `Step failed: ${step.description}`,
          );
          break; // Stop execution on first failure
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Unknown error';
        logger.error(
          {
            operation: 'plan_execute',
            serverId,
            planId: body.planId,
            stepId: step.id,
            error: errorMsg,
          },
          `Step execution error: ${step.description}`,
        );

        await stream.writeSSE({
          event: 'output',
          data: JSON.stringify({
            stepId: step.id,
            content: `[ERROR] ${errorMsg}\n`,
          }),
        });

        await stream.writeSSE({
          event: 'step_complete',
          data: JSON.stringify({
            stepId: step.id,
            exitCode: -1,
            duration: Date.now() - startTime,
            success: false,
          }),
        });

        // Update audit log with failure
        await auditLogger.updateExecutionResult(auditEntry.id, 'failed');

        allSucceeded = false;
        firstFailedStep = step.id;
        break;
      }
    }

    // Clean up tracking
    activePlanExecutions.delete(body.planId);
    executor.setProgressCallback(null);

    // Store operation record
    const resultMessage = cancelled
      ? `Plan execution cancelled at step ${firstFailedStep}: ${plan.description}`
      : allSucceeded
        ? `Plan executed successfully: ${plan.description}`
        : `Plan execution failed at step ${firstFailedStep}: ${plan.description}`;

    sessionMgr.addMessage(body.sessionId, 'system', resultMessage);

    await stream.writeSSE({
      event: 'complete',
      data: JSON.stringify({
        success: allSucceeded,
        operationId,
        failedAtStep: firstFailedStep,
        cancelled,
      }),
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

  const sessions = getSessionManager().listSessions(serverId);
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

  const session = getSessionManager().getSession(sessionId);
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

  const deleted = getSessionManager().deleteSession(sessionId, serverId);
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
