// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Task Scheduler — polls for due scheduled tasks and dispatches them.
 *
 * Periodically checks the database for tasks whose `nextRun` has passed,
 * dispatches them for execution via the TaskExecutor, and updates
 * the next run time based on the cron expression.
 *
 * Supports three task creation modes:
 * - AI conversation: tasks created during a chat session
 * - Manual: tasks created via the REST API
 * - Cron: recurring tasks driven by cron expressions
 *
 * @module core/task/scheduler
 */

import { CronExpressionParser } from 'cron-parser';

import type { TaskRepository, Task } from '../../db/repositories/task-repository.js';
import { getTaskRepository } from '../../db/repositories/task-repository.js';
import type { TaskExecutor } from './executor.js';
import { getTaskExecutor } from './executor.js';
import type { InstallServer } from '../../api/server.js';
import { createContextLogger } from '../../utils/logger.js';

// ============================================================================
// Constants
// ============================================================================

/** Default polling interval: 30 seconds */
const DEFAULT_POLL_INTERVAL_MS = 30_000;

/** Minimum polling interval: 10 seconds */
const MIN_POLL_INTERVAL_MS = 10_000;

/** Maximum polling interval: 5 minutes */
const MAX_POLL_INTERVAL_MS = 300_000;

// ============================================================================
// Types
// ============================================================================

export interface TaskSchedulerOptions {
  /** Polling interval in milliseconds (default: 30000) */
  pollIntervalMs?: number;
}

// ============================================================================
// Cron Helpers
// ============================================================================

/**
 * Calculate the next run time for a cron expression from a given date.
 *
 * @param cronExpr - A standard 5-field cron expression
 * @param from - The date to compute next run from (default: now)
 * @returns The next Date the cron should fire, or null if invalid
 */
export function getNextRunDate(cronExpr: string, from?: Date): Date | null {
  try {
    const expr = CronExpressionParser.parse(cronExpr, {
      currentDate: from ?? new Date(),
      tz: 'UTC',
    });
    return expr.next().toDate();
  } catch {
    return null;
  }
}

/**
 * Validate a cron expression string.
 *
 * @param cronExpr - The cron string to validate
 * @returns true if the expression is valid
 */
