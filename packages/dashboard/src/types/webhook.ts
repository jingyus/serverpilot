// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors

export type WebhookEventType =
  | 'task.completed'
  | 'alert.triggered'
  | 'server.offline'
  | 'operation.failed'
  | 'agent.disconnected'
  | 'skill.completed'
  | 'skill.failed';

export const WEBHOOK_EVENT_TYPES: WebhookEventType[] = [
  'task.completed',
  'alert.triggered',
  'server.offline',
  'operation.failed',
  'agent.disconnected',
  'skill.completed',
  'skill.failed',
];

export const EVENT_LABELS: Record<WebhookEventType, string> = {
  'task.completed': 'Task Completed',
  'alert.triggered': 'Alert Triggered',
  'server.offline': 'Server Offline',
  'operation.failed': 'Operation Failed',
  'agent.disconnected': 'Agent Disconnected',
  'skill.completed': 'Skill Completed',
  'skill.failed': 'Skill Failed',
};

export interface Webhook {
  id: string;
  userId: string;
  tenantId: string | null;
  name: string;
  url: string;
  secret: string;
  events: WebhookEventType[];
  enabled: boolean;
  maxRetries: number;
  createdAt: string;
  updatedAt: string;
}

export interface WebhookDelivery {
  id: string;
  webhookId: string;
  eventType: string;
  payload: Record<string, unknown>;
  status: 'pending' | 'success' | 'failed';
  httpStatus: number | null;
  responseBody: string | null;
  attempts: number;
  lastAttemptAt: string | null;
  nextRetryAt: string | null;
  createdAt: string;
}

export interface WebhooksResponse {
  webhooks: Webhook[];
  total: number;
}

export interface WebhookResponse {
  webhook: Webhook;
}

export interface DeliveriesResponse {
  deliveries: WebhookDelivery[];
  total: number;
}
