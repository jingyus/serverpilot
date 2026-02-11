// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { useEffect, useRef } from 'react';
import { CheckCircle2, XCircle, AlertTriangle, Info, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useNotificationsStore, type Notification, type NotificationType } from '@/stores/notifications';

const iconMap: Record<NotificationType, typeof CheckCircle2> = {
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
};

const styleMap: Record<NotificationType, string> = {
  success: 'border-green-500/30 bg-green-50 text-green-800 dark:bg-green-950/50 dark:text-green-200',
  error: 'border-destructive/30 bg-red-50 text-red-800 dark:bg-red-950/50 dark:text-red-200',
  warning: 'border-yellow-500/30 bg-yellow-50 text-yellow-800 dark:bg-yellow-950/50 dark:text-yellow-200',
  info: 'border-blue-500/30 bg-blue-50 text-blue-800 dark:bg-blue-950/50 dark:text-blue-200',
};

const iconStyleMap: Record<NotificationType, string> = {
  success: 'text-green-600 dark:text-green-400',
  error: 'text-red-600 dark:text-red-400',
  warning: 'text-yellow-600 dark:text-yellow-400',
  info: 'text-blue-600 dark:text-blue-400',
};

function ToastItem({ notification }: { notification: Notification }) {
  const dismiss = useNotificationsStore((s) => s.dismiss);
  const Icon = iconMap[notification.type];

  return (
    <div
      role="alert"
      data-testid={`toast-${notification.type}`}
      className={cn(
        'pointer-events-auto flex w-80 items-start gap-3 rounded-lg border p-4 shadow-lg',
        'animate-in slide-in-from-right-full fade-in duration-300',
        styleMap[notification.type],
      )}
    >
      <Icon className={cn('mt-0.5 h-5 w-5 shrink-0', iconStyleMap[notification.type])} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">{notification.title}</p>
        {notification.message && (
          <p className="mt-1 text-xs opacity-80">{notification.message}</p>
        )}
      </div>
      {notification.dismissible !== false && (
        <button
          onClick={() => dismiss(notification.id)}
          className="shrink-0 rounded-md p-0.5 opacity-60 hover:opacity-100 transition-opacity"
          aria-label="Dismiss notification"
          data-testid="toast-dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

/**
 * Toast container that renders all active notifications.
 * Mount once in the app layout (e.g., MainLayout).
 */
export function ToastContainer() {
  const notifications = useNotificationsStore((s) => s.notifications);
  const containerRef = useRef<HTMLDivElement>(null);

  // Keep the container scrolled to bottom to show newest toasts
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [notifications.length]);

  if (notifications.length === 0) return null;

  return (
    <div
      ref={containerRef}
      aria-live="polite"
      aria-label="Notifications"
      data-testid="toast-container"
      className="fixed top-4 right-4 z-50 flex flex-col gap-3 max-h-[calc(100vh-2rem)] overflow-y-auto pointer-events-none"
    >
      {notifications.map((n) => (
        <ToastItem key={n.id} notification={n} />
      ))}
    </div>
  );
}
