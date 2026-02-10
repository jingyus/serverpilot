/**
 * License Client Tests
 *
 * Tests for Magic API license client integration
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LicenseClient } from './license-client.js';
import type {
  LicenseValidateRequest,
  LicenseBindRequest,
  LicenseGenerateRequest,
} from './license-client.js';

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

describe('LicenseClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  // ==========================================================================
  // License Validation Tests
  // ==========================================================================

  describe('validate', () => {
    it('should validate valid free license', async () => {
      const mockResponse = {
        success: true,
        data: {
          valid: true,
          plan: 'free',
          maxDevices: 1,
          boundDevices: 0,
          expiresAt: null,
          active: true,
        },
      };

      mockFetchResponse(mockResponse);

      const request: LicenseValidateRequest = {
        licenseKey: 'FREE-LICENSE-KEY-2026',
      };

      const response = await LicenseClient.validate(request);

      expect(response.success).toBe(true);
      expect(response.data?.valid).toBe(true);
      expect(response.data?.plan).toBe('free');
      expect(response.data?.maxDevices).toBe(1);
      expect(response.data?.boundDevices).toBe(0);
      expect(response.data?.expiresAt).toBeNull();
      expect(response.data?.active).toBe(true);
    });

    it('should validate valid pro license', async () => {
      const mockResponse = {
        success: true,
        data: {
          valid: true,
          plan: 'pro',
          maxDevices: 3,
          boundDevices: 1,
          expiresAt: '2027-12-31 23:59:59',
          active: true,
        },
      };

      mockFetchResponse(mockResponse);

      const request: LicenseValidateRequest = {
        licenseKey: 'PRO-LICENSE-KEY-2026',
      };

      const response = await LicenseClient.validate(request);

      expect(response.success).toBe(true);
      expect(response.data?.valid).toBe(true);
      expect(response.data?.plan).toBe('pro');
      expect(response.data?.maxDevices).toBe(3);
      expect(response.data?.boundDevices).toBe(1);
      expect(response.data?.expiresAt).toBe('2027-12-31 23:59:59');
    });

    it('should validate valid enterprise license', async () => {
      const mockResponse = {
        success: true,
        data: {
          valid: true,
          plan: 'enterprise',
          maxDevices: 100,
          boundDevices: 25,
          expiresAt: '2028-06-30 23:59:59',
          active: true,
        },
      };

      mockFetchResponse(mockResponse);

      const request: LicenseValidateRequest = {
        licenseKey: 'ENTERPRISE-LICENSE-KEY-2026',
      };

      const response = await LicenseClient.validate(request);

      expect(response.success).toBe(true);
      expect(response.data?.valid).toBe(true);
      expect(response.data?.plan).toBe('enterprise');
      expect(response.data?.maxDevices).toBe(100);
      expect(response.data?.boundDevices).toBe(25);
    });

    it('should detect invalid license key', async () => {
      const mockResponse = {
        success: true,
        data: {
          valid: false,
          plan: 'free',
          maxDevices: 0,
          boundDevices: 0,
          expiresAt: null,
          active: false,
        },
      };

      mockFetchResponse(mockResponse);

      const request: LicenseValidateRequest = {
        licenseKey: 'INVALID-LICENSE-KEY',
      };

      const response = await LicenseClient.validate(request);

      expect(response.success).toBe(true);
      expect(response.data?.valid).toBe(false);
    });

    it('should detect expired license', async () => {
      const mockResponse = {
        success: true,
        data: {
          valid: false,
          plan: 'pro',
          maxDevices: 3,
          boundDevices: 2,
          expiresAt: '2025-12-31 23:59:59',
          active: false,
        },
      };

      mockFetchResponse(mockResponse);

      const request: LicenseValidateRequest = {
        licenseKey: 'EXPIRED-LICENSE-KEY',
      };

      const response = await LicenseClient.validate(request);

      expect(response.success).toBe(true);
      expect(response.data?.valid).toBe(false);
      expect(response.data?.active).toBe(false);
    });

    it('should detect inactive license', async () => {
      const mockResponse = {
        success: true,
        data: {
          valid: false,
          plan: 'pro',
          maxDevices: 3,
          boundDevices: 0,
          expiresAt: '2027-12-31 23:59:59',
          active: false,
        },
      };

      mockFetchResponse(mockResponse);

      const request: LicenseValidateRequest = {
        licenseKey: 'INACTIVE-LICENSE-KEY',
      };

      const response = await LicenseClient.validate(request);

      expect(response.success).toBe(true);
      expect(response.data?.valid).toBe(false);
      expect(response.data?.active).toBe(false);
    });

    it('should handle validation error', async () => {
      mockFetchError(new Error('Database connection error'));

      const request: LicenseValidateRequest = {
        licenseKey: 'ERROR-LICENSE-KEY',
      };

      const response = await LicenseClient.validate(request);

      expect(response.success).toBe(false);
      expect(response.error).toBeDefined();
    });

    it('should handle validation timeout', async () => {
      mockFetchTimeout();

      const request: LicenseValidateRequest = {
        licenseKey: 'TIMEOUT-LICENSE-KEY',
      };

      const response = await LicenseClient.validate(request);

      expect(response.success).toBe(false);
      expect(response.error).toContain('timeout');
    });
  });

  // ==========================================================================
  // License Binding Tests
  // ==========================================================================

  describe('bind', () => {
    it('should bind license to device successfully', async () => {
      const mockResponse = {
        success: true,
        data: {
          bound: true,
          plan: 'free',
          quotaLimit: 5,
          expiresAt: null,
        },
      };

      mockFetchResponse(mockResponse);

      const request: LicenseBindRequest = {
        licenseKey: 'FREE-LICENSE-KEY-2026',
        deviceId: 'device-123',
      };

      const response = await LicenseClient.bind(request);

      expect(response.success).toBe(true);
      expect(response.data?.bound).toBe(true);
      expect(response.data?.plan).toBe('free');
      expect(response.data?.quotaLimit).toBe(5);
      expect(response.data?.expiresAt).toBeNull();
    });

    it('should bind pro license to device', async () => {
      const mockResponse = {
        success: true,
        data: {
          bound: true,
          plan: 'pro',
          quotaLimit: 100,
          expiresAt: '2027-12-31 23:59:59',
        },
      };

      mockFetchResponse(mockResponse);

      const request: LicenseBindRequest = {
        licenseKey: 'PRO-LICENSE-KEY-2026',
        deviceId: 'device-456',
      };

      const response = await LicenseClient.bind(request);

      expect(response.success).toBe(true);
      expect(response.data?.bound).toBe(true);
      expect(response.data?.plan).toBe('pro');
      expect(response.data?.quotaLimit).toBe(100);
    });

    it('should bind enterprise license to device', async () => {
      const mockResponse = {
        success: true,
        data: {
          bound: true,
          plan: 'enterprise',
          quotaLimit: 10000,
          expiresAt: '2028-06-30 23:59:59',
        },
      };

      mockFetchResponse(mockResponse);

      const request: LicenseBindRequest = {
        licenseKey: 'ENTERPRISE-LICENSE-KEY-2026',
        deviceId: 'device-789',
      };

      const response = await LicenseClient.bind(request);

      expect(response.success).toBe(true);
      expect(response.data?.bound).toBe(true);
      expect(response.data?.plan).toBe('enterprise');
      expect(response.data?.quotaLimit).toBe(10000);
    });

    it('should handle device already bound', async () => {
      const mockResponse = {
        success: false,
        error: 'Device already bound to this license',
      };

      mockFetchResponse(mockResponse);

      const request: LicenseBindRequest = {
        licenseKey: 'FREE-LICENSE-KEY-2026',
        deviceId: 'device-already-bound',
      };

      const response = await LicenseClient.bind(request);

      expect(response.success).toBe(false);
      expect(response.error).toContain('already bound');
    });

    it('should handle max devices exceeded', async () => {
      const mockResponse = {
        success: false,
        error: 'License has reached maximum device limit',
      };

      mockFetchResponse(mockResponse);

      const request: LicenseBindRequest = {
        licenseKey: 'FREE-LICENSE-KEY-2026',
        deviceId: 'device-max-exceeded',
      };

      const response = await LicenseClient.bind(request);

      expect(response.success).toBe(false);
      expect(response.error).toContain('maximum device limit');
    });

    it('should handle invalid license on bind', async () => {
      const mockResponse = {
        success: false,
        error: 'License key not found',
      };

      mockFetchResponse(mockResponse);

      const request: LicenseBindRequest = {
        licenseKey: 'INVALID-LICENSE-KEY',
        deviceId: 'device-999',
      };

      const response = await LicenseClient.bind(request);

      expect(response.success).toBe(false);
      expect(response.error).toContain('not found');
    });

    it('should handle expired license on bind', async () => {
      const mockResponse = {
        success: false,
        error: 'License has expired',
      };

      mockFetchResponse(mockResponse);

      const request: LicenseBindRequest = {
        licenseKey: 'EXPIRED-LICENSE-KEY',
        deviceId: 'device-expired',
      };

      const response = await LicenseClient.bind(request);

      expect(response.success).toBe(false);
      expect(response.error).toContain('expired');
    });

    it('should handle bind error', async () => {
      mockFetchError(new Error('Database write error'));

      const request: LicenseBindRequest = {
        licenseKey: 'ERROR-LICENSE-KEY',
        deviceId: 'device-error',
      };

      const response = await LicenseClient.bind(request);

      expect(response.success).toBe(false);
      expect(response.error).toBeDefined();
    });

    it('should handle bind timeout', async () => {
      mockFetchTimeout();

      const request: LicenseBindRequest = {
        licenseKey: 'TIMEOUT-LICENSE-KEY',
        deviceId: 'device-timeout',
      };

      const response = await LicenseClient.bind(request);

      expect(response.success).toBe(false);
      expect(response.error).toContain('timeout');
    });
  });

  // ==========================================================================
  // License Generation Tests (Admin)
  // ==========================================================================

  describe('generate', () => {
    const ADMIN_TOKEN = 'admin-token-2026';

    it('should generate free license successfully', async () => {
      const mockResponse = {
        success: true,
        data: {
          licenseKey: 'FREE-GENERATED-KEY-2026',
          plan: 'free',
          maxDevices: 1,
          expiresAt: null,
        },
      };

      mockFetchResponse(mockResponse);

      const request: LicenseGenerateRequest = {
        plan: 'free',
        maxDevices: 1,
        adminToken: ADMIN_TOKEN,
      };

      const response = await LicenseClient.generate(request);

      expect(response.success).toBe(true);
      expect(response.data?.licenseKey).toBeDefined();
      expect(response.data?.plan).toBe('free');
      expect(response.data?.maxDevices).toBe(1);
      expect(response.data?.expiresAt).toBeNull();
    });

    it('should generate pro license successfully', async () => {
      const mockResponse = {
        success: true,
        data: {
          licenseKey: 'PRO-GENERATED-KEY-2026',
          plan: 'pro',
          maxDevices: 3,
          expiresAt: '2027-12-31 23:59:59',
        },
      };

      mockFetchResponse(mockResponse);

      const request: LicenseGenerateRequest = {
        plan: 'pro',
        maxDevices: 3,
        expiresAt: '2027-12-31 23:59:59',
        remark: 'Test pro license',
        adminToken: ADMIN_TOKEN,
      };

      const response = await LicenseClient.generate(request);

      expect(response.success).toBe(true);
      expect(response.data?.licenseKey).toBeDefined();
      expect(response.data?.plan).toBe('pro');
      expect(response.data?.maxDevices).toBe(3);
      expect(response.data?.expiresAt).toBe('2027-12-31 23:59:59');
    });

    it('should generate enterprise license successfully', async () => {
      const mockResponse = {
        success: true,
        data: {
          licenseKey: 'ENTERPRISE-GENERATED-KEY-2026',
          plan: 'enterprise',
          maxDevices: 100,
          expiresAt: '2028-06-30 23:59:59',
        },
      };

      mockFetchResponse(mockResponse);

      const request: LicenseGenerateRequest = {
        plan: 'enterprise',
        maxDevices: 100,
        expiresAt: '2028-06-30 23:59:59',
        remark: 'Enterprise customer ABC',
        adminToken: ADMIN_TOKEN,
      };

      const response = await LicenseClient.generate(request);

      expect(response.success).toBe(true);
      expect(response.data?.licenseKey).toBeDefined();
      expect(response.data?.plan).toBe('enterprise');
      expect(response.data?.maxDevices).toBe(100);
    });

    it('should generate license without expiration', async () => {
      const mockResponse = {
        success: true,
        data: {
          licenseKey: 'LIFETIME-GENERATED-KEY-2026',
          plan: 'enterprise',
          maxDevices: 50,
          expiresAt: null,
        },
      };

      mockFetchResponse(mockResponse);

      const request: LicenseGenerateRequest = {
        plan: 'enterprise',
        maxDevices: 50,
        remark: 'Lifetime enterprise license',
        adminToken: ADMIN_TOKEN,
      };

      const response = await LicenseClient.generate(request);

      expect(response.success).toBe(true);
      expect(response.data?.licenseKey).toBeDefined();
      expect(response.data?.expiresAt).toBeNull();
    });

    it('should handle invalid admin token', async () => {
      const mockResponse = {
        success: false,
        error: 'Invalid admin token',
      };

      mockFetchResponse(mockResponse);

      const request: LicenseGenerateRequest = {
        plan: 'pro',
        maxDevices: 3,
        adminToken: 'invalid-token',
      };

      const response = await LicenseClient.generate(request);

      expect(response.success).toBe(false);
      expect(response.error).toContain('Invalid admin token');
    });

    it('should handle invalid plan type', async () => {
      const mockResponse = {
        success: false,
        error: 'Invalid plan type',
      };

      mockFetchResponse(mockResponse);

      const request: LicenseGenerateRequest = {
        plan: 'invalid-plan',
        maxDevices: 1,
        adminToken: ADMIN_TOKEN,
      };

      const response = await LicenseClient.generate(request);

      expect(response.success).toBe(false);
      expect(response.error).toContain('Invalid plan type');
    });

    it('should handle invalid max devices', async () => {
      const mockResponse = {
        success: false,
        error: 'Invalid max devices value',
      };

      mockFetchResponse(mockResponse);

      const request: LicenseGenerateRequest = {
        plan: 'pro',
        maxDevices: -1,
        adminToken: ADMIN_TOKEN,
      };

      const response = await LicenseClient.generate(request);

      expect(response.success).toBe(false);
      expect(response.error).toContain('Invalid max devices');
    });

    it('should handle generation error', async () => {
      mockFetchError(new Error('Database insert error'));

      const request: LicenseGenerateRequest = {
        plan: 'pro',
        maxDevices: 3,
        adminToken: ADMIN_TOKEN,
      };

      const response = await LicenseClient.generate(request);

      expect(response.success).toBe(false);
      expect(response.error).toBeDefined();
    });

    it('should handle generation timeout', async () => {
      mockFetchTimeout();

      const request: LicenseGenerateRequest = {
        plan: 'enterprise',
        maxDevices: 100,
        adminToken: ADMIN_TOKEN,
      };

      const response = await LicenseClient.generate(request);

      expect(response.success).toBe(false);
      expect(response.error).toContain('timeout');
    });
  });

  // ==========================================================================
  // Integration Scenarios
  // ==========================================================================

  describe('integration scenarios', () => {
    it('should handle complete license lifecycle', async () => {
      const ADMIN_TOKEN = 'admin-token-2026';

      // Step 1: Generate license
      mockFetchResponse({
        success: true,
        data: {
          licenseKey: 'LIFECYCLE-TEST-KEY-2026',
          plan: 'pro',
          maxDevices: 3,
          expiresAt: '2027-12-31 23:59:59',
        },
      });

      const generateReq: LicenseGenerateRequest = {
        plan: 'pro',
        maxDevices: 3,
        expiresAt: '2027-12-31 23:59:59',
        remark: 'Test lifecycle',
        adminToken: ADMIN_TOKEN,
      };

      const generateRes = await LicenseClient.generate(generateReq);
      expect(generateRes.success).toBe(true);

      const licenseKey = generateRes.data!.licenseKey;

      // Step 2: Validate license
      mockFetchResponse({
        success: true,
        data: {
          valid: true,
          plan: 'pro',
          maxDevices: 3,
          boundDevices: 0,
          expiresAt: '2027-12-31 23:59:59',
          active: true,
        },
      });

      const validateReq: LicenseValidateRequest = {
        licenseKey,
      };

      const validateRes = await LicenseClient.validate(validateReq);
      expect(validateRes.success).toBe(true);
      expect(validateRes.data?.valid).toBe(true);
      expect(validateRes.data?.boundDevices).toBe(0);

      // Step 3: Bind license to first device
      mockFetchResponse({
        success: true,
        data: {
          bound: true,
          plan: 'pro',
          quotaLimit: 100,
          expiresAt: '2027-12-31 23:59:59',
        },
      });

      const bindReq1: LicenseBindRequest = {
        licenseKey,
        deviceId: 'device-001',
      };

      const bindRes1 = await LicenseClient.bind(bindReq1);
      expect(bindRes1.success).toBe(true);
      expect(bindRes1.data?.bound).toBe(true);

      // Step 4: Validate again (should show 1 bound device)
      mockFetchResponse({
        success: true,
        data: {
          valid: true,
          plan: 'pro',
          maxDevices: 3,
          boundDevices: 1,
          expiresAt: '2027-12-31 23:59:59',
          active: true,
        },
      });

      const validateRes2 = await LicenseClient.validate(validateReq);
      expect(validateRes2.success).toBe(true);
      expect(validateRes2.data?.boundDevices).toBe(1);

      // Step 5: Bind license to second device
      mockFetchResponse({
        success: true,
        data: {
          bound: true,
          plan: 'pro',
          quotaLimit: 100,
          expiresAt: '2027-12-31 23:59:59',
        },
      });

      const bindReq2: LicenseBindRequest = {
        licenseKey,
        deviceId: 'device-002',
      };

      const bindRes2 = await LicenseClient.bind(bindReq2);
      expect(bindRes2.success).toBe(true);

      // Step 6: Bind license to third device
      mockFetchResponse({
        success: true,
        data: {
          bound: true,
          plan: 'pro',
          quotaLimit: 100,
          expiresAt: '2027-12-31 23:59:59',
        },
      });

      const bindReq3: LicenseBindRequest = {
        licenseKey,
        deviceId: 'device-003',
      };

      const bindRes3 = await LicenseClient.bind(bindReq3);
      expect(bindRes3.success).toBe(true);

      // Step 7: Try to bind fourth device (should fail)
      mockFetchResponse({
        success: false,
        error: 'License has reached maximum device limit',
      });

      const bindReq4: LicenseBindRequest = {
        licenseKey,
        deviceId: 'device-004',
      };

      const bindRes4 = await LicenseClient.bind(bindReq4);
      expect(bindRes4.success).toBe(false);
      expect(bindRes4.error).toContain('maximum device limit');
    });

    it('should handle license upgrade scenario', async () => {
      const ADMIN_TOKEN = 'admin-token-2026';
      const deviceId = 'device-upgrade-test';

      // Start with free license
      mockFetchResponse({
        success: true,
        data: {
          licenseKey: 'FREE-UPGRADE-KEY-2026',
          plan: 'free',
          maxDevices: 1,
          expiresAt: null,
        },
      });

      const genFreeReq: LicenseGenerateRequest = {
        plan: 'free',
        maxDevices: 1,
        adminToken: ADMIN_TOKEN,
      };

      const genFreeRes = await LicenseClient.generate(genFreeReq);
      const freeLicenseKey = genFreeRes.data!.licenseKey;

      // Bind free license
      mockFetchResponse({
        success: true,
        data: {
          bound: true,
          plan: 'free',
          quotaLimit: 5,
          expiresAt: null,
        },
      });

      const bindFreeReq: LicenseBindRequest = {
        licenseKey: freeLicenseKey,
        deviceId,
      };

      const bindFreeRes = await LicenseClient.bind(bindFreeReq);
      expect(bindFreeRes.data?.quotaLimit).toBe(5);

      // Upgrade to pro license
      mockFetchResponse({
        success: true,
        data: {
          licenseKey: 'PRO-UPGRADE-KEY-2026',
          plan: 'pro',
          maxDevices: 3,
          expiresAt: '2027-12-31 23:59:59',
        },
      });

      const genProReq: LicenseGenerateRequest = {
        plan: 'pro',
        maxDevices: 3,
        expiresAt: '2027-12-31 23:59:59',
        adminToken: ADMIN_TOKEN,
      };

      const genProRes = await LicenseClient.generate(genProReq);
      const proLicenseKey = genProRes.data!.licenseKey;

      // Bind pro license
      mockFetchResponse({
        success: true,
        data: {
          bound: true,
          plan: 'pro',
          quotaLimit: 100,
          expiresAt: '2027-12-31 23:59:59',
        },
      });

      const bindProReq: LicenseBindRequest = {
        licenseKey: proLicenseKey,
        deviceId,
      };

      const bindProRes = await LicenseClient.bind(bindProReq);
      expect(bindProRes.data?.quotaLimit).toBe(100);
    });

    it('should handle multiple plan types', async () => {
      const ADMIN_TOKEN = 'admin-token-2026';
      const plans = [
        { plan: 'free', maxDevices: 1, quotaLimit: 5 },
        { plan: 'pro', maxDevices: 3, quotaLimit: 100 },
        { plan: 'enterprise', maxDevices: 100, quotaLimit: 10000 },
      ];

      for (const { plan, maxDevices, quotaLimit } of plans) {
        // Generate license
        mockFetchResponse({
          success: true,
          data: {
            licenseKey: `${plan.toUpperCase()}-MULTI-TEST-2026`,
            plan,
            maxDevices,
            expiresAt: null,
          },
        });

        const genReq: LicenseGenerateRequest = {
          plan,
          maxDevices,
          adminToken: ADMIN_TOKEN,
        };

        const genRes = await LicenseClient.generate(genReq);
        expect(genRes.success).toBe(true);
        expect(genRes.data?.plan).toBe(plan);

        // Validate license
        mockFetchResponse({
          success: true,
          data: {
            valid: true,
            plan,
            maxDevices,
            boundDevices: 0,
            expiresAt: null,
            active: true,
          },
        });

        const validateReq: LicenseValidateRequest = {
          licenseKey: genRes.data!.licenseKey,
        };

        const validateRes = await LicenseClient.validate(validateReq);
        expect(validateRes.success).toBe(true);
        expect(validateRes.data?.plan).toBe(plan);

        // Bind license
        mockFetchResponse({
          success: true,
          data: {
            bound: true,
            plan,
            quotaLimit,
            expiresAt: null,
          },
        });

        const bindReq: LicenseBindRequest = {
          licenseKey: genRes.data!.licenseKey,
          deviceId: `device-${plan}`,
        };

        const bindRes = await LicenseClient.bind(bindReq);
        expect(bindRes.success).toBe(true);
        expect(bindRes.data?.quotaLimit).toBe(quotaLimit);
      }
    });
  });
});
