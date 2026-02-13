// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Message handlers for AI Installer WebSocket server.
 *
 * Each handler processes a specific message type received from the agent client.
 * Handlers interact with the InstallServer to manage sessions and send responses.
 *
 * @module api/handlers
 */

import type { InstallServer } from './server.js';
import type {
  SessionCreateMessage,
  SessionCompleteMessage,
  EnvReportMessage,
  StepCompleteMessage,
  StepOutputMessage,
  ErrorOccurredMessage,
  AuthRequestMessage,
  MetricsReportMessage,
  Message,
  ErrorContext,
} from '@aiinstaller/shared';
import { MessageType, createMessage, SessionStatus, PROTOCOL_VERSION, checkVersionCompatibility } from '@aiinstaller/shared';
import type { InstallAIAgent } from '../ai/agent.js';
import { generateInstallPlan, generateFallbackPlan } from '../ai/planner.js';
import { diagnoseError } from '../ai/error-analyzer.js';
import { createContextLogger, logMessageRoute, logAIOperation, logError } from '../utils/logger.js';
import { randomUUID } from 'node:crypto';
import { authenticateDevice, createAuthResponse } from './auth-handler.js';
import { checkRateLimit, incrementAICall, logAICall, createQuotaExceededMessage, type AIOperationType } from './rate-limiter.js';
import { getResponseTimeTracker } from '../utils/response-time-tracker.js';
import { getSnapshotService } from '../core/snapshot/snapshot-service.js';
import { getRollbackService } from '../core/rollback/rollback-service.js';
import { getTaskExecutor } from '../core/task/executor.js';

// ============================================================================
// Types
// ============================================================================

/** Result of a handler invocation */
export interface HandlerResult {
  /** Whether the handler completed successfully */
  success: boolean;
  /** Error message if the handler failed */
  error?: string;
}

// ============================================================================
// Handler Functions
// ============================================================================

/**
 * Handle an authentication request from the agent.
 *
 * Validates device credentials, auto-registers new devices,
 * and returns authentication result with quota information.
 *
 * @param server - The InstallServer instance
 * @param clientId - The client that sent the message
 * @param message - The auth.request message
 * @returns Result indicating success or failure
 */
export async function handleAuthRequest(
  server: InstallServer,
  clientId: string,
  message: AuthRequestMessage,
): Promise<HandlerResult> {
  try {
    const requestId = message.requestId ?? randomUUID();

    const logger = createContextLogger({
      requestId,
      clientId,
      deviceId: message.payload.deviceId,
    });

    const agentProtocolVersion = message.payload.protocolVersion;

    logMessageRoute('auth.request', {
      requestId,
      clientId,
    }, {
      deviceId: message.payload.deviceId,
      hasToken: !!message.payload.deviceToken,
      platform: message.payload.platform,
      protocolVersion: agentProtocolVersion ?? 'none',
    });

    // Check protocol version compatibility
    const versionCheck = checkVersionCompatibility(agentProtocolVersion);
    if (!versionCheck.compatible) {
      logger.warn({
        agentVersion: agentProtocolVersion,
        serverVersion: PROTOCOL_VERSION,
        severity: versionCheck.severity,
      }, `Protocol version incompatible: ${versionCheck.message}`);

      // Reject with version mismatch error
      const rejectResponse = createAuthResponse(
        {
          success: false,
          error: versionCheck.message,
        },
        requestId,
        agentProtocolVersion,
      );
      server.send(clientId, rejectResponse);

      // Close connection after sending error
      setTimeout(() => {
        const client = server['clients'].get(clientId);
        if (client) {
          client.ws.close(4010, 'Protocol version incompatible');
        }
      }, 100);

      return { success: true };
    }

    if (versionCheck.severity === 'warn') {
      logger.warn({
        agentVersion: agentProtocolVersion ?? 'none',
        serverVersion: PROTOCOL_VERSION,
      }, `Protocol version warning: ${versionCheck.message}`);
    }

    // Authenticate the device
    const authResult = await authenticateDevice(message);

    // Send authentication response (includes version check result)
    const response = createAuthResponse(authResult, requestId, agentProtocolVersion);
    server.send(clientId, response);

    // If authentication succeeded, mark client as authenticated
    if (authResult.success && authResult.deviceToken) {
      server.authenticateClient(
        clientId,
        message.payload.deviceId,
        authResult.deviceToken
      );

      // Update server status to 'online' and publish event
      const serverId = message.payload.deviceId;
      try {
        const { getServerRepository } = await import('../db/repositories/server-repository.js');
        const { getServerStatusBus } = await import('../core/server-status-bus.js');
        const repo = getServerRepository();
        await repo.updateStatus(serverId, 'online');
        getServerStatusBus().publish({
          serverId,
          status: 'online',
          timestamp: new Date().toISOString(),
        });
      } catch (statusErr) {
        // Non-blocking: status update failure should not break auth
        logError(statusErr as Error, { clientId, serverId }, 'Failed to update server status to online');
      }

      logger.info({
        plan: authResult.plan,
        quotaRemaining: authResult.quota?.remaining,
      }, 'Client authenticated successfully');
    } else {
      logger.warn({
        error: authResult.error,
        banned: authResult.banned,
      }, 'Authentication failed');

      // Close connection on failed authentication
      setTimeout(() => {
        const client = server['clients'].get(clientId);
        if (client) {
          client.ws.close(4403, authResult.error || 'Authentication failed');
        }
      }, 100);
    }

    return { success: true };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logError(err as Error, { clientId, operation: 'auth.request' }, 'Failed to process authentication');
    return { success: false, error: errorMsg };
  }
}

