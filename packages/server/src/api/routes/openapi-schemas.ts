// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Shared OpenAPI response schemas and examples.
 *
 * Defines typed response schemas used by openapi-routes.ts and
 * openapi-routes-extra.ts to document all API endpoints.
 *
 * @module api/routes/openapi-schemas
 */

import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

extendZodWithOpenApi(z);

// ============================================================================
// Common
// ============================================================================

export const ErrorResponseSchema = z.object({
  error: z.object({
    code: z.string().openapi({ example: 'VALIDATION_ERROR' }),
    message: z.string().openapi({ example: 'Validation failed' }),
    details: z.array(z.object({
      field: z.string().openapi({ example: 'email' }),
      message: z.string().openapi({ example: 'Invalid email format' }),
    })).optional(),
  }),
});

export const SuccessResponseSchema = z.object({
  success: z.boolean().openapi({ example: true }),
});

export const UuidParamSchema = z.object({
  id: z.string().openapi({ description: 'Resource UUID', example: '550e8400-e29b-41d4-a716-446655440000' }),
});

export const ServerIdParamSchema = z.object({
  serverId: z.string().openapi({ description: 'Server UUID', example: '550e8400-e29b-41d4-a716-446655440000' }),
});

export const BEARER_AUTH = 'BearerAuth';

// ============================================================================
// Helpers
// ============================================================================

export const err = (desc: string) => ({
  description: desc,
  content: { 'application/json': { schema: ErrorResponseSchema } },
});

export const ok = (desc: string) => ({
  description: desc,
  content: { 'application/json': { schema: SuccessResponseSchema } },
});

export const body = (schema: z.ZodTypeAny) => ({
  content: { 'application/json': { schema } },
  required: true as const,
});

export const json = (desc: string, schema: z.ZodTypeAny) => ({
  description: desc,
  content: { 'application/json': { schema } },
});

export const sec = [{ [BEARER_AUTH]: [] }];

// ============================================================================
// Auth response schemas
// ============================================================================

export const AuthResponseSchema = z.object({
  user: z.object({
    id: z.string().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }),
    email: z.string().openapi({ example: 'admin@example.com' }),
    name: z.string().openapi({ example: 'Admin User' }),
  }),
  accessToken: z.string().openapi({ example: 'eyJhbGciOiJIUzI1NiIs...' }),
  refreshToken: z.string().openapi({ example: 'dGhpcyBpcyBhIHJlZnJl...' }),
});

export const TokenResponseSchema = z.object({
  accessToken: z.string().openapi({ example: 'eyJhbGciOiJIUzI1NiIs...' }),
  refreshToken: z.string().openapi({ example: 'dGhpcyBpcyBhIHJlZnJl...' }),
});

// ============================================================================
// Server response schemas
// ============================================================================

export const ServerSchema = z.object({
  id: z.string().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }),
  name: z.string().openapi({ example: 'production-web-01' }),
  status: z.enum(['online', 'offline', 'error']).openapi({ example: 'online' }),
  tags: z.array(z.string()).openapi({ example: ['web', 'production'] }),
  os: z.string().nullable().openapi({ example: 'Ubuntu 22.04' }),
  arch: z.string().nullable().openapi({ example: 'x64' }),
  hostname: z.string().nullable().openapi({ example: 'web-01.example.com' }),
  lastSeenAt: z.string().nullable().openapi({ example: '2026-02-11T10:30:00Z' }),
  createdAt: z.string().openapi({ example: '2026-01-15T08:00:00Z' }),
  updatedAt: z.string().openapi({ example: '2026-02-11T10:30:00Z' }),
});

export const ServerWithTokenSchema = ServerSchema.extend({
  agentToken: z.string().openapi({ example: 'agt_a1b2c3d4e5f6...' }),
});

export const ServerListResponseSchema = z.object({ servers: z.array(ServerSchema) });
export const ServerResponseSchema = z.object({ server: ServerSchema });
export const ServerCreatedResponseSchema = z.object({ server: ServerWithTokenSchema });

// ============================================================================
// Server Profile response schemas
// ============================================================================

