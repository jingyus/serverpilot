// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Common error rules data catalogue for AI Installer.
 *
 * Contains the comprehensive library of predefined error patterns with fix
 * strategies. This pure-data module is separated from the matching logic in
 * common-errors.ts to keep both files under the 500-line soft limit.
 *
 * Rules are organized by error type and priority. Higher priority rules
 * are more specific and should be checked first.
 *
 * Priority levels:
 * - 100: Critical, highly specific patterns (exact error codes)
 * - 80: High priority, specific patterns
 * - 60: Medium priority, moderately specific
 * - 40: Low priority, generic patterns
 *
 * @module ai/error-rules-data
 */

import type { ErrorRule } from './common-errors.js';

// ============================================================================
// Common Error Rules
// ============================================================================

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
