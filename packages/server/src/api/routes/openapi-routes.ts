/**
 * OpenAPI route definitions — core modules (Auth, Servers, Chat, Tasks, Alerts).
 *
 * Registers path definitions into an OpenAPIRegistry with full
 * response schemas and examples. Extra modules live in
 * openapi-routes-extra.ts.
 *
 * @module api/routes/openapi-routes
 */

import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';

extendZodWithOpenApi(z);

import {
  LoginBodySchema, RegisterBodySchema, RefreshTokenBodySchema,
  CreateServerBodySchema, UpdateServerBodySchema, ServerMetricsQuerySchema,
  AddNoteBodySchema, RemoveNoteBodySchema, UpdatePreferencesBodySchema,
  SetHistorySummaryBodySchema, RecordOperationBodySchema, PaginationQuerySchema,
  OperationQuerySchema, ChatMessageBodySchema, ExecutePlanBodySchema,
  CreateTaskBodySchema, UpdateTaskBodySchema, TaskQuerySchema,
  AlertQuerySchema, CreateAlertRuleBodySchema, UpdateAlertRuleBodySchema,
  AlertRuleQuerySchema,
} from './schemas.js';

import {
  err, ok, body, json, sec,
  UuidParamSchema, ServerIdParamSchema,
  AuthResponseSchema, TokenResponseSchema,
  ServerListResponseSchema, ServerResponseSchema, ServerCreatedResponseSchema,
  ProfileResponseSchema, MetricsResponseSchema, HistoryResponseSchema, SummaryResponseSchema,
  SnapshotListResponseSchema, SnapshotResponseSchema, SuccessResponseSchema,
  SessionListResponseSchema, SessionDetailResponseSchema,
  TaskListResponseSchema, TaskResponseSchema, TaskRunResponseSchema,
  AlertListResponseSchema, AlertResponseSchema, AlertResolvedResponseSchema,
  AlertRuleListResponseSchema, AlertRuleResponseSchema,
  OperationListResponseSchema,
} from './openapi-schemas.js';

import { registerExtraRoutes } from './openapi-routes-extra.js';

// ============================================================================
// Route registration
// ============================================================================

export function registerAllRoutes(registry: OpenAPIRegistry): void {
  registerAuthRoutes(registry);
  registerServerRoutes(registry);
  registerChatRoutes(registry);
  registerTaskRoutes(registry);
  registerAlertRoutes(registry);
  registerExtraRoutes(registry);
}

// --------------------------------------------------------------------------
// Auth
// --------------------------------------------------------------------------

function registerAuthRoutes(r: OpenAPIRegistry): void {
  r.registerPath({
    method: 'post', path: '/api/v1/auth/register',
    summary: 'Register a new user', tags: ['Auth'],
    description: 'Creates a new user account and returns JWT tokens.',
    request: { body: body(RegisterBodySchema) },
    responses: {
      201: json('Registration successful', AuthResponseSchema),
      400: err('Validation error'),
    },
  });

  r.registerPath({
    method: 'post', path: '/api/v1/auth/login',
    summary: 'Login with email and password', tags: ['Auth'],
    description: 'Authenticates a user and returns JWT access and refresh tokens.',
    request: { body: body(LoginBodySchema) },
    responses: {
      200: json('Login successful', AuthResponseSchema),
      401: err('Invalid credentials'),
    },
  });

  r.registerPath({
    method: 'post', path: '/api/v1/auth/refresh',
    summary: 'Refresh access token', tags: ['Auth'],
    description: 'Exchanges a valid refresh token for a new token pair.',
    request: { body: body(RefreshTokenBodySchema) },
    responses: {
      200: json('Token refreshed', TokenResponseSchema),
      401: err('Invalid refresh token'),
    },
  });

  r.registerPath({
    method: 'post', path: '/api/v1/auth/logout',
    summary: 'Logout (stateless)', tags: ['Auth'],
    description: 'Acknowledges logout. Tokens should be discarded client-side.',
    responses: {
      200: json('Logout acknowledged', z.object({ message: z.string().openapi({ example: 'Logged out successfully' }) })),
    },
  });
}

// --------------------------------------------------------------------------
// Servers
// --------------------------------------------------------------------------

