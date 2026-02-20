// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Verify tenant middleware — 防止通过伪造 X-Tenant-ID 访问其他租户数据。
 *
 * 对比 JWT 中的 tenantId 与 header X-Tenant-ID，不匹配则 403 TENANT_MISMATCH。
 * 无 auth context 时返回 401。
 *
 * @module cloud/api/middleware/verify-tenant
 */

import type { Context, Next } from 'hono';

// ---------------------------------------------------------------------------
// Context type (auth 注入的变量)
// ---------------------------------------------------------------------------

export interface VerifyTenantEnv {
  Variables: {
    userId?: string;
    tenantId?: string | null;
  };
}

// ---------------------------------------------------------------------------
// Error response
// ---------------------------------------------------------------------------

export interface TenantMismatchResponse {
  error: {
    code: 'TENANT_MISMATCH';
    message: string;
  };
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

/**
 * 创建 verifyTenant 中间件。
 *
 * - 无 auth（无 userId/tenantId）→ 401 Unauthorized
 * - 存在 X-Tenant-ID 且与 JWT tenantId 不一致 → 403 TENANT_MISMATCH
 * - 无 header 或一致 → next()
 */
export function verifyTenant() {
  return async (c: Context<VerifyTenantEnv>, next: Next) => {
    let tenantId: string | null | undefined;
    let userId: string | undefined;
    try {
      userId = c.get('userId');
      tenantId = c.get('tenantId');
    } catch {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } }, 401);
    }

    if (userId == null) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } }, 401);
    }

    const headerTenantId = c.req.header('X-Tenant-ID');

    if (headerTenantId != null && headerTenantId !== '' && tenantId !== headerTenantId) {
      return c.json(
        {
          error: {
            code: 'TENANT_MISMATCH',
            message: 'Tenant ID mismatch',
          },
        },
        403,
      );
    }

    await next();
  };
}
