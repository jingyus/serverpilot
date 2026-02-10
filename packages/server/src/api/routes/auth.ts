/**
 * Authentication routes.
 *
 * Handles user login, registration, token refresh, and logout.
 * All auth endpoints are public (no JWT required).
 *
 * @module api/routes/auth
 */

import { Hono } from 'hono';
import { LoginBodySchema, RegisterBodySchema, RefreshTokenBodySchema } from './schemas.js';
import { validateBody } from '../middleware/validate.js';
import { ApiError } from '../middleware/error-handler.js';
import { generateTokens, verifyToken } from '../middleware/auth.js';
import { getUserRepository } from '../../db/repositories/user-repository.js';
import { hashPassword, verifyPassword } from '../../utils/password.js';
import type { LoginBody, RegisterBody, RefreshTokenBody } from './schemas.js';
import type { ApiEnv } from './types.js';

const auth = new Hono<ApiEnv>();

// ============================================================================
// POST /auth/register
// ============================================================================

auth.post('/register', validateBody(RegisterBodySchema), async (c) => {
  const body = c.get('validatedBody') as RegisterBody;
  const repo = getUserRepository();

  // Check email uniqueness
  const existing = await repo.findByEmail(body.email);
  if (existing) {
    throw ApiError.badRequest('Email already registered', [
      { field: 'email', message: 'This email is already in use' },
    ]);
  }

  // Hash password and create user
  const passwordHash = await hashPassword(body.password);
  const user = await repo.create({
    email: body.email,
    passwordHash,
    name: body.name,
  });

  // Generate tokens
  const tokens = await generateTokens(user.id);

  return c.json({
    user: { id: user.id, email: user.email, name: user.name },
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
  }, 201);
});

// ============================================================================
// POST /auth/login
// ============================================================================

auth.post('/login', validateBody(LoginBodySchema), async (c) => {
  const body = c.get('validatedBody') as LoginBody;
  const repo = getUserRepository();

  // Find user by email
  const user = await repo.findByEmail(body.email);
  if (!user) {
    throw ApiError.unauthorized('Invalid email or password');
  }

  // Verify password
  const valid = await verifyPassword(body.password, user.passwordHash);
  if (!valid) {
    throw ApiError.unauthorized('Invalid email or password');
  }

  // Generate tokens
  const tokens = await generateTokens(user.id);

  return c.json({
    user: { id: user.id, email: user.email, name: user.name },
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
  });
});

// ============================================================================
// POST /auth/refresh
// ============================================================================

auth.post('/refresh', validateBody(RefreshTokenBodySchema), async (c) => {
  const body = c.get('validatedBody') as RefreshTokenBody;

  // Verify the refresh token
  const result = await verifyToken(body.refreshToken, 'refresh');

  // Verify user still exists
  const repo = getUserRepository();
  const user = await repo.findById(result.userId);
  if (!user) {
    throw ApiError.unauthorized('User no longer exists');
  }

  // Generate new token pair
  const tokens = await generateTokens(user.id);

  return c.json({
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
  });
});

// ============================================================================
// POST /auth/logout
// ============================================================================

auth.post('/logout', async (c) => {
  // Stateless logout: client should discard tokens.
  // Server acknowledges the request.
  return c.json({ message: 'Logged out successfully' });
});

export { auth };
