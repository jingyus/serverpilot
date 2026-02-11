// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Shield,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  Terminal,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Filter,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Download,
  X,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { useAuditLogStore, PAGE_SIZE } from '@/stores/audit-log';
import { cn } from '@/lib/utils';
import { formatDate } from '@/utils/format';
import type { AuditLogEntry, AuditRiskLevel, ValidationAction, ExecutionResult } from '@/types/dashboard';

// ── Config Maps ──

const RISK_LEVEL_CONFIG: Record<
  AuditRiskLevel,
  { labelKey: string; className: string }
> = {
  green: { labelKey: 'risk.safe', className: 'bg-green-100 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-300 dark:border-green-800' },
  yellow: { labelKey: 'risk.medium', className: 'bg-yellow-100 text-yellow-700 border-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-300 dark:border-yellow-800' },
  red: { labelKey: 'risk.high', className: 'bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-900/30 dark:text-orange-300 dark:border-orange-800' },
  critical: { labelKey: 'risk.critical', className: 'bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800' },
  forbidden: { labelKey: 'risk.forbidden', className: 'bg-red-200 text-red-900 border-red-300 dark:bg-red-900/40 dark:text-red-200 dark:border-red-700' },
};

const ACTION_CONFIG: Record<
  ValidationAction,
  { labelKey: string; variant: 'default' | 'secondary' | 'destructive'; icon: typeof CheckCircle2 }
> = {
  allowed: { labelKey: 'action.allowed', variant: 'default', icon: CheckCircle2 },
  requires_confirmation: { labelKey: 'action.confirmed', variant: 'secondary', icon: AlertCircle },
  blocked: { labelKey: 'action.blocked', variant: 'destructive', icon: XCircle },
};

const EXECUTION_RESULT_CONFIG: Record<
  ExecutionResult,
  { labelKey: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }
> = {
  success: { labelKey: 'status.success', variant: 'default' },
  failed: { labelKey: 'status.failed', variant: 'destructive' },
  timeout: { labelKey: 'status.timeout', variant: 'destructive' },
  pending: { labelKey: 'status.pending', variant: 'outline' },
  skipped: { labelKey: 'status.skipped', variant: 'secondary' },
};

// ── Export Utilities ──

