// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Drizzle ORM schema definitions for PostgreSQL.
 *
 * Mirror of schema.ts (SQLite) with PostgreSQL-specific types:
 * - sqliteTable → pgTable
 * - integer({ mode: 'timestamp' }) → timestamp (native)
 * - integer({ mode: 'boolean' }) → boolean (native)
 * - text({ mode: 'json' }) → jsonb (native)
 * - integer → integer / bigint
 *
 * @module db/pg-schema
 */
import {
  pgTable,
  text,
  integer,
  bigint,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
// Re-export shared types from SQLite schema (same interfaces)
export type {
  UserSettingsAIProvider,
  UserSettingsNotifications,
  UserSettingsKnowledgeBase,
  ProfileOsInfo,
  ProfileSoftware,
  ProfileService,
  ProfilePreferences,
  SessionMessage,
  SessionContext,
  SnapshotFile,
  SnapshotConfig,
  KnowledgeEntry,
  DocSourceGitHubConfig,
  DocSourceWebConfig,
  DocSourceHistoryEntry,
  WebhookEventType,
  InvitationStatus,
  TenantPlan,
} from '@aiinstaller/server/schema';
import type {
  UserSettingsAIProvider,
  UserSettingsNotifications,
  UserSettingsKnowledgeBase,
  ProfileOsInfo,
  ProfileSoftware,
  ProfileService,
  ProfilePreferences,
  SessionMessage,
  SessionContext,
  SnapshotFile,
  SnapshotConfig,
  KnowledgeEntry,
  DocSourceGitHubConfig,
  DocSourceWebConfig,
  WebhookEventType,
} from '@aiinstaller/server/schema';

// ============================================================================
// Tenants
// ============================================================================

export const tenants = pgTable(
  'tenants',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    ownerId: text('owner_id').notNull(),
    plan: text('plan', { enum: ['free', 'pro', 'team', 'enterprise'] })
      .default('free')
      .notNull(),
    maxServers: integer('max_servers').default(5).notNull(),
    maxUsers: integer('max_users').default(1).notNull(),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).notNull(),
  },
  (table) => [
    uniqueIndex('pg_tenants_slug_idx').on(table.slug),
    index('pg_tenants_owner_id_idx').on(table.ownerId),
  ],
);

// ============================================================================
// Users
// ============================================================================

export const users = pgTable(
  'users',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull().unique(),
    passwordHash: text('password_hash').notNull(),
    name: text('name'),
    timezone: text('timezone').default('UTC'),
    tenantId: text('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['owner', 'admin', 'member'] }).default('member').notNull(),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).notNull(),
  },
  (table) => [
    index('pg_users_tenant_id_idx').on(table.tenantId),
    index('pg_users_role_idx').on(table.role),
  ],
);

// ============================================================================
// OAuth Accounts
// ============================================================================

export const oauthAccounts = pgTable(
  'oauth_accounts',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    provider: text('provider', { enum: ['github'] }).notNull(),
    providerAccountId: text('provider_account_id').notNull(),
    providerUsername: text('provider_username'),
    providerAvatarUrl: text('provider_avatar_url'),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).notNull(),
  },
  (table) => [
    uniqueIndex('pg_oauth_provider_account_idx').on(table.provider, table.providerAccountId),
    index('pg_oauth_user_id_idx').on(table.userId),
  ],
);

// ============================================================================
// User Settings
// ============================================================================

export const userSettings = pgTable(
  'user_settings',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull()
      .unique(),
    aiProvider: jsonb('ai_provider').$type<UserSettingsAIProvider>().notNull(),
    notifications: jsonb('notifications').$type<UserSettingsNotifications>().notNull(),
    knowledgeBase: jsonb('knowledge_base').$type<UserSettingsKnowledgeBase>().notNull(),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).notNull(),
  },
  (table) => [
    uniqueIndex('pg_user_settings_user_id_idx').on(table.userId),
  ],
);

// ============================================================================
// Servers
// ============================================================================

export const servers = pgTable(
  'servers',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    tenantId: text('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
    status: text('status', { enum: ['online', 'offline', 'error'] })
      .default('offline')
      .notNull(),
    tags: jsonb('tags').$type<string[]>().default([]),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).notNull(),
  },
  (table) => [
    index('pg_servers_user_id_idx').on(table.userId),
    index('pg_servers_tenant_id_idx').on(table.tenantId),
  ],
);

// ============================================================================
// Agents
// ============================================================================

