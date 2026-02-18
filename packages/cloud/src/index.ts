// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * ServerPilot Cloud Edition — entry point.
 *
 * 提供 PostgreSQL、计费、AI 配额与路由、使用量 API、Skills（日志巡检、安全扫描）等。
 * 由 server 在 DB_TYPE=postgres 时动态加载。
 *
 * @module @aiinstaller/cloud
 */

import {
  buildPgConfigFromEnv,
  initPgDatabase,
  closePgDatabase,
} from './db/pg-connection.js';

export interface CloudBootstrapResult {
  dbType: 'postgres';
  /** 优雅关闭时调用，关闭 PG 等资源 */
  close: () => Promise<void>;
}

/**
 * 初始化 Cloud 版：PG 连接等。
 * AIQuotaManager、ModelRouter、CostTracker 由上层在需要时通过 setXxx 注入，此处不强制预热。
 */
export async function bootstrapCloud(): Promise<CloudBootstrapResult> {
  const config = buildPgConfigFromEnv();
  initPgDatabase(config);

  return {
    dbType: 'postgres',
    close: closePgDatabase,
  };
}

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------
export { buildPgConfigFromEnv, getPgDatabase, getPgPool, closePgDatabase } from './db/pg-connection.js';
export type { PgConnectionConfig, PgDrizzleDB } from './db/pg-connection.js';
export { runPgMigrations } from './db/pg-migrate.js';
export type { PgMigrateOptions, PgMigrateResult } from './db/pg-migrate.js';

// ---------------------------------------------------------------------------
// Auth & 注册
// ---------------------------------------------------------------------------
export { cloudRegister } from './auth/cloud-register.js';
export type { CloudRegisterInput, CloudRegisterResult } from './auth/cloud-register.js';

// ---------------------------------------------------------------------------
// Agent 认证
// ---------------------------------------------------------------------------
export { authenticateCloudAgent } from './websocket/cloud-agent-auth.js';

// ---------------------------------------------------------------------------
// 多租户中间件与挂载
// ---------------------------------------------------------------------------
export { verifyTenant } from './api/middleware/verify-tenant.js';
export { cloudContextFromDb } from './api/middleware/cloud-context.js';
export { mountCloudRoutes } from './api/mount-cloud-routes.js';
export { checkAIQuota } from './api/middleware/check-ai-quota.js';

// ---------------------------------------------------------------------------
// AI：配额、路由、成本、Provider
// ---------------------------------------------------------------------------
export { getAIQuotaManager, setAIQuotaManager, _resetAIQuotaManager } from './ai/quota-manager.js';
export { getModelRouter, setModelRouter, _resetModelRouter } from './ai/model-router.js';
export { getCostTracker, setCostTracker, _resetCostTracker } from './ai/cost-tracker.js';
export {
  getCloudAIProvider,
  setCloudAIProvider,
  _resetCloudAIProvider,
  CloudAIProvider,
  QuotaExceededError,
} from './ai/cloud-provider.js';
export type { CloudChatContext, CloudEnrichedChatResponse } from './ai/cloud-provider.js';

// ---------------------------------------------------------------------------
// API 路由（Usage、Billing）
// ---------------------------------------------------------------------------
export { createUsageRoutes } from './api/routes/usage.js';
export { createBillingRoutes } from './api/routes/billing.js';

// ---------------------------------------------------------------------------
// Skills：日志巡检、安全扫描
// ---------------------------------------------------------------------------
export {
  scanLogs,
  enableAutoScan,
  disableAutoScan,
  getAutoScanServerIds,
  runScheduledScans,
  setLogFetcher,
  getLogFetcher,
} from './skills/log-scanner.js';
export type {
  ScanReport,
  ScanIssue,
  ScanLogsContext,
  LogFetcher,
  FetchRecentLogsOptions,
} from './skills/log-scanner.js';

export {
  securityAudit,
  setCommandRunner,
  getCommandRunner,
} from './skills/security-scanner.js';
export type {
  AuditReport,
  SecurityAuditContext,
  CommandRunner,
  Vulnerability,
  Misconfiguration,
  Anomaly,
  ComplianceResult,
} from './skills/security-scanner.js';

// ---------------------------------------------------------------------------
// Billing（Stripe 等）— 从 billing 模块统一导出
// ---------------------------------------------------------------------------
export {
  PLANS,
  getSubscriptionStore,
  setSubscriptionStore,
  createSubscription,
  getSubscription,
  cancelSubscription,
  updateSubscriptionPlan,
  handleStripeWebhook,
} from './billing/index.js';
export type { BillingPlan } from './billing/index.js';

// ---------------------------------------------------------------------------
// Analytics（CostTracker 已从 ai 导出；analytics 模块可单独引入）
// ---------------------------------------------------------------------------
export type { DailyCostEntry, ModelDistributionEntry, TokenUsage } from './ai/cost-tracker.js';
