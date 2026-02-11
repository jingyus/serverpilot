// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * OpenAPI route definitions — extra modules.
 *
 * Operations, Agent, Knowledge, Doc Sources, Settings, Metrics, System.
 * Split from openapi-routes.ts to stay within the 500-line file limit.
 *
 * @module api/routes/openapi-routes-extra
 */

import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';

extendZodWithOpenApi(z);

import {
  OperationQuerySchema, OperationStatsQuerySchema,
  CreateOperationBodySchema, UpdateOperationStatusBodySchema,
  ScrapeDocBodySchema,
  UpdateAIProviderBodySchema, UpdateUserProfileBodySchema,
  UpdateNotificationsBodySchema, UpdateKnowledgeBaseBodySchema,
} from './schemas.js';

import {
  err, ok, body, json, sec, UuidParamSchema,
  OperationListResponseSchema, OperationResponseSchema, OperationStatsResponseSchema,
  AgentVersionResponseSchema, AgentBinariesResponseSchema,
  KnowledgeSearchResponseSchema,
  DocSourceListResponseSchema, DocSourceResponseSchema, DocSourceStatusResponseSchema,
  SettingsResponseSchema,
  MetricPointSchema, AggregatedMetricsResponseSchema,
  HealthResponseSchema, SuccessResponseSchema,
} from './openapi-schemas.js';

import { registerExtra2Routes } from './openapi-routes-extra2.js';

// ============================================================================
// Registration entry-point
// ============================================================================

export function registerExtraRoutes(registry: OpenAPIRegistry): void {
  registerOperationRoutes(registry);
  registerAgentRoutes(registry);
  registerKnowledgeRoutes(registry);
  registerDocSourceRoutes(registry);
  registerSettingsRoutes(registry);
  registerMetricsRoutes(registry);
  registerSystemRoutes(registry);
  registerExtra2Routes(registry);
}

// --------------------------------------------------------------------------
// Operations
// --------------------------------------------------------------------------

function registerOperationRoutes(r: OpenAPIRegistry): void {
  r.registerPath({
    method: 'get', path: '/api/v1/operations',
    summary: 'List operations with advanced filtering', tags: ['Operations'], security: sec,
    description: 'Supports filtering by serverId, type, status, riskLevel, date range, and full-text search.',
    request: { query: OperationQuerySchema },
    responses: { 200: json('Paginated operation list', OperationListResponseSchema) },
  });

  r.registerPath({
    method: 'get', path: '/api/v1/operations/stats',
    summary: 'Get operation statistics', tags: ['Operations'], security: sec,
    description: 'Returns aggregated counts by status, type, and risk level.',
    request: { query: OperationStatsQuerySchema },
    responses: { 200: json('Operation statistics', OperationStatsResponseSchema) },
  });

  r.registerPath({
    method: 'get', path: '/api/v1/operations/{id}',
    summary: 'Get operation details', tags: ['Operations'], security: sec,
    request: { params: UuidParamSchema },
    responses: { 200: json('Operation details', OperationResponseSchema), 404: err('Operation not found') },
  });

  r.registerPath({
    method: 'post', path: '/api/v1/operations',
    summary: 'Create an operation record', tags: ['Operations'], security: sec,
    request: { body: body(CreateOperationBodySchema) },
    responses: { 201: json('Operation created', OperationResponseSchema), 400: err('Validation error') },
  });

  r.registerPath({
    method: 'patch', path: '/api/v1/operations/{id}/status',
    summary: 'Update operation status', tags: ['Operations'], security: sec,
    request: { params: UuidParamSchema, body: body(UpdateOperationStatusBodySchema) },
    responses: { 200: json('Status updated', OperationResponseSchema), 404: err('Operation not found') },
  });
}

// --------------------------------------------------------------------------
// Agent
// --------------------------------------------------------------------------