export const agents = pgTable(
  'agents',
  {
    id: text('id').primaryKey(),
    serverId: text('server_id')
      .references(() => servers.id, { onDelete: 'cascade' })
      .notNull(),
    keyHash: text('key_hash').notNull(),
    version: text('version'),
    lastSeen: timestamp('last_seen', { mode: 'date' }),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull(),
  },
  (table) => [
    uniqueIndex('pg_agents_server_id_idx').on(table.serverId),
  ],
);

// ============================================================================
// Server Profiles
// ============================================================================

export const profiles = pgTable(
  'profiles',
  {
    id: text('id').primaryKey(),
    serverId: text('server_id')
      .references(() => servers.id, { onDelete: 'cascade' })
      .notNull()
      .unique(),
    osInfo: jsonb('os_info').$type<ProfileOsInfo | null>(),
    software: jsonb('software').$type<ProfileSoftware[]>().default([]),
    services: jsonb('services').$type<ProfileService[]>().default([]),
    preferences: jsonb('preferences').$type<ProfilePreferences | null>(),
    notes: jsonb('notes').$type<string[]>().default([]),
    operationHistory: jsonb('operation_history').$type<string[]>().default([]),
    historySummary: text('history_summary'),
    updatedAt: timestamp('updated_at', { mode: 'date' }).notNull(),
  },
  (table) => [
    uniqueIndex('pg_profiles_server_id_idx').on(table.serverId),
  ],
);

// ============================================================================
// Sessions
// ============================================================================

export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    serverId: text('server_id')
      .references(() => servers.id, { onDelete: 'cascade' })
      .notNull(),
    messages: jsonb('messages').$type<SessionMessage[]>().default([]),
    context: jsonb('context').$type<SessionContext | null>(),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).notNull(),
  },
  (table) => [
    index('pg_sessions_user_id_idx').on(table.userId),
    index('pg_sessions_server_id_idx').on(table.serverId),
  ],
);

// ============================================================================
// Operations
// ============================================================================

