// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildPgConfigFromEnv } from './pg-connection.js';

describe('pg-connection', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    // Clear PG-related env vars
    delete process.env.DATABASE_URL;
    delete process.env.PG_HOST;
    delete process.env.PG_PORT;
    delete process.env.PG_DATABASE;
    delete process.env.PG_USER;
    delete process.env.PG_PASSWORD;
    delete process.env.PG_SSL;
    delete process.env.PG_POOL_MAX;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('buildPgConfigFromEnv', () => {
    it('uses DATABASE_URL when set', () => {
      process.env.DATABASE_URL = 'postgres://user:pass@host:5432/db';
      const config = buildPgConfigFromEnv();
      expect(config.connectionString).toBe('postgres://user:pass@host:5432/db');
      expect(config.host).toBeUndefined();
    });

    it('uses individual PG_ env vars as fallback', () => {
      process.env.PG_HOST = 'myhost';
      process.env.PG_PORT = '5433';
      process.env.PG_DATABASE = 'mydb';
      process.env.PG_USER = 'myuser';
      process.env.PG_PASSWORD = 'mypass';
      const config = buildPgConfigFromEnv();
      expect(config.host).toBe('myhost');
      expect(config.port).toBe(5433);
      expect(config.database).toBe('mydb');
      expect(config.user).toBe('myuser');
      expect(config.password).toBe('mypass');
      expect(config.connectionString).toBeUndefined();
    });

    it('applies default values when nothing is set', () => {
      const config = buildPgConfigFromEnv();
      expect(config.host).toBe('localhost');
      expect(config.port).toBe(5432);
      expect(config.database).toBe('serverpilot');
      expect(config.user).toBe('serverpilot');
      expect(config.password).toBe('');
    });

    it('enables SSL when PG_SSL=true', () => {
      process.env.DATABASE_URL = 'postgres://user:pass@host:5432/db';
      process.env.PG_SSL = 'true';
      const config = buildPgConfigFromEnv();
      expect(config.ssl).toEqual({ rejectUnauthorized: false });
    });

    it('does not enable SSL when PG_SSL is not true', () => {
      process.env.DATABASE_URL = 'postgres://user:pass@host:5432/db';
      process.env.PG_SSL = 'false';
      const config = buildPgConfigFromEnv();
      expect(config.ssl).toBeUndefined();
    });

    it('parses PG_POOL_MAX', () => {
      process.env.DATABASE_URL = 'postgres://user:pass@host:5432/db';
      process.env.PG_POOL_MAX = '50';
      const config = buildPgConfigFromEnv();
      expect(config.max).toBe(50);
    });

    it('defaults PG_POOL_MAX to 20', () => {
      const config = buildPgConfigFromEnv();
      expect(config.max).toBe(20);
    });
  });
});
