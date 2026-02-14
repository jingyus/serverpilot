// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for SQLite database maintenance module.
 *
 * Validates WAL checkpoint, PRAGMA optimize, VACUUM, scheduler
 * lifecycle, and status reporting.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import {
  startDbMaintenance,
  stopDbMaintenance,
  isDbMaintenanceRunning,
  runWalCheckpoint,
  runPragmaOptimize,
  runVacuum,
  getMaintenanceStatus,
  _resetDbMaintenance,
} from "./maintenance.js";

// ============================================================================
// Mock Setup
// ============================================================================

// We need to provide a real SQLite database for pragma calls
let testDb: Database.Database;

vi.mock("./connection.js", () => ({
  getRawDatabase: () => testDb,
}));

vi.mock("../utils/logger.js", () => ({
  createContextLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ============================================================================
// Tests
// ============================================================================

describe("db/maintenance", () => {
  beforeEach(() => {
    testDb = new Database(":memory:");
    testDb.pragma("journal_mode = WAL");
    // Create a table and insert some data so VACUUM has something to work with
    testDb.exec("CREATE TABLE test_data (id INTEGER PRIMARY KEY, value TEXT)");
    testDb.exec("INSERT INTO test_data (value) VALUES ('hello'), ('world')");
    _resetDbMaintenance();
  });

  afterEach(() => {
    _resetDbMaintenance();
    testDb.close();
    vi.restoreAllMocks();
  });

  // --------------------------------------------------------------------------
  // WAL Checkpoint
  // --------------------------------------------------------------------------

  describe("runWalCheckpoint", () => {
    it("should execute WAL checkpoint without error", () => {
      expect(() => runWalCheckpoint()).not.toThrow();
    });

    it("should update last checkpoint time in status", () => {
      const before = getMaintenanceStatus();
      expect(before.lastWalCheckpoint).toBeNull();

      runWalCheckpoint();

      const after = getMaintenanceStatus();
      expect(after.lastWalCheckpoint).not.toBeNull();
      // Should be a valid ISO timestamp
      expect(new Date(after.lastWalCheckpoint!).getTime()).toBeGreaterThan(0);
    });
  });

  // --------------------------------------------------------------------------
  // PRAGMA Optimize
  // --------------------------------------------------------------------------

  describe("runPragmaOptimize", () => {
    it("should execute PRAGMA optimize without error", () => {
      expect(() => runPragmaOptimize()).not.toThrow();
    });

    it("should update last optimize time in status", () => {
      const before = getMaintenanceStatus();
      expect(before.lastPragmaOptimize).toBeNull();

      runPragmaOptimize();

      const after = getMaintenanceStatus();
      expect(after.lastPragmaOptimize).not.toBeNull();
      expect(new Date(after.lastPragmaOptimize!).getTime()).toBeGreaterThan(0);
    });
  });

  // --------------------------------------------------------------------------
  // VACUUM
  // --------------------------------------------------------------------------

  describe("runVacuum", () => {
    it("should execute VACUUM and return size info", () => {
      const result = runVacuum();

      expect(result).toHaveProperty("sizeBefore");
      expect(result).toHaveProperty("sizeAfter");
      expect(result).toHaveProperty("durationMs");
      expect(result.sizeBefore).toBeGreaterThanOrEqual(0);
      expect(result.sizeAfter).toBeGreaterThanOrEqual(0);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("should reclaim space after deleting rows", () => {
      // Insert more data to make the database larger
      for (let i = 0; i < 100; i++) {
        testDb.exec(
          `INSERT INTO test_data (value) VALUES ('${"x".repeat(500)}')`,
        );
      }
      // Delete all rows to create reclaimable space
      testDb.exec("DELETE FROM test_data");

      const result = runVacuum();
      // After VACUUM, the file size should be smaller or equal
      expect(result.sizeAfter).toBeLessThanOrEqual(result.sizeBefore);
    });
  });

  // --------------------------------------------------------------------------
  // Scheduler Lifecycle
  // --------------------------------------------------------------------------

  describe("scheduler lifecycle", () => {
    it("should start and stop correctly", () => {
      expect(isDbMaintenanceRunning()).toBe(false);

      startDbMaintenance();
      expect(isDbMaintenanceRunning()).toBe(true);

      stopDbMaintenance();
      expect(isDbMaintenanceRunning()).toBe(false);
    });

    it("should be idempotent on double start", () => {
      startDbMaintenance();
      startDbMaintenance(); // should not throw
      expect(isDbMaintenanceRunning()).toBe(true);

      stopDbMaintenance();
      expect(isDbMaintenanceRunning()).toBe(false);
    });

    it("should be idempotent on double stop", () => {
      startDbMaintenance();
      stopDbMaintenance();
      stopDbMaintenance(); // should not throw
      expect(isDbMaintenanceRunning()).toBe(false);
    });

    it("should reset state via _resetDbMaintenance", () => {
      startDbMaintenance();
      runWalCheckpoint();
      runPragmaOptimize();

      const status = getMaintenanceStatus();
      expect(status.running).toBe(true);
      expect(status.lastWalCheckpoint).not.toBeNull();

      _resetDbMaintenance();

      const resetStatus = getMaintenanceStatus();
      expect(resetStatus.running).toBe(false);
      expect(resetStatus.lastWalCheckpoint).toBeNull();
      expect(resetStatus.lastPragmaOptimize).toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // Status
  // --------------------------------------------------------------------------

  describe("getMaintenanceStatus", () => {
    it("should return complete status object", () => {
      const status = getMaintenanceStatus();
      expect(status).toHaveProperty("running");
      expect(status).toHaveProperty("lastWalCheckpoint");
      expect(status).toHaveProperty("lastPragmaOptimize");
      expect(status).toHaveProperty("dbSizeBytes");
      expect(status).toHaveProperty("walSizeBytes");
      expect(typeof status.dbSizeBytes).toBe("number");
      expect(typeof status.walSizeBytes).toBe("number");
    });

    it("should reflect running state", () => {
      expect(getMaintenanceStatus().running).toBe(false);
      startDbMaintenance();
      expect(getMaintenanceStatus().running).toBe(true);
      stopDbMaintenance();
      expect(getMaintenanceStatus().running).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // Error Resilience
  // --------------------------------------------------------------------------

  describe("error resilience", () => {
    it("should not throw if database is closed during WAL checkpoint", () => {
      testDb.close();
      // Should log error but not throw
      expect(() => runWalCheckpoint()).not.toThrow();
    });

    it("should not throw if database is closed during PRAGMA optimize", () => {
      testDb.close();
      expect(() => runPragmaOptimize()).not.toThrow();
    });
  });
});
