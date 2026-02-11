// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { useEffect, useState } from 'react';
import {
  Bell,
  Plus,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Trash2,
  Pencil,
  ShieldAlert,
  ShieldCheck,
  X,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { useAlertsStore, PAGE_SIZE } from '@/stores/alerts';
import { RuleFormDialog, DeleteRuleDialog } from '@/components/alerts/RuleFormDialog';
import { cn } from '@/lib/utils';
import { formatDate } from '@/utils/format';
import type { AlertRule, AlertSeverity, MetricType, ComparisonOperator } from '@/types/dashboard';

// ── Config ──

const SEVERITY_CONFIG: Record<AlertSeverity, { label: string; className: string }> = {
  info: { label: 'Info', className: 'bg-blue-100 text-blue-700 border-blue-200' },
  warning: { label: 'Warning', className: 'bg-yellow-100 text-yellow-700 border-yellow-200' },
  critical: { label: 'Critical', className: 'bg-red-100 text-red-700 border-red-200' },
};

const METRIC_LABELS: Record<MetricType, string> = {
  cpu: 'CPU',
  memory: 'Memory',
  disk: 'Disk',
};

const OPERATOR_LABELS: Record<ComparisonOperator, string> = {
  gt: '>',
  lt: '<',
  gte: '>=',
  lte: '<=',
};

// ── Sub-components ──

function SeverityBadge({ severity }: { severity: AlertSeverity }) {
  const config = SEVERITY_CONFIG[severity];
  return (
    <span
      className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium', config.className)}
      data-testid={`severity-${severity}`}
    >
      {config.label}
    </span>
  );
}

function StatsCards() {
  const { rules, unresolvedCount } = useAlertsStore();
  const enabledCount = rules.filter((r) => r.enabled).length;

  return (
    <div className="grid grid-cols-2 gap-2 sm:gap-4 lg:grid-cols-3" data-testid="alert-stats">
      <Card>
        <CardContent className="p-3 sm:p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Bell className="h-5 w-5" />
            </div>
            <div>
              <div className="text-xl font-bold sm:text-2xl">{rules.length}</div>
              <p className="text-xs text-muted-foreground">Total Rules</p>
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
              <div className="text-xl font-bold text-green-600 sm:text-2xl">{enabledCount}</div>
              <p className="text-xs text-muted-foreground">Active Rules</p>
            </div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-3 sm:p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-100 text-red-600">
              <ShieldAlert className="h-5 w-5" />
            </div>
            <div>
              <div className="text-xl font-bold text-red-600 sm:text-2xl">{unresolvedCount}</div>
              <p className="text-xs text-muted-foreground">Unresolved Alerts</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function TabBar() {
  const { activeTab, setActiveTab } = useAlertsStore();
  return (
    <div className="flex gap-1 rounded-lg bg-muted p-1" data-testid="tab-bar">
      <button
        type="button"
        onClick={() => setActiveTab('rules')}
        className={cn(
          'rounded-md px-4 py-1.5 text-sm font-medium transition-colors',
          activeTab === 'rules' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
        )}
      >
        Alert Rules
      </button>
      <button
        type="button"
        onClick={() => setActiveTab('history')}
        className={cn(
          'rounded-md px-4 py-1.5 text-sm font-medium transition-colors',
          activeTab === 'history' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
        )}
      >
        Alert History
      </button>
    </div>
  );
}

// ── Rules Tab ──

function RulesTab() {
  const { rules, isLoadingRules, rulesError, updateRule } = useAlertsStore();
  const [formOpen, setFormOpen] = useState(false);
  const [editRule, setEditRule] = useState<AlertRule | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AlertRule | null>(null);

  const handleEdit = (rule: AlertRule) => {
    setEditRule(rule);
    setFormOpen(true);
  };

  const handleToggle = async (rule: AlertRule) => {
    await updateRule(rule.id, { enabled: !rule.enabled });
  };

  if (isLoadingRules) {
    return (
      <div className="flex items-center justify-center py-12" data-testid="rules-loading">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (rulesError) {
    return (
      <div role="alert" className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive" data-testid="rules-error">
        <AlertCircle className="h-4 w-4 shrink-0" />
        <span>{rulesError}</span>
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-muted-foreground">{rules.length} rules configured</h3>
        <Button size="sm" onClick={() => { setEditRule(null); setFormOpen(true); }} data-testid="create-rule-btn">
          <Plus className="mr-1 h-4 w-4" /> New Rule
        </Button>
      </div>

      {rules.length === 0 ? (
        <div className="py-12 text-center" data-testid="rules-empty">
          <Bell className="mx-auto h-8 w-8 text-muted-foreground/50" />
          <p className="mt-2 text-sm text-muted-foreground">No alert rules configured</p>
          <p className="mt-1 text-xs text-muted-foreground">Create your first rule to start monitoring.</p>
        </div>
      ) : (
        <div className="space-y-3" data-testid="rules-list">
          {rules.map((rule) => (
            <Card key={rule.id} data-testid={`rule-card-${rule.id}`}>
              <CardContent className="flex items-center justify-between p-3 sm:p-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className={cn('text-sm font-medium', !rule.enabled && 'text-muted-foreground line-through')}>
                      {rule.name}
                    </span>
                    <SeverityBadge severity={rule.severity} />
                    {!rule.enabled && <Badge variant="outline" className="text-xs">Disabled</Badge>}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {METRIC_LABELS[rule.metricType]} {OPERATOR_LABELS[rule.operator]} {rule.threshold}%
                    {rule.cooldownMinutes ? ` · ${rule.cooldownMinutes}min cooldown` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleToggle(rule)} title={rule.enabled ? 'Disable' : 'Enable'}>
                    {rule.enabled ? <ShieldCheck className="h-4 w-4 text-green-600" /> : <ShieldAlert className="h-4 w-4 text-muted-foreground" />}
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleEdit(rule)} title="Edit">
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setDeleteTarget(rule)} title="Delete">
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <RuleFormDialog open={formOpen} onClose={() => setFormOpen(false)} editRule={editRule} />
      <DeleteRuleDialog rule={deleteTarget} onClose={() => setDeleteTarget(null)} />
    </>
  );
}

// ── History Tab ──

function HistoryTab() {
  const { alerts, alertsTotal, alertsPage, isLoadingAlerts, alertsError, resolveAlert, setAlertsPage, fetchAlerts } = useAlertsStore();
  const totalPages = Math.max(1, Math.ceil(alertsTotal / PAGE_SIZE));

  useEffect(() => {
    fetchAlerts();
  }, [alertsPage, fetchAlerts]);

  if (isLoadingAlerts) {
    return (
      <div className="flex items-center justify-center py-12" data-testid="history-loading">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (alertsError) {
    return (
      <div role="alert" className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive" data-testid="history-error">
        <AlertCircle className="h-4 w-4 shrink-0" />
        <span>{alertsError}</span>
      </div>
    );
  }

  if (alerts.length === 0) {
    return (
      <div className="py-12 text-center" data-testid="history-empty">
        <CheckCircle2 className="mx-auto h-8 w-8 text-green-500/50" />
        <p className="mt-2 text-sm text-muted-foreground">No alerts triggered</p>
        <p className="mt-1 text-xs text-muted-foreground">All systems are operating normally.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Mobile card view */}
      <div className="space-y-2 sm:hidden" data-testid="alerts-cards">
        {alerts.map((alert) => (
          <Card key={alert.id} data-testid={`alert-card-${alert.id}`}>
            <CardContent className="p-3">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">{alert.type.toUpperCase()}</Badge>
                    <SeverityBadge severity={alert.severity} />
                  </div>
                  {alert.resolved ? (
                    <Badge variant="default" className="gap-1 text-xs">
                      <CheckCircle2 className="h-3 w-3" /> Resolved
                    </Badge>
                  ) : (
                    <Badge variant="destructive" className="gap-1 text-xs">
                      <AlertCircle className="h-3 w-3" /> Active
                    </Badge>
                  )}
                </div>
                <p className="text-sm line-clamp-2">{alert.message}</p>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">{formatDate(alert.createdAt)}</span>
                  {!alert.resolved && (
                    <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => resolveAlert(alert.id)} data-testid={`m-resolve-btn-${alert.id}`}>
                      Resolve
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Desktop table view */}
      <div className="hidden sm:block" data-testid="alerts-table-desktop">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-border text-xs font-medium uppercase text-muted-foreground">
              <th className="px-3 py-2 sm:px-4">Time</th>
              <th className="px-3 py-2 sm:px-4">Type</th>
              <th className="px-3 py-2 sm:px-4">Severity</th>
              <th className="hidden px-3 py-2 sm:table-cell sm:px-4">Message</th>
              <th className="px-3 py-2 sm:px-4">Status</th>
              <th className="px-3 py-2 sm:px-4">Action</th>
            </tr>
          </thead>
          <tbody>
            {alerts.map((alert) => (
              <tr key={alert.id} className="border-b border-border/50" data-testid={`alert-row-${alert.id}`}>
                <td className="px-3 py-3 text-xs text-muted-foreground whitespace-nowrap sm:px-4">
                  {formatDate(alert.createdAt)}
                </td>
                <td className="px-3 py-3 text-sm sm:px-4">
                  <Badge variant="outline" className="text-xs">{alert.type.toUpperCase()}</Badge>
                </td>
                <td className="px-3 py-3 sm:px-4">
                  <SeverityBadge severity={alert.severity} />
                </td>
                <td className="hidden max-w-[250px] px-3 py-3 text-sm sm:table-cell sm:px-4">
                  <span className="line-clamp-1">{alert.message}</span>
                </td>
                <td className="px-3 py-3 sm:px-4">
                  {alert.resolved ? (
                    <Badge variant="default" className="gap-1 text-xs">
                      <CheckCircle2 className="h-3 w-3" /> Resolved
                    </Badge>
                  ) : (
                    <Badge variant="destructive" className="gap-1 text-xs">
                      <AlertCircle className="h-3 w-3" /> Active
                    </Badge>
                  )}
                </td>
                <td className="px-3 py-3 sm:px-4">
                  {!alert.resolved && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => resolveAlert(alert.id)}
                      data-testid={`resolve-btn-${alert.id}`}
                    >
                      Resolve
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {alertsTotal > PAGE_SIZE && (
        <div className="flex items-center justify-between border-t border-border px-2 pt-3" data-testid="alert-pagination">
          <span className="text-xs text-muted-foreground">
            Showing {(alertsPage - 1) * PAGE_SIZE + 1}-{Math.min(alertsPage * PAGE_SIZE, alertsTotal)} of {alertsTotal}
          </span>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" className="h-7 w-7" disabled={alertsPage <= 1} onClick={() => setAlertsPage(alertsPage - 1)} aria-label="Previous page">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="px-2 text-xs text-muted-foreground">{alertsPage} / {totalPages}</span>
            <Button variant="outline" size="icon" className="h-7 w-7" disabled={alertsPage >= totalPages} onClick={() => setAlertsPage(alertsPage + 1)} aria-label="Next page">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Page ──

export function Alerts() {
  const {
    activeTab,
    fetchRules,
    fetchAlerts,
    fetchUnresolvedCount,
    successMessage,
    clearSuccess,
  } = useAlertsStore();

  useEffect(() => {
    fetchRules();
    fetchAlerts();
    fetchUnresolvedCount();
  }, [fetchRules, fetchAlerts, fetchUnresolvedCount]);

  // Auto-dismiss success message
  useEffect(() => {
    if (successMessage) {
      const timer = setTimeout(clearSuccess, 3000);
      return () => clearTimeout(timer);
    }
  }, [successMessage, clearSuccess]);

  return (
    <div className="space-y-4 sm:space-y-6" data-testid="alerts-page">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-foreground sm:text-2xl">Alerts</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage alert rules and view alert history.
        </p>
      </div>

      {/* Success message */}
      {successMessage && (
        <div className="flex items-center gap-2 rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-700" data-testid="success-message">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span className="flex-1">{successMessage}</span>
          <button type="button" onClick={clearSuccess} className="text-green-500 hover:text-green-700">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Stats */}
      <StatsCards />

      {/* Tabs */}
      <TabBar />

      {/* Content */}
      <Card>
        <CardContent className="space-y-4 p-4 sm:p-6">
          {activeTab === 'rules' ? <RulesTab /> : <HistoryTab />}
        </CardContent>
      </Card>
    </div>
  );
}
