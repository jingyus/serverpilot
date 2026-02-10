/**
 * Common error rules library for AI Installer.
 *
 * Provides a comprehensive catalogue of common installation errors across
 * different software and package managers, with predefined fix strategies.
 * This allows fast, offline error resolution without consuming AI tokens.
 *
 * The rule-based approach complements AI-powered diagnosis:
 * 1. First, check if error matches a known pattern in this library
 * 2. If matched with high confidence, return predefined fix strategies
 * 3. If not matched or low confidence, fall back to AI diagnosis
 *
 * @module ai/common-errors
 */

import type { ErrorContext, FixStrategy } from '@aiinstaller/shared';
import type { ErrorType } from './error-analyzer.js';

// ============================================================================
// Types
// ============================================================================

/**
 * A predefined error pattern with fix strategies.
 *
 * Each rule defines:
 * - A pattern to match against error output
 * - The error type classification
 * - One or more fix strategies with confidence scores
 */
export interface ErrorRule {
  /** Unique identifier for this rule */
  id: string;
  /** Regex pattern to match against stderr/stdout */
  pattern: RegExp;
  /** The error type this rule identifies */
  type: ErrorType;
  /** Human-readable description of the error */
  description: string;
  /** Fix strategies for this error, ordered by confidence (highest first) */
  fixStrategies: FixStrategy[];
  /** Priority of this rule (higher priority rules are checked first) */
  priority: number;
}

/**
 * Result of matching error output against the rule library.
 */
export interface ErrorMatch {
  /** The matched rule */
  rule: ErrorRule;
  /** Confidence score for this match (0.0 - 1.0) */
  confidence: number;
  /** Fix strategies from the rule (already sorted by confidence) */
  fixStrategies: FixStrategy[];
}

// ============================================================================
// Common Error Rules
// ============================================================================

/**
 * Comprehensive library of common error rules.
 *
 * Rules are organized by error type and priority. Higher priority rules
 * are more specific and should be checked first.
 *
 * Priority levels:
 * - 100: Critical, highly specific patterns (exact error codes)
 * - 80: High priority, specific patterns
 * - 60: Medium priority, moderately specific
 * - 40: Low priority, generic patterns
 */
