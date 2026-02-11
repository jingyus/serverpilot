// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * OAuth account repository — data access layer for linked OAuth identities.
 *
 * @module db/repositories/oauth-account-repository
 */

import { randomUUID } from 'node:crypto';
import { eq, and } from 'drizzle-orm';

import { getDatabase } from '../connection.js';
import { oauthAccounts } from '../schema.js';

import type { DrizzleDB } from '../connection.js';

// ============================================================================
// Types
// ============================================================================

export type OAuthProvider = 'github';

export interface OAuthAccount {
  id: string;
  userId: string;
  provider: OAuthProvider;
  providerAccountId: string;
  providerUsername: string | null;
  providerAvatarUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateOAuthAccountInput {
  userId: string;
  provider: OAuthProvider;
  providerAccountId: string;
  providerUsername?: string;
  providerAvatarUrl?: string;
}

// ============================================================================
// Repository Interface
// ============================================================================

export interface OAuthAccountRepository {
  findByProviderAccount(provider: OAuthProvider, providerAccountId: string): Promise<OAuthAccount | null>;
  findByUserId(userId: string): Promise<OAuthAccount[]>;
  create(input: CreateOAuthAccountInput): Promise<OAuthAccount>;
  update(id: string, input: Partial<Pick<OAuthAccount, 'providerUsername' | 'providerAvatarUrl'>>): Promise<OAuthAccount | null>;
}

// ============================================================================
// Drizzle Implementation
// ============================================================================

export class DrizzleOAuthAccountRepository implements OAuthAccountRepository {
  constructor(private db: DrizzleDB) {}

  async findByProviderAccount(provider: OAuthProvider, providerAccountId: string): Promise<OAuthAccount | null> {
    const rows = this.db
      .select()
      .from(oauthAccounts)
      .where(and(
        eq(oauthAccounts.provider, provider),
        eq(oauthAccounts.providerAccountId, providerAccountId),
      ))
      .limit(1)
      .all();

    return rows[0] ? this.toOAuthAccount(rows[0]) : null;
  }

  async findByUserId(userId: string): Promise<OAuthAccount[]> {
    const rows = this.db
      .select()
      .from(oauthAccounts)
      .where(eq(oauthAccounts.userId, userId))
      .all();

    return rows.map((row) => this.toOAuthAccount(row));
  }

  async create(input: CreateOAuthAccountInput): Promise<OAuthAccount> {
    const now = new Date();
    const id = randomUUID();

    this.db.insert(oauthAccounts).values({
      id,
      userId: input.userId,
      provider: input.provider,
      providerAccountId: input.providerAccountId,
      providerUsername: input.providerUsername ?? null,
      providerAvatarUrl: input.providerAvatarUrl ?? null,
      createdAt: now,
      updatedAt: now,
    }).run();

    return {
      id,
      userId: input.userId,
      provider: input.provider,
      providerAccountId: input.providerAccountId,
      providerUsername: input.providerUsername ?? null,
      providerAvatarUrl: input.providerAvatarUrl ?? null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
  }

  async update(id: string, input: Partial<Pick<OAuthAccount, 'providerUsername' | 'providerAvatarUrl'>>): Promise<OAuthAccount | null> {
    const now = new Date();
    const updates: Record<string, unknown> = { updatedAt: now };
    if (input.providerUsername !== undefined) updates.providerUsername = input.providerUsername;
    if (input.providerAvatarUrl !== undefined) updates.providerAvatarUrl = input.providerAvatarUrl;

    this.db
      .update(oauthAccounts)
      .set(updates)
      .where(eq(oauthAccounts.id, id))
      .run();

    const rows = this.db
      .select()
      .from(oauthAccounts)
      .where(eq(oauthAccounts.id, id))
      .limit(1)
      .all();

    return rows[0] ? this.toOAuthAccount(rows[0]) : null;
  }

  private toOAuthAccount(row: typeof oauthAccounts.$inferSelect): OAuthAccount {
    return {
      id: row.id,
      userId: row.userId,
      provider: row.provider,
      providerAccountId: row.providerAccountId,
      providerUsername: row.providerUsername,
      providerAvatarUrl: row.providerAvatarUrl,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

// ============================================================================
// In-Memory Implementation (for testing)
// ============================================================================

export class InMemoryOAuthAccountRepository implements OAuthAccountRepository {
  private accounts = new Map<string, OAuthAccount>();

  async findByProviderAccount(provider: OAuthProvider, providerAccountId: string): Promise<OAuthAccount | null> {
    for (const account of this.accounts.values()) {
      if (account.provider === provider && account.providerAccountId === providerAccountId) {
        return account;
      }
    }
    return null;
  }

  async findByUserId(userId: string): Promise<OAuthAccount[]> {
    const result: OAuthAccount[] = [];
    for (const account of this.accounts.values()) {
      if (account.userId === userId) result.push(account);
    }
    return result;
  }

  async create(input: CreateOAuthAccountInput): Promise<OAuthAccount> {
    const now = new Date().toISOString();
    const account: OAuthAccount = {
      id: randomUUID(),
      userId: input.userId,
      provider: input.provider,
      providerAccountId: input.providerAccountId,
      providerUsername: input.providerUsername ?? null,
      providerAvatarUrl: input.providerAvatarUrl ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.accounts.set(account.id, account);
    return account;
  }

  async update(id: string, input: Partial<Pick<OAuthAccount, 'providerUsername' | 'providerAvatarUrl'>>): Promise<OAuthAccount | null> {
    const account = this.accounts.get(id);
    if (!account) return null;

    if (input.providerUsername !== undefined) account.providerUsername = input.providerUsername;
    if (input.providerAvatarUrl !== undefined) account.providerAvatarUrl = input.providerAvatarUrl;
    account.updatedAt = new Date().toISOString();

    this.accounts.set(id, account);
    return account;
  }

  clear(): void {
    this.accounts.clear();
  }
}

// ============================================================================
// Singleton
// ============================================================================

let _repository: OAuthAccountRepository | null = null;

export function getOAuthAccountRepository(): OAuthAccountRepository {
  if (!_repository) {
    _repository = new DrizzleOAuthAccountRepository(getDatabase());
  }
  return _repository;
}

export function setOAuthAccountRepository(repo: OAuthAccountRepository): void {
  _repository = repo;
}

export function _resetOAuthAccountRepository(): void {
  _repository = null;
}
