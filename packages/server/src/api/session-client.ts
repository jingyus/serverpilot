// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Magic API Session Client
 *
 * Integrates with Magic API endpoints for session and AI call logging:
 * - session/create: Create installation session record
 * - session/complete: Update session result
 * - ai-call/log: Log AI API calls
 */

import { logger } from '../utils/logger.js';

// Environment configuration
const MAGIC_API_BASE_URL = process.env.MAGIC_API_BASE_URL || 'http://localhost:8088';
const MAGIC_API_TIMEOUT = parseInt(process.env.MAGIC_API_TIMEOUT_MS || '5000', 10);

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Session creation request
 */
export interface SessionCreateRequest {
  sessionId: string;          // Unique session ID
  deviceId: string;           // Device fingerprint hash
  software: string;           // Software being installed
  platform: string;           // darwin/linux/win32
  stepsTotal?: number;        // Total steps in the plan
  envInfo?: Record<string, unknown>;   // Environment information (JSON)
  installPlan?: Record<string, unknown>; // Install plan (JSON)
}

/**
 * Session creation response
 */
export interface SessionCreateResponse {
  success: boolean;
  data?: {
    sessionId: string;        // Created session ID
    startedAt: string;        // Session start time (ISO format)
  };
  error?: string;
}

/**
 * Session completion request
 */
export interface SessionCompleteRequest {
  sessionId: string;          // Session ID to update
  status: 'completed' | 'failed' | 'interrupted';  // Final status
  stepsCompleted?: number;    // Number of completed steps
  durationMs?: number;        // Total duration in milliseconds
  errorMessage?: string;      // Error message if failed
}

/**
 * Session completion response
 */
export interface SessionCompleteResponse {
  success: boolean;
  data?: {
    sessionId: string;        // Updated session ID
    status: string;           // Final status
    completedAt: string;      // Completion time (ISO format)
  };
  error?: string;
}

/**
 * AI call log request
 */
export interface AICallLogRequest {
  sessionId: string;          // Associated session ID
  deviceId: string;           // Device ID
  scene: 'envAnalysis' | 'planGeneration' | 'errorDiagnosis' | 'fixGeneration' | 'tutor';  // AI usage scene
  provider: 'anthropic' | 'openai' | 'deepseek' | 'google' | 'qwen' | 'claude';     // AI provider
  model: string;              // Model name
  inputTokens?: number;       // Input token count
  outputTokens?: number;      // Output token count
  costUsd?: number;           // Cost in USD
  durationMs?: number;        // Response time in milliseconds
  success?: boolean;          // Whether the call succeeded
  errorCode?: string;         // Error code if failed
  errorMessage?: string;      // Error message if failed
}

/**
 * AI call log response
 */
export interface AICallLogResponse {
  success: boolean;
  data?: {
    logId: number;            // Created log ID
    createdAt: string;        // Log creation time (ISO format)
  };
  error?: string;
}

// ============================================================================
// SessionClient Class
// ============================================================================

/**
 * Magic API Session Client
 *
 * Handles session and AI call logging operations
 */
export class SessionClient {
  private readonly baseUrl: string;
  private readonly timeout: number;

  constructor(baseUrl: string = MAGIC_API_BASE_URL, timeout: number = MAGIC_API_TIMEOUT) {
    this.baseUrl = baseUrl;
    this.timeout = timeout;
  }