export const ERROR_RULES: readonly ErrorRule[] = [
  // ========================================================================
  // Permission Errors (Priority: 100-40)
  // ========================================================================
  {
    id: 'eacces-permission-denied',
    pattern: /EACCES:\s*permission denied/i,
    type: 'permission',
    description: 'File system permission denied - no access to create or modify files',
    priority: 100,
    fixStrategies: [
      {
        description: 'Run the command with sudo/administrator privileges',
        commands: ['sudo <original-command>'],
        confidence: 0.8,
        estimatedTime: 60,
        requiresSudo: true,
        risk: 'medium',
        reasoning: 'Permission denied errors typically require elevated privileges. Using sudo grants necessary access.',
      },
      {
        description: 'Change ownership of the target directory to current user',
        commands: [
          'sudo chown -R $(whoami) <target-directory>',
          '<original-command>',
        ],
        confidence: 0.75,
        estimatedTime: 120,
        requiresSudo: true,
        risk: 'medium',
        reasoning: 'Changing ownership allows the current user to write without sudo.',
      },
      {
        description: 'Use a user-writable installation directory',
        commands: [
          'mkdir -p ~/.local/bin',
          '<install-command> --prefix ~/.local',
        ],
        confidence: 0.7,
        estimatedTime: 180,
        requiresSudo: false,
        risk: 'low',
        reasoning: 'Installing to user home directory avoids permission issues entirely.',
      },
    ],
  },
  {
    id: 'eperm-operation-not-permitted',
    pattern: /EPERM:\s*operation not permitted/i,
    type: 'permission',
    description: 'Operation not permitted - may be caused by file system restrictions or running processes',
    priority: 100,
    fixStrategies: [
      {
        description: 'Close any programs using the target files and retry',
        commands: ['<original-command>'],
        confidence: 0.65,
        estimatedTime: 60,
        requiresSudo: false,
        risk: 'low',
        reasoning: 'EPERM often occurs when files are in use by another process.',
      },
      {
        description: 'Run with elevated privileges (may be required on macOS due to SIP)',
        commands: ['sudo <original-command>'],
        confidence: 0.7,
        estimatedTime: 60,
        requiresSudo: true,
        risk: 'medium',
        reasoning: 'System Integrity Protection on macOS may require sudo for certain operations.',
      },
    ],
  },
  {
    id: 'missing-write-access',
    pattern: /Missing write access|EROFS.*read-only file system/i,
    type: 'permission',
    description: 'No write access to target directory or file system is read-only',
    priority: 90,
    fixStrategies: [
      {
        description: 'Use sudo to override write restrictions',
        commands: ['sudo <original-command>'],
        confidence: 0.75,
        estimatedTime: 60,
        requiresSudo: true,
        risk: 'medium',
        reasoning: 'Missing write access typically requires elevated privileges.',
      },
      {
        description: 'Check if file system is mounted as read-only and remount with write access',
        commands: ['mount | grep <target-path>', 'sudo mount -o remount,rw <mount-point>'],
        confidence: 0.6,
        estimatedTime: 120,
        requiresSudo: true,
        risk: 'high',
        reasoning: 'If file system is read-only, it needs to be remounted with write permissions.',
      },
    ],
  },

  // ========================================================================
  // Network Errors (Priority: 100-40)
  // ========================================================================
  {
    id: 'network-etimedout',
    pattern: /ETIMEDOUT|ERR_SOCKET_TIMEOUT|network\s+timeout/i,
    type: 'network',
    description: 'Network connection timeout - server took too long to respond',
    priority: 100,
    fixStrategies: [
      {
        description: 'Retry the command - network timeouts are often transient',
        commands: ['<original-command>'],
        confidence: 0.7,
        estimatedTime: 60,
        requiresSudo: false,
        risk: 'low',
        reasoning: 'Network timeouts are often temporary. A simple retry may succeed.',
      },
      {
        description: 'Use a mirror or alternative registry with better connectivity',
        commands: [
          'npm config set registry https://registry.npmmirror.com',
          '<original-command>',
        ],
        confidence: 0.65,
        estimatedTime: 120,
        requiresSudo: false,
        risk: 'low',
        reasoning: 'Mirror registries may have better network paths or be geographically closer.',
      },
      {
        description: 'Increase network timeout settings',
        commands: [
          'npm config set fetch-timeout 300000',
          'npm config set fetch-retries 5',
          '<original-command>',
        ],
        confidence: 0.6,
        estimatedTime: 180,
        requiresSudo: false,
        risk: 'low',
        reasoning: 'Increasing timeout allows more time for slow connections to complete.',
      },
    ],
  },
  {
    id: 'network-enotfound',
    pattern: /ENOTFOUND|getaddrinfo\s+ENOTFOUND/i,
    type: 'network',
    description: 'DNS lookup failed - cannot resolve hostname',
    priority: 100,
    fixStrategies: [
      {
        description: 'Check internet connection and DNS settings',
        commands: ['ping 8.8.8.8', 'nslookup <registry-domain>'],
        confidence: 0.65,
        estimatedTime: 60,
        requiresSudo: false,
        risk: 'low',
        reasoning: 'DNS failures may indicate network connectivity or DNS configuration issues.',
      },
      {
        description: 'Use a different registry that may resolve correctly',
        commands: [
          'npm config set registry https://registry.npmmirror.com',
          '<original-command>',
        ],
        confidence: 0.7,
        estimatedTime: 120,
        requiresSudo: false,
        risk: 'low',
        reasoning: 'Alternative registries may have different DNS records or be more accessible.',
      },
    ],
  },
  {
    id: 'network-econnrefused',
    pattern: /ECONNREFUSED|connection refused/i,
    type: 'network',
    description: 'Connection refused - server actively rejected the connection',
    priority: 100,
    fixStrategies: [
      {
        description: 'Check and remove incorrect proxy settings',
        commands: [
          'npm config get proxy',
          'npm config delete proxy',
          'npm config delete https-proxy',
          '<original-command>',
        ],
        confidence: 0.75,
        estimatedTime: 120,
        requiresSudo: false,
        risk: 'low',
        reasoning: 'Incorrect proxy settings often cause connection refused errors.',
      },
      {
        description: 'Verify the server is accessible and retry',
        commands: ['curl -I <registry-url>', '<original-command>'],
        confidence: 0.6,
        estimatedTime: 60,
        requiresSudo: false,
        risk: 'low',
        reasoning: 'The server may be temporarily unavailable or firewall may be blocking access.',
      },
    ],
  },
  {
    id: 'network-ssl-certificate',
    pattern: /unable to get local issuer certificate|CERT_HAS_EXPIRED|UNABLE_TO_VERIFY_LEAF_SIGNATURE|SSL.*certificate/i,
    type: 'network',
    description: 'SSL/TLS certificate verification failed',
    priority: 90,
    fixStrategies: [
      {
        description: 'Update system CA certificates',
        commands: ['sudo update-ca-certificates'],
        confidence: 0.7,
        estimatedTime: 180,
        requiresSudo: true,
        risk: 'low',
        reasoning: 'Outdated CA certificates cannot verify modern SSL certificates.',
      },
      {
        description: 'Temporarily disable strict SSL (not recommended for production)',
        commands: [
          'npm config set strict-ssl false',
          '<original-command>',
          'npm config set strict-ssl true',
        ],
        confidence: 0.8,
        estimatedTime: 120,
        requiresSudo: false,
        risk: 'high',
        reasoning: 'Disabling SSL verification allows connection but reduces security. Should be temporary.',
      },
    ],
  },

  // ========================================================================
  // Dependency Errors (Priority: 100-40)
  // ========================================================================
  {
    id: 'command-not-found',
    pattern: /command not found|'.*?' is not recognized|No such file or directory.*command/i,
    type: 'dependency',
    description: 'Required command or program is not installed or not in PATH',
    priority: 90,
    fixStrategies: [
      {
        description: 'Install the missing command using system package manager',
        commands: [
          'brew install <missing-command>',  // macOS
          'apt-get install <missing-command>',  // Linux
        ],
        confidence: 0.8,
        estimatedTime: 300,
        requiresSudo: true,
        risk: 'low',
        reasoning: 'Command not found typically means the required program needs to be installed.',
      },
      {
        description: 'Check if command is installed but not in PATH',
        commands: [
          'which <missing-command>',
          'find /usr -name <missing-command> 2>/dev/null',
        ],
        confidence: 0.5,
        estimatedTime: 60,
        requiresSudo: false,
        risk: 'low',
        reasoning: 'The command may be installed but not accessible via PATH environment variable.',
      },
    ],
  },
  {
    id: 'dependency-eresolve',
    pattern: /ERESOLVE\s+unable to resolve|Could not resolve dependency/i,
    type: 'dependency',
    description: 'Package dependency resolution conflict',
    priority: 90,
    fixStrategies: [
      {
        description: 'Use legacy peer dependency resolution mode',
        commands: ['npm install --legacy-peer-deps <package>'],
        confidence: 0.75,
        estimatedTime: 180,
        requiresSudo: false,
        risk: 'low',
        reasoning: 'Legacy peer deps mode relaxes strict version requirements to resolve conflicts.',
      },
      {
        description: 'Force install to override peer dependency conflicts',
        commands: ['npm install --force <package>'],
        confidence: 0.6,
        estimatedTime: 180,
        requiresSudo: false,
        risk: 'medium',
        reasoning: 'Force install bypasses dependency checks but may cause runtime issues.',
      },
      {
        description: 'Clear npm cache and retry',
        commands: [
          'npm cache clean --force',
          'rm -rf node_modules package-lock.json',
          'npm install',
        ],
        confidence: 0.65,
        estimatedTime: 300,
        requiresSudo: false,
        risk: 'low',
        reasoning: 'Corrupted cache or lock files can cause resolution failures.',
      },
    ],
  },
  {
    id: 'module-not-found',
    pattern: /Cannot find module|Module not found/i,
    type: 'dependency',
    description: 'Required Node.js module is missing',
    priority: 80,
    fixStrategies: [
      {
        description: 'Install missing dependencies',
        commands: ['npm install', 'pnpm install', 'yarn install'],
        confidence: 0.85,
        estimatedTime: 180,
        requiresSudo: false,
        risk: 'low',
        reasoning: 'Missing modules typically indicate dependencies need to be installed.',
      },
      {
        description: 'Clean install to resolve corrupted modules',
        commands: [
          'rm -rf node_modules package-lock.json',
          'npm install',
        ],
        confidence: 0.7,
        estimatedTime: 300,
        requiresSudo: false,
        risk: 'low',
        reasoning: 'Corrupted node_modules can cause module resolution failures.',
      },
    ],
  },
  {
    id: 'disk-space-exhausted',
    pattern: /ENOSPC|No space left on device|Disk quota exceeded/i,
    type: 'dependency',
    description: 'Insufficient disk space to complete operation',
    priority: 100,
    fixStrategies: [
      {
        description: 'Clear package manager caches to free disk space',
        commands: [
          'npm cache clean --force',
          'pnpm store prune',
          'yarn cache clean',
        ],
        confidence: 0.75,
        estimatedTime: 180,
        requiresSudo: false,
        risk: 'low',
        reasoning: 'Package manager caches can consume significant disk space.',
      },
      {
        description: 'Remove unused Docker images and containers',
        commands: [
          'docker system prune -a',
        ],
        confidence: 0.6,
        estimatedTime: 300,
        requiresSudo: false,
        risk: 'medium',
        reasoning: 'Docker can consume large amounts of disk space with unused images.',
      },
    ],
  },
  {
    id: 'native-build-error',
    pattern: /gyp ERR!|node-gyp|compilation?\s+error|make:\s+\*\*\*.*Error/i,
    type: 'dependency',
    description: 'Native module compilation failed - build tools may be missing',
    priority: 80,
    fixStrategies: [
      {
        description: 'Install Xcode command-line tools (macOS)',
        commands: ['xcode-select --install'],
        confidence: 0.85,
        estimatedTime: 600,
        requiresSudo: false,
        risk: 'low',
        reasoning: 'Native module compilation on macOS requires Xcode command-line tools.',
      },
      {
        description: 'Install build essentials (Linux)',
        commands: ['sudo apt-get install -y build-essential python3'],
        confidence: 0.85,
        estimatedTime: 300,
        requiresSudo: true,
        risk: 'low',
        reasoning: 'Native module compilation on Linux requires build-essential package.',
      },
      {
        description: 'Install Visual Studio Build Tools (Windows)',
        commands: ['npm install --global windows-build-tools'],
        confidence: 0.8,
        estimatedTime: 900,
        requiresSudo: true,
        risk: 'low',
        reasoning: 'Native module compilation on Windows requires Visual Studio Build Tools.',
      },
    ],
  },

  // ========================================================================
  // Version Conflicts (Priority: 100-40)
  // ========================================================================
  {
    id: 'node-version-incompatible',
    pattern: /engine .+ is incompatible|Unsupported engine|requires Node\.js/i,
    type: 'version',
    description: 'Node.js version is incompatible with package requirements',
    priority: 100,
    fixStrategies: [
      {
        description: 'Install and use the required Node.js version via nvm',
        commands: [
          'nvm install <required-version>',
          'nvm use <required-version>',
          '<original-command>',
        ],
        confidence: 0.9,
        estimatedTime: 300,
        requiresSudo: false,
        risk: 'low',
        reasoning: 'nvm allows easy switching between Node.js versions.',
      },
      {
        description: 'Upgrade Node.js via system package manager',
        commands: [
          'brew upgrade node',  // macOS
          'apt-get update && apt-get upgrade nodejs',  // Linux
        ],
        confidence: 0.75,
        estimatedTime: 300,
        requiresSudo: true,
        risk: 'medium',
        reasoning: 'System package manager can upgrade Node.js but may affect other projects.',
      },
    ],
  },
  {
    id: 'peer-dependency-conflict',
    pattern: /peer dep.*unmet|requires a peer of .+ but none is installed/i,
    type: 'version',
    description: 'Peer dependency version conflict',
    priority: 80,
    fixStrategies: [
      {
        description: 'Install with legacy peer dependency mode',
        commands: ['npm install --legacy-peer-deps'],
        confidence: 0.8,
        estimatedTime: 180,
        requiresSudo: false,
        risk: 'low',
        reasoning: 'Legacy peer deps mode allows mismatched peer dependencies.',
      },
      {
        description: 'Manually install the required peer dependency version',
        commands: ['npm install <peer-dependency>@<required-version>'],
        confidence: 0.75,
        estimatedTime: 180,
        requiresSudo: false,
        risk: 'medium',
        reasoning: 'Installing the specific peer dependency version may resolve the conflict.',
      },
    ],
  },
  {
    id: 'syntax-error-old-node',
    pattern: /SyntaxError:\s*Unexpected token/i,
    type: 'version',
    description: 'Node.js version does not support modern JavaScript syntax',
    priority: 90,
    fixStrategies: [
      {
        description: 'Upgrade to a newer Node.js version that supports modern syntax',
        commands: [
          'nvm install node',  // Latest version
          'nvm use node',
          '<original-command>',
        ],
        confidence: 0.85,
        estimatedTime: 300,
        requiresSudo: false,
        risk: 'low',
        reasoning: 'Modern JavaScript syntax requires Node.js version with appropriate support.',
      },
    ],
  },

  // ========================================================================
  // Configuration Errors (Priority: 100-40)
  // ========================================================================
  {
    id: 'json-parse-error',
    pattern: /EJSONPARSE|SyntaxError.*JSON|Unexpected token.*JSON/i,
    type: 'configuration',
    description: 'JSON configuration file is malformed',
    priority: 100,
    fixStrategies: [
      {
        description: 'Reset npm configuration to defaults',
        commands: [
          'mv ~/.npmrc ~/.npmrc.backup',
          '<original-command>',
        ],
        confidence: 0.75,
        estimatedTime: 60,
        requiresSudo: false,
        risk: 'low',
        reasoning: 'Corrupted npm configuration can cause JSON parse errors.',
      },
      {
        description: 'Validate and fix package.json syntax',
        commands: [
          'cat package.json | jq .',  // Validate JSON
        ],
        confidence: 0.7,
        estimatedTime: 60,
        requiresSudo: false,
        risk: 'low',
        reasoning: 'Malformed package.json is a common cause of JSON parse errors.',
      },
    ],
  },
  {
    id: 'invalid-configuration',
    pattern: /Invalid configuration|ERR_INVALID_ARG|Invalid (option|flag|argument)/i,
    type: 'configuration',
    description: 'Configuration setting or command argument is invalid',
    priority: 80,
    fixStrategies: [
      {
        description: 'Check command syntax and fix invalid arguments',
        commands: ['<command> --help'],
        confidence: 0.6,
        estimatedTime: 60,
        requiresSudo: false,
        risk: 'low',
        reasoning: 'Invalid arguments can be corrected by checking command help documentation.',
      },
      {
        description: 'Reset configuration to defaults',
        commands: [
          'npm config delete <config-key>',
          '<original-command>',
        ],
        confidence: 0.65,
        estimatedTime: 60,
        requiresSudo: false,
        risk: 'low',
        reasoning: 'Invalid configuration values can be fixed by resetting to defaults.',
      },
    ],
  },
  {
    id: 'proxy-configuration-error',
    pattern: /proxy.*(ECONNREFUSED|config|error)|Invalid proxy URL/i,
    type: 'configuration',
    description: 'Proxy configuration is incorrect or proxy server is unreachable',
    priority: 101,  // Higher priority than all network errors (100) to match first
    fixStrategies: [
      {
        description: 'Remove proxy configuration',
        commands: [
          'npm config delete proxy',
          'npm config delete https-proxy',
          'unset HTTP_PROXY HTTPS_PROXY',
          '<original-command>',
        ],
        confidence: 0.8,
        estimatedTime: 60,
        requiresSudo: false,
        risk: 'low',
        reasoning: 'Incorrect proxy settings prevent network access. Removing them may resolve the issue.',
      },
      {
        description: 'Verify proxy server is accessible',
        commands: [
          'curl -I --proxy <proxy-url> https://registry.npmjs.org',
        ],
        confidence: 0.5,
        estimatedTime: 60,
        requiresSudo: false,
        risk: 'low',
        reasoning: 'Proxy server may be down or unreachable.',
      },
    ],
  },
];

