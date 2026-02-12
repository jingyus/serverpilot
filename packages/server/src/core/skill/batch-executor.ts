// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * BatchExecutor — multi-server batch execution for skills with
 * `server_scope: 'all'` or `server_scope: 'tagged'`.
 *
 * Executes a skill on multiple servers sequentially, aggregating results.
 * Each server gets an independent execution record. A single server's failure
 * does not block execution on remaining servers.
 *
 * @module core/skill/batch-executor
 */

import { randomUUID } from 'node:crypto';

import { createContextLogger } from '../../utils/logger.js';
import { getServerRepository } from '../../db/repositories/server-repository.js';
import type { SkillManifest } from '@aiinstaller/shared';
import type {
  InstalledSkill,
  SkillExecutionResult,
  BatchExecutionResult,
  BatchServerResult,
  SkillRunParams,
} from './types.js';

const logger = createContextLogger({ module: 'skill-batch-executor' });

/** Callback type for single-server execution (provided by SkillEngine). */
export type SingleExecuteFn = (
  params: SkillRunParams,
  skill: InstalledSkill,
  manifest: SkillManifest,
) => Promise<SkillExecutionResult>;

/**
 * Execute a skill across multiple servers sequentially.
 *
 * @param params - Original execution params (serverId used as fallback for 'single')
 * @param skill - The installed skill record
 * @param manifest - Loaded skill manifest
 * @param scope - 'all' or 'tagged'
 * @param executeSingleFn - Callback to execute on a single server
 */
export async function executeBatch(
  params: SkillRunParams,
  skill: InstalledSkill,
  manifest: SkillManifest,
  scope: 'all' | 'tagged',
  executeSingleFn: SingleExecuteFn,
): Promise<BatchExecutionResult> {
  const { userId } = params;
  const batchId = randomUUID();
  const batchStart = Date.now();

  // Resolve target servers
  const serverRepo = getServerRepository();
  const warnings: string[] = [];

  let servers: { id: string; name: string }[];

  if (scope === 'tagged') {
    const serverTags = manifest.constraints?.server_tags;
    if (!serverTags || serverTags.length === 0) {
      const msg =
        `server_scope 'tagged' requires server_tags in manifest (skill '${skill.name}'); ` +
        `falling back to single server '${params.serverId}'`;
      logger.warn({ batchId, skillId: skill.id, scope, serverId: params.serverId }, msg);
      warnings.push(msg);

      const server = await serverRepo.findById(params.serverId, userId);
      servers = server ? [{ id: server.id, name: server.name }] : [];
    } else {
      const tagged = await serverRepo.findByTags(userId, serverTags);
      servers = tagged.map((s) => ({ id: s.id, name: s.name }));
      if (servers.length === 0) {
        const msg =
          `server_scope 'tagged' matched 0 servers for tags [${serverTags.join(', ')}] ` +
          `(skill '${skill.name}'); falling back to single server '${params.serverId}'`;
        logger.warn({ batchId, skillId: skill.id, scope, serverTags, serverId: params.serverId }, msg);
        warnings.push(msg);

        const server = await serverRepo.findById(params.serverId, userId);
        servers = server ? [{ id: server.id, name: server.name }] : [];
      } else {
        logger.info(
          { batchId, skillId: skill.id, scope, serverTags, matchedCount: servers.length },
          'Resolved tagged servers',
        );
      }
    }
  } else {
    // scope === 'all': get all servers for this user
    const allServers = await serverRepo.findAllByUserId(userId);
    servers = allServers.map((s) => ({ id: s.id, name: s.name }));
  }

  if (servers.length === 0) {
    logger.warn({ skillId: skill.id, userId, scope }, 'No servers found for batch execution');
    return {
      batchId,
      serverScope: scope,
      results: [],
      successCount: 0,
      failureCount: 0,
      totalDuration: 0,
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  }

  logger.info(
    { batchId, skillId: skill.id, scope, serverCount: servers.length },
    'Starting batch execution',
  );

  // Execute on each server sequentially (avoids Agent concurrency conflicts)
  const batchResults: BatchServerResult[] = [];
  let successCount = 0;
  let failureCount = 0;

  for (const server of servers) {
    try {
      const serverParams: SkillRunParams = {
        ...params,
        serverId: server.id,
      };
      const result = await executeSingleFn(serverParams, skill, manifest);
      batchResults.push({ serverId: server.id, serverName: server.name, result });

      if (result.status === 'success') {
        successCount++;
      } else {
        failureCount++;
      }
    } catch (err) {
      const errorMessage = (err as Error).message;
      logger.error(
        { batchId, serverId: server.id, error: errorMessage },
        'Batch execution failed for server',
      );

      failureCount++;
      batchResults.push({
        serverId: server.id,
        serverName: server.name,
        result: {
          executionId: '',
          status: 'failed',
          stepsExecuted: 0,
          duration: 0,
          result: null,
          errors: [errorMessage],
        },
      });
    }
  }

  const totalDuration = Date.now() - batchStart;

  logger.info(
    { batchId, skillId: skill.id, scope, successCount, failureCount, totalDuration },
    'Batch execution completed',
  );

  return {
    batchId,
    serverScope: scope,
    results: batchResults,
    successCount,
    failureCount,
    totalDuration,
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}
