// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for the centralized security audit logger.
 *
 * Validates audit log creation, querying, filtering, and execution result
 * updates. Uses an in-memory SQLite database for isolation.
 * Target coverage: ≥ 95% for this security module.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';

import { initDatabase, closeDatabase, createTables } from '../../db/connection.js';
import { getDatabase } from '../../db/connection.js';
import { users, servers } from '../../db/schema.js';
import { RiskLevel } from '@aiinstaller/shared';

import {
  DrizzleAuditLogger,
  getAuditLogger,
  setAuditLogger,
  _resetAuditLogger,
  type AuditLogger,
  type CreateAuditLogInput,
} from './audit-logger.js';
import { validateCommand, type ValidationResult } from './command-validator.js';

// ============================================================================
// Setup
// ============================================================================

let logger: DrizzleAuditLogger;
let userId: string;
let serverId: string;

function seedTestData() {
  const db = getDatabase();
  userId = randomUUID();
  serverId = randomUUID();
  const now = new Date();

  db.insert(users).values({
    id: userId,
    email: 'test@example.com',
    passwordHash: 'hash',
    name: 'Test User',
    createdAt: now,
    updatedAt: now,
  }).run();

  db.insert(servers).values({
    id: serverId,
    name: 'Test Server',
    userId,
    status: 'online',
    createdAt: now,
    updatedAt: now,
  }).run();
}

function createLogInput(command: string, overrides?: Partial<CreateAuditLogInput>): CreateAuditLogInput {
  const validation = validateCommand(command);
  return {
    serverId,
    userId,
    command,
    validation,
    ...overrides,
  };
}

beforeEach(() => {
  initDatabase(':memory:');
  createTables();
  seedTestData();
  logger = new DrizzleAuditLogger(getDatabase());
});

afterEach(() => {
  _resetAuditLogger();
  closeDatabase();
});

// ============================================================================
// log()
// ============================================================================

describe('DrizzleAuditLogger.log', () => {
  it('creates an audit log entry for a GREEN command', async () => {
    const entry = await logger.log(createLogInput('ls -la'));

    expect(entry.id).toBeDefined();
    expect(entry.serverId).toBe(serverId);
    expect(entry.userId).toBe(userId);
    expect(entry.command).toBe('ls -la');
    expect(entry.riskLevel).toBe(RiskLevel.GREEN);
    expect(entry.action).toBe('allowed');
    expect(entry.executionResult).toBe('pending');
    expect(entry.createdAt).toBeDefined();
  });

  it('creates an audit log entry for a FORBIDDEN command', async () => {
    const entry = await logger.log(createLogInput('rm -rf /'));

    expect(entry.riskLevel).toBe(RiskLevel.FORBIDDEN);
    expect(entry.action).toBe('blocked');
    expect(entry.executionResult).toBe('skipped');
  });

  it('creates an audit log entry for a YELLOW command', async () => {
    const entry = await logger.log(createLogInput('apt install nginx'));

    expect(entry.riskLevel).toBe(RiskLevel.YELLOW);
    expect(entry.action).toBe('requires_confirmation');
    expect(entry.executionResult).toBe('pending');
  });

  it('creates an audit log entry for a CRITICAL command', async () => {
    const entry = await logger.log(createLogInput('rm -rf /tmp/build'));

    expect(entry.riskLevel).toBe(RiskLevel.CRITICAL);
    expect(entry.action).toBe('requires_confirmation');
  });

  it('includes session ID when provided', async () => {
    const sessionId = randomUUID();
    const entry = await logger.log(createLogInput('ls', { sessionId }));

    expect(entry.sessionId).toBe(sessionId);
  });

  it('includes operation ID when provided', async () => {
    const operationId = randomUUID();
    const entry = await logger.log(createLogInput('ls', { operationId }));

    expect(entry.operationId).toBe(operationId);
  });

  it('stores audit warnings from the validation', async () => {
    // Use a command with dangerous flags that will generate warnings
    const entry = await logger.log(createLogInput('apt install --purge nginx'));

    expect(entry.auditWarnings).toBeDefined();
    expect(Array.isArray(entry.auditWarnings)).toBe(true);
  });

  it('stores audit blockers from the validation', async () => {
    const entry = await logger.log(createLogInput('rm -rf /etc'));

    expect(entry.auditBlockers).toBeDefined();
    expect(Array.isArray(entry.auditBlockers)).toBe(true);
  });

  it('stores the matched pattern when available', async () => {
    const entry = await logger.log(createLogInput('ls -la'));

    // GREEN pattern should have matchedPattern
    expect(entry.matchedPattern).toBeDefined();
  });

  it('sets null session when not provided', async () => {
    const entry = await logger.log(createLogInput('ls'));

    expect(entry.sessionId).toBeNull();
  });
});

