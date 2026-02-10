/**
 * Tests for docs/deployment.md — the deployment documentation.
 *
 * Validates:
 * - File exists and is well-formed Markdown
 * - All required sections are present
 * - Environment variable table matches .env.example
 * - References to existing project files are valid
 * - Documentation completeness (server deployment, monitoring, backup)
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT_DIR = path.resolve(import.meta.dirname, '..');
const DEPLOYMENT_MD = path.join(ROOT_DIR, 'docs', 'deployment.md');

describe('docs/deployment.md', () => {
  const content = fs.readFileSync(DEPLOYMENT_MD, 'utf-8');
  const lines = content.split('\n');

  // Extract all headings
  const headings = lines
    .filter((line) => line.startsWith('#'))
    .map((line) => line.replace(/^#+\s*/, '').trim());

  describe('文件基本验证', () => {
    it('文件应存在', () => {
      expect(fs.existsSync(DEPLOYMENT_MD)).toBe(true);
    });

    it('文件不应为空', () => {
      expect(content.trim().length).toBeGreaterThan(0);
    });

    it('应以一级标题开头', () => {
      const firstNonEmptyLine = lines.find((l) => l.trim().length > 0);
      expect(firstNonEmptyLine).toMatch(/^# /);
    });

    it('应使用 LF 换行符', () => {
      expect(content).not.toContain('\r\n');
    });
  });

  describe('必需章节 - 服务端部署', () => {
    it('应包含 Docker 部署章节', () => {
      expect(content).toContain('Docker');
    });

    it('应包含 Fly.io 部署章节', () => {
      expect(content).toContain('Fly.io');
    });

    it('应包含 docker compose 命令示例', () => {
      expect(content).toContain('docker compose');
    });

    it('应包含 fly deploy 命令', () => {
      expect(content).toContain('fly deploy');
    });

    it('应包含 fly secrets set 命令', () => {
      expect(content).toContain('fly secrets set');
    });
  });

  describe('必需章节 - 环境变量配置', () => {
    it('应包含环境变量配置章节', () => {
      expect(headings.some((h) => h.includes('环境变量'))).toBe(true);
    });

    it('应列出 ANTHROPIC_API_KEY', () => {
      expect(content).toContain('ANTHROPIC_API_KEY');
    });

    it('应列出 SERVER_PORT', () => {
      expect(content).toContain('SERVER_PORT');
    });

    it('应列出 SERVER_HOST', () => {
      expect(content).toContain('SERVER_HOST');
    });

    it('应列出 NODE_ENV', () => {
      expect(content).toContain('NODE_ENV');
    });

    it('应列出 AI_MODEL', () => {
      expect(content).toContain('AI_MODEL');
    });

    it('应列出 AI_TIMEOUT_MS', () => {
      expect(content).toContain('AI_TIMEOUT_MS');
    });

    it('应列出 AI_MAX_RETRIES', () => {
      expect(content).toContain('AI_MAX_RETRIES');
    });

    it('应列出 WS_HEARTBEAT_INTERVAL_MS', () => {
      expect(content).toContain('WS_HEARTBEAT_INTERVAL_MS');
    });

    it('应列出 WS_CONNECTION_TIMEOUT_MS', () => {
      expect(content).toContain('WS_CONNECTION_TIMEOUT_MS');
    });

    it('应列出 LOG_LEVEL', () => {
      expect(content).toContain('LOG_LEVEL');
    });

    it('应列出 KNOWLEDGE_BASE_DIR', () => {
      expect(content).toContain('KNOWLEDGE_BASE_DIR');
    });

    it('应标注 ANTHROPIC_API_KEY 为必填', () => {
      // Find the line containing ANTHROPIC_API_KEY in a table row and check it says 是
      const apiKeyLine = lines.find(
        (l) => l.includes('ANTHROPIC_API_KEY') && l.includes('|'),
      );
      expect(apiKeyLine).toBeDefined();
      expect(apiKeyLine).toContain('是');
    });
  });

  describe('必需章节 - 监控设置', () => {
    it('应包含监控设置章节', () => {
      expect(headings.some((h) => h.includes('监控'))).toBe(true);
    });

    it('应包含健康检查说明', () => {
      expect(content).toContain('健康检查');
    });

    it('应包含 healthcheck 配置示例', () => {
      expect(content).toContain('healthcheck');
    });

    it('应包含告警规则', () => {
      expect(content).toContain('告警');
    });

    it('应包含日志相关内容', () => {
      expect(content).toContain('日志');
    });
  });

  describe('必需章节 - 备份策略', () => {
    it('应包含备份策略章节', () => {
      expect(headings.some((h) => h.includes('备份'))).toBe(true);
    });

    it('应提及知识库备份', () => {
      expect(content).toContain('knowledge-base');
    });

    it('应包含恢复流程', () => {
      expect(content).toContain('恢复');
    });
  });

  describe('客户端分发', () => {
    it('应包含二进制构建说明', () => {
      expect(content).toContain('build:binary');
    });

    it('应包含安装脚本说明', () => {
      expect(content).toContain('install.sh');
    });

    it('应列出所有支持的平台', () => {
      expect(content).toContain('darwin-arm64');
      expect(content).toContain('darwin-x64');
      expect(content).toContain('linux-x64');
      expect(content).toContain('linux-arm64');
    });

    it('应包含 CDN 配置说明', () => {
      expect(content).toContain('CDN');
    });
  });

  describe('运维手册', () => {
    it('应包含运维手册章节', () => {
      expect(headings.some((h) => h.includes('运维'))).toBe(true);
    });

    it('应包含常用命令', () => {
      expect(content).toContain('常用命令');
    });

    it('应包含故障排除', () => {
      expect(content).toContain('故障排除');
    });

    it('应包含版本升级说明', () => {
      expect(content).toContain('版本升级');
    });
  });

  describe('引用的项目文件应存在', () => {
    it('Dockerfile 应存在', () => {
      expect(
        fs.existsSync(path.join(ROOT_DIR, 'packages/server/Dockerfile')),
      ).toBe(true);
    });

    it('docker-compose.yml 应存在', () => {
      expect(
        fs.existsSync(path.join(ROOT_DIR, 'docker-compose.yml')),
      ).toBe(true);
    });

    it('.env.example 应存在', () => {
      expect(fs.existsSync(path.join(ROOT_DIR, '.env.example'))).toBe(true);
    });

    it('install.sh 应存在', () => {
      expect(fs.existsSync(path.join(ROOT_DIR, 'install.sh'))).toBe(true);
    });

    it('scripts/build-binary.ts 应存在', () => {
      expect(
        fs.existsSync(path.join(ROOT_DIR, 'scripts/build-binary.ts')),
      ).toBe(true);
    });
  });

  describe('文档与项目配置一致性', () => {
    it('文档中的端口应与 docker-compose.yml 一致', () => {
      const dockerCompose = fs.readFileSync(
        path.join(ROOT_DIR, 'docker-compose.yml'),
        'utf-8',
      );
      // docker-compose uses port 3000
      expect(dockerCompose).toContain('3000');
      expect(content).toContain('3000');
    });

    it('文档中的环境变量应与 .env.example 一致', () => {
      const envExample = fs.readFileSync(
        path.join(ROOT_DIR, '.env.example'),
        'utf-8',
      );
      // All env vars in .env.example should be mentioned in deployment doc
      const envVarNames: string[] = [];
      for (const line of envExample.split('\n')) {
        const match = line.match(/^([A-Z][A-Z0-9_]+)=/);
        if (match) envVarNames.push(match[1]);
      }

      for (const varName of envVarNames) {
        expect(
          content.includes(varName),
          `deployment.md should mention env var ${varName}`,
        ).toBe(true);
      }
    });
  });
});
