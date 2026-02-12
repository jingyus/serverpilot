// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Error pattern definitions and extraction logic for rule-based error analysis.
 * @module ai/error-patterns
 */

/** Known error categories that can be identified */
export type ErrorType =
  | 'network'
  | 'permission'
  | 'dependency'
  | 'version'
  | 'configuration'
  | 'unknown';

export interface ExtractedErrorInfo {
  errorCodes: string[];
  missingDependencies: string[];
  permissionIssues: {
    paths: string[];
    needsSudo: boolean;
  };
  versionConflicts: {
    package: string;
    required: string;
    current?: string;
  }[];
  configIssues: {
    file: string;
    issue: string;
  }[];
}

export interface ErrorPattern {
  type: ErrorType;
  pattern: RegExp;
  label: string;
  weight: number;
}

/** Patterns checked in order; type with highest aggregate confidence wins. */
export const ERROR_PATTERNS: ErrorPattern[] = [
  // ---- Network errors ----
  {
    type: 'network',
    pattern: /ETIMEDOUT/i,
    label: 'connection timeout (ETIMEDOUT)',
    weight: 0.9,
  },
  {
    type: 'network',
    pattern: /ECONNREFUSED/i,
    label: 'connection refused (ECONNREFUSED)',
    weight: 0.9,
  },
  {
    type: 'network',
    pattern: /ECONNRESET/i,
    label: 'connection reset (ECONNRESET)',
    weight: 0.9,
  },
  {
    type: 'network',
    pattern: /ENOTFOUND/i,
    label: 'DNS lookup failed (ENOTFOUND)',
    weight: 0.9,
  },
  {
    type: 'network',
    pattern: /network\s+timeout/i,
    label: 'network timeout',
    weight: 0.85,
  },
  {
    type: 'network',
    pattern: /unable to get local issuer certificate/i,
    label: 'SSL certificate error',
    weight: 0.8,
  },
  {
    type: 'network',
    pattern: /ERR_SOCKET_TIMEOUT/i,
    label: 'socket timeout',
    weight: 0.85,
  },
  {
    type: 'network',
    pattern: /request to .+ failed/i,
    label: 'HTTP request failed',
    weight: 0.7,
  },
  {
    type: 'network',
    pattern: /fetch failed/i,
    label: 'fetch failed',
    weight: 0.7,
  },
  {
    type: 'network',
    pattern: /registry\.npmjs\.org/i,
    label: 'npm registry access issue',
    weight: 0.5,
  },

  // ---- Permission errors ----
  {
    type: 'permission',
    pattern: /EACCES:\s*permission denied/i,
    label: 'permission denied (EACCES)',
    weight: 0.95,
  },
  {
    type: 'permission',
    pattern: /EPERM:\s*operation not permitted/i,
    label: 'operation not permitted (EPERM)',
    weight: 0.95,
  },
  {
    type: 'permission',
    pattern: /permission denied/i,
    label: 'permission denied',
    weight: 0.8,
  },
  {
    type: 'permission',
    pattern: /Run with --force to force/i,
    label: 'needs --force flag',
    weight: 0.6,
  },
  {
    type: 'permission',
    pattern: /ENOTEMPTY/i,
    label: 'directory not empty (ENOTEMPTY)',
    weight: 0.6,
  },
  {
    type: 'permission',
    pattern: /Missing write access/i,
    label: 'missing write access',
    weight: 0.9,
  },

  // ---- Dependency errors ----
  {
    type: 'dependency',
    pattern: /ERESOLVE\s+unable to resolve/i,
    label: 'dependency resolution failed (ERESOLVE)',
    weight: 0.95,
  },
  {
    type: 'dependency',
    pattern: /peer dep/i,
    label: 'peer dependency issue',
    weight: 0.7,
  },
  {
    type: 'dependency',
    pattern: /Could not resolve dependency/i,
    label: 'unresolved dependency',
    weight: 0.9,
  },
  {
    type: 'dependency',
    pattern: /not found:\s*(npm|node|pnpm|yarn)/i,
    label: 'package manager not found',
    weight: 0.85,
  },
  {
    type: 'dependency',
    pattern: /command not found/i,
    label: 'command not found',
    weight: 0.7,
  },
  {
    type: 'dependency',
    pattern: /Cannot find module/i,
    label: 'missing module',
    weight: 0.85,
  },
  {
    type: 'dependency',
    pattern: /404 Not Found.*npm/i,
    label: 'npm package not found (404)',
    weight: 0.85,
  },
  {
    type: 'dependency',
    pattern: /ERR! 404/i,
    label: 'package not found (404)',
    weight: 0.8,
  },
  {
    type: 'dependency',
    pattern: /ENOENT:\s*no such file or directory/i,
    label: 'file or directory not found (ENOENT)',
    weight: 0.6,
  },

  // ---- Version conflicts ----
  {
    type: 'version',
    pattern: /engine .+ is incompatible/i,
    label: 'engine version incompatible',
    weight: 0.95,
  },
  {
    type: 'version',
    pattern: /Unsupported engine/i,
    label: 'unsupported engine version',
    weight: 0.9,
  },
  {
    type: 'version',
    pattern: /requires a peer of .+ but none is installed/i,
    label: 'peer version mismatch',
    weight: 0.8,
  },
  {
    type: 'version',
    pattern: /version .+ not found/i,
    label: 'version not found',
    weight: 0.8,
  },
  {
    type: 'version',
    pattern: /node:\s*v?\d+\.\d+\.\d+.*is not supported/i,
    label: 'Node.js version not supported',
    weight: 0.9,
  },
  {
    type: 'version',
    pattern: /npm WARN notsup/i,
    label: 'unsupported platform/version',
    weight: 0.75,
  },

  // ---- Configuration errors ----
  {
    type: 'configuration',
    pattern: /Invalid configuration/i,
    label: 'invalid configuration',
    weight: 0.9,
  },
  {
    type: 'configuration',
    pattern: /EJSONPARSE/i,
    label: 'JSON parse error (EJSONPARSE)',
    weight: 0.9,
  },
  {
    type: 'configuration',
    pattern: /SyntaxError.*JSON/i,
    label: 'JSON syntax error',
    weight: 0.85,
  },
  {
    type: 'configuration',
    pattern: /\.npmrc/i,
    label: '.npmrc configuration issue',
    weight: 0.6,
  },
  {
    type: 'configuration',
    pattern: /ERR_INVALID_ARG/i,
    label: 'invalid argument',
    weight: 0.7,
  },
  {
    type: 'configuration',
    pattern: /Invalid (option|flag|argument)/i,
    label: 'invalid CLI option',
    weight: 0.75,
  },
  {
    type: 'configuration',
    pattern: /proxy.*config/i,
    label: 'proxy configuration issue',
    weight: 0.6,
  },
];

