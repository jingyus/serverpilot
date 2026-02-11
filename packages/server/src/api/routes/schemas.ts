// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Zod validation schemas for REST API request/response payloads.
 *
 * All route handlers use these schemas to validate incoming requests
 * and type-check outgoing responses.
 *
 * @module api/routes/schemas
 */

import { z } from 'zod';
import { CronExpressionParser } from 'cron-parser';

// ============================================================================
// Common
// ============================================================================

/** UUID string format (v4) */
const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uuid = z.string().regex(uuidRegex, 'Invalid UUID format');

/** Pagination query parameters */
export const PaginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;

// ============================================================================
// Auth Schemas
// ============================================================================

export const LoginBodySchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});
export type LoginBody = z.infer<typeof LoginBodySchema>;

export const RegisterBodySchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().min(1, 'Name is required').max(100),
});
export type RegisterBody = z.infer<typeof RegisterBodySchema>;

export const RefreshTokenBodySchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});
export type RefreshTokenBody = z.infer<typeof RefreshTokenBodySchema>;

// ============================================================================
// Server Schemas
// ============================================================================

export const CreateServerBodySchema = z.object({
  name: z.string().min(1, 'Server name is required').max(100),
  tags: z.array(z.string().max(50)).max(20).optional(),
});
export type CreateServerBody = z.infer<typeof CreateServerBodySchema>;

export const UpdateServerBodySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
});
export type UpdateServerBody = z.infer<typeof UpdateServerBodySchema>;

export const ServerIdParamSchema = z.object({
  id: uuid,
});

export const ServerMetricsQuerySchema = z.object({
  range: z.enum(['1h', '24h', '7d']).default('1h'),
});
export type ServerMetricsQuery = z.infer<typeof ServerMetricsQuerySchema>;

/** Add a note to server profile */
export const AddNoteBodySchema = z.object({
  note: z.string().min(1, 'Note is required').max(500, 'Note too long (max 500)'),
});
export type AddNoteBody = z.infer<typeof AddNoteBodySchema>;

/** Remove a note from server profile */
export const RemoveNoteBodySchema = z.object({
  index: z.number().int().min(0, 'Index must be non-negative'),
});
export type RemoveNoteBody = z.infer<typeof RemoveNoteBodySchema>;

/** Update server profile preferences */
export const UpdatePreferencesBodySchema = z.object({
  packageManager: z.enum(['apt', 'yum', 'brew', 'apk']).optional(),
  deploymentStyle: z.enum(['docker', 'bare-metal', 'pm2']).optional(),
  shell: z.string().max(50).optional(),
  timezone: z.string().max(100).optional(),
});
export type UpdatePreferencesBody = z.infer<typeof UpdatePreferencesBodySchema>;

/** Set history summary for server profile */
export const SetHistorySummaryBodySchema = z.object({
  summary: z.string().min(1, 'Summary is required').max(5000, 'Summary too long (max 5000)'),
  keepRecentCount: z.number().int().min(0).max(200).default(20),
});
export type SetHistorySummaryBody = z.infer<typeof SetHistorySummaryBodySchema>;

/** Record an operation in profile history */
export const RecordOperationBodySchema = z.object({
  summary: z.string().min(1, 'Summary is required').max(300, 'Summary too long (max 300)'),
});
export type RecordOperationBody = z.infer<typeof RecordOperationBodySchema>;

// ============================================================================
// Operation History Schemas
// ============================================================================

/** Query operations with advanced filtering */
export const OperationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  serverId: z.string().optional(),
  type: z.enum(['install', 'config', 'restart', 'execute', 'backup']).optional(),
  status: z.enum(['pending', 'running', 'success', 'failed', 'rolled_back']).optional(),
  riskLevel: z.enum(['green', 'yellow', 'red', 'critical']).optional(),
  search: z.string().max(200).optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
});
export type OperationQuery = z.infer<typeof OperationQuerySchema>;

/** Query operation statistics */
export const OperationStatsQuerySchema = z.object({
  serverId: z.string().optional(),
});
export type OperationStatsQuery = z.infer<typeof OperationStatsQuerySchema>;