export const operations = pgTable(
  'operations',
  {
    id: text('id').primaryKey(),
    serverId: text('server_id')
      .references(() => servers.id, { onDelete: 'cascade' })
      .notNull(),
    sessionId: text('session_id').references(() => sessions.id, { onDelete: 'set null' }),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    tenantId: text('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
    type: text('type', {
      enum: ['install', 'config', 'restart', 'execute', 'backup'],
    }).notNull(),
    description: text('description').notNull(),
    commands: jsonb('commands').$type<string[]>().default([]),
    output: text('output'),
    status: text('status', {
      enum: ['pending', 'running', 'success', 'failed', 'rolled_back'],
    })
      .default('pending')
      .notNull(),
    riskLevel: text('risk_level', {
      enum: ['green', 'yellow', 'red', 'critical'],
    })
      .default('green')
      .notNull(),
    snapshotId: text('snapshot_id'),
    duration: integer('duration'),
    inputTokens: integer('input_tokens').default(0).notNull(),
    outputTokens: integer('output_tokens').default(0).notNull(),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull(),
    completedAt: timestamp('completed_at', { mode: 'date' }),
  },
  (table) => [
    index('pg_operations_server_id_idx').on(table.serverId),
    index('pg_operations_user_id_idx').on(table.userId),
    index('pg_operations_tenant_id_idx').on(table.tenantId),
    index('pg_operations_session_id_idx').on(table.sessionId),
    index('pg_operations_status_idx').on(table.status),
  ],
);

// ============================================================================
// Snapshots
// ============================================================================

export const snapshots = pgTable(
  'snapshots',
  {
    id: text('id').primaryKey(),
    serverId: text('server_id')
      .references(() => servers.id, { onDelete: 'cascade' })
      .notNull(),
    operationId: text('operation_id'),
    files: jsonb('files').$type<SnapshotFile[]>().default([]),
    configs: jsonb('configs').$type<SnapshotConfig[]>().default([]),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull(),
    expiresAt: timestamp('expires_at', { mode: 'date' }),
  },
  (table) => [
    index('pg_snapshots_server_id_idx').on(table.serverId),
    index('pg_snapshots_operation_id_idx').on(table.operationId),
  ],
);

// ============================================================================
// Tasks
// ============================================================================

export const tasks = pgTable(
  'tasks',
  {
    id: text('id').primaryKey(),
    serverId: text('server_id')
      .references(() => servers.id, { onDelete: 'cascade' })
      .notNull(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    tenantId: text('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    cron: text('cron').notNull(),
    command: text('command').notNull(),
    status: text('status', { enum: ['active', 'paused', 'deleted'] })
      .default('active')
      .notNull(),
    lastRun: timestamp('last_run', { mode: 'date' }),
    lastStatus: text('last_status', { enum: ['success', 'failed'] }),
    nextRun: timestamp('next_run', { mode: 'date' }),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull(),
  },
  (table) => [
    index('pg_tasks_server_id_idx').on(table.serverId),
    index('pg_tasks_user_id_idx').on(table.userId),
    index('pg_tasks_tenant_id_idx').on(table.tenantId),
    index('pg_tasks_status_idx').on(table.status),
  ],
);

// ============================================================================
// Alert Rules
// ============================================================================

export const alertRules = pgTable(
  'alert_rules',
  {
    id: text('id').primaryKey(),
    serverId: text('server_id')
      .references(() => servers.id, { onDelete: 'cascade' })
      .notNull(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    name: text('name').notNull(),
    metricType: text('metric_type', { enum: ['cpu', 'memory', 'disk'] }).notNull(),
    operator: text('operator', { enum: ['gt', 'lt', 'gte', 'lte'] }).notNull(),
    threshold: integer('threshold').notNull(),
    severity: text('severity', { enum: ['info', 'warning', 'critical'] }).notNull(),
    enabled: boolean('enabled').default(true).notNull(),
    emailRecipients: jsonb('email_recipients').$type<string[]>().default([]),
    cooldownMinutes: integer('cooldown_minutes').default(30).notNull(),
    lastTriggeredAt: timestamp('last_triggered_at', { mode: 'date' }),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).notNull(),
  },
  (table) => [
    index('pg_alert_rules_server_id_idx').on(table.serverId),
    index('pg_alert_rules_user_id_idx').on(table.userId),
    index('pg_alert_rules_enabled_idx').on(table.enabled),
  ],
);

// ============================================================================
// Alerts
// ============================================================================

export const alerts = pgTable(
  'alerts',
  {
    id: text('id').primaryKey(),
    serverId: text('server_id')
      .references(() => servers.id, { onDelete: 'cascade' })
      .notNull(),
    type: text('type', {
      enum: ['cpu', 'memory', 'disk', 'service', 'offline'],
    }).notNull(),
    severity: text('severity', {
      enum: ['info', 'warning', 'critical'],
    }).notNull(),
    message: text('message').notNull(),
    value: text('value'),
    threshold: text('threshold'),
    resolved: boolean('resolved').default(false).notNull(),
    resolvedAt: timestamp('resolved_at', { mode: 'date' }),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull(),
  },
  (table) => [
    index('pg_alerts_server_id_idx').on(table.serverId),
    index('pg_alerts_resolved_idx').on(table.resolved),
  ],
);

// ============================================================================
// Metrics
// ============================================================================

export const metrics = pgTable(
  'metrics',
  {
    id: text('id').primaryKey(),
    serverId: text('server_id')
      .references(() => servers.id, { onDelete: 'cascade' })
      .notNull(),
    cpuUsage: integer('cpu_usage').notNull(),
    memoryUsage: bigint('memory_usage', { mode: 'number' }).notNull(),
    memoryTotal: bigint('memory_total', { mode: 'number' }).notNull(),
    diskUsage: bigint('disk_usage', { mode: 'number' }).notNull(),
    diskTotal: bigint('disk_total', { mode: 'number' }).notNull(),
    networkIn: bigint('network_in', { mode: 'number' }).notNull(),
    networkOut: bigint('network_out', { mode: 'number' }).notNull(),
    timestamp: timestamp('timestamp', { mode: 'date' }).notNull(),
  },
  (table) => [
    index('pg_metrics_server_id_idx').on(table.serverId),
    index('pg_metrics_server_timestamp_idx').on(table.serverId, table.timestamp),
  ],
);

// ============================================================================
// Metrics Hourly
// ============================================================================

export const metricsHourly = pgTable(
  'metrics_hourly',
  {
    id: text('id').primaryKey(),
    serverId: text('server_id')
      .references(() => servers.id, { onDelete: 'cascade' })
      .notNull(),
    cpuAvg: integer('cpu_avg').notNull(),
    cpuMin: integer('cpu_min').notNull(),
    cpuMax: integer('cpu_max').notNull(),
    memoryAvg: bigint('memory_avg', { mode: 'number' }).notNull(),
    memoryMin: bigint('memory_min', { mode: 'number' }).notNull(),
    memoryMax: bigint('memory_max', { mode: 'number' }).notNull(),
    memoryTotal: bigint('memory_total', { mode: 'number' }).notNull(),
    diskAvg: bigint('disk_avg', { mode: 'number' }).notNull(),
    diskMin: bigint('disk_min', { mode: 'number' }).notNull(),
    diskMax: bigint('disk_max', { mode: 'number' }).notNull(),
    diskTotal: bigint('disk_total', { mode: 'number' }).notNull(),
    networkInAvg: bigint('network_in_avg', { mode: 'number' }).notNull(),
    networkInMax: bigint('network_in_max', { mode: 'number' }).notNull(),
    networkOutAvg: bigint('network_out_avg', { mode: 'number' }).notNull(),
    networkOutMax: bigint('network_out_max', { mode: 'number' }).notNull(),
    sampleCount: integer('sample_count').notNull(),
    bucketTime: timestamp('bucket_time', { mode: 'date' }).notNull(),
  },
  (table) => [
    index('pg_metrics_hourly_server_id_idx').on(table.serverId),
    index('pg_metrics_hourly_server_bucket_idx').on(table.serverId, table.bucketTime),
  ],
);

// ============================================================================
// Metrics Daily
// ============================================================================

export const metricsDaily = pgTable(
  'metrics_daily',
  {
    id: text('id').primaryKey(),
    serverId: text('server_id')
      .references(() => servers.id, { onDelete: 'cascade' })
      .notNull(),
    cpuAvg: integer('cpu_avg').notNull(),
    cpuMin: integer('cpu_min').notNull(),
    cpuMax: integer('cpu_max').notNull(),
    memoryAvg: bigint('memory_avg', { mode: 'number' }).notNull(),
    memoryMin: bigint('memory_min', { mode: 'number' }).notNull(),
    memoryMax: bigint('memory_max', { mode: 'number' }).notNull(),
    memoryTotal: bigint('memory_total', { mode: 'number' }).notNull(),
    diskAvg: bigint('disk_avg', { mode: 'number' }).notNull(),
    diskMin: bigint('disk_min', { mode: 'number' }).notNull(),
    diskMax: bigint('disk_max', { mode: 'number' }).notNull(),
    diskTotal: bigint('disk_total', { mode: 'number' }).notNull(),
    networkInAvg: bigint('network_in_avg', { mode: 'number' }).notNull(),
    networkInMax: bigint('network_in_max', { mode: 'number' }).notNull(),
    networkOutAvg: bigint('network_out_avg', { mode: 'number' }).notNull(),
    networkOutMax: bigint('network_out_max', { mode: 'number' }).notNull(),
    sampleCount: integer('sample_count').notNull(),
    bucketTime: timestamp('bucket_time', { mode: 'date' }).notNull(),
  },
  (table) => [
    index('pg_metrics_daily_server_id_idx').on(table.serverId),
    index('pg_metrics_daily_server_bucket_idx').on(table.serverId, table.bucketTime),
  ],
);

// ============================================================================
// Knowledge Cache
// ============================================================================

export const knowledgeCache = pgTable(
  'knowledge_cache',
  {
    id: text('id').primaryKey(),
    software: text('software').notNull(),
    platform: text('platform').notNull(),
    content: jsonb('content').$type<KnowledgeEntry>().notNull(),
    source: text('source', {
      enum: ['builtin', 'auto_learn', 'scrape', 'community'],
    }).notNull(),
    successCount: integer('success_count').default(0).notNull(),
    lastUsed: timestamp('last_used', { mode: 'date' }),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).notNull(),
  },
  (table) => [
    index('pg_knowledge_cache_software_idx').on(table.software),
    index('pg_knowledge_cache_platform_idx').on(table.platform),
    index('pg_knowledge_cache_sw_plat_idx').on(table.software, table.platform),
  ],
);

// ============================================================================
// Audit Logs
// ============================================================================

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: text('id').primaryKey(),
    serverId: text('server_id')
      .references(() => servers.id, { onDelete: 'cascade' })
      .notNull(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    tenantId: text('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
    sessionId: text('session_id'),
    command: text('command').notNull(),
    riskLevel: text('risk_level', {
      enum: ['green', 'yellow', 'red', 'critical', 'forbidden'],
    }).notNull(),
    reason: text('reason').notNull(),
    matchedPattern: text('matched_pattern'),
    action: text('action', {
      enum: ['allowed', 'blocked', 'requires_confirmation'],
    }).notNull(),
    auditWarnings: jsonb('audit_warnings').$type<string[]>().default([]),
    auditBlockers: jsonb('audit_blockers').$type<string[]>().default([]),
    executionResult: text('execution_result', {
      enum: ['success', 'failed', 'timeout', 'pending', 'skipped'],
    }),
    operationId: text('operation_id'),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull(),
  },
  (table) => [
    index('pg_audit_logs_server_id_idx').on(table.serverId),
    index('pg_audit_logs_user_id_idx').on(table.userId),
    index('pg_audit_logs_tenant_id_idx').on(table.tenantId),
    index('pg_audit_logs_risk_level_idx').on(table.riskLevel),
    index('pg_audit_logs_action_idx').on(table.action),
    index('pg_audit_logs_created_at_idx').on(table.createdAt),
  ],
);

// ============================================================================
// Document Sources
// ============================================================================

export const docSources = pgTable(
  'doc_sources',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    tenantId: text('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    software: text('software').notNull(),
    type: text('type', { enum: ['github', 'website'] }).notNull(),
    githubConfig: jsonb('github_config').$type<DocSourceGitHubConfig | null>(),
    websiteConfig: jsonb('website_config').$type<DocSourceWebConfig | null>(),
    enabled: boolean('enabled').default(true).notNull(),
    autoUpdate: boolean('auto_update').default(false).notNull(),
    updateFrequencyHours: integer('update_frequency_hours').default(168),
    lastFetchedAt: timestamp('last_fetched_at', { mode: 'date' }),
    lastFetchStatus: text('last_fetch_status', {
      enum: ['success', 'failed', 'pending'],
    }),
    lastFetchError: text('last_fetch_error'),
    documentCount: integer('document_count').default(0).notNull(),
    lastSha: text('last_sha'),
    lastHash: text('last_hash'),
    lastUpdateTime: timestamp('last_update_time', { mode: 'date' }),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).notNull(),
  },
  (table) => [
    index('pg_doc_sources_user_id_idx').on(table.userId),
    index('pg_doc_sources_tenant_id_idx').on(table.tenantId),
    index('pg_doc_sources_software_idx').on(table.software),
    index('pg_doc_sources_enabled_idx').on(table.enabled),
    index('pg_doc_sources_auto_update_idx').on(table.autoUpdate),
  ],
);

// ============================================================================
// Webhooks
// ============================================================================

export const webhooks = pgTable(
  'webhooks',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    tenantId: text('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    url: text('url').notNull(),
    secret: text('secret').notNull(),
    events: jsonb('events').$type<WebhookEventType[]>().notNull(),
    enabled: boolean('enabled').default(true).notNull(),
    maxRetries: integer('max_retries').default(3).notNull(),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).notNull(),
  },
  (table) => [
    index('pg_webhooks_user_id_idx').on(table.userId),
    index('pg_webhooks_tenant_id_idx').on(table.tenantId),
    index('pg_webhooks_enabled_idx').on(table.enabled),
  ],
);