/** Patterns that indicate transient (retryable) errors */
export const TRANSIENT_PATTERNS: RegExp[] = [
  /EBUSY/i,
  /EAGAIN/i,
  /resource temporarily unavailable/i,
  /npm ERR! cb\(\) never called/i,
];

/** Match the combined output against all patterns, returning hits. */
export function matchPatterns(combined: string): ErrorPattern[] {
  return ERROR_PATTERNS.filter((p) => p.pattern.test(combined));
}

/** Extract error codes from output (e.g., EACCES, ETIMEDOUT, ERESOLVE). */
export function extractErrorCodes(output: string): string[] {
  const codes = new Set<string>();

  // Match standard Node.js error codes (EXXX format)
  const nodeErrorPattern = /\b(E[A-Z]{3,})\b/g;
  let match;
  while ((match = nodeErrorPattern.exec(output)) !== null) {
    codes.add(match[1]);
  }

  // Match npm/yarn specific error codes
  const npmErrorPattern = /npm ERR! code ([A-Z_]+)/gi;
  while ((match = npmErrorPattern.exec(output)) !== null) {
    codes.add(match[1]);
  }

  return Array.from(codes);
}

/** Extract missing dependencies from output. */
export function extractMissingDependencies(output: string): string[] {
  const dependencies = new Set<string>();

  // Pattern: "bash: xxx: command not found"
  const bashCommandNotFoundPattern = /bash:\s+([a-z0-9_-]+):\s+command not found/gi;
  let match;
  while ((match = bashCommandNotFoundPattern.exec(output)) !== null) {
    dependencies.add(match[1]);
  }

  // Pattern: "command not found: xxx" or "not found: xxx"
  const commandNotFoundPattern = /(?:command\s+not\s+found|not\s+found):\s*([a-z0-9_-]+)/gi;
  while ((match = commandNotFoundPattern.exec(output)) !== null) {
    dependencies.add(match[1]);
  }

  // Pattern: "Cannot find module 'xxx'"
  const moduleNotFoundPattern = /Cannot find module ['"]([^'"]+)['"]/gi;
  while ((match = moduleNotFoundPattern.exec(output)) !== null) {
    dependencies.add(match[1]);
  }

  // Pattern: npm 404 errors - extract package name from URL
  const npm404Pattern = /404\s+Not Found[^\n]*?\/([a-z0-9@_-]+)(?:\/|$|\s)/gi;
  while ((match = npm404Pattern.exec(output)) !== null) {
    const pkg = match[1];
    // Filter out common path segments
    if (!['registry', 'api', 'npm', 'https:', 'http:'].includes(pkg)) {
      dependencies.add(pkg);
    }
  }

  // Pattern: "package not found"
  const packageNotFoundPattern = /package\s+['"]?([a-z0-9@/_-]+)['"]?\s+not found/gi;
  while ((match = packageNotFoundPattern.exec(output)) !== null) {
    dependencies.add(match[1]);
  }

  return Array.from(dependencies);
}

/** Extract permission issues from output. */
export function extractPermissionIssues(
  output: string,
): ExtractedErrorInfo['permissionIssues'] {
  const paths = new Set<string>();
  let needsSudo = false;

  // Pattern: "permission denied" or "EACCES" or "EPERM"
  if (
    /permission denied|EACCES|EPERM|Missing write access/i.test(output)
  ) {
    needsSudo = true;

    // Extract paths from permission errors
    const pathPattern =
      /(?:permission denied|EACCES|EPERM|Missing write access).*?['"]?([/\\][^'":\s]+)['"]?/gi;
    let match;
    while ((match = pathPattern.exec(output)) !== null) {
      paths.add(match[1]);
    }

    // Extract paths from "mkdir" or "write" errors
    const mkdirPattern = /(?:mkdir|write|open).*?['"]([/\\][^'"]+)['"]/gi;
    while ((match = mkdirPattern.exec(output)) !== null) {
      paths.add(match[1]);
    }
  }

  return {
    paths: Array.from(paths),
    needsSudo,
  };
}

/** Extract version conflicts from output. */
export function extractVersionConflicts(
  output: string,
): ExtractedErrorInfo['versionConflicts'] {
  const conflicts: ExtractedErrorInfo['versionConflicts'] = [];

  // Pattern: "engine is incompatible"
  const enginePattern =
    /engine\s+\{["']?([^"':}]+)["']?:\s*["']?([^"'}]+)["']?\}\s+is incompatible/gi;
  let match;
  while ((match = enginePattern.exec(output)) !== null) {
    conflicts.push({
      package: match[1],
      required: match[2],
    });
  }

  // Pattern: "Unsupported engine"
  const unsupportedPattern =
    /Unsupported engine\s+\{["']?([^"':}]+)["']?:\s*["']?([^"'}]+)["']?\}/gi;
  while ((match = unsupportedPattern.exec(output)) !== null) {
    conflicts.push({
      package: match[1],
      required: match[2],
    });
  }

  // Pattern: "requires a peer of X@version but none is installed"
  const peerPattern =
    /requires a peer of\s+([^@\s]+)@["']?([^"'\s]+)["']?\s+but/gi;
  while ((match = peerPattern.exec(output)) !== null) {
    conflicts.push({
      package: match[1],
      required: match[2],
    });
  }

  // Pattern: "node: vX.X.X is not supported"
  const nodeVersionPattern =
    /node:\s*v?(\d+\.\d+\.\d+).*?is not supported/gi;
  while ((match = nodeVersionPattern.exec(output)) !== null) {
    conflicts.push({
      package: 'node',
      current: match[1],
      required: 'unknown',
    });
  }

  return conflicts;
}

/** Extract configuration issues from output. */
export function extractConfigIssues(
  output: string,
): ExtractedErrorInfo['configIssues'] {
  const issues: ExtractedErrorInfo['configIssues'] = [];

  // Pattern: "Invalid configuration in <file>"
  const invalidConfigPattern =
    /Invalid configuration in\s+([^\s:]+)/gi;
  let match;
  while ((match = invalidConfigPattern.exec(output)) !== null) {
    issues.push({
      file: match[1],
      issue: 'Invalid configuration',
    });
  }

  // Pattern: "EJSONPARSE" - extract file from subsequent lines
  if (/EJSONPARSE/i.test(output)) {
    const fileMatch = /file\s+([/\\][^\s]+\.json)/i.exec(output);
    issues.push({
      file: fileMatch ? fileMatch[1] : 'unknown.json',
      issue: 'JSON parse error',
    });
  }

  // Pattern: "SyntaxError" in JSON
  if (/SyntaxError.*JSON/i.test(output)) {
    const fileMatch = /in\s+([^\s:]+\.json)/i.exec(output);
    issues.push({
      file: fileMatch ? fileMatch[1] : 'unknown.json',
      issue: 'JSON syntax error',
    });
  }

  // Pattern: ".npmrc" configuration issue
  if (/\.npmrc/i.test(output)) {
    issues.push({
      file: '.npmrc',
      issue: 'npm configuration problem',
    });
  }

  // Pattern: "Invalid option/flag/argument"
  const invalidArgPattern = /Invalid (option|flag|argument)[:\s]+([^\s]+)/gi;
  while ((match = invalidArgPattern.exec(output)) !== null) {
    issues.push({
      file: 'command line',
      issue: `Invalid ${match[1]}: ${match[2]}`,
    });
  }

  return issues;
}
