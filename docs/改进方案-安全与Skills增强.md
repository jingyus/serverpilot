# ServerPilot 改进方案：安全与 Skills 增强

> **版本**: v1.0 | **日期**: 2026-02-20
> **目标**: 解决安全性平衡、Agent Skills 调用、定时任务、MCP 集成等核心问题

---

## 📋 问题清单

### 1. 安全性问题
- ❌ **问题**: 5 层安全防御虽然完善,但真正需要 `rm`/`dd` 等危险命令时无法使用
- ✅ **解决方案**: 增加"授权审批"机制

### 2. Agent 功能缺失
- ❌ **问题**: Agent 无法调用 Skills（目前只有被动接收命令）
- ❌ **问题**: 无法执行定时任务
- ✅ **解决方案**: Agent Daemon 模式增强 + Skills 调度集成

### 3. Context7（MCP）集成
- ❌ **问题**: 项目未集成 MCP Server Protocol
- ✅ **解决方案**: 云版本添加 MCP 客户端（开源版不包含）

### 4. Skills 实用功能缺失
- ❌ **问题**: 虽有 log-scanner、security-scanner，但缺少备份等核心功能
- ❌ **问题**: Skills 都在 Cloud 包，开源版无法使用
- ✅ **解决方案**: 分离为开源版基础 Skills + 云版高级 Skills

---

## 🎯 解决方案详细设计

### 方案 1: 安全审批机制 — 危险命令白名单授权

#### 1.1 设计思路

```
用户请求危险命令
  ↓
Server 识别风险级别（RED/CRITICAL）
  ↓
推送审批请求到 Dashboard
  ↓
用户在 Dashboard 批准/拒绝
  ↓
Server 根据决策执行/拒绝
  ↓
Agent 执行（或抛出"用户拒绝"错误）
```

#### 1.2 技术架构

**新增数据表**: `command_approvals`

```sql
CREATE TABLE command_approvals (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  server_id TEXT NOT NULL,
  command TEXT NOT NULL,
  risk_level TEXT NOT NULL,  -- 'red' | 'critical' | 'forbidden'
  status TEXT NOT NULL,       -- 'pending' | 'approved' | 'rejected' | 'expired'
  reason TEXT,                -- 风险原因
  requested_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL, -- 5 分钟超时
  decided_at INTEGER,
  decided_by TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id),
  FOREIGN KEY(server_id) REFERENCES servers(id)
);
```

**API 端点**:

```typescript
// Server 端
POST /api/v1/approvals              // 请求审批
GET  /api/v1/approvals?status=pending // 获取待审批列表
POST /api/v1/approvals/:id/approve  // 批准
POST /api/v1/approvals/:id/reject   // 拒绝

// Dashboard 实时通知
GET  /api/v1/approvals/stream       // SSE 推送待审批事件
```

**执行流程**:

1. **AI Chat → 计划生成**: 识别风险命令，标记 `requiresApproval: true`
2. **执行前拦截**: `TaskExecutor` 发现需审批命令 → 创建审批记录 → SSE 推送通知
3. **Dashboard 弹窗**: 用户看到命令详情、风险说明、快速批准/拒绝按钮
4. **批准后继续**: Agent 收到命令继续执行；拒绝则标记任务失败

#### 1.3 用户配置

**Dashboard → Settings → Security**:

```typescript
{
  autoApprove: {
    enabled: boolean;
    whitelistCommands: string[];    // 用户信任的危险命令（正则）
    riskLevels: ('red' | 'critical')[]; // 自动批准的风险级别
  }
}
```

**示例配置**:

```json
{
  "autoApprove": {
    "enabled": true,
    "whitelistCommands": [
      "^rm -rf /tmp/.*",
      "^docker system prune -f$"
    ],
    "riskLevels": ["red"]  // CRITICAL 仍需手动批准
  }
}
```

#### 1.4 实现优先级

- **P0**: 基础审批 API + Dashboard 审批弹窗（1-2 天）
- **P1**: SSE 实时推送 + 超时自动过期（1 天）
- **P2**: 白名单配置 + 自动批准（1 天）

---

### 方案 2: Agent Skills 调用系统

#### 2.1 Agent Daemon 模式增强

**当前 Agent 能力**:
- ✅ 环境检测、指标上报
- ❌ 无法主动调用 Skills
- ❌ 无法执行定时任务

**新增能力**:

