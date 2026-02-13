// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Database,
  Key,
  BookOpen,
  RefreshCw,
  Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useSettingsStore } from '@/stores/settings';
import { cn } from '@/lib/utils';
import type { SubsystemStatus } from '@/types/dashboard';

function StatusDot({ status }: { status: SubsystemStatus }) {
  return (
    <span
      data-testid={`status-dot-${status}`}
      className={cn(
        'inline-block h-2.5 w-2.5 shrink-0 rounded-full',
        status === 'healthy' ? 'bg-green-500' : 'bg-red-500',
      )}
    />
  );
}

interface SubsystemRowProps {
  icon: React.ComponentType<{ className?: string }>;
  name: string;
  description: string;
  status: SubsystemStatus;
  configHint?: string;
}

function SubsystemRow({ icon: Icon, name, description, status, configHint }: SubsystemRowProps) {
  return (
    <div
      className="flex items-center gap-3 rounded-md border p-3"
      data-testid={`subsystem-${name.toLowerCase().replace(/\s+/g, '-')}`}
    >
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
      <StatusDot status={status} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">{name}</p>
        <p className="text-xs text-muted-foreground truncate">{description}</p>
      </div>
      {status === 'unhealthy' && configHint && (
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            // Scroll to AI Provider card at the top of settings
            document.querySelector('[data-testid="settings-page"]')?.scrollTo({ top: 0, behavior: 'smooth' });
          }}
          className="text-xs text-primary hover:underline shrink-0"
          data-testid="config-hint-link"
        >
          {configHint}
        </a>
      )}
    </div>
  );
}

export function SystemStatus() {
  const { t } = useTranslation();
  const {
    systemHealth,
    isCheckingSystemHealth,
    fetchHealthDetail,
  } = useSettingsStore();

  useEffect(() => {
    fetchHealthDetail();
  }, [fetchHealthDetail]);

  const overallStatusLabel =
    systemHealth?.status === 'healthy'
      ? t('settings.allSystemsOperational')
      : systemHealth?.status === 'degraded'
        ? t('settings.someSystemsDegraded')
        : systemHealth?.status === 'unhealthy'
          ? t('settings.allSystemsDown')
          : '';

  const overallStatusColor =
    systemHealth?.status === 'healthy'
      ? 'border-green-500/50 bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-300'
      : systemHealth?.status === 'degraded'
        ? 'border-yellow-500/50 bg-yellow-50 text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-300'
        : 'border-destructive/50 bg-destructive/10 text-destructive';

  const overallStatusIcon =
    systemHealth?.status === 'healthy' ? (
      <CheckCircle2 className="h-4 w-4 shrink-0" />
    ) : (
      <AlertCircle className="h-4 w-4 shrink-0" />
    );

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-muted-foreground" />
          <CardTitle>{t('settings.systemStatus')}</CardTitle>
        </div>
        <CardDescription>{t('settings.systemStatusDesc')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isCheckingSystemHealth && !systemHealth && (
          <div className="flex items-center justify-center py-6">
            <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {systemHealth && (
          <>
            {/* Overall status banner */}
            <div
              data-testid="system-health-overall"
              className={cn(
                'flex items-center gap-2 rounded-md border p-3 text-sm font-medium',
                overallStatusColor,
              )}
            >
              {overallStatusIcon}
              <span>{overallStatusLabel}</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={fetchHealthDetail}
                disabled={isCheckingSystemHealth}
                className="ml-auto h-auto p-1"
                aria-label={t('settings.refreshSystemStatus')}
              >
                <RefreshCw className={cn('h-4 w-4', isCheckingSystemHealth && 'animate-spin')} />
              </Button>
            </div>

            {/* Subsystem rows */}
            <div className="space-y-2">
              <SubsystemRow
                icon={Key}
                name={t('settings.aiProvider')}
                description={
                  systemHealth.subsystems.aiProvider.status === 'healthy'
                    ? systemHealth.subsystems.aiProvider.provider ?? t('settings.provider')
                    : systemHealth.subsystems.aiProvider.message ?? t('settings.providerUnavailable')
                }
                status={systemHealth.subsystems.aiProvider.status}
                configHint={
                  systemHealth.subsystems.aiProvider.status === 'unhealthy'
                    ? t('settings.configureProvider')
                    : undefined
                }
              />

              <SubsystemRow
                icon={Database}
                name={t('settings.database')}
                description={
                  systemHealth.subsystems.database.status === 'healthy'
                    ? systemHealth.subsystems.database.type.toUpperCase()
                    : systemHealth.subsystems.database.message ?? t('status.error')
                }
                status={systemHealth.subsystems.database.status}
              />

              <SubsystemRow
                icon={Zap}
                name={t('settings.websocket')}
                description={
                  systemHealth.subsystems.websocket.status === 'healthy'
                    ? t('settings.wsConnections', {
                        current: systemHealth.subsystems.websocket.connections,
                        max: systemHealth.subsystems.websocket.maxConnections,
                      })
                    : systemHealth.subsystems.websocket.message ?? t('status.error')
                }
                status={systemHealth.subsystems.websocket.status}
              />

              <SubsystemRow
                icon={BookOpen}
                name={t('settings.ragPipeline')}
                description={
                  systemHealth.subsystems.rag.status === 'healthy'
                    ? t('settings.ragIndexedDocs', { count: systemHealth.subsystems.rag.indexedDocs })
                    : systemHealth.subsystems.rag.message ?? t('status.error')
                }
                status={systemHealth.subsystems.rag.status}
              />
            </div>

            {/* Timestamp */}
            <p className="text-xs text-muted-foreground">
              {t('settings.lastChecked')}: {new Date(systemHealth.timestamp).toLocaleTimeString()}
            </p>
          </>
        )}

        {!systemHealth && !isCheckingSystemHealth && (
          <div className="text-center py-4 space-y-2">
            <p className="text-sm text-muted-foreground">
              {t('settings.systemStatusUnavailable')}
            </p>
            <Button variant="outline" size="sm" onClick={fetchHealthDetail}>
              <RefreshCw className="mr-2 h-4 w-4" />
              {t('settings.refreshSystemStatus')}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
