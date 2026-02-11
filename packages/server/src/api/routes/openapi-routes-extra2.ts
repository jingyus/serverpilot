// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * OpenAPI route definitions — additional modules.
 *
 * GitHub OAuth, Audit Log, Webhooks, Team/Members, and missing endpoints
 * from earlier registrations (chat cancel, settings health, metrics SSE).
 * Split from openapi-routes-extra.ts to stay within the 500-line file limit.
 *
 * @module api/routes/openapi-routes-extra2
 */

import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';

extendZodWithOpenApi(z);

import {
  CancelExecutionBodySchema,
  CreateWebhookBodySchema, UpdateWebhookBodySchema,
  WebhookQuerySchema, WebhookTestBodySchema,
  CreateInvitationBodySchema, AcceptInvitationBodySchema,
} from './schemas.js';

import {
  err, ok, body, json, sec,
  UuidParamSchema, ServerIdParamSchema,
  SuccessResponseSchema, AuthResponseSchema,
  AuditLogListResponseSchema,
  WebhookListResponseSchema, WebhookResponseSchema,
  WebhookDeliveryListResponseSchema,
  MemberListResponseSchema,
  InvitationListResponseSchema, InvitationResponseSchema,
  InvitationInfoResponseSchema,
  AIProviderHealthResponseSchema,
  MetricPointSchema,
} from './openapi-schemas.js';

// ============================================================================
// Registration entry-point
// ============================================================================

export function registerExtra2Routes(registry: OpenAPIRegistry): void {
  registerGitHubOAuthRoutes(registry);
  registerChatExtraRoutes(registry);
  registerSettingsExtraRoutes(registry);
  registerMetricsExtraRoutes(registry);
  registerAuditLogRoutes(registry);
  registerWebhookRoutes(registry);
  registerMemberRoutes(registry);
  registerTeamRoutes(registry);
}

// --------------------------------------------------------------------------
// GitHub OAuth
// --------------------------------------------------------------------------

function registerGitHubOAuthRoutes(r: OpenAPIRegistry): void {
  r.registerPath({
    method: 'get', path: '/api/v1/auth/github',
    summary: 'Start GitHub OAuth flow', tags: ['Auth'],
    description: 'Redirects the user to GitHub authorization page. Requires GITHUB_OAUTH_CLIENT_ID and GITHUB_OAUTH_CLIENT_SECRET env vars to be configured.',
    responses: {
      302: { description: 'Redirect to GitHub authorization URL' },
      400: err('GitHub OAuth is not configured'),
    },
  });

  r.registerPath({
    method: 'get', path: '/api/v1/auth/github/callback',
    summary: 'GitHub OAuth callback', tags: ['Auth'],
    description: 'Handles the OAuth callback from GitHub. Exchanges the authorization code for tokens, creates or links the user account, and redirects to the dashboard with auth tokens in the URL hash fragment.',
    request: {
      query: z.object({
        code: z.string().optional().openapi({ description: 'Authorization code from GitHub' }),
        state: z.string().optional().openapi({ description: 'CSRF state parameter' }),
        error: z.string().optional().openapi({ description: 'Error code from GitHub' }),
      }),
    },
    responses: {
      302: { description: 'Redirect to dashboard with tokens in hash fragment (success) or error message (failure)' },
    },
  });
}

// --------------------------------------------------------------------------
// Chat — cancel execution (missing from openapi-routes.ts)
// --------------------------------------------------------------------------

function registerChatExtraRoutes(r: OpenAPIRegistry): void {
  r.registerPath({
    method: 'post', path: '/api/v1/chat/{serverId}/execute/cancel',
    summary: 'Cancel ongoing plan execution', tags: ['Chat'], security: sec,
    description: 'Cancels an active plan execution. The agent will stop processing remaining steps.',
    request: {
      params: ServerIdParamSchema,
      body: body(CancelExecutionBodySchema),
    },
    responses: {
      200: ok('Execution cancelled'),
      404: err('Execution not found or already completed'),
    },
  });
}

// --------------------------------------------------------------------------
// Settings — AI provider health (missing from openapi-routes-extra.ts)
// --------------------------------------------------------------------------