function registerAgentRoutes(r: OpenAPIRegistry): void {
  r.registerPath({
    method: 'get', path: '/api/v1/agent/version',
    summary: 'Check for agent updates', tags: ['Agent'],
    description: 'Public endpoint. Compares the provided version with the latest available release.',
    request: {
      query: z.object({
        current: z.string().optional().openapi({ description: 'Current agent version', example: '0.1.0' }),
        platform: z.enum(['darwin', 'linux', 'win32']).optional().openapi({ example: 'linux' }),
        arch: z.enum(['x64', 'arm64']).optional().openapi({ example: 'x64' }),
      }),
    },
    responses: { 200: json('Version info', AgentVersionResponseSchema) },
  });

  r.registerPath({
    method: 'get', path: '/api/v1/agent/binaries',
    summary: 'List all available agent binaries', tags: ['Agent'],
    description: 'Public endpoint. Returns download URLs, checksums, and sizes for all platform/arch combinations.',
    responses: { 200: json('Binary listing', AgentBinariesResponseSchema) },
  });
}

// --------------------------------------------------------------------------
// Knowledge
// --------------------------------------------------------------------------

function registerKnowledgeRoutes(r: OpenAPIRegistry): void {
  r.registerPath({
    method: 'post', path: '/api/v1/knowledge/scrape',
    summary: 'Trigger a documentation scrape', tags: ['Knowledge'], security: sec,
    description: 'Starts an async scrape of a GitHub repo or website. Returns a task for tracking progress.',
    request: { body: body(ScrapeDocBodySchema) },
    responses: {
      200: json('Scrape task created', z.object({
        task: z.object({
          id: z.string().openapi({ example: 'ft-001' }),
          status: z.enum(['pending', 'running', 'completed', 'failed']).openapi({ example: 'pending' }),
        }),
      })),
      500: err('Scrape failed'),
    },
  });

  r.registerPath({
    method: 'post', path: '/api/v1/knowledge/scrape/builtin',
    summary: 'Scrape all built-in sources', tags: ['Knowledge'], security: sec,
    responses: {
      200: json('Scrape summary', z.object({
        summary: z.object({
          succeeded: z.number().openapi({ example: 5 }),
          failed: z.number().openapi({ example: 0 }),
        }),
      })),
    },
  });

  r.registerPath({
    method: 'get', path: '/api/v1/knowledge/sources',
    summary: 'List documentation sources', tags: ['Knowledge'], security: sec,
    responses: {
      200: json('Source list', z.object({
        sources: z.array(z.object({
          id: z.string().openapi({ example: 'src-001' }),
          type: z.string().openapi({ example: 'github' }),
          software: z.string().openapi({ example: 'nginx' }),
          label: z.string().openapi({ example: 'nginx/nginx (GitHub)' }),
        })),
      })),
    },
  });

  r.registerPath({
    method: 'get', path: '/api/v1/knowledge/docs',
    summary: 'List fetched documentation', tags: ['Knowledge'], security: sec,
    responses: {
      200: json('Document list', z.object({
        docs: z.array(z.object({
          id: z.string().openapi({ example: 'doc-001' }),
          software: z.string().openapi({ example: 'nginx' }),
          title: z.string().openapi({ example: 'Reverse Proxy Guide' }),
          source: z.string().openapi({ example: 'github' }),
        })),
      })),
    },
  });

  r.registerPath({
    method: 'get', path: '/api/v1/knowledge/tasks',
    summary: 'List fetch tasks', tags: ['Knowledge'], security: sec,
    responses: {
      200: json('Task list', z.object({
        tasks: z.array(z.object({
          id: z.string().openapi({ example: 'ft-001' }),
          status: z.string().openapi({ example: 'completed' }),
          createdAt: z.string().openapi({ example: '2026-02-11T06:00:00Z' }),
        })),
      })),
    },
  });

  r.registerPath({
    method: 'get', path: '/api/v1/knowledge/tasks/{taskId}',
    summary: 'Get fetch task details', tags: ['Knowledge'], security: sec,
    request: { params: z.object({ taskId: z.string().openapi({ description: 'Fetch task ID' }) }) },
    responses: {
      200: json('Task details', z.object({
        task: z.object({
          id: z.string().openapi({ example: 'ft-001' }),
          status: z.string().openapi({ example: 'completed' }),
          summary: z.record(z.unknown()).nullable(),
        }),
      })),
      404: err('Task not found'),
    },
  });

  r.registerPath({
    method: 'get', path: '/api/v1/knowledge/search',
    summary: 'Search knowledge base', tags: ['Knowledge'], security: sec,
    description: 'Full-text search across all knowledge entries. Optionally filter by source type.',
    request: {
      query: z.object({
        q: z.string().openapi({ description: 'Search query', example: 'nginx reverse proxy' }),
        source: z.enum(['builtin', 'auto_learn', 'scrape', 'community']).optional().openapi({ example: 'builtin' }),
      }),
    },
    responses: { 200: json('Search results', KnowledgeSearchResponseSchema) },
  });
}

