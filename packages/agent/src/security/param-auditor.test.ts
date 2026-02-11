// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect } from 'vitest';

import {
  auditCommand,
  DANGEROUS_PARAMS,
  DANGEROUS_FLAGS,
  PROTECTED_PATHS,
  PROTECTED_PATH_LIST,
  AuditResultSchema,
  hasDangerousParams,
  hasProtectedPaths,
  getParamWarnings,
  getPathBlockers,
  requiresExtraConfirmation,
  hasBlockers,
  parseAuditResult,
  safeParseAuditResult,
} from './param-auditor.js';

// ============================================================================
// Constants validation
// ============================================================================

describe('DANGEROUS_PARAMS', () => {
  it('should contain all required dangerous parameters from spec', () => {
    const requiredFlags = [
      '--purge', '--force', '--no-preserve-root', '-rf', '--hard',
      '--no-verify', '--no-check', '--delete', '-y', '--yes',
      '--no-backup', '--overwrite', '--recursive', '--assume-yes',
      '--force-with-lease', '--prune', '--wipe-data', '--reset',
      '--destroy', '--no-preserve', '--remove-all', '--cascade',
    ];
    for (const flag of requiredFlags) {
      expect(DANGEROUS_FLAGS).toContain(flag);
    }
  });

  it('should have descriptions for all parameters', () => {
    for (const dp of DANGEROUS_PARAMS) {
      expect(dp.flag).toBeTruthy();
      expect(dp.description).toBeTruthy();
      expect(dp.flag.startsWith('-')).toBe(true);
    }
  });

  it('DANGEROUS_FLAGS should match DANGEROUS_PARAMS flags', () => {
    expect(DANGEROUS_FLAGS).toHaveLength(DANGEROUS_PARAMS.length);
    for (let i = 0; i < DANGEROUS_PARAMS.length; i++) {
      expect(DANGEROUS_FLAGS[i]).toBe(DANGEROUS_PARAMS[i].flag);
    }
  });

  it('should have at least 36 dangerous params', () => {
    expect(DANGEROUS_PARAMS.length).toBeGreaterThanOrEqual(36);
  });

  it('should contain new enhanced dangerous parameters', () => {
    const newFlags = [
      '--no-deps', '--skip-validation', '--force-conflicts',
      '--ignore-errors', '--no-confirm', '--allow-root',
      '--unsafe', '--force-delete', '--no-keep-alive',
    ];
    for (const flag of newFlags) {
      expect(DANGEROUS_FLAGS).toContain(flag);
    }
  });
});

describe('PROTECTED_PATHS', () => {
  it('should contain all required protected paths from spec', () => {
    const requiredPaths = [
      '/etc', '/boot', '/usr', '/var/lib/mysql',
      '/var/lib/postgresql', '/root', '/bin', '/sbin',
      '/lib', '/proc', '/sys', '/dev',
    ];
    for (const p of requiredPaths) {
      expect(PROTECTED_PATH_LIST).toContain(p);
    }
  });

  it('should contain enhanced protected paths', () => {
    const enhancedPaths = [
      '/lib64', '/var/lib/docker', '/var/lib/redis',
      '/var/lib/mongodb', '/var/lib/elasticsearch',
      '/home', '/opt', '/var/log',
      '/var/lib/containerd', '/var/lib/grafana',
      '/var/lib/prometheus', '/var/backups', '/srv',
    ];
    for (const p of enhancedPaths) {
      expect(PROTECTED_PATH_LIST).toContain(p);
    }
  });

  it('should have descriptions for all paths', () => {
    for (const pp of PROTECTED_PATHS) {
      expect(pp.path).toBeTruthy();
      expect(pp.description).toBeTruthy();
      expect(pp.path.startsWith('/')).toBe(true);
    }
  });

  it('PROTECTED_PATH_LIST should match PROTECTED_PATHS paths', () => {
    expect(PROTECTED_PATH_LIST).toHaveLength(PROTECTED_PATHS.length);
    for (let i = 0; i < PROTECTED_PATHS.length; i++) {
      expect(PROTECTED_PATH_LIST[i]).toBe(PROTECTED_PATHS[i].path);
    }
  });

  it('should have at least 40 protected paths', () => {
    expect(PROTECTED_PATHS.length).toBeGreaterThanOrEqual(40);
  });

  it('should contain new enhanced protected paths', () => {
    const newPaths = [
      '/var/lib/lxc', '/var/lib/lxd', '/var/lib/cni',
      '/var/lib/rancher', '/var/lib/consul', '/var/lib/nomad',
      '/var/lib/vault', '/var/lib/minio', '/var/lib/clickhouse',
      '/var/lib/cassandra', '/var/lib/influxdb',
    ];
    for (const p of newPaths) {
      expect(PROTECTED_PATH_LIST).toContain(p);
    }
  });
});

