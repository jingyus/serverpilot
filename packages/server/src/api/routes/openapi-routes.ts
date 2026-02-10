/**
 * OpenAPI route definitions for all API endpoints.
 *
 * Registers path definitions into an OpenAPIRegistry. Split from
 * openapi-spec.ts to stay within the 500-line file limit.
 *
 * @module api/routes/openapi-routes
 */

import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';

// Must be called before any .openapi() usage on Zod schemas
extendZodWithOpenApi(z);

import {
  LoginBodySchema,
  RegisterBodySchema,
  RefreshTokenBodySchema,
  CreateServerBodySchema,
  UpdateServerBodySchema,
  ServerMetricsQuerySchema,
  AddNoteBodySchema,
  RemoveNoteBodySchema,
  UpdatePreferencesBodySchema,
  SetHistorySummaryBodySchema,
  RecordOperationBodySchema,
  PaginationQuerySchema,
  OperationQuerySchema,
  OperationStatsQuerySchema,
  CreateOperationBodySchema,
  UpdateOperationStatusBodySchema,
  ChatMessageBodySchema,
  ExecutePlanBodySchema,
  CreateTaskBodySchema,
  UpdateTaskBodySchema,
  TaskQuerySchema,
  AlertQuerySchema,
  CreateAlertRuleBodySchema,
  UpdateAlertRuleBodySchema,
  AlertRuleQuerySchema,
  ScrapeDocBodySchema,
  UpdateAIProviderBodySchema,
  UpdateUserProfileBodySchema,
  UpdateNotificationsBodySchema,
  UpdateKnowledgeBaseBodySchema,
} from './schemas.js';

// ============================================================================
// Shared schemas
// ============================================================================

const ErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.array(z.object({ field: z.string(), message: z.string() })).optional(),
  }),
});

const SuccessResponseSchema = z.object({ success: z.boolean() });

const UuidParamSchema = z.object({
  id: z.string().openapi({ description: 'Resource UUID', example: '550e8400-e29b-41d4-a716-446655440000' }),
});

const ServerIdParamSchema = z.object({
  serverId: z.string().openapi({ description: 'Server UUID', example: '550e8400-e29b-41d4-a716-446655440000' }),
});

const BEARER_AUTH = 'BearerAuth';

// Helper for error responses
const err = (desc: string) => ({ description: desc, content: { 'application/json': { schema: ErrorResponseSchema } } });
const ok = (desc: string) => ({ description: desc, content: { 'application/json': { schema: SuccessResponseSchema } } });
const body = (schema: z.ZodTypeAny) => ({ content: { 'application/json': { schema } }, required: true as const });
const sec = [{ [BEARER_AUTH]: [] }];

// ============================================================================
// Route registration
// ============================================================================

export function registerAllRoutes(registry: OpenAPIRegistry): void {
  registerAuthRoutes(registry);
  registerServerRoutes(registry);
  registerChatRoutes(registry);
  registerTaskRoutes(registry);
  registerAlertRoutes(registry);
  registerOperationRoutes(registry);
  registerAgentRoutes(registry);
  registerKnowledgeRoutes(registry);
  registerDocSourceRoutes(registry);
  registerSettingsRoutes(registry);
  registerMetricsRoutes(registry);
  registerSystemRoutes(registry);
}

// --------------------------------------------------------------------------
// Auth
// --------------------------------------------------------------------------

function registerAuthRoutes(r: OpenAPIRegistry): void {
  const authResp = z.object({
    user: z.object({ id: z.string(), email: z.string(), name: z.string() }),
    accessToken: z.string(),
    refreshToken: z.string(),
  });

  r.registerPath({ method: 'post', path: '/api/v1/auth/register', summary: 'Register a new user', tags: ['Auth'],
    request: { body: body(RegisterBodySchema) },
    responses: { 201: { description: 'Registration successful', content: { 'application/json': { schema: authResp } } }, 400: err('Validation error') },
  });

  r.registerPath({ method: 'post', path: '/api/v1/auth/login', summary: 'Login with email and password', tags: ['Auth'],
    request: { body: body(LoginBodySchema) },
    responses: { 200: { description: 'Login successful', content: { 'application/json': { schema: authResp } } }, 401: err('Invalid credentials') },
  });

  r.registerPath({ method: 'post', path: '/api/v1/auth/refresh', summary: 'Refresh access token', tags: ['Auth'],
    request: { body: body(RefreshTokenBodySchema) },
    responses: {
      200: { description: 'Token refreshed', content: { 'application/json': { schema: z.object({ accessToken: z.string(), refreshToken: z.string() }) } } },
      401: err('Invalid refresh token'),
    },
  });

  r.registerPath({ method: 'post', path: '/api/v1/auth/logout', summary: 'Logout (stateless)', tags: ['Auth'],
    responses: { 200: { description: 'Logout acknowledged', content: { 'application/json': { schema: z.object({ message: z.string() }) } } } },
  });
}

