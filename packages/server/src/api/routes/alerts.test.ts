// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for alert management routes.
 *
 * Validates list, detail, and resolve operations
 * with filtering, pagination, and error handling.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';

import type { ApiEnv } from './types.js';
import type { Alert, AlertRepository } from '../../db/repositories/alert-repository.js';
import { onError } from '../middleware/error-handler.js';

// ============================================================================
// Module Mocks — must be before imports of the module under test
// ============================================================================

const mockAlertRepo: AlertRepository = {
  create: vi.fn(),
  getById: vi.fn(),
  resolve: vi.fn(),
  listUnresolved: vi.fn(),
  listByServer: vi.fn(),
  listByType: vi.fn(),
};

vi.mock('../../db/repositories/alert-repository.js', () => ({
  getAlertRepository: () => mockAlertRepo,
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

vi.mock('../middleware/validate.js', () => ({
  validateQuery: vi.fn(() => {
    return async (c: { req: { query: () => Record<string, string> }; set: (k: string, v: unknown) => void }, next: () => Promise<void>) => {
      const raw = c.req.query();
      // Coerce resolved to boolean if present
      const parsed: Record<string, unknown> = { ...raw };
      if (raw.resolved === 'false') {
        parsed.resolved = false;
      } else if (raw.resolved === 'true') {
        parsed.resolved = true;
      }
      // Coerce limit/offset to numbers if present
      if (raw.limit) parsed.limit = Number(raw.limit);
      if (raw.offset) parsed.offset = Number(raw.offset);
      c.set('validatedQuery', parsed);
      await next();
    };
  }),
  validateBody: vi.fn(() => {
    return async (_c: unknown, next: () => Promise<void>) => {
      await next();
    };
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
import { alerts as alertsRoute } from './alerts.js';

// ============================================================================
// Test App Setup
// ============================================================================

function createTestApp() {
  const app = new Hono<ApiEnv>();
  app.route('/alerts', alertsRoute);
  app.onError(onError);
  return app;
}

function makeAlert(overrides: Partial<Alert> = {}): Alert {
  return {
    id: '550e8400-e29b-41d4-a716-446655440000',
    serverId: '550e8400-e29b-41d4-a716-446655440001',
    type: 'cpu',
    severity: 'warning',
    message: 'CPU usage exceeded 90%',
    value: '92',
    threshold: '90',
    resolved: false,
    resolvedAt: null,
    createdAt: new Date('2026-02-10T12:00:00Z').toISOString(),
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
// GET /alerts — List alerts
// ============================================================================

describe('GET /alerts', () => {
  it('should list unresolved alerts by default', async () => {
    const alertList = [makeAlert()];
    (mockAlertRepo.listUnresolved as ReturnType<typeof vi.fn>).mockResolvedValue({
      alerts: alertList,
      total: 1,
    });

    const res = await app.request('/alerts');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.alerts).toHaveLength(1);
    expect(body.total).toBe(1);
    expect(body.limit).toBe(20);
    expect(body.offset).toBe(0);
    expect(mockAlertRepo.listUnresolved).toHaveBeenCalledWith(
      'user-1',
      { limit: 20, offset: 0 },
    );
  });

  it('should filter by serverId when provided', async () => {
    const serverId = '550e8400-e29b-41d4-a716-446655440001';
    (mockAlertRepo.listByServer as ReturnType<typeof vi.fn>).mockResolvedValue({
      alerts: [],
      total: 0,
    });

    const res = await app.request(`/alerts?serverId=${serverId}`);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.alerts).toHaveLength(0);
    expect(body.total).toBe(0);
    expect(mockAlertRepo.listByServer).toHaveBeenCalledWith(
      serverId,
      'user-1',
      { limit: 20, offset: 0 },
    );
    expect(mockAlertRepo.listUnresolved).not.toHaveBeenCalled();
  });

  it('should filter by resolved=false explicitly', async () => {
    const alertList = [makeAlert(), makeAlert({ id: '550e8400-e29b-41d4-a716-446655440002' })];
    (mockAlertRepo.listUnresolved as ReturnType<typeof vi.fn>).mockResolvedValue({
      alerts: alertList,
      total: 2,
    });

    const res = await app.request('/alerts?resolved=false');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.alerts).toHaveLength(2);
    expect(body.total).toBe(2);
    expect(mockAlertRepo.listUnresolved).toHaveBeenCalledWith(
      'user-1',
      { limit: 20, offset: 0 },
    );
  });

  it('should support custom limit and offset', async () => {
    (mockAlertRepo.listUnresolved as ReturnType<typeof vi.fn>).mockResolvedValue({
      alerts: [],
      total: 50,
    });

    const res = await app.request('/alerts?limit=10&offset=20');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.limit).toBe(10);
    expect(body.offset).toBe(20);
    expect(mockAlertRepo.listUnresolved).toHaveBeenCalledWith(
      'user-1',
      { limit: 10, offset: 20 },
    );
  });

  it('should support serverId with custom limit and offset', async () => {
    const serverId = '550e8400-e29b-41d4-a716-446655440001';
    (mockAlertRepo.listByServer as ReturnType<typeof vi.fn>).mockResolvedValue({
      alerts: [makeAlert()],
      total: 1,
    });

    const res = await app.request(`/alerts?serverId=${serverId}&limit=5&offset=10`);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.limit).toBe(5);
    expect(body.offset).toBe(10);
    expect(mockAlertRepo.listByServer).toHaveBeenCalledWith(
      serverId,
      'user-1',
      { limit: 5, offset: 10 },
    );
  });

  it('should return empty list when no alerts exist', async () => {
    (mockAlertRepo.listUnresolved as ReturnType<typeof vi.fn>).mockResolvedValue({
      alerts: [],
      total: 0,
    });

    const res = await app.request('/alerts');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.alerts).toEqual([]);
    expect(body.total).toBe(0);
  });

  it('should use default limit/offset when query omits pagination', async () => {
    (mockAlertRepo.listUnresolved as ReturnType<typeof vi.fn>).mockResolvedValue({
      alerts: [],
      total: 0,
    });

    const res = await app.request('/alerts');

    expect(res.status).toBe(200);
    expect(mockAlertRepo.listUnresolved).toHaveBeenCalledWith(
      'user-1',
      { limit: 20, offset: 0 },
    );
  });
});

// ============================================================================
// GET /alerts/:id — Get alert details
// ============================================================================

describe('GET /alerts/:id', () => {
  it('should return alert by ID', async () => {
    const alert = makeAlert();
    (mockAlertRepo.getById as ReturnType<typeof vi.fn>).mockResolvedValue(alert);

    const res = await app.request('/alerts/550e8400-e29b-41d4-a716-446655440000');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.alert.id).toBe('550e8400-e29b-41d4-a716-446655440000');
    expect(body.alert.type).toBe('cpu');
    expect(body.alert.severity).toBe('warning');
    expect(body.alert.message).toBe('CPU usage exceeded 90%');
    expect(mockAlertRepo.getById).toHaveBeenCalledWith(
      '550e8400-e29b-41d4-a716-446655440000',
      'user-1',
    );
  });

  it('should return 404 when alert is not found', async () => {
    (mockAlertRepo.getById as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const res = await app.request('/alerts/550e8400-e29b-41d4-a716-446655440099');

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.message).toBe('Alert not found');
  });

  it('should return a resolved alert', async () => {
    const resolvedAlert = makeAlert({
      resolved: true,
      resolvedAt: new Date('2026-02-10T14:00:00Z').toISOString(),
    });
    (mockAlertRepo.getById as ReturnType<typeof vi.fn>).mockResolvedValue(resolvedAlert);

    const res = await app.request('/alerts/550e8400-e29b-41d4-a716-446655440000');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.alert.resolved).toBe(true);
    expect(body.alert.resolvedAt).toBe('2026-02-10T14:00:00.000Z');
  });
});

// ============================================================================
// PATCH /alerts/:id/resolve — Mark alert as resolved
// ============================================================================

describe('PATCH /alerts/:id/resolve', () => {
  it('should resolve an alert successfully', async () => {
    const resolvedAlert = makeAlert({
      resolved: true,
      resolvedAt: new Date('2026-02-10T14:00:00Z').toISOString(),
    });
    (mockAlertRepo.resolve as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (mockAlertRepo.getById as ReturnType<typeof vi.fn>).mockResolvedValue(resolvedAlert);

    const res = await app.request('/alerts/550e8400-e29b-41d4-a716-446655440000/resolve', {
      method: 'PATCH',
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.alert.resolved).toBe(true);
    expect(body.alert.resolvedAt).toBe('2026-02-10T14:00:00.000Z');
    expect(mockAlertRepo.resolve).toHaveBeenCalledWith(
      '550e8400-e29b-41d4-a716-446655440000',
      'user-1',
    );
  });

  it('should return 404 when alert to resolve is not found', async () => {
    (mockAlertRepo.resolve as ReturnType<typeof vi.fn>).mockResolvedValue(false);

    const res = await app.request('/alerts/550e8400-e29b-41d4-a716-446655440099/resolve', {
      method: 'PATCH',
    });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.message).toBe('Alert not found');
  });

  it('should fetch updated alert after resolving', async () => {
    const alertId = '550e8400-e29b-41d4-a716-446655440000';
    const resolvedAlert = makeAlert({
      id: alertId,
      resolved: true,
      resolvedAt: new Date('2026-02-10T15:30:00Z').toISOString(),
    });
    (mockAlertRepo.resolve as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (mockAlertRepo.getById as ReturnType<typeof vi.fn>).mockResolvedValue(resolvedAlert);

    const res = await app.request(`/alerts/${alertId}/resolve`, {
      method: 'PATCH',
    });

    expect(res.status).toBe(200);
    // Verify resolve was called before getById
    expect(mockAlertRepo.resolve).toHaveBeenCalledTimes(1);
    expect(mockAlertRepo.getById).toHaveBeenCalledTimes(1);
    expect(mockAlertRepo.getById).toHaveBeenCalledWith(alertId, 'user-1');
  });

  it('should not call getById if resolve returns false', async () => {
    (mockAlertRepo.resolve as ReturnType<typeof vi.fn>).mockResolvedValue(false);

    const res = await app.request('/alerts/550e8400-e29b-41d4-a716-446655440099/resolve', {
      method: 'PATCH',
    });

    expect(res.status).toBe(404);
    expect(mockAlertRepo.resolve).toHaveBeenCalledTimes(1);
    expect(mockAlertRepo.getById).not.toHaveBeenCalled();
  });
});
