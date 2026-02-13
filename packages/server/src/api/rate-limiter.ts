// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Rate Limiting Middleware
 *
 * Manages AI call quotas for devices:
 * - Checks remaining quota before AI operations
 * - Increments call count after successful AI calls
 * - Returns upgrade guidance when quota exceeded
 * - Logs AI calls for tracking and billing
 *
 * Free tier limits:
 * - 5 installations per month
 * - 20 AI calls per installation
 *
 * @module api/rate-limiter
 */

import { logger } from '../utils/logger.js';
import { DeviceClient } from './device-client.js';
import { sessionClient } from './session-client.js';

// ============================================================================
// Constants
// ============================================================================

/** Free tier: 5 installations per month */
export const FREE_TIER_INSTALLATION_LIMIT = 5;

/** Free tier: 20 AI calls per installation (approximation) */
export const FREE_TIER_AI_CALL_LIMIT = 20;

/** Error code for quota exceeded */
export const QUOTA_EXCEEDED_ERROR = 'QUOTA_EXCEEDED';

// ============================================================================
// Types
// ============================================================================

/**
 * Rate limiting check result
 */
export interface RateLimitCheckResult {
  /** Whether the operation is allowed */
  allowed: boolean;
  /** Remaining quota */
  quotaRemaining?: number;
  /** Error message if not allowed */
  error?: string;
  /** Error code for programmatic handling */
  errorCode?: string;
  /** Upgrade message with URL */
  upgradeMessage?: string;
}

/**
 * AI operation types for logging
 */
export type AIOperationType = 'envAnalysis' | 'planGeneration' | 'errorDiagnosis' | 'fixGeneration';

/**
 * AI call tracking info
 */
export interface AICallInfo {
  /** Session ID */
  sessionId: string;
  /** Operation type */
  operation: AIOperationType;
  /** AI provider */
  provider: 'anthropic' | 'openai' | 'deepseek' | 'google' | 'qwen' | 'claude';
  /** Model name */
  model: string;
  /** Input tokens used */
  inputTokens: number;
  /** Output tokens used */
  outputTokens: number;
  /** Whether the call succeeded */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** Latency in milliseconds */
  latencyMs?: number;
}

// ============================================================================
// Rate Limiting Functions
// ============================================================================

/**
 * Check if device has sufficient quota for an AI operation.
 *
 * Verifies that:
 * 1. Device has remaining quota
 * 2. Device is not banned
 *
 * @param deviceId - Device fingerprint hash
 * @param deviceToken - Device authentication token
 * @returns Rate limit check result
 */
export async function checkRateLimit(
  deviceId: string,
  deviceToken: string
): Promise<RateLimitCheckResult> {
  try {
    logger.debug({ deviceId, operation: 'rate_limit_check' }, 'Checking rate limit');

    // Query device quota
    const quotaResult = await DeviceClient.getQuota({
      deviceId,
      token: deviceToken,
    });

    if (!quotaResult.success || !quotaResult.data) {
      logger.error(
        { deviceId, error: quotaResult.error, operation: 'rate_limit_check' },
        'Failed to query device quota'
      );

      return {
        allowed: false,
        error: quotaResult.error || 'Failed to query quota',
      };
    }

    const { quotaRemaining, plan } = quotaResult.data;

    // Check if quota is exhausted
    if (quotaRemaining <= 0) {
      logger.warn(
        { deviceId, plan, quotaRemaining, operation: 'rate_limit_check' },
        'Quota exceeded'
      );

      return {
        allowed: false,
        quotaRemaining: 0,
        error: 'Monthly quota exceeded',
        errorCode: QUOTA_EXCEEDED_ERROR,
        upgradeMessage: plan === 'free'
          ? 'Your free monthly quota (5 installations) has been exhausted. Upgrade to Pro for unlimited installations: https://aiinstaller.dev/pricing'
          : 'Your monthly quota has been exhausted. Please contact support or wait for quota reset.',
      };
    }

    logger.debug(
      { deviceId, quotaRemaining, plan, operation: 'rate_limit_check' },
      'Rate limit check passed'
    );

    return {
      allowed: true,
      quotaRemaining,
    };
  } catch (error) {
    logger.error(
      { deviceId, error, operation: 'rate_limit_check' },
      'Rate limit check failed with exception'
    );

    return {
      allowed: false,
      error: error instanceof Error ? error.message : 'Rate limit check failed',
    };
  }
}

/**
 * Increment AI call count for a device.
 *
 * Called after a successful AI operation to track usage.
 *
 * @param deviceId - Device fingerprint hash
 * @param deviceToken - Device authentication token
 * @param scene - Scene identifier for the AI call
 * @returns Updated quota information
 */