// ============================================================================
// AuditResult Zod schema
// ============================================================================

describe('AuditResultSchema', () => {
  it('should validate a correct audit result', () => {
    const valid = { safe: true, warnings: [], blockers: [] };
    expect(AuditResultSchema.parse(valid)).toEqual(valid);
  });

  it('should validate an audit result with warnings and blockers', () => {
    const result = {
      safe: false,
      warnings: ['warning 1'],
      blockers: ['blocker 1'],
    };
    expect(AuditResultSchema.parse(result)).toEqual(result);
  });

  it('should reject invalid audit results', () => {
    expect(() => AuditResultSchema.parse({})).toThrow();
    expect(() => AuditResultSchema.parse({ safe: 'yes' })).toThrow();
    expect(() => AuditResultSchema.parse({ safe: true, warnings: 'not-array' })).toThrow();
  });
});

// ============================================================================
// auditCommand — dangerous parameter detection
// ============================================================================

describe('auditCommand — dangerous parameters', () => {
  it.each([
    ['apt remove --purge nginx', '--purge'],
    ['git push --force origin main', '--force'],
    ['rm --no-preserve-root /', '--no-preserve-root'],
    ['rm -rf /tmp/old', '-rf'],
    ['rm -fr /tmp/old', '-fr'],
    ['git reset --hard HEAD~1', '--hard'],
    ['git commit --no-verify', '--no-verify'],
    ['some-tool --no-backup', '--no-backup'],
    ['cp --overwrite /src /dst', '--overwrite'],
    ['rm --recursive /tmp/dir', '--recursive'],
    ['apt install --assume-yes nginx', '--assume-yes'],
    ['tool --no-prompt', '--no-prompt'],
    ['git push --force-with-lease origin main', '--force-with-lease'],
    ['git remote prune origin --prune', '--prune'],
    ['tool --wipe-data', '--wipe-data'],
    ['tool --reset', '--reset'],
    ['terraform destroy --destroy', '--destroy'],
    ['tool --no-preserve /data', '--no-preserve'],
    ['tool --remove-all', '--remove-all'],
    ['kubectl delete --cascade pod/my-pod', '--cascade'],
  ])('should warn for "%s" containing %s', (command, flag) => {
    const result = auditCommand(command);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings.some((w) => w.includes(flag))).toBe(true);
  });

  it('should detect multiple dangerous params in one command', () => {
    const result = auditCommand('rm -rf --force /tmp/old');
    expect(result.warnings.length).toBeGreaterThanOrEqual(2);
    expect(result.warnings.some((w) => w.includes('-rf'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('--force'))).toBe(true);
  });

  it('should not warn when dangerous flag appears only as part of a path', () => {
    const result = auditCommand('cat /tmp/--force-log/output.txt');
    expect(result.warnings.length).toBe(0);
  });

  it('should detect combined short flags like -rfv containing -rf', () => {
    const result = auditCommand('rm -rfv /tmp/old');
    expect(result.warnings.some((w) => w.includes('-rf'))).toBe(true);
  });

  it('should not generate duplicate warnings for the same param', () => {
    const result = auditCommand('rm -rf /tmp/a -rf /tmp/b');
    const rfWarnings = result.warnings.filter((w) => w.includes('-rf'));
    expect(rfWarnings).toHaveLength(1);
  });

  it('should detect -y flag', () => {
    const result = auditCommand('apt install -y nginx');
    expect(result.warnings.some((w) => w.includes('-y'))).toBe(true);
  });

  it('should detect --yes flag', () => {
    const result = auditCommand('apt remove --yes nginx');
    expect(result.warnings.some((w) => w.includes('--yes'))).toBe(true);
  });

  it('should detect --delete flag (rsync)', () => {
    const result = auditCommand('rsync -avz --delete /src/ /dst/');
    expect(result.warnings.some((w) => w.includes('--delete'))).toBe(true);
  });

  it('should detect --no-check flag', () => {
    const result2 = auditCommand('some-tool --no-check');
    expect(result2.warnings.some((w) => w.includes('--no-check'))).toBe(true);
  });

  it.each([
    ['tool --no-deps install pkg', '--no-deps'],
    ['tool --skip-validation deploy', '--skip-validation'],
    ['tool --force-conflicts merge', '--force-conflicts'],
    ['tool --ignore-errors run', '--ignore-errors'],
    ['tool --no-confirm delete', '--no-confirm'],
    ['npm install --allow-root', '--allow-root'],
    ['tool --unsafe exec', '--unsafe'],
    ['tool --force-delete resource', '--force-delete'],
    ['tool --no-keep-alive check', '--no-keep-alive'],
  ])('should warn for new param "%s" containing %s', (command, flag) => {
    const result = auditCommand(command);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings.some((w) => w.includes(flag))).toBe(true);
  });
});

