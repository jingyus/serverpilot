# Skill 模块开发上下文

> AI 开发 Skill 模块时的精简参考文档。完整规范见 `skills/SKILL_SPEC.md`。

## 1. 项目结构 & 技术栈

```
ServerPilot/                     # Monorepo (pnpm workspaces)
├── packages/
│   ├── server/                  # Hono + better-sqlite3 + Drizzle ORM
│   ├── dashboard/               # React 18 + Vite 5 + Zustand 5 + Tailwind
│   ├── shared/                  # Zod schemas (单一真相源)
│   └── agent/                   # 远程 Agent (不要修改)
├── skills/                      # Skill 标准 + 官方示例
│   ├── SKILL_SPEC.md            # 完整规范
│   └── official/                # 3 个示例: log-auditor, intrusion-detector, auto-backup
└── scripts/
    └── SKILL_DEV_CONTEXT.md     # 本文件
```

**包名**: `@aiinstaller/*` (server, agent, shared, dashboard)
**Node**: 22+, TypeScript strict, `NodeNext` module resolution (server)
**测试**: Vitest (server=node, dashboard=jsdom)

## 2. Skill 模块目标架构

```
packages/server/src/
├── core/skill/                  # 🎯 核心引擎 (要开发)
│   ├── engine.ts                # SkillEngine — 加载/验证/执行 Skill
│   ├── loader.ts                # YAML 解析 + skill-schema 验证
│   ├── runner.ts                # AI 执行层 — prompt → AI → tools → 结果
│   ├── trigger-manager.ts       # 触发调度 — cron/event/threshold/manual
│   └── store.ts                 # Skill KV 存储
│
├── api/routes/skills.ts         # 🎯 REST API (要开发)
├── db/repositories/
│   └── skill-repository.ts      # 🎯 数据持久化 (要开发)
│
└── (已有模块，只读参考)
    ├── core/task/executor.ts    # 命令执行 — getTaskExecutor()
    ├── core/webhook/dispatcher.ts # 事件分发 — getWebhookDispatcher()
    ├── ai/agentic-chat.ts       # AI 自主循环参考
    ├── core/security/           # 审计日志 — getAuditLogger()
    └── index.ts                 # 服务启动注册

packages/shared/src/
└── skill-schema.ts              # ✅ 已完成 — SkillManifestSchema

packages/dashboard/src/
├── pages/Skills.tsx             # 🎯 管理页面 (要开发)
├── stores/skills.ts             # 🎯 状态管理 (要开发)
├── types/skill.ts               # 🎯 前端类型 (要开发)
└── components/skill/            # 🎯 UI 组件 (要开发)
```

## 3. 必须遵循的代码模式

### 单例模式 (所有 core 服务统一模式)

```typescript
// core/skill/engine.ts
import { createContextLogger } from '../../utils/logger.js';

const logger = createContextLogger({ module: 'skill-engine' });

let _instance: SkillEngine | null = null;

export function getSkillEngine(server?: InstallServer): SkillEngine {
  if (!_instance) {
    if (!server) throw new Error('SkillEngine not initialized');
    _instance = new SkillEngine(server);
  }
  return _instance;
}

export function setSkillEngine(instance: SkillEngine): void {
  _instance = instance;
}

export function _resetSkillEngine(): void {
  if (_instance) _instance.stop();
  _instance = null;
}
```

### 仓库模式 (数据访问层)

```typescript
// db/repositories/skill-repository.ts
export interface SkillRepository {
  findAll(userId: string): Promise<InstalledSkill[]>;
  findById(id: string): Promise<InstalledSkill | null>;
  install(input: InstallSkillInput): Promise<InstalledSkill>;
  updateStatus(id: string, status: SkillStatus): Promise<void>;
  uninstall(id: string): Promise<void>;
}

// Drizzle 实现
export class DrizzleSkillRepository implements SkillRepository { ... }

// 测试用 InMemory 实现
export class InMemorySkillRepository implements SkillRepository { ... }

// 单例
let _instance: SkillRepository | null = null;
export function getSkillRepository(): SkillRepository { ... }
export function setSkillRepository(repo: SkillRepository): void { ... }
export function _resetSkillRepository(): void { ... }
```

### API 路由模式 (Hono + 中间件链)

```typescript
// api/routes/skills.ts
import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth.js';
import { resolveRole, requirePermission } from '../middleware/rbac.js';

const router = new Hono();

router.get('/',
  requireAuth,
  resolveRole,
  requirePermission('skill:manage'),
  async (c) => { ... }
);

router.post('/:id/execute',
  requireAuth,
  resolveRole,
  requirePermission('skill:execute'),
  async (c) => { ... }
);

export default router;
```

### 启动注册 (index.ts 中的初始化)

```typescript
// 在 createServer() 函数中，跟随已有服务注册:
getSkillEngine(server);

// 在 startServer() 函数中，跟随已有后台服务启动:
getSkillEngine().start();  // 启动 TriggerManager 定时器
```

### Dashboard 模式 (Zustand store)

