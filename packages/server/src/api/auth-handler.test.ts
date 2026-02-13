// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for WebSocket authentication handler.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AuthRequestMessage } from '@aiinstaller/shared';
import { MessageType, PROTOCOL_VERSION } from '@aiinstaller/shared';
import {
  authenticateDevice,
  createAuthResponse,
  hasQuota,
  createAuthTimeout,
} from './auth-handler.js';
import { DeviceClient } from './device-client.js';

// Mock DeviceClient
vi.mock('./device-client.js', () => ({
  DeviceClient: {
    verify: vi.fn(),
    register: vi.fn(),
  },
}));

describe('auth-handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('authenticateDevice', () => {
    it('should authenticate device with valid token', async () => {
      const authRequest: AuthRequestMessage = {
        type: MessageType.AUTH_REQUEST,
        payload: {
          deviceId: 'test-device-123',
          deviceToken: 'valid-token',
          platform: 'darwin',
          osVersion: '14.0',
          architecture: 'arm64',
          hostname: 'test-host',
        },
        timestamp: Date.now(),
      };

      vi.mocked(DeviceClient.verify).mockResolvedValue({
        success: true,
        data: {
          valid: true,
          banned: false,
          plan: 'free',
          quotaLimit: 5,
          quotaUsed: 2,
        },
      });

      const result = await authenticateDevice(authRequest);

      expect(result.success).toBe(true);
      expect(result.deviceToken).toBe('valid-token');
      expect(result.quota).toEqual({
        limit: 5,
        used: 2,
        remaining: 3,
      });
      expect(result.plan).toBe('free');
      expect(DeviceClient.verify).toHaveBeenCalledWith({
        deviceId: 'test-device-123',
        token: 'valid-token',
      });
    });

    it('should reject banned device', async () => {
      const authRequest: AuthRequestMessage = {
        type: MessageType.AUTH_REQUEST,
        payload: {
          deviceId: 'banned-device',
          deviceToken: 'valid-token',
          platform: 'darwin',
        },
        timestamp: Date.now(),
      };

      vi.mocked(DeviceClient.verify).mockResolvedValue({
        success: true,
        data: {
          valid: true,
          banned: true,
          banReason: 'Abuse detected',
          plan: 'free',
          quotaLimit: 5,
          quotaUsed: 10,
        },
      });

      const result = await authenticateDevice(authRequest);

      expect(result.success).toBe(false);
      expect(result.banned).toBe(true);
      expect(result.banReason).toBe('Abuse detected');
      expect(result.error).toBe('Device is banned');
    });

    it('should auto-register device with invalid token', async () => {
      const authRequest: AuthRequestMessage = {
        type: MessageType.AUTH_REQUEST,
        payload: {
          deviceId: 'new-device',
          deviceToken: 'invalid-token',
          platform: 'linux',
          osVersion: 'Ubuntu 22.04',
          architecture: 'x64',
          hostname: 'ubuntu-host',
        },
        timestamp: Date.now(),
      };

      // Verify returns invalid
      vi.mocked(DeviceClient.verify).mockResolvedValue({
        success: true,
        data: {
          valid: false,
          banned: false,
          plan: 'free',
          quotaLimit: 5,
          quotaUsed: 0,
        },
      });

      // Register succeeds
      vi.mocked(DeviceClient.register).mockResolvedValue({
        success: true,
        data: {
          token: 'new-token',
          quotaLimit: 5,
          quotaUsed: 0,
          plan: 'free',
        },
      });

      const result = await authenticateDevice(authRequest);

      expect(result.success).toBe(true);
      expect(result.deviceToken).toBe('new-token');
      expect(result.quota).toEqual({
        limit: 5,
        used: 0,
        remaining: 5,
      });
      expect(DeviceClient.register).toHaveBeenCalledWith({
        deviceId: 'new-device',
        platform: 'linux',
        osVersion: 'Ubuntu 22.04',
        architecture: 'x64',
        hostname: 'ubuntu-host',
      });
    });

    it('should auto-register device without token', async () => {
      const authRequest: AuthRequestMessage = {
        type: MessageType.AUTH_REQUEST,
        payload: {
          deviceId: 'new-device',
          platform: 'darwin',
        },
        timestamp: Date.now(),
      };

      vi.mocked(DeviceClient.register).mockResolvedValue({
        success: true,
        data: {
          token: 'new-token',
          quotaLimit: 5,
          quotaUsed: 0,
          plan: 'free',
        },
      });

      const result = await authenticateDevice(authRequest);

      expect(result.success).toBe(true);
      expect(result.deviceToken).toBe('new-token');
      expect(DeviceClient.verify).not.toHaveBeenCalled();
    });

    it('should fail when registration fails', async () => {
      const authRequest: AuthRequestMessage = {
        type: MessageType.AUTH_REQUEST,
        payload: {
          deviceId: 'error-device',
          platform: 'darwin',
        },
        timestamp: Date.now(),
      };

      vi.mocked(DeviceClient.register).mockResolvedValue({
        success: false,
        error: 'Database connection failed',
      });

      const result = await authenticateDevice(authRequest);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Database connection failed');
    });
  });

  describe('createAuthResponse', () => {
    it('should create success auth response', () => {
      const authResult = {
        success: true,
        deviceToken: 'token-123',
        quota: {
          limit: 10,
          used: 3,
          remaining: 7,
        },
        plan: 'pro',
      };

      const response = createAuthResponse(authResult, 'req-123');

      expect(response.type).toBe(MessageType.AUTH_RESPONSE);
      expect(response.payload.success).toBe(true);
      expect(response.payload.deviceToken).toBe('token-123');
      expect(response.payload.quotaLimit).toBe(10);
      expect(response.payload.quotaUsed).toBe(3);
      expect(response.payload.quotaRemaining).toBe(7);
      expect(response.payload.plan).toBe('pro');
      expect(response.requestId).toBe('req-123');
    });

    it('should create failure auth response', () => {
      const authResult = {
        success: false,
        error: 'Invalid credentials',
      };

      const response = createAuthResponse(authResult);

      expect(response.type).toBe(MessageType.AUTH_RESPONSE);
      expect(response.payload.success).toBe(false);
      expect(response.payload.error).toBe('Invalid credentials');
      expect(response.requestId).toBeUndefined();
    });

    it('should include ban information', () => {
      const authResult = {
        success: false,
        error: 'Device banned',
        banned: true,
        banReason: 'Terms violation',
      };

      const response = createAuthResponse(authResult);

      expect(response.payload.success).toBe(false);
      expect(response.payload.banned).toBe(true);
      expect(response.payload.banReason).toBe('Terms violation');
    });
  });

  describe('hasQuota', () => {
    it('should return true when quota remaining', () => {
      const authResult = {
        success: true,
        deviceToken: 'token',
        quota: {
          limit: 5,
          used: 2,
          remaining: 3,
        },
      };

      expect(hasQuota(authResult)).toBe(true);
    });

    it('should return false when no quota remaining', () => {
      const authResult = {
        success: true,
        deviceToken: 'token',
        quota: {
          limit: 5,
          used: 5,
          remaining: 0,
        },
      };

      expect(hasQuota(authResult)).toBe(false);
    });

    it('should return false when auth failed', () => {
      const authResult = {
        success: false,
        error: 'Auth failed',
      };

      expect(hasQuota(authResult)).toBe(false);
    });

    it('should return false when quota not provided', () => {
      const authResult = {
        success: true,
        deviceToken: 'token',
      };

      expect(hasQuota(authResult)).toBe(false);
    });
  });

  describe('createAuthTimeout', () => {
    it('should reject after timeout', async () => {
      const promise = createAuthTimeout(100);

      await expect(promise).rejects.toThrow('Authentication timeout');
    }, 1000);

    it('should use custom timeout', async () => {
      const start = Date.now();
      const promise = createAuthTimeout(200);

      await expect(promise).rejects.toThrow('Authentication timeout');

      const elapsed = Date.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(200);
      expect(elapsed).toBeLessThan(300);
    }, 1000);
  });

  describe('createAuthResponse — version negotiation', () => {
    it('should include server protocolVersion in response', () => {
      const response = createAuthResponse({ success: true, deviceToken: 'tok' });
      expect(response.payload.protocolVersion).toBe(PROTOCOL_VERSION);
    });

    it('should include versionCheck for matching agent version', () => {
      const response = createAuthResponse(
        { success: true, deviceToken: 'tok' },
        'req-1',
        '1.0.0',
      );
      expect(response.payload.versionCheck).toBeDefined();
      expect(response.payload.versionCheck!.compatible).toBe(true);
      expect(response.payload.versionCheck!.severity).toBe('ok');
    });

    it('should include versionCheck warn for legacy agent (no version)', () => {
      const response = createAuthResponse(
        { success: true, deviceToken: 'tok' },
        'req-2',
        undefined,
      );
      expect(response.payload.versionCheck).toBeDefined();
      expect(response.payload.versionCheck!.compatible).toBe(true);
      expect(response.payload.versionCheck!.severity).toBe('warn');
      expect(response.payload.versionCheck!.message).toContain('legacy');
    });

    it('should include versionCheck error for incompatible major version', () => {
      const response = createAuthResponse(
        { success: false, error: 'version mismatch' },
        'req-3',
        '2.0.0',
      );
      expect(response.payload.versionCheck).toBeDefined();
      expect(response.payload.versionCheck!.compatible).toBe(false);
      expect(response.payload.versionCheck!.severity).toBe('error');
    });

    it('should include versionCheck error when agent minor exceeds server', () => {
      const response = createAuthResponse(
        { success: false, error: 'version mismatch' },
        'req-4',
        '1.5.0',
      );
      expect(response.payload.versionCheck).toBeDefined();
      expect(response.payload.versionCheck!.compatible).toBe(false);
      expect(response.payload.versionCheck!.severity).toBe('error');
    });

    it('should include versionCheck warn for invalid agent version format', () => {
      const response = createAuthResponse(
        { success: true, deviceToken: 'tok' },
        'req-5',
        'garbage',
      );
      expect(response.payload.versionCheck).toBeDefined();
      expect(response.payload.versionCheck!.compatible).toBe(true);
      expect(response.payload.versionCheck!.severity).toBe('warn');
    });
  });
});
