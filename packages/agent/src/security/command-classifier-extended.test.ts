import { describe, it, expect, afterEach } from 'vitest';

import {
  classifyCommand,
  compareRiskLevels,
  getExecutionPolicy,
  isForbidden,
  requiresConfirmation,
  requiresSnapshot,
  RiskLevel,
  normalizeCommand,
  loadCustomRules,
  clearCustomRules,
  getCustomRuleCount,
  CustomRulesConfigSchema,
} from './command-classifier.js';
import {
  FORBIDDEN_PATTERNS,
  CRITICAL_PATTERNS,
  GREEN_PATTERNS,
  YELLOW_PATTERNS,
  RED_PATTERNS,
} from './command-rules.js';

// ============================================================================
// Alias handling — sudo, doas, pkexec, su -c
// ============================================================================

describe('classifyCommand — sudo prefix handling', () => {
  it('should strip sudo and classify the underlying command', () => {
    expect(classifyCommand('sudo ls -la').riskLevel).toBe(RiskLevel.GREEN);
    expect(classifyCommand('sudo apt install nginx').riskLevel).toBe(RiskLevel.YELLOW);
    expect(classifyCommand('sudo systemctl restart nginx').riskLevel).toBe(RiskLevel.RED);
    expect(classifyCommand('sudo rm file.txt').riskLevel).toBe(RiskLevel.CRITICAL);
    expect(classifyCommand('sudo rm -rf /').riskLevel).toBe(RiskLevel.FORBIDDEN);
  });

  it('should handle sudo with flags', () => {
    expect(classifyCommand('sudo -u root ls -la').riskLevel).toBe(RiskLevel.GREEN);
    expect(classifyCommand('sudo -E apt install nginx').riskLevel).toBe(RiskLevel.YELLOW);
  });

  it('should handle sudo with long options', () => {
    expect(classifyCommand('sudo --user=root ls -la').riskLevel).toBe(RiskLevel.GREEN);
    expect(classifyCommand('sudo --preserve-env apt install nginx').riskLevel).toBe(RiskLevel.YELLOW);
  });
});

describe('classifyCommand — doas alias handling', () => {
  it('should strip doas and classify the underlying command', () => {
    expect(classifyCommand('doas ls -la').riskLevel).toBe(RiskLevel.GREEN);
    expect(classifyCommand('doas apt install nginx').riskLevel).toBe(RiskLevel.YELLOW);
    expect(classifyCommand('doas systemctl restart nginx').riskLevel).toBe(RiskLevel.RED);
    expect(classifyCommand('doas rm file.txt').riskLevel).toBe(RiskLevel.CRITICAL);
    expect(classifyCommand('doas rm -rf /').riskLevel).toBe(RiskLevel.FORBIDDEN);
  });

  it('should handle doas with -u flag', () => {
    expect(classifyCommand('doas -u root ls -la').riskLevel).toBe(RiskLevel.GREEN);
    expect(classifyCommand('doas -u www rm file.txt').riskLevel).toBe(RiskLevel.CRITICAL);
  });

  it('should handle doas with -n and -s flags', () => {
    expect(classifyCommand('doas -n ls -la').riskLevel).toBe(RiskLevel.GREEN);
  });
});

describe('classifyCommand — pkexec alias handling', () => {
  it('should strip pkexec and classify the underlying command', () => {
    expect(classifyCommand('pkexec ls -la').riskLevel).toBe(RiskLevel.GREEN);
    expect(classifyCommand('pkexec apt install nginx').riskLevel).toBe(RiskLevel.YELLOW);
    expect(classifyCommand('pkexec systemctl restart nginx').riskLevel).toBe(RiskLevel.RED);
    expect(classifyCommand('pkexec rm file.txt').riskLevel).toBe(RiskLevel.CRITICAL);
  });

  it('should handle pkexec with --user flag', () => {
    expect(classifyCommand('pkexec --user root ls -la').riskLevel).toBe(RiskLevel.GREEN);
    expect(classifyCommand('pkexec --user admin rm file.txt').riskLevel).toBe(RiskLevel.CRITICAL);
  });
});

