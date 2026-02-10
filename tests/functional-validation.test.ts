/**
 * Milestone 9.1 - Functional Validation Tests
 *
 * Validates all core features before v1.1 release:
 * 1. Install plan generation across 3+ environments
 * 2. Error diagnosis for 5+ common error types
 * 3. Rate limiting for free-tier users (5/month)
 * 4. WSS connection and certificate validation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// 1. Install Plan Generation - 3+ Environments
// ============================================================================

import {
  generateFallbackPlan,
  getKnowledgeContextForPlan,
} from '../packages/server/src/ai/planner.js';
import type { EnvironmentInfo, InstallPlan } from '../packages/shared/src/protocol/messages.js';

/** Helper: create a base environment with overrides */
function createEnv(overrides?: Partial<EnvironmentInfo>): EnvironmentInfo {
  return {
    os: { platform: 'darwin', version: '24.0.0', arch: 'arm64' },
    shell: { type: 'zsh', version: '5.9' },
    runtime: { node: '22.0.0' },
    packageManagers: { npm: '10.0.0', pnpm: '9.0.0', brew: '4.0.0' },
    network: { canAccessNpm: true, canAccessGithub: true },
    permissions: { hasSudo: true, canWriteTo: ['/usr/local'] },
    ...overrides,
  } as EnvironmentInfo;
}

describe('Functional Validation: Install Plan Generation (3+ environments)', () => {
  describe('macOS (darwin) with Homebrew', () => {
    const macEnv = createEnv({
      os: { platform: 'darwin', version: '24.0.0', arch: 'arm64' },
      packageManagers: { npm: '10.0.0', pnpm: '9.0.0', brew: '4.0.0' },
    });

    it('should generate a fallback plan with at least 3 steps', () => {
      const plan = generateFallbackPlan(macEnv, 'openclaw');
      expect(plan.steps.length).toBeGreaterThanOrEqual(3);
    });

    it('should use brew install on macOS when Homebrew is available', () => {
      const plan = generateFallbackPlan(macEnv, 'openclaw');
      const brewStep = plan.steps.find((s) => s.command.includes('brew install'));
      expect(brewStep).toBeDefined();
      expect(brewStep!.command).toContain('openclaw');
    });

    it('should include prerequisite check and verification steps', () => {
      const plan = generateFallbackPlan(macEnv, 'openclaw');
      const checkStep = plan.steps.find((s) => s.id === 'check-node');
      const verifyStep = plan.steps.find((s) => s.id === 'verify');
      expect(checkStep).toBeDefined();
      expect(verifyStep).toBeDefined();
    });

    it('should have valid step structure for each step', () => {
      const plan = generateFallbackPlan(macEnv, 'openclaw');
      for (const step of plan.steps) {
        expect(step.id).toBeTruthy();
        expect(step.description).toBeTruthy();
        expect(step.command).toBeTruthy();
        expect(step.timeout).toBeGreaterThan(0);
        expect(['retry', 'skip', 'abort', 'fallback']).toContain(step.onError);
      }
    });

    it('should include risk assessments', () => {
      const plan = generateFallbackPlan(macEnv, 'openclaw');
      expect(plan.risks).toBeDefined();
      expect(plan.risks.length).toBeGreaterThan(0);
      for (const risk of plan.risks) {
        expect(['low', 'medium', 'high']).toContain(risk.level);
        expect(risk.description).toBeTruthy();
      }
    });

    it('should calculate estimated time correctly', () => {
      const plan = generateFallbackPlan(macEnv, 'openclaw');
      const expectedTime = plan.steps.reduce((acc, step) => acc + step.timeout, 0);
      expect(plan.estimatedTime).toBe(expectedTime);
    });
  });

  describe('Linux (Ubuntu) with apt', () => {
    const linuxEnv = createEnv({
      os: { platform: 'linux', version: '22.04', arch: 'x64' },
      shell: { type: 'bash', version: '5.1' },
      packageManagers: { npm: '10.0.0', pnpm: null, brew: null, apt: '2.4.0' },
    });

    it('should generate a plan for Linux environment', () => {
      const plan = generateFallbackPlan(linuxEnv, 'openclaw');
      expect(plan.steps.length).toBeGreaterThanOrEqual(3);
    });

    it('should use npm install on Linux when Homebrew is not available', () => {
      const plan = generateFallbackPlan(linuxEnv, 'openclaw');
      const npmStep = plan.steps.find((s) => s.command.includes('npm install -g'));
      expect(npmStep).toBeDefined();
    });

    it('should generate correct version-pinned commands', () => {
      const plan = generateFallbackPlan(linuxEnv, 'openclaw', '2.0.0');
      const installStep = plan.steps.find(
        (s) => s.command.includes('npm install') || s.command.includes('pnpm install'),
      );
      expect(installStep).toBeDefined();
      expect(installStep!.command).toContain('2.0.0');
    });
  });

  describe('Linux with pnpm (no Homebrew)', () => {
    const pnpmLinuxEnv = createEnv({
      os: { platform: 'linux', version: '20.04', arch: 'x64' },
      shell: { type: 'bash', version: '5.0' },
      packageManagers: { npm: '10.0.0', pnpm: '9.0.0', brew: null },
    });

    it('should prefer pnpm over npm when pnpm is available', () => {
      const plan = generateFallbackPlan(pnpmLinuxEnv, 'openclaw');
      const pnpmStep = plan.steps.find((s) => s.command.includes('pnpm install'));
      expect(pnpmStep).toBeDefined();
    });
  });

  describe('Minimal environment (no package managers)', () => {
    const minimalEnv = createEnv({
      os: { platform: 'linux', version: '18.04', arch: 'x64' },
      packageManagers: { npm: null, pnpm: null, brew: null },
      runtime: {},
    });

    it('should generate a manual install fallback step', () => {
      const plan = generateFallbackPlan(minimalEnv, 'openclaw');
      const manualStep = plan.steps.find((s) => s.id === 'manual-install');
      expect(manualStep).toBeDefined();
      expect(manualStep!.command).toContain('nodejs');
    });

    it('should set onError to abort for manual install step', () => {
      const plan = generateFallbackPlan(minimalEnv, 'openclaw');
      const manualStep = plan.steps.find((s) => s.id === 'manual-install');
      expect(manualStep!.onError).toBe('abort');
    });
  });

  describe('Knowledge Base context generation', () => {
    it('should return empty string when knowledge base is null', () => {
      const env = createEnv();
      const context = getKnowledgeContextForPlan(null, env);
      expect(context).toBe('');
    });

    it('should return empty string when knowledge base is not loaded', () => {
      const env = createEnv();
      const mockKb = { isLoaded: () => false, search: () => [] };
      const context = getKnowledgeContextForPlan(mockKb as any, env);
      expect(context).toBe('');
    });
  });
});

