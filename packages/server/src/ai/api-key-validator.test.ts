/**
 * Tests for API key validation module.
 *
 * @module ai/api-key-validator.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  validateApiKeyFormat,
  validateApiKeyLive,
  validateApiKey,
} from './api-key-validator.js';

// ============================================================================
// validateApiKeyFormat
// ============================================================================

describe('validateApiKeyFormat', () => {
  describe('missing or empty keys', () => {
    it('should reject undefined', () => {
      const result = validateApiKeyFormat(undefined);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('not set');
    });

    it('should reject empty string', () => {
      const result = validateApiKeyFormat('');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('not set');
    });

    it('should reject whitespace-only string', () => {
      const result = validateApiKeyFormat('   ');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('not set');
    });
  });

  describe('placeholder detection', () => {
    it('should reject "your_anthropic_api_key_here"', () => {
      const result = validateApiKeyFormat('your_anthropic_api_key_here');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('placeholder');
    });

    it('should reject "your_api_key_here"', () => {
      const result = validateApiKeyFormat('your_api_key_here');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('placeholder');
    });

    it('should reject "CHANGE_ME"', () => {
      const result = validateApiKeyFormat('CHANGE_ME');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('placeholder');
    });

    it('should reject "changeme" (case-insensitive)', () => {
      const result = validateApiKeyFormat('changeme');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('placeholder');
    });

    it('should reject "placeholder"', () => {
      const result = validateApiKeyFormat('placeholder');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('placeholder');
    });

    it('should reject "TODO"', () => {
      const result = validateApiKeyFormat('TODO');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('placeholder');
    });

    it('should reject "sk-ant-xxxx"', () => {
      const result = validateApiKeyFormat('sk-ant-xxxx');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('placeholder');
    });

    it('should reject "test"', () => {
      const result = validateApiKeyFormat('test');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('placeholder');
    });
  });

  describe('prefix validation', () => {
    it('should reject keys without "sk-ant-" prefix', () => {
      const result = validateApiKeyFormat('invalid-key-format-1234567890');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('invalid format');
    });

    it('should reject keys with wrong prefix "sk-"', () => {
      const result = validateApiKeyFormat('sk-1234567890abcdefghij');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('invalid format');
    });

    it('should reject keys with "api-key-" prefix', () => {
      const result = validateApiKeyFormat('api-key-1234567890abcdefghij');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('invalid format');
    });

    it('should accept keys with "sk-ant-" prefix', () => {
      const result = validateApiKeyFormat('sk-ant-abcdefghijklmnopqrstuvwxyz1234567890');
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should accept keys with "sk-ant-api03-" prefix', () => {
      const result = validateApiKeyFormat('sk-ant-api03-abcdefghijklmnopqrstuvwxyz1234567890');
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });
  });

  describe('length validation', () => {
    it('should reject keys shorter than 20 characters', () => {
      const result = validateApiKeyFormat('sk-ant-abc');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('too short');
    });

    it('should accept keys with exactly 20 characters', () => {
      const result = validateApiKeyFormat('sk-ant-1234567890abc');
      expect(result.valid).toBe(true);
    });

    it('should accept keys longer than 20 characters', () => {
      const result = validateApiKeyFormat('sk-ant-api03-abcdefghijklmnopqrstuvwxyz1234567890abcdefghijklmnopqrstuvwxyz');
      expect(result.valid).toBe(true);
    });
  });

  describe('whitespace handling', () => {
    it('should trim leading/trailing whitespace', () => {
      const result = validateApiKeyFormat('  sk-ant-abcdefghijklmnopqrstuvwxyz1234567890  ');
      expect(result.valid).toBe(true);
    });
  });

  describe('valid keys', () => {
    it('should accept a realistic API key', () => {
      const result = validateApiKeyFormat('sk-ant-api03-ABCDEFGHIJKLMNOP1234567890abcdefghijklmnopqrstuvwxyz');
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });
  });
});

// ============================================================================
// validateApiKeyLive
// ============================================================================

describe('validateApiKeyLive', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('should reject invalid format before making API call', async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;

    const result = await validateApiKeyLive('invalid-key');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('invalid format');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('should return valid for 200 response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      status: 200,
    });

    const result = await validateApiKeyLive('sk-ant-api03-valid1234567890abcdef');
    expect(result.valid).toBe(true);
  });

  it('should return valid for 429 response (rate limited but key is valid)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      status: 429,
    });

    const result = await validateApiKeyLive('sk-ant-api03-valid1234567890abcdef');
    expect(result.valid).toBe(true);
  });

  it('should return valid for 400 response (bad request but auth passed)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      status: 400,
    });

    const result = await validateApiKeyLive('sk-ant-api03-valid1234567890abcdef');
    expect(result.valid).toBe(true);
  });

  it('should reject 401 response (unauthorized)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      status: 401,
    });

    const result = await validateApiKeyLive('sk-ant-api03-valid1234567890abcdef');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('invalid or has been revoked');
  });

  it('should reject 403 response (forbidden)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      status: 403,
    });

    const result = await validateApiKeyLive('sk-ant-api03-valid1234567890abcdef');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('permission');
  });

  it('should report unexpected status codes', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      status: 500,
    });

    const result = await validateApiKeyLive('sk-ant-api03-valid1234567890abcdef');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Unexpected API response');
    expect(result.error).toContain('500');
  });

  it('should handle network errors', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    const result = await validateApiKeyLive('sk-ant-api03-valid1234567890abcdef');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Failed to validate API key');
    expect(result.error).toContain('Network error');
  });

  it('should handle timeout (AbortError)', async () => {
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    globalThis.fetch = vi.fn().mockRejectedValue(abortError);

    const result = await validateApiKeyLive('sk-ant-api03-valid1234567890abcdef', 5000);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('timed out');
    expect(result.error).toContain('5000');
  });

  it('should send correct headers', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ status: 200 });
    globalThis.fetch = fetchSpy;

    const key = 'sk-ant-api03-valid1234567890abcdef';
    await validateApiKeyLive(key);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, options] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(options.method).toBe('POST');
    expect(options.headers['x-api-key']).toBe(key);
    expect(options.headers['anthropic-version']).toBe('2023-06-01');
    expect(options.headers['content-type']).toBe('application/json');
  });

  it('should send minimal request body', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ status: 200 });
    globalThis.fetch = fetchSpy;

    await validateApiKeyLive('sk-ant-api03-valid1234567890abcdef');

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.max_tokens).toBe(1);
    expect(body.messages).toHaveLength(1);
  });
});

// ============================================================================
// validateApiKey (combined)
// ============================================================================

describe('validateApiKey', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('should perform format-only validation by default', async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;

    const result = await validateApiKey('sk-ant-api03-valid1234567890abcdef');
    expect(result.valid).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('should reject invalid keys without live check', async () => {
    const result = await validateApiKey(undefined);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('not set');
  });

  it('should perform live check when requested', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ status: 200 });

    const result = await validateApiKey('sk-ant-api03-valid1234567890abcdef', {
      liveCheck: true,
    });
    expect(result.valid).toBe(true);
  });

  it('should reject via live check even if format is valid', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ status: 401 });

    const result = await validateApiKey('sk-ant-api03-valid1234567890abcdef', {
      liveCheck: true,
    });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('invalid or has been revoked');
  });

  it('should pass timeoutMs to live check', async () => {
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    globalThis.fetch = vi.fn().mockRejectedValue(abortError);

    const result = await validateApiKey('sk-ant-api03-valid1234567890abcdef', {
      liveCheck: true,
      timeoutMs: 3000,
    });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('3000');
  });

  it('should skip live check when format validation fails', async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;

    const result = await validateApiKey('invalid', { liveCheck: true });
    expect(result.valid).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
