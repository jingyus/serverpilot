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

/** Callback invoked when async message persistence fails after all retries. */
export type PersistenceFailureCallback = (
  sessionId: string,
  messageId: string,
) => void;

/** Cache configuration for SessionManager */
export interface SessionCacheOptions {
  /** Maximum number of sessions in cache (default: 100) */
  maxSize: number;
  /** TTL in milliseconds for inactive sessions (default: 30 minutes) */
  ttlMs: number;
  /** Interval for TTL sweep in milliseconds (default: 60 seconds) */
  sweepIntervalMs: number;
  /** Interval for retry queue sweep in milliseconds (default: 5 seconds) */
  retryIntervalMs: number;
  /** Maximum number of retry attempts for queued messages (default: 5) */
  maxRetryAttempts: number;
}

const DEFAULT_CACHE_OPTIONS: SessionCacheOptions = {
  maxSize: 100,
  ttlMs: 30 * 60 * 1000,       // 30 minutes
  sweepIntervalMs: 60 * 1000,   // 1 minute
  retryIntervalMs: 5 * 1000,    // 5 seconds
  maxRetryAttempts: 5,
};

/** Internal cache entry wrapping a Session with access tracking */
interface CacheEntry {
  session: Session;
  lastAccessedAt: number;
}

/** Entry in the persistence retry queue */
interface RetryEntry {
  sessionId: string;
  userId: string;
  message: SessionMessage;
  attempts: number;
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
  private cache = new Map<string, CacheEntry>();
  private cacheOptions: SessionCacheOptions;
  private sweepTimer: ReturnType<typeof setInterval> | null = null;
  private retryTimer: ReturnType<typeof setInterval> | null = null;
  private retryQueue: RetryEntry[] = [];
  private cacheReloadCount = 0;
  private _onPersistenceFailure: PersistenceFailureCallback | null = null;

  constructor(repo?: SessionRepository, cacheOptions?: Partial<SessionCacheOptions>) {
    this.repo = repo ?? getSessionRepository();
    this.cacheOptions = { ...DEFAULT_CACHE_OPTIONS, ...cacheOptions };
    this.startSweep();
    this.startRetryQueue();
  }

  // ==========================================================================
  // Cache internals
  // ==========================================================================

  /** Touch a cache entry to mark it as recently accessed. */
  private touchEntry(entry: CacheEntry): void {
    entry.lastAccessedAt = Date.now();
  }

  /** Get a session from cache, updating its access timestamp. */
  private cacheGet(sessionId: string): Session | undefined {
    const entry = this.cache.get(sessionId);
    if (!entry) return undefined;
    this.touchEntry(entry);
    return entry.session;
  }

  /** Insert a session into cache, evicting LRU entries if needed. */
  private cachePut(session: Session): void {
    // If already cached, just update
    const existing = this.cache.get(session.id);
    if (existing) {
      existing.session = session;
      this.touchEntry(existing);
      return;
    }
    this.evictIfNeeded();
    this.cache.set(session.id, { session, lastAccessedAt: Date.now() });
  }

  /** Remove a session from cache. */
  private cacheDelete(sessionId: string): void {
    this.cache.delete(sessionId);
  }

  /** Check if a session has active plans (should not be evicted). */
  private isActive(entry: CacheEntry): boolean {
    return entry.session.plans.size > 0;
  }

  /**
   * Evict the least-recently-used non-active entry if cache is at capacity.
   * Active sessions (with plans) are protected from eviction.
   */
  private evictIfNeeded(): void {
    if (this.cache.size < this.cacheOptions.maxSize) return;

    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this.cache) {
      if (this.isActive(entry)) continue;
      if (entry.lastAccessedAt < oldestTime) {
        oldestTime = entry.lastAccessedAt;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
      logger.debug({ sessionId: oldestKey, cacheSize: this.cache.size }, 'Session evicted from cache (LRU)');
    } else {
      logger.warn(
        { cacheSize: this.cache.size, maxSize: this.cacheOptions.maxSize },
        'Cache full — all sessions have active plans, cannot evict',
      );
    }
  }

  /** Sweep expired entries (TTL-based). Protected sessions are skipped. */
  private sweepExpired(): void {
    const now = Date.now();
    const expiry = this.cacheOptions.ttlMs;
    let evicted = 0;

    for (const [key, entry] of this.cache) {
      if (this.isActive(entry)) continue;
      if (now - entry.lastAccessedAt > expiry) {
        this.cache.delete(key);
        evicted++;
      }
    }

    if (evicted > 0) {
      logger.debug({ evicted, cacheSize: this.cache.size }, 'TTL sweep evicted sessions');
    }
  }

  /** Start periodic TTL sweep timer. */
  private startSweep(): void {
    if (this.cacheOptions.sweepIntervalMs <= 0) return;
    this.sweepTimer = setInterval(() => this.sweepExpired(), this.cacheOptions.sweepIntervalMs);
    this.sweepTimer.unref();
  }

  /** Stop the sweep timer (for cleanup/testing). */
  stopSweep(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
    if (this.retryTimer) {
      clearInterval(this.retryTimer);
      this.retryTimer = null;
    }
  }

  /** Start periodic retry queue processing. */
  private startRetryQueue(): void {
    if (this.cacheOptions.retryIntervalMs <= 0) return;
    this.retryTimer = setInterval(() => this.processRetryQueue(), this.cacheOptions.retryIntervalMs);
    this.retryTimer.unref();
  }

