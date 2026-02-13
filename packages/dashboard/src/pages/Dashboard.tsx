// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import {
  Monitor,
  Wifi,
  WifiOff,
  AlertTriangle,
  MessageCircle,
  Plus,
  Clock,
  Activity,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertCircle,
  ArrowRight,
  TrendingUp,
  BarChart3,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { useServersStore } from '@/stores/servers';
import { useDashboardStore, buildTrendData } from '@/stores/dashboard';
import { useUiStore } from '@/stores/ui';
import { cn } from '@/lib/utils';
import { formatDate } from '@/utils/format';
import type { Operation } from '@/types/dashboard';
import type { Alert } from '@/types/dashboard';
import { WelcomeWizard } from '@/components/onboarding/WelcomeWizard';

const OPERATION_STATUS_CONFIG: Record<
  string,
  { labelKey: string; variant: 'default' | 'secondary' | 'destructive' | 'outline'; icon: typeof CheckCircle2 }
> = {
  success: { labelKey: 'status.success', variant: 'default', icon: CheckCircle2 },
  failed: { labelKey: 'status.failed', variant: 'destructive', icon: XCircle },
  running: { labelKey: 'status.running', variant: 'secondary', icon: Loader2 },
  pending: { labelKey: 'status.pending', variant: 'outline', icon: Clock },
  rolled_back: { labelKey: 'status.rolledBack', variant: 'outline', icon: AlertTriangle },
};

const ALERT_SEVERITY_CONFIG: Record<
  string,
  { color: string; bgColor: string }
> = {
  critical: { color: 'text-red-700 dark:text-red-300', bgColor: 'bg-red-50 dark:bg-red-900/20' },
  warning: { color: 'text-yellow-700 dark:text-yellow-300', bgColor: 'bg-yellow-50 dark:bg-yellow-900/20' },
  info: { color: 'text-blue-700 dark:text-blue-300', bgColor: 'bg-blue-50 dark:bg-blue-900/20' },
};

function OperationStatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  const config = OPERATION_STATUS_CONFIG[status] ?? OPERATION_STATUS_CONFIG.pending;
  const Icon = config.icon;
  return (
    <Badge variant={config.variant} className="gap-1">
      <Icon className={cn('h-3 w-3', status === 'running' && 'animate-spin')} />
      {t(config.labelKey)}
    </Badge>
  );
}

function OperationRow({ operation, onClick }: { operation: Operation; onClick?: () => void }) {
  return (
    <div
      data-testid={`operation-${operation.id}`}
      className={cn(
        'flex items-center justify-between gap-3 border-b border-border/50 py-3 last:border-b-0',
        onClick && 'cursor-pointer hover:bg-muted/50 -mx-2 px-2 rounded-md transition-colors',
      )}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') onClick(); } : undefined}
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">
          {operation.description}
        </p>
        <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
          <span>{operation.serverName ?? operation.serverId}</span>
          <span>·</span>
          <span>{operation.type}</span>
          <span>·</span>
          <span>{formatDate(operation.createdAt)}</span>
        </div>
      </div>
      <OperationStatusBadge status={operation.status} />
    </div>
  );
}