```typescript
// packages/agent/src/skill-client.ts

export class SkillClient {
  constructor(private client: AuthenticatedClient) {}

  /**
   * 执行 Skill（由 Server 推送触发）
   */
  async executeSkill(skillId: string, params: Record<string, unknown>): Promise<SkillResult> {
    const { commands, env } = await this.fetchSkillDefinition(skillId);
    const results = [];

    for (const cmd of commands) {
      const result = await this.executor.execute(cmd, { env, dryRun: false });
      results.push(result);

      // 实时上报执行进度
      this.client.send(createMessage('skill.progress', {
        skillId,
        step: cmd,
        status: result.success ? 'success' : 'failed'
      }));
    }

    return { success: results.every(r => r.success), results };
  }
}
```

**Server 推送 Skill 执行**:

```typescript
// packages/server/src/core/skill/agent-dispatcher.ts

export class SkillAgentDispatcher {
  /**
   * 推送 Skill 到 Agent 执行（适用于远程 Skill）
   */
  async dispatchToAgent(serverId: string, skill: SkillDefinition): Promise<void> {
    const session = this.wsServer.getSession(serverId);
    if (!session) throw new Error('Agent offline');

    session.send({
      type: 'skill.execute',
      payload: {
        skillId: skill.id,
        commands: skill.commands,
        env: skill.env,
        timeout: skill.timeout
      }
    });
  }
}
```

#### 2.2 定时任务集成

**Cron 触发流程**:

```
TriggerManager (Server)
  ↓ (定时检查)
识别到期 Skill
  ↓
根据 Skill.executionMode 选择执行方式
  ├─ 'server': SkillRunner 本地执行（SSH）
  └─ 'agent': SkillAgentDispatcher 推送到 Agent
       ↓
Agent 收到 skill.execute 消息
  ↓
SkillClient.executeSkill()
  ↓
上报执行结果
```

**Skill 定义新增字段**:

```typescript
{
  executionMode: 'server' | 'agent';  // 执行位置
  targetServerId?: string;            // Agent 模式必填
}
```

#### 2.3 实现优先级

- **P0**: Agent SkillClient 基础框架（2 天）
- **P1**: Server 推送 Skill 到 Agent（1 天）
- **P1**: Cron 触发 Agent 执行（1 天）

---

### 方案 3: Context7（MCP）集成 — 仅云版本

#### 3.1 什么是 MCP（Model Context Protocol）

MCP 是 Anthropic 提出的标准协议，让 AI 模型能够访问外部工具和数据源：

```
AI 对话
  ↓
MCP Client (ServerPilot Cloud)
  ↓
MCP Server (Context7 / GitHub / Jira / ...)
  ↓
返回上下文数据 → 注入到 AI Prompt
```

**常见 MCP Servers**:
- **Context7**: 文档搜索（官方文档、StackOverflow、GitHub）
- **GitHub MCP**: 代码仓库、Issue、PR
- **Jira MCP**: 工单管理
- **Database MCP**: SQL 查询

#### 3.2 架构设计

**仅云版本 (`packages/cloud/`) 包含 MCP 客户端**:

```typescript
// packages/cloud/src/mcp/client.ts

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

export class MCPClientManager {
  private clients = new Map<string, Client>();

  /**
   * 连接到 MCP Server（Context7 示例）
   */
  async connectContext7(apiKey: string): Promise<void> {
    const transport = new StdioClientTransport({
      command: 'npx',
      args: ['-y', '@context7/mcp-server', apiKey]
    });

    const client = new Client({ name: 'serverpilot-cloud', version: '1.0' }, {
      capabilities: {}
    });

    await client.connect(transport);
    this.clients.set('context7', client);
  }

  /**
   * 搜索文档（调用 Context7 的 search tool）
   */
  async searchDocs(query: string, sources?: string[]): Promise<string[]> {
    const client = this.clients.get('context7');
    if (!client) throw new Error('Context7 not connected');

    const result = await client.callTool({
      name: 'search',
      arguments: { query, sources }
    });

    return result.content.map(c => c.text);
  }
}
```

**集成到 AI 对话流**:

```typescript
// packages/cloud/src/ai/cloud-chat-agent.ts

export class CloudChatAgent {
  async chat(message: string): Promise<string> {
    // 1. 用户消息解析
    const intent = this.detectIntent(message);

    // 2. 如果涉及文档查询，先调用 Context7
    let contextDocs = '';
    if (intent.needsDocs) {
      const mcpClient = getMCPClientManager();
      const docs = await mcpClient.searchDocs(message, ['nginx', 'docker']);
      contextDocs = docs.join('\n\n');
    }

    // 3. 构建增强 Prompt
    const systemPrompt = `${BASE_SYSTEM_PROMPT}

