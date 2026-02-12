// SPDX-License-Identifier: MIT
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Skill specification schema — Zod validation for skill.yaml files.
 *
 * This is the single source of truth for the Skill manifest format.
 * Both the server (SkillEngine) and CLI (skill install) use this schema
 * to validate skill.yaml before loading.
 *
 * @module skill-schema
 */

import { z } from 'zod';

// ============================================================================
// Skill Name Pattern
// ============================================================================

const SKILL_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,48}[a-z0-9]$/;

// ============================================================================
// Trigger Schemas
// ============================================================================

const ManualTriggerSchema = z.object({
  type: z.literal('manual'),
});

const CronTriggerSchema = z.object({
  type: z.literal('cron'),
  schedule: z.string().min(9).max(100), // "* * * * *" minimum
});

const EventTriggerSchema = z.object({
  type: z.literal('event'),
  on: z.enum([
    'alert.triggered',
    'server.offline',
    'server.online',
    'task.completed',
    'task.failed',
    'operation.failed',
    'agent.disconnected',
    'skill.completed',
  ]),
  filter: z.record(z.unknown()).optional(),
});

const ThresholdOperator = z.enum(['gt', 'gte', 'lt', 'lte', 'eq', 'neq']);

const ThresholdTriggerSchema = z.object({
  type: z.literal('threshold'),
  metric: z.enum([
    'cpu.usage',
    'memory.usage_percent',
    'disk.usage_percent',
    'disk.io_wait',
    'network.rx_bytes',
    'network.tx_bytes',
    'load.1min',
    'load.5min',
  ]),
  operator: ThresholdOperator,
  value: z.number(),
});

const TriggerSchema = z.discriminatedUnion('type', [
  ManualTriggerSchema,
  CronTriggerSchema,
  EventTriggerSchema,
  ThresholdTriggerSchema,
]);

// ============================================================================
// Tool Schema
// ============================================================================

const SkillTool = z.enum([
  'shell',
  'read_file',
  'write_file',
  'notify',
  'http',
  'store',
]);

// ============================================================================
// Input Schema
// ============================================================================

const InputType = z.enum(['string', 'number', 'boolean', 'string[]', 'enum']);

const SkillInputSchema = z.object({
  name: z.string().min(1).max(50).regex(/^[a-z_][a-z0-9_]*$/),
  type: InputType,
  required: z.boolean().default(false),
  default: z.unknown().optional(),
  description: z.string().max(500),
  options: z.array(z.string()).optional(), // for type=enum
}).refine(
  (input) => input.type !== 'enum' || (input.options && input.options.length >= 2),
  { message: 'enum type requires options with at least 2 values' }
);

// ============================================================================
// Constraints Schema
// ============================================================================

const SkillRiskLevel = z.enum(['green', 'yellow', 'red', 'critical']);

const TimeoutPattern = /^\d+[smh]$/;

const SkillConstraintsSchema = z.object({
  risk_level_max: SkillRiskLevel.default('yellow'),
  timeout: z.string().regex(TimeoutPattern, 'Format: "30s" | "5m" | "1h"').default('5m'),
  max_steps: z.number().int().min(1).max(100).default(20),
  requires_confirmation: z.boolean().default(false),
  server_scope: z.enum(['single', 'all', 'tagged']).default('single'),
  run_as: z.string().max(50).optional(),
}).default({});

// ============================================================================
// Requires Schema
// ============================================================================

const SkillRequiresSchema = z.object({
  agent: z.string().max(20).optional(),  // semver range like ">=1.0.0"
  os: z.array(z.enum(['linux', 'darwin', 'windows'])).optional(),
  commands: z.array(z.string().max(50)).optional(),
}).optional();

// ============================================================================
// Output Schema
// ============================================================================

const SkillOutputSchema = z.object({
  name: z.string().min(1).max(50).regex(/^[a-z_][a-z0-9_]*$/),
  type: z.enum(['string', 'number', 'boolean', 'object']),
  description: z.string().max(500),
});

// ============================================================================
// Metadata Schema
// ============================================================================

const SkillMetadataSchema = z.object({
  name: z.string().min(2).max(50).regex(SKILL_NAME_PATTERN, {
    message: 'Must be lowercase letters, numbers, and hyphens (2-50 chars)',
  }),
  displayName: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, 'Must be SemVer: "1.0.0"'),
  author: z.string().max(100).optional(),
  tags: z.array(z.string().max(30)).max(10).optional(),
  icon: z.string().max(200).optional(),
});

// ============================================================================
// Complete Skill Schema
// ============================================================================

export const SkillManifestSchema = z.object({
  kind: z.literal('skill'),
  version: z.literal('1.0'),

  metadata: SkillMetadataSchema,
  triggers: z.array(TriggerSchema).min(1, 'At least one trigger is required'),
  tools: z.array(SkillTool).min(1, 'At least one tool is required'),

  inputs: z.array(SkillInputSchema).optional(),
  constraints: SkillConstraintsSchema,
  requires: SkillRequiresSchema,
  prompt: z.string().min(50).max(50000),
  outputs: z.array(SkillOutputSchema).optional(),
});

export type SkillManifest = z.infer<typeof SkillManifestSchema>;

// ============================================================================
// Sub-type Exports
// ============================================================================

export type SkillTrigger = z.infer<typeof TriggerSchema>;
export type SkillInput = z.infer<typeof SkillInputSchema>;
export type SkillConstraints = z.infer<typeof SkillConstraintsSchema>;
export type SkillOutput = z.infer<typeof SkillOutputSchema>;
export type SkillMetadata = z.infer<typeof SkillMetadataSchema>;
export type SkillToolType = z.infer<typeof SkillTool>;

// Re-export sub-schemas for external use
export {
  TriggerSchema,
  SkillInputSchema,
  SkillConstraintsSchema,
  SkillOutputSchema,
  SkillMetadataSchema,
  SkillTool as SkillToolSchema,
  SkillRiskLevel as SkillRiskLevelSchema,
};

// ============================================================================
// Validation Helper
// ============================================================================

export function validateSkillManifest(data: unknown): {
  success: boolean;
  data?: SkillManifest;
  errors?: string[];
} {
  const result = SkillManifestSchema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return {
    success: false,
    errors: result.error.issues.map(
      (issue) => `${issue.path.join('.')}: ${issue.message}`
    ),
  };
}