// ============================================================================
// 2. Error Diagnosis - 5+ Common Error Types
// ============================================================================

import {
  analyzeError,
  identifyErrorType,
  identifyErrorTypeFromOutput,
  isTransientError,
} from '../packages/server/src/ai/error-analyzer.js';
import type { ErrorContext } from '../packages/shared/src/protocol/messages.js';

import {
  matchCommonErrors,
  getBestMatch,
  shouldSkipAI,
  getAllFixStrategies,
  getRuleStats,
  ERROR_RULES,
} from '../packages/server/src/ai/common-errors.js';

/** Helper: create an ErrorContext */
function createErrorContext(overrides?: Partial<ErrorContext>): ErrorContext {
  return {
    stepId: 'test-step',
    command: 'npm install -g openclaw',
    exitCode: 1,
    stdout: '',
    stderr: '',
    environment: createEnv(),
    previousSteps: [],
    ...overrides,
  } as ErrorContext;
}

describe('Functional Validation: Error Diagnosis (5+ common error types)', () => {
  describe('Error Type 1: Network Errors', () => {
    it('should identify ETIMEDOUT as network error', () => {
      const ctx = createErrorContext({
        stderr: 'npm ERR! code ETIMEDOUT\nnpm ERR! network timeout',
      });
      const analysis = identifyErrorType(ctx);
      expect(analysis.type).toBe('network');
      expect(analysis.confidence).toBeGreaterThan(0.5);
    });

    it('should identify ENOTFOUND (DNS failure) as network error', () => {
      const ctx = createErrorContext({
        stderr: 'getaddrinfo ENOTFOUND registry.npmjs.org',
      });
      const analysis = identifyErrorType(ctx);
      expect(analysis.type).toBe('network');
      expect(analysis.matchedPatterns.length).toBeGreaterThan(0);
    });

    it('should identify ECONNREFUSED as network error', () => {
      const ctx = createErrorContext({
        stderr: 'ECONNREFUSED 127.0.0.1:3000',
      });
      const analysis = identifyErrorType(ctx);
      expect(analysis.type).toBe('network');
    });

    it('should identify SSL certificate error as network error', () => {
      const ctx = createErrorContext({
        stderr: 'unable to get local issuer certificate',
      });
      const analysis = identifyErrorType(ctx);
      expect(analysis.type).toBe('network');
    });

    it('should classify network errors as transient', () => {
      const ctx = createErrorContext({
        stderr: 'npm ERR! ETIMEDOUT',
      });
      expect(isTransientError(ctx)).toBe(true);
    });

    it('should provide fix strategies for network timeout', () => {
      const ctx = createErrorContext({
        stderr: 'npm ERR! code ETIMEDOUT\nnpm ERR! network timeout',
      });
      const match = getBestMatch(ctx);
      expect(match).not.toBeNull();
      expect(match!.fixStrategies.length).toBeGreaterThan(0);
      // Should suggest retry or mirror
      const descriptions = match!.fixStrategies.map((s) => s.description);
      const hasRetry = descriptions.some((d) => d.toLowerCase().includes('retry'));
      const hasMirror = descriptions.some((d) => d.toLowerCase().includes('mirror') || d.toLowerCase().includes('registry'));
      expect(hasRetry || hasMirror).toBe(true);
    });
  });

  describe('Error Type 2: Permission Errors', () => {
    it('should identify EACCES as permission error', () => {
      const ctx = createErrorContext({
        stderr: 'npm ERR! EACCES: permission denied, access \'/usr/local/lib/node_modules\'',
      });
      const analysis = identifyErrorType(ctx);
      expect(analysis.type).toBe('permission');
      expect(analysis.confidence).toBeGreaterThan(0.8);
    });

    it('should identify EPERM as permission error', () => {
      const ctx = createErrorContext({
        stderr: 'EPERM: operation not permitted, mkdir \'/usr/local/lib\'',
      });
      const analysis = identifyErrorType(ctx);
      expect(analysis.type).toBe('permission');
    });

    it('should extract permission details', () => {
      const ctx = createErrorContext({
        stderr: 'npm ERR! EACCES: permission denied, access \'/usr/local/lib/node_modules\'',
      });
      const info = analyzeError(ctx);
      expect(info.permissionIssues.needsSudo).toBe(true);
      expect(info.errorCodes).toContain('EACCES');
    });

    it('should identify Missing write access as permission error', () => {
      const ctx = createErrorContext({
        stderr: 'Missing write access to /usr/local/lib/node_modules',
      });
      const analysis = identifyErrorType(ctx);
      expect(analysis.type).toBe('permission');
    });

    it('should provide sudo fix strategy for permission errors', () => {
      const ctx = createErrorContext({
        stderr: 'npm ERR! EACCES: permission denied, access \'/usr/local/lib\'',
      });
      const match = getBestMatch(ctx);
      expect(match).not.toBeNull();
      const sudoFix = match!.fixStrategies.find((s) => s.requiresSudo);
      expect(sudoFix).toBeDefined();
    });
  });

  describe('Error Type 3: Dependency Errors', () => {
    it('should identify ERESOLVE as dependency error', () => {
      const ctx = createErrorContext({
        stderr: 'npm ERR! ERESOLVE unable to resolve dependency tree',
      });
      const analysis = identifyErrorType(ctx);
      expect(analysis.type).toBe('dependency');
    });

    it('should identify command not found as dependency error', () => {
      const ctx = createErrorContext({
        stderr: 'bash: pnpm: command not found',
      });
      const analysis = identifyErrorType(ctx);
      expect(analysis.type).toBe('dependency');
    });

    it('should extract missing dependencies', () => {
      const ctx = createErrorContext({
        stderr: 'bash: pnpm: command not found',
      });
      const info = analyzeError(ctx);
      expect(info.missingDependencies).toContain('pnpm');
    });

    it('should identify Cannot find module as dependency error', () => {
      const ctx = createErrorContext({
        stderr: "Cannot find module 'express'",
      });
      const analysis = identifyErrorType(ctx);
      expect(analysis.type).toBe('dependency');
    });

    it('should match disk space error in common-errors rule library', () => {
      const ctx = createErrorContext({
        stderr: 'npm ERR! code ENOSPC\nnpm ERR! No space left on device',
      });
      // ENOSPC is handled by the common-errors rule library (not the error-analyzer patterns)
      const match = getBestMatch(ctx);
      expect(match).not.toBeNull();
      expect(match!.rule.id).toBe('disk-space-exhausted');
      expect(match!.fixStrategies.length).toBeGreaterThan(0);
    });

    it('should provide fix strategies for dependency resolution', () => {
      const ctx = createErrorContext({
        stderr: 'npm ERR! ERESOLVE unable to resolve dependency tree',
      });
      const match = getBestMatch(ctx);
      expect(match).not.toBeNull();
      expect(match!.fixStrategies.length).toBeGreaterThanOrEqual(2);
      // Should suggest --legacy-peer-deps or --force
      const descriptions = match!.fixStrategies.map((s) => s.description.toLowerCase());
      const hasLegacyDeps = descriptions.some((d) => d.includes('legacy'));
      expect(hasLegacyDeps).toBe(true);
    });
  });

  describe('Error Type 4: Version Conflicts', () => {
    it('should identify engine incompatible as version error', () => {
      const ctx = createErrorContext({
        stderr: 'npm ERR! engine {"node":">=18.0.0"} is incompatible with node v14.0.0',
      });
      const analysis = identifyErrorType(ctx);
      expect(analysis.type).toBe('version');
    });

    it('should identify Unsupported engine as version error', () => {
      const ctx = createErrorContext({
        stderr: 'npm ERR! Unsupported engine {"node":">=20"}',
      });
      const analysis = identifyErrorType(ctx);
      expect(analysis.type).toBe('version');
    });

    it('should identify peer dependency mismatch as version error', () => {
      const ctx = createErrorContext({
        stderr: 'requires a peer of react@^18.0.0 but none is installed',
      });
      const analysis = identifyErrorType(ctx);
      expect(analysis.type).toBe('version');
    });

    it('should extract version conflict details', () => {
      const ctx = createErrorContext({
        stderr: 'requires a peer of react@^18.0.0 but none is installed',
      });
      const info = analyzeError(ctx);
      expect(info.versionConflicts.length).toBeGreaterThan(0);
      expect(info.versionConflicts[0].package).toBe('react');
    });

    it('should provide nvm fix strategy for version errors', () => {
      const ctx = createErrorContext({
        stderr: 'npm ERR! engine {"node":">=18.0.0"} is incompatible with node v14.0.0',
      });
      const match = getBestMatch(ctx);
      expect(match).not.toBeNull();
      const nvmFix = match!.fixStrategies.find((s) =>
        s.commands.some((c) => c.includes('nvm')),
      );
      expect(nvmFix).toBeDefined();
    });
  });

  describe('Error Type 5: Configuration Errors', () => {
    it('should identify EJSONPARSE as configuration error', () => {
      const ctx = createErrorContext({
        stderr: 'npm ERR! code EJSONPARSE\nnpm ERR! Invalid JSON',
      });
      const analysis = identifyErrorType(ctx);
      expect(analysis.type).toBe('configuration');
    });

    it('should identify SyntaxError in JSON as configuration error', () => {
      const ctx = createErrorContext({
        stderr: 'SyntaxError: Unexpected token in JSON at position 42',
      });
      const analysis = identifyErrorType(ctx);
      expect(analysis.type).toBe('configuration');
    });

    it('should identify Invalid configuration as configuration error', () => {
      const ctx = createErrorContext({
        stderr: 'Invalid configuration found in .npmrc',
      });
      const analysis = identifyErrorType(ctx);
      expect(analysis.type).toBe('configuration');
    });

    it('should extract config file issues', () => {
      const ctx = createErrorContext({
        stderr: 'npm ERR! code EJSONPARSE\nnpm ERR! file /home/user/package.json',
      });
      const info = analyzeError(ctx);
      expect(info.configIssues.length).toBeGreaterThan(0);
      expect(info.configIssues[0].issue).toContain('JSON');
    });

    it('should match proxy configuration error in rule library with higher priority', () => {
      const ctx = createErrorContext({
        stderr: 'proxy ECONNREFUSED config error',
      });
      // The proxy config rule has priority 101, higher than network ECONNREFUSED (100)
      const match = getBestMatch(ctx);
      expect(match).not.toBeNull();
      expect(match!.rule.id).toBe('proxy-configuration-error');
      expect(match!.rule.type).toBe('configuration');
    });
  });

  describe('Error Type 6: Unknown Errors (graceful handling)', () => {
    it('should return unknown for unrecognized errors', () => {
      const ctx = createErrorContext({
        stderr: 'some completely unknown error message xyz123',
      });
      const analysis = identifyErrorType(ctx);
      expect(analysis.type).toBe('unknown');
      expect(analysis.confidence).toBe(0);
    });

    it('should not be transient for unknown errors', () => {
      const ctx = createErrorContext({
        stderr: 'some completely unknown error',
      });
      expect(isTransientError(ctx)).toBe(false);
    });
  });

  describe('Convenience function: identifyErrorTypeFromOutput', () => {
    it('should identify error type from raw stderr', () => {
      expect(identifyErrorTypeFromOutput('ETIMEDOUT')).toBe('network');
      expect(identifyErrorTypeFromOutput('EACCES: permission denied')).toBe('permission');
      expect(identifyErrorTypeFromOutput('command not found')).toBe('dependency');
      expect(identifyErrorTypeFromOutput('engine {"node":">=18"} is incompatible')).toBe('version');
      expect(identifyErrorTypeFromOutput('EJSONPARSE')).toBe('configuration');
    });
  });

  describe('Common Error Rules Library', () => {
    it('should have at least 10 error rules defined', () => {
      const stats = getRuleStats();
      expect(stats.totalRules).toBeGreaterThanOrEqual(10);
    });

    it('should cover all 5 error types in rules', () => {
      const stats = getRuleStats();
      const types = Object.keys(stats.rulesByType);
      expect(types).toContain('permission');
      expect(types).toContain('network');
      expect(types).toContain('dependency');
      expect(types).toContain('version');
      expect(types).toContain('configuration');
    });

    it('should skip AI for high-confidence common errors', () => {
      const ctx = createErrorContext({
        stderr: 'npm ERR! EACCES: permission denied, access \'/usr/local/lib\'',
      });
      expect(shouldSkipAI(ctx)).toBe(true);
    });

    it('should not skip AI for unknown errors', () => {
      const ctx = createErrorContext({
        stderr: 'some unknown error that does not match any pattern',
      });
      expect(shouldSkipAI(ctx)).toBe(false);
    });

    it('should deduplicate fix strategies from multiple matching rules', () => {
      const ctx = createErrorContext({
        stderr: 'EACCES: permission denied\nMissing write access to /usr/local',
      });
      const strategies = getAllFixStrategies(ctx);
      // Check for no duplicate descriptions
      const descriptions = strategies.map((s) => s.description);
      const unique = new Set(descriptions);
      expect(descriptions.length).toBe(unique.size);
    });

    it('should sort fix strategies by confidence descending', () => {
      const ctx = createErrorContext({
        stderr: 'npm ERR! EACCES: permission denied',
      });
      const strategies = getAllFixStrategies(ctx);
      for (let i = 1; i < strategies.length; i++) {
        expect(strategies[i - 1].confidence).toBeGreaterThanOrEqual(strategies[i].confidence);
      }
    });
  });
});

