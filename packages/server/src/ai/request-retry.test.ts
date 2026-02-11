// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for request retry and error handling module.
 *
 * @module ai/request-retry.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  classifyError,
  calculateDelay,
  withRetry,
  DEFAULT_RETRY_OPTIONS,
  type RetryOptions,
  type ErrorClassification,
} from './request-retry.js';

// ============================================================================
// classifyError
// ============================================================================

describe('classifyError', () => {
  describe('Anthropic SDK errors (status-based)', () => {
    it('should classify 401 as non-retryable authentication error', () => {
      const error = { status: 401, message: 'Unauthorized' };
      const result = classifyError(error);

      expect(result.retryable).toBe(false);
      expect(result.category).toBe('authentication');
      expect(result.statusCode).toBe(401);
    });

    it('should classify 403 as non-retryable authentication error', () => {
      const error = { status: 403, message: 'Forbidden' };
      const result = classifyError(error);

      expect(result.retryable).toBe(false);
      expect(result.category).toBe('authentication');
      expect(result.statusCode).toBe(403);
    });

    it('should classify 400 as non-retryable invalid request', () => {
      const error = { status: 400, message: 'Bad request body' };
      const result = classifyError(error);

      expect(result.retryable).toBe(false);
      expect(result.category).toBe('invalid_request');
      expect(result.statusCode).toBe(400);
      expect(result.message).toContain('Bad request body');
    });

    it('should classify 404 as non-retryable invalid request', () => {
      const error = { status: 404, message: 'Model not found' };
      const result = classifyError(error);

      expect(result.retryable).toBe(false);
      expect(result.category).toBe('invalid_request');
      expect(result.statusCode).toBe(404);
    });

    it('should classify 429 as retryable rate limit error', () => {
      const error = { status: 429, message: 'Rate limited' };
      const result = classifyError(error);

      expect(result.retryable).toBe(true);
      expect(result.category).toBe('rate_limit');
      expect(result.statusCode).toBe(429);
    });

    it('should extract retry-after header from 429 response', () => {
      const error = {
        status: 429,
        message: 'Rate limited',
        headers: { 'retry-after': '5' },
      };
      const result = classifyError(error);

      expect(result.retryable).toBe(true);
      expect(result.category).toBe('rate_limit');
      expect(result.retryAfterMs).toBe(5000);
    });

    it('should classify 500 as retryable server error', () => {
      const error = { status: 500, message: 'Internal server error' };
      const result = classifyError(error);

      expect(result.retryable).toBe(true);
      expect(result.category).toBe('server_error');
      expect(result.statusCode).toBe(500);
    });

    it('should classify 502 as retryable overloaded', () => {
      const error = { status: 502, message: 'Bad gateway' };
      const result = classifyError(error);

      expect(result.retryable).toBe(true);
      expect(result.category).toBe('overloaded');
      expect(result.statusCode).toBe(502);
    });

    it('should classify 503 as retryable overloaded', () => {
      const error = { status: 503, message: 'Service unavailable' };
      const result = classifyError(error);

      expect(result.retryable).toBe(true);
      expect(result.category).toBe('overloaded');
      expect(result.statusCode).toBe(503);
    });

    it('should classify 504 as retryable timeout', () => {
      const error = { status: 504, message: 'Gateway timeout' };
      const result = classifyError(error);

      expect(result.retryable).toBe(true);
      expect(result.category).toBe('timeout');
      expect(result.statusCode).toBe(504);
    });

    it('should classify unknown 5xx as retryable server error', () => {
      const error = { status: 529, message: 'Overloaded' };
      const result = classifyError(error);

      expect(result.retryable).toBe(true);
      expect(result.category).toBe('server_error');
      expect(result.statusCode).toBe(529);
    });

    it('should classify unknown 4xx as non-retryable', () => {
      const error = { status: 422, message: 'Unprocessable entity' };
      const result = classifyError(error);

      expect(result.retryable).toBe(false);
      expect(result.category).toBe('unknown');
      expect(result.statusCode).toBe(422);
    });
  });

  describe('abort/timeout errors', () => {
    it('should classify AbortError as retryable timeout', () => {
      const error = new Error('The operation was aborted');
      error.name = 'AbortError';
      const result = classifyError(error);

      expect(result.retryable).toBe(true);
      expect(result.category).toBe('timeout');
    });

    it('should classify errors with "timeout" in message as retryable timeout', () => {
      const error = new Error('Request timeout after 30000ms');
      const result = classifyError(error);

      expect(result.retryable).toBe(true);
      expect(result.category).toBe('timeout');
    });

    it('should classify errors with "aborted" in message as retryable timeout', () => {
      const error = new Error('Connection aborted');
      const result = classifyError(error);

      expect(result.retryable).toBe(true);
      expect(result.category).toBe('timeout');
    });
  });

  describe('network errors', () => {
    it('should classify ECONNREFUSED as retryable network error', () => {
      const error = new Error('connect ECONNREFUSED 127.0.0.1:443');
      const result = classifyError(error);

      expect(result.retryable).toBe(true);
      expect(result.category).toBe('network');
    });

    it('should classify ECONNRESET as retryable network error', () => {
      const error = new Error('read ECONNRESET');
      const result = classifyError(error);

      expect(result.retryable).toBe(true);
      expect(result.category).toBe('network');
    });

    it('should classify ENOTFOUND as retryable network error', () => {
      const error = new Error('getaddrinfo ENOTFOUND api.anthropic.com');
      const result = classifyError(error);

      expect(result.retryable).toBe(true);
      expect(result.category).toBe('network');
    });

    it('should classify ETIMEDOUT as retryable network error', () => {
      const error = new Error('connect ETIMEDOUT');
      const result = classifyError(error);

      expect(result.retryable).toBe(true);
      expect(result.category).toBe('network');
    });

    it('should classify "fetch failed" as retryable network error', () => {
      const error = new Error('fetch failed');
      const result = classifyError(error);

      expect(result.retryable).toBe(true);
      expect(result.category).toBe('network');
    });

    it('should classify "socket hang up" as retryable network error', () => {
      const error = new Error('socket hang up');
      const result = classifyError(error);

      expect(result.retryable).toBe(true);
      expect(result.category).toBe('network');
    });

    it('should classify error with code property as network error', () => {
      const error = new Error('Connection failed');
      (error as NodeJS.ErrnoException).code = 'EPIPE';
      const result = classifyError(error);

      expect(result.retryable).toBe(true);
      expect(result.category).toBe('network');
    });
  });

  describe('unknown errors', () => {
    it('should classify generic errors as non-retryable unknown', () => {
      const error = new Error('Something went wrong');
      const result = classifyError(error);

      expect(result.retryable).toBe(false);
      expect(result.category).toBe('unknown');
      expect(result.message).toBe('Something went wrong');
    });

    it('should handle non-Error objects', () => {
      const result = classifyError('string error');

      expect(result.retryable).toBe(false);
      expect(result.category).toBe('unknown');
      expect(result.message).toBe('string error');
    });

    it('should handle null error', () => {
      const result = classifyError(null);

      expect(result.retryable).toBe(false);
      expect(result.category).toBe('unknown');
    });

    it('should handle undefined error', () => {
      const result = classifyError(undefined);

      expect(result.retryable).toBe(false);
      expect(result.category).toBe('unknown');
    });
  });

  describe('retry-after header parsing', () => {
    it('should parse retry-after in seconds', () => {
      const error = {
        status: 429,
        message: 'Rate limited',
        headers: { 'retry-after': '10' },
      };
      const result = classifyError(error);

      expect(result.retryAfterMs).toBe(10000);
    });

    it('should parse Retry-After with capital letters', () => {
      const error = {
        status: 429,
        message: 'Rate limited',
        headers: { 'Retry-After': '3' },
      };
      const result = classifyError(error);

      expect(result.retryAfterMs).toBe(3000);
    });

    it('should return undefined for missing retry-after', () => {
      const error = {
        status: 429,
        message: 'Rate limited',
        headers: {},
      };
      const result = classifyError(error);

      expect(result.retryAfterMs).toBeUndefined();
    });

    it('should return undefined when no headers present', () => {
      const error = { status: 429, message: 'Rate limited' };
      const result = classifyError(error);

      expect(result.retryAfterMs).toBeUndefined();
    });
  });
});

