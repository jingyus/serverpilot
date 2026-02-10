/**
 * Device Client Tests
 *
 * Tests for Magic API device client integration
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DeviceClient } from './device-client.js';
import type {
  DeviceRegisterRequest,
  DeviceVerifyRequest,
  DeviceQuotaRequest,
  IncrementCallRequest,
} from './device-client.js';

// ============================================================================
// Mock Setup
// ============================================================================

// Save original fetch
const originalFetch = global.fetch;

// Mock response helper
function mockFetchResponse(data: unknown, status = 200, ok = true) {
  global.fetch = vi.fn().mockResolvedValue({
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    json: async () => data,
  });
}

// Mock fetch error
function mockFetchError(error: Error) {
  global.fetch = vi.fn().mockRejectedValue(error);
}

// Mock fetch timeout
function mockFetchTimeout() {
  global.fetch = vi.fn().mockImplementation(() => {
    return new Promise((_, reject) => {
      const error = new Error('Timeout');
      error.name = 'AbortError';
      setTimeout(() => reject(error), 100);
    });
  });
}

// ============================================================================
// Tests
// ============================================================================

describe('DeviceClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  // ==========================================================================
  // Device Registration Tests
  // ==========================================================================

  describe('register', () => {
    it('should register device successfully', async () => {
      const mockResponse = {
        success: true,
        data: {
          token: 'test-token-123',
          quotaLimit: 5,
          quotaUsed: 0,
          plan: 'free',
        },
      };

      mockFetchResponse(mockResponse);

      const request: DeviceRegisterRequest = {
        deviceId: 'device-123',
        platform: 'darwin',
        osVersion: 'macOS 14.0',
        architecture: 'arm64',
        hostname: 'test-mac',
      };

      const response = await DeviceClient.register(request);

      expect(response.success).toBe(true);
      expect(response.data?.token).toBe('test-token-123');
      expect(response.data?.quotaLimit).toBe(5);
      expect(response.data?.quotaUsed).toBe(0);
      expect(response.data?.plan).toBe('free');
    });

    it('should handle minimal registration request', async () => {
      const mockResponse = {
        success: true,
        data: {
          token: 'test-token-456',
          quotaLimit: 5,
          quotaUsed: 0,
          plan: 'free',
        },
      };

      mockFetchResponse(mockResponse);

      const request: DeviceRegisterRequest = {
        deviceId: 'device-456',
        platform: 'linux',
      };

      const response = await DeviceClient.register(request);

      expect(response.success).toBe(true);
      expect(response.data?.token).toBeDefined();
    });

    it('should handle registration failure', async () => {
      const mockResponse = {
        success: false,
        error: 'Device already registered',
      };

      mockFetchResponse(mockResponse);

      const request: DeviceRegisterRequest = {
        deviceId: 'device-789',
        platform: 'win32',
      };

      const response = await DeviceClient.register(request);

      expect(response.success).toBe(false);
      expect(response.error).toBe('Device already registered');
    });

    it('should handle network error during registration', async () => {
      mockFetchError(new Error('Network error'));

      const request: DeviceRegisterRequest = {
        deviceId: 'device-999',
        platform: 'darwin',
      };

      const response = await DeviceClient.register(request);

      expect(response.success).toBe(false);
      expect(response.error).toBeDefined();
    });

    it('should handle timeout during registration', async () => {
      mockFetchTimeout();

      const request: DeviceRegisterRequest = {
        deviceId: 'device-timeout',
        platform: 'linux',
      };

      const response = await DeviceClient.register(request);

      expect(response.success).toBe(false);
      expect(response.error).toContain('timeout');
    });
  });

  // ==========================================================================
  // Device Verification Tests
  // ==========================================================================

  describe('verify', () => {
    it('should verify valid device token', async () => {
      const mockResponse = {
        success: true,
        data: {
          valid: true,
          banned: false,
          plan: 'free',
          quotaLimit: 5,
          quotaUsed: 2,
        },
      };

      mockFetchResponse(mockResponse);

      const request: DeviceVerifyRequest = {
        deviceId: 'device-123',
        token: 'valid-token',
      };

      const response = await DeviceClient.verify(request);

      expect(response.success).toBe(true);
      expect(response.data?.valid).toBe(true);
      expect(response.data?.banned).toBe(false);
      expect(response.data?.quotaUsed).toBe(2);
    });

    it('should detect invalid token', async () => {
      const mockResponse = {
        success: true,
        data: {
          valid: false,
          banned: false,
          plan: 'free',
          quotaLimit: 5,
          quotaUsed: 0,
        },
      };

      mockFetchResponse(mockResponse);

      const request: DeviceVerifyRequest = {
        deviceId: 'device-123',
        token: 'invalid-token',
      };

      const response = await DeviceClient.verify(request);

      expect(response.success).toBe(true);
      expect(response.data?.valid).toBe(false);
    });

    it('should detect banned device', async () => {
      const mockResponse = {
        success: true,
        data: {
          valid: true,
          banned: true,
          banReason: 'Abuse detected',
          plan: 'free',
          quotaLimit: 5,
          quotaUsed: 100,
        },
      };

      mockFetchResponse(mockResponse);

      const request: DeviceVerifyRequest = {
        deviceId: 'device-banned',
        token: 'banned-token',
      };

      const response = await DeviceClient.verify(request);

      expect(response.success).toBe(true);
      expect(response.data?.banned).toBe(true);
      expect(response.data?.banReason).toBe('Abuse detected');
    });

    it('should handle verification error', async () => {
      mockFetchError(new Error('Database connection error'));

      const request: DeviceVerifyRequest = {
        deviceId: 'device-error',
        token: 'some-token',
      };

      const response = await DeviceClient.verify(request);

      expect(response.success).toBe(false);
      expect(response.error).toBeDefined();
    });
  });

  // ==========================================================================
  // Quota Query Tests
  // ==========================================================================

  describe('getQuota', () => {
    it('should query quota successfully', async () => {
      const mockResponse = {
        success: true,
        data: {
          quotaLimit: 5,
          quotaUsed: 3,
          quotaRemaining: 2,
          plan: 'free',
          resetDate: '2026-03-01',
        },
      };

      mockFetchResponse(mockResponse);

      const request: DeviceQuotaRequest = {
        deviceId: 'device-123',
        token: 'valid-token',
      };

      const response = await DeviceClient.getQuota(request);

      expect(response.success).toBe(true);
      expect(response.data?.quotaLimit).toBe(5);
      expect(response.data?.quotaUsed).toBe(3);
      expect(response.data?.quotaRemaining).toBe(2);
      expect(response.data?.resetDate).toBe('2026-03-01');
    });

    it('should show full quota remaining', async () => {
      const mockResponse = {
        success: true,
        data: {
          quotaLimit: 5,
          quotaUsed: 0,
          quotaRemaining: 5,
          plan: 'free',
          resetDate: '2026-03-01',
        },
      };

      mockFetchResponse(mockResponse);

      const request: DeviceQuotaRequest = {
        deviceId: 'device-new',
        token: 'new-token',
      };

      const response = await DeviceClient.getQuota(request);

      expect(response.success).toBe(true);
      expect(response.data?.quotaUsed).toBe(0);
      expect(response.data?.quotaRemaining).toBe(5);
    });

    it('should show quota exhausted', async () => {
      const mockResponse = {
        success: true,
        data: {
          quotaLimit: 5,
          quotaUsed: 5,
          quotaRemaining: 0,
          plan: 'free',
          resetDate: '2026-03-01',
        },
      };

      mockFetchResponse(mockResponse);

      const request: DeviceQuotaRequest = {
        deviceId: 'device-exhausted',
        token: 'exhausted-token',
      };

      const response = await DeviceClient.getQuota(request);

      expect(response.success).toBe(true);
      expect(response.data?.quotaUsed).toBe(5);
      expect(response.data?.quotaRemaining).toBe(0);
    });

    it('should show pro plan quota', async () => {
      const mockResponse = {
        success: true,
        data: {
          quotaLimit: 100,
          quotaUsed: 45,
          quotaRemaining: 55,
          plan: 'pro',
          resetDate: '2026-03-01',
        },
      };

      mockFetchResponse(mockResponse);

      const request: DeviceQuotaRequest = {
        deviceId: 'device-pro',
        token: 'pro-token',
      };

      const response = await DeviceClient.getQuota(request);

      expect(response.success).toBe(true);
      expect(response.data?.plan).toBe('pro');
      expect(response.data?.quotaLimit).toBe(100);
    });

    it('should handle quota query error', async () => {
      mockFetchError(new Error('Service unavailable'));

      const request: DeviceQuotaRequest = {
        deviceId: 'device-error',
        token: 'error-token',
      };

      const response = await DeviceClient.getQuota(request);

      expect(response.success).toBe(false);
      expect(response.error).toBeDefined();
    });
  });

  // ==========================================================================
  // Increment Call Count Tests
  // ==========================================================================

  describe('incrementCall', () => {
    it('should increment call count for environment analysis', async () => {
      const mockResponse = {
        success: true,
        data: {
          quotaUsed: 1,
          quotaRemaining: 4,
        },
      };

      mockFetchResponse(mockResponse);

      const request: IncrementCallRequest = {
        deviceId: 'device-123',
        token: 'valid-token',
        scene: 'envAnalysis',
      };

      const response = await DeviceClient.incrementCall(request);

      expect(response.success).toBe(true);
      expect(response.data?.quotaUsed).toBe(1);
      expect(response.data?.quotaRemaining).toBe(4);
    });

    it('should increment call count for plan generation', async () => {
      const mockResponse = {
        success: true,
        data: {
          quotaUsed: 2,
          quotaRemaining: 3,
        },
      };

      mockFetchResponse(mockResponse);

      const request: IncrementCallRequest = {
        deviceId: 'device-123',
        token: 'valid-token',
        scene: 'planGeneration',
      };

      const response = await DeviceClient.incrementCall(request);

      expect(response.success).toBe(true);
      expect(response.data?.quotaUsed).toBe(2);
      expect(response.data?.quotaRemaining).toBe(3);
    });

    it('should increment call count for error diagnosis', async () => {
      const mockResponse = {
        success: true,
        data: {
          quotaUsed: 3,
          quotaRemaining: 2,
        },
      };

      mockFetchResponse(mockResponse);

      const request: IncrementCallRequest = {
        deviceId: 'device-123',
        token: 'valid-token',
        scene: 'errorDiagnosis',
      };

      const response = await DeviceClient.incrementCall(request);

      expect(response.success).toBe(true);
      expect(response.data?.quotaUsed).toBe(3);
    });

    it('should increment call count for tutor', async () => {
      const mockResponse = {
        success: true,
        data: {
          quotaUsed: 4,
          quotaRemaining: 1,
        },
      };

      mockFetchResponse(mockResponse);

      const request: IncrementCallRequest = {
        deviceId: 'device-123',
        token: 'valid-token',
        scene: 'tutor',
      };

      const response = await DeviceClient.incrementCall(request);

      expect(response.success).toBe(true);
      expect(response.data?.quotaUsed).toBe(4);
      expect(response.data?.quotaRemaining).toBe(1);
    });

    it('should handle quota exhaustion', async () => {
      const mockResponse = {
        success: false,
        error: 'Quota exceeded',
      };

      mockFetchResponse(mockResponse);

      const request: IncrementCallRequest = {
        deviceId: 'device-exhausted',
        token: 'exhausted-token',
        scene: 'planGeneration',
      };

      const response = await DeviceClient.incrementCall(request);

      expect(response.success).toBe(false);
      expect(response.error).toContain('Quota exceeded');
    });

    it('should handle increment error', async () => {
      mockFetchError(new Error('Database write error'));

      const request: IncrementCallRequest = {
        deviceId: 'device-error',
        token: 'error-token',
        scene: 'envAnalysis',
      };

      const response = await DeviceClient.incrementCall(request);

      expect(response.success).toBe(false);
      expect(response.error).toBeDefined();
    });
  });

  // ==========================================================================
  // Health Check Tests
  // ==========================================================================

  describe('healthCheck', () => {
    it('should return true when Magic API is accessible', async () => {
      mockFetchResponse({ status: 'ok' });

      const result = await DeviceClient.healthCheck();

      expect(result).toBe(true);
    });

    it('should return false when Magic API is not accessible', async () => {
      mockFetchError(new Error('Connection refused'));

      const result = await DeviceClient.healthCheck();

      expect(result).toBe(false);
    });

    it('should return false on HTTP error', async () => {
      mockFetchResponse({ error: 'Service unavailable' }, 503, false);

      const result = await DeviceClient.healthCheck();

      expect(result).toBe(false);
    });

    it('should return false on timeout', async () => {
      mockFetchTimeout();

      const result = await DeviceClient.healthCheck();

      expect(result).toBe(false);
    });
  });

  // ==========================================================================
  // Integration Scenarios
  // ==========================================================================

  describe('integration scenarios', () => {
    it('should handle complete device lifecycle', async () => {
      // Step 1: Register device
      mockFetchResponse({
        success: true,
        data: {
          token: 'lifecycle-token',
          quotaLimit: 5,
          quotaUsed: 0,
          plan: 'free',
        },
      });

      const registerReq: DeviceRegisterRequest = {
        deviceId: 'lifecycle-device',
        platform: 'darwin',
      };

      const registerRes = await DeviceClient.register(registerReq);
      expect(registerRes.success).toBe(true);

      const token = registerRes.data!.token;

      // Step 2: Verify device
      mockFetchResponse({
        success: true,
        data: {
          valid: true,
          banned: false,
          plan: 'free',
          quotaLimit: 5,
          quotaUsed: 0,
        },
      });

      const verifyReq: DeviceVerifyRequest = {
        deviceId: 'lifecycle-device',
        token,
      };

      const verifyRes = await DeviceClient.verify(verifyReq);
      expect(verifyRes.success).toBe(true);
      expect(verifyRes.data?.valid).toBe(true);

      // Step 3: Check quota
      mockFetchResponse({
        success: true,
        data: {
          quotaLimit: 5,
          quotaUsed: 0,
          quotaRemaining: 5,
          plan: 'free',
          resetDate: '2026-03-01',
        },
      });

      const quotaReq: DeviceQuotaRequest = {
        deviceId: 'lifecycle-device',
        token,
      };

      const quotaRes = await DeviceClient.getQuota(quotaReq);
      expect(quotaRes.success).toBe(true);
      expect(quotaRes.data?.quotaRemaining).toBe(5);

      // Step 4: Increment call
      mockFetchResponse({
        success: true,
        data: {
          quotaUsed: 1,
          quotaRemaining: 4,
        },
      });

      const incrementReq: IncrementCallRequest = {
        deviceId: 'lifecycle-device',
        token,
        scene: 'envAnalysis',
      };

      const incrementRes = await DeviceClient.incrementCall(incrementReq);
      expect(incrementRes.success).toBe(true);
      expect(incrementRes.data?.quotaUsed).toBe(1);
      expect(incrementRes.data?.quotaRemaining).toBe(4);
    });

    it('should handle multiple AI scenes', async () => {
      const scenes = ['envAnalysis', 'planGeneration', 'errorDiagnosis', 'tutor'];
      const token = 'multi-scene-token';
      const deviceId = 'multi-scene-device';

      for (let i = 0; i < scenes.length; i++) {
        mockFetchResponse({
          success: true,
          data: {
            quotaUsed: i + 1,
            quotaRemaining: 5 - (i + 1),
          },
        });

        const request: IncrementCallRequest = {
          deviceId,
          token,
          scene: scenes[i],
        };

        const response = await DeviceClient.incrementCall(request);
        expect(response.success).toBe(true);
        expect(response.data?.quotaUsed).toBe(i + 1);
      }
    });

    it('should handle quota exhaustion scenario', async () => {
      const token = 'exhaustion-token';
      const deviceId = 'exhaustion-device';

      // First 5 calls succeed
      for (let i = 0; i < 5; i++) {
        mockFetchResponse({
          success: true,
          data: {
            quotaUsed: i + 1,
            quotaRemaining: 5 - (i + 1),
          },
        });

        const request: IncrementCallRequest = {
          deviceId,
          token,
          scene: 'planGeneration',
        };

        const response = await DeviceClient.incrementCall(request);
        expect(response.success).toBe(true);
      }

      // 6th call fails
      mockFetchResponse({
        success: false,
        error: 'Quota exceeded',
      });

      const finalRequest: IncrementCallRequest = {
        deviceId,
        token,
        scene: 'planGeneration',
      };

      const finalResponse = await DeviceClient.incrementCall(finalRequest);
      expect(finalResponse.success).toBe(false);
      expect(finalResponse.error).toContain('Quota exceeded');
    });
  });
});
