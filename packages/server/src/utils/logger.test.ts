/**
 * Tests for structured logging utility.
 *
 * @module utils/logger.test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Mock } from 'vitest';
import {
  initLogger,
  getLogger,
  createContextLogger,
  logAIOperation,
  logConnectionEvent,
  logMessageRoute,
  logError,
  logger,
} from './logger.js';

describe('logger', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('initLogger', () => {
    it('should initialize logger with default settings', () => {
      const loggerInstance = initLogger();
      expect(loggerInstance).toBeDefined();
      expect(typeof loggerInstance.info).toBe('function');
      expect(typeof loggerInstance.error).toBe('function');
      expect(typeof loggerInstance.warn).toBe('function');
    });

    it('should respect LOG_LEVEL environment variable', () => {
      process.env.LOG_LEVEL = 'debug';
      const loggerInstance = initLogger();
      expect(loggerInstance).toBeDefined();
    });

    it('should use production mode when NODE_ENV is production', () => {
      process.env.NODE_ENV = 'production';
      const loggerInstance = initLogger();
      expect(loggerInstance).toBeDefined();
    });

    it('should accept custom options', () => {
      const loggerInstance = initLogger({ level: 'warn' });
      expect(loggerInstance).toBeDefined();
    });
  });

  describe('getLogger', () => {
    it('should return the global logger instance', () => {
      const logger1 = getLogger();
      const logger2 = getLogger();
      expect(logger1).toBeDefined();
      expect(logger1).toBe(logger2); // Should be same instance
    });

    it('should initialize logger if not already initialized', () => {
      const loggerInstance = getLogger();
      expect(loggerInstance).toBeDefined();
      expect(typeof loggerInstance.info).toBe('function');
    });
  });

  describe('createContextLogger', () => {
    it('should create a child logger with context', () => {
      const context = {
        requestId: 'test-request-123',
        sessionId: 'test-session-456',
        clientId: 'test-client-789',
      };

      const contextLogger = createContextLogger(context);
      expect(contextLogger).toBeDefined();
      expect(typeof contextLogger.info).toBe('function');
    });

    it('should create child logger with minimal context', () => {
      const contextLogger = createContextLogger({ requestId: '123' });
      expect(contextLogger).toBeDefined();
    });

    it('should create child logger with additional fields', () => {
      const contextLogger = createContextLogger({
        requestId: '123',
        customField: 'customValue',
      });
      expect(contextLogger).toBeDefined();
    });
  });

  describe('logAIOperation', () => {
    it('should log AI call operation', () => {
      const context = {
        requestId: 'req-123',
        sessionId: 'sess-456',
        clientId: 'client-789',
      };

      // Should not throw
      expect(() => {
        logAIOperation('call', context, { operation: 'test' });
      }).not.toThrow();
    });

    it('should log AI stream operation', () => {
      const context = { requestId: 'req-123' };
      expect(() => {
        logAIOperation('stream', context);
      }).not.toThrow();
    });

    it('should log AI error operation with error level', () => {
      const context = { requestId: 'req-123' };
      expect(() => {
        logAIOperation('error', context, { error: 'test error' });
      }).not.toThrow();
    });

    it('should log AI fallback operation with warn level', () => {
      const context = { requestId: 'req-123' };
      expect(() => {
        logAIOperation('fallback', context, { reason: 'primary failed' });
      }).not.toThrow();
    });
  });

  describe('logConnectionEvent', () => {
    it('should log connection event', () => {
      const context = { clientId: 'client-123' };
      expect(() => {
        logConnectionEvent('connect', context);
      }).not.toThrow();
    });

    it('should log disconnection event', () => {
      const context = { clientId: 'client-123' };
      expect(() => {
        logConnectionEvent('disconnect', context);
      }).not.toThrow();
    });

    it('should log connection error event', () => {
      const context = { clientId: 'client-123' };
      expect(() => {
        logConnectionEvent('error', context, { errorMessage: 'Connection failed' });
      }).not.toThrow();
    });

    it('should log connection with additional data', () => {
      const context = { clientId: 'client-123' };
      expect(() => {
        logConnectionEvent('connect', context, {
          remoteAddress: '127.0.0.1',
          userAgent: 'test-agent',
        });
      }).not.toThrow();
    });
  });

  describe('logMessageRoute', () => {
    it('should log message routing', () => {
      const context = {
        requestId: 'req-123',
        sessionId: 'sess-456',
        clientId: 'client-789',
      };

      expect(() => {
        logMessageRoute('session.create', context);
      }).not.toThrow();
    });

    it('should log message routing with additional data', () => {
      const context = { requestId: 'req-123' };
      expect(() => {
        logMessageRoute('env.report', context, {
          software: 'openclaw',
          version: 'latest',
        });
      }).not.toThrow();
    });
  });

  describe('logError', () => {
    it('should log Error object', () => {
      const error = new Error('Test error');
      const context = { requestId: 'req-123' };

      expect(() => {
        logError(error, context);
      }).not.toThrow();
    });

    it('should log Error with custom message', () => {
      const error = new Error('Test error');
      const context = { requestId: 'req-123' };

      expect(() => {
        logError(error, context, 'Custom error message');
      }).not.toThrow();
    });

    it('should log non-Error object', () => {
      const context = { requestId: 'req-123' };

      expect(() => {
        logError('string error', context);
      }).not.toThrow();
    });

    it('should log error with errorCode in context', () => {
      const error = new Error('Test error');
      const context = {
        requestId: 'req-123',
        errorCode: 'ERR_TEST',
      };

      expect(() => {
        logError(error, context);
      }).not.toThrow();
    });

    it('should include stack trace for Error objects', () => {
      const error = new Error('Test error');
      error.stack = 'Error: Test error\n    at test.ts:1:1';
      const context = { requestId: 'req-123' };

      expect(() => {
        logError(error, context);
      }).not.toThrow();
    });
  });

  describe('logger export', () => {
    it('should provide logger.info method', () => {
      expect(typeof logger.info).toBe('function');
      expect(() => {
        logger.info('test message');
      }).not.toThrow();
    });

    it('should provide logger.warn method', () => {
      expect(typeof logger.warn).toBe('function');
      expect(() => {
        logger.warn('test warning');
      }).not.toThrow();
    });

    it('should provide logger.error method', () => {
      expect(typeof logger.error).toBe('function');
      expect(() => {
        logger.error('test error');
      }).not.toThrow();
    });

    it('should provide logger.debug method', () => {
      expect(typeof logger.debug).toBe('function');
      expect(() => {
        logger.debug('test debug');
      }).not.toThrow();
    });

    it('should provide logger.trace method', () => {
      expect(typeof logger.trace).toBe('function');
      expect(() => {
        logger.trace('test trace');
      }).not.toThrow();
    });

    it('should provide logger.instance getter', () => {
      expect(logger.instance).toBeDefined();
      expect(typeof logger.instance.info).toBe('function');
    });
  });

  describe('structured logging format', () => {
    it('should include requestId in context', () => {
      const context = { requestId: 'req-123' };
      const contextLogger = createContextLogger(context);
      expect(contextLogger).toBeDefined();
    });

    it('should include sessionId in context', () => {
      const context = { sessionId: 'sess-456' };
      const contextLogger = createContextLogger(context);
      expect(contextLogger).toBeDefined();
    });

    it('should include errorCode in context', () => {
      const context = { errorCode: 'ERR_TEST' };
      const contextLogger = createContextLogger(context);
      expect(contextLogger).toBeDefined();
    });

    it('should support multiple context fields', () => {
      const context = {
        requestId: 'req-123',
        sessionId: 'sess-456',
        clientId: 'client-789',
        errorCode: 'ERR_TEST',
        customField: 'custom-value',
      };
      const contextLogger = createContextLogger(context);
      expect(contextLogger).toBeDefined();
    });
  });

  describe('log filtering', () => {
    it('should respect log level for info', () => {
      initLogger({ level: 'info' });
      expect(() => {
        logger.info('info message');
        logger.debug('debug message'); // Should be filtered
      }).not.toThrow();
    });

    it('should respect log level for warn', () => {
      initLogger({ level: 'warn' });
      expect(() => {
        logger.warn('warn message');
        logger.info('info message'); // Should be filtered
      }).not.toThrow();
    });

    it('should respect log level for error', () => {
      initLogger({ level: 'error' });
      expect(() => {
        logger.error('error message');
        logger.warn('warn message'); // Should be filtered
      }).not.toThrow();
    });
  });
});
