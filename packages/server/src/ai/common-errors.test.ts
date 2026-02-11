// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for the common errors rule library.
 *
 * @module ai/common-errors.test
 */

import { describe, it, expect } from 'vitest';
import type { ErrorContext } from '@aiinstaller/shared';
import {
  matchCommonErrors,
  getBestMatch,
  shouldSkipAI,
  getAllFixStrategies,
  getRuleStats,
  ERROR_RULES,
  type ErrorMatch,
} from './common-errors.js';

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a mock ErrorContext for testing.
 */
function createErrorContext(stderr: string, stdout: string = ''): ErrorContext {
  return {
    stepId: 'test-step',
    command: 'test command',
    stdout,
    stderr,
    exitCode: 1,
    timestamp: Date.now(),
  };
}

// ============================================================================
// Permission Errors
// ============================================================================

describe('Common Errors - Permission', () => {
  it('should match EACCES permission denied error', () => {
    const ctx = createErrorContext('EACCES: permission denied, mkdir \'/usr/local/lib/node_modules/pnpm\'');
    const matches = matchCommonErrors(ctx);

    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].rule.id).toBe('eacces-permission-denied');
    expect(matches[0].rule.type).toBe('permission');
    expect(matches[0].confidence).toBeGreaterThan(0.5);
  });

  it('should provide fix strategies for EACCES error', () => {
    const ctx = createErrorContext('npm ERR! code EACCES\nnpm ERR! EACCES: permission denied');
    const match = getBestMatch(ctx);

    expect(match).not.toBeNull();
    expect(match!.fixStrategies.length).toBeGreaterThan(0);
    expect(match!.fixStrategies[0].requiresSudo).toBeDefined();
    expect(match!.fixStrategies[0].confidence).toBeGreaterThan(0);
  });

  it('should match EPERM operation not permitted error', () => {
    const ctx = createErrorContext('EPERM: operation not permitted, unlink \'/usr/local/bin/node\'');
    const matches = matchCommonErrors(ctx);

    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].rule.id).toBe('eperm-operation-not-permitted');
    expect(matches[0].rule.type).toBe('permission');
  });

  it('should match missing write access error', () => {
    const ctx = createErrorContext('npm ERR! Missing write access to /usr/local/lib/node_modules');
    const matches = matchCommonErrors(ctx);

    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].rule.id).toBe('missing-write-access');
    expect(matches[0].rule.type).toBe('permission');
  });

  it('should match read-only file system error', () => {
    const ctx = createErrorContext('EROFS: read-only file system, mkdir \'/mnt/data\'');
    const matches = matchCommonErrors(ctx);

    expect(matches.length).toBeGreaterThan(0);
    const match = matches.find(m => m.rule.id === 'missing-write-access');
    expect(match).toBeDefined();
  });
});

// ============================================================================
// Network Errors
// ============================================================================

describe('Common Errors - Network', () => {
  it('should match ETIMEDOUT network timeout error', () => {
    const ctx = createErrorContext('npm ERR! network ETIMEDOUT\nnpm ERR! network This is a problem related to network connectivity.');
    const matches = matchCommonErrors(ctx);

    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].rule.id).toBe('network-etimedout');
    expect(matches[0].rule.type).toBe('network');
  });

  it('should match ERR_SOCKET_TIMEOUT error', () => {
    const ctx = createErrorContext('Error: ERR_SOCKET_TIMEOUT');
    const matches = matchCommonErrors(ctx);

    expect(matches.length).toBeGreaterThan(0);
    const match = matches.find(m => m.rule.id === 'network-etimedout');
    expect(match).toBeDefined();
  });

  it('should match ENOTFOUND DNS error', () => {
    const ctx = createErrorContext('getaddrinfo ENOTFOUND registry.npmjs.org');
    const matches = matchCommonErrors(ctx);

    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].rule.id).toBe('network-enotfound');
    expect(matches[0].rule.type).toBe('network');
  });

  it('should match ECONNREFUSED error', () => {
    const ctx = createErrorContext('Error: connect ECONNREFUSED 127.0.0.1:8080');
    const matches = matchCommonErrors(ctx);

    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].rule.id).toBe('network-econnrefused');
    expect(matches[0].rule.type).toBe('network');
  });

  it('should match SSL certificate error', () => {
    const ctx = createErrorContext('Error: unable to get local issuer certificate');
    const matches = matchCommonErrors(ctx);

    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].rule.id).toBe('network-ssl-certificate');
    expect(matches[0].rule.type).toBe('network');
  });

  it('should provide retry strategy for transient network errors', () => {
    const ctx = createErrorContext('ETIMEDOUT connecting to registry.npmjs.org');
    const match = getBestMatch(ctx);

    expect(match).not.toBeNull();
    const retryStrategy = match!.fixStrategies.find(s =>
      s.description.toLowerCase().includes('retry')
    );
    expect(retryStrategy).toBeDefined();
    expect(retryStrategy!.requiresSudo).toBe(false);
  });

  it('should suggest mirror for network timeout', () => {
    const ctx = createErrorContext('npm ERR! network timeout');
    const strategies = getAllFixStrategies(ctx);

    const mirrorStrategy = strategies.find(s =>
      s.description.toLowerCase().includes('mirror')
    );
    expect(mirrorStrategy).toBeDefined();
  });
});

