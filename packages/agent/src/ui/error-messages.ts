/**
 * Plain-language error message formatting for AI Installer.
 *
 * Transforms technical error codes and raw stderr/stdout into
 * user-friendly messages that explain what went wrong and why,
 * using everyday language instead of jargon.
 *
 * @module ui/error-messages
 */

import chalk from 'chalk';
import type { ErrorContext } from '@aiinstaller/shared';

// ============================================================================
// Types
// ============================================================================

/** Severity levels for user-facing error messages. */
export type ErrorSeverity = 'low' | 'medium' | 'high' | 'critical';

/** Known error categories (mirrors server-side ErrorType). */
export type ErrorCategory =
  | 'network'
  | 'permission'
  | 'dependency'
  | 'version'
  | 'configuration'
  | 'unknown';

/**
 * A user-friendly error message with structured information.
 *
 * Designed to be rendered directly in the terminal, with a clear
 * separation between what happened, why, and what to do next.
 */
export interface PlainErrorMessage {
  /** Short title describing what went wrong (plain language) */
  title: string;
  /** Longer explanation of why it happened */
  explanation: string;
  /** How serious this problem is */
  severity: ErrorSeverity;
  /** The detected error category */
  category: ErrorCategory;
  /** The original technical error code or pattern, if available */
  technicalDetail?: string;
  /** Actionable next steps the user can take to resolve the issue */
  nextSteps: string[];
  /** Relevant help links for further reading */
  helpLinks: HelpLink[];
}

/**
 * A help link with a label and URL for further reading.
 */
export interface HelpLink {
  /** Short description of the linked resource */
  label: string;
  /** URL to the help resource */
  url: string;
}

/**
 * A pattern-based rule for matching stderr/stdout to a PlainErrorMessage.
 */
interface ErrorMessageRule {
  /** Regex to match against combined output */
  pattern: RegExp;
  /** The error category */
  category: ErrorCategory;
  /** Build a plain-language message from the matched output */
  build: (context: ErrorMessageContext) => PlainErrorMessage;
}

/** Context passed to rule builders. */
interface ErrorMessageContext {
  /** The command that was executed */
  command: string;
  /** Exit code of the failed command */
  exitCode: number;
  /** Standard error output */
  stderr: string;
  /** Standard output */
  stdout: string;
  /** Combined stderr + stdout */
  combined: string;
}

// ============================================================================
// Plain-language message rules
// ============================================================================

/**
 * Ordered list of error message rules. First match wins.
 *
 * Each rule maps a technical error signature to a plain-language
 * explanation that a non-technical user can understand.
 */
