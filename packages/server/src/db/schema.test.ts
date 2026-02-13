// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for the Drizzle ORM database schema and connection module.
 *
 * Validates that:
 * - All tables are created correctly
 * - CRUD operations work with typed data
 * - Foreign key constraints are enforced
 * - JSON columns serialize/deserialize correctly
 * - Indexes exist
 * - Cascade deletes work properly
 *
 * @module db/schema.test
 */

import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { initDatabase, closeDatabase, createTables, getDatabase } from './connection.js';
import type { DrizzleDB } from './connection.js';
import {
  users,
  servers,
  agents,
  profiles,
  sessions,
  operations,
  snapshots,
  tasks,
  alerts,
  knowledgeCache,
} from './schema.js';
import type {
  ProfileOsInfo,
  ProfileSoftware,
  ProfileService,
  ProfilePreferences,
  SessionMessage,
  SessionContext,
  SnapshotFile,
  SnapshotConfig,
  KnowledgeEntry,
} from './schema.js';

// ============================================================================
// Helpers
// ============================================================================

function now(): Date {
  return new Date();
}

function createUserId(): string {
  return `usr-${randomUUID()}`;
}

function createServerId(): string {
  return `srv-${randomUUID()}`;
}

async function insertUser(db: DrizzleDB, overrides: Partial<typeof users.$inferInsert> = {}) {
  const data = {
    id: createUserId(),
    email: `user-${randomUUID()}@test.com`,
    passwordHash: 'hashed_password_123',
    name: 'Test User',
    createdAt: now(),
    updatedAt: now(),
    ...overrides,
  };
  await db.insert(users).values(data);
  return data;
}

async function insertServer(
  db: DrizzleDB,
  userId: string,
  overrides: Partial<typeof servers.$inferInsert> = {},
) {
  const data = {
    id: createServerId(),
    name: 'test-server',
    userId,
    status: 'offline' as const,
    tags: ['test'],
    createdAt: now(),
    updatedAt: now(),
    ...overrides,
  };
  await db.insert(servers).values(data);
  return data;
}

// ============================================================================
// Tests
// ============================================================================

let db: DrizzleDB;

beforeEach(() => {
  db = initDatabase(':memory:');
  createTables();
});

afterEach(() => {
  closeDatabase();
});

describe('schema: users table', () => {
  it('should insert and query a user', async () => {
    const user = await insertUser(db);

    const result = await db.select().from(users).where(eq(users.id, user.id));
    expect(result).toHaveLength(1);
    expect(result[0].email).toBe(user.email);
    expect(result[0].passwordHash).toBe('hashed_password_123');
    expect(result[0].name).toBe('Test User');
    expect(result[0].timezone).toBe('UTC');
  });

  it('should enforce unique email constraint', async () => {
    const email = 'duplicate@test.com';
    await insertUser(db, { email });

    await expect(insertUser(db, { email })).rejects.toThrow(/UNIQUE/);
  });

  it('should update a user', async () => {
    const user = await insertUser(db);

    await db.update(users).set({ name: 'Updated Name' }).where(eq(users.id, user.id));

    const result = await db.select().from(users).where(eq(users.id, user.id));
    expect(result[0].name).toBe('Updated Name');
  });

  it('should delete a user', async () => {
    const user = await insertUser(db);

    await db.delete(users).where(eq(users.id, user.id));

    const result = await db.select().from(users).where(eq(users.id, user.id));
    expect(result).toHaveLength(0);
  });
});

describe('schema: servers table', () => {
  it('should insert a server with foreign key to user', async () => {
    const user = await insertUser(db);
    const server = await insertServer(db, user.id);

    const result = await db.select().from(servers).where(eq(servers.id, server.id));
    expect(result).toHaveLength(1);
    expect(result[0].userId).toBe(user.id);
    expect(result[0].status).toBe('offline');
  });

  it('should store tags as JSON array', async () => {
    const user = await insertUser(db);
    const server = await insertServer(db, user.id, {
      tags: ['production', 'web', 'us-east'],
    });

    const result = await db.select().from(servers).where(eq(servers.id, server.id));
    expect(result[0].tags).toEqual(['production', 'web', 'us-east']);
  });

  it('should reject insert with non-existent user_id', async () => {
    await expect(
      insertServer(db, 'non-existent-user'),
    ).rejects.toThrow(/FOREIGN KEY/);
  });

  it('should cascade delete when user is deleted', async () => {
    const user = await insertUser(db);
    await insertServer(db, user.id);

    await db.delete(users).where(eq(users.id, user.id));

    const result = await db.select().from(servers);
    expect(result).toHaveLength(0);
  });
});

