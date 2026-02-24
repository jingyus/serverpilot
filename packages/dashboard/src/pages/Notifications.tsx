// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  Bell,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Inbox,
  Webhook,
  AlertTriangle,
  Info,
  Monitor,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  useNotificationHistoryStore,
  getUnreadCount,
  getFilteredItems,
} from "@/stores/notification-history";
import { cn } from "@/lib/utils";
import type {
  NotificationCategory,
  NotificationItem,
} from "@/types/notification-history";
import { NOTIFICATION_CATEGORIES } from "@/types/notification-history";

const CATEGORY_CONFIG: Record<
  NotificationCategory,
  { icon: typeof Bell; className: string }
> = {
  alert: {
    icon: AlertTriangle,
    className: "text-yellow-600 dark:text-yellow-400",
  },
  webhook: {
    icon: Webhook,
    className: "text-blue-600 dark:text-blue-400",
  },
  system: {
    icon: Monitor,
    className: "text-gray-600 dark:text-gray-400",
  },
};

const SEVERITY_ICON: Record<string, typeof Info> = {
  info: Info,
  warning: AlertTriangle,
  critical: AlertCircle,
};

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  const diffHour = Math.floor(diffMs / 3_600_000);
  const diffDay = Math.floor(diffMs / 86_400_000);

  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString();
}

function NotificationRow({
  item,
  onMarkRead,
}: {
  item: NotificationItem;
  onMarkRead: (id: string) => void;
}) {
  const config = CATEGORY_CONFIG[item.category];
  const Icon = config.icon;
  const SeverityIcon = item.severity ? SEVERITY_ICON[item.severity] : null;

  return (
    <Card
      data-testid="notification-item"
      className={cn(
        "transition-colors cursor-pointer",
        !item.read && "border-primary/30 bg-primary/5",
      )}
      onClick={() => !item.read && onMarkRead(item.id)}
    >
      <CardContent className="flex items-start gap-3 p-3 sm:p-4">
        <div
          className={cn(
            "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
            item.read ? "bg-muted" : "bg-primary/10",
          )}
        >
          <Icon className={cn("h-4 w-4", config.className)} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "text-sm font-medium",
                item.read ? "text-muted-foreground" : "text-foreground",
              )}
            >
              {item.title}
            </span>
            {!item.read && (
              <span className="h-2 w-2 shrink-0 rounded-full bg-primary" />
            )}
            {item.severity && SeverityIcon && (
              <Badge
                variant={
                  item.severity === "critical" ? "destructive" : "outline"
                }
                className="text-xs"
              >
                {item.severity}
              </Badge>
            )}
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground truncate">
            {item.message}
          </p>
          <div className="mt-1 flex items-center gap-2">
            <Badge variant="outline" className="text-xs">
              {item.category}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {formatTimestamp(item.timestamp)}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function Notifications() {
  const { t } = useTranslation();

  // Use selectors to prevent unnecessary re-renders
  const isLoading = useNotificationHistoryStore((state) => state.isLoading);
  const error = useNotificationHistoryStore((state) => state.error);
  const filter = useNotificationHistoryStore((state) => state.filter);
  const unreadCount = useNotificationHistoryStore(getUnreadCount);
  const filteredItems = useNotificationHistoryStore(getFilteredItems);

  // Get actions separately - they don't change
  const fetchNotifications = useNotificationHistoryStore(
    (state) => state.fetchNotifications,
  );
  const setFilter = useNotificationHistoryStore((state) => state.setFilter);
  const markAsRead = useNotificationHistoryStore((state) => state.markAsRead);
  const markAllAsRead = useNotificationHistoryStore(
    (state) => state.markAllAsRead,
  );
  const clearError = useNotificationHistoryStore((state) => state.clearError);

  // Fetch notifications only on mount, not on every store update
  useEffect(() => {
    fetchNotifications();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleMarkRead = useCallback(
    (id: string) => {
      markAsRead(id);
    },
    [markAsRead],
  );

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground sm:text-2xl">
            {t("notifications.title")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("notifications.description")}
          </p>
        </div>
        <Button
          onClick={markAllAsRead}
          variant="outline"
          disabled={unreadCount === 0}
          className="w-full sm:w-auto"
          data-testid="mark-all-read"
        >
          <CheckCircle2 className="mr-2 h-4 w-4" />
          {t("notifications.markAllRead")}
          {unreadCount > 0 && (
            <Badge variant="secondary" className="ml-2">
              {unreadCount}
            </Badge>
          )}
        </Button>
      </div>

      {/* Error */}
      {error && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive"
        >
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            onClick={clearError}
          >
            {t("common.dismiss")}
          </Button>
        </div>
      )}

      {/* Filter tabs */}
      <div
        className="flex gap-1 rounded-lg bg-muted p-1"
        data-testid="filter-tabs"
      >
        <button
          type="button"
          className={cn(
            "rounded-md px-4 py-1.5 text-sm font-medium transition-colors",
            filter === "all"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
          onClick={() => setFilter("all")}
        >
          {t("notifications.all")}
        </button>
        {NOTIFICATION_CATEGORIES.map((cat) => (
          <button
            key={cat}
            type="button"
            className={cn(
              "rounded-md px-4 py-1.5 text-sm font-medium transition-colors capitalize",
              filter === cat
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
            onClick={() => setFilter(cat)}
          >
            {t(`notifications.category.${cat}`)}
          </button>
        ))}
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : filteredItems.length === 0 ? (
        <div
          data-testid="empty-state"
          className="flex flex-col items-center justify-center py-16 text-center"
        >
          <Inbox className="h-12 w-12 text-muted-foreground/50" />
          <h3 className="mt-4 text-lg font-medium text-foreground">
            {t("notifications.noNotifications")}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("notifications.noNotificationsDesc")}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredItems.map((item) => (
            <NotificationRow
              key={item.id}
              item={item}
              onMarkRead={handleMarkRead}
            />
          ))}
        </div>
      )}
    </div>
  );
}
