// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for skill health check — periodic verification of installed skill integrity.
 *
 * Covers:
 * - checkSingleSkill: directory missing, manifest corrupt, version mismatch, healthy
 * - healthCheck: aggregation across multiple skills
 * - healthCheckAndAutoRepair: auto-marking broken skills as error
 * - startHealthCheckTimer: periodic timer + initial run + dispose
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'node:path';
import { writeFile, rm, mkdir } from 'node:fs/promises';

import {
  healthCheck,
  healthCheckAndAutoRepair,
  startHealthCheckTimer,
  HEALTH_CHECK_INTERVAL_MS,
  type HealthReport,
} from './engine-health.js';
import {
  InMemorySkillRepository,
  setSkillRepository,
  _resetSkillRepository,
} from '../../db/repositories/skill-repository.js';
import {
  createTempDir,
  cleanupTempDirs,
  writeSkillYaml,
} from './engine-test-utils.js';

// ============================================================================
// Setup / Teardown
// ============================================================================

let repo: InMemorySkillRepository;

beforeEach(() => {
  _resetSkillRepository();
  repo = new InMemorySkillRepository();
  setSkillRepository(repo);
});

afterEach(async () => {
  _resetSkillRepository();
  await cleanupTempDirs();
});

// ============================================================================
// healthCheck — healthy skill
// ============================================================================

describe('healthCheck — healthy skills', () => {
  it('should report healthy when directory and manifest are valid', async () => {
    const skillDir = await createTempDir('health-ok-');
    await writeSkillYaml(skillDir);

    await repo.install({
      userId: 'user-1',
      name: 'test-skill',
      version: '1.0.0',
      source: 'local',
      skillPath: skillDir,
    });

    const report = await healthCheck(repo);

    expect(report.results).toHaveLength(1);
    expect(report.healthy).toBe(1);
    expect(report.degraded).toBe(0);
    expect(report.broken).toBe(0);
    expect(report.checkedAt).toBeDefined();

    const result = report.results[0];
    expect(result.status).toBe('healthy');
    expect(result.issues).toHaveLength(0);
    expect(result.dbVersion).toBe('1.0.0');
    expect(result.diskVersion).toBe('1.0.0');
    expect(result.name).toBe('test-skill');
  });

  it('should return empty report when no skills exist', async () => {
    const report = await healthCheck(repo);

    expect(report.results).toHaveLength(0);
    expect(report.healthy).toBe(0);
    expect(report.degraded).toBe(0);
    expect(report.broken).toBe(0);
  });
});

// ============================================================================
// healthCheck — broken skill (directory missing)
// ============================================================================

describe('healthCheck — broken skills', () => {
  it('should report broken when skill directory does not exist', async () => {
    await repo.install({
      userId: 'user-1',
      name: 'missing-skill',
      version: '1.0.0',
      source: 'local',
      skillPath: '/nonexistent/path/skill-xyz',
    });

    const report = await healthCheck(repo);

    expect(report.results).toHaveLength(1);
    expect(report.broken).toBe(1);

    const result = report.results[0];
    expect(result.status).toBe('broken');
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatch(/Directory missing/);
    expect(result.diskVersion).toBeNull();
  });

  it('should report broken when manifest is invalid YAML', async () => {
    const skillDir = await createTempDir('health-bad-yaml-');
    await writeFile(join(skillDir, 'skill.yaml'), '{{{{invalid yaml', 'utf-8');

    await repo.install({
      userId: 'user-1',
      name: 'bad-yaml-skill',
      version: '1.0.0',
      source: 'local',
      skillPath: skillDir,
    });

    const report = await healthCheck(repo);

    expect(report.broken).toBe(1);
    const result = report.results[0];
    expect(result.status).toBe('broken');
    expect(result.issues[0]).toMatch(/Manifest error/);
    expect(result.diskVersion).toBeNull();
  });

  it('should report broken when manifest fails schema validation', async () => {
    const skillDir = await createTempDir('health-bad-schema-');
    await writeFile(join(skillDir, 'skill.yaml'), 'kind: invalid\nversion: "1.0"\n', 'utf-8');

    await repo.install({
      userId: 'user-1',
      name: 'bad-schema-skill',
      version: '1.0.0',
      source: 'local',
      skillPath: skillDir,
    });

    const report = await healthCheck(repo);

    expect(report.broken).toBe(1);
    expect(report.results[0].status).toBe('broken');
    expect(report.results[0].issues[0]).toMatch(/Manifest error/);
  });

  it('should report broken when skillPath points to a file, not a directory', async () => {
    const tmpDir = await createTempDir('health-file-');
    const filePath = join(tmpDir, 'not-a-dir.txt');
    await writeFile(filePath, 'this is a file', 'utf-8');

    await repo.install({
      userId: 'user-1',
      name: 'file-path-skill',
      version: '1.0.0',
      source: 'local',
      skillPath: filePath,
    });

    const report = await healthCheck(repo);

    expect(report.broken).toBe(1);
    expect(report.results[0].status).toBe('broken');
    expect(report.results[0].issues[0]).toMatch(/not a directory/i);
  });
});

