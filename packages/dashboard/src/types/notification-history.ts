// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors

export type NotificationCategory = 'alert' | 'webhook' | 'system';

export interface NotificationItem {
  id: string;
  category: NotificationCategory;
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
  severity?: 'info' | 'warning' | 'critical';
  meta?: Record<string, string>;
}

export const NOTIFICATION_CATEGORIES: NotificationCategory[] = [
  'alert',
  'webhook',
  'system',
];

export const CATEGORY_LABELS: Record<NotificationCategory, string> = {
  alert: 'Alert',
  webhook: 'Webhook',
  system: 'System',
};
