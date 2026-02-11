// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  resolveDbType,
  getDbType,
  isPostgres,
  isSQLite,
  initDatabaseFromEnv,
  closeDatabaseConnection,
  _resetDbType,
} from './db-factory.js';

describe('db-factory', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    _resetDbType();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('resolveDbType', () => {
    it('defaults to sqlite when DB_TYPE is not set', () => {
      delete process.env.DB_TYPE;
      expect(resolveDbType()).toBe('sqlite');
    });

    it('returns sqlite for DB_TYPE=sqlite', () => {
      process.env.DB_TYPE = 'sqlite';
      expect(resolveDbType()).toBe('sqlite');
    });

    it('returns postgres for DB_TYPE=postgres', () => {
      process.env.DB_TYPE = 'postgres';
      expect(resolveDbType()).toBe('postgres');
    });

    it('returns postgres for DB_TYPE=postgresql', () => {
      process.env.DB_TYPE = 'postgresql';
      expect(resolveDbType()).toBe('postgres');
    });

    it('is case-insensitive', () => {
      process.env.DB_TYPE = 'POSTGRES';
      expect(resolveDbType()).toBe('postgres');
    });

    it('returns sqlite for unknown values', () => {
      process.env.DB_TYPE = 'mysql';
      expect(resolveDbType()).toBe('sqlite');
    });
  });

  describe('getDbType', () => {
    it('returns sqlite by default', () => {
      expect(getDbType()).toBe('sqlite');
    });
  });

  describe('isPostgres / isSQLite', () => {
    it('isSQLite returns true by default', () => {
      expect(isSQLite()).toBe(true);
      expect(isPostgres()).toBe(false);
    });
  });

  describe('initDatabaseFromEnv — SQLite mode', () => {
    it('initializes SQLite database from env', async () => {
      delete process.env.DB_TYPE;
      process.env.DATABASE_PATH = ':memory:';

      const dbType = await initDatabaseFromEnv();
      expect(dbType).toBe('sqlite');
      expect(getDbType()).toBe('sqlite');
      expect(isSQLite()).toBe(true);

      await closeDatabaseConnection();
    });
  });

  describe('_resetDbType', () => {
    it('resets to sqlite', () => {
      // Simulate postgres state by setting env and resolving
      process.env.DB_TYPE = 'postgres';
      // _resetDbType resets the internal state
      _resetDbType();
      expect(getDbType()).toBe('sqlite');
    });
  });
});