const MESSAGE_RULES: ErrorMessageRule[] = [
  // ---- Network errors ----
  {
    pattern: /ETIMEDOUT|ERR_SOCKET_TIMEOUT/i,
    category: 'network',
    build: (ctx) => ({
      title: 'Connection timed out',
      explanation:
        `Could not reach the package server in time. ` +
        `This usually means your internet connection is slow or the server is busy. ` +
        `Try again in a few minutes, or switch to a faster mirror.`,
      severity: 'medium',
      category: 'network',
      technicalDetail: extractMatch(ctx.combined, /ETIMEDOUT|ERR_SOCKET_TIMEOUT/i),
      nextSteps: [
        'Wait a few minutes and retry the command',
        'Switch to a mirror: npm config set registry https://registry.npmmirror.com',
        'Check your internet connection',
      ],
      helpLinks: [
        { label: 'npm network troubleshooting', url: 'https://docs.npmjs.com/common-errors#network-errors' },
      ],
    }),
  },
  {
    pattern: /ENOTFOUND/i,
    category: 'network',
    build: (ctx) => ({
      title: 'Server address not found',
      explanation:
        `Your computer could not find the package server's address. ` +
        `Check that you are connected to the internet and that your DNS settings are correct.`,
      severity: 'high',
      category: 'network',
      technicalDetail: extractMatch(ctx.combined, /ENOTFOUND\s*\S*/i),
      nextSteps: [
        'Check your internet connection (try opening a website in your browser)',
        'Try changing DNS to 8.8.8.8 or 1.1.1.1',
        'If behind a VPN or proxy, check that it is running',
      ],
      helpLinks: [
        { label: 'Fixing DNS issues', url: 'https://docs.npmjs.com/common-errors#network-errors' },
      ],
    }),
  },
  {
    pattern: /ECONNREFUSED/i,
    category: 'network',
    build: (ctx) => ({
      title: 'Connection was refused',
      explanation:
        `The package server actively refused the connection. ` +
        `This may happen if you have a proxy configured that is not running, ` +
        `or the server is temporarily down.`,
      severity: 'high',
      category: 'network',
      technicalDetail: 'ECONNREFUSED',
      nextSteps: [
        'Check if your proxy is running (if configured)',
        'Remove proxy settings: npm config delete proxy && npm config delete https-proxy',
        'Try a different registry: npm config set registry https://registry.npmjs.org',
      ],
      helpLinks: [
        { label: 'npm proxy configuration', url: 'https://docs.npmjs.com/cli/v10/using-npm/config#proxy' },
      ],
    }),
  },
  {
    pattern: /ECONNRESET/i,
    category: 'network',
    build: (ctx) => ({
      title: 'Connection was interrupted',
      explanation:
        `The connection to the package server was unexpectedly cut off. ` +
        `This is often caused by an unstable network. Try running the command again.`,
      severity: 'medium',
      category: 'network',
      technicalDetail: 'ECONNRESET',
      nextSteps: [
        'Retry the command',
        'If the problem persists, try a wired connection instead of Wi-Fi',
        'Switch to a mirror: npm config set registry https://registry.npmmirror.com',
      ],
      helpLinks: [
        { label: 'npm network troubleshooting', url: 'https://docs.npmjs.com/common-errors#network-errors' },
      ],
    }),
  },
  {
    pattern: /unable to get local issuer certificate|CERT_HAS_EXPIRED|UNABLE_TO_VERIFY_LEAF_SIGNATURE/i,
    category: 'network',
    build: (ctx) => ({
      title: 'Security certificate problem',
      explanation:
        `Your computer could not verify the security certificate of the package server. ` +
        `This can happen behind a corporate firewall or when system certificates are outdated. ` +
        `Try updating your system certificates, or contact your network administrator.`,
      severity: 'high',
      category: 'network',
      technicalDetail: extractMatch(ctx.combined, /unable to get local issuer certificate|CERT_HAS_EXPIRED|UNABLE_TO_VERIFY_LEAF_SIGNATURE/i),
      nextSteps: [
        'Update your system certificates',
        'If behind a corporate firewall, contact your network administrator',
        'As a temporary workaround: npm config set strict-ssl false (not recommended for production)',
      ],
      helpLinks: [
        { label: 'SSL certificate errors', url: 'https://docs.npmjs.com/common-errors#ssl-errors' },
      ],
    }),
  },
  {
    pattern: /network\s+timeout/i,
    category: 'network',
    build: () => ({
      title: 'Network timeout',
      explanation:
        `The download took too long and was cancelled. ` +
        `This usually happens on a slow internet connection. ` +
        `Try again, or use a closer mirror server.`,
      severity: 'medium',
      category: 'network',
      technicalDetail: 'network timeout',
      nextSteps: [
        'Retry the command',
        'Increase timeout: npm config set fetch-timeout 120000',
        'Switch to a closer mirror: npm config set registry https://registry.npmmirror.com',
      ],
      helpLinks: [
        { label: 'npm network troubleshooting', url: 'https://docs.npmjs.com/common-errors#network-errors' },
      ],
    }),
  },
  {
    pattern: /fetch failed|request to .+ failed/i,
    category: 'network',
    build: () => ({
      title: 'Download failed',
      explanation:
        `Could not download the required files from the internet. ` +
        `Make sure you are connected to the internet and try again.`,
      severity: 'medium',
      category: 'network',
      technicalDetail: 'fetch failed',
      nextSteps: [
        'Check your internet connection',
        'Retry the command',
        'If on a slow connection, try: npm config set fetch-retries 5',
      ],
      helpLinks: [
        { label: 'npm network troubleshooting', url: 'https://docs.npmjs.com/common-errors#network-errors' },
      ],
    }),
  },

  // ---- Permission errors ----
  {
    pattern: /EACCES:\s*permission denied/i,
    category: 'permission',
    build: (ctx) => ({
      title: 'Permission denied',
      explanation:
        `Your user account does not have permission to write to the required directory. ` +
        `This is common when installing packages globally. ` +
        `You can fix this by changing the npm global directory to a user-owned folder, ` +
        `or by running the command with administrator privileges.`,
      severity: 'high',
      category: 'permission',
      technicalDetail: extractMatch(ctx.combined, /EACCES:\s*permission denied[^\n]*/i),
      nextSteps: [
        'Run "pnpm setup" to configure a user-writable global directory',
        'Or use sudo: sudo npm install -g <package>',
        'Or use a Node version manager (nvm) to avoid permission issues',
      ],
      helpLinks: [
        { label: 'Fixing npm permissions', url: 'https://docs.npmjs.com/resolving-eacces-permissions-errors-when-installing-packages-globally' },
        { label: 'nvm installation guide', url: 'https://github.com/nvm-sh/nvm#installing-and-updating' },
      ],
    }),
  },
  {
    pattern: /EPERM:\s*operation not permitted/i,
    category: 'permission',
    build: () => ({
      title: 'Operation not allowed',
      explanation:
        `The system prevented this operation. On macOS, this may be caused by ` +
        `System Integrity Protection (SIP). Try installing Node.js through a version ` +
        `manager like nvm, which installs to your home directory instead.`,
      severity: 'high',
      category: 'permission',
      technicalDetail: 'EPERM',
      nextSteps: [
        'Install Node.js via nvm: curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash',
        'Then run: nvm install 22 && nvm use 22',
        'On macOS, avoid installing to system-protected directories',
      ],
      helpLinks: [
        { label: 'nvm installation guide', url: 'https://github.com/nvm-sh/nvm#installing-and-updating' },
      ],
    }),
  },
  {
    pattern: /Missing write access/i,
    category: 'permission',
    build: () => ({
      title: 'Cannot write to install directory',
      explanation:
        `You do not have write access to the global package directory. ` +
        `Run "pnpm setup" to configure a user-writable location, ` +
        `then reload your terminal and try again.`,
      severity: 'high',
      category: 'permission',
      technicalDetail: 'Missing write access',
      nextSteps: [
        'Run "pnpm setup" to configure a user-writable global directory',
        'Close and reopen your terminal',
        'Retry the install command',
      ],
      helpLinks: [
        { label: 'pnpm setup documentation', url: 'https://pnpm.io/cli/setup' },
      ],
    }),
  },

  // ---- Dependency errors ----
  {
    pattern: /node:\s*command not found|'node' is not recognized/i,
    category: 'dependency',
    build: () => ({
      title: 'Node.js is not installed',
      explanation:
        `Node.js was not found on your system. It is required for this installation. ` +
        `Install Node.js version 22 or later using nvm (recommended) or from the official website.`,
      severity: 'critical',
      category: 'dependency',
      technicalDetail: 'node: command not found',
      nextSteps: [
        'Install nvm: curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash',
        'Then run: nvm install 22',
        'Or download Node.js from https://nodejs.org/',
      ],
      helpLinks: [
        { label: 'Node.js downloads', url: 'https://nodejs.org/en/download/' },
        { label: 'nvm installation guide', url: 'https://github.com/nvm-sh/nvm#installing-and-updating' },
      ],
    }),
  },
  {
    pattern: /pnpm:\s*command not found|'pnpm' is not recognized/i,
    category: 'dependency',
    build: () => ({
      title: 'pnpm is not installed',
      explanation:
        `The pnpm package manager was not found. You can install it by running ` +
        `"corepack enable" followed by "corepack prepare pnpm@latest --activate", ` +
        `or by running "npm install -g pnpm".`,
      severity: 'high',
      category: 'dependency',
      technicalDetail: 'pnpm: command not found',
      nextSteps: [
        'Run: corepack enable && corepack prepare pnpm@latest --activate',
        'Or run: npm install -g pnpm',
        'Restart your terminal after installation',
      ],
      helpLinks: [
        { label: 'pnpm installation', url: 'https://pnpm.io/installation' },
      ],
    }),
  },
  {
    pattern: /command not found/i,
    category: 'dependency',
    build: (ctx) => {
      const cmdMatch = ctx.combined.match(/(\S+):\s*command not found/i);
      const missingCmd = cmdMatch ? cmdMatch[1] : 'A required program';
      return {
        title: `"${missingCmd}" is not installed`,
        explanation:
          `The program "${missingCmd}" was not found on your system. ` +
          `Make sure it is installed and available in your PATH.`,
        severity: 'high',
        category: 'dependency',
        technicalDetail: `${missingCmd}: command not found`,
        nextSteps: [
          `Install "${missingCmd}" using your system package manager`,
          'Make sure it is in your PATH (check with: echo $PATH)',
          'Restart your terminal after installation',
        ],
        helpLinks: [],
      };
    },
  },
  {
    pattern: /ERESOLVE\s+unable to resolve|Could not resolve dependency/i,
    category: 'dependency',
    build: () => ({
      title: 'Package version conflict',
      explanation:
        `Some packages require different versions of the same dependency, ` +
        `and the package manager cannot find a version that satisfies everyone. ` +
        `Try installing with the "--legacy-peer-deps" flag to relax version checks.`,
      severity: 'medium',
      category: 'dependency',
      technicalDetail: 'ERESOLVE',
      nextSteps: [
        'Retry with: npm install --legacy-peer-deps',
        'Or try: npm install --force',
        'Check package.json for conflicting dependency versions',
      ],
      helpLinks: [
        { label: 'npm ERESOLVE documentation', url: 'https://docs.npmjs.com/cli/v10/commands/npm-install#strict-peer-deps' },
      ],
    }),
  },
  {
    pattern: /Cannot find module/i,
    category: 'dependency',
    build: (ctx) => {
      const modMatch = ctx.combined.match(/Cannot find module\s+'([^']+)'/i);
      const moduleName = modMatch ? modMatch[1] : 'a required module';
      return {
        title: 'Missing module',
        explanation:
          `The module "${moduleName}" could not be found. ` +
          `Try running "npm install" to install all dependencies, ` +
          `or check that the module is listed in your package.json.`,
        severity: 'high',
        category: 'dependency',
        technicalDetail: `Cannot find module '${moduleName}'`,
        nextSteps: [
          'Run "npm install" or "pnpm install" to install dependencies',
          `Check that "${moduleName}" is listed in package.json`,
          'Delete node_modules and reinstall: rm -rf node_modules && npm install',
        ],
        helpLinks: [],
      };
    },
  },
  {
    pattern: /gyp ERR!|node-gyp|compilation?\s+error|make:\s+\*\*\*/i,
    category: 'dependency',
    build: () => ({
      title: 'Native code build failed',
      explanation:
        `A package with native code could not be compiled. ` +
        `Make sure you have build tools installed: ` +
        `on macOS run "xcode-select --install", ` +
        `on Linux install "build-essential" and "python3".`,
      severity: 'high',
      category: 'dependency',
      technicalDetail: 'node-gyp build error',
      nextSteps: [
        'On macOS: run "xcode-select --install"',
        'On Linux: run "sudo apt install build-essential python3"',
        'Then retry the install command',
      ],
      helpLinks: [
        { label: 'node-gyp installation guide', url: 'https://github.com/nodejs/node-gyp#installation' },
      ],
    }),
  },
  {
    pattern: /ENOSPC|No space left on device/i,
    category: 'dependency',
    build: () => ({
      title: 'Disk space is full',
      explanation:
        `There is not enough free disk space to complete the installation. ` +
        `Free up some space by clearing caches ("npm cache clean --force") ` +
        `or removing unused files, then try again.`,
      severity: 'critical',
      category: 'dependency',
      technicalDetail: 'ENOSPC',
      nextSteps: [
        'Clear npm cache: npm cache clean --force',
        'Clear pnpm cache: pnpm store prune',
        'Free up disk space by removing unused files',
        'Then retry the install command',
      ],
      helpLinks: [],
    }),
  },
  {
    pattern: /ERR! 404|404 Not Found/i,
    category: 'dependency',
    build: (ctx) => {
      const pkgMatch = ctx.combined.match(/404\s+Not Found[:\s-]*(\S+)/i);
      const pkg = pkgMatch ? pkgMatch[1] : 'the requested package';
      return {
        title: 'Package not found',
        explanation:
          `The package "${pkg}" does not exist in the registry, or the version ` +
          `you requested is not available. Double-check the package name and version.`,
        severity: 'high',
        category: 'dependency',
        technicalDetail: '404 Not Found',
        nextSteps: [
          'Double-check the package name for typos',
          `Search for the package: npm search ${pkg}`,
          'Check if the package was renamed or deprecated',
        ],
        helpLinks: [
          { label: 'npm package search', url: 'https://www.npmjs.com/' },
        ],
      };
    },
  },

  // ---- Version errors ----
  {
    pattern: /engine .+ is incompatible|Unsupported engine|requires Node\.js >= 22/i,
    category: 'version',
    build: () => ({
      title: 'Node.js version is too old',
      explanation:
        `The software you are installing requires a newer version of Node.js (22 or later). ` +
        `Upgrade Node.js using nvm ("nvm install 22") or download the latest version from nodejs.org.`,
      severity: 'high',
      category: 'version',
      technicalDetail: 'Unsupported engine',
      nextSteps: [
        'Upgrade Node.js: nvm install 22 && nvm use 22',
        'Or download from https://nodejs.org/',
        'Verify with: node --version',
      ],
      helpLinks: [
        { label: 'Node.js downloads', url: 'https://nodejs.org/en/download/' },
        { label: 'nvm installation guide', url: 'https://github.com/nvm-sh/nvm#installing-and-updating' },
      ],
    }),
  },
  {
    pattern: /SyntaxError:\s*Unexpected token/i,
    category: 'version',
    build: () => ({
      title: 'Code syntax not supported',
      explanation:
        `Your version of Node.js does not understand some of the code in this package. ` +
        `This usually means you need a newer version of Node.js. ` +
        `Upgrade to Node.js 22 or later.`,
      severity: 'high',
      category: 'version',
      technicalDetail: 'SyntaxError: Unexpected token',
      nextSteps: [
        'Upgrade Node.js: nvm install 22 && nvm use 22',
        'Check the package documentation for Node.js version requirements',
      ],
      helpLinks: [
        { label: 'Node.js downloads', url: 'https://nodejs.org/en/download/' },
      ],
    }),
  },
  {
    pattern: /ERR_REQUIRE_ESM|exports is not defined in ES module scope/i,
    category: 'version',
    build: () => ({
      title: 'Module format mismatch',
      explanation:
        `There is a conflict between old-style (CommonJS) and new-style (ESM) modules. ` +
        `Try uninstalling the package, clearing the cache, and reinstalling it fresh.`,
      severity: 'medium',
      category: 'version',
      technicalDetail: 'ERR_REQUIRE_ESM',
      nextSteps: [
        'Clear cache and reinstall: rm -rf node_modules && npm cache clean --force && npm install',
        'Try downgrading the package to a CommonJS-compatible version',
        'Or add "type": "module" to your package.json',
      ],
      helpLinks: [
        { label: 'Node.js ESM documentation', url: 'https://nodejs.org/api/esm.html' },
      ],
    }),
  },
  {
    pattern: /version .+ not found/i,
    category: 'version',
    build: (ctx) => {
      const verMatch = ctx.combined.match(/version\s+(\S+)\s+not found/i);
      const ver = verMatch ? verMatch[1] : 'the requested version';
      return {
        title: `Version ${ver} not available`,
        explanation:
          `The version "${ver}" could not be found in the registry. ` +
          `Check available versions and try specifying a valid one.`,
        severity: 'medium',
        category: 'version',
        technicalDetail: `version ${ver} not found`,
        nextSteps: [
          'List available versions: npm view <package> versions',
          'Install the latest version instead: npm install <package>@latest',
          'Check the package documentation for valid version ranges',
        ],
        helpLinks: [
          { label: 'npm package search', url: 'https://www.npmjs.com/' },
        ],
      };
    },
  },

  // ---- Configuration errors ----
  {
    pattern: /EJSONPARSE|SyntaxError.*JSON/i,
    category: 'configuration',
    build: () => ({
      title: 'Configuration file is broken',
      explanation:
        `A JSON configuration file (like .npmrc or package.json) contains a syntax error. ` +
        `Try backing up the file and recreating it, or fix the JSON formatting.`,
      severity: 'medium',
      category: 'configuration',
      technicalDetail: 'EJSONPARSE',
      nextSteps: [
        'Check package.json for syntax errors (missing commas, quotes, etc.)',
        'Use a JSON validator to find the error',
        'If the file is corrupted, restore from a backup or recreate it',
      ],
      helpLinks: [
        { label: 'JSON validator', url: 'https://jsonlint.com/' },
      ],
    }),
  },
  {
    pattern: /proxy.*ECONNREFUSED|proxy.*config/i,
    category: 'configuration',
    build: () => ({
      title: 'Proxy settings are incorrect',
      explanation:
        `Your npm proxy configuration points to a server that is not available. ` +
        `If you are not behind a proxy, remove the proxy settings with ` +
        `"npm config delete proxy" and "npm config delete https-proxy".`,
      severity: 'medium',
      category: 'configuration',
      technicalDetail: 'proxy configuration error',
      nextSteps: [
        'Remove proxy: npm config delete proxy && npm config delete https-proxy',
        'Or update proxy settings to the correct address',
        'Check your .npmrc file for proxy configuration',
      ],
      helpLinks: [
        { label: 'npm proxy configuration', url: 'https://docs.npmjs.com/cli/v10/using-npm/config#proxy' },
      ],
    }),
  },
  {
    pattern: /Invalid configuration|Invalid (option|flag|argument)/i,
    category: 'configuration',
    build: (ctx) => ({
      title: 'Invalid configuration',
      explanation:
        `A configuration setting or command-line option is not valid. ` +
        `Check the command arguments and configuration files for typos.`,
      severity: 'medium',
      category: 'configuration',
      technicalDetail: extractMatch(ctx.combined, /Invalid\s+\S+/i),
      nextSteps: [
        'Check command arguments for typos',
        'Review configuration files (.npmrc, package.json)',
        'Run the command with --help to see valid options',
      ],
      helpLinks: [],
    }),
  },
];

