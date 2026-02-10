/**
 * Tests for the database migration module.
 *
 * Validates that:
 * - Migrations run successfully on a fresh in-memory database
 * - All 15 tables are created with correct structure
 * - All indexes exist after migration
 * - Foreign key constraints work after migration
 * - Migrations are idempotent (safe to run multiple times)
 * - runMigrationsWithConnection works with an existing connection
 * - CRUD operations work on migrated tables
 *
 * @module db/migrate.test
 */

import { describe, it, expect, afterEach } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import { runMigrations, runMigrationsWithConnection } from './migrate.js';
import * as schema from './schema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_PATH = resolve(__dirname, 'migrations');

// Track connections for cleanup
const openConnections: Database.Database[] = [];

afterEach(() => {
  for (const conn of openConnections) {
    try { conn.close(); } catch { /* already closed */ }
  }
  openConnections.length = 0;
});

function createTestDb() {
  const sqlite = new Database(':memory:');
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  openConnections.push(sqlite);
  return { sqlite, db: drizzle(sqlite, { schema }) };
}

function now() {
  return new Date();
}

// ============================================================================
// Core migration tests
// ============================================================================

describe('migrate: runMigrations', () => {
  it('should run migrations successfully on a fresh database', () => {
    const result = runMigrations({
      dbPath: ':memory:',
      migrationsPath: MIGRATIONS_PATH,
    });

    expect(result.success).toBe(true);
    expect(result.dbPath).toBe(':memory:');
    expect(result.migrationsPath).toBe(MIGRATIONS_PATH);
  });

  it('should create all 17 tables', () => {
    const sqlite = new Database(':memory:');
    openConnections.push(sqlite);
    sqlite.pragma('foreign_keys = ON');

    const db = drizzle(sqlite, { schema });
    runMigrationsWithConnection(db, MIGRATIONS_PATH);

    const tables = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%' ORDER BY name")
      .all() as { name: string }[];

    const tableNames = tables.map((t) => t.name).sort();
    expect(tableNames).toEqual([
      'agents',
      'alert_rules',
      'alerts',
      'doc_source_history',
      'doc_sources',
      'knowledge_cache',
      'metrics',
      'metrics_daily',
      'metrics_hourly',
      'operations',
      'profiles',
      'servers',
      'sessions',
      'snapshots',
      'tasks',
      'user_settings',
      'users',
    ]);
  });

  it('should create all expected indexes', () => {
    const sqlite = new Database(':memory:');
    openConnections.push(sqlite);
    sqlite.pragma('foreign_keys = ON');

    const db = drizzle(sqlite, { schema });
    runMigrationsWithConnection(db, MIGRATIONS_PATH);

    const indexes = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all() as { name: string }[];

    const indexNames = indexes.map((i) => i.name).sort();

    // Verify key indexes exist
    expect(indexNames).toContain('servers_user_id_idx');
    expect(indexNames).toContain('agents_server_id_idx');
    expect(indexNames).toContain('profiles_server_id_idx');
    expect(indexNames).toContain('sessions_user_id_idx');
    expect(indexNames).toContain('sessions_server_id_idx');
    expect(indexNames).toContain('operations_server_id_idx');
    expect(indexNames).toContain('operations_user_id_idx');
    expect(indexNames).toContain('operations_session_id_idx');
    expect(indexNames).toContain('operations_status_idx');
    expect(indexNames).toContain('snapshots_server_id_idx');
    expect(indexNames).toContain('snapshots_operation_id_idx');
    expect(indexNames).toContain('tasks_server_id_idx');
    expect(indexNames).toContain('tasks_user_id_idx');
    expect(indexNames).toContain('tasks_status_idx');
    expect(indexNames).toContain('alerts_server_id_idx');
    expect(indexNames).toContain('alerts_resolved_idx');
    expect(indexNames).toContain('knowledge_cache_software_idx');
    expect(indexNames).toContain('knowledge_cache_platform_idx');
    expect(indexNames).toContain('knowledge_cache_software_platform_idx');
    expect(indexNames).toContain('metrics_hourly_server_id_idx');
    expect(indexNames).toContain('metrics_hourly_server_bucket_idx');
    expect(indexNames).toContain('metrics_daily_server_id_idx');
    expect(indexNames).toContain('metrics_daily_server_bucket_idx');
  });

  it('should be idempotent (safe to run multiple times)', () => {
    const sqlite = new Database(':memory:');
    openConnections.push(sqlite);
    sqlite.pragma('foreign_keys = ON');

    const db = drizzle(sqlite, { schema });

    // Run migrations twice
    runMigrationsWithConnection(db, MIGRATIONS_PATH);
    runMigrationsWithConnection(db, MIGRATIONS_PATH);

    const tables = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%' ORDER BY name")
      .all() as { name: string }[];

    expect(tables).toHaveLength(17);
  });
});

// ============================================================================
// Column structure tests
// ============================================================================

