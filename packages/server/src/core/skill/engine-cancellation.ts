// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Skill execution cancellation logic, extracted from SkillEngine.
 *
 * Manages:
 * - `RunningExecutionTracker` — tracks running execution IDs and their AbortControllers
 * - `cancelExecution()` — abort a running execution and publish SSE notification
 *
 * @module core/skill/engine-cancellation
 */

import { createContextLogger } from '../../utils/logger.js';
import { getSkillEventBus } from './skill-event-bus.js';

const logger = createContextLogger({ module: 'skill-cancellation' });

/**
 * Tracks running skill executions and their AbortControllers.
 * Provides cancellation support and running-state queries.
 */
export class RunningExecutionTracker {
  private executions = new Map<string, AbortController>();

  /** Register a running execution. Called at the start of executeSingle(). */
  set(executionId: string, controller: AbortController): void {
    this.executions.set(executionId, controller);
  }

  /** Remove a completed execution. Called in the finally block of executeSingle(). */
  delete(executionId: string): void {
    this.executions.delete(executionId);
  }

  /** Check if a specific execution is currently running. */
  has(executionId: string): boolean {
    return this.executions.has(executionId);
  }

  /** Get the AbortController for a running execution. */
  get(executionId: string): AbortController | undefined {
    return this.executions.get(executionId);
  }

  /** Get all currently running execution IDs. */
  keys(): string[] {
    return Array.from(this.executions.keys());
  }
}

/**
 * Cancel a running skill execution.
 *
 * Aborts the execution via its AbortController and publishes an SSE error event
 * so the dashboard gets notified immediately.
 */
export function cancelExecution(
  tracker: RunningExecutionTracker,
  executionId: string,
): void {
  const controller = tracker.get(executionId);
  if (!controller) {
    throw new Error(`Execution not found or not running: ${executionId}`);
  }

  controller.abort();

  // Publish immediate SSE event so the dashboard gets notified right away
  const bus = getSkillEventBus();
  bus.publish(executionId, {
    type: 'error',
    executionId,
    timestamp: new Date().toISOString(),
    message: 'Execution cancelled by user',
  });

  logger.info({ executionId }, 'Skill execution cancel requested');
}
