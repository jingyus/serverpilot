// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * SkillEngine — core orchestrator for the Skill plugin system.
 * Manages lifecycle, execution, and queries for installed skills.
 * @module core/skill/engine
 */

import { join, resolve } from 'node:path';
import { createContextLogger } from '../../utils/logger.js';
import {
  loadSkillFromDir,
  scanSkillDirectories,
  resolvePromptTemplate,
  type ScannedSkill,
  type TemplateVars,
} from './loader.js';
import {
  getSkillRepository,
  type SkillRepository,
} from '../../db/repositories/skill-repository.js';
import {
  getServerRepository,
} from '../../db/repositories/server-repository.js';
import { getWebhookDispatcher } from '../webhook/dispatcher.js';
import { SkillConfirmationManager } from './engine-confirmation.js';
import type { SkillManifest, SkillInput } from '@aiinstaller/shared';
import type { SkillStatus } from '../../db/schema.js';
import type {
  InstalledSkill,
  InstalledSkillWithInputs,
  SkillExecution,
  SkillExecutionResult,
  BatchExecutionResult,
  AvailableSkill,
  SkillRunParams,
  ChainContext,
} from './types.js';
import { SkillRunner } from './runner.js';
import { executeBatch } from './batch-executor.js';
import { TriggerManager, setTriggerManager, _resetTriggerManager } from './trigger-manager.js';

const logger = createContextLogger({ module: 'skill-engine' });

// --------------- Constants ---------------

const DEFAULT_SKILL_PATHS = ['skills/official', 'skills/community'];

const MAX_CHAIN_DEPTH = 5;

const STATUS_TRANSITIONS: Record<SkillStatus, SkillStatus[]> = {
  installed:  ['configured', 'enabled', 'error'],
  configured: ['enabled', 'paused', 'error'],
  enabled:    ['paused', 'error'],
  paused:     ['enabled', 'error'],
  error:      ['installed', 'enabled', 'paused'],
};

export class SkillEngine {
  private projectRoot: string;
  private repo: SkillRepository;
  private running = false;
  private triggerManager: TriggerManager | null = null;
  private confirmationManager: SkillConfirmationManager;

  constructor(projectRoot: string, repo?: SkillRepository) {
    this.projectRoot = resolve(projectRoot);
    this.repo = repo ?? getSkillRepository();
    this.confirmationManager = new SkillConfirmationManager({
      repo: this.repo,
      buildServerVars: (serverId, userId) => this.buildServerVars(serverId, userId),
      buildSkillVars: (skillId) => this.buildSkillVars(skillId),
      dispatchWebhookEvent: (type, userId, data) => this.dispatchWebhookEvent(type, userId, data),
    });
    logger.info({ projectRoot: this.projectRoot }, 'SkillEngine created');
  }

  /** Start background services including TriggerManager. */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    // Create and start TriggerManager
    this.triggerManager = new TriggerManager(
      async (skillId, serverId, userId, triggerType, chainContext) => {
        await this.execute({ skillId, serverId, userId, triggerType, chainContext });
      },
      this.repo,
    );
    setTriggerManager(this.triggerManager);
    await this.triggerManager.start();

