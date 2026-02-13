// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Template variable builders — extracted from engine.ts.
 *
 * Builds the `server` and `skill` sections of the TemplateVars object
 * used when resolving skill prompt templates.
 *
 * @module core/skill/engine-template-vars
 */

import { createContextLogger } from '../../utils/logger.js';
import { getServerRepository } from '../../db/repositories/server-repository.js';
import type { SkillRepository } from '../../db/repositories/skill-repository.js';

const logger = createContextLogger({ module: 'skill-template-vars' });

/** Server-related template variables. */
export interface ServerVars {
  name: string;
  os: string;
  ip: string;
}

/** Skill-related template variables. */
export interface SkillVars {
  last_run: string;
  last_result: string;
}

/** Build server-related template variables from the server repository. */
export async function buildServerVars(
  serverId: string,
  userId: string,
): Promise<ServerVars> {
  try {
    const serverRepo = getServerRepository();
    const server = await serverRepo.findById(serverId, userId);
    if (!server) {
      return { name: '', os: '', ip: '' };
    }

    let os = '';
    let ip = '';
    try {
      const profile = await serverRepo.getProfile(serverId, userId);
      if (profile?.osInfo) {
        os = profile.osInfo.platform;
        ip = profile.osInfo.hostname;
      }
    } catch {
      // Profile may not be available; use empty strings
    }

    return { name: server.name, os, ip };
  } catch {
    logger.debug({ serverId }, 'Failed to fetch server info for template vars');
    return { name: '', os: '', ip: '' };
  }
}

/** Build skill-related template variables from execution history. */
export async function buildSkillVars(
  repo: SkillRepository,
  skillId: string,
): Promise<SkillVars> {
  try {
    // Fetch a few recent executions — the newest may be the current in-progress one
    const executions = await repo.listExecutions(skillId, 5);
    const last = executions.find((e) => e.completedAt);
    if (!last) {
      return { last_run: 'N/A', last_result: 'N/A' };
    }
    const lastResult = last.result
      ? (typeof last.result['output'] === 'string'
          ? last.result['output']
          : JSON.stringify(last.result))
      : 'N/A';

    return {
      last_run: last.completedAt,
      last_result: lastResult,
    };
  } catch {
    logger.debug({ skillId }, 'Failed to fetch skill execution history for template vars');
    return { last_run: 'N/A', last_result: 'N/A' };
  }
}
