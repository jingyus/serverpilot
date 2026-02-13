// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for trigger-evaluators — pure functions for threshold evaluation.
 */

import { describe, it, expect } from 'vitest';

import {
  extractMetricValue,
  compareValue,
  checkThresholdTrigger,
  type ThresholdRegistration,
} from './trigger-evaluators.js';

import type { MetricEvent } from '../metrics/metrics-bus.js';

// ============================================================================
// Helpers
// ============================================================================

function createMetricEvent(overrides: Partial<MetricEvent> = {}): MetricEvent {
  return {
    id: 'metric-1',
    serverId: 'server-1',
    cpuUsage: 50,
    memoryUsage: 4_000_000_000,
    memoryTotal: 8_000_000_000,
    diskUsage: 100_000_000_000,
    diskTotal: 500_000_000_000,
    networkIn: 1000,
    networkOut: 2000,
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

function createThresholdReg(overrides: Partial<ThresholdRegistration> = {}): ThresholdRegistration {
  return {
    skillId: 'skill-1',
    userId: 'user-1',
    metric: 'cpu.usage',
    operator: 'gt',
    value: 90,
    ...overrides,
  };
}

// ============================================================================
// extractMetricValue
// ============================================================================

describe('extractMetricValue', () => {
  it('should extract cpu.usage directly', () => {
    const event = createMetricEvent({ cpuUsage: 75 });
    expect(extractMetricValue('cpu.usage', event)).toBe(75);
  });

  it('should compute memory.usage_percent as percentage', () => {
    const event = createMetricEvent({
      memoryUsage: 6_000_000_000,
      memoryTotal: 8_000_000_000,
    });
    expect(extractMetricValue('memory.usage_percent', event)).toBe(75);
  });

  it('should return null for memory.usage_percent when memoryTotal is 0', () => {
    const event = createMetricEvent({ memoryUsage: 100, memoryTotal: 0 });
    expect(extractMetricValue('memory.usage_percent', event)).toBeNull();
  });

  it('should compute disk.usage_percent as percentage', () => {
    const event = createMetricEvent({
      diskUsage: 250_000_000_000,
      diskTotal: 500_000_000_000,
    });
    expect(extractMetricValue('disk.usage_percent', event)).toBe(50);
  });

  it('should return null for disk.usage_percent when diskTotal is 0', () => {
    const event = createMetricEvent({ diskUsage: 100, diskTotal: 0 });
    expect(extractMetricValue('disk.usage_percent', event)).toBeNull();
  });

  it('should extract network.rx_bytes', () => {
    const event = createMetricEvent({ networkIn: 12345 });
    expect(extractMetricValue('network.rx_bytes', event)).toBe(12345);
  });

  it('should extract network.tx_bytes', () => {
    const event = createMetricEvent({ networkOut: 67890 });
    expect(extractMetricValue('network.tx_bytes', event)).toBe(67890);
  });

  it('should return null for unknown metric name', () => {
    const event = createMetricEvent();
    expect(extractMetricValue('unknown.metric', event)).toBeNull();
  });
});

// ============================================================================
// compareValue
// ============================================================================

describe('compareValue', () => {
  it('should handle gt operator', () => {
    expect(compareValue(95, 'gt', 90)).toBe(true);
    expect(compareValue(90, 'gt', 90)).toBe(false);
    expect(compareValue(85, 'gt', 90)).toBe(false);
  });

  it('should handle gte operator', () => {
    expect(compareValue(90, 'gte', 90)).toBe(true);
    expect(compareValue(91, 'gte', 90)).toBe(true);
    expect(compareValue(89, 'gte', 90)).toBe(false);
  });

  it('should handle lt operator', () => {
    expect(compareValue(5, 'lt', 10)).toBe(true);
    expect(compareValue(10, 'lt', 10)).toBe(false);
    expect(compareValue(15, 'lt', 10)).toBe(false);
  });

  it('should handle lte operator', () => {
    expect(compareValue(10, 'lte', 10)).toBe(true);
    expect(compareValue(9, 'lte', 10)).toBe(true);
    expect(compareValue(11, 'lte', 10)).toBe(false);
  });

  it('should handle eq operator', () => {
    expect(compareValue(50, 'eq', 50)).toBe(true);
    expect(compareValue(51, 'eq', 50)).toBe(false);
  });

  it('should handle neq operator', () => {
    expect(compareValue(51, 'neq', 50)).toBe(true);
    expect(compareValue(50, 'neq', 50)).toBe(false);
  });

  it('should return false for unknown operator', () => {
    expect(compareValue(50, 'invalid', 50)).toBe(false);
    expect(compareValue(50, '', 50)).toBe(false);
  });
});

// ============================================================================
// checkThresholdTrigger
// ============================================================================

describe('checkThresholdTrigger', () => {
  it('should return true when threshold condition is met', () => {
    const reg = createThresholdReg({ metric: 'cpu.usage', operator: 'gt', value: 90 });
    const event = createMetricEvent({ cpuUsage: 95 });
    expect(checkThresholdTrigger(reg, event)).toBe(true);
  });

  it('should return false when threshold condition is not met', () => {
    const reg = createThresholdReg({ metric: 'cpu.usage', operator: 'gt', value: 90 });
    const event = createMetricEvent({ cpuUsage: 50 });
    expect(checkThresholdTrigger(reg, event)).toBe(false);
  });

  it('should return false when metric name is unknown', () => {
    const reg = createThresholdReg({ metric: 'unknown.metric', operator: 'gt', value: 10 });
    const event = createMetricEvent();
    expect(checkThresholdTrigger(reg, event)).toBe(false);
  });

  it('should work with computed percentage metrics', () => {
    const reg = createThresholdReg({
      metric: 'memory.usage_percent',
      operator: 'gte',
      value: 80,
    });
    // 7GB / 8GB = 87.5%
    const event = createMetricEvent({
      memoryUsage: 7_000_000_000,
      memoryTotal: 8_000_000_000,
    });
    expect(checkThresholdTrigger(reg, event)).toBe(true);
  });

  it('should return false when percentage metric has zero total', () => {
    const reg = createThresholdReg({
      metric: 'disk.usage_percent',
      operator: 'lt',
      value: 50,
    });
    const event = createMetricEvent({ diskUsage: 100, diskTotal: 0 });
    expect(checkThresholdTrigger(reg, event)).toBe(false);
  });
});
