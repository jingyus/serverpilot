// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for settings routes.
 *
 * @module api/routes/settings.test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';

// ============================================================================
// Module Mocks — must be before imports of the module under test
// ============================================================================

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
  requireRole: vi.fn(() => {
    return async (_c: unknown, next: () => Promise<void>) => {
      await next();
    };
  }),
}));

import { settings } from './settings.js';
import { onError } from '../middleware/error-handler.js';
import { initJwtConfig, _resetJwtConfig, generateTokens } from '../middleware/auth.js';
import {
  InMemoryUserRepository,
  setUserRepository,
  _resetUserRepository,
} from '../../db/repositories/user-repository.js';
import {
  InMemorySettingsRepository,
  setSettingsRepository,
  _resetSettingsRepository,
} from '../../db/repositories/settings-repository.js';
import { hashPassword } from '../../utils/password.js';
import { _resetProviderFactory } from '../../ai/providers/provider-factory.js';
import type { ApiEnv } from './types.js';

// ============================================================================
// Helpers
// ============================================================================

const TEST_SECRET = 'test-secret-key-that-is-at-least-32-chars-long!!';

function createTestApp() {
  const app = new Hono<ApiEnv>();
  app.onError(onError);
  app.route('/settings', settings);
  return app;
}

function jsonRequest(
  app: Hono<ApiEnv>,
  path: string,
  method: string,
  body: unknown,
  token?: string,
) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  return app.request(path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
}

// ============================================================================
// Setup / Teardown
// ============================================================================

let userRepo: InMemoryUserRepository;
let settingsRepo: InMemorySettingsRepository;
let accessToken: string;
let userId: string;

beforeEach(async () => {
  _resetJwtConfig();
  _resetUserRepository();
  _resetSettingsRepository();

  initJwtConfig({ secret: TEST_SECRET });

  userRepo = new InMemoryUserRepository();
  setUserRepository(userRepo);

  settingsRepo = new InMemorySettingsRepository();
  setSettingsRepository(settingsRepo);

  // Create a test user
  const passwordHash = await hashPassword('password123');
  const user = await userRepo.create({
    email: 'test@example.com',
    passwordHash,
    name: 'Test User',
  });
  userId = user.id;

  // Generate access token
  const tokens = await generateTokens(userId);
  accessToken = tokens.accessToken;
});

afterEach(() => {
  _resetJwtConfig();
  _resetUserRepository();
  _resetSettingsRepository();
  _resetProviderFactory();
});

// ============================================================================
// GET /settings
// ============================================================================

describe('GET /settings', () => {
  it('should require authentication', async () => {
    const app = createTestApp();
    const res = await app.request('/settings', {
      method: 'GET',
    });

    expect(res.status).toBe(401);
  });

  it('should create default settings if none exist', async () => {
    const app = createTestApp();
    const res = await app.request('/settings', {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.aiProvider.provider).toBe('claude');
    expect(body.userProfile.name).toBe('Test User');
    expect(body.userProfile.email).toBe('test@example.com');
    expect(body.userProfile.timezone).toBe('UTC');
    expect(body.notifications.emailNotifications).toBe(true);
    expect(body.notifications.taskCompletion).toBe(true);
    expect(body.notifications.systemAlerts).toBe(true);
    expect(body.notifications.operationReports).toBe(false);
    expect(body.knowledgeBase.autoLearning).toBe(false);
    expect(body.knowledgeBase.documentSources).toEqual([]);
  });

  it('should return existing settings', async () => {
    // Create settings first
    await settingsRepo.create({
      userId,
      aiProvider: { provider: 'openai', apiKey: 'sk-test' },
      notifications: {
        emailNotifications: false,
        taskCompletion: false,
        systemAlerts: true,
        operationReports: true,
      },
    });

    const app = createTestApp();
    const res = await app.request('/settings', {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.aiProvider.provider).toBe('openai');
    expect(body.aiProvider.apiKey).toBe('sk-test');
    expect(body.notifications.emailNotifications).toBe(false);
    expect(body.notifications.operationReports).toBe(true);
  });
});

// ============================================================================
// PUT /settings/ai-provider
// ============================================================================

describe('PUT /settings/ai-provider', () => {
  it('should require authentication', async () => {
    const app = createTestApp();
    const res = await jsonRequest(app, '/settings/ai-provider', 'PUT', {
      provider: 'openai',
    });

    expect(res.status).toBe(401);
  });

  it('should update AI provider settings', async () => {
    const app = createTestApp();
    const res = await jsonRequest(
      app,
      '/settings/ai-provider',
      'PUT',
      {
        provider: 'openai',
        apiKey: 'sk-test-key',
        model: 'gpt-4',
      },
      accessToken,
    );

    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.aiProvider.provider).toBe('openai');
    expect(body.aiProvider.apiKey).toBe('sk-test-key');
    expect(body.aiProvider.model).toBe('gpt-4');
  });

  it('should validate provider enum', async () => {
    const app = createTestApp();
    const res = await jsonRequest(
      app,
      '/settings/ai-provider',
      'PUT',
      {
        provider: 'invalid-provider',
      },
      accessToken,
    );

    expect(res.status).toBe(400);
  });

  it('should allow optional fields', async () => {
    const app = createTestApp();
    const res = await jsonRequest(
      app,
      '/settings/ai-provider',
      'PUT',
      {
        provider: 'ollama',
        baseUrl: 'http://localhost:11434',
      },
      accessToken,
    );

    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.aiProvider.provider).toBe('ollama');
    expect(body.aiProvider.baseUrl).toBe('http://localhost:11434');
  });
});

