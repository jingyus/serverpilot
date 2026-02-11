// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for JWT authentication middleware.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import {
  initJwtConfig,
  generateTokens,
  verifyToken,
  requireAuth,
  _resetJwtConfig,
} from './auth.js';
import { onError } from './error-handler.js';
import type { ApiEnv } from '../routes/types.js';

// ============================================================================
// Helpers
// ============================================================================

const TEST_SECRET = 'test-secret-key-that-is-at-least-32-chars-long!!';
const TEST_USER_ID = 'user-abc-123';

function setupConfig(overrides: Record<string, string> = {}) {
  initJwtConfig({
    secret: TEST_SECRET,
    accessExpiresIn: '15m',
    refreshExpiresIn: '7d',
    ...overrides,
  });
}

function createTestApp() {
  const app = new Hono<ApiEnv>();
  app.onError(onError);
  app.get('/protected', requireAuth, (c) => {
    return c.json({ userId: c.get('userId') });
  });
  return app;
}

// ============================================================================
// initJwtConfig
// ============================================================================

describe('initJwtConfig', () => {
  beforeEach(() => _resetJwtConfig());

  it('should accept valid configuration', () => {
    expect(() => setupConfig()).not.toThrow();
  });

  it('should reject secret shorter than 32 chars', () => {
    expect(() => initJwtConfig({ secret: 'too-short' })).toThrow();
  });

  it('should apply default values for optional fields', () => {
    expect(() =>
      initJwtConfig({ secret: TEST_SECRET }),
    ).not.toThrow();
  });
});

// ============================================================================
// generateTokens
// ============================================================================

describe('generateTokens', () => {
  beforeEach(() => {
    _resetJwtConfig();
    setupConfig();
  });

  it('should return access and refresh tokens', async () => {
    const tokens = await generateTokens(TEST_USER_ID);

    expect(tokens.accessToken).toBeTruthy();
    expect(tokens.refreshToken).toBeTruthy();
    expect(typeof tokens.accessToken).toBe('string');
    expect(typeof tokens.refreshToken).toBe('string');
  });

  it('should generate different access and refresh tokens', async () => {
    const tokens = await generateTokens(TEST_USER_ID);
    expect(tokens.accessToken).not.toBe(tokens.refreshToken);
  });

  it('should throw if config not initialized', async () => {
    _resetJwtConfig();
    await expect(generateTokens(TEST_USER_ID)).rejects.toThrow(
      'JWT config not initialized',
    );
  });
});

// ============================================================================
// verifyToken
// ============================================================================

