// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Task repository — data access layer for scheduled cron tasks.
 *
 * Manages task lifecycle: creation, scheduling, execution tracking,
 * and status management.
 *
 * @module db/repositories/task-repository
 */

import { randomUUID } from 'node:crypto';
import { eq, and, count, desc, lte } from 'drizzle-orm';

import { getDatabase } from '../connection.js';
import { tasks, servers } from '../schema.js';

import type { DrizzleDB } from '../connection.js';

// ============================================================================
// Types
// ============================================================================

export type TaskStatus = 'active' | 'paused' | 'deleted';
export type TaskRunStatus = 'success' | 'failed';

export interface Task {
  id: string;
  serverId: string;
  userId: string;
  name: string;
  description: string | null;
  cron: string;
  command: string;
  status: TaskStatus;
  lastRun: string | null;
  lastStatus: TaskRunStatus | null;
  nextRun: string | null;
  createdAt: string;
}

export interface CreateTaskInput {
  serverId: string;
  userId: string;
  tenantId?: string | null;
  name: string;
  description?: string;
  cron: string;
  command: string;
  nextRun?: Date;
}

export interface UpdateTaskInput {
  name?: string;
  description?: string;
  cron?: string;
  command?: string;
  status?: TaskStatus;
}

export interface PaginationOptions {
  limit: number;
  offset: number;
}

// ============================================================================
// Repository Interface
// ============================================================================

export interface TaskRepository {
  /** Create a new scheduled task. */
  create(input: CreateTaskInput): Promise<Task>;

  /** Get task by ID with user isolation. */
  getById(id: string, userId: string): Promise<Task | null>;

  /** List tasks for a server with pagination. */
  listByServer(
    serverId: string,
    userId: string,
    pagination: PaginationOptions,
  ): Promise<{ tasks: Task[]; total: number }>;

  /** Update task properties. */
  update(id: string, userId: string, input: UpdateTaskInput): Promise<Task | null>;

  /** Delete a task (soft delete — sets status to 'deleted'). */
  delete(id: string, userId: string): Promise<boolean>;

  /** Find tasks by status for a user. */
  findByStatus(
    userId: string,
    status: TaskStatus,
    pagination: PaginationOptions,
  ): Promise<{ tasks: Task[]; total: number }>;

  /** Update last run info and schedule next run. */
  updateRunResult(
    id: string,
    userId: string,
    lastStatus: TaskRunStatus,
    nextRun: Date | null,
  ): Promise<boolean>;

  /** Find active tasks whose nextRun is at or before the given time. */
  findDueTasks(now: Date): Promise<Task[]>;
}

// ============================================================================
// Drizzle Implementation
// ============================================================================

function toISOString(date: Date | null | undefined): string | null {
  return date ? date.toISOString() : null;
}

export class DrizzleTaskRepository implements TaskRepository {
  constructor(private db: DrizzleDB) {}

  async create(input: CreateTaskInput): Promise<Task> {
    if (!(await this.verifyServerOwnership(input.serverId, input.userId))) {
      throw new Error('Server not found or access denied');
    }

    const now = new Date();
    const id = randomUUID();

    this.db.insert(tasks).values({
      id,
      serverId: input.serverId,
      userId: input.userId,
      tenantId: input.tenantId ?? null,
      name: input.name,
      description: input.description ?? null,
      cron: input.cron,
      command: input.command,
      status: 'active',
      lastRun: null,
      lastStatus: null,
      nextRun: input.nextRun ?? null,
      createdAt: now,
    }).run();

    return {
      id,
      serverId: input.serverId,
      userId: input.userId,
      name: input.name,
      description: input.description ?? null,
      cron: input.cron,
      command: input.command,
      status: 'active',
      lastRun: null,
      lastStatus: null,
      nextRun: toISOString(input.nextRun ?? null),
      createdAt: now.toISOString(),
    };
  }

