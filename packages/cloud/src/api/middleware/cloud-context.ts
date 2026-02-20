// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Cloud 上下文中间件 — 从 PG 根据 userId 解析 tenantId 与 userRole，供 Usage/Billing 路由使用。
 * 需在 requireAuth 之后使用。
 *
 * @module cloud/api/middleware/cloud-context
 */

import type { Context, Next } from 'hono';
import { eq } from 'drizzle-orm';
import { getPgDatabase } from '../../db/pg-connection.js';
import { users } from '../../db/pg-schema.js';

/** 至少包含 userId 的 context（由 server requireAuth 设置） */
export type CloudContextEnv = {
  Variables: {
    userId: string;
    tenantId?: string | null;
    userRole?: string;
  };
};

/**
 * 从 Cloud PG users 表根据 userId 查出 tenantId、role，写入 context。
 * 供 server 挂载 /api/v1/usage、/api/v1/billing 时在 requireAuth 之后调用。
 */
export async function cloudContextFromDb(
  c: Context<CloudContextEnv>,
  next: Next,
): Promise<void> {
  const userId = c.get('userId');
  const db = getPgDatabase();
  const rows = await db
    .select({ tenantId: users.tenantId, role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const row = rows[0];
  c.set('tenantId', row?.tenantId ?? null);
  c.set('userRole', (row?.role as 'owner' | 'admin' | 'member') ?? 'member');
  await next();
}