// ============================================================================
// auditCommand — safe commands (no warnings, no blockers)
// ============================================================================

describe('auditCommand — safe commands', () => {
  it.each([
    ['ls -la', 'simple listing'],
    ['cat /var/log/syslog', 'file viewing'],
    ['df -h', 'disk space check'],
    ['systemctl status nginx', 'service status'],
    ['docker ps -a', 'docker listing'],
    ['apt list --installed', 'package listing'],
    ['git log --oneline', 'git log'],
    ['find /var/log -name "*.log"', 'file search'],
    ['grep -r "error" /var/log/', 'text search'],
  ])('should return safe=true for "%s" (%s)', (command) => {
    const result = auditCommand(command);
    expect(result.safe).toBe(true);
    expect(result.warnings).toHaveLength(0);
    expect(result.blockers).toHaveLength(0);
  });
});

// ============================================================================
// auditCommand — protected path detection
// ============================================================================

describe('auditCommand — protected paths with destructive ops', () => {
  it.each([
    ['rm /etc/nginx/nginx.conf', '/etc'],
    ['rm -r /boot/grub/', '/boot'],
    ['rm /usr/local/bin/app', '/usr'],
    ['rm -rf /var/lib/mysql/data/', '/var/lib/mysql'],
    ['rm /var/lib/postgresql/14/', '/var/lib/postgresql'],
    ['rm -rf /root/.ssh/', '/root'],
    ['rm /bin/ls', '/bin'],
    ['rm /sbin/init', '/sbin'],
    ['rm /var/lib/docker/overlay2/', '/var/lib/docker'],
    ['rm /var/lib/redis/dump.rdb', '/var/lib/redis'],
    ['rm /var/lib/mongodb/data/', '/var/lib/mongodb'],
    ['rm /var/log/syslog', '/var/log'],
    ['rm /home/user/important.txt', '/home'],
    ['rm /opt/app/data', '/opt'],
    ['rm /var/lib/containerd/data', '/var/lib/containerd'],
    ['rm /var/lib/grafana/grafana.db', '/var/lib/grafana'],
    ['rm /var/lib/prometheus/data/', '/var/lib/prometheus'],
    ['rm /var/backups/daily.tar.gz', '/var/backups'],
    ['rm /srv/www/index.html', '/srv'],
  ])('should block destructive rm on "%s" (path: %s)', (command, path) => {
    const result = auditCommand(command);
    expect(result.safe).toBe(false);
    expect(result.blockers.length).toBeGreaterThan(0);
    expect(result.blockers.some((b) => b.includes(path))).toBe(true);
  });

  it('should block shred on protected paths', () => {
    const result = auditCommand('shred /etc/passwd');
    expect(result.safe).toBe(false);
    expect(result.blockers.some((b) => b.includes('/etc'))).toBe(true);
  });

  it('should block truncate on protected paths', () => {
    const result = auditCommand('truncate -s 0 /var/lib/mysql/ibdata1');
    expect(result.safe).toBe(false);
    expect(result.blockers.some((b) => b.includes('/var/lib/mysql'))).toBe(true);
  });

  it('should block mv on protected paths', () => {
    const result = auditCommand('mv /etc/nginx/nginx.conf /tmp/');
    expect(result.safe).toBe(false);
    expect(result.blockers.some((b) => b.includes('/etc'))).toBe(true);
  });

  it('should NOT block read-only operations on protected paths', () => {
    const result = auditCommand('cat /etc/nginx/nginx.conf');
    expect(result.safe).toBe(true);
    expect(result.blockers).toHaveLength(0);
  });

  it('should NOT block ls on protected paths', () => {
    const result = auditCommand('ls /etc/');
    expect(result.safe).toBe(true);
    expect(result.blockers).toHaveLength(0);
  });

  it('should NOT block cp (non-destructive) on protected paths', () => {
    const result = auditCommand('cp /etc/nginx/nginx.conf /tmp/backup.conf');
    expect(result.safe).toBe(true);
    expect(result.blockers).toHaveLength(0);
  });

  it('should detect multiple protected paths in one command', () => {
    const result = auditCommand('rm /etc/hosts /boot/grub/grub.cfg');
    expect(result.safe).toBe(false);
    expect(result.blockers.length).toBeGreaterThanOrEqual(2);
    expect(result.blockers.some((b) => b.includes('/etc'))).toBe(true);
    expect(result.blockers.some((b) => b.includes('/boot'))).toBe(true);
  });

  it('should not false-positive on paths that start with protected path prefix', () => {
    const result = auditCommand('rm /etcetera/file.txt');
    expect(result.blockers.some((b) => b.includes('/etc'))).toBe(false);
  });

  it('should match subdirectories of protected paths', () => {
    const result = auditCommand('rm /etc/nginx/sites-enabled/default');
    expect(result.safe).toBe(false);
    expect(result.blockers.some((b) => b.includes('/etc'))).toBe(true);
  });

  it.each([
    ['rm /var/lib/consul/data/', '/var/lib/consul'],
    ['rm /var/lib/vault/core/', '/var/lib/vault'],
    ['rm /var/lib/nomad/data/', '/var/lib/nomad'],
    ['rm /var/lib/minio/data/', '/var/lib/minio'],
    ['rm /var/lib/clickhouse/data/', '/var/lib/clickhouse'],
    ['rm /var/lib/cassandra/data/', '/var/lib/cassandra'],
    ['rm /var/lib/influxdb/data/', '/var/lib/influxdb'],
    ['rm /var/lib/lxc/container/', '/var/lib/lxc'],
    ['rm /var/lib/rancher/data/', '/var/lib/rancher'],
  ])('should block destructive rm on new path "%s" (path: %s)', (command, path) => {
    const result = auditCommand(command);
    expect(result.safe).toBe(false);
    expect(result.blockers.length).toBeGreaterThan(0);
    expect(result.blockers.some((b) => b.includes(path))).toBe(true);
  });
});

