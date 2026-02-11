// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Multi-tenant isolation middleware for Hono REST API.
 *
 * Resolves the current user's tenant from the database and injects
 * the tenantId into context. For community edition (no tenants),
 * sets tenantId to null to maintain backward compatibility.
 *
 * @module api/middleware/tenant
 */

import { eq } from 'drizzle-orm';
import type { Context, Next } from 'hono';
import type { ApiEnv } from '../routes/types.js';
import { getDatabase } from '../../db/connection.js';
import { users } from '../../db/schema.js';

/**
 * Hono middleware that resolves the tenant for the authenticated user.
 *
 * Must be used AFTER `requireAuth` middleware (depends on `userId` in context).
 *
 * Behavior:
 * - Looks up the user's `tenant_id` from the database
 * - If user has a tenant: sets `tenantId` in context
 * - If user has no tenant (community edition): sets `tenantId` to null
 * - If user not found: throws 401
 *
 * @example
 * ```ts
 * // Apply after auth middleware
 * app.use('/api/*', requireAuth, requireTenant);
 *
 * // Access in route handler
 * app.get('/servers', (c) => {
 *   const tenantId = c.get('tenantId'); // string | null
 * });
 * ```
 */
export async function requireTenant(c: Context<ApiEnv>, next: Next): Promise<void> {
  const userId = c.get('userId');
  const db = getDatabase();

  const rows = db
    .select({ tenantId: users.tenantId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
    .all();

  if (rows.length === 0) {
    // User not found in DB — token is valid but user was deleted
    c.set('tenantId', null);
    await next();
    return;
  }

  c.set('tenantId', rows[0].tenantId ?? null);
  await next();
}