// --------------------------------------------------------------------------
// Servers
// --------------------------------------------------------------------------

function registerServerRoutes(r: OpenAPIRegistry): void {
  r.registerPath({ method: 'get', path: '/api/v1/servers', summary: 'List all servers', tags: ['Servers'], security: sec,
    responses: { 200: { description: 'Server list' }, 401: err('Unauthorized') },
  });

  r.registerPath({ method: 'post', path: '/api/v1/servers', summary: 'Create a new server', tags: ['Servers'], security: sec,
    request: { body: body(CreateServerBodySchema) },
    responses: { 201: { description: 'Server created (includes agentToken)' }, 400: err('Validation error') },
  });

  r.registerPath({ method: 'get', path: '/api/v1/servers/{id}', summary: 'Get server details', tags: ['Servers'], security: sec,
    request: { params: UuidParamSchema },
    responses: { 200: { description: 'Server details' }, 404: err('Server not found') },
  });

  r.registerPath({ method: 'patch', path: '/api/v1/servers/{id}', summary: 'Update server info', tags: ['Servers'], security: sec,
    request: { params: UuidParamSchema, body: body(UpdateServerBodySchema) },
    responses: { 200: { description: 'Server updated' }, 404: err('Server not found') },
  });

  r.registerPath({ method: 'delete', path: '/api/v1/servers/{id}', summary: 'Delete a server', tags: ['Servers'], security: sec,
    request: { params: UuidParamSchema },
    responses: { 200: ok('Server deleted'), 404: err('Server not found') },
  });

  // Profile sub-routes
  r.registerPath({ method: 'get', path: '/api/v1/servers/{id}/profile', summary: 'Get server profile', tags: ['Server Profile'], security: sec,
    request: { params: UuidParamSchema },
    responses: { 200: { description: 'Server profile data' }, 404: err('Server not found') },
  });

  r.registerPath({ method: 'get', path: '/api/v1/servers/{id}/metrics', summary: 'Get server monitoring metrics', tags: ['Server Profile'], security: sec,
    request: { params: UuidParamSchema, query: ServerMetricsQuerySchema },
    responses: { 200: { description: 'Metrics data with time range' }, 404: err('Server not found') },
  });

  r.registerPath({ method: 'get', path: '/api/v1/servers/{id}/operations', summary: 'Get server operation history', tags: ['Server Profile'], security: sec,
    request: { params: UuidParamSchema, query: OperationQuerySchema },
    responses: { 200: { description: 'Operation history' } },
  });

  r.registerPath({ method: 'post', path: '/api/v1/servers/{id}/profile/notes', summary: 'Add a note to server profile', tags: ['Server Profile'], security: sec,
    request: { params: UuidParamSchema, body: body(AddNoteBodySchema) },
    responses: { 200: ok('Note added'), 404: err('Server not found') },
  });

  r.registerPath({ method: 'delete', path: '/api/v1/servers/{id}/profile/notes', summary: 'Remove a note by index', tags: ['Server Profile'], security: sec,
    request: { params: UuidParamSchema, body: body(RemoveNoteBodySchema) },
    responses: { 200: ok('Note removed'), 404: err('Not found') },
  });

  r.registerPath({ method: 'patch', path: '/api/v1/servers/{id}/profile/preferences', summary: 'Update profile preferences', tags: ['Server Profile'], security: sec,
    request: { params: UuidParamSchema, body: body(UpdatePreferencesBodySchema) },
    responses: { 200: { description: 'Preferences updated' } },
  });

  r.registerPath({ method: 'post', path: '/api/v1/servers/{id}/profile/history', summary: 'Record operation in profile history', tags: ['Server Profile'], security: sec,
    request: { params: UuidParamSchema, body: body(RecordOperationBodySchema) },
    responses: { 200: ok('Operation recorded') },
  });

  r.registerPath({ method: 'get', path: '/api/v1/servers/{id}/profile/history', summary: 'Get profile operation history', tags: ['Server Profile'], security: sec,
    request: { params: UuidParamSchema, query: PaginationQuerySchema },
    responses: { 200: { description: 'Paginated history' } },
  });

  r.registerPath({ method: 'put', path: '/api/v1/servers/{id}/profile/summary', summary: 'Set history summary', tags: ['Server Profile'], security: sec,
    request: { params: UuidParamSchema, body: body(SetHistorySummaryBodySchema) },
    responses: { 200: ok('Summary set') },
  });

  r.registerPath({ method: 'get', path: '/api/v1/servers/{id}/profile/summary', summary: 'Get history summary', tags: ['Server Profile'], security: sec,
    request: { params: UuidParamSchema },
    responses: { 200: { description: 'Summary text' } },
  });

  // Snapshots
  r.registerPath({ method: 'get', path: '/api/v1/servers/{serverId}/snapshots', summary: 'List snapshots', tags: ['Snapshots'], security: sec,
    request: { params: ServerIdParamSchema, query: PaginationQuerySchema },
    responses: { 200: { description: 'Paginated snapshot list' } },
  });

  r.registerPath({ method: 'get', path: '/api/v1/servers/{serverId}/snapshots/{snapshotId}', summary: 'Get snapshot details', tags: ['Snapshots'], security: sec,
    request: { params: z.object({ serverId: z.string(), snapshotId: z.string().openapi({ description: 'Snapshot UUID' }) }) },
    responses: { 200: { description: 'Snapshot details' }, 404: err('Not found') },
  });

  r.registerPath({ method: 'delete', path: '/api/v1/servers/{serverId}/snapshots/{snapshotId}', summary: 'Delete a snapshot', tags: ['Snapshots'], security: sec,
    request: { params: z.object({ serverId: z.string(), snapshotId: z.string() }) },
    responses: { 200: ok('Snapshot deleted'), 404: err('Not found') },
  });

  r.registerPath({ method: 'post', path: '/api/v1/servers/{serverId}/snapshots/{snapshotId}/rollback', summary: 'Rollback to snapshot', tags: ['Snapshots'], security: sec,
    request: {
      params: z.object({ serverId: z.string(), snapshotId: z.string() }),
      body: body(z.object({
        clientId: z.string().openapi({ description: 'WebSocket client ID of connected agent' }),
        reason: z.string().optional().openapi({ description: 'Reason for rollback' }),
        timeoutMs: z.number().optional().openapi({ description: 'Timeout in milliseconds' }),
      })),
    },
    responses: { 200: { description: 'Rollback result' }, 404: err('Snapshot not found') },
  });
}

