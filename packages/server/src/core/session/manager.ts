// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Persistent session manager for chat conversations.
 *
 * Uses SessionRepository (SQLite) as the persistence backend with
 * an LRU in-memory cache for active sessions and plans.
 *
 * Cache eviction: LRU with TTL. Sessions with active plans are protected
 * from eviction. Evicted sessions are reloaded from DB on next access.
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
import { SessionCache } from './session-cache.js';
import type { CacheOptions } from './session-cache.js';
import { RetryQueue } from './session-retry-queue.js';
import type { RetryQueueOptions } from './session-retry-queue.js';

// ============================================================================
// Types
// ============================================================================

/** A single chat message in a session (used by routes and tests) */
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  /** Whether this message has been persisted to DB. Defaults to true for DB-loaded messages. */
  persisted?: boolean;
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
  name?: string | null;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
  lastMessage?: string;
}

/** Full session with messages */
export interface Session {
  id: string;
  serverId: string;
  name?: string | null;
  messages: ChatMessage[];
  plans: Map<string, StoredPlan>;
  createdAt: string;
  updatedAt: string;
}

/** Callback invoked when async message persistence fails after all retries. */
export type PersistenceFailureCallback = (
  sessionId: string,
  messageId: string,
) => void;

/** Combined cache + retry configuration for SessionManager */
export interface SessionCacheOptions extends CacheOptions, RetryQueueOptions {}

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
  private cache: SessionCache;
  private retryQueue: RetryQueue;
  private cacheReloadCount = 0;

  constructor(repo?: SessionRepository, cacheOptions?: Partial<SessionCacheOptions>) {
    this.repo = repo ?? getSessionRepository();
    this.cache = new SessionCache(cacheOptions);
    this.retryQueue = new RetryQueue(this.repo, this.cache, cacheOptions);
  }

  // ==========================================================================
  // Delegated cache/retry accessors (preserve public API)
  // ==========================================================================

  /** Stop sweep and retry timers (for cleanup/testing). */
  stopSweep(): void {
    this.cache.stopSweep();
    this.retryQueue.stop();
  }

  /** Set a callback to be invoked when async persistence fails after all retries. */
  set onPersistenceFailure(cb: PersistenceFailureCallback | null) {
    this.retryQueue.onPersistenceFailure = cb;
  }

  /** Get current cache size (for monitoring/testing). */
  get cacheSize(): number {
    return this.cache.size;
  }

  /** Get count of sessions reloaded from DB after cache eviction (for monitoring/testing). */
  get cacheReloads(): number {
    return this.cacheReloadCount;
  }

  /** Get number of messages pending in the retry queue (for monitoring/testing). */
  get pendingRetryCount(): number {
    return this.retryQueue.pendingCount;
  }

  /** Delegate: sweep expired cache entries (used by tests via type cast). */
  private sweepExpired(): void {
    this.cache.sweepExpired();
  }

  /** Delegate: process retry queue (used by tests via type cast). */
  private async processRetryQueue(): Promise<void> {
    return this.retryQueue.processQueue();
  }

  // ==========================================================================
  // Public API
  // ==========================================================================

  /** Get or create a session for a server. userId required for DB persistence. */
  async getOrCreate(serverId: string, userId: string, sessionId?: string): Promise<Session> {
    if (sessionId) {
      const cached = this.cache.get(sessionId);
      if (cached && cached.serverId === serverId) {
        return cached;
      }
    }

    if (sessionId) {
      const dbSession = await this.repo.getById(sessionId, userId);
      if (dbSession && dbSession.serverId === serverId) {
        const session = this.dbToSession(dbSession);
        this.cache.put(session);
        return session;
      }
    }

    const created = await this.repo.create({ userId, serverId });
    const session: Session = {
      id: created.id,
      serverId: created.serverId,
      messages: [],
      plans: new Map(),
      createdAt: created.createdAt,
      updatedAt: created.updatedAt,
    };
    this.cache.put(session);
    return session;
  }

  /**
   * Add a message to a session. Persists to DB.
   *
   * - User messages (role=user) are persisted synchronously — the caller awaits DB write.
   * - Assistant/system messages are persisted asynchronously (fire-and-forget) with a retry queue
   *   so they don't block SSE streaming.
   *
   * Auto-reloads from DB on cache miss.
   */
  async addMessage(
    sessionId: string,
    userId: string,
    role: ChatMessage['role'],
    content: string,
  ): Promise<ChatMessage> {
    let session = this.cache.get(sessionId);
    if (!session) {
      const dbSession = await this.repo.getById(sessionId, userId);
      if (!dbSession) {
        throw new Error(`Session ${sessionId} not found`);
      }
      session = this.dbToSession(dbSession);
      this.cache.put(session);
      this.cacheReloadCount++;
      logger.info(
        { sessionId, cacheReloadCount: this.cacheReloadCount },
        'Session reloaded from DB after cache eviction',
      );
    }

    const message: ChatMessage = {
      id: randomUUID(),
      role,
      content,
      timestamp: new Date().toISOString(),
      persisted: false,
    };

    session.messages.push(message);
    session.updatedAt = new Date().toISOString();

    const sessionMsg = toSessionMessage(message);

    if (role === 'user') {
      await this.persistMessageSync(sessionId, userId, sessionMsg);
      message.persisted = true;
    } else {
      this.persistMessageAsync(sessionId, userId, sessionMsg, message);
    }

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
    const session = this.cache.get(sessionId);
    if (!session) return undefined;
    return session.plans.get(planId);
  }

  /** Remove a completed plan from a session, allowing cache eviction. */
  removePlan(sessionId: string, planId: string): boolean {
    // Use peek (no touch) so TTL can sweep this session after plan removal
    const session = this.cache.peek(sessionId);
    if (!session) return false;
    return session.plans.delete(planId);
  }

  /** List sessions for a server. Uses lightweight summaries (no full message loading). */
  async listSessions(serverId: string, userId: string): Promise<SessionSummary[]> {
    const result = await this.repo.listSummaries(serverId, userId, {
      limit: 100,
      offset: 0,
    });

    return result.summaries.map((s) => ({
      id: s.id,
      serverId: s.serverId,
      name: s.name,
      messageCount: s.messageCount,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      lastMessage: s.lastMessageContent?.slice(0, 100),
    }));
  }

  /** Get a session by ID. Checks cache first, then DB. */
  async getSession(sessionId: string, userId: string): Promise<Session | undefined> {
    const cached = this.cache.get(sessionId);
    if (cached) return cached;

    const dbSession = await this.repo.getById(sessionId, userId);
    if (!dbSession) return undefined;

    const session = this.dbToSession(dbSession);
    this.cache.put(session);
    return session;
  }

  /** Rename a session. Updates both cache and DB. */
  async renameSession(sessionId: string, serverId: string, userId: string, name: string): Promise<boolean> {
    const cached = this.cache.get(sessionId);
    if (cached) {
      if (cached.serverId !== serverId) return false;
      cached.name = name;
      cached.updatedAt = new Date().toISOString();
    }
    return this.repo.updateName(sessionId, userId, name);
  }

  /** Delete a session from both cache and DB. */
  async deleteSession(sessionId: string, serverId: string, userId: string): Promise<boolean> {
    const session = this.cache.peek(sessionId);
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
   */
  buildContextWithLimit(sessionId: string, maxTokens = 8000): string {
    const session = this.cache.get(sessionId);
    if (!session || session.messages.length === 0) {
      return '';
    }

    const messages = session.messages;
    const formatted = messages.map((m) => `${m.role}: ${m.content}`);

    const fullText = formatted.join('\n\n');
    if (estimateTokens(fullText) <= maxTokens) {
      return fullText;
    }

    const marker = '[Earlier conversation summarized — only recent messages shown]\n\n';
    const markerTokens = estimateTokens(marker);
    const availableTokens = maxTokens - markerTokens;

    const selected: string[] = [];
    let usedTokens = 0;

    for (let i = formatted.length - 1; i >= 0; i--) {
      const msgTokens = estimateTokens(formatted[i]);
      const separatorTokens = selected.length > 0 ? estimateTokens('\n\n') : 0;

      if (usedTokens + msgTokens + separatorTokens > availableTokens) {
        break;
      }

      selected.unshift(formatted[i]);
      usedTokens += msgTokens + separatorTokens;
    }

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
   */
  buildHistoryWithLimit(
    sessionId: string,
    maxTokens = 40000,
  ): Array<{ role: 'user' | 'assistant'; content: string }> {
    const session = this.cache.get(sessionId);
    if (!session || session.messages.length === 0) {
      return [];
    }

    const eligible = session.messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .slice(0, -1);

    if (eligible.length === 0) {
      return [];
    }

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

    if (selected.length < eligible.length) {
      const removed = eligible.length - selected.length;
      selected.unshift({
        role: 'user',
        content:
          `[System: Earlier conversation context was truncated. ` +
          `${removed} messages removed. ` +
          `If you need information from earlier steps, re-read the relevant files.]`,
      });
    }

    return selected;
  }

  // ==========================================================================
  // Persistence helpers
  // ==========================================================================

  /**
   * Persist a user message synchronously with one retry.
   * Throws if both attempts fail — callers should handle the error.
   */
  private async persistMessageSync(
    sessionId: string,
    userId: string,
    message: SessionMessage,
  ): Promise<void> {
    try {
      await this.repo.addMessage(sessionId, userId, message);
    } catch (firstError) {
      logger.warn(
        { sessionId, messageId: message.id, error: firstError },
        'User message persistence failed, retrying once',
      );
      try {
        await this.repo.addMessage(sessionId, userId, message);
        logger.info({ sessionId, messageId: message.id }, 'User message persistence retry succeeded');
      } catch (retryError) {
        logger.error(
          { sessionId, messageId: message.id, error: retryError },
          'User message persistence failed after retry',
        );
        throw retryError;
      }
    }
  }

  /**
   * Persist an assistant/system message asynchronously.
   * Tries once immediately, then enqueues to the retry queue on failure.
   */
  private persistMessageAsync(
    sessionId: string,
    userId: string,
    sessionMsg: SessionMessage,
    chatMsg: ChatMessage,
  ): void {
    this.repo.addMessage(sessionId, userId, sessionMsg).then(
      () => { chatMsg.persisted = true; },
      (error) => {
        logger.warn(
          { sessionId, messageId: sessionMsg.id, error },
          'Async message persistence failed, enqueueing for retry',
        );
        this.retryQueue.enqueue(sessionId, userId, sessionMsg);
      },
    );
  }

  /** Convert DB session to in-memory Session format. */
  private dbToSession(
    dbSession: { id: string; serverId: string; name?: string | null; messages: SessionMessage[]; createdAt: string; updatedAt: string },
  ): Session {
    return {
      id: dbSession.id,
      serverId: dbSession.serverId,
      name: dbSession.name ?? null,
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
  if (_instance) {
    _instance.stopSweep();
  }
  _instance = null;
}