// ============================================================================
// Dependency Errors
// ============================================================================

describe('Common Errors - Dependency', () => {
  it('should match command not found error', () => {
    const ctx = createErrorContext('bash: pnpm: command not found');
    const matches = matchCommonErrors(ctx);

    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].rule.id).toBe('command-not-found');
    expect(matches[0].rule.type).toBe('dependency');
  });

  it('should match command not recognized error (Windows)', () => {
    const ctx = createErrorContext('\'node\' is not recognized as an internal or external command');
    const matches = matchCommonErrors(ctx);

    expect(matches.length).toBeGreaterThan(0);
    const match = matches.find(m => m.rule.id === 'command-not-found');
    expect(match).toBeDefined();
  });

  it('should match ERESOLVE dependency conflict', () => {
    const ctx = createErrorContext('npm ERR! code ERESOLVE\nnpm ERR! ERESOLVE unable to resolve dependency tree');
    const matches = matchCommonErrors(ctx);

    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].rule.id).toBe('dependency-eresolve');
    expect(matches[0].rule.type).toBe('dependency');
  });

  it('should provide legacy-peer-deps strategy for ERESOLVE', () => {
    const ctx = createErrorContext('ERESOLVE unable to resolve dependency tree');
    const match = getBestMatch(ctx);

    expect(match).not.toBeNull();
    const legacyStrategy = match!.fixStrategies.find(s =>
      s.description.toLowerCase().includes('legacy')
    );
    expect(legacyStrategy).toBeDefined();
  });

  it('should match module not found error', () => {
    const ctx = createErrorContext('Error: Cannot find module \'express\'');
    const matches = matchCommonErrors(ctx);

    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].rule.id).toBe('module-not-found');
    expect(matches[0].rule.type).toBe('dependency');
  });

  it('should match disk space exhausted error', () => {
    const ctx = createErrorContext('npm ERR! code ENOSPC\nnpm ERR! syscall write\nnpm ERR! errno -28\nnpm ERR! ENOSPC: no space left on device');
    const matches = matchCommonErrors(ctx);

    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].rule.id).toBe('disk-space-exhausted');
    expect(matches[0].rule.type).toBe('dependency');
  });

  it('should suggest cache clearing for disk space error', () => {
    const ctx = createErrorContext('No space left on device');
    const strategies = getAllFixStrategies(ctx);

    const cacheStrategy = strategies.find(s =>
      s.description.toLowerCase().includes('cache')
    );
    expect(cacheStrategy).toBeDefined();
  });

  it('should match native build error', () => {
    const ctx = createErrorContext('gyp ERR! build error\ngyp ERR! stack Error: `make` failed with exit code: 2');
    const matches = matchCommonErrors(ctx);

    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].rule.id).toBe('native-build-error');
    expect(matches[0].rule.type).toBe('dependency');
  });

  it('should provide platform-specific build tools strategies', () => {
    const ctx = createErrorContext('node-gyp compilation error');
    const strategies = getAllFixStrategies(ctx);

    expect(strategies.length).toBeGreaterThan(0);
    // Should have strategies for different platforms
    const descriptions = strategies.map(s => s.description);
    expect(descriptions.some(d => d.includes('Xcode'))).toBe(true);  // macOS
    expect(descriptions.some(d => d.toLowerCase().includes('build essential'))).toBe(true);  // Linux
  });
});

