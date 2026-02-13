// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for health detail API route.
 *
 * Validates subsystem health checks, overall status aggregation,
 * and authentication requirements.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';

import type { AuthContext } from './types.js';

// ============================================================================
// Module Mocks — must be before imports of the module under test
// ============================================================================

const mockCheckProviderHealth = vi.fn();
const mockGetActiveProvider = vi.fn();

vi.mock('../../ai/providers/provider-factory.js', () => ({
  getActiveProvider: () => mockGetActiveProvider(),
  checkProviderHealth: (...args: unknown[]) => mockCheckProviderHealth(...args),
}));

const mockGetRawDatabase = vi.fn();

vi.mock('../../db/connection.js', () => ({
  getRawDatabase: () => mockGetRawDatabase(),
}));

const mockInstallServer = {
  isRunning: vi.fn(),
  getClientCount: vi.fn(),
  getMaxConnections: vi.fn(),
};

const mockGetInstallServer = vi.fn();

vi.mock('../../core/agent/agent-connector.js', () => ({
  getInstallServer: () => mockGetInstallServer(),
}));

const mockRagPipeline = {
  isReady: vi.fn(),
  getIndexedDocCount: vi.fn(),
};

const mockGetRagPipeline = vi.fn();

vi.mock('../../knowledge/rag-pipeline.js', () => ({
  getRagPipeline: () => mockGetRagPipeline(),
}));

vi.mock('../middleware/auth.js', () => ({
  requireAuth: vi.fn(async (c: { set: (k: string, v: string) => void }, next: () => Promise<void>) => {
    c.set('userId', 'user-1');
    await next();
  }),
}));

vi.mock('../middleware/rbac.js', () => ({
  resolveRole: vi.fn(async (c: Record<string, (k: string, v: string) => void>, next: () => Promise<void>) => {
    c.set('userRole', 'owner');
    await next();
  }),
  requirePermission: vi.fn(() => {
    return async (_c: unknown, next: () => Promise<void>) => {
      await next();
    };
  }),
}));

// ============================================================================
// Import module under test (after mocks)
// ============================================================================

const { healthRoute } = await import('./health.js');

// ============================================================================
// Test app
// ============================================================================

function createTestApp() {
  const app = new Hono<AuthContext>();
  app.route('/health', healthRoute);
  return app;
}

// ============================================================================
// Tests
// ============================================================================

