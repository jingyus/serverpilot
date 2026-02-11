// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for CORS origin configuration.
 *
 * Validates parsing of CORS_ORIGIN env var, building Hono cors origin
 * options, and production wildcard security warnings.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { parseCorsOrigins, buildCorsOrigin, warnWildcardCorsInProduction } from './cors-config.js';

// Mock logger — vi.fn() at module level is fine for vi.mock factory
const mockWarn = vi.fn();
vi.mock('../../utils/logger.js', () => ({
  getLogger: () => ({ warn: mockWarn, info: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

// ============================================================================
// parseCorsOrigins
// ============================================================================

describe('parseCorsOrigins', () => {
  it('should return "*" when no value is provided', () => {
    expect(parseCorsOrigins(undefined)).toBe('*');
  });

  it('should return "*" for explicit wildcard', () => {
    expect(parseCorsOrigins('*')).toBe('*');
  });

  it('should return "*" for empty string', () => {
    expect(parseCorsOrigins('')).toBe('*');
  });

  it('should return "*" for whitespace-only string', () => {
    expect(parseCorsOrigins('   ')).toBe('*');
  });

  it('should parse a single origin', () => {
    expect(parseCorsOrigins('https://example.com')).toEqual(['https://example.com']);
  });

  it('should parse multiple comma-separated origins', () => {
    const result = parseCorsOrigins('https://app.example.com,https://admin.example.com');
    expect(result).toEqual(['https://app.example.com', 'https://admin.example.com']);
  });

  it('should trim whitespace around origins', () => {
    const result = parseCorsOrigins('  https://app.example.com , https://admin.example.com  ');
    expect(result).toEqual(['https://app.example.com', 'https://admin.example.com']);
  });

  it('should filter out empty segments from trailing commas', () => {
    const result = parseCorsOrigins('https://example.com,,');
    expect(result).toEqual(['https://example.com']);
  });

  it('should handle origin with port', () => {
    expect(parseCorsOrigins('http://localhost:3001')).toEqual(['http://localhost:3001']);
  });
});

// ============================================================================
// buildCorsOrigin
// ============================================================================

describe('buildCorsOrigin', () => {
  it('should return "*" string for wildcard', () => {
    expect(buildCorsOrigin('*')).toBe('*');
  });

  it('should return the origin string for a single-element array', () => {
    expect(buildCorsOrigin(['https://example.com'])).toBe('https://example.com');
  });

  it('should return a function for multiple origins', () => {
    const origin = buildCorsOrigin(['https://app.example.com', 'https://admin.example.com']);
    expect(typeof origin).toBe('function');
  });

  it('should return matching origin when request origin is in the allowed list', () => {
    const originFn = buildCorsOrigin(['https://app.example.com', 'https://admin.example.com']) as (origin: string) => string | undefined;
    expect(originFn('https://app.example.com')).toBe('https://app.example.com');
    expect(originFn('https://admin.example.com')).toBe('https://admin.example.com');
  });

  it('should return undefined when request origin is not in the allowed list', () => {
    const originFn = buildCorsOrigin(['https://app.example.com', 'https://other.example.com']) as (origin: string) => string | undefined;
    expect(originFn('https://evil.example.com')).toBeUndefined();
  });
});

// ============================================================================
// warnWildcardCorsInProduction
// ============================================================================

describe('warnWildcardCorsInProduction', () => {
  afterEach(() => {
    mockWarn.mockClear();
  });

  it('should log a warning when NODE_ENV=production and CORS_ORIGIN is wildcard', () => {
    warnWildcardCorsInProduction('production', '*');
    expect(mockWarn).toHaveBeenCalledOnce();
    expect(mockWarn).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'security', corsOrigin: '*' }),
      expect.stringContaining('CORS origin is set to "*" in production'),
    );
  });

  it('should log a warning when NODE_ENV=production and CORS_ORIGIN is undefined', () => {
    warnWildcardCorsInProduction('production', undefined);
    expect(mockWarn).toHaveBeenCalledOnce();
  });

  it('should NOT log a warning when NODE_ENV=development', () => {
    warnWildcardCorsInProduction('development', '*');
    expect(mockWarn).not.toHaveBeenCalled();
  });

  it('should NOT log a warning when CORS_ORIGIN is set to a specific domain', () => {
    warnWildcardCorsInProduction('production', 'https://example.com');
    expect(mockWarn).not.toHaveBeenCalled();
  });

  it('should NOT log a warning when NODE_ENV is undefined', () => {
    warnWildcardCorsInProduction(undefined, '*');
    expect(mockWarn).not.toHaveBeenCalled();
  });
});