/** Create a new operation record */
export const CreateOperationBodySchema = z.object({
  serverId: z.string().min(1, 'Server ID is required'),
  sessionId: z.string().optional(),
  type: z.enum(['install', 'config', 'restart', 'execute', 'backup']),
  description: z.string().min(1, 'Description is required').max(500),
  commands: z.array(z.string().max(2000)).min(1, 'At least one command is required').max(50),
  riskLevel: z.enum(['green', 'yellow', 'red', 'critical']),
  snapshotId: z.string().optional(),
});
export type CreateOperationBody = z.infer<typeof CreateOperationBodySchema>;

/** Update operation status */
export const UpdateOperationStatusBodySchema = z.object({
  status: z.enum(['running', 'success', 'failed', 'rolled_back']),
  output: z.string().max(100000).optional(),
  duration: z.number().int().min(0).optional(),
});
export type UpdateOperationStatusBody = z.infer<typeof UpdateOperationStatusBodySchema>;

// ============================================================================
// Chat Schemas
// ============================================================================

export const ChatMessageBodySchema = z.object({
  message: z.string().min(1, 'Message is required').max(4000),
  sessionId: z.string().optional(),
});
export type ChatMessageBody = z.infer<typeof ChatMessageBodySchema>;

export const ExecutePlanBodySchema = z.object({
  planId: z.string().min(1, 'Plan ID is required'),
  sessionId: z.string().min(1, 'Session ID is required'),
});
export type ExecutePlanBody = z.infer<typeof ExecutePlanBodySchema>;

export const CancelExecutionBodySchema = z.object({
  planId: z.string().min(1, 'Plan ID is required'),
  sessionId: z.string().min(1, 'Session ID is required'),
});
export type CancelExecutionBody = z.infer<typeof CancelExecutionBodySchema>;

export const ChatServerIdParamSchema = z.object({
  serverId: uuid,
});

export const ChatSessionParamSchema = z.object({
  serverId: uuid,
  sessionId: uuid,
});

// ============================================================================
// Task Schemas
// ============================================================================

/** Validate a cron expression string using cron-parser. */
const cronExpression = z.string().min(1, 'Cron expression is required').max(100).refine(
  (val) => {
    try {
      CronExpressionParser.parse(val);
      return true;
    } catch {
      return false;
    }
  },
  { message: 'Invalid cron expression' },
);

export const CreateTaskBodySchema = z.object({
  serverId: uuid,
  name: z.string().min(1, 'Task name is required').max(200),
  cron: cronExpression,
  command: z.string().min(1, 'Command is required').max(1000),
  description: z.string().max(500).optional(),
});
export type CreateTaskBody = z.infer<typeof CreateTaskBodySchema>;

export const UpdateTaskBodySchema = z.object({
  name: z.string().min(1).max(200).optional(),
  cron: cronExpression.optional(),
  command: z.string().min(1).max(1000).optional(),
  description: z.string().max(500).optional(),
  status: z.enum(['active', 'paused']).optional(),
});
export type UpdateTaskBody = z.infer<typeof UpdateTaskBodySchema>;

