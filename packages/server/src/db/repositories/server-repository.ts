// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Server repository — data access layer for server management.
 *
 * Defines the repository interface and provides both an in-memory
 * implementation (for testing) and a Drizzle ORM implementation
 * for production use.
 *
 * @module db/repositories/server-repository
 */

import { randomUUID, randomBytes } from 'node:crypto';
import { eq, and, count, desc } from 'drizzle-orm';

import { getDatabase } from '../connection.js';
import { servers, profiles, operations, agents } from '../schema.js';

import type { DrizzleDB } from '../connection.js';

// ============================================================================
// Types
// ============================================================================

export type ServerStatus = 'online' | 'offline' | 'error';

export interface Server {
  id: string;
  name: string;
  userId: string;
  tenantId: string | null;
  status: ServerStatus;
  tags: string[];
  group: string | null;
  agentToken: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ServerProfile {
  serverId: string;
  osInfo: OsInfo | null;
  software: Software[];
  services: ServiceInfo[];
  updatedAt: string;
}

export interface OsInfo {
  platform: string;
  arch: string;
  version: string;
  kernel: string;
  hostname: string;
  uptime: number;
}

export interface Software {
  name: string;
  version: string;
  configPath?: string;
  dataPath?: string;
  ports: number[];
}

export interface ServiceInfo {
  name: string;
  status: 'running' | 'stopped' | 'failed';
  ports: number[];
  manager?: string;
  uptime?: number;
}

export interface Operation {
  id: string;
  serverId: string;
  userId: string;
  type: 'install' | 'config' | 'restart' | 'execute' | 'backup';
  command: string;
  output: string;
  status: 'pending' | 'running' | 'success' | 'failed' | 'rolled_back';
  riskLevel: 'green' | 'yellow' | 'red' | 'critical';
  duration: number | null;
  createdAt: string;
  completedAt: string | null;
}

export interface CreateServerInput {
  name: string;
  userId: string;
  tenantId?: string | null;
  tags?: string[];
  group?: string | null;
}

export interface UpdateServerInput {
  name?: string;
  tags?: string[];
  group?: string | null;
}

export interface ServerFilterOptions {
  group?: string;
  tag?: string;
}

export interface PaginationOptions {
  limit: number;
  offset: number;
}

// ============================================================================
// Repository Interface
// ============================================================================

export interface ServerRepository {
  findAllByUserId(userId: string, filters?: ServerFilterOptions): Promise<Server[]>;
  findById(id: string, userId: string): Promise<Server | null>;
  create(input: CreateServerInput): Promise<Server>;
  update(id: string, userId: string, input: UpdateServerInput): Promise<Server | null>;
  updateStatus(serverId: string, status: ServerStatus): Promise<boolean>;
  delete(id: string, userId: string): Promise<boolean>;
  getProfile(serverId: string, userId: string): Promise<ServerProfile | null>;
  getOperations(
    serverId: string,
    userId: string,
    pagination: PaginationOptions,
  ): Promise<{ operations: Operation[]; total: number }>;
  getDistinctGroups(userId: string): Promise<string[]>;
}

// ============================================================================
// Drizzle Implementation
// ============================================================================

function generateAgentToken(): string {
  return `sp_${randomBytes(32).toString('hex')}`;
}

function toISOString(date: Date | null | undefined): string | null {
  return date ? date.toISOString() : null;
}

export class DrizzleServerRepository implements ServerRepository {
  constructor(private db: DrizzleDB) {}

  async findAllByUserId(userId: string, filters?: ServerFilterOptions): Promise<Server[]> {
    const conditions = [eq(servers.userId, userId)];
    if (filters?.group) {
      conditions.push(eq(servers.group, filters.group));
    }

    const rows = this.db
      .select()
      .from(servers)
      .where(and(...conditions))
      .all();

    let result = rows.map((row) => this.toServer(row));

    // Tag filtering done in JS (SQLite has no native JSON array contains)
    if (filters?.tag) {
      const tagLower = filters.tag.toLowerCase();
      result = result.filter((s) =>
        s.tags.some((t) => t.toLowerCase() === tagLower),
      );
    }

    return result;
  }

  async findById(id: string, userId: string): Promise<Server | null> {
    const rows = this.db
      .select()
      .from(servers)
      .where(and(eq(servers.id, id), eq(servers.userId, userId)))
      .limit(1)
      .all();

    return rows[0] ? this.toServer(rows[0]) : null;
  }

