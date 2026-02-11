// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Team member management routes.
 *
 * Provides endpoints for listing members, updating roles,
 * and removing members from a tenant.
 *
 * @module api/routes/members
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { resolveRole, requirePermission } from '../middleware/rbac.js';
import { validateBody } from '../middleware/validate.js';
import { ApiError } from '../middleware/error-handler.js';
import { getRbacRepository } from '../../db/repositories/rbac-repository.js';
import { getUserRepository } from '../../db/repositories/user-repository.js';
import { logger } from '../../utils/logger.js';
import type { UserRole } from '@aiinstaller/shared';
import type { ApiEnv } from './types.js';

// ============================================================================
// Schemas
// ============================================================================

const UpdateRoleBodySchema = z.object({
  role: z.enum(['admin', 'member']),
});
type UpdateRoleBody = z.infer<typeof UpdateRoleBodySchema>;

const membersRoute = new Hono<ApiEnv>();

membersRoute.use('*', requireAuth, resolveRole);

// ============================================================================
// GET /members — List tenant members
// ============================================================================

membersRoute.get('/', requirePermission('member:read'), async (c) => {
  const tenantId = c.get('tenantId');
  if (!tenantId) {
    return c.json({ members: [], total: 0 });
  }

  const repo = getRbacRepository();
  const members = await repo.listTenantMembers(tenantId);

  return c.json({ members, total: members.length });
});

// ============================================================================
// PATCH /members/:userId/role — Update a member's role
// ============================================================================

membersRoute.patch(
  '/:userId/role',
  requirePermission('member:update-role'),
  validateBody(UpdateRoleBodySchema),
  async (c) => {
    const currentUserId = c.get('userId');
    const tenantId = c.get('tenantId');
    const { userId: targetUserId } = c.req.param();
    const body = c.get('validatedBody') as UpdateRoleBody;

    if (!tenantId) {
      throw ApiError.badRequest('No tenant context');
    }

    // Cannot change own role
    if (currentUserId === targetUserId) {
      throw ApiError.badRequest('Cannot change your own role');
    }

    // Verify target user exists and belongs to tenant
    const userRepo = getUserRepository();
    const targetUser = await userRepo.findById(targetUserId);
    if (!targetUser || targetUser.tenantId !== tenantId) {
      throw ApiError.notFound('Member');
    }

    // Cannot change owner's role
    if (targetUser.role === 'owner') {
      throw ApiError.forbidden('Cannot change tenant owner role');
    }

    const repo = getRbacRepository();
    const success = await repo.updateUserRole({
      userId: targetUserId,
      tenantId,
      role: body.role as UserRole,
    });

    if (!success) {
      throw ApiError.notFound('Member');
    }

    logger.info(
      { operation: 'member_role_update', targetUserId, role: body.role, tenantId, userId: currentUserId },
      `Member role updated to ${body.role}`,
    );

    return c.json({ success: true, role: body.role });
  },
);

// ============================================================================
// DELETE /members/:userId — Remove a member from tenant
// ============================================================================

membersRoute.delete('/:userId', requirePermission('member:remove'), async (c) => {
  const currentUserId = c.get('userId');
  const tenantId = c.get('tenantId');
  const { userId: targetUserId } = c.req.param();

  if (!tenantId) {
    throw ApiError.badRequest('No tenant context');
  }

  // Cannot remove self
  if (currentUserId === targetUserId) {
    throw ApiError.badRequest('Cannot remove yourself');
  }

  // Verify target user exists and belongs to tenant
  const userRepo = getUserRepository();
  const targetUser = await userRepo.findById(targetUserId);
  if (!targetUser || targetUser.tenantId !== tenantId) {
    throw ApiError.notFound('Member');
  }

  // Cannot remove owner
  if (targetUser.role === 'owner') {
    throw ApiError.forbidden('Cannot remove tenant owner');
  }

  // Only owner can remove admin, admin can remove member
  const currentRole = c.get('userRole');
  if (targetUser.role === 'admin' && currentRole !== 'owner') {
    throw ApiError.forbidden('Only owner can remove admins');
  }

  // Remove user from tenant (set tenantId to null, role to member)
  const repo = getRbacRepository();
  await repo.updateUserRole({
    userId: targetUserId,
    tenantId,
    role: 'member',
  });

  logger.info(
    { operation: 'member_remove', targetUserId, tenantId, userId: currentUserId },
    'Member removed from tenant',
  );

  return c.json({ success: true });
});

export { membersRoute };
