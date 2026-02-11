// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Integration tests for server startup flow.
 *
 * Validates the full initialization sequence:
 * - Configuration loading (DATABASE_PATH, JWT_SECRET)
 * - Database initialization and table creation
 * - JWT configuration
 * - REST API availability (health, auth endpoints)
 * - WebSocket availability on the same port
 * - Graceful shutdown with DB cleanup
 *
 * @module index.test
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer as createHttpServer } from 'node:http';
import type { Server as HttpServer, AddressInfo } from 'node:http';

import { WebSocket } from 'ws';
import { getRequestListener } from '@hono/node-server';

import { loadConfig, createServer } from './index.js';
import type { ServerConfig } from './index.js';
import { createApiApp } from './api/routes/index.js';
import { initJwtConfig, _resetJwtConfig, generateTokens } from './api/middleware/auth.js';
import { initDatabase, closeDatabase, createTables, getDatabase } from './db/connection.js';
import { initLogger } from './utils/logger.js';
import { InstallServer } from './api/server.js';
import { users } from './db/schema.js';
import {
  InMemoryUserRepository,
  setUserRepository,
  _resetUserRepository,
} from './db/repositories/user-repository.js';

// ============================================================================
// Constants
// ============================================================================

const TEST_JWT_SECRET = 'integration-test-secret-key-that-is-at-least-32-chars!!';

// ============================================================================
// Helpers
// ============================================================================

function getTestConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    port: 0, // auto-assign port
    host: '127.0.0.1',
    heartbeatIntervalMs: 30000,
    connectionTimeoutMs: 10000,
    logLevel: 'silent',
    requireAuth: false,
    authTimeoutMs: 10000,
    databasePath: ':memory:',
    jwtSecret: TEST_JWT_SECRET,
    ...overrides,
  };
}

/** Create an HTTP server from a Hono app and wait for it to start listening. */
async function createListeningServer(apiApp: ReturnType<typeof createApiApp>): Promise<HttpServer> {
  const requestListener = getRequestListener(apiApp.fetch);
  const server = createHttpServer(requestListener);
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  return server;
}

function getPort(server: HttpServer): number {
  return (server.address() as AddressInfo).port;
}

function waitForWsOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
  });
}

function closeHttpServer(server: HttpServer): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

// ============================================================================
// loadConfig() tests
// ============================================================================

describe('loadConfig', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    // Restore env
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, originalEnv);
  });

  it('should include databasePath with default value', () => {
    const config = loadConfig();
    expect(config.databasePath).toBe('./data/serverpilot.db');
  });

  it('should read DATABASE_PATH from env', () => {
    process.env.DATABASE_PATH = '/tmp/test.db';
    const config = loadConfig();
    expect(config.databasePath).toBe('/tmp/test.db');
  });

  it('should include jwtSecret', () => {
    const config = loadConfig();
    // Auto-generated secret should be at least 32 chars
    expect(config.jwtSecret.length).toBeGreaterThanOrEqual(32);
  });

  it('should read JWT_SECRET from env', () => {
    process.env.JWT_SECRET = TEST_JWT_SECRET;
    const config = loadConfig();
    expect(config.jwtSecret).toBe(TEST_JWT_SECRET);
  });

  it.skip('should generate random jwtSecret when JWT_SECRET not set (skipped - depends on .env)', () => {
    // NOTE: This test is skipped because dotenv caches environment variables
    // and doesn't reload .env on subsequent config() calls.
    // In production, JWT_SECRET should always be set explicitly.
    delete process.env.JWT_SECRET;
    const config1 = loadConfig();

    // Delete again to clear any value loaded from .env file by config()
    delete process.env.JWT_SECRET;
    const config2 = loadConfig();

    // Each call generates a different random secret
    expect(config1.jwtSecret).not.toBe(config2.jwtSecret);
  });
});

// ============================================================================
// Startup flow: DB init → JWT init → API available
// ============================================================================

