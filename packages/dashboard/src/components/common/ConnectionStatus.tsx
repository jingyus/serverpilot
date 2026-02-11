// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { useTranslation } from 'react-i18next';
import { useWebSocketStore } from '@/stores/websocket';

const STATUS_STYLE = {
  connected: 'bg-green-500',
  connecting: 'bg-yellow-500 animate-pulse',
  reconnecting: 'bg-yellow-500 animate-pulse',
  disconnected: 'bg-red-500',
} as const;

const STATUS_LABEL_KEY: Record<string, string> = {
  connected: 'connection.connected',
  connecting: 'connection.connecting',
  reconnecting: 'connection.reconnecting',
  disconnected: 'connection.disconnected',
};

export function ConnectionStatus() {
  const { t } = useTranslation();
  const status = useWebSocketStore((s) => s.status);
  const style = STATUS_STYLE[status];
  const label = t(STATUS_LABEL_KEY[status]);

  return (
    <div className="flex items-center gap-1.5" title={`WebSocket: ${label}`}>
      <span
        data-testid="connection-indicator"
        className={`h-2 w-2 rounded-full ${style}`}
      />
      <span className="hidden text-xs text-muted-foreground sm:inline">{label}</span>
    </div>
  );
}
