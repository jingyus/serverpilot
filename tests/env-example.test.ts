import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT_DIR = path.resolve(import.meta.dirname, '..');
const ENV_EXAMPLE_PATH = path.join(ROOT_DIR, '.env.example');

describe('.env.example 环境变量模板', () => {
  const content = fs.readFileSync(ENV_EXAMPLE_PATH, 'utf-8');
  const lines = content.split('\n');

  // 解析所有环境变量 (KEY=VALUE 格式)
  const envVars = new Map<string, string>();
  for (const line of lines) {
    const match = line.match(/^([A-Z][A-Z0-9_]+)=(.*)$/);
    if (match) {
      envVars.set(match[1], match[2]);
    }
  }

  describe('文件基本验证', () => {
    it('文件应存在', () => {
      expect(fs.existsSync(ENV_EXAMPLE_PATH)).toBe(true);
    });

    it('文件不应为空', () => {
      expect(content.trim().length).toBeGreaterThan(0);
    });

    it('应包含配置说明注释', () => {
      expect(content).toContain('cp .env.example .env');
    });
  });

  describe('服务端配置', () => {
    it('应包含 DASHBOARD_PORT (服务端口通过 Nginx 反向代理, SERVER_PORT 内部硬编码为 3000)', () => {
      expect(envVars.has('DASHBOARD_PORT')).toBe(true);
      expect(Number(envVars.get('DASHBOARD_PORT'))).toBeGreaterThan(0);
    });

    it('应包含 SERVER_HOST', () => {
      expect(envVars.has('SERVER_HOST')).toBe(true);
    });

    it('应包含 NODE_ENV', () => {
      expect(envVars.has('NODE_ENV')).toBe(true);
      expect(['development', 'production', 'test']).toContain(envVars.get('NODE_ENV'));
    });
  });

  describe('AI 配置', () => {
    it('应包含 ANTHROPIC_API_KEY', () => {
      expect(envVars.has('ANTHROPIC_API_KEY')).toBe(true);
    });

    it('ANTHROPIC_API_KEY 不应包含真实密钥', () => {
      const value = envVars.get('ANTHROPIC_API_KEY')!;
      expect(value).not.toMatch(/^sk-ant-/);
      expect(value).toContain('your_');
    });

    it('应包含 AI_MODEL', () => {
      expect(envVars.has('AI_MODEL')).toBe(true);
      expect(envVars.get('AI_MODEL')!.length).toBeGreaterThan(0);
    });

    it('应包含 AI_TIMEOUT_MS', () => {
      expect(envVars.has('AI_TIMEOUT_MS')).toBe(true);
      expect(Number(envVars.get('AI_TIMEOUT_MS'))).toBeGreaterThan(0);
    });

    it('应包含 AI_MAX_RETRIES', () => {
      expect(envVars.has('AI_MAX_RETRIES')).toBe(true);
      expect(Number(envVars.get('AI_MAX_RETRIES'))).toBeGreaterThanOrEqual(1);
    });
  });

  describe('WebSocket 配置', () => {
    it('应包含 WS_HEARTBEAT_INTERVAL_MS', () => {
      expect(envVars.has('WS_HEARTBEAT_INTERVAL_MS')).toBe(true);
      expect(Number(envVars.get('WS_HEARTBEAT_INTERVAL_MS'))).toBeGreaterThan(0);
    });

    it('应包含 WS_CONNECTION_TIMEOUT_MS', () => {
      expect(envVars.has('WS_CONNECTION_TIMEOUT_MS')).toBe(true);
      expect(Number(envVars.get('WS_CONNECTION_TIMEOUT_MS'))).toBeGreaterThan(0);
    });
  });

  describe('知识库配置', () => {
    it('应包含 KNOWLEDGE_BASE_DIR', () => {
      expect(envVars.has('KNOWLEDGE_BASE_DIR')).toBe(true);
      expect(envVars.get('KNOWLEDGE_BASE_DIR')!.length).toBeGreaterThan(0);
    });
  });

  describe('日志配置', () => {
    it('应包含 LOG_LEVEL', () => {
      expect(envVars.has('LOG_LEVEL')).toBe(true);
      expect(['debug', 'info', 'warn', 'error']).toContain(envVars.get('LOG_LEVEL'));
    });

    it('应包含 LOG_FILE', () => {
      expect(envVars.has('LOG_FILE')).toBe(true);
    });
  });

  describe('客户端配置', () => {
    it('应包含 INSTALL_SERVER_URL', () => {
      expect(envVars.has('INSTALL_SERVER_URL')).toBe(true);
      expect(envVars.get('INSTALL_SERVER_URL')).toMatch(/^wss?:\/\//);
    });

    it('应包含 COMMAND_TIMEOUT_MS', () => {
      expect(envVars.has('COMMAND_TIMEOUT_MS')).toBe(true);
      expect(Number(envVars.get('COMMAND_TIMEOUT_MS'))).toBeGreaterThan(0);
    });

    it('应包含 DRY_RUN', () => {
      expect(envVars.has('DRY_RUN')).toBe(true);
      expect(['true', 'false']).toContain(envVars.get('DRY_RUN'));
    });
  });

  describe('安全性检查', () => {
    const gitignorePath = path.join(ROOT_DIR, '.gitignore');
    const gitignoreExists = fs.existsSync(gitignorePath);

    it('不应包含真实的 API 密钥', () => {
      for (const [key, value] of envVars) {
        if (key.includes('KEY') || key.includes('SECRET') || key.includes('TOKEN')) {
          expect(value).not.toMatch(/^sk-/);
          expect(value).not.toMatch(/^[a-zA-Z0-9]{30,}$/);
        }
      }
    });

    it.skipIf(!gitignoreExists)('.gitignore 应排除 .env 文件', () => {
      const gitignore = fs.readFileSync(gitignorePath, 'utf-8');
      expect(gitignore).toContain('.env');
    });

    it.skipIf(!gitignoreExists)('.gitignore 不应排除 .env.example', () => {
      const gitignore = fs.readFileSync(gitignorePath, 'utf-8');
      expect(gitignore).not.toContain('.env.example');
    });
  });

  describe('格式规范', () => {
    it('应使用 LF 换行符', () => {
      expect(content).not.toContain('\r\n');
    });

    it('应以换行结尾', () => {
      expect(content.endsWith('\n')).toBe(true);
    });

    it('所有变量名应为大写加下划线格式', () => {
      for (const key of envVars.keys()) {
        expect(key).toMatch(/^[A-Z][A-Z0-9_]+$/);
      }
    });

    it('应包含分组注释', () => {
      expect(content).toContain('# 服务端配置');
      expect(content).toContain('# AI 配置');
      expect(content).toContain('# WebSocket 配置');
      expect(content).toContain('# 知识库配置');
      expect(content).toContain('# 日志配置');
      expect(content).toContain('# 客户端配置');
    });
  });
});
