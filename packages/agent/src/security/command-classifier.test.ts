import { describe, it, expect } from 'vitest';

import {
  classifyCommand,
  compareRiskLevels,
  getExecutionPolicy,
  isForbidden,
  requiresConfirmation,
  requiresSnapshot,
  RiskLevel,
  RiskLevelSchema,
} from './command-classifier.js';

// ============================================================================
// RiskLevel enum & schema
// ============================================================================

describe('RiskLevel', () => {
  it('should define all 5 risk levels', () => {
    expect(RiskLevel.GREEN).toBe('green');
    expect(RiskLevel.YELLOW).toBe('yellow');
    expect(RiskLevel.RED).toBe('red');
    expect(RiskLevel.CRITICAL).toBe('critical');
    expect(RiskLevel.FORBIDDEN).toBe('forbidden');
  });

  it('should validate valid risk levels with Zod schema', () => {
    expect(RiskLevelSchema.parse('green')).toBe('green');
    expect(RiskLevelSchema.parse('yellow')).toBe('yellow');
    expect(RiskLevelSchema.parse('red')).toBe('red');
    expect(RiskLevelSchema.parse('critical')).toBe('critical');
    expect(RiskLevelSchema.parse('forbidden')).toBe('forbidden');
  });

  it('should reject invalid risk levels with Zod schema', () => {
    expect(() => RiskLevelSchema.parse('unknown')).toThrow();
    expect(() => RiskLevelSchema.parse('')).toThrow();
    expect(() => RiskLevelSchema.parse(42)).toThrow();
  });
});

// ============================================================================
// classifyCommand — GREEN level
// ============================================================================

describe('classifyCommand — GREEN (read-only)', () => {
  it.each([
    ['ls -la', 'File listing'],
    ['ls', 'File listing'],
    ['cat /etc/nginx/nginx.conf', 'File content display'],
    ['head -n 20 /var/log/syslog', 'File head display'],
    ['tail -f /var/log/syslog', 'File tail display'],
    ['less /etc/hosts', 'File pager'],
    ['wc -l /etc/passwd', 'Word count'],
  ])('should classify "%s" as GREEN (%s)', (command) => {
    const result = classifyCommand(command);
    expect(result.riskLevel).toBe(RiskLevel.GREEN);
  });

  it.each([
    ['df -h', 'Disk space'],
    ['free -m', 'Memory usage'],
    ['top -bn1', 'Process monitoring'],
    ['ps aux', 'Process list'],
    ['uptime', 'System uptime'],
    ['uname -a', 'System info'],
    ['hostname', 'Hostname'],
    ['whoami', 'Current user'],
    ['id', 'User identity'],
    ['date', 'Date display'],
  ])('should classify system info command "%s" as GREEN (%s)', (command) => {
    expect(classifyCommand(command).riskLevel).toBe(RiskLevel.GREEN);
  });

  it.each([
    ['ping 8.8.8.8', 'Network ping'],
    ['dig google.com', 'DNS query'],
    ['nslookup google.com', 'DNS lookup'],
    ['netstat -tlnp', 'Network statistics'],
    ['ss -tlnp', 'Socket statistics'],
    ['traceroute google.com', 'Network trace'],
    ['ifconfig', 'Network interfaces'],
    ['ip addr show', 'IP address info'],
    ['ip link show', 'IP link info'],
    ['ip route show', 'IP route info'],
  ])('should classify network diagnostic "%s" as GREEN (%s)', (command) => {
    expect(classifyCommand(command).riskLevel).toBe(RiskLevel.GREEN);
  });

  it.each([
    ['systemctl status nginx', 'Service status'],
    ['systemctl is-active nginx', 'Service active check'],
    ['systemctl is-enabled nginx', 'Service enabled check'],
    ['systemctl list-units', 'Service list'],
    ['service nginx status', 'Service status (legacy)'],
  ])('should classify service query "%s" as GREEN (%s)', (command) => {
    expect(classifyCommand(command).riskLevel).toBe(RiskLevel.GREEN);
  });

  it.each([
    ['docker ps', 'Container list'],
    ['docker images', 'Image list'],
    ['docker logs my-container', 'Container logs'],
    ['docker inspect my-container', 'Container inspect'],
    ['docker info', 'Docker info'],
    ['docker version', 'Docker version'],
    ['docker stats', 'Docker stats'],
  ])('should classify docker read-only "%s" as GREEN (%s)', (command) => {
    expect(classifyCommand(command).riskLevel).toBe(RiskLevel.GREEN);
  });

  it.each([
    ['nginx -t', 'Nginx config test'],
    ['nginx -T', 'Nginx config dump'],
  ])('should classify nginx test "%s" as GREEN (%s)', (command) => {
    expect(classifyCommand(command).riskLevel).toBe(RiskLevel.GREEN);
  });

  it.each([
    ['find /var/log -name "*.log"', 'File search'],
    ['grep -r "error" /var/log/', 'Text search'],
    ['which node', 'Command lookup'],
    ['whereis nginx', 'Command lookup'],
    ['locate nginx.conf', 'File search'],
  ])('should classify search command "%s" as GREEN (%s)', (command) => {
    expect(classifyCommand(command).riskLevel).toBe(RiskLevel.GREEN);
  });

  it.each([
    ['node --version', 'Version check'],
    ['npm -v', 'Version check'],
    ['python3 -V', 'Version check'],
    ['printenv', 'Environment vars'],
    ['env', 'Environment vars'],
    ['echo hello', 'Echo output'],
  ])('should classify info command "%s" as GREEN (%s)', (command) => {
    expect(classifyCommand(command).riskLevel).toBe(RiskLevel.GREEN);
  });

  it.each([
    ['apt list --installed', 'Package list'],
    ['apt show nginx', 'Package info'],
    ['apt search redis', 'Package search'],
    ['dpkg -l', 'Package list'],
    ['dpkg --list', 'Package list'],
    ['rpm -qa', 'Package query'],
  ])('should classify package query "%s" as GREEN (%s)', (command) => {
    expect(classifyCommand(command).riskLevel).toBe(RiskLevel.GREEN);
  });

  it.each([
    ['lsblk', 'Block devices'],
    ['mount', 'Mount points'],
    ['du -sh /var', 'Disk usage'],
  ])('should classify disk info "%s" as GREEN (%s)', (command) => {
    expect(classifyCommand(command).riskLevel).toBe(RiskLevel.GREEN);
  });
});

