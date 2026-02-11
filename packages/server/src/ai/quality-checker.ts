// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * AI quality checker module for ServerPilot.
 *
 * Validates AI-generated installation plans before execution by performing
 * five checks: command existence, package name validation, risk level
 * verification, forbidden command detection, and platform compatibility.
 *
 * This module acts as a safety gate between plan generation and execution,
 * catching potential issues before they affect the target system.
 *
 * @module ai/quality-checker
 */

import { z } from 'zod';
import type { InstallPlan, InstallStep, EnvironmentInfo } from '@aiinstaller/shared';

// ============================================================================
// Types
// ============================================================================

/** Risk level constants matching the agent's command classifier */
export const RiskLevel = {
  GREEN: 'green',
  YELLOW: 'yellow',
  RED: 'red',
  CRITICAL: 'critical',
  FORBIDDEN: 'forbidden',
} as const;

export type RiskLevel = (typeof RiskLevel)[keyof typeof RiskLevel];

/** Result returned by a command classifier */
export interface ClassificationResult {
  command: string;
  riskLevel: RiskLevel;
  reason: string;
  matchedPattern?: string;
}

/** Function type for classifying commands into risk levels */
export type CommandClassifierFn = (command: string) => ClassificationResult;

/** Severity of a quality issue */
export type IssueSeverity = 'warning' | 'error';

/** Types of quality issues that can be detected */
export type QualityIssueType =
  | 'command_not_found'
  | 'package_not_found'
  | 'risk_mismatch'
  | 'forbidden_command'
  | 'platform_incompatible';

/** A single quality issue found during plan validation */
export interface QualityIssue {
  type: QualityIssueType;
  severity: IssueSeverity;
  message: string;
  stepId?: string;
}

/** Result of a quality check on an installation plan */
export interface QualityCheckResult {
  passed: boolean;
  issues: QualityIssue[];
  suggestions: string[];
}

/** Zod schema for QualityIssue */
export const QualityIssueSchema = z.object({
  type: z.enum([
    'command_not_found',
    'package_not_found',
    'risk_mismatch',
    'forbidden_command',
    'platform_incompatible',
  ]),
  severity: z.enum(['warning', 'error']),
  message: z.string(),
  stepId: z.string().optional(),
});

/** Zod schema for QualityCheckResult */
export const QualityCheckResultSchema = z.object({
  passed: z.boolean(),
  issues: z.array(QualityIssueSchema),
  suggestions: z.array(z.string()),
});

// ============================================================================
// Known Commands by Platform
// ============================================================================

/** Commands commonly available on Linux (Debian/Ubuntu) */
const DEBIAN_COMMANDS = new Set([
  'apt', 'apt-get', 'dpkg', 'systemctl', 'service',
  'ufw', 'nginx', 'curl', 'wget', 'tar', 'unzip',
  'git', 'make', 'gcc', 'node', 'npm', 'python3', 'pip3',
  'docker', 'ssh', 'scp', 'rsync', 'crontab', 'chmod',
  'chown', 'cp', 'mv', 'mkdir', 'rm', 'ls', 'cat',
  'grep', 'find', 'sed', 'awk', 'tee', 'echo',
  'df', 'free', 'ps', 'top', 'htop', 'kill',
  'ip', 'ss', 'netstat', 'ping', 'dig', 'nslookup',
  'openssl', 'certbot', 'snap',
]);

/** Commands commonly available on macOS */
const DARWIN_COMMANDS = new Set([
  'brew', 'port', 'curl', 'wget', 'tar', 'unzip',
  'git', 'make', 'node', 'npm', 'python3', 'pip3',
  'docker', 'ssh', 'scp', 'rsync', 'crontab', 'chmod',
  'chown', 'cp', 'mv', 'mkdir', 'rm', 'ls', 'cat',
  'grep', 'find', 'sed', 'awk', 'tee', 'echo',
  'df', 'ps', 'top', 'kill', 'launchctl',
  'ifconfig', 'netstat', 'ping', 'dig', 'nslookup',
  'openssl', 'xcode-select', 'xcodebuild',
  'pnpm', 'yarn',
]);