export const ProfileSchema = z.object({
  serverId: z.string().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }),
  notes: z.array(z.string()).openapi({ example: ['Runs nginx reverse proxy', 'Upgraded to Node 22'] }),
  preferences: z.object({
    packageManager: z.string().optional().openapi({ example: 'apt' }),
    deploymentStyle: z.string().optional().openapi({ example: 'docker' }),
    shell: z.string().optional().openapi({ example: 'bash' }),
    timezone: z.string().optional().openapi({ example: 'Asia/Shanghai' }),
  }).nullable(),
  historySummary: z.string().nullable().openapi({ example: 'Server has been running stably...' }),
});

export const ProfileResponseSchema = z.object({ profile: ProfileSchema });
export const HistoryResponseSchema = z.object({
  history: z.array(z.string()).openapi({ example: ['Installed nginx', 'Updated SSL certs'] }),
  total: z.number().openapi({ example: 42 }),
});
export const SummaryResponseSchema = z.object({
  summary: z.string().openapi({ example: 'Server has been running stably for 30 days...' }),
});

// ============================================================================
// Metrics response schemas
// ============================================================================

export const MetricPointSchema = z.object({
  id: z.string().openapi({ example: '1' }),
  serverId: z.string().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }),
  cpuUsage: z.number().openapi({ example: 45.2 }),
  memoryUsage: z.number().openapi({ example: 2147483648 }),
  memoryTotal: z.number().openapi({ example: 8589934592 }),
  diskUsage: z.number().openapi({ example: 53687091200 }),
  diskTotal: z.number().openapi({ example: 107374182400 }),
  networkIn: z.number().openapi({ example: 1048576 }),
  networkOut: z.number().openapi({ example: 524288 }),
  timestamp: z.string().openapi({ example: '2026-02-11T10:30:00Z' }),
});

export const MetricsResponseSchema = z.object({
  metrics: z.array(MetricPointSchema),
  range: z.string().openapi({ example: '24h' }),
});

export const AggBucketSchema = z.object({
  avg: z.number().openapi({ example: 45.2 }),
  min: z.number().openapi({ example: 10.1 }),
  max: z.number().openapi({ example: 89.5 }),
});

export const AggregatedMetricsResponseSchema = z.object({
  metrics: z.array(z.object({
    timestamp: z.string().openapi({ example: '2026-02-11T10:00:00Z' }),
    cpuUsage: AggBucketSchema,
    memoryUsage: AggBucketSchema,
    diskUsage: AggBucketSchema,
    networkIn: AggBucketSchema,
    networkOut: AggBucketSchema,
  })),
});

// ============================================================================
// Operation response schemas
// ============================================================================

export const OperationSchema = z.object({
  id: z.string().openapi({ example: '660e8400-e29b-41d4-a716-446655440000' }),
  serverId: z.string().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }),
  sessionId: z.string().nullable().openapi({ example: null }),
  type: z.enum(['install', 'config', 'restart', 'execute', 'backup']).openapi({ example: 'execute' }),
  description: z.string().openapi({ example: 'Check disk usage' }),
  commands: z.array(z.string()).openapi({ example: ['df -h'] }),
  status: z.enum(['pending', 'running', 'success', 'failed', 'rolled_back']).openapi({ example: 'success' }),
  riskLevel: z.enum(['green', 'yellow', 'red', 'critical']).openapi({ example: 'green' }),
  output: z.string().nullable().openapi({ example: '/dev/sda1  100G  53G  47G  53%' }),
  duration: z.number().nullable().openapi({ example: 1200 }),
  inputTokens: z.number().nullable().openapi({ example: 150 }),
  outputTokens: z.number().nullable().openapi({ example: 320 }),
  snapshotId: z.string().nullable().openapi({ example: null }),
  createdAt: z.string().openapi({ example: '2026-02-11T10:30:00Z' }),
  updatedAt: z.string().openapi({ example: '2026-02-11T10:30:01Z' }),
});

export const OperationListResponseSchema = z.object({
  operations: z.array(OperationSchema),
  total: z.number().openapi({ example: 128 }),
  limit: z.number().openapi({ example: 50 }),
  offset: z.number().openapi({ example: 0 }),
});

export const OperationResponseSchema = z.object({ operation: OperationSchema });

