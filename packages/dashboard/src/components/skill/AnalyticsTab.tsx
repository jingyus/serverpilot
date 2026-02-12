// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { useTranslation } from 'react-i18next';
import { BarChart3, Loader2 } from 'lucide-react';
import type { SkillStats, SkillTriggerType } from '@/types/skill';

const TRIGGER_LABELS: Record<SkillTriggerType, string> = {
  manual: 'Manual',
  cron: 'Cron',
  event: 'Event',
  threshold: 'Threshold',
};

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

export function AnalyticsTab({
  stats,
  isLoading,
}: {
  stats: SkillStats | null;
  isLoading: boolean;
}) {
  const { t } = useTranslation();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!stats || stats.totalExecutions === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <BarChart3 className="h-12 w-12 text-muted-foreground/50" />
        <h3 className="mt-4 text-lg font-medium text-foreground">{t('skills.noStats')}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{t('skills.noStatsDesc')}</p>
      </div>
    );
  }

  const successPct = Math.round(stats.successRate * 100);

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <SummaryCard label={t('skills.totalExecutions')} value={String(stats.totalExecutions)} />
        <SummaryCard label={t('skills.successRate')} value={`${successPct}%`} accent={successPct >= 80 ? 'green' : successPct >= 50 ? 'yellow' : 'red'} />
        <SummaryCard label={t('skills.avgDuration')} value={formatDuration(stats.avgDuration)} />
      </div>

      {/* Top Skills */}
      {stats.topSkills.length > 0 && (
        <div className="rounded-lg border border-border p-4">
          <h3 className="mb-3 text-sm font-semibold text-foreground">{t('skills.topSkills')}</h3>
          <div className="space-y-2">
            {stats.topSkills.map((skill) => {
              const pct = stats.totalExecutions > 0 ? (skill.executionCount / stats.totalExecutions) * 100 : 0;
              return (
                <div key={skill.skillId} className="flex items-center gap-3">
                  <span className="w-32 truncate text-sm text-foreground" title={skill.skillName}>
                    {skill.skillName}
                  </span>
                  <div className="relative flex-1 h-5 rounded bg-muted overflow-hidden">
                    <div
                      className="absolute inset-y-0 left-0 rounded bg-primary/70 transition-all"
                      style={{ width: `${Math.max(pct, 2)}%` }}
                    />
                    <span className="relative z-10 flex items-center h-full px-2 text-xs font-medium text-foreground">
                      {skill.executionCount} {t('skills.executions')}
                    </span>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {t('skills.successCount', { count: skill.successCount })}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Daily Trend */}
      {stats.dailyTrend.length > 0 && (
        <div className="rounded-lg border border-border p-4">
          <h3 className="mb-3 text-sm font-semibold text-foreground">{t('skills.dailyTrend')}</h3>
          <DailyTrendChart data={stats.dailyTrend} />
        </div>
      )}

      {/* Trigger Distribution */}
      {stats.triggerDistribution.length > 0 && (
        <div className="rounded-lg border border-border p-4">
          <h3 className="mb-3 text-sm font-semibold text-foreground">{t('skills.triggerDistribution')}</h3>
          <div className="flex flex-wrap gap-4">
            {stats.triggerDistribution.map(({ triggerType, count }) => (
              <div key={triggerType} className="flex items-center gap-2 rounded-md bg-muted px-3 py-2">
                <span className="text-sm font-medium text-foreground">{TRIGGER_LABELS[triggerType]}</span>
                <span className="rounded-full bg-primary/20 px-2 py-0.5 text-xs font-semibold text-primary">
                  {count}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Summary Card
// ============================================================================

function SummaryCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: 'green' | 'yellow' | 'red';
}) {
  const accentClass = accent === 'green'
    ? 'text-green-600 dark:text-green-400'
    : accent === 'yellow'
      ? 'text-yellow-600 dark:text-yellow-400'
      : accent === 'red'
        ? 'text-red-600 dark:text-red-400'
        : 'text-foreground';

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${accentClass}`}>{value}</p>
    </div>
  );
}

// ============================================================================
// Daily Trend Chart (pure CSS bar chart)
// ============================================================================

function DailyTrendChart({ data }: { data: SkillStats['dailyTrend'] }) {
  const maxTotal = Math.max(...data.map((d) => d.total), 1);

  return (
    <div className="flex items-end gap-px overflow-x-auto" style={{ minHeight: 100 }}>
      {data.map((day) => {
        const successH = (day.success / maxTotal) * 80;
        const failedH = (day.failed / maxTotal) * 80;
        const otherH = ((day.total - day.success - day.failed) / maxTotal) * 80;
        return (
          <div
            key={day.date}
            className="group relative flex flex-col items-center"
            style={{ minWidth: data.length > 15 ? 12 : 24 }}
          >
            <div className="flex flex-col-reverse w-full">
              {day.success > 0 && (
                <div className="bg-green-500/70 rounded-t-sm" style={{ height: successH }} />
              )}
              {day.failed > 0 && (
                <div className="bg-red-500/70" style={{ height: failedH }} />
              )}
              {day.total - day.success - day.failed > 0 && (
                <div className="bg-muted-foreground/30" style={{ height: otherH }} />
              )}
            </div>
            {/* Tooltip */}
            <div className="absolute bottom-full mb-1 hidden group-hover:block z-10 rounded bg-popover px-2 py-1 text-xs text-popover-foreground shadow whitespace-nowrap">
              {day.date}: {day.total} total, {day.success} ok, {day.failed} fail
            </div>
          </div>
        );
      })}
    </div>
  );
}
