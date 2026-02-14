# ServerPilot 版本功能矩阵

## 📦 开源本地版（Community Edition - CE）
**定位**：个人/小团队自托管，单机运维助手，**引流工具**
**架构**：Server + Agent + Dashboard 三合一部署
**目标用户**：开发者、小型团队、学习者

### ✅ 包含功能
- ✅ AI 对话（支持多种 AI Provider）
- ✅ 命令执行与审核
- ✅ 本机环境探测
- ✅ 操作历史记录
- ✅ 知识库 RAG（本地向量存储）
- ✅ 错误自动诊断
- ✅ 基础安全审计日志
- ✅ 用户个人设置
- ✅ 主题切换（深色/浅色）
- ✅ 多语言支持（中/英）
- ✅ 单个对话会话

### ❌ 不包含功能
- ❌ 多服务器管理
- ❌ 服务器列表/添加服务器
- ❌ 团队协作（多用户/角色/邀请）
- ❌ Webhook 通知
- ❌ 告警系统
- ❌ 实时指标监控（Metrics SSE）
- ❌ 审计日志导出（CSV）
- ❌ OAuth 登录（GitHub）
- ❌ API Rate Limiting
- ❌ 多租户（Tenant）
- ❌ 订阅计费

---

## ☁️ 云端全功能版（Cloud Edition - EE）
**定位**：企业级 SaaS 服务，多服务器集中管理
**架构**：Server + Dashboard 云端，Agent 分布式部署
**目标用户**：企业、DevOps 团队、MSP（托管服务提供商）

### ✅ 包含功能
**= 所有 CE 功能 +**

- ✅ 多服务器管理（添加/删除/分组）
- ✅ 分布式 Agent 管理
- ✅ 团队协作（RBAC：Owner/Admin/Member）
- ✅ 团队邀请系统
- ✅ Webhook 通知集成
- ✅ 告警规则与触发
- ✅ 实时指标监控（CPU/内存/磁盘）
- ✅ 审计日志导出（CSV/JSON）
- ✅ OAuth 第三方登录
- ✅ API Rate Limiting
- ✅ 多租户隔离
- ✅ 订阅计费（Stripe）
- ✅ PostgreSQL 数据库（高可用）
- ✅ Redis 会话管理
- ✅ S3 对象存储
- ✅ Kubernetes 部署

---

## 🔧 技术实现策略

### 1. 环境变量驱动
```bash
# .env.example
EDITION=ce          # ce = Community, ee = Enterprise
CLOUD_MODE=false    # true for cloud deployment

# CE 模式
EDITION=ce
CLOUD_MODE=false

# EE 模式
EDITION=ee
CLOUD_MODE=true
```

### 2. 后端 Feature Flag
```typescript
// packages/server/src/config/edition.ts
export const EDITION = {
  isCE: process.env.EDITION === 'ce',
  isEE: process.env.EDITION === 'ee',
  isCloud: process.env.CLOUD_MODE === 'true',
} as const;

export const FEATURES = {
  // CE 功能（always true）
  chat: true,
  commandExecution: true,
  knowledgeBase: true,

  // EE 专属功能（根据 EDITION 动态）
  multiServer: EDITION.isEE,
  teamCollaboration: EDITION.isEE,
  webhooks: EDITION.isEE,
  alerts: EDITION.isEE,
  metricsMonitoring: EDITION.isEE,
  auditExport: EDITION.isEE,
  oauthLogin: EDITION.isEE,
  rateLimiting: EDITION.isEE,
  multiTenant: EDITION.isEE && EDITION.isCloud,
  billing: EDITION.isEE && EDITION.isCloud,
} as const;
```

### 3. 前端 Feature Flag
```typescript
// packages/dashboard/src/config/features.ts
// 从后端 API 获取 edition 信息
export interface EditionInfo {
  edition: 'ce' | 'ee';
  features: Record<string, boolean>;
}

// GET /api/v1/system/edition
```

### 4. 条件渲染示例
```typescript
// Sidebar.tsx
{features.multiServer && (
  <NavItem to="/servers" icon={Server} label="服务器" />
)}

{features.teamCollaboration && (
  <NavItem to="/team" icon={Users} label="团队" />
)}

// Routes.tsx
{features.multiServer && <Route path="/servers" element={<Servers />} />}
```