// ============================================================================
// Public API
// ============================================================================

/**
 * Match an error context against the common error rules library.
 *
 * Returns all matching rules sorted by priority (highest first), with
 * confidence scores based on pattern match quality.
 *
 * @param errorContext - The error context from a failed step
 * @returns Array of error matches, sorted by priority and confidence
 *
 * @example
 * ```ts
 * const matches = matchCommonErrors(errorContext);
 * if (matches.length > 0) {
 *   const bestMatch = matches[0];
 *   console.log('Matched rule:', bestMatch.rule.description);
 *   console.log('Fix strategies:', bestMatch.fixStrategies);
 * }
 * ```
 */
export function matchCommonErrors(errorContext: ErrorContext): ErrorMatch[] {
  const combined = `${errorContext.stdout}\n${errorContext.stderr}`;
  const matches: ErrorMatch[] = [];

  for (const rule of ERROR_RULES) {
    if (rule.pattern.test(combined)) {
      // Calculate confidence based on pattern specificity
      // More specific patterns (higher priority) get higher confidence
      const baseConfidence = Math.min(rule.priority / 100, 1.0);

      matches.push({
        rule,
        confidence: baseConfidence,
        fixStrategies: rule.fixStrategies,
      });
    }
  }

  // Sort by priority (descending), then by confidence (descending)
  matches.sort((a, b) => {
    if (b.rule.priority !== a.rule.priority) {
      return b.rule.priority - a.rule.priority;
    }
    return b.confidence - a.confidence;
  });

  return matches;
}

