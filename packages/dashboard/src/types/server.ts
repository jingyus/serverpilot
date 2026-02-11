// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { z } from 'zod';

export const ServerStatus = {
  ONLINE: 'online',
  OFFLINE: 'offline',
  ERROR: 'error',
} as const;

export type ServerStatus = (typeof ServerStatus)[keyof typeof ServerStatus];

export const ServerStatusSchema = z.enum(['online', 'offline', 'error']);

export const OsInfoSchema = z.object({
  platform: z.string(),
  arch: z.string(),
  version: z.string(),
  kernel: z.string(),
  hostname: z.string(),
  uptime: z.number(),
});

export type OsInfo = z.infer<typeof OsInfoSchema>;

export const ServerSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: ServerStatusSchema,
  tags: z.array(z.string()).default([]),
  group: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  osInfo: OsInfoSchema.nullable().optional(),
  lastSeen: z.string().nullable().optional(),
});

export type Server = z.infer<typeof ServerSchema>;

export const ServerListResponseSchema = z.object({
  servers: z.array(ServerSchema),
  total: z.number(),
});

export type ServerListResponse = z.infer<typeof ServerListResponseSchema>;

export const AddServerResponseSchema = z.object({
  server: ServerSchema,
  token: z.string(),
  installCommand: z.string(),
});

export type AddServerResponse = z.infer<typeof AddServerResponseSchema>;

export const ServiceStatusSchema = z.enum(['running', 'stopped', 'failed']);
export type ServiceStatus = z.infer<typeof ServiceStatusSchema>;

export const ServiceSchema = z.object({
  name: z.string(),
  status: ServiceStatusSchema,
  ports: z.array(z.number()).default([]),
  manager: z.enum(['systemd', 'pm2', 'docker']).optional(),
  uptime: z.string().optional(),
});
export type Service = z.infer<typeof ServiceSchema>;

export const SoftwareSchema = z.object({
  name: z.string(),
  version: z.string(),
  configPath: z.string().optional(),
  dataPath: z.string().optional(),
  ports: z.array(z.number()).optional(),
});
export type Software = z.infer<typeof SoftwareSchema>;

export const PreferencesSchema = z.object({
  packageManager: z.enum(['apt', 'yum', 'brew', 'apk']).optional(),
  deploymentStyle: z.enum(['docker', 'bare-metal', 'pm2']).optional(),
  backupLocation: z.string().optional(),
  logLocation: z.string().optional(),
  preferredEditor: z.string().optional(),
});
export type Preferences = z.infer<typeof PreferencesSchema>;

export const MetricsSchema = z.object({
  cpuUsage: z.number(),
  memoryUsage: z.number(),
  memoryTotal: z.number(),
  diskUsage: z.number(),
  diskTotal: z.number(),
  networkIn: z.number(),
  networkOut: z.number(),
  timestamp: z.string(),
});
export type Metrics = z.infer<typeof MetricsSchema>;

export const ServerProfileSchema = z.object({
  services: z.array(ServiceSchema).default([]),
  software: z.array(SoftwareSchema).default([]),
  preferences: PreferencesSchema.nullable().optional(),
});
export type ServerProfile = z.infer<typeof ServerProfileSchema>;

export const ServerDetailResponseSchema = z.object({
  server: ServerSchema,
});
export type ServerDetailResponse = z.infer<typeof ServerDetailResponseSchema>;

export const ServerProfileResponseSchema = z.object({
  profile: ServerProfileSchema,
});
export type ServerProfileResponse = z.infer<typeof ServerProfileResponseSchema>;

export const ServerMetricsResponseSchema = z.object({
  metrics: MetricsSchema.nullable(),
});
export type ServerMetricsResponse = z.infer<typeof ServerMetricsResponseSchema>;

export const MetricPointSchema = z.object({
  id: z.string(),
  serverId: z.string(),
  cpuUsage: z.number(),
  memoryUsage: z.number(),
  memoryTotal: z.number(),
  diskUsage: z.number(),
  diskTotal: z.number(),
  networkIn: z.number(),
  networkOut: z.number(),
  timestamp: z.string(),
});
export type MetricPoint = z.infer<typeof MetricPointSchema>;

export type MetricsRange = '1h' | '24h' | '7d';

export const MetricsHistoryResponseSchema = z.object({
  metrics: z.array(MetricPointSchema),
  range: z.enum(['1h', '24h', '7d']),
});
export type MetricsHistoryResponse = z.infer<typeof MetricsHistoryResponseSchema>;
