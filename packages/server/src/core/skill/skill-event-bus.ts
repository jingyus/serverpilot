// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Skill execution event bus for real-time SSE streaming.
 *
 * Provides pub/sub for skill execution progress events: the SkillRunner
 * publishes events during tool execution, SSE endpoints subscribe per
 * executionId to push progress to the dashboard.
 *
 * @module core/skill/skill-event-bus
 */

import { EventEmitter } from 'node:events';

import type { SkillLogEventType } from '../../db/schema.js';

// ============================================================================
// Event Types
// ============================================================================

export type SkillEventType = 'step' | 'log' | 'completed' | 'error' | 'confirmation_required';

export interface SkillStepEvent {
  type: 'step';
  executionId: string;
  timestamp: string;
  tool: string;
  input?: Record<string, unknown>;
  result?: string;
  success?: boolean;
  duration?: number;
  phase: 'start' | 'complete';
}

export interface SkillLogEvent {
  type: 'log';
  executionId: string;
  timestamp: string;
  text: string;
}

export interface SkillCompletedEvent {
  type: 'completed';
  executionId: string;
  timestamp: string;
  status: 'success' | 'failed' | 'timeout' | 'cancelled';
  stepsExecuted: number;
  duration: number;
  output: string;
}

export interface SkillErrorEvent {
  type: 'error';
  executionId: string;
  timestamp: string;
  message: string;
}

export interface SkillConfirmationEvent {
  type: 'confirmation_required';
  executionId: string;
  timestamp: string;
  skillId: string;
  skillName: string;
  serverId: string;
  triggerType: string;
}

export type SkillEvent =
  | SkillStepEvent
  | SkillLogEvent
  | SkillCompletedEvent
  | SkillErrorEvent
  | SkillConfirmationEvent;

type SkillEventListener = (event: SkillEvent) => void;

// ============================================================================
// Log Persistence Hook
// ============================================================================

/**
 * Callback type for persisting events to DB.
 * Called asynchronously after each publish — failures are silently caught
 * so SSE delivery is never blocked.
 */
export type LogPersistFn = (
  executionId: string,
  eventType: SkillLogEventType,
  data: Record<string, unknown>,
) => Promise<void>;

// ============================================================================
// SkillEventBus
// ============================================================================

class SkillEventBus {
  private emitter = new EventEmitter();
  private persistFn: LogPersistFn | null = null;

  constructor() {
    this.emitter.setMaxListeners(200);
  }

  /**
   * Register an async persistence callback. Called fire-and-forget on every
   * publish so DB writes never block SSE delivery.
   */
  setPersistFn(fn: LogPersistFn | null): void {
    this.persistFn = fn;
  }

  /** Publish an event for a specific execution. */
  publish(executionId: string, event: SkillEvent): void {
    this.emitter.emit(`skill:${executionId}`, event);

    // Fire-and-forget DB persistence
    if (this.persistFn) {
      const { type, ...rest } = event;
      this.persistFn(executionId, type, rest as Record<string, unknown>).catch(() => {
        // Silently swallow — DB write failure must never break SSE
      });
    }
  }

  /** Subscribe to events for a specific execution. Returns unsubscribe fn. */
  subscribe(executionId: string, listener: SkillEventListener): () => void {
    const channel = `skill:${executionId}`;
    this.emitter.on(channel, listener);
    return () => {
      this.emitter.off(channel, listener);
    };
  }

  /** Get count of listeners for an execution (useful for tests). */
  listenerCount(executionId: string): number {
    return this.emitter.listenerCount(`skill:${executionId}`);
  }

  /** Remove all listeners (for testing). */
  removeAll(): void {
    this.emitter.removeAllListeners();
  }
}

// ============================================================================
// Singleton
// ============================================================================

let instance: SkillEventBus | null = null;

export function getSkillEventBus(): SkillEventBus {
  if (!instance) {
    instance = new SkillEventBus();
  }
  return instance;
}

/** Reset singleton (for testing). */
export function _resetSkillEventBus(): void {
  instance?.removeAll();
  instance = null;
}
