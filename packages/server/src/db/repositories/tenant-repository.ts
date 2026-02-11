// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tenant repository — data access layer for multi-tenant management.
 *
 * Provides CRUD operations for tenants and migration utilities
 * for converting single-tenant data to multi-tenant.
 *
 * @module db/repositories/tenant-repository
 */

import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';

import { getDatabase } from '../connection.js';
import { tenants, users, servers, operations, tasks, auditLogs, docSources } from '../schema.js';
import type { TenantPlan } from '../schema.js';
import type { DrizzleDB } from '../connection.js';

// ============================================================================
// Types
// ============================================================================

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  ownerId: string;
  plan: TenantPlan;
  maxServers: number;
  maxUsers: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTenantInput {
  name: string;
  slug: string;
  ownerId: string;
  plan?: TenantPlan;
  maxServers?: number;
  maxUsers?: number;
}

export interface UpdateTenantInput {
  name?: string;
  plan?: TenantPlan;
  maxServers?: number;
  maxUsers?: number;
}

// ============================================================================
// Repository Interface
// ============================================================================

export interface TenantRepository {
  findById(id: string): Promise<Tenant | null>;
  findBySlug(slug: string): Promise<Tenant | null>;
  findByOwnerId(ownerId: string): Promise<Tenant | null>;
  create(input: CreateTenantInput): Promise<Tenant>;
  update(id: string, input: UpdateTenantInput): Promise<Tenant | null>;
  delete(id: string): Promise<boolean>;
  /** Migrate a single user's data to a new default tenant */
  migrateUserToTenant(userId: string): Promise<Tenant>;
}

// ============================================================================
// Drizzle Implementation
// ============================================================================

export class DrizzleTenantRepository implements TenantRepository {
  constructor(private db: DrizzleDB) {}

  async findById(id: string): Promise<Tenant | null> {
    const rows = this.db
      .select()
      .from(tenants)
      .where(eq(tenants.id, id))
      .limit(1)
      .all();

    return rows[0] ? this.toTenant(rows[0]) : null;
  }

  async findBySlug(slug: string): Promise<Tenant | null> {
    const rows = this.db
      .select()
      .from(tenants)
      .where(eq(tenants.slug, slug))
      .limit(1)
      .all();

    return rows[0] ? this.toTenant(rows[0]) : null;
  }

  async findByOwnerId(ownerId: string): Promise<Tenant | null> {
    const rows = this.db
      .select()
      .from(tenants)
      .where(eq(tenants.ownerId, ownerId))
      .limit(1)
      .all();

    return rows[0] ? this.toTenant(rows[0]) : null;
  }