export const OperationStatsResponseSchema = z.object({
  stats: z.object({
    total: z.number().openapi({ example: 128 }),
    byStatus: z.record(z.number()).openapi({ example: { success: 100, failed: 15, pending: 13 } }),
    byType: z.record(z.number()).openapi({ example: { execute: 80, install: 30, config: 18 } }),
    byRiskLevel: z.record(z.number()).openapi({ example: { green: 90, yellow: 25, red: 10, critical: 3 } }),
  }),
});

// ============================================================================
// Task response schemas
// ============================================================================

export const TaskSchema = z.object({
  id: z.string().openapi({ example: '770e8400-e29b-41d4-a716-446655440000' }),
  serverId: z.string().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }),
  name: z.string().openapi({ example: 'Daily backup' }),
  cron: z.string().openapi({ example: '0 2 * * *' }),
  command: z.string().openapi({ example: 'tar -czf /backups/daily.tar.gz /data' }),
  description: z.string().nullable().openapi({ example: 'Compress data directory nightly' }),
  status: z.enum(['active', 'paused']).openapi({ example: 'active' }),
  lastRunAt: z.string().nullable().openapi({ example: '2026-02-11T02:00:00Z' }),
  nextRunAt: z.string().nullable().openapi({ example: '2026-02-12T02:00:00Z' }),
  createdAt: z.string().openapi({ example: '2026-01-15T08:00:00Z' }),
  updatedAt: z.string().openapi({ example: '2026-02-11T02:00:05Z' }),
});

export const TaskListResponseSchema = z.object({
  tasks: z.array(TaskSchema),
  total: z.number().openapi({ example: 12 }),
  limit: z.number().openapi({ example: 50 }),
  offset: z.number().openapi({ example: 0 }),
});

export const TaskResponseSchema = z.object({ task: TaskSchema });

export const TaskRunResponseSchema = z.object({
  success: z.boolean().openapi({ example: true }),
  exitCode: z.number().openapi({ example: 0 }),
  stdout: z.string().openapi({ example: 'Backup completed successfully' }),
  stderr: z.string().openapi({ example: '' }),
  duration: z.number().openapi({ example: 5200 }),
});

// ============================================================================
// Alert response schemas
// ============================================================================

export const AlertSchema = z.object({
  id: z.string().openapi({ example: '880e8400-e29b-41d4-a716-446655440000' }),
  serverId: z.string().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }),
  ruleId: z.string().openapi({ example: '990e8400-e29b-41d4-a716-446655440000' }),
  metricType: z.enum(['cpu', 'memory', 'disk']).openapi({ example: 'cpu' }),
  currentValue: z.number().openapi({ example: 95.3 }),
  threshold: z.number().openapi({ example: 90 }),
  severity: z.enum(['info', 'warning', 'critical']).openapi({ example: 'critical' }),
  resolved: z.boolean().openapi({ example: false }),
  resolvedAt: z.string().nullable().openapi({ example: null }),
  createdAt: z.string().openapi({ example: '2026-02-11T10:30:00Z' }),
});

export const AlertListResponseSchema = z.object({
  alerts: z.array(AlertSchema),
  total: z.number().openapi({ example: 5 }),
  limit: z.number().openapi({ example: 50 }),
  offset: z.number().openapi({ example: 0 }),
});

export const AlertResponseSchema = z.object({ alert: AlertSchema });
export const AlertResolvedResponseSchema = z.object({
  success: z.boolean().openapi({ example: true }),
  alert: AlertSchema,
});

// ============================================================================
// Alert Rule response schemas
// ============================================================================

export const AlertRuleSchema = z.object({
  id: z.string().openapi({ example: '990e8400-e29b-41d4-a716-446655440000' }),
  serverId: z.string().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }),
  name: z.string().openapi({ example: 'High CPU Alert' }),
  metricType: z.enum(['cpu', 'memory', 'disk']).openapi({ example: 'cpu' }),
  operator: z.enum(['gt', 'lt', 'gte', 'lte']).openapi({ example: 'gt' }),
  threshold: z.number().openapi({ example: 90 }),
  severity: z.enum(['info', 'warning', 'critical']).openapi({ example: 'critical' }),
  enabled: z.boolean().openapi({ example: true }),
  emailRecipients: z.array(z.string()).openapi({ example: ['ops@example.com'] }),
  cooldownMinutes: z.number().openapi({ example: 15 }),
  createdAt: z.string().openapi({ example: '2026-01-20T12:00:00Z' }),
  updatedAt: z.string().openapi({ example: '2026-02-10T09:00:00Z' }),
});

