// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * RBAC (Role-Based Access Control) types and permission matrix.
 *
 * Single source of truth for role definitions, permission actions,
 * and the role-permission mapping used across server and dashboard.
 *
 * @module rbac
 */

// ============================================================================
// Role Definitions
// ============================================================================

/** Available user roles, ordered by privilege level (highest first). */
export const ROLES = ["owner", "admin", "member"] as const;

/** A user role within a tenant. */
export type UserRole = (typeof ROLES)[number];

// ============================================================================
// Permission Actions
// ============================================================================

/** All permission actions available in the system. */
export const PERMISSIONS = [
  // Server management
  "server:create",
  "server:read",
  "server:update",
  "server:delete",

  // Operations & tasks
  "operation:read",
  "operation:create",
  "task:create",
  "task:read",
  "task:update",
  "task:delete",

  // Chat / AI
  "chat:use",

  // Command approvals
  "command:approve",

  // Alert rules
  "alert-rule:create",
  "alert-rule:read",
  "alert-rule:update",
  "alert-rule:delete",

  // Alerts (read-only for most)
  "alert:read",

  // Webhooks
  "webhook:create",
  "webhook:read",
  "webhook:update",
  "webhook:delete",

  // Settings
  "settings:read",
  "settings:update",

  // Audit log
  "audit-log:read",
  "audit-log:export",

  // Knowledge & doc sources
  "knowledge:read",
  "knowledge:create",
  "doc-source:create",
  "doc-source:read",
  "doc-source:update",
  "doc-source:delete",

  // Metrics & snapshots
  "metrics:read",
  "snapshot:read",
  "snapshot:create",

  // Member management
  "member:invite",
  "member:read",
  "member:update-role",
  "member:remove",

  // Skills
  "skill:view",
  "skill:execute",
  "skill:manage",

  // Tenant management
  "tenant:read",
  "tenant:update",
  "tenant:delete",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

// ============================================================================
// Permission Matrix
// ============================================================================

/**
 * Permission matrix mapping each role to its allowed actions.
 *
 * Roles are cumulative: member < admin < owner.
 */
const MEMBER_PERMISSIONS: readonly Permission[] = [
  "server:read",
  "operation:read",
  "task:read",
  "chat:use",
  "command:approve",
  "alert-rule:read",
  "alert:read",
  "webhook:read",
  "settings:read",
  "audit-log:read",
  "knowledge:read",
  "doc-source:read",
  "metrics:read",
  "snapshot:read",
  "skill:view",
  "skill:execute",
  "member:read",
  "tenant:read",
];

const ADMIN_PERMISSIONS: readonly Permission[] = [
  ...MEMBER_PERMISSIONS,
  "server:create",
  "server:update",
  "server:delete",
  "operation:create",
  "task:create",
  "task:update",
  "task:delete",
  "alert-rule:create",
  "alert-rule:update",
  "alert-rule:delete",
  "webhook:create",
  "webhook:update",
  "webhook:delete",
  "settings:update",
  "audit-log:export",
  "knowledge:create",
  "doc-source:create",
  "doc-source:update",
  "doc-source:delete",
  "snapshot:create",
  "skill:manage",
  "member:invite",
  "member:remove",
];

const OWNER_PERMISSIONS: readonly Permission[] = [
  ...ADMIN_PERMISSIONS,
  "member:update-role",
  "tenant:update",
  "tenant:delete",
];

export const ROLE_PERMISSIONS: Record<UserRole, readonly Permission[]> = {
  owner: OWNER_PERMISSIONS,
  admin: ADMIN_PERMISSIONS,
  member: MEMBER_PERMISSIONS,
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check whether a given role has a specific permission.
 */
export function hasPermission(role: UserRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

/**
 * Check whether `role` is at least as privileged as `minRole`.
 *
 * Privilege order: owner > admin > member.
 */
export function hasMinRole(role: UserRole, minRole: UserRole): boolean {
  const idx = ROLES.indexOf(role);
  const minIdx = ROLES.indexOf(minRole);
  // Lower index = higher privilege (owner=0, admin=1, member=2)
  return idx <= minIdx;
}

/**
 * Check if a role string is a valid UserRole.
 */
export function isValidRole(role: string): role is UserRole {
  return ROLES.includes(role as UserRole);
}