// --------------------------------------------------------------------------
// Doc Sources
// --------------------------------------------------------------------------

function registerDocSourceRoutes(r: OpenAPIRegistry): void {
  r.registerPath({
    method: 'get', path: '/api/v1/doc-sources',
    summary: 'List documentation sources', tags: ['Doc Sources'], security: sec,
    responses: { 200: json('Source list', DocSourceListResponseSchema) },
  });

  r.registerPath({
    method: 'post', path: '/api/v1/doc-sources',
    summary: 'Create a documentation source', tags: ['Doc Sources'], security: sec,
    request: {
      body: body(z.object({
        name: z.string().min(1).max(100).openapi({ example: 'Nginx Official Docs' }),
        software: z.string().min(1).max(50).openapi({ example: 'nginx' }),
        type: z.enum(['github', 'website']).openapi({ example: 'github' }),
        githubConfig: z.object({
          owner: z.string().openapi({ example: 'nginx' }),
          repo: z.string().openapi({ example: 'nginx' }),
          branch: z.string().optional().openapi({ example: 'master' }),
          paths: z.array(z.string()).optional().openapi({ example: ['docs/'] }),
        }).optional(),
        websiteConfig: z.object({
          baseUrl: z.string().url().openapi({ example: 'https://nginx.org/en/docs/' }),
          pages: z.array(z.string().url()).optional(),
        }).optional(),
        enabled: z.boolean().optional().openapi({ example: true }),
        autoUpdate: z.boolean().optional().openapi({ example: true }),
        updateFrequencyHours: z.number().optional().openapi({ example: 24 }),
      })),
    },
    responses: { 201: json('Source created', DocSourceResponseSchema), 400: err('Validation error') },
  });

  r.registerPath({
    method: 'get', path: '/api/v1/doc-sources/{id}',
    summary: 'Get documentation source', tags: ['Doc Sources'], security: sec,
    request: { params: UuidParamSchema },
    responses: { 200: json('Source details', DocSourceResponseSchema), 404: err('Not found') },
  });

  r.registerPath({
    method: 'patch', path: '/api/v1/doc-sources/{id}',
    summary: 'Update a documentation source', tags: ['Doc Sources'], security: sec,
    request: { params: UuidParamSchema },
    responses: { 200: json('Source updated', DocSourceResponseSchema), 404: err('Not found') },
  });

  r.registerPath({
    method: 'delete', path: '/api/v1/doc-sources/{id}',
    summary: 'Delete a documentation source', tags: ['Doc Sources'], security: sec,
    request: { params: UuidParamSchema },
    responses: { 200: ok('Source deleted'), 404: err('Not found') },
  });

  r.registerPath({
    method: 'post', path: '/api/v1/doc-sources/{id}/fetch',
    summary: 'Trigger manual fetch', tags: ['Doc Sources'], security: sec,
    description: 'Manually triggers a documentation fetch for the specified source.',
    request: { params: UuidParamSchema },
    responses: {
      200: json('Fetch result', z.object({
        success: z.boolean().openapi({ example: true }),
        task: z.object({
          id: z.string().openapi({ example: 'ft-002' }),
          status: z.string().openapi({ example: 'completed' }),
          summary: z.record(z.unknown()).nullable(),
        }),
      })),
      404: err('Not found'),
    },
  });

  r.registerPath({
    method: 'get', path: '/api/v1/doc-sources/{id}/status',
    summary: 'Get fetch status', tags: ['Doc Sources'], security: sec,
    request: { params: UuidParamSchema },
    responses: { 200: json('Fetch status and history', DocSourceStatusResponseSchema), 404: err('Not found') },
  });
}

