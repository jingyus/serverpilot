// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * SkillEngine — core orchestrator for the Skill plugin system.
 * Manages lifecycle, execution, and queries for installed skills.
 *
 * Execution, upgrade, and cancellation logic have been extracted into:
 * - engine-execute.ts   (executeSingle, emitTriggerEvent, dispatchWebhookEvent)
 * - engine-upgrade.ts   (upgrade, upgradeGitSkill)
 * - engine-cancellation.ts (RunningExecutionTracker, cancelExecution)
 *
 * @module core/skill/engine
 */

import { resolve } from 'node:path';
import { createContextLogger } from '../../utils/logger.js';
import { loadSkillFromDir } from './loader.js';
import {
  getSkillRepository,
  type SkillRepository,
} from '../../db/repositories/skill-repository.js';
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
import { startCleanupTimers, cleanupOldExecutions } from './engine-cleanup.js';
import {
  healthCheckAndAutoRepair,
  startHealthCheckTimer,
  type HealthReport,
} from './engine-health.js';
import { executeSingle, dispatchWebhookEvent } from './engine-execute.js';
import { upgrade as upgradeSkill } from './engine-upgrade.js';
import { RunningExecutionTracker, cancelExecution } from './engine-cancellation.js';
import { executeBatch } from './batch-executor.js';
import { TriggerManager, setTriggerManager, _resetTriggerManager } from './trigger-manager.js';
import type { SkillStatus } from '../../db/schema.js';
import type {
  InstalledSkill,
  InstalledSkillWithInputs,
  SkillExecution,
  SkillExecutionResult,
  BatchExecutionResult,
  AvailableSkill,
  SkillRunParams,
} from './types.js';

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
  private healthDispose: (() => void) | null = null;
  private confirmationManager: SkillConfirmationManager;
  private runningExecutions = new RunningExecutionTracker();

  constructor(projectRoot: string, repo?: SkillRepository) {
    this.projectRoot = resolve(projectRoot);
    this.repo = repo ?? getSkillRepository();
    this.confirmationManager = new SkillConfirmationManager({
      repo: this.repo,
      buildServerVars: (serverId, userId) => buildServerVars(serverId, userId),
      buildSkillVars: (skillId) => buildSkillVars(this.repo, skillId),
      dispatchWebhookEvent: (type, userId, data) => dispatchWebhookEvent(type, userId, data),
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

    // Periodic health check (every 6 hours)
    const health = startHealthCheckTimer(this.repo);
    this.healthDispose = health.dispose;

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

    if (this.healthDispose) {
      this.healthDispose();
      this.healthDispose = null;
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

  /** Upgrade a skill in-place, preserving config and execution history. */
  async upgrade(skillId: string, userId: string): Promise<InstalledSkill> {
    return upgradeSkill(skillId, userId, {
      repo: this.repo,
      triggerManager: this.triggerManager,
    });
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
    let manifest;
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
        (p, s, m) => executeSingle(p, s, m, this.buildExecuteDeps()),
      );
    }

    // Default: single-server execution
    return executeSingle(params, skill, manifest, this.buildExecuteDeps());
  }

  /** Build the dependency bag for executeSingle(). */
  private buildExecuteDeps() {
    return {
      repo: this.repo,
      triggerManager: this.triggerManager,
      runningExecutions: this.runningExecutions,
      confirmationManager: this.confirmationManager,
    };
  }

  /** Delete execution records older than the retention period (90 days). */
  async cleanupOldExecutions(): Promise<number> {
    return cleanupOldExecutions(this.repo);
  }

  /** Run health check on all installed skills. Broken skills are auto-marked as error. */
  async healthCheck(): Promise<HealthReport> {
    return healthCheckAndAutoRepair(this.repo);
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
    cancelExecution(this.runningExecutions, executionId);
  }

  /** Check if a specific execution is currently running. */
  isExecutionRunning(executionId: string): boolean {
    return this.runningExecutions.has(executionId);
  }

  /** Get all currently running execution IDs. */
  getRunningExecutionIds(): string[] {
    return this.runningExecutions.keys();
  }

  // =========================================================================
  // Query delegates (thin wrappers around engine-queries.ts)
  // =========================================================================

  async listInstalled(userId: string): Promise<InstalledSkill[]> {
    return queryListInstalled(this.repo, userId);
  }

  async listInstalledWithInputs(userId: string): Promise<InstalledSkillWithInputs[]> {
    return queryListInstalledWithInputs(this.repo, userId);
  }

  async getInstalled(skillId: string): Promise<InstalledSkill | null> {
    return queryGetInstalled(this.repo, skillId);
  }

  async getInstalledWithInputs(skillId: string): Promise<InstalledSkillWithInputs | null> {
    return queryGetInstalledWithInputs(this.repo, skillId);
  }

  async listAvailable(userId: string): Promise<AvailableSkill[]> {
    return queryListAvailable(this.repo, this.projectRoot, userId);
  }

  async getExecutions(skillId: string, limit = 20): Promise<SkillExecution[]> {
    return queryGetExecutions(this.repo, skillId, limit);
  }

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