/**
 * Handle a session creation request from the agent.
 *
 * Creates a new installation session and sends back a confirmation
 * with the session ID and initial status.
 *
 * @param server - The InstallServer instance
 * @param clientId - The client that sent the message
 * @param message - The session.create message
 * @returns Result indicating success or failure
 */
export function handleCreateSession(
  server: InstallServer,
  clientId: string,
  message: SessionCreateMessage,
): HandlerResult {
  try {
    const session = server.createSession(clientId, message.payload);
    const requestId = message.requestId ?? randomUUID();

    const logger = createContextLogger({
      requestId,
      sessionId: session.id,
      clientId,
    });

    logMessageRoute('session.create', {
      requestId,
      sessionId: session.id,
      clientId,
    }, {
      software: message.payload.software,
      version: message.payload.version,
    });

    // Send initial plan.receive with empty plan
    // Full plan will be generated after env.report is received and processed
    const initialPlan = {
      steps: [],
      estimatedTime: 0,
      risks: [],
    };
    server.send(clientId, createMessage(MessageType.PLAN_RECEIVE, initialPlan, requestId));

    logger.info('Session created successfully');
    return { success: true };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logError(err as Error, { clientId, operation: 'session.create' }, 'Failed to create session');
    return { success: false, error: errorMsg };
  }
}

/**
 * Handle an environment report from the agent.
 *
 * Receives the agent's environment information, calls the AI to analyze it,
 * and sends back an environment analysis result.
 *
 * @param server - The InstallServer instance
 * @param clientId - The client that sent the message
 * @param message - The env.report message
 * @param aiAgent - Optional AI agent for environment analysis
 * @returns Result indicating success or failure
 */
