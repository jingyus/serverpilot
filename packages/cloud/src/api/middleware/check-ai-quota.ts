// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * AI quota check middleware for Hono.
 *
 * Validates that the authenticated user has remaining AI quota before
 * allowing the request to proceed. Free users are hard-blocked when their
 * monthly limit is exhausted (HTTP 429); paid users are never blocked
 * (soft limit warnings are handled by the quota manager internally).
 *
 * Must be mounted **after** auth middleware (requires `userId` and
 * `tenantId` in the Hono context).
 *
 * @module cloud/api/middleware/check-ai-quota
 */

import type { Context, Next } from 'hono';
import { getAIQuotaManager } from '../../ai/quota-manager.js';

// ---------------------------------------------------------------------------
// Context type (mirrors server ApiEnv — only the fields we need)
// ---------------------------------------------------------------------------

export interface QuotaApiEnv {
  Variables: {
    userId: string;
    tenantId: string | null;
  };
}

// ---------------------------------------------------------------------------
// Error response type
// ---------------------------------------------------------------------------

export interface QuotaExceededResponse {
  error: {
    code: 'QUOTA_EXCEEDED';
    message: string;
    upgradeUrl: string;
  };
}

// ---------------------------------------------------------------------------
// Middleware factory
// ---------------------------------------------------------------------------

/**
 * Create a Hono middleware that checks the user's AI quota.
 *
 * Usage:
 * ```ts
 * app.use('/api/v1/chat/*', requireAuth, requireTenant, checkAIQuota());
 * ```
 *
 * On quota exhaustion (free plan only):
 * - Returns HTTP 429 with `{ error: { code: 'QUOTA_EXCEEDED', message, upgradeUrl } }`
 *
 * On every successful pass:
 * - Sets `X-Quota-Remaining` response header with remaining quota count.
 */
export function checkAIQuota() {
  return async function aiQuotaMiddleware(
    c: Context<QuotaApiEnv>,
    next: Next,
  ): Promise<Response | void> {
    const userId = c.get('userId');
    const tenantId = c.get('tenantId');

    // If auth middleware hasn't run or user isn't authenticated, reject.
    if (!userId) {
      return c.json(
        {
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authentication required',
          },
        },
        401,
      );
    }

    // If tenant context is missing, reject.
    if (!tenantId) {
      return c.json(
        {
          error: {
            code: 'UNAUTHORIZED',
            message: 'Tenant context required',
          },
        },
        401,
      );
    }

    const manager = getAIQuotaManager();
    const result = await manager.checkQuota(userId, tenantId);

    // Set remaining quota header on every response
    c.header('X-Quota-Remaining', String(result.remaining));

    if (!result.allowed) {
      return c.json(
        {
          error: {
            code: 'QUOTA_EXCEEDED' as const,
            message: result.reason ?? 'AI quota exceeded',
            upgradeUrl: result.upgradeUrl ?? '/billing?upgrade=pro',
          },
        } satisfies QuotaExceededResponse,
        429,
      );
    }

    await next();
  };
}
