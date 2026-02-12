// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for BatchExecutor — multi-server batch execution with
 * tag-based server filtering for scope='tagged'.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  InMemoryServerRepository,
  setServerRepository,
  _resetServerRepository,
} from '../../db/repositories/server-repository.js';
import { executeBatch, type SingleExecuteFn } from './batch-executor.js';
import type {
  InstalledSkill,
  SkillRunParams,
  SkillExecutionResult,
} from './types.js';
import type { SkillManifest } from '@aiinstaller/shared';

// ============================================================================
// Helpers
// ============================================================================

const TEST_USER_ID = 'user-1';

function makeSkill(overrides: Partial<InstalledSkill> = {}): InstalledSkill {
  return {
    id: 'skill-1',
    userId: TEST_USER_ID,
    tenantId: null,
    name: 'test-skill',
    displayName: 'Test Skill',
    version: '1.0.0',
    source: 'local',
    skillPath: '/tmp/test-skill',
    status: 'active',
    config: null,
    manifestInputs: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeManifest(overrides: Partial<SkillManifest> = {}): SkillManifest {
  return {
    kind: 'skill',
    version: '1.0',
    metadata: {
      name: 'test-skill',
      displayName: 'Test Skill',
      version: '1.0.0',
    },
    triggers: [{ type: 'manual' }],
    tools: ['shell'],
    prompt:
      'This is a test prompt that must be at least 50 characters long to pass validation rules properly.',
    ...overrides,
  } as SkillManifest;
}

function makeParams(overrides: Partial<SkillRunParams> = {}): SkillRunParams {
  return {
    skillId: 'skill-1',
    serverId: 'server-1',
    userId: TEST_USER_ID,
    triggerType: 'manual',
    ...overrides,
  };
}

function makeSuccessResult(
  executionId = 'exec-1',
): SkillExecutionResult {
  return {
    executionId,
    status: 'success',
    stepsExecuted: 3,
    duration: 100,
    result: { output: 'done' },
    errors: [],
  };
}

function makeFailedResult(
  executionId = 'exec-fail',
): SkillExecutionResult {
  return {
    executionId,
    status: 'failed',
    stepsExecuted: 1,
    duration: 50,
    result: null,
    errors: ['step 2 failed'],
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('BatchExecutor', () => {
  let serverRepo: InMemoryServerRepository;

  beforeEach(async () => {
    _resetServerRepository();
    serverRepo = new InMemoryServerRepository();
    setServerRepository(serverRepo);
  });

  // --------------------------------------------------------------------------
  // scope='all' tests
  // --------------------------------------------------------------------------

  describe('scope=all', () => {
    it('executes on all servers for the user', async () => {
      const s1 = await serverRepo.create({
        name: 'Server A',
        userId: TEST_USER_ID,
      });
      const s2 = await serverRepo.create({
        name: 'Server B',
        userId: TEST_USER_ID,
      });

      const executeFn: SingleExecuteFn = vi
        .fn()
        .mockResolvedValueOnce(makeSuccessResult('exec-a'))
        .mockResolvedValueOnce(makeSuccessResult('exec-b'));

      const result = await executeBatch(
        makeParams(),
        makeSkill(),
        makeManifest(),
        'all',
        executeFn,
      );

      expect(result.serverScope).toBe('all');
      expect(result.results).toHaveLength(2);
      expect(result.successCount).toBe(2);
      expect(result.failureCount).toBe(0);
      expect(result.totalDuration).toBeGreaterThanOrEqual(0);
      expect(result.warnings).toBeUndefined();

      // Verify each server was called
      expect(executeFn).toHaveBeenCalledTimes(2);
      const serverIds = result.results.map((r) => r.serverId);
      expect(serverIds).toContain(s1.id);
      expect(serverIds).toContain(s2.id);
    });

    it('returns empty results when user has no servers', async () => {
      const executeFn: SingleExecuteFn = vi.fn();

      const result = await executeBatch(
        makeParams(),
        makeSkill(),
        makeManifest(),
        'all',
        executeFn,
      );

      expect(result.results).toHaveLength(0);
      expect(result.successCount).toBe(0);
      expect(result.failureCount).toBe(0);
      expect(executeFn).not.toHaveBeenCalled();
    });

    it('handles partial failures across servers', async () => {
      await serverRepo.create({ name: 'OK Server', userId: TEST_USER_ID });
      await serverRepo.create({ name: 'Bad Server', userId: TEST_USER_ID });

      const executeFn: SingleExecuteFn = vi
        .fn()
        .mockResolvedValueOnce(makeSuccessResult())
        .mockResolvedValueOnce(makeFailedResult());

      const result = await executeBatch(
        makeParams(),
        makeSkill(),
        makeManifest(),
        'all',
        executeFn,
      );

      expect(result.successCount).toBe(1);
      expect(result.failureCount).toBe(1);
      expect(result.results).toHaveLength(2);
    });

    it('catches thrown errors and records as failed result', async () => {
      await serverRepo.create({ name: 'Crash Server', userId: TEST_USER_ID });

      const executeFn: SingleExecuteFn = vi
        .fn()
        .mockRejectedValue(new Error('connection refused'));

      const result = await executeBatch(
        makeParams(),
        makeSkill(),
        makeManifest(),
        'all',
        executeFn,
      );

      expect(result.failureCount).toBe(1);
      expect(result.successCount).toBe(0);
      expect(result.results[0].result.status).toBe('failed');
      expect(result.results[0].result.errors).toContain('connection refused');
    });
  });

  // --------------------------------------------------------------------------
  // scope='tagged' — real tag-based server filtering
  // --------------------------------------------------------------------------

  describe('scope=tagged', () => {
    it('executes only on servers matching manifest server_tags', async () => {
      const s1 = await serverRepo.create({
        name: 'Web Server',
        userId: TEST_USER_ID,
        tags: ['web', 'prod'],
      });
      await serverRepo.create({
        name: 'DB Server',
        userId: TEST_USER_ID,
        tags: ['db', 'prod'],
      });
      const s3 = await serverRepo.create({
        name: 'Cache Server',
        userId: TEST_USER_ID,
        tags: ['web', 'cache'],
      });

      const manifest = makeManifest({
        constraints: {
          server_scope: 'tagged',
          server_tags: ['web'],
          risk_level_max: 'yellow',
          timeout: '5m',
          max_steps: 20,
          requires_confirmation: false,
        },
      });

      const executeFn: SingleExecuteFn = vi
        .fn()
        .mockResolvedValue(makeSuccessResult());

      const result = await executeBatch(
        makeParams(),
        makeSkill(),
        manifest,
        'tagged',
        executeFn,
      );

      expect(result.serverScope).toBe('tagged');
      expect(result.results).toHaveLength(2);
      expect(result.successCount).toBe(2);
      expect(result.warnings).toBeUndefined();

      const serverIds = result.results.map((r) => r.serverId);
      expect(serverIds).toContain(s1.id);
      expect(serverIds).toContain(s3.id);
    });

    it('returns empty results when no servers match tags', async () => {
      await serverRepo.create({
        name: 'Web Server',
        userId: TEST_USER_ID,
        tags: ['web'],
      });

      const manifest = makeManifest({
        constraints: {
          server_scope: 'tagged',
          server_tags: ['nonexistent-tag'],
          risk_level_max: 'yellow',
          timeout: '5m',
          max_steps: 20,
          requires_confirmation: false,
        },
      });

      const executeFn: SingleExecuteFn = vi.fn();

      const result = await executeBatch(
        makeParams(),
        makeSkill(),
        manifest,
        'tagged',
        executeFn,
      );

      expect(result.results).toHaveLength(0);
      expect(executeFn).not.toHaveBeenCalled();
    });

    it('degrades to single-server when manifest has no server_tags', async () => {
      const server = await serverRepo.create({
        name: 'Fallback Server',
        userId: TEST_USER_ID,
      });
      const params = makeParams({ serverId: server.id });

      const executeFn: SingleExecuteFn = vi
        .fn()
        .mockResolvedValue(makeSuccessResult());

      // No server_tags in constraints
      const result = await executeBatch(
        params,
        makeSkill(),
        makeManifest(),
        'tagged',
        executeFn,
      );

      expect(result.results).toHaveLength(1);
      expect(result.results[0].serverId).toBe(server.id);
      expect(result.warnings).toBeDefined();
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings![0]).toContain('requires server_tags');
      expect(result.warnings![0]).toContain('falling back to single server');
    });

    it('degrades when server_tags is empty array', async () => {
      const server = await serverRepo.create({
        name: 'Fallback Server',
        userId: TEST_USER_ID,
      });
      const params = makeParams({ serverId: server.id });

      const manifest = makeManifest({
        constraints: {
          server_scope: 'tagged',
          server_tags: [],
          risk_level_max: 'yellow',
          timeout: '5m',
          max_steps: 20,
          requires_confirmation: false,
        },
      });

      const executeFn: SingleExecuteFn = vi
        .fn()
        .mockResolvedValue(makeSuccessResult());

      const result = await executeBatch(
        params,
        makeSkill(),
        manifest,
        'tagged',
        executeFn,
      );

      expect(result.warnings).toHaveLength(1);
      expect(result.warnings![0]).toContain('requires server_tags');
    });

    it('does not include other users servers when filtering by tags', async () => {
      await serverRepo.create({
        name: 'My Server',
        userId: TEST_USER_ID,
        tags: ['web'],
      });
      await serverRepo.create({
        name: 'Other Server',
        userId: 'other-user',
        tags: ['web'],
      });

      const manifest = makeManifest({
        constraints: {
          server_scope: 'tagged',
          server_tags: ['web'],
          risk_level_max: 'yellow',
          timeout: '5m',
          max_steps: 20,
          requires_confirmation: false,
        },
      });

      const executeFn: SingleExecuteFn = vi
        .fn()
        .mockResolvedValue(makeSuccessResult());

      const result = await executeBatch(
        makeParams(),
        makeSkill(),
        manifest,
        'tagged',
        executeFn,
      );

      expect(result.results).toHaveLength(1);
      expect(result.results[0].serverName).toBe('My Server');
    });

    it('handles execution failure on tagged server', async () => {
      await serverRepo.create({
        name: 'Fail Server',
        userId: TEST_USER_ID,
        tags: ['web'],
      });

      const manifest = makeManifest({
        constraints: {
          server_scope: 'tagged',
          server_tags: ['web'],
          risk_level_max: 'yellow',
          timeout: '5m',
          max_steps: 20,
          requires_confirmation: false,
        },
      });

      const executeFn: SingleExecuteFn = vi
        .fn()
        .mockRejectedValue(new Error('agent offline'));

      const result = await executeBatch(
        makeParams(),
        makeSkill(),
        manifest,
        'tagged',
        executeFn,
      );

      expect(result.failureCount).toBe(1);
      expect(result.successCount).toBe(0);
      expect(result.results[0].result.errors).toContain('agent offline');
    });
  });

  // --------------------------------------------------------------------------
  // Edge cases
  // --------------------------------------------------------------------------

  describe('edge cases', () => {
    it('does not include other users servers in scope=all', async () => {
      await serverRepo.create({ name: 'My Server', userId: TEST_USER_ID });
      await serverRepo.create({ name: 'Other Server', userId: 'other-user' });

      const executeFn: SingleExecuteFn = vi
        .fn()
        .mockResolvedValue(makeSuccessResult());

      const result = await executeBatch(
        makeParams(),
        makeSkill(),
        makeManifest(),
        'all',
        executeFn,
      );

      expect(result.results).toHaveLength(1);
      expect(executeFn).toHaveBeenCalledTimes(1);
    });

    it('generates a unique batchId per invocation', async () => {
      const executeFn: SingleExecuteFn = vi.fn();

      const r1 = await executeBatch(
        makeParams(),
        makeSkill(),
        makeManifest(),
        'all',
        executeFn,
      );
      const r2 = await executeBatch(
        makeParams(),
        makeSkill(),
        makeManifest(),
        'all',
        executeFn,
      );

      expect(r1.batchId).toBeTruthy();
      expect(r2.batchId).toBeTruthy();
      expect(r1.batchId).not.toBe(r2.batchId);
    });
  });
});
