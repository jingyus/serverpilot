/**
 * ServerPilot Server entry point.
 *
 * Initializes the database, JWT configuration, REST API (Hono), and
 * WebSocket server on a single unified HTTP server. Handles graceful
 * shutdown of all components on SIGINT/SIGTERM.
 *
 * @module index
 */

import { randomBytes } from 'node:crypto';
import { createServer as createHttpServer } from 'node:http';
import type { Server as HttpServer } from 'node:http';

import { config } from 'dotenv';
import { getRequestListener } from '@hono/node-server';

import { InstallServer } from './api/server.js';
import type { InstallServerOptions } from './api/server.js';
import { routeMessage } from './api/handlers.js';
import { createApiApp } from './api/routes/index.js';
import { initJwtConfig } from './api/middleware/auth.js';
import { initDatabase, closeDatabase, createTables } from './db/connection.js';
import { getSnapshotService } from './core/snapshot/snapshot-service.js';
import { getRollbackService } from './core/rollback/rollback-service.js';
import { getTaskExecutor } from './core/task/executor.js';
import { getTaskScheduler } from './core/task/scheduler.js';
import { initAgentConnector } from './core/agent/agent-connector.js';
import { InstallAIAgent } from './ai/agent.js';
import { initLogger, logger, logConnectionEvent, logError } from './utils/logger.js';
import { getMemoryMonitor } from './utils/memory-monitor.js';
import { getAlertEvaluator } from './core/alert/alert-evaluator.js';
import { createEmailNotifier } from './core/alert/email-notifier.js';
import { createDocAutoFetcher, type DocAutoFetcher } from './knowledge/doc-auto-fetcher.js';
import { startMetricsCleanupScheduler, stopMetricsCleanupScheduler } from './core/metrics-cleanup-scheduler.js';

// ============================================================================
// Constants
// ============================================================================

export const SERVER_NAME = '@aiinstaller/server';
export const SERVER_VERSION = '0.1.0';

// ============================================================================
// Global State
// ============================================================================

/** Global reference to the documentation auto-fetcher (for graceful shutdown) */
let _docAutoFetcher: DocAutoFetcher | null = null;

// ============================================================================
// Environment Configuration
// ============================================================================

/** Server configuration derived from environment variables */
export interface ServerConfig {
  /** Server listening port */
  port: number;
  /** Server bind host */
  host: string;
  /** WebSocket heartbeat interval in ms */
  heartbeatIntervalMs: number;
  /** WebSocket connection timeout in ms */
  connectionTimeoutMs: number;
  /** Log level */
  logLevel: string;
  /** Require authentication for connections */
  requireAuth: boolean;
  /** Authentication timeout in ms */
  authTimeoutMs: number;
  /** Path to the SQLite database file */
  databasePath: string;
  /** JWT secret key (min 32 chars) */
  jwtSecret: string;
  /** AI configuration */
  ai?: {
    /** Anthropic API key */
    apiKey: string;
    /** Model to use */
    model?: string;
    /** Request timeout in ms */
    timeoutMs?: number;
    /** Maximum retry attempts */
    maxRetries?: number;
  };
  /** Knowledge base configuration */
  knowledgeBase?: {
    /** GitHub API token for fetching docs */
    githubToken?: string;
    /** Auto-fetch check interval in hours */
    checkIntervalHours?: number;
    /** Whether to run fetch immediately on startup */
    runOnStart?: boolean;
    /** Maximum concurrent fetch operations */
    maxConcurrent?: number;
  };
}

/**
 * Load configuration from environment variables.
 *
 * Reads from .env file (if present) and process.env. Falls back to
 * sensible defaults for all values. Generates a random JWT secret
 * in development if not explicitly configured.
 *
 * @returns The resolved server configuration
 */
