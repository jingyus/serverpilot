// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Unit tests for Rate Limiting Middleware
 *
 * Tests rate limiting functionality including:
 * - Quota checking
 * - AI call incrementing
 * - AI call logging
 * - Upgrade messages
 * - Error handling
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  checkRateLimit,
  incrementAICall,
  logAICall,
  getUpgradeMessage,
  isQuotaExceededError,
  createQuotaExceededMessage,
  QUOTA_EXCEEDED_ERROR,
  FREE_TIER_INSTALLATION_LIMIT,
  FREE_TIER_AI_CALL_LIMIT,
  type AICallInfo,
} from './rate-limiter.js';
import { DeviceClient } from './device-client.js';
import { sessionClient } from './session-client.js';

// ============================================================================
// Mock Setup
// ============================================================================

vi.mock('./device-client.js', () => ({
  DeviceClient: {
    getQuota: vi.fn(),
    incrementCall: vi.fn(),
  },
}));

vi.mock('./session-client.js', () => ({
  SessionClient: {
    logAICall: vi.fn(),
  },
  sessionClient: {
    logAICall: vi.fn(),
  },
}));

vi.mock('../utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// ============================================================================
// Test Suite
// ============================================================================

describe('Rate Limiter', () => {
  const mockDeviceId = 'device-123';
  const mockToken = 'token-456';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // Constants
  // ==========================================================================

  describe('Constants', () => {
    it('should export correct free tier limits', () => {
      expect(FREE_TIER_INSTALLATION_LIMIT).toBe(5);
      expect(FREE_TIER_AI_CALL_LIMIT).toBe(20);
      expect(QUOTA_EXCEEDED_ERROR).toBe('QUOTA_EXCEEDED');
    });
  });

  // ==========================================================================
  // checkRateLimit
  // ==========================================================================

  describe('checkRateLimit', () => {
    it('should allow operation when quota is available', async () => {
      vi.mocked(DeviceClient.getQuota).mockResolvedValue({
        success: true,
        data: {
          quotaLimit: 5,
          quotaUsed: 2,
          quotaRemaining: 3,
          plan: 'free',
          resetDate: '2026-03-01',
        },
      });

      const result = await checkRateLimit(mockDeviceId, mockToken);

      expect(result.allowed).toBe(true);
      expect(result.quotaRemaining).toBe(3);
      expect(result.error).toBeUndefined();
      expect(DeviceClient.getQuota).toHaveBeenCalledWith({
        deviceId: mockDeviceId,
        token: mockToken,
      });
    });

    it('should deny operation when quota is exhausted (free plan)', async () => {
      vi.mocked(DeviceClient.getQuota).mockResolvedValue({
        success: true,
        data: {
          quotaLimit: 5,
          quotaUsed: 5,
          quotaRemaining: 0,
          plan: 'free',
          resetDate: '2026-03-01',
        },
      });

      const result = await checkRateLimit(mockDeviceId, mockToken);

      expect(result.allowed).toBe(false);
      expect(result.quotaRemaining).toBe(0);
      expect(result.error).toBe('Monthly quota exceeded');
      expect(result.errorCode).toBe(QUOTA_EXCEEDED_ERROR);
      expect(result.upgradeMessage).toContain('Upgrade to Pro');
      expect(result.upgradeMessage).toContain('https://aiinstaller.dev/pricing');
    });

    it('should deny operation when quota is exhausted (pro plan)', async () => {
      vi.mocked(DeviceClient.getQuota).mockResolvedValue({
        success: true,
        data: {
          quotaLimit: 100,
          quotaUsed: 100,
          quotaRemaining: 0,
          plan: 'pro',
          resetDate: '2026-03-01',
        },
      });

      const result = await checkRateLimit(mockDeviceId, mockToken);

      expect(result.allowed).toBe(false);
      expect(result.quotaRemaining).toBe(0);
      expect(result.error).toBe('Monthly quota exceeded');
      expect(result.errorCode).toBe(QUOTA_EXCEEDED_ERROR);
      expect(result.upgradeMessage).toContain('contact support');
      expect(result.upgradeMessage).not.toContain('Upgrade to Pro');
    });

    it('should handle quota query failure', async () => {
      vi.mocked(DeviceClient.getQuota).mockResolvedValue({
        success: false,
        error: 'Network error',
      });

      const result = await checkRateLimit(mockDeviceId, mockToken);

      expect(result.allowed).toBe(false);
      expect(result.error).toBe('Network error');
      expect(result.quotaRemaining).toBeUndefined();
    });

    it('should handle exceptions during quota check', async () => {
      vi.mocked(DeviceClient.getQuota).mockRejectedValue(new Error('Connection timeout'));

      const result = await checkRateLimit(mockDeviceId, mockToken);

      expect(result.allowed).toBe(false);
      expect(result.error).toBe('Connection timeout');
    });

    it('should allow operation when quota is at threshold', async () => {
      vi.mocked(DeviceClient.getQuota).mockResolvedValue({
        success: true,
        data: {
          quotaLimit: 5,
          quotaUsed: 4,
          quotaRemaining: 1,
          plan: 'free',
          resetDate: '2026-03-01',
        },
      });

      const result = await checkRateLimit(mockDeviceId, mockToken);

      expect(result.allowed).toBe(true);
      expect(result.quotaRemaining).toBe(1);
    });
  });

  // ==========================================================================
  // incrementAICall
  // ==========================================================================

  describe('incrementAICall', () => {
    it('should successfully increment AI call count', async () => {
      vi.mocked(DeviceClient.incrementCall).mockResolvedValue({
        success: true,
        data: {
          quotaUsed: 3,
          quotaRemaining: 2,
        },
      });

      const result = await incrementAICall(mockDeviceId, mockToken, 'planGeneration');

      expect(result.success).toBe(true);
      expect(result.quotaRemaining).toBe(2);
      expect(result.error).toBeUndefined();
      expect(DeviceClient.incrementCall).toHaveBeenCalledWith({
        deviceId: mockDeviceId,
        token: mockToken,
        scene: 'planGeneration',
      });
    });

    it('should handle different AI operation types', async () => {
      const operations: Array<'envAnalysis' | 'planGeneration' | 'errorDiagnosis' | 'fixGeneration'> = [
        'envAnalysis',
        'planGeneration',
        'errorDiagnosis',
        'fixGeneration',
      ];

      for (const operation of operations) {
        vi.mocked(DeviceClient.incrementCall).mockResolvedValue({
          success: true,
          data: {
            quotaUsed: 1,
            quotaRemaining: 4,
          },
        });

        const result = await incrementAICall(mockDeviceId, mockToken, operation);

        expect(result.success).toBe(true);
        expect(DeviceClient.incrementCall).toHaveBeenCalledWith({
          deviceId: mockDeviceId,
          token: mockToken,
          scene: operation,
        });
      }
    });

    it('should handle increment failure', async () => {
      vi.mocked(DeviceClient.incrementCall).mockResolvedValue({
        success: false,
        error: 'Database error',
      });

      const result = await incrementAICall(mockDeviceId, mockToken, 'envAnalysis');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Database error');
      expect(result.quotaRemaining).toBeUndefined();
    });

    it('should handle exceptions during increment', async () => {
      vi.mocked(DeviceClient.incrementCall).mockRejectedValue(
        new Error('Connection timeout')
      );

      const result = await incrementAICall(mockDeviceId, mockToken, 'errorDiagnosis');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Connection timeout');
    });

    it('should track quota consumption correctly', async () => {
      // Simulate multiple AI calls
      const callSequence = [
        { quotaUsed: 1, quotaRemaining: 4 },
        { quotaUsed: 2, quotaRemaining: 3 },
        { quotaUsed: 3, quotaRemaining: 2 },
      ];

      for (const quota of callSequence) {
        vi.mocked(DeviceClient.incrementCall).mockResolvedValue({
          success: true,
          data: quota,
        });

        const result = await incrementAICall(mockDeviceId, mockToken, 'planGeneration');

        expect(result.success).toBe(true);
        expect(result.quotaRemaining).toBe(quota.quotaRemaining);
      }
    });
  });

  // ==========================================================================
  // logAICall
  // ==========================================================================

  describe('logAICall', () => {
    const mockCallInfo: AICallInfo = {
      sessionId: 'session-789',
      operation: 'planGeneration',
      provider: 'claude',
      model: 'claude-3-5-sonnet-20241022',
      inputTokens: 1000,
      outputTokens: 500,
      success: true,
      latencyMs: 2500,
    };

    it('should successfully log AI call', async () => {
      vi.mocked(sessionClient.logAICall).mockResolvedValue({
        success: true,
        data: {
          logId: 'log-123',
        },
      });

      const result = await logAICall(mockDeviceId, mockToken, mockCallInfo);

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
      expect(sessionClient.logAICall).toHaveBeenCalledWith({
        deviceId: mockDeviceId,
        sessionId: mockCallInfo.sessionId,
        scene: mockCallInfo.operation,
        provider: mockCallInfo.provider,
        model: mockCallInfo.model,
        inputTokens: mockCallInfo.inputTokens,
        outputTokens: mockCallInfo.outputTokens,
        success: mockCallInfo.success,
        errorMessage: mockCallInfo.error,
        durationMs: mockCallInfo.latencyMs,
      });
    });

    it('should log failed AI call with error', async () => {
      const failedCallInfo: AICallInfo = {
        ...mockCallInfo,
        success: false,
        error: 'Rate limit exceeded',
      };

      vi.mocked(sessionClient.logAICall).mockResolvedValue({
        success: true,
        data: {
          logId: 'log-456',
        },
      });

      const result = await logAICall(mockDeviceId, mockToken, failedCallInfo);

      expect(result.success).toBe(true);
      expect(sessionClient.logAICall).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          errorMessage: 'Rate limit exceeded',
        })
      );
    });

    it('should handle different AI providers', async () => {
      const providers = ['claude', 'deepseek', 'gpt'];

      for (const provider of providers) {
        const callInfo = { ...mockCallInfo, provider };

        vi.mocked(sessionClient.logAICall).mockResolvedValue({
          success: true,
          data: { logId: `log-${provider}` },
        });

        await logAICall(mockDeviceId, mockToken, callInfo);

        expect(sessionClient.logAICall).toHaveBeenCalledWith(
          expect.objectContaining({ provider })
        );
      }
    });

    it('should handle logging failure gracefully', async () => {
      vi.mocked(sessionClient.logAICall).mockResolvedValue({
        success: false,
        error: 'Database connection failed',
      });

      const result = await logAICall(mockDeviceId, mockToken, mockCallInfo);

      // Logging failure should not fail the operation
      expect(result.success).toBe(false);
      expect(result.error).toBe('Database connection failed');
    });

    it('should handle exceptions during logging', async () => {
      vi.mocked(sessionClient.logAICall).mockRejectedValue(new Error('Network error'));

      const result = await logAICall(mockDeviceId, mockToken, mockCallInfo);

      // Exception should be caught and not propagate
      expect(result.success).toBe(false);
      expect(result.error).toBe('Network error');
    });
  });

  // ==========================================================================
  // Upgrade Messages
  // ==========================================================================

  describe('getUpgradeMessage', () => {
    it('should return free plan upgrade message', () => {
      const message = getUpgradeMessage('free');

      expect(message).toContain('Upgrade to Pro');
      expect(message).toContain('5 installations');
      expect(message).toContain('https://aiinstaller.dev/pricing');
      expect(message).toContain('Unlimited installations');
    });

    it('should return pro plan quota message', () => {
      const message = getUpgradeMessage('pro');

      expect(message).not.toContain('Upgrade to Pro');
      expect(message).toContain('contact support');
      expect(message).toContain('support@aiinstaller.dev');
    });

    it('should return pro plan message for enterprise plan', () => {
      const message = getUpgradeMessage('enterprise');

      expect(message).not.toContain('Upgrade to Pro');
      expect(message).toContain('contact support');
    });
  });

  describe('createQuotaExceededMessage', () => {
    it('should create quota exceeded message with upgrade guidance', () => {
      const message = createQuotaExceededMessage('free');

      expect(message).toContain('Upgrade to Pro');
      expect(message).toContain(QUOTA_EXCEEDED_ERROR);
    });

    it('should create quota exceeded message for pro plan', () => {
      const message = createQuotaExceededMessage('pro');

      expect(message).toContain('contact support');
      expect(message).toContain(QUOTA_EXCEEDED_ERROR);
    });
  });

  // ==========================================================================
  // Error Detection
  // ==========================================================================

  describe('isQuotaExceededError', () => {
    it('should detect quota exceeded error from string', () => {
      expect(isQuotaExceededError('quota exceeded')).toBe(true);
      expect(isQuotaExceededError('Monthly quota exceeded')).toBe(true);
      expect(isQuotaExceededError(QUOTA_EXCEEDED_ERROR)).toBe(true);
    });

    it('should detect quota exceeded error from Error object', () => {
      expect(isQuotaExceededError(new Error('quota exceeded'))).toBe(true);
      expect(isQuotaExceededError(new Error(QUOTA_EXCEEDED_ERROR))).toBe(true);
    });

    it('should return false for non-quota errors', () => {
      expect(isQuotaExceededError('Network error')).toBe(false);
      expect(isQuotaExceededError(new Error('Database error'))).toBe(false);
      expect(isQuotaExceededError(null)).toBe(false);
      expect(isQuotaExceededError(undefined)).toBe(false);
      expect(isQuotaExceededError({})).toBe(false);
    });
  });

  // ==========================================================================
  // Integration Scenarios
  // ==========================================================================

  describe('Integration Scenarios', () => {
    it('should handle complete rate limiting flow', async () => {
      // 1. Check rate limit (allowed)
      vi.mocked(DeviceClient.getQuota).mockResolvedValue({
        success: true,
        data: {
          quotaLimit: 5,
          quotaUsed: 2,
          quotaRemaining: 3,
          plan: 'free',
          resetDate: '2026-03-01',
        },
      });

      const checkResult = await checkRateLimit(mockDeviceId, mockToken);
      expect(checkResult.allowed).toBe(true);

      // 2. Perform AI operation (simulated)
      // ...

      // 3. Increment call count
      vi.mocked(DeviceClient.incrementCall).mockResolvedValue({
        success: true,
        data: {
          quotaUsed: 3,
          quotaRemaining: 2,
        },
      });

      const incrementResult = await incrementAICall(
        mockDeviceId,
        mockToken,
        'planGeneration'
      );
      expect(incrementResult.success).toBe(true);

      // 4. Log AI call
      vi.mocked(sessionClient.logAICall).mockResolvedValue({
        success: true,
        data: { logId: 'log-123' },
      });

      const logResult = await logAICall(mockDeviceId, mockToken, {
        sessionId: 'session-789',
        operation: 'planGeneration',
        provider: 'claude',
        model: 'claude-3-5-sonnet-20241022',
        inputTokens: 1000,
        outputTokens: 500,
        success: true,
        latencyMs: 2500,
      });
      expect(logResult.success).toBe(true);
    });

    it('should block operation when quota is reached', async () => {
      // Check rate limit (quota exhausted)
      vi.mocked(DeviceClient.getQuota).mockResolvedValue({
        success: true,
        data: {
          quotaLimit: 5,
          quotaUsed: 5,
          quotaRemaining: 0,
          plan: 'free',
          resetDate: '2026-03-01',
        },
      });

      const checkResult = await checkRateLimit(mockDeviceId, mockToken);
      expect(checkResult.allowed).toBe(false);
      expect(checkResult.errorCode).toBe(QUOTA_EXCEEDED_ERROR);
      expect(checkResult.upgradeMessage).toContain('Upgrade to Pro');
    });

    it('should handle partial failure (logging fails but operation succeeds)', async () => {
      // 1. Check rate limit (allowed)
      vi.mocked(DeviceClient.getQuota).mockResolvedValue({
        success: true,
        data: {
          quotaLimit: 5,
          quotaUsed: 3,
          quotaRemaining: 2,
          plan: 'free',
          resetDate: '2026-03-01',
        },
      });

      const checkResult = await checkRateLimit(mockDeviceId, mockToken);
      expect(checkResult.allowed).toBe(true);

      // 2. Increment call count (succeeds)
      vi.mocked(DeviceClient.incrementCall).mockResolvedValue({
        success: true,
        data: {
          quotaUsed: 4,
          quotaRemaining: 1,
        },
      });

      const incrementResult = await incrementAICall(
        mockDeviceId,
        mockToken,
        'errorDiagnosis'
      );
      expect(incrementResult.success).toBe(true);

      // 3. Log AI call (fails - but doesn't affect operation)
      vi.mocked(sessionClient.logAICall).mockResolvedValue({
        success: false,
        error: 'Database error',
      });

      const logResult = await logAICall(mockDeviceId, mockToken, {
        sessionId: 'session-789',
        operation: 'errorDiagnosis',
        provider: 'claude',
        model: 'claude-3-5-sonnet-20241022',
        inputTokens: 500,
        outputTokens: 300,
        success: true,
        latencyMs: 1800,
      });

      // Logging failure should be non-fatal
      expect(logResult.success).toBe(false);
    });
  });
});