// ============================================================================
// PUT /settings/profile
// ============================================================================

describe('PUT /settings/profile', () => {
  it('should require authentication', async () => {
    const app = createTestApp();
    const res = await jsonRequest(app, '/settings/profile', 'PUT', {
      name: 'New Name',
      email: 'test@example.com',
      timezone: 'America/New_York',
    });

    expect(res.status).toBe(401);
  });

  it('should update user profile', async () => {
    const app = createTestApp();
    const res = await jsonRequest(
      app,
      '/settings/profile',
      'PUT',
      {
        name: 'Updated Name',
        email: 'test@example.com',
        timezone: 'Asia/Shanghai',
      },
      accessToken,
    );

    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.userProfile.name).toBe('Updated Name');
    expect(body.userProfile.timezone).toBe('Asia/Shanghai');
  });

  it('should validate email format', async () => {
    const app = createTestApp();
    const res = await jsonRequest(
      app,
      '/settings/profile',
      'PUT',
      {
        name: 'Test',
        email: 'invalid-email',
        timezone: 'UTC',
      },
      accessToken,
    );

    expect(res.status).toBe(400);
  });

  it('should require all fields', async () => {
    const app = createTestApp();
    const res = await jsonRequest(
      app,
      '/settings/profile',
      'PUT',
      {
        name: 'Test',
        // Missing email and timezone
      },
      accessToken,
    );

    expect(res.status).toBe(400);
  });
});

// ============================================================================
// PUT /settings/notifications
// ============================================================================

describe('PUT /settings/notifications', () => {
  it('should require authentication', async () => {
    const app = createTestApp();
    const res = await jsonRequest(app, '/settings/notifications', 'PUT', {
      emailNotifications: false,
      taskCompletion: false,
      systemAlerts: true,
      operationReports: true,
    });

    expect(res.status).toBe(401);
  });

  it('should update notification preferences', async () => {
    const app = createTestApp();
    const res = await jsonRequest(
      app,
      '/settings/notifications',
      'PUT',
      {
        emailNotifications: false,
        taskCompletion: false,
        systemAlerts: true,
        operationReports: true,
      },
      accessToken,
    );

    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.notifications.emailNotifications).toBe(false);
    expect(body.notifications.taskCompletion).toBe(false);
    expect(body.notifications.systemAlerts).toBe(true);
    expect(body.notifications.operationReports).toBe(true);
  });

  it('should validate boolean types', async () => {
    const app = createTestApp();
    const res = await jsonRequest(
      app,
      '/settings/notifications',
      'PUT',
      {
        emailNotifications: 'not-a-boolean',
        taskCompletion: true,
        systemAlerts: true,
        operationReports: false,
      },
      accessToken,
    );

    expect(res.status).toBe(400);
  });

  it('should require all notification fields', async () => {
    const app = createTestApp();
    const res = await jsonRequest(
      app,
      '/settings/notifications',
      'PUT',
      {
        emailNotifications: true,
        // Missing other fields
      },
      accessToken,
    );

    expect(res.status).toBe(400);
  });
});

// ============================================================================
// PUT /settings/knowledge-base
// ============================================================================

describe('PUT /settings/knowledge-base', () => {
  it('should require authentication', async () => {
    const app = createTestApp();
    const res = await jsonRequest(app, '/settings/knowledge-base', 'PUT', {
      autoLearning: true,
      documentSources: ['source-1'],
    });

    expect(res.status).toBe(401);
  });

  it('should update knowledge base settings', async () => {
    const app = createTestApp();
    const res = await jsonRequest(
      app,
      '/settings/knowledge-base',
      'PUT',
      {
        autoLearning: true,
        documentSources: ['source-1', 'source-2'],
      },
      accessToken,
    );

    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.knowledgeBase.autoLearning).toBe(true);
    expect(body.knowledgeBase.documentSources).toEqual(['source-1', 'source-2']);
  });

  it('should validate array length limit', async () => {
    const app = createTestApp();
    const sources = Array(51)
      .fill(0)
      .map((_, i) => `source-${i}`);

    const res = await jsonRequest(
      app,
      '/settings/knowledge-base',
      'PUT',
      {
        autoLearning: true,
        documentSources: sources,
      },
      accessToken,
    );

    expect(res.status).toBe(400);
  });

  it('should allow empty document sources', async () => {
    const app = createTestApp();
    const res = await jsonRequest(
      app,
      '/settings/knowledge-base',
      'PUT',
      {
        autoLearning: false,
        documentSources: [],
      },
      accessToken,
    );

    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.knowledgeBase.autoLearning).toBe(false);
    expect(body.knowledgeBase.documentSources).toEqual([]);
  });
});