function registerServerRoutes(r: OpenAPIRegistry): void {
  r.registerPath({
    method: 'get', path: '/api/v1/servers',
    summary: 'List all servers', tags: ['Servers'], security: sec,
    responses: { 200: json('Server list', ServerListResponseSchema), 401: err('Unauthorized') },
  });

  r.registerPath({
    method: 'post', path: '/api/v1/servers',
    summary: 'Create a new server', tags: ['Servers'], security: sec,
    description: 'Creates a server and returns it with a one-time agentToken for agent registration.',
    request: { body: body(CreateServerBodySchema) },
    responses: { 201: json('Server created (includes agentToken)', ServerCreatedResponseSchema), 400: err('Validation error') },
  });

  r.registerPath({
    method: 'get', path: '/api/v1/servers/{id}',
    summary: 'Get server details', tags: ['Servers'], security: sec,
    request: { params: UuidParamSchema },
    responses: { 200: json('Server details', ServerResponseSchema), 404: err('Server not found') },
  });

  r.registerPath({
    method: 'patch', path: '/api/v1/servers/{id}',
    summary: 'Update server info', tags: ['Servers'], security: sec,
    request: { params: UuidParamSchema, body: body(UpdateServerBodySchema) },
    responses: { 200: json('Server updated', ServerResponseSchema), 404: err('Server not found') },
  });

  r.registerPath({
    method: 'delete', path: '/api/v1/servers/{id}',
    summary: 'Delete a server', tags: ['Servers'], security: sec,
    request: { params: UuidParamSchema },
    responses: { 200: ok('Server deleted'), 404: err('Server not found') },
  });

  // Profile sub-routes
  r.registerPath({
    method: 'get', path: '/api/v1/servers/{id}/profile',
    summary: 'Get server profile', tags: ['Server Profile'], security: sec,
    request: { params: UuidParamSchema },
    responses: { 200: json('Server profile data', ProfileResponseSchema), 404: err('Server not found') },
  });

  r.registerPath({
    method: 'get', path: '/api/v1/servers/{id}/metrics',
    summary: 'Get server monitoring metrics', tags: ['Server Profile'], security: sec,
    request: { params: UuidParamSchema, query: ServerMetricsQuerySchema },
    responses: { 200: json('Metrics data with time range', MetricsResponseSchema), 404: err('Server not found') },
  });

  r.registerPath({
    method: 'get', path: '/api/v1/servers/{id}/operations',
    summary: 'Get server operation history', tags: ['Server Profile'], security: sec,
    request: { params: UuidParamSchema, query: OperationQuerySchema },
    responses: { 200: json('Operation history', OperationListResponseSchema) },
  });

  r.registerPath({
    method: 'post', path: '/api/v1/servers/{id}/profile/notes',
    summary: 'Add a note to server profile', tags: ['Server Profile'], security: sec,
    request: { params: UuidParamSchema, body: body(AddNoteBodySchema) },
    responses: { 200: ok('Note added'), 404: err('Server not found') },
  });

  r.registerPath({
    method: 'delete', path: '/api/v1/servers/{id}/profile/notes',
    summary: 'Remove a note by index', tags: ['Server Profile'], security: sec,
    request: { params: UuidParamSchema, body: body(RemoveNoteBodySchema) },
    responses: { 200: ok('Note removed'), 404: err('Not found') },
  });

  r.registerPath({
    method: 'patch', path: '/api/v1/servers/{id}/profile/preferences',
    summary: 'Update profile preferences', tags: ['Server Profile'], security: sec,
    request: { params: UuidParamSchema, body: body(UpdatePreferencesBodySchema) },
    responses: { 200: json('Preferences updated', z.object({ preferences: z.record(z.string()).nullable() })) },
  });

  r.registerPath({
    method: 'post', path: '/api/v1/servers/{id}/profile/history',
    summary: 'Record operation in profile history', tags: ['Server Profile'], security: sec,
    request: { params: UuidParamSchema, body: body(RecordOperationBodySchema) },
    responses: { 200: ok('Operation recorded') },
  });

  r.registerPath({
    method: 'get', path: '/api/v1/servers/{id}/profile/history',
    summary: 'Get profile operation history', tags: ['Server Profile'], security: sec,
    request: { params: UuidParamSchema, query: PaginationQuerySchema },
    responses: { 200: json('Paginated history', HistoryResponseSchema) },
  });

  r.registerPath({
    method: 'put', path: '/api/v1/servers/{id}/profile/summary',
    summary: 'Set history summary', tags: ['Server Profile'], security: sec,
    request: { params: UuidParamSchema, body: body(SetHistorySummaryBodySchema) },
    responses: { 200: ok('Summary set') },
  });

  r.registerPath({
    method: 'get', path: '/api/v1/servers/{id}/profile/summary',
    summary: 'Get history summary', tags: ['Server Profile'], security: sec,
    request: { params: UuidParamSchema },
    responses: { 200: json('Summary text', SummaryResponseSchema) },
  });

  // Snapshots
  r.registerPath({
    method: 'get', path: '/api/v1/servers/{serverId}/snapshots',
    summary: 'List snapshots', tags: ['Snapshots'], security: sec,
    request: { params: ServerIdParamSchema, query: PaginationQuerySchema },
    responses: { 200: json('Paginated snapshot list', SnapshotListResponseSchema) },
  });

  r.registerPath({
    method: 'get', path: '/api/v1/servers/{serverId}/snapshots/{snapshotId}',
    summary: 'Get snapshot details', tags: ['Snapshots'], security: sec,
    request: { params: z.object({ serverId: z.string(), snapshotId: z.string().openapi({ description: 'Snapshot UUID' }) }) },
    responses: { 200: json('Snapshot details', SnapshotResponseSchema), 404: err('Not found') },
  });

  r.registerPath({
    method: 'delete', path: '/api/v1/servers/{serverId}/snapshots/{snapshotId}',
    summary: 'Delete a snapshot', tags: ['Snapshots'], security: sec,
    request: { params: z.object({ serverId: z.string(), snapshotId: z.string() }) },
    responses: { 200: ok('Snapshot deleted'), 404: err('Not found') },
  });

  r.registerPath({
    method: 'post', path: '/api/v1/servers/{serverId}/snapshots/{snapshotId}/rollback',
    summary: 'Rollback to snapshot', tags: ['Snapshots'], security: sec,
    request: {
      params: z.object({ serverId: z.string(), snapshotId: z.string() }),
      body: body(z.object({
        clientId: z.string().openapi({ description: 'WebSocket client ID of connected agent', example: 'ws-abc123' }),
        reason: z.string().optional().openapi({ description: 'Reason for rollback', example: 'Config change broke nginx' }),
        timeoutMs: z.number().optional().openapi({ description: 'Timeout in milliseconds', example: 30000 }),
      })),
    },
    responses: { 200: json('Rollback result', SuccessResponseSchema), 404: err('Snapshot not found') },
  });
}

