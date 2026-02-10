/**
 * In-memory session manager for chat conversations.
 *
 * Tracks chat sessions per server, storing messages, plans,
 * and conversation context for AI interactions.
 *
 * @module core/session/manager
 */

import { randomUUID } from 'node:crypto';

// ============================================================================
// Types
// ============================================================================

/** A single chat message in a session */
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
}

/** A stored execution plan */
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
// SessionManager
// ============================================================================

export class SessionManager {
  /** Map<sessionId, Session> */
  private sessions = new Map<string, Session>();

  /** Get or create a session for a server */
  getOrCreate(serverId: string, sessionId?: string): Session {
    if (sessionId) {
      const existing = this.sessions.get(sessionId);
      if (existing && existing.serverId === serverId) {
        return existing;
      }
    }

    const id = randomUUID();
    const now = new Date().toISOString();
    const session: Session = {
      id,
      serverId,
      messages: [],
      plans: new Map(),
      createdAt: now,
      updatedAt: now,
    };
    this.sessions.set(id, session);
    return session;
  }

  /** Add a message to a session */
  addMessage(sessionId: string, role: ChatMessage['role'], content: string): ChatMessage {
    const session = this.sessions.get(sessionId);
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
    return message;
  }

  /** Store a generated plan in a session */
  storePlan(sessionId: string, plan: StoredPlan): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }
    session.plans.set(plan.planId, plan);
    session.updatedAt = new Date().toISOString();
  }

  /** Retrieve a stored plan */
  getPlan(sessionId: string, planId: string): StoredPlan | undefined {
    return this.sessions.get(sessionId)?.plans.get(planId);
  }

  /** List sessions for a server */
  listSessions(serverId: string): SessionSummary[] {
    const results: SessionSummary[] = [];
    for (const session of this.sessions.values()) {
      if (session.serverId === serverId) {
        const lastMsg = session.messages[session.messages.length - 1];
        results.push({
          id: session.id,
          serverId: session.serverId,
          messageCount: session.messages.length,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
          lastMessage: lastMsg?.content.slice(0, 100),
        });
      }
    }
    return results.sort((a, b) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  }

  /** Get a session by ID */
  getSession(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  /** Delete a session */
  deleteSession(sessionId: string, serverId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session || session.serverId !== serverId) {
      return false;
    }
    return this.sessions.delete(sessionId);
  }

  /** Build conversation context for AI from session messages */
  buildContext(sessionId: string): string {
    const session = this.sessions.get(sessionId);
    if (!session || session.messages.length === 0) {
      return '';
    }

    return session.messages
      .map((m) => `${m.role}: ${m.content}`)
      .join('\n\n');
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

/** Reset for testing */
export function _resetSessionManager(): void {
  _instance = null;
}