// ============================================================================
// Webhook Deliveries
// ============================================================================

export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: text('id').primaryKey(),
    webhookId: text('webhook_id')
      .references(() => webhooks.id, { onDelete: 'cascade' })
      .notNull(),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    status: text('status', {
      enum: ['pending', 'success', 'failed'],
    })
      .default('pending')
      .notNull(),
    httpStatus: integer('http_status'),
    responseBody: text('response_body'),
    attempts: integer('attempts').default(0).notNull(),
    lastAttemptAt: timestamp('last_attempt_at', { mode: 'date' }),
    nextRetryAt: timestamp('next_retry_at', { mode: 'date' }),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull(),
  },
  (table) => [
    index('pg_webhook_deliveries_webhook_id_idx').on(table.webhookId),
    index('pg_webhook_deliveries_status_idx').on(table.status),
    index('pg_webhook_deliveries_next_retry_idx').on(table.nextRetryAt),
    index('pg_webhook_deliveries_created_at_idx').on(table.createdAt),
  ],
);

// ============================================================================
// Invitations
// ============================================================================

export const invitations = pgTable(
  'invitations',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    email: text('email').notNull(),
    role: text('role', { enum: ['admin', 'member'] }).default('member').notNull(),
    token: text('token').notNull().unique(),
    status: text('status', { enum: ['pending', 'accepted', 'cancelled', 'expired'] })
      .default('pending')
      .notNull(),
    invitedBy: text('invited_by')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    expiresAt: timestamp('expires_at', { mode: 'date' }).notNull(),
    acceptedAt: timestamp('accepted_at', { mode: 'date' }),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).notNull(),
  },
  (table) => [
    index('pg_invitations_tenant_id_idx').on(table.tenantId),
    index('pg_invitations_email_idx').on(table.email),
    index('pg_invitations_token_idx').on(table.token),
    index('pg_invitations_status_idx').on(table.status),
    index('pg_invitations_expires_at_idx').on(table.expiresAt),
  ],
);

