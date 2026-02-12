// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors

// ============================================================================
// Skill Status & Source Enums
// ============================================================================

export type SkillStatus = 'installed' | 'configured' | 'enabled' | 'paused' | 'error';
export type SkillSource = 'official' | 'community' | 'local';
export type SkillTriggerType = 'manual' | 'cron' | 'event' | 'threshold';
export type SkillExecutionStatus = 'running' | 'success' | 'failed' | 'timeout';

export const SKILL_STATUS_LABELS: Record<SkillStatus, string> = {
  installed: 'Installed',
  configured: 'Configured',
  enabled: 'Enabled',
  paused: 'Paused',
  error: 'Error',
};

export const SKILL_SOURCE_LABELS: Record<SkillSource, string> = {
  official: 'Official',
  community: 'Community',
  local: 'Local',
};

// ============================================================================
// Installed Skill (mirrors server InstalledSkill)
// ============================================================================

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
// Skill Execution (mirrors server SkillExecution)
// ============================================================================

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

// ============================================================================
// Skill Execution Result (returned from POST /skills/:id/execute)
// ============================================================================

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

export interface AvailableSkillManifest {
  name: string;
  displayName: string;
  version: string;
  description: string;
  author: string;
  tags: string[];
}

export interface AvailableSkill {
  manifest: AvailableSkillManifest;
  source: SkillSource;
  dirPath: string;
  installed: boolean;
}

// ============================================================================
// API Response Wrappers
// ============================================================================

export interface SkillsResponse {
  skills: InstalledSkill[];
}

export interface SkillResponse {
  skill: InstalledSkill;
}

export interface AvailableSkillsResponse {
  skills: AvailableSkill[];
}

export interface ExecutionResponse {
  execution: SkillExecutionResult;
}

export interface ExecutionsResponse {
  executions: SkillExecution[];
}