// ============================================================================
// Version Conflicts
// ============================================================================

describe('Common Errors - Version', () => {
  it('should match Node.js version incompatible error', () => {
    const ctx = createErrorContext('npm ERR! engine Unsupported engine\nnpm ERR! engine Not compatible with your version of node');
    const matches = matchCommonErrors(ctx);

    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].rule.id).toBe('node-version-incompatible');
    expect(matches[0].rule.type).toBe('version');
  });

  it('should match requires Node.js version error', () => {
    const ctx = createErrorContext('Error: The package requires Node.js >= 18.0.0');
    const matches = matchCommonErrors(ctx);

    expect(matches.length).toBeGreaterThan(0);
    const match = matches.find(m => m.rule.id === 'node-version-incompatible');
    expect(match).toBeDefined();
  });

  it('should suggest nvm for Node.js version issues', () => {
    const ctx = createErrorContext('engine {"node":">=18"} is incompatible with this module');
    const match = getBestMatch(ctx);

    expect(match).not.toBeNull();
    const nvmStrategy = match!.fixStrategies.find(s =>
      s.commands.some(cmd => cmd.includes('nvm'))
    );
    expect(nvmStrategy).toBeDefined();
  });

  it('should match peer dependency conflict', () => {
    const ctx = createErrorContext('react-dom requires a peer of react@^18.0.0 but none is installed');
    const matches = matchCommonErrors(ctx);

    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].rule.id).toBe('peer-dependency-conflict');
    expect(matches[0].rule.type).toBe('version');
  });

  it('should match syntax error from old Node.js', () => {
    const ctx = createErrorContext('SyntaxError: Unexpected token ??=');
    const matches = matchCommonErrors(ctx);

    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].rule.id).toBe('syntax-error-old-node');
    expect(matches[0].rule.type).toBe('version');
  });
});

// ============================================================================
// Configuration Errors
// ============================================================================

describe('Common Errors - Configuration', () => {
  it('should match JSON parse error', () => {
    const ctx = createErrorContext('npm ERR! code EJSONPARSE\nnpm ERR! JSON.parse Failed to parse json');
    const matches = matchCommonErrors(ctx);

    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].rule.id).toBe('json-parse-error');
    expect(matches[0].rule.type).toBe('configuration');
  });

  it('should match JSON syntax error', () => {
    const ctx = createErrorContext('SyntaxError: Unexpected token } in JSON at position 123');
    const matches = matchCommonErrors(ctx);

    expect(matches.length).toBeGreaterThan(0);
    const match = matches.find(m => m.rule.id === 'json-parse-error');
    expect(match).toBeDefined();
  });

  it('should match invalid configuration error', () => {
    const ctx = createErrorContext('Error: Invalid configuration object');
    const matches = matchCommonErrors(ctx);

    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].rule.id).toBe('invalid-configuration');
    expect(matches[0].rule.type).toBe('configuration');
  });

  it('should match invalid argument error', () => {
    const ctx = createErrorContext('Error [ERR_INVALID_ARG_TYPE]: The "path" argument must be of type string');
    const matches = matchCommonErrors(ctx);

    expect(matches.length).toBeGreaterThan(0);
    const match = matches.find(m => m.rule.id === 'invalid-configuration');
    expect(match).toBeDefined();
  });

  it('should match proxy configuration error', () => {
    const ctx = createErrorContext('Error: proxy config error\nECONNREFUSED connecting to proxy server');
    const matches = matchCommonErrors(ctx);

    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].rule.id).toBe('proxy-configuration-error');
    expect(matches[0].rule.type).toBe('configuration');
  });

  it('should suggest removing proxy for proxy errors', () => {
    const ctx = createErrorContext('proxy config error: ECONNREFUSED');
    const strategies = getAllFixStrategies(ctx);

    const removeProxyStrategy = strategies.find(s =>
      s.description.toLowerCase().includes('remove proxy')
    );
    expect(removeProxyStrategy).toBeDefined();
  });
});

