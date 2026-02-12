// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Persistent session manager for chat conversations.
 *
 * Uses SessionRepository (SQLite) as the persistence backend with
 * an in-memory cache for active sessions and plans.
 *
 * Plans remain in-memory only (ephemeral, tied to active execution flows).
 *
 * @module core/session/manager
 */

import { randomUUID } from 'node:crypto';
import {
  getSessionRepository,
} from '../../db/repositories/session-repository.js';
import type { SessionRepository } from '../../db/repositories/session-repository.js';
import type { SessionMessage } from '../../db/schema.js';
import { estimateTokens } from '../../ai/profile-context.js';
import { logger } from '../../utils/logger.js';

// ============================================================================
// Types
// ============================================================================

/** A single chat message in a session (used by routes and tests) */
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
}

/** A stored execution plan (in-memory only) */
export interface StoredPlan {
  planId: string;
  description: string;
  steps: PlanStep[];
  totalRisk: string;
  requiresConfirmation: boolean;
  estimatedTime?: number;
}

export interface PlanStep {
  id: string;
  description: string;
  command: string;
  riskLevel: string;
  rollbackCommand?: string;
  timeout: number;
  canRollback: boolean;
}

/** Summary of a session (returned in list endpoints) */
export interface SessionSummary {
  id: string;
  serverId: string;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
  lastMessage?: string;
}

/** Full session with messages */
export interface Session {
  id: string;
  serverId: string;
  messages: ChatMessage[];
  plans: Map<string, StoredPlan>;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// Helpers: convert between ChatMessage (ISO string) and SessionMessage (number)
// ============================================================================

function toSessionMessage(msg: ChatMessage): SessionMessage {
  return {
    id: msg.id,
    role: msg.role,
    content: msg.content,
    timestamp: new Date(msg.timestamp).getTime(),
  };
}

function toChatMessage(msg: SessionMessage): ChatMessage {
  return {
    id: msg.id,
    role: msg.role,
    content: msg.content,
    timestamp: new Date(msg.timestamp).toISOString(),
  };
}

// ============================================================================
// SessionManager (backed by SessionRepository)
// ============================================================================

export class SessionManager {
  private repo: SessionRepository;
  /** In-memory cache: sessionId → Session (with plans) */
  private cache = new Map<string, Session>();

  constructor(repo?: SessionRepository) {
    this.repo = repo ?? getSessionRepository();
  }

  /** Get or create a session for a server. userId required for DB persistence. */
  async getOrCreate(serverId: string, userId: string, sessionId?: string): Promise<Session> {
    // Try cache first
    if (sessionId) {
      const cached = this.cache.get(sessionId);
      if (cached && cached.serverId === serverId) {
        return cached;
      }
    }

    // Try loading from DB
    if (sessionId) {
      const dbSession = await this.repo.getById(sessionId, userId);
      if (dbSession && dbSession.serverId === serverId) {
        const session = this.dbToSession(dbSession);
        this.cache.set(session.id, session);
        return session;
      }
    }

    // Create new session in DB
    const created = await this.repo.create({ userId, serverId });
    const session: Session = {
      id: created.id,
      serverId: created.serverId,
      messages: [],
      plans: new Map(),
      createdAt: created.createdAt,
      updatedAt: created.updatedAt,
    };
    this.cache.set(session.id, session);
    return session;
  }

  /** Add a message to a session. Persists to DB. */
  async addMessage(
    sessionId: string,
    userId: string,
    role: ChatMessage['role'],
    content: string,
  ): Promise<ChatMessage> {
    const session = this.cache.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const message: ChatMessage = {
      id: randomUUID(),
      role,
      content,
      timestamp: new Date().toISOString(),
    };

    session.messages.push(message);
    session.updatedAt = new Date().toISOString();

    // Persist to DB (fire-and-forget to not block SSE streaming)
    this.persistMessage(sessionId, userId, toSessionMessage(message));

    return message;
  }

  /** Store a generated plan in a session (in-memory only). */
  storePlan(sessionId: string, plan: StoredPlan): void {
    const session = this.cache.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }
    session.plans.set(plan.planId, plan);
    session.updatedAt = new Date().toISOString();
  }

  /** Retrieve a stored plan (in-memory only). */
  getPlan(sessionId: string, planId: string): StoredPlan | undefined {
    return this.cache.get(sessionId)?.plans.get(planId);
  }

  /** List sessions for a server. Loads from DB for complete history. */
  async listSessions(serverId: string, userId: string): Promise<SessionSummary[]> {
    const result = await this.repo.listByServer(serverId, userId, {
      limit: 100,
      offset: 0,
    });

    return result.sessions.map((s) => {
      const messages = s.messages.map(toChatMessage);
      const lastMsg = messages[messages.length - 1];
      return {
        id: s.id,
        serverId: s.serverId,
        messageCount: messages.length,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        lastMessage: lastMsg?.content.slice(0, 100),
      };
    });
  }

  /** Get a session by ID. Checks cache first, then DB. */
  async getSession(sessionId: string, userId: string): Promise<Session | undefined> {
    const cached = this.cache.get(sessionId);
    if (cached) return cached;

    const dbSession = await this.repo.getById(sessionId, userId);
    if (!dbSession) return undefined;

    const session = this.dbToSession(dbSession);
    this.cache.set(session.id, session);
    return session;
  }