// ============================================================================
// calculateDelay
// ============================================================================

describe('calculateDelay', () => {
  const baseOptions: RetryOptions = {
    maxRetries: 3,
    initialDelayMs: 1000,
    maxDelayMs: 30000,
    backoffMultiplier: 2,
    timeoutMs: 30000,
  };

  beforeEach(() => {
    // Use a fixed random seed for deterministic jitter
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
  });

  it('should return initial delay for first attempt (attempt 0)', () => {
    const delay = calculateDelay(0, baseOptions);

    // With random=0.5, jitter is 0, so delay = 1000 * 2^0 = 1000
    expect(delay).toBe(1000);
  });

  it('should apply exponential backoff', () => {
    const delay0 = calculateDelay(0, baseOptions);
    const delay1 = calculateDelay(1, baseOptions);
    const delay2 = calculateDelay(2, baseOptions);

    // With random=0.5, jitter is 0
    // attempt 0: 1000 * 2^0 = 1000
    // attempt 1: 1000 * 2^1 = 2000
    // attempt 2: 1000 * 2^2 = 4000
    expect(delay0).toBe(1000);
    expect(delay1).toBe(2000);
    expect(delay2).toBe(4000);
  });

  it('should cap delay at maxDelayMs', () => {
    const options = { ...baseOptions, maxDelayMs: 3000 };
    const delay = calculateDelay(5, options);

    expect(delay).toBeLessThanOrEqual(3000);
  });

  it('should use retry-after from classification when available', () => {
    const classification: ErrorClassification = {
      retryable: true,
      category: 'rate_limit',
      message: 'Rate limited',
      retryAfterMs: 5000,
    };

    const delay = calculateDelay(0, baseOptions, classification);
    expect(delay).toBe(5000);
  });

  it('should cap retry-after at maxDelayMs', () => {
    const options = { ...baseOptions, maxDelayMs: 3000 };
    const classification: ErrorClassification = {
      retryable: true,
      category: 'rate_limit',
      message: 'Rate limited',
      retryAfterMs: 10000,
    };

    const delay = calculateDelay(0, options, classification);
    expect(delay).toBe(3000);
  });

  it('should add jitter to prevent thundering herd', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0); // min jitter
    const delayMin = calculateDelay(0, baseOptions);

    vi.spyOn(Math, 'random').mockReturnValue(1); // max jitter
    const delayMax = calculateDelay(0, baseOptions);

    // jitter range: ±25% of base delay (1000)
    // min: 1000 + 250 * (0 * 2 - 1) = 1000 - 250 = 750
    // max: 1000 + 250 * (1 * 2 - 1) = 1000 + 250 = 1250
    expect(delayMin).toBe(750);
    expect(delayMax).toBe(1250);
  });

  it('should never return negative delay', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const options = { ...baseOptions, initialDelayMs: 1 };
    const delay = calculateDelay(0, options);

    expect(delay).toBeGreaterThanOrEqual(0);
  });

  it('should ignore retry-after of 0', () => {
    const classification: ErrorClassification = {
      retryable: true,
      category: 'rate_limit',
      message: 'Rate limited',
      retryAfterMs: 0,
    };

    const delay = calculateDelay(0, baseOptions, classification);
    // Should use exponential backoff instead
    expect(delay).toBe(1000);
  });
});