  async create(input: CreateServerInput): Promise<Server> {
    const now = new Date();
    const id = randomUUID();
    const agentToken = generateAgentToken();

    this.db.insert(servers).values({
      id,
      name: input.name,
      userId: input.userId,
      tenantId: input.tenantId ?? null,
      status: 'offline',
      tags: input.tags ?? [],
      group: input.group ?? null,
      createdAt: now,
      updatedAt: now,
    }).run();

    // Create associated agent with token hash
    this.db.insert(agents).values({
      id: randomUUID(),
      serverId: id,
      keyHash: agentToken,
      createdAt: now,
    }).run();

    // Initialize empty profile
    this.db.insert(profiles).values({
      id: randomUUID(),
      serverId: id,
      osInfo: null,
      software: [],
      services: [],
      preferences: null,
      notes: [],
      operationHistory: [],
      updatedAt: now,
    }).run();

    return {
      id,
      name: input.name,
      userId: input.userId,
      tenantId: input.tenantId ?? null,
      status: 'offline',
      tags: input.tags ?? [],
      group: input.group ?? null,
      agentToken,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
  }

  async update(
    id: string,
    userId: string,
    input: UpdateServerInput,
  ): Promise<Server | null> {
    const existing = await this.findById(id, userId);
    if (!existing) return null;

    const now = new Date();
    const updates: Record<string, unknown> = { updatedAt: now };
    if (input.name !== undefined) updates.name = input.name;
    if (input.tags !== undefined) updates.tags = input.tags;
    if (input.group !== undefined) updates.group = input.group;

    this.db
      .update(servers)
      .set(updates)
      .where(and(eq(servers.id, id), eq(servers.userId, userId)))
      .run();

    return this.findById(id, userId);
  }

  async updateStatus(serverId: string, status: ServerStatus): Promise<boolean> {
    const result = this.db
      .update(servers)
      .set({ status, updatedAt: new Date() })
      .where(eq(servers.id, serverId))
      .run();
    return result.changes > 0;
  }

  async delete(id: string, userId: string): Promise<boolean> {
    const existing = await this.findById(id, userId);
    if (!existing) return false;

    this.db
      .delete(servers)
      .where(and(eq(servers.id, id), eq(servers.userId, userId)))
      .run();

    return true;
  }

  async getProfile(
    serverId: string,
    userId: string,
  ): Promise<ServerProfile | null> {
    // Verify user owns the server
    const server = await this.findById(serverId, userId);
    if (!server) return null;

    const rows = this.db
      .select()
      .from(profiles)
      .where(eq(profiles.serverId, serverId))
      .limit(1)
      .all();

    if (!rows[0]) return null;
    const row = rows[0];

    return {
      serverId: row.serverId,
      osInfo: row.osInfo ?? null,
      software: (row.software ?? []) as Software[],
      services: (row.services ?? []) as ServiceInfo[],
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async getOperations(
    serverId: string,
    userId: string,
    pagination: PaginationOptions,
  ): Promise<{ operations: Operation[]; total: number }> {
    // Verify user owns the server
    const server = await this.findById(serverId, userId);
    if (!server) return { operations: [], total: 0 };

    const totalResult = this.db
      .select({ count: count() })
      .from(operations)
      .where(eq(operations.serverId, serverId))
      .all();
    const total = totalResult[0]?.count ?? 0;

    const rows = this.db
      .select()
      .from(operations)
      .where(eq(operations.serverId, serverId))
      .orderBy(desc(operations.createdAt))
      .limit(pagination.limit)
      .offset(pagination.offset)
      .all();

    return {
      operations: rows.map((row) => ({
        id: row.id,
        serverId: row.serverId,
        userId: row.userId,
        type: row.type,
        command: (row.commands as string[])?.[0] ?? '',
        output: row.output ?? '',
        status: row.status,
        riskLevel: row.riskLevel,
        duration: row.duration ?? null,
        createdAt: row.createdAt.toISOString(),
        completedAt: toISOString(row.completedAt),
      })),
      total,
    };
  }

  async getDistinctGroups(userId: string): Promise<string[]> {
    const rows = this.db
      .select({ group: servers.group })
      .from(servers)
      .where(eq(servers.userId, userId))
      .all();

    const groups = new Set<string>();
    for (const row of rows) {
      if (row.group) groups.add(row.group);
    }
    return [...groups].sort();
  }

  private toServer(row: typeof servers.$inferSelect): Server {
    return {
      id: row.id,
      name: row.name,
      userId: row.userId,
      tenantId: row.tenantId ?? null,
      status: row.status as ServerStatus,
      tags: (row.tags ?? []) as string[],
      group: row.group ?? null,
      agentToken: null, // Token not exposed after creation
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

// ============================================================================
// In-Memory Implementation (for testing)
// ============================================================================

function nowISO(): string {
  return new Date().toISOString();
}

export class InMemoryServerRepository implements ServerRepository {
  private servers = new Map<string, Server>();
  private profiles = new Map<string, ServerProfile>();
  private operations = new Map<string, Operation[]>();

  async findAllByUserId(userId: string, filters?: ServerFilterOptions): Promise<Server[]> {
    let result = [...this.servers.values()].filter((s) => s.userId === userId);
    if (filters?.group) {
      result = result.filter((s) => s.group === filters.group);
    }
    if (filters?.tag) {
      const tagLower = filters.tag.toLowerCase();
      result = result.filter((s) =>
        s.tags.some((t) => t.toLowerCase() === tagLower),
      );
    }
    return result;
  }

  async findById(id: string, userId: string): Promise<Server | null> {
    const server = this.servers.get(id);
    if (!server || server.userId !== userId) return null;
    return server;
  }

  async create(input: CreateServerInput): Promise<Server> {
    const now = nowISO();
    const server: Server = {
      id: randomUUID(),
      name: input.name,
      userId: input.userId,
      tenantId: input.tenantId ?? null,
      status: 'offline',
      tags: input.tags ?? [],
      group: input.group ?? null,
      agentToken: generateAgentToken(),
      createdAt: now,
      updatedAt: now,
    };
    this.servers.set(server.id, server);

    this.profiles.set(server.id, {
      serverId: server.id,
      osInfo: null,
      software: [],
      services: [],
      updatedAt: now,
    });

    this.operations.set(server.id, []);
    return server;
  }

  async update(
    id: string,
    userId: string,
    input: UpdateServerInput,
  ): Promise<Server | null> {
    const server = this.servers.get(id);
    if (!server || server.userId !== userId) return null;

    if (input.name !== undefined) server.name = input.name;
    if (input.tags !== undefined) server.tags = input.tags;
    if (input.group !== undefined) server.group = input.group;
    server.updatedAt = nowISO();

    this.servers.set(id, server);
    return server;
  }

  async updateStatus(serverId: string, status: ServerStatus): Promise<boolean> {
    const server = this.servers.get(serverId);
    if (!server) return false;
    server.status = status;
    server.updatedAt = nowISO();
    return true;
  }

  async delete(id: string, userId: string): Promise<boolean> {
    const server = this.servers.get(id);
    if (!server || server.userId !== userId) return false;

    this.servers.delete(id);
    this.profiles.delete(id);
    this.operations.delete(id);
    return true;
  }

  async getProfile(
    serverId: string,
    userId: string,
  ): Promise<ServerProfile | null> {
    const server = this.servers.get(serverId);
    if (!server || server.userId !== userId) return null;
    return this.profiles.get(serverId) ?? null;
  }

  async getOperations(
    serverId: string,
    userId: string,
    pagination: PaginationOptions,
  ): Promise<{ operations: Operation[]; total: number }> {
    const server = this.servers.get(serverId);
    if (!server || server.userId !== userId) {
      return { operations: [], total: 0 };
    }

    const all = this.operations.get(serverId) ?? [];
    const total = all.length;
    const ops = all.slice(
      pagination.offset,
      pagination.offset + pagination.limit,
    );
    return { operations: ops, total };
  }

  async getDistinctGroups(userId: string): Promise<string[]> {
    const groups = new Set<string>();
    for (const server of this.servers.values()) {
      if (server.userId === userId && server.group) {
        groups.add(server.group);
      }
    }
    return [...groups].sort();
  }

  /** Clear all data (for testing). */
  clear(): void {
    this.servers.clear();
    this.profiles.clear();
    this.operations.clear();
  }
}

// ============================================================================
// Singleton
// ============================================================================

let _repository: ServerRepository | null = null;

/**
 * Get the server repository singleton.
 * Uses DrizzleServerRepository by default if database is initialized.
 */
export function getServerRepository(): ServerRepository {
  if (!_repository) {
    _repository = new DrizzleServerRepository(getDatabase());
  }
  return _repository;
}

export function setServerRepository(repo: ServerRepository): void {
  _repository = repo;
}

/** Reset to default (for testing). */
export function _resetServerRepository(): void {
  _repository = null;
}
