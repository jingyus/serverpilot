/**
 * Centralized Zod schema registry for AI Installer protocol.
 *
 * Re-exports all Zod schemas from messages.ts and types.ts, and provides
 * convenient validation functions for each schema type.
 *
 * Usage:
 * ```ts
 * import { schemas, validate, safeParse } from './schemas.js';
 *
 * // Validate data against a specific schema
 * const env = validate.environmentInfo(rawData);
 *
 * // Safe parse (won't throw)
 * const result = safeParse.installPlan(rawData);
 * if (result.success) { ... }
 *
 * // Access raw schemas
 * type MyEnv = z.infer<typeof schemas.EnvironmentInfo>;
 * ```
 *
 * @module protocol/schemas
 */

import { z } from 'zod';

import {
  EnvironmentInfoSchema,
  ErrorContextSchema,
  ErrorHandlingStrategySchema,
  FixStrategySchema,
  InstallPlanSchema,
  InstallStepSchema,
  StepResultSchema,
  ServiceSchema,
  ServiceManagerSchema,
  SessionCreateMessageSchema,
  EnvReportMessageSchema,
  PlanReceiveMessageSchema,
  StepExecuteMessageSchema,
  StepOutputMessageSchema,
  StepCompleteMessageSchema,
  ErrorOccurredMessageSchema,
  FixSuggestMessageSchema,
  SessionCompleteMessageSchema,
  SnapshotRequestMessageSchema,
  SnapshotResponseMessageSchema,
  SnapshotFileEntrySchema,
  SnapshotConfigTypeSchema,
  RollbackRequestMessageSchema,
  RollbackResponseMessageSchema,
  RollbackFileEntrySchema,
  RollbackFileResultSchema,
  MessageSchema,
} from './messages.js';

import {
  ExecResultSchema,
  SessionStatusSchema,
  SessionInfoSchema,
  StepStatusSchema,
  StepProgressSchema,
} from './types.js';

// ============================================================================
// Re-export all schemas
// ============================================================================

// Sub-type schemas (from messages.ts)
export {
  EnvironmentInfoSchema,
  ErrorContextSchema,
  ErrorHandlingStrategySchema,
  FixStrategySchema,
  InstallPlanSchema,
  InstallStepSchema,
  StepResultSchema,
  ServiceSchema,
  ServiceManagerSchema,
};

// Message schemas (from messages.ts)
export {
  SessionCreateMessageSchema,
  EnvReportMessageSchema,
  PlanReceiveMessageSchema,
  StepExecuteMessageSchema,
  StepOutputMessageSchema,
  StepCompleteMessageSchema,
  ErrorOccurredMessageSchema,
  FixSuggestMessageSchema,
  SessionCompleteMessageSchema,
  SnapshotRequestMessageSchema,
  SnapshotResponseMessageSchema,
  SnapshotFileEntrySchema,
  SnapshotConfigTypeSchema,
  RollbackRequestMessageSchema,
  RollbackResponseMessageSchema,
  RollbackFileEntrySchema,
  RollbackFileResultSchema,
  MessageSchema,
};

// Additional type schemas (from types.ts)
export {
  ExecResultSchema,
  SessionStatusSchema,
  SessionInfoSchema,
  StepStatusSchema,
  StepProgressSchema,
};

// ============================================================================
// Schema registry object
// ============================================================================

/**
 * All protocol schemas grouped in a single object for convenient access.
 */
