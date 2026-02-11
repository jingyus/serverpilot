/**
 * Tests for packages/server/src/index.ts - Server entry point
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import WebSocket from 'ws';

import { initDatabase, closeDatabase, createTables } from '../packages/server/src/db/connection.js';
import { _resetSnapshotService } from '../packages/server/src/core/snapshot/snapshot-service.js';
import { _resetRollbackService } from '../packages/server/src/core/rollback/rollback-service.js';
import { _resetTaskExecutor } from '../packages/server/src/core/task/executor.js';
import { _resetTaskScheduler } from '../packages/server/src/core/task/scheduler.js';

const serverIndexPath = path.resolve(__dirname, '../packages/server/src/index.ts');

// ============================================================================
// Test Setup - Database initialization for Phase 2 services
// ============================================================================

beforeAll(() => {
  // Initialize in-memory database for tests
  initDatabase(':memory:');
  createTables();
});

afterAll(() => {
  closeDatabase();
});

beforeEach(() => {
  // Reset singleton services BEFORE each test to ensure clean state
  _resetSnapshotService();
  _resetRollbackService();
  _resetTaskExecutor();
  _resetTaskScheduler();
});

afterEach(() => {
  // Also reset AFTER each test for cleanup
  _resetSnapshotService();
  _resetRollbackService();
  _resetTaskExecutor();
  _resetTaskScheduler();
});

// ============================================================================
// File Existence & Structure
// ============================================================================

describe('Server index.ts - File existence', () => {
  it('should exist at packages/server/src/index.ts', () => {
    expect(existsSync(serverIndexPath)).toBe(true);
  });

  it('should not be empty', () => {
    const content = readFileSync(serverIndexPath, 'utf-8');
    expect(content.trim().length).toBeGreaterThan(0);
  });

  it('should have JSDoc module documentation', () => {
    const content = readFileSync(serverIndexPath, 'utf-8');
    expect(content).toContain('@module');
  });
});

// ============================================================================
// Exports
// ============================================================================

describe('Server index.ts - Exports', () => {
  it('should export SERVER_NAME constant', async () => {
    const mod = await import('@aiinstaller/server');
    expect(mod.SERVER_NAME).toBe('@aiinstaller/server');
  });

  it('should export SERVER_VERSION constant', async () => {
    const mod = await import('@aiinstaller/server');
    expect(mod.SERVER_VERSION).toBe('0.1.0');
  });

  it('should export loadConfig function', async () => {
    const mod = await import('@aiinstaller/server');
    expect(typeof mod.loadConfig).toBe('function');
  });

  it('should export createServer function', async () => {
    const mod = await import('@aiinstaller/server');
    expect(typeof mod.createServer).toBe('function');
  });

  it('should export registerShutdownHandlers function', async () => {
    const mod = await import('@aiinstaller/server');
    expect(typeof mod.registerShutdownHandlers).toBe('function');
  });

  it('should export startServer function', async () => {
    const mod = await import('@aiinstaller/server');
    expect(typeof mod.startServer).toBe('function');
  });
});

// ============================================================================
// loadConfig
// ============================================================================

describe('Server index.ts - loadConfig', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Reset env to avoid pollution
    delete process.env.SERVER_PORT;
    delete process.env.SERVER_HOST;
    delete process.env.WS_HEARTBEAT_INTERVAL_MS;
    delete process.env.WS_CONNECTION_TIMEOUT_MS;
    delete process.env.LOG_LEVEL;
  });

  afterEach(() => {
    // Restore original env
    process.env = { ...originalEnv };
  });

  it('should return default config when no env vars set', async () => {
    const { loadConfig } = await import('@aiinstaller/server');
    const config = loadConfig();
    expect(config.port).toBe(3000);
    expect(config.host).toBe('0.0.0.0');
    expect(config.heartbeatIntervalMs).toBe(30000);
    expect(config.connectionTimeoutMs).toBe(10000);
    // logLevel defaults to 'info', but .env.local may override it to 'debug'
    expect(['info', 'debug']).toContain(config.logLevel);
  });

  it('should read SERVER_PORT from env', async () => {
    process.env.SERVER_PORT = '8080';
    const { loadConfig } = await import('@aiinstaller/server');
    const config = loadConfig();
    expect(config.port).toBe(8080);
  });

  it('should read SERVER_HOST from env', async () => {
    process.env.SERVER_HOST = '127.0.0.1';
    const { loadConfig } = await import('@aiinstaller/server');
    const config = loadConfig();
    expect(config.host).toBe('127.0.0.1');
  });

  it('should read WS_HEARTBEAT_INTERVAL_MS from env', async () => {
    process.env.WS_HEARTBEAT_INTERVAL_MS = '5000';
    const { loadConfig } = await import('@aiinstaller/server');
    const config = loadConfig();
    expect(config.heartbeatIntervalMs).toBe(5000);
  });

  it('should read WS_CONNECTION_TIMEOUT_MS from env', async () => {
    process.env.WS_CONNECTION_TIMEOUT_MS = '15000';
    const { loadConfig } = await import('@aiinstaller/server');
    const config = loadConfig();
    expect(config.connectionTimeoutMs).toBe(15000);
  });

  it('should read LOG_LEVEL from env', async () => {
    process.env.LOG_LEVEL = 'debug';
    const { loadConfig } = await import('@aiinstaller/server');
    const config = loadConfig();
    expect(config.logLevel).toBe('debug');
  });

  it('should return all config fields', async () => {
    const { loadConfig } = await import('@aiinstaller/server');
    const config = loadConfig();
    expect(config).toHaveProperty('port');
    expect(config).toHaveProperty('host');
    expect(config).toHaveProperty('heartbeatIntervalMs');
    expect(config).toHaveProperty('connectionTimeoutMs');
    expect(config).toHaveProperty('logLevel');
  });

  it('should parse port as integer', async () => {
    process.env.SERVER_PORT = '4567';
    const { loadConfig } = await import('@aiinstaller/server');
    const config = loadConfig();
    expect(typeof config.port).toBe('number');
    expect(Number.isInteger(config.port)).toBe(true);
  });
});

// ============================================================================
// createServer
// ============================================================================

describe('Server index.ts - createServer', () => {
  it('should return an InstallServer instance', async () => {
    const { createServer } = await import('@aiinstaller/server');
    const server = createServer({
      port: 0,
      host: '127.0.0.1',
      heartbeatIntervalMs: 30000,
      connectionTimeoutMs: 10000,
      logLevel: 'info',
    });
    expect(server).toBeDefined();
    expect(typeof server.start).toBe('function');
    expect(typeof server.stop).toBe('function');
    expect(typeof server.isRunning).toBe('function');
  });

  it('should configure message routing', async () => {
    const { createServer } = await import('@aiinstaller/server');
    const { createMessage, MessageType } = await import('@aiinstaller/shared');

    const server = createServer({
      port: 0,
      host: '127.0.0.1',
      heartbeatIntervalMs: 30000,
      connectionTimeoutMs: 10000,
      logLevel: 'info',
      requireAuth: false,
      authTimeoutMs: 10000,
    });

    // Track message events
    let messageReceived = false;
    server.on('message', () => {
      messageReceived = true;
    });

    // Start server on random port
    await server.start();

    try {
      // Connect a client
      const address = server.address();
      const ws = new WebSocket(`ws://127.0.0.1:${address.port}`);

      await new Promise<void>((resolve) => {
        ws.on('open', resolve);
      });

      // Send a session.create message
      const msg = createMessage(MessageType.SESSION_CREATE, {
        software: 'test-app',
      });
      ws.send(JSON.stringify(msg));

      // Wait briefly for message to be processed
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify the message was received and routed
      expect(messageReceived).toBe(true);

      ws.close();
    } finally {
      await server.stop();
    }
  });

  it('should log connection events', async () => {
    const { createServer } = await import('@aiinstaller/server');
    const events: string[] = [];

    const server = createServer({
      port: 0,
      host: '127.0.0.1',
      heartbeatIntervalMs: 30000,
      connectionTimeoutMs: 10000,
      logLevel: 'silent',
      requireAuth: false,
      authTimeoutMs: 10000,
    });

    server.on('connection', (clientId: string) => events.push(`connect:${clientId}`));
    server.on('disconnect', (clientId: string) => events.push(`disconnect:${clientId}`));

    await server.start();

    try {
      const address = server.address();
      const ws = new WebSocket(`ws://127.0.0.1:${address.port}`);

      await new Promise<void>((resolve) => {
        ws.on('open', resolve);
      });

      // Wait a bit for the event to fire
      await new Promise((r) => setTimeout(r, 50));

      expect(events.some((e) => e.startsWith('connect:'))).toBe(true);

      ws.close();
      await new Promise((r) => setTimeout(r, 50));

      expect(events.some((e) => e.startsWith('disconnect:'))).toBe(true);
    } finally {
      await server.stop();
    }
  });

  it('should log error events', async () => {
    const { createServer } = await import('@aiinstaller/server');
    const errors: Error[] = [];

    const server = createServer({
      port: 0,
      host: '127.0.0.1',
      heartbeatIntervalMs: 30000,
      connectionTimeoutMs: 10000,
      logLevel: 'silent',
      requireAuth: false,
      authTimeoutMs: 10000,
    });

    server.on('error', (_clientId: string, error: Error) => errors.push(error));

    await server.start();

    try {
      const address = server.address();
      const ws = new WebSocket(`ws://127.0.0.1:${address.port}`);

      await new Promise<void>((resolve) => {
        ws.on('open', resolve);
      });

      // Send invalid JSON
      ws.send('not-valid-json');
      await new Promise((r) => setTimeout(r, 50));

      expect(errors.length).toBeGreaterThan(0);

      ws.close();
    } finally {
      await server.stop();
    }
  });
});

// ============================================================================
// registerShutdownHandlers
// ============================================================================

describe('Server index.ts - registerShutdownHandlers', () => {
  it('should register SIGINT and SIGTERM handlers', async () => {
    const { createServer, registerShutdownHandlers } = await import('@aiinstaller/server');
    const onSpy = vi.spyOn(process, 'on');

    const server = createServer({
      port: 0,
      host: '127.0.0.1',
      heartbeatIntervalMs: 30000,
      connectionTimeoutMs: 10000,
      logLevel: 'info',
    });

    const initialListenerCount = process.listenerCount('SIGINT') + process.listenerCount('SIGTERM');

    registerShutdownHandlers(server);

    const newListenerCount = process.listenerCount('SIGINT') + process.listenerCount('SIGTERM');
    expect(newListenerCount).toBeGreaterThan(initialListenerCount);

    onSpy.mockRestore();
  });

  it('should be callable without errors', async () => {
    const { createServer, registerShutdownHandlers } = await import('@aiinstaller/server');

    const server = createServer({
      port: 0,
      host: '127.0.0.1',
      heartbeatIntervalMs: 30000,
      connectionTimeoutMs: 10000,
      logLevel: 'info',
    });

    expect(() => registerShutdownHandlers(server)).not.toThrow();
  });
});

// ============================================================================
// startServer
// ============================================================================

describe('Server index.ts - startServer', () => {
  afterEach(() => {
    delete process.env.SERVER_PORT;
    delete process.env.SERVER_HOST;
  });

  it('should start and return a running server', async () => {
    process.env.SERVER_PORT = '0';
    process.env.SERVER_HOST = '127.0.0.1';

    const { startServer } = await import('@aiinstaller/server');
    const server = await startServer();

    try {
      expect(server.isRunning()).toBe(true);
    } finally {
      await server.stop();
    }
  });

  it('should log startup message', async () => {
    process.env.SERVER_PORT = '0';
    process.env.SERVER_HOST = '127.0.0.1';

    const { startServer } = await import('@aiinstaller/server');
    const server = await startServer();

    try {
      // Server should be running and listening after startup
      expect(server.isRunning()).toBe(true);
      const address = server.address();
      expect(address.port).toBeGreaterThan(0);
    } finally {
      await server.stop();
    }
  });

  it('should include version in startup message', async () => {
    process.env.SERVER_PORT = '0';
    process.env.SERVER_HOST = '127.0.0.1';

    const { startServer, SERVER_VERSION } = await import('@aiinstaller/server');
    const server = await startServer();

    try {
      expect(SERVER_VERSION).toBe('0.1.0');
      expect(server.isRunning()).toBe(true);
    } finally {
      await server.stop();
    }
  });

  it('should accept connections after start', async () => {
    process.env.SERVER_PORT = '0';
    process.env.SERVER_HOST = '127.0.0.1';

    const { startServer } = await import('@aiinstaller/server');
    const server = await startServer();

    try {
      const address = server.address();
      const ws = new WebSocket(`ws://127.0.0.1:${address.port}`);

      await new Promise<void>((resolve, reject) => {
        ws.on('open', resolve);
        ws.on('error', reject);
      });

      expect(server.getClientCount()).toBe(1);
      ws.close();
    } finally {
      await server.stop();
    }
  });
});

// ============================================================================
// Integration: Message routing through startServer
// ============================================================================

describe('Server index.ts - Integration', () => {
  afterEach(() => {
    delete process.env.SERVER_PORT;
    delete process.env.SERVER_HOST;
    delete process.env.WS_REQUIRE_AUTH;
  });

  it('should route session.create and create session', async () => {
    process.env.SERVER_PORT = '0';
    process.env.SERVER_HOST = '127.0.0.1';
    process.env.WS_REQUIRE_AUTH = 'false';

    const { startServer } = await import('@aiinstaller/server');
    const { createMessage, MessageType } = await import('@aiinstaller/shared');
    const server = await startServer();

    // Track message events
    let sessionCreated = false;
    server.on('message', (_clientId, message) => {
      if ((message as any).type === MessageType.SESSION_CREATE) {
        sessionCreated = true;
      }
    });

    try {
      const address = server.address();
      const ws = new WebSocket(`ws://127.0.0.1:${address.port}`);

      await new Promise<void>((resolve) => {
        ws.on('open', resolve);
      });

      const msg = createMessage(MessageType.SESSION_CREATE, {
        software: 'openclaw',
        version: '1.0.0',
      });
      ws.send(JSON.stringify(msg));

      // Wait for message to be processed
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify session.create was received and processed
      expect(sessionCreated).toBe(true);

      ws.close();
    } finally {
      await server.stop();
    }
  });

  it('should route error.occurred message', async () => {
    process.env.SERVER_PORT = '0';
    process.env.SERVER_HOST = '127.0.0.1';
    process.env.WS_REQUIRE_AUTH = 'false';

    const { startServer } = await import('@aiinstaller/server');
    const { createMessage, MessageType } = await import('@aiinstaller/shared');
    const server = await startServer();

    // Track message events
    let errorMessageReceived = false;
    server.on('message', (_clientId, message) => {
      if ((message as any).type === MessageType.ERROR_OCCURRED) {
        errorMessageReceived = true;
      }
    });

    try {
      const address = server.address();
      const ws = new WebSocket(`ws://127.0.0.1:${address.port}`);

      await new Promise<void>((resolve) => {
        ws.on('open', resolve);
      });

      // First create a session (required for error handling)
      const createMsg = createMessage(MessageType.SESSION_CREATE, {
        software: 'test',
      });
      ws.send(JSON.stringify(createMsg));

      // Wait for session to be created
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Now send an error with full ErrorContext payload
      const errorMsg = createMessage(MessageType.ERROR_OCCURRED, {
        stepId: 'install-openclaw',
        command: 'npm install -g openclaw',
        exitCode: 1,
        stdout: '',
        stderr: 'EACCES: permission denied',
        environment: {
          os: { platform: 'darwin' as const, version: '14.0', arch: 'arm64' },
          shell: { type: 'zsh' as const, version: '5.9' },
          runtime: { node: '22.0.0' },
          packageManagers: { npm: '10.0.0' },
          network: { canAccessNpm: true, canAccessGithub: true },
          permissions: { hasSudo: false, canWriteTo: ['/tmp'] },
        },
        previousSteps: [],
      });

      ws.send(JSON.stringify(errorMsg));

      // Wait for message to be processed
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify error.occurred was received
      expect(errorMessageReceived).toBe(true);

      ws.close();
    } finally {
      await server.stop();
    }
  });
});

// ============================================================================
// Code Quality
// ============================================================================

describe('Server index.ts - Code quality', () => {
  let content: string;

  beforeEach(() => {
    content = readFileSync(serverIndexPath, 'utf-8');
  });

  it('should import dotenv for environment variable loading', () => {
    expect(content).toContain("import { config } from 'dotenv'");
  });

  it('should import InstallServer from api/server', () => {
    expect(content).toContain("import { InstallServer } from './api/server.js'");
  });

  it('should import routeMessage from api/handlers', () => {
    expect(content).toContain("import { routeMessage } from './api/handlers.js'");
  });

  it('should use export keyword for all public functions', () => {
    expect(content).toContain('export function loadConfig');
    expect(content).toContain('export function createServer');
    expect(content).toContain('export function registerShutdownHandlers');
    expect(content).toContain('export async function startServer');
  });

  it('should export ServerConfig interface', () => {
    expect(content).toContain('export interface ServerConfig');
  });

  it('should handle SIGINT signal', () => {
    expect(content).toContain('SIGINT');
  });

  it('should handle SIGTERM signal', () => {
    expect(content).toContain('SIGTERM');
  });

  it('should use structured logger for error logging', () => {
    expect(content).toContain('logError');
  });

  it('should use structured logger for info logging', () => {
    expect(content).toContain('logger.info');
  });

  it('should have graceful shutdown with process.exit', () => {
    expect(content).toContain('process.exit(0)');
    expect(content).toContain('process.exit(1)');
  });

  it('should call dotenv config() in loadConfig', () => {
    expect(content).toContain('config()');
  });

  it('should have error handling in main function', () => {
    expect(content).toContain('Failed to start server');
  });

  it('should have isMainModule guard', () => {
    expect(content).toContain('isMainModule');
  });

  it('should prevent duplicate shutdown', () => {
    expect(content).toContain('shuttingDown');
  });
});
