// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Cpu,
  HardDrive,
  MemoryStick,
  Activity,
  Package,
  Settings,
  AlertCircle,
  Loader2,
  MessageCircle,
  Monitor,
  Network,
  Clock,
  Play,
  Square,
  AlertTriangle,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { useServerDetailStore } from '@/stores/server-detail';
import { MonitoringSection } from '@/components/monitor/MonitoringSection';
import { cn } from '@/lib/utils';
import { formatBytes, formatDate, formatDuration } from '@/utils/format';
import type { Service, Software, Metrics } from '@/types/server';

const STATUS_CONFIG: Record<
  string,
  { label: string; variant: 'default' | 'secondary' | 'destructive'; dot: string }
> = {
  online: { label: 'Online', variant: 'default', dot: 'bg-green-500' },
  offline: { label: 'Offline', variant: 'secondary', dot: 'bg-gray-400' },
  error: { label: 'Error', variant: 'destructive', dot: 'bg-red-500' },
};

const SERVICE_STATUS_CONFIG: Record<
  string,
  { icon: typeof Play; color: string; label: string }
> = {
  running: { icon: Play, color: 'text-green-600', label: 'Running' },
  stopped: { icon: Square, color: 'text-gray-500', label: 'Stopped' },
  failed: { icon: AlertTriangle, color: 'text-red-600', label: 'Failed' },
};

