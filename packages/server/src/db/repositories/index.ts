// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Repository layer — unified data access for all database entities.
 *
 * Re-exports all repository interfaces, implementations, and
 * singleton accessors for convenient consumption.
 *
 * @module db/repositories
 */

export {
  type ServerRepository,
  type Server,
  type ServerProfile,
  type ServerStatus,
  type OsInfo,
  type Software,
  type ServiceInfo,
  type Operation,
  type CreateServerInput,
  type UpdateServerInput,
  type PaginationOptions,
  DrizzleServerRepository,
  InMemoryServerRepository,
  getServerRepository,
  setServerRepository,
  _resetServerRepository,
} from './server-repository.js';

export {
  type ProfileRepository,
  type Profile,
  type UpdateProfileInput,
  DrizzleProfileRepository,
  getProfileRepository,
  setProfileRepository,
  _resetProfileRepository,
} from './profile-repository.js';

export {
  type OperationRepository,
  type OperationRecord,
  type OperationType,
  type OperationStatus,
  type RiskLevel,
  type CreateOperationInput,
  type OperationFilter,
  type OperationStats,
  DrizzleOperationRepository,
  getOperationRepository,
  setOperationRepository,
  _resetOperationRepository,
} from './operation-repository.js';

export {
  type SessionRepository,
  type Session,
  type CreateSessionInput,
  DrizzleSessionRepository,
  InMemorySessionRepository,
  getSessionRepository,
  setSessionRepository,
  _resetSessionRepository,
} from './session-repository.js';

export {
  type TaskRepository,
  type Task,
  type TaskStatus,
  type TaskRunStatus,
  type CreateTaskInput,
  type UpdateTaskInput,
  DrizzleTaskRepository,
  getTaskRepository,
  setTaskRepository,
  _resetTaskRepository,
} from './task-repository.js';

export {
  type SnapshotRepository,
  type Snapshot,
  type CreateSnapshotInput,
  DrizzleSnapshotRepository,
  getSnapshotRepository,
  setSnapshotRepository,
  _resetSnapshotRepository,
} from './snapshot-repository.js';

export {
  type AlertRepository,
  type Alert,
  type AlertType,
  type AlertSeverity,
  type CreateAlertInput,
  DrizzleAlertRepository,
  getAlertRepository,
  setAlertRepository,
  _resetAlertRepository,
} from './alert-repository.js';

export {
  type MetricsRepository,
  type MetricPoint,
  type CreateMetricInput,
  type MetricsRange,
  DrizzleMetricsRepository,
  getMetricsRepository,
  setMetricsRepository,
  _resetMetricsRepository,
} from './metrics-repository.js';

export {
  type KnowledgeRepository,
  type Knowledge,
  type KnowledgeSource,
  type CreateKnowledgeInput,
  type UpdateKnowledgeInput,
  DrizzleKnowledgeRepository,
  getKnowledgeRepository,
  setKnowledgeRepository,
  _resetKnowledgeRepository,
} from './knowledge-repository.js';

export {
  type UserRepository,
  type User,
  type CreateUserInput,
  type UpdateUserInput,
  DrizzleUserRepository,
  InMemoryUserRepository,
  getUserRepository,
  setUserRepository,
  _resetUserRepository,
} from './user-repository.js';

export {
  type TenantRepository,
  type Tenant,
  type CreateTenantInput,
  type UpdateTenantInput,
  DrizzleTenantRepository,
  InMemoryTenantRepository,
  getTenantRepository,
  setTenantRepository,
  _resetTenantRepository,
} from './tenant-repository.js';

export {
  type WebhookRepository,
  type Webhook,
  type WebhookDelivery,
  type DeliveryStatus,
  type CreateWebhookInput,
  type UpdateWebhookInput,
  type CreateDeliveryInput,
  DrizzleWebhookRepository,
  getWebhookRepository,
  setWebhookRepository,
  _resetWebhookRepository,
} from './webhook-repository.js';