export const schemas = {
  // Sub-type schemas
  EnvironmentInfo: EnvironmentInfoSchema,
  ErrorContext: ErrorContextSchema,
  ErrorHandlingStrategy: ErrorHandlingStrategySchema,
  FixStrategy: FixStrategySchema,
  InstallPlan: InstallPlanSchema,
  InstallStep: InstallStepSchema,
  StepResult: StepResultSchema,
  Service: ServiceSchema,
  ServiceManager: ServiceManagerSchema,

  // Message schemas
  SessionCreateMessage: SessionCreateMessageSchema,
  EnvReportMessage: EnvReportMessageSchema,
  PlanReceiveMessage: PlanReceiveMessageSchema,
  StepExecuteMessage: StepExecuteMessageSchema,
  StepOutputMessage: StepOutputMessageSchema,
  StepCompleteMessage: StepCompleteMessageSchema,
  ErrorOccurredMessage: ErrorOccurredMessageSchema,
  FixSuggestMessage: FixSuggestMessageSchema,
  SessionCompleteMessage: SessionCompleteMessageSchema,
  SnapshotRequestMessage: SnapshotRequestMessageSchema,
  SnapshotResponseMessage: SnapshotResponseMessageSchema,
  SnapshotFileEntry: SnapshotFileEntrySchema,
  SnapshotConfigType: SnapshotConfigTypeSchema,
  RollbackRequestMessage: RollbackRequestMessageSchema,
  RollbackResponseMessage: RollbackResponseMessageSchema,
  RollbackFileEntry: RollbackFileEntrySchema,
  RollbackFileResult: RollbackFileResultSchema,
  Message: MessageSchema,

  // Additional type schemas
  ExecResult: ExecResultSchema,
  SessionStatus: SessionStatusSchema,
  SessionInfo: SessionInfoSchema,
  StepStatus: StepStatusSchema,
  StepProgress: StepProgressSchema,
} as const;

// ============================================================================
// Type-safe validation functions (throw on failure)
// ============================================================================

/**
 * Validation functions that parse and return typed data.
 * Each function throws `z.ZodError` on invalid input.
 */
export const validate = {
  // Sub-type validators
  environmentInfo: (data: unknown) => EnvironmentInfoSchema.parse(data),
  errorContext: (data: unknown) => ErrorContextSchema.parse(data),
  errorHandlingStrategy: (data: unknown) => ErrorHandlingStrategySchema.parse(data),
  fixStrategy: (data: unknown) => FixStrategySchema.parse(data),
  installPlan: (data: unknown) => InstallPlanSchema.parse(data),
  installStep: (data: unknown) => InstallStepSchema.parse(data),
  stepResult: (data: unknown) => StepResultSchema.parse(data),
  service: (data: unknown) => ServiceSchema.parse(data),

  // Message validators
  sessionCreateMessage: (data: unknown) => SessionCreateMessageSchema.parse(data),
  envReportMessage: (data: unknown) => EnvReportMessageSchema.parse(data),
  planReceiveMessage: (data: unknown) => PlanReceiveMessageSchema.parse(data),
  stepExecuteMessage: (data: unknown) => StepExecuteMessageSchema.parse(data),
  stepOutputMessage: (data: unknown) => StepOutputMessageSchema.parse(data),
  stepCompleteMessage: (data: unknown) => StepCompleteMessageSchema.parse(data),
  errorOccurredMessage: (data: unknown) => ErrorOccurredMessageSchema.parse(data),
  fixSuggestMessage: (data: unknown) => FixSuggestMessageSchema.parse(data),
  sessionCompleteMessage: (data: unknown) => SessionCompleteMessageSchema.parse(data),
  snapshotRequestMessage: (data: unknown) => SnapshotRequestMessageSchema.parse(data),
  snapshotResponseMessage: (data: unknown) => SnapshotResponseMessageSchema.parse(data),
  snapshotFileEntry: (data: unknown) => SnapshotFileEntrySchema.parse(data),
  rollbackRequestMessage: (data: unknown) => RollbackRequestMessageSchema.parse(data),
  rollbackResponseMessage: (data: unknown) => RollbackResponseMessageSchema.parse(data),
  rollbackFileEntry: (data: unknown) => RollbackFileEntrySchema.parse(data),
  rollbackFileResult: (data: unknown) => RollbackFileResultSchema.parse(data),
  message: (data: unknown) => MessageSchema.parse(data),

  // Additional type validators
  execResult: (data: unknown) => ExecResultSchema.parse(data),
  sessionInfo: (data: unknown) => SessionInfoSchema.parse(data),
  stepProgress: (data: unknown) => StepProgressSchema.parse(data),
} as const;

