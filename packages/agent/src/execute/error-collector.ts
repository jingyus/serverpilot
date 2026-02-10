/**
 * Error collection module for AI Installer agent.
 *
 * Collects comprehensive error context when a command execution fails,
 * packaging execution results, environment info, and step history into
 * an ErrorContext object ready to be sent to the server for AI diagnosis.
 *
 * @module execute/error-collector
 */

import type { ErrorContext, EnvironmentInfo, ExecResult, StepResult } from '@aiinstaller/shared';

// ============================================================================
// Types
// ============================================================================

/** Options for collecting error context. */
export interface CollectErrorOptions {
  /** The ID of the step that failed. */
  stepId: string;
  /** The execution result from the failed command. */
  execResult: ExecResult;
  /** Current environment information. */
  environment: EnvironmentInfo;
  /** Results of previously executed steps (in order). */
  previousSteps?: StepResult[];
}

/** Maximum length for stdout/stderr fields to avoid oversized payloads. */
const MAX_OUTPUT_LENGTH = 10_000;

// ============================================================================
// Helpers
// ============================================================================

/**
 * Truncate a string to a maximum length, appending a truncation notice.
 *
 * Keeps the last `maxLength` characters since the end of output is
 * typically more relevant for error diagnosis.
 */
function truncateOutput(output: string, maxLength: number = MAX_OUTPUT_LENGTH): string {
  if (output.length <= maxLength) {
    return output;
  }
  const truncated = output.slice(-maxLength);
  return `[...truncated ${output.length - maxLength} chars...]\n${truncated}`;
}

/**
 * Extract the last N lines from a string.
 *
 * Useful for getting the most relevant portion of command output.
 */
export function lastLines(output: string, count: number): string {
  if (count <= 0) {
    return '';
  }
  const lines = output.split('\n');
  if (lines.length <= count) {
    return output;
  }
  return lines.slice(-count).join('\n');
}

// ============================================================================
// ErrorCollector
// ============================================================================

/**
 * Collects and manages error context during installation execution.
 *
 * Maintains a history of step results so that when an error occurs,
 * the full context (including prior steps) can be assembled and sent
 * to the server AI for diagnosis.
 *
 * @example
 * ```ts
 * const collector = new ErrorCollector(environmentInfo);
 *
 * // Record successful steps
 * collector.addStepResult({ stepId: 'check-node', success: true, ... });
 *
 * // When a step fails, collect error context
 * const errorCtx = collector.collectErrorContext({
 *   stepId: 'install-pnpm',
 *   execResult: failedResult,
 *   environment: envInfo,
 * });
 * ```
 */
export class ErrorCollector {
  private readonly stepHistory: StepResult[] = [];
  private readonly environment: EnvironmentInfo;

  /**
   * Create a new ErrorCollector.
   *
   * @param environment - The current environment information.
   */
  constructor(environment: EnvironmentInfo) {
    this.environment = environment;
  }

  /**
   * Record a completed step result in the history.
   *
   * @param result - The step result to record.
   */
  addStepResult(result: StepResult): void {
    this.stepHistory.push(result);
  }

  /**
   * Get a copy of the current step history.
   *
   * @returns Array of step results in execution order.
   */
  getStepHistory(): StepResult[] {
    return [...this.stepHistory];
  }

  /**
   * Clear all recorded step history.
   */
  clearHistory(): void {
    this.stepHistory.length = 0;
  }

  /**
   * Collect a complete error context from a failed step execution.
   *
   * Packages the execution result with the current environment and
   * step history into an ErrorContext suitable for server-side AI diagnosis.
   *
   * @param stepId - ID of the step that failed.
   * @param execResult - The execution result from the failed command.
   * @returns A complete ErrorContext object.
   */
  collect(stepId: string, execResult: ExecResult): ErrorContext {
    return {
      stepId,
      command: execResult.command,
      exitCode: execResult.exitCode,
      stdout: truncateOutput(execResult.stdout),
      stderr: truncateOutput(execResult.stderr),
      environment: this.environment,
      previousSteps: [...this.stepHistory],
    };
  }
}

// ============================================================================
// Standalone function
// ============================================================================

/**
 * Collect a complete error context from a failed command execution.
 *
 * Stateless convenience function that assembles an ErrorContext from
 * the provided options without maintaining internal state.
 *
 * @param options - Error collection options.
 * @returns A complete ErrorContext object.
 *
 * @example
 * ```ts
 * const errorCtx = collectErrorContext({
 *   stepId: 'install-pnpm',
 *   execResult: {
 *     command: 'npm install -g pnpm',
 *     exitCode: 1,
 *     stdout: '',
 *     stderr: 'EACCES: permission denied',
 *     duration: 1234,
 *     timedOut: false,
 *   },
 *   environment: envInfo,
 *   previousSteps: [
 *     { stepId: 'check-node', success: true, exitCode: 0, stdout: 'v22.0.0', stderr: '', duration: 100 },
 *   ],
 * });
 * ```
 */
export function collectErrorContext(options: CollectErrorOptions): ErrorContext {
  const { stepId, execResult, environment, previousSteps = [] } = options;

  return {
    stepId,
    command: execResult.command,
    exitCode: execResult.exitCode,
    stdout: truncateOutput(execResult.stdout),
    stderr: truncateOutput(execResult.stderr),
    environment,
    previousSteps: [...previousSteps],
  };
}
