// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * CORS origin configuration.
 *
 * Parses the CORS_ORIGIN environment variable and provides the
 * origin function for Hono's cors() middleware.
 *
 * Supports:
 * - `*` (wildcard, default) — allows all origins
 * - Single origin: `https://example.com`
 * - Multiple origins (comma-separated): `https://app.example.com,https://admin.example.com`
 *
 * In production (NODE_ENV=production), using wildcard origin logs a
 * security warning via pino.
 *
 * @module api/middleware/cors-config
 */

import { getLogger } from '../../utils/logger.js';

/**
 * Parse the CORS_ORIGIN env var into a list of allowed origins.
 *
 * @param raw - Raw env var value (defaults to '*')
 * @returns Parsed origin list or '*' for wildcard
 */
export function parseCorsOrigins(raw?: string): '*' | string[] {
  const value = (raw ?? '*').trim();

  if (value === '*' || value === '') {
    return '*';
  }

  const origins = value
    .split(',')
    .map((o) => o.trim())
    .filter((o) => o.length > 0);

  if (origins.length === 0) {
    return '*';
  }

  return origins;
}

/**
 * Build the `origin` option for Hono's cors() middleware.
 *
 * When origins is '*', returns the string '*'.
 * When origins is a list, returns a function that checks the
 * request's Origin header against the allowed list.
 *
 * @param origins - Parsed origin config from parseCorsOrigins()
 * @returns Value suitable for Hono cors({ origin })
 */
export function buildCorsOrigin(origins: '*' | string[]): string | ((origin: string) => string | undefined) {
  if (origins === '*') {
    return '*';
  }

  // Single origin — return as string (Hono supports this directly)
  if (origins.length === 1) {
    return origins[0];
  }

  // Multiple origins — return a function that checks membership
  const allowedSet = new Set(origins);
  return (origin: string): string | undefined => {
    if (allowedSet.has(origin)) {
      return origin;
    }
    return undefined;
  };
}

/**
 * Log a security warning when wildcard CORS is used in production.
 *
 * Should be called once at startup time.
 *
 * @param nodeEnv - Current NODE_ENV value
 * @param corsOrigin - Raw CORS_ORIGIN env value
 */
export function warnWildcardCorsInProduction(nodeEnv?: string, corsOrigin?: string): void {
  const origins = parseCorsOrigins(corsOrigin);

  if (nodeEnv === 'production' && origins === '*') {
    const logger = getLogger();
    logger.warn(
      {
        operation: 'security',
        corsOrigin: '*',
      },
      'CORS origin is set to "*" in production — this allows any domain to make cross-origin requests. ' +
      'Set CORS_ORIGIN to your actual domain(s) for better security. ' +
      'Example: CORS_ORIGIN=https://your-dashboard.example.com',
    );
  }
}
