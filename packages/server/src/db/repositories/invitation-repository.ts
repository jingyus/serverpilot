// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Invitation repository — data access layer for team invitations.
 *
 * Handles creating, querying, and updating invitation records.
 *
 * @module db/repositories/invitation-repository
 */

import { randomUUID, randomBytes } from 'node:crypto';
import { eq, and } from 'drizzle-orm';
import { getDatabase } from '../connection.js';
import { invitations } from '../schema.js';
import type { DrizzleDB } from '../connection.js';
import type { UserRole } from '@aiinstaller/shared';

// ============================================================================
// Types
// ============================================================================

export type InvitationStatus = 'pending' | 'accepted' | 'cancelled' | 'expired';

export interface Invitation {
  id: string;
  tenantId: string;
  email: string;
  role: 'admin' | 'member';
  token: string;
  status: InvitationStatus;
  invitedBy: string;
  expiresAt: string;
  acceptedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateInvitationInput {
  tenantId: string;
  email: string;
  role: 'admin' | 'member';
  invitedBy: string;
  expiresInDays?: number;
}

// ============================================================================
// Repository Interface
// ============================================================================

export interface InvitationRepository {
  create(input: CreateInvitationInput): Promise<Invitation>;
  findById(id: string): Promise<Invitation | null>;
  findByToken(token: string): Promise<Invitation | null>;
  findByTenant(tenantId: string): Promise<Invitation[]>;
  findPendingByEmail(email: string, tenantId: string): Promise<Invitation | null>;
  updateStatus(id: string, status: InvitationStatus): Promise<boolean>;
  markAccepted(id: string): Promise<boolean>;
  delete(id: string): Promise<boolean>;
}

// ============================================================================
// Drizzle Implementation
// ============================================================================

export class DrizzleInvitationRepository implements InvitationRepository {
  constructor(private db: DrizzleDB) {}

