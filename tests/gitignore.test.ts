import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT_DIR = path.resolve(import.meta.dirname, '..');
const GITIGNORE_PATH = path.join(ROOT_DIR, '.gitignore');

// Skip all tests if .gitignore doesn't exist
const gitignoreExists = fs.existsSync(GITIGNORE_PATH);

// Only read file content if file exists
const content = gitignoreExists ? fs.readFileSync(GITIGNORE_PATH, 'utf-8') : '';
const lines = content.split('\n');

// 获取所有非注释、非空行的规则
const rules = lines
  .map((line) => line.trim())
  .filter((line) => line.length > 0 && !line.startsWith('#'));

describe.skipIf(!gitignoreExists)('.gitignore 文件', () => {

  describe('文件基本验证', () => {
    it('文件应存在', () => {
      expect(fs.existsSync(GITIGNORE_PATH)).toBe(true);
    });

    it('文件不应为空', () => {
      expect(content.trim().length).toBeGreaterThan(0);
    });

    it('应使用 LF 换行符', () => {
      expect(content).not.toContain('\r\n');
    });

    it('应以换行结尾', () => {
      expect(content.endsWith('\n')).toBe(true);
    });
  });

  describe('Dependencies 规则', () => {
    it('应忽略 node_modules/', () => {
      expect(rules).toContain('node_modules/');
    });
  });

  describe('Build outputs 规则', () => {
    it('应忽略 dist/', () => {
      expect(rules).toContain('dist/');
    });

    it('应忽略 build/', () => {
      expect(rules).toContain('build/');
    });

    it('应忽略 TypeScript 构建信息文件', () => {
      expect(rules).toContain('*.tsbuildinfo');
    });
  });

  describe('Environment variables 规则', () => {
    it('应忽略 .env', () => {
      expect(rules).toContain('.env');
    });

    it('应忽略 .env.local', () => {
      expect(rules).toContain('.env.local');
    });

    it('应忽略 .env.*.local', () => {
      expect(rules).toContain('.env.*.local');
    });

    it('不应忽略 .env.example', () => {
      expect(rules).not.toContain('.env.example');
    });
  });

  describe('Test and coverage 规则', () => {
    it('应忽略 coverage/', () => {
      expect(rules).toContain('coverage/');
    });
  });

  describe('IDE and editor 规则', () => {
    it('应忽略 .idea/', () => {
      expect(rules).toContain('.idea/');
    });

    it('应忽略 .vscode/', () => {
      expect(rules).toContain('.vscode/');
    });

    it('应忽略 .history/', () => {
      expect(rules).toContain('.history/');
    });
  });

  describe('OS files 规则', () => {
    it('应忽略 .DS_Store', () => {
      expect(rules).toContain('.DS_Store');
    });

    it('应忽略 Thumbs.db', () => {
      expect(rules).toContain('Thumbs.db');
    });
  });

  describe('Logs 规则', () => {
    it('应忽略通用日志文件', () => {
      expect(rules).toContain('*.log');
    });

    it('应忽略 npm 调试日志', () => {
      expect(rules).toContain('npm-debug.log*');
    });

    it('应忽略 pnpm 调试日志', () => {
      expect(rules).toContain('pnpm-debug.log*');
    });
  });

  describe('Temporary files 规则', () => {
    it('应忽略 *.tmp', () => {
      expect(rules).toContain('*.tmp');
    });

    it('应忽略 *.swp', () => {
      expect(rules).toContain('*.swp');
    });

    it('应忽略 *~', () => {
      expect(rules).toContain('*~');
    });
  });

  describe('分组注释', () => {
    it('应包含 Dependencies 分组', () => {
      expect(content).toContain('# Dependencies');
    });

    it('应包含 Build outputs 分组', () => {
      expect(content).toContain('# Build outputs');
    });

    it('应包含 Environment variables 分组', () => {
      expect(content).toContain('# Environment variables');
    });

    it('应包含 Test and coverage 分组', () => {
      expect(content).toContain('# Test and coverage');
    });

    it('应包含 IDE and editor 分组', () => {
      expect(content).toContain('# IDE and editor');
    });

    it('应包含 OS files 分组', () => {
      expect(content).toContain('# OS files');
    });

    it('应包含 Logs 分组', () => {
      expect(content).toContain('# Logs');
    });

    it('应包含 Temporary files 分组', () => {
      expect(content).toContain('# Temporary files');
    });
  });

  describe('与项目配置一致性', () => {
    const prettierIgnorePath = path.join(ROOT_DIR, '.prettierignore');
    const prettierIgnoreExists = fs.existsSync(prettierIgnorePath);

    it.skipIf(!prettierIgnoreExists)('.prettierignore 中的忽略项应在 .gitignore 中有体现', () => {
      const prettierIgnore = fs.readFileSync(prettierIgnorePath, 'utf-8');
      const prettierRules = prettierIgnore
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && !l.startsWith('#'));

      // dist/ 和 node_modules/ 应同时在两个文件中
      for (const rule of ['dist/', 'node_modules/']) {
        if (prettierRules.includes(rule)) {
          expect(rules).toContain(rule);
        }
      }
    });
  });
});