describe('classifyCommand — su -c alias handling', () => {
  it('should strip su -c and classify the underlying command', () => {
    expect(classifyCommand('su -c "ls -la"').riskLevel).toBe(RiskLevel.GREEN);
    expect(classifyCommand("su -c 'apt install nginx'").riskLevel).toBe(RiskLevel.YELLOW);
    expect(classifyCommand('su -c "systemctl restart nginx"').riskLevel).toBe(RiskLevel.RED);
    expect(classifyCommand('su -c "rm file.txt"').riskLevel).toBe(RiskLevel.CRITICAL);
  });

  it('should handle su with user and -c flag', () => {
    expect(classifyCommand('su root -c "ls -la"').riskLevel).toBe(RiskLevel.GREEN);
    expect(classifyCommand('su - root -c "rm file.txt"').riskLevel).toBe(RiskLevel.CRITICAL);
  });
});

// ============================================================================
// normalizeCommand
// ============================================================================

describe('normalizeCommand', () => {
  it('should strip sudo prefix', () => {
    expect(normalizeCommand('sudo ls -la')).toBe('ls -la');
  });

  it('should strip doas prefix', () => {
    expect(normalizeCommand('doas ls -la')).toBe('ls -la');
  });

  it('should strip doas with -u user', () => {
    expect(normalizeCommand('doas -u root ls -la')).toBe('ls -la');
  });

  it('should strip pkexec prefix', () => {
    expect(normalizeCommand('pkexec ls -la')).toBe('ls -la');
  });

  it('should strip pkexec with --user', () => {
    expect(normalizeCommand('pkexec --user root ls -la')).toBe('ls -la');
  });

  it('should extract command from su -c', () => {
    expect(normalizeCommand('su -c "ls -la"')).toBe('ls -la');
    expect(normalizeCommand("su -c 'rm file.txt'")).toBe('rm file.txt');
    expect(normalizeCommand('su root -c "ls -la"')).toBe('ls -la');
  });

  it('should not modify commands without escalation prefix', () => {
    expect(normalizeCommand('ls -la')).toBe('ls -la');
    expect(normalizeCommand('rm file.txt')).toBe('rm file.txt');
  });
});

// ============================================================================
// Classification result structure
// ============================================================================

describe('ClassificationResult structure', () => {
  it('should include original command string', () => {
    const result = classifyCommand('ls -la');
    expect(result.command).toBe('ls -la');
  });

  it('should include reason for classification', () => {
    const result = classifyCommand('ls -la');
    expect(result.reason).toBeTruthy();
    expect(typeof result.reason).toBe('string');
  });

  it('should include matched pattern for known commands', () => {
    const result = classifyCommand('ls -la');
    expect(result.matchedPattern).toBeDefined();
    expect(typeof result.matchedPattern).toBe('string');
  });

  it('should not include matched pattern for unknown commands', () => {
    const result = classifyCommand('some-unknown-command');
    expect(result.matchedPattern).toBeUndefined();
  });
});

// ============================================================================
// Priority ordering
// ============================================================================

describe('classifyCommand — priority ordering', () => {
  it('FORBIDDEN should take priority over CRITICAL', () => {
    expect(classifyCommand('rm -rf /').riskLevel).toBe(RiskLevel.FORBIDDEN);
  });

  it('CRITICAL should take priority over RED', () => {
    expect(classifyCommand('rm important-file.conf').riskLevel).toBe(RiskLevel.CRITICAL);
  });
});

// ============================================================================
// Custom rules
// ============================================================================

