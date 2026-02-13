// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Pure functions for threshold evaluation in trigger-based skill execution.
 *
 * Extracted from trigger-manager.ts to keep files under the 500-line limit.
 * These functions are stateless and depend only on their inputs.
 *
 * @module core/skill/trigger-evaluators
 */

import type { MetricEvent } from '../metrics/metrics-bus.js';

export interface ThresholdRegistration {
  skillId: string;
  userId: string;
  metric: string;
  operator: string;
  value: number;
}

/**
 * Extract a numeric value from a MetricEvent for a given metric name.
 * Returns null if the metric name is unknown or the value cannot be computed.
 */
export function extractMetricValue(metricName: string, event: MetricEvent): number | null {
  switch (metricName) {
    case 'cpu.usage': return event.cpuUsage;
    case 'memory.usage_percent':
      return event.memoryTotal > 0 ? (event.memoryUsage / event.memoryTotal) * 100 : null;
    case 'disk.usage_percent':
      return event.diskTotal > 0 ? (event.diskUsage / event.diskTotal) * 100 : null;
    case 'network.rx_bytes': return event.networkIn;
    case 'network.tx_bytes': return event.networkOut;
    default: return null;
  }
}

/**
 * Compare a current value against a threshold using the given operator.
 * Supported operators: gt, gte, lt, lte, eq, neq.
 */
export function compareValue(current: number, operator: string, threshold: number): boolean {
  switch (operator) {
    case 'gt': return current > threshold;
    case 'gte': return current >= threshold;
    case 'lt': return current < threshold;
    case 'lte': return current <= threshold;
    case 'eq': return current === threshold;
    case 'neq': return current !== threshold;
    default: return false;
  }
}

/**
 * Check whether a single threshold registration is triggered by a metric event.
 * Returns true if the metric matches and the threshold condition is met.
 */
export function checkThresholdTrigger(
  reg: ThresholdRegistration,
  metric: MetricEvent,
): boolean {
  const currentValue = extractMetricValue(reg.metric, metric);
  if (currentValue === null) return false;
  return compareValue(currentValue, reg.operator, reg.value);
}
