import { useEffect, useCallback } from 'react';
import {
  Activity,
  CheckCircle2,
  XCircle,
  Loader2,
  Clock,
  AlertCircle,
  Filter,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
  Terminal,
  Shield,
  TrendingUp,
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
import { useOperationsStore, PAGE_SIZE } from '@/stores/operations';
import { cn } from '@/lib/utils';
import { formatDate, formatDuration } from '@/utils/format';
import type { Operation, OperationStatus, OperationType, RiskLevel } from '@/types/dashboard';

// ── Config Maps ──

const OPERATION_STATUS_CONFIG: Record<
  OperationStatus,
  { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline'; icon: typeof CheckCircle2 }
> = {
  success: { label: 'Success', variant: 'default', icon: CheckCircle2 },
  failed: { label: 'Failed', variant: 'destructive', icon: XCircle },
  running: { label: 'Running', variant: 'secondary', icon: Loader2 },
  pending: { label: 'Pending', variant: 'outline', icon: Clock },
  rolled_back: { label: 'Rolled Back', variant: 'outline', icon: RotateCcw },
};

const RISK_LEVEL_CONFIG: Record<
  RiskLevel,
  { label: string; className: string }
> = {
  green: { label: 'Safe', className: 'bg-green-100 text-green-700 border-green-200' },
  yellow: { label: 'Medium', className: 'bg-yellow-100 text-yellow-700 border-yellow-200' },
  red: { label: 'High', className: 'bg-orange-100 text-orange-700 border-orange-200' },
  critical: { label: 'Dangerous', className: 'bg-red-100 text-red-700 border-red-200' },
};

const OPERATION_TYPE_LABELS: Record<OperationType, string> = {
  install: 'Install',
  config: 'Config',
  restart: 'Restart',
  execute: 'Execute',
  backup: 'Backup',
};

// ── Sub-components ──

function StatusBadge({ status }: { status: OperationStatus }) {
  const config = OPERATION_STATUS_CONFIG[status] ?? OPERATION_STATUS_CONFIG.pending;
  const Icon = config.icon;
  return (
    <Badge variant={config.variant} className="gap-1" data-testid={`status-badge-${status}`}>
      <Icon className={cn('h-3 w-3', status === 'running' && 'animate-spin')} />
      {config.label}
    </Badge>
  );
}

function RiskBadge({ level }: { level: RiskLevel }) {
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

function StatsCards() {
  const { stats, isLoadingStats } = useOperationsStore();

  if (isLoadingStats) {
    return (
      <div className="flex items-center justify-center py-6" data-testid="stats-loading">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!stats) return null;

  const riskTotal =
    (stats.byRiskLevel.green ?? 0) +
    (stats.byRiskLevel.yellow ?? 0) +
    (stats.byRiskLevel.red ?? 0) +
    (stats.byRiskLevel.critical ?? 0);

  return (
    <div
      className="grid grid-cols-2 gap-2 sm:gap-4 lg:grid-cols-4"
      data-testid="stats-cards"
    >
      <Card>
        <CardContent className="p-3 sm:p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Activity className="h-5 w-5" />
            </div>
            <div>
              <div className="text-xl font-bold sm:text-2xl">{stats.total}</div>
              <p className="text-xs text-muted-foreground">Total Operations</p>
            </div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-3 sm:p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-100 text-green-600">
              <TrendingUp className="h-5 w-5" />
            </div>
            <div>
              <div className="text-xl font-bold text-green-600 sm:text-2xl">
                {stats.successRate.toFixed(1)}%
              </div>
              <p className="text-xs text-muted-foreground">Success Rate</p>
            </div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-3 sm:p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100 text-blue-600">
              <Clock className="h-5 w-5" />
            </div>
            <div>
              <div className="text-xl font-bold text-blue-600 sm:text-2xl">
                {stats.avgDuration != null ? formatDuration(stats.avgDuration) : '-'}
              </div>
              <p className="text-xs text-muted-foreground">Avg Duration</p>
            </div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-3 sm:p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-orange-100 text-orange-600">
              <Shield className="h-5 w-5" />
            </div>
            <div>
              <div className="flex gap-1 text-sm font-bold sm:text-base">
                <span className="text-green-600">{stats.byRiskLevel.green ?? 0}</span>
                <span className="text-muted-foreground">/</span>
                <span className="text-yellow-600">{stats.byRiskLevel.yellow ?? 0}</span>
                <span className="text-muted-foreground">/</span>
                <span className="text-orange-600">{stats.byRiskLevel.red ?? 0}</span>
                <span className="text-muted-foreground">/</span>
                <span className="text-red-600">{stats.byRiskLevel.critical ?? 0}</span>
              </div>
              <p className="text-xs text-muted-foreground">Risk Distribution</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function FilterBar() {
  const { filters, setFilters, resetFilters } = useOperationsStore();

  const hasActiveFilters = Object.values(filters).some((v) => v !== '');

  return (
    <Card data-testid="filter-bar">
      <CardContent className="p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Filter className="h-4 w-4 text-muted-foreground" />

          <select
            value={filters.type}
            onChange={(e) => setFilters({ type: e.target.value })}
            className="h-8 rounded-md border border-input bg-background px-2 text-xs"
            aria-label="Filter by type"
            data-testid="filter-type"
          >
            <option value="">All Types</option>
            {(['install', 'config', 'restart', 'execute', 'backup'] as const).map((t) => (
              <option key={t} value={t}>{OPERATION_TYPE_LABELS[t]}</option>
            ))}
          </select>

          <select
            value={filters.status}
            onChange={(e) => setFilters({ status: e.target.value })}
            className="h-8 rounded-md border border-input bg-background px-2 text-xs"
            aria-label="Filter by status"
            data-testid="filter-status"
          >
            <option value="">All Status</option>
            {(['pending', 'running', 'success', 'failed', 'rolled_back'] as const).map((s) => (
              <option key={s} value={s}>{OPERATION_STATUS_CONFIG[s].label}</option>
            ))}
          </select>

          <select
            value={filters.riskLevel}
            onChange={(e) => setFilters({ riskLevel: e.target.value })}
            className="h-8 rounded-md border border-input bg-background px-2 text-xs"
            aria-label="Filter by risk level"
            data-testid="filter-risk"
          >
            <option value="">All Risk</option>
            {(['green', 'yellow', 'red', 'critical'] as const).map((r) => (
              <option key={r} value={r}>{RISK_LEVEL_CONFIG[r].label}</option>
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

function OperationRow({
  operation,
  onSelect,
}: {
  operation: Operation;
  onSelect: (op: Operation) => void;
}) {
  return (
    <tr
      className="cursor-pointer border-b border-border/50 transition-colors hover:bg-muted/50"
      onClick={() => onSelect(operation)}
      data-testid={`operation-row-${operation.id}`}
    >
      <td className="px-3 py-3 text-xs text-muted-foreground whitespace-nowrap sm:px-4">
        {formatDate(operation.createdAt)}
      </td>
      <td className="px-3 py-3 text-sm sm:px-4">
        {operation.serverName ?? operation.serverId}
      </td>
      <td className="hidden px-3 py-3 text-sm sm:table-cell sm:px-4">
        <Badge variant="outline" className="text-xs">
          {OPERATION_TYPE_LABELS[operation.type] ?? operation.type}
        </Badge>
      </td>
      <td className="hidden px-3 py-3 text-sm md:table-cell md:px-4">
        <span className="line-clamp-1 max-w-[200px]">{operation.description}</span>
      </td>
      <td className="px-3 py-3 sm:px-4">
        <RiskBadge level={operation.riskLevel} />
      </td>
      <td className="px-3 py-3 sm:px-4">
        <StatusBadge status={operation.status} />
      </td>
      <td className="hidden px-3 py-3 text-xs text-muted-foreground lg:table-cell lg:px-4">
        {operation.duration != null ? formatDuration(operation.duration) : '-'}
      </td>
    </tr>
  );
}

function OperationsTable() {
  const { operations, isLoading, error, setSelectedOperation } = useOperationsStore();

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

  if (operations.length === 0) {
    return (
      <div className="py-12 text-center" data-testid="table-empty">
        <Activity className="mx-auto h-8 w-8 text-muted-foreground/50" />
        <p className="mt-2 text-sm text-muted-foreground">No operations found</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Try adjusting your filters or check back later.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto" data-testid="operations-table">
      <table className="w-full text-left">
        <thead>
          <tr className="border-b border-border text-xs font-medium uppercase text-muted-foreground">
            <th className="px-3 py-2 sm:px-4">Time</th>
            <th className="px-3 py-2 sm:px-4">Server</th>
            <th className="hidden px-3 py-2 sm:table-cell sm:px-4">Type</th>
            <th className="hidden px-3 py-2 md:table-cell md:px-4">Description</th>
            <th className="px-3 py-2 sm:px-4">Risk</th>
            <th className="px-3 py-2 sm:px-4">Status</th>
            <th className="hidden px-3 py-2 lg:table-cell lg:px-4">Duration</th>
          </tr>
        </thead>
        <tbody>
          {operations.map((op) => (
            <OperationRow
              key={op.id}
              operation={op}
              onSelect={setSelectedOperation}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Pagination() {
  const { page, total, setPage } = useOperationsStore();
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const goTo = useCallback(
    (p: number) => {
      setPage(p);
    },
    [setPage]
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

function OperationDetailDialog() {
  const { selectedOperation, setSelectedOperation } = useOperationsStore();
  const op = selectedOperation;

  return (
    <Dialog
      open={op != null}
      onOpenChange={(open) => { if (!open) setSelectedOperation(null); }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl" data-testid="operation-detail">
        {op && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Terminal className="h-5 w-5" />
                Operation Detail
              </DialogTitle>
              <DialogDescription>{op.description}</DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              {/* Meta */}
              <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                <div>
                  <span className="text-xs text-muted-foreground">Server</span>
                  <p className="font-medium">{op.serverName ?? op.serverId}</p>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">Type</span>
                  <p className="font-medium">{OPERATION_TYPE_LABELS[op.type] ?? op.type}</p>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">Status</span>
                  <div className="mt-0.5">
                    <StatusBadge status={op.status} />
                  </div>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">Risk Level</span>
                  <div className="mt-0.5">
                    <RiskBadge level={op.riskLevel} />
                  </div>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">Created</span>
                  <p className="font-medium">{formatDate(op.createdAt)}</p>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">Duration</span>
                  <p className="font-medium">
                    {op.duration != null ? formatDuration(op.duration) : '-'}
                  </p>
                </div>
              </div>

              {/* Commands */}
              {op.commands && op.commands.length > 0 && (
                <div>
                  <h4 className="mb-1 text-xs font-medium text-muted-foreground">Commands</h4>
                  <pre
                    className="overflow-x-auto rounded-md bg-muted p-3 text-xs"
                    data-testid="detail-commands"
                  >
                    {op.commands.join('\n')}
                  </pre>
                </div>
              )}

              {/* Output */}
              {op.output && (
                <div>
                  <h4 className="mb-1 text-xs font-medium text-muted-foreground">Output</h4>
                  <pre
                    className="max-h-60 overflow-auto rounded-md bg-muted p-3 text-xs"
                    data-testid="detail-output"
                  >
                    {op.output}
                  </pre>
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

export function Operations() {
  const { fetchOperations, fetchStats, page, filters } = useOperationsStore();

  useEffect(() => {
    fetchOperations();
    fetchStats();
  }, [fetchOperations, fetchStats]);

  // Refetch when page or filters change
  useEffect(() => {
    fetchOperations();
  }, [page, filters, fetchOperations]);

  // Refetch stats when serverId filter changes
  useEffect(() => {
    fetchStats();
  }, [filters.serverId, fetchStats]);

  return (
    <div className="space-y-4 sm:space-y-6" data-testid="operations-page">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-foreground sm:text-2xl">Operations</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Operation history and audit logs.
        </p>
      </div>

      {/* Stats */}
      <StatsCards />

      {/* Filters */}
      <FilterBar />

      {/* Table */}
      <Card>
        <CardContent className="p-0 sm:p-0">
          <OperationsTable />
          <Pagination />
        </CardContent>
      </Card>

      {/* Detail Dialog */}
      <OperationDetailDialog />
    </div>
  );
}
