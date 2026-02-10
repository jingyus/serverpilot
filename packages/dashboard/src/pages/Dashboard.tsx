import { useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
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
import { useDashboardStore } from '@/stores/dashboard';
import { cn } from '@/lib/utils';
import { formatDate } from '@/utils/format';
import type { Operation } from '@/types/dashboard';
import type { Alert } from '@/types/dashboard';

const OPERATION_STATUS_CONFIG: Record<
  string,
  { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline'; icon: typeof CheckCircle2 }
> = {
  success: { label: 'Success', variant: 'default', icon: CheckCircle2 },
  failed: { label: 'Failed', variant: 'destructive', icon: XCircle },
  running: { label: 'Running', variant: 'secondary', icon: Loader2 },
  pending: { label: 'Pending', variant: 'outline', icon: Clock },
  rolled_back: { label: 'Rolled Back', variant: 'outline', icon: AlertTriangle },
};

const ALERT_SEVERITY_CONFIG: Record<
  string,
  { color: string; bgColor: string }
> = {
  critical: { color: 'text-red-700', bgColor: 'bg-red-50' },
  warning: { color: 'text-yellow-700', bgColor: 'bg-yellow-50' },
  info: { color: 'text-blue-700', bgColor: 'bg-blue-50' },
};

function OperationStatusBadge({ status }: { status: string }) {
  const config = OPERATION_STATUS_CONFIG[status] ?? OPERATION_STATUS_CONFIG.pending;
  const Icon = config.icon;
  return (
    <Badge variant={config.variant} className="gap-1">
      <Icon className={cn('h-3 w-3', status === 'running' && 'animate-spin')} />
      {config.label}
    </Badge>
  );
}

function OperationRow({ operation }: { operation: Operation }) {
  return (
    <div
      data-testid={`operation-${operation.id}`}
      className="flex items-center justify-between gap-3 border-b border-border/50 py-3 last:border-b-0"
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

export function Dashboard() {
  const navigate = useNavigate();
  const {
    servers,
    isLoading: isLoadingServers,
    fetchServers,
  } = useServersStore();
  const {
    operations,
    alerts,
    isLoadingOperations,
    isLoadingAlerts,
    operationsError,
    alertsError,
    fetchRecentOperations,
    fetchAlerts,
  } = useDashboardStore();

  useEffect(() => {
    fetchServers();
    fetchRecentOperations();
    fetchAlerts();
  }, [fetchServers, fetchRecentOperations, fetchAlerts]);

  const serverStats = useMemo(() => {
    const counts = { total: servers.length, online: 0, offline: 0, error: 0 };
    for (const s of servers) {
      if (s.status === 'online') counts.online++;
      else if (s.status === 'offline') counts.offline++;
      else if (s.status === 'error') counts.error++;
    }
    return counts;
  }, [servers]);

  const unresolvedAlertCount = alerts.length;

  return (
    <div className="space-y-6" data-testid="dashboard-page">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground sm:text-2xl">Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Server overview and system status.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => navigate('/chat')}
            data-testid="quick-chat"
          >
            <MessageCircle className="mr-2 h-4 w-4" />
            Start Chat
          </Button>
          <Button
            onClick={() => navigate('/servers')}
            data-testid="quick-add-server"
          >
            <Plus className="mr-2 h-4 w-4" />
            Add Server
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
                  <p className="text-xs text-muted-foreground">Total Servers</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 sm:p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-100 text-green-600">
                  <Wifi className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-xl font-bold text-green-600 sm:text-2xl">
                    {serverStats.online}
                  </div>
                  <p className="text-xs text-muted-foreground">Online</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 sm:p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-100 text-gray-500">
                  <WifiOff className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-xl font-bold text-gray-500 sm:text-2xl">
                    {serverStats.offline}
                  </div>
                  <p className="text-xs text-muted-foreground">Offline</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 sm:p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-100 text-red-600">
                  <AlertTriangle className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-xl font-bold text-red-600 sm:text-2xl">
                    {serverStats.error}
                  </div>
                  <p className="text-xs text-muted-foreground">Error</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Main Content Grid: Operations + Alerts */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Recent Operations */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Activity className="h-5 w-5 text-muted-foreground" />
                <CardTitle className="text-base">Recent Operations</CardTitle>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate('/operations')}
                data-testid="view-all-operations"
              >
                View All
                <ArrowRight className="ml-1 h-3.5 w-3.5" />
              </Button>
            </div>
            <CardDescription>Last 5 operations across all servers</CardDescription>
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
                <p className="mt-2 text-sm text-muted-foreground">No operations yet</p>
              </div>
            ) : (
              <div data-testid="operations-list">
                {operations.map((op) => (
                  <OperationRow key={op.id} operation={op} />
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
                <CardTitle className="text-base">Active Alerts</CardTitle>
                {unresolvedAlertCount > 0 && (
                  <Badge variant="destructive" className="ml-1">
                    {unresolvedAlertCount}
                  </Badge>
                )}
              </div>
            </div>
            <CardDescription>Unresolved alerts requiring attention</CardDescription>
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
                <p className="mt-2 text-sm text-muted-foreground">No active alerts</p>
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