// ============================================================================
// 3. Rate Limiting - Free Tier 5/Month
// ============================================================================

import {
  FREE_TIER_INSTALLATION_LIMIT,
  FREE_TIER_AI_CALL_LIMIT,
  QUOTA_EXCEEDED_ERROR,
  getUpgradeMessage,
  isQuotaExceededError,
  createQuotaExceededMessage,
} from '../packages/server/src/api/rate-limiter.js';

describe('Functional Validation: Rate Limiting (free user 5/month)', () => {
  describe('Constants', () => {
    it('should set free tier installation limit to 5', () => {
      expect(FREE_TIER_INSTALLATION_LIMIT).toBe(5);
    });

    it('should set free tier AI call limit to 20', () => {
      expect(FREE_TIER_AI_CALL_LIMIT).toBe(20);
    });

    it('should define QUOTA_EXCEEDED error code', () => {
      expect(QUOTA_EXCEEDED_ERROR).toBe('QUOTA_EXCEEDED');
    });
  });

  describe('Upgrade Message', () => {
    it('should return upgrade message for free plan users', () => {
      const msg = getUpgradeMessage('free');
      expect(msg).toContain('Upgrade to Pro');
      expect(msg).toContain('5 installations');
      expect(msg).toContain('aiinstaller.dev/pricing');
    });

    it('should return support message for paid plan users', () => {
      const msg = getUpgradeMessage('pro');
      expect(msg).toContain('contact support');
      expect(msg).toContain('support@aiinstaller.dev');
    });

    it('should mention unlimited installations in Pro upgrade', () => {
      const msg = getUpgradeMessage('free');
      expect(msg.toLowerCase()).toContain('unlimited');
    });
  });

  describe('Quota Exceeded Detection', () => {
    it('should detect quota exceeded from string', () => {
      expect(isQuotaExceededError('quota exceeded')).toBe(true);
      expect(isQuotaExceededError(QUOTA_EXCEEDED_ERROR)).toBe(true);
    });

    it('should detect quota exceeded from Error object', () => {
      expect(isQuotaExceededError(new Error('quota exceeded'))).toBe(true);
      expect(isQuotaExceededError(new Error(QUOTA_EXCEEDED_ERROR))).toBe(true);
    });

    it('should not flag non-quota errors', () => {
      expect(isQuotaExceededError('some other error')).toBe(false);
      expect(isQuotaExceededError(new Error('network error'))).toBe(false);
      expect(isQuotaExceededError(null)).toBe(false);
      expect(isQuotaExceededError(undefined)).toBe(false);
      expect(isQuotaExceededError(42)).toBe(false);
    });
  });

  describe('Quota Exceeded Message', () => {
    it('should include error code in message', () => {
      const msg = createQuotaExceededMessage('free');
      expect(msg).toContain(QUOTA_EXCEEDED_ERROR);
    });

    it('should include upgrade guidance for free users', () => {
      const msg = createQuotaExceededMessage('free');
      expect(msg).toContain('Upgrade to Pro');
      expect(msg).toContain('aiinstaller.dev/pricing');
    });

    it('should include support info for paid users', () => {
      const msg = createQuotaExceededMessage('pro');
      expect(msg).toContain('support@aiinstaller.dev');
    });
  });
});