// ============================================================================
// classifyCommand — YELLOW level
// ============================================================================

describe('classifyCommand — YELLOW (installation)', () => {
  it.each([
    ['apt install nginx', 'apt install'],
    ['apt-get install nginx', 'apt-get install'],
    ['apt update', 'apt update'],
    ['apt-get update', 'apt-get update'],
    ['apt upgrade', 'apt upgrade'],
    ['yum install httpd', 'yum install'],
    ['dnf install httpd', 'dnf install'],
    ['pacman -S nginx', 'pacman install'],
  ])('should classify "%s" as YELLOW (%s)', (command) => {
    expect(classifyCommand(command).riskLevel).toBe(RiskLevel.YELLOW);
  });

  it.each([
    ['npm install express', 'npm install'],
    ['npm i express', 'npm shorthand'],
    ['npm ci', 'npm clean install'],
    ['pnpm install', 'pnpm install'],
    ['pnpm add express', 'pnpm add'],
    ['yarn install', 'yarn install'],
    ['yarn add express', 'yarn add'],
    ['pip install flask', 'pip install'],
    ['pip3 install flask', 'pip3 install'],
  ])('should classify "%s" as YELLOW (%s)', (command) => {
    expect(classifyCommand(command).riskLevel).toBe(RiskLevel.YELLOW);
  });

  it.each([
    ['docker pull nginx:latest', 'docker pull'],
    ['docker compose pull', 'docker compose pull'],
    ['git clone https://github.com/user/repo.git', 'git clone'],
    ['curl -O https://example.com/file.tar.gz', 'curl download'],
    ['wget https://example.com/file.tar.gz', 'wget download'],
  ])('should classify "%s" as YELLOW (%s)', (command) => {
    expect(classifyCommand(command).riskLevel).toBe(RiskLevel.YELLOW);
  });

  it.each([
    ['tar xzf archive.tar.gz', 'tar extract'],
    ['unzip file.zip', 'unzip'],
    ['make', 'make build'],
    ['npm run build', 'npm build'],
    ['pnpm build', 'pnpm build'],
    ['docker build -t myapp .', 'docker build'],
    ['docker compose build', 'docker compose build'],
  ])('should classify "%s" as YELLOW (%s)', (command) => {
    expect(classifyCommand(command).riskLevel).toBe(RiskLevel.YELLOW);
  });
});