// --------------------------------------------------------------------------
// Chat
// --------------------------------------------------------------------------

function registerChatRoutes(r: OpenAPIRegistry): void {
  r.registerPath({ method: 'post', path: '/api/v1/chat/{serverId}', summary: 'Send message to AI (SSE streaming)', tags: ['Chat'], security: sec,
    description: 'Sends a user message and receives AI-generated response via Server-Sent Events.',
    request: { params: ServerIdParamSchema, body: body(ChatMessageBodySchema) },
    responses: { 200: { description: 'SSE stream with events: message, plan, complete', content: { 'text/event-stream': { schema: z.string() } } }, 404: err('Server not found') },
  });

  r.registerPath({ method: 'post', path: '/api/v1/chat/{serverId}/execute', summary: 'Execute confirmed plan (SSE streaming)', tags: ['Chat'], security: sec,
    description: 'Executes a previously generated plan. Streams step progress and output via SSE.',
    request: { params: ServerIdParamSchema, body: body(ExecutePlanBodySchema) },
    responses: { 200: { description: 'SSE stream with events: step_start, output, step_complete, complete', content: { 'text/event-stream': { schema: z.string() } } }, 404: err('Server or plan not found') },
  });

  r.registerPath({ method: 'get', path: '/api/v1/chat/{serverId}/sessions', summary: 'List chat sessions', tags: ['Chat'], security: sec,
    request: { params: ServerIdParamSchema },
    responses: { 200: { description: 'Session list' } },
  });

  r.registerPath({ method: 'get', path: '/api/v1/chat/{serverId}/sessions/{sessionId}', summary: 'Get session details with messages', tags: ['Chat'], security: sec,
    request: { params: z.object({ serverId: z.string(), sessionId: z.string() }) },
    responses: { 200: { description: 'Session with messages' }, 404: err('Session not found') },
  });

  r.registerPath({ method: 'delete', path: '/api/v1/chat/{serverId}/sessions/{sessionId}', summary: 'Delete a chat session', tags: ['Chat'], security: sec,
    request: { params: z.object({ serverId: z.string(), sessionId: z.string() }) },
    responses: { 200: ok('Session deleted'), 404: err('Session not found') },
  });
}

