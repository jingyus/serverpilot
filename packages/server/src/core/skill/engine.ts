// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * SkillEngine — core orchestrator for the Skill plugin system.
 * Manages lifecycle, execution, and queries for installed skills.
 * @module core/skill/engine
 */

import { resolve } from 'node:path';
import { createContextLogger } from '../../utils/logger.js';
import {
  loadSkillFromDir,
  resolvePromptTemplate,
  checkRequirements,
  type TemplateVars,
  type RequirementCheckResult,
} from './loader.js';
import {
  getSkillRepository,
  type SkillRepository,
} from '../../db/repositories/skill-repository.js';
import {
  getServerRepository,
} from '../../db/repositories/server-repository.js';
import { getWebhookDispatcher } from '../webhook/dispatcher.js';
import { upgradeFromGitUrl } from './git-installer.js';
import { getGitRemoteUrl } from './git-utils.js';
import { SkillConfirmationManager } from './engine-confirmation.js';
import {
  listInstalled as queryListInstalled,
  listInstalledWithInputs as queryListInstalledWithInputs,
  getInstalled as queryGetInstalled,
  getInstalledWithInputs as queryGetInstalledWithInputs,
  listAvailable as queryListAvailable,
  getExecutions as queryGetExecutions,
  getExecution as queryGetExecution,
} from './engine-queries.js';
import { buildServerVars, buildSkillVars } from './engine-template-vars.js';
import { startCleanupTimers, cleanupOldExecutions, EXECUTION_RETENTION_DAYS } from './engine-cleanup.js';
import type { SkillManifest } from '@aiinstaller/shared';
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
import { getSkillEventBus } from './skill-event-bus.js';
import { executeBatch } from './batch-executor.js';
import { TriggerManager, setTriggerManager, _resetTriggerManager } from './trigger-manager.js';

const logger = createContextLogger({ module: 'skill-engine' });

