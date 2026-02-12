// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * SkillEngine — core orchestrator for the Skill plugin system.
 *
 * Manages the full skill lifecycle:
 * - Install / uninstall skills from disk
 * - Configure user-facing inputs
 * - Enable / pause / error status transitions
 * - Execute skills (manual trigger via AI SkillRunner)
 * - Query installed skills, available skills, and execution history
 *
 * Uses singleton pattern consistent with all other core services.
 *
 * @module core/skill/engine
 */

import { join, resolve } from 'node:path';

import { createContextLogger } from '../../utils/logger.js';
import {
  loadSkillFromDir,
  scanSkillDirectories,
  resolvePromptTemplate,
  checkRequirements,
  type ScannedSkill,
} from './loader.js';
import {
  getSkillRepository,
  type SkillRepository,
} from '../../db/repositories/skill-repository.js';
import type { SkillManifest, SkillInput } from '@aiinstaller/shared';
import type { SkillStatus } from '../../db/schema.js';
import type {
  InstalledSkill,
  InstalledSkillWithInputs,
  SkillExecution,
  SkillExecutionResult,
  AvailableSkill,
  SkillRunParams,
  ChainContext,
} from './types.js';
import { SkillRunner } from './runner.js';
import { TriggerManager, setTriggerManager, _resetTriggerManager } from './trigger-manager.js';

const logger = createContextLogger({ module: 'skill-engine' });

// ============================================================================
// Constants
// ============================================================================

/** Default directories to scan for available skills (relative to project root). */
const DEFAULT_SKILL_PATHS = ['skills/official', 'skills/community'];

/** Maximum chain depth for skill.completed event-driven triggers. */
const MAX_CHAIN_DEPTH = 5;

/** Valid status transitions. */
const STATUS_TRANSITIONS: Record<SkillStatus, SkillStatus[]> = {
  installed:  ['configured', 'enabled', 'error'],
  configured: ['enabled', 'paused', 'error'],
  enabled:    ['paused', 'error'],
  paused:     ['enabled', 'error'],
  error:      ['installed', 'enabled', 'paused'],
};

// ============================================================================
// SkillEngine
// ============================================================================

export class SkillEngine {
  private projectRoot: string;
  private repo: SkillRepository;
  private running = false;
  private triggerManager: TriggerManager | null = null;

  constructor(projectRoot: string, repo?: SkillRepository) {
    this.projectRoot = resolve(projectRoot);
    this.repo = repo ?? getSkillRepository();
    logger.info({ projectRoot: this.projectRoot }, 'SkillEngine created');
  }

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

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

  // --------------------------------------------------------------------------
  // Install / Uninstall
  // --------------------------------------------------------------------------

  /**
   * Install a skill from a directory.
   *
   * Loads and validates the skill.yaml, then persists to DB.
   * Rejects duplicate installations (same user + skill name).
   */
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

  /**
   * Uninstall a skill by ID.
   *
   * @throws Error if skill does not exist
   */
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

  // --------------------------------------------------------------------------
  // Configuration
  // --------------------------------------------------------------------------

  /**
   * Update user configuration (input values) for an installed skill.
   *
   * @throws Error if skill does not exist
   */
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

  /**
   * Update the status of an installed skill.
   *
   * Validates state transitions — not all transitions are allowed.
   *
   * @throws Error if skill does not exist or transition is invalid
   */
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

  // --------------------------------------------------------------------------
  // Execution
  // --------------------------------------------------------------------------

  /**
   * Execute a skill (manual trigger) via the AI SkillRunner.
   *
   * Creates execution record, resolves the prompt template, then delegates
   * to SkillRunner for autonomous AI-driven execution with security checks.
   */
  async execute(params: SkillRunParams): Promise<SkillExecutionResult> {
    const { skillId, serverId, userId, triggerType, chainContext } = params;
    const startTime = Date.now();

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
      const resolvedPrompt = resolvePromptTemplate(manifest.prompt, {
        input: mergedConfig,
        now: new Date().toISOString(),
      });

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

      // Emit skill.completed or skill.failed event for chain triggers
      if (this.triggerManager) {
        const eventType = status === 'success' ? 'skill.completed' : 'skill.failed';
        this.triggerManager.handleEvent(eventType, {
          serverId,
          skillId,
          skillName: skill.name,
          executionId: execution.id,
          chainContext: nextChain,
        }).catch((err) => {
          logger.error(
            { skillId, eventType, error: (err as Error).message },
            'Failed to emit skill completion event',
          );
        });
      }

      return execResult;
    } catch (err) {
      const duration = Date.now() - startTime;
      const errorMessage = (err as Error).message;

      await this.repo.completeExecution(
        execution.id,
        'failed',
        { error: errorMessage },
        0,
        duration,
      );

      logger.error(
        { executionId: execution.id, skillId, error: errorMessage },
        'Skill execution failed',
      );

      // Emit skill.failed event for chain triggers
      if (this.triggerManager) {
        this.triggerManager.handleEvent('skill.failed', {
          serverId,
          skillId,
          skillName: skill.name,
          executionId: execution.id,
          chainContext: nextChain,
        }).catch((emitErr) => {
          logger.error(
            { skillId, error: (emitErr as Error).message },
            'Failed to emit skill.failed event',
          );
        });
      }

      return {
        executionId: execution.id,
        status: 'failed',
        stepsExecuted: 0,
        duration,
        result: null,
        errors: [errorMessage],
      };
    }
  }

  // --------------------------------------------------------------------------
  // Queries
  // --------------------------------------------------------------------------

  /** List all installed skills for a user. */
  async listInstalled(userId: string): Promise<InstalledSkill[]> {
    return this.repo.findAll(userId);
  }

  /**
   * List installed skills enriched with manifest input definitions.
   *
   * Uses persisted `manifestInputs` from DB when available.
   * Falls back to loading skill.yaml from disk if DB value is null
   * (e.g. skills installed before this feature was added).
   */
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

  /**
   * Get a single installed skill enriched with manifest input definitions.
   *
   * Uses persisted `manifestInputs` from DB when available,
   * falls back to loading from disk.
   */
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

  /**
   * List all available skills (official + community + local).
   *
   * Scans the default skill directories and marks each as installed or not.
   */
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

// ============================================================================
// Singleton
// ============================================================================

let _instance: SkillEngine | null = null;

/**
 * Get the global SkillEngine instance.
 *
 * @param projectRoot - Project root path (required on first call)
 * @returns The SkillEngine singleton
 */
export function getSkillEngine(projectRoot?: string): SkillEngine {
  if (!_instance) {
    if (!projectRoot) {
      throw new Error('SkillEngine not initialized — provide projectRoot on first call');
    }
    _instance = new SkillEngine(projectRoot);
  }
  return _instance;
}

/** Set a custom SkillEngine instance (for testing). */
export function setSkillEngine(engine: SkillEngine): void {
  _instance = engine;
}

/** Reset the singleton (for testing). */
export function _resetSkillEngine(): void {
  if (_instance) {
    _instance.stop();
  }
  _instance = null;
}
