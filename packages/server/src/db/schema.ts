// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Drizzle ORM schema definitions for ServerPilot.
 *
 * Defines all database tables using drizzle-orm/sqlite-core.
 * Each table includes typed columns, foreign keys, and indexes.
 *
 * Tables: tenants, users, servers, agents, profiles, sessions, operations,
 *         snapshots, tasks, alerts, metrics, knowledgeCache
 *
 * @module db/schema
 */

import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

// ============================================================================
// Tenants (multi-tenant isolation boundary)
// ============================================================================

export type TenantPlan = "free" | "pro" | "enterprise";

export const tenants = sqliteTable(
  "tenants",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    ownerId: text("owner_id").notNull(),
    plan: text("plan", { enum: ["free", "pro", "enterprise"] })
      .default("free")
      .notNull(),
    maxServers: integer("max_servers").default(5).notNull(),
    maxUsers: integer("max_users").default(1).notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("tenants_slug_idx").on(table.slug),
    index("tenants_owner_id_idx").on(table.ownerId),
  ],
);

// ============================================================================
// Users
// ============================================================================

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    name: text("name"),
    timezone: text("timezone").default("UTC"),
    tenantId: text("tenant_id").references(() => tenants.id, {
      onDelete: "cascade",
    }),
    role: text("role", { enum: ["owner", "admin", "member"] })
      .default("member")
      .notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("users_tenant_id_idx").on(table.tenantId),
    index("users_role_idx").on(table.role),
  ],
);

// ============================================================================
// OAuth Accounts (linked external identity providers)
// ============================================================================

export const oauthAccounts = sqliteTable(
  "oauth_accounts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    provider: text("provider", { enum: ["github"] }).notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    providerUsername: text("provider_username"),
    providerAvatarUrl: text("provider_avatar_url"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("oauth_accounts_provider_account_idx").on(
      table.provider,
      table.providerAccountId,
    ),
    index("oauth_accounts_user_id_idx").on(table.userId),
  ],
);

// ============================================================================
// User Settings (AI Provider, Notifications, Knowledge Base)
// ============================================================================

/** AI Provider configuration stored as JSON */
export interface UserSettingsAIProvider {
  provider: "claude" | "openai" | "ollama" | "deepseek" | "custom-openai";
  apiKey?: string;
  model?: string;
  baseUrl?: string;
}

/** Notification preferences stored as JSON */
export interface UserSettingsNotifications {
  emailNotifications: boolean;
  taskCompletion: boolean;
  systemAlerts: boolean;
  operationReports: boolean;
}

/** Knowledge base configuration stored as JSON */
export interface UserSettingsKnowledgeBase {
  autoLearning: boolean;
  documentSources: string[];
}

export const userSettings = sqliteTable(
  "user_settings",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull()
      .unique(),
    aiProvider: text("ai_provider", { mode: "json" })
      .$type<UserSettingsAIProvider>()
      .notNull(),
    notifications: text("notifications", { mode: "json" })
      .$type<UserSettingsNotifications>()
      .notNull(),
    knowledgeBase: text("knowledge_base", { mode: "json" })
      .$type<UserSettingsKnowledgeBase>()
      .notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [uniqueIndex("user_settings_user_id_idx").on(table.userId)],
);

// ============================================================================
// Servers
// ============================================================================

export const servers = sqliteTable(
  "servers",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    userId: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    tenantId: text("tenant_id").references(() => tenants.id, {
      onDelete: "cascade",
    }),
    status: text("status", { enum: ["online", "offline", "error"] })
      .default("offline")
      .notNull(),
    tags: text("tags", { mode: "json" }).$type<string[]>().default([]),
    group: text("group"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("servers_user_id_idx").on(table.userId),
    index("servers_tenant_id_idx").on(table.tenantId),
    index("servers_group_idx").on(table.group),
  ],
);

// ============================================================================
// Agents
// ============================================================================

