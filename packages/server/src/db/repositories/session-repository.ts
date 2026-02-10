/**
 * Session repository — data access layer for AI chat sessions.
 *
 * Manages conversation persistence: messages, context snapshots,
 * and session lifecycle.
 *
 * @module db/repositories/session-repository
 */

import { randomUUID } from 'node:crypto';
import { eq, and, desc, count } from 'drizzle-orm';

import { getDatabase } from '../connection.js';
import { sessions, servers } from '../schema.js';

import type { DrizzleDB } from '../connection.js';
import type { SessionMessage, SessionContext } from '../schema.js';

// ============================================================================
// Types
// ============================================================================

export interface Session {
  id: string;
  userId: string;
  serverId: string;
  messages: SessionMessage[];
  context: SessionContext | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSessionInput {
  userId: string;
  serverId: string;
  context?: SessionContext;
}

export interface PaginationOptions {
  limit: number;
  offset: number;
}

// ============================================================================
// Repository Interface
// ============================================================================

export interface SessionRepository {
  /** Create a new session. */
  create(input: CreateSessionInput): Promise<Session>;

  /** Get session by ID with user isolation. */
  getById(id: string, userId: string): Promise<Session | null>;

  /** List sessions for a server with pagination. */
  listByServer(
    serverId: string,
    userId: string,
    pagination: PaginationOptions,
  ): Promise<{ sessions: Session[]; total: number }>;

  /** Add a message to a session. */
  addMessage(
    id: string,
    userId: string,
    message: SessionMessage,
  ): Promise<boolean>;

  /** Update session context. */
  updateContext(
    id: string,
    userId: string,
    context: SessionContext,
  ): Promise<boolean>;

  /** Delete a session. */
  delete(id: string, userId: string): Promise<boolean>;
}

// ============================================================================
// Drizzle Implementation
// ============================================================================

export class DrizzleSessionRepository implements SessionRepository {
  constructor(private db: DrizzleDB) {}

  async create(input: CreateSessionInput): Promise<Session> {
    if (!(await this.verifyServerOwnership(input.serverId, input.userId))) {
      throw new Error('Server not found or access denied');
    }

    const now = new Date();
    const id = randomUUID();

    this.db.insert(sessions).values({
      id,
      userId: input.userId,
      serverId: input.serverId,
      messages: [],
      context: input.context ?? null,
      createdAt: now,
      updatedAt: now,
    }).run();

    return {
      id,
      userId: input.userId,
      serverId: input.serverId,
      messages: [],
      context: input.context ?? null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
  }

  async getById(id: string, userId: string): Promise<Session | null> {
    const rows = this.db
      .select()
      .from(sessions)
      .where(and(eq(sessions.id, id), eq(sessions.userId, userId)))
      .limit(1)
      .all();

    return rows[0] ? this.toSession(rows[0]) : null;
  }

  async listByServer(
    serverId: string,
    userId: string,
    pagination: PaginationOptions,
  ): Promise<{ sessions: Session[]; total: number }> {
    if (!(await this.verifyServerOwnership(serverId, userId))) {
      return { sessions: [], total: 0 };
    }

    const totalResult = this.db
      .select({ count: count() })
      .from(sessions)
      .where(
        and(eq(sessions.serverId, serverId), eq(sessions.userId, userId)),
      )
      .all();
    const total = totalResult[0]?.count ?? 0;

    const rows = this.db
      .select()
      .from(sessions)
      .where(
        and(eq(sessions.serverId, serverId), eq(sessions.userId, userId)),
      )
      .orderBy(desc(sessions.updatedAt))
      .limit(pagination.limit)
      .offset(pagination.offset)
      .all();

    return {
      sessions: rows.map((row) => this.toSession(row)),
      total,
    };
  }

  async addMessage(
    id: string,
    userId: string,
    message: SessionMessage,
  ): Promise<boolean> {
    const existing = await this.getById(id, userId);
    if (!existing) return false;

    const updatedMessages = [...existing.messages, message];
    this.db
      .update(sessions)
      .set({ messages: updatedMessages, updatedAt: new Date() })
      .where(and(eq(sessions.id, id), eq(sessions.userId, userId)))
      .run();

    return true;
  }

  async updateContext(
    id: string,
    userId: string,
    context: SessionContext,
  ): Promise<boolean> {
    const existing = await this.getById(id, userId);
    if (!existing) return false;

    this.db
      .update(sessions)
      .set({ context, updatedAt: new Date() })
      .where(and(eq(sessions.id, id), eq(sessions.userId, userId)))
      .run();

    return true;
  }

  async delete(id: string, userId: string): Promise<boolean> {
    const existing = await this.getById(id, userId);
    if (!existing) return false;

    this.db
      .delete(sessions)
      .where(and(eq(sessions.id, id), eq(sessions.userId, userId)))
      .run();

    return true;
  }

  private async verifyServerOwnership(
    serverId: string,
    userId: string,
  ): Promise<boolean> {
    const rows = this.db
      .select({ userId: servers.userId })
      .from(servers)
      .where(and(eq(servers.id, serverId), eq(servers.userId, userId)))
      .limit(1)
      .all();

    return rows.length > 0;
  }

  private toSession(row: typeof sessions.$inferSelect): Session {
    return {
      id: row.id,
      userId: row.userId,
      serverId: row.serverId,
      messages: (row.messages ?? []) as SessionMessage[],
      context: row.context ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

// ============================================================================
// Singleton
// ============================================================================

let _repository: SessionRepository | null = null;

export function getSessionRepository(): SessionRepository {
  if (!_repository) {
    _repository = new DrizzleSessionRepository(getDatabase());
  }
  return _repository;
}

export function setSessionRepository(repo: SessionRepository): void {
  _repository = repo;
}

export function _resetSessionRepository(): void {
  _repository = null;
}
