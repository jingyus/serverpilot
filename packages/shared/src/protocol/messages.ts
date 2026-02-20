// SPDX-License-Identifier: MIT
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * WebSocket message protocol definitions for AI Installer.
 *
 * Defines all message types exchanged between the server and agent
 * via WebSocket communication. Uses discriminated unions on the `type` field.
 *
 * @module protocol/messages
 */

import { z } from "zod";

// ============================================================================
// Message Type Constants
// ============================================================================

/** All valid message type strings */
export const MessageType = {
  AUTH_REQUEST: "auth.request",
  AUTH_RESPONSE: "auth.response",
  SESSION_CREATE: "session.create",
  ENV_REPORT: "env.report",
  PLAN_RECEIVE: "plan.receive",
  STEP_EXECUTE: "step.execute",
  STEP_OUTPUT: "step.output",
  STEP_COMPLETE: "step.complete",
  ERROR_OCCURRED: "error.occurred",
  FIX_SUGGEST: "fix.suggest",
  SESSION_COMPLETE: "session.complete",
  AI_STREAM_START: "ai.stream.start",
  AI_STREAM_TOKEN: "ai.stream.token",
  AI_STREAM_COMPLETE: "ai.stream.complete",
  AI_STREAM_ERROR: "ai.stream.error",
  SNAPSHOT_REQUEST: "snapshot.request",
  SNAPSHOT_RESPONSE: "snapshot.response",
  ROLLBACK_REQUEST: "rollback.request",
  ROLLBACK_RESPONSE: "rollback.response",
  METRICS_REPORT: "metrics.report",
  // Skills messages
  SKILL_EXECUTE: "skill.execute",
  SKILL_PROGRESS: "skill.progress",
  SKILL_RESULT: "skill.result",
} as const;

export type MessageType = (typeof MessageType)[keyof typeof MessageType];

// ============================================================================
// Shared Sub-Schemas (used by message payloads)
// ============================================================================

/** Operating system information */
const OsInfoSchema = z.object({
  platform: z.enum(["darwin", "linux", "win32"]),
  version: z.string(),
  arch: z.string(),
});

/** Shell information */
const ShellInfoSchema = z.object({
  type: z.enum(["bash", "zsh", "fish", "powershell", "unknown"]),
  version: z.string(),
});

/** Runtime versions */
const RuntimeInfoSchema = z.object({
  node: z.string().optional(),
  python: z.string().optional(),
});

/** Package manager versions */
const PackageManagersSchema = z.object({
  npm: z.string().optional(),
  pnpm: z.string().optional(),
  yarn: z.string().optional(),
  brew: z.string().optional(),
  apt: z.string().optional(),
  yum: z.string().optional(),
});

/** Network reachability */
const NetworkInfoSchema = z.object({
  canAccessNpm: z.boolean(),
  canAccessGithub: z.boolean(),
});

/** System permissions */
const PermissionsSchema = z.object({
  hasSudo: z.boolean(),
  canWriteTo: z.array(z.string()),
});

/** Service manager type */
export const ServiceManagerSchema = z.enum(["systemd", "pm2", "docker"]);

export type ServiceManager = z.infer<typeof ServiceManagerSchema>;

/** A detected service running on the system */
export const ServiceSchema = z.object({
  /** Service name (e.g. "nginx", "mysql", "node-app") */
  name: z.string(),
  /** Current service status */
  status: z.enum(["running", "stopped", "failed"]),
  /** Open ports used by the service */
  ports: z.array(z.number()),
  /** Which service manager manages this service */
  manager: ServiceManagerSchema.optional(),
  /** Human-readable uptime (e.g. "5d 2h 30m") */
  uptime: z.string().optional(),
});

export type Service = z.infer<typeof ServiceSchema>;

