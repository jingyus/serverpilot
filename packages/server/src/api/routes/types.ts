/**
 * Hono environment type definitions for the REST API.
 *
 * Declares context variables used by middleware and route handlers
 * (validated body, query, user ID, etc.).
 *
 * @module api/routes/types
 */

/**
 * Hono environment type for all API routes.
 *
 * Declares the context variables that middleware can set
 * and route handlers can read via `c.get(key)`.
 */
export interface ApiEnv {
  Variables: {
    /** Validated request body (set by validateBody middleware) */
    validatedBody: unknown;
    /** Validated query params (set by validateQuery middleware) */
    validatedQuery: unknown;
    /** Authenticated user ID (set by auth middleware) */
    userId: string;
  };
}
