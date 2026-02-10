/**
 * Structured logging utility using Pino.
 *
 * Provides consistent log formatting with requestId, sessionId, and errorCode
 * tracking for easier debugging and troubleshooting.
 *
 * @module utils/logger
 */

import pino from 'pino';
import type { Logger as PinoLogger } from 'pino';

/**
 * Log context for tracking request/session flow.
 */
export interface LogContext {
  /** Unique request ID */
  requestId?: string;
  /** Session ID for tracking user sessions */
  sessionId?: string;
  /** Client ID for WebSocket connections */
  clientId?: string;
  /** Error code for categorizing errors */
  errorCode?: string;
  /** Additional metadata */
  [key: string]: unknown;
}

/**
 * Global logger instance configured with appropriate defaults.
 */
let globalLogger: PinoLogger;

/**
 * Initialize the logger with configuration.
 *
 * @param options - Pino logger options
 * @returns The configured logger instance
 */
export function initLogger(options?: pino.LoggerOptions): PinoLogger {
  const isDevelopment = process.env.NODE_ENV !== 'production';

  globalLogger = pino({
    level: process.env.LOG_LEVEL ?? 'info',
    ...options,
    // Pretty print in development for better readability
    transport: isDevelopment ? {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
      },
    } : undefined,
    // Base metadata
    base: {
      name: '@aiinstaller/server',
      version: '0.1.0',
    },
    // Timestamp format
    timestamp: pino.stdTimeFunctions.isoTime,
  });

  return globalLogger;
}

/**
 * Get the global logger instance.
 * Initializes with defaults if not already initialized.
 *
 * @returns The logger instance
 */
export function getLogger(): PinoLogger {
  if (!globalLogger) {
    initLogger();
  }
  return globalLogger;
}

/**
 * Create a child logger with additional context.
 *
 * This is useful for adding requestId, sessionId, or other contextual
 * information that should be included in all log entries for a specific flow.
 *
 * @param context - Context to bind to the child logger
 * @returns A child logger with the given context
 */
export function createContextLogger(context: LogContext): PinoLogger {
  const logger = getLogger();
  return logger.child(context);
}

/**
 * Log an AI operation (calls, streaming, etc.)
 *
 * @param operation - The operation being performed
 * @param context - Log context
 * @param data - Additional data to log
 */
export function logAIOperation(
  operation: 'call' | 'stream' | 'error' | 'fallback',
  context: LogContext,
  data?: Record<string, unknown>
): void {
  const logger = createContextLogger(context);

  const logData = {
    operation: 'ai',
    aiOperation: operation,
    ...data,
  };

  switch (operation) {
    case 'error':
      logger.error(logData, `AI operation failed: ${operation}`);
      break;
    case 'fallback':
      logger.warn(logData, `AI fallback triggered: ${operation}`);
      break;
    default:
      logger.info(logData, `AI operation: ${operation}`);
  }
}

/**
 * Log a connection event (connect, disconnect, error)
 *
 * @param event - The connection event
 * @param context - Log context
 * @param data - Additional data to log
 */
export function logConnectionEvent(
  event: 'connect' | 'disconnect' | 'error',
  context: LogContext,
  data?: Record<string, unknown>
): void {
  const logger = createContextLogger(context);

  const logData = {
    operation: 'connection',
    connectionEvent: event,
    ...data,
  };

  switch (event) {
    case 'error':
      logger.error(logData, `Connection error for client ${context.clientId}`);
      break;
    case 'disconnect':
      logger.info(logData, `Client disconnected: ${context.clientId}`);
      break;
    default:
      logger.info(logData, `Client connected: ${context.clientId}`);
  }
}

/**
 * Log a message routing event
 *
 * @param messageType - The type of message being routed
 * @param context - Log context
 * @param data - Additional data to log
 */
export function logMessageRoute(
  messageType: string,
  context: LogContext,
  data?: Record<string, unknown>
): void {
  const logger = createContextLogger(context);

  logger.info({
    operation: 'message',
    messageType,
    ...data,
  }, `Routing message: ${messageType}`);
}

/**
 * Log an error with full context
 *
 * @param error - The error object
 * @param context - Log context
 * @param message - Optional error message
 */
export function logError(
  error: Error | unknown,
  context: LogContext,
  message?: string
): void {
  const logger = createContextLogger(context);

  const errorData = {
    operation: 'error',
    error: error instanceof Error ? {
      name: error.name,
      message: error.message,
      stack: error.stack,
    } : error,
  };

  logger.error(errorData, message ?? 'An error occurred');
}

/**
 * Export logger for direct use when context is not needed
 */
export const logger = {
  get instance() {
    return getLogger();
  },
  info: (...args: Parameters<PinoLogger['info']>) => getLogger().info(...args),
  warn: (...args: Parameters<PinoLogger['warn']>) => getLogger().warn(...args),
  error: (...args: Parameters<PinoLogger['error']>) => getLogger().error(...args),
  debug: (...args: Parameters<PinoLogger['debug']>) => getLogger().debug(...args),
  trace: (...args: Parameters<PinoLogger['trace']>) => getLogger().trace(...args),
};
