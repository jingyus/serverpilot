/**
 * Global error handling middleware for Hono REST API.
 *
 * Catches all unhandled errors and formats them as standardized JSON
 * error responses with appropriate HTTP status codes.
 *
 * @module api/middleware/error-handler
 */

import type { Context } from 'hono';
import { ZodError } from 'zod';
import { logger } from '../../utils/logger.js';

// ============================================================================
// Error Codes
// ============================================================================

export const ErrorCode = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  SERVER_OFFLINE: 'SERVER_OFFLINE',
  AI_UNAVAILABLE: 'AI_UNAVAILABLE',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

// ============================================================================
// API Error Class
// ============================================================================

/**
 * Typed API error with HTTP status code and machine-readable error code.
 */
export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: Array<{ field: string; message: string }>,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  static badRequest(message: string, details?: Array<{ field: string; message: string }>): ApiError {
    return new ApiError(400, ErrorCode.VALIDATION_ERROR, message, details);
  }

  static unauthorized(message = 'Not authenticated'): ApiError {
    return new ApiError(401, ErrorCode.UNAUTHORIZED, message);
  }

  static forbidden(message = 'No permission'): ApiError {
    return new ApiError(403, ErrorCode.FORBIDDEN, message);
  }

  static notFound(resource = 'Resource'): ApiError {
    return new ApiError(404, ErrorCode.NOT_FOUND, `${resource} not found`);
  }

  static serverOffline(): ApiError {
    return new ApiError(503, ErrorCode.SERVER_OFFLINE, 'Target server is offline');
  }

  static aiUnavailable(): ApiError {
    return new ApiError(503, ErrorCode.AI_UNAVAILABLE, 'AI service unavailable');
  }

  static rateLimited(): ApiError {
    return new ApiError(429, ErrorCode.RATE_LIMITED, 'Too many requests');
  }

  static internal(message = 'Internal server error'): ApiError {
    return new ApiError(500, ErrorCode.INTERNAL_ERROR, message);
  }
}

// ============================================================================
// Error Response Format
// ============================================================================

interface ErrorResponse {
  error: {
    code: ErrorCode;
    message: string;
    details?: Array<{ field: string; message: string }>;
  };
}

function formatZodError(err: ZodError): ErrorResponse {
  const details = err.errors.map((issue) => ({
    field: issue.path.join('.'),
    message: issue.message,
  }));

  return {
    error: {
      code: ErrorCode.VALIDATION_ERROR,
      message: 'Request validation failed',
      details,
    },
  };
}

function formatApiError(err: ApiError): ErrorResponse {
  return {
    error: {
      code: err.code,
      message: err.message,
      ...(err.details ? { details: err.details } : {}),
    },
  };
}

// ============================================================================
// Middleware
// ============================================================================

/**
 * Global error handler for the Hono app.
 *
 * Converts thrown errors into standardized JSON error responses.
 * Logs unexpected errors at error level for monitoring.
 */
export function onError(err: Error, c: Context): Response {
  // Zod validation errors → 400
  if (err instanceof ZodError) {
    return c.json(formatZodError(err), 400);
  }

  // Known API errors → appropriate status code
  if (err instanceof ApiError) {
    if (err.statusCode >= 500) {
      logger.error({ operation: 'api_error', code: err.code, statusCode: err.statusCode }, err.message);
    }
    return c.json(formatApiError(err), err.statusCode as 400);
  }

  // Unknown errors → 500
  logger.error(
    {
      operation: 'unhandled_error',
      error: { name: err.name, message: err.message, stack: err.stack },
    },
    'Unhandled API error',
  );

  return c.json(
    { error: { code: ErrorCode.INTERNAL_ERROR, message: 'Internal server error' } } satisfies ErrorResponse,
    500,
  );
}

/**
 * 404 handler for unmatched routes.
 */
export function onNotFound(c: Context): Response {
  return c.json(
    { error: { code: ErrorCode.NOT_FOUND, message: `Route not found: ${c.req.method} ${c.req.path}` } } satisfies ErrorResponse,
    404,
  );
}
