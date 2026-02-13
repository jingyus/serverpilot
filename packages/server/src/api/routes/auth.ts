// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Authentication routes.
 *
 * Handles user login, registration, token refresh, and logout.
 * All auth endpoints are public (no JWT required).
 *
 * @module api/routes/auth
 */

import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { LoginBodySchema, RegisterBodySchema, RefreshTokenBodySchema, ChangePasswordBodySchema } from './schemas.js';
import { validateBody } from '../middleware/validate.js';
import { ApiError } from '../middleware/error-handler.js';
import { generateTokens, verifyToken, requireAuth } from '../middleware/auth.js';
import { getUserRepository } from '../../db/repositories/user-repository.js';
import { getDatabase } from '../../db/connection.js';
import { users } from '../../db/schema.js';
import { hashPassword, verifyPassword } from '../../utils/password.js';
import { ensureDefaultTenant } from '../../utils/auto-tenant.js';
import { logger } from '../../utils/logger.js';
import type { LoginBody, RegisterBody, RefreshTokenBody, ChangePasswordBody } from './schemas.js';
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

  // Open-source single-tenant mode: promote users appropriately.
  // First user becomes owner; subsequent users become admin
  // (in self-hosted mode, the operator controls who can register).
  try {
    const db = getDatabase();
    const userCount = db.select().from(users).limit(2).all().length;
    if (userCount <= 1) {
      db.update(users).set({ role: 'owner' }).where(eq(users.id, user.id)).run();
    } else {
      db.update(users).set({ role: 'admin' }).where(eq(users.id, user.id)).run();
    }
  } catch {
    // Database may not be available in unit tests using InMemoryUserRepository
  }

  // Auto-provision default tenant in single-tenant mode
  await ensureDefaultTenant(user.id, user.email);

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
// PUT /auth/password — Change password (authenticated)
// ============================================================================

auth.put('/password', requireAuth, validateBody(ChangePasswordBodySchema), async (c) => {
  const userId = c.get('userId');
  const body = c.get('validatedBody') as ChangePasswordBody;
  const repo = getUserRepository();

  // Find the authenticated user
  const user = await repo.findById(userId);
  if (!user) {
    throw ApiError.unauthorized('User not found');
  }

  // OAuth-only users cannot change password
  if (user.passwordHash.startsWith('oauth:')) {
    throw ApiError.badRequest('OAuth-only accounts cannot change password. Use your OAuth provider to manage credentials.');
  }

  // Verify current password
  const currentValid = await verifyPassword(body.currentPassword, user.passwordHash);
  if (!currentValid) {
    throw ApiError.badRequest('Current password is incorrect');
  }

  // Hash and persist the new password
  const newHash = await hashPassword(body.newPassword);
  const updated = await repo.updatePasswordHash(userId, newHash);
  if (!updated) {
    throw ApiError.internal('Failed to update password');
  }

  logger.info(
    { operation: 'password_change', userId },
    'User password changed successfully',
  );

  return c.json({ message: 'Password changed successfully' });
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
