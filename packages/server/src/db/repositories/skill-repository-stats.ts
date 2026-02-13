// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Shared stats computation for skill repositories.
 *
 * Extracted from skill-repository.ts to keep file sizes under the 500-line limit.
 * Both DrizzleSkillRepository and InMemorySkillRepository use this shared logic.
 *
 * @module db/repositories/skill-repository-stats
 */

import type { SkillStats } from '../../core/skill/types.js';
import type { SkillTriggerType } from '../schema.js';

// ============================================================================
// Input Type
// ============================================================================

export interface StatsRow {
  skillId: string;
  status: string;
  triggerType: string;
  startedAt: Date | null;
  duration: number | null;
}

// ============================================================================
// Stats Computation
// ============================================================================

export function computeStats(
  rows: StatsRow[],
  skillNameMap: Map<string, string>,
): SkillStats {
  const totalExecutions = rows.length;
  const successCount = rows.filter((r) => r.status === 'success').length;
  const successRate = totalExecutions > 0 ? successCount / totalExecutions : 0;

  const durations = rows.filter((r) => r.duration != null).map((r) => r.duration!);
  const avgDuration = durations.length > 0
    ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
    : 0;

  // Top skills by execution count (top 5)
  const skillCounts = new Map<string, { count: number; success: number }>();
  for (const r of rows) {
    const entry = skillCounts.get(r.skillId) ?? { count: 0, success: 0 };
    entry.count++;
    if (r.status === 'success') entry.success++;
    skillCounts.set(r.skillId, entry);
  }
  const topSkills = [...skillCounts.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 5)
    .map(([skillId, { count, success }]) => ({
      skillId,
      skillName: skillNameMap.get(skillId) ?? skillId,
      executionCount: count,
      successCount: success,
    }));

  // Daily trend
  const dailyMap = new Map<string, { total: number; success: number; failed: number }>();
  for (const r of rows) {
    const date = r.startedAt ? r.startedAt.toISOString().slice(0, 10) : 'unknown';
    const entry = dailyMap.get(date) ?? { total: 0, success: 0, failed: 0 };
    entry.total++;
    if (r.status === 'success') entry.success++;
    if (r.status === 'failed' || r.status === 'timeout') entry.failed++;
    dailyMap.set(date, entry);
  }
  const dailyTrend = [...dailyMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, { total, success, failed }]) => ({ date, total, success, failed }));

  // Trigger distribution
  const triggerMap = new Map<string, number>();
  for (const r of rows) {
    triggerMap.set(r.triggerType, (triggerMap.get(r.triggerType) ?? 0) + 1);
  }
  const triggerDistribution = [...triggerMap.entries()].map(([triggerType, count]) => ({
    triggerType: triggerType as SkillTriggerType,
    count,
  }));

  return {
    totalExecutions,
    successRate,
    avgDuration,
    topSkills,
    dailyTrend,
    triggerDistribution,
  };
}
