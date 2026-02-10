/**
 * Tests for AI quality checker module.
 */

import { describe, it, expect } from 'vitest';
import type { InstallPlan, EnvironmentInfo } from '@aiinstaller/shared';
import {
  AIQualityChecker,
  RiskLevel,
  type CommandClassifierFn,
  type ClassificationResult,
  QualityIssueSchema,
  QualityCheckResultSchema,
} from './quality-checker.js';

// ============================================================================
// Helpers
// ============================================================================

function createLinuxEnv(overrides?: Partial<EnvironmentInfo>): EnvironmentInfo {
  return {
    os: { platform: 'linux', version: '22.04', arch: 'x86_64' },
    shell: { type: 'bash', version: '5.1' },
    runtime: { node: '22.1.0' },
    packageManagers: { npm: '10.2.0', apt: '2.4.0' },
    network: { canAccessNpm: true, canAccessGithub: true },
    permissions: { hasSudo: true, canWriteTo: ['/usr/local'] },
    ...overrides,
  };
}

function createDarwinEnv(overrides?: Partial<EnvironmentInfo>): EnvironmentInfo {
  return {
    os: { platform: 'darwin', version: '24.0.0', arch: 'arm64' },
    shell: { type: 'zsh', version: '5.9' },
    runtime: { node: '22.1.0' },
    packageManagers: { pnpm: '9.1.0', npm: '10.2.0', brew: '4.3.0' },
    network: { canAccessNpm: true, canAccessGithub: true },
    permissions: { hasSudo: true, canWriteTo: ['/usr/local'] },
    ...overrides,
  };
}

function createStep(
  command: string,
  id = 'step-1',
  description = 'Test step',
): InstallPlan['steps'][0] {
  return {
    id,
    description,
    command,
    timeout: 30000,
    canRollback: false,
    onError: 'abort',
  };
}