// ============================================================================
// Public API
// ============================================================================

/**
 * Convert a technical error into a plain-language message.
 *
 * Matches the stderr/stdout content against known error patterns and
 * returns a user-friendly message. Falls back to a generic message
 * when no pattern matches.
 *
 * @param errorContext - The error context from a failed step
 * @returns A plain-language error message
 *
 * @example
 * ```ts
 * const msg = formatPlainError({
 *   stepId: 'install-pnpm',
 *   command: 'npm install -g pnpm',
 *   exitCode: 1,
 *   stderr: 'EACCES: permission denied /usr/local/lib',
 *   stdout: '',
 *   environment: envInfo,
 *   previousSteps: [],
 * });
 * console.log(msg.title);       // "Permission denied"
 * console.log(msg.explanation);  // "Your user account does not have..."
 * ```
 */
export function formatPlainError(errorContext: ErrorContext): PlainErrorMessage {
  const ctx: ErrorMessageContext = {
    command: errorContext.command,
    exitCode: errorContext.exitCode,
    stderr: errorContext.stderr,
    stdout: errorContext.stdout,
    combined: `${errorContext.stdout}\n${errorContext.stderr}`,
  };

  for (const rule of MESSAGE_RULES) {
    if (rule.pattern.test(ctx.combined)) {
      return rule.build(ctx);
    }
  }

  return buildFallbackMessage(ctx);
}