// ============================================================================
// classifyCommand — RED level
// ============================================================================

describe('classifyCommand — RED (modification)', () => {
  it.each([
    ['systemctl restart nginx', 'Service restart'],
    ['systemctl stop nginx', 'Service stop'],
    ['systemctl start nginx', 'Service start'],
    ['systemctl reload nginx', 'Service reload'],
    ['systemctl enable nginx', 'Service enable'],
    ['systemctl disable nginx', 'Service disable'],
    ['service nginx restart', 'Legacy service restart'],
    ['service nginx stop', 'Legacy service stop'],
  ])('should classify "%s" as RED (%s)', (command) => {
    expect(classifyCommand(command).riskLevel).toBe(RiskLevel.RED);
  });

  it.each([
    ['nginx -s reload', 'Nginx reload'],
    ['nginx -s stop', 'Nginx stop'],
    ['nginx -s quit', 'Nginx quit'],
  ])('should classify "%s" as RED (%s)', (command) => {
    expect(classifyCommand(command).riskLevel).toBe(RiskLevel.RED);
  });

  it.each([
    ['docker stop my-container', 'Docker stop'],
    ['docker restart my-container', 'Docker restart'],
    ['docker start my-container', 'Docker start'],
    ['docker kill my-container', 'Docker kill'],
    ['docker compose up -d', 'Docker compose up'],
    ['docker compose down', 'Docker compose down'],
    ['docker compose restart', 'Docker compose restart'],
  ])('should classify "%s" as RED (%s)', (command) => {
    expect(classifyCommand(command).riskLevel).toBe(RiskLevel.RED);
  });

  it.each([
    ['chmod 644 /var/www/html/index.html', 'chmod'],
    ['chown www-data:www-data /var/www', 'chown'],
    ['sed -i "s/old/new/g" /etc/nginx/nginx.conf', 'sed in-place'],
    ['cp /etc/nginx/nginx.conf /etc/nginx/nginx.conf.bak', 'File copy'],
    ['mv /tmp/config.conf /etc/app/config.conf', 'File move'],
    ['mkdir /opt/myapp', 'Directory creation'],
    ['tee /etc/apt/sources.list.d/custom.list', 'File write via tee'],
  ])('should classify "%s" as RED (%s)', (command) => {
    expect(classifyCommand(command).riskLevel).toBe(RiskLevel.RED);
  });

  it.each([
    ['git push origin main', 'git push'],
    ['git commit -m "message"', 'git commit'],
    ['git merge feature-branch', 'git merge'],
    ['git rebase main', 'git rebase'],
    ['git reset HEAD~1', 'git reset'],
    ['git checkout feature', 'git checkout'],
  ])('should classify git modification "%s" as RED (%s)', (command) => {
    expect(classifyCommand(command).riskLevel).toBe(RiskLevel.RED);
  });

  it.each([
    ['crontab -e', 'Crontab edit'],
    ['ufw allow 80', 'Firewall allow'],
    ['ufw deny 22', 'Firewall deny'],
    ['iptables -A INPUT -p tcp --dport 80 -j ACCEPT', 'iptables rule'],
  ])('should classify "%s" as RED (%s)', (command) => {
    expect(classifyCommand(command).riskLevel).toBe(RiskLevel.RED);
  });

  it('should classify unknown commands as RED by default', () => {
    const result = classifyCommand('some-unknown-command --flag');
    expect(result.riskLevel).toBe(RiskLevel.RED);
    expect(result.reason).toContain('Unknown command');
  });
});

// ============================================================================
// classifyCommand — CRITICAL level
// ============================================================================

