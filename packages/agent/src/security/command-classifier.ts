/**
 * Command classifier module for ServerPilot Agent.
 *
 * Classifies shell commands into 5 risk levels as part of the
 * first layer of the five-layer defense-in-depth security model.
 *
 * Risk levels (from safest to most dangerous):
 * - GREEN:     Read-only commands, auto-executed
 * - YELLOW:    Installation commands, require user confirmation
 * - RED:       Modification commands, require confirmation + impact display
 * - CRITICAL:  Destructive commands, require confirmation + password + snapshot
 * - FORBIDDEN: Absolutely prohibited, never executed
 *
 * Classification algorithm:
 * 1. Check FORBIDDEN patterns first (highest priority)
 * 2. Check CRITICAL patterns
 * 3. Check GREEN patterns (read-only)
 * 4. Check YELLOW patterns (installation)
 * 5. Check RED patterns (modification)
 * 6. Unknown commands default to RED (fail-safe)
 *
 * @module security/command-classifier
 */

import { z } from 'zod';

// ============================================================================
// Risk Level Definition
// ============================================================================

/**
 * Risk level enum for command classification.
 *
 * Ordered from safest to most dangerous. Used throughout the security
 * pipeline to determine execution policy.
 */
export const RiskLevel = {
  GREEN: 'green',
  YELLOW: 'yellow',
  RED: 'red',
  CRITICAL: 'critical',
  FORBIDDEN: 'forbidden',
} as const;

export type RiskLevel = (typeof RiskLevel)[keyof typeof RiskLevel];

/** Zod schema for runtime validation of risk levels. */
export const RiskLevelSchema = z.enum(['green', 'yellow', 'red', 'critical', 'forbidden']);

// ============================================================================
// Classification Result
// ============================================================================

/** Result of classifying a command. */
export interface ClassificationResult {
  /** The original command string */
  command: string;
  /** Assigned risk level */
  riskLevel: RiskLevel;
  /** Human-readable reason for the classification */
  reason: string;
  /** The pattern that matched (for debugging/audit) */
  matchedPattern?: string;
}

/** Zod schema for ClassificationResult. */
export const ClassificationResultSchema = z.object({
  command: z.string(),
  riskLevel: RiskLevelSchema,
  reason: z.string(),
  matchedPattern: z.string().optional(),
});

// ============================================================================
// Pattern Rules
// ============================================================================

interface PatternRule {
  pattern: RegExp;
  reason: string;
}

/**
 * FORBIDDEN patterns — absolutely prohibited commands.
 * Checked first (highest priority).
 */
const FORBIDDEN_PATTERNS: PatternRule[] = [
  // Recursive deletion of root or entire filesystem
  { pattern: /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|(-[a-zA-Z]*f[a-zA-Z]*r))\s+\/(\s|$|\*)/, reason: 'Recursive deletion of root filesystem' },
  { pattern: /\brm\s+--no-preserve-root/, reason: 'Deletion with --no-preserve-root' },
  // Disk formatting
  { pattern: /\bmkfs\b/, reason: 'Disk formatting command' },
  { pattern: /\bfdisk\b/, reason: 'Disk partitioning command' },
  // Device overwriting
  { pattern: /\bdd\s+.*if=\/dev\/zero/, reason: 'Device overwriting with /dev/zero' },
  { pattern: /\bdd\s+.*of=\/dev\/sd/, reason: 'Direct writing to block device' },
  // Fork bomb
  { pattern: /:\(\)\s*\{[^}]*:\|:/, reason: 'Fork bomb detected' },
  { pattern: /\.\/fork_bomb|fork_bomb\.sh/, reason: 'Fork bomb script' },
  // Writing to block devices
  { pattern: />\s*\/dev\/sd[a-z]/, reason: 'Direct writing to block device' },
  // Recursive chmod 777 on root
  { pattern: /\bchmod\s+(-[a-zA-Z]*R[a-zA-Z]*\s+)?777\s+\/(\s|$)/, reason: 'Recursive chmod 777 on root' },
  // Destructive kernel/system operations
  { pattern: /\bsysctl\s+-w\s+kernel\.panic/, reason: 'Kernel panic manipulation' },
];