// --------------------------------------------------------------------------
// Chat
// --------------------------------------------------------------------------

function registerChatRoutes(r: OpenAPIRegistry): void {
  r.registerPath({
    method: 'post', path: '/api/v1/chat/{serverId}',
    summary: 'Send message to AI (SSE streaming)', tags: ['Chat'], security: sec,
    description: 'Sends a user message and receives AI-generated response via Server-Sent Events. Events: message (streaming tokens), plan (generated plan), complete.',
    request: { params: ServerIdParamSchema, body: body(ChatMessageBodySchema) },
    responses: {
      200: { description: 'SSE stream with events: message, plan, complete', content: { 'text/event-stream': { schema: z.string() } } },
      404: err('Server not found'),
    },
  });

  r.registerPath({
    method: 'post', path: '/api/v1/chat/{serverId}/execute',
    summary: 'Execute confirmed plan (SSE streaming)', tags: ['Chat'], security: sec,
    description: 'Executes a previously generated plan. Streams step progress and output via SSE. Events: step_start, output, step_complete, complete.',
    request: { params: ServerIdParamSchema, body: body(ExecutePlanBodySchema) },
    responses: {
      200: { description: 'SSE stream with events: step_start, output, step_complete, complete', content: { 'text/event-stream': { schema: z.string() } } },
      404: err('Server or plan not found'),
    },
  });

  r.registerPath({
    method: 'get', path: '/api/v1/chat/{serverId}/sessions',
    summary: 'List chat sessions', tags: ['Chat'], security: sec,
    request: { params: ServerIdParamSchema },
    responses: { 200: json('Session list', SessionListResponseSchema) },
  });

  r.registerPath({
    method: 'get', path: '/api/v1/chat/{serverId}/sessions/{sessionId}',
    summary: 'Get session details with messages', tags: ['Chat'], security: sec,
    request: { params: z.object({ serverId: z.string(), sessionId: z.string() }) },
    responses: { 200: json('Session with messages', SessionDetailResponseSchema), 404: err('Session not found') },
  });

  r.registerPath({
    method: 'delete', path: '/api/v1/chat/{serverId}/sessions/{sessionId}',
    summary: 'Delete a chat session', tags: ['Chat'], security: sec,
    request: { params: z.object({ serverId: z.string(), sessionId: z.string() }) },
    responses: { 200: ok('Session deleted'), 404: err('Session not found') },
  });
}

// --------------------------------------------------------------------------
// Tasks
// --------------------------------------------------------------------------