  /** Process queued persistence retries. */
  private async processRetryQueue(): Promise<void> {
    if (this.retryQueue.length === 0) return;

    const batch = this.retryQueue.splice(0, this.retryQueue.length);
    const requeue: RetryEntry[] = [];

    for (const entry of batch) {
      try {
        await this.repo.addMessage(entry.sessionId, entry.userId, entry.message);
        // Mark in-memory message as persisted
        this.markMessagePersisted(entry.sessionId, entry.message.id);
        logger.info(
          { sessionId: entry.sessionId, messageId: entry.message.id, attempt: entry.attempts + 1 },
          'Retry queue: message persisted successfully',
        );
      } catch {
        entry.attempts++;
        if (entry.attempts < this.cacheOptions.maxRetryAttempts) {
          requeue.push(entry);
        } else {
          logger.error(
            { sessionId: entry.sessionId, messageId: entry.message.id, attempts: entry.attempts },
            'Retry queue: message persistence exhausted — message lost on restart',
          );
          this._onPersistenceFailure?.(entry.sessionId, entry.message.id);
        }
      }
    }

    if (requeue.length > 0) {
      this.retryQueue.push(...requeue);
    }
  }

  /** Mark a cached message as persisted. */
  private markMessagePersisted(sessionId: string, messageId: string): void {
    const entry = this.cache.get(sessionId);
    if (!entry) return;
    const msg = entry.session.messages.find((m) => m.id === messageId);
    if (msg) msg.persisted = true;
  }

  /** Set a callback to be invoked when async persistence fails after all retries. */
  set onPersistenceFailure(cb: PersistenceFailureCallback | null) {
    this._onPersistenceFailure = cb;
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
    return this.retryQueue.length;
  }

  // ==========================================================================
  // Public API
  // ==========================================================================

  /** Get or create a session for a server. userId required for DB persistence. */
  async getOrCreate(serverId: string, userId: string, sessionId?: string): Promise<Session> {
    // Try cache first
    if (sessionId) {
      const cached = this.cacheGet(sessionId);
      if (cached && cached.serverId === serverId) {
        return cached;
      }
    }

    // Try loading from DB
    if (sessionId) {
      const dbSession = await this.repo.getById(sessionId, userId);
      if (dbSession && dbSession.serverId === serverId) {
        const session = this.dbToSession(dbSession);
        this.cachePut(session);
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
    this.cachePut(session);
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
    let entry = this.cache.get(sessionId);
    if (!entry) {
      // Cache miss — attempt to reload from DB (session may have been evicted)
      const dbSession = await this.repo.getById(sessionId, userId);
      if (!dbSession) {
        throw new Error(`Session ${sessionId} not found`);
      }
      const session = this.dbToSession(dbSession);
      this.cachePut(session);
      entry = this.cache.get(sessionId)!;
      this.cacheReloadCount++;
      logger.info(
        { sessionId, cacheReloadCount: this.cacheReloadCount },
        'Session reloaded from DB after cache eviction',
      );
    }
    this.touchEntry(entry);

    const message: ChatMessage = {
      id: randomUUID(),
      role,
      content,
      timestamp: new Date().toISOString(),
      persisted: false,
    };

    entry.session.messages.push(message);
    entry.session.updatedAt = new Date().toISOString();

    const sessionMsg = toSessionMessage(message);

    if (role === 'user') {
      // User messages: synchronous persistence — caller knows if it failed
      await this.persistMessageSync(sessionId, userId, sessionMsg);
      message.persisted = true;
    } else {
      // Assistant/system: fire-and-forget with retry queue fallback
      this.persistMessageAsync(sessionId, userId, sessionMsg, message);
    }

    return message;
  }

  /** Store a generated plan in a session (in-memory only). */
  storePlan(sessionId: string, plan: StoredPlan): void {
    const entry = this.cache.get(sessionId);
    if (!entry) {
      throw new Error(`Session ${sessionId} not found`);
    }
    this.touchEntry(entry);
    entry.session.plans.set(plan.planId, plan);
    entry.session.updatedAt = new Date().toISOString();
  }

  /** Retrieve a stored plan (in-memory only). */
  getPlan(sessionId: string, planId: string): StoredPlan | undefined {
    const entry = this.cache.get(sessionId);
    if (!entry) return undefined;
    this.touchEntry(entry);
    return entry.session.plans.get(planId);
  }

  /** Remove a completed plan from a session, allowing cache eviction. */
  removePlan(sessionId: string, planId: string): boolean {
    const entry = this.cache.get(sessionId);
    if (!entry) return false;
    return entry.session.plans.delete(planId);
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
      messageCount: s.messageCount,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      lastMessage: s.lastMessageContent?.slice(0, 100),
    }));
  }

  /** Get a session by ID. Checks cache first, then DB. */
  async getSession(sessionId: string, userId: string): Promise<Session | undefined> {
    const cached = this.cacheGet(sessionId);
    if (cached) return cached;

    const dbSession = await this.repo.getById(sessionId, userId);
    if (!dbSession) return undefined;

    const session = this.dbToSession(dbSession);
    this.cachePut(session);
    return session;
  }

  /** Delete a session from both cache and DB. */
  async deleteSession(sessionId: string, serverId: string, userId: string): Promise<boolean> {
    const entry = this.cache.get(sessionId);
    if (entry) {
      if (entry.session.serverId !== serverId) return false;
      this.cacheDelete(sessionId);
    }

    return this.repo.delete(sessionId, userId);
  }

  /** Build conversation context for AI from session messages. */
  buildContext(sessionId: string): string {
    const session = this.cacheGet(sessionId);
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
    const session = this.cacheGet(sessionId);
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
    const session = this.cacheGet(sessionId);
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

    return selected;
  }

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
   * Never throws — errors are queued for background retry.
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
        this.retryQueue.push({
          sessionId,
          userId,
          message: sessionMsg,
          attempts: 1,
        });
      },
    );
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
  if (_instance) {
    _instance.stopSweep();
  }
  _instance = null;
}
