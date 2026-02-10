/**
 * Repository for managing documentation source configurations.
 *
 * Provides CRUD operations for doc sources that define where to fetch
 * external documentation (GitHub repos, websites). Supports auto-update
 * scheduling and tracking fetch status.
 *
 * @module db/repositories/doc-source-repository
 */

import { eq, and, desc } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { getDatabase } from '../connection.js';
import { docSources, type DocSourceGitHubConfig, type DocSourceWebConfig } from '../schema.js';

// ============================================================================
// Types
// ============================================================================

/** Full document source record from database */
export interface DocSource {
  id: string;
  userId: string;
  name: string;
  software: string;
  type: 'github' | 'website';
  githubConfig: DocSourceGitHubConfig | null;
  websiteConfig: DocSourceWebConfig | null;
  enabled: boolean;
  autoUpdate: boolean;
  updateFrequencyHours: number | null;
  lastFetchedAt: Date | null;
  lastFetchStatus: 'success' | 'failed' | 'pending' | null;
  lastFetchError: string | null;
  documentCount: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Data required to create a new doc source */
export interface CreateDocSourceData {
  userId: string;
  name: string;
  software: string;
  type: 'github' | 'website';
  githubConfig?: DocSourceGitHubConfig;
  websiteConfig?: DocSourceWebConfig;
  enabled?: boolean;
  autoUpdate?: boolean;
  updateFrequencyHours?: number;
}

/** Data to update an existing doc source */
export interface UpdateDocSourceData {
  name?: string;
  enabled?: boolean;
  autoUpdate?: boolean;
  updateFrequencyHours?: number;
  githubConfig?: DocSourceGitHubConfig;
  websiteConfig?: DocSourceWebConfig;
}

/** Data to record a fetch operation result */
export interface FetchResultData {
  status: 'success' | 'failed';
  error?: string;
  documentCount?: number;
}

// ============================================================================
// DocSourceRepository
// ============================================================================

export class DocSourceRepository {
  constructor(private db = getDatabase()) {}

  /**
   * Create a new documentation source.
   */
  async create(data: CreateDocSourceData): Promise<DocSource> {
    const now = new Date();
    const id = randomUUID();

    const values = {
      id,
      userId: data.userId,
      name: data.name,
      software: data.software,
      type: data.type,
      githubConfig: data.githubConfig ?? null,
      websiteConfig: data.websiteConfig ?? null,
      enabled: data.enabled ?? true,
      autoUpdate: data.autoUpdate ?? false,
      updateFrequencyHours: data.updateFrequencyHours ?? 168,
      lastFetchedAt: null,
      lastFetchStatus: null,
      lastFetchError: null,
      documentCount: 0,
      createdAt: now,
      updatedAt: now,
    };

    await this.db.insert(docSources).values(values);

    return values;
  }

  /**
   * Find a doc source by ID.
   */
  async findById(id: string, userId: string): Promise<DocSource | null> {
    const result = await this.db
      .select()
      .from(docSources)
      .where(and(eq(docSources.id, id), eq(docSources.userId, userId)))
      .limit(1);

    return result[0] ?? null;
  }

  /**
   * List all doc sources for a user.
   */
  async listByUserId(userId: string): Promise<DocSource[]> {
    return this.db
      .select()
      .from(docSources)
      .where(eq(docSources.userId, userId))
      .orderBy(desc(docSources.createdAt));
  }

  /**
   * List enabled doc sources for a user.
   */
  async listEnabledByUserId(userId: string): Promise<DocSource[]> {
    return this.db
      .select()
      .from(docSources)
      .where(and(eq(docSources.userId, userId), eq(docSources.enabled, true)))
      .orderBy(desc(docSources.createdAt));
  }

  /**
   * List doc sources that have auto-update enabled.
   */
  async listAutoUpdateSources(): Promise<DocSource[]> {
    return this.db
      .select()
      .from(docSources)
      .where(and(eq(docSources.enabled, true), eq(docSources.autoUpdate, true)))
      .orderBy(desc(docSources.lastFetchedAt));
  }

  /**
   * Find doc sources by software name.
   */
  async findBySoftware(software: string, userId: string): Promise<DocSource[]> {
    return this.db
      .select()
      .from(docSources)
      .where(and(eq(docSources.software, software), eq(docSources.userId, userId)))
      .orderBy(desc(docSources.createdAt));
  }

  /**
   * Update a doc source.
   */
  async update(id: string, userId: string, data: UpdateDocSourceData): Promise<DocSource | null> {
    const now = new Date();

    const updateValues: Record<string, unknown> = {
      updatedAt: now,
    };

    if (data.name !== undefined) updateValues.name = data.name;
    if (data.enabled !== undefined) updateValues.enabled = data.enabled;
    if (data.autoUpdate !== undefined) updateValues.autoUpdate = data.autoUpdate;
    if (data.updateFrequencyHours !== undefined)
      updateValues.updateFrequencyHours = data.updateFrequencyHours;
    if (data.githubConfig !== undefined) updateValues.githubConfig = data.githubConfig;
    if (data.websiteConfig !== undefined) updateValues.websiteConfig = data.websiteConfig;

    await this.db
      .update(docSources)
      .set(updateValues)
      .where(and(eq(docSources.id, id), eq(docSources.userId, userId)));

    return this.findById(id, userId);
  }

  /**
   * Record the result of a fetch operation.
   */
  async recordFetchResult(
    id: string,
    userId: string,
    result: FetchResultData,
  ): Promise<DocSource | null> {
    const now = new Date();

    const updateValues: Record<string, unknown> = {
      lastFetchedAt: now,
      lastFetchStatus: result.status,
      updatedAt: now,
    };

    if (result.error) {
      updateValues.lastFetchError = result.error;
    } else {
      updateValues.lastFetchError = null;
    }

    if (result.documentCount !== undefined) {
      updateValues.documentCount = result.documentCount;
    }

    await this.db
      .update(docSources)
      .set(updateValues)
      .where(and(eq(docSources.id, id), eq(docSources.userId, userId)));

    return this.findById(id, userId);
  }

  /**
   * Delete a doc source.
   */
  async delete(id: string, userId: string): Promise<boolean> {
    const result = await this.db
      .delete(docSources)
      .where(and(eq(docSources.id, id), eq(docSources.userId, userId)));

    return result.changes > 0;
  }

  /**
   * Check if a source should be updated based on its last fetch time
   * and configured update frequency.
   */
  shouldUpdate(source: DocSource): boolean {
    if (!source.autoUpdate || !source.enabled) return false;
    if (!source.lastFetchedAt) return true;

    const frequencyMs = (source.updateFrequencyHours ?? 168) * 60 * 60 * 1000;
    const nextUpdateTime = source.lastFetchedAt.getTime() + frequencyMs;
    return Date.now() >= nextUpdateTime;
  }
}

// ============================================================================
// Singleton
// ============================================================================

let _repository: DocSourceRepository | null = null;

export function getDocSourceRepository(): DocSourceRepository {
  if (!_repository) {
    _repository = new DocSourceRepository();
  }
  return _repository;
}

export function setDocSourceRepository(repo: DocSourceRepository): void {
  _repository = repo;
}

export function _resetDocSourceRepository(): void {
  _repository = null;
}