/**
 * Convert a raw stderr/stdout pair into a plain-language message.
 *
 * Convenience function when a full ErrorContext is not available.
 *
 * @param stderr - Standard error output
 * @param stdout - Standard output (optional)
 * @param command - The command that failed (optional, for display)
 * @returns A plain-language error message
 */
export function formatPlainErrorFromOutput(
  stderr: string,
  stdout: string = '',
  command: string = '',
): PlainErrorMessage {
  const ctx: ErrorMessageContext = {
    command,
    exitCode: 1,
    stderr,
    stdout,
    combined: `${stdout}\n${stderr}`,
  };

  for (const rule of MESSAGE_RULES) {
    if (rule.pattern.test(ctx.combined)) {
      return rule.build(ctx);
    }
  }

  return buildFallbackMessage(ctx);
}

/**
 * Get the plain-language category label for an error category.
 *
 * @param category - The error category
 * @returns A human-readable label
 */
export function getCategoryLabel(category: ErrorCategory): string {
  return CATEGORY_LABELS[category];
}

/**
 * Get the severity label for a given severity level.
 *
 * @param severity - The severity level
 * @returns A human-readable label
 */
export function getSeverityLabel(severity: ErrorSeverity): string {
  return SEVERITY_LABELS[severity];
}

/**
 * Get actionable next-step suggestions for an error.
 *
 * Convenience function that extracts the nextSteps from a formatted error.
 *
 * @param errorContext - The error context from a failed step
 * @returns An array of actionable suggestions
 */