export async function handleEnvReport(
  server: InstallServer,
  clientId: string,
  message: EnvReportMessage,
  aiAgent?: InstallAIAgent,
): Promise<HandlerResult> {
  try {
    const sessionId = server.getClientSessionId(clientId);
    if (!sessionId) {
      // No install session — check if this is a daemon-mode agent (has auth credentials).
      // Daemon agents send env.report on connect but don't go through the install flow.
      const clientAuth = server.getClientAuth(clientId);
      if (clientAuth) {
        // Authenticated daemon-mode agent — silently succeed
        return { success: true };
      }
      // No auth credentials — this is an install-flow client without a session
      logError(
        new Error('No session found'),
        { clientId, operation: 'env.report' },
        'No session found for client'
      );
      return { success: false, error: `No session found for client ${clientId}` };
    }

    const session = server.getSession(sessionId);
    if (!session) {
      logError(
        new Error('Session not found'),
        { clientId, sessionId, operation: 'env.report' },
        'Session not found'
      );
      return { success: false, error: `Session ${sessionId} not found` };
    }

    const requestId = message.requestId ?? randomUUID();
    const logger = createContextLogger({
      requestId,
      sessionId,
      clientId,
    });

    logMessageRoute('env.report', {
      requestId,
      sessionId,
      clientId,
    }, {
      os: message.payload.os.platform,
      arch: message.payload.os.arch,
    });

    // Update session status to detecting
    server.updateSessionStatus(sessionId, SessionStatus.DETECTING);

    const software = session.software;
    const environment = message.payload;
    const version = session.version;

    let environmentReady = true; // Assume ready by default

    // Check rate limit before AI operations
    const clientAuth = server.getClientAuth(clientId);
    if (clientAuth && aiAgent) {
      const rateLimitCheck = await checkRateLimit(clientAuth.deviceId, clientAuth.deviceToken);

      if (!rateLimitCheck.allowed) {
        logger.warn(
          {
            deviceId: clientAuth.deviceId,
            error: rateLimitCheck.error,
            errorCode: rateLimitCheck.errorCode,
          },
          'Rate limit exceeded for AI operation'
        );

        // Send quota exceeded error message
        const errorMsg = rateLimitCheck.upgradeMessage || rateLimitCheck.error || 'Quota exceeded';
        server.send(clientId, createMessage(MessageType.AI_STREAM_START, {
          operation: 'quota_check',
        }, requestId));

        server.send(clientId, createMessage(MessageType.AI_STREAM_TOKEN, {
          token: `\n⚠️  ${errorMsg}\n`,
          accumulated: '',
        }, requestId));

        server.send(clientId, createMessage(MessageType.AI_STREAM_COMPLETE, {
          text: errorMsg,
          inputTokens: 0,
          outputTokens: 0,
        }, requestId));

        // Return empty plan (no AI analysis)
        const fallbackPlan = generateFallbackPlan(environment, software, version);
        server.send(clientId, createMessage(MessageType.PLAN_RECEIVE, fallbackPlan, requestId));

        return { success: true };
      }
    }

    // No AI agent — send error notification and use fallback plan
    if (!aiAgent) {
      logger.warn({ sessionId, clientId }, 'No AI agent, using fallback plan');
      server.updateSessionStatus(sessionId, SessionStatus.PLANNING);
      server.send(clientId, createMessage(MessageType.AI_STREAM_ERROR, {
        error: 'AI service is not available. Using template-based fallback plan.',
      }, requestId));
      server.send(clientId, createMessage(MessageType.PLAN_RECEIVE,
        generateFallbackPlan(environment, software, version), requestId));
      return { success: true };
    }

    // Analyze the environment with AI
    if (aiAgent) {
      logAIOperation('call', { requestId, sessionId, clientId }, { operation: 'analyzeEnvironment' });

      // Track AI response time
      const tracker = getResponseTimeTracker();
      const endEnvTimer = tracker.startTimer('envAnalysis');

      // Call AI to analyze environment
      const analysisResult = await aiAgent.analyzeEnvironment(environment, software);
      endEnvTimer({ fromCache: false });

      if (analysisResult.success && analysisResult.data) {
        logger.info({ operation: 'ai_analysis', result: 'success' }, 'Environment analysis completed');

        // Send AI stream messages to show analysis in progress
        const analysis = analysisResult.data;

        // Send analysis summary as AI stream
        server.send(clientId, createMessage(MessageType.AI_STREAM_START, {
          operation: 'environment_analysis',
        }, requestId));

        server.send(clientId, createMessage(MessageType.AI_STREAM_TOKEN, {
          token: `Environment Analysis:\n${analysis.summary}\n\nReady: ${analysis.ready}\n\nIssues:\n${analysis.issues.map(i => `- ${i}`).join('\n')}\n\nRecommendations:\n${analysis.recommendations.map(r => `- ${r}`).join('\n')}`,
          accumulated: '',
        }, requestId));

        // Use actual token counts from AI agent response
        const analysisUsage = analysisResult.usage ?? { inputTokens: 0, outputTokens: 0 };
        server.send(clientId, createMessage(MessageType.AI_STREAM_COMPLETE, {
          text: 'Analysis complete',
          inputTokens: analysisUsage.inputTokens,
          outputTokens: analysisUsage.outputTokens,
        }, requestId));

        // Update environment readiness
        environmentReady = analysis.ready;

        // Update session status based on readiness
        if (!analysis.ready) {
          server.updateSessionStatus(sessionId, SessionStatus.ERROR);
          logger.warn({ operation: 'env_analysis', ready: false }, 'Environment not ready for installation');
          return { success: true }; // Don't generate plan if environment not ready
        }
      } else {
        // AI analysis failed, log error but continue
        logAIOperation('error', { requestId, sessionId, clientId }, {
          operation: 'analyzeEnvironment',
          error: analysisResult.error,
        });
      }
    }

    // Generate installation plan (only if environment is ready)
    server.updateSessionStatus(sessionId, SessionStatus.PLANNING);

    // Create streaming callbacks for plan generation
    const callbacks = {
      onStart: () => {
        server.send(clientId, createMessage(MessageType.AI_STREAM_START, {
          operation: 'plan_generation',
        }, requestId));
      },
      onToken: (token: string) => {
        server.send(clientId, createMessage(MessageType.AI_STREAM_TOKEN, {
          token,
          accumulated: '',
        }, requestId));
      },
      onComplete: (fullText: string, usage: { inputTokens: number; outputTokens: number }) => {
        // Use actual token counts from streaming response
        server.send(clientId, createMessage(MessageType.AI_STREAM_COMPLETE, {
          text: 'Analysis complete',
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
        }, requestId));
      },
      onError: (error: Error) => {
        logAIOperation('error', { requestId, sessionId, clientId }, {
          operation: 'planGeneration',
          error: error.message,
        });
      },
    };

    let plan;
    let planUsage;
    if (aiAgent) {
      logAIOperation('call', { requestId, sessionId, clientId }, { operation: 'generateInstallPlan' });

      // Track AI response time for plan generation
      const tracker = getResponseTimeTracker();
      const endPlanTimer = tracker.startTimer('planGeneration');

      // Generate plan with AI and knowledge base
      const planResult = await generateInstallPlan(aiAgent, environment, software, version, callbacks);
      plan = planResult.plan;
      planUsage = planResult.usage;
      endPlanTimer({ fromCache: !plan });
    }

    // If AI plan generation failed, notify and use fallback plan
    if (!plan) {
      logAIOperation('fallback', { requestId, sessionId, clientId }, { operation: 'generateInstallPlan' });
      server.send(clientId, createMessage(MessageType.AI_STREAM_ERROR, {
        error: 'AI plan generation failed. Using template-based fallback plan.',
      }, requestId));
      plan = generateFallbackPlan(environment, software, version);
    } else {
      // Use actual token counts from AI response (safe fallback to 0 if not available)
      const actualInputTokens = planUsage?.inputTokens ?? 0;
      const actualOutputTokens = planUsage?.outputTokens ?? 0;

      logger.info({
        requestId,
        sessionId,
        clientId,
        operation: 'plan_generation',
        stepsCount: plan.steps.length,
        inputTokens: actualInputTokens,
        outputTokens: actualOutputTokens,
      }, 'Install plan generated successfully');

      // Increment AI call count and log the call with actual token usage
      if (clientAuth) {
        await incrementAICall(clientAuth.deviceId, clientAuth.deviceToken, 'planGeneration');

        await logAICall(clientAuth.deviceId, clientAuth.deviceToken, {
          sessionId,
          operation: 'planGeneration',
          provider: 'claude',
          model: 'claude-3-5-sonnet-20241022',
          inputTokens: actualInputTokens,
          outputTokens: actualOutputTokens,
          success: true,
        });
      }
    }

    // Send the installation plan to the client
    server.send(clientId, createMessage(MessageType.PLAN_RECEIVE, plan, requestId));

    return { success: true };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const sessionId = server.getClientSessionId(clientId);
    logError(err as Error, { clientId, sessionId: sessionId ?? undefined, operation: 'env.report' }, 'Failed to handle environment report');
    return { success: false, error: errorMsg };
  }
}