function AlertRow({ alert }: { alert: Alert }) {
  const config = ALERT_SEVERITY_CONFIG[alert.severity] ?? ALERT_SEVERITY_CONFIG.info;
  return (
    <div
      data-testid={`alert-${alert.id}`}
      className={cn(
        'rounded-md border px-3 py-2',
        config.bgColor,
      )}
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className={cn('mt-0.5 h-4 w-4 shrink-0', config.color)} />
        <div className="min-w-0 flex-1">
          <p className={cn('text-sm font-medium', config.color)}>
            {alert.message}
          </p>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
            <span>{alert.serverName ?? alert.serverId}</span>
            <span>·</span>
            <span>{formatDate(alert.createdAt)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function formatShortDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return `${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getDate().toString().padStart(2, '0')}`;
}

export function Dashboard() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const isFirstRun = useUiStore((s) => s.isFirstRun);
  const checkFirstRun = useUiStore((s) => s.checkFirstRun);
  const completeOnboarding = useUiStore((s) => s.completeOnboarding);
  const {
    servers,
    isLoading: isLoadingServers,
    fetchServers,
  } = useServersStore();
  const {
    operations,
    alerts,
    stats,
    weekOperations,
    isLoadingOperations,
    isLoadingAlerts,
    isLoadingStats,
    isLoadingWeekOps,
    operationsError,
    alertsError,
    fetchRecentOperations,
    fetchAlerts,
    fetchOperationStats,
    fetchWeekOperations,
  } = useDashboardStore();

  const handleOnboardingComplete = useCallback(() => {
    completeOnboarding();
  }, [completeOnboarding]);

  useEffect(() => {
    fetchServers();
    fetchRecentOperations();
    fetchAlerts();
    fetchOperationStats();
    fetchWeekOperations();
  }, [fetchServers, fetchRecentOperations, fetchAlerts, fetchOperationStats, fetchWeekOperations]);

  // Re-evaluate first-run status when servers are loaded
  useEffect(() => {
    if (!isLoadingServers) {
      checkFirstRun(servers.length);
    }
  }, [isLoadingServers, servers.length, checkFirstRun]);

  const serverStats = useMemo(() => {
    const counts = { total: servers.length, online: 0, offline: 0, error: 0 };
    for (const s of servers) {
      if (s.status === 'online') counts.online++;
      else if (s.status === 'offline') counts.offline++;
      else if (s.status === 'error') counts.error++;
    }
    return counts;
  }, [servers]);

  const trendData = useMemo(() => {
    return buildTrendData(weekOperations).map((p) => ({
      ...p,
      label: formatShortDate(p.date),
    }));
  }, [weekOperations]);

  const successCount = stats?.byStatus?.success ?? 0;
  const failedCount = stats?.byStatus?.failed ?? 0;
  const totalFinished = successCount + failedCount;
  const successRate = stats?.successRate ?? (totalFinished > 0 ? Math.round((successCount / totalFinished) * 100) : 0);

  const unresolvedAlertCount = alerts.length;

  if (isFirstRun) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center" data-testid="dashboard-page">
        <WelcomeWizard onComplete={handleOnboardingComplete} />
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="dashboard-page">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground sm:text-2xl">{t('dashboard.title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('dashboard.description')}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => navigate('/chat')}
            data-testid="quick-chat"
          >
            <MessageCircle className="mr-2 h-4 w-4" />
            {t('dashboard.startChat')}
          </Button>
          <Button
            onClick={() => navigate('/servers')}
            data-testid="quick-add-server"
          >
            <Plus className="mr-2 h-4 w-4" />
            {t('dashboard.addServer')}
          </Button>
        </div>
      </div>

      {/* Server Stats */}
      {isLoadingServers ? (
        <div className="flex items-center justify-center py-8" data-testid="stats-loading">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div
          className="grid grid-cols-2 gap-2 sm:gap-4 lg:grid-cols-4"
          data-testid="server-stats"
        >
          <Card>
            <CardContent className="p-3 sm:p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Monitor className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-xl font-bold sm:text-2xl">{serverStats.total}</div>
                  <p className="text-xs text-muted-foreground">{t('dashboard.totalServers')}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 sm:p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-100 text-green-600 dark:bg-green-900/50 dark:text-green-400">
                  <Wifi className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-xl font-bold text-green-600 sm:text-2xl">
                    {serverStats.online}
                  </div>
                  <p className="text-xs text-muted-foreground">{t('status.online')}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 sm:p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-100 text-gray-500 dark:bg-gray-900/50 dark:text-gray-400">
                  <WifiOff className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-xl font-bold text-gray-500 sm:text-2xl">
                    {serverStats.offline}
                  </div>
                  <p className="text-xs text-muted-foreground">{t('status.offline')}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 sm:p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-100 text-red-600 dark:bg-red-900/50 dark:text-red-400">
                  <AlertTriangle className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-xl font-bold text-red-600 sm:text-2xl">
                    {serverStats.error}
                  </div>
                  <p className="text-xs text-muted-foreground">{t('status.error')}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Trend Chart + Success Rate */}
      <div className="grid gap-4 sm:gap-6 lg:grid-cols-3" data-testid="overview-charts">
        {/* 7-day Operation Trend */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-muted-foreground" />
              <CardTitle className="text-base">{t('dashboard.operationTrend')}</CardTitle>
            </div>
            <CardDescription>{t('dashboard.operationTrendDesc')}</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoadingWeekOps ? (
              <div className="flex items-center justify-center py-12" data-testid="trend-loading">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div data-testid="trend-chart" className="h-[200px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trendData}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                    <Tooltip
                      formatter={(value: number | undefined) => [value ?? 0, t('dashboard.operations')]}
                      labelFormatter={(label: unknown) => String(label)}
                    />
                    <Line
                      type="monotone"
                      dataKey="count"
                      name={t('dashboard.operations')}
                      stroke="#3b82f6"
                      strokeWidth={2}
                      dot={{ r: 3 }}
                      activeDot={{ r: 5 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Success Rate Card */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-muted-foreground" />
              <CardTitle className="text-base">{t('dashboard.successRate')}</CardTitle>
            </div>
            <CardDescription>{t('dashboard.successRateDesc')}</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoadingStats ? (
              <div className="flex items-center justify-center py-12" data-testid="stats-card-loading">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="space-y-4" data-testid="success-rate-card">
                <div className="text-center">
                  <div className={cn(
                    'text-4xl font-bold',
                    successRate >= 80 ? 'text-green-600' : successRate >= 50 ? 'text-yellow-600' : 'text-red-600',
                  )}>
                    {successRate}%
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{t('dashboard.overallSuccess')}</p>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-1.5">
                      <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                      <span>{t('status.success')}</span>
                    </div>
                    <span className="font-medium">{successCount}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-1.5">
                      <XCircle className="h-3.5 w-3.5 text-red-600" />
                      <span>{t('status.failed')}</span>
                    </div>
                    <span className="font-medium">{failedCount}</span>
                  </div>
                  {stats && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">{t('dashboard.totalOps')}</span>
                      <span className="font-medium">{stats.total}</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Main Content Grid: Operations + Alerts */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Recent Operations */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Activity className="h-5 w-5 text-muted-foreground" />
                <CardTitle className="text-base">{t('dashboard.recentOperations')}</CardTitle>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate('/operations')}
                data-testid="view-all-operations"
              >
                {t('common.viewAll')}
                <ArrowRight className="ml-1 h-3.5 w-3.5" />
              </Button>
            </div>
            <CardDescription>{t('dashboard.recentOperationsDesc')}</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoadingOperations ? (
              <div className="flex items-center justify-center py-8" data-testid="operations-loading">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : operationsError ? (
              <div
                role="alert"
                className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive"
                data-testid="operations-error"
              >
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{operationsError}</span>
              </div>
            ) : operations.length === 0 ? (
              <div className="py-8 text-center" data-testid="operations-empty">
                <Activity className="mx-auto h-8 w-8 text-muted-foreground/50" />
                <p className="mt-2 text-sm text-muted-foreground">{t('dashboard.noOperations')}</p>
              </div>
            ) : (
              <div data-testid="operations-list">
                {operations.map((op) => (
                  <OperationRow
                    key={op.id}
                    operation={op}
                    onClick={() => navigate(`/operations?highlight=${op.id}`)}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Alerts */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-muted-foreground" />
                <CardTitle className="text-base">{t('dashboard.activeAlerts')}</CardTitle>
                {unresolvedAlertCount > 0 && (
                  <Badge variant="destructive" className="ml-1">
                    {unresolvedAlertCount}
                  </Badge>
                )}
              </div>
            </div>
            <CardDescription>{t('dashboard.activeAlertsDesc')}</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoadingAlerts ? (
              <div className="flex items-center justify-center py-8" data-testid="alerts-loading">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : alertsError ? (
              <div
                role="alert"
                className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive"
                data-testid="alerts-error"
              >
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{alertsError}</span>
              </div>
            ) : alerts.length === 0 ? (
              <div className="py-8 text-center" data-testid="alerts-empty">
                <CheckCircle2 className="mx-auto h-8 w-8 text-green-500/50" />
                <p className="mt-2 text-sm text-muted-foreground">{t('dashboard.noAlerts')}</p>
              </div>
            ) : (
              <div className="space-y-2" data-testid="alerts-list">
                {alerts.map((alert) => (
                  <AlertRow key={alert.id} alert={alert} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
