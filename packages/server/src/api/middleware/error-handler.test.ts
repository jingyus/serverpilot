// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for error handling middleware.
 */

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { ZodError, z } from 'zod';
import { ApiError, ErrorCode, onError, onNotFound } from './error-handler.js';

function createTestApp() {
  const app = new Hono();
  app.onError(onError);
  app.notFound(onNotFound);
  return app;
}

describe('ApiError', () => {
  it('should create badRequest with details', () => {
    const err = ApiError.badRequest('Invalid input', [
      { field: 'name', message: 'Required' },
    ]);
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe(ErrorCode.VALIDATION_ERROR);
    expect(err.details).toHaveLength(1);
  });

  it('should create unauthorized', () => {
    const err = ApiError.unauthorized();
    expect(err.statusCode).toBe(401);
    expect(err.code).toBe(ErrorCode.UNAUTHORIZED);
  });

  it('should create forbidden', () => {
    const err = ApiError.forbidden();
    expect(err.statusCode).toBe(403);
    expect(err.code).toBe(ErrorCode.FORBIDDEN);
  });

  it('should create notFound with custom resource name', () => {
    const err = ApiError.notFound('Server');
    expect(err.statusCode).toBe(404);
    expect(err.message).toBe('Server not found');
  });

  it('should create serverOffline', () => {
    const err = ApiError.serverOffline();
    expect(err.statusCode).toBe(503);
    expect(err.code).toBe(ErrorCode.SERVER_OFFLINE);
  });

  it('should create aiUnavailable', () => {
    const err = ApiError.aiUnavailable();
    expect(err.statusCode).toBe(503);
    expect(err.code).toBe(ErrorCode.AI_UNAVAILABLE);
  });

  it('should create rateLimited', () => {
    const err = ApiError.rateLimited();
    expect(err.statusCode).toBe(429);
    expect(err.code).toBe(ErrorCode.RATE_LIMITED);
  });

  it('should create internal', () => {
    const err = ApiError.internal();
    expect(err.statusCode).toBe(500);
    expect(err.code).toBe(ErrorCode.INTERNAL_ERROR);
  });
});

describe('onError middleware', () => {
  it('should format ZodError as 400', async () => {
    const app = createTestApp();
    app.get('/test', () => {
      throw new ZodError([
        {
          code: 'invalid_type',
          expected: 'string',
          received: 'number',
          path: ['email'],
          message: 'Expected string, received number',
        },
      ]);
    });

    const res = await app.request('/test');
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details[0].field).toBe('email');
  });

  it('should format ApiError with correct status', async () => {
    const app = createTestApp();
    app.get('/test', () => {
      throw ApiError.forbidden('No access');
    });

    const res = await app.request('/test');
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe('FORBIDDEN');
    expect(body.error.message).toBe('No access');
  });

  it('should format unknown errors as 500', async () => {
    const app = createTestApp();
    app.get('/test', () => {
      throw new TypeError('Cannot read property');
    });

    const res = await app.request('/test');
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).toBe('Internal server error');
  });
});

describe('onNotFound middleware', () => {
  it('should return 404 with route info', async () => {
    const app = createTestApp();

    const res = await app.request('/unknown-route');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.message).toContain('Route not found');
  });
});