/**
 * Handle a step.output message from the agent.
 *
 * Routes the streaming output to the TaskExecutor, which will forward it
 * to any registered progress callbacks for real-time output display.
 *
 * @param server - The InstallServer instance
 * @param clientId - The client that sent the message
 * @param message - The step.output message
 * @returns Result indicating success or failure
 */
export function handleStepOutput(
  server: InstallServer,
  clientId: string,
  message: StepOutputMessage,
): HandlerResult {
  try {
    // Route output to TaskExecutor if available
    // If the executor isn't initialized (e.g., in tests), just succeed silently
    try {
      const executor = getTaskExecutor(server);
      executor.handleStepOutput(message.payload.stepId, message.payload.output);
    } catch {
      // TaskExecutor not initialized - skip routing (likely in test environment)
    }

    return { success: true };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logError(err as Error, { clientId, operation: 'step.output' }, 'Failed to handle step output');
    return { success: false, error: errorMsg };
  }
}

/**
 * Handle a step completion report from the agent.
 *
 * Processes the result of a completed step. If the step failed,
 * updates the session status to "error". If successful, keeps the
 * session in "executing" status.
 *
 * @param server - The InstallServer instance
 * @param clientId - The client that sent the message
 * @param message - The step.complete message
 * @returns Result indicating success or failure
 */