  /**
   * Unwrap Magic API envelope: {code, message, data} → data
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private unwrap(raw: any): any {
    if (raw && typeof raw === 'object' && 'code' in raw) {
      return raw.data;
    }
    return raw;
  }

  // ==========================================================================
  // Session Management
  // ==========================================================================

  /**
   * Create installation session record
   *
   * @param request - Session creation data
   * @returns Session creation result
   */
  async createSession(request: SessionCreateRequest): Promise<SessionCreateResponse> {
    const endpoint = '/session/create';
    const url = `${this.baseUrl}${endpoint}`;

    try {
      logger.info(`Creating session: ${request.sessionId} for ${request.software}`);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const data = await response.json();

      if (!response.ok) {
        logger.warn(`Session creation failed: ${data.error || response.statusText}`);
        return {
          success: false,
          error: data.error || `HTTP ${response.status}: ${response.statusText}`,
        };
      }

      logger.info(`Session created: ${request.sessionId}`);
      return this.unwrap(data);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Session creation error: ${errorMessage}`);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Update session completion status
   *
   * @param request - Session completion data
   * @returns Session completion result
   */
  async completeSession(request: SessionCompleteRequest): Promise<SessionCompleteResponse> {
    const endpoint = '/session/complete';
    const url = `${this.baseUrl}${endpoint}`;

    try {
      logger.info(`Completing session: ${request.sessionId} with status ${request.status}`);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const data = await response.json();

      if (!response.ok) {
        logger.warn(`Session completion failed: ${data.error || response.statusText}`);
        return {
          success: false,
          error: data.error || `HTTP ${response.status}: ${response.statusText}`,
        };
      }

      logger.info(`Session completed: ${request.sessionId} (${request.status})`);
      return this.unwrap(data);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Session completion error: ${errorMessage}`);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  // ==========================================================================
  // AI Call Logging
  // ==========================================================================

  /**
   * Log AI API call for cost tracking
   *
   * @param request - AI call log data
   * @returns AI call log result
   */
  async logAICall(request: AICallLogRequest): Promise<AICallLogResponse> {
    const endpoint = '/ai-call/log';
    const url = `${this.baseUrl}${endpoint}`;

    try {
      // Log with sensitive data masked
      const logData = {
        sessionId: request.sessionId,
        scene: request.scene,
        provider: request.provider,
        model: request.model,
        tokens: `${request.inputTokens || 0}/${request.outputTokens || 0}`,
        success: request.success !== false,
      };
      logger.info(`Logging AI call: ${JSON.stringify(logData)}`);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const data = await response.json();

      if (!response.ok) {
        logger.warn(`AI call logging failed: ${data.error || response.statusText}`);
        return {
          success: false,
          error: data.error || `HTTP ${response.status}: ${response.statusText}`,
        };
      }

      const result = this.unwrap(data);
      logger.info(`AI call logged: ${result?.data?.logId || 'unknown'}`);
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`AI call logging error: ${errorMessage}`);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  // ==========================================================================
  // Helper Methods
  // ==========================================================================

  /**
   * Create session and log it (combined operation)
   *
   * @param request - Session creation data
   * @returns Session creation result
   */
  async createAndLogSession(request: SessionCreateRequest): Promise<SessionCreateResponse> {
    const result = await this.createSession(request);

    if (result.success) {
      logger.info(`Session ${request.sessionId} created and logged successfully`);
    } else {
      logger.warn(`Session ${request.sessionId} creation failed: ${result.error}`);
    }

    return result;
  }

  /**
   * Complete session with error handling
   *
   * @param sessionId - Session ID
   * @param success - Whether the installation succeeded
   * @param stepsCompleted - Number of steps completed
   * @param durationMs - Total duration
   * @param errorMessage - Error message if failed
   * @returns Session completion result
   */
  async completeSessionWithStatus(
    sessionId: string,
    success: boolean,
    stepsCompleted?: number,
    durationMs?: number,
    errorMessage?: string
  ): Promise<SessionCompleteResponse> {
    const status = success ? 'completed' : 'failed';
    return this.completeSession({
      sessionId,
      status,
      stepsCompleted,
      durationMs,
      errorMessage,
    });
  }

  /**
   * Log successful AI call
   *
   * @param sessionId - Session ID
   * @param deviceId - Device ID
   * @param scene - AI usage scene
   * @param provider - AI provider
   * @param model - Model name
   * @param inputTokens - Input token count
   * @param outputTokens - Output token count
   * @param costUsd - Cost in USD
   * @param durationMs - Response time
   * @returns AI call log result
   */
  async logSuccessfulAICall(
    sessionId: string,
    deviceId: string,
    scene: AICallLogRequest['scene'],
    provider: AICallLogRequest['provider'],
    model: string,
    inputTokens: number,
    outputTokens: number,
    costUsd: number,
    durationMs: number
  ): Promise<AICallLogResponse> {
    return this.logAICall({
      sessionId,
      deviceId,
      scene,
      provider,
      model,
      inputTokens,
      outputTokens,
      costUsd,
      durationMs,
      success: true,
    });
  }

  /**
   * Log failed AI call
   *
   * @param sessionId - Session ID
   * @param deviceId - Device ID
   * @param scene - AI usage scene
   * @param provider - AI provider
   * @param model - Model name
   * @param errorCode - Error code
   * @param errorMessage - Error message
   * @param durationMs - Response time
   * @returns AI call log result
   */
  async logFailedAICall(
    sessionId: string,
    deviceId: string,
    scene: AICallLogRequest['scene'],
    provider: AICallLogRequest['provider'],
    model: string,
    errorCode: string,
    errorMessage: string,
    durationMs: number
  ): Promise<AICallLogResponse> {
    return this.logAICall({
      sessionId,
      deviceId,
      scene,
      provider,
      model,
      success: false,
      errorCode,
      errorMessage,
      durationMs,
    });
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

/**
 * Default session client instance
 */
export const sessionClient = new SessionClient();
