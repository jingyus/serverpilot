/**
 * Tests for Fly.io deployment configuration and setup validation.
 *
 * Validates:
 * - fly.toml exists with correct structure
 * - fly.toml references the correct Dockerfile
 * - fly.toml port matches Dockerfile EXPOSE
 * - fly.toml env vars are consistent with docker-compose.yml
 * - Setup validation functions work correctly
 * - Deployment documentation references fly.toml
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  checkFlyToml,
  checkDockerfile,
  parseFlyToml,
  validateFlyConfig,
  runAllChecks,
  REQUIRED_FLY_SECRETS,
  OPTIONAL_FLY_SECRETS,
} from './fly-setup';

const ROOT_DIR = path.resolve(import.meta.dirname, '..');
const FLY_TOML_PATH = path.join(ROOT_DIR, 'fly.toml');

describe('fly.toml 配置文件', () => {
  const content = fs.readFileSync(FLY_TOML_PATH, 'utf-8');

  describe('文件基本验证', () => {
    it('fly.toml 应存在', () => {
      expect(fs.existsSync(FLY_TOML_PATH)).toBe(true);
    });

    it('文件不应为空', () => {
      expect(content.trim().length).toBeGreaterThan(0);
    });

    it('应使用 LF 换行符', () => {
      expect(content).not.toContain('\r\n');
    });
  });

  describe('必需字段', () => {
    it('应包含 app 名称', () => {
      expect(content).toMatch(/^app\s*=/m);
    });

    it('应包含 primary_region', () => {
      expect(content).toMatch(/^primary_region\s*=/m);
    });

    it('应包含 [build] 段', () => {
      expect(content).toContain('[build]');
    });

    it('应包含 [env] 段', () => {
      expect(content).toContain('[env]');
    });

    it('应包含 [http_service] 段', () => {
      expect(content).toContain('[http_service]');
    });

    it('应包含 [[vm]] 段', () => {
      expect(content).toContain('[[vm]]');
    });
  });

  describe('构建配置', () => {
    it('应指向正确的 Dockerfile', () => {
      expect(content).toContain('packages/server/Dockerfile');
    });

    it('引用的 Dockerfile 应存在', () => {
      expect(
        fs.existsSync(path.join(ROOT_DIR, 'packages/server/Dockerfile')),
      ).toBe(true);
    });
  });

  describe('HTTP 服务配置', () => {
    it('内部端口应为 3000', () => {
      expect(content).toMatch(/internal_port\s*=\s*3000/);
    });

    it('应强制使用 HTTPS', () => {
      expect(content).toMatch(/force_https\s*=\s*true/);
    });

    it('应包含健康检查配置', () => {
      expect(content).toContain('checks');
    });

    it('健康检查路径应为 /', () => {
      expect(content).toMatch(/path\s*=\s*"\/"/);
    });
  });

  describe('环境变量配置', () => {
    it('应设置 NODE_ENV 为 production', () => {
      expect(content).toMatch(/NODE_ENV\s*=\s*"production"/);
    });

    it('应设置 SERVER_PORT', () => {
      expect(content).toMatch(/SERVER_PORT\s*=\s*"3000"/);
    });

    it('应设置 SERVER_HOST', () => {
      expect(content).toMatch(/SERVER_HOST\s*=\s*"0\.0\.0\.0"/);
    });

    it('应设置 LOG_LEVEL', () => {
      expect(content).toMatch(/LOG_LEVEL\s*=\s*"info"/);
    });

    it('应设置 KNOWLEDGE_BASE_DIR', () => {
      expect(content).toContain('KNOWLEDGE_BASE_DIR');
    });

    it('不应包含敏感信息 (ANTHROPIC_API_KEY)', () => {
      // fly.toml is committed to git; secrets should use `fly secrets set`
      expect(content).not.toContain('ANTHROPIC_API_KEY');
    });
  });

  describe('VM 配置', () => {
    it('应配置内存大小', () => {
      expect(content).toMatch(/memory\s*=\s*"/);
    });

    it('应配置 CPU', () => {
      expect(content).toMatch(/cpus\s*=\s*\d/);
    });
  });

  describe('自动伸缩配置', () => {
    it('应配置 auto_stop_machines', () => {
      expect(content).toContain('auto_stop_machines');
    });

    it('应配置 auto_start_machines', () => {
      expect(content).toContain('auto_start_machines');
    });

    it('应配置 min_machines_running', () => {
      expect(content).toContain('min_machines_running');
    });
  });
});

describe('fly.toml 与项目配置一致性', () => {
  it('fly.toml 端口应与 Dockerfile EXPOSE 一致', () => {
    const dockerfile = fs.readFileSync(
      path.join(ROOT_DIR, 'packages/server/Dockerfile'),
      'utf-8',
    );
    expect(dockerfile).toContain('EXPOSE 3000');

    const flyToml = fs.readFileSync(FLY_TOML_PATH, 'utf-8');
    expect(flyToml).toMatch(/internal_port\s*=\s*3000/);
  });

  it('fly.toml 端口应与 docker-compose.yml 一致', () => {
    const dockerCompose = fs.readFileSync(
      path.join(ROOT_DIR, 'docker-compose.yml'),
      'utf-8',
    );
    expect(dockerCompose).toContain('3000');

    const flyToml = fs.readFileSync(FLY_TOML_PATH, 'utf-8');
    expect(flyToml).toMatch(/internal_port\s*=\s*3000/);
  });

  it('fly.toml NODE_ENV 应与 Dockerfile 一致', () => {
    const dockerfile = fs.readFileSync(
      path.join(ROOT_DIR, 'packages/server/Dockerfile'),
      'utf-8',
    );
    expect(dockerfile).toContain('NODE_ENV=production');

    const flyToml = fs.readFileSync(FLY_TOML_PATH, 'utf-8');
    expect(flyToml).toMatch(/NODE_ENV\s*=\s*"production"/);
  });

  it('部署文档应提及 fly.toml', () => {
    const deployDoc = fs.readFileSync(
      path.join(ROOT_DIR, 'docs/deployment.md'),
      'utf-8',
    );
    expect(deployDoc).toContain('fly');
  });
});

describe('parseFlyToml()', () => {
  const config = parseFlyToml();

  it('应解析 app 名称', () => {
    expect(config.app).toBe('aiinstaller-server');
  });

  it('应解析 primary_region', () => {
    expect(config.primaryRegion).toBeDefined();
    expect(typeof config.primaryRegion).toBe('string');
    expect(config.primaryRegion!.length).toBeGreaterThan(0);
  });

  it('应解析 build dockerfile', () => {
    expect(config.buildDockerfile).toBe('packages/server/Dockerfile');
  });

  it('应解析 internal_port', () => {
    expect(config.internalPort).toBe(3000);
  });

  it('应解析 [env] 中的环境变量', () => {
    expect(config.envVars).toBeDefined();
    expect(config.envVars['NODE_ENV']).toBe('production');
    expect(config.envVars['SERVER_PORT']).toBe('3000');
    expect(config.envVars['SERVER_HOST']).toBe('0.0.0.0');
    expect(config.envVars['LOG_LEVEL']).toBe('info');
  });
});

describe('checkFlyToml()', () => {
  it('应返回通过结果', () => {
    const result = checkFlyToml();
    expect(result.passed).toBe(true);
    expect(result.name).toBe('fly.toml');
  });
});

describe('checkDockerfile()', () => {
  it('应返回通过结果', () => {
    const result = checkDockerfile();
    expect(result.passed).toBe(true);
    expect(result.name).toBe('Dockerfile');
  });
});

describe('validateFlyConfig()', () => {
  const results = validateFlyConfig();

  it('应返回多个检查结果', () => {
    expect(results.length).toBeGreaterThan(0);
  });

  it('所有检查应通过', () => {
    for (const r of results) {
      expect(r.passed, `${r.name}: ${r.message}`).toBe(true);
    }
  });

  it('应包含 app name 检查', () => {
    expect(results.some((r) => r.name === 'app name')).toBe(true);
  });

  it('应包含 primary_region 检查', () => {
    expect(results.some((r) => r.name === 'primary_region')).toBe(true);
  });

  it('应包含端口检查', () => {
    expect(results.some((r) => r.name === 'http_service.internal_port')).toBe(true);
  });

  it('应包含 NODE_ENV 检查', () => {
    expect(results.some((r) => r.name === 'env.NODE_ENV')).toBe(true);
  });
});

describe('runAllChecks()', () => {
  const results = runAllChecks();

  it('应返回所有检查结果', () => {
    expect(results.length).toBeGreaterThanOrEqual(7);
  });

  it('所有检查应通过', () => {
    for (const r of results) {
      expect(r.passed, `${r.name}: ${r.message}`).toBe(true);
    }
  });
});

describe('REQUIRED_FLY_SECRETS 常量', () => {
  it('应包含 ANTHROPIC_API_KEY', () => {
    expect(REQUIRED_FLY_SECRETS).toContain('ANTHROPIC_API_KEY');
  });

  it('所有必需密钥应在部署文档中提及', () => {
    const deployDoc = fs.readFileSync(
      path.join(ROOT_DIR, 'docs/deployment.md'),
      'utf-8',
    );
    for (const secret of REQUIRED_FLY_SECRETS) {
      expect(deployDoc, `deployment.md should mention ${secret}`).toContain(secret);
    }
  });
});

describe('OPTIONAL_FLY_SECRETS 常量', () => {
  it('所有可选密钥应在部署文档中提及', () => {
    const deployDoc = fs.readFileSync(
      path.join(ROOT_DIR, 'docs/deployment.md'),
      'utf-8',
    );
    for (const secret of OPTIONAL_FLY_SECRETS) {
      expect(deployDoc, `deployment.md should mention ${secret}`).toContain(secret);
    }
  });
});
