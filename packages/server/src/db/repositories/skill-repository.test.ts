// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for SkillRepository — findAllEnabled() for both Drizzle and InMemory.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { initDatabase, closeDatabase, createTables } from '../connection.js';
import {
  DrizzleSkillRepository,
  InMemorySkillRepository,
} from './skill-repository.js';

import type { DrizzleDB } from '../connection.js';
import type { SkillSource, SkillStatus, SkillTriggerType } from '../schema.js';

// ============================================================================
// Helpers
// ============================================================================

function seedUser(db: DrizzleDB, id: string, email: string): void {
  const sqlite = (db as unknown as { session: { client: { exec: (s: string) => void } } })
    .session.client;
  sqlite.exec(
    `INSERT INTO users (id, email, password_hash, created_at, updated_at)
     VALUES ('${id}', '${email}', 'hash', ${Date.now()}, ${Date.now()})`,
  );
}

const SAMPLE_INPUTS = [
  { name: 'domain', type: 'string', required: true, description: 'Target domain' },
  { name: 'port', type: 'number', required: false, default: 443, description: 'Port number' },
];

function makeInstallInput(overrides: {
  userId?: string;
  name?: string;
  source?: SkillSource;
  manifestInputs?: unknown[] | null;
} = {}) {
  return {
    userId: overrides.userId ?? 'user-1',
    name: overrides.name ?? 'test-skill',
    version: '1.0.0',
    source: (overrides.source ?? 'local') as SkillSource,
    skillPath: '/skills/test-skill',
    manifestInputs: overrides.manifestInputs,
  };
}

// ============================================================================
// DrizzleSkillRepository — findAllEnabled
// ============================================================================

describe('DrizzleSkillRepository.findAllEnabled', () => {
  let db: DrizzleDB;
  let repo: DrizzleSkillRepository;

  beforeEach(() => {
    db = initDatabase(':memory:');
    createTables();
    repo = new DrizzleSkillRepository(db);
    seedUser(db, 'user-1', 'a@test.com');
    seedUser(db, 'user-2', 'b@test.com');
  });

  afterEach(() => {
    closeDatabase();
  });

  it('should return empty array when no skills exist', async () => {
    const result = await repo.findAllEnabled();
    expect(result).toEqual([]);
  });

  it('should return only enabled skills', async () => {
    const s1 = await repo.install(makeInstallInput({ name: 'skill-a' }));
    const s2 = await repo.install(makeInstallInput({ name: 'skill-b' }));
    await repo.install(makeInstallInput({ name: 'skill-c' }));

    // Enable two, leave one as 'installed'
    await repo.updateStatus(s1.id, 'enabled' as SkillStatus);
    await repo.updateStatus(s2.id, 'enabled' as SkillStatus);

    const result = await repo.findAllEnabled();
    expect(result).toHaveLength(2);

    const names = result.map((s) => s.name);
    expect(names).toContain('skill-a');
    expect(names).toContain('skill-b');
  });

  it('should not return disabled skills', async () => {
    const s1 = await repo.install(makeInstallInput({ name: 'skill-disabled' }));
    await repo.updateStatus(s1.id, 'enabled' as SkillStatus);
    await repo.updateStatus(s1.id, 'disabled' as SkillStatus);

    const result = await repo.findAllEnabled();
    expect(result).toHaveLength(0);
  });

  it('should return enabled skills across multiple users', async () => {
    const s1 = await repo.install(makeInstallInput({ userId: 'user-1', name: 'skill-u1' }));
    const s2 = await repo.install(makeInstallInput({ userId: 'user-2', name: 'skill-u2' }));

    await repo.updateStatus(s1.id, 'enabled' as SkillStatus);
    await repo.updateStatus(s2.id, 'enabled' as SkillStatus);

    const result = await repo.findAllEnabled();
    expect(result).toHaveLength(2);
    expect(result.map((s) => s.userId)).toContain('user-1');
    expect(result.map((s) => s.userId)).toContain('user-2');
  });
});

// ============================================================================
// DrizzleSkillRepository — manifestInputs persistence
// ============================================================================

