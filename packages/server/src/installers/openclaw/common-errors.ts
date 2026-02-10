/**
 * Common OpenClaw installation errors and their solutions.
 *
 * Provides a structured catalogue of frequently encountered errors during
 * OpenClaw installation, mapped to solution strategies that can be applied
 * automatically or suggested to the user.
 *
 * Works together with the rule-based error-analyzer (ai/error-analyzer.ts)
 * to close the loop: error-analyzer identifies the *type*, this module
 * provides the OpenClaw-specific *solutions*.
 *
 * @module installers/openclaw/common-errors
 */

import type { ErrorType } from '../../ai/error-analyzer.js';

// ============================================================================
// Types
// ============================================================================

/** A single solution step that can be executed or shown to the user. */
export interface SolutionStep {
  /** Human-readable description of the step */
  description: string;
  /** Shell command to execute (if applicable) */
  command?: string;
}

/** A solution strategy for a common error. */
export interface Solution {
  /** Unique identifier for this solution */
  id: string;
  /** Human-readable description */
  description: string;
  /** Ordered steps to resolve the error */
  steps: SolutionStep[];
  /** Estimated confidence that this solution will work (0.0 - 1.0) */
  confidence: number;
}

/** A common error entry with its signature, type, and solutions. */
export interface CommonError {
  /** Unique identifier for this error */
  id: string;
  /** Regex or string signature that identifies this error in stderr/stdout */
  signature: RegExp;
  /** The error type (aligns with ErrorType from error-analyzer) */
  type: ErrorType;
  /** Human-readable description of the error */
  description: string;
  /** Which install step(s) this error typically occurs in */
  stepIds: string[];
  /** Ordered solution strategies (most likely to succeed first) */
  solutions: Solution[];
}

// ============================================================================
// Common Errors
// ============================================================================

/**
 * Catalogue of common errors encountered during OpenClaw installation.
 *
 * Each entry links a recognizable error signature to one or more
 * solution strategies. Solutions are ordered by expected success rate.
 */
