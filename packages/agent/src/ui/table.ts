// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Table display module for AI Installer agent.
 *
 * Provides formatted table rendering for terminal output, with specialized
 * functions for displaying environment information and install plans.
 * Inspired by openclaw-modules/terminal/table.ts.
 *
 * @module ui/table
 */

import chalk from 'chalk';
import type { EnvironmentInfo, InstallPlan, InstallStep } from '@aiinstaller/shared';

// ============================================================================
// Types
// ============================================================================

/** Alignment options for table cells. */
export type Align = 'left' | 'right' | 'center';

/** Describes a single column in a table. */
export interface TableColumn {
  /** Key used to look up cell values from row records */
  key: string;
  /** Header text displayed at the top of the column */
  header: string;
  /** Text alignment within the column (default: 'left') */
  align?: Align;
  /** Minimum column width in characters */
  minWidth?: number;
}

/** Options for rendering a table. */
export interface RenderTableOptions {
  /** Column definitions */
  columns: TableColumn[];
  /** Row data; each row is a record keyed by column key */
  rows: Array<Record<string, string>>;
  /** Border style (default: 'unicode') */
  border?: 'unicode' | 'ascii' | 'none';
  /** Cell padding on each side (default: 1) */
  padding?: number;
}

// ============================================================================
// Low-level helpers
// ============================================================================

function repeat(ch: string, n: number): string {
  return n <= 0 ? '' : ch.repeat(n);
}

function padCell(text: string, width: number, align: Align): string {
  const len = text.length;
  if (len >= width) return text;
  const pad = width - len;
  if (align === 'right') return `${repeat(' ', pad)}${text}`;
  if (align === 'center') {
    const left = Math.floor(pad / 2);
    const right = pad - left;
    return `${repeat(' ', left)}${text}${repeat(' ', right)}`;
  }
  return `${text}${repeat(' ', pad)}`;
}

// ============================================================================
// renderTable
// ============================================================================

/**
 * Render row data as a formatted text table.
 *
 * Supports unicode, ascii, and borderless styles. Column widths are
 * automatically calculated from headers and cell content.
 *
 * @param opts - Table rendering options
 * @returns The rendered table as a string (with trailing newline)
 *
 * @example
 * ```ts
 * const output = renderTable({
 *   columns: [
 *     { key: 'name', header: 'Name' },
 *     { key: 'value', header: 'Value' },
 *   ],
 *   rows: [
 *     { name: 'OS', value: 'macOS 14.0' },
 *   ],
 * });
 * ```
 */
export function renderTable(opts: RenderTableOptions): string {
  const { columns, rows } = opts;
  const border = opts.border ?? 'unicode';
  const padding = Math.max(0, opts.padding ?? 1);

  if (border === 'none') {
    const header = columns.map((c) => c.header).join(' | ');
    const dataLines = rows.map((r) => columns.map((c) => r[c.key] ?? '').join(' | '));
    return [header, ...dataLines].join('\n') + '\n';
  }

  // Calculate column widths: max of header and all cell values, respecting minWidth
  const widths = columns.map((col, _i) => {
    const headerLen = col.header.length;
    const maxCell = Math.max(0, ...rows.map((r) => (r[col.key] ?? '').length));
    const contentWidth = Math.max(headerLen, maxCell);
    return Math.max(col.minWidth ?? 0, contentWidth + padding * 2);
  });

  // Box-drawing characters
  const box =
    border === 'ascii'
      ? { tl: '+', tr: '+', bl: '+', br: '+', h: '-', v: '|', t: '+', ml: '+', m: '+', mr: '+', b: '+' }
      : { tl: '┌', tr: '┐', bl: '└', br: '┘', h: '─', v: '│', t: '┬', ml: '├', m: '┼', mr: '┤', b: '┴' };

  const hLine = (left: string, mid: string, right: string) =>
    `${left}${widths.map((w) => repeat(box.h, w)).join(mid)}${right}`;

  const contentWidth = (i: number) => Math.max(1, widths[i] - padding * 2);
  const padStr = repeat(' ', padding);

  const renderRow = (cells: string[]) => {
    const parts = cells.map((cell, i) => {
      const aligned = padCell(cell, contentWidth(i), columns[i]?.align ?? 'left');
      return `${padStr}${aligned}${padStr}`;
    });
    return `${box.v}${parts.join(box.v)}${box.v}`;
  };

  const lines: string[] = [];
  lines.push(hLine(box.tl, box.t, box.tr));
  lines.push(renderRow(columns.map((c) => c.header)));
  lines.push(hLine(box.ml, box.m, box.mr));
  for (const row of rows) {
    lines.push(renderRow(columns.map((c) => row[c.key] ?? '')));
  }
  lines.push(hLine(box.bl, box.b, box.br));
  return lines.join('\n') + '\n';
}

