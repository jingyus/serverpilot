// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Profile repository — data access layer for server profiles.
 *
 * Manages server environment snapshots: OS info, software, services,
 * user preferences, notes, and operation history.
 *
 * @module db/repositories/profile-repository
 */

import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';

import { getDatabase } from '../connection.js';
import { profiles, servers } from '../schema.js';

import type { DrizzleDB } from '../connection.js';
import type {
  ProfileOsInfo,
  ProfileSoftware,
  ProfileService,
  ProfilePreferences,
} from '../schema.js';

// ============================================================================
// Types
// ============================================================================

export interface Profile {
  id: string;
  serverId: string;
  osInfo: ProfileOsInfo | null;
  software: ProfileSoftware[];
  services: ProfileService[];
  preferences: ProfilePreferences | null;
  notes: string[];
  operationHistory: string[];
  historySummary: string | null;
  updatedAt: string;
}

export interface UpdateProfileInput {
  osInfo?: ProfileOsInfo | null;
  software?: ProfileSoftware[];
  services?: ProfileService[];
  preferences?: ProfilePreferences | null;
}

// ============================================================================
// Repository Interface
// ============================================================================

export interface ProfileRepository {
  /** Get profile by server ID. User isolation via server ownership check. */
  getByServerId(serverId: string, userId: string): Promise<Profile | null>;

  /** Create a profile for a server. */
  create(serverId: string, userId: string): Promise<Profile>;

  /** Update profile fields. */
  update(
    serverId: string,
    userId: string,
    input: UpdateProfileInput,
  ): Promise<Profile | null>;

  /** Add a note to the profile. */
  addNote(serverId: string, userId: string, note: string): Promise<boolean>;

  /** Record an operation summary in history. */
  addOperationHistory(
    serverId: string,
    userId: string,
    summary: string,
  ): Promise<boolean>;

  /** Get operation history for a server. */
  getOperationHistory(
    serverId: string,
    userId: string,
  ): Promise<string[]>;

  /** Remove a note by index. */
  removeNote(serverId: string, userId: string, index: number): Promise<boolean>;

  /** Update preferences (merge with existing). */
  updatePreferences(
    serverId: string,
    userId: string,
    preferences: Partial<ProfilePreferences>,
  ): Promise<boolean>;

  /** Set history summary text. */
  setHistorySummary(
    serverId: string,
    userId: string,
    summary: string,
  ): Promise<boolean>;

  /** Clear old operation history entries after summarization. */
  trimOperationHistory(
    serverId: string,
    userId: string,
    keepCount: number,
  ): Promise<boolean>;
}

// ============================================================================
// Drizzle Implementation
// ============================================================================

export class DrizzleProfileRepository implements ProfileRepository {
  constructor(private db: DrizzleDB) {}

  async getByServerId(
    serverId: string,
    userId: string,
  ): Promise<Profile | null> {
    if (!(await this.verifyServerOwnership(serverId, userId))) return null;

    const rows = this.db
      .select()
      .from(profiles)
      .where(eq(profiles.serverId, serverId))
      .limit(1)
      .all();

    return rows[0] ? this.toProfile(rows[0]) : null;
  }

  async create(serverId: string, userId: string): Promise<Profile> {
    if (!(await this.verifyServerOwnership(serverId, userId))) {
      throw new Error('Server not found or access denied');
    }

    const now = new Date();
    const id = randomUUID();

    this.db.insert(profiles).values({
      id,
      serverId,
      osInfo: null,
      software: [],
      services: [],
      preferences: null,
      notes: [],
      operationHistory: [],
      updatedAt: now,
    }).run();

    return {
      id,
      serverId,
      osInfo: null,
      software: [],
      services: [],
      preferences: null,
      notes: [],
      operationHistory: [],
      historySummary: null,
      updatedAt: now.toISOString(),
    };
  }

  async update(
    serverId: string,
    userId: string,
    input: UpdateProfileInput,
  ): Promise<Profile | null> {
    const existing = await this.getByServerId(serverId, userId);
    if (!existing) return null;

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (input.osInfo !== undefined) updates.osInfo = input.osInfo;
    if (input.software !== undefined) updates.software = input.software;
    if (input.services !== undefined) updates.services = input.services;
    if (input.preferences !== undefined) updates.preferences = input.preferences;

    this.db
      .update(profiles)
      .set(updates)
      .where(eq(profiles.serverId, serverId))
      .run();

    return this.getByServerId(serverId, userId);
  }

