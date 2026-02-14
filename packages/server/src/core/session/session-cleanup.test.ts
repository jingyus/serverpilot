// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for automatic session cleanup module.
 *
 * Validates retention-based cleanup, cascade deletion of session_messages,
 * configurable retention via SESSION_RETENTION_DAYS, scheduler lifecycle,
 * dry-run logging, and status reporting.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import type { DrizzleDB } from "../../db/connection.js";
import {
  getRetentionDays,
  countExpiredSessions,
  deleteExpiredSessions,
  runCleanup,
  startSessionCleanup,
  stopSessionCleanup,
  isSessionCleanupRunning,
  getSessionCleanupStatus,
  _resetSessionCleanup,
} from "./session-cleanup.js";

// ============================================================================
// Mock Setup
// ============================================================================

const mockGetDatabase = vi.fn();

vi.mock("../../db/connection.js", () => ({
  getDatabase: (...args: unknown[]) => mockGetDatabase(...args),
}));

vi.mock("../../utils/logger.js", () => ({
  createContextLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ============================================================================
// Helpers
// ============================================================================

let sqlite: Database.Database;
let db: DrizzleDB;

function setupTestDb(): void {
  sqlite = new Database(":memory:");
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  // Create sessions and session_messages tables matching schema.ts
  sqlite.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      email TEXT NOT NULL,
      password_hash TEXT NOT NULL
    )
  `);

  sqlite.exec(`
    CREATE TABLE servers (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      hostname TEXT NOT NULL
    )
  `);

  sqlite.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
      name TEXT,
      messages TEXT DEFAULT '[]',
      context TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  sqlite.exec(`
    CREATE TABLE session_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);

  db = drizzle(sqlite) as unknown as DrizzleDB;

  // Seed a user and server for FK constraints
  sqlite.exec(
    `INSERT INTO users (id, username, email, password_hash) VALUES ('u1', 'test', 'test@test.com', 'hash')`,
  );
  sqlite.exec(
    `INSERT INTO servers (id, user_id, name, hostname) VALUES ('s1', 'u1', 'Test Server', 'test.local')`,
  );
}

function insertSession(id: string, updatedAt: Date): void {
  const ts = Math.floor(updatedAt.getTime() / 1000);
  sqlite.exec(
    `INSERT INTO sessions (id, user_id, server_id, messages, created_at, updated_at)
     VALUES ('${id}', 'u1', 's1', '[]', ${ts}, ${ts})`,
  );
}

function insertSessionMessage(id: string, sessionId: string): void {
  const ts = Math.floor(Date.now() / 1000);
  sqlite.exec(
    `INSERT INTO session_messages (id, session_id, role, content, timestamp, created_at)
     VALUES ('${id}', '${sessionId}', 'user', 'hello', ${ts}, ${ts})`,
  );
}

function countSessions(): number {
  const row = sqlite.prepare("SELECT COUNT(*) as cnt FROM sessions").get() as {
    cnt: number;
  };
  return row.cnt;
}

function countMessages(): number {
  const row = sqlite
    .prepare("SELECT COUNT(*) as cnt FROM session_messages")
    .get() as { cnt: number };
  return row.cnt;
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

// ============================================================================
// Tests
// ============================================================================

describe("core/session/session-cleanup", () => {
  beforeEach(() => {
    setupTestDb();
    _resetSessionCleanup();
    vi.stubEnv("SESSION_RETENTION_DAYS", "");
    mockGetDatabase.mockReturnValue(db);
  });

  afterEach(() => {
    _resetSessionCleanup();
    sqlite.close();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  // --------------------------------------------------------------------------
  // getRetentionDays
  // --------------------------------------------------------------------------

  describe("getRetentionDays", () => {
    it("should return default 90 when env is not set", () => {
      expect(getRetentionDays()).toBe(90);
    });

    it("should read SESSION_RETENTION_DAYS from environment", () => {
      vi.stubEnv("SESSION_RETENTION_DAYS", "30");
      expect(getRetentionDays()).toBe(30);
    });

    it("should fallback to default for invalid values", () => {
      vi.stubEnv("SESSION_RETENTION_DAYS", "abc");
      expect(getRetentionDays()).toBe(90);
    });

    it("should fallback to default for zero or negative values", () => {
      vi.stubEnv("SESSION_RETENTION_DAYS", "0");
      expect(getRetentionDays()).toBe(90);

      vi.stubEnv("SESSION_RETENTION_DAYS", "-5");
      expect(getRetentionDays()).toBe(90);
    });
  });

  // --------------------------------------------------------------------------
  // countExpiredSessions
  // --------------------------------------------------------------------------

  describe("countExpiredSessions", () => {
    it("should return 0 when no sessions exist", () => {
      const cutoff = new Date();
      expect(countExpiredSessions(db, cutoff)).toBe(0);
    });

    it("should count only sessions older than cutoff", () => {
      insertSession("old-1", daysAgo(100));
      insertSession("old-2", daysAgo(95));
      insertSession("recent", daysAgo(10));

      const cutoff = daysAgo(90);
      expect(countExpiredSessions(db, cutoff)).toBe(2);
    });
  });

  // --------------------------------------------------------------------------
  // deleteExpiredSessions
  // --------------------------------------------------------------------------

  describe("deleteExpiredSessions", () => {
    it("should delete sessions older than cutoff", () => {
      insertSession("old-1", daysAgo(100));
      insertSession("recent", daysAgo(10));

      const cutoff = daysAgo(90);
      const deleted = deleteExpiredSessions(db, cutoff);

      expect(deleted).toBe(1);
      expect(countSessions()).toBe(1);
    });

    it("should cascade-delete associated session_messages", () => {
      insertSession("old-session", daysAgo(100));
      insertSessionMessage("msg-1", "old-session");
      insertSessionMessage("msg-2", "old-session");

      insertSession("new-session", daysAgo(10));
      insertSessionMessage("msg-3", "new-session");

      expect(countMessages()).toBe(3);

      const cutoff = daysAgo(90);
      deleteExpiredSessions(db, cutoff);

      expect(countSessions()).toBe(1);
      expect(countMessages()).toBe(1); // only msg-3 remains
    });

    it("should return 0 when no sessions match", () => {
      insertSession("recent", daysAgo(10));
      const cutoff = daysAgo(90);
      expect(deleteExpiredSessions(db, cutoff)).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // runCleanup
  // --------------------------------------------------------------------------

  describe("runCleanup", () => {
    it("should delete expired sessions and return result", () => {
      vi.stubEnv("SESSION_RETENTION_DAYS", "30");

      insertSession("expired-1", daysAgo(60));
      insertSession("expired-2", daysAgo(45));
      insertSession("active", daysAgo(5));

      const result = runCleanup(db);

      expect(result.deletedCount).toBe(2);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(result.cutoffDate).toBeTruthy();
      expect(countSessions()).toBe(1);
    });

    it("should return 0 deletedCount when no sessions are expired", () => {
      insertSession("recent", daysAgo(5));

      const result = runCleanup(db);

      expect(result.deletedCount).toBe(0);
      expect(result.durationMs).toBe(0);
    });

    it("should update lastResult in status", () => {
      insertSession("old", daysAgo(100));

      expect(getSessionCleanupStatus().lastResult).toBeNull();

      runCleanup(db);

      const status = getSessionCleanupStatus();
      expect(status.lastCleanupAt).not.toBeNull();
      expect(status.lastResult).not.toBeNull();
      expect(status.lastResult!.deletedCount).toBe(1);
    });
  });

  // --------------------------------------------------------------------------
  // Scheduler Lifecycle
  // --------------------------------------------------------------------------

  describe("scheduler lifecycle", () => {
    it("should start and stop correctly", () => {
      expect(isSessionCleanupRunning()).toBe(false);

      startSessionCleanup();
      expect(isSessionCleanupRunning()).toBe(true);

      stopSessionCleanup();
      expect(isSessionCleanupRunning()).toBe(false);
    });

    it("should be idempotent on double start", () => {
      startSessionCleanup();
      startSessionCleanup(); // no-op, no throw
      expect(isSessionCleanupRunning()).toBe(true);

      stopSessionCleanup();
    });

    it("should be idempotent on double stop", () => {
      startSessionCleanup();
      stopSessionCleanup();
      stopSessionCleanup(); // no-op, no throw
      expect(isSessionCleanupRunning()).toBe(false);
    });

    it("should reset state via _resetSessionCleanup", () => {
      startSessionCleanup();
      // Run cleanup manually to populate lastResult
      insertSession("old", daysAgo(100));
      runCleanup(db);

      const status = getSessionCleanupStatus();
      expect(status.running).toBe(true);
      expect(status.lastCleanupAt).not.toBeNull();

      _resetSessionCleanup();

      const resetStatus = getSessionCleanupStatus();
      expect(resetStatus.running).toBe(false);
      expect(resetStatus.lastCleanupAt).toBeNull();
      expect(resetStatus.lastResult).toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // Status
  // --------------------------------------------------------------------------

  describe("getSessionCleanupStatus", () => {
    it("should return complete status object", () => {
      const status = getSessionCleanupStatus();
      expect(status).toHaveProperty("running");
      expect(status).toHaveProperty("retentionDays");
      expect(status).toHaveProperty("lastCleanupAt");
      expect(status).toHaveProperty("lastResult");
      expect(typeof status.retentionDays).toBe("number");
    });

    it("should reflect running state", () => {
      expect(getSessionCleanupStatus().running).toBe(false);
      startSessionCleanup();
      expect(getSessionCleanupStatus().running).toBe(true);
      stopSessionCleanup();
      expect(getSessionCleanupStatus().running).toBe(false);
    });

    it("should reflect configured retention days", () => {
      vi.stubEnv("SESSION_RETENTION_DAYS", "45");
      expect(getSessionCleanupStatus().retentionDays).toBe(45);
    });
  });
});
