// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for REST API route framework.
 *
 * Validates route registration, request validation, error handling,
 * and middleware integration using Hono's built-in test utilities.
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import type { Hono } from 'hono';
import { createApiApp } from './index.js';
import { _resetRateLimitStore } from '../middleware/rate-limit.js';
import type { ApiEnv } from './types.js';

// ============================================================================
// Test Setup
// ============================================================================

let app: Hono<ApiEnv>;

beforeAll(() => {
  app = createApiApp();
});

beforeEach(() => {
  _resetRateLimitStore();
});

/** Helper to create a test request and return the response */
function req(path: string, init?: RequestInit): Promise<Response> {
  return app.request(path, init);
}

/** Helper to create a JSON POST request */
function jsonPost(path: string, body: unknown): Promise<Response> {
  return req(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** Helper to create a JSON PATCH request */
function jsonPatch(path: string, body: unknown): Promise<Response> {
  return req(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ============================================================================
// Health Check
// ============================================================================

describe('Health Check', () => {
  it('GET /health should return 200 with status ok', async () => {
    const res = await req('/health');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.timestamp).toBeTypeOf('number');
  });
});

// ============================================================================
// 404 Not Found
// ============================================================================

describe('Not Found', () => {
  it('should return 404 for unknown routes', async () => {
    const res = await req('/api/v1/nonexistent');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe('NOT_FOUND');
  });
});

// ============================================================================
// CORS
// ============================================================================

describe('CORS', () => {
  it('should include CORS headers in response (default wildcard)', async () => {
    const res = await req('/health');
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('should handle OPTIONS preflight', async () => {
    const res = await req('/api/v1/servers', {
      method: 'OPTIONS',
      headers: {
        'Origin': 'http://localhost:3000',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type, Authorization',
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-methods')).toContain('POST');
  });

  it('should restrict origin when CORS_ORIGIN is set to a specific domain', async () => {
    const original = process.env.CORS_ORIGIN;
    process.env.CORS_ORIGIN = 'https://my-dashboard.example.com';
    try {
      const restrictedApp = createApiApp();
      const res = await restrictedApp.request('/health', {
        headers: { Origin: 'https://my-dashboard.example.com' },
      });
      expect(res.headers.get('access-control-allow-origin')).toBe('https://my-dashboard.example.com');
    } finally {
      if (original === undefined) delete process.env.CORS_ORIGIN;
      else process.env.CORS_ORIGIN = original;
    }
  });

  it('should allow one of multiple configured origins', async () => {
    const original = process.env.CORS_ORIGIN;
    process.env.CORS_ORIGIN = 'https://app.example.com,https://admin.example.com';
    try {
      const multiApp = createApiApp();
      const res = await multiApp.request('/health', {
        headers: { Origin: 'https://admin.example.com' },
      });
      expect(res.headers.get('access-control-allow-origin')).toBe('https://admin.example.com');
    } finally {
      if (original === undefined) delete process.env.CORS_ORIGIN;
      else process.env.CORS_ORIGIN = original;
    }
  });

  it('should not set origin header for disallowed origin with multi-origin config', async () => {
    const original = process.env.CORS_ORIGIN;
    process.env.CORS_ORIGIN = 'https://app.example.com';
    try {
      const restrictedApp = createApiApp();
      const res = await restrictedApp.request('/health', {
        headers: { Origin: 'https://evil.example.com' },
      });
      // Hono cors middleware does not set the header for non-matching origins
      const originHeader = res.headers.get('access-control-allow-origin');
      expect(originHeader).not.toBe('https://evil.example.com');
    } finally {
      if (original === undefined) delete process.env.CORS_ORIGIN;
      else process.env.CORS_ORIGIN = original;
    }
  });
});

// ============================================================================
// Security Headers
// ============================================================================

describe('Security Headers', () => {
  it('should include X-Content-Type-Options on responses', async () => {
    const res = await req('/health');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('should include X-Frame-Options on responses', async () => {
    const res = await req('/health');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
  });

  it('should include Content-Security-Policy on responses', async () => {
    const res = await req('/health');
    const csp = res.headers.get('content-security-policy');
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it('should include Permissions-Policy on responses', async () => {
    const res = await req('/health');
    const pp = res.headers.get('permissions-policy');
    expect(pp).toContain('camera=()');
    expect(pp).toContain('microphone=()');
  });

  it('should include Referrer-Policy on responses', async () => {
    const res = await req('/health');
    expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
  });
});

// ============================================================================
// Auth Routes
// ============================================================================

describe('Auth Routes', () => {
  describe('POST /api/v1/auth/login', () => {
    it('should validate email format', async () => {
      const res = await jsonPost('/api/v1/auth/login', {
        email: 'not-an-email',
        password: 'password123',
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'email' }),
        ]),
      );
    });

    it('should validate password minimum length', async () => {
      const res = await jsonPost('/api/v1/auth/login', {
        email: 'test@example.com',
        password: 'short',
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'password' }),
        ]),
      );
    });

    it('should reject missing body fields', async () => {
      const res = await jsonPost('/api/v1/auth/login', {});
      expect(res.status).toBe(400);
    });

    it('should reject invalid JSON', async () => {
      const res = await req('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not json',
      });
      expect(res.status).toBe(400);
    });

    it('should accept valid login body and reach handler', async () => {
      const res = await jsonPost('/api/v1/auth/login', {
        email: 'test@example.com',
        password: 'password123',
      });
      // Valid body passes validation; handler runs but may fail without DB
      expect([401, 500]).toContain(res.status);
    });
  });

  describe('POST /api/v1/auth/register', () => {
    it('should validate required name field', async () => {
      const res = await jsonPost('/api/v1/auth/register', {
        email: 'test@example.com',
        password: 'password123',
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'name' }),
        ]),
      );
    });

    it('should accept valid registration (stub returns 500)', async () => {
      const res = await jsonPost('/api/v1/auth/register', {
        email: 'test@example.com',
        password: 'password123',
        name: 'Test User',
      });
      expect(res.status).toBe(500);
    });
  });

  describe('POST /api/v1/auth/refresh', () => {
    it('should validate refreshToken field', async () => {
      const res = await jsonPost('/api/v1/auth/refresh', {});
      expect(res.status).toBe(400);
    });

    it('should accept valid refresh body (stub returns 500)', async () => {
      const res = await jsonPost('/api/v1/auth/refresh', {
        refreshToken: 'some-refresh-token',
      });
      expect(res.status).toBe(500);
    });
  });

  describe('POST /api/v1/auth/logout', () => {
    it('should return 200 with success message', async () => {
      const res = await req('/api/v1/auth/logout', { method: 'POST' });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.message).toBe('Logged out successfully');
    });
  });
});

// ============================================================================
// Server Routes (auth required — full tests in servers.test.ts)
// ============================================================================

describe('Server Routes', () => {
  it('should return 401 for unauthenticated GET /api/v1/servers', async () => {
    const res = await req('/api/v1/servers');
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('should return 401 for unauthenticated POST /api/v1/servers', async () => {
    const res = await jsonPost('/api/v1/servers', { name: 'my-server' });
    expect(res.status).toBe(401);
  });

  it('should return 401 for unauthenticated GET /api/v1/servers/:id', async () => {
    const res = await req('/api/v1/servers/550e8400-e29b-41d4-a716-446655440000');
    expect(res.status).toBe(401);
  });

  it('should return 401 for unauthenticated DELETE /api/v1/servers/:id', async () => {
    const res = await req('/api/v1/servers/550e8400-e29b-41d4-a716-446655440000', {
      method: 'DELETE',
    });
    expect(res.status).toBe(401);
  });
});

// ============================================================================
// Chat Routes
// ============================================================================

describe('Chat Routes', () => {
  const serverId = '550e8400-e29b-41d4-a716-446655440000';

  describe('POST /api/v1/chat/:serverId', () => {
    it('should return 401 for unauthenticated request', async () => {
      const res = await jsonPost(`/api/v1/chat/${serverId}`, {
        message: 'Install nginx on my server',
      });
      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/v1/chat/:serverId/execute', () => {
    it('should return 401 for unauthenticated request', async () => {
      const res = await jsonPost(`/api/v1/chat/${serverId}/execute`, {
        planId: 'plan-123',
        sessionId: 'session-456',
      });
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/v1/chat/:serverId/sessions', () => {
    it('should return 401 for unauthenticated request', async () => {
      const res = await req(`/api/v1/chat/${serverId}/sessions`);
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/v1/chat/:serverId/sessions/:sessionId', () => {
    it('should return 401 for unauthenticated request', async () => {
      const res = await req(`/api/v1/chat/${serverId}/sessions/550e8400-e29b-41d4-a716-446655440001`);
      expect(res.status).toBe(401);
    });
  });

  describe('DELETE /api/v1/chat/:serverId/sessions/:sessionId', () => {
    it('should return 401 for unauthenticated request', async () => {
      const res = await req(`/api/v1/chat/${serverId}/sessions/550e8400-e29b-41d4-a716-446655440001`, {
        method: 'DELETE',
      });
      expect(res.status).toBe(401);
    });
  });
});

// ============================================================================
// Task Routes (require authentication)
// ============================================================================

describe('Task Routes', () => {
  describe('GET /api/v1/tasks', () => {
    it('should return 401 for unauthenticated request', async () => {
      const res = await req('/api/v1/tasks');
      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/v1/tasks', () => {
    it('should return 401 for unauthenticated request', async () => {
      const res = await jsonPost('/api/v1/tasks', {
        serverId: '550e8400-e29b-41d4-a716-446655440000',
        name: 'Daily Backup',
        cron: '0 0 * * *',
        command: 'tar -czf backup.tar.gz /data',
      });
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/v1/tasks/:id', () => {
    it('should return 401 for unauthenticated request', async () => {
      const res = await req('/api/v1/tasks/550e8400-e29b-41d4-a716-446655440000');
      expect(res.status).toBe(401);
    });
  });

  describe('PATCH /api/v1/tasks/:id', () => {
    it('should return 401 for unauthenticated request', async () => {
      const res = await jsonPatch(
        '/api/v1/tasks/550e8400-e29b-41d4-a716-446655440000',
        { name: 'Updated Task', status: 'paused' },
      );
      expect(res.status).toBe(401);
    });
  });

  describe('DELETE /api/v1/tasks/:id', () => {
    it('should return 401 for unauthenticated request', async () => {
      const res = await req('/api/v1/tasks/550e8400-e29b-41d4-a716-446655440000', {
        method: 'DELETE',
      });
      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/v1/tasks/:id/run', () => {
    it('should return 401 for unauthenticated request', async () => {
      const res = await req('/api/v1/tasks/550e8400-e29b-41d4-a716-446655440000/run', {
        method: 'POST',
      });
      expect(res.status).toBe(401);
    });
  });
});

// ============================================================================
// Alert Routes (require authentication)
// ============================================================================

describe('Alert Routes', () => {
  describe('GET /api/v1/alerts', () => {
    it('should return 401 for unauthenticated request', async () => {
      const res = await req('/api/v1/alerts');
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/v1/alerts/:id', () => {
    it('should return 401 for unauthenticated request', async () => {
      const res = await req('/api/v1/alerts/550e8400-e29b-41d4-a716-446655440000');
      expect(res.status).toBe(401);
    });
  });

  describe('PATCH /api/v1/alerts/:id/resolve', () => {
    it('should return 401 for unauthenticated request', async () => {
      const res = await req('/api/v1/alerts/550e8400-e29b-41d4-a716-446655440000/resolve', {
        method: 'PATCH',
      });
      expect(res.status).toBe(401);
    });
  });
});

// ============================================================================
// Error Handling
// ============================================================================

describe('Error Handling', () => {
  it('should format ZodError as 400 with field details', async () => {
    const res = await jsonPost('/api/v1/auth/login', {
      email: 123,
      password: true,
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toBe('Request validation failed');
    expect(Array.isArray(body.error.details)).toBe(true);
    expect(body.error.details.length).toBeGreaterThan(0);
  });

  it('should format ApiError with correct status and code', async () => {
    // Unauthenticated request to a protected route triggers ApiError.unauthorized
    const res = await req('/api/v1/servers');
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('UNAUTHORIZED');
    expect(body.error.message).toBeTypeOf('string');
  });

  it('should return 404 with proper error format for unknown endpoint', async () => {
    const res = await req('/api/v1/does-not-exist');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.message).toContain('Route not found');
  });
});