/** An open listening port detected on the system */
export const OpenPortSchema = z.object({
  /** Port number (1-65535) */
  port: z.number().int().min(1).max(65535),
  /** Network protocol */
  protocol: z.enum(["tcp", "udp"]),
  /** Listening address (e.g. "0.0.0.0", "127.0.0.1", "::") */
  address: z.string(),
  /** Process name using this port */
  process: z.string().optional(),
  /** Process ID */
  pid: z.number().int().optional(),
});

export type OpenPort = z.infer<typeof OpenPortSchema>;

/** Environment information reported by the agent */
export const EnvironmentInfoSchema = z.object({
  os: OsInfoSchema,
  shell: ShellInfoSchema,
  runtime: RuntimeInfoSchema,
  packageManagers: PackageManagersSchema,
  network: NetworkInfoSchema,
  permissions: PermissionsSchema,
  services: z.array(ServiceSchema).optional(),
  openPorts: z.array(OpenPortSchema).optional(),
});

export type EnvironmentInfo = z.infer<typeof EnvironmentInfoSchema>;

/** Error handling strategy for a step */
export const ErrorHandlingStrategySchema = z.enum([
  "retry",
  "skip",
  "abort",
  "fallback",
]);

export type ErrorHandlingStrategy = z.infer<typeof ErrorHandlingStrategySchema>;

/** A single install step within a plan */
export const InstallStepSchema = z.object({
  id: z.string(),
  description: z.string(),
  command: z.string(),
  expectedOutput: z.string().optional(),
  timeout: z.number(),
  canRollback: z.boolean(),
  onError: ErrorHandlingStrategySchema,
});

export type InstallStep = z.infer<typeof InstallStepSchema>;

/** Risk associated with an install plan */
const RiskSchema = z.object({
  level: z.enum(["low", "medium", "high"]),
  description: z.string(),
});

/** Install plan generated by the server AI */
export const InstallPlanSchema = z.object({
  steps: z.array(InstallStepSchema),
  estimatedTime: z.number(),
  risks: z.array(RiskSchema),
});

export type InstallPlan = z.infer<typeof InstallPlanSchema>;

/** Result of executing a single step */
export const StepResultSchema = z.object({
  stepId: z.string(),
  success: z.boolean(),
  exitCode: z.number(),
  stdout: z.string(),
  stderr: z.string(),
  duration: z.number(),
});

export type StepResult = z.infer<typeof StepResultSchema>;

/** Error context sent when an error occurs during execution */
export const ErrorContextSchema = z.object({
  stepId: z.string(),
  command: z.string(),
  exitCode: z.number(),
  stdout: z.string(),
  stderr: z.string(),
  environment: EnvironmentInfoSchema,
  previousSteps: z.array(StepResultSchema),
});

export type ErrorContext = z.infer<typeof ErrorContextSchema>;

/** A single fix strategy suggested by the AI */
export const FixStrategySchema = z.object({
  id: z.string().optional(),
  description: z.string(),
  commands: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  risk: z.enum(["low", "medium", "high"]).optional(),
  requiresSudo: z.boolean().optional(),
  estimatedTime: z.number().optional(),
  reasoning: z.string().optional(),
});

export type FixStrategy = z.infer<typeof FixStrategySchema>;

// ============================================================================
// Message Schemas
// ============================================================================

/** Client -> Server: Authentication request with device credentials */
export const AuthRequestMessageSchema = z.object({
  type: z.literal(MessageType.AUTH_REQUEST),
  payload: z.object({
    deviceId: z.string(),
    deviceToken: z.string().optional(),
    protocolVersion: z.string().optional(),
    platform: z.string(),
    osVersion: z.string().optional(),
    architecture: z.string().optional(),
    hostname: z.string().optional(),
  }),
  timestamp: z.number(),
  requestId: z.string().optional(),
});

export type AuthRequestMessage = z.infer<typeof AuthRequestMessageSchema>;