// ============================================================================
// healthCheck — degraded skill (version mismatch)
// ============================================================================

describe('healthCheck — degraded skills', () => {
  it('should report degraded when DB version differs from disk manifest version', async () => {
    const skillDir = await createTempDir('health-degraded-');
    await writeSkillYaml(skillDir); // disk version = 1.0.0

    await repo.install({
      userId: 'user-1',
      name: 'test-skill',
      version: '0.9.0', // DB has older version
      source: 'local',
      skillPath: skillDir,
    });

    const report = await healthCheck(repo);

    expect(report.degraded).toBe(1);
    expect(report.healthy).toBe(0);

    const result = report.results[0];
    expect(result.status).toBe('degraded');
    expect(result.dbVersion).toBe('0.9.0');
    expect(result.diskVersion).toBe('1.0.0');
    expect(result.issues[0]).toMatch(/Version mismatch.*DB=0\.9\.0.*disk=1\.0\.0/);
  });
});

// ============================================================================
// healthCheck — mixed results
// ============================================================================

describe('healthCheck — multiple skills', () => {
  it('should correctly aggregate healthy, degraded, and broken skills', async () => {
    // Healthy skill
    const healthyDir = await createTempDir('health-mixed-ok-');
    await writeSkillYaml(healthyDir);
    await repo.install({
      userId: 'user-1',
      name: 'test-skill',
      version: '1.0.0',
      source: 'local',
      skillPath: healthyDir,
    });

    // Degraded skill (version mismatch)
    const degradedDir = await createTempDir('health-mixed-deg-');
    await writeSkillYaml(degradedDir, { name: 'degraded-skill' });
    await repo.install({
      userId: 'user-1',
      name: 'degraded-skill',
      version: '0.5.0',
      source: 'local',
      skillPath: degradedDir,
    });

    // Broken skill (missing directory)
    await repo.install({
      userId: 'user-2',
      name: 'broken-skill',
      version: '1.0.0',
      source: 'local',
      skillPath: '/nonexistent/broken',
    });

    const report = await healthCheck(repo);

    expect(report.results).toHaveLength(3);
    expect(report.healthy).toBe(1);
    expect(report.degraded).toBe(1);
    expect(report.broken).toBe(1);
  });

  it('should check skills across multiple users', async () => {
    const dir1 = await createTempDir('health-u1-');
    await writeSkillYaml(dir1, { name: 'user1-skill' });
    await repo.install({
      userId: 'user-1',
      name: 'user1-skill',
      version: '1.0.0',
      source: 'local',
      skillPath: dir1,
    });

    const dir2 = await createTempDir('health-u2-');
    await writeSkillYaml(dir2, { name: 'user2-skill' });
    await repo.install({
      userId: 'user-2',
      name: 'user2-skill',
      version: '1.0.0',
      source: 'local',
      skillPath: dir2,
    });

    const report = await healthCheck(repo);

    expect(report.results).toHaveLength(2);
    expect(report.healthy).toBe(2);
    // Verify both users' skills are checked
    const names = report.results.map((r) => r.name).sort();
    expect(names).toEqual(['user1-skill', 'user2-skill']);
  });
});

// ============================================================================
// healthCheckAndAutoRepair
// ============================================================================

