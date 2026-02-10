/**
 * Installation summary module for AI Installer agent.
 *
 * Generates a structured summary of the installation process including
 * timing, executed commands, encountered problems, and solutions.
 * Supports terminal display, Markdown export, and JSON serialization
 * for sharing.
 *
 * @module ui/summary
 */

import chalk from 'chalk';
import { renderTable, type TableColumn } from './table.js';
import type { InstallProgressResult, StepProgressResult } from './progress.js';

// ============================================================================
// Types
// ============================================================================

/** A problem encountered during installation with its resolution. */
export interface InstallProblem {
  /** Which step encountered the problem */
  stepId: string;
  /** Description of the problem */
  description: string;
  /** How the problem was resolved (or null if unresolved) */
  solution: string | null;
}

/** Full installation summary capturing the entire installation lifecycle. */
export interface InstallationSummary {
  /** Whether the overall installation succeeded */
  success: boolean;
  /** Name of the software being installed */
  software: string;
  /** Total installation duration in milliseconds */
  totalDurationMs: number;
  /** Timestamp when the installation started (ISO 8601) */
  startedAt: string;
  /** Timestamp when the installation finished (ISO 8601) */
  finishedAt: string;
  /** Per-step results */
  steps: StepSummary[];
  /** Problems encountered during installation */
  problems: InstallProblem[];
  /** Overall success rate as a percentage (0-100) */
  successRate: number;
  /** Number of steps that succeeded */
  successCount: number;
  /** Number of steps that failed */
  failureCount: number;
  /** Total number of steps */
  totalSteps: number;
}

/** Summary of a single installation step. */
export interface StepSummary {
  /** Step identifier */
  id: string;
  /** Human-readable step description */
  description: string;
  /** Whether the step succeeded */
  success: boolean;
  /** Duration in milliseconds */
  durationMs: number;
  /** Error message if the step failed */
  error?: string;
}

// ============================================================================
// Summary Generation
// ============================================================================

/** Options for generating an installation summary. */
export interface GenerateSummaryOptions {
  /** The name of the software that was installed */
  software: string;
  /** Installation progress result from installWithProgress */
  result: InstallProgressResult;
  /** Problems encountered during the installation */
  problems?: InstallProblem[];
  /** Override the start timestamp (ISO 8601); defaults to calculated from result */
  startedAt?: string;
}

/**
 * Generate a structured installation summary from progress results.
 *
 * @param options - Summary generation options
 * @returns A complete installation summary
 *
 * @example
 * ```ts
 * const summary = generateSummary({
 *   software: 'OpenClaw',
 *   result: installResult,
 *   problems: [{ stepId: 'install-pnpm', description: 'Network timeout', solution: 'Used mirror' }],
 * });
 * ```
 */
export function generateSummary(options: GenerateSummaryOptions): InstallationSummary {
  const { software, result, problems = [] } = options;

  const finishedAt = new Date().toISOString();
  const startedAt =
    options.startedAt ?? new Date(Date.now() - result.duration).toISOString();

  const steps: StepSummary[] = result.steps.map((s) => ({
    id: s.id,
    description: s.description,
    success: s.success,
    durationMs: s.duration,
    error: s.error,
  }));

  const successCount = steps.filter((s) => s.success).length;
  const failureCount = steps.filter((s) => !s.success).length;
  const totalSteps = result.totalSteps;
  const successRate = totalSteps > 0 ? Math.round((successCount / totalSteps) * 100) : 0;

  return {
    success: result.success,
    software,
    totalDurationMs: result.duration,
    startedAt,
    finishedAt,
    steps,
    problems,
    successRate,
    successCount,
    failureCount,
    totalSteps,
  };
}

// ============================================================================
// Duration Formatting
// ============================================================================

/**
 * Format a duration in milliseconds to a human-readable string.
 *
 * @param ms - Duration in milliseconds
 * @returns Formatted string like "1m 23s", "45s", "< 1s"
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return '< 1s';
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  if (seconds === 0) return `${minutes}m`;
  return `${minutes}m ${seconds}s`;
}

// ============================================================================
// Terminal Display
// ============================================================================

/**
 * Render an installation summary for terminal display with colors.
 *
 * @param summary - The installation summary to display
 * @returns A formatted, colorized string for terminal output
 *
 * @example
 * ```ts
 * const output = displaySummary(summary);
 * process.stdout.write(output);
 * ```
 */