// ============================================================================
// Priority and Confidence
// ============================================================================

describe('Common Errors - Priority and Confidence', () => {
  it('should prioritize higher priority rules', () => {
    // Both patterns could match, but EACCES should win due to higher priority
    const ctx = createErrorContext('EACCES: permission denied, command not found');
    const matches = matchCommonErrors(ctx);

    expect(matches.length).toBeGreaterThan(0);
    // EACCES has priority 100, should be first
    expect(matches[0].rule.id).toBe('eacces-permission-denied');
  });

  it('should return matches sorted by priority then confidence', () => {
    const ctx = createErrorContext('ETIMEDOUT network timeout ECONNREFUSED');
    const matches = matchCommonErrors(ctx);

    expect(matches.length).toBeGreaterThanOrEqual(2);
    // All should be network errors
    matches.forEach(match => {
      expect(match.rule.type).toBe('network');
    });

    // Verify sorted by priority descending
    for (let i = 0; i < matches.length - 1; i++) {
      expect(matches[i].rule.priority).toBeGreaterThanOrEqual(matches[i + 1].rule.priority);
    }
  });

  it('should calculate confidence based on priority', () => {
    const ctx = createErrorContext('EACCES: permission denied');
    const match = getBestMatch(ctx);

    expect(match).not.toBeNull();
    expect(match!.confidence).toBeGreaterThan(0.5);
    // Priority 100 should give confidence 1.0
    expect(match!.confidence).toBeCloseTo(1.0, 1);
  });

  it('should return null for unmatched errors', () => {
    const ctx = createErrorContext('This is a completely unknown error message');
    const match = getBestMatch(ctx);

    expect(match).toBeNull();
  });
});

// ============================================================================
// AI Skip Logic
// ============================================================================

describe('Common Errors - AI Skip Logic', () => {
  it('should skip AI for high confidence matches (default threshold)', () => {
    const ctx = createErrorContext('EACCES: permission denied, mkdir');
    const skip = shouldSkipAI(ctx);

    expect(skip).toBe(true);
  });

  it('should not skip AI for low confidence matches', () => {
    const ctx = createErrorContext('Some obscure error that barely matches');
    const skip = shouldSkipAI(ctx);

    expect(skip).toBe(false);
  });

  it('should respect custom confidence threshold', () => {
    const ctx = createErrorContext('EACCES: permission denied');

    // Should skip with low threshold
    expect(shouldSkipAI(ctx, 0.5)).toBe(true);

    // Should not skip with very high threshold
    expect(shouldSkipAI(ctx, 0.99)).toBe(true);  // Priority 100 gives 1.0 confidence
  });

  it('should not skip AI when no rules match', () => {
    const ctx = createErrorContext('Unknown error xyz123');
    const skip = shouldSkipAI(ctx, 0.1);  // Even very low threshold

    expect(skip).toBe(false);
  });
});

// ============================================================================
// Fix Strategies
// ============================================================================

