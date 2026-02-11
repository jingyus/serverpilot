// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * OpenAPI documentation routes tests.
 *
 * Tests for Swagger UI page, OpenAPI JSON spec, and spec correctness.
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { Hono } from 'hono';
import { openapi } from './openapi.js';
import { generateOpenAPIDocument, clearOpenAPICache } from './openapi-spec.js';

describe('OpenAPI Routes', () => {
  let app: Hono;

  beforeAll(() => {
    app = new Hono();
    app.route('/api-docs', openapi);
  });

  afterEach(() => {
    clearOpenAPICache();
  });

  // ==========================================================================
  // GET /api-docs — Swagger UI
  // ==========================================================================

  describe('GET /api-docs', () => {
    it('should return Swagger UI HTML page', async () => {
      const res = await app.request('/api-docs');
      expect(res.status).toBe(200);

      const contentType = res.headers.get('content-type');
      expect(contentType).toContain('text/html');

      const html = await res.text();
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('swagger-ui');
      expect(html).toContain('ServerPilot API Documentation');
    });

    it('should reference the OpenAPI JSON endpoint', async () => {
      const res = await app.request('/api-docs');
      const html = await res.text();
      expect(html).toContain('/api-docs/openapi.json');
    });

    it('should include Swagger UI bundle script', async () => {
      const res = await app.request('/api-docs');
      const html = await res.text();
      expect(html).toContain('swagger-ui-bundle.js');
      expect(html).toContain('SwaggerUIBundle');
    });
  });

  // ==========================================================================
  // GET /api-docs/openapi.json — OpenAPI Spec
  // ==========================================================================

  describe('GET /api-docs/openapi.json', () => {
    it('should return valid JSON', async () => {
      const res = await app.request('/api-docs/openapi.json');
      expect(res.status).toBe(200);

      const contentType = res.headers.get('content-type');
      expect(contentType).toContain('application/json');

      const json = await res.json();
      expect(json).toBeDefined();
    });

    it('should have correct OpenAPI version', async () => {
      const res = await app.request('/api-docs/openapi.json');
      const doc = await res.json() as Record<string, unknown>;
      expect(doc.openapi).toBe('3.0.3');
    });

    it('should have correct info section', async () => {
      const res = await app.request('/api-docs/openapi.json');
      const doc = await res.json() as { info: { title: string; version: string; description: string } };
      expect(doc.info.title).toBe('ServerPilot API');
      expect(doc.info.version).toBe('0.1.0');
      expect(doc.info.description).toContain('AI-driven');
    });

    it('should define server URLs', async () => {
      const res = await app.request('/api-docs/openapi.json');
      const doc = await res.json() as { servers: Array<{ url: string }> };
      expect(doc.servers).toHaveLength(1);
      expect(doc.servers[0].url).toBe('http://localhost:3000');
    });

    it('should include Bearer auth security scheme', async () => {
      const res = await app.request('/api-docs/openapi.json');
      const doc = await res.json() as { components: { securitySchemes: Record<string, { type: string; scheme: string }> } };
      expect(doc.components.securitySchemes).toHaveProperty('BearerAuth');
      expect(doc.components.securitySchemes.BearerAuth.type).toBe('http');
      expect(doc.components.securitySchemes.BearerAuth.scheme).toBe('bearer');
    });
  });

  // ==========================================================================
  // Route coverage
  // ==========================================================================

  describe('Route Coverage', () => {
    it('should have all required tags', async () => {
      const res = await app.request('/api-docs/openapi.json');
      const doc = await res.json() as { tags: Array<{ name: string }> };
      const tagNames = doc.tags.map((t) => t.name);

      expect(tagNames).toContain('Auth');
      expect(tagNames).toContain('Servers');
      expect(tagNames).toContain('Server Profile');
      expect(tagNames).toContain('Snapshots');
      expect(tagNames).toContain('Chat');
      expect(tagNames).toContain('Tasks');
      expect(tagNames).toContain('Alerts');
      expect(tagNames).toContain('Alert Rules');
      expect(tagNames).toContain('Operations');
      expect(tagNames).toContain('Agent');
      expect(tagNames).toContain('Knowledge');
      expect(tagNames).toContain('Doc Sources');
      expect(tagNames).toContain('Settings');
      expect(tagNames).toContain('Metrics');
      expect(tagNames).toContain('System');
    });

    it('should document auth endpoints', async () => {
      const res = await app.request('/api-docs/openapi.json');
      const doc = await res.json() as { paths: Record<string, unknown> };

      expect(doc.paths).toHaveProperty('/api/v1/auth/login');
      expect(doc.paths).toHaveProperty('/api/v1/auth/register');
      expect(doc.paths).toHaveProperty('/api/v1/auth/refresh');
      expect(doc.paths).toHaveProperty('/api/v1/auth/logout');
    });

    it('should document server CRUD endpoints', async () => {
      const res = await app.request('/api-docs/openapi.json');
      const doc = await res.json() as { paths: Record<string, unknown> };

      expect(doc.paths).toHaveProperty('/api/v1/servers');
      expect(doc.paths).toHaveProperty('/api/v1/servers/{id}');
    });

    it('should document chat endpoints', async () => {
      const res = await app.request('/api-docs/openapi.json');
      const doc = await res.json() as { paths: Record<string, unknown> };

      expect(doc.paths).toHaveProperty('/api/v1/chat/{serverId}');
      expect(doc.paths).toHaveProperty('/api/v1/chat/{serverId}/execute');
      expect(doc.paths).toHaveProperty('/api/v1/chat/{serverId}/sessions');
    });

    it('should document task endpoints', async () => {
      const res = await app.request('/api-docs/openapi.json');
      const doc = await res.json() as { paths: Record<string, unknown> };

      expect(doc.paths).toHaveProperty('/api/v1/tasks');
      expect(doc.paths).toHaveProperty('/api/v1/tasks/{id}');
      expect(doc.paths).toHaveProperty('/api/v1/tasks/{id}/run');
    });

    it('should document alert endpoints', async () => {
      const res = await app.request('/api-docs/openapi.json');
      const doc = await res.json() as { paths: Record<string, unknown> };

      expect(doc.paths).toHaveProperty('/api/v1/alerts');
      expect(doc.paths).toHaveProperty('/api/v1/alerts/{id}');
      expect(doc.paths).toHaveProperty('/api/v1/alerts/{id}/resolve');
    });

    it('should document alert rule endpoints', async () => {
      const res = await app.request('/api-docs/openapi.json');
      const doc = await res.json() as { paths: Record<string, unknown> };

      expect(doc.paths).toHaveProperty('/api/v1/alert-rules');
      expect(doc.paths).toHaveProperty('/api/v1/alert-rules/{id}');
    });

    it('should document operation endpoints', async () => {
      const res = await app.request('/api-docs/openapi.json');
      const doc = await res.json() as { paths: Record<string, unknown> };

      expect(doc.paths).toHaveProperty('/api/v1/operations');
      expect(doc.paths).toHaveProperty('/api/v1/operations/stats');
      expect(doc.paths).toHaveProperty('/api/v1/operations/{id}');
      expect(doc.paths).toHaveProperty('/api/v1/operations/{id}/status');
    });

    it('should document agent endpoints', async () => {
      const res = await app.request('/api-docs/openapi.json');
      const doc = await res.json() as { paths: Record<string, unknown> };

      expect(doc.paths).toHaveProperty('/api/v1/agent/version');
      expect(doc.paths).toHaveProperty('/api/v1/agent/binaries');
    });

    it('should document knowledge endpoints', async () => {
      const res = await app.request('/api-docs/openapi.json');
      const doc = await res.json() as { paths: Record<string, unknown> };

      expect(doc.paths).toHaveProperty('/api/v1/knowledge/scrape');
      expect(doc.paths).toHaveProperty('/api/v1/knowledge/sources');
      expect(doc.paths).toHaveProperty('/api/v1/knowledge/search');
    });

    it('should document doc source endpoints', async () => {
      const res = await app.request('/api-docs/openapi.json');
      const doc = await res.json() as { paths: Record<string, unknown> };

      expect(doc.paths).toHaveProperty('/api/v1/doc-sources');
      expect(doc.paths).toHaveProperty('/api/v1/doc-sources/{id}');
      expect(doc.paths).toHaveProperty('/api/v1/doc-sources/{id}/fetch');
      expect(doc.paths).toHaveProperty('/api/v1/doc-sources/{id}/status');
    });

    it('should document settings endpoints', async () => {
      const res = await app.request('/api-docs/openapi.json');
      const doc = await res.json() as { paths: Record<string, unknown> };

      expect(doc.paths).toHaveProperty('/api/v1/settings');
      expect(doc.paths).toHaveProperty('/api/v1/settings/ai-provider');
      expect(doc.paths).toHaveProperty('/api/v1/settings/profile');
      expect(doc.paths).toHaveProperty('/api/v1/settings/notifications');
      expect(doc.paths).toHaveProperty('/api/v1/settings/knowledge-base');
    });

    it('should document metrics endpoints', async () => {
      const res = await app.request('/api-docs/openapi.json');
      const doc = await res.json() as { paths: Record<string, unknown> };

      expect(doc.paths).toHaveProperty('/api/v1/metrics');
      expect(doc.paths).toHaveProperty('/api/v1/metrics/latest');
      expect(doc.paths).toHaveProperty('/api/v1/metrics/aggregated');
    });

    it('should document snapshot endpoints', async () => {
      const res = await app.request('/api-docs/openapi.json');
      const doc = await res.json() as { paths: Record<string, unknown> };

      expect(doc.paths).toHaveProperty('/api/v1/servers/{serverId}/snapshots');
      expect(doc.paths).toHaveProperty('/api/v1/servers/{serverId}/snapshots/{snapshotId}');
      expect(doc.paths).toHaveProperty('/api/v1/servers/{serverId}/snapshots/{snapshotId}/rollback');
    });

    it('should document health check endpoint', async () => {
      const res = await app.request('/api-docs/openapi.json');
      const doc = await res.json() as { paths: Record<string, unknown> };

      expect(doc.paths).toHaveProperty('/health');
    });
  });

  // ==========================================================================
  // Schema validation
  // ==========================================================================

  describe('Schema Correctness', () => {
    it('should have request body schemas for POST auth/login', async () => {
      const res = await app.request('/api-docs/openapi.json');
      const doc = await res.json() as { paths: Record<string, Record<string, { requestBody?: unknown }>> };

      const loginPath = doc.paths['/api/v1/auth/login'];
      expect(loginPath).toHaveProperty('post');
      expect(loginPath.post).toHaveProperty('requestBody');
    });

    it('should have security requirements for protected routes', async () => {
      const res = await app.request('/api-docs/openapi.json');
      const doc = await res.json() as { paths: Record<string, Record<string, { security?: unknown[] }>> };

      const serverList = doc.paths['/api/v1/servers'];
      expect(serverList.get.security).toBeDefined();
      expect(serverList.get.security).toHaveLength(1);
    });

    it('should NOT have security requirements for public routes', async () => {
      const res = await app.request('/api-docs/openapi.json');
      const doc = await res.json() as { paths: Record<string, Record<string, { security?: unknown[] }>> };

      const loginPath = doc.paths['/api/v1/auth/login'];
      expect(loginPath.post.security).toBeUndefined();
    });

    it('should have path parameters for parameterized routes', async () => {
      const res = await app.request('/api-docs/openapi.json');
      const doc = await res.json() as { paths: Record<string, Record<string, { parameters?: Array<{ in: string; name: string }> }>> };

      const serverDetail = doc.paths['/api/v1/servers/{id}'];
      expect(serverDetail.get.parameters).toBeDefined();
      const pathParams = serverDetail.get.parameters!.filter((p) => p.in === 'path');
      expect(pathParams.length).toBeGreaterThan(0);
      expect(pathParams.some((p) => p.name === 'id')).toBe(true);
    });

    it('should have query parameters for query-validated routes', async () => {
      const res = await app.request('/api-docs/openapi.json');
      const doc = await res.json() as { paths: Record<string, Record<string, { parameters?: Array<{ in: string; name: string }> }>> };

      const agentVersion = doc.paths['/api/v1/agent/version'];
      expect(agentVersion.get.parameters).toBeDefined();
      const queryParams = agentVersion.get.parameters!.filter((p) => p.in === 'query');
      expect(queryParams.some((p) => p.name === 'current')).toBe(true);
      expect(queryParams.some((p) => p.name === 'platform')).toBe(true);
    });
  });

  // ==========================================================================
  // Response schemas and examples
  // ==========================================================================

  describe('Response Schemas', () => {
    it('should have typed response schemas for auth endpoints', async () => {
      const res = await app.request('/api-docs/openapi.json');
      const doc = await res.json() as Record<string, unknown>;
      const paths = doc.paths as Record<string, Record<string, { responses: Record<string, { content?: Record<string, { schema?: Record<string, unknown> }> }> }>>;

      // POST /auth/login should have 200 response with schema
      const loginResp = paths['/api/v1/auth/login'].post.responses['200'];
      expect(loginResp.content).toBeDefined();
      expect(loginResp.content!['application/json']).toBeDefined();
      expect(loginResp.content!['application/json'].schema).toBeDefined();

      // POST /auth/register should have 201 response with schema
      const registerResp = paths['/api/v1/auth/register'].post.responses['201'];
      expect(registerResp.content).toBeDefined();
      expect(registerResp.content!['application/json'].schema).toBeDefined();
    });

    it('should have typed response schemas for server endpoints', async () => {
      const res = await app.request('/api-docs/openapi.json');
      const doc = await res.json() as Record<string, unknown>;
      const paths = doc.paths as Record<string, Record<string, { responses: Record<string, { content?: Record<string, { schema?: Record<string, unknown> }> }> }>>;

      // GET /servers should have 200 response with schema containing "servers" array
      const listResp = paths['/api/v1/servers'].get.responses['200'];
      expect(listResp.content).toBeDefined();
      const listSchema = listResp.content!['application/json'].schema as Record<string, unknown>;
      expect(listSchema.properties).toHaveProperty('servers');

      // POST /servers should have 201 response with schema containing "server" + "agentToken"
      const createResp = paths['/api/v1/servers'].post.responses['201'];
      expect(createResp.content).toBeDefined();
      const createSchema = createResp.content!['application/json'].schema as { properties: { server: { properties: Record<string, unknown> } } };
      expect(createSchema.properties.server.properties).toHaveProperty('agentToken');
    });

    it('should have typed response schemas for task endpoints', async () => {
      const res = await app.request('/api-docs/openapi.json');
      const doc = await res.json() as Record<string, unknown>;
      const paths = doc.paths as Record<string, Record<string, { responses: Record<string, { content?: Record<string, { schema?: Record<string, unknown> }> }> }>>;

      // GET /tasks should have pagination fields
      const listResp = paths['/api/v1/tasks'].get.responses['200'];
      const listSchema = listResp.content!['application/json'].schema as Record<string, unknown>;
      expect(listSchema.properties).toHaveProperty('tasks');
      expect(listSchema.properties).toHaveProperty('total');
      expect(listSchema.properties).toHaveProperty('limit');
      expect(listSchema.properties).toHaveProperty('offset');

      // POST /tasks/{id}/run should have execution result schema
      const runResp = paths['/api/v1/tasks/{id}/run'].post.responses['200'];
      const runSchema = runResp.content!['application/json'].schema as Record<string, unknown>;
      expect(runSchema.properties).toHaveProperty('exitCode');
      expect(runSchema.properties).toHaveProperty('stdout');
      expect(runSchema.properties).toHaveProperty('stderr');
    });

    it('should have typed response schemas for alert endpoints', async () => {
      const res = await app.request('/api-docs/openapi.json');
      const doc = await res.json() as Record<string, unknown>;
      const paths = doc.paths as Record<string, Record<string, { responses: Record<string, { content?: Record<string, { schema?: Record<string, unknown> }> }> }>>;

      // PATCH /alerts/{id}/resolve should include both success and alert
      const resolveResp = paths['/api/v1/alerts/{id}/resolve'].patch.responses['200'];
      const resolveSchema = resolveResp.content!['application/json'].schema as Record<string, unknown>;
      expect(resolveSchema.properties).toHaveProperty('success');
      expect(resolveSchema.properties).toHaveProperty('alert');
    });

    it('should have typed response schemas for operation endpoints', async () => {
      const res = await app.request('/api-docs/openapi.json');
      const doc = await res.json() as Record<string, unknown>;
      const paths = doc.paths as Record<string, Record<string, { responses: Record<string, { content?: Record<string, { schema?: Record<string, unknown> }> }> }>>;

      // GET /operations/stats should have stats object
      const statsResp = paths['/api/v1/operations/stats'].get.responses['200'];
      const statsSchema = statsResp.content!['application/json'].schema as Record<string, unknown>;
      expect(statsSchema.properties).toHaveProperty('stats');
    });

    it('should have typed response schemas for metrics endpoints', async () => {
      const res = await app.request('/api-docs/openapi.json');
      const doc = await res.json() as Record<string, unknown>;
      const paths = doc.paths as Record<string, Record<string, { responses: Record<string, { content?: Record<string, { schema?: Record<string, unknown> }> }> }>>;

      // GET /metrics should have metrics array
      const metricsResp = paths['/api/v1/metrics'].get.responses['200'];
      const metricsSchema = metricsResp.content!['application/json'].schema as Record<string, unknown>;
      expect(metricsSchema.properties).toHaveProperty('metrics');

      // GET /metrics/aggregated should have metrics with avg/min/max
      const aggResp = paths['/api/v1/metrics/aggregated'].get.responses['200'];
      expect(aggResp.content).toBeDefined();
    });

    it('should have typed response schemas for settings endpoints', async () => {
      const res = await app.request('/api-docs/openapi.json');
      const doc = await res.json() as Record<string, unknown>;
      const paths = doc.paths as Record<string, Record<string, { responses: Record<string, { content?: Record<string, { schema?: Record<string, unknown> }> }> }>>;

      // GET /settings should have all setting sections
      const settingsResp = paths['/api/v1/settings'].get.responses['200'];
      const settingsSchema = settingsResp.content!['application/json'].schema as Record<string, unknown>;
      expect(settingsSchema.properties).toHaveProperty('aiProvider');
      expect(settingsSchema.properties).toHaveProperty('userProfile');
      expect(settingsSchema.properties).toHaveProperty('notifications');
      expect(settingsSchema.properties).toHaveProperty('knowledgeBase');
    });

    it('should have typed response for health check', async () => {
      const res = await app.request('/api-docs/openapi.json');
      const doc = await res.json() as Record<string, unknown>;
      const paths = doc.paths as Record<string, Record<string, { responses: Record<string, { content?: Record<string, { schema?: Record<string, unknown> }> }> }>>;

      const healthResp = paths['/health'].get.responses['200'];
      const healthSchema = healthResp.content!['application/json'].schema as Record<string, unknown>;
      expect(healthSchema.properties).toHaveProperty('status');
      expect(healthSchema.properties).toHaveProperty('timestamp');
    });
  });

  // ==========================================================================
  // Example values
  // ==========================================================================

  describe('Example Values', () => {
    it('should include examples in response schemas', async () => {
      const res = await app.request('/api-docs/openapi.json');
      const doc = await res.json() as Record<string, unknown>;
      const paths = doc.paths as Record<string, Record<string, { responses: Record<string, { content?: Record<string, { schema?: Record<string, unknown> }> }> }>>;

      // Check that auth response schema properties have examples
      const loginSchema = paths['/api/v1/auth/login'].post.responses['200']
        .content!['application/json'].schema as { properties: Record<string, { properties?: Record<string, { example?: unknown }> }> };
      const userProps = loginSchema.properties.user?.properties;
      expect(userProps?.email?.example).toBe('admin@example.com');
    });

    it('should include examples in agent version response', async () => {
      const res = await app.request('/api-docs/openapi.json');
      const doc = await res.json() as Record<string, unknown>;
      const paths = doc.paths as Record<string, Record<string, { responses: Record<string, { content?: Record<string, { schema?: Record<string, unknown> }> }> }>>;

      const versionSchema = paths['/api/v1/agent/version'].get.responses['200']
        .content!['application/json'].schema as { properties: Record<string, { example?: unknown }> };
      expect(versionSchema.properties.latest?.example).toBe('0.2.0');
      expect(versionSchema.properties.updateAvailable?.example).toBe(true);
    });

    it('should include descriptions in endpoint definitions', async () => {
      const res = await app.request('/api-docs/openapi.json');
      const doc = await res.json() as Record<string, unknown>;
      const paths = doc.paths as Record<string, Record<string, { description?: string }>>;

      // Chat endpoints should have descriptions about SSE streaming
      expect(paths['/api/v1/chat/{serverId}'].post.description).toContain('Server-Sent Events');
      expect(paths['/api/v1/chat/{serverId}/execute'].post.description).toContain('SSE');
    });
  });

  // ==========================================================================
  // Endpoint count completeness
  // ==========================================================================

  describe('Endpoint Completeness', () => {
    it('should document all server profile sub-routes', async () => {
      const res = await app.request('/api-docs/openapi.json');
      const doc = await res.json() as { paths: Record<string, unknown> };

      expect(doc.paths).toHaveProperty('/api/v1/servers/{id}/profile');
      expect(doc.paths).toHaveProperty('/api/v1/servers/{id}/metrics');
      expect(doc.paths).toHaveProperty('/api/v1/servers/{id}/operations');
      expect(doc.paths).toHaveProperty('/api/v1/servers/{id}/profile/notes');
      expect(doc.paths).toHaveProperty('/api/v1/servers/{id}/profile/preferences');
      expect(doc.paths).toHaveProperty('/api/v1/servers/{id}/profile/history');
      expect(doc.paths).toHaveProperty('/api/v1/servers/{id}/profile/summary');
    });

    it('should document all knowledge sub-routes', async () => {
      const res = await app.request('/api-docs/openapi.json');
      const doc = await res.json() as { paths: Record<string, unknown> };

      expect(doc.paths).toHaveProperty('/api/v1/knowledge/scrape');
      expect(doc.paths).toHaveProperty('/api/v1/knowledge/scrape/builtin');
      expect(doc.paths).toHaveProperty('/api/v1/knowledge/sources');
      expect(doc.paths).toHaveProperty('/api/v1/knowledge/docs');
      expect(doc.paths).toHaveProperty('/api/v1/knowledge/tasks');
      expect(doc.paths).toHaveProperty('/api/v1/knowledge/tasks/{taskId}');
      expect(doc.paths).toHaveProperty('/api/v1/knowledge/search');
    });

    it('should have at least 60 unique endpoint operations', async () => {
      const res = await app.request('/api-docs/openapi.json');
      const doc = await res.json() as { paths: Record<string, Record<string, unknown>> };

      let operationCount = 0;
      const httpMethods = ['get', 'post', 'put', 'patch', 'delete'];
      for (const pathMethods of Object.values(doc.paths)) {
        for (const method of httpMethods) {
          if (pathMethods[method]) operationCount++;
        }
      }
      expect(operationCount).toBeGreaterThanOrEqual(60);
    });
  });

  // ==========================================================================
  // generateOpenAPIDocument
  // ==========================================================================

  describe('generateOpenAPIDocument', () => {
    it('should return a valid object', () => {
      const doc = generateOpenAPIDocument();
      expect(doc).toBeDefined();
      expect(typeof doc).toBe('object');
    });

    it('should cache the document', () => {
      const doc1 = generateOpenAPIDocument();
      const doc2 = generateOpenAPIDocument();
      expect(doc1).toBe(doc2);
    });

    it('should regenerate after cache clear', () => {
      const doc1 = generateOpenAPIDocument();
      clearOpenAPICache();
      const doc2 = generateOpenAPIDocument();
      // Different object references but same content
      expect(doc1).not.toBe(doc2);
      expect(JSON.stringify(doc1)).toBe(JSON.stringify(doc2));
    });

    it('should count total paths', () => {
      const doc = generateOpenAPIDocument() as { paths: Record<string, unknown> };
      const pathCount = Object.keys(doc.paths).length;
      // We have at least 30+ unique path patterns
      expect(pathCount).toBeGreaterThanOrEqual(30);
    });
  });
});