function registerSettingsExtraRoutes(r: OpenAPIRegistry): void {
  r.registerPath({
    method: 'get', path: '/api/v1/settings/ai-provider/health',
    summary: 'Check AI provider availability', tags: ['Settings'], security: sec,
    description: 'Verifies the configured AI provider is reachable and returns its status, model info, and response time.',
    responses: {
      200: json('Provider health status', AIProviderHealthResponseSchema),
      503: err('Provider unavailable'),
    },
  });
}

// --------------------------------------------------------------------------
// Metrics — SSE stream (missing from openapi-routes-extra.ts)
// --------------------------------------------------------------------------

function registerMetricsExtraRoutes(r: OpenAPIRegistry): void {
  r.registerPath({
    method: 'get', path: '/api/v1/metrics/stream',
    summary: 'Real-time metrics SSE stream', tags: ['Metrics'], security: sec,
    description: 'Server-Sent Events stream that pushes real-time metric data points as they arrive from the agent heartbeat. Events: connected (initial), metric (new data point).',
    request: {
      query: z.object({
        serverId: z.string().openapi({ description: 'Server ID (required)', example: '550e8400-e29b-41d4-a716-446655440000' }),
      }),
    },
    responses: {
      200: {
        description: 'SSE stream with events: connected, metric',
        content: { 'text/event-stream': { schema: z.string() } },
      },
      400: err('Missing serverId'),
      404: err('Server not found'),
    },
  });
}

// --------------------------------------------------------------------------
// Audit Log
// --------------------------------------------------------------------------

function registerAuditLogRoutes(r: OpenAPIRegistry): void {
  r.registerPath({
    method: 'get', path: '/api/v1/audit-log',
    summary: 'Query audit logs', tags: ['Audit Log'], security: sec,
    description: 'Returns paginated audit log entries with filtering by server, risk level, action, and date range.',
    request: {
      query: z.object({
        limit: z.coerce.number().default(50).openapi({ example: 50 }),
        offset: z.coerce.number().default(0).openapi({ example: 0 }),
        serverId: z.string().optional().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }),
        riskLevel: z.enum(['green', 'yellow', 'red', 'critical', 'forbidden']).optional().openapi({ example: 'red' }),
        action: z.enum(['allowed', 'blocked', 'requires_confirmation']).optional().openapi({ example: 'blocked' }),
        startDate: z.string().optional().openapi({ example: '2026-02-01T00:00:00Z' }),
        endDate: z.string().optional().openapi({ example: '2026-02-11T23:59:59Z' }),
      }),
    },
    responses: { 200: json('Paginated audit log entries', AuditLogListResponseSchema) },
  });

  r.registerPath({
    method: 'get', path: '/api/v1/audit-log/export',
    summary: 'Export audit logs as CSV', tags: ['Audit Log'], security: sec,
    description: 'Streams audit log entries as a CSV file. Requires admin or owner role. Supports filtering by date range, server, and risk level.',
    request: {
      query: z.object({
        format: z.enum(['csv']).default('csv').openapi({ example: 'csv' }),
        from: z.string().optional().openapi({ example: '2026-02-01T00:00:00Z' }),
        to: z.string().optional().openapi({ example: '2026-02-11T23:59:59Z' }),
        serverId: z.string().optional().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }),
        riskLevel: z.enum(['green', 'yellow', 'red', 'critical', 'forbidden']).optional().openapi({ example: 'red' }),
      }),
    },
    responses: {
      200: {
        description: 'CSV file stream with BOM for Excel compatibility',
        content: { 'text/csv': { schema: z.string() } },
      },
    },
  });
}

// --------------------------------------------------------------------------
// Webhooks
// --------------------------------------------------------------------------

