// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * WebSocket Authentication Handler
 *
 * Handles device authentication during WebSocket handshake:
 * - Validates device tokens
 * - Registers new devices automatically
 * - Checks quota and ban status
 * - Rejects invalid connections
 *
 * @module api/auth-handler
 */

import type { AuthRequestMessage, AuthResponseMessage } from '@aiinstaller/shared';
import { MessageType } from '@aiinstaller/shared';
import { DeviceClient } from './device-client.js';
import { logger } from '../utils/logger.js';

/**
 * Authentication result for WebSocket connections
 */
export interface AuthResult {
  /** Whether authentication succeeded */
  success: boolean;
  /** Device authentication token (returned or newly generated) */
  deviceToken?: string;
  /** Quota information */
  quota?: {
    limit: number;
    used: number;
    remaining: number;
  };
  /** Plan type: free/pro/enterprise */
  plan?: string;
  /** Error message if authentication failed */
  error?: string;
  /** Whether device is banned */
  banned?: boolean;
  /** Reason for ban if banned */
  banReason?: string;
}

/**
 * Authenticate a device during WebSocket handshake.
 *
 * Flow:
 * 1. If device has token, verify it
 * 2. If verification succeeds, return quota info
 * 3. If token missing or invalid, auto-register device
 * 4. Return new token and quota info
 *
 * @param authRequest - Authentication request from client
 * @returns Authentication result with token and quota info
 */
export async function authenticateDevice(
  authRequest: AuthRequestMessage
): Promise<AuthResult> {
  const { deviceId, deviceToken, platform, osVersion, architecture, hostname } =
    authRequest.payload;

  logger.info(
    {
      deviceId,
      hasToken: !!deviceToken,
      platform,
      operation: 'auth_handshake',
    },
    'Processing device authentication'
  );

  // Case 1: Device has token, verify it
  if (deviceToken) {
    const verifyResult = await DeviceClient.verify({
      deviceId,
      token: deviceToken,
    });

    if (verifyResult.success && verifyResult.data) {
      const { valid, banned, banReason, plan, quotaLimit, quotaUsed } = verifyResult.data;

      // Check if device is banned
      if (banned) {
        logger.warn(
          { deviceId, banReason, operation: 'auth_handshake' },
          'Device is banned'
        );

        return {
          success: false,
          error: 'Device is banned',
          banned: true,
          banReason,
        };
      }

      // Check if token is valid
      if (valid) {
        logger.info(
          {
            deviceId,
            plan,
            quotaUsed,
            quotaRemaining: quotaLimit - quotaUsed,
            operation: 'auth_handshake',
          },
          'Device token verified successfully'
        );

        return {
          success: true,
          deviceToken,
          quota: {
            limit: quotaLimit,
            used: quotaUsed,
            remaining: quotaLimit - quotaUsed,
          },
          plan,
        };
      }

      // Token is invalid, fall through to registration
      logger.info(
        { deviceId, operation: 'auth_handshake' },
        'Device token invalid, will auto-register'
      );
    }
  }

  // Case 2: No token or token invalid, auto-register device
  logger.info({ deviceId, platform, operation: 'auth_handshake' }, 'Auto-registering device');

  const registerResult = await DeviceClient.register({
    deviceId,
    platform,
    osVersion,
    architecture,
    hostname,
  });

  if (registerResult.success && registerResult.data) {
    const { token, quotaLimit, quotaUsed, plan } = registerResult.data;

    logger.info(
      {
        deviceId,
        plan,
        quotaLimit,
        operation: 'auth_handshake',
      },
      'Device registered successfully'
    );

    return {
      success: true,
      deviceToken: token,
      quota: {
        limit: quotaLimit,
        used: quotaUsed,
        remaining: quotaLimit - quotaUsed,
      },
      plan,
    };
  }

  // Registration failed
  logger.error(
    {
      deviceId,
      error: registerResult.error,
      operation: 'auth_handshake',
    },
    'Device registration failed'
  );

  return {
    success: false,
    error: registerResult.error || 'Device registration failed',
  };
}

/**
 * Create an authentication response message.
 *
 * @param authResult - Authentication result
 * @param requestId - Optional request ID for matching
 * @returns Authentication response message
 */
export function createAuthResponse(
  authResult: AuthResult,
  requestId?: string
): AuthResponseMessage {
  return {
    type: MessageType.AUTH_RESPONSE,
    payload: {
      success: authResult.success,
      deviceToken: authResult.deviceToken,
      quotaLimit: authResult.quota?.limit,
      quotaUsed: authResult.quota?.used,
      quotaRemaining: authResult.quota?.remaining,
      plan: authResult.plan,
      error: authResult.error,
      banned: authResult.banned,
      banReason: authResult.banReason,
    },
    timestamp: Date.now(),
    ...(requestId ? { requestId } : {}),
  };
}

/**
 * Check if device has sufficient quota for AI operations.
 *
 * @param authResult - Authentication result with quota info
 * @returns True if device has quota remaining
 */
export function hasQuota(authResult: AuthResult): boolean {
  if (!authResult.success || !authResult.quota) {
    return false;
  }

  return authResult.quota.remaining > 0;
}

/**
 * Validate authentication timeout.
 * Rejects if no auth message received within timeout period.
 *
 * @param timeoutMs - Timeout in milliseconds (default: 10000)
 * @returns Promise that rejects on timeout
 */
export function createAuthTimeout(timeoutMs: number = 10000): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => {
      reject(new Error('Authentication timeout: no auth message received'));
    }, timeoutMs);
  });
}