describe('classifyCommand — CRITICAL (destructive)', () => {
  it.each([
    ['rm file.txt', 'File deletion'],
    ['rm -r /tmp/old-dir', 'Recursive deletion'],
    ['rm -f /var/log/old.log', 'Force deletion'],
  ])('should classify "%s" as CRITICAL (%s)', (command) => {
    expect(classifyCommand(command).riskLevel).toBe(RiskLevel.CRITICAL);
  });

  it.each([
    ['apt remove nginx', 'apt remove'],
    ['apt purge nginx', 'apt purge'],
    ['apt-get remove nginx', 'apt-get remove'],
    ['apt-get purge nginx', 'apt-get purge'],
    ['yum remove httpd', 'yum remove'],
    ['yum erase httpd', 'yum erase'],
    ['dnf remove httpd', 'dnf remove'],
  ])('should classify "%s" as CRITICAL (%s)', (command) => {
    expect(classifyCommand(command).riskLevel).toBe(RiskLevel.CRITICAL);
  });

  it.each([
    ['docker rm my-container', 'Docker container deletion'],
    ['docker rmi nginx:latest', 'Docker image deletion'],
    ['docker container rm my-container', 'Docker container rm'],
    ['docker image rm nginx', 'Docker image rm'],
    ['docker system prune', 'Docker system prune'],
  ])('should classify "%s" as CRITICAL (%s)', (command) => {
    expect(classifyCommand(command).riskLevel).toBe(RiskLevel.CRITICAL);
  });

  it.each([
    ['DROP DATABASE mydb', 'DROP DATABASE'],
    ['DROP TABLE users', 'DROP TABLE'],
    ['drop database mydb', 'drop database (lowercase)'],
    ['TRUNCATE TABLE logs', 'TRUNCATE TABLE'],
    ['DELETE FROM users WHERE id = 1', 'DELETE FROM'],
  ])('should classify SQL destructive "%s" as CRITICAL (%s)', (command) => {
    expect(classifyCommand(command).riskLevel).toBe(RiskLevel.CRITICAL);
  });

  it.each([
    ['userdel john', 'User deletion'],
    ['groupdel developers', 'Group deletion'],
    ['mv /etc/nginx/nginx.conf /tmp/', 'Moving system config'],
  ])('should classify "%s" as CRITICAL (%s)', (command) => {
    expect(classifyCommand(command).riskLevel).toBe(RiskLevel.CRITICAL);
  });
});

// ============================================================================
// classifyCommand — FORBIDDEN level
// ============================================================================

describe('classifyCommand — FORBIDDEN (prohibited)', () => {
  it.each([
    ['rm -rf /', 'rm -rf /'],
    ['rm -rf /*', 'rm -rf /*'],
    ['rm -rf / --no-preserve-root', 'rm with --no-preserve-root'],
    ['rm -fr /', 'rm -fr /'],
  ])('should classify "%s" as FORBIDDEN (%s)', (command) => {
    expect(classifyCommand(command).riskLevel).toBe(RiskLevel.FORBIDDEN);
  });

  it.each([
    ['mkfs.ext4 /dev/sda1', 'Disk formatting'],
    ['fdisk /dev/sda', 'Disk partitioning'],
  ])('should classify "%s" as FORBIDDEN (%s)', (command) => {
    expect(classifyCommand(command).riskLevel).toBe(RiskLevel.FORBIDDEN);
  });

  it.each([
    ['dd if=/dev/zero of=/dev/sda', 'Device overwriting with /dev/zero'],
    ['dd if=/dev/random of=/dev/sdb bs=1M', 'Direct write to block device'],
  ])('should classify "%s" as FORBIDDEN (%s)', (command) => {
    expect(classifyCommand(command).riskLevel).toBe(RiskLevel.FORBIDDEN);
  });

  it('should classify fork bomb as FORBIDDEN', () => {
    expect(classifyCommand(':(){ :|:& };:')).toHaveProperty('riskLevel', RiskLevel.FORBIDDEN);
  });

  it('should classify direct device writes as FORBIDDEN', () => {
    expect(classifyCommand('echo "data" > /dev/sda')).toHaveProperty('riskLevel', RiskLevel.FORBIDDEN);
  });

  it('should classify recursive chmod 777 / as FORBIDDEN', () => {
    expect(classifyCommand('chmod -R 777 /')).toHaveProperty('riskLevel', RiskLevel.FORBIDDEN);
    expect(classifyCommand('chmod 777 /')).toHaveProperty('riskLevel', RiskLevel.FORBIDDEN);
  });

  it('should classify empty command as FORBIDDEN', () => {
    expect(classifyCommand('')).toHaveProperty('riskLevel', RiskLevel.FORBIDDEN);
    expect(classifyCommand('   ')).toHaveProperty('riskLevel', RiskLevel.FORBIDDEN);
  });

  it('should classify rm --no-preserve-root as FORBIDDEN', () => {
    expect(classifyCommand('rm --no-preserve-root /')).toHaveProperty('riskLevel', RiskLevel.FORBIDDEN);
  });
});