export async function incrementAICall(
  deviceId: string,
  deviceToken: string,
  scene: AIOperationType
): Promise<{ success: boolean; quotaRemaining?: number; error?: string }> {
  try {
    logger.debug(
      { deviceId, scene, operation: 'increment_ai_call' },
      'Incrementing AI call count'
    );

    const result = await DeviceClient.incrementCall({
      deviceId,
      token: deviceToken,
      scene,
    });

    if (!result.success || !result.data) {
      logger.error(
        { deviceId, scene, error: result.error, operation: 'increment_ai_call' },
        'Failed to increment AI call count'
      );

      return {
        success: false,
        error: result.error || 'Failed to increment call count',
      };
    }

    logger.info(
      {
        deviceId,
        scene,
        quotaUsed: result.data.quotaUsed,
        quotaRemaining: result.data.quotaRemaining,
        operation: 'increment_ai_call',
      },
      'AI call count incremented'
    );

    return {
      success: true,
      quotaRemaining: result.data.quotaRemaining,
    };
  } catch (error) {
    logger.error(
      { deviceId, scene, error, operation: 'increment_ai_call' },
      'Increment AI call failed with exception'
    );

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to increment call count',
    };
  }
}

/**
 * Log an AI call for tracking and billing.
 *
 * Records detailed information about AI API calls including:
 * - Token usage
 * - Latency
 * - Success/failure status
 * - Provider and model
 *
 * @param deviceId - Device fingerprint hash
 * @param deviceToken - Device authentication token
 * @param callInfo - AI call information
 * @returns Log result
 */
export async function logAICall(
  deviceId: string,
  deviceToken: string,
  callInfo: AICallInfo
): Promise<{ success: boolean; error?: string }> {
  try {
    logger.debug(
      {
        deviceId,
        sessionId: callInfo.sessionId,
        operation: callInfo.operation,
        provider: callInfo.provider,
      },
      'Logging AI call'
    );

    const result = await sessionClient.logAICall({
      deviceId,
      sessionId: callInfo.sessionId,
      scene: callInfo.operation,
      provider: callInfo.provider,
      model: callInfo.model,
      inputTokens: callInfo.inputTokens,
      outputTokens: callInfo.outputTokens,
      success: callInfo.success,
      errorMessage: callInfo.error,
      durationMs: callInfo.latencyMs,
    });

    if (!result.success) {
      logger.warn(
        {
          deviceId,
          sessionId: callInfo.sessionId,
          error: result.error,
          operation: 'log_ai_call',
        },
        'Failed to log AI call'
      );

      // Don't fail the operation if logging fails
      return {
        success: false,
        error: result.error,
      };
    }

    logger.debug(
      {
        deviceId,
        sessionId: callInfo.sessionId,
        operation: callInfo.operation,
      },
      'AI call logged successfully'
    );

    return {
      success: true,
    };
  } catch (error) {
    logger.error(
      {
        deviceId,
        sessionId: callInfo.sessionId,
        error,
        operation: 'log_ai_call',
      },
      'Log AI call failed with exception'
    );

    // Don't fail the operation if logging fails
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to log AI call',
    };
  }
}

/**
 * Get upgrade message for users who exceeded quota.
 *
 * @param plan - Current plan type
 * @returns User-friendly upgrade message
 */
export function getUpgradeMessage(plan: string): string {
  if (plan === 'free') {
    return `
🚀 Quota Exceeded - Upgrade to Pro!

Your free monthly quota (5 installations) has been exhausted.

Upgrade to Pro for:
✅ Unlimited installations
✅ Priority support
✅ Advanced AI features
✅ No ads

Visit: https://aiinstaller.dev/pricing

Or wait until next month for quota reset.
`.trim();
  }

  return `
⚠️ Quota Exceeded

Your monthly quota has been exhausted.
Please contact support or wait for quota reset at the beginning of next month.

Support: support@aiinstaller.dev
`.trim();
}

/**
 * Check if an error is a quota exceeded error.
 *
 * @param error - Error object or message
 * @returns True if quota exceeded
 */
export function isQuotaExceededError(error: unknown): boolean {
  if (typeof error === 'string') {
    return error.includes('quota exceeded') || error.includes(QUOTA_EXCEEDED_ERROR);
  }

  if (error instanceof Error) {
    return error.message.includes('quota exceeded') || error.message.includes(QUOTA_EXCEEDED_ERROR);
  }

  return false;
}

/**
 * Create a quota exceeded error message for users.
 *
 * @param plan - Current plan type
 * @returns Error message with upgrade guidance
 */
export function createQuotaExceededMessage(plan: string): string {
  const upgradeMsg = getUpgradeMessage(plan);
  return `${upgradeMsg}\n\nError Code: ${QUOTA_EXCEEDED_ERROR}`;
}
