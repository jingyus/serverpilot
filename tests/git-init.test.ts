import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const ROOT_DIR = path.resolve(import.meta.dirname, '..');

// Skip all tests if .git directory doesn't exist (project not yet a git repo)
const gitDirExists = fs.existsSync(path.join(ROOT_DIR, '.git'));

describe.skipIf(!gitDirExists)('Git 仓库初始化', () => {
  describe('.git 目录验证', () => {
    it('.git 目录应存在', () => {
      expect(fs.existsSync(path.join(ROOT_DIR, '.git'))).toBe(true);
    });

    it('.git 应是一个目录', () => {
      const stat = fs.statSync(path.join(ROOT_DIR, '.git'));
      expect(stat.isDirectory()).toBe(true);
    });

    it('.git/HEAD 应存在', () => {
      expect(fs.existsSync(path.join(ROOT_DIR, '.git', 'HEAD'))).toBe(true);
    });

    it('.git/config 应存在', () => {
      expect(fs.existsSync(path.join(ROOT_DIR, '.git', 'config'))).toBe(true);
    });
  });

  describe('分支配置', () => {
    it('应在 master 分支上', () => {
      const branch = execSync('git rev-parse --abbrev-ref HEAD', {
        cwd: ROOT_DIR,
        encoding: 'utf-8',
      }).trim();
      expect(branch).toBe('master');
    });

    it('应有至少一个提交', () => {
      const commitCount = execSync('git rev-list --count HEAD', {
        cwd: ROOT_DIR,
        encoding: 'utf-8',
      }).trim();
      expect(Number(commitCount)).toBeGreaterThan(0);
    });
  });

  describe('远程仓库配置', () => {
    it('应配置 origin 远程仓库', () => {
      const remotes = execSync('git remote', {
        cwd: ROOT_DIR,
        encoding: 'utf-8',
      }).trim();
      expect(remotes.split('\n')).toContain('origin');
    });

    it('origin 应有 fetch URL', () => {
      const url = execSync('git remote get-url origin', {
        cwd: ROOT_DIR,
        encoding: 'utf-8',
      }).trim();
      expect(url.length).toBeGreaterThan(0);
    });

    it('origin 应有 push URL', () => {
      const url = execSync('git remote get-url --push origin', {
        cwd: ROOT_DIR,
        encoding: 'utf-8',
      }).trim();
      expect(url.length).toBeGreaterThan(0);
    });
  });

  describe('.gitignore 验证', () => {
    it('.gitignore 应存在', () => {
      expect(fs.existsSync(path.join(ROOT_DIR, '.gitignore'))).toBe(true);
    });

    it('.gitignore 应包含 node_modules/', () => {
      const content = fs.readFileSync(path.join(ROOT_DIR, '.gitignore'), 'utf-8');
      const rules = content
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && !l.startsWith('#'));
      expect(rules).toContain('node_modules/');
    });

    it('.gitignore 应包含 dist/', () => {
      const content = fs.readFileSync(path.join(ROOT_DIR, '.gitignore'), 'utf-8');
      const rules = content
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && !l.startsWith('#'));
      expect(rules).toContain('dist/');
    });

    it('.gitignore 应包含 .env', () => {
      const content = fs.readFileSync(path.join(ROOT_DIR, '.gitignore'), 'utf-8');
      const rules = content
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && !l.startsWith('#'));
      expect(rules).toContain('.env');
    });
  });

  describe('Git 核心配置', () => {
    it('core.bare 应为 false', () => {
      const bare = execSync('git config --local core.bare', {
        cwd: ROOT_DIR,
        encoding: 'utf-8',
      }).trim();
      expect(bare).toBe('false');
    });

    it('core.logallrefupdates 应为 true', () => {
      const logRefUpdates = execSync('git config --local core.logallrefupdates', {
        cwd: ROOT_DIR,
        encoding: 'utf-8',
      }).trim();
      expect(logRefUpdates).toBe('true');
    });
  });

  describe('Git 工作区状态', () => {
    it('不应有未跟踪的重要配置文件', () => {
      const untrackedOutput = execSync('git ls-files --others --exclude-standard', {
        cwd: ROOT_DIR,
        encoding: 'utf-8',
      }).trim();
      const untrackedFiles = untrackedOutput
        .split('\n')
        .filter((f) => f.length > 0);

      // 重要配置文件不应未跟踪
      const importantFiles = [
        'package.json',
        'tsconfig.json',
        '.gitignore',
        '.env.example',
        'eslint.config.js',
        '.prettierrc',
      ];

      for (const file of importantFiles) {
        expect(untrackedFiles).not.toContain(file);
      }
    });

    it('重要配置文件应被 Git 跟踪', () => {
      const trackedFiles = execSync('git ls-files', {
        cwd: ROOT_DIR,
        encoding: 'utf-8',
      }).trim();

      const importantFiles = [
        'package.json',
        'tsconfig.json',
        '.gitignore',
        '.env.example',
      ];

      for (const file of importantFiles) {
        expect(trackedFiles).toContain(file);
      }
    });
  });

  describe('分支跟踪', () => {
    it('master 分支应跟踪 origin/master', () => {
      const remote = execSync('git config --local branch.master.remote', {
        cwd: ROOT_DIR,
        encoding: 'utf-8',
      }).trim();
      expect(remote).toBe('origin');
    });

    it('master 分支应合并 refs/heads/master', () => {
      const merge = execSync('git config --local branch.master.merge', {
        cwd: ROOT_DIR,
        encoding: 'utf-8',
      }).trim();
      expect(merge).toBe('refs/heads/master');
    });
  });
});