// ============================================================================
// auditCommand — combined warnings and blockers
// ============================================================================

describe('auditCommand — combined warnings and blockers', () => {
  it('should produce both warnings and blockers', () => {
    const result = auditCommand('rm --force /etc/nginx/nginx.conf');
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.blockers.length).toBeGreaterThan(0);
    expect(result.safe).toBe(false);
    expect(result.warnings.some((w) => w.includes('--force'))).toBe(true);
    expect(result.blockers.some((b) => b.includes('/etc'))).toBe(true);
  });

  it('should produce warnings without blockers for dangerous params on non-protected paths', () => {
    const result = auditCommand('rm --force /tmp/test.txt');
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.blockers).toHaveLength(0);
    expect(result.safe).toBe(true);
  });
});

// ============================================================================
// auditCommand — alias handling (sudo, doas, pkexec)
// ============================================================================

describe('auditCommand — alias prefix handling', () => {
  it('should strip sudo and audit the underlying command', () => {
    const result = auditCommand('sudo rm --force /etc/nginx/nginx.conf');
    expect(result.warnings.some((w) => w.includes('--force'))).toBe(true);
    expect(result.blockers.some((b) => b.includes('/etc'))).toBe(true);
    expect(result.safe).toBe(false);
  });

  it('should handle sudo with flags', () => {
    const result = auditCommand('sudo -u root rm -rf /etc/nginx/');
    expect(result.warnings.some((w) => w.includes('-rf'))).toBe(true);
    expect(result.blockers.some((b) => b.includes('/etc'))).toBe(true);
  });

  it('should handle sudo with long options', () => {
    const result = auditCommand('sudo --preserve-env rm --force /boot/grub/');
    expect(result.warnings.some((w) => w.includes('--force'))).toBe(true);
    expect(result.blockers.some((b) => b.includes('/boot'))).toBe(true);
  });

  it('should strip doas and audit the underlying command', () => {
    const result = auditCommand('doas rm --force /etc/nginx/nginx.conf');
    expect(result.warnings.some((w) => w.includes('--force'))).toBe(true);
    expect(result.blockers.some((b) => b.includes('/etc'))).toBe(true);
  });

  it('should strip pkexec and audit the underlying command', () => {
    const result = auditCommand('pkexec rm --force /etc/hosts');
    expect(result.warnings.some((w) => w.includes('--force'))).toBe(true);
    expect(result.blockers.some((b) => b.includes('/etc'))).toBe(true);
  });
});