/** Package manager -> platform mapping for compatibility checks */
const PACKAGE_MANAGER_PLATFORM: Record<string, string[]> = {
  apt: ['linux'],
  'apt-get': ['linux'],
  yum: ['linux'],
  dnf: ['linux'],
  pacman: ['linux'],
  brew: ['darwin'],
  port: ['darwin'],
};

/** Platform-specific package manager suggestions */
const PLATFORM_PM_SUGGESTIONS: Record<string, Record<string, string>> = {
  darwin: {
    apt: 'Use "brew install" instead of "apt install" on macOS',
    'apt-get': 'Use "brew install" instead of "apt-get install" on macOS',
    yum: 'Use "brew install" instead of "yum install" on macOS',
    dnf: 'Use "brew install" instead of "dnf install" on macOS',
  },
  linux: {
    brew: 'Use "apt install" instead of "brew install" on Debian/Ubuntu Linux',
  },
};

// ============================================================================
// Well-known Package Names
// ============================================================================

/** Well-known apt package names for offline validation. */
const WELL_KNOWN_APT_PACKAGES = new Set([
  'nginx', 'apache2', 'mysql-server', 'postgresql', 'redis-server',
  'docker.io', 'docker-ce', 'git', 'curl', 'wget', 'vim', 'nano',
  'build-essential', 'python3', 'python3-pip', 'nodejs', 'npm',
  'certbot', 'ufw', 'fail2ban', 'htop', 'net-tools', 'unzip',
  'zip', 'tar', 'openssh-server', 'rsync', 'cron', 'sudo',
  'ca-certificates', 'gnupg', 'lsb-release', 'software-properties-common',
  'apt-transport-https', 'libssl-dev', 'libffi-dev', 'python3-dev',
  'gcc', 'g++', 'make', 'pkg-config', 'jq', 'tree',
  'mongodb-org', 'elasticsearch', 'rabbitmq-server', 'memcached',
]);

// ============================================================================
// Default Classifier (lightweight, server-side only)
// ============================================================================

/**
 * Default command classifier used when no external classifier is provided.
 * Mirrors the agent's classifier patterns for forbidden and critical commands.
 */