// --------------------------------------------------------------------------
// Tasks
// --------------------------------------------------------------------------

function registerTaskRoutes(r: OpenAPIRegistry): void {
  r.registerPath({ method: 'get', path: '/api/v1/tasks', summary: 'List scheduled tasks', tags: ['Tasks'], security: sec,
    request: { query: TaskQuerySchema },
    responses: { 200: { description: 'Paginated task list' } },
  });

  r.registerPath({ method: 'post', path: '/api/v1/tasks', summary: 'Create a scheduled task', tags: ['Tasks'], security: sec,
    request: { body: body(CreateTaskBodySchema) },
    responses: { 201: { description: 'Task created' }, 400: err('Validation error') },
  });

  r.registerPath({ method: 'get', path: '/api/v1/tasks/{id}', summary: 'Get task details', tags: ['Tasks'], security: sec,
    request: { params: UuidParamSchema },
    responses: { 200: { description: 'Task details' }, 404: err('Task not found') },
  });

  r.registerPath({ method: 'patch', path: '/api/v1/tasks/{id}', summary: 'Update a task', tags: ['Tasks'], security: sec,
    request: { params: UuidParamSchema, body: body(UpdateTaskBodySchema) },
    responses: { 200: { description: 'Task updated' }, 404: err('Task not found') },
  });

  r.registerPath({ method: 'delete', path: '/api/v1/tasks/{id}', summary: 'Delete a task', tags: ['Tasks'], security: sec,
    request: { params: UuidParamSchema },
    responses: { 200: ok('Task deleted'), 404: err('Task not found') },
  });

  r.registerPath({ method: 'post', path: '/api/v1/tasks/{id}/run', summary: 'Execute task immediately', tags: ['Tasks'], security: sec,
    request: { params: UuidParamSchema },
    responses: {
      200: { description: 'Execution result', content: { 'application/json': { schema: z.object({ success: z.boolean(), exitCode: z.number(), stdout: z.string(), stderr: z.string(), duration: z.number() }) } } },
      404: err('Task not found'), 503: err('Agent offline'),
    },
  });
}

// --------------------------------------------------------------------------
// Alerts & Alert Rules
// --------------------------------------------------------------------------

