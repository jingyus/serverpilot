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

import type {
  AuthRequestMessage,
  AuthResponseMessage,
} from "@aiinstaller/shared";
import {
  MessageType,
  PROTOCOL_VERSION,
  checkVersionCompatibility,
} from "@aiinstaller/shared";
import { eq, and } from "drizzle-orm";
import { logger } from "../utils/logger.js";
import { getDatabase } from "../db/connection.js";
import { agents } from "../db/schema.js";

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
 * Try local agent authentication using the agents table directly.
 *
 * For self-hosted deployments where the agent is co-located with the server,
 * the agent authenticates using serverId (as deviceId) and agentToken (as deviceToken).
 * This avoids the external DeviceClient/Magic API round-trip.
 *
 * @returns AuthResult if local token matches, null to fall through to DeviceClient path
 */
function tryLocalAgentAuth(serverId: string, token: string): AuthResult | null {
  try {
    console.log("[AUTH DEBUG] Attempting local agent auth:", {
      serverId,
      tokenPrefix: token.substring(0, 20) + "...",
    });

    const db = getDatabase();
    const rows = db
      .select()
      .from(agents)
      .where(and(eq(agents.serverId, serverId), eq(agents.keyHash, token)))
      .limit(1)
      .all();

    console.log("[AUTH DEBUG] Query result:", {
      serverId,
      rowsFound: rows.length,
      firstRow: rows[0] ? { id: rows[0].id, serverId: rows[0].serverId } : null,
    });

    if (rows.length > 0) {
      logger.info(
        { serverId, operation: "auth_handshake" },
        "Local agent authenticated via agents table",
      );
      return {
        success: true,
        deviceToken: token,
        quota: { limit: 999_999, used: 0, remaining: 999_999 },
        plan: "self-hosted",
      };
    }
  } catch (err) {
    logger.error(
      { serverId, error: err, operation: "auth_handshake" },
      "Local agent auth lookup failed, falling back to DeviceClient",
    );
  }
  return null;
}

/**
 * Authenticate a device during WebSocket handshake.
 *
 * Self-hosted mode (simplified):
 * 1. Check agents table for matching serverId + agentToken
 * 2. If found, return success with unlimited quota
 * 3. If not found, reject authentication
 *
 * Note: Magic API (DeviceClient) removed for self-hosted version.
 * Cloud version will use a separate authentication module.
 *
 * @param authRequest - Authentication request from client
 * @returns Authentication result with token and quota info
 */
export async function authenticateDevice(
  authRequest: AuthRequestMessage,
): Promise<AuthResult> {
  const { deviceId, deviceToken } = authRequest.payload;

  logger.info(
    {
      deviceId,
      hasToken: !!deviceToken,
      operation: "auth_handshake",
    },
    "Processing device authentication (self-hosted mode)",
  );

  // Self-hosted mode: only local agent auth
  if (deviceId && deviceToken) {
    const localResult = tryLocalAgentAuth(deviceId, deviceToken);
    if (localResult) return localResult;
  }

  // Authentication failed - no matching agent found
  logger.warn(
    { deviceId, operation: "auth_handshake" },
    "Authentication failed: no matching agent found in database",
  );

  return {
    success: false,
    error:
      "Authentication failed: agent not registered. Please create server in Dashboard first.",
  };
}

/**
 * Create an authentication response message.
 *
 * Includes the server's protocol version and optional version check result
 * so the agent can detect compatibility issues.
 *
 * @param authResult - Authentication result
 * @param requestId - Optional request ID for matching
 * @param agentProtocolVersion - Protocol version reported by the agent (may be undefined for legacy agents)
 * @returns Authentication response message
 */
export function createAuthResponse(
  authResult: AuthResult,
  requestId?: string,
  agentProtocolVersion?: string,
): AuthResponseMessage {
  const versionCheck = checkVersionCompatibility(agentProtocolVersion);

  return {
    type: MessageType.AUTH_RESPONSE,
    payload: {
      success: authResult.success,
      protocolVersion: PROTOCOL_VERSION,
      deviceToken: authResult.deviceToken,
      quotaLimit: authResult.quota?.limit,
      quotaUsed: authResult.quota?.used,
      quotaRemaining: authResult.quota?.remaining,
      plan: authResult.plan,
      error: authResult.error,
      banned: authResult.banned,
      banReason: authResult.banReason,
      versionCheck,
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
      reject(new Error("Authentication timeout: no auth message received"));
    }, timeoutMs);
  });
}