    logger.info('SkillEngine started');
  }

  /** Stop background services. */
  stop(): void {
    if (!this.running) return;
    this.running = false;

    if (this.triggerManager) {
      this.triggerManager.stop();
      this.triggerManager = null;
      _resetTriggerManager();
    }

    logger.info('SkillEngine stopped');
  }

  /** Install a skill from a directory. Rejects duplicate (same user + name). */
  async install(
    userId: string,
    skillDir: string,
    source: 'official' | 'community' | 'local',
  ): Promise<InstalledSkill> {
    const resolvedDir = resolve(skillDir);
    const manifest = await loadSkillFromDir(resolvedDir);

    // Check for duplicate
    const existing = await this.repo.findByName(userId, manifest.metadata.name);
    if (existing) {
      throw new Error(
        `Skill '${manifest.metadata.name}' is already installed (id=${existing.id})`,
      );
    }

    const skill = await this.repo.install({
      userId,
      name: manifest.metadata.name,
      displayName: manifest.metadata.displayName,
      version: manifest.metadata.version,
      source,
      skillPath: resolvedDir,
      config: null,
      manifestInputs: manifest.inputs ?? null,
    });

    logger.info(
      { skillId: skill.id, name: manifest.metadata.name, source },
      'Skill installed',
    );
    return skill;
  }

  /** Uninstall a skill by ID. */
  async uninstall(skillId: string): Promise<void> {
    const skill = await this.repo.findById(skillId);
    if (!skill) {
      throw new Error(`Skill not found: ${skillId}`);
    }

    // Unregister triggers before removing from DB
    this.triggerManager?.unregisterSkill(skillId);

    await this.repo.uninstall(skillId);
    logger.info({ skillId, name: skill.name }, 'Skill uninstalled');
  }

  /** Update user configuration (input values) for an installed skill. */
  async configure(skillId: string, config: Record<string, unknown>): Promise<void> {
    const skill = await this.repo.findById(skillId);
    if (!skill) {
      throw new Error(`Skill not found: ${skillId}`);
    }
    await this.repo.updateConfig(skillId, config);

    // Auto-transition from installed → configured if first config
    if (skill.status === 'installed') {
      await this.repo.updateStatus(skillId, 'configured');
    }

    logger.info({ skillId, name: skill.name }, 'Skill configured');
  }

  /** Update status with valid state transition enforcement. */
  async updateStatus(skillId: string, newStatus: SkillStatus): Promise<void> {
    const skill = await this.repo.findById(skillId);
    if (!skill) {
      throw new Error(`Skill not found: ${skillId}`);
    }

    const allowed = STATUS_TRANSITIONS[skill.status];
    if (!allowed?.includes(newStatus)) {
      throw new Error(
        `Invalid status transition: ${skill.status} → ${newStatus}`,
      );
    }

    await this.repo.updateStatus(skillId, newStatus);

    // Update trigger registration based on new status
    if (this.triggerManager) {
      if (newStatus === 'enabled') {
        const updatedSkill = await this.repo.findById(skillId);
        if (updatedSkill) {
          await this.triggerManager.registerSkill(updatedSkill);
        }
      } else if (newStatus === 'paused' || newStatus === 'error') {
        this.triggerManager.unregisterSkill(skillId);
      }
    }

    logger.info(
      { skillId, name: skill.name, from: skill.status, to: newStatus },
      'Skill status updated',
    );
  }

  /** Execute a skill, dispatching to batch mode if server_scope is 'all' or 'tagged'. */
  async execute(params: SkillRunParams): Promise<SkillExecutionResult | BatchExecutionResult> {
    const { skillId, chainContext } = params;

    // Chain depth / cycle validation
    if (chainContext) {
      if (chainContext.depth >= MAX_CHAIN_DEPTH) {
        throw new Error(
          `Chain depth limit exceeded (max=${MAX_CHAIN_DEPTH}): ${chainContext.trail.join(' → ')} → ${skillId}`,
        );
      }
      if (chainContext.trail.includes(skillId)) {
        throw new Error(
          `Circular chain detected: ${chainContext.trail.join(' → ')} → ${skillId}`,
        );
      }
    }

    // Load installed skill
    const skill = await this.repo.findById(skillId);
    if (!skill) {
      throw new Error(`Skill not found: ${skillId}`);
    }

    // Must be enabled to execute
    if (skill.status !== 'enabled') {
      throw new Error(
        `Skill '${skill.name}' is not enabled (status=${skill.status})`,
      );
    }

    // Load and validate manifest from disk
    let manifest: SkillManifest;
    try {
      manifest = await loadSkillFromDir(skill.skillPath);
    } catch (err) {
      await this.repo.updateStatus(skillId, 'error');
      throw new Error(
        `Failed to load skill manifest: ${(err as Error).message}`,
      );
    }

    // Determine server scope
    const serverScope = manifest.constraints?.server_scope ?? 'single';

    if (serverScope === 'all' || serverScope === 'tagged') {
      return executeBatch(
        params, skill, manifest, serverScope,
        (p, s, m) => this.executeSingle(p, s, m),
      );
    }

    // Default: single-server execution
    return this.executeSingle(params, skill, manifest);
  }

  /** Execute a skill on a single server. Reused by batch mode via callback. */
  private async executeSingle(
    params: SkillRunParams,
    skill: InstalledSkill,
    manifest: SkillManifest,
  ): Promise<SkillExecutionResult> {
    const { skillId, serverId, userId, triggerType, chainContext } = params;
    const startTime = Date.now();

    // Check if confirmation is required for auto-triggered skills
    const needsConfirmation =
      manifest.constraints?.requires_confirmation === true &&
      triggerType !== 'manual';

    if (needsConfirmation) {
      return this.confirmationManager.createPendingConfirmation(params, skill, manifest);
    }

    // Create execution record
    const execution = await this.repo.createExecution({
      skillId,
      serverId,
      userId,
      triggerType,
    });

    // Build chain context for downstream triggers
    const nextChain: ChainContext = {
      depth: (chainContext?.depth ?? 0) + 1,
      trail: [...(chainContext?.trail ?? []), skillId],
    };

    try {
      // Resolve prompt template with available variables
      const mergedConfig = { ...skill.config, ...params.config };

      // Build server context from repository
      const serverVars = await this.buildServerVars(serverId, userId);

      // Build skill context from last execution
      const skillVars = await this.buildSkillVars(skillId);

      const templateVars: TemplateVars = {
        input: mergedConfig,
        server: serverVars,
        skill: skillVars,
        now: new Date().toISOString(),
      };
      const resolvedPrompt = resolvePromptTemplate(manifest.prompt, templateVars);

      // Run via AI SkillRunner
      const runner = new SkillRunner();
      const runResult = await runner.run({
        manifest,
        resolvedPrompt,
        skillId,
        serverId,
        userId,
        executionId: execution.id,
        config: mergedConfig,
      });

      const duration = Date.now() - startTime;
      const status = runResult.status === 'success' ? 'success'
        : runResult.status === 'timeout' ? 'timeout'
        : 'failed';

      const result: Record<string, unknown> = {
        output: runResult.output,
        toolResults: runResult.toolResults,
        errors: runResult.errors,
        ...(runResult.parsedOutputs ? { parsedOutputs: runResult.parsedOutputs } : {}),
      };

      await this.repo.completeExecution(
        execution.id,
        status,
        result,
        runResult.stepsExecuted,
        duration,
      );

      logger.info(
        { executionId: execution.id, skillId, serverId, duration, steps: runResult.stepsExecuted },
        'Skill execution completed',
      );

      const execResult: SkillExecutionResult = {
        executionId: execution.id,
        status,
        stepsExecuted: runResult.stepsExecuted,
        duration,
        result,
        errors: runResult.errors,
      };

      this.emitTriggerEvent(
        status === 'success' ? 'skill.completed' : 'skill.failed',
        { serverId, skillId, skillName: skill.name, executionId: execution.id, chainContext: nextChain },
      );

      this.dispatchWebhookEvent(
        status === 'success' ? 'skill.completed' : 'skill.failed',
        userId,
        { serverId, skillId, skillName: skill.name, executionId: execution.id, status, duration },
      );

      return execResult;
    } catch (err) {
      const duration = Date.now() - startTime;
      const errorMessage = (err as Error).message;

      await this.repo.completeExecution(execution.id, 'failed', { error: errorMessage }, 0, duration);
      logger.error({ executionId: execution.id, skillId, error: errorMessage }, 'Skill execution failed');

      this.emitTriggerEvent('skill.failed', {
        serverId, skillId, skillName: skill.name, executionId: execution.id, chainContext: nextChain,
      });

      this.dispatchWebhookEvent('skill.failed', userId, {
        serverId, skillId, skillName: skill.name, executionId: execution.id,
        status: 'failed', duration, error: errorMessage,
      });

      return {
        executionId: execution.id, status: 'failed', stepsExecuted: 0,
        duration, result: null, errors: [errorMessage],
      };
    }
  }

  /** Fire-and-forget event emission for chain triggers. */
  private emitTriggerEvent(eventType: string, data: Record<string, unknown>): void {
    if (!this.triggerManager) return;
    this.triggerManager.handleEvent(eventType, data).catch((err) => {
      logger.error({ eventType, error: (err as Error).message }, 'Failed to emit trigger event');
    });
  }

  /** Fire-and-forget webhook dispatch for external subscribers. */
  private dispatchWebhookEvent(
    type: 'skill.completed' | 'skill.failed',
    userId: string,
    data: Record<string, unknown>,
  ): void {
    try {
      const dispatcher = getWebhookDispatcher();
      dispatcher.dispatch({ type, userId, data }).catch((err) => {
        logger.error({ type, error: (err as Error).message }, 'Failed to dispatch webhook event');
      });
    } catch {
      // Dispatcher not initialized — skip silently (e.g. in tests)
    }
  }

  async confirmExecution(executionId: string, userId: string): Promise<SkillExecutionResult> {
    return this.confirmationManager.confirmExecution(executionId, userId);
  }

  async rejectExecution(executionId: string, userId: string): Promise<void> {
    return this.confirmationManager.rejectExecution(executionId, userId);
  }

  async listPendingConfirmations(userId: string): Promise<SkillExecution[]> {
    return this.confirmationManager.listPendingConfirmations(userId);
  }

  async expirePendingConfirmations(): Promise<number> {
    return this.confirmationManager.expirePendingConfirmations();
  }

  /** Build server-related template variables from the server repository. */
  private async buildServerVars(
    serverId: string,
    userId: string,
  ): Promise<{ name: string; os: string; ip: string }> {
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
  private async buildSkillVars(
    skillId: string,
  ): Promise<{ last_run: string; last_result: string }> {
    try {
      // Fetch a few recent executions — the newest may be the current in-progress one
      const executions = await this.repo.listExecutions(skillId, 5);
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

  /** List all installed skills for a user. */
  async listInstalled(userId: string): Promise<InstalledSkill[]> {
    return this.repo.findAll(userId);
  }

  /** List installed skills enriched with manifest input definitions. */
  async listInstalledWithInputs(userId: string): Promise<InstalledSkillWithInputs[]> {
    const skills = await this.repo.findAll(userId);
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
  async getInstalled(skillId: string): Promise<InstalledSkill | null> {
    return this.repo.findById(skillId);
  }

  /** Get a single installed skill enriched with manifest input definitions. */
  async getInstalledWithInputs(skillId: string): Promise<InstalledSkillWithInputs | null> {
    const skill = await this.repo.findById(skillId);
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
  async listAvailable(userId: string): Promise<AvailableSkill[]> {
    const scanPaths = DEFAULT_SKILL_PATHS.map((p) => join(this.projectRoot, p));
    const scanned = await scanSkillDirectories(scanPaths);
    const installed = await this.repo.findAll(userId);
    const installedNames = new Set(installed.map((s) => s.name));

    return scanned.map((s: ScannedSkill) => ({
      manifest: s.manifest,
      source: s.source,
      dirPath: s.dirPath,
      installed: installedNames.has(s.manifest.metadata.name),
    }));
  }

  /** Get execution history for a skill. */
  async getExecutions(skillId: string, limit = 20): Promise<SkillExecution[]> {
    return this.repo.listExecutions(skillId, limit);
  }

  /** Get a single execution by ID. */
  async getExecution(executionId: string): Promise<SkillExecution | null> {
    return this.repo.findExecutionById(executionId);
  }
}

let _instance: SkillEngine | null = null;

export function getSkillEngine(projectRoot?: string): SkillEngine {
  if (!_instance) {
    if (!projectRoot) {
      throw new Error('SkillEngine not initialized — provide projectRoot on first call');
    }
    _instance = new SkillEngine(projectRoot);
  }
  return _instance;
}

export function setSkillEngine(engine: SkillEngine): void {
  _instance = engine;
}

export function _resetSkillEngine(): void {
  if (_instance) {
    _instance.stop();
  }
  _instance = null;
}