function createPlan(
  steps: InstallPlan['steps'],
  overrides?: Partial<InstallPlan>,
): InstallPlan {
  return {
    steps,
    estimatedTime: 60000,
    risks: [{ level: 'low', description: 'Test plan' }],
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('AIQualityChecker', () => {
  const checker = new AIQualityChecker();

  // --------------------------------------------------------------------------
  // checkPlan - clean plans
  // --------------------------------------------------------------------------

  describe('checkPlan - clean plans', () => {
    it('should pass a plan with safe commands on Linux', () => {
      const plan = createPlan([
        createStep('apt install -y nginx', 'install-nginx', 'Install nginx'),
        createStep('systemctl enable nginx', 'enable-nginx', 'Enable nginx'),
      ]);
      const result = checker.checkPlan(plan, createLinuxEnv());

      expect(result.passed).toBe(true);
      expect(result.issues.filter((i) => i.severity === 'error')).toHaveLength(0);
    });

    it('should pass a plan with safe commands on macOS', () => {
      const plan = createPlan([
        createStep('brew install node', 'install-node', 'Install Node.js'),
        createStep('node --version', 'check-node', 'Check version'),
      ]);
      const result = checker.checkPlan(plan, createDarwinEnv());

      expect(result.passed).toBe(true);
      expect(result.issues.filter((i) => i.severity === 'error')).toHaveLength(0);
    });

    it('should return empty issues and suggestions for a safe plan', () => {
      const plan = createPlan([
        createStep('curl -fsSL https://example.com/install.sh', 'download', 'Download'),
      ]);
      const result = checker.checkPlan(plan, createLinuxEnv());

      expect(result.passed).toBe(true);
      expect(result.suggestions).toHaveLength(0);
    });
  });

  // --------------------------------------------------------------------------
  // Check 1: Command Existence
  // --------------------------------------------------------------------------

  describe('command existence check', () => {
    it('should detect unknown commands on Linux', () => {
      const plan = createPlan([
        createStep('nonexistent-tool --setup', 'step-1', 'Run tool'),
      ]);
      const result = checker.checkPlan(plan, createLinuxEnv());

      expect(result.passed).toBe(false);
      expect(result.issues).toContainEqual(
        expect.objectContaining({
          type: 'command_not_found',
          severity: 'error',
          stepId: 'step-1',
        }),
      );
    });

    it('should detect unknown commands on macOS', () => {
      const plan = createPlan([
        createStep('zypper install pkg', 'step-1', 'Install via zypper'),
      ]);
      const result = checker.checkPlan(plan, createDarwinEnv());

      expect(result.passed).toBe(false);
      expect(result.issues).toContainEqual(
        expect.objectContaining({
          type: 'command_not_found',
        }),
      );
    });

    it('should recognize known Linux commands', () => {
      const commands = ['apt install nginx', 'systemctl status nginx', 'curl -fsSL https://example.com'];
      for (const cmd of commands) {
        const plan = createPlan([createStep(cmd)]);
        const result = checker.checkPlan(plan, createLinuxEnv());
        const cmdNotFound = result.issues.filter((i) => i.type === 'command_not_found');
        expect(cmdNotFound).toHaveLength(0);
      }
    });

    it('should recognize known macOS commands', () => {
      const commands = ['brew install node', 'git clone https://github.com/test/repo'];
      for (const cmd of commands) {
        const plan = createPlan([createStep(cmd)]);
        const result = checker.checkPlan(plan, createDarwinEnv());
        const cmdNotFound = result.issues.filter((i) => i.type === 'command_not_found');
        expect(cmdNotFound).toHaveLength(0);
      }
    });

    it('should handle sudo prefix correctly', () => {
      const plan = createPlan([
        createStep('sudo apt install -y nginx', 'step-1', 'Install nginx'),
      ]);
      const result = checker.checkPlan(plan, createLinuxEnv());
      const cmdNotFound = result.issues.filter((i) => i.type === 'command_not_found');
      expect(cmdNotFound).toHaveLength(0);
    });

    it('should skip command existence check for win32', () => {
      const env = createLinuxEnv({
        os: { platform: 'win32', version: '10.0', arch: 'x86_64' },
      });
      const plan = createPlan([
        createStep('unknown-cmd', 'step-1', 'Unknown'),
      ]);
      const result = checker.checkPlan(plan, env);
      const cmdNotFound = result.issues.filter((i) => i.type === 'command_not_found');
      expect(cmdNotFound).toHaveLength(0);
    });

    it('should detect commands available from environment', () => {
      const env = createLinuxEnv({
        packageManagers: { pnpm: '9.0.0', npm: '10.0.0' },
      });
      const plan = createPlan([
        createStep('pnpm install', 'step-1', 'Install deps'),
      ]);
      const result = checker.checkPlan(plan, env);
      const cmdNotFound = result.issues.filter((i) => i.type === 'command_not_found');
      expect(cmdNotFound).toHaveLength(0);
    });
  });

  // --------------------------------------------------------------------------
  // Check 2: Package Name Validation
  // --------------------------------------------------------------------------

  describe('package name validation', () => {
    it('should validate known apt packages', () => {
      const plan = createPlan([
        createStep('apt install -y nginx curl git', 'step-1', 'Install packages'),
      ]);
      const result = checker.checkPlan(plan, createLinuxEnv());
      const pkgIssues = result.issues.filter((i) => i.type === 'package_not_found');
      expect(pkgIssues).toHaveLength(0);
    });

    it('should warn about unknown apt packages', () => {
      const plan = createPlan([
        createStep('apt install -y nginx fake-package-xyz', 'step-1', 'Install packages'),
      ]);
      const result = checker.checkPlan(plan, createLinuxEnv());
      const pkgIssues = result.issues.filter((i) => i.type === 'package_not_found');
      expect(pkgIssues).toHaveLength(1);
      expect(pkgIssues[0].message).toContain('fake-package-xyz');
      expect(pkgIssues[0].severity).toBe('warning');
    });

    it('should handle apt-get install', () => {
      const plan = createPlan([
        createStep('apt-get install -y nginx', 'step-1', 'Install nginx'),
      ]);
      const result = checker.checkPlan(plan, createLinuxEnv());
      const pkgIssues = result.issues.filter((i) => i.type === 'package_not_found');
      expect(pkgIssues).toHaveLength(0);
    });

    it('should extract multiple packages from apt install', () => {
      const plan = createPlan([
        createStep('apt install build-essential gcc make unknown-pkg', 'step-1', 'Install dev tools'),
      ]);
      const result = checker.checkPlan(plan, createLinuxEnv());
      const pkgIssues = result.issues.filter((i) => i.type === 'package_not_found');
      expect(pkgIssues).toHaveLength(1);
      expect(pkgIssues[0].message).toContain('unknown-pkg');
    });

    it('should skip validation for non-apt managers', () => {
      const plan = createPlan([
        createStep('npm install -g unknown-npm-pkg', 'step-1', 'Install npm package'),
      ]);
      const result = checker.checkPlan(plan, createLinuxEnv());
      const pkgIssues = result.issues.filter((i) => i.type === 'package_not_found');
      expect(pkgIssues).toHaveLength(0);
    });

    it('should handle yum install package extraction', () => {
      const packages = checker.extractPackages('yum install -y httpd mod_ssl');
      expect(packages).toEqual(['httpd', 'mod_ssl']);
    });

    it('should handle dnf install package extraction', () => {
      const packages = checker.extractPackages('dnf install -y python3 python3-pip');
      expect(packages).toEqual(['python3', 'python3-pip']);
    });

    it('should return empty for non-install commands', () => {
      const packages = checker.extractPackages('ls -la /tmp');
      expect(packages).toEqual([]);
    });

    it('should filter out flags from package list', () => {
      const packages = checker.extractPackages('apt install -y -q nginx');
      expect(packages).toEqual(['nginx']);
    });
  });

  // --------------------------------------------------------------------------
  // Check 3: Risk Level Verification
  // --------------------------------------------------------------------------

  describe('risk level verification', () => {
    it('should warn about CRITICAL risk commands', () => {
      const plan = createPlan([
        createStep('rm -rf /tmp/old-logs', 'step-1', 'Clean up logs'),
      ]);
      const result = checker.checkPlan(plan, createLinuxEnv());
      const riskIssues = result.issues.filter((i) => i.type === 'risk_mismatch');
      expect(riskIssues).toHaveLength(1);
      expect(riskIssues[0].severity).toBe('warning');
      expect(riskIssues[0].message).toContain('CRITICAL');
    });

    it('should not warn about YELLOW risk commands', () => {
      const plan = createPlan([
        createStep('apt install -y nginx', 'step-1', 'Install nginx'),
      ]);
      const result = checker.checkPlan(plan, createLinuxEnv());
      const riskIssues = result.issues.filter((i) => i.type === 'risk_mismatch');
      expect(riskIssues).toHaveLength(0);
    });

    it('should not warn about GREEN risk commands', () => {
      const plan = createPlan([
        createStep('ls -la /etc', 'step-1', 'List config files'),
      ]);
      const result = checker.checkPlan(plan, createLinuxEnv());
      const riskIssues = result.issues.filter((i) => i.type === 'risk_mismatch');
      expect(riskIssues).toHaveLength(0);
    });
  });

  // --------------------------------------------------------------------------
  // Check 4: Forbidden Command Detection
  // --------------------------------------------------------------------------

  describe('forbidden command detection', () => {
    it('should detect rm -rf /', () => {
      const plan = createPlan([
        createStep('rm -rf /', 'step-1', 'Destroy system'),
      ]);
      const result = checker.checkPlan(plan, createLinuxEnv());

      expect(result.passed).toBe(false);
      expect(result.issues).toContainEqual(
        expect.objectContaining({
          type: 'forbidden_command',
          severity: 'error',
        }),
      );
    });

    it('should detect mkfs commands', () => {
      const plan = createPlan([
        createStep('mkfs.ext4 /dev/sda1', 'step-1', 'Format disk'),
      ]);
      const result = checker.checkPlan(plan, createLinuxEnv());

      expect(result.passed).toBe(false);
      expect(result.issues).toContainEqual(
        expect.objectContaining({
          type: 'forbidden_command',
          severity: 'error',
        }),
      );
    });

    it('should detect fdisk commands', () => {
      const plan = createPlan([
        createStep('fdisk /dev/sda', 'step-1', 'Partition disk'),
      ]);
      const result = checker.checkPlan(plan, createLinuxEnv());

      expect(result.passed).toBe(false);
      expect(result.issues).toContainEqual(
        expect.objectContaining({ type: 'forbidden_command' }),
      );
    });

    it('should detect dd if=/dev/zero', () => {
      const plan = createPlan([
        createStep('dd if=/dev/zero of=/dev/sda bs=1M', 'step-1', 'Wipe disk'),
      ]);
      const result = checker.checkPlan(plan, createLinuxEnv());

      expect(result.passed).toBe(false);
      const forbidden = result.issues.filter((i) => i.type === 'forbidden_command');
      expect(forbidden.length).toBeGreaterThan(0);
    });

    it('should detect chmod 777 on root', () => {
      const plan = createPlan([
        createStep('chmod -R 777 /', 'step-1', 'Open all permissions'),
      ]);
      const result = checker.checkPlan(plan, createLinuxEnv());

      expect(result.passed).toBe(false);
      expect(result.issues).toContainEqual(
        expect.objectContaining({ type: 'forbidden_command' }),
      );
    });

    it('should not flag safe commands as forbidden', () => {
      const plan = createPlan([
        createStep('apt install -y nginx', 'step-1', 'Install nginx'),
        createStep('node --version', 'step-2', 'Check node'),
      ]);
      const result = checker.checkPlan(plan, createLinuxEnv());
      const forbidden = result.issues.filter((i) => i.type === 'forbidden_command');
      expect(forbidden).toHaveLength(0);
    });
  });

  // --------------------------------------------------------------------------
  // Check 5: Platform Compatibility
  // --------------------------------------------------------------------------

  describe('platform compatibility', () => {
    it('should detect apt on macOS', () => {
      const plan = createPlan([
        createStep('apt install -y nginx', 'step-1', 'Install nginx'),
      ]);
      const result = checker.checkPlan(plan, createDarwinEnv());

      expect(result.passed).toBe(false);
      expect(result.issues).toContainEqual(
        expect.objectContaining({
          type: 'platform_incompatible',
          severity: 'error',
        }),
      );
      expect(result.suggestions).toContainEqual(
        expect.stringContaining('brew install'),
      );
    });

    it('should detect brew on Linux', () => {
      const plan = createPlan([
        createStep('brew install node', 'step-1', 'Install node'),
      ]);
      const result = checker.checkPlan(plan, createLinuxEnv());

      expect(result.passed).toBe(false);
      expect(result.issues).toContainEqual(
        expect.objectContaining({
          type: 'platform_incompatible',
        }),
      );
      expect(result.suggestions).toContainEqual(
        expect.stringContaining('apt install'),
      );
    });

    it('should detect yum on Debian-based system', () => {
      const env = createLinuxEnv({
        packageManagers: { apt: '2.4.0', npm: '10.0.0' },
      });
      const plan = createPlan([
        createStep('yum install -y httpd', 'step-1', 'Install Apache'),
      ]);
      const result = checker.checkPlan(plan, env);

      expect(result.suggestions).toContainEqual(
        expect.stringContaining('yum command'),
      );
    });

    it('should detect dnf on Debian-based system', () => {
      const env = createLinuxEnv({
        packageManagers: { apt: '2.4.0', npm: '10.0.0' },
      });
      const plan = createPlan([
        createStep('dnf install -y python3', 'step-1', 'Install Python'),
      ]);
      const result = checker.checkPlan(plan, env);

      expect(result.suggestions).toContainEqual(
        expect.stringContaining('dnf command'),
      );
    });

    it('should not flag compatible package managers', () => {
      const plan = createPlan([
        createStep('apt install -y nginx', 'step-1', 'Install nginx'),
      ]);
      const result = checker.checkPlan(plan, createLinuxEnv());
      const platformIssues = result.issues.filter((i) => i.type === 'platform_incompatible');
      expect(platformIssues).toHaveLength(0);
    });

    it('should not duplicate suggestions', () => {
      const plan = createPlan([
        createStep('apt install -y nginx', 'step-1', 'Install nginx'),
        createStep('apt install -y curl', 'step-2', 'Install curl'),
      ]);
      const result = checker.checkPlan(plan, createDarwinEnv());
      const brewSuggestions = result.suggestions.filter((s) => s.includes('brew'));
      expect(brewSuggestions.length).toBeLessThanOrEqual(1);
    });
  });

  // --------------------------------------------------------------------------
  // Mixed scenarios
  // --------------------------------------------------------------------------

  describe('mixed scenarios', () => {
    it('should detect multiple issues in one plan', () => {
      const plan = createPlan([
        createStep('apt install -y nginx', 'step-1', 'Install nginx'),
        createStep('rm -rf /tmp/cache', 'step-2', 'Clear cache'),
        createStep('nonexistent-cmd --run', 'step-3', 'Run tool'),
      ]);
      const result = checker.checkPlan(plan, createLinuxEnv());

      expect(result.passed).toBe(false);
      expect(result.issues.length).toBeGreaterThanOrEqual(2);
    });

    it('should pass only when no error-level issues exist', () => {
      const plan = createPlan([
        createStep('apt install -y nginx fake-pkg', 'step-1', 'Install packages'),
      ]);
      const result = checker.checkPlan(plan, createLinuxEnv());

      // fake-pkg is a warning, not an error
      expect(result.passed).toBe(true);
      expect(result.issues.some((i) => i.severity === 'warning')).toBe(true);
    });

    it('should handle empty plan gracefully', () => {
      const plan = createPlan([]);
      const result = checker.checkPlan(plan, createLinuxEnv());

      expect(result.passed).toBe(true);
      expect(result.issues).toHaveLength(0);
      expect(result.suggestions).toHaveLength(0);
    });
  });

  // --------------------------------------------------------------------------
  // extractBaseCommand
  // --------------------------------------------------------------------------

  describe('extractBaseCommand', () => {
    it('should extract simple command names', () => {
      expect(checker.extractBaseCommand('apt install nginx')).toBe('apt');
      expect(checker.extractBaseCommand('curl -fsSL https://example.com')).toBe('curl');
      expect(checker.extractBaseCommand('nginx -t')).toBe('nginx');
    });

    it('should strip sudo prefix', () => {
      expect(checker.extractBaseCommand('sudo apt install nginx')).toBe('apt');
      expect(checker.extractBaseCommand('sudo -E npm install')).toBe('npm');
    });

    it('should return null for empty command', () => {
      expect(checker.extractBaseCommand('')).toBeNull();
      expect(checker.extractBaseCommand('   ')).toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // extractPackages
  // --------------------------------------------------------------------------

  describe('extractPackages', () => {
    it('should extract packages from apt install', () => {
      expect(checker.extractPackages('apt install nginx curl git')).toEqual([
        'nginx', 'curl', 'git',
      ]);
    });

    it('should handle -y flag', () => {
      expect(checker.extractPackages('apt install -y nginx')).toEqual(['nginx']);
    });

    it('should handle apt-get', () => {
      expect(checker.extractPackages('apt-get install -y nginx curl')).toEqual([
        'nginx', 'curl',
      ]);
    });

    it('should return empty for non-install commands', () => {
      expect(checker.extractPackages('ls -la')).toEqual([]);
      expect(checker.extractPackages('node --version')).toEqual([]);
    });
  });

  // --------------------------------------------------------------------------
  // Custom classifier injection
  // --------------------------------------------------------------------------

  describe('custom classifier injection', () => {
    it('should use injected classifier for risk checks', () => {
      const customClassifier: CommandClassifierFn = (command) => ({
        command,
        riskLevel: RiskLevel.FORBIDDEN,
        reason: 'Custom: all forbidden',
      });

      const customChecker = new AIQualityChecker(customClassifier);
      const plan = createPlan([
        createStep('echo hello', 'step-1', 'Simple echo'),
      ]);
      const result = customChecker.checkPlan(plan, createLinuxEnv());

      expect(result.passed).toBe(false);
      expect(result.issues).toContainEqual(
        expect.objectContaining({
          type: 'forbidden_command',
          severity: 'error',
        }),
      );
    });

    it('should use default classifier when none is provided', () => {
      const defaultChecker = new AIQualityChecker();
      const plan = createPlan([
        createStep('ls -la /tmp', 'step-1', 'List files'),
      ]);
      const result = defaultChecker.checkPlan(plan, createLinuxEnv());
      const forbidden = result.issues.filter((i) => i.type === 'forbidden_command');
      expect(forbidden).toHaveLength(0);
    });
  });

  // --------------------------------------------------------------------------
  // Zod schema validation
  // --------------------------------------------------------------------------

  describe('Zod schemas', () => {
    it('should validate a QualityCheckResult with Zod schema', () => {
      const plan = createPlan([
        createStep('apt install -y nginx', 'step-1', 'Install nginx'),
      ]);
      const result = checker.checkPlan(plan, createLinuxEnv());
      const parsed = QualityCheckResultSchema.safeParse(result);
      expect(parsed.success).toBe(true);
    });

    it('should validate a QualityIssue with Zod schema', () => {
      const issue = {
        type: 'forbidden_command' as const,
        severity: 'error' as const,
        message: 'Test message',
        stepId: 'step-1',
      };
      const parsed = QualityIssueSchema.safeParse(issue);
      expect(parsed.success).toBe(true);
    });

    it('should reject invalid issue types', () => {
      const invalid = {
        type: 'unknown_type',
        severity: 'error',
        message: 'Test',
      };
      const parsed = QualityIssueSchema.safeParse(invalid);
      expect(parsed.success).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // Default classifier tests
  // --------------------------------------------------------------------------

  describe('default classifier', () => {
    it('should classify forbidden commands correctly', () => {
      const plan = createPlan([
        createStep('rm -rf /', 'step-1', 'Destroy'),
      ]);
      const result = checker.checkPlan(plan, createLinuxEnv());
      expect(result.issues).toContainEqual(
        expect.objectContaining({ type: 'forbidden_command' }),
      );
    });

    it('should classify critical commands correctly', () => {
      const plan = createPlan([
        createStep('rm file.txt', 'step-1', 'Delete file'),
      ]);
      const result = checker.checkPlan(plan, createLinuxEnv());
      expect(result.issues).toContainEqual(
        expect.objectContaining({ type: 'risk_mismatch' }),
      );
    });

    it('should not flag yellow commands', () => {
      const plan = createPlan([
        createStep('apt install -y nginx', 'step-1', 'Install'),
      ]);
      const result = checker.checkPlan(plan, createLinuxEnv());
      const risk = result.issues.filter((i) => i.type === 'risk_mismatch');
      expect(risk).toHaveLength(0);
    });

    it('should not flag green commands', () => {
      const plan = createPlan([
        createStep('echo hello', 'step-1', 'Echo'),
      ]);
      const result = checker.checkPlan(plan, createLinuxEnv());
      const risk = result.issues.filter((i) => i.type === 'risk_mismatch');
      const forbidden = result.issues.filter((i) => i.type === 'forbidden_command');
      expect(risk).toHaveLength(0);
      expect(forbidden).toHaveLength(0);
    });

    it('should classify unknown commands as RED (fail-safe)', () => {
      const customChecker = new AIQualityChecker();
      const plan = createPlan([
        createStep('some-custom-tool --arg', 'step-1', 'Custom tool'),
      ]);
      const result = customChecker.checkPlan(plan, createLinuxEnv());
      // RED is neither CRITICAL nor FORBIDDEN, so no risk_mismatch or forbidden_command
      const risk = result.issues.filter((i) => i.type === 'risk_mismatch');
      const forbidden = result.issues.filter((i) => i.type === 'forbidden_command');
      expect(risk).toHaveLength(0);
      expect(forbidden).toHaveLength(0);
    });
  });
});
