/**
 * Tests for enhanced command classification rules (task-007).
 * Covers new rules added for command-rules.ts enhancements.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { writeFileSync, unlinkSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  classifyCommand,
  RiskLevel,
  loadCustomRules,
  loadCustomRulesFromFile,
  clearCustomRules,
  getCustomRuleCount,
  getBuiltinRuleCount,
} from './command-classifier.js';
import {
  FORBIDDEN_PATTERNS,
  CRITICAL_PATTERNS,
  GREEN_PATTERNS,
  YELLOW_PATTERNS,
  RED_PATTERNS,
} from './command-rules.js';
import {
  auditCommand,
  DANGEROUS_PARAMS,
  DANGEROUS_FLAGS,
  PROTECTED_PATHS,
  PROTECTED_PATH_LIST,
  hasDangerousParams,
  hasProtectedPaths,
} from './param-auditor.js';

// ============================================================================
// Enhanced rule count verification
// ============================================================================

describe('Enhanced rule count verification', () => {
  it('should have 500+ total built-in rules (enhanced library)', () => {
    const total = getBuiltinRuleCount();
    expect(total).toBeGreaterThanOrEqual(500);
  });

  it('should have 45+ FORBIDDEN patterns', () => {
    expect(FORBIDDEN_PATTERNS.length).toBeGreaterThanOrEqual(45);
  });

  it('should have 90+ CRITICAL patterns', () => {
    expect(CRITICAL_PATTERNS.length).toBeGreaterThanOrEqual(90);
  });

  it('should have 215+ GREEN patterns', () => {
    expect(GREEN_PATTERNS.length).toBeGreaterThanOrEqual(215);
  });

  it('should have 70+ YELLOW patterns', () => {
    expect(YELLOW_PATTERNS.length).toBeGreaterThanOrEqual(70);
  });

  it('should have 90+ RED patterns', () => {
    expect(RED_PATTERNS.length).toBeGreaterThanOrEqual(90);
  });

  it('getBuiltinRuleCount should match sum of all pattern arrays', () => {
    const sum = FORBIDDEN_PATTERNS.length + CRITICAL_PATTERNS.length
      + GREEN_PATTERNS.length + YELLOW_PATTERNS.length + RED_PATTERNS.length;
    expect(getBuiltinRuleCount()).toBe(sum);
  });
});

// ============================================================================
// New FORBIDDEN patterns
// ============================================================================

describe('classifyCommand — new FORBIDDEN patterns', () => {
  it.each([
    ['iptables -F', 'Firewall flush'],
    ['iptables --flush', 'Firewall flush (long)'],
    ['cgdelete cpu:/mygroup', 'Cgroup deletion'],
    ['grub-install /dev/sda', 'GRUB install'],
    ['systemctl mask networking', 'Mask critical networking service'],
    ['systemctl mask sshd', 'Mask critical sshd service'],
  ])('should classify "%s" as FORBIDDEN (%s)', (command) => {
    expect(classifyCommand(command).riskLevel).toBe(RiskLevel.FORBIDDEN);
  });
});

// ============================================================================
// New CRITICAL patterns
// ============================================================================

describe('classifyCommand — new CRITICAL patterns', () => {
  it.each([
    ['cargo uninstall serde', 'Rust uninstall'],
    ['go clean -cache', 'Go cache clean'],
    ['git branch -d feature', 'Git branch delete'],
    ['git branch -D feature', 'Git branch force delete'],
    ['git branch --delete feature', 'Git branch delete (long)'],
    ['git tag -d v1.0', 'Git tag delete'],
    ['flatpak uninstall org.app.Name', 'Flatpak uninstall'],
    ['nix-collect-garbage -d', 'Nix garbage collection'],
    ['docker network prune', 'Docker network prune'],
    ['git reset --hard HEAD~1', 'Git hard reset'],
    ['REVOKE ALL ON database FROM user', 'DB privilege revocation'],
  ])('should classify "%s" as CRITICAL (%s)', (command) => {
    expect(classifyCommand(command).riskLevel).toBe(RiskLevel.CRITICAL);
  });

  it.each([
    ['aws iam delete-user --user-name john', 'AWS IAM user deletion'],
    ['aws iam delete-role --role-name admin', 'AWS IAM role deletion'],
    ['aws lambda delete-function --function-name myFunc', 'AWS Lambda deletion'],
    ['aws ecs delete-cluster --cluster mycluster', 'AWS ECS cluster deletion'],
  ])('should classify AWS destructive "%s" as CRITICAL (%s)', (command) => {
    expect(classifyCommand(command).riskLevel).toBe(RiskLevel.CRITICAL);
  });

  it.each([
    ['mongo --eval "db.dropDatabase()"', 'MongoDB drop database'],
    ['mongosh --eval "db.users.drop()"', 'MongoDB drop collection'],
    ['curl -X DELETE http://localhost:9200/my-index', 'Elasticsearch index delete'],
  ])('should classify database destructive "%s" as CRITICAL (%s)', (command) => {
    expect(classifyCommand(command).riskLevel).toBe(RiskLevel.CRITICAL);
  });
});

// ============================================================================
// New GREEN patterns
// ============================================================================

describe('classifyCommand — new GREEN patterns', () => {
  it.each([
    ['flatpak list'], ['flatpak info org.app.Name'],
    ['flatpak search firefox'], ['flatpak remote-ls flathub'],
    ['snap info firefox'], ['snap find editor'],
  ])('should classify flatpak/snap query "%s" as GREEN', (command) => {
    expect(classifyCommand(command).riskLevel).toBe(RiskLevel.GREEN);
  });

  it.each([
    ['nix-env -q'], ['nix-env --query'],
    ['nix search nixpkgs#hello'], ['nix show nixpkgs#hello'],
  ])('should classify nix query "%s" as GREEN', (command) => {
    expect(classifyCommand(command).riskLevel).toBe(RiskLevel.GREEN);
  });

  it.each([
    ['cargo check'], ['cargo test'], ['cargo clippy'],
    ['cargo doc'], ['cargo bench'],
  ])('should classify cargo read-only "%s" as GREEN', (command) => {
    expect(classifyCommand(command).riskLevel).toBe(RiskLevel.GREEN);
  });

  it.each([
    ['go test ./...'], ['go vet ./...'],
    ['go list -m all'], ['go mod tidy'],
    ['go mod graph'], ['go mod verify'],
  ])('should classify go read-only "%s" as GREEN', (command) => {
    expect(classifyCommand(command).riskLevel).toBe(RiskLevel.GREEN);
  });

  it.each([
    ['pip list'], ['pip show flask'], ['pip freeze'], ['pip check'],
    ['pip3 list'], ['pip3 show requests'],
    ['python3 -m pytest tests/'],
  ])('should classify python read-only "%s" as GREEN', (command) => {
    expect(classifyCommand(command).riskLevel).toBe(RiskLevel.GREEN);
  });

  it.each([
    ['gem list'], ['gem info rails'], ['gem search rails'],
    ['bundle list'], ['bundle show'], ['bundle check'],
  ])('should classify ruby read-only "%s" as GREEN', (command) => {
    expect(classifyCommand(command).riskLevel).toBe(RiskLevel.GREEN);
  });

  it.each([
    ['dotnet list'], ['dotnet test'], ['dotnet nuget list source'],
    ['composer show'], ['composer validate'], ['composer info'],
    ['php -v'],
  ])('should classify .NET/PHP read-only "%s" as GREEN', (command) => {
    expect(classifyCommand(command).riskLevel).toBe(RiskLevel.GREEN);
  });

  it.each([
    ['tune2fs -l /dev/sda1'], ['xfs_info /dev/sda1'],
  ])('should classify filesystem info "%s" as GREEN', (command) => {
    expect(classifyCommand(command).riskLevel).toBe(RiskLevel.GREEN);
  });

  it.each([
    ['ip rule show'], ['ip tunnel show'],
    ['tc qdisc show'], ['tc class show'], ['tc filter show'],
  ])('should classify network info "%s" as GREEN', (command) => {
    expect(classifyCommand(command).riskLevel).toBe(RiskLevel.GREEN);
  });

  it.each([
    ['kubectl api-resources'], ['kubectl config view'],
    ['kubectl config get-contexts'], ['kubectl config current-context'],
    ['kubectl version'],
  ])('should classify k8s extended read-only "%s" as GREEN', (command) => {
    expect(classifyCommand(command).riskLevel).toBe(RiskLevel.GREEN);
  });

  it.each([
    ['docker history nginx:latest'], ['docker image ls'],
    ['docker container ls'], ['docker system df'],
  ])('should classify docker extended read-only "%s" as GREEN', (command) => {
    expect(classifyCommand(command).riskLevel).toBe(RiskLevel.GREEN);
  });

  it.each([
    ['systemctl list-dependencies'], ['systemctl list-sockets'],
    ['systemctl cat nginx.service'],
  ])('should classify systemd extended read-only "%s" as GREEN', (command) => {
    expect(classifyCommand(command).riskLevel).toBe(RiskLevel.GREEN);
  });

  it.each([
    ['mvn dependency:tree'], ['mvn validate'], ['mvn test'],
    ['gradle dependencies'], ['gradle tasks'], ['gradle test'],
  ])('should classify maven/gradle read-only "%s" as GREEN', (command) => {
    expect(classifyCommand(command).riskLevel).toBe(RiskLevel.GREEN);
  });

  it.each([
    ['atop'], ['nmon'], ['glances'], ['iotop'],
    ['strace -p 1234'], ['ltrace ls'],
  ])('should classify monitoring tools "%s" as GREEN', (command) => {
    expect(classifyCommand(command).riskLevel).toBe(RiskLevel.GREEN);
  });

  it.each([
    ['lynis audit system'], ['chkrootkit'],
    ['rkhunter --check'],
  ])('should classify security audit "%s" as GREEN', (command) => {
    expect(classifyCommand(command).riskLevel).toBe(RiskLevel.GREEN);
  });

  it.each([
    ['terraform fmt'], ['terraform graph'], ['terraform providers'],
    ['terraform version'], ['terraform workspace list'],
  ])('should classify terraform read-only "%s" as GREEN', (command) => {
    expect(classifyCommand(command).riskLevel).toBe(RiskLevel.GREEN);
  });
});

// ============================================================================
// New YELLOW patterns
// ============================================================================

describe('classifyCommand — new YELLOW patterns', () => {
  it.each([
    ['flatpak install org.app.Name', 'Flatpak install'],
    ['flatpak update', 'Flatpak update'],
    ['nix-env -i hello', 'Nix install'],
    ['nix profile install nixpkgs#hello', 'Nix profile install'],
    ['snap refresh', 'Snap refresh'],
    ['rustup update', 'Rustup update'],
    ['rustup install stable', 'Rustup install'],
    ['pecl install redis', 'PECL install'],
    ['luarocks install luasocket', 'Luarocks install'],
  ])('should classify "%s" as YELLOW (%s)', (command) => {
    expect(classifyCommand(command).riskLevel).toBe(RiskLevel.YELLOW);
  });
});

// ============================================================================
// New RED patterns
// ============================================================================

describe('classifyCommand — new RED patterns', () => {
  it.each([
    ['INSERT INTO users VALUES (1, "john")', 'DB insert'],
    ['UPDATE users SET name = "john" WHERE id = 1', 'DB update'],
    ['GRANT SELECT ON db TO user', 'DB grant'],
    ['ALTER TABLE users ADD COLUMN age INT', 'DB alter add'],
    ['CREATE TABLE users (id INT)', 'DB create table'],
    ['CREATE DATABASE mydb', 'DB create database'],
  ])('should classify SQL modification "%s" as RED (%s)', (command) => {
    expect(classifyCommand(command).riskLevel).toBe(RiskLevel.RED);
  });

  it.each([
    ['sysctl -w net.ipv4.ip_forward=1', 'Kernel param change'],
    ['timedatectl set-timezone UTC', 'Timezone change'],
    ['hostnamectl set-hostname myhost', 'Hostname change'],
    ['localectl set-locale LANG=en_US.UTF-8', 'Locale change'],
  ])('should classify system config "%s" as RED (%s)', (command) => {
    expect(classifyCommand(command).riskLevel).toBe(RiskLevel.RED);
  });

  it.each([
    ['snap set firefox key=value', 'Snap set'],
    ['flatpak override org.app.Name --allow=network', 'Flatpak override'],
  ])('should classify snap/flatpak management "%s" as RED (%s)', (command) => {
    expect(classifyCommand(command).riskLevel).toBe(RiskLevel.RED);
  });

  it.each([
    ['git clean -fd', 'Git clean'],
    ['git revert HEAD', 'Git revert'],
    ['git am patch.mbox', 'Git apply patches'],
    ['git bisect start', 'Git bisect'],
  ])('should classify git advanced "%s" as RED (%s)', (command) => {
    expect(classifyCommand(command).riskLevel).toBe(RiskLevel.RED);
  });

  it.each([
    ['helm repo add stable https://example.com', 'Helm repo add'],
    ['helm repo remove stable', 'Helm repo remove'],
    ['helm repo update', 'Helm repo update'],
    ['terraform init', 'Terraform init'],
    ['terraform import aws_instance.a i-123', 'Terraform import'],
    ['terraform taint aws_instance.a', 'Terraform taint'],
  ])('should classify infrastructure "%s" as RED (%s)', (command) => {
    expect(classifyCommand(command).riskLevel).toBe(RiskLevel.RED);
  });

  it.each([
    ['kubectl cordon node1', 'K8s cordon'],
    ['kubectl uncordon node1', 'K8s uncordon'],
    ['kubectl drain node1', 'K8s drain'],
    ['kubectl taint nodes node1 key=value:NoSchedule', 'K8s taint'],
    ['kubectl label pods my-pod app=v2', 'K8s label'],
    ['kubectl annotate pods my-pod desc="test"', 'K8s annotate'],
  ])('should classify k8s management "%s" as RED (%s)', (command) => {
    expect(classifyCommand(command).riskLevel).toBe(RiskLevel.RED);
  });

  it.each([
    ['podman push myrepo/myapp:latest', 'Podman push'],
    ['podman commit container1 myimage', 'Podman commit'],
    ['docker commit container1 myimage', 'Docker commit'],
    ['docker tag myimage:latest myimage:v2', 'Docker tag'],
  ])('should classify container registry ops "%s" as RED (%s)', (command) => {
    expect(classifyCommand(command).riskLevel).toBe(RiskLevel.RED);
  });

  it.each([
    ['ip route add 10.0.0.0/8 via 192.168.1.1', 'IP route add'],
    ['ip route del default', 'IP route delete'],
    ['at now + 5 minutes', 'Scheduled command'],
  ])('should classify network/schedule "%s" as RED (%s)', (command) => {
    expect(classifyCommand(command).riskLevel).toBe(RiskLevel.RED);
  });
});

// ============================================================================
// loadCustomRulesFromFile
// ============================================================================

describe('loadCustomRulesFromFile', () => {
  let tempDir: string;

  afterEach(() => {
    clearCustomRules();
  });

  it('should load rules from a valid JSON file', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'rules-'));
    const filePath = join(tempDir, 'rules.json');
    writeFileSync(filePath, JSON.stringify({
      rules: [
        { pattern: '\\bmy-custom-tool\\b', reason: 'Custom tool', level: 'forbidden' },
        { pattern: '\\bmy-safe-check\\b', reason: 'Safe check', level: 'green' },
      ],
    }));
    loadCustomRulesFromFile(filePath);
    expect(getCustomRuleCount()).toBe(2);
    expect(classifyCommand('my-custom-tool --exec').riskLevel).toBe(RiskLevel.FORBIDDEN);
    expect(classifyCommand('my-safe-check --status').riskLevel).toBe(RiskLevel.GREEN);
    unlinkSync(filePath);
  });

  it('should throw on non-existent file', () => {
    expect(() => loadCustomRulesFromFile('/nonexistent/path/rules.json')).toThrow();
  });

  it('should throw on invalid JSON', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'rules-'));
    const filePath = join(tempDir, 'bad.json');
    writeFileSync(filePath, 'not valid json {{{');
    expect(() => loadCustomRulesFromFile(filePath)).toThrow();
    unlinkSync(filePath);
  });

  it('should throw on valid JSON but invalid schema', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'rules-'));
    const filePath = join(tempDir, 'bad-schema.json');
    writeFileSync(filePath, JSON.stringify({ rules: [{ pattern: '\\btest\\b', level: 'invalid' }] }));
    expect(() => loadCustomRulesFromFile(filePath)).toThrow();
    unlinkSync(filePath);
  });

  it('should replace previous custom rules when loading new file', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'rules-'));
    const file1 = join(tempDir, 'rules1.json');
    writeFileSync(file1, JSON.stringify({ rules: [{ pattern: '\\bfoo\\b', reason: 'Foo', level: 'red' }] }));
    loadCustomRulesFromFile(file1);
    expect(getCustomRuleCount()).toBe(1);

    const file2 = join(tempDir, 'rules2.json');
    writeFileSync(file2, JSON.stringify({
      rules: [
        { pattern: '\\bbar\\b', reason: 'Bar', level: 'green' },
        { pattern: '\\bbaz\\b', reason: 'Baz', level: 'yellow' },
      ],
    }));
    loadCustomRulesFromFile(file2);
    expect(getCustomRuleCount()).toBe(2);
    unlinkSync(file1);
    unlinkSync(file2);
  });

  it('should support all 5 risk levels in file-loaded rules', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'rules-'));
    const filePath = join(tempDir, 'all-levels.json');
    writeFileSync(filePath, JSON.stringify({
      rules: [
        { pattern: '\\bfile-forbidden\\b', reason: 'Test forbidden', level: 'forbidden' },
        { pattern: '\\bfile-critical\\b', reason: 'Test critical', level: 'critical' },
        { pattern: '^\\s*file-green\\b', reason: 'Test green', level: 'green' },
        { pattern: '\\bfile-yellow\\b', reason: 'Test yellow', level: 'yellow' },
        { pattern: '\\bfile-red\\b', reason: 'Test red', level: 'red' },
      ],
    }));
    loadCustomRulesFromFile(filePath);
    expect(getCustomRuleCount()).toBe(5);
    expect(classifyCommand('file-forbidden --run').riskLevel).toBe(RiskLevel.FORBIDDEN);
    expect(classifyCommand('file-critical --run').riskLevel).toBe(RiskLevel.CRITICAL);
    expect(classifyCommand('file-green --check').riskLevel).toBe(RiskLevel.GREEN);
    expect(classifyCommand('file-yellow --install').riskLevel).toBe(RiskLevel.YELLOW);
    expect(classifyCommand('file-red --modify').riskLevel).toBe(RiskLevel.RED);
    unlinkSync(filePath);
  });
});

// ============================================================================
// Enhanced dangerous parameter tests
// ============================================================================

describe('Enhanced dangerous parameters', () => {
  it('should have at least 43 dangerous params', () => {
    expect(DANGEROUS_PARAMS.length).toBeGreaterThanOrEqual(43);
  });

  it('should contain new enhanced dangerous parameters', () => {
    const newFlags = [
      '--all', '--no-interaction', '--force-renewal',
      '--skip-checks', '--no-preserve-env', '--force-overwrite',
      '--disable-verification', '--skip-hooks', '--no-audit',
    ];
    for (const flag of newFlags) {
      expect(DANGEROUS_FLAGS).toContain(flag);
    }
  });

  it.each([
    ['tool --all targets', '--all'],
    ['composer install --no-interaction', '--no-interaction'],
    ['certbot renew --force-renewal', '--force-renewal'],
    ['tool deploy --skip-checks', '--skip-checks'],
    ['tool --no-preserve-env cmd', '--no-preserve-env'],
    ['tool --force-overwrite file', '--force-overwrite'],
    ['tool --disable-verification', '--disable-verification'],
    ['git commit --skip-hooks', '--skip-hooks'],
    ['npm install --no-audit', '--no-audit'],
  ])('should warn for new param "%s" containing %s', (command, flag) => {
    const result = auditCommand(command);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings.some((w) => w.includes(flag))).toBe(true);
  });
});

// ============================================================================
// Enhanced protected paths tests
// ============================================================================

describe('Enhanced protected paths', () => {
  it('should have at least 50 protected paths', () => {
    expect(PROTECTED_PATHS.length).toBeGreaterThanOrEqual(50);
  });

  it('should contain new enhanced protected paths', () => {
    const newPaths = [
      '/var/lib/rabbitmq', '/var/lib/neo4j', '/var/lib/cockroach',
      '/var/lib/ceph', '/var/lib/gitea', '/var/lib/gitlab',
      '/var/lib/jenkins', '/var/lib/zookeeper', '/var/lib/kafka',
      '/var/lib/haproxy',
    ];
    for (const p of newPaths) {
      expect(PROTECTED_PATH_LIST).toContain(p);
    }
  });

  it.each([
    ['rm /var/lib/rabbitmq/data/', '/var/lib/rabbitmq'],
    ['rm /var/lib/neo4j/data/', '/var/lib/neo4j'],
    ['rm /var/lib/cockroach/data/', '/var/lib/cockroach'],
    ['rm /var/lib/ceph/osd/', '/var/lib/ceph'],
    ['rm /var/lib/gitea/data/', '/var/lib/gitea'],
    ['rm /var/lib/gitlab/data/', '/var/lib/gitlab'],
    ['rm /var/lib/jenkins/workspace/', '/var/lib/jenkins'],
    ['rm /var/lib/zookeeper/data/', '/var/lib/zookeeper'],
    ['rm /var/lib/kafka/data/', '/var/lib/kafka'],
    ['rm /var/lib/haproxy/state/', '/var/lib/haproxy'],
  ])('should block destructive rm on new path "%s" (path: %s)', (command, path) => {
    const result = auditCommand(command);
    expect(result.safe).toBe(false);
    expect(result.blockers.length).toBeGreaterThan(0);
    expect(result.blockers.some((b) => b.includes(path))).toBe(true);
  });

  it('should NOT block read-only operations on new protected paths', () => {
    const commands = [
      'cat /var/lib/rabbitmq/data/log',
      'ls /var/lib/kafka/data/',
      'ls /var/lib/jenkins/workspace/',
    ];
    for (const cmd of commands) {
      const result = auditCommand(cmd);
      expect(result.safe).toBe(true);
      expect(result.blockers).toHaveLength(0);
    }
  });
});

// ============================================================================
// Cross-cutting security boundaries
// ============================================================================

describe('Enhanced security boundaries', () => {
  it('should never classify iptables flush as anything less than FORBIDDEN', () => {
    expect(classifyCommand('iptables -F').riskLevel).toBe(RiskLevel.FORBIDDEN);
    expect(classifyCommand('sudo iptables -F').riskLevel).toBe(RiskLevel.FORBIDDEN);
    expect(classifyCommand('iptables --flush').riskLevel).toBe(RiskLevel.FORBIDDEN);
  });

  it('should classify git branch deletion as CRITICAL', () => {
    expect(classifyCommand('git branch -d feature').riskLevel).toBe(RiskLevel.CRITICAL);
    expect(classifyCommand('git branch -D feature').riskLevel).toBe(RiskLevel.CRITICAL);
    expect(classifyCommand('sudo git branch -d feature').riskLevel).toBe(RiskLevel.CRITICAL);
  });

  it('should classify git hard reset as CRITICAL', () => {
    expect(classifyCommand('git reset --hard HEAD~3').riskLevel).toBe(RiskLevel.CRITICAL);
    expect(classifyCommand('sudo git reset --hard').riskLevel).toBe(RiskLevel.CRITICAL);
  });

  it('should classify SQL REVOKE as CRITICAL', () => {
    expect(classifyCommand('REVOKE ALL PRIVILEGES ON *.* FROM user').riskLevel).toBe(RiskLevel.CRITICAL);
  });

  it('should classify SQL INSERT/UPDATE as RED (not GREEN)', () => {
    expect(classifyCommand('INSERT INTO users (name) VALUES ("test")').riskLevel).toBe(RiskLevel.RED);
    expect(classifyCommand('UPDATE users SET active=false WHERE id=1').riskLevel).toBe(RiskLevel.RED);
  });

  it('should classify kubectl drain as RED (disruptive but not destructive)', () => {
    expect(classifyCommand('kubectl drain node1 --ignore-daemonsets').riskLevel).toBe(RiskLevel.RED);
  });

  it('should classify security audit tools as GREEN (read-only)', () => {
    expect(classifyCommand('lynis audit system').riskLevel).toBe(RiskLevel.GREEN);
    expect(classifyCommand('chkrootkit').riskLevel).toBe(RiskLevel.GREEN);
  });

  it('custom rules from files should be cleared with clearCustomRules', () => {
    loadCustomRules({
      rules: [{ pattern: '\\btest-custom\\b', reason: 'Test', level: 'forbidden' }],
    });
    expect(getCustomRuleCount()).toBe(1);
    clearCustomRules();
    expect(getCustomRuleCount()).toBe(0);
  });
});

// ============================================================================
// Alias handling with new commands
// ============================================================================

describe('Alias handling with new command rules', () => {
  it.each([
    ['sudo flatpak uninstall org.app.Name', RiskLevel.CRITICAL],
    ['doas cargo uninstall serde', RiskLevel.CRITICAL],
    ['pkexec git branch -d feature', RiskLevel.CRITICAL],
    ['su -c "nix-collect-garbage -d"', RiskLevel.CRITICAL],
    ['sudo flatpak install org.app.Name', RiskLevel.YELLOW],
    ['doas snap refresh', RiskLevel.YELLOW],
    ['sudo kubectl drain node1', RiskLevel.RED],
    ['doas sysctl -w net.ipv4.ip_forward=1', RiskLevel.RED],
  ])('should strip alias and classify "%s" as %s', (command, expected) => {
    expect(classifyCommand(command).riskLevel).toBe(expected);
  });
});

// ============================================================================
// Regex pattern matching verification
// ============================================================================

describe('Regex pattern matching', () => {
  it('all built-in rules should have valid regex patterns', () => {
    const allRules = [
      ...FORBIDDEN_PATTERNS, ...CRITICAL_PATTERNS,
      ...GREEN_PATTERNS, ...YELLOW_PATTERNS, ...RED_PATTERNS,
    ];
    for (const rule of allRules) {
      expect(rule.pattern).toBeInstanceOf(RegExp);
      expect(() => new RegExp(rule.pattern.source)).not.toThrow();
      expect(rule.reason.length).toBeGreaterThan(0);
    }
  });

  it('should support regex special characters in patterns', () => {
    // Verify patterns with special regex chars work
    loadCustomRules({
      rules: [
        { pattern: '\\bmy-tool\\[v2\\]\\b', reason: 'Tool with brackets', level: 'red' },
      ],
    });
    expect(classifyCommand('my-tool[v2] --exec').riskLevel).toBe(RiskLevel.RED);
    clearCustomRules();
  });

  it('should support wildcard-like patterns via regex', () => {
    loadCustomRules({
      rules: [
        { pattern: '^\\s*my-prefix-.*--dangerous', reason: 'Wildcard match', level: 'critical' },
      ],
    });
    expect(classifyCommand('my-prefix-tool --dangerous').riskLevel).toBe(RiskLevel.CRITICAL);
    expect(classifyCommand('my-prefix-other --dangerous').riskLevel).toBe(RiskLevel.CRITICAL);
    clearCustomRules();
  });
});