describe('verifyToken', () => {
  beforeEach(() => {
    _resetJwtConfig();
    setupConfig();
  });

  it('should verify a valid access token', async () => {
    const tokens = await generateTokens(TEST_USER_ID);
    const result = await verifyToken(tokens.accessToken, 'access');

    expect(result.userId).toBe(TEST_USER_ID);
    expect(result.type).toBe('access');
  });

  it('should verify a valid refresh token', async () => {
    const tokens = await generateTokens(TEST_USER_ID);
    const result = await verifyToken(tokens.refreshToken, 'refresh');

    expect(result.userId).toBe(TEST_USER_ID);
    expect(result.type).toBe('refresh');
  });

  it('should reject an access token when refresh is expected', async () => {
    const tokens = await generateTokens(TEST_USER_ID);
    await expect(verifyToken(tokens.accessToken, 'refresh')).rejects.toThrow(
      'Invalid token type',
    );
  });

  it('should reject a refresh token when access is expected', async () => {
    const tokens = await generateTokens(TEST_USER_ID);
    await expect(verifyToken(tokens.refreshToken, 'access')).rejects.toThrow(
      'Invalid token type',
    );
  });

  it('should reject an expired token', async () => {
    _resetJwtConfig();
    initJwtConfig({ secret: TEST_SECRET, accessExpiresIn: '0s' });

    const tokens = await generateTokens(TEST_USER_ID);
    // Small delay to ensure expiration
    await new Promise((r) => setTimeout(r, 10));

    await expect(verifyToken(tokens.accessToken, 'access')).rejects.toThrow(
      'Token expired',
    );
  });

  it('should reject a token with invalid signature', async () => {
    // Generate token with different secret
    const otherKey = new TextEncoder().encode(
      'another-secret-key-that-is-also-at-least-32-chars!!',
    );
    const fakeToken = await new SignJWT({ type: 'access' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(TEST_USER_ID)
      .setIssuer('serverpilot')
      .setAudience('serverpilot-api')
      .setExpirationTime('15m')
      .sign(otherKey);

    await expect(verifyToken(fakeToken, 'access')).rejects.toThrow(
      'Invalid token signature',
    );
  });

  it('should reject a token with wrong issuer', async () => {
    const key = new TextEncoder().encode(TEST_SECRET);
    const fakeToken = await new SignJWT({ type: 'access' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(TEST_USER_ID)
      .setIssuer('wrong-issuer')
      .setAudience('serverpilot-api')
      .setExpirationTime('15m')
      .sign(key);

    await expect(verifyToken(fakeToken, 'access')).rejects.toThrow(
      'Token validation failed',
    );
  });

  it('should reject a token with wrong audience', async () => {
    const key = new TextEncoder().encode(TEST_SECRET);
    const fakeToken = await new SignJWT({ type: 'access' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(TEST_USER_ID)
      .setIssuer('serverpilot')
      .setAudience('wrong-audience')
      .setExpirationTime('15m')
      .sign(key);

    await expect(verifyToken(fakeToken, 'access')).rejects.toThrow(
      'Token validation failed',
    );
  });

  it('should reject a completely invalid token string', async () => {
    await expect(verifyToken('not.a.valid.jwt', 'access')).rejects.toThrow(
      'Invalid token',
    );
  });

  it('should reject a token without subject claim', async () => {
    const key = new TextEncoder().encode(TEST_SECRET);
    const fakeToken = await new SignJWT({ type: 'access' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('serverpilot')
      .setAudience('serverpilot-api')
      .setExpirationTime('15m')
      .sign(key);

    await expect(verifyToken(fakeToken, 'access')).rejects.toThrow(
      'missing subject',
    );
  });
});

// ============================================================================
// requireAuth middleware
// ============================================================================

describe('requireAuth middleware', () => {
  beforeEach(() => {
    _resetJwtConfig();
    setupConfig();
  });

  it('should pass with valid access token and set userId', async () => {
    const app = createTestApp();
    const tokens = await generateTokens(TEST_USER_ID);

    const res = await app.request('/protected', {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.userId).toBe(TEST_USER_ID);
  });

  it('should return 401 when Authorization header is missing', async () => {
    const app = createTestApp();

    const res = await app.request('/protected');
    expect(res.status).toBe(401);

    const body = await res.json();
    expect(body.error.code).toBe('UNAUTHORIZED');
    expect(body.error.message).toContain('Missing Authorization header');
  });

  it('should return 401 for non-Bearer auth scheme', async () => {
    const app = createTestApp();

    const res = await app.request('/protected', {
      headers: { Authorization: 'Basic dXNlcjpwYXNz' },
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.message).toContain('Invalid Authorization format');
  });

  it('should return 401 for Bearer with empty token', async () => {
    const app = createTestApp();

    const res = await app.request('/protected', {
      headers: { Authorization: 'Bearer ' },
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('should return 401 for expired access token', async () => {
    _resetJwtConfig();
    initJwtConfig({ secret: TEST_SECRET, accessExpiresIn: '0s' });

    const tokens = await generateTokens(TEST_USER_ID);
    await new Promise((r) => setTimeout(r, 10));

    const app = createTestApp();
    const res = await app.request('/protected', {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.message).toContain('Token expired');
  });

  it('should return 401 for refresh token used as access token', async () => {
    const app = createTestApp();
    const tokens = await generateTokens(TEST_USER_ID);

    const res = await app.request('/protected', {
      headers: { Authorization: `Bearer ${tokens.refreshToken}` },
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.message).toContain('Invalid token type');
  });

  it('should return 401 for tampered token', async () => {
    const app = createTestApp();
    const tokens = await generateTokens(TEST_USER_ID);
    const tampered = tokens.accessToken.slice(0, -5) + 'XXXXX';

    const res = await app.request('/protected', {
      headers: { Authorization: `Bearer ${tampered}` },
    });

    expect(res.status).toBe(401);
  });

  it('should work with multiple protected routes', async () => {
    const app = new Hono<ApiEnv>();
    app.onError(onError);
    app.use('/api/*', requireAuth);
    app.get('/api/profile', (c) => c.json({ id: c.get('userId') }));
    app.get('/api/settings', (c) => c.json({ id: c.get('userId') }));
    app.get('/public', (c) => c.json({ ok: true }));

    const tokens = await generateTokens(TEST_USER_ID);
    const headers = { Authorization: `Bearer ${tokens.accessToken}` };

    const [profileRes, settingsRes, publicRes] = await Promise.all([
      app.request('/api/profile', { headers }),
      app.request('/api/settings', { headers }),
      app.request('/public'),
    ]);

    expect(profileRes.status).toBe(200);
    expect(settingsRes.status).toBe(200);
    expect(publicRes.status).toBe(200);

    const profileBody = await profileRes.json();
    expect(profileBody.id).toBe(TEST_USER_ID);
  });
});