export function getNextSteps(errorContext: ErrorContext): string[] {
  return formatPlainError(errorContext).nextSteps;
}

/**
 * Get relevant help links for an error.
 *
 * Convenience function that extracts the helpLinks from a formatted error.
 *
 * @param errorContext - The error context from a failed step
 * @returns An array of help links
 */
export function getHelpLinks(errorContext: ErrorContext): HelpLink[] {
  return formatPlainError(errorContext).helpLinks;
}

/**
 * Render a PlainErrorMessage to a single formatted string for terminal output.
 *
 * Produces a multi-line block like:
 * ```
 * [High] Permission denied
 * Your user account does not have permission...
 * (EACCES: permission denied /usr/local/lib)
 * ```
 *
 * @param msg - The plain error message to render
 * @returns A formatted string ready for console output
 */
export function renderPlainError(msg: PlainErrorMessage): string {
  const lines: string[] = [];

  const sevLabel = SEVERITY_LABELS[msg.severity];
  lines.push(`[${sevLabel}] ${msg.title}`);
  lines.push(msg.explanation);

  if (msg.technicalDetail) {
    lines.push(`(${msg.technicalDetail})`);
  }

  if (msg.nextSteps.length > 0) {
    lines.push('');
    lines.push('Next steps:');
    for (const step of msg.nextSteps) {
      lines.push(`  - ${step}`);
    }
  }

  if (msg.helpLinks.length > 0) {
    lines.push('');
    lines.push('Help links:');
    for (const link of msg.helpLinks) {
      lines.push(`  - ${link.label}: ${link.url}`);
    }
  }

  return lines.join('\n');
}

