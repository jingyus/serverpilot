// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * RBAC (Role-Based Access Control) middleware for Hono REST API.
 *
 * Provides middleware factories that check the authenticated user's
 * role against required permissions or minimum role levels.
 *
 * Must be used AFTER `requireAuth` middleware (depends on `userId` in context).
 *
 * @module api/middleware/rbac
 */

import type { Context, Next } from 'hono';
import type { UserRole, Permission } from '@aiinstaller/shared';
import { hasPermission, hasMinRole } from '@aiinstaller/shared';
import { ApiError } from './error-handler.js';
import { getRbacRepository } from '../../db/repositories/rbac-repository.js';
import type { ApiEnv } from '../routes/types.js';

/**
 * Middleware that resolves the user's role and stores it in context.
 *
 * Must run after `requireAuth`. Sets `userRole` in context for
 * downstream middleware and route handlers.
 */
export async function resolveRole(c: Context<ApiEnv>, next: Next): Promise<void> {
  const userId = c.get('userId');
  const repo = getRbacRepository();
  const role = await repo.getUserRole(userId);
  c.set('userRole', role);
  await next();
}

/**
 * Create middleware that requires the user to have a minimum role level.
 *
 * Role hierarchy: owner > admin > member.
 * Must be used AFTER `resolveRole` middleware.
 *
 * @param minRole - The minimum role required to access the route
 *
 * @example
 * ```ts
 * servers.delete('/:id', requireRole('admin'), async (c) => { ... });
 * ```
 */
export function requireRole(minRole: UserRole) {
  return async (c: Context<ApiEnv>, next: Next): Promise<void> => {
    const userRole = c.get('userRole');

    if (!userRole) {
      throw ApiError.forbidden('Role not resolved');
    }

    if (!hasMinRole(userRole, minRole)) {
      throw ApiError.forbidden(
        `Requires ${minRole} role or higher`,
      );
    }

    await next();
  };
}

/**
 * Create middleware that requires the user to have a specific permission.
 *
 * Must be used AFTER `resolveRole` middleware.
 *
 * @param permission - The permission action required
 *
 * @example
 * ```ts
 * servers.post('/', requirePermission('server:create'), async (c) => { ... });
 * ```
 */
export function requirePermission(permission: Permission) {
  return async (c: Context<ApiEnv>, next: Next): Promise<void> => {
    const userRole = c.get('userRole');

    if (!userRole) {
      throw ApiError.forbidden('Role not resolved');
    }

    if (!hasPermission(userRole, permission)) {
      throw ApiError.forbidden(
        `Missing permission: ${permission}`,
      );
    }

    await next();
  };
}