export const COMMON_ERRORS: readonly CommonError[] = [
  // ---- Permission errors ----
  {
    id: 'eacces-permission-denied',
    signature: /EACCES:\s*permission denied/i,
    type: 'permission',
    description: 'File system permission denied when installing packages globally',
    stepIds: ['install-pnpm', 'install-openclaw'],
    solutions: [
      {
        id: 'change-npm-prefix',
        description: 'Change npm global directory to a user-owned location',
        steps: [
          { description: 'Create user-owned npm directory', command: 'mkdir -p ~/.npm-global' },
          { description: 'Set npm prefix', command: 'npm config set prefix ~/.npm-global' },
          {
            description: 'Add to PATH',
            command: 'echo \'export PATH=~/.npm-global/bin:$PATH\' >> ~/.bashrc && source ~/.bashrc',
          },
        ],
        confidence: 0.85,
      },
      {
        id: 'use-sudo',
        description: 'Run the install command with sudo',
        steps: [
          { description: 'Re-run with elevated privileges', command: 'sudo npm install -g pnpm' },
        ],
        confidence: 0.7,
      },
      {
        id: 'fix-ownership',
        description: 'Fix ownership of the npm global directory',
        steps: [
          {
            description: 'Change ownership to current user',
            command: 'sudo chown -R $(whoami) $(npm config get prefix)/{lib/node_modules,bin,share}',
          },
        ],
        confidence: 0.75,
      },
    ],
  },
  {
    id: 'eperm-operation-not-permitted',
    signature: /EPERM:\s*operation not permitted/i,
    type: 'permission',
    description: 'Operation not permitted (may be caused by macOS SIP or file locking)',
    stepIds: ['install-pnpm', 'install-openclaw'],
    solutions: [
      {
        id: 'use-nvm',
        description: 'Use nvm to install Node.js in user space',
        steps: [
          { description: 'Install nvm', command: 'curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash' },
          { description: 'Install Node.js 22', command: 'nvm install 22' },
          { description: 'Use Node.js 22', command: 'nvm use 22' },
        ],
        confidence: 0.8,
      },
    ],
  },
  {
    id: 'missing-write-access',
    signature: /Missing write access/i,
    type: 'permission',
    description: 'No write access to the npm global install directory',
    stepIds: ['install-pnpm', 'install-openclaw'],
    solutions: [
      {
        id: 'pnpm-setup',
        description: 'Use pnpm setup to configure a user-writable global directory',
        steps: [
          { description: 'Run pnpm setup', command: 'pnpm setup' },
          { description: 'Reload shell configuration', command: 'source ~/.bashrc' },
        ],
        confidence: 0.85,
      },
    ],
  },

  // ---- Network errors ----
  {
    id: 'network-timeout',
    signature: /ETIMEDOUT|network\s+timeout|ERR_SOCKET_TIMEOUT/i,
    type: 'network',
    description: 'Network timeout when connecting to npm registry',
    stepIds: ['install-pnpm', 'install-openclaw'],
    solutions: [
      {
        id: 'use-mirror',
        description: 'Use a faster npm mirror registry',
        steps: [
          {
            description: 'Switch to npmmirror',
            command: 'npm config set registry https://registry.npmmirror.com',
          },
        ],
        confidence: 0.8,
      },
      {
        id: 'increase-timeout',
        description: 'Increase npm timeout settings',
        steps: [
          { description: 'Set fetch timeout to 5 minutes', command: 'npm config set fetch-timeout 300000' },
          { description: 'Set fetch retries to 5', command: 'npm config set fetch-retries 5' },
        ],
        confidence: 0.6,
      },
      {
        id: 'configure-proxy',
        description: 'Configure HTTP proxy if behind a corporate firewall',
        steps: [
          {
            description: 'Set HTTP proxy',
            command: 'npm config set proxy http://proxy.company.com:8080',
          },
          {
            description: 'Set HTTPS proxy',
            command: 'npm config set https-proxy http://proxy.company.com:8080',
          },
        ],
        confidence: 0.5,
      },
    ],
  },
  {
    id: 'dns-lookup-failed',
    signature: /ENOTFOUND/i,
    type: 'network',
    description: 'DNS lookup failed — cannot resolve registry hostname',
    stepIds: ['install-pnpm', 'install-openclaw'],
    solutions: [
      {
        id: 'change-dns',
        description: 'Switch to a public DNS server',
        steps: [
          {
            description: 'Check current DNS resolution',
            command: 'nslookup registry.npmjs.org',
          },
        ],
        confidence: 0.5,
      },
      {
        id: 'use-mirror',
        description: 'Use a mirror registry that may resolve differently',
        steps: [
          {
            description: 'Switch to npmmirror',
            command: 'npm config set registry https://registry.npmmirror.com',
          },
        ],
        confidence: 0.7,
      },
    ],
  },
  {
    id: 'ssl-certificate-error',
    signature: /unable to get local issuer certificate|CERT_HAS_EXPIRED|UNABLE_TO_VERIFY_LEAF_SIGNATURE/i,
    type: 'network',
    description: 'SSL/TLS certificate verification failed',
    stepIds: ['install-pnpm', 'install-openclaw'],
    solutions: [
      {
        id: 'update-ca-certs',
        description: 'Update CA certificates on the system',
        steps: [
          {
            description: 'Update CA certificates (Linux)',
            command: 'sudo update-ca-certificates',
          },
        ],
        confidence: 0.6,
      },
      {
        id: 'set-strict-ssl-false',
        description: 'Temporarily disable strict SSL (not recommended for production)',
        steps: [
          { description: 'Disable strict SSL check', command: 'npm config set strict-ssl false' },
        ],
        confidence: 0.8,
      },
    ],
  },
  {
    id: 'connection-refused',
    signature: /ECONNREFUSED/i,
    type: 'network',
    description: 'Connection refused — registry or proxy server is unreachable',
    stepIds: ['install-pnpm', 'install-openclaw'],
    solutions: [
      {
        id: 'check-proxy',
        description: 'Check and clear proxy configuration',
        steps: [
          { description: 'View current proxy settings', command: 'npm config get proxy' },
          { description: 'Remove proxy if incorrect', command: 'npm config delete proxy' },
          { description: 'Remove HTTPS proxy if incorrect', command: 'npm config delete https-proxy' },
        ],
        confidence: 0.7,
      },
    ],
  },

  // ---- Dependency errors ----
  {
    id: 'command-not-found-node',
    signature: /node:\s*command not found|'node' is not recognized/i,
    type: 'dependency',
    description: 'Node.js is not installed or not in PATH',
    stepIds: ['check-node'],
    solutions: [
      {
        id: 'install-node-nvm',
        description: 'Install Node.js using nvm',
        steps: [
          { description: 'Install nvm', command: 'curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash' },
          { description: 'Reload shell', command: 'source ~/.bashrc' },
          { description: 'Install Node.js 22', command: 'nvm install 22' },
        ],
        confidence: 0.9,
      },
    ],
  },
  {
    id: 'command-not-found-pnpm',
    signature: /pnpm:\s*command not found|'pnpm' is not recognized/i,
    type: 'dependency',
    description: 'pnpm is not installed or not in PATH',
    stepIds: ['install-openclaw'],
    solutions: [
      {
        id: 'install-pnpm-corepack',
        description: 'Enable pnpm via corepack',
        steps: [
          { description: 'Enable corepack', command: 'corepack enable' },
          { description: 'Prepare pnpm', command: 'corepack prepare pnpm@latest --activate' },
        ],
        confidence: 0.85,
      },
      {
        id: 'install-pnpm-npm',
        description: 'Install pnpm via npm',
        steps: [
          { description: 'Install pnpm globally', command: 'npm install -g pnpm' },
        ],
        confidence: 0.8,
      },
    ],
  },
  {
    id: 'native-build-error',
    signature: /gyp ERR!|node-gyp|compilation?\s+error|make:\s+\*\*\*/i,
    type: 'dependency',
    description: 'Native module compilation failed — build tools may be missing',
    stepIds: ['install-openclaw'],
    solutions: [
      {
        id: 'install-build-tools-macos',
        description: 'Install Xcode command-line tools (macOS)',
        steps: [
          { description: 'Install Xcode CLT', command: 'xcode-select --install' },
        ],
        confidence: 0.8,
      },
      {
        id: 'install-build-tools-linux',
        description: 'Install build essentials (Linux)',
        steps: [
          {
            description: 'Install build dependencies',
            command: 'sudo apt-get install -y build-essential python3',
          },
        ],
        confidence: 0.8,
      },
    ],
  },
  {
    id: 'eresolve-dependency',
    signature: /ERESOLVE\s+unable to resolve|Could not resolve dependency/i,
    type: 'dependency',
    description: 'Dependency resolution conflict',
    stepIds: ['install-openclaw'],
    solutions: [
      {
        id: 'legacy-peer-deps',
        description: 'Install with legacy peer dependency resolution',
        steps: [
          {
            description: 'Retry with --legacy-peer-deps',
            command: 'npm install -g openclaw --legacy-peer-deps',
          },
        ],
        confidence: 0.7,
      },
      {
        id: 'force-install',
        description: 'Force install (use with caution)',
        steps: [
          { description: 'Force install', command: 'npm install -g openclaw --force' },
        ],
        confidence: 0.5,
      },
    ],
  },
  {
    id: 'disk-space-exhausted',
    signature: /ENOSPC|No space left on device/i,
    type: 'dependency',
    description: 'Disk space exhausted',
    stepIds: ['install-pnpm', 'install-openclaw'],
    solutions: [
      {
        id: 'clear-cache',
        description: 'Clear npm and pnpm caches to free disk space',
        steps: [
          { description: 'Clear npm cache', command: 'npm cache clean --force' },
          { description: 'Clear pnpm store', command: 'pnpm store prune' },
        ],
        confidence: 0.6,
      },
    ],
  },

  // ---- Version conflicts ----
  {
    id: 'node-version-too-old',
    signature: /requires Node\.js >= 22|Unsupported engine|engine .+ is incompatible/i,
    type: 'version',
    description: 'Node.js version is too old for OpenClaw (requires >= 22.0.0)',
    stepIds: ['check-node', 'install-openclaw'],
    solutions: [
      {
        id: 'upgrade-node-nvm',
        description: 'Upgrade Node.js to version 22 using nvm',
        steps: [
          { description: 'Install Node.js 22', command: 'nvm install 22' },
          { description: 'Set as default', command: 'nvm alias default 22' },
        ],
        confidence: 0.9,
      },
      {
        id: 'upgrade-node-brew',
        description: 'Upgrade Node.js via Homebrew (macOS)',
        steps: [
          { description: 'Install Node.js 22', command: 'brew install node@22' },
        ],
        confidence: 0.8,
      },
    ],
  },
  {
    id: 'syntax-error-old-node',
    signature: /SyntaxError:\s*Unexpected token '\?\?='/i,
    type: 'version',
    description: 'Node.js version does not support modern JavaScript syntax',
    stepIds: ['install-openclaw', 'verify-installation'],
    solutions: [
      {
        id: 'upgrade-node',
        description: 'Upgrade Node.js to a version that supports modern syntax',
        steps: [
          { description: 'Install Node.js 22', command: 'nvm install 22' },
          { description: 'Use Node.js 22', command: 'nvm use 22' },
        ],
        confidence: 0.9,
      },
    ],
  },
  {
    id: 'esm-cjs-conflict',
    signature: /ERR_REQUIRE_ESM|exports is not defined in ES module scope/i,
    type: 'version',
    description: 'ESM / CommonJS module system conflict',
    stepIds: ['install-openclaw', 'verify-installation'],
    solutions: [
      {
        id: 'clean-reinstall',
        description: 'Clean reinstall to resolve module format conflicts',
        steps: [
          { description: 'Uninstall openclaw', command: 'pnpm uninstall -g openclaw' },
          { description: 'Clear pnpm store', command: 'pnpm store prune' },
          { description: 'Reinstall openclaw', command: 'pnpm install -g openclaw' },
        ],
        confidence: 0.7,
      },
    ],
  },

  // ---- Configuration errors ----
  {
    id: 'json-parse-error',
    signature: /EJSONPARSE|SyntaxError.*JSON/i,
    type: 'configuration',
    description: 'JSON configuration file is malformed',
    stepIds: ['install-pnpm', 'install-openclaw', 'configure-openclaw'],
    solutions: [
      {
        id: 'reset-npmrc',
        description: 'Reset npm configuration to defaults',
        steps: [
          { description: 'Backup current .npmrc', command: 'cp ~/.npmrc ~/.npmrc.bak' },
          { description: 'Remove corrupt .npmrc', command: 'rm ~/.npmrc' },
        ],
        confidence: 0.7,
      },
    ],
  },
  {
    id: 'proxy-config-error',
    signature: /proxy.*ECONNREFUSED|proxy.*config/i,
    type: 'configuration',
    description: 'Proxy configuration is incorrect or proxy server is down',
    stepIds: ['install-pnpm', 'install-openclaw'],
    solutions: [
      {
        id: 'clear-proxy',
        description: 'Remove proxy configuration',
        steps: [
          { description: 'Remove HTTP proxy', command: 'npm config delete proxy' },
          { description: 'Remove HTTPS proxy', command: 'npm config delete https-proxy' },
          { description: 'Unset environment variable', command: 'unset HTTP_PROXY HTTPS_PROXY' },
        ],
        confidence: 0.7,
      },
    ],
  },
];