/**
 * Render a PlainErrorMessage with color highlighting for terminal output.
 *
 * Applies color-coded severity badges, bold titles, category labels,
 * and dim technical details. Key terms in the explanation text
 * (quoted commands, paths, version numbers) are also highlighted.
 *
 * Produces output like:
 * ```
 *  ✖ [Critical] Permission denied  (Permission problem)
 *    Your user account does not have permission to write to the
 *    required directory. You can fix this by running "pnpm setup"...
 *    (EACCES: permission denied /usr/local/lib)
 * ```
 *
 * @param msg - The plain error message to render
 * @returns A color-formatted string ready for console output
 */
export function renderHighlightedError(msg: PlainErrorMessage): string {
  const lines: string[] = [];

  const sevLabel = SEVERITY_LABELS[msg.severity];
  const sevColor = getSeverityColor(msg.severity);
  const catLabel = CATEGORY_LABELS[msg.category];

  // Header line: icon + colored severity badge + bold title + dim category
  const icon = msg.severity === 'critical' || msg.severity === 'high' ? '✖' : '▲';
  lines.push(
    ` ${sevColor(icon)} ${sevColor(`[${sevLabel}]`)} ${chalk.bold(msg.title)}  ${chalk.dim(`(${catLabel})`)}`,
  );

  // Explanation with highlighted keywords
  const highlighted = highlightKeywords(msg.explanation);
  lines.push(`   ${highlighted}`);

  // Technical detail in dim
  if (msg.technicalDetail) {
    lines.push(`   ${chalk.dim(`(${msg.technicalDetail})`)}`);
  }

  // Next steps with styled bullets
  if (msg.nextSteps.length > 0) {
    lines.push('');
    lines.push(`   ${chalk.bold('Next steps:')}`);
    for (const step of msg.nextSteps) {
      lines.push(`   ${chalk.green('→')} ${highlightKeywords(step)}`);
    }
  }

  // Help links with styled bullets
  if (msg.helpLinks.length > 0) {
    lines.push('');
    lines.push(`   ${chalk.bold('Help links:')}`);
    for (const link of msg.helpLinks) {
      lines.push(`   ${chalk.blue('◆')} ${link.label}: ${chalk.underline.blue(link.url)}`);
    }
  }

  return lines.join('\n');
}