/**
 * Get the best matching error rule for the given error context.
 *
 * Returns the highest priority and confidence match, or null if no rules match.
 *
 * @param errorContext - The error context from a failed step
 * @returns The best error match, or null if no match found
 *
 * @example
 * ```ts
 * const match = getBestMatch(errorContext);
 * if (match && match.confidence > 0.7) {
 *   // Use predefined fix strategies instead of AI
 *   return match.fixStrategies;
 * }
 * ```
 */
export function getBestMatch(errorContext: ErrorContext): ErrorMatch | null {
  const matches = matchCommonErrors(errorContext);
  return matches.length > 0 ? matches[0] : null;
}

/**
 * Check if an error should skip AI diagnosis based on rule match confidence.
 *
 * If a high-confidence rule match is found, AI diagnosis can be skipped to
 * save token costs and reduce latency.
 *
 * @param errorContext - The error context from a failed step
 * @param confidenceThreshold - Minimum confidence to skip AI (default: 0.75)
 * @returns True if AI diagnosis can be skipped, false otherwise
 *
 * @example
 * ```ts
 * if (shouldSkipAI(errorContext)) {
 *   // Use predefined fix strategies
 *   const match = getBestMatch(errorContext);
 *   return match.fixStrategies;
 * } else {
 *   // Fall back to AI diagnosis
 *   return await diagnoseWithAI(errorContext);
 * }
 * ```
 */
