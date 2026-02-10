/**
 * Tests for Magic API Session Client
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  SessionClient,
  SessionCreateRequest,
  SessionCreateResponse,
  SessionCompleteRequest,
  SessionCompleteResponse,
  AICallLogRequest,
  AICallLogResponse,
} from './session-client.js';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch as any;

describe('SessionClient', () => {
  let client: SessionClient;
  const mockBaseUrl = 'http://test-api.local:8088';
  const mockTimeout = 5000;

  beforeEach(() => {
    client = new SessionClient(mockBaseUrl, mockTimeout);
    mockFetch.mockClear();
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  // ==========================================================================
  // Session Creation Tests
  // ==========================================================================

  describe('createSession', () => {
    it('should successfully create a session', async () => {
      const request: SessionCreateRequest = {
        sessionId: 'sess_test_123',
        deviceId: 'dev_abc123',
        software: 'openclaw',
        platform: 'darwin',
        stepsTotal: 5,
      };

      const mockResponse: SessionCreateResponse = {
        success: true,
        data: {
          sessionId: 'sess_test_123',
          startedAt: '2026-02-07T12:00:00Z',
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      });

      const result = await client.createSession(request);

      expect(result.success).toBe(true);
      expect(result.data?.sessionId).toBe('sess_test_123');
      expect(result.data?.startedAt).toBe('2026-02-07T12:00:00Z');
      expect(mockFetch).toHaveBeenCalledWith(
        `${mockBaseUrl}/session/create`,
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(request),
        })
      );
    });

    it('should create session with full environment info', async () => {
      const request: SessionCreateRequest = {
        sessionId: 'sess_test_456',
        deviceId: 'dev_xyz789',
        software: 'nodejs',
        platform: 'linux',
        stepsTotal: 3,
        envInfo: {
          os: 'Ubuntu 22.04',
          arch: 'x64',
          packageManagers: ['apt', 'npm'],
        },
        installPlan: {
          steps: [
            { id: '1', command: 'sudo apt update' },
            { id: '2', command: 'sudo apt install nodejs' },
            { id: '3', command: 'node --version' },
          ],
        },
      };

      const mockResponse: SessionCreateResponse = {
        success: true,
        data: {
          sessionId: 'sess_test_456',
          startedAt: '2026-02-07T12:00:00Z',
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      });

      const result = await client.createSession(request);

      expect(result.success).toBe(true);
      expect(result.data?.sessionId).toBe('sess_test_456');
    });

    it('should handle session creation failure', async () => {
      const request: SessionCreateRequest = {
        sessionId: 'sess_fail_123',
        deviceId: 'dev_invalid',
        software: 'unknown',
        platform: 'darwin',
      };

      const mockResponse = {
        success: false,
        error: 'Device not found',
      };

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: async () => mockResponse,
      });

      const result = await client.createSession(request);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Device not found');
    });

    it('should handle network timeout', async () => {
      const request: SessionCreateRequest = {
        sessionId: 'sess_timeout_123',
        deviceId: 'dev_abc123',
        software: 'test',
        platform: 'darwin',
      };

      mockFetch.mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            setTimeout(() => reject(new Error('The operation was aborted')), 100);
          })
      );

      const result = await client.createSession(request);

      expect(result.success).toBe(false);
      expect(result.error).toContain('aborted');
    });

    it('should handle invalid response', async () => {
      const request: SessionCreateRequest = {
        sessionId: 'sess_invalid_123',
        deviceId: 'dev_abc123',
        software: 'test',
        platform: 'darwin',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error('Invalid JSON');
        },
      });

      const result = await client.createSession(request);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid JSON');
    });
  });

  // ==========================================================================
  // Session Completion Tests
  // ==========================================================================

  describe('completeSession', () => {
    it('should successfully complete a session', async () => {
      const request: SessionCompleteRequest = {
        sessionId: 'sess_test_123',
        status: 'completed',
        stepsCompleted: 5,
        durationMs: 12345,
      };

      const mockResponse: SessionCompleteResponse = {
        success: true,
        data: {
          sessionId: 'sess_test_123',
          status: 'completed',
          completedAt: '2026-02-07T12:05:00Z',
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      });

      const result = await client.completeSession(request);

      expect(result.success).toBe(true);
      expect(result.data?.sessionId).toBe('sess_test_123');
      expect(result.data?.status).toBe('completed');
      expect(result.data?.completedAt).toBe('2026-02-07T12:05:00Z');
      expect(mockFetch).toHaveBeenCalledWith(
        `${mockBaseUrl}/session/complete`,
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(request),
        })
      );
    });

    it('should complete session with failed status', async () => {
      const request: SessionCompleteRequest = {
        sessionId: 'sess_fail_123',
        status: 'failed',
        stepsCompleted: 2,
        durationMs: 5000,
        errorMessage: 'Installation failed: permission denied',
      };

      const mockResponse: SessionCompleteResponse = {
        success: true,
        data: {
          sessionId: 'sess_fail_123',
          status: 'failed',
          completedAt: '2026-02-07T12:05:00Z',
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      });

      const result = await client.completeSession(request);

      expect(result.success).toBe(true);
      expect(result.data?.status).toBe('failed');
    });

    it('should complete session with interrupted status', async () => {
      const request: SessionCompleteRequest = {
        sessionId: 'sess_interrupt_123',
        status: 'interrupted',
        stepsCompleted: 3,
        durationMs: 8000,
        errorMessage: 'User interrupted',
      };

      const mockResponse: SessionCompleteResponse = {
        success: true,
        data: {
          sessionId: 'sess_interrupt_123',
          status: 'interrupted',
          completedAt: '2026-02-07T12:05:00Z',
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      });

      const result = await client.completeSession(request);

      expect(result.success).toBe(true);
      expect(result.data?.status).toBe('interrupted');
    });

    it('should handle session completion failure', async () => {
      const request: SessionCompleteRequest = {
        sessionId: 'sess_notfound_123',
        status: 'completed',
        stepsCompleted: 5,
      };

      const mockResponse = {
        success: false,
        error: 'Session not found',
      };

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: async () => mockResponse,
      });

      const result = await client.completeSession(request);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Session not found');
    });

    it('should handle network error during completion', async () => {
      const request: SessionCompleteRequest = {
        sessionId: 'sess_test_123',
        status: 'completed',
      };

      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await client.completeSession(request);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Network error');
    });
  });

  // ==========================================================================
  // AI Call Logging Tests
  // ==========================================================================

  describe('logAICall', () => {
    it('should successfully log an AI call', async () => {
      const request: AICallLogRequest = {
        sessionId: 'sess_test_123',
        deviceId: 'dev_abc123',
        scene: 'planGeneration',
        provider: 'anthropic',
        model: 'claude-3-5-sonnet-20241022',
        inputTokens: 1000,
        outputTokens: 500,
        costUsd: 0.015,
        durationMs: 2500,
        success: true,
      };

      const mockResponse: AICallLogResponse = {
        success: true,
        data: {
          logId: 12345,
          createdAt: '2026-02-07T12:00:00Z',
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      });

      const result = await client.logAICall(request);

      expect(result.success).toBe(true);
      expect(result.data?.logId).toBe(12345);
      expect(result.data?.createdAt).toBe('2026-02-07T12:00:00Z');
      expect(mockFetch).toHaveBeenCalledWith(
        `${mockBaseUrl}/ai-call/log`,
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(request),
        })
      );
    });

    it('should log AI call for different scenes', async () => {
      const scenes: AICallLogRequest['scene'][] = [
        'envAnalysis',
        'planGeneration',
        'errorDiagnosis',
        'tutor',
      ];

      for (const scene of scenes) {
        const request: AICallLogRequest = {
          sessionId: 'sess_test_123',
          deviceId: 'dev_abc123',
          scene,
          provider: 'anthropic',
          model: 'claude-3-5-sonnet-20241022',
          inputTokens: 500,
          outputTokens: 300,
          costUsd: 0.01,
          durationMs: 1500,
          success: true,
        };

        const mockResponse: AICallLogResponse = {
          success: true,
          data: {
            logId: 12345,
            createdAt: '2026-02-07T12:00:00Z',
          },
        };

        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => mockResponse,
        });

        const result = await client.logAICall(request);
        expect(result.success).toBe(true);
      }
    });

    it('should log AI call for different providers', async () => {
      const providers: AICallLogRequest['provider'][] = [
        'anthropic',
        'openai',
        'deepseek',
        'google',
        'qwen',
      ];

      for (const provider of providers) {
        const request: AICallLogRequest = {
          sessionId: 'sess_test_123',
          deviceId: 'dev_abc123',
          scene: 'planGeneration',
          provider,
          model: 'test-model',
          inputTokens: 500,
          outputTokens: 300,
          costUsd: 0.01,
          durationMs: 1500,
          success: true,
        };

        const mockResponse: AICallLogResponse = {
          success: true,
          data: {
            logId: 12345,
            createdAt: '2026-02-07T12:00:00Z',
          },
        };

        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => mockResponse,
        });

        const result = await client.logAICall(request);
        expect(result.success).toBe(true);
      }
    });

    it('should log failed AI call', async () => {
      const request: AICallLogRequest = {
        sessionId: 'sess_test_123',
        deviceId: 'dev_abc123',
        scene: 'errorDiagnosis',
        provider: 'anthropic',
        model: 'claude-3-5-sonnet-20241022',
        success: false,
        errorCode: 'rate_limit_exceeded',
        errorMessage: 'API rate limit exceeded',
        durationMs: 100,
      };

      const mockResponse: AICallLogResponse = {
        success: true,
        data: {
          logId: 12346,
          createdAt: '2026-02-07T12:00:01Z',
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      });

      const result = await client.logAICall(request);

      expect(result.success).toBe(true);
      expect(result.data?.logId).toBe(12346);
    });

    it('should handle AI call logging failure', async () => {
      const request: AICallLogRequest = {
        sessionId: 'sess_test_123',
        deviceId: 'dev_abc123',
        scene: 'planGeneration',
        provider: 'anthropic',
        model: 'test-model',
      };

      const mockResponse = {
        success: false,
        error: 'Database error',
      };

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: async () => mockResponse,
      });

      const result = await client.logAICall(request);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Database error');
    });

    it('should handle network error during logging', async () => {
      const request: AICallLogRequest = {
        sessionId: 'sess_test_123',
        deviceId: 'dev_abc123',
        scene: 'planGeneration',
        provider: 'anthropic',
        model: 'test-model',
      };

      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await client.logAICall(request);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Network error');
    });
  });

  // ==========================================================================
  // Helper Methods Tests
  // ==========================================================================

  describe('createAndLogSession', () => {
    it('should create and log session successfully', async () => {
      const request: SessionCreateRequest = {
        sessionId: 'sess_test_123',
        deviceId: 'dev_abc123',
        software: 'openclaw',
        platform: 'darwin',
        stepsTotal: 5,
      };

      const mockResponse: SessionCreateResponse = {
        success: true,
        data: {
          sessionId: 'sess_test_123',
          startedAt: '2026-02-07T12:00:00Z',
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      });

      const result = await client.createAndLogSession(request);

      expect(result.success).toBe(true);
      expect(result.data?.sessionId).toBe('sess_test_123');
    });

    it('should handle creation failure gracefully', async () => {
      const request: SessionCreateRequest = {
        sessionId: 'sess_fail_123',
        deviceId: 'dev_invalid',
        software: 'unknown',
        platform: 'darwin',
      };

      const mockResponse = {
        success: false,
        error: 'Device not found',
      };

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => mockResponse,
      });

      const result = await client.createAndLogSession(request);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Device not found');
    });
  });

  describe('completeSessionWithStatus', () => {
    it('should complete session with success status', async () => {
      const mockResponse: SessionCompleteResponse = {
        success: true,
        data: {
          sessionId: 'sess_test_123',
          status: 'completed',
          completedAt: '2026-02-07T12:05:00Z',
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      });

      const result = await client.completeSessionWithStatus(
        'sess_test_123',
        true,
        5,
        12345
      );

      expect(result.success).toBe(true);
      expect(result.data?.status).toBe('completed');
    });

    it('should complete session with failure status', async () => {
      const mockResponse: SessionCompleteResponse = {
        success: true,
        data: {
          sessionId: 'sess_fail_123',
          status: 'failed',
          completedAt: '2026-02-07T12:05:00Z',
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      });

      const result = await client.completeSessionWithStatus(
        'sess_fail_123',
        false,
        2,
        5000,
        'Installation failed'
      );

      expect(result.success).toBe(true);
      expect(result.data?.status).toBe('failed');
    });
  });

  describe('logSuccessfulAICall', () => {
    it('should log successful AI call with all parameters', async () => {
      const mockResponse: AICallLogResponse = {
        success: true,
        data: {
          logId: 12345,
          createdAt: '2026-02-07T12:00:00Z',
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      });

      const result = await client.logSuccessfulAICall(
        'sess_test_123',
        'dev_abc123',
        'planGeneration',
        'anthropic',
        'claude-3-5-sonnet-20241022',
        1000,
        500,
        0.015,
        2500
      );

      expect(result.success).toBe(true);
      expect(result.data?.logId).toBe(12345);
    });
  });

  describe('logFailedAICall', () => {
    it('should log failed AI call with error details', async () => {
      const mockResponse: AICallLogResponse = {
        success: true,
        data: {
          logId: 12346,
          createdAt: '2026-02-07T12:00:01Z',
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      });

      const result = await client.logFailedAICall(
        'sess_test_123',
        'dev_abc123',
        'errorDiagnosis',
        'anthropic',
        'claude-3-5-sonnet-20241022',
        'rate_limit_exceeded',
        'API rate limit exceeded',
        100
      );

      expect(result.success).toBe(true);
      expect(result.data?.logId).toBe(12346);
    });
  });

  // ==========================================================================
  // Integration Scenarios
  // ==========================================================================

  describe('Integration Scenarios', () => {
    it('should handle complete installation session lifecycle', async () => {
      // 1. Create session
      const createRequest: SessionCreateRequest = {
        sessionId: 'sess_integration_123',
        deviceId: 'dev_abc123',
        software: 'openclaw',
        platform: 'darwin',
        stepsTotal: 3,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            sessionId: 'sess_integration_123',
            startedAt: '2026-02-07T12:00:00Z',
          },
        }),
      });

      const createResult = await client.createSession(createRequest);
      expect(createResult.success).toBe(true);

      // 2. Log AI calls during installation
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: { logId: 1, createdAt: '2026-02-07T12:01:00Z' },
        }),
      });

      const logResult1 = await client.logAICall({
        sessionId: 'sess_integration_123',
        deviceId: 'dev_abc123',
        scene: 'envAnalysis',
        provider: 'anthropic',
        model: 'claude-3-5-sonnet-20241022',
        inputTokens: 500,
        outputTokens: 300,
        costUsd: 0.01,
        durationMs: 1500,
        success: true,
      });
      expect(logResult1.success).toBe(true);

      // 3. Complete session
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            sessionId: 'sess_integration_123',
            status: 'completed',
            completedAt: '2026-02-07T12:05:00Z',
          },
        }),
      });

      const completeResult = await client.completeSession({
        sessionId: 'sess_integration_123',
        status: 'completed',
        stepsCompleted: 3,
        durationMs: 300000,
      });
      expect(completeResult.success).toBe(true);
    });

    it('should handle failed installation with error recovery', async () => {
      // 1. Create session
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            sessionId: 'sess_fail_123',
            startedAt: '2026-02-07T12:00:00Z',
          },
        }),
      });

      await client.createSession({
        sessionId: 'sess_fail_123',
        deviceId: 'dev_abc123',
        software: 'test',
        platform: 'linux',
      });

      // 2. Log failed AI call
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: { logId: 2, createdAt: '2026-02-07T12:01:00Z' },
        }),
      });

      await client.logFailedAICall(
        'sess_fail_123',
        'dev_abc123',
        'errorDiagnosis',
        'anthropic',
        'claude-3-5-sonnet-20241022',
        'api_error',
        'API timeout',
        5000
      );

      // 3. Complete session with failure
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            sessionId: 'sess_fail_123',
            status: 'failed',
            completedAt: '2026-02-07T12:02:00Z',
          },
        }),
      });

      const result = await client.completeSessionWithStatus(
        'sess_fail_123',
        false,
        1,
        120000,
        'Installation failed due to API timeout'
      );
      expect(result.success).toBe(true);
      expect(result.data?.status).toBe('failed');
    });

    it('should handle multiple AI calls in a single session', async () => {
      const sessionId = 'sess_multi_ai_123';

      // Create session
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: { sessionId, startedAt: '2026-02-07T12:00:00Z' },
        }),
      });

      await client.createSession({
        sessionId,
        deviceId: 'dev_abc123',
        software: 'complex-app',
        platform: 'darwin',
      });

      // Log multiple AI calls
      const scenes: AICallLogRequest['scene'][] = [
        'envAnalysis',
        'planGeneration',
        'errorDiagnosis',
        'tutor',
      ];

      for (const scene of scenes) {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            data: { logId: Math.random(), createdAt: new Date().toISOString() },
          }),
        });

        const result = await client.logAICall({
          sessionId,
          deviceId: 'dev_abc123',
          scene,
          provider: 'anthropic',
          model: 'claude-3-5-sonnet-20241022',
          inputTokens: 500,
          outputTokens: 300,
          costUsd: 0.01,
          durationMs: 1500,
          success: true,
        });
        expect(result.success).toBe(true);
      }
    });
  });
});