export function loadConfig(): ServerConfig {
  config();

  // Generate a random JWT secret if not set (development only)
  const jwtSecret = process.env.JWT_SECRET ?? randomBytes(32).toString('base64');

  const serverConfig: ServerConfig = {
    port: parseInt(process.env.SERVER_PORT ?? '3000', 10),
    host: process.env.SERVER_HOST ?? '0.0.0.0',
    heartbeatIntervalMs: parseInt(process.env.WS_HEARTBEAT_INTERVAL_MS ?? '30000', 10),
    connectionTimeoutMs: parseInt(process.env.WS_CONNECTION_TIMEOUT_MS ?? '10000', 10),
    logLevel: process.env.LOG_LEVEL ?? 'info',
    requireAuth: process.env.WS_REQUIRE_AUTH !== 'false', // Default to true
    authTimeoutMs: parseInt(process.env.WS_AUTH_TIMEOUT_MS ?? '10000', 10),
    databasePath: process.env.DATABASE_PATH ?? './data/serverpilot.db',
    jwtSecret,
  };

  // Load AI configuration if API key is present
  if (process.env.ANTHROPIC_API_KEY) {
    serverConfig.ai = {
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: process.env.AI_MODEL,
      timeoutMs: process.env.AI_TIMEOUT_MS ? parseInt(process.env.AI_TIMEOUT_MS, 10) : undefined,
      maxRetries: process.env.AI_MAX_RETRIES ? parseInt(process.env.AI_MAX_RETRIES, 10) : undefined,
    };
  }

  // Load knowledge base configuration
  serverConfig.knowledgeBase = {
    githubToken: process.env.GITHUB_TOKEN,
    checkIntervalHours: process.env.KB_CHECK_INTERVAL_HOURS
      ? parseInt(process.env.KB_CHECK_INTERVAL_HOURS, 10)
      : 24, // Default: check daily
    runOnStart: process.env.KB_RUN_ON_START !== 'false', // Default: true
    maxConcurrent: process.env.KB_MAX_CONCURRENT
      ? parseInt(process.env.KB_MAX_CONCURRENT, 10)
      : 3,
  };

  return serverConfig;
}

// ============================================================================
// Server Bootstrap
// ============================================================================

/**
 * Create and configure an InstallServer with message routing.
 *
 * @param serverConfig - The server configuration
 * @returns The configured InstallServer instance
 */
export function createServer(serverConfig: ServerConfig): InstallServer {
  const options: InstallServerOptions = {
    port: serverConfig.port,
    host: serverConfig.host,
    heartbeatIntervalMs: serverConfig.heartbeatIntervalMs,
    connectionTimeoutMs: serverConfig.connectionTimeoutMs,
    requireAuth: serverConfig.requireAuth,
    authTimeoutMs: serverConfig.authTimeoutMs,
  };

  const server = new InstallServer(options);

  // Create AI agent if configuration is provided
  let aiAgent: InstallAIAgent | undefined;
  if (serverConfig.ai) {
    aiAgent = new InstallAIAgent(serverConfig.ai);
    logger.info({
      operation: 'initialization',
      model: serverConfig.ai.model ?? 'claude-sonnet-4-20250514',
    }, 'AI agent initialized');
  } else {
    logger.warn({
      operation: 'initialization',
    }, 'AI agent not initialized - ANTHROPIC_API_KEY not configured');
  }

  // Initialize services that depend on the server instance
  // Note: TaskExecutor must be initialized before TaskScheduler
  initAgentConnector(server);
  getSnapshotService(server);
  getRollbackService(server);
  getTaskExecutor(server);
  getTaskScheduler(server);

  server.on('message', async (clientId, message) => {
    const result = await routeMessage(server, clientId, message, aiAgent);
    if (!result.success) {
      logError(
        new Error(result.error),
        { clientId, operation: 'message_handler' },
        `Handler error for ${message.type}`
      );
    }
  });

  server.on('connection', (clientId) => {
    logConnectionEvent('connect', { clientId });
  });

  server.on('disconnect', (clientId) => {
    logConnectionEvent('disconnect', { clientId });
  });

  server.on('error', (clientId, error) => {
    logConnectionEvent('error', { clientId }, { errorMessage: error.message });
  });

  return server;
}

/**
 * Register process signal handlers for graceful shutdown.
 *
 * Listens for SIGINT and SIGTERM, stops the server, closes the
 * database connection, and exits cleanly.
 *
 * @param server - The running InstallServer instance
 * @param httpServer - The HTTP server to close
 */