export function handleStepComplete(
  server: InstallServer,
  clientId: string,
  message: StepCompleteMessage,
): HandlerResult {
  try {
    // IMPORTANT: Route results to TaskExecutor FIRST, before any session checks.
    // Chat-initiated executions (via executor.executeCommand) don't use install sessions,
    // so the session lookup below may fail for daemon-mode agents. The executor must
    // still receive the result to resolve its awaiting Promise.
    try {
      const executor = getTaskExecutor(server);
      executor.handleStepComplete(message.payload);
    } catch {
      // TaskExecutor not initialized - skip routing (likely in test environment)
    }

    // Session status updates (for install-flow sessions only)
    const sessionId = server.getClientSessionId(clientId);
    if (!sessionId) {
      // Check if this is a daemon-mode agent (has auth credentials).
      // Daemon agents run chat commands without install sessions — the executor
      // routing above already handled the result.
      const clientAuth = server.getClientAuth(clientId);
      if (clientAuth) {
        return { success: true };
      }
      // No auth credentials — this is an install-flow client without a session
      logError(
        new Error('No session found'),
        { clientId, operation: 'step.complete' },
        'No session found for client'
      );
      return { success: false, error: `No session found for client ${clientId}` };
    }

    const session = server.getSession(sessionId);
    if (!session) {
      logError(
        new Error('Session not found'),
        { clientId, sessionId, operation: 'step.complete' },
        'Session not found'
      );
      return { success: false, error: `Session ${sessionId} not found` };
    }

    const requestId = message.requestId ?? randomUUID();
    const logger = createContextLogger({ requestId, sessionId, clientId });

    logMessageRoute('step.complete', { requestId, sessionId, clientId }, {
      stepId: message.payload.stepId,
      success: message.payload.success,
    });

    if (message.payload.success) {
      server.updateSessionStatus(sessionId, SessionStatus.EXECUTING);
      logger.info({ stepId: message.payload.stepId }, 'Step completed successfully');
    } else {
      server.updateSessionStatus(sessionId, SessionStatus.ERROR);
      logger.warn({
        stepId: message.payload.stepId,
        exitCode: message.payload.exitCode,
        stderr: message.payload.stderr,
      }, 'Step failed');
    }

    return { success: true };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logError(err as Error, { clientId, operation: 'step.complete' }, 'Failed to handle step complete');
    return { success: false, error: errorMsg };
  }
}

/**
 * Handle an error report from the agent.
 *
 * Updates the session status to "error" and sends back a fix suggestion
 * message with AI-powered diagnosis and fix strategies. Streams the AI's
 * diagnostic process back to the client for real-time feedback.
 *
 * @param server - The InstallServer instance
 * @param clientId - The client that sent the message
 * @param message - The error.occurred message
 * @param aiAgent - Optional AI agent for intelligent error diagnosis
 * @returns Result indicating success or failure
 */