describe('migrate: table structure', () => {
  it('should create users table with correct columns', () => {
    const sqlite = new Database(':memory:');
    openConnections.push(sqlite);
    const db = drizzle(sqlite, { schema });
    runMigrationsWithConnection(db, MIGRATIONS_PATH);

    const columns = sqlite
      .prepare("PRAGMA table_info('users')")
      .all() as { name: string; type: string; notnull: number }[];

    const colNames = columns.map((c) => c.name);
    expect(colNames).toContain('id');
    expect(colNames).toContain('email');
    expect(colNames).toContain('password_hash');
    expect(colNames).toContain('name');
    expect(colNames).toContain('timezone');
    expect(colNames).toContain('created_at');
    expect(colNames).toContain('updated_at');
  });

  it('should create operations table with all 16 columns', () => {
    const sqlite = new Database(':memory:');
    openConnections.push(sqlite);
    const db = drizzle(sqlite, { schema });
    runMigrationsWithConnection(db, MIGRATIONS_PATH);

    const columns = sqlite
      .prepare("PRAGMA table_info('operations')")
      .all() as { name: string }[];

    expect(columns).toHaveLength(16);
    const colNames = columns.map((c) => c.name);
    expect(colNames).toContain('snapshot_id');
    expect(colNames).toContain('duration');
    expect(colNames).toContain('completed_at');
    expect(colNames).toContain('input_tokens');
    expect(colNames).toContain('output_tokens');
  });
});

// ============================================================================
// Foreign key constraint tests (post-migration)
// ============================================================================

describe('migrate: foreign key enforcement', () => {
  it('should enforce foreign key on servers.user_id', () => {
    const { db } = createTestDb();
    runMigrationsWithConnection(db, MIGRATIONS_PATH);

    expect(() => {
      db.insert(schema.servers).values({
        id: `srv-${randomUUID()}`,
        name: 'test',
        userId: 'nonexistent-user',
        status: 'offline',
        createdAt: now(),
        updatedAt: now(),
      }).run();
    }).toThrow(/FOREIGN KEY/);
  });

  it('should cascade delete servers when user is deleted', async () => {
    const { db } = createTestDb();
    runMigrationsWithConnection(db, MIGRATIONS_PATH);

    const userId = `usr-${randomUUID()}`;
    await db.insert(schema.users).values({
      id: userId,
      email: `test-${randomUUID()}@test.com`,
      passwordHash: 'hash',
      createdAt: now(),
      updatedAt: now(),
    });

    const serverId = `srv-${randomUUID()}`;
    await db.insert(schema.servers).values({
      id: serverId,
      name: 'test-server',
      userId,
      status: 'offline',
      createdAt: now(),
      updatedAt: now(),
    });

    await db.delete(schema.users).where(eq(schema.users.id, userId));

    const remaining = await db.select().from(schema.servers);
    expect(remaining).toHaveLength(0);
  });
});

// ============================================================================
// CRUD operations on migrated database
// ============================================================================

describe('migrate: CRUD on migrated tables', () => {
  it('should support full insert/select/update/delete cycle', async () => {
    const { db } = createTestDb();
    runMigrationsWithConnection(db, MIGRATIONS_PATH);

    // Insert
    const userId = `usr-${randomUUID()}`;
    await db.insert(schema.users).values({
      id: userId,
      email: `crud-${randomUUID()}@test.com`,
      passwordHash: 'hashed',
      name: 'CRUD Test',
      createdAt: now(),
      updatedAt: now(),
    });

    // Select
    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
    expect(user.name).toBe('CRUD Test');

    // Update
    await db.update(schema.users).set({ name: 'Updated' }).where(eq(schema.users.id, userId));
    const [updated] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
    expect(updated.name).toBe('Updated');

    // Delete
    await db.delete(schema.users).where(eq(schema.users.id, userId));
    const remaining = await db.select().from(schema.users).where(eq(schema.users.id, userId));
    expect(remaining).toHaveLength(0);
  });

  it('should handle JSON columns correctly after migration', async () => {
    const { db } = createTestDb();
    runMigrationsWithConnection(db, MIGRATIONS_PATH);

    const userId = `usr-${randomUUID()}`;
    await db.insert(schema.users).values({
      id: userId,
      email: `json-${randomUUID()}@test.com`,
      passwordHash: 'hash',
      createdAt: now(),
      updatedAt: now(),
    });

    const serverId = `srv-${randomUUID()}`;
    await db.insert(schema.servers).values({
      id: serverId,
      name: 'json-test',
      userId,
      tags: ['prod', 'web'],
      createdAt: now(),
      updatedAt: now(),
    });

    const [server] = await db.select().from(schema.servers).where(eq(schema.servers.id, serverId));
    expect(server.tags).toEqual(['prod', 'web']);
  });
});

// ============================================================================
// runMigrationsWithConnection tests
// ============================================================================

describe('migrate: runMigrationsWithConnection', () => {
  it('should apply migrations using an existing connection', () => {
    const { sqlite, db } = createTestDb();
    runMigrationsWithConnection(db, MIGRATIONS_PATH);

    const tables = sqlite
      .prepare("SELECT count(*) as cnt FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%'")
      .get() as { cnt: number };

    expect(tables.cnt).toBe(17);
  });
});
