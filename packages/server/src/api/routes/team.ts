// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Team invitation and member management routes.
 *
 * Provides endpoints for inviting members, accepting invitations,
 * listing/managing invitations, and team member CRUD.
 *
 * @module api/routes/team
 */

import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth.js';
import { resolveRole, requirePermission } from '../middleware/rbac.js';
import { requireTenant } from '../middleware/tenant.js';
import { validateBody } from '../middleware/validate.js';
import { ApiError } from '../middleware/error-handler.js';
import { generateTokens } from '../middleware/auth.js';
import { getInvitationRepository } from '../../db/repositories/invitation-repository.js';
import { getUserRepository } from '../../db/repositories/user-repository.js';
import { getRbacRepository } from '../../db/repositories/rbac-repository.js';
import { hashPassword } from '../../utils/password.js';
import { logger } from '../../utils/logger.js';
import {
  CreateInvitationBodySchema,
  AcceptInvitationBodySchema,
} from './schemas.js';
import type { CreateInvitationBody, AcceptInvitationBody } from './schemas.js';
import type { ApiEnv } from './types.js';

const teamRoute = new Hono<ApiEnv>();

// ============================================================================
// Authenticated routes (require auth + tenant + role)
// ============================================================================

const authenticated = new Hono<ApiEnv>();
authenticated.use('*', requireAuth, requireTenant, resolveRole);

// ----------------------------------------------------------------------------
// POST /team/invite — Create invitation
// ----------------------------------------------------------------------------

authenticated.post(
  '/invite',
  requirePermission('member:invite'),
  validateBody(CreateInvitationBodySchema),
  async (c) => {
    const userId = c.get('userId');
    const tenantId = c.get('tenantId');
    const body = c.get('validatedBody') as CreateInvitationBody;

    if (!tenantId) {
      throw ApiError.badRequest('No tenant context');
    }

    // Cannot invite yourself
    const userRepo = getUserRepository();
    const currentUser = await userRepo.findById(userId);
    if (currentUser?.email === body.email) {
      throw ApiError.badRequest('Cannot invite yourself');
    }

    // Check if user is already a member of the tenant
    const existingUser = await userRepo.findByEmail(body.email);
    if (existingUser && existingUser.tenantId === tenantId) {
      throw ApiError.badRequest('User is already a member of this team');
    }

    // Check for existing pending invitation
    const invRepo = getInvitationRepository();
    const existingInv = await invRepo.findPendingByEmail(body.email, tenantId);
    if (existingInv) {
      throw ApiError.badRequest('A pending invitation already exists for this email');
    }

    const invitation = await invRepo.create({
      tenantId,
      email: body.email,
      role: body.role,
      invitedBy: userId,
    });

    logger.info(
      { operation: 'invitation_create', email: body.email, tenantId, userId },
      `Invitation created for ${body.email}`,
    );

    return c.json({ invitation }, 201);
  },
);

// ----------------------------------------------------------------------------
// GET /team/invitations — List tenant invitations
// ----------------------------------------------------------------------------

authenticated.get('/invitations', requirePermission('member:read'), async (c) => {
  const tenantId = c.get('tenantId');
  if (!tenantId) {
    return c.json({ invitations: [], total: 0 });
  }

  const invRepo = getInvitationRepository();
  const all = await invRepo.findByTenant(tenantId);

  // Auto-expire past-due invitations
  const now = Date.now();
  for (const inv of all) {
    if (inv.status === 'pending' && new Date(inv.expiresAt).getTime() < now) {
      await invRepo.updateStatus(inv.id, 'expired');
      inv.status = 'expired';
    }
  }

  return c.json({ invitations: all, total: all.length });
});

// ----------------------------------------------------------------------------
// DELETE /team/invitations/:id — Cancel (revoke) an invitation
// ----------------------------------------------------------------------------

authenticated.delete(
  '/invitations/:id',
  requirePermission('member:invite'),
  async (c) => {
    const tenantId = c.get('tenantId');
    const userId = c.get('userId');
    const { id } = c.req.param();

    if (!tenantId) {
      throw ApiError.badRequest('No tenant context');
    }

    const invRepo = getInvitationRepository();
    const inv = await invRepo.findById(id);

    if (!inv || inv.tenantId !== tenantId) {
      throw ApiError.notFound('Invitation');
    }

    if (inv.status !== 'pending') {
      throw ApiError.badRequest('Can only cancel pending invitations');
    }

    await invRepo.updateStatus(id, 'cancelled');

    logger.info(
      { operation: 'invitation_cancel', invitationId: id, tenantId, userId },
      'Invitation cancelled',
    );

    return c.json({ success: true });
  },
);

// ----------------------------------------------------------------------------
// GET /team/members — List tenant members (delegates to RBAC repo)
// ----------------------------------------------------------------------------

authenticated.get('/members', requirePermission('member:read'), async (c) => {
  const tenantId = c.get('tenantId');
  if (!tenantId) {
    return c.json({ members: [], total: 0 });
  }

  const repo = getRbacRepository();
  const members = await repo.listTenantMembers(tenantId);
  return c.json({ members, total: members.length });
});

// ----------------------------------------------------------------------------
// PUT /team/members/:id/role — Update member role
// ----------------------------------------------------------------------------