---

## 📂 目录结构（无需分离）

```
ServerPilot/
├── packages/
│   ├── server/          # 包含所有功能，通过 FEATURES 控制
│   ├── agent/           # 两版本通用
│   ├── dashboard/       # 包含所有 UI，通过 features.* 控制显示
│   └── shared/          # 两版本通用
├── .env.ce.example      # CE 版本环境变量示例
├── .env.ee.example      # EE 版本环境变量示例
├── docker-compose.ce.yml    # CE 部署配置（SQLite）
├── docker-compose.ee.yml    # EE 部署配置（PostgreSQL + Redis）
└── EDITION_MATRIX.md    # 本文档
```

---

## 🚀 构建与发布策略

### NPM Packages（开源）
```bash
# 发布到 npm（仅 CE 版本）
pnpm publish --filter @aiinstaller/server  # 包含所有代码，但默认 EDITION=ce
pnpm publish --filter @aiinstaller/agent
pnpm publish --filter @aiinstaller/dashboard
```

### Docker Images（分开构建）
```bash
# CE 镜像（公开）
docker build -t aiinstaller/server:latest --build-arg EDITION=ce .
docker build -t aiinstaller/dashboard:latest --build-arg EDITION=ce .

# EE 镜像（私有）
docker build -t aiinstaller/server-ee:latest --build-arg EDITION=ee .
docker build -t aiinstaller/dashboard-ee:latest --build-arg EDITION=ee .
```

### GitHub Releases
- **main 分支**：开源代码（包含所有功能，但默认 CE 模式）
- **Tag v1.0.0-ce**：CE 版本发布
- **Tag v1.0.0-ee**：EE 版本发布（私有 registry）

---

## 🎁 开源策略（引流）

### README.md 明确说明
```markdown
## 版本对比

| 功能 | Community (CE) | Cloud (EE) |
|------|----------------|------------|
| AI 对话 | ✅ | ✅ |
| 本机运维 | ✅ | ✅ |
| 多服务器管理 | ❌ | ✅ |
| 团队协作 | ❌ | ✅ |
| 企业级监控 | ❌ | ✅ |

**💡 试用云端版**：[https://serverpilot.io](https://serverpilot.io)
享受 14 天免费试用，无需信用卡。
```

### License 策略
- **CE 版本**：AGPL-3.0（开源，网络使用需开源）
- **EE 版本**：Commercial License（需购买订阅）
- **Agent**：Apache-2.0（企业友好，可自由部署）
- **Shared**：MIT（最大兼容性）
- 详细说明见 [LICENSING.md](LICENSING.md)

---

## ✅ 实施步骤建议

1. **创建 Feature Flag 系统**（1 天）
   - `packages/server/src/config/edition.ts`
   - `packages/server/src/config/features.ts`
   - API: `GET /api/v1/system/edition`

2. **后端路由保护**（1 天）
   - Middleware: `requireFeature('multiServer')`
   - 在所有 EE 功能的路由上添加检查

3. **前端条件渲染**（2 天）
   - 创建 `useFeatures()` hook
   - 改造 Sidebar、Routes、Settings 等

4. **简化 CE 版 UI**（1 天）
   - 移除服务器管理相关页面
   - 直接跳转到 `/chat`
   - 简化 Settings

5. **文档与部署配置**（1 天）
   - 更新 README
   - 创建 `docker-compose.ce.yml` 和 `.ee.yml`
   - CI/CD 分别构建两种镜像

6. **测试**（1 天）
   - E2E 测试需要覆盖两种模式
   - 确保 feature flag 正确工作

---

## 🤔 FAQ

**Q: 为什么不分成两个代码库？**
A: 维护成本太高，bug 修复需要同步两次。GitLab、Sentry 都是单库多版本。

**Q: 开源版会不会被滥用？**
A: CE 版本功能有限（单机），企业需求必然需要 EE 版的多服务器管理。

**Q: 如何防止破解 EE 功能？**
A: Feature flag 在后端验证，前端只是隐藏 UI。需要 License Key 验证（下一步）。

**Q: 如何平滑升级 CE → EE？**
A: 数据库 schema 兼容，只需修改环境变量 `EDITION=ee` 即可。
