import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';

const ROOT = resolve(__dirname, '..');
const testYmlPath = resolve(ROOT, '.github/workflows/test.yml');
const ciYmlPath = resolve(ROOT, '.github/workflows/ci.yml');

describe('GitHub Actions CI 配置', () => {
  describe('test.yml - 测试工作流', () => {
    let config: Record<string, unknown>;
    let content: string;

    it('文件存在且可读', () => {
      expect(existsSync(testYmlPath)).toBe(true);
      content = readFileSync(testYmlPath, 'utf-8');
      expect(content.length).toBeGreaterThan(0);
    });

    it('YAML 格式有效', () => {
      content = readFileSync(testYmlPath, 'utf-8');
      config = parseYaml(content);
      expect(config).toBeDefined();
      expect(config.name).toBe('Test');
    });

    describe('触发条件', () => {
      it('push 到 master/main 触发', () => {
        content = readFileSync(testYmlPath, 'utf-8');
        config = parseYaml(content);
        const on = config.on as Record<string, unknown>;
        expect(on).toBeDefined();
        expect(on.push).toBeDefined();
        const push = on.push as Record<string, unknown>;
        const branches = push.branches as string[];
        expect(branches).toContain('master');
        expect(branches).toContain('main');
      });

      it('PR 到 master/main 触发', () => {
        content = readFileSync(testYmlPath, 'utf-8');
        config = parseYaml(content);
        const on = config.on as Record<string, unknown>;
        expect(on.pull_request).toBeDefined();
        const pr = on.pull_request as Record<string, unknown>;
        const branches = pr.branches as string[];
        expect(branches).toContain('master');
        expect(branches).toContain('main');
      });
    });

    describe('并发控制', () => {
      it('配置了并发组以避免重复运行', () => {
        content = readFileSync(testYmlPath, 'utf-8');
        config = parseYaml(content);
        const concurrency = config.concurrency as Record<string, unknown>;
        expect(concurrency).toBeDefined();
        expect(concurrency.group).toBeDefined();
        expect(concurrency['cancel-in-progress']).toBe(true);
      });
    });

    describe('测试 Job', () => {
      it('包含 test job', () => {
        content = readFileSync(testYmlPath, 'utf-8');
        config = parseYaml(content);
        const jobs = config.jobs as Record<string, unknown>;
        expect(jobs.test).toBeDefined();
      });

      it('使用矩阵策略覆盖多平台', () => {
        content = readFileSync(testYmlPath, 'utf-8');
        config = parseYaml(content);
        const jobs = config.jobs as Record<string, unknown>;
        const test = jobs.test as Record<string, unknown>;
        const strategy = test.strategy as Record<string, unknown>;
        expect(strategy).toBeDefined();
        const matrix = strategy.matrix as Record<string, unknown>;
        const includeArray = matrix.include as Array<Record<string, unknown>>;
        const osValues = includeArray.map((entry) => entry.os);
        expect(osValues).toContain('ubuntu-latest');
        expect(osValues).toContain('macos-latest');
      });

      it('fail-fast 设置为 false 以确保所有平台都测试', () => {
        content = readFileSync(testYmlPath, 'utf-8');
        config = parseYaml(content);
        const jobs = config.jobs as Record<string, unknown>;
        const test = jobs.test as Record<string, unknown>;
        const strategy = test.strategy as Record<string, unknown>;
        expect(strategy['fail-fast']).toBe(false);
      });

      it('使用 Node.js 22', () => {
        content = readFileSync(testYmlPath, 'utf-8');
        config = parseYaml(content);
        const jobs = config.jobs as Record<string, unknown>;
        const test = jobs.test as Record<string, unknown>;
        const strategy = test.strategy as Record<string, unknown>;
        const matrix = strategy.matrix as Record<string, unknown>;
        const includeArray = matrix.include as Array<Record<string, unknown>>;
        const nodeVersions = includeArray.map((entry) => entry['node-version']);
        expect(nodeVersions).toContain(22);
      });

      it('包含关键步骤: checkout, pnpm, node, install, test', () => {
        content = readFileSync(testYmlPath, 'utf-8');
        config = parseYaml(content);
        const jobs = config.jobs as Record<string, unknown>;
        const test = jobs.test as Record<string, unknown>;
        const steps = test.steps as Array<Record<string, unknown>>;
        expect(steps.length).toBeGreaterThanOrEqual(5);

        const stepNames = steps.map(s => s.name as string);
        expect(stepNames.some(n => n.toLowerCase().includes('checkout'))).toBe(true);
        expect(stepNames.some(n => n.toLowerCase().includes('pnpm'))).toBe(true);
        expect(stepNames.some(n => n.toLowerCase().includes('node'))).toBe(true);
        expect(stepNames.some(n => n.toLowerCase().includes('install'))).toBe(true);
        expect(stepNames.some(n => n.toLowerCase().includes('test'))).toBe(true);
      });

      it('使用 pnpm install --frozen-lockfile', () => {
        content = readFileSync(testYmlPath, 'utf-8');
        expect(content).toContain('pnpm install --frozen-lockfile');
      });

      it('运行 pnpm test', () => {
        content = readFileSync(testYmlPath, 'utf-8');
        expect(content).toContain('pnpm test');
      });

      it('使用 actions/checkout@v4', () => {
        content = readFileSync(testYmlPath, 'utf-8');
        expect(content).toContain('actions/checkout@v4');
      });

      it('使用 actions/setup-node@v4', () => {
        content = readFileSync(testYmlPath, 'utf-8');
        expect(content).toContain('actions/setup-node@v4');
      });

      it('使用 pnpm/action-setup@v4', () => {
        content = readFileSync(testYmlPath, 'utf-8');
        expect(content).toContain('pnpm/action-setup@v4');
      });

      it('配置 pnpm 缓存', () => {
        content = readFileSync(testYmlPath, 'utf-8');
        expect(content).toContain("cache: 'pnpm'");
      });
    });

    describe('Lint Job', () => {
      it('包含 lint job', () => {
        content = readFileSync(testYmlPath, 'utf-8');
        config = parseYaml(content);
        const jobs = config.jobs as Record<string, unknown>;
        expect(jobs.lint).toBeDefined();
      });

      it('lint 在 ubuntu 上运行', () => {
        content = readFileSync(testYmlPath, 'utf-8');
        config = parseYaml(content);
        const jobs = config.jobs as Record<string, unknown>;
        const lint = jobs.lint as Record<string, unknown>;
        expect(lint['runs-on']).toBe('ubuntu-latest');
      });

      it('包含类型检查步骤', () => {
        content = readFileSync(testYmlPath, 'utf-8');
        expect(content).toContain('pnpm typecheck');
      });
    });

    describe('覆盖率报告', () => {
      it('生成覆盖率报告', () => {
        content = readFileSync(testYmlPath, 'utf-8');
        expect(content).toContain('pnpm test:coverage');
      });

      it('上传覆盖率 artifact', () => {
        content = readFileSync(testYmlPath, 'utf-8');
        expect(content).toContain('actions/upload-artifact@v4');
        expect(content).toContain('coverage-report');
      });

      it('仅在 ubuntu 上上传覆盖率', () => {
        content = readFileSync(testYmlPath, 'utf-8');
        expect(content).toContain("matrix.os == 'ubuntu-latest'");
      });
    });
  });

  describe('ci.yml - 构建工作流', () => {
    let config: Record<string, unknown>;
    let content: string;

    it('文件存在且可读', () => {
      expect(existsSync(ciYmlPath)).toBe(true);
      content = readFileSync(ciYmlPath, 'utf-8');
      expect(content.length).toBeGreaterThan(0);
    });

    it('YAML 格式有效', () => {
      content = readFileSync(ciYmlPath, 'utf-8');
      config = parseYaml(content);
      expect(config).toBeDefined();
      expect(config.name).toBe('CI');
    });

    it('PR 时触发构建', () => {
      content = readFileSync(ciYmlPath, 'utf-8');
      config = parseYaml(content);
      const on = config.on as Record<string, unknown>;
      expect(on.pull_request).toBeDefined();
    });

    it('包含 build job', () => {
      content = readFileSync(ciYmlPath, 'utf-8');
      config = parseYaml(content);
      const jobs = config.jobs as Record<string, unknown>;
      expect(jobs.build).toBeDefined();
    });

    it('运行 pnpm build', () => {
      content = readFileSync(ciYmlPath, 'utf-8');
      expect(content).toContain('pnpm build');
    });

    it('配置了并发控制', () => {
      content = readFileSync(ciYmlPath, 'utf-8');
      config = parseYaml(content);
      const concurrency = config.concurrency as Record<string, unknown>;
      expect(concurrency).toBeDefined();
      expect(concurrency['cancel-in-progress']).toBe(true);
    });
  });

  describe('工作流安全最佳实践', () => {
    it('test.yml 不包含硬编码密钥', () => {
      const content = readFileSync(testYmlPath, 'utf-8');
      expect(content).not.toMatch(/password\s*[:=]\s*['"]\w+['"]/i);
      expect(content).not.toMatch(/secret\s*[:=]\s*['"]\w+['"]/i);
      expect(content).not.toMatch(/api[_-]?key\s*[:=]\s*['"]\w+['"]/i);
    });

    it('ci.yml 不包含硬编码密钥', () => {
      const content = readFileSync(ciYmlPath, 'utf-8');
      expect(content).not.toMatch(/password\s*[:=]\s*['"]\w+['"]/i);
      expect(content).not.toMatch(/secret\s*[:=]\s*['"]\w+['"]/i);
      expect(content).not.toMatch(/api[_-]?key\s*[:=]\s*['"]\w+['"]/i);
    });

    it('使用固定版本的 actions（@v4）', () => {
      const content = readFileSync(testYmlPath, 'utf-8');
      const actionUses = content.match(/uses:\s*\S+/g) || [];
      for (const action of actionUses) {
        expect(action).toMatch(/@v\d+/);
      }
    });
  });

  describe('deploy-website.yml - 网站部署工作流', () => {
    const deployPath = resolve(ROOT, '.github/workflows/deploy-website.yml');

    it('文件存在', () => {
      expect(existsSync(deployPath)).toBe(true);
    });

    it('YAML 格式有效', () => {
      const content = readFileSync(deployPath, 'utf-8');
      const config = parseYaml(content);
      expect(config).toBeDefined();
      expect(config.name).toBe('Deploy Website');
    });

    it('仅在 website 目录变更时触发', () => {
      const content = readFileSync(deployPath, 'utf-8');
      expect(content).toContain('packages/website/**');
    });
  });
});