// ============================================================================
// auditCommand — edge cases
// ============================================================================

describe('auditCommand — edge cases', () => {
  it('should handle empty command', () => {
    const result = auditCommand('');
    expect(result.safe).toBe(true);
    expect(result.warnings).toHaveLength(0);
    expect(result.blockers).toHaveLength(0);
  });

  it('should handle whitespace-only command', () => {
    const result = auditCommand('   ');
    expect(result.safe).toBe(true);
    expect(result.warnings).toHaveLength(0);
    expect(result.blockers).toHaveLength(0);
  });

  it('should handle leading/trailing whitespace', () => {
    const result = auditCommand('  rm --force /etc/hosts  ');
    expect(result.warnings.some((w) => w.includes('--force'))).toBe(true);
    expect(result.blockers.some((b) => b.includes('/etc'))).toBe(true);
  });

  it('should handle commands with quoted arguments', () => {
    const result = auditCommand('rm "/etc/nginx/nginx.conf"');
    expect(result.safe).toBe(false);
    expect(result.blockers.some((b) => b.includes('/etc'))).toBe(true);
  });

  it('should handle commands with single-quoted arguments', () => {
    const result = auditCommand("rm '/etc/nginx/nginx.conf'");
    expect(result.safe).toBe(false);
    expect(result.blockers.some((b) => b.includes('/etc'))).toBe(true);
  });

  it('should handle SQL destructive operations', () => {
    const result = auditCommand('DROP TABLE users');
    expect(result.safe).toBe(true);
  });

  it('should handle commands with pipe operators', () => {
    const result = auditCommand('rm --force /tmp/file | tee /var/log/output');
    expect(result.warnings.some((w) => w.includes('--force'))).toBe(true);
  });
});

