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
} from './schemas.js';
import { validateBody } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { ApiError } from '../middleware/error-handler.js';
import { getSessionManager } from '../../core/session/manager.js';
import { getServerRepository } from '../../db/repositories/server-repository.js';
import { getChatAIAgent } from './chat-ai.js';
import { logger } from '../../utils/logger.js';
import { findConnectedAgent } from '../../core/agent/agent-connector.js';
import { getTaskExecutor } from '../../core/task/executor.js';
import type { InstallStep } from '@aiinstaller/shared';
import type { ChatMessageBody, ExecutePlanBody } from './schemas.js';
import type { ApiEnv } from './types.js';

const chat = new Hono<ApiEnv>();

// All chat routes require authentication
chat.use('*', requireAuth);

// ============================================================================
// POST /chat/:serverId — Send message, AI generates plan (SSE)
// ============================================================================

chat.post('/:serverId', validateBody(ChatMessageBodySchema), async (c) => {
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

  // Get server profile for environment context
  const profile = await repo.getProfile(serverId, userId);

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
          content: 'AI service is not configured. Please set ANTHROPIC_API_KEY.',
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
      const profileContext = profile
        ? `Server: ${server.name}\nOS: ${profile.osInfo?.platform ?? 'unknown'} ${profile.osInfo?.version ?? ''}\n`
        : `Server: ${server.name}\n`;

      // Stream AI response
      let fullResponse = '';

      const result = await agent.chat(
        body.message,
        profileContext,
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
      );

      // If AI generated a plan, send it as a plan event
      if (result.plan) {
        const planId = randomUUID();
        const storedPlan = {
          planId,
          description: result.plan.description ?? 'Execution plan',
          steps: result.plan.steps.map((step: InstallStep, i: number) => ({
            id: step.id ?? `step-${i + 1}`,
            description: step.description,
            command: step.command,
            riskLevel: classifyRisk(step.command),
            rollbackCommand: step.canRollback ? undefined : undefined,
            timeout: step.timeout ?? 30000,
            canRollback: step.canRollback ?? false,
          })),
          totalRisk: 'yellow' as const,
          requiresConfirmation: true,
          estimatedTime: result.plan.estimatedTime,
        };

        sessionMgr.storePlan(session.id, storedPlan);

        await stream.writeSSE({
          event: 'plan',
          data: JSON.stringify(storedPlan),
        });
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

chat.post('/:serverId/execute', validateBody(ExecutePlanBodySchema), async (c) => {
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

    // Set up progress callback for real-time output
    const executionOutputMap = new Map<string, string>();

    executor.setProgressCallback((executionId, status, output) => {
      if (output) {
        // Accumulate output for this execution
        const current = executionOutputMap.get(executionId) || '';
        executionOutputMap.set(executionId, current + output);
      }
    });

    // Execute each step sequentially
    for (const step of plan.steps) {
      const startTime = Date.now();

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
        // Execute command through WebSocket
        const result = await executor.executeCommand({
          serverId,
          userId,
          clientId,
          command: step.command,
          description: step.description,
          riskLevel: step.riskLevel as 'green' | 'yellow' | 'red' | 'critical',
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

        allSucceeded = false;
        firstFailedStep = step.id;
        break;
      }
    }

    // Clear progress callback
    executor.setProgressCallback(null);

    // Store operation record
    const resultMessage = allSucceeded
      ? `Plan executed successfully: ${plan.description}`
      : `Plan execution failed at step ${firstFailedStep}: ${plan.description}`;

    sessionMgr.addMessage(body.sessionId, 'system', resultMessage);

    await stream.writeSSE({
      event: 'complete',
      data: JSON.stringify({
        success: allSucceeded,
        operationId,
        failedAtStep: firstFailedStep,
      }),
    });
  });
});

// ============================================================================
// GET /chat/:serverId/sessions — List chat sessions
// ============================================================================

chat.get('/:serverId/sessions', async (c) => {
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

chat.get('/:serverId/sessions/:sessionId', async (c) => {
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

chat.delete('/:serverId/sessions/:sessionId', async (c) => {
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

// ============================================================================
// Helpers
// ============================================================================

/** Classify command risk level based on command content */
function classifyRisk(command: string): string {
  const cmd = command.toLowerCase().trim();

  // Forbidden patterns
  if (/rm\s+-rf\s+\/[^\/]*/i.test(cmd) || /mkfs|dd\s+if=/.test(cmd)) {
    return 'critical';
  }

  // Destructive patterns
  if (/rm\s+-rf|drop\s+database|systemctl\s+stop|service\s+.*\s+stop/i.test(cmd)) {
    return 'red';
  }

  // Modification patterns (install, config changes)
  if (/install|apt\s+update|yum|brew|pip|npm\s+i/i.test(cmd)) {
    return 'yellow';
  }

  // Read-only patterns
  return 'green';
}

export { chat };