// ============================================================================
// Document Source History
// ============================================================================

export const docSourceHistory = pgTable(
  'doc_source_history',
  {
    id: text('id').primaryKey(),
    sourceId: text('source_id')
      .references(() => docSources.id, { onDelete: 'cascade' })
      .notNull(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    changeType: text('change_type', {
      enum: ['initial', 'update', 'no_change'],
    }).notNull(),
    previousVersion: text('previous_version'),
    currentVersion: text('current_version'),
    status: text('status', {
      enum: ['success', 'failed'],
    }).notNull(),
    error: text('error'),
    documentCount: integer('document_count').default(0).notNull(),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull(),
  },
  (table) => [
    index('pg_doc_source_history_source_id_idx').on(table.sourceId),
    index('pg_doc_source_history_user_id_idx').on(table.userId),
    index('pg_doc_source_history_created_at_idx').on(table.createdAt),
  ],
);

// ============================================================================
// Subscriptions (Stripe)
// ============================================================================

export const subscriptions = pgTable(
  'subscriptions',
  {
    id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
    tenantId: text('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull()
      .unique(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    plan: text('plan', { enum: ['free', 'pro', 'team', 'enterprise'] })
      .default('free')
      .notNull(),
    status: text('status', {
      enum: ['incomplete', 'active', 'past_due', 'canceled', 'unpaid'],
    })
      .default('incomplete')
      .notNull(),
    stripeSubscriptionId: text('stripe_subscription_id'),
    stripeCustomerId: text('stripe_customer_id'),
    currentPeriodStart: timestamp('current_period_start', { mode: 'date' }),
    currentPeriodEnd: timestamp('current_period_end', { mode: 'date' }),
    cancelAtPeriodEnd: boolean('cancel_at_period_end').default(false).notNull(),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).notNull(),
  },
  (table) => [
    index('pg_subscriptions_tenant_id_idx').on(table.tenantId),
    index('pg_subscriptions_user_id_idx').on(table.userId),
    index('pg_subscriptions_stripe_subscription_id_idx').on(table.stripeSubscriptionId),
    index('pg_subscriptions_status_idx').on(table.status),
  ],
);

// ============================================================================
// AI Usage (Cost Tracking)
// ============================================================================

export const aiUsage = pgTable(
  'ai_usage',
  {
    id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    tenantId: text('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    model: text('model').notNull(), // claude-haiku-4-5, claude-sonnet-4-5, claude-opus-4-6
    inputTokens: integer('input_tokens').default(0).notNull(),
    outputTokens: integer('output_tokens').default(0).notNull(),
    cost: bigint('cost', { mode: 'number' }).notNull(), // stored as cents/basis points
    createdAt: timestamp('created_at', { mode: 'date' }).notNull(),
  },
  (table) => [
    index('pg_ai_usage_user_id_idx').on(table.userId),
    index('pg_ai_usage_tenant_id_idx').on(table.tenantId),
    index('pg_ai_usage_model_idx').on(table.model),
    index('pg_ai_usage_created_at_idx').on(table.createdAt),
    index('pg_ai_usage_user_created_idx').on(table.userId, table.createdAt),
    index('pg_ai_usage_tenant_created_idx').on(table.tenantId, table.createdAt),
  ],
);

// ============================================================================
// Skill Executions
// ============================================================================

export const skillExecutions = pgTable(
  'skill_executions',
  {
    id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    tenantId: text('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    serverId: text('server_id')
      .references(() => servers.id, { onDelete: 'cascade' })
      .notNull(),
    skillName: text('skill_name').notNull(),
    status: text('status', { enum: ['success', 'failed'] }).notNull(),
    report: jsonb('report').$type<Record<string, unknown> | null>(),
    duration: integer('duration'),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull(),
  },
  (table) => [
    index('pg_skill_executions_user_id_idx').on(table.userId),
    index('pg_skill_executions_tenant_id_idx').on(table.tenantId),
    index('pg_skill_executions_server_id_idx').on(table.serverId),
    index('pg_skill_executions_skill_name_idx').on(table.skillName),
    index('pg_skill_executions_created_at_idx').on(table.createdAt),
  ],
);