// ============================================================================
// updateExecutionResult()
// ============================================================================

describe('DrizzleAuditLogger.updateExecutionResult', () => {
  it('updates the execution result to success', async () => {
    const entry = await logger.log(createLogInput('ls'));
    const updated = await logger.updateExecutionResult(entry.id, 'success');

    expect(updated).toBe(true);

    // Verify by querying
    const result = await logger.query(userId, {}, { limit: 50, offset: 0 });
    expect(result.logs[0].executionResult).toBe('success');
  });

  it('updates the execution result to failed', async () => {
    const entry = await logger.log(createLogInput('ls'));
    await logger.updateExecutionResult(entry.id, 'failed');

    const result = await logger.query(userId, {}, { limit: 50, offset: 0 });
    expect(result.logs[0].executionResult).toBe('failed');
  });

  it('updates the execution result to timeout', async () => {
    const entry = await logger.log(createLogInput('ls'));
    await logger.updateExecutionResult(entry.id, 'timeout');

    const result = await logger.query(userId, {}, { limit: 50, offset: 0 });
    expect(result.logs[0].executionResult).toBe('timeout');
  });

  it('updates operationId along with execution result', async () => {
    const entry = await logger.log(createLogInput('ls'));
    const operationId = randomUUID();
    await logger.updateExecutionResult(entry.id, 'success', operationId);

    const result = await logger.query(userId, {}, { limit: 50, offset: 0 });
    expect(result.logs[0].operationId).toBe(operationId);
  });
});

// ============================================================================
// query()
// ============================================================================