function registerWebhookRoutes(r: OpenAPIRegistry): void {
  r.registerPath({
    method: 'get', path: '/api/v1/webhooks',
    summary: 'List webhooks', tags: ['Webhooks'], security: sec,
    description: 'Returns all webhooks for the authenticated user. Secrets are masked in the response.',
    request: { query: WebhookQuerySchema },
    responses: { 200: json('Webhook list (secrets masked)', WebhookListResponseSchema) },
  });

  r.registerPath({
    method: 'post', path: '/api/v1/webhooks',
    summary: 'Create a webhook', tags: ['Webhooks'], security: sec,
    description: 'Creates a new webhook endpoint. If no secret is provided, a random one is generated.',
    request: { body: body(CreateWebhookBodySchema) },
    responses: { 201: json('Webhook created', WebhookResponseSchema), 400: err('Validation error') },
  });

  r.registerPath({
    method: 'get', path: '/api/v1/webhooks/{id}',
    summary: 'Get webhook details', tags: ['Webhooks'], security: sec,
    request: { params: UuidParamSchema },
    responses: { 200: json('Webhook details', WebhookResponseSchema), 404: err('Webhook not found') },
  });

  r.registerPath({
    method: 'patch', path: '/api/v1/webhooks/{id}',
    summary: 'Update a webhook', tags: ['Webhooks'], security: sec,
    request: { params: UuidParamSchema, body: body(UpdateWebhookBodySchema) },
    responses: { 200: json('Webhook updated', WebhookResponseSchema), 404: err('Webhook not found') },
  });

  r.registerPath({
    method: 'delete', path: '/api/v1/webhooks/{id}',
    summary: 'Delete a webhook', tags: ['Webhooks'], security: sec,
    request: { params: UuidParamSchema },
    responses: { 200: ok('Webhook deleted'), 404: err('Webhook not found') },
  });

  r.registerPath({
    method: 'post', path: '/api/v1/webhooks/{id}/test',
    summary: 'Send a test webhook event', tags: ['Webhooks'], security: sec,
    description: 'Dispatches a test event to the webhook endpoint to verify it is reachable.',
    request: { params: UuidParamSchema, body: body(WebhookTestBodySchema) },
    responses: {
      200: json('Test event dispatched', z.object({
        success: z.boolean().openapi({ example: true }),
        message: z.string().openapi({ example: 'Test event dispatched' }),
      })),
      404: err('Webhook not found'),
    },
  });

  r.registerPath({
    method: 'get', path: '/api/v1/webhooks/{id}/deliveries',
    summary: 'List webhook delivery history', tags: ['Webhooks'], security: sec,
    description: 'Returns delivery attempts for a webhook, including status codes and errors.',
    request: { params: UuidParamSchema, query: WebhookQuerySchema },
    responses: { 200: json('Delivery history', WebhookDeliveryListResponseSchema), 404: err('Webhook not found') },
  });
}

// --------------------------------------------------------------------------
// Members (legacy /members routes)
// --------------------------------------------------------------------------

function registerMemberRoutes(r: OpenAPIRegistry): void {
  r.registerPath({
    method: 'get', path: '/api/v1/members',
    summary: 'List tenant members', tags: ['Members'], security: sec,
    responses: { 200: json('Member list', MemberListResponseSchema) },
  });

  r.registerPath({
    method: 'patch', path: '/api/v1/members/{userId}/role',
    summary: 'Update member role', tags: ['Members'], security: sec,
    description: 'Changes a member\'s role. Cannot change your own role or the owner\'s role.',
    request: {
      params: z.object({ userId: z.string().openapi({ description: 'Target user UUID' }) }),
      body: body(z.object({
        role: z.enum(['admin', 'member']).openapi({ example: 'admin' }),
      })),
    },
    responses: {
      200: json('Role updated', z.object({
        success: z.boolean().openapi({ example: true }),
        role: z.string().openapi({ example: 'admin' }),
      })),
      400: err('Cannot change own role'),
      403: err('Cannot change owner role'),
      404: err('Member not found'),
    },
  });

  r.registerPath({
    method: 'delete', path: '/api/v1/members/{userId}',
    summary: 'Remove member from tenant', tags: ['Members'], security: sec,
    description: 'Removes a member from the tenant. Cannot remove yourself or the owner.',
    request: { params: z.object({ userId: z.string().openapi({ description: 'Target user UUID' }) }) },
    responses: {
      200: ok('Member removed'),
      400: err('Cannot remove yourself'),
      403: err('Cannot remove owner'),
      404: err('Member not found'),
    },
  });
}