export const agents = sqliteTable(
  "agents",
  {
    id: text("id").primaryKey(),
    serverId: text("server_id")
      .references(() => servers.id, { onDelete: "cascade" })
      .notNull(),
    keyHash: text("key_hash").notNull(),
    version: text("version"),
    lastSeen: integer("last_seen", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [uniqueIndex("agents_server_id_idx").on(table.serverId)],
);

// ============================================================================
// Server Profiles (1:1 with servers)
// ============================================================================

/** OS information stored as JSON in profiles */
export interface ProfileOsInfo {
  platform: string;
  arch: string;
  version: string;
  kernel: string;
  hostname: string;
  uptime: number;
}

/** Software entry stored as JSON in profiles */
export interface ProfileSoftware {
  name: string;
  version: string;
  configPath?: string;
  dataPath?: string;
  ports?: number[];
}

/** Service entry stored as JSON in profiles */
export interface ProfileService {
  name: string;
  status: "running" | "stopped" | "failed";
  ports: number[];
  manager?: "systemd" | "pm2" | "docker";
  uptime?: string;
}

/** User preferences stored as JSON in profiles */
export interface ProfilePreferences {
  packageManager?: "apt" | "yum" | "brew" | "apk";
  deploymentStyle?: "docker" | "bare-metal" | "pm2";
  backupLocation?: string;
  logLocation?: string;
  preferredEditor?: string;
}

export const profiles = sqliteTable(
  "profiles",
  {
    id: text("id").primaryKey(),
    serverId: text("server_id")
      .references(() => servers.id, { onDelete: "cascade" })
      .notNull()
      .unique(),
    osInfo: text("os_info", { mode: "json" }).$type<ProfileOsInfo | null>(),
    software: text("software", { mode: "json" })
      .$type<ProfileSoftware[]>()
      .default([]),
    services: text("services", { mode: "json" })
      .$type<ProfileService[]>()
      .default([]),
    preferences: text("preferences", {
      mode: "json",
    }).$type<ProfilePreferences | null>(),
    notes: text("notes", { mode: "json" }).$type<string[]>().default([]),
    operationHistory: text("operation_history", { mode: "json" })
      .$type<string[]>()
      .default([]),
    historySummary: text("history_summary"),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [uniqueIndex("profiles_server_id_idx").on(table.serverId)],
);

// ============================================================================
// Sessions (AI conversation sessions)
// ============================================================================

/** Chat message stored as JSON in sessions */
export interface SessionMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  plan?: unknown;
}

/** Session context metadata stored as JSON */
export interface SessionContext {
  serverId: string;
  profileSnapshot: string;
  tokenCount: number;
  summarized: boolean;
}

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    serverId: text("server_id")
      .references(() => servers.id, { onDelete: "cascade" })
      .notNull(),
    name: text("name"),
    /** @deprecated Kept for backward compat; new messages go to session_messages table. */
    messages: text("messages", { mode: "json" })
      .$type<SessionMessage[]>()
      .default([]),
    context: text("context", { mode: "json" }).$type<SessionContext | null>(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("sessions_user_id_idx").on(table.userId),
    index("sessions_server_id_idx").on(table.serverId),
  ],
);

// ============================================================================
// Session Messages (normalized message storage — replaces JSON array)
// ============================================================================

export const sessionMessages = sqliteTable(
  "session_messages",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .references(() => sessions.id, { onDelete: "cascade" })
      .notNull(),
    role: text("role", { enum: ["user", "assistant", "system"] }).notNull(),
    content: text("content").notNull(),
    timestamp: integer("timestamp").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("session_messages_session_id_idx").on(table.sessionId),
    index("session_messages_session_timestamp_idx").on(
      table.sessionId,
      table.timestamp,
    ),
  ],
);

// ============================================================================
// Operations (command execution records)
// ============================================================================