function defaultClassifyCommand(command: string): ClassificationResult {
  const normalized = command.trim().replace(/^\s*sudo\s+(-\S+\s+)*/, '');

  // Forbidden patterns
  const forbiddenPatterns: Array<[RegExp, string]> = [
    [/\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|(-[a-zA-Z]*f[a-zA-Z]*r))\s+\/(\s|$|\*)/, 'Recursive deletion of root filesystem'],
    [/\brm\s+--no-preserve-root/, 'Deletion with --no-preserve-root'],
    [/\bmkfs\b/, 'Disk formatting command'],
    [/\bfdisk\b/, 'Disk partitioning command'],
    [/\bdd\s+.*if=\/dev\/zero/, 'Device overwriting with /dev/zero'],
    [/\bdd\s+.*of=\/dev\/sd/, 'Direct writing to block device'],
    [/:\(\)\s*\{[^}]*:\|:/, 'Fork bomb detected'],
    [/>\s*\/dev\/sd[a-z]/, 'Direct writing to block device'],
    [/\bchmod\s+(-[a-zA-Z]*R[a-zA-Z]*\s+)?777\s+\/(\s|$)/, 'Recursive chmod 777 on root'],
    [/\bsysctl\s+-w\s+kernel\.panic/, 'Kernel panic manipulation'],
  ];

  for (const [pattern, reason] of forbiddenPatterns) {
    if (pattern.test(normalized)) {
      return { command, riskLevel: RiskLevel.FORBIDDEN, reason };
    }
  }

  // Critical patterns
  const criticalPatterns: Array<[RegExp, string]> = [
    [/\brm\s+/, 'File deletion command'],
    [/\bapt\s+(remove|purge)\s/, 'Package removal command'],
    [/\bapt-get\s+(remove|purge)\s/, 'Package removal command'],
    [/\byum\s+(remove|erase)\s/, 'Package removal command'],
    [/\bdnf\s+(remove|erase)\s/, 'Package removal command'],
    [/\bdocker\s+(rm|rmi)\s/, 'Docker container/image deletion'],
    [/\bdocker\s+system\s+prune/, 'Docker system prune'],
    [/\bDROP\s+(DATABASE|TABLE)\b/i, 'Database/table deletion'],
    [/\bTRUNCATE\s+/i, 'Table truncation'],
    [/\bDELETE\s+FROM\s+/i, 'Data deletion query'],
    [/\buserdel\s/, 'User deletion'],
    [/\bgroupdel\s/, 'Group deletion'],
  ];

  for (const [pattern, reason] of criticalPatterns) {
    if (pattern.test(normalized)) {
      return { command, riskLevel: RiskLevel.CRITICAL, reason };
    }
  }

  // Green patterns (read-only)
  const greenPatterns: Array<[RegExp, string]> = [
    [/^\s*ls(\s|$)/, 'File listing (read-only)'],
    [/^\s*cat\s/, 'File content display (read-only)'],
    [/^\s*df(\s|$)/, 'Disk space display (read-only)'],
    [/^\s*free(\s|$)/, 'Memory usage display (read-only)'],
    [/^\s*ps(\s|$)/, 'Process list (read-only)'],
    [/^\s*\S+\s+--version(\s|$)/, 'Version check (read-only)'],
    [/^\s*echo(\s|$)/, 'Echo output (read-only)'],
    [/^\s*which(\s|$)/, 'Command lookup (read-only)'],
  ];

  for (const [pattern, reason] of greenPatterns) {
    if (pattern.test(normalized)) {
      return { command, riskLevel: RiskLevel.GREEN, reason };
    }
  }

  // Yellow patterns (installation)
  const yellowPatterns: Array<[RegExp, string]> = [
    [/\bapt\s+install\s/, 'Package installation (apt)'],
    [/\bapt-get\s+install\s/, 'Package installation (apt-get)'],
    [/\bapt\s+update(\s|$)/, 'Package index update (apt)'],
    [/\byum\s+install\s/, 'Package installation (yum)'],
    [/\bdnf\s+install\s/, 'Package installation (dnf)'],
    [/\bnpm\s+install(\s|$)/, 'NPM package installation'],
    [/\bpnpm\s+(install|add)(\s|$)/, 'PNPM package installation'],
    [/\bcurl\s+/, 'URL download (curl)'],
    [/\bwget\s+/, 'URL download (wget)'],
    [/\bgit\s+clone\s/, 'Repository cloning'],
    [/\bdocker\s+pull\s/, 'Docker image download'],
    [/\bmake(\s|$)/, 'Build command (make)'],
  ];

  for (const [pattern, reason] of yellowPatterns) {
    if (pattern.test(normalized)) {
      return { command, riskLevel: RiskLevel.YELLOW, reason };
    }
  }

  // Red patterns (modification)
  const redPatterns: Array<[RegExp, string]> = [
    [/\bsystemctl\s+(restart|stop|start|reload|enable|disable)\s/, 'Service management command'],
    [/\bchmod\s/, 'File permission change'],
    [/\bchown\s/, 'File ownership change'],
    [/\bsed\s+-i/, 'In-place file editing'],
    [/\bcp\s/, 'File copy operation'],
    [/\bmv\s/, 'File move/rename operation'],
    [/\bmkdir\s/, 'Directory creation'],
  ];

  for (const [pattern, reason] of redPatterns) {
    if (pattern.test(normalized)) {
      return { command, riskLevel: RiskLevel.RED, reason };
    }
  }

  // Default to RED (fail-safe)
  return {
    command,
    riskLevel: RiskLevel.RED,
    reason: 'Unknown command — classified as RED by default (fail-safe)',
  };
}

// ============================================================================
// Quality Checker Class
// ============================================================================

/**
 * Validates AI-generated installation plans before execution.
 *
 * Performs five types of checks:
 * 1. Command existence — verifies commands exist on the target platform
 * 2. Package name validation — validates package names for known managers
 * 3. Risk level verification — ensures classified risk matches expectations
 * 4. Forbidden command detection — blocks prohibited commands
 * 5. Platform compatibility — detects package manager / platform mismatches
 */
export class AIQualityChecker {
  private classifyCommand: CommandClassifierFn;

  constructor(classifyCommand?: CommandClassifierFn) {
    this.classifyCommand = classifyCommand ?? defaultClassifyCommand;
  }