// ============================================================================
// Helper functions
// ============================================================================

describe('hasDangerousParams', () => {
  it('should return true when dangerous params exist', () => {
    expect(hasDangerousParams('rm -rf /tmp/old')).toBe(true);
    expect(hasDangerousParams('git push --force')).toBe(true);
    expect(hasDangerousParams('apt remove --purge nginx')).toBe(true);
    expect(hasDangerousParams('tool --no-backup')).toBe(true);
    expect(hasDangerousParams('cp --overwrite src dst')).toBe(true);
  });

  it('should return false when no dangerous params exist', () => {
    expect(hasDangerousParams('ls -la')).toBe(false);
    expect(hasDangerousParams('cat /etc/hosts')).toBe(false);
    expect(hasDangerousParams('docker ps -a')).toBe(false);
  });

  it('should return false for empty command', () => {
    expect(hasDangerousParams('')).toBe(false);
    expect(hasDangerousParams('  ')).toBe(false);
  });
});

describe('hasProtectedPaths', () => {
  it('should return true when protected paths exist', () => {
    expect(hasProtectedPaths('cat /etc/hosts')).toBe(true);
    expect(hasProtectedPaths('ls /boot/')).toBe(true);
    expect(hasProtectedPaths('ls /var/lib/mysql/')).toBe(true);
    expect(hasProtectedPaths('ls /var/lib/docker/')).toBe(true);
    expect(hasProtectedPaths('ls /home/user/')).toBe(true);
    expect(hasProtectedPaths('ls /var/log/')).toBe(true);
  });

  it('should return false when no protected paths exist', () => {
    expect(hasProtectedPaths('ls /tmp/')).toBe(false);
    expect(hasProtectedPaths('docker ps')).toBe(false);
  });

  it('should return false for empty command', () => {
    expect(hasProtectedPaths('')).toBe(false);
    expect(hasProtectedPaths('  ')).toBe(false);
  });
});

describe('getParamWarnings', () => {
  it('should return warnings for commands with dangerous params', () => {
    const warnings = getParamWarnings('rm --force /tmp/file');
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings.some((w) => w.includes('--force'))).toBe(true);
  });

  it('should return empty array for safe commands', () => {
    expect(getParamWarnings('ls -la')).toHaveLength(0);
  });
});

describe('getPathBlockers', () => {
  it('should return blockers for destructive ops on protected paths', () => {
    const blockers = getPathBlockers('rm /etc/hosts');
    expect(blockers.length).toBeGreaterThan(0);
    expect(blockers.some((b) => b.includes('/etc'))).toBe(true);
  });

  it('should return empty array for non-destructive ops', () => {
    expect(getPathBlockers('cat /etc/hosts')).toHaveLength(0);
  });

  it('should return empty array for destructive ops on non-protected paths', () => {
    expect(getPathBlockers('rm /tmp/file')).toHaveLength(0);
  });
});

describe('requiresExtraConfirmation', () => {
  it('should return true when there are warnings', () => {
    expect(requiresExtraConfirmation({ safe: true, warnings: ['warn'], blockers: [] })).toBe(true);
  });

  it('should return true when there are blockers', () => {
    expect(requiresExtraConfirmation({ safe: false, warnings: [], blockers: ['block'] })).toBe(true);
  });

  it('should return true when there are both', () => {
    expect(requiresExtraConfirmation({ safe: false, warnings: ['w'], blockers: ['b'] })).toBe(true);
  });

  it('should return false for clean results', () => {
    expect(requiresExtraConfirmation({ safe: true, warnings: [], blockers: [] })).toBe(false);
  });
});

describe('hasBlockers', () => {
  it('should return true when blockers exist', () => {
    expect(hasBlockers({ safe: false, warnings: [], blockers: ['blocker'] })).toBe(true);
  });

  it('should return false when no blockers exist', () => {
    expect(hasBlockers({ safe: true, warnings: ['warning'], blockers: [] })).toBe(false);
    expect(hasBlockers({ safe: true, warnings: [], blockers: [] })).toBe(false);
  });
});

