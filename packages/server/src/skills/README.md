# Skill 定时任务系统

## 概述

Skill 系统提供预定义的任务模板，让用户快速创建常用的定时任务，无需手写命令。

### 核心功能
1. **预定义模板**：disk-check（磁盘监控）、backup（数据备份）、log-cleanup（日志清理）
2. **AI 对话创建**：通过自然语言设置定时任务
3. **智能诊断**：任务失败时自动分析并提供修复建议
4. **知识增强**：集成 Context7 MCP 搜索技术文档

## 快速开始

### 1. 通过 API 创建 Skill 任务

#### 列出可用模板
```bash
curl http://localhost:3000/api/v1/tasks/templates \
  -H "Authorization: Bearer $TOKEN"
```

#### 从模板创建任务
```bash
curl -X POST http://localhost:3000/api/v1/tasks/from-template \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "skillName": "backup",
    "serverId": "server-uuid",
    "config": {
      "sourcePath": "/var/www",
      "backupDir": "/backup",
      "keepCount": 7,
      "compress": true
    },
    "schedule": "0 2 * * *"
  }'
```

### 2. 通过 AI 对话创建

```
User: 帮我设置一个每天备份 /var/www 的任务

AI: 好的！我推荐使用 backup skill。请提供:
    1. 备份保存目录?
    2. 保留几天的备份?

User: 保存到 /backup, 保留 7 天

AI: ✅ 任务创建成功！
    每天凌晨 2 点自动备份 /var/www 到 /backup
    保留最近 7 个备份文件
```

## 可用的 Skill 模板

目前提供 **5 个预定义 Skill 模板**：

| Skill | 功能 | 默认调度 |
|-------|------|----------|
| disk-check | 磁盘空间监控 | 每 30 分钟 |
| backup | 文件/数据库备份 | 每天凌晨 2 点 |
| log-cleanup | 日志自动清理 | 每天凌晨 3 点 |
| ssl-check | SSL 证书过期检查 | 每天 0 点 |
| service-health | 服务健康检查 | 每 5 分钟 |

### 1. disk-check（磁盘空间检查）

**功能**：定期检查磁盘使用率，超过阈值时发送告警

**配置参数**：
```typescript
{
  threshold: number;        // 告警阈值(百分比, 0-100), 默认 80
  mountPoints?: string[];   // 检查的挂载点（可选）
  webhookEnabled: boolean;  // 是否启用 Webhook 通知, 默认 true
}
```

**默认调度**：每 30 分钟执行一次

**示例**：
```json
{
  "skillName": "disk-check",
  "serverId": "xxx",
  "config": {
    "threshold": 85,
    "mountPoints": ["/", "/data"],
    "webhookEnabled": true
  }
}
```

### 2. backup（数据备份）

**功能**：自动备份文件或数据库，支持压缩和清理旧备份

**配置参数**：
```typescript
{
  sourcePath: string;          // 备份源路径
  backupDir: string;           // 备份目标目录
  keepCount: number;           // 保留最近 N 个备份, 默认 7
  compress: boolean;           // 是否压缩, 默认 true
  dbType?: 'mysql' | 'postgresql' | 'mongodb';  // 数据库类型（可选）
  dbName?: string;             // 数据库名称
  webhookEnabled: boolean;     // Webhook 通知, 默认 true
}
```

**默认调度**：每天凌晨 2 点执行

**文件备份示例**：
```json
{
  "skillName": "backup",
  "serverId": "xxx",
  "config": {
    "sourcePath": "/var/www",
    "backupDir": "/backup",
    "keepCount": 7,
    "compress": true
  }
}
```

**数据库备份示例**：
```json
{
  "skillName": "backup",
  "serverId": "xxx",
  "config": {
    "dbType": "mysql",
    "dbName": "myapp_db",
    "backupDir": "/backup/mysql",
    "keepCount": 14,
    "compress": true
  }
}
```

### 3. log-cleanup（日志清理）

**功能**：自动清理过期日志文件，释放磁盘空间

**配置参数**：
```typescript
{
  logPath: string;             // 日志目录路径
  retentionDays: number;       // 保留最近 N 天的日志, 默认 30
  pattern?: string;            // 文件匹配模式, 默认 '*.log*'
  compressOld?: boolean;       // 是否压缩旧日志, 默认 false
  compressAfterDays?: number;  // 压缩前保留天数, 默认 7
  webhookEnabled: boolean;     // Webhook 通知, 默认 true
}
```

**默认调度**：每天凌晨 3 点执行

**示例**：
```json
{
  "skillName": "log-cleanup",
  "serverId": "xxx",
  "config": {
    "logPath": "/var/log/nginx",
    "retentionDays": 30,
    "pattern": "*.log*",
    "compressOld": true,
    "compressAfterDays": 7
  }
}
```

### 4. ssl-check（SSL 证书检查）

**功能**：定期检查 SSL 证书有效期，临近过期时发送告警

**配置参数**：
```typescript
{
  domains: string[];           // 要检查的域名列表
  daysBeforeExpiry: number;    // 提前告警天数, 默认 30
  webhookEnabled: boolean;     // Webhook 通知, 默认 true
}
```

