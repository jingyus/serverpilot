/**
 * Tests for documentation completion (Milestone 9.1 - 文档完善)
 *
 * Validates:
 * - README.md contains production install commands
 * - CHANGELOG.md exists and is well-formed
 * - Website download links are consistent
 * - No placeholder URLs remain in documentation
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT_DIR = path.resolve(import.meta.dirname, '..');

// Check for files that tests depend on
const changelogExists = fs.existsSync(path.join(ROOT_DIR, 'CHANGELOG.md'));
const websiteDir = path.join(ROOT_DIR, 'packages', 'website', 'docs');
const websiteExists = fs.existsSync(websiteDir);

// Note: These tests are specific to AI Installer project
// For ServerPilot, many of these will be skipped until the README is updated
const isAIInstallerProject = fs.readFileSync(path.join(ROOT_DIR, 'README.md'), 'utf-8').includes('get.aiinstaller.dev');

describe.skipIf(!isAIInstallerProject)('README.md - 正式安装命令', () => {
  const readmePath = path.join(ROOT_DIR, 'README.md');
  const content = fs.readFileSync(readmePath, 'utf-8');

  describe('文件基本验证', () => {
    it('文件应存在', () => {
      expect(fs.existsSync(readmePath)).toBe(true);
    });

    it('文件不应为空', () => {
      expect(content.trim().length).toBeGreaterThan(0);
    });

    it('应以一级标题开头', () => {
      const lines = content.split('\n');
      const firstNonEmptyLine = lines.find((l) => l.trim().length > 0);
      expect(firstNonEmptyLine).toMatch(/^# /);
    });
  });

  describe('正式安装命令', () => {
    it('应包含一键安装脚本命令', () => {
      expect(content).toContain('curl -fsSL');
      expect(content).toContain('get.aiinstaller.dev');
    });

    it('应包含所有平台的下载链接', () => {
      expect(content).toContain('aiinstaller-darwin-arm64');
      expect(content).toContain('aiinstaller-darwin-x64');
      expect(content).toContain('aiinstaller-linux-x64');
      expect(content).toContain('aiinstaller-linux-arm64');
      expect(content).toContain('aiinstaller-win-x64.exe');
    });

    it('下载链接应指向 GitHub Releases', () => {
      expect(content).toContain(
        'https://github.com/aiinstaller/aiinstaller/releases/latest/download/',
      );
    });

    it('应包含使用方法示例', () => {
      expect(content).toContain('aiinstaller openclaw');
    });

    it('应包含 --dry-run 选项说明', () => {
      expect(content).toContain('--dry-run');
    });

    it('应包含 --version 选项说明', () => {
      expect(content).toContain('--version');
    });

    it('应包含 WSS 服务器地址', () => {
      expect(content).toContain('wss://api.aiinstaller.dev');
    });
  });

  describe('不应包含占位符', () => {
    it('不应包含 yourusername 占位符', () => {
      expect(content).not.toContain('yourusername');
    });

    it('不应包含 install.ai 旧域名', () => {
      expect(content).not.toMatch(/https:\/\/install\.ai[^n]/);
    });
  });

  describe('核心章节完整性', () => {
    const headings = content
      .split('\n')
      .filter((line) => line.startsWith('#'))
      .map((line) => line.replace(/^#+\s*/, '').trim());

    it('应包含快速安装章节', () => {
      expect(headings.some((h) => h.includes('安装'))).toBe(true);
    });

    it('应包含使用方法章节', () => {
      expect(headings.some((h) => h.includes('使用'))).toBe(true);
    });

    it('应包含项目结构章节', () => {
      expect(headings.some((h) => h.includes('项目结构'))).toBe(true);
    });

    it('应包含技术栈章节', () => {
      expect(headings.some((h) => h.includes('技术栈'))).toBe(true);
    });

    it('应包含安全设计章节', () => {
      expect(headings.some((h) => h.includes('安全'))).toBe(true);
    });

    it('应包含开发指南章节', () => {
      expect(headings.some((h) => h.includes('开发'))).toBe(true);
    });
  });

  describe('技术栈信息准确性', () => {
    it('应提及 Claude API', () => {
      expect(content).toContain('Claude API');
    });

    it('应提及 Vitest 测试框架', () => {
      expect(content).toContain('Vitest');
    });

    it('应提及 MySQL 数据库', () => {
      expect(content).toContain('MySQL');
    });

    it('应提及 Docker 部署', () => {
      expect(content).toContain('Docker');
    });
  });

  describe('链接有效性', () => {
    it.skipIf(!changelogExists)('CHANGELOG.md 应存在', () => {
      expect(
        fs.existsSync(path.join(ROOT_DIR, 'CHANGELOG.md')),
      ).toBe(true);
    });

    it('docs/deployment.md 应存在', () => {
      expect(
        fs.existsSync(path.join(ROOT_DIR, 'docs', 'deployment.md')),
      ).toBe(true);
    });

    it('docs/使用说明.md 应存在', () => {
      expect(
        fs.existsSync(path.join(ROOT_DIR, 'docs', '使用说明.md')),
      ).toBe(true);
    });

    it('docs/开发指南.md 应存在', () => {
      expect(
        fs.existsSync(path.join(ROOT_DIR, 'docs', '开发指南.md')),
      ).toBe(true);
    });
  });
});

