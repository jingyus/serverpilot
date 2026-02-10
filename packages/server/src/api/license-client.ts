/**
 * Magic API License Client
 *
 * Integrates with Magic API endpoints for license management:
 * - license/validate: Validate license key
 * - license/bind: Bind license key to device
 * - license/generate: Generate license key (admin only)
 */

import { logger } from '../utils/logger.js';

// Environment configuration
const MAGIC_API_BASE_URL = process.env.MAGIC_API_BASE_URL || 'http://localhost:8088';
const MAGIC_API_TIMEOUT = parseInt(process.env.MAGIC_API_TIMEOUT_MS || '5000', 10);

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * License validation request
 */
export interface LicenseValidateRequest {
  licenseKey: string;         // License key to validate
}

/**
 * License validation response
 */
export interface LicenseValidateResponse {
  success: boolean;
  data?: {
    valid: boolean;           // Is license key valid
    plan: string;             // Plan type: free/pro/enterprise
    maxDevices: number;       // Max bindable devices
    boundDevices: number;     // Currently bound devices
    expiresAt: string | null; // Expiration date (YYYY-MM-DD HH:MM:SS) or null for lifetime
    active: boolean;          // Is license active
  };
  error?: string;
}

/**
 * License bind request
 */
export interface LicenseBindRequest {
  licenseKey: string;         // License key to bind
  deviceId: string;           // Device fingerprint hash
}

/**
 * License bind response
 */
export interface LicenseBindResponse {
  success: boolean;
  data?: {
    bound: boolean;           // Was binding successful
    plan: string;             // Plan type
    quotaLimit: number;       // Monthly quota limit for this plan
    expiresAt: string | null; // License expiration date
  };
  error?: string;
}

/**
 * License generation request (admin only)
 */
export interface LicenseGenerateRequest {
  plan: string;               // Plan type: free/pro/enterprise
  maxDevices: number;         // Max bindable devices
  expiresAt?: string;         // Optional expiration date (YYYY-MM-DD HH:MM:SS)
  remark?: string;            // Optional remark
  adminToken: string;         // Admin authentication token
}

/**
 * License generation response
 */
export interface LicenseGenerateResponse {
  success: boolean;
  data?: {
    licenseKey: string;       // Generated license key
    plan: string;             // Plan type
    maxDevices: number;       // Max bindable devices
    expiresAt: string | null; // Expiration date or null
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

    const data = await response.json();

    logger.debug({ url, status: response.status, data }, 'Magic API response');

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${data.error || response.statusText}`);
    }

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
// License API Client
// ============================================================================

/**
 * License API client for Magic API integration
 */
export class LicenseClient {
  /**
   * Validate a license key
   *
   * @param req - License validation request
   * @returns License validation response
   */
  static async validate(req: LicenseValidateRequest): Promise<LicenseValidateResponse> {
    try {
      logger.info({ licenseKey: req.licenseKey.substring(0, 10) + '...' }, 'Validating license key');

      const response = await request<LicenseValidateResponse>(
        '/license/validate',
        'POST',
        req
      );

      logger.info(
        {
          licenseKey: req.licenseKey.substring(0, 10) + '...',
          valid: response.data?.valid,
          plan: response.data?.plan,
        },
        'License validation completed'
      );

      return response;
    } catch (error) {
      logger.error({ licenseKey: req.licenseKey.substring(0, 10) + '...', error }, 'License validation failed');

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Bind a license key to a device
   *
   * @param req - License bind request
   * @returns License bind response
   */
  static async bind(req: LicenseBindRequest): Promise<LicenseBindResponse> {
    try {
      logger.info(
        {
          licenseKey: req.licenseKey.substring(0, 10) + '...',
          deviceId: req.deviceId,
        },
        'Binding license key to device'
      );

      const response = await request<LicenseBindResponse>(
        '/license/bind',
        'POST',
        req
      );

      logger.info(
        {
          licenseKey: req.licenseKey.substring(0, 10) + '...',
          deviceId: req.deviceId,
          bound: response.data?.bound,
        },
        'License binding completed'
      );

      return response;
    } catch (error) {
      logger.error(
        {
          licenseKey: req.licenseKey.substring(0, 10) + '...',
          deviceId: req.deviceId,
          error,
        },
        'License binding failed'
      );

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Generate a new license key (admin only)
   *
   * @param req - License generation request
   * @returns License generation response
   */
  static async generate(req: LicenseGenerateRequest): Promise<LicenseGenerateResponse> {
    try {
      logger.info(
        {
          plan: req.plan,
          maxDevices: req.maxDevices,
          expiresAt: req.expiresAt,
        },
        'Generating license key'
      );

      const response = await request<LicenseGenerateResponse>(
        '/license/generate',
        'POST',
        req
      );

      logger.info(
        {
          licenseKey: response.data?.licenseKey?.substring(0, 10) + '...',
          plan: response.data?.plan,
        },
        'License generation completed'
      );

      return response;
    } catch (error) {
      logger.error({ plan: req.plan, error }, 'License generation failed');

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}