**默认调度**：每天 0 点执行

**示例**：
```json
{
  "skillName": "ssl-check",
  "serverId": "xxx",
  "config": {
    "domains": ["example.com", "api.example.com"],
    "daysBeforeExpiry": 30,
    "webhookEnabled": true
  }
}
```

### 5. service-health（服务健康检查）

**功能**：定期检查关键服务状态，自动重启异常服务

**配置参数**：
```typescript
{
  services: string[];              // 要监控的服务列表
  autoRestart: boolean;            // 是否自动重启失败的服务, 默认 true
  alertOnRestartFailure: boolean;  // 重启失败后是否发送告警, 默认 true
  webhookEnabled: boolean;         // Webhook 通知, 默认 true
}
```

**默认调度**：每 5 分钟执行一次

**示例**：
```json
{
  "skillName": "service-health",
  "serverId": "xxx",
  "config": {
    "services": ["nginx", "mysql", "redis"],
    "autoRestart": true,
    "alertOnRestartFailure": true,
    "webhookEnabled": true
  }
}
```

## 架构说明

### 文件结构
```
packages/server/src/skills/
├── builtin/
│   ├── disk-check.ts       # 磁盘检查 Skill
│   ├── backup.ts           # 备份 Skill
│   ├── log-cleanup.ts      # 日志清理 Skill
│   ├── ssl-check.ts        # SSL 证书检查 Skill
│   └── service-health.ts   # 服务健康检查 Skill
├── skill-registry.ts       # Skill 注册中心
├── skill-task-converter.ts # Skill → Task 转换
├── skill-dispatcher.ts     # Skill 推送到 Agent
├── chat-integration.ts     # Chat AI 集成工具
├── INTEGRATION_DESIGN.md   # 集成设计文档
└── README.md               # 本文件
```

### 与现有系统集成

#### 1. Task Scheduler
- Skill 模板生成的命令由 Task Scheduler 自动调度
- 使用现有的 cron 表达式和定时执行逻辑

#### 2. Chat AI
- 通过 `chat-integration.ts` 提供的工具函数
- AI 可以推荐、验证、创建 Skill 任务

#### 3. Context7 MCP（Cloud 包）
- Skill 失败时搜索相关文档
- 为用户提供智能诊断和修复建议

## 开发指南

### 添加新的 Skill 模板

1. 在 `builtin/` 目录下创建新文件：

```typescript
// builtin/my-skill.ts
export interface MySkillConfig {
  // 配置参数定义
}

export function generateMySkillCommands(config: MySkillConfig): string[] {
  // 生成执行命令
  return ['command1', 'command2'];
}

export function parseMySkillResult(stdout: string) {
  // 解析执行结果（可选）
  return { success: true };
}

export const MY_SKILL_TEMPLATE = {
  name: 'my-skill',
  description: 'My Skill 描述',
  defaultSchedule: '0 * * * *',
  executionMode: 'agent' as const,
  configSchema: {
    // 配置 Schema 定义
  },
  generateCommands: generateMySkillCommands,
  parseResult: parseMySkillResult,
};
```

2. 在 `skill-registry.ts` 中注册：

```typescript
import { MY_SKILL_TEMPLATE } from './builtin/my-skill.js';

private registerBuiltinSkills(): void {
  // ...
  this.register(MY_SKILL_TEMPLATE);
}
```

### 测试 Skill

```bash
# 运行 Skill 相关测试
pnpm --filter @aiinstaller/server test src/skills

# 端到端测试
pnpm --filter @aiinstaller/server test tasks.test.ts
```

## 常见问题

### Q: Skill 和现有的 Skills 系统有什么区别？

A:
- **Skill 模板**（本系统）：轻量级的任务模板，快速创建常用定时任务
- **Skills 系统**（packages/server/src/core/skill）：完整的技能安装、配置、管理系统

两者可以并存，Skill 模板适合简单场景，Skills 系统适合复杂场景。

### Q: 如何自定义 Skill 的 Cron 表达式？

A: 在创建任务时提供 `schedule` 参数即可覆盖默认值：

```json
{
  "skillName": "backup",
  "schedule": "0 3 * * *",  // 改为凌晨 3 点执行
  "config": { ... }
}
```

### Q: Skill 任务失败后会自动重试吗？

A: Task Scheduler 不会自动重试失败的任务，但会：
1. 记录失败状态
2. 触发自动诊断
3. 通过 Webhook 通知用户
4. 继续按计划执行下次任务

### Q: 如何在 AI 对话中使用 Skill？

A: 直接用自然语言描述需求即可：
```
"帮我设置一个每天备份数据库的任务"
"监控磁盘空间,超过 80% 发送告警"
"清理超过 30 天的 nginx 日志"
```

AI 会自动：
1. 识别合适的 Skill 模板
2. 询问必要的配置参数
3. 验证配置并创建任务
4. 确认任务创建成功

## 更多信息

- 集成设计详情：查看 [INTEGRATION_DESIGN.md](./INTEGRATION_DESIGN.md)
- API 文档：查看 `api/routes/tasks.ts`
- 示例代码：查看 `builtin/*.ts` 中的实现