// ============================================================================
// Safe-parse functions (never throw)
// ============================================================================

/**
 * Safe parse functions that return `{ success, data?, error? }`.
 * These never throw — use when you need to handle invalid data gracefully.
 */
export const safeParse = {
  // Sub-type parsers
  environmentInfo: (data: unknown) => EnvironmentInfoSchema.safeParse(data),
  errorContext: (data: unknown) => ErrorContextSchema.safeParse(data),
  errorHandlingStrategy: (data: unknown) => ErrorHandlingStrategySchema.safeParse(data),
  fixStrategy: (data: unknown) => FixStrategySchema.safeParse(data),
  installPlan: (data: unknown) => InstallPlanSchema.safeParse(data),
  installStep: (data: unknown) => InstallStepSchema.safeParse(data),
  stepResult: (data: unknown) => StepResultSchema.safeParse(data),
  service: (data: unknown) => ServiceSchema.safeParse(data),

  // Message parsers
  sessionCreateMessage: (data: unknown) => SessionCreateMessageSchema.safeParse(data),
  envReportMessage: (data: unknown) => EnvReportMessageSchema.safeParse(data),
  planReceiveMessage: (data: unknown) => PlanReceiveMessageSchema.safeParse(data),
  stepExecuteMessage: (data: unknown) => StepExecuteMessageSchema.safeParse(data),
  stepOutputMessage: (data: unknown) => StepOutputMessageSchema.safeParse(data),
  stepCompleteMessage: (data: unknown) => StepCompleteMessageSchema.safeParse(data),
  errorOccurredMessage: (data: unknown) => ErrorOccurredMessageSchema.safeParse(data),
  fixSuggestMessage: (data: unknown) => FixSuggestMessageSchema.safeParse(data),
  sessionCompleteMessage: (data: unknown) => SessionCompleteMessageSchema.safeParse(data),
  snapshotRequestMessage: (data: unknown) => SnapshotRequestMessageSchema.safeParse(data),
  snapshotResponseMessage: (data: unknown) => SnapshotResponseMessageSchema.safeParse(data),
  snapshotFileEntry: (data: unknown) => SnapshotFileEntrySchema.safeParse(data),
  rollbackRequestMessage: (data: unknown) => RollbackRequestMessageSchema.safeParse(data),
  rollbackResponseMessage: (data: unknown) => RollbackResponseMessageSchema.safeParse(data),
  rollbackFileEntry: (data: unknown) => RollbackFileEntrySchema.safeParse(data),
  rollbackFileResult: (data: unknown) => RollbackFileResultSchema.safeParse(data),
  message: (data: unknown) => MessageSchema.safeParse(data),

  // Additional type parsers
  execResult: (data: unknown) => ExecResultSchema.safeParse(data),
  sessionInfo: (data: unknown) => SessionInfoSchema.safeParse(data),
  stepProgress: (data: unknown) => StepProgressSchema.safeParse(data),
} as const;

// ============================================================================
// Utility: validate JSON string
// ============================================================================

/**
 * Parse a raw JSON string as a protocol message.
 *
 * @param json - Raw JSON string received from WebSocket
 * @returns The parsed and validated message
 * @throws {SyntaxError} When the string is not valid JSON
 * @throws {z.ZodError} When the parsed data does not match any message schema
 */
export function parseMessageFromJSON(json: string): z.infer<typeof MessageSchema> {
  const data: unknown = JSON.parse(json);
  return MessageSchema.parse(data);
}

/**
 * Safely parse a raw JSON string as a protocol message.
 *
 * @param json - Raw JSON string received from WebSocket
 * @returns A result object with success flag and parsed data or error
 */
export function safeParseMessageFromJSON(
  json: string,
): z.SafeParseReturnType<unknown, z.infer<typeof MessageSchema>> | { success: false; error: Error } {
  try {
    const data: unknown = JSON.parse(json);
    return MessageSchema.safeParse(data);
  } catch (err) {
    return { success: false as const, error: err instanceof Error ? err : new Error(String(err)) };
  }
}