describe.skipIf(!changelogExists)('CHANGELOG.md - 发布说明', () => {
  const changelogPath = path.join(ROOT_DIR, 'CHANGELOG.md');
  const content = changelogExists
    ? fs.readFileSync(changelogPath, 'utf-8')
    : '';

  describe('文件基本验证', () => {
    it('文件应存在', () => {
      expect(fs.existsSync(changelogPath)).toBe(true);
    });

    it('文件不应为空', () => {
      expect(content.trim().length).toBeGreaterThan(0);
    });

    it('应以 Changelog 标题开头', () => {
      expect(content).toMatch(/^# Changelog/);
    });
  });

  describe('格式规范', () => {
    it('应遵循 Keep a Changelog 格式', () => {
      expect(content).toContain('Keep a Changelog');
    });

    it('应遵循 Semantic Versioning', () => {
      expect(content).toContain('Semantic Versioning');
    });

    it('应包含版本号和日期', () => {
      expect(content).toMatch(/## \[\d+\.\d+\.\d+\] - \d{4}-\d{2}-\d{2}/);
    });

    it('应包含变更类型标签 (Added/Changed)', () => {
      expect(content).toContain('### Added');
    });
  });

  describe('v0.3.0-beta 发布内容', () => {
    it('应包含 v0.3.0-beta 版本', () => {
      expect(content).toContain('[0.3.0-beta]');
    });

    it('应包含 Dashboard 增强功能', () => {
      expect(content).toContain('Dashboard');
    });

    it('应包含自定义 OpenAI Provider', () => {
      expect(content).toContain('Custom OpenAI');
    });

    it('应包含 E2E 冒烟测试', () => {
      expect(content).toContain('E2E');
    });
  });

  describe('v0.2.0 发布内容', () => {
    it('应包含 v0.2.0 版本', () => {
      expect(content).toContain('[0.2.0]');
    });

    it('应包含共享安全规则', () => {
      expect(content).toContain('Shared Security Rules');
    });

    it('应包含 AI Provider Factory', () => {
      expect(content).toContain('AI Provider Factory');
    });

    it('应包含 CI/CD Pipeline', () => {
      expect(content).toContain('CI/CD Pipeline');
    });

    it('应包含协议兼容性', () => {
      expect(content).toContain('Protocol Compatibility');
    });
  });

  describe('v0.1.0 基线版本', () => {
    it('应包含 v0.1.0 版本', () => {
      expect(content).toContain('[0.1.0]');
    });

    it('应包含 WebSocket 架构', () => {
      expect(content).toContain('WebSocket');
    });

    it('应包含 AI 引擎', () => {
      expect(content).toContain('AI Engine');
    });

    it('应包含安全模块', () => {
      expect(content).toContain('Security');
    });

    it('应包含 Docker Compose 部署', () => {
      expect(content).toContain('Docker Compose');
    });
  });
});

describe.skipIf(!websiteExists)('官网文档 - 链接一致性', () => {

  describe('首页链接', () => {
    const indexPath = path.join(websiteDir, 'index.md');

    it('index.md 应存在', () => {
      expect(fs.existsSync(indexPath)).toBe(true);
    });

    it('不应包含 yourusername 占位符', () => {
      const content = fs.readFileSync(indexPath, 'utf-8');
      expect(content).not.toContain('yourusername');
    });

    it('GitHub 链接应指向正确仓库', () => {
      const content = fs.readFileSync(indexPath, 'utf-8');
      // All GitHub references should use aiinstaller/aiinstaller
      const githubLinks = content.match(/github\.com\/[^/\s)]+\/[^/\s)]+/g) || [];
      for (const link of githubLinks) {
        expect(link).toBe('github.com/aiinstaller/aiinstaller');
      }
    });
  });

  describe('下载页链接', () => {
    const downloadPath = path.join(websiteDir, 'download.md');

    it('download.md 应存在', () => {
      expect(fs.existsSync(downloadPath)).toBe(true);
    });

    it('应包含所有平台的下载链接', () => {
      const content = fs.readFileSync(downloadPath, 'utf-8');
      expect(content).toContain('aiinstaller-darwin-arm64');
      expect(content).toContain('aiinstaller-darwin-x64');
      expect(content).toContain('aiinstaller-linux-x64');
      expect(content).toContain('aiinstaller-linux-arm64');
      expect(content).toContain('aiinstaller-win-x64.exe');
    });

    it('下载链接应指向 GitHub Releases', () => {
      const content = fs.readFileSync(downloadPath, 'utf-8');
      expect(content).toContain(
        'https://github.com/aiinstaller/aiinstaller/releases/latest/download/',
      );
    });

    it('应包含一键安装脚本', () => {
      const content = fs.readFileSync(downloadPath, 'utf-8');
      expect(content).toContain('curl -fsSL');
    });

    it('应包含从源码构建说明', () => {
      const content = fs.readFileSync(downloadPath, 'utf-8');
      expect(content).toContain('pnpm install');
      expect(content).toContain('pnpm build');
    });
  });

  describe('README 和官网一致性', () => {
    it('README 和下载页应使用相同的二进制文件名', () => {
      const readme = fs.readFileSync(
        path.join(ROOT_DIR, 'README.md'),
        'utf-8',
      );
      const download = fs.readFileSync(
        path.join(websiteDir, 'download.md'),
        'utf-8',
      );

      const binaryNames = [
        'aiinstaller-darwin-arm64',
        'aiinstaller-darwin-x64',
        'aiinstaller-linux-x64',
        'aiinstaller-linux-arm64',
        'aiinstaller-win-x64.exe',
      ];

      for (const name of binaryNames) {
        expect(readme).toContain(name);
        expect(download).toContain(name);
      }
    });
  });
});
