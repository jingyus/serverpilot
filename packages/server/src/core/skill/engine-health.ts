// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Skill health check — periodic verification of installed skill integrity.
 *
 * Checks:
 * - skillPath directory exists
 * - skill.yaml can be parsed and validated (via loadSkillFromDir)
 * - DB version matches disk manifest version
 *
 * Broken skills are automatically marked with `error` status.
 *
 * @module core/skill/engine-health
 */

import { stat } from 'node:fs/promises';

import { createContextLogger } from '../../utils/logger.js';
import { loadSkillFromDir } from './loader.js';
import type { SkillRepository } from '../../db/repositories/skill-repository.js';
import type { InstalledSkill } from './types.js';

const logger = createContextLogger({ module: 'skill-engine-health' });

// ============================================================================
// Types
// ============================================================================

/** Health status of an individual skill. */
export type SkillHealthStatus = 'healthy' | 'degraded' | 'broken';

/** Health check result for a single skill. */
export interface SkillHealthCheckResult {
  skillId: string;
  name: string;
  status: SkillHealthStatus;
  /** Human-readable issues found (empty when healthy). */
  issues: string[];
  /** Version recorded in DB. */
  dbVersion: string;
  /** Version on disk (null if manifest could not be loaded). */
  diskVersion: string | null;
  checkedAt: string;
}

/** Aggregated health report. */
export interface HealthReport {
  results: SkillHealthCheckResult[];
  healthy: number;
  degraded: number;
  broken: number;
  checkedAt: string;
}

/** How often to run the periodic health check. */
export const HEALTH_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

// ============================================================================
// Health Check Logic
// ============================================================================

/**
 * Check a single skill's health.
 *
 * 1. Verify skillPath directory exists
 * 2. Try loadSkillFromDir() to validate the manifest
 * 3. Compare DB version vs disk manifest version
 */
async function checkSingleSkill(skill: InstalledSkill): Promise<SkillHealthCheckResult> {
  const issues: string[] = [];
  let diskVersion: string | null = null;
  let status: SkillHealthStatus = 'healthy';

  // 1. Check directory exists
  try {
    const dirStat = await stat(skill.skillPath);
    if (!dirStat.isDirectory()) {
      issues.push(`Path is not a directory: ${skill.skillPath}`);
      status = 'broken';
    }
  } catch {
    issues.push(`Directory missing: ${skill.skillPath}`);
    return {
      skillId: skill.id,
      name: skill.name,
      status: 'broken',
      issues,
      dbVersion: skill.version,
      diskVersion: null,
      checkedAt: new Date().toISOString(),
    };
  }

  // 2. Try loading manifest
  if (status !== 'broken') {
    try {
      const manifest = await loadSkillFromDir(skill.skillPath);
      diskVersion = manifest.metadata.version;
    } catch (err) {
      issues.push(`Manifest error: ${(err as Error).message}`);
      status = 'broken';
    }
  }

  // 3. Compare versions (only if manifest loaded successfully)
  if (diskVersion !== null && diskVersion !== skill.version) {
    issues.push(`Version mismatch: DB=${skill.version}, disk=${diskVersion}`);
    if (status === 'healthy') {
      status = 'degraded';
    }
  }

  return {
    skillId: skill.id,
    name: skill.name,
    status,
    issues,
    dbVersion: skill.version,
    diskVersion,
    checkedAt: new Date().toISOString(),
  };
}

/**
 * Run health checks on all enabled/configured/installed skills.
 *
 * Skills in 'error' status are also checked so they can recover
 * when the underlying issue is fixed.
 */
export async function healthCheck(repo: SkillRepository): Promise<HealthReport> {
  const allSkills = await repo.findAll();
  const results: SkillHealthCheckResult[] = [];

  for (const skill of allSkills) {
    const result = await checkSingleSkill(skill);
    results.push(result);
  }

  return {
    results,
    healthy: results.filter((r) => r.status === 'healthy').length,
    degraded: results.filter((r) => r.status === 'degraded').length,
    broken: results.filter((r) => r.status === 'broken').length,
    checkedAt: new Date().toISOString(),
  };
}

/**
 * Run health check and auto-mark broken skills with `error` status.
 * Logs all status transitions. Returns the full health report.
 */
export async function healthCheckAndAutoRepair(repo: SkillRepository): Promise<HealthReport> {
  const report = await healthCheck(repo);

  for (const result of report.results) {
    if (result.status === 'broken') {
      // Look up current DB status to avoid unnecessary updates
      const skill = await repo.findById(result.skillId);
      if (skill && skill.status !== 'error') {
        await repo.updateStatus(result.skillId, 'error');
        logger.warn(
          {
            skillId: result.skillId,
            name: result.name,
            previousStatus: skill.status,
            issues: result.issues,
          },
          'Skill auto-degraded to error status',
        );
      }
    }
  }

  if (report.broken > 0) {
    logger.warn(
      { healthy: report.healthy, degraded: report.degraded, broken: report.broken },
      'Health check completed with issues',
    );
  } else {
    logger.info(
      { healthy: report.healthy, degraded: report.degraded },
      'Health check completed — all skills OK',
    );
  }

  return report;
}

/**
 * Start a periodic health check timer.
 * Returns a dispose function that clears the timer.
 */
export function startHealthCheckTimer(
  repo: SkillRepository,
  intervalMs = HEALTH_CHECK_INTERVAL_MS,
): { dispose: () => void } {
  const timer = setInterval(() => {
    healthCheckAndAutoRepair(repo).catch((err) => {
      logger.error({ error: (err as Error).message }, 'Periodic health check failed');
    });
  }, intervalMs);
  timer.unref();

  // Run initial health check (fire-and-forget)
  healthCheckAndAutoRepair(repo).catch(() => {});

  return {
    dispose() {
      clearInterval(timer);
    },
  };
}