describe('DrizzleSkillRepository.manifestInputs', () => {
  let db: DrizzleDB;
  let repo: DrizzleSkillRepository;

  beforeEach(() => {
    db = initDatabase(':memory:');
    createTables();
    repo = new DrizzleSkillRepository(db);
    seedUser(db, 'user-1', 'a@test.com');
  });

  afterEach(() => {
    closeDatabase();
  });

  it('should persist manifestInputs on install', async () => {
    const skill = await repo.install(
      makeInstallInput({ name: 'with-inputs', manifestInputs: SAMPLE_INPUTS }),
    );
    expect(skill.manifestInputs).toEqual(SAMPLE_INPUTS);
  });

  it('should return null manifestInputs when not provided', async () => {
    const skill = await repo.install(makeInstallInput({ name: 'no-inputs' }));
    expect(skill.manifestInputs).toBeNull();
  });

  it('should persist manifestInputs through findById', async () => {
    const installed = await repo.install(
      makeInstallInput({ name: 'find-by-id', manifestInputs: SAMPLE_INPUTS }),
    );
    const found = await repo.findById(installed.id);
    expect(found).not.toBeNull();
    expect(found!.manifestInputs).toEqual(SAMPLE_INPUTS);
  });

  it('should persist manifestInputs through findAll', async () => {
    await repo.install(
      makeInstallInput({ name: 'find-all', manifestInputs: SAMPLE_INPUTS }),
    );
    const all = await repo.findAll('user-1');
    expect(all).toHaveLength(1);
    expect(all[0].manifestInputs).toEqual(SAMPLE_INPUTS);
  });

  it('should persist manifestInputs through findByName', async () => {
    await repo.install(
      makeInstallInput({ name: 'by-name', manifestInputs: SAMPLE_INPUTS }),
    );
    const found = await repo.findByName('user-1', 'by-name');
    expect(found).not.toBeNull();
    expect(found!.manifestInputs).toEqual(SAMPLE_INPUTS);
  });

  it('should persist empty array as manifestInputs', async () => {
    const skill = await repo.install(
      makeInstallInput({ name: 'empty-inputs', manifestInputs: [] }),
    );
    expect(skill.manifestInputs).toEqual([]);
  });
});

// ============================================================================
// InMemorySkillRepository — manifestInputs persistence
// ============================================================================

describe('InMemorySkillRepository.manifestInputs', () => {
  let repo: InMemorySkillRepository;

  beforeEach(() => {
    repo = new InMemorySkillRepository();
  });

  it('should persist manifestInputs on install', async () => {
    const skill = await repo.install(
      makeInstallInput({ name: 'with-inputs', manifestInputs: SAMPLE_INPUTS }),
    );
    expect(skill.manifestInputs).toEqual(SAMPLE_INPUTS);
  });

  it('should return null manifestInputs when not provided', async () => {
    const skill = await repo.install(makeInstallInput({ name: 'no-inputs' }));
    expect(skill.manifestInputs).toBeNull();
  });

  it('should persist manifestInputs through findById', async () => {
    const installed = await repo.install(
      makeInstallInput({ name: 'find-by-id', manifestInputs: SAMPLE_INPUTS }),
    );
    const found = await repo.findById(installed.id);
    expect(found).not.toBeNull();
    expect(found!.manifestInputs).toEqual(SAMPLE_INPUTS);
  });

  it('should persist empty array as manifestInputs', async () => {
    const skill = await repo.install(
      makeInstallInput({ name: 'empty-inputs', manifestInputs: [] }),
    );
    expect(skill.manifestInputs).toEqual([]);
  });
});

// ============================================================================
// InMemorySkillRepository — findAllEnabled
// ============================================================================

describe('InMemorySkillRepository.findAllEnabled', () => {
  let repo: InMemorySkillRepository;

  beforeEach(() => {
    repo = new InMemorySkillRepository();
  });

  it('should return empty array when no skills exist', async () => {
    const result = await repo.findAllEnabled();
    expect(result).toEqual([]);
  });

  it('should return only enabled skills', async () => {
    const s1 = await repo.install(makeInstallInput({ name: 'skill-a' }));
    const s2 = await repo.install(makeInstallInput({ name: 'skill-b' }));
    await repo.install(makeInstallInput({ name: 'skill-c' }));

    await repo.updateStatus(s1.id, 'enabled' as SkillStatus);
    await repo.updateStatus(s2.id, 'enabled' as SkillStatus);

    const result = await repo.findAllEnabled();
    expect(result).toHaveLength(2);

    const names = result.map((s) => s.name);
    expect(names).toContain('skill-a');
    expect(names).toContain('skill-b');
  });

  it('should not return disabled or installed skills', async () => {
    const s1 = await repo.install(makeInstallInput({ name: 'skill-installed' }));
    const s2 = await repo.install(makeInstallInput({ name: 'skill-disabled' }));
    await repo.updateStatus(s2.id, 'enabled' as SkillStatus);
    await repo.updateStatus(s2.id, 'disabled' as SkillStatus);

    const result = await repo.findAllEnabled();
    expect(result).toHaveLength(0);
    // Verify s1 is still 'installed'
    const s1Found = await repo.findById(s1.id);
    expect(s1Found?.status).toBe('installed');
  });

  it('should return enabled skills across multiple users', async () => {
    const s1 = await repo.install(makeInstallInput({ userId: 'user-1', name: 'skill-u1' }));
    const s2 = await repo.install(makeInstallInput({ userId: 'user-2', name: 'skill-u2' }));

    await repo.updateStatus(s1.id, 'enabled' as SkillStatus);
    await repo.updateStatus(s2.id, 'enabled' as SkillStatus);

    const result = await repo.findAllEnabled();
    expect(result).toHaveLength(2);
  });
});

