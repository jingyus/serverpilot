// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * SkillEngine query helpers — extracted from engine.ts to stay within file limits.
 *
 * Pure read-only operations: listing installed/available skills, fetching
 * single skills, execution history, and input enrichment.
 *
 * @module core/skill/engine-queries
 */

import { join } from 'node:path';
import { createContextLogger } from '../../utils/logger.js';
import {
  loadSkillFromDir,
  scanSkillDirectories,
  type ScannedSkill,
} from './loader.js';
import type { SkillRepository } from '../../db/repositories/skill-repository.js';
import type { SkillInput } from '@aiinstaller/shared';
import type {
  InstalledSkill,
  InstalledSkillWithInputs,
  SkillExecution,
  AvailableSkill,
} from './types.js';

const logger = createContextLogger({ module: 'skill-engine-queries' });

const DEFAULT_SKILL_PATHS = ['skills/official', 'skills/community'];

/** List all installed skills for a user. */
export async function listInstalled(
  repo: SkillRepository,
  userId: string,
): Promise<InstalledSkill[]> {
  return repo.findAll(userId);
}

/** List installed skills enriched with manifest input definitions. */
export async function listInstalledWithInputs(
  repo: SkillRepository,
  userId: string,
): Promise<InstalledSkillWithInputs[]> {
  const skills = await repo.findAll(userId);
  return Promise.all(
    skills.map(async (skill): Promise<InstalledSkillWithInputs> => {
      if (skill.manifestInputs) {
        return { ...skill, inputs: skill.manifestInputs as SkillInput[] };
      }
      try {
        const manifest = await loadSkillFromDir(skill.skillPath);
        return { ...skill, inputs: manifest.inputs ?? [] };
      } catch {
        logger.warn({ skillId: skill.id, path: skill.skillPath }, 'Failed to load manifest for inputs');
        return { ...skill, inputs: [] };
      }
    }),
  );
}

/** Get a single installed skill by ID. */
export async function getInstalled(
  repo: SkillRepository,
  skillId: string,
): Promise<InstalledSkill | null> {
  return repo.findById(skillId);
}

/** Get a single installed skill enriched with manifest input definitions. */
export async function getInstalledWithInputs(
  repo: SkillRepository,
  skillId: string,
): Promise<InstalledSkillWithInputs | null> {
  const skill = await repo.findById(skillId);
  if (!skill) return null;
  if (skill.manifestInputs) {
    return { ...skill, inputs: skill.manifestInputs as SkillInput[] };
  }
  try {
    const manifest = await loadSkillFromDir(skill.skillPath);
    return { ...skill, inputs: manifest.inputs ?? [] };
  } catch {
    logger.warn({ skillId: skill.id, path: skill.skillPath }, 'Failed to load manifest for inputs');
    return { ...skill, inputs: [] };
  }
}

/** List all available skills (official + community + local). */
export async function listAvailable(
  repo: SkillRepository,
  projectRoot: string,
  userId: string,
): Promise<AvailableSkill[]> {
  const scanPaths = DEFAULT_SKILL_PATHS.map((p) => join(projectRoot, p));
  const scanned = await scanSkillDirectories(scanPaths);
  const installed = await repo.findAll(userId);
  const installedNames = new Set(installed.map((s) => s.name));

  return scanned.map((s: ScannedSkill) => ({
    manifest: s.manifest,
    source: s.source,
    dirPath: s.dirPath,
    installed: installedNames.has(s.manifest.metadata.name),
  }));
}

/** Get execution history for a skill. */
export async function getExecutions(
  repo: SkillRepository,
  skillId: string,
  limit = 20,
): Promise<SkillExecution[]> {
  return repo.listExecutions(skillId, limit);
}

/** Get a single execution by ID. */
export async function getExecution(
  repo: SkillRepository,
  executionId: string,
): Promise<SkillExecution | null> {
  return repo.findExecutionById(executionId);
}