export const TaskQuerySchema = z.object({
  serverId: uuid.optional(),
  status: z.enum(['active', 'paused']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type TaskQuery = z.infer<typeof TaskQuerySchema>;

export const TaskIdParamSchema = z.object({
  id: uuid,
});

// ============================================================================
// Alert Schemas
// ============================================================================

export const AlertQuerySchema = z.object({
  serverId: uuid.optional(),
  resolved: z.coerce.boolean().optional(),
});
export type AlertQuery = z.infer<typeof AlertQuerySchema>;

export const AlertIdParamSchema = z.object({
  id: uuid,
});

// ============================================================================
// Alert Rule Schemas
// ============================================================================

const metricType = z.enum(['cpu', 'memory', 'disk']);
const comparisonOperator = z.enum(['gt', 'lt', 'gte', 'lte']);
const ruleSeverity = z.enum(['info', 'warning', 'critical']);

export const CreateAlertRuleBodySchema = z.object({
  serverId: uuid,
  name: z.string().min(1, 'Rule name is required').max(200),
  metricType,
  operator: comparisonOperator,
  threshold: z.number().int().min(0).max(100),
  severity: ruleSeverity,
  emailRecipients: z.array(z.string().email()).max(20).optional(),
  cooldownMinutes: z.number().int().min(1).max(1440).optional(),
});
export type CreateAlertRuleBody = z.infer<typeof CreateAlertRuleBodySchema>;

export const UpdateAlertRuleBodySchema = z.object({
  name: z.string().min(1).max(200).optional(),
  metricType: metricType.optional(),
  operator: comparisonOperator.optional(),
  threshold: z.number().int().min(0).max(100).optional(),
  severity: ruleSeverity.optional(),
  enabled: z.boolean().optional(),
  emailRecipients: z.array(z.string().email()).max(20).optional(),
  cooldownMinutes: z.number().int().min(1).max(1440).optional(),
});
export type UpdateAlertRuleBody = z.infer<typeof UpdateAlertRuleBodySchema>;

export const AlertRuleQuerySchema = z.object({
  serverId: uuid.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type AlertRuleQuery = z.infer<typeof AlertRuleQuerySchema>;

// ============================================================================
// Knowledge / Doc Fetcher Schemas
// ============================================================================

/** Trigger a GitHub repository documentation scrape */
export const ScrapeGitHubBodySchema = z.object({
  owner: z.string().min(1).max(100),
  repo: z.string().min(1).max(100),
  branch: z.string().max(100).optional(),
  paths: z.array(z.string().max(500)).max(20).optional(),
  extensions: z.array(z.string().max(10)).max(10).optional(),
  maxFiles: z.number().int().min(1).max(100).optional(),
  software: z.string().min(1).max(100),
});
export type ScrapeGitHubBody = z.infer<typeof ScrapeGitHubBodySchema>;

/** Trigger a website documentation scrape */
export const ScrapeWebsiteBodySchema = z.object({
  baseUrl: z.string().url('Invalid URL'),
  software: z.string().min(1).max(100),
  pages: z.array(z.string().url()).max(50).optional(),
  maxDepth: z.number().int().min(0).max(5).optional(),
  maxPages: z.number().int().min(1).max(50).optional(),
  includePatterns: z.array(z.string().max(200)).max(10).optional(),
  excludePatterns: z.array(z.string().max(200)).max(10).optional(),
});
export type ScrapeWebsiteBody = z.infer<typeof ScrapeWebsiteBodySchema>;

/** Generic scrape request (discriminated by type) */
export const ScrapeDocBodySchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('github'),
    source: ScrapeGitHubBodySchema,
  }),
  z.object({
    type: z.literal('website'),
    source: ScrapeWebsiteBodySchema,
  }),
]);
export type ScrapeDocBody = z.infer<typeof ScrapeDocBodySchema>;

// ============================================================================
// Settings Schemas
// ============================================================================

/** AI Provider type */
const aiProvider = z.enum(['claude', 'openai', 'ollama', 'deepseek']);

/** Update AI Provider configuration */
export const UpdateAIProviderBodySchema = z.object({
  provider: aiProvider,
  apiKey: z.string().min(1).max(500).optional(),
  model: z.string().min(1).max(200).optional(),
  baseUrl: z.string().url('Invalid URL').max(500).optional(),
});
export type UpdateAIProviderBody = z.infer<typeof UpdateAIProviderBodySchema>;

/** Update user profile */
export const UpdateUserProfileBodySchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email('Invalid email format'),
  timezone: z.string().min(1).max(100),
});
export type UpdateUserProfileBody = z.infer<typeof UpdateUserProfileBodySchema>;

/** Update notification preferences */
export const UpdateNotificationsBodySchema = z.object({
  emailNotifications: z.boolean(),
  taskCompletion: z.boolean(),
  systemAlerts: z.boolean(),
  operationReports: z.boolean(),
});
export type UpdateNotificationsBody = z.infer<typeof UpdateNotificationsBodySchema>;

/** Update knowledge base configuration */
export const UpdateKnowledgeBaseBodySchema = z.object({
  autoLearning: z.boolean(),
  documentSources: z.array(z.string().max(500)).max(50),
});
export type UpdateKnowledgeBaseBody = z.infer<typeof UpdateKnowledgeBaseBodySchema>;