// ============================================================================
// withRetry
// ============================================================================

describe('withRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  it('should return data on first success', async () => {
    const fn = vi.fn().mockResolvedValue('result');

    const result = await withRetry(fn, { maxRetries: 3, initialDelayMs: 10 });

    expect(result.success).toBe(true);
    expect(result.data).toBe('result');
    expect(result.attempts).toBe(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should retry on retryable errors', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce({ status: 500, message: 'Server error' })
      .mockResolvedValueOnce('result');

    const result = await withRetry(fn, { maxRetries: 3, initialDelayMs: 10 });

    expect(result.success).toBe(true);
    expect(result.data).toBe('result');
    expect(result.attempts).toBe(2);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('should fail immediately on non-retryable errors', async () => {
    const fn = vi
      .fn()
      .mockRejectedValue({ status: 401, message: 'Unauthorized' });

    const result = await withRetry(fn, { maxRetries: 3, initialDelayMs: 10 });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Authentication failed');
    expect(result.attempts).toBe(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should fail after all retries exhausted', async () => {
    const fn = vi
      .fn()
      .mockRejectedValue({ status: 500, message: 'Internal error' });

    const result = await withRetry(fn, { maxRetries: 2, initialDelayMs: 10 });

    expect(result.success).toBe(false);
    expect(result.error).toContain('failed after 3 attempts');
    expect(result.attempts).toBe(3);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('should include error classification on failure', async () => {
    const fn = vi
      .fn()
      .mockRejectedValue({ status: 429, message: 'Rate limited' });

    const result = await withRetry(fn, { maxRetries: 0, initialDelayMs: 10 });

    expect(result.success).toBe(false);
    expect(result.errorClassification).toBeDefined();
    expect(result.errorClassification!.category).toBe('rate_limit');
  });

  it('should track elapsed time', async () => {
    const fn = vi.fn().mockResolvedValue('ok');

    const result = await withRetry(fn, { maxRetries: 0 });

    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it('should use default options when none provided', async () => {
    const fn = vi.fn().mockResolvedValue('ok');

    const result = await withRetry(fn);

    expect(result.success).toBe(true);
    expect(result.attempts).toBe(1);
  });

  it('should retry network errors', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('connect ECONNREFUSED'))
      .mockResolvedValueOnce('result');

    const result = await withRetry(fn, { maxRetries: 3, initialDelayMs: 10 });

    expect(result.success).toBe(true);
    expect(result.attempts).toBe(2);
  });

  it('should retry timeout errors', async () => {
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';

    const fn = vi
      .fn()
      .mockRejectedValueOnce(abortError)
      .mockResolvedValueOnce('result');

    const result = await withRetry(fn, { maxRetries: 3, initialDelayMs: 10 });

    expect(result.success).toBe(true);
    expect(result.attempts).toBe(2);
  });

  it('should not retry 400 errors', async () => {
    const fn = vi
      .fn()
      .mockRejectedValue({ status: 400, message: 'Bad request' });

    const result = await withRetry(fn, { maxRetries: 3, initialDelayMs: 10 });

    expect(result.success).toBe(false);
    expect(result.attempts).toBe(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should recover after transient failures', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce({ status: 503, message: 'Overloaded' })
      .mockRejectedValueOnce({ status: 500, message: 'Internal error' })
      .mockResolvedValueOnce('finally works');

    const result = await withRetry(fn, { maxRetries: 3, initialDelayMs: 10 });

    expect(result.success).toBe(true);
    expect(result.data).toBe('finally works');
    expect(result.attempts).toBe(3);
  });

  it('should stop retrying when non-retryable error after retryable errors', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce({ status: 500, message: 'Server error' })
      .mockRejectedValueOnce({ status: 401, message: 'Unauthorized' });

    const result = await withRetry(fn, { maxRetries: 3, initialDelayMs: 10 });

    expect(result.success).toBe(false);
    expect(result.attempts).toBe(2);
    expect(result.errorClassification!.category).toBe('authentication');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('should handle maxRetries of 0 (no retries)', async () => {
    const fn = vi
      .fn()
      .mockRejectedValue({ status: 500, message: 'Server error' });

    const result = await withRetry(fn, { maxRetries: 0, initialDelayMs: 10 });

    expect(result.success).toBe(false);
    expect(result.attempts).toBe(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

// ============================================================================
// DEFAULT_RETRY_OPTIONS
// ============================================================================

describe('DEFAULT_RETRY_OPTIONS', () => {
  it('should have sensible defaults', () => {
    expect(DEFAULT_RETRY_OPTIONS.maxRetries).toBe(3);
    expect(DEFAULT_RETRY_OPTIONS.initialDelayMs).toBe(1000);
    expect(DEFAULT_RETRY_OPTIONS.maxDelayMs).toBe(30000);
    expect(DEFAULT_RETRY_OPTIONS.backoffMultiplier).toBe(2);
    expect(DEFAULT_RETRY_OPTIONS.timeoutMs).toBe(30000);
  });
});