## 相关文档参考

${contextDocs}

请根据以上文档信息回答用户问题。`;

    // 4. 调用 AI Provider
    return this.provider.chat({ messages: [...], system: systemPrompt });
  }
}
```

#### 3.3 用户配置

**Cloud Dashboard → Settings → AI Enhancements**:

```typescript
{
  mcp: {
    enabled: boolean;
    servers: {
      context7: { apiKey: string };
      github: { token: string };
    }
  }
}
```

#### 3.4 实现优先级

- **P1**: MCP Client 基础框架（2 天）
- **P1**: Context7 集成 + 文档搜索（1 天）
- **P2**: GitHub/Jira MCP 支持（按需）

---

### 方案 4: 实用 Skills 补全

#### 4.1 现有 Skills（云版本）

| Skill | 功能 | 位置 |
|-------|------|------|
| `log-scanner` | AI 日志巡检 | `packages/cloud/src/skills/log-scanner.ts` |
| `security-scanner` | AI 安全审计 | `packages/cloud/src/skills/security-scanner.ts` |

#### 4.2 新增基础 Skills（开源版）

**分离策略**:
- **开源版** (`packages/server/src/skills/`): 无需 AI 的基础运维功能
- **云版本** (`packages/cloud/src/skills/`): AI 驱动的高级功能

**新增开源版 Skills**:

##### Skill 1: 自动备份 (`backup.ts`)

```typescript
export interface BackupSkill {
  name: 'backup';
  schedule: string;  // '0 2 * * *' 每天凌晨 2 点
  commands: [
    'tar -czf /backup/db-$(date +%Y%m%d).tar.gz /var/lib/mysql',
    'find /backup -name "db-*.tar.gz" -mtime +7 -delete'  // 删除 7 天前备份
  ];
}
```

**功能**:
- 数据库备份（MySQL/PostgreSQL/MongoDB）
- 配置文件备份（nginx/apache）
- 代码仓库备份
- 自动清理旧备份

##### Skill 2: 日志清理 (`log-cleanup.ts`)

```typescript
export interface LogCleanupSkill {
  name: 'log-cleanup';
  schedule: string;  // '0 3 * * 0' 每周日凌晨 3 点
  commands: [
    'find /var/log -name "*.log" -mtime +30 -exec gzip {} \\;',
    'find /var/log -name "*.gz" -mtime +90 -delete'
  ];
}
```

##### Skill 3: 磁盘空间检查 (`disk-check.ts`)

```typescript
export interface DiskCheckSkill {
  name: 'disk-check';
  schedule: string;  // '*/30 * * * *' 每 30 分钟
  commands: [
    'df -h | awk \'$5 >= 80 {print "WARN: " $1 " usage " $5}\''
  ];
  alert: {
    threshold: 80;
    webhook: true;
  };
}
```

##### Skill 4: SSL 证书检查 (`ssl-check.ts`)

```typescript
export interface SSLCheckSkill {
  name: 'ssl-check';
  schedule: string;  // '0 0 * * *' 每天检查
  commands: [
    'echo | openssl s_client -connect example.com:443 2>/dev/null | openssl x509 -noout -dates'
  ];
  alert: {
    daysBeforeExpiry: 30;
  };
}
```

##### Skill 5: 服务健康检查 (`service-health.ts`)

```typescript
export interface ServiceHealthSkill {
  name: 'service-health';
  schedule: string;  // '*/5 * * * *' 每 5 分钟
  commands: [
    'systemctl is-active nginx || systemctl restart nginx',
    'systemctl is-active mysql || systemctl restart mysql'
  ];
}
```

#### 4.3 高级 Skills（云版本）

**保持现有**:
- `log-scanner`: AI 日志分析
- `security-scanner`: AI 安全审计

**新增**:
- `performance-optimizer`: AI 性能调优建议
- `cost-analyzer`: 云资源成本分析

#### 4.4 实现优先级

- **P0**: 自动备份 Skill（1 天）
- **P0**: 磁盘空间检查 Skill（0.5 天）
- **P1**: 日志清理 Skill（0.5 天）
- **P1**: SSL 证书检查 Skill（0.5 天）
- **P2**: 服务健康检查 Skill（0.5 天）

---

## 📦 模块组织

### 开源版 (`packages/server/src/skills/`)

```
skills/
├── builtin/
│   ├── backup.ts              # 数据库/文件备份
│   ├── log-cleanup.ts         # 日志清理
│   ├── disk-check.ts          # 磁盘监控
│   ├── ssl-check.ts           # SSL 证书检查
│   └── service-health.ts      # 服务健康检查
├── registry.ts                # Skill 注册表
└── index.ts                   # 统一导出
```

