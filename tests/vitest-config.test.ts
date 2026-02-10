/**
 * Vitest 配置验证测试
 *
 * 验证 vitest.config.ts 配置正确，包括：
 * - 路径别名解析
 * - 测试文件匹配模式
 * - 覆盖率配置
 * - 超时和池配置
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..');
const configPath = path.join(ROOT, 'vitest.config.ts');
const configContent = fs.readFileSync(configPath, 'utf-8');

describe('vitest.config.ts 文件存在性', () => {
  it('应该存在于项目根目录', () => {
    expect(fs.existsSync(configPath)).toBe(true);
  });

  it('应该是有效的 TypeScript 文件', () => {
    expect(configContent).toContain('import');
    expect(configContent).toContain('defineConfig');
    expect(configContent).toContain('export default');
  });
});

describe('路径别名配置', () => {
  it('应该配置 @aiinstaller/shared 别名', () => {
    expect(configContent).toContain('@aiinstaller/shared');
    expect(configContent).toContain('packages/shared/src/index.ts');
  });

  it('应该配置 @aiinstaller/server 别名', () => {
    expect(configContent).toContain('@aiinstaller/server');
    expect(configContent).toContain('packages/server/src/index.ts');
  });

  it('应该配置 @aiinstaller/agent 别名', () => {
    expect(configContent).toContain('@aiinstaller/agent');
    expect(configContent).toContain('packages/agent/src/index.ts');
  });
});

describe('测试文件包含规则', () => {
  it('应该包含 packages 下的测试文件', () => {
    expect(configContent).toContain('packages/*/src/**/*.test.ts');
  });

  it('应该包含 tests 目录下的测试文件', () => {
    expect(configContent).toContain('tests/**/*.test.ts');
  });
});

describe('排除规则', () => {
  it('应该排除 node_modules', () => {
    expect(configContent).toContain('**/node_modules/**');
  });

  it('应该排除 dist 目录', () => {
    expect(configContent).toContain('**/dist/**');
  });

  it('应该排除 openclaw-modules', () => {
    expect(configContent).toContain('openclaw-modules');
  });
});

describe('全局 API 配置', () => {
  it('应该启用 globals', () => {
    expect(configContent).toContain('globals: true');
  });
});

describe('超时配置', () => {
  it('应该设置测试超时时间', () => {
    expect(configContent).toMatch(/testTimeout:\s*\d+/);
  });

  it('应该设置 hook 超时时间', () => {
    expect(configContent).toMatch(/hookTimeout:\s*\d+/);
  });
});

describe('测试池配置', () => {
  it('应该配置 pool 选项', () => {
    expect(configContent).toMatch(/pool:\s*['"]forks['"]/);
  });
});

describe('覆盖率配置', () => {
  it('应该配置 coverage provider 为 v8', () => {
    expect(configContent).toMatch(/provider:\s*['"]v8['"]/);
  });

  it('应该配置覆盖率报告格式', () => {
    expect(configContent).toContain('text');
    expect(configContent).toContain('html');
    expect(configContent).toContain('lcov');
  });

  it('应该配置覆盖率报告目录', () => {
    expect(configContent).toContain('reportsDirectory');
    expect(configContent).toContain('coverage');
  });

  it('应该配置覆盖率包含的源文件', () => {
    expect(configContent).toContain('packages/*/src/**/*.ts');
  });

  it('应该排除测试文件不计入覆盖率', () => {
    expect(configContent).toContain('**/*.test.ts');
  });

  it('应该配置覆盖率阈值', () => {
    expect(configContent).toContain('thresholds');
    expect(configContent).toContain('statements');
    expect(configContent).toContain('branches');
    expect(configContent).toContain('functions');
    expect(configContent).toContain('lines');
  });

  it('覆盖率阈值应设置为 80%', () => {
    // 验证阈值都是 80
    const thresholdMatches = configContent.match(/(?:statements|branches|functions|lines):\s*(\d+)/g);
    expect(thresholdMatches).not.toBeNull();
    expect(thresholdMatches!.length).toBe(4);
    for (const match of thresholdMatches!) {
      const value = parseInt(match.split(':')[1].trim());
      expect(value).toBe(80);
    }
  });
});

describe('coverage 依赖安装', () => {
  it('应该安装 @vitest/coverage-v8', () => {
    const rootPkgPath = path.join(ROOT, 'package.json');
    const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, 'utf-8'));
    const hasCoverageV8 =
      rootPkg.devDependencies?.['@vitest/coverage-v8'] ||
      rootPkg.dependencies?.['@vitest/coverage-v8'];
    expect(hasCoverageV8).toBeTruthy();
  });

  it('vitest 和 @vitest/coverage-v8 主版本号应一致', () => {
    const rootPkgPath = path.join(ROOT, 'package.json');
    const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, 'utf-8'));
    const vitestVersion = rootPkg.devDependencies?.['vitest'] || '';
    const coverageVersion = rootPkg.devDependencies?.['@vitest/coverage-v8'] || '';
    // 提取主版本号（去掉 ^ 或 ~ 前缀）
    const vitestMajor = vitestVersion.replace(/^[\^~]/, '').split('.')[0];
    const coverageMajor = coverageVersion.replace(/^[\^~]/, '').split('.')[0];
    expect(vitestMajor).toBe(coverageMajor);
  });
});

describe('各包的测试脚本配置', () => {
  const packages = ['shared', 'server', 'agent'];

  for (const pkg of packages) {
    it(`packages/${pkg}/package.json 应包含 test 脚本`, () => {
      const pkgPath = path.join(ROOT, 'packages', pkg, 'package.json');
      const pkgJson = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      expect(pkgJson.scripts.test).toBe('vitest run');
    });

    it(`packages/${pkg}/package.json 应包含 test:watch 脚本`, () => {
      const pkgPath = path.join(ROOT, 'packages', pkg, 'package.json');
      const pkgJson = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      expect(pkgJson.scripts['test:watch']).toBe('vitest');
    });
  }
});

describe('根 package.json 测试脚本', () => {
  it('应包含 test 脚本', () => {
    const rootPkgPath = path.join(ROOT, 'package.json');
    const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, 'utf-8'));
    expect(rootPkg.scripts.test).toBe('vitest run');
  });

  it('应包含 test:watch 脚本', () => {
    const rootPkgPath = path.join(ROOT, 'package.json');
    const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, 'utf-8'));
    expect(rootPkg.scripts['test:watch']).toBe('vitest');
  });

  it('应包含 test:coverage 脚本', () => {
    const rootPkgPath = path.join(ROOT, 'package.json');
    const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, 'utf-8'));
    expect(rootPkg.scripts['test:coverage']).toBe('vitest run --coverage');
  });
});