  async addNote(
    serverId: string,
    userId: string,
    note: string,
  ): Promise<boolean> {
    const existing = await this.getByServerId(serverId, userId);
    if (!existing) return false;

    const updatedNotes = [...existing.notes, note];
    this.db
      .update(profiles)
      .set({ notes: updatedNotes, updatedAt: new Date() })
      .where(eq(profiles.serverId, serverId))
      .run();

    return true;
  }

  async addOperationHistory(
    serverId: string,
    userId: string,
    summary: string,
  ): Promise<boolean> {
    const existing = await this.getByServerId(serverId, userId);
    if (!existing) return false;

    const updatedHistory = [...existing.operationHistory, summary];
    this.db
      .update(profiles)
      .set({ operationHistory: updatedHistory, updatedAt: new Date() })
      .where(eq(profiles.serverId, serverId))
      .run();

    return true;
  }

  async getOperationHistory(
    serverId: string,
    userId: string,
  ): Promise<string[]> {
    const profile = await this.getByServerId(serverId, userId);
    return profile?.operationHistory ?? [];
  }

  async removeNote(
    serverId: string,
    userId: string,
    index: number,
  ): Promise<boolean> {
    const existing = await this.getByServerId(serverId, userId);
    if (!existing) return false;
    if (index < 0 || index >= existing.notes.length) return false;

    const updatedNotes = [...existing.notes];
    updatedNotes.splice(index, 1);
    this.db
      .update(profiles)
      .set({ notes: updatedNotes, updatedAt: new Date() })
      .where(eq(profiles.serverId, serverId))
      .run();

    return true;
  }

  async updatePreferences(
    serverId: string,
    userId: string,
    preferences: Partial<ProfilePreferences>,
  ): Promise<boolean> {
    const existing = await this.getByServerId(serverId, userId);
    if (!existing) return false;

    const merged = { ...(existing.preferences ?? {}), ...preferences };
    this.db
      .update(profiles)
      .set({ preferences: merged as ProfilePreferences, updatedAt: new Date() })
      .where(eq(profiles.serverId, serverId))
      .run();

    return true;
  }

  async setHistorySummary(
    serverId: string,
    userId: string,
    summary: string,
  ): Promise<boolean> {
    if (!(await this.verifyServerOwnership(serverId, userId))) return false;

    this.db
      .update(profiles)
      .set({ historySummary: summary, updatedAt: new Date() })
      .where(eq(profiles.serverId, serverId))
      .run();

    return true;
  }

  async trimOperationHistory(
    serverId: string,
    userId: string,
    keepCount: number,
  ): Promise<boolean> {
    const existing = await this.getByServerId(serverId, userId);
    if (!existing) return false;

    const trimmed = existing.operationHistory.slice(-keepCount);
    this.db
      .update(profiles)
      .set({ operationHistory: trimmed, updatedAt: new Date() })
      .where(eq(profiles.serverId, serverId))
      .run();

    return true;
  }

  private async verifyServerOwnership(
    serverId: string,
    userId: string,
  ): Promise<boolean> {
    const rows = this.db
      .select({ id: servers.id })
      .from(servers)
      .where(eq(servers.id, serverId))
      .limit(1)
      .all();

    if (!rows[0]) return false;

    const serverRows = this.db
      .select({ userId: servers.userId })
      .from(servers)
      .where(eq(servers.id, serverId))
      .limit(1)
      .all();

    return serverRows[0]?.userId === userId;
  }

  private toProfile(row: typeof profiles.$inferSelect): Profile {
    return {
      id: row.id,
      serverId: row.serverId,
      osInfo: row.osInfo ?? null,
      software: (row.software ?? []) as ProfileSoftware[],
      services: (row.services ?? []) as ProfileService[],
      preferences: row.preferences ?? null,
      notes: (row.notes ?? []) as string[],
      operationHistory: (row.operationHistory ?? []) as string[],
      historySummary: row.historySummary ?? null,
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

// ============================================================================
// Singleton
// ============================================================================

let _repository: ProfileRepository | null = null;

export function getProfileRepository(): ProfileRepository {
  if (!_repository) {
    _repository = new DrizzleProfileRepository(getDatabase());
  }
  return _repository;
}

export function setProfileRepository(repo: ProfileRepository): void {
  _repository = repo;
}

export function _resetProfileRepository(): void {
  _repository = null;
}
