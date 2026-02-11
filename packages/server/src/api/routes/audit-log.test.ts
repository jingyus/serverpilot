// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for audit log routes.
 *
 * Validates query endpoint and CSV export with streaming.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';

import type { ApiEnv } from './types.js';
import type { AuditLogEntry, AuditLogFilter, AuditLogPagination } from '../../core/security/audit-logger.js';
import { onError } from '../middleware/error-handler.js';

// ============================================================================
// Module Mocks
// ============================================================================

const mockAuditLogger = {
  log: vi.fn(),
  updateExecutionResult: vi.fn(),
  query: vi.fn(),
  queryAll: vi.fn(),
};

vi.mock('../../core/security/audit-logger.js', () => ({
  getAuditLogger: () => mockAuditLogger,
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

// Import after mocks
import { auditLog } from './audit-log.js';

// ============================================================================
// Test App Setup
// ============================================================================

function createTestApp() {
  const app = new Hono<ApiEnv>();
  app.route('/audit-log', auditLog);
  app.onError(onError);
  return app;
}

function makeEntry(overrides: Partial<AuditLogEntry> = {}): AuditLogEntry {
  return {
    id: 'al-1',
    serverId: 'srv-1',
    userId: 'user-1',
    sessionId: null,
    command: 'ls -la',
    riskLevel: 'green',
    reason: 'Read-only command',
    matchedPattern: 'ls',
    action: 'allowed',
    auditWarnings: [],
    auditBlockers: [],
    executionResult: 'success',
    operationId: 'op-1',
    createdAt: '2026-02-09T10:00:00.000Z',
    ...overrides,
  };
}

// ============================================================================
// Tests: GET /audit-log
// ============================================================================

describe('GET /audit-log', () => {
  let app: ReturnType<typeof createTestApp>;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createTestApp();
  });

  it('returns audit logs with default pagination', async () => {
    mockAuditLogger.query.mockResolvedValue({
      logs: [makeEntry()],
      total: 1,
    });

    const res = await app.request('/audit-log');
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.logs).toHaveLength(1);
    expect(body.total).toBe(1);
    expect(body.limit).toBe(50);
    expect(body.offset).toBe(0);
  });

  it('passes filter params to the logger', async () => {
    mockAuditLogger.query.mockResolvedValue({ logs: [], total: 0 });

    await app.request('/audit-log?serverId=srv-1&riskLevel=red&limit=10&offset=5');

    expect(mockAuditLogger.query).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        serverId: 'srv-1',
        riskLevel: 'red',
      }),
      { limit: 10, offset: 5 },
    );
  });

  it('rejects invalid riskLevel', async () => {
    const res = await app.request('/audit-log?riskLevel=invalid');
    expect(res.status).toBe(400);
  });

  it('rejects limit over 100', async () => {
    const res = await app.request('/audit-log?limit=999');
    expect(res.status).toBe(400);
  });
});

// ============================================================================
// Tests: GET /audit-log/export
// ============================================================================

