// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Magic API Device Client
 *
 * Integrates with Magic API endpoints for device management:
 * - device/register: Register new devices
 * - device/verify: Verify device token
 * - device/quota: Query remaining quota
 * - device/increment-call: Increment AI call count
 */

import { logger } from '../utils/logger.js';

// Environment configuration
const MAGIC_API_BASE_URL = process.env.MAGIC_API_BASE_URL || 'http://localhost:8088';
const MAGIC_API_TIMEOUT = parseInt(process.env.MAGIC_API_TIMEOUT_MS || '5000', 10);

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Device registration request
 */
export interface DeviceRegisterRequest {
  deviceId: string;           // Device fingerprint hash
  platform: string;           // darwin/linux/win32
  osVersion?: string;         // OS version
  architecture?: string;      // x64/arm64
  hostname?: string;          // Device hostname
}

/**
 * Device registration response
 */
export interface DeviceRegisterResponse {
  success: boolean;
  data?: {
    token: string;            // Device authentication token
    quotaLimit: number;       // Monthly quota limit
    quotaUsed: number;        // Quota used this month
    plan: string;             // Plan type: free/pro/enterprise
  };
  error?: string;
}

/**
 * Device verification request
 */
export interface DeviceVerifyRequest {
  deviceId: string;
  token: string;
}

/**
 * Device verification response
 */
export interface DeviceVerifyResponse {
  success: boolean;
  data?: {
    valid: boolean;           // Is token valid
    banned: boolean;          // Is device banned
    banReason?: string;       // Ban reason if banned
    plan: string;             // Plan type
    quotaLimit: number;       // Monthly quota limit
    quotaUsed: number;        // Quota used this month
  };
  error?: string;
}

/**
 * Device quota query request
 */
export interface DeviceQuotaRequest {
  deviceId: string;
  token: string;
}

/**
 * Device quota query response
 */
export interface DeviceQuotaResponse {
  success: boolean;
  data?: {
    quotaLimit: number;       // Monthly quota limit
    quotaUsed: number;        // Quota used this month
    quotaRemaining: number;   // Remaining quota
    plan: string;             // Plan type
    resetDate: string;        // Next quota reset date (YYYY-MM-DD)
  };
  error?: string;
}

/**
 * Increment call count request
 */
export interface IncrementCallRequest {
  deviceId: string;
  token: string;
  scene: string;              // Scene: envAnalysis/planGeneration/errorDiagnosis/tutor
}

/**
 * Increment call count response
 */
export interface IncrementCallResponse {
  success: boolean;
  data?: {
    quotaUsed: number;        // Updated quota used
    quotaRemaining: number;   // Remaining quota
  };
  error?: string;
}

// ============================================================================
// HTTP Client Helper
// ============================================================================

/**
 * Make HTTP request with timeout
 */
async function request<T>(
  endpoint: string,
  method: string,
  body?: unknown
): Promise<T> {
  const url = `${MAGIC_API_BASE_URL}${endpoint}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), MAGIC_API_TIMEOUT);

  try {
    logger.debug({ url, method, body }, 'Making Magic API request');

    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const raw = await response.json();

    logger.debug({ url, status: response.status, data: raw }, 'Magic API response');

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${raw.error || response.statusText}`);
    }

    // Unwrap Magic API envelope: {code, message, data} → data
    const data = (raw && typeof raw === 'object' && 'code' in raw) ? raw.data : raw;

    return data as T;
  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof Error && error.name === 'AbortError') {
      logger.error({ url, timeout: MAGIC_API_TIMEOUT }, 'Magic API request timeout');
      throw new Error(`Request timeout after ${MAGIC_API_TIMEOUT}ms`);
    }

    logger.error({ url, error }, 'Magic API request failed');
    throw error;
  }
}

// ============================================================================
// Device API Client
// ============================================================================

/**
 * Device API client for Magic API integration
 */
export class DeviceClient {
  /**
   * Register a new device
   *
   * @param req - Device registration request
   * @returns Device registration response with token
   */
  static async register(req: DeviceRegisterRequest): Promise<DeviceRegisterResponse> {
    try {
      logger.info({ deviceId: req.deviceId, platform: req.platform }, 'Registering device');

      const response = await request<DeviceRegisterResponse>(
        '/device/register',
        'POST',
        req
      );

      logger.info(
        { deviceId: req.deviceId, success: response.success },
        'Device registration completed'
      );

      return response;
    } catch (error) {
      logger.error({ deviceId: req.deviceId, error }, 'Device registration failed');

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Verify device token
   *
   * @param req - Device verification request
   * @returns Device verification response
   */
  static async verify(req: DeviceVerifyRequest): Promise<DeviceVerifyResponse> {
    try {
      logger.debug({ deviceId: req.deviceId }, 'Verifying device token');

      const response = await request<DeviceVerifyResponse>(
        '/device/verify',
        'POST',
        req
      );

      logger.debug(
        { deviceId: req.deviceId, valid: response.data?.valid },
        'Device verification completed'
      );

      return response;
    } catch (error) {
      logger.error({ deviceId: req.deviceId, error }, 'Device verification failed');

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Query device quota
   *
   * @param req - Device quota query request
   * @returns Device quota information
   */
  static async getQuota(req: DeviceQuotaRequest): Promise<DeviceQuotaResponse> {
    try {
      logger.debug({ deviceId: req.deviceId }, 'Querying device quota');

      const response = await request<DeviceQuotaResponse>(
        '/device/quota',
        'POST',
        req
      );

      logger.debug(
        {
          deviceId: req.deviceId,
          quotaUsed: response.data?.quotaUsed,
          quotaRemaining: response.data?.quotaRemaining,
        },
        'Device quota query completed'
      );

      return response;
    } catch (error) {
      logger.error({ deviceId: req.deviceId, error }, 'Device quota query failed');

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Increment AI call count
   *
   * @param req - Increment call request
   * @returns Updated quota information
   */
  static async incrementCall(req: IncrementCallRequest): Promise<IncrementCallResponse> {
    try {
      logger.debug({ deviceId: req.deviceId, scene: req.scene }, 'Incrementing call count');

      const response = await request<IncrementCallResponse>(
        '/device/increment-call',
        'POST',
        req
      );

      logger.debug(
        {
          deviceId: req.deviceId,
          scene: req.scene,
          quotaUsed: response.data?.quotaUsed,
          quotaRemaining: response.data?.quotaRemaining,
        },
        'Call count incremented'
      );

      return response;
    } catch (error) {
      logger.error({ deviceId: req.deviceId, error }, 'Increment call count failed');

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Health check for Magic API connection
   *
   * @returns True if Magic API is accessible
   */
  static async healthCheck(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);

      const response = await fetch(`${MAGIC_API_BASE_URL}/health`, {
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      return response.ok;
    } catch (error) {
      logger.warn({ error }, 'Magic API health check failed');
      return false;
    }
  }
}