function registerAlertRoutes(r: OpenAPIRegistry): void {
  r.registerPath({ method: 'get', path: '/api/v1/alerts', summary: 'List alerts', tags: ['Alerts'], security: sec,
    request: { query: AlertQuerySchema },
    responses: { 200: { description: 'Alert list with pagination' } },
  });

  r.registerPath({ method: 'get', path: '/api/v1/alerts/{id}', summary: 'Get alert details', tags: ['Alerts'], security: sec,
    request: { params: UuidParamSchema },
    responses: { 200: { description: 'Alert details' }, 404: err('Alert not found') },
  });

  r.registerPath({ method: 'patch', path: '/api/v1/alerts/{id}/resolve', summary: 'Mark alert as resolved', tags: ['Alerts'], security: sec,
    request: { params: UuidParamSchema },
    responses: { 200: ok('Alert resolved'), 404: err('Alert not found') },
  });

  // Alert Rules
  r.registerPath({ method: 'post', path: '/api/v1/alert-rules', summary: 'Create an alert rule', tags: ['Alert Rules'], security: sec,
    request: { body: body(CreateAlertRuleBodySchema) },
    responses: { 201: { description: 'Rule created' }, 400: err('Validation error') },
  });

  r.registerPath({ method: 'get', path: '/api/v1/alert-rules', summary: 'List alert rules', tags: ['Alert Rules'], security: sec,
    request: { query: AlertRuleQuerySchema },
    responses: { 200: { description: 'Alert rule list' } },
  });

  r.registerPath({ method: 'get', path: '/api/v1/alert-rules/{id}', summary: 'Get alert rule details', tags: ['Alert Rules'], security: sec,
    request: { params: UuidParamSchema },
    responses: { 200: { description: 'Rule details' }, 404: err('Rule not found') },
  });

  r.registerPath({ method: 'patch', path: '/api/v1/alert-rules/{id}', summary: 'Update an alert rule', tags: ['Alert Rules'], security: sec,
    request: { params: UuidParamSchema, body: body(UpdateAlertRuleBodySchema) },
    responses: { 200: { description: 'Rule updated' }, 404: err('Rule not found') },
  });

  r.registerPath({ method: 'delete', path: '/api/v1/alert-rules/{id}', summary: 'Delete an alert rule', tags: ['Alert Rules'], security: sec,
    request: { params: UuidParamSchema },
    responses: { 200: ok('Rule deleted'), 404: err('Rule not found') },
  });
}

// --------------------------------------------------------------------------
// Operations
// --------------------------------------------------------------------------

function registerOperationRoutes(r: OpenAPIRegistry): void {
  r.registerPath({ method: 'get', path: '/api/v1/operations', summary: 'List operations with advanced filtering', tags: ['Operations'], security: sec,
    request: { query: OperationQuerySchema },
    responses: { 200: { description: 'Paginated operation list' } },
  });

  r.registerPath({ method: 'get', path: '/api/v1/operations/stats', summary: 'Get operation statistics', tags: ['Operations'], security: sec,
    request: { query: OperationStatsQuerySchema },
    responses: { 200: { description: 'Operation statistics' } },
  });

  r.registerPath({ method: 'get', path: '/api/v1/operations/{id}', summary: 'Get operation details', tags: ['Operations'], security: sec,
    request: { params: UuidParamSchema },
    responses: { 200: { description: 'Operation details' }, 404: err('Operation not found') },
  });

  r.registerPath({ method: 'post', path: '/api/v1/operations', summary: 'Create an operation record', tags: ['Operations'], security: sec,
    request: { body: body(CreateOperationBodySchema) },
    responses: { 201: { description: 'Operation created' }, 400: err('Validation error') },
  });

  r.registerPath({ method: 'patch', path: '/api/v1/operations/{id}/status', summary: 'Update operation status', tags: ['Operations'], security: sec,
    request: { params: UuidParamSchema, body: body(UpdateOperationStatusBodySchema) },
    responses: { 200: { description: 'Status updated' }, 404: err('Operation not found') },
  });
}

// --------------------------------------------------------------------------
// Agent
// --------------------------------------------------------------------------

function registerAgentRoutes(r: OpenAPIRegistry): void {
  r.registerPath({ method: 'get', path: '/api/v1/agent/version', summary: 'Check for agent updates', tags: ['Agent'],
    request: { query: z.object({
      current: z.string().optional().openapi({ description: 'Current agent version' }),
      platform: z.enum(['darwin', 'linux', 'win32']).optional(),
      arch: z.enum(['x64', 'arm64']).optional(),
    }) },
    responses: { 200: { description: 'Version info', content: { 'application/json': { schema: z.object({
      latest: z.string(), current: z.string(), updateAvailable: z.boolean(), forceUpdate: z.boolean(),
      releaseDate: z.string(), releaseNotes: z.string(), downloadUrl: z.string().optional(), sha256: z.string().optional(), size: z.number().optional(),
    }) } } } },
  });

  r.registerPath({ method: 'get', path: '/api/v1/agent/binaries', summary: 'List all available agent binaries', tags: ['Agent'],
    responses: { 200: { description: 'Binary listing' } },
  });
}

