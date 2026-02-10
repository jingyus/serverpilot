/**
 * Authenticated WebSocket client for AI Installer agent.
 *
 * Extends the base InstallClient with automatic device authentication:
 * - Generates/loads device fingerprint
 * - Sends authentication request on connection
 * - Handles authentication responses
 * - Stores device token locally
 *
 * @module authenticated-client
 */

import { InstallClient } from './client.js';
import type { InstallClientOptions } from './client.js';
import type { AuthResponseMessage } from '@aiinstaller/shared';
import { MessageType, createMessageLite as createMessage } from './protocol-lite.js';
import { getOrCreateDeviceFingerprint, updateDeviceToken } from './detect/device-fingerprint.js';
import type { DeviceAuthInfo } from './detect/device-fingerprint.js';
import os from 'node:os';

/**
 * Authentication state for the client.
 */
export interface AuthState {
  /** Whether authentication is complete */
  authenticated: boolean;
  /** Device information */
  deviceInfo?: DeviceAuthInfo;
  /** Authentication error if failed */
  error?: string;
  /** Quota information */
  quota?: {
    limit: number;
    used: number;
    remaining: number;
  };
  /** Plan type */
  plan?: string;
}

/**
 * Options for authenticated client.
 */
export interface AuthenticatedClientOptions extends InstallClientOptions {
  /** Timeout for authentication in ms (default: 10000) */
  authTimeoutMs?: number;
}

/**
 * Authenticated WebSocket client with automatic device authentication.
 *
 * Automatically handles device fingerprint generation and authentication
 * handshake when connecting to the server.
 *
 * @example
 * ```ts
 * const client = new AuthenticatedClient({ serverUrl: 'ws://localhost:3000' });
 * await client.connectAndAuth();
 * // Client is now authenticated and ready to use
 * ```
 */
export class AuthenticatedClient extends InstallClient {
  private authState: AuthState = { authenticated: false };
  private readonly authTimeoutMs: number;

  constructor(options: AuthenticatedClientOptions) {
    super(options);
    this.authTimeoutMs = options.authTimeoutMs ?? 10000;
  }

  /**
   * Get current authentication state.
   */
  getAuthState(): AuthState {
    return { ...this.authState };
  }

  /**
   * Check if client is authenticated.
   */
  isAuthenticated(): boolean {
    return this.authState.authenticated;
  }

  /**
   * Get device information.
   */
  getDeviceInfo(): DeviceAuthInfo | undefined {
    return this.authState.deviceInfo;
  }

  /**
   * Connect to server and perform authentication handshake.
   *
   * This is the main method to use for establishing an authenticated connection.
   *
   * @returns Promise that resolves when connection and authentication are complete
   * @throws {Error} When connection or authentication fails
   */
  async connectAndAuth(): Promise<void> {
    // Reset auth state
    this.authState = { authenticated: false };

    // Connect to server
    await this.connect();

    // Perform authentication handshake
    await this.authenticate();
  }

  /**
   * Perform authentication handshake.
   *
   * Sends authentication request and waits for response.
   *
   * @returns Promise that resolves when authentication is complete
   * @throws {Error} When authentication fails or times out
   */
  private async authenticate(): Promise<void> {
    // Get or create device fingerprint
    const deviceInfo = getOrCreateDeviceFingerprint();
    this.authState.deviceInfo = deviceInfo;

    // Create authentication request
    const authRequest = createMessage(
      MessageType.AUTH_REQUEST,
      {
        deviceId: deviceInfo.deviceId,
        deviceToken: deviceInfo.deviceToken,
        platform: deviceInfo.platform,
        osVersion: os.release(),
        architecture: deviceInfo.arch,
        hostname: deviceInfo.hostname,
      }
    );

    // Send auth request and wait for response
    const authResponse = await this.sendAndWait<typeof MessageType.AUTH_RESPONSE>(
      authRequest,
      MessageType.AUTH_RESPONSE,
      this.authTimeoutMs
    );

    // Handle authentication response
    await this.handleAuthResponse(authResponse);
  }

  /**
   * Handle authentication response from server.
   *
   * @param response - Authentication response message
   * @throws {Error} When authentication fails
   */
  private async handleAuthResponse(response: AuthResponseMessage): Promise<void> {
    if (!response.payload.success) {
      const error = response.payload.error || 'Authentication failed';

      this.authState = {
        authenticated: false,
        error,
        deviceInfo: this.authState.deviceInfo,
      };

      throw new Error(`Authentication failed: ${error}`);
    }

    // Authentication succeeded
    const { deviceToken, quotaLimit, quotaUsed, quotaRemaining, plan, banned, banReason } =
      response.payload;

    // Check if device is banned
    if (banned) {
      const error = `Device is banned: ${banReason || 'No reason provided'}`;
      this.authState = {
        authenticated: false,
        error,
        deviceInfo: this.authState.deviceInfo,
      };

      throw new Error(error);
    }

    // Update device token if provided (for new registrations)
    if (deviceToken && deviceToken !== this.authState.deviceInfo?.deviceToken) {
      updateDeviceToken(deviceToken);

      // Reload device info with updated token
      this.authState.deviceInfo = getOrCreateDeviceFingerprint();
    }

    // Update auth state
    this.authState = {
      authenticated: true,
      deviceInfo: this.authState.deviceInfo,
      quota:
        quotaLimit !== undefined && quotaUsed !== undefined && quotaRemaining !== undefined
          ? {
              limit: quotaLimit,
              used: quotaUsed,
              remaining: quotaRemaining,
            }
          : undefined,
      plan,
    };
  }

  /**
   * Override disconnect to clear auth state.
   */
  override disconnect(code?: number, reason?: string): void {
    this.authState = { authenticated: false };
    super.disconnect(code, reason);
  }
}
