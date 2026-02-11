// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { z } from 'zod';

export const OperationStatusSchema = z.enum([
  'pending',
  'running',
  'success',
  'failed',
  'rolled_back',
]);
export type OperationStatus = z.infer<typeof OperationStatusSchema>;

export const OperationTypeSchema = z.enum([
  'install',
  'config',
  'restart',
  'execute',
  'backup',
]);
export type OperationType = z.infer<typeof OperationTypeSchema>;

export const RiskLevelSchema = z.enum(['green', 'yellow', 'red', 'critical']);
export type RiskLevel = z.infer<typeof RiskLevelSchema>;

export const OperationSchema = z.object({
  id: z.string(),
  serverId: z.string(),
  serverName: z.string().optional(),
  sessionId: z.string().nullable().optional(),
  type: OperationTypeSchema,
  description: z.string(),
  commands: z.array(z.string()).optional(),
  output: z.string().nullable().optional(),
  status: OperationStatusSchema,
  riskLevel: RiskLevelSchema,
  snapshotId: z.string().nullable().optional(),
  duration: z.number().nullable().optional(),
  createdAt: z.string(),
  completedAt: z.string().nullable().optional(),
});
export type Operation = z.infer<typeof OperationSchema>;

export const OperationsResponseSchema = z.object({
  operations: z.array(OperationSchema),
  total: z.number(),
});
export type OperationsResponse = z.infer<typeof OperationsResponseSchema>;

export const OperationStatsSchema = z.object({
  total: z.number(),
  byStatus: z.record(OperationStatusSchema, z.number()),
  byType: z.record(OperationTypeSchema, z.number()),
  byRiskLevel: z.record(RiskLevelSchema, z.number()),
  avgDuration: z.number().nullable(),
  successRate: z.number(),
});
export type OperationStats = z.infer<typeof OperationStatsSchema>;

export const AlertSeveritySchema = z.enum(['info', 'warning', 'critical']);
export type AlertSeverity = z.infer<typeof AlertSeveritySchema>;

export const AlertTypeSchema = z.enum([
  'cpu',
  'memory',
  'disk',
  'service',
  'offline',
]);
export type AlertType = z.infer<typeof AlertTypeSchema>;

export const AlertSchema = z.object({
  id: z.string(),
  serverId: z.string(),
  serverName: z.string().optional(),
  type: AlertTypeSchema,
  severity: AlertSeveritySchema,
  message: z.string(),
  value: z.string().optional(),
  threshold: z.string().optional(),
  resolved: z.boolean(),
  resolvedAt: z.string().optional(),
  createdAt: z.string(),
});
export type Alert = z.infer<typeof AlertSchema>;

export const AlertsResponseSchema = z.object({
  alerts: z.array(AlertSchema),
  total: z.number(),
});
export type AlertsResponse = z.infer<typeof AlertsResponseSchema>;

// ── Task Types ──

export const TaskStatusSchema = z.enum(['active', 'paused', 'deleted']);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const TaskLastStatusSchema = z.enum(['success', 'failed']);
export type TaskLastStatus = z.infer<typeof TaskLastStatusSchema>;

export const TaskSchema = z.object({
  id: z.string(),
  serverId: z.string(),
  serverName: z.string().optional(),
  userId: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  cron: z.string(),
  command: z.string(),
  status: TaskStatusSchema,
  lastRun: z.string().nullable().optional(),
  lastStatus: TaskLastStatusSchema.nullable().optional(),
  nextRun: z.string().nullable().optional(),
  createdAt: z.string(),
});
export type Task = z.infer<typeof TaskSchema>;

export const TasksResponseSchema = z.object({
  tasks: z.array(TaskSchema),
  total: z.number(),
});
export type TasksResponse = z.infer<typeof TasksResponseSchema>;

export interface CreateTaskInput {
  name: string;
  serverId: string;
  cron: string;
  command: string;
  description?: string;
}

export interface UpdateTaskInput {
  name?: string;
  cron?: string;
  command?: string;
  description?: string;
  status?: TaskStatus;
}

// ── Alert Rule Types ──

export const MetricTypeSchema = z.enum(['cpu', 'memory', 'disk']);
export type MetricType = z.infer<typeof MetricTypeSchema>;

export const ComparisonOperatorSchema = z.enum(['gt', 'lt', 'gte', 'lte']);
export type ComparisonOperator = z.infer<typeof ComparisonOperatorSchema>;

export const AlertRuleSchema = z.object({
  id: z.string(),
  serverId: z.string(),
  userId: z.string(),
  name: z.string(),
  metricType: MetricTypeSchema,
  operator: ComparisonOperatorSchema,
  threshold: z.number(),
  severity: AlertSeveritySchema,
  enabled: z.boolean(),
  emailRecipients: z.array(z.string()).nullable().optional(),
  cooldownMinutes: z.number().nullable().optional(),
  lastTriggeredAt: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type AlertRule = z.infer<typeof AlertRuleSchema>;

export const AlertRulesResponseSchema = z.object({
  rules: z.array(AlertRuleSchema),
  total: z.number(),
});
export type AlertRulesResponse = z.infer<typeof AlertRulesResponseSchema>;

export interface CreateAlertRuleInput {
  serverId: string;
  name: string;
  metricType: MetricType;
  operator: ComparisonOperator;
  threshold: number;
  severity: AlertSeverity;
  emailRecipients?: string[];
  cooldownMinutes?: number;
}

export interface UpdateAlertRuleInput {
  name?: string;
  metricType?: MetricType;
  operator?: ComparisonOperator;
  threshold?: number;
  severity?: AlertSeverity;
  enabled?: boolean;
  emailRecipients?: string[];
  cooldownMinutes?: number;
}