/**
 * Get the chalk color function for a given severity level.
 *
 * - critical → red + bold
 * - high → red
 * - medium → yellow
 * - low → cyan
 *
 * @param severity - The error severity level
 * @returns A chalk colorizer function
 */
export function getSeverityColor(severity: ErrorSeverity): (text: string) => string {
  switch (severity) {
    case 'critical':
      return (text: string) => chalk.bold.red(text);
    case 'high':
      return chalk.red;
    case 'medium':
      return chalk.yellow;
    case 'low':
      return chalk.cyan;
  }
}

/**
 * Highlight key terms in an explanation string.
 *
 * Applies visual emphasis to:
 * - Quoted strings like `"npm install"` → bold accent color
 * - File paths like `/usr/local/lib` → underlined
 * - Version patterns like `v22.0.0` or `22` (standalone) → green
 *
 * @param text - The explanation text to process
 * @returns The text with ANSI highlighting applied
 */
export function highlightKeywords(text: string): string {
  // 1. Highlight quoted strings (commands, package names, etc.)
  let result = text.replace(/"([^"]+)"/g, (_match, inner) => {
    return `"${chalk.bold.hex('#FF7A3D')(inner)}"`;
  });

  // 2. Highlight file paths (starting with /) that are NOT inside quotes
  //    Only match paths with at least two segments to avoid false positives
  result = result.replace(/(?<!")(\/([\w.-]+\/)+[\w.-]+)(?!")/g, (_match, path) => {
    return chalk.underline(path);
  });

  // 3. Highlight standalone version numbers like v22, v22.0.0, 22.04
  result = result.replace(/\bv?\d+\.\d+(\.\d+)?\b/g, (match) => {
    return chalk.green(match);
  });

  return result;
}