/**
 * CRITICAL patterns — destructive commands requiring confirmation + password + snapshot.
 */
const CRITICAL_PATTERNS: PatternRule[] = [
  // File deletion
  { pattern: /\brm\s+/, reason: 'File deletion command' },
  // Package removal
  { pattern: /\bapt\s+(remove|purge)\s/, reason: 'Package removal command' },
  { pattern: /\bapt-get\s+(remove|purge)\s/, reason: 'Package removal command' },
  { pattern: /\byum\s+(remove|erase)\s/, reason: 'Package removal command' },
  { pattern: /\bdnf\s+(remove|erase)\s/, reason: 'Package removal command' },
  // Container/image deletion
  { pattern: /\bdocker\s+(rm|rmi)\s/, reason: 'Docker container/image deletion' },
  { pattern: /\bdocker\s+container\s+rm\s/, reason: 'Docker container deletion' },
  { pattern: /\bdocker\s+image\s+rm\s/, reason: 'Docker image deletion' },
  { pattern: /\bdocker\s+system\s+prune/, reason: 'Docker system prune' },
  // Database destruction
  { pattern: /\bDROP\s+(DATABASE|TABLE|INDEX)\b/i, reason: 'Database/table deletion' },
  { pattern: /\bTRUNCATE\s+/i, reason: 'Table truncation' },
  { pattern: /\bDELETE\s+FROM\s+/i, reason: 'Data deletion query' },
  // Dangerous file operations
  { pattern: /\bmv\s+\/etc\//, reason: 'Moving system configuration files' },
  // User/group management
  { pattern: /\buserdel\s/, reason: 'User deletion' },
  { pattern: /\bgroupdel\s/, reason: 'Group deletion' },
];

/**
 * GREEN patterns — read-only commands, safe to auto-execute.
 */
const GREEN_PATTERNS: PatternRule[] = [
  // File listing and viewing
  { pattern: /^\s*ls(\s|$)/, reason: 'File listing (read-only)' },
  { pattern: /^\s*cat\s/, reason: 'File content display (read-only)' },
  { pattern: /^\s*head(\s|$)/, reason: 'File head display (read-only)' },
  { pattern: /^\s*tail(\s|$)/, reason: 'File tail display (read-only)' },
  { pattern: /^\s*less(\s|$)/, reason: 'File pager (read-only)' },
  { pattern: /^\s*more(\s|$)/, reason: 'File pager (read-only)' },
  { pattern: /^\s*wc(\s|$)/, reason: 'Word count (read-only)' },
  { pattern: /^\s*file(\s|$)/, reason: 'File type detection (read-only)' },
  { pattern: /^\s*stat(\s|$)/, reason: 'File statistics (read-only)' },
  // System information
  { pattern: /^\s*df(\s|$)/, reason: 'Disk space display (read-only)' },
  { pattern: /^\s*free(\s|$)/, reason: 'Memory usage display (read-only)' },
  { pattern: /^\s*top\b/, reason: 'Process monitoring (read-only)' },
  { pattern: /^\s*htop\b/, reason: 'Process monitoring (read-only)' },
  { pattern: /^\s*ps(\s|$)/, reason: 'Process list (read-only)' },
  { pattern: /^\s*uptime(\s|$)/, reason: 'System uptime (read-only)' },
  { pattern: /^\s*uname(\s|$)/, reason: 'System info (read-only)' },
  { pattern: /^\s*hostname(\s|$)/, reason: 'Hostname display (read-only)' },
  { pattern: /^\s*whoami(\s|$)/, reason: 'Current user (read-only)' },
  { pattern: /^\s*id(\s|$)/, reason: 'User identity (read-only)' },
  { pattern: /^\s*date(\s|$)/, reason: 'Date display (read-only)' },
  { pattern: /^\s*lsb_release(\s|$)/, reason: 'OS release info (read-only)' },
  // Network diagnostics
  { pattern: /^\s*ping(\s|$)/, reason: 'Network ping (read-only)' },
  { pattern: /^\s*traceroute(\s|$)/, reason: 'Network trace (read-only)' },
  { pattern: /^\s*dig(\s|$)/, reason: 'DNS query (read-only)' },
  { pattern: /^\s*nslookup(\s|$)/, reason: 'DNS lookup (read-only)' },
  { pattern: /^\s*netstat(\s|$)/, reason: 'Network statistics (read-only)' },
  { pattern: /^\s*ss(\s|$)/, reason: 'Socket statistics (read-only)' },
  { pattern: /^\s*ifconfig(\s|$)/, reason: 'Network interfaces (read-only)' },
  { pattern: /^\s*ip\s+(addr|link|route|neigh)\s*(show)?(\s|$)/, reason: 'Network info (read-only)' },
  // Service status queries
  { pattern: /^\s*systemctl\s+status(\s|$)/, reason: 'Service status query (read-only)' },
  { pattern: /^\s*systemctl\s+is-active(\s|$)/, reason: 'Service active check (read-only)' },
  { pattern: /^\s*systemctl\s+is-enabled(\s|$)/, reason: 'Service enabled check (read-only)' },
  { pattern: /^\s*systemctl\s+list-units(\s|$)/, reason: 'Service list (read-only)' },
  { pattern: /^\s*service\s+\S+\s+status(\s|$)/, reason: 'Service status query (read-only)' },
  // Docker read-only queries
  { pattern: /^\s*docker\s+ps(\s|$)/, reason: 'Docker container list (read-only)' },
  { pattern: /^\s*docker\s+images(\s|$)/, reason: 'Docker image list (read-only)' },
  { pattern: /^\s*docker\s+logs(\s|$)/, reason: 'Docker logs (read-only)' },
  { pattern: /^\s*docker\s+inspect(\s|$)/, reason: 'Docker inspect (read-only)' },
  { pattern: /^\s*docker\s+info(\s|$)/, reason: 'Docker info (read-only)' },
  { pattern: /^\s*docker\s+version(\s|$)/, reason: 'Docker version (read-only)' },
  { pattern: /^\s*docker\s+stats(\s|$)/, reason: 'Docker stats (read-only)' },
  // Nginx testing
  { pattern: /^\s*nginx\s+-t(\s|$)/, reason: 'Nginx config test (read-only)' },
  { pattern: /^\s*nginx\s+-T(\s|$)/, reason: 'Nginx config dump (read-only)' },
  // Search/find (read-only)
  { pattern: /^\s*find\s/, reason: 'File search (read-only)' },
  { pattern: /^\s*grep(\s|$)/, reason: 'Text search (read-only)' },
  { pattern: /^\s*which(\s|$)/, reason: 'Command lookup (read-only)' },
  { pattern: /^\s*whereis(\s|$)/, reason: 'Command lookup (read-only)' },
  { pattern: /^\s*locate(\s|$)/, reason: 'File search (read-only)' },
  // Version checks
  { pattern: /^\s*\S+\s+--version(\s|$)/, reason: 'Version check (read-only)' },
  { pattern: /^\s*\S+\s+-v(\s|$)/, reason: 'Version check (read-only)' },
  { pattern: /^\s*\S+\s+-V(\s|$)/, reason: 'Version check (read-only)' },
  { pattern: /^\s*node\s+--version/, reason: 'Node.js version (read-only)' },
  // Environment
  { pattern: /^\s*printenv(\s|$)/, reason: 'Environment variables (read-only)' },
  { pattern: /^\s*env(\s|$)/, reason: 'Environment variables (read-only)' },
  { pattern: /^\s*echo(\s|$)/, reason: 'Echo output (read-only)' },
  // Package query
  { pattern: /^\s*apt\s+list(\s|$)/, reason: 'Package list (read-only)' },
  { pattern: /^\s*apt\s+show(\s|$)/, reason: 'Package info (read-only)' },
  { pattern: /^\s*apt\s+search(\s|$)/, reason: 'Package search (read-only)' },
  { pattern: /^\s*dpkg\s+-l(\s|$)/, reason: 'Package list (read-only)' },
  { pattern: /^\s*dpkg\s+--list(\s|$)/, reason: 'Package list (read-only)' },
  { pattern: /^\s*rpm\s+-q/, reason: 'Package query (read-only)' },
  // Disk / mount info
  { pattern: /^\s*lsblk(\s|$)/, reason: 'Block device list (read-only)' },
  { pattern: /^\s*mount(\s|$)/, reason: 'Mount points display (read-only)' },
  { pattern: /^\s*du(\s|$)/, reason: 'Disk usage (read-only)' },
];

/**
 * YELLOW patterns — installation/download commands, need user confirmation.
 */
const YELLOW_PATTERNS: PatternRule[] = [
  // System package installation
  { pattern: /\bapt\s+install\s/, reason: 'Package installation (apt)' },
  { pattern: /\bapt-get\s+install\s/, reason: 'Package installation (apt-get)' },
  { pattern: /\bapt\s+update(\s|$)/, reason: 'Package index update (apt)' },
  { pattern: /\bapt-get\s+update(\s|$)/, reason: 'Package index update (apt-get)' },
  { pattern: /\bapt\s+upgrade(\s|$)/, reason: 'Package upgrade (apt)' },
  { pattern: /\bapt-get\s+upgrade(\s|$)/, reason: 'Package upgrade (apt-get)' },
  { pattern: /\byum\s+install\s/, reason: 'Package installation (yum)' },
  { pattern: /\bdnf\s+install\s/, reason: 'Package installation (dnf)' },
  { pattern: /\bpacman\s+-S(\s|$)/, reason: 'Package installation (pacman)' },
  // Node.js package managers
  { pattern: /\bnpm\s+install(\s|$)/, reason: 'NPM package installation' },
  { pattern: /\bnpm\s+i(\s|$)/, reason: 'NPM package installation' },
  { pattern: /\bnpm\s+ci(\s|$)/, reason: 'NPM clean install' },
  { pattern: /\bpnpm\s+(install|add)(\s|$)/, reason: 'PNPM package installation' },
  { pattern: /\byarn\s+(install|add)(\s|$)/, reason: 'Yarn package installation' },
  // Python
  { pattern: /\bpip\s+install\s/, reason: 'Python package installation' },
  { pattern: /\bpip3\s+install\s/, reason: 'Python package installation' },
  // Docker pull
  { pattern: /\bdocker\s+pull\s/, reason: 'Docker image download' },
  { pattern: /\bdocker\s+compose\s+pull(\s|$)/, reason: 'Docker Compose image pull' },
  // Git clone
  { pattern: /\bgit\s+clone\s/, reason: 'Repository cloning' },
  // Downloads
  { pattern: /\bcurl\s+/, reason: 'URL download (curl)' },
  { pattern: /\bwget\s+/, reason: 'URL download (wget)' },
  // Archive extraction
  { pattern: /\btar\s+.*x/, reason: 'Archive extraction' },
  { pattern: /\bunzip\s/, reason: 'Archive extraction' },
  // Build commands
  { pattern: /\bmake(\s|$)/, reason: 'Build command (make)' },
  { pattern: /\bnpm\s+run\s+build(\s|$)/, reason: 'Build command (npm)' },
  { pattern: /\bpnpm\s+build(\s|$)/, reason: 'Build command (pnpm)' },
  // Docker build
  { pattern: /\bdocker\s+build\s/, reason: 'Docker image build' },
  { pattern: /\bdocker\s+compose\s+build(\s|$)/, reason: 'Docker Compose build' },
];

/**
 * RED patterns — modification commands, need confirmation + impact display.
 */
const RED_PATTERNS: PatternRule[] = [
  // Service management
  { pattern: /\bsystemctl\s+(restart|stop|start|reload|enable|disable)\s/, reason: 'Service management command' },
  { pattern: /\bservice\s+\S+\s+(restart|stop|start|reload)(\s|$)/, reason: 'Service management command' },
  // Nginx reload/restart
  { pattern: /\bnginx\s+-s\s+(reload|stop|quit|reopen)/, reason: 'Nginx signal command' },
  // Docker container management
  { pattern: /\bdocker\s+(stop|restart|start|kill)\s/, reason: 'Docker container management' },
  { pattern: /\bdocker\s+compose\s+(up|down|restart|stop|start)(\s|$)/, reason: 'Docker Compose management' },
  // Permission changes
  { pattern: /\bchmod\s/, reason: 'File permission change' },
  { pattern: /\bchown\s/, reason: 'File ownership change' },
  // File editing/creation
  { pattern: /\bsed\s+-i/, reason: 'In-place file editing' },
  { pattern: /\btee\s/, reason: 'File writing via tee' },
  // Configuration editing
  { pattern: /\bcp\s/, reason: 'File copy operation' },
  { pattern: /\bmv\s/, reason: 'File move/rename operation' },
  { pattern: /\bmkdir\s/, reason: 'Directory creation' },
  // Git operations that modify state
  { pattern: /\bgit\s+(push|commit|merge|rebase|reset|checkout)(\s|$)/, reason: 'Git state modification' },
  // Cron management
  { pattern: /\bcrontab\s/, reason: 'Crontab modification' },
  // Firewall changes
  { pattern: /\bufw\s+(allow|deny|delete|enable|disable)/, reason: 'Firewall rule modification' },
  { pattern: /\biptables\s/, reason: 'Firewall rule modification' },
  // Network configuration
  { pattern: /\bip\s+(addr|link|route)\s+(add|del|change)/, reason: 'Network configuration change' },
];

// ============================================================================
// Classifier Implementation
// ============================================================================

/**
 * Parse a raw command string into its base command and full text.
 *
 * Strips leading `sudo` prefix and trims whitespace.
 */
function normalizeCommand(raw: string): string {
  let cmd = raw.trim();

  // Strip sudo prefix for classification purposes
  // The risk level is about what the command does, not how it's invoked
  // Handles: sudo, sudo -E, sudo -u root, sudo --user=root, etc.
  // sudo flags that require a separate argument value
  const SUDO_FLAGS_WITH_ARG = new Set(['u', 'g', 'C', 'D', 'R', 'T', 'U', 'h', 'p', 'r', 't']);

  if (/^\s*sudo\b/.test(cmd)) {
    cmd = cmd.replace(/^\s*sudo\s+/, '');
    while (/^-/.test(cmd)) {
      // Long option: --user=root or --preserve-env
      const longMatch = cmd.match(/^--\S+\s*/);
      if (longMatch) {
        cmd = cmd.slice(longMatch[0].length);
        continue;
      }
      // Short option(s): -E, -u root, -Eu root
      const shortMatch = cmd.match(/^-([a-zA-Z]+)\s*/);
      if (shortMatch) {
        const flags = shortMatch[1];
        cmd = cmd.slice(shortMatch[0].length);
        // If the last flag in the group takes an argument, consume the next word
        const lastFlag = flags[flags.length - 1];
        if (SUDO_FLAGS_WITH_ARG.has(lastFlag) && cmd.length > 0 && !cmd.startsWith('-')) {
          cmd = cmd.replace(/^\S+\s*/, '');
        }
        continue;
      }
      break;
    }
  }

  return cmd.trim();
}

/**
 * Match a command against a list of pattern rules.
 *
 * @returns The first matching rule, or undefined if no match
 */
function matchPatterns(command: string, patterns: PatternRule[]): PatternRule | undefined {
  return patterns.find((rule) => rule.pattern.test(command));
}

/**
 * Classify a command string into a risk level.
 *
 * Applies the five-level classification system defined in the
 * ServerPilot security architecture. Commands are checked against
 * pattern lists in priority order: FORBIDDEN → CRITICAL → GREEN →
 * YELLOW → RED. Unknown commands default to RED (fail-safe).
 *
 * @param command - The raw command string to classify
 * @returns The classification result including risk level and reason
 *
 * @example
 * ```ts
 * const result = classifyCommand('ls -la');
 * // { command: 'ls -la', riskLevel: 'green', reason: 'File listing (read-only)' }
 *
 * const result2 = classifyCommand('rm -rf /');
 * // { command: 'rm -rf /', riskLevel: 'forbidden', reason: 'Recursive deletion of root filesystem' }
 * ```
 */
export function classifyCommand(command: string): ClassificationResult {
  if (!command || command.trim().length === 0) {
    return {
      command,
      riskLevel: RiskLevel.FORBIDDEN,
      reason: 'Empty command is not allowed',
    };
  }

  const normalized = normalizeCommand(command);

  // 1. Check FORBIDDEN first (highest priority, most dangerous)
  const forbidden = matchPatterns(normalized, FORBIDDEN_PATTERNS);
  if (forbidden) {
    return {
      command,
      riskLevel: RiskLevel.FORBIDDEN,
      reason: forbidden.reason,
      matchedPattern: forbidden.pattern.source,
    };
  }

  // 2. Check CRITICAL (destructive operations)
  const critical = matchPatterns(normalized, CRITICAL_PATTERNS);
  if (critical) {
    return {
      command,
      riskLevel: RiskLevel.CRITICAL,
      reason: critical.reason,
      matchedPattern: critical.pattern.source,
    };
  }

  // 3. Check GREEN (read-only, safe)
  const green = matchPatterns(normalized, GREEN_PATTERNS);
  if (green) {
    return {
      command,
      riskLevel: RiskLevel.GREEN,
      reason: green.reason,
      matchedPattern: green.pattern.source,
    };
  }

  // 4. Check YELLOW (installation)
  const yellow = matchPatterns(normalized, YELLOW_PATTERNS);
  if (yellow) {
    return {
      command,
      riskLevel: RiskLevel.YELLOW,
      reason: yellow.reason,
      matchedPattern: yellow.pattern.source,
    };
  }

  // 5. Check RED (modification)
  const red = matchPatterns(normalized, RED_PATTERNS);
  if (red) {
    return {
      command,
      riskLevel: RiskLevel.RED,
      reason: red.reason,
      matchedPattern: red.pattern.source,
    };
  }

  // 6. Default to RED for unknown commands (fail-safe principle)
  return {
    command,
    riskLevel: RiskLevel.RED,
    reason: 'Unknown command — classified as RED by default (fail-safe)',
  };
}

/**
 * Check whether a risk level requires user confirmation before execution.
 *
 * GREEN commands auto-execute; all others require some form of confirmation.
 */
export function requiresConfirmation(riskLevel: RiskLevel): boolean {
  return riskLevel !== RiskLevel.GREEN;
}

/**
 * Check whether a risk level requires creating a snapshot before execution.
 *
 * Only CRITICAL commands require pre-execution snapshots.
 */
export function requiresSnapshot(riskLevel: RiskLevel): boolean {
  return riskLevel === RiskLevel.CRITICAL;
}

/**
 * Check whether a command is absolutely forbidden from execution.
 */
export function isForbidden(riskLevel: RiskLevel): boolean {
  return riskLevel === RiskLevel.FORBIDDEN;
}

/**
 * Compare two risk levels. Returns a positive number if `a` is riskier than `b`,
 * negative if less risky, and 0 if equal.
 */
export function compareRiskLevels(a: RiskLevel, b: RiskLevel): number {
  const order: Record<RiskLevel, number> = {
    [RiskLevel.GREEN]: 0,
    [RiskLevel.YELLOW]: 1,
    [RiskLevel.RED]: 2,
    [RiskLevel.CRITICAL]: 3,
    [RiskLevel.FORBIDDEN]: 4,
  };
  return order[a] - order[b];
}

/**
 * Get a human-readable description of the execution policy for a risk level.
 */
export function getExecutionPolicy(riskLevel: RiskLevel): string {
  const policies: Record<RiskLevel, string> = {
    [RiskLevel.GREEN]: 'Auto-execute (read-only)',
    [RiskLevel.YELLOW]: 'Requires user confirmation',
    [RiskLevel.RED]: 'Requires user confirmation + impact display',
    [RiskLevel.CRITICAL]: 'Requires user confirmation + password + pre-execution snapshot',
    [RiskLevel.FORBIDDEN]: 'Absolutely prohibited — will not execute',
  };
  return policies[riskLevel];
}
