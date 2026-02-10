/**
 * Protocol type definitions for AI Installer.
 *
 * Provides standalone TypeScript types and Zod schemas for:
 * - Environment information
 * - Install plans and steps
 * - Command execution results
 * - Error context and fix strategies
 *
 * Types that overlap with messages.ts are re-exported from there for consistency.
 * Additional types specific to business logic are defined here.
 *
 * @module protocol/types
 */

import { z } from 'zod';

import type {
  EnvironmentInfo,
  ErrorContext,
  ErrorHandlingStrategy,
  FixStrategy,
  InstallPlan,
  InstallStep,
  Service,
  ServiceManager,
  StepResult,
} from './messages.js';

// ============================================================================
// Re-exports from messages.ts (Zod-backed types)
// ============================================================================

export type {
  EnvironmentInfo,
  ErrorContext,
  ErrorHandlingStrategy,
  FixStrategy,
  InstallPlan,
  InstallStep,
  Service,
  ServiceManager,
  StepResult,
};

// ============================================================================
// ExecResult - Command execution result
// ============================================================================

/**
 * Raw command execution result.
 *
 * Unlike StepResult (which is tied to a plan step), ExecResult represents
 * the outcome of any arbitrary command execution on the client.
 */
export const ExecResultSchema = z.object({
  /** The command that was executed */
  command: z.string(),
  /** Process exit code (0 = success) */
  exitCode: z.number(),
  /** Standard output captured from the command */
  stdout: z.string(),
  /** Standard error captured from the command */
  stderr: z.string(),
  /** Execution duration in milliseconds */
  duration: z.number(),
  /** Whether the command timed out */
  timedOut: z.boolean(),
});

export type ExecResult = z.infer<typeof ExecResultSchema>;

// ============================================================================
// Session types
// ============================================================================

/** Possible states of an installation session */
export const SessionStatus = {
  CREATED: 'created',
  DETECTING: 'detecting',
  PLANNING: 'planning',
  EXECUTING: 'executing',
  ERROR: 'error',
  COMPLETED: 'completed',
} as const;

export type SessionStatus = (typeof SessionStatus)[keyof typeof SessionStatus];

export const SessionStatusSchema = z.enum([
  'created',
  'detecting',
  'planning',
  'executing',
  'error',
  'completed',
]);

/** Session metadata tracked on the server */
export const SessionInfoSchema = z.object({
  /** Unique session identifier */
  id: z.string(),
  /** Software being installed */
  software: z.string(),
  /** Target version (if specified) */
  version: z.string().optional(),
  /** Current session status */
  status: SessionStatusSchema,
  /** Session creation timestamp */
  createdAt: z.number(),
  /** Last activity timestamp */
  updatedAt: z.number(),
});

export type SessionInfo = z.infer<typeof SessionInfoSchema>;

// ============================================================================
// Step status tracking
// ============================================================================

/** Possible states of a single install step */
export const StepStatus = {
  PENDING: 'pending',
  RUNNING: 'running',
  SUCCESS: 'success',
  FAILED: 'failed',
  SKIPPED: 'skipped',
} as const;

export type StepStatus = (typeof StepStatus)[keyof typeof StepStatus];

export const StepStatusSchema = z.enum(['pending', 'running', 'success', 'failed', 'skipped']);

/** Runtime progress of an install step */
export const StepProgressSchema = z.object({
  /** Step identifier (matches InstallStep.id) */
  stepId: z.string(),
  /** Current status */
  status: StepStatusSchema,
  /** Start timestamp (when the step began executing) */
  startedAt: z.number().optional(),
  /** End timestamp (when the step finished) */
  completedAt: z.number().optional(),
  /** Number of retry attempts so far */
  retryCount: z.number(),
  /** Execution result (populated after completion) */
  result: ExecResultSchema.optional(),
});

export type StepProgress = z.infer<typeof StepProgressSchema>;

// ============================================================================
// Validation helpers
// ============================================================================

/**
 * Parse and validate an unknown value as an ExecResult.
 *
 * @param data - The raw data to validate
 * @returns The parsed and typed ExecResult
 * @throws {z.ZodError} When the data does not match the schema
 */
export function parseExecResult(data: unknown): ExecResult {
  return ExecResultSchema.parse(data);
}

/**
 * Safely parse an unknown value as an ExecResult.
 *
 * @param data - The raw data to validate
 * @returns A result object with success flag and parsed data or error
 */
export function safeParseExecResult(data: unknown): z.SafeParseReturnType<unknown, ExecResult> {
  return ExecResultSchema.safeParse(data);
}

/**
 * Parse and validate an unknown value as SessionInfo.
 *
 * @param data - The raw data to validate
 * @returns The parsed and typed SessionInfo
 * @throws {z.ZodError} When the data does not match the schema
 */
export function parseSessionInfo(data: unknown): SessionInfo {
  return SessionInfoSchema.parse(data);
}

/**
 * Parse and validate an unknown value as StepProgress.
 *
 * @param data - The raw data to validate
 * @returns The parsed and typed StepProgress
 * @throws {z.ZodError} When the data does not match the schema
 */
export function parseStepProgress(data: unknown): StepProgress {
  return StepProgressSchema.parse(data);
}