describe('schema: agents table', () => {
  it('should insert an agent linked to a server', async () => {
    const user = await insertUser(db);
    const server = await insertServer(db, user.id);

    const agentId = `agt-${randomUUID()}`;
    await db.insert(agents).values({
      id: agentId,
      serverId: server.id,
      keyHash: 'sha256_hash_here',
      version: '0.1.0',
      createdAt: now(),
    });

    const result = await db.select().from(agents).where(eq(agents.id, agentId));
    expect(result).toHaveLength(1);
    expect(result[0].serverId).toBe(server.id);
    expect(result[0].version).toBe('0.1.0');
  });

  it('should enforce unique server_id constraint', async () => {
    const user = await insertUser(db);
    const server = await insertServer(db, user.id);

    await db.insert(agents).values({
      id: `agt-${randomUUID()}`,
      serverId: server.id,
      keyHash: 'hash1',
      createdAt: now(),
    });

    await expect(
      db.insert(agents).values({
        id: `agt-${randomUUID()}`,
        serverId: server.id,
        keyHash: 'hash2',
        createdAt: now(),
      }),
    ).rejects.toThrow(/UNIQUE/);
  });
});

describe('schema: profiles table', () => {
  it('should store and retrieve complex JSON fields', async () => {
    const user = await insertUser(db);
    const server = await insertServer(db, user.id);

    const osInfo: ProfileOsInfo = {
      platform: 'linux',
      arch: 'x64',
      version: 'Ubuntu 22.04',
      kernel: '5.15.0',
      hostname: 'prod-01',
      uptime: 86400,
    };

    const software: ProfileSoftware[] = [
      { name: 'nginx', version: '1.24.0', configPath: '/etc/nginx', ports: [80, 443] },
      { name: 'redis', version: '7.0.0', ports: [6379] },
    ];

    const services: ProfileService[] = [
      { name: 'nginx', status: 'running', ports: [80, 443], manager: 'systemd' },
    ];

    const preferences: ProfilePreferences = {
      packageManager: 'apt',
      deploymentStyle: 'docker',
    };

    const profileId = `prf-${randomUUID()}`;
    await db.insert(profiles).values({
      id: profileId,
      serverId: server.id,
      osInfo,
      software,
      services,
      preferences,
      notes: ['Production server', 'Do not restart during business hours'],
      operationHistory: ['Installed nginx on 2026-01-15'],
      updatedAt: now(),
    });

    const result = await db.select().from(profiles).where(eq(profiles.id, profileId));
    expect(result).toHaveLength(1);

    const profile = result[0];
    expect(profile.osInfo).toEqual(osInfo);
    expect(profile.software).toEqual(software);
    expect(profile.services).toEqual(services);
    expect(profile.preferences).toEqual(preferences);
    expect(profile.notes).toEqual(['Production server', 'Do not restart during business hours']);
    expect(profile.operationHistory).toEqual(['Installed nginx on 2026-01-15']);
  });

  it('should enforce unique server_id (1:1 relationship)', async () => {
    const user = await insertUser(db);
    const server = await insertServer(db, user.id);

    await db.insert(profiles).values({
      id: `prf-${randomUUID()}`,
      serverId: server.id,
      updatedAt: now(),
    });

    await expect(
      db.insert(profiles).values({
        id: `prf-${randomUUID()}`,
        serverId: server.id,
        updatedAt: now(),
      }),
    ).rejects.toThrow(/UNIQUE/);
  });
});

describe('schema: sessions table', () => {
  it('should store messages and context as JSON', async () => {
    const user = await insertUser(db);
    const server = await insertServer(db, user.id);

    const messages: SessionMessage[] = [
      { id: '1', role: 'user', content: '安装 Redis', timestamp: Date.now() },
      { id: '2', role: 'assistant', content: '好的，我来帮你安装', timestamp: Date.now() },
    ];

    const context: SessionContext = {
      serverId: server.id,
      profileSnapshot: '{}',
      tokenCount: 150,
      summarized: false,
    };

    const sessionId = `ses-${randomUUID()}`;
    await db.insert(sessions).values({
      id: sessionId,
      userId: user.id,
      serverId: server.id,
      messages,
      context,
      createdAt: now(),
      updatedAt: now(),
    });

    const result = await db.select().from(sessions).where(eq(sessions.id, sessionId));
    expect(result).toHaveLength(1);
    expect(result[0].messages).toEqual(messages);
    expect(result[0].context).toEqual(context);
  });
});