function registerTaskRoutes(r: OpenAPIRegistry): void {
  r.registerPath({
    method: 'get', path: '/api/v1/tasks',
    summary: 'List scheduled tasks', tags: ['Tasks'], security: sec,
    request: { query: TaskQuerySchema },
    responses: { 200: json('Paginated task list', TaskListResponseSchema) },
  });

  r.registerPath({
    method: 'post', path: '/api/v1/tasks',
    summary: 'Create a scheduled task', tags: ['Tasks'], security: sec,
    request: { body: body(CreateTaskBodySchema) },
    responses: { 201: json('Task created', TaskResponseSchema), 400: err('Validation error') },
  });

  r.registerPath({
    method: 'get', path: '/api/v1/tasks/{id}',
    summary: 'Get task details', tags: ['Tasks'], security: sec,
    request: { params: UuidParamSchema },
    responses: { 200: json('Task details', TaskResponseSchema), 404: err('Task not found') },
  });

  r.registerPath({
    method: 'patch', path: '/api/v1/tasks/{id}',
    summary: 'Update a task', tags: ['Tasks'], security: sec,
    request: { params: UuidParamSchema, body: body(UpdateTaskBodySchema) },
    responses: { 200: json('Task updated', TaskResponseSchema), 404: err('Task not found') },
  });

  r.registerPath({
    method: 'delete', path: '/api/v1/tasks/{id}',
    summary: 'Delete a task', tags: ['Tasks'], security: sec,
    request: { params: UuidParamSchema },
    responses: { 200: ok('Task deleted'), 404: err('Task not found') },
  });

  r.registerPath({
    method: 'post', path: '/api/v1/tasks/{id}/run',
    summary: 'Execute task immediately', tags: ['Tasks'], security: sec,
    description: 'Triggers immediate execution of a scheduled task on the connected agent.',
    request: { params: UuidParamSchema },
    responses: {
      200: json('Execution result', TaskRunResponseSchema),
      404: err('Task not found'),
      503: err('Agent offline'),
    },
  });
}

// --------------------------------------------------------------------------
// Alerts & Alert Rules
// --------------------------------------------------------------------------

function registerAlertRoutes(r: OpenAPIRegistry): void {
  r.registerPath({
    method: 'get', path: '/api/v1/alerts',
    summary: 'List alerts', tags: ['Alerts'], security: sec,
    request: { query: AlertQuerySchema },
    responses: { 200: json('Alert list with pagination', AlertListResponseSchema) },
  });

  r.registerPath({
    method: 'get', path: '/api/v1/alerts/{id}',
    summary: 'Get alert details', tags: ['Alerts'], security: sec,
    request: { params: UuidParamSchema },
    responses: { 200: json('Alert details', AlertResponseSchema), 404: err('Alert not found') },
  });

  r.registerPath({
    method: 'patch', path: '/api/v1/alerts/{id}/resolve',
    summary: 'Mark alert as resolved', tags: ['Alerts'], security: sec,
    request: { params: UuidParamSchema },
    responses: { 200: json('Alert resolved', AlertResolvedResponseSchema), 404: err('Alert not found') },
  });

  // Alert Rules
  r.registerPath({
    method: 'post', path: '/api/v1/alert-rules',
    summary: 'Create an alert rule', tags: ['Alert Rules'], security: sec,
    request: { body: body(CreateAlertRuleBodySchema) },
    responses: { 201: json('Rule created', AlertRuleResponseSchema), 400: err('Validation error') },
  });

  r.registerPath({
    method: 'get', path: '/api/v1/alert-rules',
    summary: 'List alert rules', tags: ['Alert Rules'], security: sec,
    request: { query: AlertRuleQuerySchema },
    responses: { 200: json('Alert rule list', AlertRuleListResponseSchema) },
  });

  r.registerPath({
    method: 'get', path: '/api/v1/alert-rules/{id}',
    summary: 'Get alert rule details', tags: ['Alert Rules'], security: sec,
    request: { params: UuidParamSchema },
    responses: { 200: json('Rule details', AlertRuleResponseSchema), 404: err('Rule not found') },
  });

  r.registerPath({
    method: 'patch', path: '/api/v1/alert-rules/{id}',
    summary: 'Update an alert rule', tags: ['Alert Rules'], security: sec,
    request: { params: UuidParamSchema, body: body(UpdateAlertRuleBodySchema) },
    responses: { 200: json('Rule updated', AlertRuleResponseSchema), 404: err('Rule not found') },
  });

  r.registerPath({
    method: 'delete', path: '/api/v1/alert-rules/{id}',
    summary: 'Delete an alert rule', tags: ['Alert Rules'], security: sec,
    request: { params: UuidParamSchema },
    responses: { 200: ok('Rule deleted'), 404: err('Rule not found') },
  });
}