// ============================================================================
// Validation helpers
// ============================================================================

describe('parseAuditResult', () => {
  it('should parse a valid audit result', () => {
    const data = { safe: true, warnings: [], blockers: [] };
    expect(parseAuditResult(data)).toEqual(data);
  });

  it('should throw on invalid data', () => {
    expect(() => parseAuditResult({})).toThrow();
    expect(() => parseAuditResult({ safe: 'yes' })).toThrow();
    expect(() => parseAuditResult(null)).toThrow();
  });
});

describe('safeParseAuditResult', () => {
  it('should return success for valid data', () => {
    const result = safeParseAuditResult({ safe: true, warnings: [], blockers: [] });
    expect(result.success).toBe(true);
  });

  it('should return failure for invalid data', () => {
    const result = safeParseAuditResult({ invalid: true });
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// AuditResult structure
// ============================================================================

describe('AuditResult structure', () => {
  it('should always return an object with safe, warnings, and blockers', () => {
    const commands = [
      'ls -la',
      'rm --force /etc/hosts',
      'sudo rm -rf /boot/',
      '',
      'git push --force',
    ];
    for (const cmd of commands) {
      const result = auditCommand(cmd);
      expect(typeof result.safe).toBe('boolean');
      expect(Array.isArray(result.warnings)).toBe(true);
      expect(Array.isArray(result.blockers)).toBe(true);
      expect(() => AuditResultSchema.parse(result)).not.toThrow();
    }
  });
});

// ============================================================================
// Security boundaries
// ============================================================================

describe('auditCommand — security boundaries', () => {
  it('should always block rm on /etc', () => {
    const commands = [
      'rm /etc/hosts',
      'rm -f /etc/passwd',
      'rm -rf /etc/',
      'sudo rm /etc/shadow',
    ];
    for (const cmd of commands) {
      const result = auditCommand(cmd);
      expect(result.safe).toBe(false);
      expect(result.blockers.some((b) => b.includes('/etc'))).toBe(true);
    }
  });

  it('should always block rm on /boot', () => {
    const result = auditCommand('rm -rf /boot/grub/');
    expect(result.safe).toBe(false);
    expect(result.blockers.some((b) => b.includes('/boot'))).toBe(true);
  });

  it('should always block rm on database data directories', () => {
    const commands = [
      'rm -rf /var/lib/mysql/',
      'rm -rf /var/lib/postgresql/14/main/',
      'rm -rf /var/lib/redis/',
      'rm -rf /var/lib/mongodb/',
      'rm -rf /var/lib/elasticsearch/',
    ];
    for (const cmd of commands) {
      const result = auditCommand(cmd);
      expect(result.safe).toBe(false);
    }
  });

  it('should always warn on --force flag regardless of command', () => {
    const commands = [
      'git push --force',
      'docker rm --force container',
      'npm install --force',
    ];
    for (const cmd of commands) {
      const result = auditCommand(cmd);
      expect(result.warnings.some((w) => w.includes('--force'))).toBe(true);
    }
  });

  it('should always warn on -rf flag', () => {
    const commands = [
      'rm -rf /tmp/old',
      'rm -rfv /tmp/old',
    ];
    for (const cmd of commands) {
      const result = auditCommand(cmd);
      expect(result.warnings.some((w) => w.includes('-rf'))).toBe(true);
    }
  });

  it('safe=true should never be returned when blockers exist', () => {
    const dangerousCommands = [
      'rm /etc/hosts',
      'rm -rf /boot/',
      'mv /etc/nginx/nginx.conf /tmp/',
      'shred /var/lib/mysql/data.ibd',
    ];
    for (const cmd of dangerousCommands) {
      const result = auditCommand(cmd);
      if (result.blockers.length > 0) {
        expect(result.safe).toBe(false);
      }
    }
  });
});
