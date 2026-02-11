// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Settings repository — data access layer for user settings management.
 *
 * Manages user-specific configuration including AI provider settings,
 * notification preferences, and knowledge base configuration.
 *
 * @module db/repositories/settings-repository
 */

import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';

import { getDatabase } from '../connection.js';
import {
  userSettings,
  type UserSettingsAIProvider,
  type UserSettingsNotifications,
  type UserSettingsKnowledgeBase,
} from '../schema.js';

import type { DrizzleDB } from '../connection.js';

// ============================================================================
// Types
// ============================================================================

export interface UserSettings {
  id: string;
  userId: string;
  aiProvider: UserSettingsAIProvider;
  notifications: UserSettingsNotifications;
  knowledgeBase: UserSettingsKnowledgeBase;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSettingsInput {
  userId: string;
  aiProvider?: Partial<UserSettingsAIProvider>;
  notifications?: Partial<UserSettingsNotifications>;
  knowledgeBase?: Partial<UserSettingsKnowledgeBase>;
}

export interface UpdateSettingsInput {
  aiProvider?: Partial<UserSettingsAIProvider>;
  notifications?: Partial<UserSettingsNotifications>;
  knowledgeBase?: Partial<UserSettingsKnowledgeBase>;
}

// Default settings
const DEFAULT_AI_PROVIDER: UserSettingsAIProvider = {
  provider: 'claude',
};

const DEFAULT_NOTIFICATIONS: UserSettingsNotifications = {
  emailNotifications: true,
  taskCompletion: true,
  systemAlerts: true,
  operationReports: false,
};

const DEFAULT_KNOWLEDGE_BASE: UserSettingsKnowledgeBase = {
  autoLearning: false,
  documentSources: [],
};

// ============================================================================
// Repository Interface
// ============================================================================

export interface SettingsRepository {
  findByUserId(userId: string): Promise<UserSettings | null>;
  create(input: CreateSettingsInput): Promise<UserSettings>;
  update(userId: string, input: UpdateSettingsInput): Promise<UserSettings | null>;
  delete(userId: string): Promise<boolean>;
}

// ============================================================================
// Drizzle Implementation
// ============================================================================

export class DrizzleSettingsRepository implements SettingsRepository {
  constructor(private db: DrizzleDB) {}

  async findByUserId(userId: string): Promise<UserSettings | null> {
    const rows = this.db
      .select()
      .from(userSettings)
      .where(eq(userSettings.userId, userId))
      .limit(1)
      .all();

    return rows[0] ? this.toUserSettings(rows[0]) : null;
  }

  async create(input: CreateSettingsInput): Promise<UserSettings> {
    const now = new Date();
    const id = randomUUID();

    const aiProvider: UserSettingsAIProvider = {
      ...DEFAULT_AI_PROVIDER,
      ...input.aiProvider,
    };

    const notifications: UserSettingsNotifications = {
      ...DEFAULT_NOTIFICATIONS,
      ...input.notifications,
    };

    const knowledgeBase: UserSettingsKnowledgeBase = {
      ...DEFAULT_KNOWLEDGE_BASE,
      ...input.knowledgeBase,
    };

    this.db
      .insert(userSettings)
      .values({
        id,
        userId: input.userId,
        aiProvider,
        notifications,
        knowledgeBase,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    return {
      id,
      userId: input.userId,
      aiProvider,
      notifications,
      knowledgeBase,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
  }

  async update(userId: string, input: UpdateSettingsInput): Promise<UserSettings | null> {
    const existing = await this.findByUserId(userId);
    if (!existing) return null;

    const now = new Date();

    // Merge with existing settings
    const aiProvider: UserSettingsAIProvider = input.aiProvider
      ? { ...existing.aiProvider, ...input.aiProvider }
      : existing.aiProvider;

    const notifications: UserSettingsNotifications = input.notifications
      ? { ...existing.notifications, ...input.notifications }
      : existing.notifications;

    const knowledgeBase: UserSettingsKnowledgeBase = input.knowledgeBase
      ? { ...existing.knowledgeBase, ...input.knowledgeBase }
      : existing.knowledgeBase;

    this.db
      .update(userSettings)
      .set({
        aiProvider,
        notifications,
        knowledgeBase,
        updatedAt: now,
      })
      .where(eq(userSettings.userId, userId))
      .run();

    return this.findByUserId(userId);
  }

  async delete(userId: string): Promise<boolean> {
    const existing = await this.findByUserId(userId);
    if (!existing) return false;

    this.db.delete(userSettings).where(eq(userSettings.userId, userId)).run();
    return true;
  }

  private toUserSettings(row: typeof userSettings.$inferSelect): UserSettings {
    return {
      id: row.id,
      userId: row.userId,
      aiProvider: row.aiProvider,
      notifications: row.notifications,
      knowledgeBase: row.knowledgeBase,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

// ============================================================================
// In-Memory Implementation (for testing)
// ============================================================================

export class InMemorySettingsRepository implements SettingsRepository {
  private settings = new Map<string, UserSettings>();

  async findByUserId(userId: string): Promise<UserSettings | null> {
    for (const setting of this.settings.values()) {
      if (setting.userId === userId) return setting;
    }
    return null;
  }

  async create(input: CreateSettingsInput): Promise<UserSettings> {
    const now = new Date().toISOString();
    const settings: UserSettings = {
      id: randomUUID(),
      userId: input.userId,
      aiProvider: { ...DEFAULT_AI_PROVIDER, ...input.aiProvider },
      notifications: { ...DEFAULT_NOTIFICATIONS, ...input.notifications },
      knowledgeBase: { ...DEFAULT_KNOWLEDGE_BASE, ...input.knowledgeBase },
      createdAt: now,
      updatedAt: now,
    };
    this.settings.set(settings.id, settings);
    return settings;
  }

  async update(userId: string, input: UpdateSettingsInput): Promise<UserSettings | null> {
    const existing = await this.findByUserId(userId);
    if (!existing) return null;

    const updated: UserSettings = {
      ...existing,
      aiProvider: input.aiProvider
        ? { ...existing.aiProvider, ...input.aiProvider }
        : existing.aiProvider,
      notifications: input.notifications
        ? { ...existing.notifications, ...input.notifications }
        : existing.notifications,
      knowledgeBase: input.knowledgeBase
        ? { ...existing.knowledgeBase, ...input.knowledgeBase }
        : existing.knowledgeBase,
      updatedAt: new Date().toISOString(),
    };

    this.settings.set(existing.id, updated);
    return updated;
  }

  async delete(userId: string): Promise<boolean> {
    const existing = await this.findByUserId(userId);
    if (!existing) return false;

    this.settings.delete(existing.id);
    return true;
  }

  clear(): void {
    this.settings.clear();
  }
}

// ============================================================================
// Singleton
// ============================================================================

let _repository: SettingsRepository | null = null;

export function getSettingsRepository(): SettingsRepository {
  if (!_repository) {
    _repository = new DrizzleSettingsRepository(getDatabase());
  }
  return _repository;
}

export function setSettingsRepository(repo: SettingsRepository): void {
  _repository = repo;
}

/** Reset to default (for testing). */
export function _resetSettingsRepository(): void {
  _repository = null;
}
