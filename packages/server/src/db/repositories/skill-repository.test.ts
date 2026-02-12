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
import type { SkillSource, SkillStatus } from '../schema.js';

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

function makeInstallInput(overrides: {
  userId?: string;
  name?: string;
  source?: SkillSource;
} = {}) {
  return {
    userId: overrides.userId ?? 'user-1',
    name: overrides.name ?? 'test-skill',
    version: '1.0.0',
    source: (overrides.source ?? 'local') as SkillSource,
    skillPath: '/skills/test-skill',
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
