/**
 * 服务器准备任务测试
 *
 * 测试范围:
 * 1. 文档完整性测试
 * 2. 脚本语法测试
 * 3. 脚本功能逻辑测试
 * 4. DNS 检查功能测试
 * 5. 健康检查功能测试
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

const PROJECT_ROOT = path.resolve(__dirname, '..');
const DOCS_DIR = path.join(PROJECT_ROOT, 'docs');
const SCRIPTS_DIR = path.join(PROJECT_ROOT, 'scripts');

describe('服务器准备 - 文档测试', () => {
  describe('server-setup.md 文档', () => {
    const docPath = path.join(DOCS_DIR, 'server-setup.md');

    it('文档文件应该存在', () => {
      expect(fs.existsSync(docPath)).toBe(true);
    });

    it('文档应该包含必要章节', () => {
      const content = fs.readFileSync(docPath, 'utf-8');

      // 必要章节
      const requiredSections = [
        '# 服务器准备指南',
        '## 🎯 目标',
        '## 🛠️ 服务器要求',
        '## 🌏 推荐服务商',
        '## 📝 购买步骤',
        '## 🔐 SSH 连接配置',
        '## 🌐 域名配置',
        '## 🔒 基础安全配置',
        '## ✅ 验收测试',
      ];

      requiredSections.forEach((section) => {
        expect(content).toContain(section);
      });
    });

    it('文档应该包含服务器配置要求', () => {
      const content = fs.readFileSync(docPath, 'utf-8');

      expect(content).toContain('CPU');
      expect(content).toContain('内存');
      expect(content).toContain('存储');
      expect(content).toContain('2 核心');
      expect(content).toContain('2 GB RAM');
    });

    it('文档应该包含推荐服务商', () => {
      const content = fs.readFileSync(docPath, 'utf-8');

      expect(content).toContain('Vultr');
      expect(content).toContain('DigitalOcean');
      expect(content).toContain('Tokyo, Japan');
    });

    it('文档应该包含 SSH 配置说明', () => {
      const content = fs.readFileSync(docPath, 'utf-8');

      expect(content).toContain('ssh-keygen');
      expect(content).toContain('authorized_keys');
      expect(content).toContain('~/.ssh/config');
    });

    it('文档应该包含域名配置说明', () => {
      const content = fs.readFileSync(docPath, 'utf-8');

      expect(content).toContain('api.aiinstaller.dev');
      expect(content).toContain('DNS');
      expect(content).toContain('Cloudflare');
    });

    it('文档应该包含安全配置说明', () => {
      const content = fs.readFileSync(docPath, 'utf-8');

      expect(content).toContain('ufw');
      expect(content).toContain('防火墙');
      expect(content).toContain('22/tcp'); // Port 22
      expect(content).toContain('80/tcp'); // Port 80
      expect(content).toContain('443/tcp'); // Port 443
    });

    it('文档应该包含验收测试说明', () => {
      const content = fs.readFileSync(docPath, 'utf-8');

      expect(content).toContain('ping');
      expect(content).toContain('SSH 连接测试');
      expect(content).toContain('Docker 测试');
    });

    it('文档应该有合理的预估时间', () => {
      const content = fs.readFileSync(docPath, 'utf-8');

      expect(content).toMatch(/0\.3\s*天|2-3\s*小时/);
    });
  });
});

describe('服务器准备 - 配置脚本测试', () => {
  describe('provision-server.sh 脚本', () => {
    const scriptPath = path.join(SCRIPTS_DIR, 'provision-server.sh');

    it('脚本文件应该存在', () => {
      expect(fs.existsSync(scriptPath)).toBe(true);
    });

    it('脚本应该是可执行的', () => {
      const stats = fs.statSync(scriptPath);
      // 检查是否有执行权限（至少有一个执行位）
      expect(stats.mode & 0o111).toBeGreaterThan(0);
    });

    it('脚本应该有正确的 shebang', () => {
      const content = fs.readFileSync(scriptPath, 'utf-8');
      expect(content.startsWith('#!/bin/bash')).toBe(true);
    });

    it('脚本应该包含错误处理', () => {
      const content = fs.readFileSync(scriptPath, 'utf-8');

      expect(content).toContain('set -euo pipefail');
    });

    it('脚本应该有日志函数', () => {
      const content = fs.readFileSync(scriptPath, 'utf-8');

      expect(content).toContain('log_info()');
      expect(content).toContain('log_success()');
      expect(content).toContain('log_warning()');
      expect(content).toContain('log_error()');
    });

    it('脚本应该检查 root 权限', () => {
      const content = fs.readFileSync(scriptPath, 'utf-8');

      expect(content).toContain('check_root()');
      expect(content).toContain('EUID');
    });

    it('脚本应该检查操作系统', () => {
      const content = fs.readFileSync(scriptPath, 'utf-8');

      expect(content).toContain('check_os()');
      expect(content).toContain('/etc/os-release');
      expect(content).toContain('ubuntu');
    });

    it('脚本应该包含系统更新', () => {
      const content = fs.readFileSync(scriptPath, 'utf-8');

      expect(content).toContain('update_system()');
      expect(content).toContain('apt-get update');
      expect(content).toContain('apt-get upgrade');
    });

    it('脚本应该包含基础工具安装', () => {
      const content = fs.readFileSync(scriptPath, 'utf-8');

      expect(content).toContain('install_basic_tools()');
      expect(content).toContain('curl');
      expect(content).toContain('wget');
      expect(content).toContain('git');
      expect(content).toContain('htop');
    });

    it('脚本应该包含防火墙配置', () => {
      const content = fs.readFileSync(scriptPath, 'utf-8');

      expect(content).toContain('setup_firewall()');
      expect(content).toContain('ufw');
      expect(content).toContain('ufw allow 22/tcp');
      expect(content).toContain('ufw allow 80/tcp');
      expect(content).toContain('ufw allow 443/tcp');
    });

    it('脚本应该包含 Docker 安装', () => {
      const content = fs.readFileSync(scriptPath, 'utf-8');

      expect(content).toContain('install_docker()');
      expect(content).toContain('docker-ce');
      expect(content).toContain('docker-compose-plugin');
    });

    it('脚本应该包含自动更新配置', () => {
      const content = fs.readFileSync(scriptPath, 'utf-8');

      expect(content).toContain('setup_auto_updates()');
      expect(content).toContain('unattended-upgrades');
    });

    it('脚本应该包含系统优化', () => {
      const content = fs.readFileSync(scriptPath, 'utf-8');

      expect(content).toContain('optimize_system()');
      expect(content).toContain('sysctl');
    });

    it('脚本应该创建项目目录', () => {
      const content = fs.readFileSync(scriptPath, 'utf-8');

      expect(content).toContain('create_project_dirs()');
      expect(content).toContain('/opt/aiinstaller');
    });

    it('脚本应该生成服务器信息', () => {
      const content = fs.readFileSync(scriptPath, 'utf-8');

      expect(content).toContain('generate_server_info()');
      expect(content).toContain('server-info.txt');
    });

    it('脚本语法应该正确', () => {
      // 使用 bash -n 检查语法
      expect(() => {
        execSync(`bash -n ${scriptPath}`, { encoding: 'utf-8' });
      }).not.toThrow();
    });
  });
});

describe('服务器准备 - DNS 检查脚本测试', () => {
  describe('check-dns.sh 脚本', () => {
    const scriptPath = path.join(SCRIPTS_DIR, 'check-dns.sh');

    it('脚本文件应该存在', () => {
      expect(fs.existsSync(scriptPath)).toBe(true);
    });

    it('脚本应该是可执行的', () => {
      const stats = fs.statSync(scriptPath);
      expect(stats.mode & 0o111).toBeGreaterThan(0);
    });

    it('脚本应该有正确的 shebang', () => {
      const content = fs.readFileSync(scriptPath, 'utf-8');
      expect(content.startsWith('#!/bin/bash')).toBe(true);
    });

    it('脚本应该包含错误处理', () => {
      const content = fs.readFileSync(scriptPath, 'utf-8');
      expect(content).toContain('set -euo pipefail');
    });

    it('脚本应该检查参数', () => {
      const content = fs.readFileSync(scriptPath, 'utf-8');

      expect(content).toContain('$#');
      expect(content).toMatch(/domain|DOMAIN/);
      expect(content).toMatch(/ip|EXPECTED_IP/);
    });

    it('脚本应该使用 dig 查询 DNS', () => {
      const content = fs.readFileSync(scriptPath, 'utf-8');

      expect(content).toContain('check_with_dig()');
      expect(content).toContain('dig');
    });

    it('脚本应该使用 nslookup 查询 DNS', () => {
      const content = fs.readFileSync(scriptPath, 'utf-8');

      expect(content).toContain('check_with_nslookup()');
      expect(content).toContain('nslookup');
    });

    it('脚本应该使用 ping 测试连通性', () => {
      const content = fs.readFileSync(scriptPath, 'utf-8');

      expect(content).toContain('check_with_ping()');
      expect(content).toContain('ping');
    });

    it('脚本应该检查多个 DNS 服务器', () => {
      const content = fs.readFileSync(scriptPath, 'utf-8');

      expect(content).toContain('check_with_multiple_dns()');
      expect(content).toContain('8.8.8.8'); // Google DNS
      expect(content).toContain('1.1.1.1'); // Cloudflare DNS
    });

    it('脚本应该提供 DNS 配置示例', () => {
      const content = fs.readFileSync(scriptPath, 'utf-8');

      expect(content).toContain('show_dns_config_example()');
      expect(content).toContain('Cloudflare');
    });

    it('脚本语法应该正确', () => {
      expect(() => {
        execSync(`bash -n ${scriptPath}`, { encoding: 'utf-8' });
      }).not.toThrow();
    });

    it('脚本应该能显示帮助信息', () => {
      const result = execSync(`bash ${scriptPath} 2>&1 || true`, {
        encoding: 'utf-8',
      });

      expect(result).toContain('用法');
      expect(result).toContain('domain');
      expect(result).toContain('ip');
    });
  });
});

describe('服务器准备 - 健康检查脚本测试', () => {
  describe('health-check.sh 脚本', () => {
    const scriptPath = path.join(SCRIPTS_DIR, 'health-check.sh');

    it('脚本文件应该存在', () => {
      expect(fs.existsSync(scriptPath)).toBe(true);
    });

    it('脚本应该是可执行的', () => {
      const stats = fs.statSync(scriptPath);
      expect(stats.mode & 0o111).toBeGreaterThan(0);
    });

    it('脚本应该有正确的 shebang', () => {
      const content = fs.readFileSync(scriptPath, 'utf-8');
      expect(content.startsWith('#!/bin/bash')).toBe(true);
    });

    it('脚本应该包含错误处理', () => {
      const content = fs.readFileSync(scriptPath, 'utf-8');
      expect(content).toContain('set -euo pipefail');
    });

    it('脚本应该支持远程模式', () => {
      const content = fs.readFileSync(scriptPath, 'utf-8');

      expect(content).toContain('--remote');
      expect(content).toContain('REMOTE_MODE');
      expect(content).toContain('REMOTE_HOST');
    });

    it('脚本应该检查系统信息', () => {
      const content = fs.readFileSync(scriptPath, 'utf-8');

      expect(content).toContain('check_system_info()');
      expect(content).toContain('/etc/os-release');
      expect(content).toContain('uname');
    });

    it('脚本应该检查 CPU', () => {
      const content = fs.readFileSync(scriptPath, 'utf-8');

      expect(content).toContain('check_cpu()');
      expect(content).toContain('nproc');
    });

    it('脚本应该检查内存', () => {
      const content = fs.readFileSync(scriptPath, 'utf-8');

      expect(content).toContain('check_memory()');
      expect(content).toContain('free');
    });

    it('脚本应该检查磁盘空间', () => {
      const content = fs.readFileSync(scriptPath, 'utf-8');

      expect(content).toContain('check_disk()');
      expect(content).toContain('df');
    });

    it('脚本应该检查网络连通性', () => {
      const content = fs.readFileSync(scriptPath, 'utf-8');

      expect(content).toContain('check_network()');
      expect(content).toContain('ping');
    });

    it('脚本应该检查 Docker', () => {
      const content = fs.readFileSync(scriptPath, 'utf-8');

      expect(content).toContain('check_docker()');
      expect(content).toContain('docker --version');
    });

    it('脚本应该检查 Docker Compose', () => {
      const content = fs.readFileSync(scriptPath, 'utf-8');

      expect(content).toContain('check_docker_compose()');
      expect(content).toContain('docker compose version');
    });

    it('脚本应该检查防火墙', () => {
      const content = fs.readFileSync(scriptPath, 'utf-8');

      expect(content).toContain('check_firewall()');
      expect(content).toContain('ufw status');
    });

    it('脚本应该检查端口监听', () => {
      const content = fs.readFileSync(scriptPath, 'utf-8');

      expect(content).toContain('check_ports()');
      expect(content).toContain('22'); // SSH
      expect(content).toContain('80'); // HTTP
      expect(content).toContain('443'); // HTTPS
    });

    it('脚本应该检查项目目录', () => {
      const content = fs.readFileSync(scriptPath, 'utf-8');

      expect(content).toContain('check_project_dirs()');
      expect(content).toContain('/opt/aiinstaller');
    });

    it('脚本应该生成报告', () => {
      const content = fs.readFileSync(scriptPath, 'utf-8');

      expect(content).toContain('generate_report()');
      expect(content).toContain('通过');
      expect(content).toContain('失败');
      expect(content).toContain('警告');
    });

    it('脚本语法应该正确', () => {
      expect(() => {
        execSync(`bash -n ${scriptPath}`, { encoding: 'utf-8' });
      }).not.toThrow();
    });
  });
});

describe('服务器准备 - 集成测试', () => {
  it('所有必要的脚本文件都存在', () => {
    const requiredScripts = [
      'provision-server.sh',
      'check-dns.sh',
      'health-check.sh',
    ];

    requiredScripts.forEach((script) => {
      const scriptPath = path.join(SCRIPTS_DIR, script);
      expect(fs.existsSync(scriptPath)).toBe(true);
    });
  });

  it('所有脚本都是可执行的', () => {
    const scripts = ['provision-server.sh', 'check-dns.sh', 'health-check.sh'];

    scripts.forEach((script) => {
      const scriptPath = path.join(SCRIPTS_DIR, script);
      const stats = fs.statSync(scriptPath);
      expect(stats.mode & 0o111).toBeGreaterThan(0);
    });
  });

  it('所有脚本语法都正确', () => {
    const scripts = ['provision-server.sh', 'check-dns.sh', 'health-check.sh'];

    scripts.forEach((script) => {
      const scriptPath = path.join(SCRIPTS_DIR, script);
      expect(() => {
        execSync(`bash -n ${scriptPath}`, { encoding: 'utf-8' });
      }).not.toThrow();
    });
  });

  it('文档引用的脚本都存在', () => {
    const docPath = path.join(DOCS_DIR, 'server-setup.md');
    const content = fs.readFileSync(docPath, 'utf-8');

    // 检查文档中提到的脚本
    const mentionedScripts = [
      'provision-server.sh',
      'check-dns.sh',
      'health-check.sh',
    ];

    mentionedScripts.forEach((script) => {
      if (content.includes(script)) {
        const scriptPath = path.join(SCRIPTS_DIR, script);
        expect(fs.existsSync(scriptPath)).toBe(true);
      }
    });
  });
});

describe('服务器准备 - 验收标准测试', () => {
  it('文档应该明确说明购买服务器的步骤', () => {
    const docPath = path.join(DOCS_DIR, 'server-setup.md');
    const content = fs.readFileSync(docPath, 'utf-8');

    expect(content).toContain('购买');
    expect(content).toContain('云服务器');
    expect(content).toContain('Vultr');
    expect(content).toContain('DigitalOcean');
  });

  it('文档应该明确说明域名配置步骤', () => {
    const docPath = path.join(DOCS_DIR, 'server-setup.md');
    const content = fs.readFileSync(docPath, 'utf-8');

    expect(content).toContain('域名');
    expect(content).toContain('DNS');
    expect(content).toContain('api.aiinstaller.dev');
    expect(content).toMatch(/\|\s*[AT]\s*\||\|\s*Type\s*\|/); // Check for A record or Type in DNS table
  });

  it('文档应该包含验收标准：域名能 ping 通服务器', () => {
    const docPath = path.join(DOCS_DIR, 'server-setup.md');
    const content = fs.readFileSync(docPath, 'utf-8');

    expect(content).toContain('验收');
    expect(content).toContain('ping');
  });

  it('提供的脚本应该能自动化配置服务器', () => {
    const scriptPath = path.join(SCRIPTS_DIR, 'provision-server.sh');
    const content = fs.readFileSync(scriptPath, 'utf-8');

    // 检查自动化步骤
    expect(content).toContain('apt-get update');
    expect(content).toContain('install_docker');
    expect(content).toContain('setup_firewall');
  });

  it('提供的脚本应该能检查 DNS 配置', () => {
    const scriptPath = path.join(SCRIPTS_DIR, 'check-dns.sh');
    const content = fs.readFileSync(scriptPath, 'utf-8');

    expect(content).toContain('dig');
    expect(content).toContain('nslookup');
    expect(content).toContain('ping');
  });

  it('提供的脚本应该能健康检查服务器', () => {
    const scriptPath = path.join(SCRIPTS_DIR, 'health-check.sh');
    const content = fs.readFileSync(scriptPath, 'utf-8');

    expect(content).toContain('check_cpu');
    expect(content).toContain('check_memory');
    expect(content).toContain('check_disk');
    expect(content).toContain('check_docker');
  });
});

describe('服务器准备 - 完整性测试', () => {
  it('应该有完整的文档和脚本', () => {
    // 检查文档
    expect(fs.existsSync(path.join(DOCS_DIR, 'server-setup.md'))).toBe(true);

    // 检查脚本
    expect(
      fs.existsSync(path.join(SCRIPTS_DIR, 'provision-server.sh'))
    ).toBe(true);
    expect(fs.existsSync(path.join(SCRIPTS_DIR, 'check-dns.sh'))).toBe(true);
    expect(fs.existsSync(path.join(SCRIPTS_DIR, 'health-check.sh'))).toBe(
      true
    );
  });

  it('脚本和文档应该相互对应', () => {
    const docPath = path.join(DOCS_DIR, 'server-setup.md');
    const docContent = fs.readFileSync(docPath, 'utf-8');

    // 文档中提到的功能应该在脚本中实现
    const features = [
      { doc: '更新系统', script: 'update_system' },
      { doc: '防火墙', script: 'setup_firewall' },
      { doc: 'Docker', script: 'install_docker' },
      { doc: 'DNS', script: 'check-dns.sh' },
      { doc: '健康检查', script: 'health-check' },
    ];

    features.forEach(({ doc, script }) => {
      // 如果文档提到某个功能
      if (docContent.includes(doc)) {
        // 应该有对应的脚本或函数
        const hasScript = fs
          .readdirSync(SCRIPTS_DIR)
          .some((file) => file.includes(script));
        const hasFunction =
          fs
            .readdirSync(SCRIPTS_DIR)
            .filter((file) => file.endsWith('.sh'))
            .map((file) => fs.readFileSync(path.join(SCRIPTS_DIR, file), 'utf-8'))
            .some((content) => content.includes(script));

        expect(hasScript || hasFunction).toBe(true);
      }
    });
  });
});