/** Server -> Client: Authentication response */
export const AuthResponseMessageSchema = z.object({
  type: z.literal(MessageType.AUTH_RESPONSE),
  payload: z.object({
    success: z.boolean(),
    protocolVersion: z.string().optional(),
    deviceToken: z.string().optional(),
    quotaLimit: z.number().optional(),
    quotaUsed: z.number().optional(),
    quotaRemaining: z.number().optional(),
    plan: z.string().optional(),
    error: z.string().optional(),
    banned: z.boolean().optional(),
    banReason: z.string().optional(),
    versionCheck: z
      .object({
        compatible: z.boolean(),
        severity: z.enum(["ok", "warn", "error"]),
        message: z.string(),
      })
      .optional(),
  }),
  timestamp: z.number(),
  requestId: z.string().optional(),
});

export type AuthResponseMessage = z.infer<typeof AuthResponseMessageSchema>;

/** Client -> Server: Request to create a new install session */
export const SessionCreateMessageSchema = z.object({
  type: z.literal(MessageType.SESSION_CREATE),
  payload: z.object({
    software: z.string(),
    version: z.string().optional(),
  }),
  timestamp: z.number(),
  requestId: z.string().optional(),
});

export type SessionCreateMessage = z.infer<typeof SessionCreateMessageSchema>;

/** Client -> Server: Report environment information */
export const EnvReportMessageSchema = z.object({
  type: z.literal(MessageType.ENV_REPORT),
  payload: EnvironmentInfoSchema,
  timestamp: z.number(),
  requestId: z.string().optional(),
});

export type EnvReportMessage = z.infer<typeof EnvReportMessageSchema>;

/** Server -> Client: Send the generated install plan */
export const PlanReceiveMessageSchema = z.object({
  type: z.literal(MessageType.PLAN_RECEIVE),
  payload: InstallPlanSchema,
  timestamp: z.number(),
  requestId: z.string().optional(),
});

export type PlanReceiveMessage = z.infer<typeof PlanReceiveMessageSchema>;

/** Server -> Client: Instruct the agent to execute a step */
export const StepExecuteMessageSchema = z.object({
  type: z.literal(MessageType.STEP_EXECUTE),
  payload: InstallStepSchema,
  timestamp: z.number(),
  requestId: z.string().optional(),
});

export type StepExecuteMessage = z.infer<typeof StepExecuteMessageSchema>;

/** Client -> Server: Stream step execution output */
export const StepOutputMessageSchema = z.object({
  type: z.literal(MessageType.STEP_OUTPUT),
  payload: z.object({
    stepId: z.string(),
    output: z.string(),
  }),
  timestamp: z.number(),
  requestId: z.string().optional(),
});

export type StepOutputMessage = z.infer<typeof StepOutputMessageSchema>;

/** Client -> Server: Report step completion */
export const StepCompleteMessageSchema = z.object({
  type: z.literal(MessageType.STEP_COMPLETE),
  payload: StepResultSchema,
  timestamp: z.number(),
  requestId: z.string().optional(),
});

export type StepCompleteMessage = z.infer<typeof StepCompleteMessageSchema>;

/** Client -> Server: Report an error during execution */
export const ErrorOccurredMessageSchema = z.object({
  type: z.literal(MessageType.ERROR_OCCURRED),
  payload: ErrorContextSchema,
  timestamp: z.number(),
  requestId: z.string().optional(),
});

export type ErrorOccurredMessage = z.infer<typeof ErrorOccurredMessageSchema>;

/** Server -> Client: Suggest fix strategies for an error */
export const FixSuggestMessageSchema = z.object({
  type: z.literal(MessageType.FIX_SUGGEST),
  payload: z.array(FixStrategySchema),
  timestamp: z.number(),
  requestId: z.string().optional(),
});

export type FixSuggestMessage = z.infer<typeof FixSuggestMessageSchema>;

/** Either side: Session completed */
export const SessionCompleteMessageSchema = z.object({
  type: z.literal(MessageType.SESSION_COMPLETE),
  payload: z.object({
    success: z.boolean(),
    summary: z.string().optional(),
  }),
  timestamp: z.number(),
  requestId: z.string().optional(),
});