// --------------------------------------------------------------------------
// Settings
// --------------------------------------------------------------------------

function registerSettingsRoutes(r: OpenAPIRegistry): void {
  r.registerPath({
    method: 'get', path: '/api/v1/settings',
    summary: 'Get user settings', tags: ['Settings'], security: sec,
    description: 'Returns all user settings: AI provider, profile, notifications, and knowledge base configuration.',
    responses: { 200: json('User settings', SettingsResponseSchema) },
  });

  r.registerPath({
    method: 'put', path: '/api/v1/settings/ai-provider',
    summary: 'Update AI provider configuration', tags: ['Settings'], security: sec,
    request: { body: body(UpdateAIProviderBodySchema) },
    responses: { 200: json('Settings updated (returns full settings)', SettingsResponseSchema) },
  });

  r.registerPath({
    method: 'put', path: '/api/v1/settings/profile',
    summary: 'Update user profile', tags: ['Settings'], security: sec,
    request: { body: body(UpdateUserProfileBodySchema) },
    responses: { 200: json('Settings updated (returns full settings)', SettingsResponseSchema) },
  });

  r.registerPath({
    method: 'put', path: '/api/v1/settings/notifications',
    summary: 'Update notification preferences', tags: ['Settings'], security: sec,
    request: { body: body(UpdateNotificationsBodySchema) },
    responses: { 200: json('Settings updated (returns full settings)', SettingsResponseSchema) },
  });

  r.registerPath({
    method: 'put', path: '/api/v1/settings/knowledge-base',
    summary: 'Update knowledge base settings', tags: ['Settings'], security: sec,
    request: { body: body(UpdateKnowledgeBaseBodySchema) },
    responses: { 200: json('Settings updated (returns full settings)', SettingsResponseSchema) },
  });
}

// --------------------------------------------------------------------------
// Metrics
// --------------------------------------------------------------------------

function registerMetricsRoutes(r: OpenAPIRegistry): void {
  r.registerPath({
    method: 'get', path: '/api/v1/metrics',
    summary: 'Get metrics by time range', tags: ['Metrics'], security: sec,
    description: 'Returns raw metric data points for a server within a time range.',
    request: {
      query: z.object({
        serverId: z.string().openapi({ description: 'Server ID (required)', example: '550e8400-e29b-41d4-a716-446655440000' }),
        range: z.enum(['1h', '24h', '7d']).default('24h').openapi({ example: '24h' }),
      }),
    },
    responses: {
      200: json('Metrics data points', z.object({ metrics: z.array(MetricPointSchema) })),
      400: err('Missing serverId'),
    },
  });

  r.registerPath({
    method: 'get', path: '/api/v1/metrics/latest',
    summary: 'Get latest metric point', tags: ['Metrics'], security: sec,
    request: {
      query: z.object({
        serverId: z.string().openapi({ description: 'Server ID (required)', example: '550e8400-e29b-41d4-a716-446655440000' }),
      }),
    },
    responses: {
      200: json('Latest metric point or null', z.object({ latest: MetricPointSchema.nullable() })),
      400: err('Missing serverId'),
    },
  });

  r.registerPath({
    method: 'get', path: '/api/v1/metrics/aggregated',
    summary: 'Get aggregated metrics', tags: ['Metrics'], security: sec,
    description: 'Returns pre-computed hourly/daily aggregates with avg, min, max per bucket.',
    request: {
      query: z.object({
        serverId: z.string().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }),
        range: z.enum(['1h', '24h', '7d']).default('24h').openapi({ example: '24h' }),
      }),
    },
    responses: {
      200: json('Aggregated metric buckets', AggregatedMetricsResponseSchema),
      400: err('Missing serverId'),
    },
  });
}

// --------------------------------------------------------------------------
// System
// --------------------------------------------------------------------------

function registerSystemRoutes(r: OpenAPIRegistry): void {
  r.registerPath({
    method: 'get', path: '/health',
    summary: 'Health check', tags: ['System'],
    description: 'Returns service health status. Used by load balancers and monitoring.',
    responses: { 200: json('Service is healthy', HealthResponseSchema) },
  });
}