export function shouldSkipAI(
  errorContext: ErrorContext,
  confidenceThreshold: number = 0.75,
): boolean {
  const match = getBestMatch(errorContext);
  return match !== null && match.confidence >= confidenceThreshold;
}

/**
 * Get all fix strategies from matching rules, deduplicated and sorted by confidence.
 *
 * Combines fix strategies from all matching rules, removes duplicates based on
 * description, and sorts by confidence in descending order.
 *
 * @param errorContext - The error context from a failed step
 * @returns Deduplicated fix strategies sorted by confidence (highest first)
 *
 * @example
 * ```ts
 * const strategies = getAllFixStrategies(errorContext);
 * for (const strategy of strategies) {
 *   console.log(`[${strategy.confidence}] ${strategy.description}`);
 * }
 * ```
 */
export function getAllFixStrategies(errorContext: ErrorContext): FixStrategy[] {
  const matches = matchCommonErrors(errorContext);
  const allStrategies: FixStrategy[] = [];
  const seen = new Set<string>();

  for (const match of matches) {
    for (const strategy of match.fixStrategies) {
      // Deduplicate by description
      if (!seen.has(strategy.description)) {
        seen.add(strategy.description);
        allStrategies.push(strategy);
      }
    }
  }

  // Sort by confidence descending
  allStrategies.sort((a, b) => b.confidence - a.confidence);

  return allStrategies;
}

/**
 * Get statistics about the rule library.
 *
 * @returns Statistics about the error rules library
 */
export function getRuleStats(): {
  totalRules: number;
  rulesByType: Record<ErrorType, number>;
  averagePriority: number;
  highPriorityRules: number;
} {
  const rulesByType: Record<string, number> = {};
  let totalPriority = 0;
  let highPriorityCount = 0;

  for (const rule of ERROR_RULES) {
    rulesByType[rule.type] = (rulesByType[rule.type] || 0) + 1;
    totalPriority += rule.priority;
    if (rule.priority >= 80) {
      highPriorityCount++;
    }
  }

  return {
    totalRules: ERROR_RULES.length,
    rulesByType: rulesByType as Record<ErrorType, number>,
    averagePriority: totalPriority / ERROR_RULES.length,
    highPriorityRules: highPriorityCount,
  };
}
