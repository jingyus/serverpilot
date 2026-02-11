// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * REST API route registry.
 *
 * Assembles all route modules under the `/api/v1` base path
 * and applies global middleware (error handling, CORS, logging).
 *
 * @module api/routes/index
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { requestId } from 'hono/request-id';

import { auth } from './auth.js';
import { authGitHub } from './auth-github.js';
import { servers } from './servers.js';
import { chat } from './chat.js';
import { tasks } from './tasks.js';
import { alerts } from './alerts.js';
import { alertRules } from './alert-rules.js';
import { operations } from './operations.js';
import { agent } from './agent.js';
import { knowledge } from './knowledge.js';
import docSources from './doc-sources.js';
import { settings } from './settings.js';
import { metricsRoutes } from './metrics.js';
import { auditLog } from './audit-log.js';
import { webhooksRoute } from './webhooks.js';
import { membersRoute } from './members.js';
import { teamRoute } from './team.js';
import { openapi } from './openapi.js';
import { onError, onNotFound } from '../middleware/error-handler.js';
import { createRateLimitMiddleware } from '../middleware/rate-limit.js';
import type { ApiEnv } from './types.js';

// ============================================================================
// Create API app
// ============================================================================

/**
 * Create and configure the Hono REST API application.
 *
 * Registers all route modules under `/api/v1` with global middleware
 * for CORS, request ID tracking, logging, and error handling.
 *
 * @returns Configured Hono app instance
 */
export function createApiApp(): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>();

  // --------------------------------------------------------------------------
  // Global middleware
  // --------------------------------------------------------------------------

  app.use('*', cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    exposeHeaders: ['X-Request-Id', 'X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset', 'Retry-After'],
    maxAge: 86400,
  }));

  app.use('*', requestId());

  app.use('/api/v1/*', createRateLimitMiddleware());

  // --------------------------------------------------------------------------
  // Health check (outside /api/v1 for load balancer probes)
  // --------------------------------------------------------------------------

  app.get('/health', (c) =>
    c.json({ status: 'ok', timestamp: Date.now() }),
  );

  // --------------------------------------------------------------------------
  // API documentation (Swagger UI + OpenAPI spec)
  // --------------------------------------------------------------------------

  app.route('/api-docs', openapi);

  // --------------------------------------------------------------------------
  // API v1 routes
  // --------------------------------------------------------------------------

  const v1 = new Hono();

  v1.route('/auth', auth);
  v1.route('/auth/github', authGitHub);
  v1.route('/servers', servers);
  v1.route('/chat', chat);
  v1.route('/tasks', tasks);
  v1.route('/alerts', alerts);
  v1.route('/alert-rules', alertRules);
  v1.route('/operations', operations);
  v1.route('/agent', agent);
  v1.route('/knowledge', knowledge);
  v1.route('/doc-sources', docSources);
  v1.route('/settings', settings);
  v1.route('/metrics', metricsRoutes);
  v1.route('/audit-log', auditLog);
  v1.route('/webhooks', webhooksRoute);
  v1.route('/members', membersRoute);
  v1.route('/team', teamRoute);

  app.route('/api/v1', v1);

  // --------------------------------------------------------------------------
  // Error handling
  // --------------------------------------------------------------------------

  app.onError(onError);
  app.notFound(onNotFound);

  return app;
}

export { auth, authGitHub, servers, chat, tasks, alerts, alertRules, operations, agent, knowledge, settings, metricsRoutes, auditLog, webhooksRoute, membersRoute, teamRoute };
export { docSources };