describe('schema: operations table', () => {
  it('should insert an operation with all fields', async () => {
    const user = await insertUser(db);
    const server = await insertServer(db, user.id);

    const opId = `op-${randomUUID()}`;
    await db.insert(operations).values({
      id: opId,
      serverId: server.id,
      userId: user.id,
      type: 'install',
      description: 'Install Redis 7.0',
      commands: ['apt update', 'apt install redis-server -y'],
      output: 'Installation successful',
      status: 'success',
      riskLevel: 'yellow',
      duration: 12500,
      createdAt: now(),
      completedAt: now(),
    });

    const result = await db.select().from(operations).where(eq(operations.id, opId));
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('install');
    expect(result[0].commands).toEqual(['apt update', 'apt install redis-server -y']);
    expect(result[0].status).toBe('success');
    expect(result[0].riskLevel).toBe('yellow');
    expect(result[0].duration).toBe(12500);
  });

  it('should allow null sessionId', async () => {
    const user = await insertUser(db);
    const server = await insertServer(db, user.id);

    const opId = `op-${randomUUID()}`;
    await db.insert(operations).values({
      id: opId,
      serverId: server.id,
      userId: user.id,
      type: 'execute',
      description: 'Manual command',
      status: 'pending',
      riskLevel: 'green',
      createdAt: now(),
    });

    const result = await db.select().from(operations).where(eq(operations.id, opId));
    expect(result[0].sessionId).toBeNull();
  });
});