describe('GET /health/detail', () => {
  let app: ReturnType<typeof createTestApp>;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createTestApp();
  });

  it('returns healthy when all subsystems are healthy', async () => {
    // AI provider healthy
    const mockProvider = { name: 'claude', tier: 1 };
    mockGetActiveProvider.mockReturnValue(mockProvider);
    mockCheckProviderHealth.mockResolvedValue({
      provider: 'claude',
      available: true,
      tier: 1,
    });

    // DB healthy
    const mockDb = { pragma: vi.fn() };
    mockGetRawDatabase.mockReturnValue(mockDb);

    // WS healthy
    mockGetInstallServer.mockReturnValue(mockInstallServer);
    mockInstallServer.isRunning.mockReturnValue(true);
    mockInstallServer.getClientCount.mockReturnValue(3);
    mockInstallServer.getMaxConnections.mockReturnValue(100);

    // RAG healthy
    mockGetRagPipeline.mockReturnValue(mockRagPipeline);
    mockRagPipeline.isReady.mockReturnValue(true);
    mockRagPipeline.getIndexedDocCount.mockReturnValue(10);

    const res = await app.request('/health/detail');
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.status).toBe('healthy');
    expect(body.timestamp).toBeTypeOf('number');
    expect(body.subsystems.aiProvider.status).toBe('healthy');
    expect(body.subsystems.aiProvider.provider).toBe('claude');
    expect(body.subsystems.database.status).toBe('healthy');
    expect(body.subsystems.database.type).toBe('sqlite');
    expect(body.subsystems.websocket.status).toBe('healthy');
    expect(body.subsystems.websocket.connections).toBe(3);
    expect(body.subsystems.websocket.maxConnections).toBe(100);
    expect(body.subsystems.rag.status).toBe('healthy');
    expect(body.subsystems.rag.indexedDocs).toBe(10);
  });

  it('returns degraded when AI provider is unavailable', async () => {
    mockGetActiveProvider.mockReturnValue(null);

    const mockDb = { pragma: vi.fn() };
    mockGetRawDatabase.mockReturnValue(mockDb);

    mockGetInstallServer.mockReturnValue(mockInstallServer);
    mockInstallServer.isRunning.mockReturnValue(true);
    mockInstallServer.getClientCount.mockReturnValue(0);
    mockInstallServer.getMaxConnections.mockReturnValue(100);

    mockGetRagPipeline.mockReturnValue(mockRagPipeline);
    mockRagPipeline.isReady.mockReturnValue(true);
    mockRagPipeline.getIndexedDocCount.mockReturnValue(5);

    const res = await app.request('/health/detail');
    const body = await res.json();

    expect(body.status).toBe('degraded');
    expect(body.subsystems.aiProvider.status).toBe('unhealthy');
    expect(body.subsystems.aiProvider.message).toBe('No AI provider configured');
  });

  it('returns degraded when database is not initialized', async () => {
    const mockProvider = { name: 'claude', tier: 1 };
    mockGetActiveProvider.mockReturnValue(mockProvider);
    mockCheckProviderHealth.mockResolvedValue({
      provider: 'claude',
      available: true,
      tier: 1,
    });

    mockGetRawDatabase.mockImplementation(() => {
      throw new Error('Database not initialized');
    });

    mockGetInstallServer.mockReturnValue(mockInstallServer);
    mockInstallServer.isRunning.mockReturnValue(true);
    mockInstallServer.getClientCount.mockReturnValue(0);
    mockInstallServer.getMaxConnections.mockReturnValue(100);

    mockGetRagPipeline.mockReturnValue(mockRagPipeline);
    mockRagPipeline.isReady.mockReturnValue(true);
    mockRagPipeline.getIndexedDocCount.mockReturnValue(5);

    const res = await app.request('/health/detail');
    const body = await res.json();

    expect(body.status).toBe('degraded');
    expect(body.subsystems.database.status).toBe('unhealthy');
    expect(body.subsystems.database.message).toContain('Database not initialized');
  });

  it('returns degraded when WebSocket server is not running', async () => {
    const mockProvider = { name: 'openai', tier: 2 };
    mockGetActiveProvider.mockReturnValue(mockProvider);
    mockCheckProviderHealth.mockResolvedValue({
      provider: 'openai',
      available: true,
      tier: 2,
    });

    const mockDb = { pragma: vi.fn() };
    mockGetRawDatabase.mockReturnValue(mockDb);

    mockGetInstallServer.mockReturnValue(mockInstallServer);
    mockInstallServer.isRunning.mockReturnValue(false);
    mockInstallServer.getMaxConnections.mockReturnValue(100);

    mockGetRagPipeline.mockReturnValue(mockRagPipeline);
    mockRagPipeline.isReady.mockReturnValue(true);
    mockRagPipeline.getIndexedDocCount.mockReturnValue(5);

    const res = await app.request('/health/detail');
    const body = await res.json();

    expect(body.status).toBe('degraded');
    expect(body.subsystems.websocket.status).toBe('unhealthy');
    expect(body.subsystems.websocket.message).toBe('WebSocket server not running');
  });

  it('returns degraded when WebSocket server is not initialized', async () => {
    const mockProvider = { name: 'claude', tier: 1 };
    mockGetActiveProvider.mockReturnValue(mockProvider);
    mockCheckProviderHealth.mockResolvedValue({
      provider: 'claude',
      available: true,
      tier: 1,
    });

    const mockDb = { pragma: vi.fn() };
    mockGetRawDatabase.mockReturnValue(mockDb);

    mockGetInstallServer.mockReturnValue(null);

    mockGetRagPipeline.mockReturnValue(mockRagPipeline);
    mockRagPipeline.isReady.mockReturnValue(true);
    mockRagPipeline.getIndexedDocCount.mockReturnValue(5);

    const res = await app.request('/health/detail');
    const body = await res.json();

    expect(body.status).toBe('degraded');
    expect(body.subsystems.websocket.status).toBe('unhealthy');
    expect(body.subsystems.websocket.message).toBe('WebSocket server not initialized');
  });

  it('returns degraded when RAG pipeline is not initialized', async () => {
    const mockProvider = { name: 'claude', tier: 1 };
    mockGetActiveProvider.mockReturnValue(mockProvider);
    mockCheckProviderHealth.mockResolvedValue({
      provider: 'claude',
      available: true,
      tier: 1,
    });

    const mockDb = { pragma: vi.fn() };
    mockGetRawDatabase.mockReturnValue(mockDb);

    mockGetInstallServer.mockReturnValue(mockInstallServer);
    mockInstallServer.isRunning.mockReturnValue(true);
    mockInstallServer.getClientCount.mockReturnValue(0);
    mockInstallServer.getMaxConnections.mockReturnValue(100);

    mockGetRagPipeline.mockReturnValue(null);

    const res = await app.request('/health/detail');
    const body = await res.json();

    expect(body.status).toBe('degraded');
    expect(body.subsystems.rag.status).toBe('unhealthy');
    expect(body.subsystems.rag.message).toBe('RAG pipeline not initialized');
  });

  it('returns degraded when RAG pipeline has no indexed docs', async () => {
    const mockProvider = { name: 'claude', tier: 1 };
    mockGetActiveProvider.mockReturnValue(mockProvider);
    mockCheckProviderHealth.mockResolvedValue({
      provider: 'claude',
      available: true,
      tier: 1,
    });

    const mockDb = { pragma: vi.fn() };
    mockGetRawDatabase.mockReturnValue(mockDb);

    mockGetInstallServer.mockReturnValue(mockInstallServer);
    mockInstallServer.isRunning.mockReturnValue(true);
    mockInstallServer.getClientCount.mockReturnValue(0);
    mockInstallServer.getMaxConnections.mockReturnValue(100);

    mockGetRagPipeline.mockReturnValue(mockRagPipeline);
    mockRagPipeline.isReady.mockReturnValue(false);
    mockRagPipeline.getIndexedDocCount.mockReturnValue(0);

    const res = await app.request('/health/detail');
    const body = await res.json();

    expect(body.status).toBe('degraded');
    expect(body.subsystems.rag.status).toBe('unhealthy');
    expect(body.subsystems.rag.indexedDocs).toBe(0);
  });

  it('returns unhealthy when all subsystems are down', async () => {
    mockGetActiveProvider.mockReturnValue(null);

    mockGetRawDatabase.mockImplementation(() => {
      throw new Error('DB gone');
    });

    mockGetInstallServer.mockReturnValue(null);

    mockGetRagPipeline.mockReturnValue(null);

    const res = await app.request('/health/detail');
    const body = await res.json();

    expect(body.status).toBe('unhealthy');
    expect(body.subsystems.aiProvider.status).toBe('unhealthy');
    expect(body.subsystems.database.status).toBe('unhealthy');
    expect(body.subsystems.websocket.status).toBe('unhealthy');
    expect(body.subsystems.rag.status).toBe('unhealthy');
  });

  it('returns AI provider health error message when check fails', async () => {
    const mockProvider = { name: 'claude', tier: 1 };
    mockGetActiveProvider.mockReturnValue(mockProvider);
    mockCheckProviderHealth.mockResolvedValue({
      provider: 'claude',
      available: false,
      tier: 1,
      error: 'API key invalid',
    });

    const mockDb = { pragma: vi.fn() };
    mockGetRawDatabase.mockReturnValue(mockDb);

    mockGetInstallServer.mockReturnValue(mockInstallServer);
    mockInstallServer.isRunning.mockReturnValue(true);
    mockInstallServer.getClientCount.mockReturnValue(0);
    mockInstallServer.getMaxConnections.mockReturnValue(100);

    mockGetRagPipeline.mockReturnValue(mockRagPipeline);
    mockRagPipeline.isReady.mockReturnValue(true);
    mockRagPipeline.getIndexedDocCount.mockReturnValue(5);

    const res = await app.request('/health/detail');
    const body = await res.json();

    expect(body.status).toBe('degraded');
    expect(body.subsystems.aiProvider.status).toBe('unhealthy');
    expect(body.subsystems.aiProvider.provider).toBe('claude');
    expect(body.subsystems.aiProvider.message).toBe('API key invalid');
  });

  it('omits message field when subsystem is healthy', async () => {
    const mockProvider = { name: 'claude', tier: 1 };
    mockGetActiveProvider.mockReturnValue(mockProvider);
    mockCheckProviderHealth.mockResolvedValue({
      provider: 'claude',
      available: true,
      tier: 1,
    });

    const mockDb = { pragma: vi.fn() };
    mockGetRawDatabase.mockReturnValue(mockDb);

    mockGetInstallServer.mockReturnValue(mockInstallServer);
    mockInstallServer.isRunning.mockReturnValue(true);
    mockInstallServer.getClientCount.mockReturnValue(0);
    mockInstallServer.getMaxConnections.mockReturnValue(100);

    mockGetRagPipeline.mockReturnValue(mockRagPipeline);
    mockRagPipeline.isReady.mockReturnValue(true);
    mockRagPipeline.getIndexedDocCount.mockReturnValue(5);

    const res = await app.request('/health/detail');
    const body = await res.json();

    expect(body.status).toBe('healthy');
    // Healthy subsystems should NOT have a message field
    expect(body.subsystems.aiProvider.message).toBeUndefined();
    expect(body.subsystems.database.message).toBeUndefined();
    expect(body.subsystems.websocket.message).toBeUndefined();
    expect(body.subsystems.rag.message).toBeUndefined();
  });

  it('returns degraded with multiple unhealthy subsystems (not unhealthy)', async () => {
    // 2 out of 4 unhealthy → degraded, not unhealthy
    mockGetActiveProvider.mockReturnValue(null);

    mockGetRawDatabase.mockImplementation(() => {
      throw new Error('DB gone');
    });

    mockGetInstallServer.mockReturnValue(mockInstallServer);
    mockInstallServer.isRunning.mockReturnValue(true);
    mockInstallServer.getClientCount.mockReturnValue(2);
    mockInstallServer.getMaxConnections.mockReturnValue(100);

    mockGetRagPipeline.mockReturnValue(mockRagPipeline);
    mockRagPipeline.isReady.mockReturnValue(true);
    mockRagPipeline.getIndexedDocCount.mockReturnValue(5);

    const res = await app.request('/health/detail');
    const body = await res.json();

    expect(body.status).toBe('degraded');
    // Verify the ones that are healthy
    expect(body.subsystems.websocket.status).toBe('healthy');
    expect(body.subsystems.rag.status).toBe('healthy');
    // And the unhealthy ones
    expect(body.subsystems.aiProvider.status).toBe('unhealthy');
    expect(body.subsystems.database.status).toBe('unhealthy');
  });
});