export const operations = sqliteTable(
  "operations",
  {
    id: text("id").primaryKey(),
    serverId: text("server_id")
      .references(() => servers.id, { onDelete: "cascade" })
      .notNull(),
    sessionId: text("session_id").references(() => sessions.id, {
      onDelete: "set null",
    }),
    userId: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    tenantId: text("tenant_id").references(() => tenants.id, {
      onDelete: "cascade",
    }),
    type: text("type", {
      enum: ["install", "config", "restart", "execute", "backup"],
    }).notNull(),
    description: text("description").notNull(),
    commands: text("commands", { mode: "json" }).$type<string[]>().default([]),
    output: text("output"),
    status: text("status", {
      enum: ["pending", "running", "success", "failed", "rolled_back"],
    })
      .default("pending")
      .notNull(),
    riskLevel: text("risk_level", {
      enum: ["green", "yellow", "red", "critical"],
    })
      .default("green")
      .notNull(),
    snapshotId: text("snapshot_id"),
    duration: integer("duration"),
    inputTokens: integer("input_tokens").default(0).notNull(),
    outputTokens: integer("output_tokens").default(0).notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    completedAt: integer("completed_at", { mode: "timestamp" }),
  },
  (table) => [
    index("operations_server_id_idx").on(table.serverId),
    index("operations_user_id_idx").on(table.userId),
    index("operations_tenant_id_idx").on(table.tenantId),
    index("operations_session_id_idx").on(table.sessionId),
    index("operations_status_idx").on(table.status),
  ],
);

// ============================================================================
// Snapshots (pre/post operation file snapshots)
// ============================================================================

/** File snapshot entry stored as JSON */
export interface SnapshotFile {
  path: string;
  content: string;
  mode: number;
  owner: string;
}

/** Config snapshot entry stored as JSON */
export interface SnapshotConfig {
  type: "nginx" | "mysql" | "redis" | "crontab" | "other";
  path: string;
  content: string;
}

export const snapshots = sqliteTable(
  "snapshots",
  {
    id: text("id").primaryKey(),
    serverId: text("server_id")
      .references(() => servers.id, { onDelete: "cascade" })
      .notNull(),
    operationId: text("operation_id"),
    files: text("files", { mode: "json" }).$type<SnapshotFile[]>().default([]),
    configs: text("configs", { mode: "json" })
      .$type<SnapshotConfig[]>()
      .default([]),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp" }),
  },
  (table) => [
    index("snapshots_server_id_idx").on(table.serverId),
    index("snapshots_operation_id_idx").on(table.operationId),
  ],
);

// ============================================================================
// Tasks (scheduled cron tasks)
// ============================================================================

export const tasks = sqliteTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    serverId: text("server_id")
      .references(() => servers.id, { onDelete: "cascade" })
      .notNull(),
    userId: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    tenantId: text("tenant_id").references(() => tenants.id, {
      onDelete: "cascade",
    }),
    name: text("name").notNull(),
    description: text("description"),
    cron: text("cron").notNull(),
    command: text("command").notNull(),
    status: text("status", { enum: ["active", "paused", "deleted"] })
      .default("active")
      .notNull(),
    lastRun: integer("last_run", { mode: "timestamp" }),
    lastStatus: text("last_status", { enum: ["success", "failed"] }),
    nextRun: integer("next_run", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("tasks_server_id_idx").on(table.serverId),
    index("tasks_user_id_idx").on(table.userId),
    index("tasks_tenant_id_idx").on(table.tenantId),
    index("tasks_status_idx").on(table.status),
  ],
);

// ============================================================================
// Alert Rules (threshold configuration)
// ============================================================================