function exportToJSON(logs: AuditLogEntry[]) {
  const json = JSON.stringify(logs, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'audit-log.json';
  a.click();
  URL.revokeObjectURL(url);
}

// ── Sub-components ──

function RiskBadge({ level }: { level: AuditRiskLevel }) {
  const { t } = useTranslation();
  const config = RISK_LEVEL_CONFIG[level] ?? RISK_LEVEL_CONFIG.green;
  return (
    <span
      className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium', config.className)}
      data-testid={`risk-badge-${level}`}
    >
      {t(config.labelKey)}
    </span>
  );
}

function ActionBadge({ action }: { action: ValidationAction }) {
  const { t } = useTranslation();
  const config = ACTION_CONFIG[action] ?? ACTION_CONFIG.allowed;
  const Icon = config.icon;
  return (
    <Badge variant={config.variant} className="gap-1" data-testid={`action-badge-${action}`}>
      <Icon className="h-3 w-3" />
      {t(config.labelKey)}
    </Badge>
  );
}

function ResultBadge({ result }: { result: ExecutionResult | null }) {
  const { t } = useTranslation();
  if (!result) return <span className="text-xs text-muted-foreground">-</span>;
  const config = EXECUTION_RESULT_CONFIG[result] ?? EXECUTION_RESULT_CONFIG.pending;
  return (
    <Badge variant={config.variant} className="text-xs" data-testid={`result-badge-${result}`}>
      {t(config.labelKey)}
    </Badge>
  );
}

function StatsCards() {
  const { t } = useTranslation();
  const { logs, total } = useAuditLogStore();

  const blocked = logs.filter((l) => l.action === 'blocked').length;
  const allowed = logs.filter((l) => l.action === 'allowed').length;
  const highRisk = logs.filter((l) =>
    l.riskLevel === 'red' || l.riskLevel === 'critical' || l.riskLevel === 'forbidden',
  ).length;

  return (
    <div className="grid grid-cols-2 gap-2 sm:gap-4 lg:grid-cols-4" data-testid="stats-cards">
      <Card>
        <CardContent className="p-3 sm:p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Shield className="h-5 w-5" />
            </div>
            <div>
              <div className="text-xl font-bold sm:text-2xl">{total}</div>
              <p className="text-xs text-muted-foreground">{t('auditLog.totalRecords')}</p>
            </div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-3 sm:p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-100 text-green-600 dark:bg-green-900/50 dark:text-green-400">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <div className="text-xl font-bold text-green-600 sm:text-2xl">{allowed}</div>
              <p className="text-xs text-muted-foreground">{t('auditLog.allowed')}</p>
            </div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-3 sm:p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-100 text-red-600 dark:bg-red-900/50 dark:text-red-400">
              <ShieldX className="h-5 w-5" />
            </div>
            <div>
              <div className="text-xl font-bold text-red-600 sm:text-2xl">{blocked}</div>
              <p className="text-xs text-muted-foreground">{t('auditLog.blocked')}</p>
            </div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-3 sm:p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-orange-100 text-orange-600 dark:bg-orange-900/50 dark:text-orange-400">
              <ShieldAlert className="h-5 w-5" />
            </div>
            <div>
              <div className="text-xl font-bold text-orange-600 sm:text-2xl">{highRisk}</div>
              <p className="text-xs text-muted-foreground">{t('auditLog.highRisk')}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function FilterBar() {
  const { t } = useTranslation();
  const { filters, setFilters, resetFilters } = useAuditLogStore();
  const hasActiveFilters = Object.values(filters).some((v) => v !== '');

  return (
    <Card data-testid="filter-bar">
      <CardContent className="p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Filter className="h-4 w-4 text-muted-foreground" />

          <select
            value={filters.riskLevel}
            onChange={(e) => setFilters({ riskLevel: e.target.value })}
            className="h-8 rounded-md border border-input bg-background px-2 text-xs"
            aria-label="Filter by risk level"
            data-testid="filter-risk"
          >
            <option value="">{t('auditLog.allRisk')}</option>
            {(['green', 'yellow', 'red', 'critical', 'forbidden'] as const).map((r) => (
              <option key={r} value={r}>{t(RISK_LEVEL_CONFIG[r].labelKey)}</option>
            ))}
          </select>

          <select
            value={filters.action}
            onChange={(e) => setFilters({ action: e.target.value })}
            className="h-8 rounded-md border border-input bg-background px-2 text-xs"
            aria-label="Filter by action"
            data-testid="filter-action"
          >
            <option value="">{t('auditLog.allActions')}</option>
            {(['allowed', 'blocked', 'requires_confirmation'] as const).map((a) => (
              <option key={a} value={a}>{t(ACTION_CONFIG[a].labelKey)}</option>
            ))}
          </select>

          <Input
            type="date"
            value={filters.startDate}
            onChange={(e) => setFilters({ startDate: e.target.value })}
            className="h-8 w-auto text-xs"
            aria-label="Start date"
            data-testid="filter-start-date"
          />
          <Input
            type="date"
            value={filters.endDate}
            onChange={(e) => setFilters({ endDate: e.target.value })}
            className="h-8 w-auto text-xs"
            aria-label="End date"
            data-testid="filter-end-date"
          />

          {hasActiveFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={resetFilters}
              className="h-8 gap-1 text-xs"
              data-testid="reset-filters"
            >
              <X className="h-3 w-3" />
              {t('common.reset')}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function AuditLogCard({
  log,
  onSelect,
}: {
  log: AuditLogEntry;
  onSelect: (log: AuditLogEntry) => void;
}) {
  return (
    <Card
      className="cursor-pointer transition-colors hover:bg-muted/50"
      onClick={() => onSelect(log)}
      data-testid={`audit-card-${log.id}`}
    >
      <CardContent className="p-3">
        <div className="space-y-1.5">
          <code className="line-clamp-2 block rounded bg-muted px-1.5 py-0.5 text-xs">
            {log.command}
          </code>
          <div className="flex flex-wrap items-center gap-2">
            <RiskBadge level={log.riskLevel} />
            <ActionBadge action={log.action} />
            <ResultBadge result={log.executionResult} />
          </div>
          <p className="text-xs text-muted-foreground">{formatDate(log.createdAt)}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function AuditLogRow({
  log,
  onSelect,
}: {
  log: AuditLogEntry;
  onSelect: (log: AuditLogEntry) => void;
}) {
  return (
    <tr
      className="cursor-pointer border-b border-border/50 transition-colors hover:bg-muted/50"
      onClick={() => onSelect(log)}
      data-testid={`audit-row-${log.id}`}
    >
      <td className="px-3 py-3 text-xs text-muted-foreground whitespace-nowrap sm:px-4">
        {formatDate(log.createdAt)}
      </td>
      <td className="px-3 py-3 sm:px-4">
        <code className="line-clamp-1 max-w-[240px] rounded bg-muted px-1.5 py-0.5 text-xs">
          {log.command}
        </code>
      </td>
      <td className="px-3 py-3 sm:px-4">
        <RiskBadge level={log.riskLevel} />
      </td>
      <td className="hidden px-3 py-3 sm:table-cell sm:px-4">
        <ActionBadge action={log.action} />
      </td>
      <td className="hidden px-3 py-3 md:table-cell md:px-4">
        <ResultBadge result={log.executionResult} />
      </td>
      <td className="hidden px-3 py-3 text-sm lg:table-cell lg:px-4">
        <span className="line-clamp-1 max-w-[200px] text-xs text-muted-foreground">
          {log.reason}
        </span>
      </td>
    </tr>
  );
}

function AuditLogTable() {
  const { t } = useTranslation();
  const { logs, isLoading, error, setSelectedLog } = useAuditLogStore();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12" data-testid="table-loading">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div
        role="alert"
        className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive"
        data-testid="table-error"
      >
        <AlertCircle className="h-4 w-4 shrink-0" />
        <span>{error}</span>
      </div>
    );
  }

  if (logs.length === 0) {
    return (
      <div className="py-12 text-center" data-testid="table-empty">
        <Shield className="mx-auto h-8 w-8 text-muted-foreground/50" />
        <p className="mt-2 text-sm text-muted-foreground">{t('auditLog.noLogs')}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {t('auditLog.noLogsDesc')}
        </p>
      </div>
    );
  }

  return (
    <>
      {/* Mobile card view */}
      <div className="space-y-2 p-2 sm:hidden" data-testid="audit-table">
        {logs.map((log) => (
          <AuditLogCard key={log.id} log={log} onSelect={setSelectedLog} />
        ))}
      </div>

      {/* Desktop table view */}
      <div className="hidden sm:block" data-testid="audit-table-desktop">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-border text-xs font-medium uppercase text-muted-foreground">
              <th className="px-3 py-2 sm:px-4">{t('auditLog.tableHeaders.time')}</th>
              <th className="px-3 py-2 sm:px-4">{t('auditLog.tableHeaders.command')}</th>
              <th className="px-3 py-2 sm:px-4">{t('auditLog.tableHeaders.risk')}</th>
              <th className="hidden px-3 py-2 sm:table-cell sm:px-4">{t('auditLog.tableHeaders.action')}</th>
              <th className="hidden px-3 py-2 md:table-cell md:px-4">{t('auditLog.tableHeaders.result')}</th>
              <th className="hidden px-3 py-2 lg:table-cell lg:px-4">{t('auditLog.tableHeaders.reason')}</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <AuditLogRow key={log.id} log={log} onSelect={setSelectedLog} />
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Pagination() {
  const { t } = useTranslation();
  const { page, total, setPage } = useAuditLogStore();
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const goTo = useCallback(
    (p: number) => { setPage(p); },
    [setPage],
  );

  if (total <= PAGE_SIZE) return null;

  return (
    <div
      className="flex items-center justify-between border-t border-border px-2 pt-3"
      data-testid="pagination"
    >
      <span className="text-xs text-muted-foreground">
        {t('common.showingRange', { start: (page - 1) * PAGE_SIZE + 1, end: Math.min(page * PAGE_SIZE, total), total })}
      </span>
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="icon"
          className="h-7 w-7"
          disabled={page <= 1}
          onClick={() => goTo(page - 1)}
          aria-label="Previous page"
          data-testid="page-prev"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="px-2 text-xs text-muted-foreground">
          {page} / {totalPages}
        </span>
        <Button
          variant="outline"
          size="icon"
          className="h-7 w-7"
          disabled={page >= totalPages}
          onClick={() => goTo(page + 1)}
          aria-label="Next page"
          data-testid="page-next"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function AuditDetailDialog() {
  const { t } = useTranslation();
  const { selectedLog, setSelectedLog } = useAuditLogStore();
  const log = selectedLog;

  return (
    <Dialog
      open={log != null}
      onOpenChange={(open) => { if (!open) setSelectedLog(null); }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl" data-testid="audit-detail">
        {log && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Terminal className="h-5 w-5" />
                {t('auditLog.auditDetail')}
              </DialogTitle>
              <DialogDescription>{t('auditLog.auditDetailDesc')}</DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              {/* Meta */}
              <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                <div>
                  <span className="text-xs text-muted-foreground">{t('auditLog.riskLevel')}</span>
                  <div className="mt-0.5">
                    <RiskBadge level={log.riskLevel} />
                  </div>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">{t('auditLog.action')}</span>
                  <div className="mt-0.5">
                    <ActionBadge action={log.action} />
                  </div>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">{t('auditLog.result')}</span>
                  <div className="mt-0.5">
                    <ResultBadge result={log.executionResult} />
                  </div>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">{t('auditLog.time')}</span>
                  <p className="font-medium">{formatDate(log.createdAt)}</p>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">{t('auditLog.serverId')}</span>
                  <p className="font-mono text-xs">{log.serverId}</p>
                </div>
                {log.matchedPattern && (
                  <div>
                    <span className="text-xs text-muted-foreground">{t('auditLog.matchedPattern')}</span>
                    <p className="font-mono text-xs">{log.matchedPattern}</p>
                  </div>
                )}
              </div>

              {/* Command */}
              <div>
                <h4 className="mb-1 text-xs font-medium text-muted-foreground">{t('auditLog.command')}</h4>
                <pre
                  className="overflow-x-auto rounded-md bg-muted p-3 text-xs"
                  data-testid="detail-command"
                >
                  {log.command}
                </pre>
              </div>

              {/* Reason */}
              <div>
                <h4 className="mb-1 text-xs font-medium text-muted-foreground">{t('auditLog.reason')}</h4>
                <p className="text-sm">{log.reason}</p>
              </div>

              {/* Warnings */}
              {log.auditWarnings.length > 0 && (
                <div>
                  <h4 className="mb-1 flex items-center gap-1 text-xs font-medium text-yellow-600">
                    <AlertCircle className="h-3 w-3" />
                    {t('auditLog.warnings', { count: log.auditWarnings.length })}
                  </h4>
                  <ul className="space-y-1">
                    {log.auditWarnings.map((w, i) => (
                      <li key={i} className="rounded-md bg-yellow-50 px-3 py-1.5 text-xs text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-200">
                        {w}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Blockers */}
              {log.auditBlockers.length > 0 && (
                <div>
                  <h4 className="mb-1 flex items-center gap-1 text-xs font-medium text-red-600">
                    <XCircle className="h-3 w-3" />
                    {t('auditLog.blockers', { count: log.auditBlockers.length })}
                  </h4>
                  <ul className="space-y-1">
                    {log.auditBlockers.map((b, i) => (
                      <li key={i} className="rounded-md bg-red-50 px-3 py-1.5 text-xs text-red-800 dark:bg-red-900/20 dark:text-red-200">
                        {b}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Main Page ──

export function AuditLog() {
  const { t } = useTranslation();
  const { fetchLogs, exportCsv, page, filters, logs, isExporting } = useAuditLogStore();

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  useEffect(() => {
    fetchLogs();
  }, [page, filters, fetchLogs]);

  return (
    <div className="space-y-4 sm:space-y-6" data-testid="audit-log-page">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground sm:text-2xl">{t('auditLog.title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('auditLog.description')}
          </p>
        </div>
        {logs.length > 0 && (
          <div className="flex items-center gap-2 shrink-0" data-testid="export-buttons">
            <Button
              variant="outline"
              size="sm"
              className="gap-1 text-xs"
              onClick={exportCsv}
              disabled={isExporting}
              data-testid="export-csv"
            >
              {isExporting ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Download className="h-3 w-3" />
              )}
              {t('auditLog.csv')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1 text-xs"
              onClick={() => exportToJSON(logs)}
              data-testid="export-json"
            >
              <Download className="h-3 w-3" />
              {t('auditLog.json')}
            </Button>
          </div>
        )}
      </div>

      {/* Stats */}
      <StatsCards />

      {/* Filters */}
      <FilterBar />

      {/* Table */}
      <Card>
        <CardContent className="p-0 sm:p-0">
          <AuditLogTable />
          <Pagination />
        </CardContent>
      </Card>

      {/* Detail Dialog */}
      <AuditDetailDialog />
    </div>
  );
}