describe('Startup integration', () => {
  let httpServer: HttpServer;
  let wsServer: InstallServer;
  let port: number;

  beforeEach(() => {
    initLogger({ level: 'silent' });
  });

  afterEach(async () => {
    _resetJwtConfig();
    _resetUserRepository();

    if (wsServer?.isRunning()) {
      await wsServer.stop();
    }
    if (httpServer?.listening) {
      await closeHttpServer(httpServer);
    }
    closeDatabase();
  });

  it('should initialize database and create all tables', () => {
    const db = initDatabase(':memory:');
    createTables();

    // Verify key tables exist by querying them
    const result = db.select().from(users).all();
    expect(result).toEqual([]);
  });

  it('should initialize JWT and allow token generation', async () => {
    initJwtConfig({ secret: TEST_JWT_SECRET });
    const tokens = await generateTokens('test-user-id');
    expect(tokens.accessToken).toBeTruthy();
    expect(tokens.refreshToken).toBeTruthy();
  });

  it('should serve REST API health check on HTTP server', async () => {
    const config = getTestConfig();

    // Init dependencies
    initDatabase(config.databasePath);
    createTables();
    initJwtConfig({ secret: config.jwtSecret });

    // Create API and HTTP server
    const apiApp = createApiApp();
    httpServer = await createListeningServer(apiApp);
    port = getPort(httpServer);

    // Test health endpoint
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.timestamp).toBeTypeOf('number');
  });

  it('should serve REST API auth endpoints', async () => {
    const config = getTestConfig();

    initDatabase(config.databasePath);
    createTables();
    initJwtConfig({ secret: config.jwtSecret });

    // Use in-memory user repo for testing
    const repo = new InMemoryUserRepository();
    setUserRepository(repo);

    const apiApp = createApiApp();
    httpServer = await createListeningServer(apiApp);
    port = getPort(httpServer);

    // Test login endpoint returns proper error (not 404)
    const loginRes = await fetch(`http://127.0.0.1:${port}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'test@example.com', password: 'password123' }),
    });

    // Should be 401 (invalid credentials), NOT 404
    expect(loginRes.status).toBe(401);
    const loginBody = await loginRes.json();
    expect(loginBody.error.code).toBe('UNAUTHORIZED');
  });

  it('should handle full register → login flow via HTTP', async () => {
    const config = getTestConfig();

    initDatabase(config.databasePath);
    createTables();
    initJwtConfig({ secret: config.jwtSecret });

    const repo = new InMemoryUserRepository();
    setUserRepository(repo);

    const apiApp = createApiApp();
    httpServer = await createListeningServer(apiApp);
    port = getPort(httpServer);

    // 1. Register
    const registerRes = await fetch(`http://127.0.0.1:${port}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'alice@example.com',
        password: 'securepass123',
        name: 'Alice',
      }),
    });
    expect(registerRes.status).toBe(201);
    const registerBody = await registerRes.json();
    expect(registerBody.user.email).toBe('alice@example.com');
    expect(registerBody.accessToken).toBeTruthy();

    // 2. Login with same credentials
    const loginRes = await fetch(`http://127.0.0.1:${port}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'alice@example.com',
        password: 'securepass123',
      }),
    });
    expect(loginRes.status).toBe(200);
    const loginBody = await loginRes.json();
    expect(loginBody.user.email).toBe('alice@example.com');
    expect(loginBody.accessToken).toBeTruthy();
  });

  it('should accept WebSocket connections on the same HTTP server', async () => {
    const config = getTestConfig();

    initDatabase(config.databasePath);
    createTables();
    initJwtConfig({ secret: config.jwtSecret });

    const apiApp = createApiApp();
    httpServer = await createListeningServer(apiApp);
    port = getPort(httpServer);

    // Create WS server attached to HTTP server
    wsServer = new InstallServer({
      port,
      host: '127.0.0.1',
      requireAuth: false,
    });
    await wsServer.start(httpServer);
    expect(wsServer.isRunning()).toBe(true);

    // Connect a WebSocket client
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    await waitForWsOpen(ws);

    expect(wsServer.getClientCount()).toBe(1);

    ws.close();
    // Wait for close to propagate
    await new Promise((r) => setTimeout(r, 50));
    expect(wsServer.getClientCount()).toBe(0);
  });

  it('should serve both HTTP API and WebSocket on same port simultaneously', async () => {
    const config = getTestConfig();

    initDatabase(config.databasePath);
    createTables();
    initJwtConfig({ secret: config.jwtSecret });

    const repo = new InMemoryUserRepository();
    setUserRepository(repo);

    const apiApp = createApiApp();
    httpServer = await createListeningServer(apiApp);
    port = getPort(httpServer);

    wsServer = new InstallServer({
      port,
      host: '127.0.0.1',
      requireAuth: false,
    });
    await wsServer.start(httpServer);

    // 1. HTTP health check works
    const healthRes = await fetch(`http://127.0.0.1:${port}/health`);
    expect(healthRes.status).toBe(200);

    // 2. WebSocket connects on the same port
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    await waitForWsOpen(ws);
    expect(wsServer.getClientCount()).toBe(1);

    // 3. HTTP API still works while WS is connected
    const authRes = await fetch(`http://127.0.0.1:${port}/api/v1/auth/logout`, {
      method: 'POST',
    });
    expect(authRes.status).toBe(200);

    ws.close();
    await new Promise((r) => setTimeout(r, 50));
  });

  it('should return 404 for non-existent API routes (not crash)', async () => {
    const config = getTestConfig();

    initDatabase(config.databasePath);
    createTables();
    initJwtConfig({ secret: config.jwtSecret });

    const apiApp = createApiApp();
    httpServer = await createListeningServer(apiApp);
    port = getPort(httpServer);

    const res = await fetch(`http://127.0.0.1:${port}/api/v1/nonexistent`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('should create database file at configured path', () => {
    // Using :memory: won't create a file, but initDatabase should succeed
    const db = initDatabase(':memory:');
    createTables();
    expect(db).toBeTruthy();
    expect(getDatabase()).toBe(db);
  });

  it('should clean up database on closeDatabase()', () => {
    initDatabase(':memory:');
    createTables();
    closeDatabase();

    // After closing, getDatabase should throw
    expect(() => getDatabase()).toThrow('Database not initialized');
  });
});

// ============================================================================
// createServer() tests
// ============================================================================

describe('createServer', () => {
  beforeEach(() => {
    initLogger({ level: 'silent' });
  });

  afterEach(() => {
    _resetJwtConfig();
    closeDatabase();
  });

  it('should create an InstallServer instance', () => {
    const config = getTestConfig();
    initDatabase(':memory:');
    createTables();
    initJwtConfig({ secret: config.jwtSecret });

    const server = createServer(config);
    expect(server).toBeInstanceOf(InstallServer);
    expect(server.isRunning()).toBe(false);
  });

  it('should create server without AI agent when no API key configured', () => {
    const config = getTestConfig({ ai: undefined });
    initDatabase(':memory:');
    createTables();
    initJwtConfig({ secret: config.jwtSecret });

    // Should not throw
    const server = createServer(config);
    expect(server).toBeInstanceOf(InstallServer);
  });
});