// ============================================================================
// PUT /settings/ai-provider — custom-openai
// ============================================================================

describe('PUT /settings/ai-provider (custom-openai)', () => {
  it('should switch to custom-openai with full config', async () => {
    const app = createTestApp();
    const res = await jsonRequest(
      app,
      '/settings/ai-provider',
      'PUT',
      {
        provider: 'custom-openai',
        baseUrl: 'https://my-oneapi.example.com/v1',
        apiKey: 'sk-custom-key-123',
        model: 'gpt-4o',
      },
      accessToken,
    );

    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.aiProvider.provider).toBe('custom-openai');
    expect(body.aiProvider.baseUrl).toBe('https://my-oneapi.example.com/v1');
    expect(body.aiProvider.apiKey).toBe('sk-custom-key-123');
    expect(body.aiProvider.model).toBe('gpt-4o');
  });

  it('should reject custom-openai without baseUrl', async () => {
    const app = createTestApp();
    const res = await jsonRequest(
      app,
      '/settings/ai-provider',
      'PUT',
      {
        provider: 'custom-openai',
        apiKey: 'sk-custom-key',
        model: 'gpt-4o',
      },
      accessToken,
    );

    // setActiveProvider → createProvider → CustomOpenAIConfigSchema.parse
    // fails because baseUrl defaults to '' which is not a valid URL
    expect(res.status).toBe(400);
  });

  it('should reject custom-openai without apiKey', async () => {
    const app = createTestApp();
    const res = await jsonRequest(
      app,
      '/settings/ai-provider',
      'PUT',
      {
        provider: 'custom-openai',
        baseUrl: 'https://my-oneapi.example.com/v1',
        model: 'gpt-4o',
      },
      accessToken,
    );

    expect(res.status).toBe(400);
  });

  it('should reject custom-openai without model', async () => {
    const app = createTestApp();
    const res = await jsonRequest(
      app,
      '/settings/ai-provider',
      'PUT',
      {
        provider: 'custom-openai',
        baseUrl: 'https://my-oneapi.example.com/v1',
        apiKey: 'sk-custom-key',
      },
      accessToken,
    );

    expect(res.status).toBe(400);
  });

  it('should persist custom-openai in GET /settings', async () => {
    const app = createTestApp();

    // Switch to custom-openai
    await jsonRequest(
      app,
      '/settings/ai-provider',
      'PUT',
      {
        provider: 'custom-openai',
        baseUrl: 'https://litellm.internal.corp/v1',
        apiKey: 'sk-litellm-key',
        model: 'deepseek-chat',
      },
      accessToken,
    );

    // Verify persistence via GET
    const res = await app.request('/settings', {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.aiProvider.provider).toBe('custom-openai');
    expect(body.aiProvider.baseUrl).toBe('https://litellm.internal.corp/v1');
    expect(body.aiProvider.apiKey).toBe('sk-litellm-key');
    expect(body.aiProvider.model).toBe('deepseek-chat');
  });
});

// ============================================================================
// GET /settings/ai-provider/health — custom-openai
// ============================================================================

describe('GET /settings/ai-provider/health (custom-openai)', () => {
  it('should return health status for custom-openai provider', async () => {
    const app = createTestApp();

    // Switch to custom-openai first
    await jsonRequest(
      app,
      '/settings/ai-provider',
      'PUT',
      {
        provider: 'custom-openai',
        baseUrl: 'https://my-oneapi.example.com/v1',
        apiKey: 'sk-custom-key',
        model: 'gpt-4o',
      },
      accessToken,
    );

    // Check health — will be unavailable since the URL doesn't exist,
    // but the endpoint should respond with the correct structure
    const res = await app.request('/settings/ai-provider/health', {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.provider).toBe('custom-openai');
    expect(typeof body.available).toBe('boolean');
    expect(body.tier).toBe(2);
  });
});

// ============================================================================
// Integration: Multiple Updates
// ============================================================================

describe('Integration: Multiple Updates', () => {
  it('should persist changes across multiple requests', async () => {
    const app = createTestApp();

    // Update AI provider
    await jsonRequest(
      app,
      '/settings/ai-provider',
      'PUT',
      {
        provider: 'openai',
        apiKey: 'sk-test',
      },
      accessToken,
    );

    // Update notifications
    await jsonRequest(
      app,
      '/settings/notifications',
      'PUT',
      {
        emailNotifications: false,
        taskCompletion: false,
        systemAlerts: true,
        operationReports: true,
      },
      accessToken,
    );

    // Get all settings
    const res = await app.request('/settings', {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json();

    // Verify all changes persisted
    expect(body.aiProvider.provider).toBe('openai');
    expect(body.aiProvider.apiKey).toBe('sk-test');
    expect(body.notifications.emailNotifications).toBe(false);
    expect(body.notifications.operationReports).toBe(true);
  });
});
