// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Session repository — data access layer for AI chat sessions.
 *
 * Manages conversation persistence: messages, context snapshots,
 * and session lifecycle.
 *
 * @module db/repositories/session-repository
 */

import { randomUUID } from 'node:crypto';
import { eq, and, desc, count, sql } from 'drizzle-orm';

import { getDatabase, getRawDatabase } from '../connection.js';
import { sessions, sessionMessages, servers } from '../schema.js';

import type { DrizzleDB } from '../connection.js';
import type { SessionMessage, SessionContext } from '../schema.js';

// ============================================================================
// Types
// ============================================================================

export interface Session {
  id: string;
  userId: string;
  serverId: string;
  name: string | null;
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

/** Lightweight session summary — avoids loading all messages. */
export interface SessionSummaryRow {
  id: string;
  serverId: string;
  name: string | null;
  messageCount: number;
  lastMessageContent: string | null;
  createdAt: string;
  updatedAt: string;
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

  /** List session summaries without loading all messages (O(1) query). */
  listSummaries(
    serverId: string,
    userId: string,
    pagination: PaginationOptions,
  ): Promise<{ summaries: SessionSummaryRow[]; total: number }>;

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

  /** Update the session name. */
  updateName(id: string, userId: string, name: string): Promise<boolean>;

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
      name: null,
      messages: [],
      context: input.context ?? null,
      createdAt: now,
      updatedAt: now,
    }).run();

    return {
      id,
      userId: input.userId,
      serverId: input.serverId,
      name: null,
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

  async listSummaries(
    serverId: string,
    userId: string,
    pagination: PaginationOptions,
  ): Promise<{ summaries: SessionSummaryRow[]; total: number }> {
    if (!(await this.verifyServerOwnership(serverId, userId))) {
      return { summaries: [], total: 0 };
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
      .select({
        id: sessions.id,
        serverId: sessions.serverId,
        name: sessions.name,
        createdAt: sessions.createdAt,
        updatedAt: sessions.updatedAt,
        messageCount: sql<number>`json_array_length(${sessions.messages})`.as('message_count'),
        lastMessageContent: sql<string | null>`CASE WHEN json_array_length(${sessions.messages}) > 0 THEN json_extract(${sessions.messages}, '$[' || (json_array_length(${sessions.messages}) - 1) || '].content') ELSE NULL END`.as('last_message_content'),
      })
      .from(sessions)
      .where(
        and(eq(sessions.serverId, serverId), eq(sessions.userId, userId)),
      )
      .orderBy(desc(sessions.updatedAt))
      .limit(pagination.limit)
      .offset(pagination.offset)
      .all();

    return {
      summaries: rows.map((row) => ({
        id: row.id,
        serverId: row.serverId,
        name: row.name ?? null,
        messageCount: row.messageCount ?? 0,
        lastMessageContent: row.lastMessageContent ?? null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
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

  async updateName(id: string, userId: string, name: string): Promise<boolean> {
    const existing = await this.getById(id, userId);
    if (!existing) return false;

    this.db
      .update(sessions)
      .set({ name, updatedAt: new Date() })
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
      name: row.name ?? null,
      messages: (row.messages ?? []) as SessionMessage[],
      context: row.context ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

// ============================================================================
// InMemory Implementation (for testing)
// ============================================================================

export class InMemorySessionRepository implements SessionRepository {
  private sessions = new Map<string, Session>();

  async create(input: CreateSessionInput): Promise<Session> {
    const now = new Date().toISOString();
    const id = randomUUID();

    const session: Session = {
      id,
      userId: input.userId,
      serverId: input.serverId,
      name: null,
      messages: [],
      context: input.context ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.sessions.set(id, session);
    return session;
  }

  async getById(id: string, userId: string): Promise<Session | null> {
    const session = this.sessions.get(id);
    if (!session || session.userId !== userId) return null;
    return session;
  }

  async listByServer(
    serverId: string,
    userId: string,
    pagination: PaginationOptions,
  ): Promise<{ sessions: Session[]; total: number }> {
    const all = [...this.sessions.values()]
      .filter((s) => s.serverId === serverId && s.userId === userId)
      .sort((a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      );

    return {
      sessions: all.slice(pagination.offset, pagination.offset + pagination.limit),
      total: all.length,
    };
  }

  async listSummaries(
    serverId: string,
    userId: string,
    pagination: PaginationOptions,
  ): Promise<{ summaries: SessionSummaryRow[]; total: number }> {
    const all = [...this.sessions.values()]
      .filter((s) => s.serverId === serverId && s.userId === userId)
      .sort((a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      );

    const page = all.slice(pagination.offset, pagination.offset + pagination.limit);
    return {
      summaries: page.map((s) => ({
        id: s.id,
        serverId: s.serverId,
        name: s.name ?? null,
        messageCount: s.messages.length,
        lastMessageContent: s.messages.length > 0
          ? s.messages[s.messages.length - 1].content
          : null,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      })),
      total: all.length,
    };
  }

  async addMessage(
    id: string,
    userId: string,
    message: SessionMessage,
  ): Promise<boolean> {
    const session = this.sessions.get(id);
    if (!session || session.userId !== userId) return false;

    session.messages.push(message);
    session.updatedAt = new Date().toISOString();
    return true;
  }

  async updateContext(
    id: string,
    userId: string,
    context: SessionContext,
  ): Promise<boolean> {
    const session = this.sessions.get(id);
    if (!session || session.userId !== userId) return false;

    session.context = context;
    session.updatedAt = new Date().toISOString();
    return true;
  }

  async updateName(id: string, userId: string, name: string): Promise<boolean> {
    const session = this.sessions.get(id);
    if (!session || session.userId !== userId) return false;

    session.name = name;
    session.updatedAt = new Date().toISOString();
    return true;
  }

  async delete(id: string, userId: string): Promise<boolean> {
    const session = this.sessions.get(id);
    if (!session || session.userId !== userId) return false;

    this.sessions.delete(id);
    return true;
  }

  clear(): void {
    this.sessions.clear();
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
