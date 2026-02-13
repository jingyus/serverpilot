// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Security headers middleware.
 *
 * Adds defense-in-depth HTTP headers for XSS prevention, MIME sniffing,
 * clickjacking, transport security (HSTS), and feature policy.
 *
 * These headers complement the nginx-level headers. When deployed behind
 * nginx the headers will be duplicated, but browsers handle that correctly
 * (first value wins for single-value headers). Running the server standalone
 * still gets protection.
 *
 * @module api/middleware/security-headers
 */

import type { MiddlewareHandler } from 'hono';

export interface SecurityHeadersOptions {
  /** Enable HSTS header. Should be true only when behind TLS termination. */
  enableHsts: boolean;
  /** HSTS max-age in seconds. Default: 63072000 (2 years). */
  hstsMaxAge?: number;
}

const DEFAULT_HSTS_MAX_AGE = 63_072_000; // 2 years

/**
 * Build Content-Security-Policy value for API responses.
 *
 * The API server only returns JSON / SSE, so CSP is restrictive:
 * - default-src 'none'  — no loading of any resource by default
 * - frame-ancestors 'none' — API responses cannot be framed
 */
function buildCspHeader(): string {
  return "default-src 'none'; frame-ancestors 'none'";
}

/**
 * Create security-headers middleware.
 *
 * @param options — toggle HSTS and configure max-age
 */
export function createSecurityHeadersMiddleware(
  options?: Partial<SecurityHeadersOptions>,
): MiddlewareHandler {
  const enableHsts = options?.enableHsts ?? (process.env.NODE_ENV === 'production');
  const hstsMaxAge = options?.hstsMaxAge ?? DEFAULT_HSTS_MAX_AGE;

  const csp = buildCspHeader();
  const hsts = `max-age=${hstsMaxAge}; includeSubDomains`;

  return async (c, next) => {
    await next();

    // Standard security headers
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('X-Frame-Options', 'DENY');
    c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    c.header('Content-Security-Policy', csp);
    c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');

    // HSTS — only when TLS is terminated upstream
    if (enableHsts) {
      c.header('Strict-Transport-Security', hsts);
    }
  };
}
