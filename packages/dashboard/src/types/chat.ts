// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { z } from 'zod';

export const RiskLevel = {
  GREEN: 'green',
  YELLOW: 'yellow',
  RED: 'red',
  CRITICAL: 'critical',
} as const;

export type RiskLevel = (typeof RiskLevel)[keyof typeof RiskLevel];

export const RiskLevelSchema = z.enum(['green', 'yellow', 'red', 'critical']);

export const PlanStepSchema = z.object({
  id: z.string(),
  description: z.string(),
  command: z.string(),
  riskLevel: RiskLevelSchema,
  rollbackCommand: z.string().optional(),
  timeout: z.number().default(30000),
  canRollback: z.boolean().default(false),
});

export type PlanStep = z.infer<typeof PlanStepSchema>;

export const ExecutionPlanSchema = z.object({
  planId: z.string(),
  description: z.string(),
  steps: z.array(PlanStepSchema),
  totalRisk: RiskLevelSchema,
  requiresConfirmation: z.boolean(),
  estimatedTime: z.number().optional(),
});

export type ExecutionPlan = z.infer<typeof ExecutionPlanSchema>;

export const MessageRole = {
  USER: 'user',
  ASSISTANT: 'assistant',
  SYSTEM: 'system',
} as const;

export type MessageRole = (typeof MessageRole)[keyof typeof MessageRole];

export const ChatMessageSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
  timestamp: z.string(),
  plan: ExecutionPlanSchema.optional(),
});

export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const StepOutputSchema = z.object({
  stepId: z.string(),
  content: z.string(),
});

export type StepOutput = z.infer<typeof StepOutputSchema>;

export const StepCompleteSchema = z.object({
  stepId: z.string(),
  exitCode: z.number(),
  duration: z.number(),
});

export type StepComplete = z.infer<typeof StepCompleteSchema>;

export const ExecutionCompleteSchema = z.object({
  success: z.boolean(),
  operationId: z.string().optional(),
  snapshotId: z.string().optional(),
  failedAtStep: z.string().nullable().optional(),
  cancelled: z.boolean().optional(),
});

export type ExecutionComplete = z.infer<typeof ExecutionCompleteSchema>;

export const SessionSummarySchema = z.object({
  id: z.string(),
  serverId: z.string(),
  messageCount: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastMessage: z.string().optional(),
});

export type SessionSummary = z.infer<typeof SessionSummarySchema>;

export const RISK_CONFIG: Record<
  RiskLevel,
  { label: string; color: string; bgColor: string; borderColor: string }
> = {
  green: {
    label: 'Safe',
    color: 'text-green-700',
    bgColor: 'bg-green-50',
    borderColor: 'border-green-200',
  },
  yellow: {
    label: 'Caution',
    color: 'text-yellow-700',
    bgColor: 'bg-yellow-50',
    borderColor: 'border-yellow-200',
  },
  red: {
    label: 'Dangerous',
    color: 'text-red-700',
    bgColor: 'bg-red-50',
    borderColor: 'border-red-200',
  },
  critical: {
    label: 'Critical',
    color: 'text-red-900',
    bgColor: 'bg-red-100',
    borderColor: 'border-red-300',
  },
};

export const MAX_MESSAGE_LENGTH = 4000;