  async getById(id: string, userId: string): Promise<Task | null> {
    const rows = this.db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, id), eq(tasks.userId, userId)))
      .limit(1)
      .all();

    return rows[0] ? this.toTask(rows[0]) : null;
  }

  async listByServer(
    serverId: string,
    userId: string,
    pagination: PaginationOptions,
  ): Promise<{ tasks: Task[]; total: number }> {
    if (!(await this.verifyServerOwnership(serverId, userId))) {
      return { tasks: [], total: 0 };
    }

    const totalResult = this.db
      .select({ count: count() })
      .from(tasks)
      .where(and(eq(tasks.serverId, serverId), eq(tasks.userId, userId)))
      .all();
    const total = totalResult[0]?.count ?? 0;

    const rows = this.db
      .select()
      .from(tasks)
      .where(and(eq(tasks.serverId, serverId), eq(tasks.userId, userId)))
      .orderBy(desc(tasks.createdAt))
      .limit(pagination.limit)
      .offset(pagination.offset)
      .all();

    return {
      tasks: rows.map((row) => this.toTask(row)),
      total,
    };
  }

  async update(
    id: string,
    userId: string,
    input: UpdateTaskInput,
  ): Promise<Task | null> {
    const existing = await this.getById(id, userId);
    if (!existing) return null;

    const updates: Record<string, unknown> = {};
    if (input.name !== undefined) updates.name = input.name;
    if (input.description !== undefined) updates.description = input.description;
    if (input.cron !== undefined) updates.cron = input.cron;
    if (input.command !== undefined) updates.command = input.command;
    if (input.status !== undefined) updates.status = input.status;

    if (Object.keys(updates).length === 0) return existing;

    this.db
      .update(tasks)
      .set(updates)
      .where(and(eq(tasks.id, id), eq(tasks.userId, userId)))
      .run();

    return this.getById(id, userId);
  }

  async delete(id: string, userId: string): Promise<boolean> {
    const existing = await this.getById(id, userId);
    if (!existing) return false;

    this.db
      .update(tasks)
      .set({ status: 'deleted' as const })
      .where(and(eq(tasks.id, id), eq(tasks.userId, userId)))
      .run();

    return true;
  }

  async findByStatus(
    userId: string,
    status: TaskStatus,
    pagination: PaginationOptions,
  ): Promise<{ tasks: Task[]; total: number }> {
    const totalResult = this.db
      .select({ count: count() })
      .from(tasks)
      .where(and(eq(tasks.userId, userId), eq(tasks.status, status)))
      .all();
    const total = totalResult[0]?.count ?? 0;

    const rows = this.db
      .select()
      .from(tasks)
      .where(and(eq(tasks.userId, userId), eq(tasks.status, status)))
      .orderBy(desc(tasks.createdAt))
      .limit(pagination.limit)
      .offset(pagination.offset)
      .all();

    return {
      tasks: rows.map((row) => this.toTask(row)),
      total,
    };
  }

  async updateRunResult(
    id: string,
    userId: string,
    lastStatus: TaskRunStatus,
    nextRun: Date | null,
  ): Promise<boolean> {
    const existing = await this.getById(id, userId);
    if (!existing) return false;

    this.db
      .update(tasks)
      .set({
        lastRun: new Date(),
        lastStatus,
        nextRun,
      })
      .where(and(eq(tasks.id, id), eq(tasks.userId, userId)))
      .run();

    return true;
  }

  async findDueTasks(now: Date): Promise<Task[]> {
    const rows = this.db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.status, 'active'),
          lte(tasks.nextRun, now),
        ),
      )
      .all();

    return rows.map((row) => this.toTask(row));
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

  private toTask(row: typeof tasks.$inferSelect): Task {
    return {
      id: row.id,
      serverId: row.serverId,
      userId: row.userId,
      name: row.name,
      description: row.description ?? null,
      cron: row.cron,
      command: row.command,
      status: row.status as TaskStatus,
      lastRun: toISOString(row.lastRun),
      lastStatus: (row.lastStatus as TaskRunStatus) ?? null,
      nextRun: toISOString(row.nextRun),
      createdAt: row.createdAt.toISOString(),
    };
  }
}

// ============================================================================
// Singleton
// ============================================================================

let _repository: TaskRepository | null = null;

export function getTaskRepository(): TaskRepository {
  if (!_repository) {
    _repository = new DrizzleTaskRepository(getDatabase());
  }
  return _repository;
}

export function setTaskRepository(repo: TaskRepository): void {
  _repository = repo;
}

export function _resetTaskRepository(): void {
  _repository = null;
}