describe('GET /audit-log/export', () => {
  let app: ReturnType<typeof createTestApp>;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createTestApp();
  });

  it('returns CSV with correct headers and content type', async () => {
    mockAuditLogger.queryAll.mockResolvedValue([makeEntry()]);

    const res = await app.request('/audit-log/export?format=csv');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/csv');
    expect(res.headers.get('Content-Disposition')).toContain('attachment');
    expect(res.headers.get('Content-Disposition')).toContain('.csv');

    const text = await res.text();
    expect(text).toContain('Time,User ID,Server ID,Command,Risk Level,Action,Status,Reason,Warnings,Blockers');
    expect(text).toContain('ls -la');
    expect(text).toContain('green');
    expect(text).toContain('allowed');
  });

  it('uses date range in filename when from/to provided', async () => {
    mockAuditLogger.queryAll.mockResolvedValue([]);

    const res = await app.request(
      '/audit-log/export?format=csv&from=2026-02-01T00:00:00Z&to=2026-02-09T23:59:59Z',
    );
    expect(res.status).toBe(200);

    const disposition = res.headers.get('Content-Disposition') ?? '';
    expect(disposition).toContain('audit-log-2026-02-01-2026-02-09.csv');
  });

  it('uses generic filename when no date range', async () => {
    mockAuditLogger.queryAll.mockResolvedValue([]);

    const res = await app.request('/audit-log/export?format=csv');
    expect(res.status).toBe(200);

    const disposition = res.headers.get('Content-Disposition') ?? '';
    expect(disposition).toContain('audit-log-export-');
    expect(disposition).toContain('.csv');
  });

  it('passes filter params to queryAll', async () => {
    mockAuditLogger.queryAll.mockResolvedValue([]);

    await app.request(
      '/audit-log/export?format=csv&serverId=srv-2&riskLevel=critical&from=2026-02-01T00:00:00Z&to=2026-02-09T23:59:59Z',
    );

    expect(mockAuditLogger.queryAll).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        serverId: 'srv-2',
        riskLevel: 'critical',
        startDate: '2026-02-01T00:00:00Z',
        endDate: '2026-02-09T23:59:59Z',
      }),
    );
  });

  it('escapes CSV fields with commas and quotes', async () => {
    mockAuditLogger.queryAll.mockResolvedValue([
      makeEntry({
        id: 'al-csv',
        command: 'echo "hello, world"',
        reason: 'Contains "special" chars, and commas',
        auditWarnings: ['warn1; warn2'],
        auditBlockers: ['block "a"'],
      }),
    ]);

    const res = await app.request('/audit-log/export?format=csv');
    const text = await res.text();

    // Command with quotes and commas should be escaped
    expect(text).toContain('"echo ""hello, world"""');
    // Reason with quotes and commas
    expect(text).toContain('"Contains ""special"" chars, and commas"');
  });

  it('handles empty result set', async () => {
    mockAuditLogger.queryAll.mockResolvedValue([]);

    const res = await app.request('/audit-log/export?format=csv');
    expect(res.status).toBe(200);

    const text = await res.text();
    const lines = text.trim().split('\n');
    // BOM + header line only
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('Time,User ID');
  });

  it('handles large datasets via batching', async () => {
    const entries = Array.from({ length: 1500 }, (_, i) =>
      makeEntry({
        id: `al-${i}`,
        command: `cmd-${i}`,
        createdAt: `2026-02-09T${String(i % 24).padStart(2, '0')}:00:00.000Z`,
      }),
    );
    mockAuditLogger.queryAll.mockResolvedValue(entries);

    const res = await app.request('/audit-log/export?format=csv');
    expect(res.status).toBe(200);

    const text = await res.text();
    const lines = text.trim().split('\n');
    // Header + 1500 data rows
    expect(lines).toHaveLength(1501);
  });

  it('rejects invalid riskLevel filter', async () => {
    const res = await app.request('/audit-log/export?format=csv&riskLevel=invalid');
    expect(res.status).toBe(400);
  });

  it('includes BOM for Excel compatibility', async () => {
    mockAuditLogger.queryAll.mockResolvedValue([]);

    const res = await app.request('/audit-log/export?format=csv');
    const buffer = await res.arrayBuffer();
    const bytes = new Uint8Array(buffer);

    // UTF-8 BOM is 0xEF, 0xBB, 0xBF
    expect(bytes[0]).toBe(0xEF);
    expect(bytes[1]).toBe(0xBB);
    expect(bytes[2]).toBe(0xBF);
  });

  it('includes all fields in CSV rows', async () => {
    const entry = makeEntry({
      id: 'al-full',
      userId: 'user-42',
      serverId: 'srv-7',
      command: 'apt-get install nginx',
      riskLevel: 'yellow',
      action: 'requires_confirmation',
      executionResult: 'success',
      reason: 'Installation command',
      auditWarnings: ['Package installation'],
      auditBlockers: [],
    });
    mockAuditLogger.queryAll.mockResolvedValue([entry]);

    const res = await app.request('/audit-log/export?format=csv');
    const text = await res.text();
    const lines = text.trim().split('\n');
    const dataRow = lines[1];

    expect(dataRow).toContain('user-42');
    expect(dataRow).toContain('srv-7');
    expect(dataRow).toContain('apt-get install nginx');
    expect(dataRow).toContain('yellow');
    expect(dataRow).toContain('requires_confirmation');
    expect(dataRow).toContain('success');
    expect(dataRow).toContain('Installation command');
    expect(dataRow).toContain('Package installation');
  });

  it('handles null executionResult', async () => {
    mockAuditLogger.queryAll.mockResolvedValue([
      makeEntry({ executionResult: null }),
    ]);

    const res = await app.request('/audit-log/export?format=csv');
    const text = await res.text();
    const lines = text.trim().split('\n');
    // Data row should have empty field for null executionResult
    expect(lines[1]).toBeDefined();
  });
});
