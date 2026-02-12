// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for RBAC types, permission matrix, and helper functions.
 */

import { describe, it, expect } from 'vitest';
import {
  ROLES,
  PERMISSIONS,
  ROLE_PERMISSIONS,
  hasPermission,
  hasMinRole,
  isValidRole,
  type UserRole,
  type Permission,
} from './rbac.js';

// ============================================================================
// Role Definitions
// ============================================================================

describe('ROLES', () => {
  it('should define exactly 3 roles', () => {
    expect(ROLES).toHaveLength(3);
  });

  it('should include owner, admin, member in privilege order', () => {
    expect(ROLES).toEqual(['owner', 'admin', 'member']);
  });
});

// ============================================================================
// Permission Definitions
// ============================================================================

describe('PERMISSIONS', () => {
  it('should have at least 30 permissions', () => {
    expect(PERMISSIONS.length).toBeGreaterThanOrEqual(30);
  });

  it('should include key server permissions', () => {
    expect(PERMISSIONS).toContain('server:create');
    expect(PERMISSIONS).toContain('server:read');
    expect(PERMISSIONS).toContain('server:update');
    expect(PERMISSIONS).toContain('server:delete');
  });

  it('should include member management permissions', () => {
    expect(PERMISSIONS).toContain('member:invite');
    expect(PERMISSIONS).toContain('member:read');
    expect(PERMISSIONS).toContain('member:update-role');
    expect(PERMISSIONS).toContain('member:remove');
  });

  it('should include tenant management permissions', () => {
    expect(PERMISSIONS).toContain('tenant:read');
    expect(PERMISSIONS).toContain('tenant:update');
    expect(PERMISSIONS).toContain('tenant:delete');
  });

  it('should have no duplicate permissions', () => {
    const unique = new Set(PERMISSIONS);
    expect(unique.size).toBe(PERMISSIONS.length);
  });
});

// ============================================================================
// Permission Matrix
// ============================================================================

describe('ROLE_PERMISSIONS', () => {
  it('should define permissions for all 3 roles', () => {
    expect(Object.keys(ROLE_PERMISSIONS)).toHaveLength(3);
    expect(ROLE_PERMISSIONS).toHaveProperty('owner');
    expect(ROLE_PERMISSIONS).toHaveProperty('admin');
    expect(ROLE_PERMISSIONS).toHaveProperty('member');
  });

  it('owner should have all permissions', () => {
    for (const perm of PERMISSIONS) {
      expect(ROLE_PERMISSIONS.owner).toContain(perm);
    }
  });

  it('admin should have more permissions than member', () => {
    expect(ROLE_PERMISSIONS.admin.length).toBeGreaterThan(
      ROLE_PERMISSIONS.member.length,
    );
  });

  it('owner should have more permissions than admin', () => {
    expect(ROLE_PERMISSIONS.owner.length).toBeGreaterThan(
      ROLE_PERMISSIONS.admin.length,
    );
  });

  it('member should only have read/view permissions, chat, and skill:execute', () => {
    const allowedNonRead = new Set(['chat:use', 'skill:execute']);
    for (const perm of ROLE_PERMISSIONS.member) {
      const isReadOrView = perm.endsWith(':read') || perm.endsWith(':view') || allowedNonRead.has(perm);
      expect(isReadOrView).toBe(true);
    }
  });

  it('admin should NOT have member:update-role', () => {
    expect(ROLE_PERMISSIONS.admin).not.toContain('member:update-role');
  });

  it('admin should NOT have tenant:delete', () => {
    expect(ROLE_PERMISSIONS.admin).not.toContain('tenant:delete');
  });

  it('owner should have member:update-role', () => {
    expect(ROLE_PERMISSIONS.owner).toContain('member:update-role');
  });

  it('member should have skill:view and skill:execute', () => {
    expect(ROLE_PERMISSIONS.member).toContain('skill:view');
    expect(ROLE_PERMISSIONS.member).toContain('skill:execute');
    expect(ROLE_PERMISSIONS.member).not.toContain('skill:manage');
  });

  it('admin should have all skill permissions via inheritance', () => {
    expect(ROLE_PERMISSIONS.admin).toContain('skill:view');
    expect(ROLE_PERMISSIONS.admin).toContain('skill:execute');
    expect(ROLE_PERMISSIONS.admin).toContain('skill:manage');
  });

  it('owner should have all skill permissions', () => {
    expect(ROLE_PERMISSIONS.owner).toContain('skill:view');
    expect(ROLE_PERMISSIONS.owner).toContain('skill:execute');
    expect(ROLE_PERMISSIONS.owner).toContain('skill:manage');
  });
});

// ============================================================================
// hasPermission
// ============================================================================

describe('hasPermission', () => {
  it('owner has all permissions', () => {
    expect(hasPermission('owner', 'server:create')).toBe(true);
    expect(hasPermission('owner', 'server:delete')).toBe(true);
    expect(hasPermission('owner', 'member:update-role')).toBe(true);
    expect(hasPermission('owner', 'tenant:delete')).toBe(true);
  });

  it('admin has server CRUD but not member:update-role', () => {
    expect(hasPermission('admin', 'server:create')).toBe(true);
    expect(hasPermission('admin', 'server:read')).toBe(true);
    expect(hasPermission('admin', 'server:update')).toBe(true);
    expect(hasPermission('admin', 'server:delete')).toBe(true);
    expect(hasPermission('admin', 'member:update-role')).toBe(false);
  });

  it('member has read permissions, chat, and skill:execute', () => {
    expect(hasPermission('member', 'server:read')).toBe(true);
    expect(hasPermission('member', 'chat:use')).toBe(true);
    expect(hasPermission('member', 'skill:view')).toBe(true);
    expect(hasPermission('member', 'skill:execute')).toBe(true);
    expect(hasPermission('member', 'skill:manage')).toBe(false);
    expect(hasPermission('member', 'server:create')).toBe(false);
    expect(hasPermission('member', 'server:delete')).toBe(false);
    expect(hasPermission('member', 'member:invite')).toBe(false);
  });
});

// ============================================================================
// hasMinRole
// ============================================================================

describe('hasMinRole', () => {
  it('owner meets all minimum role requirements', () => {
    expect(hasMinRole('owner', 'owner')).toBe(true);
    expect(hasMinRole('owner', 'admin')).toBe(true);
    expect(hasMinRole('owner', 'member')).toBe(true);
  });

  it('admin meets admin and member requirements', () => {
    expect(hasMinRole('admin', 'owner')).toBe(false);
    expect(hasMinRole('admin', 'admin')).toBe(true);
    expect(hasMinRole('admin', 'member')).toBe(true);
  });

  it('member only meets member requirement', () => {
    expect(hasMinRole('member', 'owner')).toBe(false);
    expect(hasMinRole('member', 'admin')).toBe(false);
    expect(hasMinRole('member', 'member')).toBe(true);
  });
});

// ============================================================================
// isValidRole
// ============================================================================

describe('isValidRole', () => {
  it('recognizes valid roles', () => {
    expect(isValidRole('owner')).toBe(true);
    expect(isValidRole('admin')).toBe(true);
    expect(isValidRole('member')).toBe(true);
  });

  it('rejects invalid roles', () => {
    expect(isValidRole('superadmin')).toBe(false);
    expect(isValidRole('')).toBe(false);
    expect(isValidRole('OWNER')).toBe(false);
    expect(isValidRole('viewer')).toBe(false);
  });
});