  async create(input: CreateTenantInput): Promise<Tenant> {
    const now = new Date();
    const id = randomUUID();

    this.db.insert(tenants).values({
      id,
      name: input.name,
      slug: input.slug,
      ownerId: input.ownerId,
      plan: input.plan ?? 'free',
      maxServers: input.maxServers ?? 5,
      maxUsers: input.maxUsers ?? 1,
      createdAt: now,
      updatedAt: now,
    }).run();

    return {
      id,
      name: input.name,
      slug: input.slug,
      ownerId: input.ownerId,
      plan: input.plan ?? 'free',
      maxServers: input.maxServers ?? 5,
      maxUsers: input.maxUsers ?? 1,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
  }

  async update(id: string, input: UpdateTenantInput): Promise<Tenant | null> {
    const existing = await this.findById(id);
    if (!existing) return null;

    const now = new Date();
    const updates: Record<string, unknown> = { updatedAt: now };
    if (input.name !== undefined) updates.name = input.name;
    if (input.plan !== undefined) updates.plan = input.plan;
    if (input.maxServers !== undefined) updates.maxServers = input.maxServers;
    if (input.maxUsers !== undefined) updates.maxUsers = input.maxUsers;

    this.db
      .update(tenants)
      .set(updates)
      .where(eq(tenants.id, id))
      .run();

    return this.findById(id);
  }

  async delete(id: string): Promise<boolean> {
    const existing = await this.findById(id);
    if (!existing) return false;

    this.db.delete(tenants).where(eq(tenants.id, id)).run();
    return true;
  }

  async migrateUserToTenant(userId: string): Promise<Tenant> {
    // Check if user already has a tenant
    const userRows = this.db
      .select({ tenantId: users.tenantId, email: users.email })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
      .all();

    if (userRows.length === 0) {
      throw new Error(`User ${userId} not found`);
    }

    if (userRows[0].tenantId) {
      const existing = await this.findById(userRows[0].tenantId);
      if (existing) return existing;
    }

    // Create a default tenant for this user
    const slug = `user-${userId.slice(0, 8)}`;
    const emailPrefix = userRows[0].email.split('@')[0];
    const tenant = await this.create({
      name: `${emailPrefix}'s workspace`,
      slug,
      ownerId: userId,
    });

    // Assign user to tenant
    this.db
      .update(users)
      .set({ tenantId: tenant.id })
      .where(eq(users.id, userId))
      .run();

    // Assign all user's servers to tenant
    this.db
      .update(servers)
      .set({ tenantId: tenant.id })
      .where(eq(servers.userId, userId))
      .run();

    // Assign all user's operations to tenant
    this.db
      .update(operations)
      .set({ tenantId: tenant.id })
      .where(eq(operations.userId, userId))
      .run();

    // Assign all user's tasks to tenant
    this.db
      .update(tasks)
      .set({ tenantId: tenant.id })
      .where(eq(tasks.userId, userId))
      .run();

    // Assign all user's audit logs to tenant
    this.db
      .update(auditLogs)
      .set({ tenantId: tenant.id })
      .where(eq(auditLogs.userId, userId))
      .run();

    // Assign all user's doc sources to tenant
    this.db
      .update(docSources)
      .set({ tenantId: tenant.id })
      .where(eq(docSources.userId, userId))
      .run();

    return tenant;
  }

  private toTenant(row: typeof tenants.$inferSelect): Tenant {
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      ownerId: row.ownerId,
      plan: row.plan as TenantPlan,
      maxServers: row.maxServers,
      maxUsers: row.maxUsers,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

// ============================================================================
// In-Memory Implementation (for testing)
// ============================================================================

export class InMemoryTenantRepository implements TenantRepository {
  private tenants = new Map<string, Tenant>();

  async findById(id: string): Promise<Tenant | null> {
    return this.tenants.get(id) ?? null;
  }

  async findBySlug(slug: string): Promise<Tenant | null> {
    return [...this.tenants.values()].find((t) => t.slug === slug) ?? null;
  }

  async findByOwnerId(ownerId: string): Promise<Tenant | null> {
    return [...this.tenants.values()].find((t) => t.ownerId === ownerId) ?? null;
  }

  async create(input: CreateTenantInput): Promise<Tenant> {
    const now = new Date().toISOString();
    const tenant: Tenant = {
      id: randomUUID(),
      name: input.name,
      slug: input.slug,
      ownerId: input.ownerId,
      plan: input.plan ?? 'free',
      maxServers: input.maxServers ?? 5,
      maxUsers: input.maxUsers ?? 1,
      createdAt: now,
      updatedAt: now,
    };
    this.tenants.set(tenant.id, tenant);
    return tenant;
  }

  async update(id: string, input: UpdateTenantInput): Promise<Tenant | null> {
    const tenant = this.tenants.get(id);
    if (!tenant) return null;

    if (input.name !== undefined) tenant.name = input.name;
    if (input.plan !== undefined) tenant.plan = input.plan;
    if (input.maxServers !== undefined) tenant.maxServers = input.maxServers;
    if (input.maxUsers !== undefined) tenant.maxUsers = input.maxUsers;
    tenant.updatedAt = new Date().toISOString();

    this.tenants.set(id, tenant);
    return tenant;
  }

  async delete(id: string): Promise<boolean> {
    return this.tenants.delete(id);
  }

  async migrateUserToTenant(userId: string): Promise<Tenant> {
    const existing = [...this.tenants.values()].find((t) => t.ownerId === userId);
    if (existing) return existing;

    return this.create({
      name: `User ${userId}'s workspace`,
      slug: `user-${userId.slice(0, 8)}`,
      ownerId: userId,
    });
  }

  clear(): void {
    this.tenants.clear();
  }
}

// ============================================================================
// Singleton
// ============================================================================

let _repository: TenantRepository | null = null;

export function getTenantRepository(): TenantRepository {
  if (!_repository) {
    _repository = new DrizzleTenantRepository(getDatabase());
  }
  return _repository;
}

export function setTenantRepository(repo: TenantRepository): void {
  _repository = repo;
}

export function _resetTenantRepository(): void {
  _repository = null;
}