export type SessionCompleteMessage = z.infer<
  typeof SessionCompleteMessageSchema
>;

// ============================================================================
// AI Streaming Message Schemas
// ============================================================================

/** Server -> Client: AI streaming has started */
export const AIStreamStartMessageSchema = z.object({
  type: z.literal(MessageType.AI_STREAM_START),
  payload: z.object({
    /** Identifies the operation being streamed (e.g. 'analyzeEnvironment') */
    operation: z.string(),
  }),
  timestamp: z.number(),
  requestId: z.string().optional(),
});

export type AIStreamStartMessage = z.infer<typeof AIStreamStartMessageSchema>;

/** Server -> Client: A token chunk from AI streaming */
export const AIStreamTokenMessageSchema = z.object({
  type: z.literal(MessageType.AI_STREAM_TOKEN),
  payload: z.object({
    /** The new token text */
    token: z.string(),
    /** Accumulated text so far */
    accumulated: z.string(),
  }),
  timestamp: z.number(),
  requestId: z.string().optional(),
});

export type AIStreamTokenMessage = z.infer<typeof AIStreamTokenMessageSchema>;

/** Server -> Client: AI streaming completed successfully */
export const AIStreamCompleteMessageSchema = z.object({
  type: z.literal(MessageType.AI_STREAM_COMPLETE),
  payload: z.object({
    /** The full response text */
    text: z.string(),
    /** Input tokens used */
    inputTokens: z.number(),
    /** Output tokens used */
    outputTokens: z.number(),
  }),
  timestamp: z.number(),
  requestId: z.string().optional(),
});

export type AIStreamCompleteMessage = z.infer<
  typeof AIStreamCompleteMessageSchema
>;

/** Server -> Client: AI streaming encountered an error */
export const AIStreamErrorMessageSchema = z.object({
  type: z.literal(MessageType.AI_STREAM_ERROR),
  payload: z.object({
    /** Error message */
    error: z.string(),
  }),
  timestamp: z.number(),
  requestId: z.string().optional(),
});

export type AIStreamErrorMessage = z.infer<typeof AIStreamErrorMessageSchema>;

// ============================================================================
// Snapshot Message Schemas
// ============================================================================

/** File entry in a snapshot request/response */
export const SnapshotFileEntrySchema = z.object({
  /** Absolute path of the file to snapshot */
  path: z.string().min(1),
  /** File content (populated in response) */
  content: z.string().optional(),
  /** Unix file mode (populated in response) */
  mode: z.number().int().optional(),
  /** File owner (populated in response) */
  owner: z.string().optional(),
  /** Whether the file existed at snapshot time (populated in response) */
  existed: z.boolean().optional(),
});

export type SnapshotFileEntry = z.infer<typeof SnapshotFileEntrySchema>;

/** Config entry type classification */
export const SnapshotConfigTypeSchema = z.enum([
  "nginx",
  "mysql",
  "redis",
  "crontab",
  "other",
]);

export type SnapshotConfigType = z.infer<typeof SnapshotConfigTypeSchema>;

/** Server -> Agent: Request agent to capture file snapshots */
export const SnapshotRequestMessageSchema = z.object({
  type: z.literal(MessageType.SNAPSHOT_REQUEST),
  payload: z.object({
    /** Unique snapshot request ID for matching response */
    snapshotRequestId: z.string(),
    /** Files to capture */
    files: z.array(z.string().min(1)),
    /** Label describing why the snapshot is being taken */
    label: z.string(),
  }),
  timestamp: z.number(),
  requestId: z.string().optional(),
});

export type SnapshotRequestMessage = z.infer<
  typeof SnapshotRequestMessageSchema
>;

/** Agent -> Server: Response with captured file data */
export const SnapshotResponseMessageSchema = z.object({
  type: z.literal(MessageType.SNAPSHOT_RESPONSE),
  payload: z.object({
    /** Matching snapshot request ID */
    snapshotRequestId: z.string(),
    /** Whether the snapshot was captured successfully */
    success: z.boolean(),
    /** Captured file entries */
    files: z.array(SnapshotFileEntrySchema),
    /** Error message if snapshot failed */
    error: z.string().optional(),
  }),
  timestamp: z.number(),
  requestId: z.string().optional(),
});