// ============================================================================
// sudo handling
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
// Priority ordering: FORBIDDEN > CRITICAL > GREEN > YELLOW > RED
// ============================================================================

describe('classifyCommand — priority ordering', () => {
  it('FORBIDDEN should take priority over CRITICAL (rm -rf / is FORBIDDEN, not CRITICAL)', () => {
    // rm -rf / matches both CRITICAL (rm) and FORBIDDEN (rm -rf /)
    expect(classifyCommand('rm -rf /').riskLevel).toBe(RiskLevel.FORBIDDEN);
  });

  it('CRITICAL should take priority over RED (rm matches CRITICAL before RED)', () => {
    // rm matches CRITICAL (file deletion)
    expect(classifyCommand('rm important-file.conf').riskLevel).toBe(RiskLevel.CRITICAL);
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
    expect(compareRiskLevels(RiskLevel.CRITICAL, RiskLevel.YELLOW)).toBeGreaterThan(0);
  });

  it('should return negative when first is less risky', () => {
    expect(compareRiskLevels(RiskLevel.GREEN, RiskLevel.RED)).toBeLessThan(0);
    expect(compareRiskLevels(RiskLevel.YELLOW, RiskLevel.CRITICAL)).toBeLessThan(0);
  });

  it('should maintain consistent ordering', () => {
    const levels: RiskLevel[] = [
      RiskLevel.GREEN,
      RiskLevel.YELLOW,
      RiskLevel.RED,
      RiskLevel.CRITICAL,
      RiskLevel.FORBIDDEN,
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
    // "systemctl status" is GREEN, not RED
    expect(classifyCommand('systemctl status nginx').riskLevel).toBe(RiskLevel.GREEN);
    // "docker ps" is GREEN, not RED
    expect(classifyCommand('docker ps -a').riskLevel).toBe(RiskLevel.GREEN);
    // "apt list" is GREEN, not YELLOW
    expect(classifyCommand('apt list --installed').riskLevel).toBe(RiskLevel.GREEN);
  });

  it('should classify piped commands based on first command', () => {
    // `ls | grep` — leading command is ls (GREEN)
    expect(classifyCommand('ls -la | grep nginx').riskLevel).toBe(RiskLevel.GREEN);
  });

  it('should handle commands with complex arguments', () => {
    expect(classifyCommand('apt install -y nginx php-fpm mysql-server').riskLevel).toBe(RiskLevel.YELLOW);
    expect(classifyCommand('docker run -d -p 80:80 --name web nginx:latest').riskLevel).toBe(RiskLevel.RED);
  });
});

// ============================================================================
// Security boundary: ensure dangerous commands are never GREEN
// ============================================================================

describe('classifyCommand — security boundaries', () => {
  it('should never classify rm as GREEN', () => {
    const rmCommands = ['rm file.txt', 'rm -r dir/', 'rm -f file', 'rm -rf /tmp/old'];
    for (const cmd of rmCommands) {
      const result = classifyCommand(cmd);
      expect(result.riskLevel).not.toBe(RiskLevel.GREEN);
    }
  });

  it('should never classify service management as GREEN', () => {
    const serviceCommands = [
      'systemctl restart nginx',
      'systemctl stop nginx',
      'systemctl start nginx',
      'service nginx restart',
    ];
    for (const cmd of serviceCommands) {
      const result = classifyCommand(cmd);
      expect(result.riskLevel).not.toBe(RiskLevel.GREEN);
    }
  });

  it('should never classify package removal as GREEN or YELLOW', () => {
    const removalCommands = [
      'apt remove nginx',
      'apt purge nginx',
      'yum remove httpd',
      'dnf remove httpd',
    ];
    for (const cmd of removalCommands) {
      const result = classifyCommand(cmd);
      expect(result.riskLevel).not.toBe(RiskLevel.GREEN);
      expect(result.riskLevel).not.toBe(RiskLevel.YELLOW);
    }
  });

  it('should never allow FORBIDDEN commands to be anything else', () => {
    const forbiddenCommands = [
      'rm -rf /',
      'rm -rf /*',
      'mkfs.ext4 /dev/sda',
      'fdisk /dev/sda',
      'dd if=/dev/zero of=/dev/sda',
    ];
    for (const cmd of forbiddenCommands) {
      expect(classifyCommand(cmd).riskLevel).toBe(RiskLevel.FORBIDDEN);
    }
  });
});
