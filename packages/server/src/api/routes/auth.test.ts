// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for authentication routes (register, login, refresh, logout).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';

import { auth } from './auth.js';
import { onError } from '../middleware/error-handler.js';
import { initJwtConfig, _resetJwtConfig, verifyToken } from '../middleware/auth.js';
import {
  InMemoryUserRepository,
  setUserRepository,
  _resetUserRepository,
} from '../../db/repositories/user-repository.js';
import { hashPassword } from '../../utils/password.js';
import type { ApiEnv } from './types.js';

// ============================================================================
// Helpers
// ============================================================================

const TEST_SECRET = 'test-secret-key-that-is-at-least-32-chars-long!!';

function createTestApp() {
  const app = new Hono<ApiEnv>();
  app.onError(onError);
  app.route('/auth', auth);
  return app;
}

function jsonPost(app: Hono<ApiEnv>, path: string, body: unknown) {
  return app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ============================================================================
// Setup / Teardown
// ============================================================================

let repo: InMemoryUserRepository;

beforeEach(() => {
  _resetJwtConfig();
  _resetUserRepository();
  initJwtConfig({ secret: TEST_SECRET });
  repo = new InMemoryUserRepository();
  setUserRepository(repo);
});

afterEach(() => {
  _resetJwtConfig();
  _resetUserRepository();
});

// ============================================================================
// POST /auth/register
// ============================================================================

describe('POST /auth/register', () => {
  it('should register a new user and return tokens', async () => {
    const app = createTestApp();
    const res = await jsonPost(app, '/auth/register', {
      email: 'alice@example.com',
      password: 'securepass123',
      name: 'Alice',
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.user.email).toBe('alice@example.com');
    expect(body.user.name).toBe('Alice');
    expect(body.user.id).toBeTruthy();
    expect(body.accessToken).toBeTruthy();
    expect(body.refreshToken).toBeTruthy();
  });

  it('should store hashed password (not plaintext)', async () => {
    const app = createTestApp();
    await jsonPost(app, '/auth/register', {
      email: 'alice@example.com',
      password: 'securepass123',
      name: 'Alice',
    });

    const user = await repo.findByEmail('alice@example.com');
    expect(user).not.toBeNull();
    expect(user!.passwordHash).not.toBe('securepass123');
    expect(user!.passwordHash).toMatch(/^scrypt:/);
  });

  it('should return valid JWT tokens', async () => {
    const app = createTestApp();
    const res = await jsonPost(app, '/auth/register', {
      email: 'alice@example.com',
      password: 'securepass123',
      name: 'Alice',
    });

    const body = await res.json();

    // Verify access token
    const accessResult = await verifyToken(body.accessToken, 'access');
    expect(accessResult.userId).toBe(body.user.id);
    expect(accessResult.type).toBe('access');

    // Verify refresh token
    const refreshResult = await verifyToken(body.refreshToken, 'refresh');
    expect(refreshResult.userId).toBe(body.user.id);
    expect(refreshResult.type).toBe('refresh');
  });

  it('should reject duplicate email', async () => {
    const app = createTestApp();

    await jsonPost(app, '/auth/register', {
      email: 'dup@example.com',
      password: 'securepass123',
      name: 'First',
    });

    const res = await jsonPost(app, '/auth/register', {
      email: 'dup@example.com',
      password: 'otherpass456',
      name: 'Second',
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toContain('Email already registered');
  });

  it('should reject missing name', async () => {
    const app = createTestApp();
    const res = await jsonPost(app, '/auth/register', {
      email: 'alice@example.com',
      password: 'securepass123',
    });

    expect(res.status).toBe(400);
  });

  it('should reject invalid email', async () => {
    const app = createTestApp();
    const res = await jsonPost(app, '/auth/register', {
      email: 'not-an-email',
      password: 'securepass123',
      name: 'Alice',
    });

    expect(res.status).toBe(400);
  });

  it('should reject short password', async () => {
    const app = createTestApp();
    const res = await jsonPost(app, '/auth/register', {
      email: 'alice@example.com',
      password: 'short',
      name: 'Alice',
    });

    expect(res.status).toBe(400);
  });

  it('should reject empty body', async () => {
    const app = createTestApp();
    const res = await jsonPost(app, '/auth/register', {});
    expect(res.status).toBe(400);
  });
});

// ============================================================================
// POST /auth/login
// ============================================================================

describe('POST /auth/login', () => {
  beforeEach(async () => {
    // Pre-register a user
    const hash = await hashPassword('correctpassword');
    await repo.create({
      email: 'bob@example.com',
      passwordHash: hash,
      name: 'Bob',
    });
  });

  it('should login with correct credentials', async () => {
    const app = createTestApp();
    const res = await jsonPost(app, '/auth/login', {
      email: 'bob@example.com',
      password: 'correctpassword',
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.email).toBe('bob@example.com');
    expect(body.user.name).toBe('Bob');
    expect(body.accessToken).toBeTruthy();
    expect(body.refreshToken).toBeTruthy();
  });

  it('should return valid tokens on login', async () => {
    const app = createTestApp();
    const res = await jsonPost(app, '/auth/login', {
      email: 'bob@example.com',
      password: 'correctpassword',
    });

    const body = await res.json();
    const result = await verifyToken(body.accessToken, 'access');
    expect(result.userId).toBe(body.user.id);
  });

  it('should reject wrong password', async () => {
    const app = createTestApp();
    const res = await jsonPost(app, '/auth/login', {
      email: 'bob@example.com',
      password: 'wrongpassword',
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('UNAUTHORIZED');
    expect(body.error.message).toBe('Invalid email or password');
  });

  it('should reject non-existent email', async () => {
    const app = createTestApp();
    const res = await jsonPost(app, '/auth/login', {
      email: 'nobody@example.com',
      password: 'anypassword1',
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.message).toBe('Invalid email or password');
  });

  it('should return same error for wrong email and wrong password (no enumeration)', async () => {
    const app = createTestApp();

    const wrongEmail = await jsonPost(app, '/auth/login', {
      email: 'nobody@example.com',
      password: 'anypassword1',
    });
    const wrongPass = await jsonPost(app, '/auth/login', {
      email: 'bob@example.com',
      password: 'wrongpassword',
    });

    const body1 = await wrongEmail.json();
    const body2 = await wrongPass.json();
    expect(body1.error.message).toBe(body2.error.message);
  });

  it('should reject invalid email format', async () => {
    const app = createTestApp();
    const res = await jsonPost(app, '/auth/login', {
      email: 'not-email',
      password: 'somepassword1',
    });

    expect(res.status).toBe(400);
  });

  it('should reject missing password', async () => {
    const app = createTestApp();
    const res = await jsonPost(app, '/auth/login', {
      email: 'bob@example.com',
    });

    expect(res.status).toBe(400);
  });
});

// ============================================================================
// POST /auth/refresh
// ============================================================================

describe('POST /auth/refresh', () => {
  let validRefreshToken: string;
  let userId: string;

  beforeEach(async () => {
    // Register a user and get tokens
    const app = createTestApp();
    const res = await jsonPost(app, '/auth/register', {
      email: 'carol@example.com',
      password: 'securepass123',
      name: 'Carol',
    });
    const body = await res.json();
    validRefreshToken = body.refreshToken;
    userId = body.user.id;
  });

  it('should issue new tokens with valid refresh token', async () => {
    const app = createTestApp();
    const res = await jsonPost(app, '/auth/refresh', {
      refreshToken: validRefreshToken,
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.accessToken).toBeTruthy();
    expect(body.refreshToken).toBeTruthy();
  });

  it('should return tokens for the same user', async () => {
    const app = createTestApp();
    const res = await jsonPost(app, '/auth/refresh', {
      refreshToken: validRefreshToken,
    });

    const body = await res.json();
    const result = await verifyToken(body.accessToken, 'access');
    expect(result.userId).toBe(userId);
  });

  it('should reject invalid refresh token', async () => {
    const app = createTestApp();
    const res = await jsonPost(app, '/auth/refresh', {
      refreshToken: 'invalid.token.string',
    });

    expect(res.status).toBe(401);
  });

  it('should reject access token used as refresh token', async () => {
    // First get an access token
    const app = createTestApp();
    const loginRes = await jsonPost(app, '/auth/login', {
      email: 'carol@example.com',
      password: 'securepass123',
    });
    const loginBody = await loginRes.json();

    const res = await jsonPost(app, '/auth/refresh', {
      refreshToken: loginBody.accessToken,
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.message).toContain('Invalid token type');
  });

  it('should reject empty refreshToken', async () => {
    const app = createTestApp();
    const res = await jsonPost(app, '/auth/refresh', {
      refreshToken: '',
    });

    expect(res.status).toBe(400);
  });

  it('should reject missing refreshToken field', async () => {
    const app = createTestApp();
    const res = await jsonPost(app, '/auth/refresh', {});

    expect(res.status).toBe(400);
  });

  it('should reject refresh when user has been deleted', async () => {
    // Delete the user from the repo
    await repo.delete(userId);

    const app = createTestApp();
    const res = await jsonPost(app, '/auth/refresh', {
      refreshToken: validRefreshToken,
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.message).toContain('User no longer exists');
  });
});

// ============================================================================
// POST /auth/logout
// ============================================================================

describe('POST /auth/logout', () => {
  it('should return success message', async () => {
    const app = createTestApp();
    const res = await app.request('/auth/logout', { method: 'POST' });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.message).toBe('Logged out successfully');
  });
});

// ============================================================================
// Integration: full register → login → refresh flow
// ============================================================================

describe('Full auth flow', () => {
  it('should complete register → login → refresh → access protected resource', async () => {
    const app = new Hono<ApiEnv>();
    app.onError(onError);
    app.route('/auth', auth);

    // 1. Register
    const registerRes = await jsonPost(app, '/auth/register', {
      email: 'dave@example.com',
      password: 'password1234',
      name: 'Dave',
    });
    expect(registerRes.status).toBe(201);
    const registerBody = await registerRes.json();

    // 2. Login with same credentials
    const loginRes = await jsonPost(app, '/auth/login', {
      email: 'dave@example.com',
      password: 'password1234',
    });
    expect(loginRes.status).toBe(200);
    const loginBody = await loginRes.json();
    expect(loginBody.user.email).toBe('dave@example.com');

    // 3. Refresh with the token from register
    const refreshRes = await jsonPost(app, '/auth/refresh', {
      refreshToken: registerBody.refreshToken,
    });
    expect(refreshRes.status).toBe(200);
    const refreshBody = await refreshRes.json();
    expect(refreshBody.accessToken).toBeTruthy();

    // 4. Verify the new access token is valid
    const verifyResult = await verifyToken(refreshBody.accessToken, 'access');
    expect(verifyResult.userId).toBe(registerBody.user.id);
  });
});
