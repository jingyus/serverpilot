/**
 * Tests for alert rule management routes.
 *
 * Validates CRUD operations, validation, and user isolation
 * for alert threshold rule endpoints.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';

import type { ApiEnv } from './types.js';
import type { AlertRuleRepository, AlertRule } from '../../db/repositories/alert-rule-repository.js';
import { onError } from '../middleware/error-handler.js';

// ============================================================================
// Module Mocks — must be before imports of the module under test
// ============================================================================

const mockRuleRepo: AlertRuleRepository = {
  create: vi.fn(),
  getById: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  listByServer: vi.fn(),
  listByUser: vi.fn(),
  listEnabled: vi.fn(),
  updateLastTriggered: vi.fn(),
};

vi.mock('../../db/repositories/alert-rule-repository.js', () => ({
  getAlertRuleRepository: () => mockRuleRepo,
}));

vi.mock('../middleware/auth.js', () => ({
  requireAuth: vi.fn(async (c: { set: (k: string, v: string) => void }, next: () => Promise<void>) => {
    c.set('userId', 'user-1');
    await next();
  }),
}));

vi.mock('../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Import after mocks
import { alertRules } from './alert-rules.js';

// ============================================================================
// Test App Setup
// ============================================================================

function createTestApp() {
  const app = new Hono<ApiEnv>();
  app.route('/alert-rules', alertRules);
  app.onError(onError);
  return app;
}

function makeRule(overrides: Partial<AlertRule> = {}): AlertRule {
  return {
    id: '550e8400-e29b-41d4-a716-446655440000',
    serverId: '550e8400-e29b-41d4-a716-446655440001',
    userId: 'user-1',
    name: 'High CPU',
    metricType: 'cpu',
    operator: 'gt',
    threshold: 80,
    severity: 'warning',
    enabled: true,
    emailRecipients: ['admin@example.com'],
    cooldownMinutes: 30,
    lastTriggeredAt: null,
    createdAt: new Date('2026-02-09T00:00:00Z').toISOString(),
    updatedAt: new Date('2026-02-09T00:00:00Z').toISOString(),
    ...overrides,
  };
}

// ============================================================================
// Setup
// ============================================================================

let app: ReturnType<typeof createTestApp>;

beforeEach(() => {
  app = createTestApp();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ============================================================================
// POST /alert-rules — Create rule
// ============================================================================

describe('POST /alert-rules', () => {
  it('should create an alert rule with valid input', async () => {
    const newRule = makeRule();
    (mockRuleRepo.create as ReturnType<typeof vi.fn>).mockResolvedValue(newRule);

    const res = await app.request('/alert-rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        serverId: '550e8400-e29b-41d4-a716-446655440001',
        name: 'High CPU',
        metricType: 'cpu',
        operator: 'gt',
        threshold: 80,
        severity: 'warning',
        emailRecipients: ['admin@example.com'],
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.rule.name).toBe('High CPU');
    expect(mockRuleRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        name: 'High CPU',
        metricType: 'cpu',
        operator: 'gt',
        threshold: 80,
      }),
    );
  });

  it('should reject missing required fields', async () => {
    const res = await app.request('/alert-rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Missing server',
        metricType: 'cpu',
      }),
    });

    expect(res.status).toBe(400);
  });

  it('should reject invalid metric type', async () => {
    const res = await app.request('/alert-rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        serverId: '550e8400-e29b-41d4-a716-446655440001',
        name: 'Bad type',
        metricType: 'network',
        operator: 'gt',
        threshold: 80,
        severity: 'warning',
      }),
    });

    expect(res.status).toBe(400);
  });

  it('should reject threshold out of range', async () => {
    const res = await app.request('/alert-rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        serverId: '550e8400-e29b-41d4-a716-446655440001',
        name: 'Bad threshold',
        metricType: 'cpu',
        operator: 'gt',
        threshold: 150,
        severity: 'warning',
      }),
    });

    expect(res.status).toBe(400);
  });

  it('should reject invalid email recipients', async () => {
    const res = await app.request('/alert-rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        serverId: '550e8400-e29b-41d4-a716-446655440001',
        name: 'Bad email',
        metricType: 'cpu',
        operator: 'gt',
        threshold: 80,
        severity: 'warning',
        emailRecipients: ['not-an-email'],
      }),
    });

    expect(res.status).toBe(400);
  });

  it('should return 403 when server access is denied', async () => {
    (mockRuleRepo.create as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Server not found or access denied'),
    );

    const res = await app.request('/alert-rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        serverId: '550e8400-e29b-41d4-a716-446655440001',
        name: 'Denied',
        metricType: 'cpu',
        operator: 'gt',
        threshold: 80,
        severity: 'warning',
      }),
    });

    expect(res.status).toBe(403);
  });
});

// ============================================================================
// GET /alert-rules — List rules
// ============================================================================

describe('GET /alert-rules', () => {
  it('should list all rules for user', async () => {
    const rules = [makeRule()];
    (mockRuleRepo.listByUser as ReturnType<typeof vi.fn>).mockResolvedValue({
      rules,
      total: 1,
    });

    const res = await app.request('/alert-rules');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rules).toHaveLength(1);
    expect(body.total).toBe(1);
    expect(mockRuleRepo.listByUser).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ limit: 50, offset: 0 }),
    );
  });

  it('should filter by serverId', async () => {
    (mockRuleRepo.listByServer as ReturnType<typeof vi.fn>).mockResolvedValue({
      rules: [],
      total: 0,
    });

    const res = await app.request(
      '/alert-rules?serverId=550e8400-e29b-41d4-a716-446655440001',
    );

    expect(res.status).toBe(200);
    expect(mockRuleRepo.listByServer).toHaveBeenCalledWith(
      '550e8400-e29b-41d4-a716-446655440001',
      'user-1',
      expect.objectContaining({ limit: 50, offset: 0 }),
    );
  });

  it('should support pagination', async () => {
    (mockRuleRepo.listByUser as ReturnType<typeof vi.fn>).mockResolvedValue({
      rules: [],
      total: 100,
    });

    const res = await app.request('/alert-rules?limit=10&offset=20');

    expect(res.status).toBe(200);
    expect(mockRuleRepo.listByUser).toHaveBeenCalledWith(
      'user-1',
      { limit: 10, offset: 20 },
    );
  });
});

// ============================================================================
// GET /alert-rules/:id — Get rule details
// ============================================================================

describe('GET /alert-rules/:id', () => {
  it('should return rule by ID', async () => {
    const rule = makeRule();
    (mockRuleRepo.getById as ReturnType<typeof vi.fn>).mockResolvedValue(rule);

    const res = await app.request('/alert-rules/550e8400-e29b-41d4-a716-446655440000');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rule.id).toBe('550e8400-e29b-41d4-a716-446655440000');
  });

  it('should return 404 for non-existent rule', async () => {
    (mockRuleRepo.getById as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const res = await app.request('/alert-rules/550e8400-e29b-41d4-a716-446655440099');

    expect(res.status).toBe(404);
  });
});

// ============================================================================
// PATCH /alert-rules/:id — Update rule
// ============================================================================

describe('PATCH /alert-rules/:id', () => {
  it('should update rule fields', async () => {
    const updated = makeRule({ name: 'Updated CPU', threshold: 95 });
    (mockRuleRepo.update as ReturnType<typeof vi.fn>).mockResolvedValue(updated);

    const res = await app.request('/alert-rules/550e8400-e29b-41d4-a716-446655440000', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Updated CPU', threshold: 95 }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rule.name).toBe('Updated CPU');
    expect(body.rule.threshold).toBe(95);
  });

  it('should toggle enabled state', async () => {
    const updated = makeRule({ enabled: false });
    (mockRuleRepo.update as ReturnType<typeof vi.fn>).mockResolvedValue(updated);

    const res = await app.request('/alert-rules/550e8400-e29b-41d4-a716-446655440000', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rule.enabled).toBe(false);
  });

  it('should return 404 for non-existent rule', async () => {
    (mockRuleRepo.update as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const res = await app.request('/alert-rules/550e8400-e29b-41d4-a716-446655440099', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Updated' }),
    });

    expect(res.status).toBe(404);
  });

  it('should reject invalid threshold in update', async () => {
    const res = await app.request('/alert-rules/550e8400-e29b-41d4-a716-446655440000', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ threshold: 200 }),
    });

    expect(res.status).toBe(400);
  });
});

// ============================================================================
// DELETE /alert-rules/:id — Delete rule
// ============================================================================

describe('DELETE /alert-rules/:id', () => {
  it('should delete a rule', async () => {
    (mockRuleRepo.delete as ReturnType<typeof vi.fn>).mockResolvedValue(true);

    const res = await app.request('/alert-rules/550e8400-e29b-41d4-a716-446655440000', {
      method: 'DELETE',
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it('should return 404 for non-existent rule', async () => {
    (mockRuleRepo.delete as ReturnType<typeof vi.fn>).mockResolvedValue(false);

    const res = await app.request('/alert-rules/550e8400-e29b-41d4-a716-446655440099', {
      method: 'DELETE',
    });

    expect(res.status).toBe(404);
  });
});
