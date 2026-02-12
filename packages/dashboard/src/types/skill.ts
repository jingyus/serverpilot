// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors

// ============================================================================
// Skill Status & Source Enums
// ============================================================================

export type SkillStatus = 'installed' | 'configured' | 'enabled' | 'paused' | 'error';
export type SkillSource = 'official' | 'community' | 'local';
export type SkillTriggerType = 'manual' | 'cron' | 'event' | 'threshold';
export type SkillExecutionStatus = 'pending_confirmation' | 'running' | 'success' | 'failed' | 'timeout' | 'cancelled';

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

/** Input definition from skill manifest. */
export interface SkillManifestInput {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'string[]' | 'enum';
  required: boolean;
  default?: unknown;
  description: string;
  options?: string[];
}

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
  /** Input definitions from the skill manifest. */
  inputs?: SkillManifestInput[];
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// Skill Execution (mirrors server SkillExecution)
// ============================================================================

/** Record of a single tool call during execution. */
export interface ToolCallRecord {
  toolName: string;
  input: Record<string, unknown>;
  result: string;
  success: boolean;
  duration: number;
}

/** Structured execution result stored in DB. */
export interface ExecutionResultData {
  output?: string;
  toolResults?: ToolCallRecord[];
  errors?: string[];
}

export interface SkillExecution {
  id: string;
  skillId: string;
  serverId: string;
  userId: string;
  triggerType: SkillTriggerType;
  status: SkillExecutionStatus;
  startedAt: string;
  completedAt: string | null;
  result: ExecutionResultData | Record<string, unknown> | null;
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

export interface ExecutionDetailResponse {
  execution: SkillExecution;
}

export interface PendingConfirmationsResponse {
  executions: SkillExecution[];
}

// ============================================================================
// Skill Execution Streaming Events
// ============================================================================

export type SkillExecutionEventType = 'step' | 'log' | 'completed' | 'error' | 'confirmation_required';

export interface SkillStepEvent {
  type: 'step';
  executionId: string;
  timestamp: string;
  tool: string;
  input?: Record<string, unknown>;
  result?: string;
  success?: boolean;
  duration?: number;
  phase: 'start' | 'complete';
}

export interface SkillLogEvent {
  type: 'log';
  executionId: string;
  timestamp: string;
  text: string;
}

export interface SkillCompletedEvent {
  type: 'completed';
  executionId: string;
  timestamp: string;
  status: 'success' | 'failed' | 'timeout';
  stepsExecuted: number;
  duration: number;
  output: string;
}

export interface SkillErrorEvent {
  type: 'error';
  executionId: string;
  timestamp: string;
  message: string;
}

export interface SkillConfirmationEvent {
  type: 'confirmation_required';
  executionId: string;
  timestamp: string;
  skillId: string;
  skillName: string;
  serverId: string;
  triggerType: string;
}

export type SkillExecutionEvent =
  | SkillStepEvent
  | SkillLogEvent
  | SkillCompletedEvent
  | SkillErrorEvent
  | SkillConfirmationEvent;