describe('schema: snapshots table', () => {
  it('should store file and config snapshots as JSON', async () => {
    const user = await insertUser(db);
    const server = await insertServer(db, user.id);

    const snapshotFiles: SnapshotFile[] = [
      { path: '/etc/nginx/nginx.conf', content: 'worker_processes auto;', mode: 0o644, owner: 'root' },
    ];

    const snapshotConfigs: SnapshotConfig[] = [
      { type: 'nginx', path: '/etc/nginx/nginx.conf', content: 'worker_processes auto;' },
    ];

    const snapId = `snap-${randomUUID()}`;
    await db.insert(snapshots).values({
      id: snapId,
      serverId: server.id,
      operationId: `op-${randomUUID()}`,
      files: snapshotFiles,
      configs: snapshotConfigs,
      createdAt: now(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    const result = await db.select().from(snapshots).where(eq(snapshots.id, snapId));
    expect(result).toHaveLength(1);
    expect(result[0].files).toEqual(snapshotFiles);
    expect(result[0].configs).toEqual(snapshotConfigs);
  });
});

describe('schema: tasks table', () => {
  it('should insert a scheduled task', async () => {
    const user = await insertUser(db);
    const server = await insertServer(db, user.id);

    const taskId = `task-${randomUUID()}`;
    await db.insert(tasks).values({
      id: taskId,
      serverId: server.id,
      userId: user.id,
      name: 'Daily backup',
      description: 'Backup database every night',
      cron: '0 2 * * *',
      command: 'pg_dump mydb > /backups/mydb.sql',
      status: 'active',
      createdAt: now(),
    });

    const result = await db.select().from(tasks).where(eq(tasks.id, taskId));
    expect(result).toHaveLength(1);
    expect(result[0].cron).toBe('0 2 * * *');
    expect(result[0].status).toBe('active');
  });
});

describe('schema: alerts table', () => {
  it('should insert and resolve an alert', async () => {
    const user = await insertUser(db);
    const server = await insertServer(db, user.id);

    const alertId = `alert-${randomUUID()}`;
    await db.insert(alerts).values({
      id: alertId,
      serverId: server.id,
      type: 'cpu',
      severity: 'warning',
      message: 'CPU usage above 90%',
      value: '93',
      threshold: '90',
      createdAt: now(),
    });

    let result = await db.select().from(alerts).where(eq(alerts.id, alertId));
    expect(result[0].resolved).toBe(false);

    // Resolve the alert
    await db.update(alerts).set({ resolved: true, resolvedAt: now() }).where(eq(alerts.id, alertId));

    result = await db.select().from(alerts).where(eq(alerts.id, alertId));
    expect(result[0].resolved).toBe(true);
    expect(result[0].resolvedAt).not.toBeNull();
  });
});

describe('schema: knowledgeCache table', () => {
  it('should store and retrieve knowledge entries', async () => {
    const entry: KnowledgeEntry = {
      commands: ['apt update', 'apt install redis-server -y'],
      verification: 'redis-cli ping',
      notes: ['Requires port 6379 to be available'],
      platform: 'ubuntu',
    };

    const kcId = `kc-${randomUUID()}`;
    await db.insert(knowledgeCache).values({
      id: kcId,
      software: 'redis',
      platform: 'ubuntu-22.04',
      content: entry,
      source: 'builtin',
      createdAt: now(),
      updatedAt: now(),
    });

    const result = await db.select().from(knowledgeCache).where(eq(knowledgeCache.id, kcId));
    expect(result).toHaveLength(1);
    expect(result[0].content).toEqual(entry);
    expect(result[0].source).toBe('builtin');
    expect(result[0].successCount).toBe(0);
  });

  it('should increment success count', async () => {
    const kcId = `kc-${randomUUID()}`;
    await db.insert(knowledgeCache).values({
      id: kcId,
      software: 'nginx',
      platform: 'ubuntu-22.04',
      content: { commands: ['apt install nginx -y'] },
      source: 'auto_learn',
      createdAt: now(),
      updatedAt: now(),
    });

    await db
      .update(knowledgeCache)
      .set({ successCount: 5, lastUsed: now() })
      .where(eq(knowledgeCache.id, kcId));

    const result = await db.select().from(knowledgeCache).where(eq(knowledgeCache.id, kcId));
    expect(result[0].successCount).toBe(5);
    expect(result[0].lastUsed).not.toBeNull();
  });
});

describe('schema: cascade deletes', () => {
  it('should cascade delete servers, profiles, sessions, operations when user is deleted', async () => {
    const user = await insertUser(db);
    const server = await insertServer(db, user.id);

    // Create profile
    await db.insert(profiles).values({
      id: `prf-${randomUUID()}`,
      serverId: server.id,
      updatedAt: now(),
    });

    // Create session
    const sessionId = `ses-${randomUUID()}`;
    await db.insert(sessions).values({
      id: sessionId,
      userId: user.id,
      serverId: server.id,
      createdAt: now(),
      updatedAt: now(),
    });

    // Create operation
    await db.insert(operations).values({
      id: `op-${randomUUID()}`,
      serverId: server.id,
      sessionId,
      userId: user.id,
      type: 'execute',
      description: 'test op',
      status: 'success',
      riskLevel: 'green',
      createdAt: now(),
    });

    // Create snapshot
    await db.insert(snapshots).values({
      id: `snap-${randomUUID()}`,
      serverId: server.id,
      createdAt: now(),
    });

    // Create alert
    await db.insert(alerts).values({
      id: `alert-${randomUUID()}`,
      serverId: server.id,
      type: 'cpu',
      severity: 'info',
      message: 'test alert',
      createdAt: now(),
    });

    // Create task
    await db.insert(tasks).values({
      id: `task-${randomUUID()}`,
      serverId: server.id,
      userId: user.id,
      name: 'test task',
      cron: '* * * * *',
      command: 'echo test',
      createdAt: now(),
    });

    // Delete user — should cascade to everything
    await db.delete(users).where(eq(users.id, user.id));

    expect(await db.select().from(servers)).toHaveLength(0);
    expect(await db.select().from(profiles)).toHaveLength(0);
    expect(await db.select().from(sessions)).toHaveLength(0);
    expect(await db.select().from(operations)).toHaveLength(0);
    expect(await db.select().from(snapshots)).toHaveLength(0);
    expect(await db.select().from(alerts)).toHaveLength(0);
    expect(await db.select().from(tasks)).toHaveLength(0);
  });

  it('should cascade delete agent when server is deleted', async () => {
    const user = await insertUser(db);
    const server = await insertServer(db, user.id);

    await db.insert(agents).values({
      id: `agt-${randomUUID()}`,
      serverId: server.id,
      keyHash: 'test_hash',
      createdAt: now(),
    });

    await db.delete(servers).where(eq(servers.id, server.id));

    expect(await db.select().from(agents)).toHaveLength(0);
  });
});

describe('schema: connection module', () => {
  it('should throw when getting database before init', () => {
    closeDatabase();
    expect(() => getDatabase()).toThrow('Database not initialized');
  });
});