export type SnapshotResponseMessage = z.infer<
  typeof SnapshotResponseMessageSchema
>;

// ============================================================================
// Rollback Message Schemas
// ============================================================================

/** File entry to restore during rollback */
export const RollbackFileEntrySchema = z.object({
  /** Absolute path to restore the file to */
  path: z.string().min(1),
  /** File content to write */
  content: z.string(),
  /** Unix file mode to set */
  mode: z.number().int(),
  /** File owner to set */
  owner: z.string(),
  /** Whether the file existed before the operation */
  existed: z.boolean(),
});

export type RollbackFileEntry = z.infer<typeof RollbackFileEntrySchema>;

/** Server -> Agent: Request to rollback files to a previous snapshot state */
export const RollbackRequestMessageSchema = z.object({
  type: z.literal(MessageType.ROLLBACK_REQUEST),
  payload: z.object({
    /** Unique rollback request ID for matching response */
    rollbackRequestId: z.string(),
    /** Snapshot ID being rolled back to */
    snapshotId: z.string(),
    /** Files to restore */
    files: z.array(RollbackFileEntrySchema),
    /** Reason for the rollback */
    reason: z.string(),
  }),
  timestamp: z.number(),
  requestId: z.string().optional(),
});

export type RollbackRequestMessage = z.infer<
  typeof RollbackRequestMessageSchema
>;

/** Individual file rollback result */
export const RollbackFileResultSchema = z.object({
  /** File path */
  path: z.string(),
  /** Whether this file was restored successfully */
  success: z.boolean(),
  /** Error message if restoration failed */
  error: z.string().optional(),
});

export type RollbackFileResult = z.infer<typeof RollbackFileResultSchema>;

/** Agent -> Server: Response with rollback results */
export const RollbackResponseMessageSchema = z.object({
  type: z.literal(MessageType.ROLLBACK_RESPONSE),
  payload: z.object({
    /** Matching rollback request ID */
    rollbackRequestId: z.string(),
    /** Whether the overall rollback succeeded */
    success: z.boolean(),
    /** Per-file rollback results */
    fileResults: z.array(RollbackFileResultSchema),
    /** Error message if rollback failed */
    error: z.string().optional(),
  }),
  timestamp: z.number(),
  requestId: z.string().optional(),
});

export type RollbackResponseMessage = z.infer<
  typeof RollbackResponseMessageSchema
>;

// ============================================================================
// Metrics (Agent → Server: System metrics reporting)
// ============================================================================

/** Agent -> Server: Report system metrics */
export const MetricsReportMessageSchema = z.object({
  type: z.literal(MessageType.METRICS_REPORT),
  payload: z.object({
    /** Server ID this metrics belongs to */
    serverId: z.string(),
    /** CPU usage percentage (0-100) */
    cpuUsage: z.number().min(0).max(100),
    /** Memory usage in bytes */
    memoryUsage: z.number().int().nonnegative(),
    /** Total memory in bytes */
    memoryTotal: z.number().int().positive(),
    /** Disk usage in bytes */
    diskUsage: z.number().int().nonnegative(),
    /** Total disk in bytes */
    diskTotal: z.number().int().positive(),
    /** Network inbound bytes/s */
    networkIn: z.number().int().nonnegative(),
    /** Network outbound bytes/s */
    networkOut: z.number().int().nonnegative(),
  }),
  timestamp: z.number(),
  requestId: z.string().optional(),
});

export type MetricsReportMessage = z.infer<typeof MetricsReportMessageSchema>;

// ============================================================================
// Skills Messages
// ============================================================================

