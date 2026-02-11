// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { useEffect, useCallback } from 'react';
import {
  Shield,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  Terminal,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Clock,
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
  { label: string; className: string }
> = {
  green: { label: 'Safe', className: 'bg-green-100 text-green-700 border-green-200' },
  yellow: { label: 'Medium', className: 'bg-yellow-100 text-yellow-700 border-yellow-200' },
  red: { label: 'High', className: 'bg-orange-100 text-orange-700 border-orange-200' },
  critical: { label: 'Critical', className: 'bg-red-100 text-red-700 border-red-200' },
  forbidden: { label: 'Forbidden', className: 'bg-red-200 text-red-900 border-red-300' },
};

const ACTION_CONFIG: Record<
  ValidationAction,
  { label: string; variant: 'default' | 'secondary' | 'destructive'; icon: typeof CheckCircle2 }
> = {
  allowed: { label: 'Allowed', variant: 'default', icon: CheckCircle2 },
  requires_confirmation: { label: 'Confirmed', variant: 'secondary', icon: AlertCircle },
  blocked: { label: 'Blocked', variant: 'destructive', icon: XCircle },
};

const EXECUTION_RESULT_CONFIG: Record<
  ExecutionResult,
  { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }
> = {
  success: { label: 'Success', variant: 'default' },
  failed: { label: 'Failed', variant: 'destructive' },
  timeout: { label: 'Timeout', variant: 'destructive' },
  pending: { label: 'Pending', variant: 'outline' },
  skipped: { label: 'Skipped', variant: 'secondary' },
};

// ── Export Utilities ──

function exportToCSV(logs: AuditLogEntry[]) {
  const headers = ['Time', 'Command', 'Risk Level', 'Action', 'Result', 'Reason', 'Warnings', 'Blockers'];
  const rows = logs.map((log) => [
    log.createdAt,
    `"${log.command.replace(/"/g, '""')}"`,
    log.riskLevel,
    log.action,
    log.executionResult ?? '',
    `"${log.reason.replace(/"/g, '""')}"`,
    `"${log.auditWarnings.join('; ').replace(/"/g, '""')}"`,
    `"${log.auditBlockers.join('; ').replace(/"/g, '""')}"`,
  ]);
  const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  downloadFile(csv, 'audit-log.csv', 'text/csv');
}

function exportToJSON(logs: AuditLogEntry[]) {
  const json = JSON.stringify(logs, null, 2);
  downloadFile(json, 'audit-log.json', 'application/json');
}

function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Sub-components ──

function RiskBadge({ level }: { level: AuditRiskLevel }) {
  const config = RISK_LEVEL_CONFIG[level] ?? RISK_LEVEL_CONFIG.green;
  return (
    <span
      className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium', config.className)}
      data-testid={`risk-badge-${level}`}
    >
      {config.label}
    </span>
  );
}

function ActionBadge({ action }: { action: ValidationAction }) {
  const config = ACTION_CONFIG[action] ?? ACTION_CONFIG.allowed;
  const Icon = config.icon;
  return (
    <Badge variant={config.variant} className="gap-1" data-testid={`action-badge-${action}`}>
      <Icon className="h-3 w-3" />
      {config.label}
    </Badge>
  );
}

function ResultBadge({ result }: { result: ExecutionResult | null }) {
  if (!result) return <span className="text-xs text-muted-foreground">-</span>;
  const config = EXECUTION_RESULT_CONFIG[result] ?? EXECUTION_RESULT_CONFIG.pending;
  return (
    <Badge variant={config.variant} className="text-xs" data-testid={`result-badge-${result}`}>
      {config.label}
    </Badge>
  );
}

function StatsCards() {
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
              <p className="text-xs text-muted-foreground">Total Records</p>
            </div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-3 sm:p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-100 text-green-600">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <div className="text-xl font-bold text-green-600 sm:text-2xl">{allowed}</div>
              <p className="text-xs text-muted-foreground">Allowed</p>
            </div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-3 sm:p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-100 text-red-600">
              <ShieldX className="h-5 w-5" />
            </div>
            <div>
              <div className="text-xl font-bold text-red-600 sm:text-2xl">{blocked}</div>
              <p className="text-xs text-muted-foreground">Blocked</p>
            </div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-3 sm:p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-orange-100 text-orange-600">
              <ShieldAlert className="h-5 w-5" />
            </div>
            <div>
              <div className="text-xl font-bold text-orange-600 sm:text-2xl">{highRisk}</div>
              <p className="text-xs text-muted-foreground">High Risk</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function FilterBar() {
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
            <option value="">All Risk</option>
            {(['green', 'yellow', 'red', 'critical', 'forbidden'] as const).map((r) => (
              <option key={r} value={r}>{RISK_LEVEL_CONFIG[r].label}</option>
            ))}
          </select>

          <select
            value={filters.action}
            onChange={(e) => setFilters({ action: e.target.value })}
            className="h-8 rounded-md border border-input bg-background px-2 text-xs"
            aria-label="Filter by action"
            data-testid="filter-action"
          >
            <option value="">All Actions</option>
            {(['allowed', 'blocked', 'requires_confirmation'] as const).map((a) => (
              <option key={a} value={a}>{ACTION_CONFIG[a].label}</option>
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
              Reset
            </Button>
          )}
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
        <p className="mt-2 text-sm text-muted-foreground">No audit logs found</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Command validation events will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto" data-testid="audit-table">
      <table className="w-full text-left">
        <thead>
          <tr className="border-b border-border text-xs font-medium uppercase text-muted-foreground">
            <th className="px-3 py-2 sm:px-4">Time</th>
            <th className="px-3 py-2 sm:px-4">Command</th>
            <th className="px-3 py-2 sm:px-4">Risk</th>
            <th className="hidden px-3 py-2 sm:table-cell sm:px-4">Action</th>
            <th className="hidden px-3 py-2 md:table-cell md:px-4">Result</th>
            <th className="hidden px-3 py-2 lg:table-cell lg:px-4">Reason</th>
          </tr>
        </thead>
        <tbody>
          {logs.map((log) => (
            <AuditLogRow key={log.id} log={log} onSelect={setSelectedLog} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Pagination() {
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
        Showing {(page - 1) * PAGE_SIZE + 1}-{Math.min(page * PAGE_SIZE, total)} of {total}
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
                Audit Detail
              </DialogTitle>
              <DialogDescription>Command validation record</DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              {/* Meta */}
              <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                <div>
                  <span className="text-xs text-muted-foreground">Risk Level</span>
                  <div className="mt-0.5">
                    <RiskBadge level={log.riskLevel} />
                  </div>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">Action</span>
                  <div className="mt-0.5">
                    <ActionBadge action={log.action} />
                  </div>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">Result</span>
                  <div className="mt-0.5">
                    <ResultBadge result={log.executionResult} />
                  </div>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">Time</span>
                  <p className="font-medium">{formatDate(log.createdAt)}</p>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">Server ID</span>
                  <p className="font-mono text-xs">{log.serverId}</p>
                </div>
                {log.matchedPattern && (
                  <div>
                    <span className="text-xs text-muted-foreground">Matched Pattern</span>
                    <p className="font-mono text-xs">{log.matchedPattern}</p>
                  </div>
                )}
              </div>

              {/* Command */}
              <div>
                <h4 className="mb-1 text-xs font-medium text-muted-foreground">Command</h4>
                <pre
                  className="overflow-x-auto rounded-md bg-muted p-3 text-xs"
                  data-testid="detail-command"
                >
                  {log.command}
                </pre>
              </div>

              {/* Reason */}
              <div>
                <h4 className="mb-1 text-xs font-medium text-muted-foreground">Reason</h4>
                <p className="text-sm">{log.reason}</p>
              </div>

              {/* Warnings */}
              {log.auditWarnings.length > 0 && (
                <div>
                  <h4 className="mb-1 flex items-center gap-1 text-xs font-medium text-yellow-600">
                    <AlertCircle className="h-3 w-3" />
                    Warnings ({log.auditWarnings.length})
                  </h4>
                  <ul className="space-y-1">
                    {log.auditWarnings.map((w, i) => (
                      <li key={i} className="rounded-md bg-yellow-50 px-3 py-1.5 text-xs text-yellow-800">
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
                    Blockers ({log.auditBlockers.length})
                  </h4>
                  <ul className="space-y-1">
                    {log.auditBlockers.map((b, i) => (
                      <li key={i} className="rounded-md bg-red-50 px-3 py-1.5 text-xs text-red-800">
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
  const { fetchLogs, page, filters, logs } = useAuditLogStore();

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  useEffect(() => {
    fetchLogs();
  }, [page, filters, fetchLogs]);

  return (
    <div className="space-y-4 sm:space-y-6" data-testid="audit-log-page">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground sm:text-2xl">Audit Log</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Security audit trail — command validation history.
          </p>
        </div>
        {logs.length > 0 && (
          <div className="flex items-center gap-2" data-testid="export-buttons">
            <Button
              variant="outline"
              size="sm"
              className="gap-1 text-xs"
              onClick={() => exportToCSV(logs)}
              data-testid="export-csv"
            >
              <Download className="h-3 w-3" />
              CSV
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1 text-xs"
              onClick={() => exportToJSON(logs)}
              data-testid="export-json"
            >
              <Download className="h-3 w-3" />
              JSON
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
