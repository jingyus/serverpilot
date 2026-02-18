// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * ServerPilot Cloud — Analytics Module
 *
 * 提供 CostTracker 等与使用量/成本分析相关的能力，供 Usage 仪表盘与报表使用。
 *
 * @module cloud/analytics
 */

// CostTracker 单例与类型（真实实现）
export {
  getCostTracker,
  setCostTracker,
  _resetCostTracker,
} from '../ai/cost-tracker.js';
export type {
  CostTracker,
  DailyCostEntry,
  ModelDistributionEntry,
  TokenUsage,
} from '../ai/cost-tracker.js';

// 占位类型（后续高级报表可扩展）
export interface AnalyticsReport {
  id: string;
  tenantId: string;
  type: 'capacity' | 'cost' | 'performance' | 'usage';
  period: { from: Date; to: Date };
  data: Record<string, unknown>;
  generatedAt: Date;
}

export interface ForecastResult {
  metric: string;
  currentValue: number;
  predictedValue: number;
  confidence: number;
  timeHorizon: string;
  recommendation: string;
}