// --------------- Constants ---------------

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
  private cleanupDispose: (() => void) | null = null;
  private confirmationManager: SkillConfirmationManager;
  /** Map of running execution IDs to their AbortControllers for cancellation support. */
  private runningExecutions = new Map<string, AbortController>();

  constructor(projectRoot: string, repo?: SkillRepository) {
    this.projectRoot = resolve(projectRoot);
    this.repo = repo ?? getSkillRepository();
    this.confirmationManager = new SkillConfirmationManager({
      repo: this.repo,
      buildServerVars: (serverId, userId) => buildServerVars(serverId, userId),
      buildSkillVars: (skillId) => buildSkillVars(this.repo, skillId),
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

    // Periodic cleanup timers (confirmations + old executions)
    const cleanup = startCleanupTimers(
      this.repo,
      () => this.expirePendingConfirmations(),
      () => this.cleanupOldExecutions(),
    );
    this.cleanupDispose = cleanup.dispose;

    logger.info('SkillEngine started');
  }

  /** Stop background services. */
  stop(): void {
    if (!this.running) return;
    this.running = false;

    if (this.cleanupDispose) {
      this.cleanupDispose();
      this.cleanupDispose = null;
    }

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

  /**
   * Upgrade a skill in-place, preserving config and execution history.
   *
   * - Git source: atomic clone → validate → swap (rollback on failure)
   * - Local source: re-read manifest from disk → update DB metadata
   *
   * Pauses triggers during upgrade and re-registers on success.
   */
  async upgrade(skillId: string, userId: string): Promise<InstalledSkill> {
    const skill = await this.repo.findById(skillId);
    if (!skill) {
      throw new Error(`Skill not found: ${skillId}`);
    }
    if (skill.userId !== userId) {
      throw new Error(`Not authorized to upgrade skill: ${skillId}`);
    }

    // Pause triggers during upgrade
    const wasTriggerRegistered = skill.status === 'enabled';
    if (wasTriggerRegistered) {
      this.triggerManager?.unregisterSkill(skillId);
    }

    try {
      let newManifest: SkillManifest;

      if (skill.source === 'community') {
        // Git-based upgrade: read git remote URL, clone new version, atomic swap
        newManifest = await this.upgradeGitSkill(skill);
      } else {
        // Local/official: re-load manifest from disk (hot reload)
        newManifest = await loadSkillFromDir(skill.skillPath);
      }

      const previousVersion = skill.version;

      // Update DB record — preserves id, config, executions
      await this.repo.updateManifest(skillId, {
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
        const updatedSkill = await this.repo.findById(skillId);
        if (updatedSkill && this.triggerManager) {
          await this.triggerManager.registerSkill(updatedSkill);
        }
      }

      return (await this.repo.findById(skillId))!;
    } catch (err) {
      // Re-register triggers even on failure (skill stays at old version)
      if (wasTriggerRegistered) {
        const currentSkill = await this.repo.findById(skillId);
        if (currentSkill && this.triggerManager) {
          await this.triggerManager.registerSkill(currentSkill);
        }
      }
      throw err;
    }
  }

  /**
   * Upgrade a git-sourced (community) skill.
   * Reads the git remote URL from the cloned directory, then performs atomic upgrade.
   */
  private async upgradeGitSkill(skill: InstalledSkill): Promise<SkillManifest> {
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
        this.triggerManager.resetFailureCounter(skillId);
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

    // Check skill requirements against server profile
    const reqCheck = await this.checkSkillRequirements(manifest, serverId, userId);
    if (!reqCheck.satisfied) {
      throw new Error(
        `Skill requirements not met: ${reqCheck.missing.join('; ')}`,
      );
    }
    if (reqCheck.warnings.length > 0) {
      logger.warn(
        { skillId, warnings: reqCheck.warnings },
        'Skill requirements check has warnings',
      );
    }

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

    // Create AbortController for external cancellation
    const abortController = new AbortController();
    this.runningExecutions.set(execution.id, abortController);

    try {
      // Resolve prompt template with available variables
      const mergedConfig = { ...skill.config, ...params.config };

      // Build server context from repository
      const serverVars = await buildServerVars(serverId, userId);

      // Build skill context from last execution
      const skillVars = await buildSkillVars(this.repo, skillId);

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
        signal: abortController.signal,
      });

      const duration = Date.now() - startTime;
      const status = runResult.status === 'success' ? 'success'
        : runResult.status === 'cancelled' ? 'cancelled'
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
    } finally {
      this.runningExecutions.delete(execution.id);
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

  /** Delete execution records older than the retention period (90 days). */
  async cleanupOldExecutions(): Promise<number> {
    return cleanupOldExecutions(this.repo);
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

  /** Cancel a running skill execution. */
  async cancel(executionId: string): Promise<void> {
    const controller = this.runningExecutions.get(executionId);
    if (!controller) {
      throw new Error(`Execution not found or not running: ${executionId}`);
    }

    controller.abort();
    // Publish immediate SSE event so the dashboard gets notified right away
    const bus = getSkillEventBus();
    bus.publish(executionId, {
      type: 'error',
      executionId,
      timestamp: new Date().toISOString(),
      message: 'Execution cancelled by user',
    });

    logger.info({ executionId }, 'Skill execution cancel requested');
  }

  /** Check if a specific execution is currently running. */
  isExecutionRunning(executionId: string): boolean {
    return this.runningExecutions.has(executionId);
  }

  /** Get all currently running execution IDs. */
  getRunningExecutionIds(): string[] {
    return Array.from(this.runningExecutions.keys());
  }

  /**
   * Check skill requirements against the target server's profile.
   * Agent version is not yet available in the protocol, so it passes null
   * which causes a graceful degradation to a warning.
   */
  private async checkSkillRequirements(
    manifest: SkillManifest,
    serverId: string,
    userId: string,
  ): Promise<RequirementCheckResult> {
    let serverProfile = null;
    try {
      const serverRepo = getServerRepository();
      serverProfile = await serverRepo.getProfile(serverId, userId);
    } catch {
      // Profile may not be available — checkRequirements handles null gracefully
    }

    // Agent version not yet reported via protocol — pass null to degrade to warning
    const agentVersion: string | null = null;

    return checkRequirements(manifest.requires, serverProfile, agentVersion);
  }

  /** List all installed skills for a user. */
  async listInstalled(userId: string): Promise<InstalledSkill[]> {
    return queryListInstalled(this.repo, userId);
  }

  /** List installed skills enriched with manifest input definitions. */
  async listInstalledWithInputs(userId: string): Promise<InstalledSkillWithInputs[]> {
    return queryListInstalledWithInputs(this.repo, userId);
  }

  /** Get a single installed skill by ID. */
  async getInstalled(skillId: string): Promise<InstalledSkill | null> {
    return queryGetInstalled(this.repo, skillId);
  }

  /** Get a single installed skill enriched with manifest input definitions. */
  async getInstalledWithInputs(skillId: string): Promise<InstalledSkillWithInputs | null> {
    return queryGetInstalledWithInputs(this.repo, skillId);
  }

  /** List all available skills (official + community + local). */
  async listAvailable(userId: string): Promise<AvailableSkill[]> {
    return queryListAvailable(this.repo, this.projectRoot, userId);
  }

  /** Get execution history for a skill. */
  async getExecutions(skillId: string, limit = 20): Promise<SkillExecution[]> {
    return queryGetExecutions(this.repo, skillId, limit);
  }

  /** Get a single execution by ID. */
  async getExecution(executionId: string): Promise<SkillExecution | null> {
    return queryGetExecution(this.repo, executionId);
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
