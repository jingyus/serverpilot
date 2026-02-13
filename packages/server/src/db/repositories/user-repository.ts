// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * User repository — data access layer for user management.
 *
 * Defines the repository interface and provides both an in-memory
 * implementation (for testing) and a Drizzle ORM implementation
 * for production use.
 *
 * @module db/repositories/user-repository
 */

import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';

import { getDatabase } from '../connection.js';
import { users } from '../schema.js';

import type { DrizzleDB } from '../connection.js';
import type { UserRole } from '@aiinstaller/shared';

// ============================================================================
// Types
// ============================================================================

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  name: string | null;
  timezone: string | null;
  tenantId: string | null;
  role: UserRole;
  createdAt: string;
  updatedAt: string;
}

export interface CreateUserInput {
  email: string;
  passwordHash: string;
  name: string;
}

export interface UpdateUserInput {
  name?: string;
  timezone?: string;
}

// ============================================================================
// Repository Interface
// ============================================================================

export interface UserRepository {
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  create(input: CreateUserInput): Promise<User>;
  update(id: string, input: UpdateUserInput): Promise<User | null>;
  updatePasswordHash(id: string, passwordHash: string): Promise<boolean>;
  delete(id: string): Promise<boolean>;
}

// ============================================================================
// Drizzle Implementation
// ============================================================================

export class DrizzleUserRepository implements UserRepository {
  constructor(private db: DrizzleDB) {}

  async findById(id: string): Promise<User | null> {
    const rows = this.db
      .select()
      .from(users)
      .where(eq(users.id, id))
      .limit(1)
      .all();

    return rows[0] ? this.toUser(rows[0]) : null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const rows = this.db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1)
      .all();

    return rows[0] ? this.toUser(rows[0]) : null;
  }

  async create(input: CreateUserInput): Promise<User> {
    const now = new Date();
    const id = randomUUID();

    this.db.insert(users).values({
      id,
      email: input.email,
      passwordHash: input.passwordHash,
      name: input.name,
      createdAt: now,
      updatedAt: now,
    }).run();

    return {
      id,
      email: input.email,
      passwordHash: input.passwordHash,
      name: input.name,
      timezone: 'UTC',
      tenantId: null,
      role: 'member',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
  }

  async update(id: string, input: UpdateUserInput): Promise<User | null> {
    const existing = await this.findById(id);
    if (!existing) return null;

    const now = new Date();
    const updates: Record<string, unknown> = { updatedAt: now };
    if (input.name !== undefined) updates.name = input.name;
    if (input.timezone !== undefined) updates.timezone = input.timezone;

    this.db
      .update(users)
      .set(updates)
      .where(eq(users.id, id))
      .run();

    return this.findById(id);
  }

  async updatePasswordHash(id: string, passwordHash: string): Promise<boolean> {
    const existing = await this.findById(id);
    if (!existing) return false;

    this.db
      .update(users)
      .set({ passwordHash, updatedAt: new Date() })
      .where(eq(users.id, id))
      .run();

    return true;
  }

  async delete(id: string): Promise<boolean> {
    const existing = await this.findById(id);
    if (!existing) return false;

    this.db.delete(users).where(eq(users.id, id)).run();
    return true;
  }

  private toUser(row: typeof users.$inferSelect): User {
    return {
      id: row.id,
      email: row.email,
      passwordHash: row.passwordHash,
      name: row.name,
      timezone: row.timezone,
      tenantId: row.tenantId ?? null,
      role: (row.role ?? 'member') as UserRole,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

// ============================================================================
// In-Memory Implementation (for testing)
// ============================================================================

export class InMemoryUserRepository implements UserRepository {
  private users = new Map<string, User>();

  async findById(id: string): Promise<User | null> {
    return this.users.get(id) ?? null;
  }

  async findByEmail(email: string): Promise<User | null> {
    for (const user of this.users.values()) {
      if (user.email === email) return user;
    }
    return null;
  }

  async create(input: CreateUserInput): Promise<User> {
    const now = new Date().toISOString();
    const user: User = {
      id: randomUUID(),
      email: input.email,
      passwordHash: input.passwordHash,
      name: input.name,
      timezone: 'UTC',
      tenantId: null,
      role: 'member',
      createdAt: now,
      updatedAt: now,
    };
    this.users.set(user.id, user);
    return user;
  }

  async update(id: string, input: UpdateUserInput): Promise<User | null> {
    const user = this.users.get(id);
    if (!user) return null;

    if (input.name !== undefined) user.name = input.name;
    if (input.timezone !== undefined) user.timezone = input.timezone;
    user.updatedAt = new Date().toISOString();

    this.users.set(id, user);
    return user;
  }

  async updatePasswordHash(id: string, passwordHash: string): Promise<boolean> {
    const user = this.users.get(id);
    if (!user) return false;

    user.passwordHash = passwordHash;
    user.updatedAt = new Date().toISOString();
    this.users.set(id, user);
    return true;
  }

  async delete(id: string): Promise<boolean> {
    return this.users.delete(id);
  }

  clear(): void {
    this.users.clear();
  }
}

// ============================================================================
// Singleton
// ============================================================================

let _repository: UserRepository | null = null;

export function getUserRepository(): UserRepository {
  if (!_repository) {
    _repository = new DrizzleUserRepository(getDatabase());
  }
  return _repository;
}

export function setUserRepository(repo: UserRepository): void {
  _repository = repo;
}

/** Reset to default (for testing). */
export function _resetUserRepository(): void {
  _repository = null;
}