  async create(input: CreateInvitationInput): Promise<Invitation> {
    const now = new Date();
    const id = randomUUID();
    const token = randomBytes(32).toString('hex');
    const expiresInDays = input.expiresInDays ?? 7;
    const expiresAt = new Date(now.getTime() + expiresInDays * 24 * 60 * 60 * 1000);

    this.db.insert(invitations).values({
      id,
      tenantId: input.tenantId,
      email: input.email,
      role: input.role,
      token,
      status: 'pending',
      invitedBy: input.invitedBy,
      expiresAt,
      createdAt: now,
      updatedAt: now,
    }).run();

    return {
      id,
      tenantId: input.tenantId,
      email: input.email,
      role: input.role,
      token,
      status: 'pending',
      invitedBy: input.invitedBy,
      expiresAt: expiresAt.toISOString(),
      acceptedAt: null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
  }

  async findById(id: string): Promise<Invitation | null> {
    const rows = this.db
      .select()
      .from(invitations)
      .where(eq(invitations.id, id))
      .limit(1)
      .all();

    return rows[0] ? this.toInvitation(rows[0]) : null;
  }

  async findByToken(token: string): Promise<Invitation | null> {
    const rows = this.db
      .select()
      .from(invitations)
      .where(eq(invitations.token, token))
      .limit(1)
      .all();

    return rows[0] ? this.toInvitation(rows[0]) : null;
  }

  async findByTenant(tenantId: string): Promise<Invitation[]> {
    const rows = this.db
      .select()
      .from(invitations)
      .where(eq(invitations.tenantId, tenantId))
      .all();

    return rows.map((row) => this.toInvitation(row));
  }

  async findPendingByEmail(email: string, tenantId: string): Promise<Invitation | null> {
    const rows = this.db
      .select()
      .from(invitations)
      .where(
        and(
          eq(invitations.email, email),
          eq(invitations.tenantId, tenantId),
          eq(invitations.status, 'pending'),
        ),
      )
      .limit(1)
      .all();

    return rows[0] ? this.toInvitation(rows[0]) : null;
  }

  async updateStatus(id: string, status: InvitationStatus): Promise<boolean> {
    const rows = this.db
      .select({ id: invitations.id })
      .from(invitations)
      .where(eq(invitations.id, id))
      .limit(1)
      .all();

    if (rows.length === 0) return false;

    this.db
      .update(invitations)
      .set({ status, updatedAt: new Date() })
      .where(eq(invitations.id, id))
      .run();

    return true;
  }

  async markAccepted(id: string): Promise<boolean> {
    const rows = this.db
      .select({ id: invitations.id })
      .from(invitations)
      .where(eq(invitations.id, id))
      .limit(1)
      .all();

    if (rows.length === 0) return false;

    const now = new Date();
    this.db
      .update(invitations)
      .set({ status: 'accepted', acceptedAt: now, updatedAt: now })
      .where(eq(invitations.id, id))
      .run();

    return true;
  }

  async delete(id: string): Promise<boolean> {
    const rows = this.db
      .select({ id: invitations.id })
      .from(invitations)
      .where(eq(invitations.id, id))
      .limit(1)
      .all();

    if (rows.length === 0) return false;

    this.db.delete(invitations).where(eq(invitations.id, id)).run();
    return true;
  }

  private toInvitation(row: typeof invitations.$inferSelect): Invitation {
    return {
      id: row.id,
      tenantId: row.tenantId,
      email: row.email,
      role: row.role as 'admin' | 'member',
      token: row.token,
      status: row.status as InvitationStatus,
      invitedBy: row.invitedBy,
      expiresAt: row.expiresAt.toISOString(),
      acceptedAt: row.acceptedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

// ============================================================================
// In-Memory Implementation (for testing)
// ============================================================================

export class InMemoryInvitationRepository implements InvitationRepository {
  private store = new Map<string, Invitation>();

  async create(input: CreateInvitationInput): Promise<Invitation> {
    const now = new Date();
    const expiresInDays = input.expiresInDays ?? 7;
    const expiresAt = new Date(now.getTime() + expiresInDays * 24 * 60 * 60 * 1000);

    const invitation: Invitation = {
      id: randomUUID(),
      tenantId: input.tenantId,
      email: input.email,
      role: input.role,
      token: randomBytes(32).toString('hex'),
      status: 'pending',
      invitedBy: input.invitedBy,
      expiresAt: expiresAt.toISOString(),
      acceptedAt: null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };

    this.store.set(invitation.id, invitation);
    return invitation;
  }

  async findById(id: string): Promise<Invitation | null> {
    return this.store.get(id) ?? null;
  }

  async findByToken(token: string): Promise<Invitation | null> {
    for (const inv of this.store.values()) {
      if (inv.token === token) return inv;
    }
    return null;
  }

  async findByTenant(tenantId: string): Promise<Invitation[]> {
    return [...this.store.values()].filter((inv) => inv.tenantId === tenantId);
  }

  async findPendingByEmail(email: string, tenantId: string): Promise<Invitation | null> {
    for (const inv of this.store.values()) {
      if (inv.email === email && inv.tenantId === tenantId && inv.status === 'pending') {
        return inv;
      }
    }
    return null;
  }

  async updateStatus(id: string, status: InvitationStatus): Promise<boolean> {
    const inv = this.store.get(id);
    if (!inv) return false;
    inv.status = status;
    inv.updatedAt = new Date().toISOString();
    return true;
  }

  async markAccepted(id: string): Promise<boolean> {
    const inv = this.store.get(id);
    if (!inv) return false;
    const now = new Date().toISOString();
    inv.status = 'accepted';
    inv.acceptedAt = now;
    inv.updatedAt = now;
    return true;
  }

  async delete(id: string): Promise<boolean> {
    return this.store.delete(id);
  }

  clear(): void {
    this.store.clear();
  }
}

// ============================================================================
// Singleton
// ============================================================================

let _repository: InvitationRepository | null = null;

export function getInvitationRepository(): InvitationRepository {
  if (!_repository) {
    _repository = new DrizzleInvitationRepository(getDatabase());
  }
  return _repository;
}

export function setInvitationRepository(repo: InvitationRepository): void {
  _repository = repo;
}

export function _resetInvitationRepository(): void {
  _repository = null;
}