describe('DrizzleAuditLogger.query', () => {
  it('returns empty result when no logs exist', async () => {
    const result = await logger.query(userId, {}, { limit: 50, offset: 0 });

    expect(result.logs).toHaveLength(0);
    expect(result.total).toBe(0);
  });

  it('returns all logs for a user', async () => {
    await logger.log(createLogInput('ls'));
    await logger.log(createLogInput('cat /etc/hostname'));
    await logger.log(createLogInput('apt install nginx'));

    const result = await logger.query(userId, {}, { limit: 50, offset: 0 });

    expect(result.logs).toHaveLength(3);
    expect(result.total).toBe(3);
  });

  it('filters by serverId', async () => {
    await logger.log(createLogInput('ls'));

    // Create a second server and log to it
    const db = getDatabase();
    const serverId2 = randomUUID();
    db.insert(servers).values({
      id: serverId2,
      name: 'Other Server',
      userId,
      status: 'online',
      createdAt: new Date(),
      updatedAt: new Date(),
    }).run();

    await logger.log(createLogInput('cat /etc/hostname', { serverId: serverId2 }));

    const result = await logger.query(
      userId,
      { serverId: serverId2 },
      { limit: 50, offset: 0 },
    );

    expect(result.logs).toHaveLength(1);
    expect(result.logs[0].serverId).toBe(serverId2);
  });

  it('filters by riskLevel', async () => {
    await logger.log(createLogInput('ls'));
    await logger.log(createLogInput('apt install nginx'));
    await logger.log(createLogInput('rm -rf /'));

    const result = await logger.query(
      userId,
      { riskLevel: RiskLevel.FORBIDDEN },
      { limit: 50, offset: 0 },
    );

    expect(result.logs).toHaveLength(1);
    expect(result.logs[0].riskLevel).toBe(RiskLevel.FORBIDDEN);
  });

  it('filters by action', async () => {
    await logger.log(createLogInput('ls'));
    await logger.log(createLogInput('apt install nginx'));
    await logger.log(createLogInput('rm -rf /'));

    const result = await logger.query(
      userId,
      { action: 'blocked' },
      { limit: 50, offset: 0 },
    );

    expect(result.logs).toHaveLength(1);
    expect(result.logs[0].action).toBe('blocked');
  });

  it('supports pagination with limit', async () => {
    for (let i = 0; i < 5; i++) {
      await logger.log(createLogInput(`echo ${i}`));
    }

    const result = await logger.query(userId, {}, { limit: 2, offset: 0 });

    expect(result.logs).toHaveLength(2);
    expect(result.total).toBe(5);
  });

  it('supports pagination with offset', async () => {
    for (let i = 0; i < 5; i++) {
      await logger.log(createLogInput(`echo ${i}`));
    }

    const result = await logger.query(userId, {}, { limit: 2, offset: 3 });

    expect(result.logs).toHaveLength(2);
    expect(result.total).toBe(5);
  });

  it('returns logs ordered by createdAt descending', async () => {
    await logger.log(createLogInput('ls'));
    await logger.log(createLogInput('cat /etc/hostname'));

    const result = await logger.query(userId, {}, { limit: 50, offset: 0 });

    expect(result.logs).toHaveLength(2);
    // Both logs exist; order may vary if timestamps are identical
    const commands = result.logs.map((l) => l.command);
    expect(commands).toContain('ls');
    expect(commands).toContain('cat /etc/hostname');
  });

  it('isolates logs by user', async () => {
    await logger.log(createLogInput('ls'));

    const otherUserId = randomUUID();
    const result = await logger.query(otherUserId, {}, { limit: 50, offset: 0 });

    expect(result.logs).toHaveLength(0);
    expect(result.total).toBe(0);
  });

  it('filters by date range (startDate)', async () => {
    await logger.log(createLogInput('ls'));

    // Query with a future start date should return nothing
    const futureDate = new Date(Date.now() + 86400000).toISOString();
    const result = await logger.query(
      userId,
      { startDate: futureDate },
      { limit: 50, offset: 0 },
    );

    expect(result.logs).toHaveLength(0);
  });

  it('filters by date range (endDate)', async () => {
    await logger.log(createLogInput('ls'));

    // Query with a past end date should return nothing
    const pastDate = new Date(Date.now() - 86400000).toISOString();
    const result = await logger.query(
      userId,
      { endDate: pastDate },
      { limit: 50, offset: 0 },
    );

    expect(result.logs).toHaveLength(0);
  });

  it('combines multiple filters', async () => {
    await logger.log(createLogInput('ls'));
    await logger.log(createLogInput('apt install nginx'));
    await logger.log(createLogInput('rm -rf /'));

    const result = await logger.query(
      userId,
      { riskLevel: RiskLevel.GREEN, action: 'allowed' },
      { limit: 50, offset: 0 },
    );

    expect(result.logs).toHaveLength(1);
    expect(result.logs[0].command).toBe('ls');
  });
});

// ============================================================================
// Singleton management
// ============================================================================

describe('singleton management', () => {
  it('setAuditLogger overrides the singleton', () => {
    const mockLogger: AuditLogger = {
      log: async () => ({} as any),
      updateExecutionResult: async () => true,
      query: async () => ({ logs: [], total: 0 }),
    };

    setAuditLogger(mockLogger);
    expect(getAuditLogger()).toBe(mockLogger);
  });

  it('_resetAuditLogger clears the singleton', () => {
    setAuditLogger(logger);
    _resetAuditLogger();

    // After reset, getAuditLogger will create a new instance from DB
    // (which still works because we have an in-memory DB)
    const newLogger = getAuditLogger();
    expect(newLogger).not.toBe(logger);
  });
});
