// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for security-headers middleware.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { createSecurityHeadersMiddleware } from './security-headers.js';

// ============================================================================
// Helpers
// ============================================================================

function createTestApp(options?: Parameters<typeof createSecurityHeadersMiddleware>[0]) {
  const app = new Hono();
  app.use('*', createSecurityHeadersMiddleware(options));
  app.get('/test', (c) => c.json({ ok: true }));
  return app;
}

// ============================================================================
// Tests
// ============================================================================

describe('Security Headers Middleware', () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env.NODE_ENV;
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalEnv;
  });

  // --------------------------------------------------------------------------
  // Standard headers (always present)
  // --------------------------------------------------------------------------

  describe('standard headers', () => {
    it('should set X-Content-Type-Options to nosniff', async () => {
      const app = createTestApp({ enableHsts: false });
      const res = await app.request('/test');
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    });

    it('should set X-Frame-Options to DENY', async () => {
      const app = createTestApp({ enableHsts: false });
      const res = await app.request('/test');
      expect(res.headers.get('x-frame-options')).toBe('DENY');
    });

    it('should set Referrer-Policy', async () => {
      const app = createTestApp({ enableHsts: false });
      const res = await app.request('/test');
      expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    });

    it('should set Content-Security-Policy for API', async () => {
      const app = createTestApp({ enableHsts: false });
      const res = await app.request('/test');
      const csp = res.headers.get('content-security-policy');
      expect(csp).toContain("default-src 'none'");
      expect(csp).toContain("frame-ancestors 'none'");
    });

    it('should set Permissions-Policy', async () => {
      const app = createTestApp({ enableHsts: false });
      const res = await app.request('/test');
      const pp = res.headers.get('permissions-policy');
      expect(pp).toContain('camera=()');
      expect(pp).toContain('microphone=()');
      expect(pp).toContain('geolocation=()');
      expect(pp).toContain('payment=()');
    });
  });

  // --------------------------------------------------------------------------
  // HSTS
  // --------------------------------------------------------------------------

  describe('HSTS', () => {
    it('should set HSTS when enableHsts is true', async () => {
      const app = createTestApp({ enableHsts: true });
      const res = await app.request('/test');
      const hsts = res.headers.get('strict-transport-security');
      expect(hsts).toContain('max-age=63072000');
      expect(hsts).toContain('includeSubDomains');
    });

    it('should NOT set HSTS when enableHsts is false', async () => {
      const app = createTestApp({ enableHsts: false });
      const res = await app.request('/test');
      expect(res.headers.get('strict-transport-security')).toBeNull();
    });

    it('should allow custom max-age', async () => {
      const app = createTestApp({ enableHsts: true, hstsMaxAge: 31536000 });
      const res = await app.request('/test');
      const hsts = res.headers.get('strict-transport-security');
      expect(hsts).toContain('max-age=31536000');
    });

    it('should auto-enable HSTS in production when not specified', async () => {
      process.env.NODE_ENV = 'production';
      const app = createTestApp();
      const res = await app.request('/test');
      expect(res.headers.get('strict-transport-security')).not.toBeNull();
    });

    it('should NOT auto-enable HSTS in development', async () => {
      process.env.NODE_ENV = 'development';
      const app = createTestApp();
      const res = await app.request('/test');
      expect(res.headers.get('strict-transport-security')).toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // Integration
  // --------------------------------------------------------------------------

  describe('integration', () => {
    it('should set headers on all routes', async () => {
      const app = new Hono();
      app.use('*', createSecurityHeadersMiddleware({ enableHsts: false }));
      app.get('/a', (c) => c.text('a'));
      app.get('/b', (c) => c.json({ b: 1 }));

      const [resA, resB] = await Promise.all([
        app.request('/a'),
        app.request('/b'),
      ]);

      expect(resA.headers.get('content-security-policy')).toBeTruthy();
      expect(resB.headers.get('content-security-policy')).toBeTruthy();
    });

    it('should not interfere with response body', async () => {
      const app = createTestApp({ enableHsts: false });
      const res = await app.request('/test');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ ok: true });
    });
  });
});