/** Skill execute message (Server → Agent) */
export const SkillExecuteMessageSchema = z.object({
  type: z.literal(MessageType.SKILL_EXECUTE),
  payload: z.object({
    skillId: z.string(),
    skillName: z.string(),
    commands: z.array(z.string()),
    env: z.record(z.string()).optional(),
    timeout: z.number().optional(),
    cwd: z.string().optional(),
  }),
  timestamp: z.number(),
  requestId: z.string().optional(),
});

export type SkillExecuteMessage = z.infer<typeof SkillExecuteMessageSchema>;

/** Skill progress message (Agent → Server) */
export const SkillProgressMessageSchema = z.object({
  type: z.literal(MessageType.SKILL_PROGRESS),
  payload: z.object({
    skillId: z.string(),
    status: z.enum([
      "started",
      "running",
      "step_complete",
      "completed",
      "failed",
    ]),
    step: z.number().optional(),
    totalSteps: z.number().optional(),
    message: z.string().optional(),
    error: z.string().optional(),
  }),
  timestamp: z.number(),
  requestId: z.string().optional(),
});

export type SkillProgressMessage = z.infer<typeof SkillProgressMessageSchema>;

/** Skill result message (Agent → Server) */
export const SkillResultMessageSchema = z.object({
  type: z.literal(MessageType.SKILL_RESULT),
  payload: z.object({
    skillId: z.string(),
    success: z.boolean(),
    output: z.string().optional(),
    error: z.string().optional(),
    duration: z.number().optional(),
  }),
  timestamp: z.number(),
  requestId: z.string().optional(),
});

export type SkillResultMessage = z.infer<typeof SkillResultMessageSchema>;

// ============================================================================
// Union Message Type
// ============================================================================

/** Discriminated union of all message schemas */
export const MessageSchema = z.discriminatedUnion("type", [
  AuthRequestMessageSchema,
  AuthResponseMessageSchema,
  SessionCreateMessageSchema,
  EnvReportMessageSchema,
  PlanReceiveMessageSchema,
  StepExecuteMessageSchema,
  StepOutputMessageSchema,
  StepCompleteMessageSchema,
  ErrorOccurredMessageSchema,
  FixSuggestMessageSchema,
  SessionCompleteMessageSchema,
  AIStreamStartMessageSchema,
  AIStreamTokenMessageSchema,
  AIStreamCompleteMessageSchema,
  AIStreamErrorMessageSchema,
  SnapshotRequestMessageSchema,
  SnapshotResponseMessageSchema,
  RollbackRequestMessageSchema,
  RollbackResponseMessageSchema,
  MetricsReportMessageSchema,
  SkillExecuteMessageSchema,
  SkillProgressMessageSchema,
  SkillResultMessageSchema,
]);

/** Any valid message in the protocol */
export type Message = z.infer<typeof MessageSchema>;

// ============================================================================
// Validation Helpers
// ============================================================================

/**
 * Parse and validate an unknown value as a protocol message.
 *
 * @param data - The raw data to validate
 * @returns The parsed and typed message
 * @throws {z.ZodError} When the data does not match any message schema
 */
export function parseMessage(data: unknown): Message {
  return MessageSchema.parse(data);
}

/**
 * Safely parse an unknown value as a protocol message.
 *
 * @param data - The raw data to validate
 * @returns A result object with success flag and parsed data or error
 */
export function safeParseMessage(
  data: unknown,
): z.SafeParseReturnType<unknown, Message> {
  return MessageSchema.safeParse(data);
}

/**
 * Create a message with the current timestamp.
 *
 * @param type - The message type
 * @param payload - The message payload
 * @param requestId - Optional request ID for request-response matching
 * @returns A fully formed message object
 */
export function createMessage<T extends Message["type"]>(
  type: T,
  payload: Extract<Message, { type: T }>["payload"],
  requestId?: string,
): Extract<Message, { type: T }> {
  return {
    type,
    payload,
    timestamp: Date.now(),
    ...(requestId !== undefined ? { requestId } : {}),
  } as Extract<Message, { type: T }>;
}