// --------------------------------------------------------------------------
// Team (invitations + team members)
// --------------------------------------------------------------------------

function registerTeamRoutes(r: OpenAPIRegistry): void {
  // Authenticated routes
  r.registerPath({
    method: 'post', path: '/api/v1/team/invite',
    summary: 'Create team invitation', tags: ['Team'], security: sec,
    description: 'Sends an invitation to join the team. The invitee receives a unique token link. Invitation expires in 7 days.',
    request: { body: body(CreateInvitationBodySchema) },
    responses: {
      201: json('Invitation created', InvitationResponseSchema),
      400: err('Invalid email, already a member, or pending invitation exists'),
    },
  });

  r.registerPath({
    method: 'get', path: '/api/v1/team/invitations',
    summary: 'List team invitations', tags: ['Team'], security: sec,
    description: 'Returns all invitations for the current tenant. Expired invitations are automatically marked.',
    responses: { 200: json('Invitation list', InvitationListResponseSchema) },
  });

  r.registerPath({
    method: 'delete', path: '/api/v1/team/invitations/{id}',
    summary: 'Cancel an invitation', tags: ['Team'], security: sec,
    description: 'Revokes a pending invitation. Only pending invitations can be cancelled.',
    request: { params: UuidParamSchema },
    responses: {
      200: ok('Invitation cancelled'),
      400: err('Can only cancel pending invitations'),
      404: err('Invitation not found'),
    },
  });

  r.registerPath({
    method: 'get', path: '/api/v1/team/members',
    summary: 'List team members', tags: ['Team'], security: sec,
    responses: { 200: json('Member list', MemberListResponseSchema) },
  });

  r.registerPath({
    method: 'put', path: '/api/v1/team/members/{id}/role',
    summary: 'Update team member role', tags: ['Team'], security: sec,
    description: 'Changes a team member\'s role. Cannot change your own role or the owner\'s role. Role must be "admin" or "member".',
    request: {
      params: UuidParamSchema,
      body: body(z.object({
        role: z.enum(['admin', 'member']).openapi({ example: 'admin' }),
      })),
    },
    responses: {
      200: json('Role updated', z.object({
        success: z.boolean().openapi({ example: true }),
        role: z.string().openapi({ example: 'admin' }),
      })),
      400: err('Cannot change own role'),
      403: err('Cannot change owner role'),
      404: err('Member not found'),
    },
  });

  r.registerPath({
    method: 'delete', path: '/api/v1/team/members/{id}',
    summary: 'Remove team member', tags: ['Team'], security: sec,
    description: 'Removes a member from the team. Cannot remove yourself, the owner, or (as admin) other admins.',
    request: { params: UuidParamSchema },
    responses: {
      200: ok('Member removed'),
      400: err('Cannot remove yourself'),
      403: err('Cannot remove owner / insufficient permissions'),
      404: err('Member not found'),
    },
  });

  // Public routes (no auth)
  r.registerPath({
    method: 'get', path: '/api/v1/team/invite/{token}',
    summary: 'Get invitation details (public)', tags: ['Team'],
    description: 'Returns limited invitation info for the accept page. No authentication required. Returns email, role, and expiry.',
    request: {
      params: z.object({ token: z.string().openapi({ description: 'Invitation token (64-char hex)' }) }),
    },
    responses: {
      200: json('Invitation info', InvitationInfoResponseSchema),
      400: err('Invitation expired or already used'),
      404: err('Invitation not found'),
    },
  });

  r.registerPath({
    method: 'post', path: '/api/v1/team/invite/{token}/accept',
    summary: 'Accept invitation (public)', tags: ['Team'],
    description: 'Accepts an invitation. For new users, creates an account with the provided name and password. For existing users, links them to the tenant. Returns JWT tokens.',
    request: {
      params: z.object({ token: z.string().openapi({ description: 'Invitation token (64-char hex)' }) }),
      body: body(AcceptInvitationBodySchema),
    },
    responses: {
      200: json('Invitation accepted, user authenticated', AuthResponseSchema),
      400: err('Invitation expired, already used, or already a member'),
      404: err('Invitation not found'),
    },
  });
}