export function displaySummary(summary: InstallationSummary): string {
  const parts: string[] = [];

  // Header
  const statusIcon = summary.success ? chalk.green('SUCCESS') : chalk.red('FAILED');
  parts.push('');
  parts.push(chalk.bold('Installation Summary'));
  parts.push(`Status: ${statusIcon}`);
  parts.push(`Software: ${summary.software}`);
  parts.push(`Duration: ${formatDuration(summary.totalDurationMs)}`);
  parts.push(`Success Rate: ${summary.successRate}% (${summary.successCount}/${summary.totalSteps})`);
  parts.push('');

  // Steps table
  const columns: TableColumn[] = [
    { key: 'step', header: '#', align: 'right', minWidth: 3 },
    { key: 'description', header: 'Step', minWidth: 20 },
    { key: 'status', header: 'Status', minWidth: 8 },
    { key: 'duration', header: 'Duration', align: 'right', minWidth: 8 },
  ];

  const rows = summary.steps.map((s, i) => ({
    step: String(i + 1),
    description: s.description,
    status: s.success ? 'PASS' : 'FAIL',
    duration: formatDuration(s.durationMs),
  }));

  parts.push(renderTable({ columns, rows }));

  // Problems section
  if (summary.problems.length > 0) {
    parts.push(chalk.bold('Problems Encountered'));
    for (const problem of summary.problems) {
      parts.push(`  Step: ${problem.stepId}`);
      parts.push(`  Problem: ${problem.description}`);
      parts.push(`  Solution: ${problem.solution ?? 'Unresolved'}`);
      parts.push('');
    }
  }

  // Failed steps detail
  const failedSteps = summary.steps.filter((s) => !s.success);
  if (failedSteps.length > 0 && summary.problems.length === 0) {
    parts.push(chalk.bold('Failed Steps'));
    for (const step of failedSteps) {
      parts.push(`  ${step.description}: ${step.error ?? 'Unknown error'}`);
    }
    parts.push('');
  }

  return parts.join('\n') + '\n';
}

// ============================================================================
// Markdown Export
// ============================================================================

/**
 * Export an installation summary as a Markdown document.
 *
 * @param summary - The installation summary to export
 * @returns A Markdown-formatted string
 *
 * @example
 * ```ts
 * const md = exportMarkdown(summary);
 * fs.writeFileSync('install-report.md', md);
 * ```
 */
export function exportMarkdown(summary: InstallationSummary): string {
  const lines: string[] = [];

  // Title
  const statusEmoji = summary.success ? 'SUCCESS' : 'FAILED';
  lines.push(`# Installation Report: ${summary.software}`);
  lines.push('');
  lines.push(`**Status**: ${statusEmoji}`);
  lines.push(`**Duration**: ${formatDuration(summary.totalDurationMs)}`);
  lines.push(`**Started**: ${summary.startedAt}`);
  lines.push(`**Finished**: ${summary.finishedAt}`);
  lines.push(`**Success Rate**: ${summary.successRate}% (${summary.successCount}/${summary.totalSteps})`);
  lines.push('');

  // Steps table
  lines.push('## Steps');
  lines.push('');
  lines.push('| # | Step | Status | Duration |');
  lines.push('|---|------|--------|----------|');
  for (let i = 0; i < summary.steps.length; i++) {
    const s = summary.steps[i];
    const status = s.success ? 'PASS' : 'FAIL';
    lines.push(`| ${i + 1} | ${s.description} | ${status} | ${formatDuration(s.durationMs)} |`);
  }
  lines.push('');

  // Problems section
  if (summary.problems.length > 0) {
    lines.push('## Problems Encountered');
    lines.push('');
    for (const problem of summary.problems) {
      lines.push(`### ${problem.stepId}`);
      lines.push('');
      lines.push(`- **Problem**: ${problem.description}`);
      lines.push(`- **Solution**: ${problem.solution ?? 'Unresolved'}`);
      lines.push('');
    }
  }

  // Failed steps
  const failedSteps = summary.steps.filter((s) => !s.success);
  if (failedSteps.length > 0 && summary.problems.length === 0) {
    lines.push('## Failed Steps');
    lines.push('');
    for (const step of failedSteps) {
      lines.push(`- **${step.description}**: ${step.error ?? 'Unknown error'}`);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('*Generated by AI Installer*');
  lines.push('');

  return lines.join('\n');
}

// ============================================================================
// JSON Export (for sharing)
// ============================================================================

/**
 * Export an installation summary as a JSON string for sharing.
 *
 * @param summary - The installation summary to export
 * @returns A pretty-printed JSON string
 *
 * @example
 * ```ts
 * const json = exportJson(summary);
 * fs.writeFileSync('install-report.json', json);
 * ```
 */
export function exportJson(summary: InstallationSummary): string {
  return JSON.stringify(summary, null, 2);
}

/**
 * Parse a JSON string back into an InstallationSummary.
 *
 * @param json - The JSON string to parse
 * @returns The parsed InstallationSummary
 * @throws {SyntaxError} When the JSON is invalid
 */
export function parseJsonSummary(json: string): InstallationSummary {
  return JSON.parse(json) as InstallationSummary;
}