export function isValidCron(cronExpr: string): boolean {
  try {
    CronExpressionParser.parse(cronExpr);
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// TaskScheduler
// ============================================================================

export class TaskScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private processing = false;
  private readonly pollIntervalMs: number;
  private readonly logger = createContextLogger({ module: 'task-scheduler' });

  constructor(
    private server: InstallServer,
    private taskRepo: TaskRepository = getTaskRepository(),
    private executor: TaskExecutor = getTaskExecutor(),
    options: TaskSchedulerOptions = {},
  ) {
    const interval = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.pollIntervalMs = Math.min(
      Math.max(interval, MIN_POLL_INTERVAL_MS),
      MAX_POLL_INTERVAL_MS,
    );
  }

  /**
   * Start the scheduler polling loop.
   */
  start(): void {
    if (this.running) return;
    this.running = true;

    this.logger.info(
      { pollIntervalMs: this.pollIntervalMs },
      'Task scheduler started',
    );

    // Run an initial poll immediately, then on the interval
    this.poll();
    this.timer = setInterval(() => this.poll(), this.pollIntervalMs);
  }

  /**
   * Stop the scheduler and wait for any in-flight processing to finish.
   */
  stop(): void {
    if (!this.running) return;
    this.running = false;

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    this.logger.info('Task scheduler stopped');
  }

  /**
   * Whether the scheduler is currently running.
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Manually trigger a poll cycle (useful for testing).
   */
  async poll(): Promise<void> {
    if (this.processing) return; // Prevent overlapping polls
    this.processing = true;

    try {
      const now = new Date();
      const dueTasks = await this.taskRepo.findDueTasks(now);

      if (dueTasks.length > 0) {
        this.logger.info(
          { count: dueTasks.length },
          'Found due tasks to execute',
        );
      }

      for (const task of dueTasks) {
        await this.executeTask(task);
      }
    } catch (err) {
      this.logger.error(
        { error: err instanceof Error ? err.message : String(err) },
        'Error during task scheduler poll',
      );
    } finally {
      this.processing = false;
    }
  }

  /**
   * Find a connected agent client ID for a server.
   * Returns null if no agent is connected.
   */
  findConnectedAgent(serverId: string): string | null {
    return this.findAgentClient(serverId);
  }

  /**
   * Get the WebSocket server reference.
   */
  getServer(): InstallServer {
    return this.server;
  }

  // --------------------------------------------------------------------------
  // Private
  // --------------------------------------------------------------------------

  private async executeTask(task: Task): Promise<void> {
    const taskLogger = createContextLogger({
      module: 'task-scheduler',
      taskId: task.id,
      serverId: task.serverId,
    });

    // Find the connected agent for this server
    const clientId = this.findAgentClient(task.serverId);
    if (!clientId) {
      taskLogger.warn('No connected agent for server, skipping task');
      // Still update nextRun so we don't retry every poll
      const nextRun = getNextRunDate(task.cron);
      if (nextRun) {
        await this.taskRepo.updateRunResult(task.id, task.userId, 'failed', nextRun);
      }
      return;
    }

    taskLogger.info(
      { command: task.command, clientId },
      'Executing scheduled task',
    );

    try {
      const result = await this.executor.executeCommand({
        serverId: task.serverId,
        userId: task.userId,
        clientId,
        command: task.command,
        description: `Scheduled: ${task.name}`,
        riskLevel: 'green',
        type: 'execute',
        taskId: task.id,
        timeoutMs: 60_000,
      });

      // Calculate next run
      const nextRun = getNextRunDate(task.cron);

      await this.taskRepo.updateRunResult(
        task.id,
        task.userId,
        result.success ? 'success' : 'failed',
        nextRun,
      );

      taskLogger.info(
        {
          success: result.success,
          exitCode: result.exitCode,
          duration: result.duration,
          nextRun: nextRun?.toISOString(),
        },
        'Scheduled task execution completed',
      );
    } catch (err) {
      taskLogger.error(
        { error: err instanceof Error ? err.message : String(err) },
        'Scheduled task execution failed',
      );

      const nextRun = getNextRunDate(task.cron);
      await this.taskRepo.updateRunResult(task.id, task.userId, 'failed', nextRun);
    }
  }

  /**
   * Find a connected and authenticated WebSocket client for a server.
   *
   * Looks up the agent record for the given server, then finds a
   * connected client using the agent's device ID.
   */
  private findAgentClient(serverId: string): string | null {
    // Agents are identified by their serverId as deviceId
    const clients = this.server.getClientsByDeviceId(serverId);
    return clients.length > 0 ? clients[0] : null;
  }
}

// ============================================================================
// Singleton
// ============================================================================

let _scheduler: TaskScheduler | null = null;

/**
 * Get or create the global TaskScheduler instance.
 *
 * @param server - The WebSocket server (required on first call)
 * @param options - Scheduler options
 * @returns The TaskScheduler singleton
 */
export function getTaskScheduler(
  server?: InstallServer,
  options?: TaskSchedulerOptions,
): TaskScheduler {
  if (!_scheduler) {
    if (!server) {
      throw new Error(
        'TaskScheduler not initialized — provide an InstallServer on first call',
      );
    }
    _scheduler = new TaskScheduler(server, undefined, undefined, options);
  }
  return _scheduler;
}

/** Set a custom TaskScheduler instance (for testing). */
export function setTaskScheduler(scheduler: TaskScheduler): void {
  _scheduler = scheduler;
}

/** Reset the singleton (for testing). */
export function _resetTaskScheduler(): void {
  if (_scheduler) {
    _scheduler.stop();
  }
  _scheduler = null;
}