describe('Custom rules', () => {
  afterEach(() => {
    clearCustomRules();
  });

  it('should load custom rules via loadCustomRules', () => {
    loadCustomRules({
      rules: [
        { pattern: '\\bmy-dangerous-tool\\b', reason: 'Custom dangerous tool', level: 'forbidden' },
        { pattern: '\\bmy-safe-tool\\b', reason: 'Custom safe tool', level: 'green' },
      ],
    });
    expect(getCustomRuleCount()).toBe(2);
  });

  it('should classify commands using custom FORBIDDEN rules', () => {
    loadCustomRules({
      rules: [
        { pattern: '\\bmy-dangerous-tool\\b', reason: 'Custom dangerous tool', level: 'forbidden' },
      ],
    });
    expect(classifyCommand('my-dangerous-tool --execute').riskLevel).toBe(RiskLevel.FORBIDDEN);
  });

  it('should classify commands using custom GREEN rules', () => {
    loadCustomRules({
      rules: [
        { pattern: '^\\s*my-safe-tool\\b', reason: 'Custom safe tool', level: 'green' },
      ],
    });
    expect(classifyCommand('my-safe-tool --check').riskLevel).toBe(RiskLevel.GREEN);
  });

  it('should classify commands using custom YELLOW rules', () => {
    loadCustomRules({
      rules: [
        { pattern: '\\bmy-installer\\b', reason: 'Custom installer', level: 'yellow' },
      ],
    });
    expect(classifyCommand('my-installer --setup').riskLevel).toBe(RiskLevel.YELLOW);
  });

  it('should classify commands using custom CRITICAL rules', () => {
    loadCustomRules({
      rules: [
        { pattern: '\\bmy-destroyer\\b', reason: 'Custom destroyer', level: 'critical' },
      ],
    });
    expect(classifyCommand('my-destroyer --all').riskLevel).toBe(RiskLevel.CRITICAL);
  });

  it('should classify commands using custom RED rules', () => {
    loadCustomRules({
      rules: [
        { pattern: '\\bmy-modifier\\b', reason: 'Custom modifier', level: 'red' },
      ],
    });
    expect(classifyCommand('my-modifier --apply').riskLevel).toBe(RiskLevel.RED);
  });

  it('built-in rules should take priority over custom rules at same level', () => {
    loadCustomRules({
      rules: [
        { pattern: '^\\s*ls\\b', reason: 'Custom ls override', level: 'red' },
      ],
    });
    expect(classifyCommand('ls -la').riskLevel).toBe(RiskLevel.GREEN);
  });

  it('clearCustomRules should remove all custom rules', () => {
    loadCustomRules({
      rules: [
        { pattern: '\\bfoo\\b', reason: 'Test', level: 'forbidden' },
      ],
    });
    expect(getCustomRuleCount()).toBe(1);
    clearCustomRules();
    expect(getCustomRuleCount()).toBe(0);
  });

  it('loadCustomRules should replace previous custom rules', () => {
    loadCustomRules({
      rules: [
        { pattern: '\\bfoo\\b', reason: 'Test foo', level: 'forbidden' },
      ],
    });
    expect(getCustomRuleCount()).toBe(1);
    loadCustomRules({
      rules: [
        { pattern: '\\bbar\\b', reason: 'Test bar', level: 'red' },
        { pattern: '\\bbaz\\b', reason: 'Test baz', level: 'green' },
      ],
    });
    expect(getCustomRuleCount()).toBe(2);
  });

  it('should validate custom rule config with Zod', () => {
    expect(() => CustomRulesConfigSchema.parse({ rules: [] })).not.toThrow();
    expect(() => CustomRulesConfigSchema.parse({
      rules: [{ pattern: '\\btest\\b', reason: 'Test', level: 'green' }],
    })).not.toThrow();
    expect(() => CustomRulesConfigSchema.parse({
      rules: [{ pattern: '\\btest\\b', reason: 'Test', level: 'invalid' }],
    })).toThrow();
    expect(() => CustomRulesConfigSchema.parse({})).toThrow();
  });

  it('should throw on invalid regex patterns', () => {
    expect(() => loadCustomRules({
      rules: [{ pattern: '[invalid', reason: 'Bad regex', level: 'red' }],
    })).toThrow();
  });
});

// ============================================================================
// Helper functions
// ============================================================================

describe('requiresConfirmation', () => {
  it('should return false for GREEN', () => {
    expect(requiresConfirmation(RiskLevel.GREEN)).toBe(false);
  });

  it.each([
    [RiskLevel.YELLOW, 'YELLOW'],
    [RiskLevel.RED, 'RED'],
    [RiskLevel.CRITICAL, 'CRITICAL'],
    [RiskLevel.FORBIDDEN, 'FORBIDDEN'],
  ] as const)('should return true for %s', (level) => {
    expect(requiresConfirmation(level)).toBe(true);
  });
});

