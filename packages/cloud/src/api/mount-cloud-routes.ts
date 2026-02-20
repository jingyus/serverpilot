// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * 将 Cloud Usage、Billing 路由挂载到 Server 的 Hono 应用上。
 * 需在 requireAuth 之后注入 tenantId/userRole（cloudContextFromDb）并校验 X-Tenant-ID（verifyTenant）。
 *
 * @module cloud/api/mount-cloud-routes
 */

import { Hono } from 'hono';
import { cloudContextFromDb } from './middleware/cloud-context.js';
import { verifyTenant } from './middleware/verify-tenant.js';
import { createUsageRoutes } from './routes/usage.js';
import { createBillingRoutes } from './routes/billing.js';

/** Server 提供的 requireAuth 中间件（设置 userId） */
export type RequireAuthMiddleware = (c: unknown, next: () => Promise<void>) => Promise<void>;

/**
 * 在已存在的 Hono 应用上挂载 /api/v1/usage 与 /api/v1/billing。
 * 中间件顺序：requireAuth → cloudContextFromDb → verifyTenant → 路由。
 *
 * @param app - Server 的 API 应用（例如 createApiApp() 的返回值）
 * @param requireAuth - Server 的 requireAuth 中间件
 */
export function mountCloudRoutes(
  app: Hono,
  requireAuth: RequireAuthMiddleware,
): void {
  const usageApp = new Hono();
  usageApp.use('*', requireAuth as never, cloudContextFromDb, verifyTenant());
  usageApp.route('/', createUsageRoutes());
  app.route('/api/v1/usage', usageApp);

  const billingApp = new Hono();
  billingApp.use('*', requireAuth as never, cloudContextFromDb, verifyTenant());
  billingApp.route('/', createBillingRoutes());
  app.route('/api/v1/billing', billingApp);
}
