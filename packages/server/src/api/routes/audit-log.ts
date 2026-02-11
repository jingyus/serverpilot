// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Audit log routes — query security audit trail.
 *
 * Provides GET /audit-log for querying command validation history
 * with filtering by server, time range, risk level, and action.
 * Provides GET /audit-log/export for CSV export with streaming.
 *
 * @module api/routes/audit-log
 */

import { Hono } from 'hono';
import { stream } from 'hono/streaming';
import { z } from 'zod';

import { requireAuth } from '../middleware/auth.js';
import { resolveRole, requirePermission } from '../middleware/rbac.js';
import { getAuditLogger } from '../../core/security/audit-logger.js';
import type { AuditLogEntry } from '../../core/security/audit-logger.js';
import type { ApiEnv } from './types.js';
import type { RiskLevel } from '@aiinstaller/shared';
import type { ValidationAction } from '../../core/security/command-validator.js';

const auditLog = new Hono<ApiEnv>();

auditLog.use('*', requireAuth, resolveRole);

// ============================================================================
// Query Schemas
// ============================================================================

const AuditLogQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  serverId: z.string().optional(),
  riskLevel: z.enum(['green', 'yellow', 'red', 'critical', 'forbidden']).optional(),
  action: z.enum(['allowed', 'blocked', 'requires_confirmation']).optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
});

const ExportQuerySchema = z.object({
  format: z.enum(['csv']).default('csv'),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  serverId: z.string().optional(),
  riskLevel: z.enum(['green', 'yellow', 'red', 'critical', 'forbidden']).optional(),
});

// ============================================================================
// CSV Helpers
// ============================================================================

const CSV_HEADERS = [
  'Time',
  'User ID',
  'Server ID',
  'Command',
  'Risk Level',
  'Action',
  'Status',
  'Reason',
  'Warnings',
  'Blockers',
];

function escapeCsvField(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n') || value.includes('\r')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function auditLogToCsvRow(entry: AuditLogEntry): string {
  const fields = [
    entry.createdAt,
    entry.userId,
    entry.serverId,
    escapeCsvField(entry.command),
    entry.riskLevel,
    entry.action,
    entry.executionResult ?? '',
    escapeCsvField(entry.reason),
    escapeCsvField(entry.auditWarnings.join('; ')),
    escapeCsvField(entry.auditBlockers.join('; ')),
  ];
  return fields.join(',');
}

// ============================================================================
// GET /audit-log — Query audit logs
// ============================================================================

auditLog.get('/', requirePermission('audit-log:read'), async (c) => {
  const userId = c.get('userId');
  const rawQuery = c.req.query();
  const query = AuditLogQuerySchema.parse(rawQuery);

  const logger = getAuditLogger();
  const result = await logger.query(
    userId,
    {
      serverId: query.serverId,
      riskLevel: query.riskLevel as RiskLevel | undefined,
      action: query.action as ValidationAction | undefined,
      startDate: query.startDate,
      endDate: query.endDate,
    },
    {
      limit: query.limit,
      offset: query.offset,
    },
  );

  return c.json({
    logs: result.logs,
    total: result.total,
    limit: query.limit,
    offset: query.offset,
  });
});

// ============================================================================
// GET /audit-log/export — Stream CSV export
// ============================================================================

auditLog.get('/export', requirePermission('audit-log:export'), async (c) => {
  const userId = c.get('userId');
  const rawQuery = c.req.query();
  const query = ExportQuerySchema.parse(rawQuery);

  const fromDate = query.from;
  const toDate = query.to;

  const filename = fromDate && toDate
    ? `audit-log-${fromDate.slice(0, 10)}-${toDate.slice(0, 10)}.csv`
    : `audit-log-export-${new Date().toISOString().slice(0, 10)}.csv`;

  c.header('Content-Type', 'text/csv; charset=utf-8');
  c.header('Content-Disposition', `attachment; filename="${filename}"`);
  c.header('Cache-Control', 'no-cache');

  const logger = getAuditLogger();
  const logs = await logger.queryAll(userId, {
    serverId: query.serverId,
    riskLevel: query.riskLevel as RiskLevel | undefined,
    startDate: fromDate,
    endDate: toDate,
  });

  return stream(c, async (s) => {
    // BOM for Excel UTF-8 detection
    await s.write('\uFEFF');
    await s.write(CSV_HEADERS.join(',') + '\n');

    const BATCH_SIZE = 500;
    for (let i = 0; i < logs.length; i += BATCH_SIZE) {
      const batch = logs.slice(i, i + BATCH_SIZE);
      const chunk = batch.map(auditLogToCsvRow).join('\n') + '\n';
      await s.write(chunk);
    }
  });
});

export { auditLog };