export function registerShutdownHandlers(server: InstallServer, httpServer?: HttpServer): void {
  let shuttingDown = false;

  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info({ operation: 'shutdown', signal }, `Received ${signal}, shutting down...`);

    try {
      getAlertEvaluator().stop();
      getTaskScheduler().stop();
      stopMetricsCleanupScheduler();
      if (_docAutoFetcher) {
        _docAutoFetcher.stop();
      }
      await server.stop();

      if (httpServer) {
        await new Promise<void>((resolve, reject) => {
          httpServer.close((err) => (err ? reject(err) : resolve()));
        });
      }

      closeDatabase();
      logger.info({ operation: 'shutdown' }, 'Server stopped gracefully');
      process.exit(0);
    } catch (err) {
      logError(err as Error, { operation: 'shutdown' }, 'Error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

/**
 * Start the ServerPilot server.
 *
 * Performs the full initialization sequence:
 * 1. Load configuration from environment
 * 2. Initialize database (SQLite + tables)
 * 3. Initialize JWT authentication
 * 4. Create Hono REST API
 * 5. Create unified HTTP server (REST API + WebSocket)
 * 6. Start background services (memory monitor, task scheduler, alert evaluator)
 *
 * @returns The started InstallServer instance
 */
export async function startServer(): Promise<InstallServer> {
  const serverConfig = loadConfig();

  // Initialize logger first
  initLogger({ level: serverConfig.logLevel });

  // 1. Initialize database
  logger.info({ operation: 'startup', databasePath: serverConfig.databasePath }, 'Initializing database...');
  initDatabase(serverConfig.databasePath);
  createTables();
  logger.info({ operation: 'startup' }, 'Database initialized with tables');

  // 2. Initialize JWT
  initJwtConfig({ secret: serverConfig.jwtSecret });
  logger.info({ operation: 'startup' }, 'JWT configuration initialized');

  // 3. Create Hono REST API
  const apiApp = createApiApp();
  logger.info({ operation: 'startup' }, 'REST API created');

  // 4. Create WebSocket server (message routing, services)
  const server = createServer(serverConfig);

  // 5. Create unified HTTP server (REST API + WebSocket on same port)
  const requestListener = getRequestListener(apiApp.fetch);
  const httpServer = createHttpServer(requestListener);

  // Attach WebSocket upgrade handling to the HTTP server
  registerShutdownHandlers(server, httpServer);
  await server.start(httpServer);

  // Start listening
  await new Promise<void>((resolve) => {
    httpServer.listen(serverConfig.port, serverConfig.host, resolve);
  });

  // Start memory monitoring (500MB threshold, sample every 30s)
  const memoryMonitor = getMemoryMonitor({ thresholdMB: 500, intervalMs: 30000 });
  memoryMonitor.start();
  const memStats = memoryMonitor.getStats();
  logger.info({
    operation: 'startup',
    rssMB: memStats.current.rssMB,
    heapUsedMB: memStats.current.heapUsedMB,
    thresholdMB: memStats.thresholdMB,
  }, `Memory monitor started (RSS: ${memStats.current.rssMB}MB, threshold: ${memStats.thresholdMB}MB)`);

  // Start the task scheduler for cron-based task execution
  const taskScheduler = getTaskScheduler();
  taskScheduler.start();
  logger.info({ operation: 'startup' }, 'Task scheduler started');

  // Start the alert evaluator for threshold monitoring
  const emailNotifier = createEmailNotifier();
  const alertEvaluator = getAlertEvaluator(emailNotifier);
  alertEvaluator.start();
  logger.info(
    { operation: 'startup', emailEnabled: emailNotifier !== null },
    'Alert evaluator started',
  );

  // Start the documentation auto-fetcher for knowledge base updates
  if (serverConfig.knowledgeBase) {
    _docAutoFetcher = createDocAutoFetcher(process.cwd(), {
      githubToken: serverConfig.knowledgeBase.githubToken,
      checkIntervalMs: (serverConfig.knowledgeBase.checkIntervalHours ?? 24) * 60 * 60 * 1000,
      runOnStart: serverConfig.knowledgeBase.runOnStart,
      maxConcurrent: serverConfig.knowledgeBase.maxConcurrent,
    });
    _docAutoFetcher.start();
    logger.info(
      {
        operation: 'startup',
        checkIntervalHours: serverConfig.knowledgeBase.checkIntervalHours,
        runOnStart: serverConfig.knowledgeBase.runOnStart,
      },
      'Documentation auto-fetcher started',
    );
  }

  // Start the metrics cleanup scheduler
  startMetricsCleanupScheduler();
  logger.info({ operation: 'startup' }, 'Metrics cleanup scheduler started');

  logger.info({
    operation: 'startup',
    version: SERVER_VERSION,
    host: serverConfig.host,
    port: serverConfig.port,
  }, `Server listening on ${serverConfig.host}:${serverConfig.port} (HTTP + WebSocket)`);

  return server;
}

// ============================================================================
// Main Entry Point
// ============================================================================

/**
 * Main function — invoked when running the server directly.
 * Wrapped in an async IIFE to support top-level await in ESM.
 */
async function main(): Promise<void> {
  try {
    await startServer();
  } catch (err) {
    logError(err as Error, { operation: 'startup' }, 'Failed to start server');
    process.exit(1);
  }
}

// Only run main when this module is executed directly (not imported)
const isMainModule =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  (process.argv[1].endsWith('/index.js') ||
    process.argv[1].endsWith('/index.ts') ||
    process.argv[1].includes('@aiinstaller/server'));

if (isMainModule) {
  main();
}