// --------------------------------------------------------------------------
// Knowledge
// --------------------------------------------------------------------------

function registerKnowledgeRoutes(r: OpenAPIRegistry): void {
  r.registerPath({ method: 'post', path: '/api/v1/knowledge/scrape', summary: 'Trigger a documentation scrape', tags: ['Knowledge'], security: sec,
    request: { body: body(ScrapeDocBodySchema) },
    responses: { 200: { description: 'Scrape result' }, 500: { description: 'Scrape failed' } },
  });

  r.registerPath({ method: 'post', path: '/api/v1/knowledge/scrape/builtin', summary: 'Scrape all built-in sources', tags: ['Knowledge'], security: sec,
    responses: { 200: { description: 'Scrape summary' } },
  });

  r.registerPath({ method: 'get', path: '/api/v1/knowledge/sources', summary: 'List documentation sources', tags: ['Knowledge'], security: sec,
    responses: { 200: { description: 'Source list' } },
  });

  r.registerPath({ method: 'get', path: '/api/v1/knowledge/docs', summary: 'List fetched documentation', tags: ['Knowledge'], security: sec,
    responses: { 200: { description: 'Document list' } },
  });

  r.registerPath({ method: 'get', path: '/api/v1/knowledge/tasks', summary: 'List fetch tasks', tags: ['Knowledge'], security: sec,
    responses: { 200: { description: 'Task list' } },
  });

  r.registerPath({ method: 'get', path: '/api/v1/knowledge/tasks/{taskId}', summary: 'Get fetch task details', tags: ['Knowledge'], security: sec,
    request: { params: z.object({ taskId: z.string() }) },
    responses: { 200: { description: 'Task details' }, 404: { description: 'Task not found' } },
  });

  r.registerPath({ method: 'get', path: '/api/v1/knowledge/search', summary: 'Search knowledge base', tags: ['Knowledge'], security: sec,
    request: { query: z.object({ q: z.string().openapi({ description: 'Search query' }), source: z.enum(['builtin', 'auto_learn', 'scrape', 'community']).optional() }) },
    responses: { 200: { description: 'Search results' } },
  });
}

// --------------------------------------------------------------------------
// Doc Sources
// --------------------------------------------------------------------------

function registerDocSourceRoutes(r: OpenAPIRegistry): void {
  r.registerPath({ method: 'get', path: '/api/v1/doc-sources', summary: 'List documentation sources', tags: ['Doc Sources'], security: sec,
    responses: { 200: { description: 'Source list' } },
  });

  r.registerPath({ method: 'post', path: '/api/v1/doc-sources', summary: 'Create a documentation source', tags: ['Doc Sources'], security: sec,
    request: { body: body(z.object({
      name: z.string().min(1).max(100), software: z.string().min(1).max(50), type: z.enum(['github', 'website']),
      githubConfig: z.object({ owner: z.string(), repo: z.string(), branch: z.string().optional(), paths: z.array(z.string()).optional() }).optional(),
      websiteConfig: z.object({ baseUrl: z.string().url(), pages: z.array(z.string().url()).optional() }).optional(),
      enabled: z.boolean().optional(), autoUpdate: z.boolean().optional(), updateFrequencyHours: z.number().optional(),
    })) },
    responses: { 201: { description: 'Source created' }, 400: { description: 'Validation error' } },
  });

  r.registerPath({ method: 'get', path: '/api/v1/doc-sources/{id}', summary: 'Get documentation source', tags: ['Doc Sources'], security: sec,
    request: { params: UuidParamSchema },
    responses: { 200: { description: 'Source details' }, 404: { description: 'Not found' } },
  });

  r.registerPath({ method: 'patch', path: '/api/v1/doc-sources/{id}', summary: 'Update a documentation source', tags: ['Doc Sources'], security: sec,
    request: { params: UuidParamSchema },
    responses: { 200: { description: 'Source updated' }, 404: { description: 'Not found' } },
  });

  r.registerPath({ method: 'delete', path: '/api/v1/doc-sources/{id}', summary: 'Delete a documentation source', tags: ['Doc Sources'], security: sec,
    request: { params: UuidParamSchema },
    responses: { 200: ok('Source deleted'), 404: { description: 'Not found' } },
  });

  r.registerPath({ method: 'post', path: '/api/v1/doc-sources/{id}/fetch', summary: 'Trigger manual fetch', tags: ['Doc Sources'], security: sec,
    request: { params: UuidParamSchema },
    responses: { 200: { description: 'Fetch result' }, 404: { description: 'Not found' } },
  });

  r.registerPath({ method: 'get', path: '/api/v1/doc-sources/{id}/status', summary: 'Get fetch status', tags: ['Doc Sources'], security: sec,
    request: { params: UuidParamSchema },
    responses: { 200: { description: 'Fetch status and history' }, 404: { description: 'Not found' } },
  });
}