// ============================================================================
// Public API
// ============================================================================

/**
 * Find all common errors whose signature matches the given output.
 *
 * @param stderr - Standard error output from a failed command
 * @param stdout - Standard output from a failed command (optional)
 * @returns Array of matching CommonError entries, ordered by their position in the catalogue
 */
export function matchCommonErrors(stderr: string, stdout: string = ''): CommonError[] {
  const combined = `${stdout}\n${stderr}`;
  return COMMON_ERRORS.filter((entry) => entry.signature.test(combined));
}

/**
 * Find common errors that match a given output and are relevant to a specific step.
 *
 * @param stepId - The install step ID where the error occurred
 * @param stderr - Standard error output
 * @param stdout - Standard output (optional)
 * @returns Matching errors filtered to those relevant to the step
 */
export function matchCommonErrorsForStep(
  stepId: string,
  stderr: string,
  stdout: string = '',
): CommonError[] {
  return matchCommonErrors(stderr, stdout).filter(
    (entry) => entry.stepIds.includes(stepId),
  );
}

/**
 * Get the best solution for a matched common error.
 *
 * Returns the solution with the highest confidence from the first
 * matching error, or null if no match is found.
 *
 * @param stderr - Standard error output
 * @param stdout - Standard output (optional)
 * @returns The best solution, or null if no matching error was found
 */
export function getBestSolution(
  stderr: string,
  stdout: string = '',
): Solution | null {
  const matches = matchCommonErrors(stderr, stdout);
  if (matches.length === 0) return null;

  // Collect all solutions from all matches and pick the highest confidence
  let best: Solution | null = null;
  for (const match of matches) {
    for (const solution of match.solutions) {
      if (!best || solution.confidence > best.confidence) {
        best = solution;
      }
    }
  }

  return best;
}

/**
 * Get all solutions for a matched error output, sorted by confidence (descending).
 *
 * @param stderr - Standard error output
 * @param stdout - Standard output (optional)
 * @returns All applicable solutions sorted by confidence
 */
export function getAllSolutions(
  stderr: string,
  stdout: string = '',
): Solution[] {
  const matches = matchCommonErrors(stderr, stdout);
  const solutions: Solution[] = [];

  for (const match of matches) {
    solutions.push(...match.solutions);
  }

  // Deduplicate by solution id and sort by confidence descending
  const seen = new Set<string>();
  const unique: Solution[] = [];
  for (const s of solutions) {
    if (!seen.has(s.id)) {
      seen.add(s.id);
      unique.push(s);
    }
  }

  return unique.sort((a, b) => b.confidence - a.confidence);
}
