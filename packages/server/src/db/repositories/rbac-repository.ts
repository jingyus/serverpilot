// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * RBAC repository — data access layer for role management.
 *
 * Handles querying and updating user roles within a tenant.
 *
 * @module db/repositories/rbac-repository
 */

import { eq, and } from 'drizzle-orm';
import { getDatabase } from '../connection.js';
import { users, tenants } from '../schema.js';
import type { DrizzleDB } from '../connection.js';
import type { UserRole } from '@aiinstaller/shared';

// ============================================================================
// Types
// ============================================================================

export interface TenantMember {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
  createdAt: string;
}

export interface UpdateRoleInput {
  userId: string;
  tenantId: string;
  role: UserRole;
}

// ============================================================================
// Repository Interface
// ============================================================================

export interface RbacRepository {
  /** Get a user's role (returns 'member' if not found). */
  getUserRole(userId: string): Promise<UserRole>;
  /** Update a user's role within a tenant. */
  updateUserRole(input: UpdateRoleInput): Promise<boolean>;
  /** List all members of a tenant. */
  listTenantMembers(tenantId: string): Promise<TenantMember[]>;
  /** Check if a user is the tenant owner. */
  isTenantOwner(userId: string, tenantId: string): Promise<boolean>;
}

// ============================================================================
// Drizzle Implementation
// ============================================================================

export class DrizzleRbacRepository implements RbacRepository {
  constructor(private db: DrizzleDB) {}

  async getUserRole(userId: string): Promise<UserRole> {
    const rows = this.db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
      .all();

    return (rows[0]?.role as UserRole) ?? 'member';
  }

  async updateUserRole(input: UpdateRoleInput): Promise<boolean> {
    // Verify user belongs to the tenant
    const rows = this.db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, input.userId), eq(users.tenantId, input.tenantId)))
      .limit(1)
      .all();

    if (rows.length === 0) return false;

    this.db
      .update(users)
      .set({ role: input.role, updatedAt: new Date() })
      .where(eq(users.id, input.userId))
      .run();

    return true;
  }

  async listTenantMembers(tenantId: string): Promise<TenantMember[]> {
    const rows = this.db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        role: users.role,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.tenantId, tenantId))
      .all();

    return rows.map((row) => ({
      id: row.id,
      email: row.email,
      name: row.name,
      role: (row.role ?? 'member') as UserRole,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async isTenantOwner(userId: string, tenantId: string): Promise<boolean> {
    const rows = this.db
      .select({ ownerId: tenants.ownerId })
      .from(tenants)
      .where(and(eq(tenants.id, tenantId), eq(tenants.ownerId, userId)))
      .limit(1)
      .all();

    return rows.length > 0;
  }
}

// ============================================================================
// In-Memory Implementation (for testing)
// ============================================================================

export class InMemoryRbacRepository implements RbacRepository {
  private roles = new Map<string, UserRole>();
  private membersByTenant = new Map<string, TenantMember[]>();
  private tenantOwners = new Map<string, string>();

  async getUserRole(userId: string): Promise<UserRole> {
    return this.roles.get(userId) ?? 'member';
  }

  async updateUserRole(input: UpdateRoleInput): Promise<boolean> {
    this.roles.set(input.userId, input.role);
    const members = this.membersByTenant.get(input.tenantId);
    if (members) {
      const member = members.find((m) => m.id === input.userId);
      if (member) member.role = input.role;
    }
    return true;
  }

  async listTenantMembers(tenantId: string): Promise<TenantMember[]> {
    return this.membersByTenant.get(tenantId) ?? [];
  }

  async isTenantOwner(userId: string, tenantId: string): Promise<boolean> {
    return this.tenantOwners.get(tenantId) === userId;
  }

  // Test helpers
  setRole(userId: string, role: UserRole): void {
    this.roles.set(userId, role);
  }

  setTenantMembers(tenantId: string, members: TenantMember[]): void {
    this.membersByTenant.set(tenantId, members);
    for (const m of members) {
      this.roles.set(m.id, m.role);
    }
  }

  setTenantOwner(tenantId: string, ownerId: string): void {
    this.tenantOwners.set(tenantId, ownerId);
  }

  clear(): void {
    this.roles.clear();
    this.membersByTenant.clear();
    this.tenantOwners.clear();
  }
}

// ============================================================================
// Singleton
// ============================================================================

let _repository: RbacRepository | null = null;

export function getRbacRepository(): RbacRepository {
  if (!_repository) {
    _repository = new DrizzleRbacRepository(getDatabase());
  }
  return _repository;
}

export function setRbacRepository(repo: RbacRepository): void {
  _repository = repo;
}

export function _resetRbacRepository(): void {
  _repository = null;
}
