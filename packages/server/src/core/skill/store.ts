// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * SkillKVStore — per-skill key-value persistence layer.
 *
 * Provides CRUD operations scoped by skillId so that each installed skill
 * has its own isolated namespace. Values are stored in the `skill_store`
 * SQLite table via Drizzle.
 *
 * @module core/skill/store
 */

import { randomUUID } from 'node:crypto';
import { eq, and } from 'drizzle-orm';

import { getDatabase } from '../../db/connection.js';
import { skillStore } from '../../db/schema.js';
import { createContextLogger } from '../../utils/logger.js';

import type { DrizzleDB } from '../../db/connection.js';

const logger = createContextLogger({ module: 'skill-kv-store' });

/** Maximum value size in bytes (1 MB). */
const MAX_VALUE_SIZE = 1_048_576;

// ============================================================================
// Interface
// ============================================================================

export interface SkillKVStoreInterface {
  get(skillId: string, key: string): Promise<string | null>;
  set(skillId: string, key: string, value: string): Promise<void>;
  delete(skillId: string, key: string): Promise<void>;
  list(skillId: string): Promise<Record<string, string>>;
}

// ============================================================================
// Drizzle Implementation
// ============================================================================

export class SkillKVStore implements SkillKVStoreInterface {
  constructor(private db: DrizzleDB) {}

  async get(skillId: string, key: string): Promise<string | null> {
    const rows = this.db
      .select()
      .from(skillStore)
      .where(and(eq(skillStore.skillId, skillId), eq(skillStore.key, key)))
      .limit(1)
      .all();
    return rows[0]?.value ?? null;
  }

  async set(skillId: string, key: string, value: string): Promise<void> {
    const byteLength = Buffer.byteLength(value, 'utf8');
    if (byteLength > MAX_VALUE_SIZE) {
      throw new Error(
        `Value size ${byteLength} bytes exceeds maximum ${MAX_VALUE_SIZE} bytes (1 MB)`,
      );
    }

    const now = new Date();
    const existing = this.db
      .select({ id: skillStore.id })
      .from(skillStore)
      .where(and(eq(skillStore.skillId, skillId), eq(skillStore.key, key)))
      .limit(1)
      .all();

    if (existing.length > 0) {
      this.db
        .update(skillStore)
        .set({ value, updatedAt: now })
        .where(eq(skillStore.id, existing[0].id))
        .run();
    } else {
      this.db
        .insert(skillStore)
        .values({ id: randomUUID(), skillId, key, value, updatedAt: now })
        .run();
    }

    logger.debug({ skillId, key }, 'KV store set');
  }

  async delete(skillId: string, key: string): Promise<void> {
    this.db
      .delete(skillStore)
      .where(and(eq(skillStore.skillId, skillId), eq(skillStore.key, key)))
      .run();
    logger.debug({ skillId, key }, 'KV store delete');
  }

  async list(skillId: string): Promise<Record<string, string>> {
    const rows = this.db
      .select({ key: skillStore.key, value: skillStore.value })
      .from(skillStore)
      .where(eq(skillStore.skillId, skillId))
      .all();

    const result: Record<string, string> = {};
    for (const row of rows) {
      result[row.key] = row.value ?? '';
    }
    return result;
  }
}

// ============================================================================
// InMemory Implementation (for testing)
// ============================================================================

export class InMemorySkillKVStore implements SkillKVStoreInterface {
  private data = new Map<string, Map<string, string>>();

  async get(skillId: string, key: string): Promise<string | null> {
    return this.data.get(skillId)?.get(key) ?? null;
  }

  async set(skillId: string, key: string, value: string): Promise<void> {
    const byteLength = Buffer.byteLength(value, 'utf8');
    if (byteLength > MAX_VALUE_SIZE) {
      throw new Error(
        `Value size ${byteLength} bytes exceeds maximum ${MAX_VALUE_SIZE} bytes (1 MB)`,
      );
    }

    let skillMap = this.data.get(skillId);
    if (!skillMap) {
      skillMap = new Map();
      this.data.set(skillId, skillMap);
    }
    skillMap.set(key, value);
  }

  async delete(skillId: string, key: string): Promise<void> {
    this.data.get(skillId)?.delete(key);
  }

  async list(skillId: string): Promise<Record<string, string>> {
    const skillMap = this.data.get(skillId);
    if (!skillMap) return {};
    return Object.fromEntries(skillMap);
  }
}

// ============================================================================
// Singleton
// ============================================================================

let _instance: SkillKVStoreInterface | null = null;

export function getSkillKVStore(): SkillKVStoreInterface {
  if (!_instance) {
    _instance = new SkillKVStore(getDatabase());
  }
  return _instance;
}

export function setSkillKVStore(store: SkillKVStoreInterface): void {
  _instance = store;
}

export function _resetSkillKVStore(): void {
  _instance = null;
}
