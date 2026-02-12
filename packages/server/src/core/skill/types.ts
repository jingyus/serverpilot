// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Skill engine internal types.
 *
 * Defines execution results, available skill descriptors, run parameters,
 * and the composite InstalledSkill-with-manifest type used throughout
 * the skill subsystem.
 *
 * @module core/skill/types
 */

import type { SkillManifest } from '@aiinstaller/shared';
import type {
  SkillSource,
  SkillStatus,
  SkillTriggerType,
  SkillExecutionStatus,
} from '../../db/schema.js';

// ============================================================================
// Installed Skill (DB row representation)
// ============================================================================

/** Row-level representation of an installed skill (mirrors DB schema). */
export interface InstalledSkill {
  id: string;
  userId: string;
  tenantId: string | null;
  name: string;
  displayName: string | null;
  version: string;
  source: SkillSource;
  skillPath: string;
  status: SkillStatus;
  config: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// Skill Execution
// ============================================================================

/** Persisted execution record (mirrors DB schema). */
export interface SkillExecution {
  id: string;
  skillId: string;
  serverId: string;
  userId: string;
  triggerType: SkillTriggerType;
  status: SkillExecutionStatus;
  startedAt: string;
  completedAt: string | null;
  result: Record<string, unknown> | null;
  stepsExecuted: number;
  duration: number | null;
}

/** Result returned from SkillEngine.execute(). */
export interface SkillExecutionResult {
  executionId: string;
  status: SkillExecutionStatus;
  stepsExecuted: number;
  duration: number;
  result: Record<string, unknown> | null;
  errors: string[];
}

// ============================================================================
// Available Skill (for discovery / marketplace)
// ============================================================================

/** A skill available for installation (from directory scan). */
export interface AvailableSkill {
  manifest: SkillManifest;
  source: SkillSource;
  dirPath: string;
  installed: boolean;
}

// ============================================================================
// Run Parameters
// ============================================================================

/** Parameters for executing a skill. */
export interface SkillRunParams {
  skillId: string;
  serverId: string;
  userId: string;
  triggerType: SkillTriggerType;
  config?: Record<string, unknown>;
  /** Chain context for cycle detection in chained skill triggers. */
  chainContext?: ChainContext;
}

/** Tracks the execution chain for skill.completed event-driven triggers. */
export interface ChainContext {
  /** Current chain depth (starts at 0 for manual triggers). */
  depth: number;
  /** Ordered list of skill IDs in the chain (for cycle detection). */
  trail: string[];
}