export const AlertRuleListResponseSchema = z.object({
  rules: z.array(AlertRuleSchema),
  total: z.number().openapi({ example: 8 }),
  limit: z.number().openapi({ example: 50 }),
  offset: z.number().openapi({ example: 0 }),
});

export const AlertRuleResponseSchema = z.object({ rule: AlertRuleSchema });

// ============================================================================
// Chat / Session response schemas
// ============================================================================

export const SessionSchema = z.object({
  id: z.string().openapi({ example: 'aa0e8400-e29b-41d4-a716-446655440000' }),
  serverId: z.string().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }),
  createdAt: z.string().openapi({ example: '2026-02-11T10:00:00Z' }),
  updatedAt: z.string().openapi({ example: '2026-02-11T10:05:00Z' }),
});

export const MessageSchema = z.object({
  id: z.string().openapi({ example: 'bb0e8400-e29b-41d4-a716-446655440000' }),
  role: z.enum(['user', 'assistant']).openapi({ example: 'user' }),
  content: z.string().openapi({ example: 'Check disk usage on this server' }),
  createdAt: z.string().openapi({ example: '2026-02-11T10:00:00Z' }),
});

export const SessionListResponseSchema = z.object({ sessions: z.array(SessionSchema) });
export const SessionDetailResponseSchema = z.object({
  session: SessionSchema.extend({ messages: z.array(MessageSchema) }),
});

// ============================================================================
// Snapshot response schemas
// ============================================================================

export const SnapshotSchema = z.object({
  id: z.string().openapi({ example: 'cc0e8400-e29b-41d4-a716-446655440000' }),
  serverId: z.string().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }),
  operationId: z.string().openapi({ example: '660e8400-e29b-41d4-a716-446655440000' }),
  type: z.string().openapi({ example: 'pre-operation' }),
  data: z.record(z.unknown()).openapi({ example: { files: ['/etc/nginx/nginx.conf'] } }),
  createdAt: z.string().openapi({ example: '2026-02-11T10:29:55Z' }),
});

export const SnapshotListResponseSchema = z.object({
  snapshots: z.array(SnapshotSchema),
  total: z.number().openapi({ example: 3 }),
});

export const SnapshotResponseSchema = z.object({ snapshot: SnapshotSchema });

// ============================================================================
// Agent response schemas
// ============================================================================

export const AgentVersionResponseSchema = z.object({
  latest: z.string().openapi({ example: '0.2.0' }),
  current: z.string().openapi({ example: '0.1.0' }),
  updateAvailable: z.boolean().openapi({ example: true }),
  forceUpdate: z.boolean().openapi({ example: false }),
  releaseDate: z.string().openapi({ example: '2026-02-10T00:00:00Z' }),
  releaseNotes: z.string().openapi({ example: 'Bug fixes and performance improvements' }),
  downloadUrl: z.string().optional().openapi({ example: 'https://releases.serverpilot.dev/agent/0.2.0/linux-x64' }),
  sha256: z.string().optional().openapi({ example: 'a1b2c3d4e5f6...' }),
  size: z.number().optional().openapi({ example: 15728640 }),
});

export const BinaryInfoSchema = z.object({
  url: z.string().openapi({ example: 'https://releases.serverpilot.dev/agent/0.2.0/linux-x64' }),
  sha256: z.string().openapi({ example: 'a1b2c3d4e5f6...' }),
  size: z.number().openapi({ example: 15728640 }),
});

export const AgentBinariesResponseSchema = z.object({
  version: z.string().openapi({ example: '0.2.0' }),
  binaries: z.record(BinaryInfoSchema).openapi({
    example: { 'linux-x64': { url: 'https://releases.serverpilot.dev/agent/0.2.0/linux-x64', sha256: 'a1b2c3...', size: 15728640 } },
  }),
});