// ============================================================================
// displayEnvironmentInfo
// ============================================================================

/**
 * Format environment information as a human-readable table string.
 *
 * Displays operating system, shell, runtime versions, package managers,
 * network reachability, and permission details.
 *
 * @param env - The environment information to display
 * @returns Formatted table string
 *
 * @example
 * ```ts
 * const text = displayEnvironmentInfo(envInfo);
 * process.stdout.write(text);
 * ```
 */
export function displayEnvironmentInfo(env: EnvironmentInfo): string {
  const columns: TableColumn[] = [
    { key: 'category', header: 'Category', minWidth: 12 },
    { key: 'item', header: 'Item', minWidth: 16 },
    { key: 'value', header: 'Value', minWidth: 20 },
  ];

  const rows: Array<Record<string, string>> = [];

  // OS information
  rows.push({ category: 'OS', item: 'Platform', value: env.os.platform });
  rows.push({ category: 'OS', item: 'Version', value: env.os.version });
  rows.push({ category: 'OS', item: 'Architecture', value: env.os.arch });

  // Shell
  rows.push({ category: 'Shell', item: 'Type', value: env.shell.type });
  rows.push({ category: 'Shell', item: 'Version', value: env.shell.version });

  // Runtimes
  if (env.runtime.node) {
    rows.push({ category: 'Runtime', item: 'Node.js', value: env.runtime.node });
  }
  if (env.runtime.python) {
    rows.push({ category: 'Runtime', item: 'Python', value: env.runtime.python });
  }

  // Package managers
  const pmEntries: Array<[string, string | undefined]> = [
    ['npm', env.packageManagers.npm],
    ['pnpm', env.packageManagers.pnpm],
    ['yarn', env.packageManagers.yarn],
    ['brew', env.packageManagers.brew],
    ['apt', env.packageManagers.apt],
  ];
  for (const [name, version] of pmEntries) {
    if (version) {
      rows.push({ category: 'Pkg Manager', item: name, value: version });
    }
  }

  // Network
  rows.push({
    category: 'Network',
    item: 'npm Registry',
    value: env.network.canAccessNpm ? 'Reachable' : 'Unreachable',
  });
  rows.push({
    category: 'Network',
    item: 'GitHub',
    value: env.network.canAccessGithub ? 'Reachable' : 'Unreachable',
  });

  // Permissions
  rows.push({
    category: 'Permissions',
    item: 'sudo',
    value: env.permissions.hasSudo ? 'Yes' : 'No',
  });
  if (env.permissions.canWriteTo.length > 0) {
    rows.push({
      category: 'Permissions',
      item: 'Writable Paths',
      value: env.permissions.canWriteTo.join(', '),
    });
  }

  const title = chalk.bold('Environment Information') + '\n';
  return title + renderTable({ columns, rows });
}

// ============================================================================
// displayInstallPlan
// ============================================================================

/**
 * Format an installation plan as a human-readable table string.
 *
 * Shows each step with its index, command, timeout, rollback support,
 * and error handling strategy. Also displays risks and estimated time.
 *
 * @param plan - The install plan to display
 * @returns Formatted table string
 *
 * @example
 * ```ts
 * const text = displayInstallPlan(plan);
 * process.stdout.write(text);
 * ```
 */
export function displayInstallPlan(plan: InstallPlan): string {
  const columns: TableColumn[] = [
    { key: 'step', header: '#', align: 'right', minWidth: 3 },
    { key: 'description', header: 'Description', minWidth: 20 },
    { key: 'command', header: 'Command', minWidth: 20 },
    { key: 'timeout', header: 'Timeout', align: 'right', minWidth: 8 },
    { key: 'rollback', header: 'Rollback', align: 'center', minWidth: 8 },
    { key: 'onError', header: 'On Error', minWidth: 8 },
  ];

  const rows = plan.steps.map((s: InstallStep, i: number) => ({
    step: String(i + 1),
    description: s.description,
    command: s.command,
    timeout: `${Math.round(s.timeout / 1000)}s`,
    rollback: s.canRollback ? 'Yes' : 'No',
    onError: s.onError,
  }));

  const parts: string[] = [];
  parts.push(chalk.bold('Install Plan') + '\n');
  parts.push(renderTable({ columns, rows }));

  // Summary line
  const totalTime = Math.round(plan.estimatedTime / 1000);
  parts.push(`Estimated time: ${totalTime}s | Steps: ${plan.steps.length}`);

  // Risks
  if (plan.risks.length > 0) {
    parts.push('\n' + chalk.bold('Risks:'));
    for (const risk of plan.risks) {
      const levelColor =
        risk.level === 'high' ? chalk.red : risk.level === 'medium' ? chalk.yellow : chalk.green;
      parts.push(`  ${levelColor(`[${risk.level}]`)} ${risk.description}`);
    }
  }

  return parts.join('\n') + '\n';
}