function StatusBadge({ status }: { status: string }) {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.offline;
  return (
    <Badge variant={config.variant} className="gap-1.5">
      <span className={cn('h-2 w-2 rounded-full', config.dot)} />
      {config.label}
    </Badge>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  subValue,
  color,
  testId,
}: {
  icon: typeof Cpu;
  label: string;
  value: string;
  subValue?: string;
  color: string;
  testId: string;
}) {
  return (
    <Card data-testid={testId}>
      <CardContent className="p-3 sm:p-4">
        <div className="flex items-center gap-2 sm:gap-3">
          <div className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg sm:h-10 sm:w-10', color)}>
            <Icon className="h-4 w-4 sm:h-5 sm:w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground sm:text-sm">{label}</p>
            <p className="text-lg font-bold sm:text-xl">{value}</p>
            {subValue && (
              <p className="truncate text-xs text-muted-foreground">{subValue}</p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function MetricsSection({ metrics }: { metrics: Metrics | null }) {
  if (!metrics) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground" data-testid="no-metrics">
        No metrics data available. Server may be offline.
      </div>
    );
  }

  const cpuPercent = `${metrics.cpuUsage.toFixed(1)}%`;
  const memPercent = `${((metrics.memoryUsage / metrics.memoryTotal) * 100).toFixed(1)}%`;
  const memDetail = `${formatBytes(metrics.memoryUsage)} / ${formatBytes(metrics.memoryTotal)}`;
  const diskPercent = `${((metrics.diskUsage / metrics.diskTotal) * 100).toFixed(1)}%`;
  const diskDetail = `${formatBytes(metrics.diskUsage)} / ${formatBytes(metrics.diskTotal)}`;
  const netIn = formatBytes(metrics.networkIn);
  const netOut = formatBytes(metrics.networkOut);

  return (
    <div className="grid grid-cols-2 gap-2 sm:gap-4 lg:grid-cols-4" data-testid="metrics-grid">
      <MetricCard
        icon={Cpu}
        label="CPU Usage"
        value={cpuPercent}
        color="bg-blue-100 text-blue-600"
        testId="metric-cpu"
      />
      <MetricCard
        icon={MemoryStick}
        label="Memory"
        value={memPercent}
        subValue={memDetail}
        color="bg-purple-100 text-purple-600"
        testId="metric-memory"
      />
      <MetricCard
        icon={HardDrive}
        label="Disk"
        value={diskPercent}
        subValue={diskDetail}
        color="bg-amber-100 text-amber-600"
        testId="metric-disk"
      />
      <MetricCard
        icon={Network}
        label="Network"
        value={`${netIn}/s`}
        subValue={`Out: ${netOut}/s`}
        color="bg-green-100 text-green-600"
        testId="metric-network"
      />
    </div>
  );
}

function ServiceRow({ service }: { service: Service }) {
  const config = SERVICE_STATUS_CONFIG[service.status] ?? SERVICE_STATUS_CONFIG.stopped;
  const Icon = config.icon;

  return (
    <div
      className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
      data-testid={`service-${service.name}`}
    >
      <div className="flex items-center gap-3">
        <Icon className={cn('h-4 w-4 shrink-0', config.color)} />
        <div className="min-w-0">
          <p className="text-sm font-medium">{service.name}</p>
          {service.manager && (
            <p className="text-xs text-muted-foreground">{service.manager}</p>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 pl-7 sm:gap-3 sm:pl-0">
        {service.ports.length > 0 && (
          <span className="text-xs text-muted-foreground">
            :{service.ports.join(', :')}
          </span>
        )}
        {service.uptime && (
          <span className="text-xs text-muted-foreground">
            <Clock className="mr-1 inline-block h-3 w-3" />
            {service.uptime}
          </span>
        )}
        <Badge
          variant={service.status === 'running' ? 'default' : service.status === 'failed' ? 'destructive' : 'secondary'}
          className="text-xs"
        >
          {config.label}
        </Badge>
      </div>
    </div>
  );
}

function ServicesSection({ services }: { services: Service[] }) {
  if (services.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground" data-testid="no-services">
        No services detected.
      </div>
    );
  }

  const running = services.filter((s) => s.status === 'running').length;
  const stopped = services.filter((s) => s.status === 'stopped').length;
  const failed = services.filter((s) => s.status === 'failed').length;

  return (
    <div>
      <div className="mb-4 flex gap-4 text-sm" data-testid="services-summary">
        <span className="text-green-600">{running} running</span>
        <span className="text-gray-500">{stopped} stopped</span>
        {failed > 0 && <span className="text-red-600">{failed} failed</span>}
      </div>
      <div className="divide-y" data-testid="services-list">
        {services.map((service) => (
          <ServiceRow key={service.name} service={service} />
        ))}
      </div>
    </div>
  );
}

function SoftwareRow({ software }: { software: Software }) {
  return (
    <div
      className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
      data-testid={`software-${software.name}`}
    >
      <div className="flex items-center gap-3">
        <Package className="h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <p className="text-sm font-medium">{software.name}</p>
          {software.configPath && (
            <p className="truncate text-xs text-muted-foreground">Config: {software.configPath}</p>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 pl-7 sm:gap-3 sm:pl-0">
        {software.ports && software.ports.length > 0 && (
          <span className="text-xs text-muted-foreground">
            :{software.ports.join(', :')}
          </span>
        )}
        <Badge variant="outline" className="text-xs">{software.version}</Badge>
      </div>
    </div>
  );
}

function SoftwareSection({ software }: { software: Software[] }) {
  if (software.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground" data-testid="no-software">
        No software inventory available.
      </div>
    );
  }

  return (
    <div className="divide-y" data-testid="software-list">
      {software.map((sw) => (
        <SoftwareRow key={sw.name} software={sw} />
      ))}
    </div>
  );
}

export function ServerDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const {
    server,
    profile,
    metrics,
    metricsHistory,
    metricsRange,
    isLoading,
    isProfileLoading,
    isMetricsLoading,
    error,
    fetchServer,
    fetchProfile,
    fetchMetrics,
    startMetricsStream,
    stopMetricsStream,
    clearError,
    reset,
  } = useServerDetailStore();

  useEffect(() => {
    if (!id) return;
    fetchServer(id);
    fetchProfile(id);
    fetchMetrics(id);
    return () => reset();
  }, [id, fetchServer, fetchProfile, fetchMetrics, reset]);

  // Start SSE stream after initial metrics load completes
  useEffect(() => {
    if (!id || isMetricsLoading) return;
    startMetricsStream(id);
    return () => stopMetricsStream();
  }, [id, isMetricsLoading, startMetricsStream, stopMetricsStream]);

  // Determine if server has ever had metrics reported
  const hasEverReported = server ? (metricsHistory.length > 0 || metrics !== null) : undefined;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24" data-testid="loading-spinner">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error && !server) {
    return (
      <div className="space-y-4" data-testid="error-state">
        <div
          role="alert"
          className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive"
        >
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
        <Button variant="outline" onClick={() => navigate('/servers')}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Servers
        </Button>
      </div>
    );
  }

  if (!server) return null;

  return (
    <div className="space-y-6" data-testid="server-detail">
      {/* Header */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate('/servers')}
            aria-label="Back to servers"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex flex-1 flex-wrap items-center gap-2 sm:gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Monitor className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl font-bold text-foreground sm:text-2xl">{server.name}</h1>
              {server.osInfo && (
                <p className="text-xs text-muted-foreground sm:text-sm">
                  {server.osInfo.platform} {server.osInfo.version} &middot; {server.osInfo.arch}
                </p>
              )}
            </div>
            <StatusBadge status={server.status} />
          </div>
        </div>
        {server.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 pl-12">
            {server.tags.map((tag) => (
              <Badge key={tag} variant="outline" className="text-xs">
                {tag}
              </Badge>
            ))}
          </div>
        )}
        <Button onClick={() => navigate(`/chat/${server.id}`)} className="w-full sm:w-auto">
          <MessageCircle className="mr-2 h-4 w-4" />
          Chat with AI
        </Button>
      </div>

      {/* Server info summary */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground sm:text-sm" data-testid="server-info">
        {server.osInfo && (
          <>
            <span>Kernel: {server.osInfo.kernel}</span>
            <span>Hostname: {server.osInfo.hostname}</span>
            <span>Uptime: {formatDuration(server.osInfo.uptime * 1000)}</span>
          </>
        )}
        {server.lastSeen && <span>Last seen: {formatDate(server.lastSeen)}</span>}
        <span>Created: {formatDate(server.createdAt)}</span>
      </div>

      {/* Error alert */}
      {error && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive"
        >
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
          <Button variant="ghost" size="sm" className="ml-auto" onClick={clearError}>
            Dismiss
          </Button>
        </div>
      )}

      {/* Monitoring Section */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Activity className="h-5 w-5" />
            Monitoring
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isMetricsLoading ? (
            <div className="flex items-center justify-center py-8" data-testid="metrics-loading">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-6">
              <MetricsSection metrics={metrics} />
              <MonitoringSection
                metricsHistory={metricsHistory}
                metricsRange={metricsRange}
                serverId={id!}
                serverStatus={server.status}
                hasEverReported={hasEverReported}
                onRangeChange={(range) => {
                  fetchMetrics(id!, range);
                }}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Services Section */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Settings className="h-5 w-5" />
            Services
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isProfileLoading ? (
            <div className="flex items-center justify-center py-8" data-testid="profile-loading">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <ServicesSection services={profile?.services ?? []} />
          )}
        </CardContent>
      </Card>

      {/* Software Inventory Section */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Package className="h-5 w-5" />
            Software Inventory
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isProfileLoading ? (
            <div className="flex items-center justify-center py-8" data-testid="software-loading">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <SoftwareSection software={profile?.software ?? []} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
