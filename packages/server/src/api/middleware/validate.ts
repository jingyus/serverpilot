/**
 * Request validation middleware using Zod.
 *
 * Provides Hono middleware factories that validate request body,
 * query params, and route params against Zod schemas before
 * the handler runs.
 *
 * @module api/middleware/validate
 */

import type { Context, Next } from 'hono';
import type { ZodSchema } from 'zod';
import { ZodError } from 'zod';
import { ApiError } from './error-handler.js';
import type { ApiEnv } from '../routes/types.js';

// ============================================================================
// Middleware Factories
// ============================================================================

/**
 * Create middleware that validates the JSON request body against a Zod schema.
 *
 * On success, the parsed data is stored in context as `validatedBody`.
 * On failure, throws a ZodError (caught by global error handler → 400).
 *
 * @param schema - Zod schema to validate against
 * @returns Hono middleware
 */
export function validateBody<T>(schema: ZodSchema<T>) {
  return async (c: Context<ApiEnv>, next: Next) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      throw ApiError.badRequest('Invalid JSON in request body');
    }

    const result = schema.safeParse(body);
    if (!result.success) {
      throw new ZodError(result.error.errors);
    }

    c.set('validatedBody', result.data);
    await next();
  };
}

/**
 * Create middleware that validates query parameters against a Zod schema.
 *
 * On success, the parsed data is stored in context as `validatedQuery`.
 * On failure, throws a ZodError (caught by global error handler → 400).
 *
 * @param schema - Zod schema to validate against
 * @returns Hono middleware
 */
export function validateQuery<T>(schema: ZodSchema<T>) {
  return async (c: Context<ApiEnv>, next: Next) => {
    const query = c.req.query();
    const result = schema.safeParse(query);
    if (!result.success) {
      throw new ZodError(result.error.errors);
    }

    c.set('validatedQuery', result.data);
    await next();
  };
}
