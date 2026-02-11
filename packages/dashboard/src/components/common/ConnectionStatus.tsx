// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { useWebSocketStore } from '@/stores/websocket';

const STATUS_CONFIG = {
  connected: { label: 'Connected', className: 'bg-green-500' },
  connecting: { label: 'Connecting...', className: 'bg-yellow-500 animate-pulse' },
  reconnecting: { label: 'Reconnecting...', className: 'bg-yellow-500 animate-pulse' },
  disconnected: { label: 'Disconnected', className: 'bg-red-500' },
} as const;

export function ConnectionStatus() {
  const status = useWebSocketStore((s) => s.status);
  const config = STATUS_CONFIG[status];

  return (
    <div className="flex items-center gap-1.5" title={`WebSocket: ${config.label}`}>
      <span
        data-testid="connection-indicator"
        className={`h-2 w-2 rounded-full ${config.className}`}
      />
      <span className="hidden text-xs text-muted-foreground sm:inline">{config.label}</span>
    </div>
  );
}
