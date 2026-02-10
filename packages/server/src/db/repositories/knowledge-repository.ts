/**
 * Knowledge repository — data access layer for software installation knowledge.
 *
 * Manages the knowledge cache for installation commands, verification steps,
 * and platform-specific instructions. Supports learning from successful operations.
 *
 * @module db/repositories/knowledge-repository
 */

import { randomUUID } from 'node:crypto';
import { eq, and, like, desc, sql } from 'drizzle-orm';

import { getDatabase } from '../connection.js';
import { knowledgeCache } from '../schema.js';

import type { DrizzleDB } from '../connection.js';
import type { KnowledgeEntry } from '../schema.js';

// ============================================================================
// Types
// ============================================================================

export type KnowledgeSource = 'builtin' | 'auto_learn' | 'scrape' | 'community';

export interface Knowledge {
  id: string;
  software: string;
  platform: string;
  content: KnowledgeEntry;
  source: KnowledgeSource;
  successCount: number;
  lastUsed: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateKnowledgeInput {
  software: string;
  platform: string;
  content: KnowledgeEntry;
  source: KnowledgeSource;
}

export interface UpdateKnowledgeInput {
  content?: KnowledgeEntry;
  source?: KnowledgeSource;
}

// ============================================================================
// Repository Interface
// ============================================================================

export interface KnowledgeRepository {
  /** Search knowledge by software name (partial match). */
  search(query: string): Promise<Knowledge[]>;

  /** Find knowledge for a specific software + platform combination. */
  findBySoftwarePlatform(
    software: string,
    platform: string,
  ): Promise<Knowledge | null>;

  /** Create a new knowledge entry. */
  create(input: CreateKnowledgeInput): Promise<Knowledge>;

  /** Update an existing knowledge entry. */
  update(id: string, input: UpdateKnowledgeInput): Promise<Knowledge | null>;

  /** Record a successful usage (increment count, update lastUsed). */
  recordUsage(id: string): Promise<boolean>;

  /** Get knowledge entries by source. */
  getBySource(source: KnowledgeSource): Promise<Knowledge[]>;

  /** Delete a knowledge entry. */
  delete(id: string): Promise<boolean>;
}

// ============================================================================
// Drizzle Implementation
// ============================================================================

function toISOString(date: Date | null | undefined): string | null {
  return date ? date.toISOString() : null;
}

export class DrizzleKnowledgeRepository implements KnowledgeRepository {
  constructor(private db: DrizzleDB) {}

  async search(query: string): Promise<Knowledge[]> {
    const rows = this.db
      .select()
      .from(knowledgeCache)
      .where(like(knowledgeCache.software, `%${query}%`))
      .orderBy(desc(knowledgeCache.successCount))
      .all();

    return rows.map((row) => this.toKnowledge(row));
  }

  async findBySoftwarePlatform(
    software: string,
    platform: string,
  ): Promise<Knowledge | null> {
    const rows = this.db
      .select()
      .from(knowledgeCache)
      .where(
        and(
          eq(knowledgeCache.software, software),
          eq(knowledgeCache.platform, platform),
        ),
      )
      .limit(1)
      .all();

    return rows[0] ? this.toKnowledge(rows[0]) : null;
  }

  async create(input: CreateKnowledgeInput): Promise<Knowledge> {
    const now = new Date();
    const id = randomUUID();

    this.db.insert(knowledgeCache).values({
      id,
      software: input.software,
      platform: input.platform,
      content: input.content,
      source: input.source,
      successCount: 0,
      lastUsed: null,
      createdAt: now,
      updatedAt: now,
    }).run();

    return {
      id,
      software: input.software,
      platform: input.platform,
      content: input.content,
      source: input.source,
      successCount: 0,
      lastUsed: null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
  }

  async update(
    id: string,
    input: UpdateKnowledgeInput,
  ): Promise<Knowledge | null> {
    const existing = await this.getById(id);
    if (!existing) return null;

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (input.content !== undefined) updates.content = input.content;
    if (input.source !== undefined) updates.source = input.source;

    this.db
      .update(knowledgeCache)
      .set(updates)
      .where(eq(knowledgeCache.id, id))
      .run();

    return this.getById(id);
  }

  async recordUsage(id: string): Promise<boolean> {
    const existing = await this.getById(id);
    if (!existing) return false;

    this.db
      .update(knowledgeCache)
      .set({
        successCount: sql`${knowledgeCache.successCount} + 1`,
        lastUsed: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(knowledgeCache.id, id))
      .run();

    return true;
  }

  async getBySource(source: KnowledgeSource): Promise<Knowledge[]> {
    const rows = this.db
      .select()
      .from(knowledgeCache)
      .where(eq(knowledgeCache.source, source))
      .orderBy(desc(knowledgeCache.successCount))
      .all();

    return rows.map((row) => this.toKnowledge(row));
  }

  async delete(id: string): Promise<boolean> {
    const existing = await this.getById(id);
    if (!existing) return false;

    this.db
      .delete(knowledgeCache)
      .where(eq(knowledgeCache.id, id))
      .run();

    return true;
  }

  private async getById(id: string): Promise<Knowledge | null> {
    const rows = this.db
      .select()
      .from(knowledgeCache)
      .where(eq(knowledgeCache.id, id))
      .limit(1)
      .all();

    return rows[0] ? this.toKnowledge(rows[0]) : null;
  }

  private toKnowledge(row: typeof knowledgeCache.$inferSelect): Knowledge {
    return {
      id: row.id,
      software: row.software,
      platform: row.platform,
      content: row.content as KnowledgeEntry,
      source: row.source as KnowledgeSource,
      successCount: row.successCount,
      lastUsed: toISOString(row.lastUsed),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

// ============================================================================
// Singleton
// ============================================================================

let _repository: KnowledgeRepository | null = null;

export function getKnowledgeRepository(): KnowledgeRepository {
  if (!_repository) {
    _repository = new DrizzleKnowledgeRepository(getDatabase());
  }
  return _repository;
}

export function setKnowledgeRepository(repo: KnowledgeRepository): void {
  _repository = repo;
}

export function _resetKnowledgeRepository(): void {
  _repository = null;
}