// ============================================================================
// InMemorySkillRepository — getStats
// ============================================================================

describe('InMemorySkillRepository.getStats', () => {
  let repo: InMemorySkillRepository;

  beforeEach(() => {
    repo = new InMemorySkillRepository();
  });

  it('should return zero stats when no executions exist', async () => {
    const stats = await repo.getStats('user-1');
    expect(stats.totalExecutions).toBe(0);
    expect(stats.successRate).toBe(0);
    expect(stats.avgDuration).toBe(0);
    expect(stats.topSkills).toEqual([]);
    expect(stats.dailyTrend).toEqual([]);
    expect(stats.triggerDistribution).toEqual([]);
  });

  it('should compute correct stats with mixed executions', async () => {
    const skill = await repo.install(makeInstallInput({ name: 'stats-skill', userId: 'user-1' }));
    const skill2 = await repo.install(makeInstallInput({ name: 'stats-skill-2', userId: 'user-1' }));

    // Create executions
    const e1 = await repo.createExecution({ skillId: skill.id, serverId: 's1', userId: 'user-1', triggerType: 'manual' as SkillTriggerType });
    await repo.completeExecution(e1.id, 'success', null, 3, 1000);
    const e2 = await repo.createExecution({ skillId: skill.id, serverId: 's1', userId: 'user-1', triggerType: 'cron' as SkillTriggerType });
    await repo.completeExecution(e2.id, 'failed', null, 1, 2000);
    const e3 = await repo.createExecution({ skillId: skill2.id, serverId: 's1', userId: 'user-1', triggerType: 'manual' as SkillTriggerType });
    await repo.completeExecution(e3.id, 'success', null, 5, 3000);

    const stats = await repo.getStats('user-1');

    expect(stats.totalExecutions).toBe(3);
    expect(stats.successRate).toBeCloseTo(2 / 3);
    expect(stats.avgDuration).toBe(2000); // (1000+2000+3000)/3

    // Top skills — skill has 2 executions, skill2 has 1
    expect(stats.topSkills).toHaveLength(2);
    expect(stats.topSkills[0].skillId).toBe(skill.id);
    expect(stats.topSkills[0].executionCount).toBe(2);
    expect(stats.topSkills[0].successCount).toBe(1);

    // Trigger distribution
    const manualTrigger = stats.triggerDistribution.find((t) => t.triggerType === 'manual');
    expect(manualTrigger?.count).toBe(2);
    const cronTrigger = stats.triggerDistribution.find((t) => t.triggerType === 'cron');
    expect(cronTrigger?.count).toBe(1);
  });

  it('should filter by date range', async () => {
    const skill = await repo.install(makeInstallInput({ name: 'range-skill', userId: 'user-1' }));

    // Manually create an execution with old date
    const e1 = await repo.createExecution({ skillId: skill.id, serverId: 's1', userId: 'user-1', triggerType: 'manual' as SkillTriggerType });
    await repo.completeExecution(e1.id, 'success', null, 1, 500);

    // Get stats with a future range that excludes current executions
    const futureFrom = new Date(Date.now() + 100_000);
    const futureTo = new Date(Date.now() + 200_000);
    const stats = await repo.getStats('user-1', futureFrom, futureTo);
    expect(stats.totalExecutions).toBe(0);

    // Get stats with range that includes current executions
    const pastFrom = new Date(Date.now() - 100_000);
    const pastTo = new Date(Date.now() + 100_000);
    const stats2 = await repo.getStats('user-1', pastFrom, pastTo);
    expect(stats2.totalExecutions).toBe(1);
  });
});