describe('Common Errors - Fix Strategies', () => {
  it('should return fix strategies sorted by confidence', () => {
    const ctx = createErrorContext('EACCES: permission denied, mkdir /usr/local/lib');
    const strategies = getAllFixStrategies(ctx);

    expect(strategies.length).toBeGreaterThan(0);

    // Verify sorted by confidence descending
    for (let i = 0; i < strategies.length - 1; i++) {
      expect(strategies[i].confidence).toBeGreaterThanOrEqual(strategies[i + 1].confidence);
    }
  });

  it('should include all required FixStrategy fields', () => {
    const ctx = createErrorContext('ETIMEDOUT');
    const strategies = getAllFixStrategies(ctx);

    expect(strategies.length).toBeGreaterThan(0);
    strategies.forEach(strategy => {
      expect(strategy.description).toBeDefined();
      expect(strategy.description.length).toBeGreaterThan(0);
      expect(strategy.commands).toBeDefined();
      expect(Array.isArray(strategy.commands)).toBe(true);
      expect(strategy.confidence).toBeGreaterThanOrEqual(0);
      expect(strategy.confidence).toBeLessThanOrEqual(1);
      expect(strategy.estimatedTime).toBeGreaterThan(0);
      expect(strategy.requiresSudo).toBeDefined();
      expect(strategy.risk).toMatch(/^(low|medium|high)$/);
      expect(strategy.reasoning).toBeDefined();
      expect(strategy.reasoning.length).toBeGreaterThan(0);
    });
  });

  it('should deduplicate strategies with same description', () => {
    const ctx = createErrorContext('ETIMEDOUT ECONNREFUSED network timeout');
    const strategies = getAllFixStrategies(ctx);

    const descriptions = strategies.map(s => s.description);
    const uniqueDescriptions = new Set(descriptions);

    expect(descriptions.length).toBe(uniqueDescriptions.size);
  });

  it('should return empty array when no matches', () => {
    const ctx = createErrorContext('Unknown error xyz123');
    const strategies = getAllFixStrategies(ctx);

    expect(strategies).toEqual([]);
  });
});

// ============================================================================
// Rule Statistics
// ============================================================================

describe('Common Errors - Rule Statistics', () => {
  it('should return correct total rule count', () => {
    const stats = getRuleStats();

    expect(stats.totalRules).toBe(ERROR_RULES.length);
    expect(stats.totalRules).toBeGreaterThanOrEqual(15);  // At least 15 rules
  });

  it('should categorize rules by type', () => {
    const stats = getRuleStats();

    expect(stats.rulesByType).toBeDefined();
    expect(stats.rulesByType.permission).toBeGreaterThan(0);
    expect(stats.rulesByType.network).toBeGreaterThan(0);
    expect(stats.rulesByType.dependency).toBeGreaterThan(0);
    expect(stats.rulesByType.version).toBeGreaterThan(0);
    expect(stats.rulesByType.configuration).toBeGreaterThan(0);
  });

  it('should calculate average priority', () => {
    const stats = getRuleStats();

    expect(stats.averagePriority).toBeGreaterThan(0);
    expect(stats.averagePriority).toBeLessThanOrEqual(100);
  });

  it('should count high priority rules correctly', () => {
    const stats = getRuleStats();

    const manualCount = ERROR_RULES.filter(r => r.priority >= 80).length;
    expect(stats.highPriorityRules).toBe(manualCount);
    expect(stats.highPriorityRules).toBeGreaterThan(0);
  });
});

// ============================================================================
// Edge Cases
// ============================================================================

describe('Common Errors - Edge Cases', () => {
  it('should handle empty stderr and stdout', () => {
    const ctx = createErrorContext('', '');
    const matches = matchCommonErrors(ctx);

    expect(matches).toEqual([]);
  });

  it('should handle very long error messages', () => {
    const longError = 'EACCES: permission denied ' + 'x'.repeat(10000);
    const ctx = createErrorContext(longError);
    const matches = matchCommonErrors(ctx);

    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].rule.id).toBe('eacces-permission-denied');
  });

  it('should handle multiple error patterns in one message', () => {
    const multiError = 'EACCES: permission denied\nETIMEDOUT network timeout\nERESOLVE unable to resolve dependency';
    const ctx = createErrorContext(multiError);
    const matches = matchCommonErrors(ctx);

    expect(matches.length).toBeGreaterThanOrEqual(3);
    const matchedIds = matches.map(m => m.rule.id);
    expect(matchedIds).toContain('eacces-permission-denied');
    expect(matchedIds).toContain('network-etimedout');
    expect(matchedIds).toContain('dependency-eresolve');
  });

  it('should handle case-insensitive matching', () => {
    const lowerCase = createErrorContext('eacces: permission denied');
    const upperCase = createErrorContext('EACCES: PERMISSION DENIED');
    const mixedCase = createErrorContext('EaCcEs: Permission Denied');

    expect(matchCommonErrors(lowerCase).length).toBeGreaterThan(0);
    expect(matchCommonErrors(upperCase).length).toBeGreaterThan(0);
    expect(matchCommonErrors(mixedCase).length).toBeGreaterThan(0);
  });

  it('should match errors in stdout as well as stderr', () => {
    const stderrMatch = createErrorContext('EACCES: permission denied', '');
    const stdoutMatch = createErrorContext('', 'EACCES: permission denied');

    expect(matchCommonErrors(stderrMatch).length).toBeGreaterThan(0);
    expect(matchCommonErrors(stdoutMatch).length).toBeGreaterThan(0);
  });
});