export async function handleErrorOccurred(
  server: InstallServer,
  clientId: string,
  message: ErrorOccurredMessage,
  aiAgent?: InstallAIAgent,
): Promise<HandlerResult> {
  try {
    const sessionId = server.getClientSessionId(clientId);
    if (!sessionId) {
      logError(new Error('No session found'), { clientId, operation: 'error.occurred' }, 'No session found for client');
      return { success: false, error: `No session found for client ${clientId}` };
    }

    const session = server.getSession(sessionId);
    if (!session) {
      logError(new Error('Session not found'), { clientId, sessionId, operation: 'error.occurred' }, 'Session not found');
      return { success: false, error: `Session ${sessionId} not found` };
    }

    const requestId = message.requestId ?? randomUUID();
    const logger = createContextLogger({ requestId, sessionId, clientId });

    logMessageRoute('error.occurred', { requestId, sessionId, clientId }, {
      stepId: message.payload.stepId,
      command: message.payload.command,
      exitCode: message.payload.exitCode,
    });

    // Update session status to error
    server.updateSessionStatus(sessionId, SessionStatus.ERROR);

    // Check rate limit before AI error diagnosis
    const clientAuth = server.getClientAuth(clientId);
    if (clientAuth && aiAgent) {
      const rateLimitCheck = await checkRateLimit(clientAuth.deviceId, clientAuth.deviceToken);

      if (!rateLimitCheck.allowed) {
        logger.warn(
          {
            deviceId: clientAuth.deviceId,
            error: rateLimitCheck.error,
            errorCode: rateLimitCheck.errorCode,
          },
          'Rate limit exceeded for error diagnosis'
        );

        // Send basic retry suggestion without AI
        const response = createMessage(MessageType.FIX_SUGGEST, [
          {
            id: 'retry',
            description: `Retry the failed command: ${message.payload.command}\n\n⚠️  ${rateLimitCheck.upgradeMessage || 'Quota exceeded'}`,
            commands: [message.payload.command],
            confidence: 0.5,
            risk: 'low',
            requiresSudo: false,
          },
        ], requestId);

        server.send(clientId, response);
        return { success: true };
      }
    }

    // If no AI agent is available, send a basic retry suggestion
    if (!aiAgent) {
      logger.warn('No AI agent available, sending basic retry suggestion');
      const response = createMessage(MessageType.FIX_SUGGEST, [
        {
          id: 'retry',
          description: `Retry the failed command: ${message.payload.command}`,
          commands: [message.payload.command],
          confidence: 0.5,
          risk: 'low',
          requiresSudo: false,
        },
      ], requestId);

      server.send(clientId, response);
      return { success: true };
    }

    // Use AI to diagnose the error and suggest fixes with streaming
    logAIOperation('call', { requestId, sessionId, clientId }, { operation: 'diagnoseError' });

    const errorContext: ErrorContext = {
      ...message.payload,
    };

    // Track AI response time for error diagnosis
    const tracker = getResponseTimeTracker();
    const endDiagTimer = tracker.startTimer('errorDiagnosis');

    // Stream AI diagnostic tokens back to the client
    const streamCallback = (token: string) => {
      if (token) {
        const streamMsg = createMessage(
          MessageType.AI_STREAM_TOKEN,
          { token, accumulated: '' },
          requestId,
        );
        server.send(clientId, streamMsg);
      }
    };

    const diagnosisResult = await diagnoseError(
      errorContext,
      aiAgent,
      streamCallback,
    );
    endDiagTimer({ fromCache: diagnosisResult.usedRuleLibrary ?? false });

    // Use actual token usage from diagnosis result
    const diagnosisUsage = diagnosisResult.usage ?? { inputTokens: 0, outputTokens: 0 };
    const streamCompleteMsg = createMessage(
      MessageType.AI_STREAM_COMPLETE,
      {
        text: 'Error diagnosis complete',
        inputTokens: diagnosisUsage.inputTokens,
        outputTokens: diagnosisUsage.outputTokens,
      },
      requestId,
    );
    server.send(clientId, streamCompleteMsg);

    if (!diagnosisResult.success || !diagnosisResult.fixStrategies) {
      // If AI diagnosis fails, send a basic fallback
      logAIOperation('fallback', { requestId, sessionId, clientId }, {
        operation: 'diagnoseError',
        error: diagnosisResult.error,
      });

      const fallbackResponse = createMessage(MessageType.FIX_SUGGEST, [
        {
          id: 'retry',
          description: `Retry the failed command: ${message.payload.command}`,
          commands: [message.payload.command],
          confidence: 0.5,
          risk: 'low',
          requiresSudo: false,
        },
      ], requestId);

      server.send(clientId, fallbackResponse);
      return { success: true };
    }

    // Use actual token counts from diagnosis (safe fallback to 0)
    const actualDiagInputTokens = diagnosisResult.usage?.inputTokens ?? 0;
    const actualDiagOutputTokens = diagnosisResult.usage?.outputTokens ?? 0;

    logger.info({
      operation: 'error_diagnosis',
      strategiesCount: diagnosisResult.fixStrategies.length,
      inputTokens: actualDiagInputTokens,
      outputTokens: actualDiagOutputTokens,
      usedRuleLibrary: diagnosisResult.usedRuleLibrary ?? false,
    }, 'Error diagnosis completed');

    // Increment AI call count and log the call with actual token usage
    // Only log if AI was actually used (not rule library)
    if (clientAuth && !diagnosisResult.usedRuleLibrary) {
      await incrementAICall(clientAuth.deviceId, clientAuth.deviceToken, 'errorDiagnosis');

      await logAICall(clientAuth.deviceId, clientAuth.deviceToken, {
        sessionId,
        operation: 'errorDiagnosis',
        provider: 'claude',
        model: 'claude-3-5-sonnet-20241022',
        inputTokens: actualDiagInputTokens,
        outputTokens: actualDiagOutputTokens,
        success: true,
      });
    }

    // Send AI-generated fix strategies
    const response = createMessage(
      MessageType.FIX_SUGGEST,
      diagnosisResult.fixStrategies,
      requestId,
    );

    server.send(clientId, response);

    return { success: true };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logError(err as Error, { clientId, operation: 'error.occurred' }, 'Failed to handle error occurred');
    return { success: false, error: errorMsg };
  }
}

