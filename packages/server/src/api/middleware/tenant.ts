// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Multi-tenant isolation middleware for Hono REST API.
 *
 * Resolves the current user's tenant from the database and injects
 * the tenantId into context. In single-tenant mode (default, non-CLOUD_MODE),
 * auto-provisions a default tenant for users who don't have one yet.
 *
 * @module api/middleware/tenant
 */

import { eq } from 'drizzle-orm';
import type { Context, Next } from 'hono';
import type { ApiEnv } from '../routes/types.js';
import { getDatabase } from '../../db/connection.js';
import { users } from '../../db/schema.js';
import { ensureDefaultTenant } from '../../utils/auto-tenant.js';

/**
 * Hono middleware that resolves the tenant for the authenticated user.
 *
 * Must be used AFTER `requireAuth` middleware (depends on `userId` in context).
 *
 * Behavior:
 * - Looks up the user's `tenant_id` from the database
 * - If user has a tenant: sets `tenantId` in context
 * - If user has no tenant in single-tenant mode: auto-provisions one
 * - If user not found: sets `tenantId` to null
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
    .select({ tenantId: users.tenantId, email: users.email })
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

  let tenantId = rows[0].tenantId ?? null;

  // In single-tenant mode, auto-provision a default tenant for users
  // who registered before auto-tenant was enabled (migration safety net)
  if (!tenantId) {
    tenantId = await ensureDefaultTenant(userId, rows[0].email);
  }

  c.set('tenantId', tenantId);
  await next();
}
