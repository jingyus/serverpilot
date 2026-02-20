// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors

export type CommandApprovalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "expired";

export type CommandApprovalRiskLevel = "red" | "critical" | "forbidden";

export interface CommandApproval {
  id: string;
  userId: string;
  serverId: string;
  command: string;
  riskLevel: CommandApprovalRiskLevel;
  status: CommandApprovalStatus;
  reason: string | null;
  warnings: string[];
  requestedAt: string;
  expiresAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  executionContext: {
    sessionId?: string;
    taskId?: string;
    stepIndex?: number;
  } | null;
}

export interface ApprovalsResponse {
  approvals: CommandApproval[];
  total: number;
}

export interface ApprovalResponse {
  approval: CommandApproval;
}

export const RISK_LEVEL_LABELS: Record<CommandApprovalRiskLevel, string> = {
  red: "High Risk",
  critical: "Critical",
  forbidden: "Forbidden",
};

export const RISK_LEVEL_COLORS: Record<CommandApprovalRiskLevel, string> = {
  red: "text-orange-600 bg-orange-50 border-orange-200",
  critical: "text-red-600 bg-red-50 border-red-200",
  forbidden: "text-purple-600 bg-purple-50 border-purple-200",
};

export const STATUS_LABELS: Record<CommandApprovalStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  expired: "Expired",
};