describe('requiresSnapshot', () => {
  it('should return true only for CRITICAL', () => {
    expect(requiresSnapshot(RiskLevel.CRITICAL)).toBe(true);
  });

  it.each([
    [RiskLevel.GREEN, 'GREEN'],
    [RiskLevel.YELLOW, 'YELLOW'],
    [RiskLevel.RED, 'RED'],
    [RiskLevel.FORBIDDEN, 'FORBIDDEN'],
  ] as const)('should return false for %s', (level) => {
    expect(requiresSnapshot(level)).toBe(false);
  });
});

describe('isForbidden', () => {
  it('should return true only for FORBIDDEN', () => {
    expect(isForbidden(RiskLevel.FORBIDDEN)).toBe(true);
  });

  it.each([
    [RiskLevel.GREEN, 'GREEN'],
    [RiskLevel.YELLOW, 'YELLOW'],
    [RiskLevel.RED, 'RED'],
    [RiskLevel.CRITICAL, 'CRITICAL'],
  ] as const)('should return false for %s', (level) => {
    expect(isForbidden(level)).toBe(false);
  });
});

describe('compareRiskLevels', () => {
  it('should return 0 for equal levels', () => {
    expect(compareRiskLevels(RiskLevel.GREEN, RiskLevel.GREEN)).toBe(0);
    expect(compareRiskLevels(RiskLevel.RED, RiskLevel.RED)).toBe(0);
  });

  it('should return positive when first is riskier', () => {
    expect(compareRiskLevels(RiskLevel.RED, RiskLevel.GREEN)).toBeGreaterThan(0);
    expect(compareRiskLevels(RiskLevel.FORBIDDEN, RiskLevel.CRITICAL)).toBeGreaterThan(0);
  });

  it('should return negative when first is less risky', () => {
    expect(compareRiskLevels(RiskLevel.GREEN, RiskLevel.RED)).toBeLessThan(0);
  });

  it('should maintain consistent ordering', () => {
    const levels: RiskLevel[] = [
      RiskLevel.GREEN, RiskLevel.YELLOW, RiskLevel.RED,
      RiskLevel.CRITICAL, RiskLevel.FORBIDDEN,
    ];
    for (let i = 0; i < levels.length - 1; i++) {
      expect(compareRiskLevels(levels[i], levels[i + 1])).toBeLessThan(0);
    }
  });
});

describe('getExecutionPolicy', () => {
  it('should return policy string for each risk level', () => {
    expect(getExecutionPolicy(RiskLevel.GREEN)).toContain('Auto-execute');
    expect(getExecutionPolicy(RiskLevel.YELLOW)).toContain('confirmation');
    expect(getExecutionPolicy(RiskLevel.RED)).toContain('impact');
    expect(getExecutionPolicy(RiskLevel.CRITICAL)).toContain('snapshot');
    expect(getExecutionPolicy(RiskLevel.FORBIDDEN)).toContain('prohibited');
  });
});

// ============================================================================
// Edge cases & security boundary tests
// ============================================================================

describe('classifyCommand — edge cases', () => {
  it('should handle leading/trailing whitespace', () => {
    expect(classifyCommand('  ls -la  ').riskLevel).toBe(RiskLevel.GREEN);
    expect(classifyCommand('  rm -rf /  ').riskLevel).toBe(RiskLevel.FORBIDDEN);
  });

  it('should handle mixed case for SQL commands', () => {
    expect(classifyCommand('Drop Database mydb').riskLevel).toBe(RiskLevel.CRITICAL);
    expect(classifyCommand('truncate TABLE logs').riskLevel).toBe(RiskLevel.CRITICAL);
    expect(classifyCommand('delete from users').riskLevel).toBe(RiskLevel.CRITICAL);
  });

  it('should not false-positive on partial matches', () => {
    expect(classifyCommand('systemctl status nginx').riskLevel).toBe(RiskLevel.GREEN);
    expect(classifyCommand('docker ps -a').riskLevel).toBe(RiskLevel.GREEN);
    expect(classifyCommand('apt list --installed').riskLevel).toBe(RiskLevel.GREEN);
  });

  it('should classify piped commands based on first command', () => {
    expect(classifyCommand('ls -la | grep nginx').riskLevel).toBe(RiskLevel.GREEN);
  });

  it('should handle commands with complex arguments', () => {
    expect(classifyCommand('apt install -y nginx php-fpm').riskLevel).toBe(RiskLevel.YELLOW);
    expect(classifyCommand('docker run -d -p 80:80 --name web nginx').riskLevel).toBe(RiskLevel.RED);
  });
});

