// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Skill upgrade logic, extracted from SkillEngine.
 *
 * Handles:
 * - `upgrade()` — upgrade a skill in-place (local hot-reload or git atomic swap)
 * - `upgradeGitSkill()` — git-sourced community skill upgrade
 *
 * @module core/skill/engine-upgrade
 */

import { createContextLogger } from '../../utils/logger.js';
import { loadSkillFromDir } from './loader.js';
import { upgradeFromGitUrl } from './git-installer.js';
import { getGitRemoteUrl } from './git-utils.js';
import type { SkillRepository } from '../../db/repositories/skill-repository.js';
import type { TriggerManager } from './trigger-manager.js';
import type { SkillManifest } from '@aiinstaller/shared';
import type { InstalledSkill } from './types.js';

const logger = createContextLogger({ module: 'skill-upgrade' });

/** Dependencies injected from SkillEngine into upgrade(). */
export interface UpgradeDeps {
  repo: SkillRepository;
  triggerManager: TriggerManager | null;
}

/**
 * Upgrade a skill in-place, preserving config and execution history.
 *
 * - Git source: atomic clone → validate → swap (rollback on failure)
 * - Local source: re-read manifest from disk → update DB metadata
 *
 * Pauses triggers during upgrade and re-registers on success.
 */
export async function upgrade(
  skillId: string,
  userId: string,
  deps: UpgradeDeps,
): Promise<InstalledSkill> {
  const { repo, triggerManager } = deps;

  const skill = await repo.findById(skillId);
  if (!skill) {
    throw new Error(`Skill not found: ${skillId}`);
  }
  if (skill.userId !== userId) {
    throw new Error(`Not authorized to upgrade skill: ${skillId}`);
  }

  // Pause triggers during upgrade
  const wasTriggerRegistered = skill.status === 'enabled';
  if (wasTriggerRegistered) {
    triggerManager?.unregisterSkill(skillId);
  }

  try {
    let newManifest: SkillManifest;

    if (skill.source === 'community') {
      // Git-based upgrade: read git remote URL, clone new version, atomic swap
      newManifest = await upgradeGitSkill(skill);
    } else {
      // Local/official: re-load manifest from disk (hot reload)
      newManifest = await loadSkillFromDir(skill.skillPath);
    }

    const previousVersion = skill.version;

    // Update DB record — preserves id, config, executions
    await repo.updateManifest(skillId, {
      version: newManifest.metadata.version,
      displayName: newManifest.metadata.displayName,
      manifestInputs: newManifest.inputs ?? null,
    });

    logger.info(
      {
        skillId,
        name: skill.name,
        previousVersion,
        newVersion: newManifest.metadata.version,
        source: skill.source,
      },
      'Skill upgraded',
    );

    // Re-register triggers if the skill was enabled
    if (wasTriggerRegistered) {
      const updatedSkill = await repo.findById(skillId);
      if (updatedSkill && triggerManager) {
        await triggerManager.registerSkill(updatedSkill);
      }
    }

    return (await repo.findById(skillId))!;
  } catch (err) {
    // Re-register triggers even on failure (skill stays at old version)
    if (wasTriggerRegistered) {
      const currentSkill = await repo.findById(skillId);
      if (currentSkill && triggerManager) {
        await triggerManager.registerSkill(currentSkill);
      }
    }
    throw err;
  }
}

/**
 * Upgrade a git-sourced (community) skill.
 * Reads the git remote URL from the cloned directory, then performs atomic upgrade.
 */
async function upgradeGitSkill(skill: InstalledSkill): Promise<SkillManifest> {
  // Read git remote URL from the existing clone
  const gitUrl = await getGitRemoteUrl(skill.skillPath);
  if (!gitUrl) {
    throw new Error(
      `Cannot determine git remote URL for skill '${skill.name}' at ${skill.skillPath}. ` +
      'The directory may not be a valid git repository.',
    );
  }

  const result = await upgradeFromGitUrl(skill.skillPath, gitUrl);
  return result.manifest;
}