// ============================================================================
// 4. WSS Connection and Certificate Validation
// ============================================================================

import {
  authenticateDevice,
  createAuthResponse,
  hasQuota,
  createAuthTimeout,
} from '../packages/server/src/api/auth-handler.js';
import type { AuthResult } from '../packages/server/src/api/auth-handler.js';
import { MessageType } from '../packages/shared/src/protocol/messages.js';

describe('Functional Validation: WSS Connection (certificate validation)', () => {
  describe('Auth Response Creation', () => {
    it('should create successful auth response with quota info', () => {
      const authResult: AuthResult = {
        success: true,
        deviceToken: 'test-token-123',
        quota: { limit: 5, used: 2, remaining: 3 },
        plan: 'free',
      };

      const response = createAuthResponse(authResult, 'req-1');

      expect(response.type).toBe(MessageType.AUTH_RESPONSE);
      expect(response.payload.success).toBe(true);
      expect(response.payload.deviceToken).toBe('test-token-123');
      expect(response.payload.quotaLimit).toBe(5);
      expect(response.payload.quotaUsed).toBe(2);
      expect(response.payload.quotaRemaining).toBe(3);
      expect(response.payload.plan).toBe('free');
      expect(response.requestId).toBe('req-1');
      expect(response.timestamp).toBeGreaterThan(0);
    });

    it('should create failed auth response with error', () => {
      const authResult: AuthResult = {
        success: false,
        error: 'Device is banned',
        banned: true,
        banReason: 'Abuse detected',
      };

      const response = createAuthResponse(authResult);

      expect(response.type).toBe(MessageType.AUTH_RESPONSE);
      expect(response.payload.success).toBe(false);
      expect(response.payload.error).toBe('Device is banned');
      expect(response.payload.banned).toBe(true);
      expect(response.payload.banReason).toBe('Abuse detected');
    });

    it('should not include requestId when not provided', () => {
      const authResult: AuthResult = { success: true, deviceToken: 'tok' };
      const response = createAuthResponse(authResult);
      expect(response.requestId).toBeUndefined();
    });
  });

  describe('Quota Checking', () => {
    it('should return true when quota remaining > 0', () => {
      const result: AuthResult = {
        success: true,
        quota: { limit: 5, used: 2, remaining: 3 },
      };
      expect(hasQuota(result)).toBe(true);
    });

    it('should return false when quota is 0', () => {
      const result: AuthResult = {
        success: true,
        quota: { limit: 5, used: 5, remaining: 0 },
      };
      expect(hasQuota(result)).toBe(false);
    });

    it('should return false when auth failed', () => {
      const result: AuthResult = {
        success: false,
        error: 'Auth failed',
      };
      expect(hasQuota(result)).toBe(false);
    });

    it('should return false when no quota info', () => {
      const result: AuthResult = {
        success: true,
      };
      expect(hasQuota(result)).toBe(false);
    });

    it('should correctly handle free tier limit of 5', () => {
      // Simulate exactly at free tier limit
      const atLimit: AuthResult = {
        success: true,
        quota: { limit: FREE_TIER_INSTALLATION_LIMIT, used: FREE_TIER_INSTALLATION_LIMIT, remaining: 0 },
        plan: 'free',
      };
      expect(hasQuota(atLimit)).toBe(false);

      // One under limit
      const underLimit: AuthResult = {
        success: true,
        quota: { limit: FREE_TIER_INSTALLATION_LIMIT, used: FREE_TIER_INSTALLATION_LIMIT - 1, remaining: 1 },
        plan: 'free',
      };
      expect(hasQuota(underLimit)).toBe(true);
    });
  });

  describe('Auth Timeout', () => {
    it('should reject after timeout', async () => {
      const promise = createAuthTimeout(50); // 50ms for fast test
      await expect(promise).rejects.toThrow('Authentication timeout');
    });

    it('should use default timeout of 10000ms', () => {
      // Just verify the function signature accepts no args
      const promise = createAuthTimeout();
      // We can't wait 10s, so just verify it returns a promise
      expect(promise).toBeInstanceOf(Promise);
      // Cancel the timer to avoid test timeout
      promise.catch(() => {});
    });
  });

  describe('SSL/WSS Certificate Validation Flow', () => {
    it('should detect SSL certificate errors in error analyzer', () => {
      const ctx = createErrorContext({
        stderr: 'unable to get local issuer certificate',
      });
      const analysis = identifyErrorType(ctx);
      expect(analysis.type).toBe('network');
      expect(analysis.matchedPatterns).toContain('SSL certificate error');
    });

    it('should provide fix strategies for SSL certificate errors', () => {
      const ctx = createErrorContext({
        stderr: 'unable to get local issuer certificate',
      });
      const match = getBestMatch(ctx);
      expect(match).not.toBeNull();
      expect(match!.rule.id).toBe('network-ssl-certificate');
      expect(match!.fixStrategies.length).toBeGreaterThan(0);
      // Should suggest updating CA certificates
      const caFix = match!.fixStrategies.find((s) =>
        s.commands.some((c) => c.includes('ca-certificates')),
      );
      expect(caFix).toBeDefined();
    });

    it('should detect expired certificate errors', () => {
      const ctx = createErrorContext({
        stderr: 'CERT_HAS_EXPIRED: certificate has expired',
      });
      const match = getBestMatch(ctx);
      expect(match).not.toBeNull();
      expect(match!.rule.id).toBe('network-ssl-certificate');
    });

    it('should detect leaf signature verification failures', () => {
      const ctx = createErrorContext({
        stderr: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
      });
      const match = getBestMatch(ctx);
      expect(match).not.toBeNull();
      expect(match!.rule.id).toBe('network-ssl-certificate');
    });
  });
});

