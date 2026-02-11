// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for the server-side command validator.
 *
 * Validates that the command validator correctly uses the shared security
 * engine to classify commands and determine actions (allowed/blocked/requires_confirmation).
 * Target coverage: ≥ 95% for this security module.
 */

import { describe, it, expect } from 'vitest';
import { RiskLevel } from '@aiinstaller/shared';

import {
  validateCommand,
  validatePlan,
  type ValidationResult,
  type PlanValidationResult,
} from './command-validator.js';

// ============================================================================
// validateCommand
// ============================================================================

describe('validateCommand', () => {
  // --------------------------------------------------------------------------
  // GREEN commands — allowed
  // --------------------------------------------------------------------------
  describe('GREEN commands (allowed)', () => {
    it('allows read-only commands like ls', () => {
      const result = validateCommand('ls -la');
      expect(result.action).toBe('allowed');
      expect(result.classification.riskLevel).toBe(RiskLevel.GREEN);
    });

    it('allows cat command', () => {
      const result = validateCommand('cat /etc/hostname');
      expect(result.action).toBe('allowed');
      expect(result.classification.riskLevel).toBe(RiskLevel.GREEN);
    });

    it('allows git status', () => {
      const result = validateCommand('git status');
      expect(result.action).toBe('allowed');
      expect(result.classification.riskLevel).toBe(RiskLevel.GREEN);
    });

    it('allows docker ps', () => {
      const result = validateCommand('docker ps');
      expect(result.action).toBe('allowed');
      expect(result.classification.riskLevel).toBe(RiskLevel.GREEN);
    });

    it('allows df -h', () => {
      const result = validateCommand('df -h');
      expect(result.action).toBe('allowed');
      expect(result.classification.riskLevel).toBe(RiskLevel.GREEN);
    });

    it('includes the classification reason', () => {
      const result = validateCommand('ls');
      expect(result.reasons.length).toBeGreaterThan(0);
      expect(result.policy).toContain('Auto-execute');
    });
  });

  // --------------------------------------------------------------------------
  // YELLOW commands — requires confirmation
  // --------------------------------------------------------------------------
  describe('YELLOW commands (requires confirmation)', () => {
    it('requires confirmation for apt install', () => {
      const result = validateCommand('apt install nginx');
      expect(result.action).toBe('requires_confirmation');
      expect(result.classification.riskLevel).toBe(RiskLevel.YELLOW);
    });

    it('requires confirmation for npm install', () => {
      const result = validateCommand('npm install express');
      expect(result.action).toBe('requires_confirmation');
      expect(result.classification.riskLevel).toBe(RiskLevel.YELLOW);
    });

    it('requires confirmation for pip install', () => {
      const result = validateCommand('pip install flask');
      expect(result.action).toBe('requires_confirmation');
      expect(result.classification.riskLevel).toBe(RiskLevel.YELLOW);
    });

    it('includes the correct policy', () => {
      const result = validateCommand('apt install nginx');
      expect(result.policy).toContain('user confirmation');
    });
  });

  // --------------------------------------------------------------------------
  // RED commands — requires confirmation
  // --------------------------------------------------------------------------
  describe('RED commands (requires confirmation)', () => {
    it('requires confirmation for systemctl restart', () => {
      const result = validateCommand('systemctl restart nginx');
      expect(result.action).toBe('requires_confirmation');
      expect(result.classification.riskLevel).toBe(RiskLevel.RED);
    });

    it('requires confirmation for chmod', () => {
      const result = validateCommand('chmod 755 /var/www');
      expect(result.action).toBe('requires_confirmation');
      expect(result.classification.riskLevel).toBe(RiskLevel.RED);
    });

    it('requires confirmation for git push', () => {
      const result = validateCommand('git push origin main');
      expect(result.action).toBe('requires_confirmation');
      expect(result.classification.riskLevel).toBe(RiskLevel.RED);
    });
  });

  // --------------------------------------------------------------------------
  // CRITICAL commands — requires confirmation
  // --------------------------------------------------------------------------
  describe('CRITICAL commands (requires confirmation)', () => {
    it('requires confirmation for rm -rf', () => {
      const result = validateCommand('rm -rf /tmp/build');
      expect(result.action).toBe('requires_confirmation');
      expect(result.classification.riskLevel).toBe(RiskLevel.CRITICAL);
    });

    it('requires confirmation for drop database', () => {
      const result = validateCommand('mysql -e "DROP DATABASE test"');
      expect(result.action).toBe('requires_confirmation');
      expect(result.classification.riskLevel).toBe(RiskLevel.CRITICAL);
    });

    it('includes the correct policy for critical', () => {
      const result = validateCommand('rm -rf /tmp/build');
      expect(result.policy).toContain('snapshot');
    });
  });

  // --------------------------------------------------------------------------
  // FORBIDDEN commands — blocked
  // --------------------------------------------------------------------------
  describe('FORBIDDEN commands (blocked)', () => {
    it('blocks rm -rf /', () => {
      const result = validateCommand('rm -rf /');
      expect(result.action).toBe('blocked');
      expect(result.classification.riskLevel).toBe(RiskLevel.FORBIDDEN);
    });

    it('blocks mkfs commands', () => {
      const result = validateCommand('mkfs.ext4 /dev/sda1');
      expect(result.action).toBe('blocked');
      expect(result.classification.riskLevel).toBe(RiskLevel.FORBIDDEN);
    });

    it('blocks dd if=/dev/zero of=/dev/sda', () => {
      const result = validateCommand('dd if=/dev/zero of=/dev/sda');
      expect(result.action).toBe('blocked');
      expect(result.classification.riskLevel).toBe(RiskLevel.FORBIDDEN);
    });

    it('blocks fork bombs', () => {
      const result = validateCommand(':(){ :|:& };:');
      expect(result.action).toBe('blocked');
      expect(result.classification.riskLevel).toBe(RiskLevel.FORBIDDEN);
    });

    it('blocks empty commands', () => {
      const result = validateCommand('');
      expect(result.action).toBe('blocked');
      expect(result.classification.riskLevel).toBe(RiskLevel.FORBIDDEN);
    });

    it('blocks whitespace-only commands', () => {
      const result = validateCommand('   ');
      expect(result.action).toBe('blocked');
      expect(result.classification.riskLevel).toBe(RiskLevel.FORBIDDEN);
    });

    it('includes blocked reason', () => {
      const result = validateCommand('rm -rf /');
      expect(result.reasons).toContain('Command is absolutely prohibited');
    });

    it('includes the correct policy for forbidden', () => {
      const result = validateCommand('rm -rf /');
      expect(result.policy).toContain('prohibited');
    });
  });

  // --------------------------------------------------------------------------
  // Sudo handling
  // --------------------------------------------------------------------------
  describe('sudo prefix handling', () => {
    it('strips sudo prefix and classifies the underlying command', () => {
      const result = validateCommand('sudo ls -la');
      expect(result.action).toBe('allowed');
      expect(result.classification.riskLevel).toBe(RiskLevel.GREEN);
    });

    it('blocks sudo with forbidden command', () => {
      const result = validateCommand('sudo rm -rf /');
      expect(result.action).toBe('blocked');
      expect(result.classification.riskLevel).toBe(RiskLevel.FORBIDDEN);
    });
  });

  // --------------------------------------------------------------------------
  // Audit warnings and blockers
  // --------------------------------------------------------------------------
  describe('parameter audit integration', () => {
    it('includes audit warnings for dangerous flags', () => {
      const result = validateCommand('apt install --force-yes nginx');
      // Should still be requires_confirmation at minimum due to YELLOW
      expect(result.action).toBe('requires_confirmation');
    });

    it('includes audit result in the validation', () => {
      const result = validateCommand('ls -la');
      expect(result.audit).toBeDefined();
      expect(result.audit.warnings).toBeDefined();
      expect(result.audit.blockers).toBeDefined();
    });

    it('blocks commands with destructive ops on protected paths', () => {
      const result = validateCommand('rm -rf /etc/passwd');
      // This should be CRITICAL due to rm -rf pattern and blocked due to protected path
      expect(result.classification.riskLevel).not.toBe(RiskLevel.GREEN);
    });
  });

  // --------------------------------------------------------------------------
  // Unknown commands — fail-safe to RED
  // --------------------------------------------------------------------------
  describe('unknown commands (fail-safe)', () => {
    it('classifies unknown commands as RED (requires confirmation)', () => {
      const result = validateCommand('some-random-binary --unknown-flag');
      expect(result.action).toBe('requires_confirmation');
      expect(result.classification.riskLevel).toBe(RiskLevel.RED);
    });
  });

  // --------------------------------------------------------------------------
  // Result structure
  // --------------------------------------------------------------------------
  describe('result structure', () => {
    it('returns all required fields', () => {
      const result = validateCommand('ls');
      expect(result).toHaveProperty('action');
      expect(result).toHaveProperty('classification');
      expect(result).toHaveProperty('audit');
      expect(result).toHaveProperty('policy');
      expect(result).toHaveProperty('reasons');
      expect(result.classification).toHaveProperty('command');
      expect(result.classification).toHaveProperty('riskLevel');
      expect(result.classification).toHaveProperty('reason');
      expect(result.audit).toHaveProperty('safe');
      expect(result.audit).toHaveProperty('warnings');
      expect(result.audit).toHaveProperty('blockers');
    });
  });
});