authenticated.put(
  '/members/:id/role',
  requirePermission('member:update-role'),
  async (c) => {
    const currentUserId = c.get('userId');
    const tenantId = c.get('tenantId');
    const { id: targetUserId } = c.req.param();

    if (!tenantId) {
      throw ApiError.badRequest('No tenant context');
    }

    let body: { role: string };
    try {
      body = await c.req.json();
    } catch {
      throw ApiError.badRequest('Invalid JSON');
    }

    if (!body.role || !['admin', 'member'].includes(body.role)) {
      throw ApiError.badRequest('Role must be "admin" or "member"');
    }

    if (currentUserId === targetUserId) {
      throw ApiError.badRequest('Cannot change your own role');
    }

    const userRepo = getUserRepository();
    const target = await userRepo.findById(targetUserId);
    if (!target || target.tenantId !== tenantId) {
      throw ApiError.notFound('Member');
    }

    if (target.role === 'owner') {
      throw ApiError.forbidden('Cannot change tenant owner role');
    }

    const rbacRepo = getRbacRepository();
    const success = await rbacRepo.updateUserRole({
      userId: targetUserId,
      tenantId,
      role: body.role as 'admin' | 'member',
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

// ----------------------------------------------------------------------------
// DELETE /team/members/:id — Remove member from tenant
// ----------------------------------------------------------------------------

authenticated.delete(
  '/members/:id',
  requirePermission('member:remove'),
  async (c) => {
    const currentUserId = c.get('userId');
    const tenantId = c.get('tenantId');
    const currentRole = c.get('userRole');
    const { id: targetUserId } = c.req.param();

    if (!tenantId) {
      throw ApiError.badRequest('No tenant context');
    }

    if (currentUserId === targetUserId) {
      throw ApiError.badRequest('Cannot remove yourself');
    }

    const userRepo = getUserRepository();
    const target = await userRepo.findById(targetUserId);
    if (!target || target.tenantId !== tenantId) {
      throw ApiError.notFound('Member');
    }

    if (target.role === 'owner') {
      throw ApiError.forbidden('Cannot remove tenant owner');
    }

    if (target.role === 'admin' && currentRole !== 'owner') {
      throw ApiError.forbidden('Only owner can remove admins');
    }

    const rbacRepo = getRbacRepository();
    await rbacRepo.updateUserRole({
      userId: targetUserId,
      tenantId,
      role: 'member',
    });

    logger.info(
      { operation: 'member_remove', targetUserId, tenantId, userId: currentUserId },
      'Member removed from tenant',
    );

    return c.json({ success: true });
  },
);

teamRoute.route('/', authenticated);

// ============================================================================
// Public routes (no auth required)
// ============================================================================

// ----------------------------------------------------------------------------
// GET /team/invite/:token — Get invitation details (for accept page)
// ----------------------------------------------------------------------------

teamRoute.get('/invite/:token', async (c) => {
  const { token } = c.req.param();

  const invRepo = getInvitationRepository();
  const inv = await invRepo.findByToken(token);

  if (!inv) {
    throw ApiError.notFound('Invitation');
  }

  if (inv.status !== 'pending') {
    throw ApiError.badRequest(`Invitation has been ${inv.status}`);
  }

  if (new Date(inv.expiresAt).getTime() < Date.now()) {
    await invRepo.updateStatus(inv.id, 'expired');
    throw ApiError.badRequest('Invitation has expired');
  }

  // Return limited info (no token in response)
  return c.json({
    invitation: {
      id: inv.id,
      email: inv.email,
      role: inv.role,
      expiresAt: inv.expiresAt,
    },
  });
});

// ----------------------------------------------------------------------------
// POST /team/invite/:token/accept — Accept invitation
// ----------------------------------------------------------------------------

teamRoute.post(
  '/invite/:token/accept',
  validateBody(AcceptInvitationBodySchema),
  async (c) => {
    const { token } = c.req.param();
    const body = c.get('validatedBody') as AcceptInvitationBody;

    const invRepo = getInvitationRepository();
    const inv = await invRepo.findByToken(token);

    if (!inv) {
      throw ApiError.notFound('Invitation');
    }

    if (inv.status !== 'pending') {
      throw ApiError.badRequest(`Invitation has been ${inv.status}`);
    }

    if (new Date(inv.expiresAt).getTime() < Date.now()) {
      await invRepo.updateStatus(inv.id, 'expired');
      throw ApiError.badRequest('Invitation has expired');
    }

    const userRepo = getUserRepository();

    // Check if user already exists
    let user = await userRepo.findByEmail(inv.email);

    if (user) {
      // Existing user — check if already in a tenant
      if (user.tenantId === inv.tenantId) {
        throw ApiError.badRequest('You are already a member of this team');
      }
      // Assign user to tenant with invited role
      const rbacRepo = getRbacRepository();
      await rbacRepo.updateUserRole({
        userId: user.id,
        tenantId: inv.tenantId,
        role: inv.role,
      });
    } else {
      // New user — create account
      const passwordHash = await hashPassword(body.password);
      user = await userRepo.create({
        email: inv.email,
        passwordHash,
        name: body.name,
      });

      // Set tenant and role
      const rbacRepo = getRbacRepository();
      await rbacRepo.updateUserRole({
        userId: user.id,
        tenantId: inv.tenantId,
        role: inv.role,
      });
    }

    // Mark invitation as accepted
    await invRepo.markAccepted(inv.id);

    // Generate tokens for the user
    const tokens = await generateTokens(user.id);

    logger.info(
      { operation: 'invitation_accept', email: inv.email, tenantId: inv.tenantId, userId: user.id },
      `Invitation accepted by ${inv.email}`,
    );

    return c.json({
      user: { id: user.id, email: user.email, name: user.name },
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    });
  },
);

export { teamRoute };
