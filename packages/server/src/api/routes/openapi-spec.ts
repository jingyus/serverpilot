// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * OpenAPI 3.0 specification generator.
 *
 * Orchestrates OpenAPI document generation by creating a registry,
 * registering all routes via openapi-routes, and generating
 * the final OpenAPI 3.0 JSON document.
 *
 * @module api/routes/openapi-spec
 */

import { z } from 'zod';
import {
  extendZodWithOpenApi,
  OpenAPIRegistry,
  OpenApiGeneratorV3,
} from '@asteasolutions/zod-to-openapi';
import { registerAllRoutes } from './openapi-routes.js';

// Extend Zod with OpenAPI metadata support
extendZodWithOpenApi(z);

const BEARER_AUTH = 'BearerAuth';

// ============================================================================
// Document generation
// ============================================================================

let _cachedDocument: object | null = null;

/**
 * Generate the OpenAPI 3.0 JSON document.
 *
 * Creates a registry, registers the Bearer auth security scheme,
 * registers all route definitions, then generates the spec.
 * Result is cached for subsequent calls.
 */
export function generateOpenAPIDocument(): object {
  if (_cachedDocument) return _cachedDocument;

  const registry = new OpenAPIRegistry();

  // Register security scheme
  registry.registerComponent('securitySchemes', BEARER_AUTH, {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
    description: 'JWT access token obtained from POST /api/v1/auth/login',
  });

  // Register all API routes
  registerAllRoutes(registry);

  const generator = new OpenApiGeneratorV3(registry.definitions);

  _cachedDocument = generator.generateDocument({
    openapi: '3.0.3',
    info: {
      title: 'ServerPilot API',
      version: '0.1.0',
      description: 'AI-driven server operations platform API. Manage servers, execute AI-assisted commands, configure alerts, and more.',
      license: { name: 'MIT' },
    },
    servers: [
      { url: 'http://localhost:3000', description: 'Local development' },
    ],
    tags: [
      { name: 'Auth', description: 'User authentication and token management' },
      { name: 'Servers', description: 'Server CRUD operations' },
      { name: 'Server Profile', description: 'Server profile, notes, preferences, and history' },
      { name: 'Snapshots', description: 'Snapshot management and rollback' },
      { name: 'Chat', description: 'AI chat and plan execution (SSE streaming)' },
      { name: 'Tasks', description: 'Scheduled task management' },
      { name: 'Alerts', description: 'Alert listing and resolution' },
      { name: 'Alert Rules', description: 'Alert threshold rule management' },
      { name: 'Operations', description: 'Operation history and audit trail' },
      { name: 'Agent', description: 'Agent version checking and updates' },
      { name: 'Knowledge', description: 'Documentation scraping and knowledge base' },
      { name: 'Doc Sources', description: 'Documentation source management' },
      { name: 'Settings', description: 'User settings and preferences' },
      { name: 'Metrics', description: 'Server monitoring metrics' },
      { name: 'System', description: 'Health check and system info' },
    ],
  });

  return _cachedDocument;
}

/** Clear the cached document (useful for testing). */
export function clearOpenAPICache(): void {
  _cachedDocument = null;
}