// ============================================================================
// Knowledge response schemas
// ============================================================================

export const KnowledgeSearchResponseSchema = z.object({
  query: z.string().openapi({ example: 'nginx reverse proxy' }),
  count: z.number().openapi({ example: 3 }),
  results: z.array(z.object({
    id: z.string().openapi({ example: 'dd0e8400-e29b-41d4-a716-446655440000' }),
    software: z.string().openapi({ example: 'nginx' }),
    platform: z.string().openapi({ example: 'linux' }),
    content: z.string().openapi({ example: 'To configure nginx as reverse proxy...' }),
    source: z.enum(['builtin', 'auto_learn', 'scrape', 'community']).openapi({ example: 'builtin' }),
    successCount: z.number().openapi({ example: 42 }),
    lastUsed: z.string().nullable().openapi({ example: '2026-02-10T15:00:00Z' }),
    createdAt: z.string().openapi({ example: '2026-01-01T00:00:00Z' }),
    updatedAt: z.string().openapi({ example: '2026-02-10T15:00:00Z' }),
  })),
});

// ============================================================================
// Doc Sources response schemas
// ============================================================================

export const DocSourceSchema = z.object({
  id: z.string().openapi({ example: 'ee0e8400-e29b-41d4-a716-446655440000' }),
  name: z.string().openapi({ example: 'Nginx Official Docs' }),
  software: z.string().openapi({ example: 'nginx' }),
  type: z.enum(['github', 'website']).openapi({ example: 'github' }),
  enabled: z.boolean().openapi({ example: true }),
  autoUpdate: z.boolean().openapi({ example: true }),
  updateFrequencyHours: z.number().openapi({ example: 24 }),
  lastFetchedAt: z.string().nullable().openapi({ example: '2026-02-11T06:00:00Z' }),
  lastFetchStatus: z.string().nullable().openapi({ example: 'success' }),
  documentCount: z.number().openapi({ example: 15 }),
  createdAt: z.string().openapi({ example: '2026-01-10T00:00:00Z' }),
});

export const DocSourceListResponseSchema = z.object({ sources: z.array(DocSourceSchema) });
export const DocSourceResponseSchema = z.object({ source: DocSourceSchema });

export const DocSourceStatusResponseSchema = z.object({
  status: z.object({
    lastFetchedAt: z.string().nullable().openapi({ example: '2026-02-11T06:00:00Z' }),
    lastFetchStatus: z.string().nullable().openapi({ example: 'success' }),
    lastFetchError: z.string().nullable().openapi({ example: null }),
    documentCount: z.number().openapi({ example: 15 }),
    shouldUpdate: z.boolean().openapi({ example: false }),
  }),
});

// ============================================================================
// Settings response schemas
// ============================================================================

export const SettingsResponseSchema = z.object({
  aiProvider: z.object({
    provider: z.enum(['claude', 'openai', 'ollama']).openapi({ example: 'claude' }),
    model: z.string().openapi({ example: 'claude-sonnet-4-5-20250929' }),
    baseUrl: z.string().nullable().openapi({ example: null }),
  }),
  userProfile: z.object({
    name: z.string().openapi({ example: 'Admin User' }),
    email: z.string().openapi({ example: 'admin@example.com' }),
    timezone: z.string().openapi({ example: 'Asia/Shanghai' }),
  }),
  notifications: z.object({
    emailNotifications: z.boolean().openapi({ example: true }),
    taskCompletion: z.boolean().openapi({ example: true }),
    systemAlerts: z.boolean().openapi({ example: true }),
    operationReports: z.boolean().openapi({ example: false }),
  }),
  knowledgeBase: z.object({
    autoLearning: z.boolean().openapi({ example: true }),
    documentSources: z.array(z.string()).openapi({ example: ['https://nginx.org/en/docs/'] }),
  }),
});

// ============================================================================
// Health check
// ============================================================================

export const HealthResponseSchema = z.object({
  status: z.literal('ok').openapi({ example: 'ok' }),
  timestamp: z.number().openapi({ example: 1707648000000 }),
});