describe('classifyCommand — security boundaries', () => {
  it('should never classify rm as GREEN', () => {
    for (const cmd of ['rm file.txt', 'rm -r dir/', 'rm -f file', 'rm -rf /tmp/old']) {
      expect(classifyCommand(cmd).riskLevel).not.toBe(RiskLevel.GREEN);
    }
  });

  it('should never classify service management as GREEN', () => {
    for (const cmd of ['systemctl restart nginx', 'systemctl stop nginx', 'service nginx restart']) {
      expect(classifyCommand(cmd).riskLevel).not.toBe(RiskLevel.GREEN);
    }
  });

  it('should never classify package removal as GREEN or YELLOW', () => {
    for (const cmd of ['apt remove nginx', 'apt purge nginx', 'yum remove httpd']) {
      const result = classifyCommand(cmd);
      expect(result.riskLevel).not.toBe(RiskLevel.GREEN);
      expect(result.riskLevel).not.toBe(RiskLevel.YELLOW);
    }
  });

  it('should never allow FORBIDDEN commands to be anything else', () => {
    for (const cmd of ['rm -rf /', 'rm -rf /*', 'mkfs.ext4 /dev/sda', 'fdisk /dev/sda']) {
      expect(classifyCommand(cmd).riskLevel).toBe(RiskLevel.FORBIDDEN);
    }
  });

  it('should classify aliases of dangerous commands the same way', () => {
    expect(classifyCommand('sudo rm -rf /').riskLevel).toBe(RiskLevel.FORBIDDEN);
    expect(classifyCommand('doas rm -rf /').riskLevel).toBe(RiskLevel.FORBIDDEN);
    expect(classifyCommand('pkexec rm -rf /').riskLevel).toBe(RiskLevel.FORBIDDEN);
    expect(classifyCommand('su -c "rm -rf /"').riskLevel).toBe(RiskLevel.FORBIDDEN);
  });
});

// ============================================================================
// Rule count verification
// ============================================================================

describe('Rule count verification', () => {
  it('should have 100+ total rules across all levels', () => {
    const total = FORBIDDEN_PATTERNS.length + CRITICAL_PATTERNS.length
      + GREEN_PATTERNS.length + YELLOW_PATTERNS.length + RED_PATTERNS.length;
    expect(total).toBeGreaterThanOrEqual(100);
  });

  it('should have 300+ total rules (enhanced rule library)', () => {
    const total = FORBIDDEN_PATTERNS.length + CRITICAL_PATTERNS.length
      + GREEN_PATTERNS.length + YELLOW_PATTERNS.length + RED_PATTERNS.length;
    expect(total).toBeGreaterThanOrEqual(300);
  });

  it('should have 430+ total rules (extended rule library with cloud/infra)', () => {
    const total = FORBIDDEN_PATTERNS.length + CRITICAL_PATTERNS.length
      + GREEN_PATTERNS.length + YELLOW_PATTERNS.length + RED_PATTERNS.length;
    expect(total).toBeGreaterThanOrEqual(430);
  });

  it('should have rules at every risk level', () => {
    expect(FORBIDDEN_PATTERNS.length).toBeGreaterThan(0);
    expect(CRITICAL_PATTERNS.length).toBeGreaterThan(0);
    expect(GREEN_PATTERNS.length).toBeGreaterThan(0);
    expect(YELLOW_PATTERNS.length).toBeGreaterThan(0);
    expect(RED_PATTERNS.length).toBeGreaterThan(0);
  });

  it('every rule should have a valid RegExp pattern and non-empty reason', () => {
    const allRules = [
      ...FORBIDDEN_PATTERNS, ...CRITICAL_PATTERNS,
      ...GREEN_PATTERNS, ...YELLOW_PATTERNS, ...RED_PATTERNS,
    ];
    for (const rule of allRules) {
      expect(rule.pattern).toBeInstanceOf(RegExp);
      expect(rule.reason.length).toBeGreaterThan(0);
    }
  });
});