  /** Delete a session from both cache and DB. */
  async deleteSession(sessionId: string, serverId: string, userId: string): Promise<boolean> {
    const session = this.cache.get(sessionId);
    if (session) {
      if (session.serverId !== serverId) return false;
      this.cache.delete(sessionId);
    }

    return this.repo.delete(sessionId, userId);
  }

  /** Build conversation context for AI from session messages. */
  buildContext(sessionId: string): string {
    const session = this.cache.get(sessionId);
    if (!session || session.messages.length === 0) {
      return '';
    }

    return session.messages
      .map((m) => `${m.role}: ${m.content}`)
      .join('\n\n');
  }

  /**
   * Build conversation context with a token budget limit.
   *
   * Strategy: keep the most recent messages that fit within the budget.
   * When truncation occurs, prepends a `[Earlier conversation summarized]` marker.
   *
   * @param sessionId - Session to build context from
   * @param maxTokens - Maximum token budget for the context string (default: 8000)
   * @returns Formatted context string within the token budget
   */
  buildContextWithLimit(sessionId: string, maxTokens = 8000): string {
    const session = this.cache.get(sessionId);
    if (!session || session.messages.length === 0) {
      return '';
    }

    const messages = session.messages;
    const formatted = messages.map((m) => `${m.role}: ${m.content}`);

    // Check if all messages fit within the budget
    const fullText = formatted.join('\n\n');
    if (estimateTokens(fullText) <= maxTokens) {
      return fullText;
    }

    // Truncation needed: keep messages from the end, within budget
    const marker = '[Earlier conversation summarized — only recent messages shown]\n\n';
    const markerTokens = estimateTokens(marker);
    const availableTokens = maxTokens - markerTokens;

    const selected: string[] = [];
    let usedTokens = 0;

    // Walk backwards, keeping recent messages
    for (let i = formatted.length - 1; i >= 0; i--) {
      const msgTokens = estimateTokens(formatted[i]);
      // Account for separator between messages
      const separatorTokens = selected.length > 0 ? estimateTokens('\n\n') : 0;

      if (usedTokens + msgTokens + separatorTokens > availableTokens) {
        break;
      }

      selected.unshift(formatted[i]);
      usedTokens += msgTokens + separatorTokens;
    }

    // If we kept all messages, no marker needed (edge case: budget barely fits)
    if (selected.length === formatted.length) {
      return selected.join('\n\n');
    }

    return marker + selected.join('\n\n');
  }

  /**
   * Build conversation history as a message array with token limit.
   *
   * Used by the agentic engine which needs `{ role, content }[]` format.
   * Keeps the most recent messages that fit within the token budget.
   *
   * @param sessionId - Session to build history from
   * @param maxTokens - Maximum token budget (default: 40000)
   * @returns Array of messages within budget, excluding the latest user message
   */
  buildHistoryWithLimit(
    sessionId: string,
    maxTokens = 40000,
  ): Array<{ role: 'user' | 'assistant'; content: string }> {
    const session = this.cache.get(sessionId);
    if (!session || session.messages.length === 0) {
      return [];
    }

    // Filter to user/assistant only, exclude the last message (current user message)
    const eligible = session.messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .slice(0, -1);

    if (eligible.length === 0) {
      return [];
    }

    // Check if everything fits
    const totalTokens = eligible.reduce(
      (sum, m) => sum + estimateTokens(m.content),
      0,
    );

    if (totalTokens <= maxTokens) {
      return eligible.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));
    }

    // Keep recent messages within budget
    const selected: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    let usedTokens = 0;

    for (let i = eligible.length - 1; i >= 0; i--) {
      const msgTokens = estimateTokens(eligible[i].content);
      if (usedTokens + msgTokens > maxTokens) {
        break;
      }
      selected.unshift({
        role: eligible[i].role as 'user' | 'assistant',
        content: eligible[i].content,
      });
      usedTokens += msgTokens;
    }

    return selected;
  }

  /**
   * Persist a message to the DB with one retry.
   * Never throws — errors are logged but don't block the SSE stream.
   */
  private async persistMessage(
    sessionId: string,
    userId: string,
    message: SessionMessage,
  ): Promise<void> {
    try {
      await this.repo.addMessage(sessionId, userId, message);
    } catch (firstError) {
      logger.warn(
        { sessionId, messageId: message.id, error: firstError },
        'Message persistence failed, retrying in 500ms',
      );
      await new Promise((r) => setTimeout(r, 500));
      try {
        await this.repo.addMessage(sessionId, userId, message);
        logger.info({ sessionId, messageId: message.id }, 'Message persistence retry succeeded');
      } catch (retryError) {
        logger.error(
          { sessionId, messageId: message.id, error: retryError },
          'Message persistence failed after retry — message only in memory cache',
        );
      }
    }
  }

  /** Convert DB session to in-memory Session format. */
  private dbToSession(
    dbSession: { id: string; serverId: string; messages: SessionMessage[]; createdAt: string; updatedAt: string },
  ): Session {
    return {
      id: dbSession.id,
      serverId: dbSession.serverId,
      messages: dbSession.messages.map(toChatMessage),
      plans: new Map(),
      createdAt: dbSession.createdAt,
      updatedAt: dbSession.updatedAt,
    };
  }
}

// ============================================================================
// Singleton
// ============================================================================

let _instance: SessionManager | null = null;

export function getSessionManager(): SessionManager {
  if (!_instance) {
    _instance = new SessionManager();
  }
  return _instance;
}

export function setSessionManager(mgr: SessionManager): void {
  _instance = mgr;
}

/** Reset for testing */
export function _resetSessionManager(): void {
  _instance = null;
}