  /**
   * Check an installation plan for quality issues.
   *
   * @param plan - The AI-generated installation plan to validate
   * @param environment - The target system's environment information
   * @returns Quality check result with issues and suggestions
   */
  checkPlan(plan: InstallPlan, environment: EnvironmentInfo): QualityCheckResult {
    const issues: QualityIssue[] = [];
    const suggestions: string[] = [];

    for (const step of plan.steps) {
      this.checkCommandExists(step, environment, issues);
      this.checkPackageNames(step, issues);
      this.checkRiskLevel(step, issues);
      this.checkForbiddenCommand(step, issues);
    }

    this.checkPlatformCompatibility(plan, environment, issues, suggestions);

    return {
      passed: !issues.some((i) => i.severity === 'error'),
      issues,
      suggestions,
    };
  }

  // --------------------------------------------------------------------------
  // Check 1: Command Existence
  // --------------------------------------------------------------------------

  private checkCommandExists(
    step: InstallStep,
    environment: EnvironmentInfo,
    issues: QualityIssue[],
  ): void {
    const baseCommand = this.extractBaseCommand(step.command);
    if (!baseCommand) return;

    const knownCommands = this.getKnownCommands(environment);
    if (knownCommands.size === 0) return;

    const availableFromEnv = this.getCommandsFromEnvironment(environment);

    if (!knownCommands.has(baseCommand) && !availableFromEnv.has(baseCommand)) {
      issues.push({
        type: 'command_not_found',
        severity: 'error',
        message: `Command "${baseCommand}" may not exist on the target system (${environment.os.platform})`,
        stepId: step.id,
      });
    }
  }

  // --------------------------------------------------------------------------
  // Check 2: Package Name Validation
  // --------------------------------------------------------------------------

  private checkPackageNames(step: InstallStep, issues: QualityIssue[]): void {
    const packages = this.extractPackages(step.command);
    if (packages.length === 0) return;

    const manager = this.detectPackageManager(step.command);

    for (const pkg of packages) {
      if (!this.isKnownPackage(pkg, manager)) {
        issues.push({
          type: 'package_not_found',
          severity: 'warning',
          message: `Package "${pkg}" may not exist in ${manager} — please verify`,
          stepId: step.id,
        });
      }
    }
  }

  // --------------------------------------------------------------------------
  // Check 3: Risk Level Verification
  // --------------------------------------------------------------------------

  private checkRiskLevel(step: InstallStep, issues: QualityIssue[]): void {
    const classification = this.classifyCommand(step.command);

    if (classification.riskLevel === RiskLevel.CRITICAL) {
      issues.push({
        type: 'risk_mismatch',
        severity: 'warning',
        message: `Step "${step.description}" contains a CRITICAL risk command: ${classification.reason}`,
        stepId: step.id,
      });
    }
  }

  // --------------------------------------------------------------------------
  // Check 4: Forbidden Command Detection
  // --------------------------------------------------------------------------

  private checkForbiddenCommand(step: InstallStep, issues: QualityIssue[]): void {
    const classification = this.classifyCommand(step.command);

    if (classification.riskLevel === RiskLevel.FORBIDDEN) {
      issues.push({
        type: 'forbidden_command',
        severity: 'error',
        message: `Step "${step.description}" contains a forbidden command: ${classification.reason}`,
        stepId: step.id,
      });
    }
  }

  // --------------------------------------------------------------------------
  // Check 5: Platform Compatibility
  // --------------------------------------------------------------------------

  private checkPlatformCompatibility(
    plan: InstallPlan,
    environment: EnvironmentInfo,
    issues: QualityIssue[],
    suggestions: string[],
  ): void {
    const platform = environment.os.platform;

    for (const step of plan.steps) {
      const pm = this.detectPackageManagerFromCommand(step.command);
      if (!pm) continue;

      const supportedPlatforms = PACKAGE_MANAGER_PLATFORM[pm];
      if (!supportedPlatforms) continue;

      if (!supportedPlatforms.includes(platform)) {
        issues.push({
          type: 'platform_incompatible',
          severity: 'error',
          message: `Package manager "${pm}" is not available on ${platform}`,
          stepId: step.id,
        });

        const suggestion = PLATFORM_PM_SUGGESTIONS[platform]?.[pm];
        if (suggestion && !suggestions.includes(suggestion)) {
          suggestions.push(suggestion);
        }
      }
    }

    this.checkRedHatOnDebian(plan, environment, suggestions);
  }

