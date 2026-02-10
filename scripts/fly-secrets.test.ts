/**
 * Tests for Fly.io Secrets (Environment Variables) Configuration Module.
 *
 * Validates:
 * - Constants consistency with fly-setup.ts
 * - App name resolution logic
 * - .env.example parsing
 * - Command building functions
 * - Secret set/list/validate logic (dry-run)
 * - Type exports
 * - Integration with project configuration
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  REQUIRED_SECRETS,
  OPTIONAL_SECRETS,
  ALL_SECRETS,
  resolveAppName,
  parseEnvExample,
  buildSetCommand,
  buildUnsetCommand,
  buildListCommand,
  setSecret,
  setMultipleSecrets,
  validateSecrets,
} from './fly-secrets';
import type {
  FlySecretEntry,
  FlySecretsListResult,
  FlySecretSetResult,
  FlySecretsValidation,
} from './fly-secrets';
import {
  REQUIRED_FLY_SECRETS,
  OPTIONAL_FLY_SECRETS,
} from './fly-setup';

const ROOT_DIR = path.resolve(import.meta.dirname, '..');

// ============================================================================
// Constants
// ============================================================================

describe('REQUIRED_SECRETS 常量', () => {
  it('应包含 ANTHROPIC_API_KEY', () => {
    expect(REQUIRED_SECRETS).toContain('ANTHROPIC_API_KEY');
  });

  it('应至少有一个必需密钥', () => {
    expect(REQUIRED_SECRETS.length).toBeGreaterThanOrEqual(1);
  });

  it('所有必需密钥应是非空字符串', () => {
    for (const secret of REQUIRED_SECRETS) {
      expect(typeof secret).toBe('string');
      expect(secret.length).toBeGreaterThan(0);
    }
  });

  it('所有必需密钥应使用大写下划线命名', () => {
    for (const secret of REQUIRED_SECRETS) {
      expect(secret).toMatch(/^[A-Z][A-Z0-9_]*$/);
    }
  });

  it('应与 fly-setup.ts 的 REQUIRED_FLY_SECRETS 一致', () => {
    expect([...REQUIRED_SECRETS].sort()).toEqual([...REQUIRED_FLY_SECRETS].sort());
  });
});

describe('OPTIONAL_SECRETS 常量', () => {
  it('应包含已知的可选密钥', () => {
    expect(OPTIONAL_SECRETS).toContain('AI_MODEL');
    expect(OPTIONAL_SECRETS).toContain('AI_TIMEOUT_MS');
    expect(OPTIONAL_SECRETS).toContain('LOG_LEVEL');
  });

  it('所有可选密钥应使用大写下划线命名', () => {
    for (const secret of OPTIONAL_SECRETS) {
      expect(secret).toMatch(/^[A-Z][A-Z0-9_]*$/);
    }
  });

  it('应与 fly-setup.ts 的 OPTIONAL_FLY_SECRETS 一致', () => {
    expect([...OPTIONAL_SECRETS].sort()).toEqual([...OPTIONAL_FLY_SECRETS].sort());
  });

  it('不应与 REQUIRED_SECRETS 重叠', () => {
    const required = new Set(REQUIRED_SECRETS);
    for (const secret of OPTIONAL_SECRETS) {
      expect(required.has(secret as string), `${secret} should not be in both required and optional`).toBe(false);
    }
  });
});

describe('ALL_SECRETS 常量', () => {
  it('应包含所有必需和可选密钥', () => {
    for (const secret of REQUIRED_SECRETS) {
      expect(ALL_SECRETS).toContain(secret);
    }
    for (const secret of OPTIONAL_SECRETS) {
      expect(ALL_SECRETS).toContain(secret);
    }
  });

  it('长度应等于必需加可选之和', () => {
    expect(ALL_SECRETS.length).toBe(REQUIRED_SECRETS.length + OPTIONAL_SECRETS.length);
  });

  it('不应有重复项', () => {
    const unique = new Set(ALL_SECRETS);
    expect(unique.size).toBe(ALL_SECRETS.length);
  });
});

// ============================================================================
// resolveAppName
// ============================================================================

describe('resolveAppName()', () => {
  it('指定 appName 时应直接返回', () => {
    expect(resolveAppName('my-custom-app')).toBe('my-custom-app');
  });

  it('未指定时应从 fly.toml 解析', () => {
    const result = resolveAppName();
    expect(result).toBe('aiinstaller-server');
  });

  it('应返回字符串类型', () => {
    expect(typeof resolveAppName()).toBe('string');
  });

  it('返回值不应为空', () => {
    expect(resolveAppName().length).toBeGreaterThan(0);
  });
});

// ============================================================================
// parseEnvExample
// ============================================================================

describe('parseEnvExample()', () => {
  it('应返回 Map 类型', () => {
    const result = parseEnvExample();
    expect(result).toBeInstanceOf(Map);
  });

  it('应解析出 ANTHROPIC_API_KEY', () => {
    const result = parseEnvExample();
    expect(result.has('ANTHROPIC_API_KEY')).toBe(true);
  });

  it('ANTHROPIC_API_KEY 应包含描述', () => {
    const result = parseEnvExample();
    const entry = result.get('ANTHROPIC_API_KEY');
    expect(entry).toBeDefined();
    expect(entry!.description.length).toBeGreaterThan(0);
  });

  it('应解析出 SERVER_PORT 的默认值', () => {
    const result = parseEnvExample();
    const entry = result.get('SERVER_PORT');
    expect(entry).toBeDefined();
    expect(entry!.defaultValue).toBe('3000');
  });

  it('应解析出 AI_MODEL 的默认值', () => {
    const result = parseEnvExample();
    const entry = result.get('AI_MODEL');
    expect(entry).toBeDefined();
    expect(entry!.defaultValue.length).toBeGreaterThan(0);
  });

  it('应解析出所有必需密钥', () => {
    const result = parseEnvExample();
    for (const secret of REQUIRED_SECRETS) {
      expect(result.has(secret), `${secret} should be in .env.example`).toBe(true);
    }
  });

  it('应解析出所有可选密钥', () => {
    const result = parseEnvExample();
    for (const secret of OPTIONAL_SECRETS) {
      expect(result.has(secret), `${secret} should be in .env.example`).toBe(true);
    }
  });

  it('解析结果的每个条目应有描述和默认值', () => {
    const result = parseEnvExample();
    for (const [key, entry] of result) {
      expect(typeof entry.description, `${key} should have string description`).toBe('string');
      expect(typeof entry.defaultValue, `${key} should have string defaultValue`).toBe('string');
    }
  });
});

// ============================================================================
// Command Building
// ============================================================================

describe('buildSetCommand()', () => {
  it('应构建正确的 fly secrets set 命令', () => {
    const cmd = buildSetCommand('MY_KEY', 'my_value', 'test-app');
    expect(cmd).toBe('fly secrets set MY_KEY=my_value --app test-app');
  });

  it('应包含 --app 参数', () => {
    const cmd = buildSetCommand('KEY', 'val', 'my-app');
    expect(cmd).toContain('--app my-app');
  });

  it('应包含 fly secrets set', () => {
    const cmd = buildSetCommand('KEY', 'val', 'app');
    expect(cmd).toMatch(/^fly secrets set/);
  });

  it('应包含 key=value 格式', () => {
    const cmd = buildSetCommand('FOO', 'bar', 'app');
    expect(cmd).toContain('FOO=bar');
  });
});

describe('buildUnsetCommand()', () => {
  it('应构建正确的 fly secrets unset 命令', () => {
    const cmd = buildUnsetCommand('MY_KEY', 'test-app');
    expect(cmd).toBe('fly secrets unset MY_KEY --app test-app');
  });

  it('应包含 fly secrets unset', () => {
    const cmd = buildUnsetCommand('KEY', 'app');
    expect(cmd).toMatch(/^fly secrets unset/);
  });

  it('应包含密钥名称', () => {
    const cmd = buildUnsetCommand('ANTHROPIC_API_KEY', 'app');
    expect(cmd).toContain('ANTHROPIC_API_KEY');
  });
});

describe('buildListCommand()', () => {
  it('应构建正确的 fly secrets list 命令', () => {
    const cmd = buildListCommand('test-app');
    expect(cmd).toBe('fly secrets list --app test-app');
  });

  it('应包含 fly secrets list', () => {
    const cmd = buildListCommand('app');
    expect(cmd).toMatch(/^fly secrets list/);
  });

  it('应包含 --app 参数', () => {
    const cmd = buildListCommand('my-app');
    expect(cmd).toContain('--app my-app');
  });
});

// ============================================================================
// setSecret (dry-run)
// ============================================================================

describe('setSecret() dry-run', () => {
  it('dry-run 模式应返回成功', () => {
    const result = setSecret('KEY', 'value', 'app', true);
    expect(result.success).toBe(true);
    expect(result.action).toBe('dry-run');
  });

  it('dry-run 应包含密钥名称在消息中', () => {
    const result = setSecret('ANTHROPIC_API_KEY', 'sk-xxx', 'app', true);
    expect(result.message).toContain('ANTHROPIC_API_KEY');
  });

  it('dry-run 应标记 action 为 dry-run', () => {
    const result = setSecret('KEY', 'val', 'app', true);
    expect(result.action).toBe('dry-run');
  });

  it('空 name 应返回失败', () => {
    const result = setSecret('', 'value', 'app', true);
    expect(result.success).toBe(false);
    expect(result.action).toBe('skipped');
  });

  it('空 value 应返回失败', () => {
    const result = setSecret('KEY', '', 'app', true);
    expect(result.success).toBe(false);
    expect(result.action).toBe('skipped');
  });

  it('返回结果应包含 name 字段', () => {
    const result = setSecret('MY_SECRET', 'val', 'app', true);
    expect(result.name).toBe('MY_SECRET');
  });
});

// ============================================================================
// setMultipleSecrets (dry-run)
// ============================================================================

describe('setMultipleSecrets() dry-run', () => {
  it('应为每个密钥返回 dry-run 结果', () => {
    const results = setMultipleSecrets(
      { KEY1: 'val1', KEY2: 'val2' },
      'app',
      true,
    );
    expect(results).toHaveLength(2);
    expect(results[0].action).toBe('dry-run');
    expect(results[1].action).toBe('dry-run');
  });

  it('空对象应返回空数组', () => {
    const results = setMultipleSecrets({}, 'app', true);
    expect(results).toHaveLength(0);
  });

  it('应过滤空值', () => {
    const results = setMultipleSecrets(
      { KEY1: 'val1', KEY2: '' },
      'app',
      true,
    );
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('KEY1');
  });

  it('每个结果应包含密钥名称', () => {
    const results = setMultipleSecrets(
      { FOO: 'a', BAR: 'b' },
      'app',
      true,
    );
    const names = results.map((r) => r.name);
    expect(names).toContain('FOO');
    expect(names).toContain('BAR');
  });

  it('所有 dry-run 结果应标记成功', () => {
    const results = setMultipleSecrets(
      { KEY1: 'val1', KEY2: 'val2', KEY3: 'val3' },
      'app',
      true,
    );
    for (const r of results) {
      expect(r.success).toBe(true);
    }
  });
});

// ============================================================================
// validateSecrets (dry-run)
// ============================================================================

describe('validateSecrets() dry-run', () => {
  it('dry-run 应列出所有必需密钥为 missing', () => {
    const result = validateSecrets('app', true);
    expect(result.missing).toEqual(expect.arrayContaining([...REQUIRED_SECRETS]));
  });

  it('dry-run 的 valid 应为 false (因为未实际检查)', () => {
    const result = validateSecrets('app', true);
    expect(result.valid).toBe(false);
  });

  it('dry-run 应返回所有密钥的检查结果', () => {
    const result = validateSecrets('app', true);
    expect(result.results.length).toBe(REQUIRED_SECRETS.length);
  });

  it('dry-run 结果中每个 action 应为 dry-run', () => {
    const result = validateSecrets('app', true);
    for (const r of result.results) {
      expect(r.action).toBe('dry-run');
    }
  });

  it('dry-run present 列表应为空', () => {
    const result = validateSecrets('app', true);
    expect(result.present).toHaveLength(0);
  });
});

// ============================================================================
// Type exports
// ============================================================================

describe('类型导出', () => {
  it('FlySecretEntry 类型应正确定义', () => {
    const entry: FlySecretEntry = {
      name: 'KEY',
      digest: 'abc123',
      createdAt: '2026-01-01',
    };
    expect(entry.name).toBe('KEY');
    expect(entry.digest).toBe('abc123');
    expect(entry.createdAt).toBe('2026-01-01');
  });

  it('FlySecretsListResult 类型应正确定义', () => {
    const result: FlySecretsListResult = {
      success: true,
      secrets: [],
    };
    expect(result.success).toBe(true);
    expect(result.secrets).toEqual([]);
  });

  it('FlySecretSetResult 类型应正确定义', () => {
    const result: FlySecretSetResult = {
      success: true,
      name: 'KEY',
      action: 'set',
      message: 'done',
    };
    expect(result.action).toBe('set');
  });

  it('FlySecretsValidation 类型应正确定义', () => {
    const result: FlySecretsValidation = {
      valid: true,
      missing: [],
      present: ['ANTHROPIC_API_KEY'],
      results: [],
    };
    expect(result.valid).toBe(true);
    expect(result.present).toContain('ANTHROPIC_API_KEY');
  });
});

// ============================================================================
// 项目配置一致性
// ============================================================================

describe('项目配置一致性', () => {
  it('所有必需密钥应在 .env.example 中定义', () => {
    const envExample = fs.readFileSync(
      path.join(ROOT_DIR, '.env.example'),
      'utf-8',
    );
    for (const secret of REQUIRED_SECRETS) {
      expect(envExample, `${secret} should be in .env.example`).toContain(secret);
    }
  });

  it('所有可选密钥应在 .env.example 中定义', () => {
    const envExample = fs.readFileSync(
      path.join(ROOT_DIR, '.env.example'),
      'utf-8',
    );
    for (const secret of OPTIONAL_SECRETS) {
      expect(envExample, `${secret} should be in .env.example`).toContain(secret);
    }
  });

  it('ANTHROPIC_API_KEY 不应出现在 fly.toml 中', () => {
    const flyToml = fs.readFileSync(
      path.join(ROOT_DIR, 'fly.toml'),
      'utf-8',
    );
    expect(flyToml).not.toContain('ANTHROPIC_API_KEY');
  });

  it('部署文档应提及 fly secrets set', () => {
    const deployDoc = fs.readFileSync(
      path.join(ROOT_DIR, 'docs/deployment.md'),
      'utf-8',
    );
    expect(deployDoc).toContain('fly secrets');
  });

  it('部署文档应提及所有必需密钥', () => {
    const deployDoc = fs.readFileSync(
      path.join(ROOT_DIR, 'docs/deployment.md'),
      'utf-8',
    );
    for (const secret of REQUIRED_SECRETS) {
      expect(deployDoc, `deployment.md should mention ${secret}`).toContain(secret);
    }
  });

  it('resolveAppName 应与 fly.toml 中的 app 名称一致', () => {
    const appName = resolveAppName();
    const flyToml = fs.readFileSync(
      path.join(ROOT_DIR, 'fly.toml'),
      'utf-8',
    );
    expect(flyToml).toContain(`app = "${appName}"`);
  });
});

// ============================================================================
// 安全性验证
// ============================================================================

describe('安全性验证', () => {
  it('fly-secrets.ts 不应包含硬编码的 API key', () => {
    const source = fs.readFileSync(
      path.join(ROOT_DIR, 'scripts/fly-secrets.ts'),
      'utf-8',
    );
    expect(source).not.toMatch(/sk-ant-/);
    expect(source).not.toMatch(/ANTHROPIC_API_KEY\s*=\s*["']sk-/);
  });

  it('buildSetCommand 不应泄露值到日志 (格式验证)', () => {
    const cmd = buildSetCommand('KEY', 'secret_value', 'app');
    // Command should contain the value (needed for execution)
    // but the format should be correct (KEY=value)
    expect(cmd).toMatch(/^fly secrets set KEY=secret_value --app app$/);
  });

  it('dry-run 消息不应包含实际密钥值', () => {
    const result = setSecret('KEY', 'super_secret', 'app', true);
    expect(result.message).not.toContain('super_secret');
  });
});