```typescript
// stores/skills.ts
import { create } from 'zustand';
import { apiRequest } from '../api/client';

interface SkillStore {
  skills: InstalledSkill[];
  loading: boolean;
  fetchSkills: () => Promise<void>;
  executeSkill: (id: string) => Promise<void>;
}

export const useSkillStore = create<SkillStore>((set, get) => ({
  skills: [],
  loading: false,
  fetchSkills: async () => { ... },
  executeSkill: async (id) => { ... },
}));
```

## 4. Skill 执行流程 (核心设计)

```
触发 (manual/cron/event/threshold)
  │
  ├── SkillEngine.execute(skillId, serverId, userId)
  │     ├── loader.load(skillDir) → 解析 YAML + 验证 Schema
  │     ├── 检查 requires (OS, 命令依赖, Agent 版本)
  │     ├── 解析 prompt (注入 {{input.*}}, {{server.*}} 变量)
  │     │
  │     ├── SkillRunner.run(parsedPrompt, tools, constraints)
  │     │     ├── 构建 AI messages (system + skill prompt + user trigger)
  │     │     ├── AI Agentic Loop (类似 agentic-chat.ts):
  │     │     │     ├── AI 决定调用工具
  │     │     │     ├── 工具调用安全检查:
  │     │     │     │     ├── classifyCommand() 风险分级
  │     │     │     │     ├── risk_level > constraints.risk_level_max → 拒绝
  │     │     │     │     ├── risk_level == forbidden → 永远拒绝
  │     │     │     │     └── 通过 → getTaskExecutor() 发送到 Agent
  │     │     │     ├── 收集结果 → 返回给 AI
  │     │     │     └── 重复直到完成或达到 max_steps/timeout
  │     │     └── 返回 SkillExecutionResult
  │     │
  │     ├── 记录执行结果到 DB
  │     ├── 触发 webhook: skill.completed 事件
  │     └── 返回结果
  │
  └── SSE 推送实时进度到 Dashboard (可选)
```

## 5. DB Schema 设计参考

```typescript
// 需要添加到 db/schema.ts 的表

// 已安装的 Skills
export const installedSkills = sqliteTable('installed_skills', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  tenantId: text('tenant_id'),
  name: text('name').notNull(),           // metadata.name
  displayName: text('display_name'),
  version: text('version').notNull(),
  source: text('source').notNull(),        // 'official' | 'community' | 'local'
  skillPath: text('skill_path').notNull(), // 磁盘路径
  status: text('status').notNull(),        // installed|configured|enabled|paused|error
  config: text('config'),                  // JSON: 用户配置的 inputs 值
  createdAt: integer('created_at', { mode: 'timestamp' }),
  updatedAt: integer('updated_at', { mode: 'timestamp' }),
});

// Skill 执行记录
export const skillExecutions = sqliteTable('skill_executions', {
  id: text('id').primaryKey(),
  skillId: text('skill_id').notNull(),
  serverId: text('server_id').notNull(),
  userId: text('user_id').notNull(),
  triggerType: text('trigger_type').notNull(),  // manual|cron|event|threshold
  status: text('status').notNull(),              // running|success|failed|timeout
  startedAt: integer('started_at', { mode: 'timestamp' }),
  completedAt: integer('completed_at', { mode: 'timestamp' }),
  result: text('result'),                        // JSON: AI 输出的结构化结果
  stepsExecuted: integer('steps_executed'),
  duration: integer('duration'),                 // ms
});

// Skill KV Store (per-skill 持久化存储)
export const skillStore = sqliteTable('skill_store', {
  id: text('id').primaryKey(),
  skillId: text('skill_id').notNull(),
  key: text('key').notNull(),
  value: text('value'),
  updatedAt: integer('updated_at', { mode: 'timestamp' }),
});
```

## 6. RBAC 权限 (需要添加到 shared/src/rbac.ts)

```typescript
// 在 PERMISSIONS 对象中添加:
'skill:manage'    // 安装/卸载/配置 Skill (admin+owner)
'skill:execute'   // 手动执行 Skill (member+admin+owner)
'skill:view'      // 查看 Skill 列表和执行历史 (all roles)
```

## 7. API 端点设计

```
GET    /api/v1/skills                    # 列表 (已安装)
POST   /api/v1/skills/install            # 安装 Skill
DELETE /api/v1/skills/:id                # 卸载
PUT    /api/v1/skills/:id/config         # 配置 inputs
PUT    /api/v1/skills/:id/status         # 启用/暂停
POST   /api/v1/skills/:id/execute        # 手动执行
GET    /api/v1/skills/:id/executions     # 执行历史
GET    /api/v1/skills/:id/executions/:eid # 执行详情
GET    /api/v1/skills/available          # 可安装的 Skill 列表 (official + community)
```

## 8. 关键约束

- **低耦合**: 通过 getter 函数访问其他服务，不直接 import 实例
- **不修改已有模块**: core/task/, core/webhook/, ai/ 等只读引用
- **文件限制**: 单文件 ≤ 500 行 (硬限制 800)
- **TypeScript strict**: 不允许 any, 使用 Zod 验证所有外部输入
- **ESM**: 所有 import 使用 `.js` 后缀 (`import { x } from './y.js'`)
- **测试**: 每个核心模块必须有对应的 `.test.ts` 文件
- **RBAC**: 所有 API 端点必须有权限检查
- **审计**: 所有 Skill 执行的命令必须记录到 audit_log