/**
 * Handle a snapshot response from the agent.
 *
 * Routes the response to the SnapshotService to complete the
 * pending snapshot request.
 */
async function handleSnapshotResponse(
  message: Extract<Message, { type: 'snapshot.response' }>,
): Promise<HandlerResult> {
  try {
    const snapshotService = getSnapshotService();
    const handled = await snapshotService.handleSnapshotResponse(message.payload);
    if (!handled) {
      return { success: false, error: 'No pending snapshot request matched' };
    }
    return { success: true };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logError(err as Error, { operation: 'snapshot.response' }, 'Failed to handle snapshot response');
    return { success: false, error: errorMsg };
  }
}

/**
 * Handle a rollback response from the agent.
 *
 * Routes the response to the RollbackService to complete the
 * pending rollback request.
 */
async function handleRollbackResponse(
  message: Extract<Message, { type: 'rollback.response' }>,
): Promise<HandlerResult> {
  try {
    const rollbackService = getRollbackService();
    const handled = await rollbackService.handleRollbackResponse(message.payload);
    if (!handled) {
      return { success: false, error: 'No pending rollback request matched' };
    }
    return { success: true };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logError(err as Error, { operation: 'rollback.response' }, 'Failed to handle rollback response');
    return { success: false, error: errorMsg };
  }
}

/**
 * Handle a metrics report from the agent.
 *
 * Stores system metrics (CPU, memory, disk, network) in the database
 * for monitoring and alerting purposes.
 *
 * @param server - The InstallServer instance
 * @param clientId - The client that sent the message
 * @param message - The metrics.report message
 * @returns Result indicating success or failure
 */
export async function handleMetricsReport(
  server: InstallServer,
  clientId: string,
  message: MetricsReportMessage,
): Promise<HandlerResult> {
  try {
    const requestId = message.requestId ?? randomUUID();
    const logger = createContextLogger({
      requestId,
      clientId,
      serverId: message.payload.serverId,
    });

    logMessageRoute('metrics.report', {
      requestId,
      clientId,
    }, {
      serverId: message.payload.serverId,
      cpuUsage: message.payload.cpuUsage.toFixed(2),
      memoryUsageMB: (message.payload.memoryUsage / 1024 / 1024).toFixed(2),
    });

    // Import metrics repository
    const { getMetricsRepository } = await import('../db/repositories/metrics-repository.js');
    const metricsRepo = getMetricsRepository();

    // Store metrics in database
    const recorded = await metricsRepo.record({
      serverId: message.payload.serverId,
      cpuUsage: message.payload.cpuUsage,
      memoryUsage: message.payload.memoryUsage,
      memoryTotal: message.payload.memoryTotal,
      diskUsage: message.payload.diskUsage,
      diskTotal: message.payload.diskTotal,
      networkIn: message.payload.networkIn,
      networkOut: message.payload.networkOut,
    });

    // Publish to metrics bus for real-time SSE subscribers
    const { getMetricsBus } = await import('../core/metrics/metrics-bus.js');
    getMetricsBus().publish(message.payload.serverId, {
      id: recorded.id,
      serverId: recorded.serverId,
      cpuUsage: recorded.cpuUsage,
      memoryUsage: recorded.memoryUsage,
      memoryTotal: recorded.memoryTotal,
      diskUsage: recorded.diskUsage,
      diskTotal: recorded.diskTotal,
      networkIn: recorded.networkIn,
      networkOut: recorded.networkOut,
      timestamp: recorded.timestamp,
    });

    logger.debug('Metrics stored and published');

    return { success: true };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logError(err as Error, { clientId, operation: 'metrics.report' }, 'Failed to handle metrics report');
    return { success: false, error: errorMsg };
  }
}