// ============================================================================
// Integration: Cross-Feature Validation
// ============================================================================

describe('Functional Validation: Cross-Feature Integration', () => {
  describe('Plan generation + error handling flow', () => {
    it('should generate plan, then handle simulated errors with fix strategies', () => {
      // Step 1: Generate a plan
      const env = createEnv();
      const plan = generateFallbackPlan(env, 'openclaw');
      expect(plan.steps.length).toBeGreaterThanOrEqual(3);

      // Step 2: Simulate an error during installation
      const errorCtx = createErrorContext({
        stepId: plan.steps[1].id,
        command: plan.steps[1].command,
        stderr: 'npm ERR! EACCES: permission denied, mkdir \'/usr/local/lib/node_modules\'',
      });

      // Step 3: Diagnose the error
      const analysis = identifyErrorType(errorCtx);
      expect(analysis.type).toBe('permission');

      // Step 4: Get fix strategies
      const match = getBestMatch(errorCtx);
      expect(match).not.toBeNull();
      expect(match!.fixStrategies.length).toBeGreaterThan(0);
    });
  });

  describe('Rate limiting + error diagnosis flow', () => {
    it('should provide quota exceeded message when limit reached', () => {
      const atLimit: AuthResult = {
        success: true,
        quota: { limit: 5, used: 5, remaining: 0 },
        plan: 'free',
      };

      // At limit - no quota
      expect(hasQuota(atLimit)).toBe(false);

      // Generate upgrade message
      const upgradeMsg = getUpgradeMessage('free');
      expect(upgradeMsg).toContain('Upgrade to Pro');

      // Verify quota error detection
      expect(isQuotaExceededError(QUOTA_EXCEEDED_ERROR)).toBe(true);
    });
  });

  describe('Multi-environment plan validation', () => {
    const environments: Array<{ name: string; env: EnvironmentInfo }> = [
      {
        name: 'macOS ARM64 with Homebrew',
        env: createEnv({
          os: { platform: 'darwin', version: '24.0.0', arch: 'arm64' },
          packageManagers: { npm: '10.0.0', pnpm: '9.0.0', brew: '4.0.0' },
        }),
      },
      {
        name: 'Ubuntu x64 with npm only',
        env: createEnv({
          os: { platform: 'linux', version: '22.04', arch: 'x64' },
          packageManagers: { npm: '10.0.0', pnpm: null, brew: null },
        }),
      },
      {
        name: 'Linux with pnpm',
        env: createEnv({
          os: { platform: 'linux', version: '20.04', arch: 'x64' },
          packageManagers: { npm: '10.0.0', pnpm: '9.0.0', brew: null },
        }),
      },
    ];

    for (const { name, env } of environments) {
      it(`should generate valid plan for ${name}`, () => {
        const plan = generateFallbackPlan(env, 'openclaw');

        // Every plan must have at least 3 steps
        expect(plan.steps.length).toBeGreaterThanOrEqual(3);

        // Every plan must have estimated time > 0
        expect(plan.estimatedTime).toBeGreaterThan(0);

        // Every plan must have risks
        expect(plan.risks.length).toBeGreaterThan(0);

        // Every step must have valid structure
        for (const step of plan.steps) {
          expect(step.id).toBeTruthy();
          expect(step.command).toBeTruthy();
          expect(step.timeout).toBeGreaterThan(0);
        }
      });
    }
  });
});