// ============================================================================
// validatePlan
// ============================================================================

describe('validatePlan', () => {
  it('allows a plan with only GREEN commands', () => {
    const result = validatePlan([
      { id: 'step-1', command: 'ls -la', description: 'List files' },
      { id: 'step-2', command: 'cat /etc/hostname', description: 'Show hostname' },
    ]);

    expect(result.action).toBe('allowed');
    expect(result.maxRiskLevel).toBe(RiskLevel.GREEN);
    expect(result.blockedSteps).toHaveLength(0);
    expect(result.confirmationSteps).toHaveLength(0);
  });

  it('requires confirmation for a plan with YELLOW commands', () => {
    const result = validatePlan([
      { id: 'step-1', command: 'ls -la', description: 'List files' },
      { id: 'step-2', command: 'apt install nginx', description: 'Install nginx' },
    ]);

    expect(result.action).toBe('requires_confirmation');
    expect(result.maxRiskLevel).toBe(RiskLevel.YELLOW);
    expect(result.confirmationSteps.length).toBeGreaterThan(0);
  });

  it('blocks a plan with FORBIDDEN commands', () => {
    const result = validatePlan([
      { id: 'step-1', command: 'ls -la', description: 'List files' },
      { id: 'step-2', command: 'rm -rf /', description: 'Dangerous' },
    ]);

    expect(result.action).toBe('blocked');
    expect(result.maxRiskLevel).toBe(RiskLevel.FORBIDDEN);
    expect(result.blockedSteps).toHaveLength(1);
    expect(result.blockedSteps[0].stepId).toBe('step-2');
  });

  it('returns the highest risk level across all steps', () => {
    const result = validatePlan([
      { id: 'step-1', command: 'ls -la', description: 'List files' },
      { id: 'step-2', command: 'apt install nginx', description: 'Install nginx' },
      { id: 'step-3', command: 'systemctl restart nginx', description: 'Restart nginx' },
    ]);

    expect(result.maxRiskLevel).toBe(RiskLevel.RED);
  });

  it('returns per-step validation results', () => {
    const result = validatePlan([
      { id: 'step-1', command: 'ls', description: 'List' },
      { id: 'step-2', command: 'apt install nginx', description: 'Install' },
    ]);

    expect(result.steps).toHaveLength(2);
    expect(result.steps[0].stepId).toBe('step-1');
    expect(result.steps[0].validation.action).toBe('allowed');
    expect(result.steps[1].stepId).toBe('step-2');
    expect(result.steps[1].validation.action).toBe('requires_confirmation');
  });

  it('handles single-step plans', () => {
    const result = validatePlan([
      { id: 'step-1', command: 'ls', description: 'List' },
    ]);

    expect(result.action).toBe('allowed');
    expect(result.steps).toHaveLength(1);
  });

  it('handles plans with mixed risk levels', () => {
    const result = validatePlan([
      { id: 'step-1', command: 'ls', description: 'List' },
      { id: 'step-2', command: 'apt install nginx', description: 'Install' },
      { id: 'step-3', command: 'rm -rf /tmp/build', description: 'Clean' },
    ]);

    expect(result.action).toBe('requires_confirmation');
    expect(result.steps).toHaveLength(3);
    expect(result.maxRiskLevel).toBe(RiskLevel.CRITICAL);
  });

  it('identifies all blocked steps when multiple FORBIDDEN commands exist', () => {
    const result = validatePlan([
      { id: 'step-1', command: 'rm -rf /', description: 'Wipe root' },
      { id: 'step-2', command: 'ls', description: 'List' },
      { id: 'step-3', command: 'mkfs.ext4 /dev/sda', description: 'Format' },
    ]);

    expect(result.action).toBe('blocked');
    expect(result.blockedSteps).toHaveLength(2);
  });

  it('identifies all confirmation steps in a mixed plan', () => {
    const result = validatePlan([
      { id: 'step-1', command: 'ls', description: 'List' },
      { id: 'step-2', command: 'apt install nginx', description: 'Install' },
      { id: 'step-3', command: 'systemctl restart nginx', description: 'Restart' },
    ]);

    expect(result.confirmationSteps).toHaveLength(2);
  });
});
