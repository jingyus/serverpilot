// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Verbose output logger for AI Installer agent.
 *
 * Provides a structured logger that outputs timestamped, categorized debug
 * information when --verbose / -v mode is enabled. When disabled, all
 * log calls are no-ops for zero overhead.
 *
 * @module ui/verbose
 */

import { theme } from './colors.js';

// ============================================================================
// Types
// ============================================================================

/** Log categories for verbose output. */
export type VerboseCategory =
  | 'env'
  | 'server'
  | 'ws'
  | 'auth'
  | 'step'
  | 'sandbox'
  | 'exec'
  | 'plan'
  | 'error'
  | 'general';

/** Options for creating a VerboseLogger instance. */
export interface VerboseLoggerOptions {
  /** Whether verbose output is enabled (default: false) */
  enabled?: boolean;
  /** Output function for log messages (default: console.error) */
  writer?: (message: string) => void;
  /** Whether to include timestamps in output (default: true) */
  timestamps?: boolean;
}

// ============================================================================
// Category labels
// ============================================================================

const CATEGORY_LABELS: Record<VerboseCategory, string> = {
  env: 'ENV',
  server: 'SERVER',
  ws: 'WS',
  auth: 'AUTH',
  step: 'STEP',
  sandbox: 'SANDBOX',
  exec: 'EXEC',
  plan: 'PLAN',
  error: 'ERROR',
  general: 'VERBOSE',
};

// ============================================================================
// VerboseLogger
// ============================================================================

/**
 * Structured verbose logger for detailed output in --verbose mode.
 *
 * When disabled, all methods are no-ops. When enabled, outputs timestamped
 * messages with category labels to stderr (to avoid interfering with stdout).
 *
 * @example
 * ```ts
 * const verbose = new VerboseLogger({ enabled: options.verbose });
 * verbose.log('env', 'Detecting operating system...');
 * verbose.log('ws', `Connected to ${serverUrl}`);
 * verbose.logData('env', 'Environment info', envInfo);
 * verbose.logTiming('step', 'Install pnpm', 3200);
 * ```
 */
export class VerboseLogger {
  readonly enabled: boolean;
  private readonly writer: (message: string) => void;
  private readonly timestamps: boolean;

  constructor(options: VerboseLoggerOptions = {}) {
    this.enabled = options.enabled ?? false;
    this.writer = options.writer ?? ((msg: string) => console.error(msg));
    this.timestamps = options.timestamps ?? true;
  }

  /**
   * Log a verbose message under a given category.
   *
   * @param category - The log category
   * @param message - The message to log
   */
  log(category: VerboseCategory, message: string): void {
    if (!this.enabled) return;
    const prefix = this.formatPrefix(category);
    this.writer(`${prefix} ${message}`);
  }

  /**
   * Log a key-value data object under a given category.
   *
   * @param category - The log category
   * @param label - A label describing the data
   * @param data - An object whose key-value pairs will be printed
   */
  logData(category: VerboseCategory, label: string, data: Record<string, unknown>): void {
    if (!this.enabled) return;
    const prefix = this.formatPrefix(category);
    this.writer(`${prefix} ${label}:`);
    for (const [key, value] of Object.entries(data)) {
      const displayValue = typeof value === 'object' ? JSON.stringify(value) : String(value);
      this.writer(`${prefix}   ${key}: ${displayValue}`);
    }
  }

  /**
   * Log a timing/duration message.
   *
   * @param category - The log category
   * @param label - What was timed
   * @param durationMs - Duration in milliseconds
   */
  logTiming(category: VerboseCategory, label: string, durationMs: number): void {
    if (!this.enabled) return;
    const prefix = this.formatPrefix(category);
    const formatted = formatMs(durationMs);
    this.writer(`${prefix} ${label} completed in ${formatted}`);
  }

  /**
   * Log a command that is about to be executed.
   *
   * @param command - The command string
   * @param args - Command arguments
   */
  logCommand(command: string, args: string[]): void {
    if (!this.enabled) return;
    const prefix = this.formatPrefix('exec');
    const full = args.length > 0 ? `${command} ${args.join(' ')}` : command;
    this.writer(`${prefix} Executing: ${full}`);
  }

  /**
   * Log a step transition during installation.
   *
   * @param stepIndex - Current step index (0-based)
   * @param totalSteps - Total number of steps
   * @param description - Step description
   */
  logStep(stepIndex: number, totalSteps: number, description: string): void {
    if (!this.enabled) return;
    const prefix = this.formatPrefix('step');
    this.writer(`${prefix} [${stepIndex + 1}/${totalSteps}] Starting: ${description}`);
  }

  private formatPrefix(category: VerboseCategory): string {
    const label = CATEGORY_LABELS[category];
    const tag = theme.muted(`[${label}]`);
    if (this.timestamps) {
      const ts = theme.muted(formatTimestamp(new Date()));
      return `${ts} ${tag}`;
    }
    return tag;
  }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Format a Date into a HH:MM:SS.mmm timestamp string.
 */
export function formatTimestamp(date: Date): string {
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  const s = String(date.getSeconds()).padStart(2, '0');
  const ms = String(date.getMilliseconds()).padStart(3, '0');
  return `${h}:${m}:${s}.${ms}`;
}

/**
 * Format milliseconds into a human-readable duration.
 */
export function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = (ms / 1000).toFixed(1);
  return `${seconds}s`;
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a VerboseLogger instance. Convenience factory.
 *
 * @param enabled - Whether verbose mode is enabled
 * @param options - Additional options
 * @returns A new VerboseLogger
 */
export function createVerboseLogger(
  enabled: boolean,
  options?: Omit<VerboseLoggerOptions, 'enabled'>,
): VerboseLogger {
  return new VerboseLogger({ ...options, enabled });
}