// --------------------------------------------------------------------------
// Settings
// --------------------------------------------------------------------------

function registerSettingsRoutes(r: OpenAPIRegistry): void {
  r.registerPath({ method: 'get', path: '/api/v1/settings', summary: 'Get user settings', tags: ['Settings'], security: sec,
    responses: { 200: { description: 'User settings (AI provider, profile, notifications, knowledge base)' } },
  });

  r.registerPath({ method: 'put', path: '/api/v1/settings/ai-provider', summary: 'Update AI provider configuration', tags: ['Settings'], security: sec,
    request: { body: body(UpdateAIProviderBodySchema) },
    responses: { 200: { description: 'Settings updated (returns full settings)' } },
  });

  r.registerPath({ method: 'put', path: '/api/v1/settings/profile', summary: 'Update user profile', tags: ['Settings'], security: sec,
    request: { body: body(UpdateUserProfileBodySchema) },
    responses: { 200: { description: 'Settings updated (returns full settings)' } },
  });

  r.registerPath({ method: 'put', path: '/api/v1/settings/notifications', summary: 'Update notification preferences', tags: ['Settings'], security: sec,
    request: { body: body(UpdateNotificationsBodySchema) },
    responses: { 200: { description: 'Settings updated (returns full settings)' } },
  });

  r.registerPath({ method: 'put', path: '/api/v1/settings/knowledge-base', summary: 'Update knowledge base settings', tags: ['Settings'], security: sec,
    request: { body: body(UpdateKnowledgeBaseBodySchema) },
    responses: { 200: { description: 'Settings updated (returns full settings)' } },
  });
}

// --------------------------------------------------------------------------
// Metrics
// --------------------------------------------------------------------------

function registerMetricsRoutes(r: OpenAPIRegistry): void {
  r.registerPath({ method: 'get', path: '/api/v1/metrics', summary: 'Get metrics by time range', tags: ['Metrics'], security: sec,
    request: { query: z.object({ serverId: z.string().openapi({ description: 'Server ID (required)' }), range: z.enum(['1h', '24h', '7d']).default('24h') }) },
    responses: { 200: { description: 'Metrics data points' } },
  });

  r.registerPath({ method: 'get', path: '/api/v1/metrics/latest', summary: 'Get latest metric point', tags: ['Metrics'], security: sec,
    request: { query: z.object({ serverId: z.string().openapi({ description: 'Server ID (required)' }) }) },
    responses: { 200: { description: 'Latest metric point or null' } },
  });

  r.registerPath({ method: 'get', path: '/api/v1/metrics/aggregated', summary: 'Get aggregated metrics', tags: ['Metrics'], security: sec,
    description: 'Returns pre-computed hourly/daily aggregates with avg, min, max per bucket.',
    request: { query: z.object({ serverId: z.string(), range: z.enum(['1h', '24h', '7d']).default('24h') }) },
    responses: { 200: { description: 'Aggregated metric buckets' } },
  });
}

// --------------------------------------------------------------------------
// System
// --------------------------------------------------------------------------

function registerSystemRoutes(r: OpenAPIRegistry): void {
  r.registerPath({ method: 'get', path: '/health', summary: 'Health check', tags: ['System'],
    responses: { 200: { description: 'Service is healthy', content: { 'application/json': { schema: z.object({ status: z.literal('ok'), timestamp: z.number() }) } } } },
  });
}