export const alertRules = sqliteTable(
  "alert_rules",
  {
    id: text("id").primaryKey(),
    serverId: text("server_id")
      .references(() => servers.id, { onDelete: "cascade" })
      .notNull(),
    userId: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    name: text("name").notNull(),
    metricType: text("metric_type", {
      enum: ["cpu", "memory", "disk"],
    }).notNull(),
    operator: text("operator", {
      enum: ["gt", "lt", "gte", "lte"],
    }).notNull(),
    threshold: integer("threshold").notNull(), // percentage 0-100
    severity: text("severity", {
      enum: ["info", "warning", "critical"],
    }).notNull(),
    enabled: integer("enabled", { mode: "boolean" }).default(true).notNull(),
    emailRecipients: text("email_recipients", { mode: "json" })
      .$type<string[]>()
      .default([]),
    cooldownMinutes: integer("cooldown_minutes").default(30).notNull(),
    lastTriggeredAt: integer("last_triggered_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("alert_rules_server_id_idx").on(table.serverId),
    index("alert_rules_user_id_idx").on(table.userId),
    index("alert_rules_enabled_idx").on(table.enabled),
  ],
);

// ============================================================================
// Alerts (monitoring alerts)
// ============================================================================

export const alerts = sqliteTable(
  "alerts",
  {
    id: text("id").primaryKey(),
    serverId: text("server_id")
      .references(() => servers.id, { onDelete: "cascade" })
      .notNull(),
    type: text("type", {
      enum: ["cpu", "memory", "disk", "service", "offline"],
    }).notNull(),
    severity: text("severity", {
      enum: ["info", "warning", "critical"],
    }).notNull(),
    message: text("message").notNull(),
    value: text("value"),
    threshold: text("threshold"),
    resolved: integer("resolved", { mode: "boolean" }).default(false).notNull(),
    resolvedAt: integer("resolved_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("alerts_server_id_idx").on(table.serverId),
    index("alerts_resolved_idx").on(table.resolved),
  ],
);

// ============================================================================
// Metrics (time-series monitoring data)
// ============================================================================

export const metrics = sqliteTable(
  "metrics",
  {
    id: text("id").primaryKey(),
    serverId: text("server_id")
      .references(() => servers.id, { onDelete: "cascade" })
      .notNull(),
    cpuUsage: integer("cpu_usage").notNull(), // 0-10000 (percentage * 100)
    memoryUsage: integer("memory_usage").notNull(), // bytes
    memoryTotal: integer("memory_total").notNull(), // bytes
    diskUsage: integer("disk_usage").notNull(), // bytes
    diskTotal: integer("disk_total").notNull(), // bytes
    networkIn: integer("network_in").notNull(), // bytes/s
    networkOut: integer("network_out").notNull(), // bytes/s
    timestamp: integer("timestamp", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("metrics_server_id_idx").on(table.serverId),
    index("metrics_server_timestamp_idx").on(table.serverId, table.timestamp),
  ],
);

// ============================================================================
// Metrics Hourly (aggregated per hour, retained 30 days)
// ============================================================================

export const metricsHourly = sqliteTable(
  "metrics_hourly",
  {
    id: text("id").primaryKey(),
    serverId: text("server_id")
      .references(() => servers.id, { onDelete: "cascade" })
      .notNull(),
    cpuAvg: integer("cpu_avg").notNull(), // 0-10000
    cpuMin: integer("cpu_min").notNull(),
    cpuMax: integer("cpu_max").notNull(),
    memoryAvg: integer("memory_avg").notNull(), // bytes
    memoryMin: integer("memory_min").notNull(),
    memoryMax: integer("memory_max").notNull(),
    memoryTotal: integer("memory_total").notNull(),
    diskAvg: integer("disk_avg").notNull(),
    diskMin: integer("disk_min").notNull(),
    diskMax: integer("disk_max").notNull(),
    diskTotal: integer("disk_total").notNull(),
    networkInAvg: integer("network_in_avg").notNull(),
    networkInMax: integer("network_in_max").notNull(),
    networkOutAvg: integer("network_out_avg").notNull(),
    networkOutMax: integer("network_out_max").notNull(),
    sampleCount: integer("sample_count").notNull(),
    bucketTime: integer("bucket_time", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("metrics_hourly_server_id_idx").on(table.serverId),
    index("metrics_hourly_server_bucket_idx").on(
      table.serverId,
      table.bucketTime,
    ),
  ],
);

// ============================================================================
// Metrics Daily (aggregated per day, retained 1 year)
// ============================================================================

export const metricsDaily = sqliteTable(
  "metrics_daily",
  {
    id: text("id").primaryKey(),
    serverId: text("server_id")
      .references(() => servers.id, { onDelete: "cascade" })
      .notNull(),
    cpuAvg: integer("cpu_avg").notNull(),
    cpuMin: integer("cpu_min").notNull(),
    cpuMax: integer("cpu_max").notNull(),
    memoryAvg: integer("memory_avg").notNull(),
    memoryMin: integer("memory_min").notNull(),
    memoryMax: integer("memory_max").notNull(),
    memoryTotal: integer("memory_total").notNull(),
    diskAvg: integer("disk_avg").notNull(),
    diskMin: integer("disk_min").notNull(),
    diskMax: integer("disk_max").notNull(),
    diskTotal: integer("disk_total").notNull(),
    networkInAvg: integer("network_in_avg").notNull(),
    networkInMax: integer("network_in_max").notNull(),
    networkOutAvg: integer("network_out_avg").notNull(),
    networkOutMax: integer("network_out_max").notNull(),
    sampleCount: integer("sample_count").notNull(),
    bucketTime: integer("bucket_time", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("metrics_daily_server_id_idx").on(table.serverId),
    index("metrics_daily_server_bucket_idx").on(
      table.serverId,
      table.bucketTime,
    ),
  ],
);

// ============================================================================
// Knowledge Cache
// ============================================================================

/** Knowledge entry stored as JSON */
export interface KnowledgeEntry {
  commands: string[];
  verification?: string;
  notes?: string[];
  platform?: string;
}

export const knowledgeCache = sqliteTable(
  "knowledge_cache",
  {
    id: text("id").primaryKey(),
    software: text("software").notNull(),
    platform: text("platform").notNull(),
    content: text("content", { mode: "json" })
      .$type<KnowledgeEntry>()
      .notNull(),
    source: text("source", {
      enum: ["builtin", "auto_learn", "scrape", "community"],
    }).notNull(),
    successCount: integer("success_count").default(0).notNull(),
    lastUsed: integer("last_used", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("knowledge_cache_software_idx").on(table.software),
    index("knowledge_cache_platform_idx").on(table.platform),
    index("knowledge_cache_software_platform_idx").on(
      table.software,
      table.platform,
    ),
  ],
);

// ============================================================================
// Audit Logs (security audit trail)
// ============================================================================

export const auditLogs = sqliteTable(
  "audit_logs",
  {
    id: text("id").primaryKey(),
    serverId: text("server_id")
      .references(() => servers.id, { onDelete: "cascade" })
      .notNull(),
    userId: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    tenantId: text("tenant_id").references(() => tenants.id, {
      onDelete: "cascade",
    }),
    sessionId: text("session_id"),
    command: text("command").notNull(),
    riskLevel: text("risk_level", {
      enum: ["green", "yellow", "red", "critical", "forbidden"],
    }).notNull(),
    reason: text("reason").notNull(),
    matchedPattern: text("matched_pattern"),
    action: text("action", {
      enum: ["allowed", "blocked", "requires_confirmation"],
    }).notNull(),
    auditWarnings: text("audit_warnings", { mode: "json" })
      .$type<string[]>()
      .default([]),
    auditBlockers: text("audit_blockers", { mode: "json" })
      .$type<string[]>()
      .default([]),
    executionResult: text("execution_result", {
      enum: ["success", "failed", "timeout", "pending", "skipped"],
    }),
    operationId: text("operation_id"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("audit_logs_server_id_idx").on(table.serverId),
    index("audit_logs_user_id_idx").on(table.userId),
    index("audit_logs_tenant_id_idx").on(table.tenantId),
    index("audit_logs_risk_level_idx").on(table.riskLevel),
    index("audit_logs_action_idx").on(table.action),
    index("audit_logs_created_at_idx").on(table.createdAt),
  ],
);

// ============================================================================
// Document Sources (for auto-scraping external documentation)
// ============================================================================

/** GitHub source configuration stored as JSON */
export interface DocSourceGitHubConfig {
  owner: string;
  repo: string;
  branch?: string;
  paths?: string[];
  extensions?: string[];
  maxFiles?: number;
}

/** Website source configuration stored as JSON */
export interface DocSourceWebConfig {
  baseUrl: string;
  pages?: string[];
  maxDepth?: number;
  maxPages?: number;
  includePatterns?: string[];
  excludePatterns?: string[];
}

export const docSources = sqliteTable(
  "doc_sources",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    tenantId: text("tenant_id").references(() => tenants.id, {
      onDelete: "cascade",
    }),
    name: text("name").notNull(),
    software: text("software").notNull(),
    type: text("type", { enum: ["github", "website"] }).notNull(),
    githubConfig: text("github_config", {
      mode: "json",
    }).$type<DocSourceGitHubConfig | null>(),
    websiteConfig: text("website_config", {
      mode: "json",
    }).$type<DocSourceWebConfig | null>(),
    enabled: integer("enabled", { mode: "boolean" }).default(true).notNull(),
    autoUpdate: integer("auto_update", { mode: "boolean" })
      .default(false)
      .notNull(),
    updateFrequencyHours: integer("update_frequency_hours").default(168), // Weekly by default
    lastFetchedAt: integer("last_fetched_at", { mode: "timestamp" }),
    lastFetchStatus: text("last_fetch_status", {
      enum: ["success", "failed", "pending"],
    }),
    lastFetchError: text("last_fetch_error"),
    documentCount: integer("document_count").default(0).notNull(),
    lastSha: text("last_sha"),
    lastHash: text("last_hash"),
    lastUpdateTime: integer("last_update_time", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("doc_sources_user_id_idx").on(table.userId),
    index("doc_sources_tenant_id_idx").on(table.tenantId),
    index("doc_sources_software_idx").on(table.software),
    index("doc_sources_enabled_idx").on(table.enabled),
    index("doc_sources_auto_update_idx").on(table.autoUpdate),
  ],
);

// ============================================================================
// Document Source History (update tracking)
// ============================================================================

/** Document source update history entry */
export interface DocSourceHistoryEntry {
  sourceId: string;
  sourceName: string;
  changeType: "initial" | "update" | "no_change";
  previousVersion?: string;
  currentVersion?: string;
}

// ============================================================================
// Webhooks (external notification endpoints)
// ============================================================================

export type WebhookEventType =
  | "task.completed"
  | "alert.triggered"
  | "server.offline"
  | "operation.failed"
  | "agent.disconnected"
  | "skill.completed"
  | "skill.failed";

export const webhooks = sqliteTable(
  "webhooks",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    tenantId: text("tenant_id").references(() => tenants.id, {
      onDelete: "cascade",
    }),
    name: text("name").notNull(),
    url: text("url").notNull(),
    secret: text("secret").notNull(),
    events: text("events", { mode: "json" })
      .$type<WebhookEventType[]>()
      .notNull(),
    enabled: integer("enabled", { mode: "boolean" }).default(true).notNull(),
    maxRetries: integer("max_retries").default(3).notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("webhooks_user_id_idx").on(table.userId),
    index("webhooks_tenant_id_idx").on(table.tenantId),
    index("webhooks_enabled_idx").on(table.enabled),
  ],
);

// ============================================================================
// Webhook Deliveries (delivery attempt log)
// ============================================================================

export const webhookDeliveries = sqliteTable(
  "webhook_deliveries",
  {
    id: text("id").primaryKey(),
    webhookId: text("webhook_id")
      .references(() => webhooks.id, { onDelete: "cascade" })
      .notNull(),
    eventType: text("event_type").notNull(),
    payload: text("payload", { mode: "json" })
      .$type<Record<string, unknown>>()
      .notNull(),
    status: text("status", {
      enum: ["pending", "success", "failed"],
    })
      .default("pending")
      .notNull(),
    httpStatus: integer("http_status"),
    responseBody: text("response_body"),
    attempts: integer("attempts").default(0).notNull(),
    lastAttemptAt: integer("last_attempt_at", { mode: "timestamp" }),
    nextRetryAt: integer("next_retry_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("webhook_deliveries_webhook_id_idx").on(table.webhookId),
    index("webhook_deliveries_status_idx").on(table.status),
    index("webhook_deliveries_next_retry_idx").on(table.nextRetryAt),
    index("webhook_deliveries_created_at_idx").on(table.createdAt),
  ],
);

// ============================================================================
// Invitations (team member invite workflow)
// ============================================================================

export type InvitationStatus = "pending" | "accepted" | "cancelled" | "expired";

export const invitations = sqliteTable(
  "invitations",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    email: text("email").notNull(),
    role: text("role", { enum: ["admin", "member"] })
      .default("member")
      .notNull(),
    token: text("token").notNull().unique(),
    status: text("status", {
      enum: ["pending", "accepted", "cancelled", "expired"],
    })
      .default("pending")
      .notNull(),
    invitedBy: text("invited_by")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    acceptedAt: integer("accepted_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("invitations_tenant_id_idx").on(table.tenantId),
    index("invitations_email_idx").on(table.email),
    index("invitations_token_idx").on(table.token),
    index("invitations_status_idx").on(table.status),
    index("invitations_expires_at_idx").on(table.expiresAt),
  ],
);

// ============================================================================
// Document Source History (update tracking)
// ============================================================================

export const docSourceHistory = sqliteTable(
  "doc_source_history",
  {
    id: text("id").primaryKey(),
    sourceId: text("source_id")
      .references(() => docSources.id, { onDelete: "cascade" })
      .notNull(),
    userId: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    changeType: text("change_type", {
      enum: ["initial", "update", "no_change"],
    }).notNull(),
    previousVersion: text("previous_version"),
    currentVersion: text("current_version"),
    status: text("status", {
      enum: ["success", "failed"],
    }).notNull(),
    error: text("error"),
    documentCount: integer("document_count").default(0).notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("doc_source_history_source_id_idx").on(table.sourceId),
    index("doc_source_history_user_id_idx").on(table.userId),
    index("doc_source_history_created_at_idx").on(table.createdAt),
  ],
);

// ============================================================================
// Installed Skills (skill plugin registry)
// ============================================================================

export type SkillSource = "official" | "community" | "local";
export type SkillStatus =
  | "installed"
  | "configured"
  | "enabled"
  | "paused"
  | "error";

export const installedSkills = sqliteTable(
  "installed_skills",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    tenantId: text("tenant_id").references(() => tenants.id, {
      onDelete: "cascade",
    }),
    name: text("name").notNull(),
    displayName: text("display_name"),
    version: text("version").notNull(),
    source: text("source", {
      enum: ["official", "community", "local"],
    }).notNull(),
    skillPath: text("skill_path").notNull(),
    status: text("status", {
      enum: ["installed", "configured", "enabled", "paused", "error"],
    })
      .default("installed")
      .notNull(),
    config: text("config", { mode: "json" }).$type<Record<
      string,
      unknown
    > | null>(),
    manifestInputs: text("manifest_inputs", { mode: "json" }).$type<
      unknown[] | null
    >(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("installed_skills_user_id_idx").on(table.userId),
    index("installed_skills_tenant_id_idx").on(table.tenantId),
    index("installed_skills_name_idx").on(table.name),
    index("installed_skills_status_idx").on(table.status),
  ],
);

// ============================================================================
// Skill Executions (execution history log)
// ============================================================================

export type SkillTriggerType =
  | "manual"
  | "cron"
  | "event"
  | "threshold"
  | "dry-run";
export type SkillExecutionStatus =
  | "pending_confirmation"
  | "running"
  | "success"
  | "failed"
  | "timeout"
  | "cancelled";

export const skillExecutions = sqliteTable(
  "skill_executions",
  {
    id: text("id").primaryKey(),
    skillId: text("skill_id")
      .references(() => installedSkills.id, { onDelete: "cascade" })
      .notNull(),
    serverId: text("server_id")
      .references(() => servers.id, { onDelete: "cascade" })
      .notNull(),
    userId: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    triggerType: text("trigger_type", {
      enum: ["manual", "cron", "event", "threshold", "dry-run"],
    }).notNull(),
    status: text("status", {
      enum: [
        "pending_confirmation",
        "running",
        "success",
        "failed",
        "timeout",
        "cancelled",
      ],
    })
      .default("running")
      .notNull(),
    startedAt: integer("started_at", { mode: "timestamp" }).notNull(),
    completedAt: integer("completed_at", { mode: "timestamp" }),
    result: text("result", { mode: "json" }).$type<Record<
      string,
      unknown
    > | null>(),
    stepsExecuted: integer("steps_executed").default(0).notNull(),
    duration: integer("duration"),
  },
  (table) => [
    index("skill_executions_skill_id_idx").on(table.skillId),
    index("skill_executions_server_id_idx").on(table.serverId),
    index("skill_executions_user_id_idx").on(table.userId),
    index("skill_executions_status_idx").on(table.status),
    index("skill_executions_started_at_idx").on(table.startedAt),
  ],
);

// ============================================================================
// Skill Execution Logs (step-level event persistence)
// ============================================================================

export type SkillLogEventType =
  | "step"
  | "log"
  | "error"
  | "completed"
  | "confirmation_required";

export const skillExecutionLogs = sqliteTable(
  "skill_execution_logs",
  {
    id: text("id").primaryKey(),
    executionId: text("execution_id")
      .references(() => skillExecutions.id, { onDelete: "cascade" })
      .notNull(),
    eventType: text("event_type", {
      enum: ["step", "log", "error", "completed", "confirmation_required"],
    }).notNull(),
    data: text("data", { mode: "json" })
      .$type<Record<string, unknown>>()
      .notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("skill_execution_logs_execution_id_idx").on(table.executionId),
    index("skill_execution_logs_event_type_idx").on(table.eventType),
    index("skill_execution_logs_created_at_idx").on(table.createdAt),
  ],
);

// ============================================================================
// Skill Store (per-skill key-value persistence)
// ============================================================================

export const skillStore = sqliteTable(
  "skill_store",
  {
    id: text("id").primaryKey(),
    skillId: text("skill_id")
      .references(() => installedSkills.id, { onDelete: "cascade" })
      .notNull(),
    key: text("key").notNull(),
    value: text("value"),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("skill_store_skill_key_idx").on(table.skillId, table.key),
    index("skill_store_skill_id_idx").on(table.skillId),
  ],
);

// ============================================================================
// Command Approvals (dangerous command approval workflow)
// ============================================================================

export type CommandApprovalRiskLevel = "red" | "critical" | "forbidden";
export type CommandApprovalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "expired";

/** Execution context for tracking where the approval came from */
export interface CommandApprovalExecutionContext {
  taskId?: string;
  operationId?: string;
  sessionId?: string;
  chatMessageId?: string;
}

export const commandApprovals = sqliteTable(
  "command_approvals",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    serverId: text("server_id")
      .references(() => servers.id, { onDelete: "cascade" })
      .notNull(),
    command: text("command").notNull(),
    riskLevel: text("risk_level", {
      enum: ["red", "critical", "forbidden"],
    }).notNull(),
    status: text("status", {
      enum: ["pending", "approved", "rejected", "expired"],
    })
      .default("pending")
      .notNull(),
    reason: text("reason"),
    warnings: text("warnings", { mode: "json" }).$type<string[]>().default([]),
    requestedAt: integer("requested_at", { mode: "timestamp" }).notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    decidedAt: integer("decided_at", { mode: "timestamp" }),
    decidedBy: text("decided_by"),
    executionContext: text("execution_context", {
      mode: "json",
    }).$type<CommandApprovalExecutionContext>(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("command_approvals_user_id_idx").on(table.userId),
    index("command_approvals_server_id_idx").on(table.serverId),
    index("command_approvals_status_idx").on(table.status),
    index("command_approvals_expires_at_idx").on(table.expiresAt),
  ],
);