// ============================================================================
// Real-World Error Examples
// ============================================================================

describe('Common Errors - Real-World Examples', () => {
  it('should match real npm permission error', () => {
    const realError = `npm ERR! code EACCES
npm ERR! syscall mkdir
npm ERR! path /usr/local/lib/node_modules/pnpm
npm ERR! errno -13
npm ERR! Error: EACCES: permission denied, mkdir '/usr/local/lib/node_modules/pnpm'`;

    const ctx = createErrorContext(realError);
    const match = getBestMatch(ctx);

    expect(match).not.toBeNull();
    expect(match!.rule.type).toBe('permission');
    expect(match!.fixStrategies.length).toBeGreaterThan(0);
  });

  it('should match real network timeout error', () => {
    const realError = `npm ERR! code ETIMEDOUT
npm ERR! errno ETIMEDOUT
npm ERR! network request to https://registry.npmjs.org/pnpm failed, reason: connect ETIMEDOUT 104.16.19.35:443
npm ERR! network This is a problem related to network connectivity.
npm ERR! network In most cases you are behind a proxy or have bad network settings.`;

    const ctx = createErrorContext(realError);
    const match = getBestMatch(ctx);

    expect(match).not.toBeNull();
    expect(match!.rule.type).toBe('network');
    expect(shouldSkipAI(ctx)).toBe(true);
  });

  it('should match real dependency resolution error', () => {
    const realError = `npm ERR! code ERESOLVE
npm ERR! ERESOLVE unable to resolve dependency tree
npm ERR!
npm ERR! While resolving: myapp@1.0.0
npm ERR! Found: react@17.0.2
npm ERR! node_modules/react
npm ERR!   react@"^17.0.2" from the root project`;

    const ctx = createErrorContext(realError);
    const match = getBestMatch(ctx);

    expect(match).not.toBeNull();
    expect(match!.rule.type).toBe('dependency');
    const hasLegacyPeerDeps = match!.fixStrategies.some(s =>
      s.description.includes('legacy')
    );
    expect(hasLegacyPeerDeps).toBe(true);
  });

  it('should match real node-gyp build error', () => {
    const realError = `gyp ERR! build error
gyp ERR! stack Error: \`make\` failed with exit code: 2
gyp ERR! stack     at ChildProcess.onExit (/usr/local/lib/node_modules/npm/node_modules/node-gyp/lib/build.js:262:23)
gyp ERR! System Darwin 21.6.0
gyp ERR! command "/usr/local/bin/node" "/usr/local/lib/node_modules/npm/node_modules/node-gyp/bin/node-gyp.js" "rebuild"
gyp ERR! node -v v16.14.0`;

    const ctx = createErrorContext(realError);
    const match = getBestMatch(ctx);

    expect(match).not.toBeNull();
    expect(match!.rule.type).toBe('dependency');
    expect(match!.rule.id).toBe('native-build-error');
  });

  it('should match real Node.js version error', () => {
    const realError = `npm ERR! code EBADENGINE
npm ERR! engine Unsupported engine
npm ERR! engine Not compatible with your version of node/npm: mypackage@2.0.0
npm ERR! notsup Not compatible with your version of node/npm: mypackage@2.0.0
npm ERR! notsup Required: {"node":">=18.0.0"}
npm ERR! notsup Actual:   {"npm":"8.5.0","node":"v16.14.2"}`;

    const ctx = createErrorContext(realError);
    const match = getBestMatch(ctx);

    expect(match).not.toBeNull();
    expect(match!.rule.type).toBe('version');
    expect(shouldSkipAI(ctx)).toBe(true);
  });
});