// ============================================================================
// Internals
// ============================================================================

const CATEGORY_LABELS: Record<ErrorCategory, string> = {
  network: 'Network problem',
  permission: 'Permission problem',
  dependency: 'Missing dependency',
  version: 'Version mismatch',
  configuration: 'Configuration problem',
  unknown: 'Unexpected error',
};

const SEVERITY_LABELS: Record<ErrorSeverity, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  critical: 'Critical',
};

/** Build a generic fallback when no pattern matches. */
function buildFallbackMessage(ctx: ErrorMessageContext): PlainErrorMessage {
  const firstLine = (ctx.stderr || ctx.stdout).split('\n').filter(Boolean)[0] ?? '';
  const detail = firstLine.length > 120 ? firstLine.slice(0, 120) + '...' : firstLine;

  return {
    title: 'Something went wrong',
    explanation:
      ctx.command
        ? `The command "${ctx.command}" exited with an error (code ${ctx.exitCode}). ` +
          `Review the output above for details.`
        : `An unexpected error occurred (code ${ctx.exitCode}). Review the output above for details.`,
    severity: 'medium',
    category: 'unknown',
    technicalDetail: detail || undefined,
    nextSteps: [
      'Review the error output above for more details',
      'Search for the error message online',
      'Retry the command',
    ],
    helpLinks: [
      { label: 'AI Installer troubleshooting', url: 'https://github.com/anthropics/ai-installer#troubleshooting' },
    ],
  };
}

/** Safely extract the first regex match from a string. */
function extractMatch(text: string, pattern: RegExp): string | undefined {
  const m = text.match(pattern);
  return m ? m[0] : undefined;
}