### 云版本 (`packages/cloud/src/skills/`)

```
skills/
├── log-scanner.ts             # AI 日志巡检（已有）
├── security-scanner.ts        # AI 安全审计（已有）
├── performance-optimizer.ts   # AI 性能调优（新增）
└── cost-analyzer.ts           # 云成本分析（新增）
```

---

## 🚀 实施计划

### Week 1: 安全审批 + Agent Skills 基础

| 任务 | 工时 | 优先级 |
|------|------|--------|
| 命令审批数据表 + API | 1 天 | P0 |
| Dashboard 审批弹窗 | 1 天 | P0 |
| Agent SkillClient 框架 | 2 天 | P0 |
| Server → Agent Skill 推送 | 1 天 | P1 |

### Week 2: Skills 补全 + MCP 集成

| 任务 | 工时 | 优先级 |
|------|------|--------|
| 自动备份 Skill | 1 天 | P0 |
| 磁盘/SSL/日志清理 Skills | 1.5 天 | P1 |
| MCP Client 框架（云版本） | 2 天 | P1 |
| Context7 集成 + 测试 | 1.5 天 | P1 |

### Week 3: 集成测试 + 文档

| 任务 | 工时 | 优先级 |
|------|------|--------|
| E2E 测试（审批流程） | 1 天 | P0 |
| E2E 测试（Agent Skills） | 1 天 | P0 |
| Skills 使用文档 | 1 天 | P1 |
| MCP 配置文档（云版本） | 1 天 | P2 |

---

## 📊 预期效果

### 安全性平衡

✅ **解决问题**:
- 用户可以使用危险命令（需审批）
- 白名单自动批准常用命令
- 仍保留 FORBIDDEN 级别的绝对禁止

✅ **用户体验**:
```
用户: "清理 /tmp 下的旧文件"
AI: 生成 `rm -rf /tmp/old_*`
Dashboard: 🔔 危险命令需审批（弹窗）
用户: 点击"批准" → 立即执行
```

### Agent 功能增强

✅ **解决问题**:
- Agent 可以执行定时任务
- Agent 可以调用 Skills
- Server 可以推送 Skill 到 Agent

✅ **用户体验**:
```
Dashboard: 启用"每日数据库备份" Skill
Server: 每天凌晨 2 点推送备份命令到 Agent
Agent: 执行备份 → 上报结果
Dashboard: 显示备份历史 + 成功/失败状态
```

### MCP 集成（云版本）

✅ **解决问题**:
- AI 对话可以访问外部文档（Context7）
- 比知识库更省事（不需要手动上传）

✅ **用户体验**:
```
用户: "nginx 反向代理如何配置 WebSocket？"
Cloud: 调用 Context7 搜索 nginx 官方文档
AI: 根据最新文档生成配置 + 解释
```

### Skills 实用性

✅ **解决问题**:
- 开源版有基础运维 Skills
- 云版本有 AI 驱动的高级 Skills
- 定时任务自动化运维

✅ **用户体验**:
```
开源版:
- 自动备份数据库
- 自动清理日志
- 磁盘空间告警
- SSL 证书到期提醒

云版本（额外）:
- AI 日志异常分析
- AI 安全漏洞扫描
- AI 性能调优建议
```

---

## ✅ 待办事项

添加到 `TODO.md`:

```markdown
## Phase 5: 安全与 Skills 增强 (v0.5)

| 任务 | 优先级 | 状态 | 说明 |
|------|--------|------|------|
| 命令审批机制 | P0 | ⬜ 待开发 | 危险命令白名单授权 |
| Agent Skills 调用 | P0 | ⬜ 待开发 | Agent Daemon 模式增强 |
| 基础 Skills 补全 | P0 | ⬜ 待开发 | 备份/磁盘/SSL/日志清理 |
| MCP 客户端（云版本） | P1 | ⬜ 待开发 | Context7 集成 |
| Skill 执行模式选择 | P1 | ⬜ 待开发 | Server/Agent 双模式 |
```

---

## 📚 参考资料

- [MCP 官方文档](https://modelcontextprotocol.io/)
- [Context7 MCP Server](https://github.com/context7/mcp-server)
- [Anthropic MCP SDK](https://github.com/anthropics/anthropic-sdk-typescript)
- [Cron Expression Parser](https://www.npmjs.com/package/cron-parser)

---

*最后更新: 2026-02-20*