  private checkRedHatOnDebian(
    plan: InstallPlan,
    environment: EnvironmentInfo,
    suggestions: string[],
  ): void {
    if (environment.os.platform !== 'linux') return;

    const hasApt = environment.packageManagers.apt !== undefined;
    if (!hasApt) return;

    const hasYum = plan.steps.some((s) => /\byum\b/.test(s.command));
    const hasDnf = plan.steps.some((s) => /\bdnf\b/.test(s.command));

    if (hasYum) {
      const msg = 'Detected yum command but the target system uses apt — use apt instead';
      if (!suggestions.includes(msg)) suggestions.push(msg);
    }
    if (hasDnf) {
      const msg = 'Detected dnf command but the target system uses apt — use apt instead';
      if (!suggestions.includes(msg)) suggestions.push(msg);
    }
  }

  // --------------------------------------------------------------------------
  // Utility Methods (public for testing)
  // --------------------------------------------------------------------------

  /** Extract the base command (first word) from a command string. */
  extractBaseCommand(command: string): string | null {
    const trimmed = command.trim();
    if (!trimmed) return null;

    let cmd = trimmed;
    if (/^\s*sudo\s+/.test(cmd)) {
      cmd = cmd.replace(/^\s*sudo\s+(-\S+\s+)*/, '');
    }

    const match = cmd.match(/^(\S+)/);
    return match ? match[1] : null;
  }

  /** Extract package names from install commands. */
  extractPackages(command: string): string[] {
    const aptMatch = command.match(/\b(?:apt|apt-get)\s+install\s+(-[yq]\s+)*(.+)/);
    if (aptMatch) {
      return aptMatch[2].split(/\s+/).filter((p) => p && !p.startsWith('-'));
    }

    const yumMatch = command.match(/\b(?:yum|dnf)\s+install\s+(-y\s+)*(.+)/);
    if (yumMatch) {
      return yumMatch[2].split(/\s+/).filter((p) => p && !p.startsWith('-'));
    }

    return [];
  }

  private detectPackageManager(command: string): string {
    if (/\bapt-get\b/.test(command)) return 'apt';
    if (/\bapt\b/.test(command)) return 'apt';
    if (/\byum\b/.test(command)) return 'yum';
    if (/\bdnf\b/.test(command)) return 'dnf';
    if (/\bpacman\b/.test(command)) return 'pacman';
    if (/\bbrew\b/.test(command)) return 'brew';
    if (/\bnpm\b/.test(command)) return 'npm';
    if (/\bpip3?\b/.test(command)) return 'pip';
    return 'unknown';
  }

  private detectPackageManagerFromCommand(command: string): string | null {
    const pmPatterns: Array<[RegExp, string]> = [
      [/\bapt\s+(install|update|upgrade)\b/, 'apt'],
      [/\bapt-get\s+(install|update|upgrade)\b/, 'apt-get'],
      [/\byum\s+(install|update)\b/, 'yum'],
      [/\bdnf\s+(install|update)\b/, 'dnf'],
      [/\bpacman\s+-S\b/, 'pacman'],
      [/\bbrew\s+(install|update|upgrade)\b/, 'brew'],
    ];

    for (const [pattern, pm] of pmPatterns) {
      if (pattern.test(command)) return pm;
    }

    return null;
  }

  private isKnownPackage(pkg: string, manager: string): boolean {
    if (manager === 'apt') {
      return WELL_KNOWN_APT_PACKAGES.has(pkg);
    }
    return true;
  }

  private getKnownCommands(environment: EnvironmentInfo): Set<string> {
    switch (environment.os.platform) {
      case 'linux':
        return DEBIAN_COMMANDS;
      case 'darwin':
        return DARWIN_COMMANDS;
      default:
        return new Set();
    }
  }

  private getCommandsFromEnvironment(environment: EnvironmentInfo): Set<string> {
    const commands = new Set<string>();
    if (environment.packageManagers.npm) commands.add('npm');
    if (environment.packageManagers.pnpm) commands.add('pnpm');
    if (environment.packageManagers.yarn) commands.add('yarn');
    if (environment.packageManagers.brew) commands.add('brew');
    if (environment.packageManagers.apt) commands.add('apt');
    if (environment.runtime.node) commands.add('node');
    if (environment.runtime.python) commands.add('python3');
    return commands;
  }
}