describe('healthCheckAndAutoRepair', () => {
  it('should auto-mark broken skills as error status', async () => {
    await repo.install({
      userId: 'user-1',
      name: 'auto-repair-skill',
      version: '1.0.0',
      source: 'local',
      skillPath: '/nonexistent/dir',
    });
    // Set the skill to enabled first
    const skills = await repo.findAllSkills();
    await repo.updateStatus(skills[0].id, 'enabled');

    const report = await healthCheckAndAutoRepair(repo);

    expect(report.broken).toBe(1);

    // Verify the skill was transitioned to error
    const skill = await repo.findById(skills[0].id);
    expect(skill!.status).toBe('error');
  });

  it('should not update status if skill is already in error state', async () => {
    await repo.install({
      userId: 'user-1',
      name: 'already-error',
      version: '1.0.0',
      source: 'local',
      skillPath: '/nonexistent/dir',
    });
    const skills = await repo.findAllSkills();
    await repo.updateStatus(skills[0].id, 'error');

    const updateSpy = vi.spyOn(repo, 'updateStatus');
    await healthCheckAndAutoRepair(repo);

    // updateStatus should NOT be called since it's already error
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('should not change status of healthy skills', async () => {
    const skillDir = await createTempDir('health-nochange-');
    await writeSkillYaml(skillDir);

    await repo.install({
      userId: 'user-1',
      name: 'test-skill',
      version: '1.0.0',
      source: 'local',
      skillPath: skillDir,
    });
    const skills = await repo.findAllSkills();
    await repo.updateStatus(skills[0].id, 'enabled');

    await healthCheckAndAutoRepair(repo);

    const skill = await repo.findById(skills[0].id);
    expect(skill!.status).toBe('enabled');
  });

  it('should not change status of degraded skills', async () => {
    const skillDir = await createTempDir('health-degraded-nochange-');
    await writeSkillYaml(skillDir);

    await repo.install({
      userId: 'user-1',
      name: 'test-skill',
      version: '0.9.0', // version mismatch
      source: 'local',
      skillPath: skillDir,
    });
    const skills = await repo.findAllSkills();
    await repo.updateStatus(skills[0].id, 'enabled');

    await healthCheckAndAutoRepair(repo);

    const skill = await repo.findById(skills[0].id);
    expect(skill!.status).toBe('enabled'); // degraded does not trigger status change
  });
});

// ============================================================================
// startHealthCheckTimer
// ============================================================================

describe('startHealthCheckTimer', () => {
  it('should run an initial health check immediately', async () => {
    const skillDir = await createTempDir('health-timer-init-');
    await writeSkillYaml(skillDir);
    await repo.install({
      userId: 'user-1',
      name: 'test-skill',
      version: '1.0.0',
      source: 'local',
      skillPath: skillDir,
    });

    const findAllSpy = vi.spyOn(repo, 'findAllSkills');
    const handle = startHealthCheckTimer(repo);

    // Wait for the initial async health check to complete
    await vi.waitFor(() => expect(findAllSpy).toHaveBeenCalled());

    handle.dispose();
  });

  it('should run periodic health checks at the specified interval', async () => {
    vi.useFakeTimers();
    try {
      const findAllSpy = vi.spyOn(repo, 'findAllSkills').mockResolvedValue([]);

      const handle = startHealthCheckTimer(repo, 1000); // 1 second interval

      // Initial check fires immediately
      await vi.advanceTimersByTimeAsync(0);
      expect(findAllSpy).toHaveBeenCalledTimes(1);

      // After 1 second, periodic check fires
      await vi.advanceTimersByTimeAsync(1000);
      expect(findAllSpy).toHaveBeenCalledTimes(2);

      // After another second
      await vi.advanceTimersByTimeAsync(1000);
      expect(findAllSpy).toHaveBeenCalledTimes(3);

      handle.dispose();

      // No more checks after dispose
      await vi.advanceTimersByTimeAsync(1000);
      expect(findAllSpy).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('should use the default 6-hour interval', () => {
    expect(HEALTH_CHECK_INTERVAL_MS).toBe(6 * 60 * 60 * 1000);
  });

  it('should handle errors in periodic health check gracefully', async () => {
    vi.useFakeTimers();
    try {
      vi.spyOn(repo, 'findAllSkills').mockRejectedValue(new Error('DB down'));

      // Should not throw despite error
      const handle = startHealthCheckTimer(repo, 1000);

      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(1000);

      // Timer continues despite errors
      await vi.advanceTimersByTimeAsync(1000);

      handle.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});

// ============================================================================
// HealthReport structure
// ============================================================================

describe('HealthReport structure', () => {
  it('should include ISO timestamp in checkedAt', async () => {
    const report = await healthCheck(repo);

    expect(report.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('should include per-skill checkedAt timestamps', async () => {
    const skillDir = await createTempDir('health-ts-');
    await writeSkillYaml(skillDir);

    await repo.install({
      userId: 'user-1',
      name: 'test-skill',
      version: '1.0.0',
      source: 'local',
      skillPath: skillDir,
    });

    const report = await healthCheck(repo);

    expect(report.results[0].checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('should include correct skillId in results', async () => {
    const skillDir = await createTempDir('health-id-');
    await writeSkillYaml(skillDir);

    const skill = await repo.install({
      userId: 'user-1',
      name: 'test-skill',
      version: '1.0.0',
      source: 'local',
      skillPath: skillDir,
    });

    const report = await healthCheck(repo);

    expect(report.results[0].skillId).toBe(skill.id);
  });
});