/**
 * Handle a session.complete message from the agent.
 *
 * Updates the session status to completed or failed based on the payload.
 */
export function handleSessionComplete(
  server: InstallServer,
  clientId: string,
  message: SessionCompleteMessage,
): HandlerResult {
  try {
    const sessionId = server.getClientSessionId(clientId);
    if (!sessionId) {
      logError(
        new Error('No session found'),
        { clientId, operation: 'session.complete' },
        'No session found for client'
      );
      return { success: false, error: `No session found for client ${clientId}` };
    }

    const requestId = message.requestId ?? randomUUID();
    const logger = createContextLogger({ requestId, sessionId, clientId });

    logMessageRoute('session.complete', { requestId, sessionId, clientId }, {
      success: message.payload.success,
      summary: message.payload.summary,
    });

    const status = message.payload.success ? SessionStatus.COMPLETED : SessionStatus.ERROR;
    server.updateSessionStatus(sessionId, status);

    logger.info({
      success: message.payload.success,
      summary: message.payload.summary,
    }, 'Session completed');

    return { success: true };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logError(err as Error, { clientId, operation: 'session.complete' }, 'Failed to handle session complete');
    return { success: false, error: errorMsg };
  }
}

// ============================================================================
// Message Router
// ============================================================================

/**
 * Route a message to the appropriate handler based on its type.
 *
 * @param server - The InstallServer instance
 * @param clientId - The client that sent the message
 * @param message - The protocol message to route
 * @param aiAgent - Optional AI agent for intelligent analysis
 * @returns Result indicating success or failure
 */
export async function routeMessage(
  server: InstallServer,
  clientId: string,
  message: Message,
  aiAgent?: InstallAIAgent,
): Promise<HandlerResult> {
  // Handle authentication request (always allowed)
  if (message.type === MessageType.AUTH_REQUEST) {
    return await handleAuthRequest(server, clientId, message);
  }

  // For all other messages, check if client is authenticated
  if (!server.isClientAuthenticated(clientId)) {
    logError(
      new Error('Unauthenticated client attempted to send message'),
      { clientId, messageType: message.type },
      'Authentication required'
    );
    return {
      success: false,
      error: 'Authentication required. Send auth.request message first.',
    };
  }

  // Route authenticated messages
  switch (message.type) {
    case MessageType.SESSION_CREATE:
      return handleCreateSession(server, clientId, message);
    case MessageType.ENV_REPORT:
      return await handleEnvReport(server, clientId, message, aiAgent);
    case MessageType.STEP_EXECUTE:
      // Agent sends step.execute as a notification that it started a step.
      // This is informational only — the server does not need to act on it.
      return { success: true };
    case MessageType.STEP_OUTPUT:
      return handleStepOutput(server, clientId, message);
    case MessageType.STEP_COMPLETE:
      return handleStepComplete(server, clientId, message);
    case MessageType.ERROR_OCCURRED:
      return await handleErrorOccurred(server, clientId, message, aiAgent);
    case MessageType.SESSION_COMPLETE:
      return handleSessionComplete(server, clientId, message);
    case MessageType.SNAPSHOT_RESPONSE:
      return await handleSnapshotResponse(message);
    case MessageType.ROLLBACK_RESPONSE:
      return await handleRollbackResponse(message);
    case MessageType.METRICS_REPORT:
      return await handleMetricsReport(server, clientId, message);
    default:
      return { success: false, error: `Unhandled message type: ${(message as Message).type}` };
  }
}
