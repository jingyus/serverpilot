# ServerPilot 部署模式与功能矩阵

## 🏠 Self-Hosted（自部署开源版）
**定位**：100% 开源，功能完整，自主可控
**架构**：Server + Dashboard + Agent 本地部署
**目标用户**：开发者、小型团队、企业内部部署、对数据敏感的用户
**许可证**：AGPL-3.0（Server/Dashboard）+ Apache-2.0（Agent）+ MIT（Shared）

### ✅ 包含功能（完整功能，无限制）

#### 🤖 核心 AI 功能
- ✅ AI 对话运维（支持 Claude / OpenAI / DeepSeek / Ollama / Custom OpenAI 兼容）
- ✅ 命令生成与执行
- ✅ 知识库 RAG（本地向量存储）
- ✅ 错误自动诊断与修复建议
- ✅ 服务器环境档案（AI 上下文注入）

#### 🖥️ 服务器管理
- ✅ **多服务器管理**（无限制）
- ✅ 服务器列表 / 添加 / 删除 / 分组
- ✅ 分布式 Agent 管理
- ✅ 实时指标监控（CPU / 内存 / 磁盘 / 网络）
- ✅ 服务器在线状态检测

#### 👥 团队协作
- ✅ **多用户协作**（无限制）
- ✅ RBAC 权限系统（Owner / Admin / Member）
- ✅ 团队邀请系统
- ✅ 成员管理

#### 🔔 通知与告警
- ✅ Webhook 通知集成
- ✅ 告警规则与触发
- ✅ 事件推送（任务完成 / 服务器离线 / 操作失败）

#### 📊 监控与审计
- ✅ 实时指标监控（SSE 推送）
- ✅ 操作历史记录
- ✅ 安全审计日志（五级命令分类）
- ✅ 审计日志导出（CSV）

#### 🔐 安全与认证
- ✅ OAuth 第三方登录（GitHub，需自己配置 OAuth App）
- ✅ API Rate Limiting
- ✅ 五层安全防护（命令分级 / 参数审计 / 快照 / 紧急终止 / 审计）

#### 🎨 界面与体验
- ✅ 多会话管理
- ✅ 主题切换（深色 / 浅色）
- ✅ 多语言支持（中文 / 英文）
- ✅ 响应式设计

#### 🛠️ 其他
- ✅ 完整 REST API
- ✅ WebSocket / SSE 实时通信
- ✅ SQLite 数据库（适合中小规模）
- ✅ Docker / Docker Compose 部署

### ❌ 需要自己配置的
- ⚙️ AI Provider API Key（需自己申请 Anthropic / OpenAI 等 API Key）
- ⚙️ OAuth 配置（需自己在 GitHub 创建 OAuth App）
- ⚙️ 服务器运维（备份、更新、监控、安全）
- ⚙️ 高可用性（如需要，自己搭建负载均衡 / 数据库集群）

---

## ☁️ Cloud（托管 SaaS 服务）
**定位**：免部署、免运维、企业级增强
**架构**：官方运营 serverpilot.io，用户注册即用
**目标用户**：追求便利的团队、企业用户、需要合规的组织
**许可证**：Commercial License（按月订阅）

### ✅ 包含功能
**= Self-Hosted 所有功能 +**

#### 🎁 托管便利性
- ✅ **官方 AI Provider**（无需自己申请 API Key，开箱即用）
- ✅ **免部署、免运维**（官方维护基础设施）
- ✅ **99.9% SLA 保证**（高可用性承诺）
- ✅ **自动备份与灾难恢复**（每日备份，30 天保留）
- ✅ **自动安全更新**（零停机滚动更新）
- ✅ **全球 CDN 加速**（Dashboard 快速访问）

#### 🏢 企业增强功能
- ✅ **企业级 SSO**（SAML 2.0 / Google Workspace / Okta）
- ✅ **高级审计合规**（SOC2 / ISO27001 / GDPR）
- ✅ **自定义域名**（White-label，如 ops.your-company.com）
- ✅ **优先技术支持**（邮件 / Slack / 电话支持）
- ✅ **SLA 保障**（响应时间承诺）
- ✅ **多租户隔离**（数据完全隔离）
- ✅ **订阅计费管理**（Stripe 集成）

#### 🚀 性能与规模
- ✅ PostgreSQL 数据库（高性能、支持大规模）
- ✅ Redis 会话管理（快速响应）
- ✅ S3 对象存储（日志归档、备份）
- ✅ Kubernetes 部署（弹性伸缩）

---

## 📊 功能对比表

| 功能分类 | Self-Hosted（开源） | Cloud（托管） |
|---------|---------------------|---------------|
| **AI 对话运维** | ✅ 完整支持 | ✅ 完整支持 |
| **多服务器管理** | ✅ 无限制 | ✅ 无限制 |
| **团队协作** | ✅ 无限用户 | ✅ 无限用户 |
| **Webhook/告警** | ✅ 完整支持 | ✅ 完整支持 |
| **监控与审计** | ✅ 完整支持 | ✅ 完整支持 |
| **OAuth 登录** | ✅ 需自己配置 | ✅ 官方预配置 |
| **AI Provider** | ⚙️ 需自己申请 Key | ✅ 官方提供 |
| **部署运维** | ⚙️ 自己负责 | ✅ 官方托管 |
| **高可用性** | ⚙️ 自己搭建 | ✅ 99.9% SLA |
| **备份恢复** | ⚙️ 自己配置 | ✅ 自动备份 |
| **企业 SSO（SAML）** | ❌ 不支持 | ✅ 支持 |
| **审计合规报告** | ❌ 不提供 | ✅ SOC2/ISO27001 |
| **技术支持** | ⚙️ 社区支持 | ✅ 优先支持 |
| **数据库** | SQLite | PostgreSQL |
| **价格** | **免费** | **$19/月起** |

---

## 🔧 技术实现策略

### 1. 环境变量驱动（仅区分部署模式）
```bash
# Self-Hosted（开源部署）
CLOUD_MODE=false           # 默认值，自部署模式

# Cloud（官方托管）
CLOUD_MODE=true            # 托管模式，启用云专属功能
```

**核心变化**：
- ❌ 不再使用 `EDITION=ce|ee` 区分功能
- ✅ 仅用 `CLOUD_MODE` 区分部署环境
- ✅ 所有核心功能默认开启（多服务器、团队、Webhook 等）

### 2. 后端配置（简化）
```typescript
// packages/server/src/config/edition.ts
export const DEPLOYMENT = {
  isSelfHosted: process.env.CLOUD_MODE !== 'true',
  isCloud: process.env.CLOUD_MODE === 'true',
} as const;

// 所有功能默认启用（Self-Hosted 可用）
export const FEATURES = {
  // 核心功能 - 100% 开源
  chat: true,
  commandExecution: true,
  knowledgeBase: true,
  multiServer: true,              // ✅ Self-Hosted 可用
  multiSession: true,             // ✅ Self-Hosted 可用
  teamCollaboration: true,        // ✅ Self-Hosted 可用
  webhooks: true,                 // ✅ Self-Hosted 可用
  alerts: true,                   // ✅ Self-Hosted 可用
  metricsMonitoring: true,        // ✅ Self-Hosted 可用
  auditExport: true,              // ✅ Self-Hosted 可用
  oauthLogin: true,               // ✅ Self-Hosted 可用（需自己配置）
  rateLimiting: true,             // ✅ Self-Hosted 可用
} as const;

// Cloud 专属功能（托管环境特性，非功能限制）
export const CLOUD_ONLY = {
  officialAIKey: DEPLOYMENT.isCloud,     // 官方 AI Key
  autoBackup: DEPLOYMENT.isCloud,        // 自动备份
  samlSSO: DEPLOYMENT.isCloud,           // 企业 SSO
  complianceReports: DEPLOYMENT.isCloud, // 合规报告
  multiTenant: DEPLOYMENT.isCloud,       // 多租户隔离
  billing: DEPLOYMENT.isCloud,           // 订阅计费
  managedInfra: DEPLOYMENT.isCloud,      // 托管基础设施
} as const;
```

### 3. 前端配置（无需 Feature Gate）
```typescript
// packages/dashboard/src/hooks/useDeployment.ts
export function useDeployment() {
  const { systemInfo } = useSystemStore();

  return {
    isSelfHosted: !systemInfo.cloudMode,
    isCloud: systemInfo.cloudMode,
    // 所有功能默认可用，无需检查
    features: {
      multiServer: true,
      teamCollaboration: true,
      webhooks: true,
      // ...
    }
  };
}
```

### 4. UI 调整（仅 Cloud 专属功能需要判断）
```typescript
// Sidebar.tsx - 所有功能都显示
<NavItem to="/servers" icon={Server} label="服务器" />
<NavItem to="/team" icon={Users} label="团队" />
<NavItem to="/webhooks" icon={Webhook} label="Webhook" />

// Settings.tsx - 仅 Cloud 专属功能需要判断
{isCloud ? (
  <SAMLSSOSettings />  // Cloud 专属：企业 SSO
) : (
  <GitHubOAuthSettings />  // Self-Hosted: 自己配置 OAuth
)}
```

---

## 📂 目录结构（单一代码库）

```
ServerPilot/
├── packages/
│   ├── server/          # 包含所有功能（开源 AGPL-3.0）
│   ├── agent/           # 轻量 Agent（开源 Apache-2.0）
│   ├── dashboard/       # 前端 UI（开源 AGPL-3.0）
│   └── shared/          # 协议与类型（开源 MIT）
├── .env.example         # Self-Hosted 环境变量示例
├── docker-compose.yml   # Self-Hosted 部署配置
└── EDITION_MATRIX.md    # 本文档
```

**不再需要 CE/EE 分离**：
- ❌ 删除 `.env.ce.example` / `.env.ee.example`
- ❌ 删除 `docker-compose.ce.yml` / `docker-compose.ee.yml`
- ✅ 单一配置文件，通过 `CLOUD_MODE` 区分环境

---

## 🚀 构建与发布策略

### NPM Packages（100% 开源）
```bash
# 发布到 npm（所有功能开源）
pnpm publish --filter @aiinstaller/server
pnpm publish --filter @aiinstaller/agent
pnpm publish --filter @aiinstaller/dashboard
pnpm publish --filter @aiinstaller/shared
```

### Docker Images（公开构建）
```bash
# Self-Hosted 镜像（公开，默认 CLOUD_MODE=false）
docker build -t serverpilot/server:latest .
docker build -t serverpilot/agent:latest ./packages/agent
docker build -t serverpilot/dashboard:latest ./packages/dashboard

# 发布到 Docker Hub 和 GHCR
docker push serverpilot/server:latest
docker push ghcr.io/jingjinbao/serverpilot/server:latest
```

### GitHub Releases
- **main 分支**：开源代码（100% 功能，AGPL-3.0）
- **Tag v1.0.0**：版本发布（Self-Hosted 用户直接使用）

---

## 💰 定价策略

### Self-Hosted（免费）
```
价格: $0（永久免费）
功能: 100% 完整功能
限制: 无
支持: 社区支持（GitHub Issues / Discussions）
适合: 开发者、小型团队、企业内部部署
```

### Cloud Free（免费试用）
```
价格: $0/月
限制: 1 台服务器，1 个用户
功能: 完整功能
支持: 社区支持
适合: 个人用户、评估测试
```

### Cloud Pro（专业版）
```
价格: $19/月
包含: 10 台服务器，5 个用户
功能: 完整功能 + 官方 AI Key + 自动备份
支持: 邮件支持（48h 响应）
适合: 小型团队、初创公司
```

### Cloud Team（团队版）
```
价格: $49/月
包含: 无限服务器，无限用户
功能: Pro 全部 + GitHub SSO + 高级监控
支持: 邮件 + Slack 支持（24h 响应）
适合: 成长型团队、DevOps 团队
```

### Cloud Enterprise（企业版）
```
价格: $199/月起（联系销售）
包含: Team 全部 + 企业增强
功能: SAML SSO / 审计合规 / 自定义域名
支持: 优先支持 + SLA 保障 + 专属客户经理
适合: 大型企业、需要合规的组织
```

---

## 🎁 开源策略（引流到 Cloud）

### README.md 明确说明
```markdown
## 快速开始

### 🏠 Self-Hosted（推荐个人/团队）
```bash
# 30 秒部署，100% 功能，永久免费
docker compose up -d
# 访问 http://localhost:3001
```

### ☁️ Cloud（推荐企业用户）
访问 [serverpilot.io](https://serverpilot.io) 注册账号
- ✅ 免配置 AI（无需自己申请 API Key）
- ✅ 免运维（官方维护基础设施）
- ✅ 企业级 SSO 和审计合规
- 🎁 14 天免费试用，无需信用卡
```

### License 策略
- **Self-Hosted**：AGPL-3.0（开源，网络使用需开源修改）
  - Server / Dashboard: AGPL-3.0
  - Agent: Apache-2.0（企业友好）
  - Shared: MIT（最大兼容性）
- **Cloud**：Commercial License（按月订阅，无需担心 AGPL 传染性）
- 详细说明见 [LICENSING.md](LICENSING.md)

---

## 🤔 FAQ

**Q: Self-Hosted 和 Cloud 功能有什么区别？**
A: **核心功能完全一致**（多服务器、团队、Webhook、监控等）。Cloud 的价值是**便利性**（免运维、官方 AI Key、企业 SSO）和**合规性**（SOC2、审计报告），而非功能解锁。

**Q: Self-Hosted 可以商用吗？**
A: 可以，AGPL-3.0 允许商用。但如果你修改代码并作为网络服务提供，需要开源你的修改。

**Q: 为什么多服务器管理也开源？**
A: 这是 ServerPilot 的核心价值，不应该成为付费门槛。我们相信真正需要企业级支持的用户会选择 Cloud。

**Q: Cloud 如何防止被 Self-Hosted 替代？**
A:
- 运维成本：自己维护需要时间（备份、更新、监控）
- AI 成本：自己申请 API Key 需要充值和管理
- 企业功能：SAML SSO、审计合规报告仅 Cloud 提供
- 技术支持：Cloud 提供 SLA 保障和优先支持

**Q: 如何升级 Self-Hosted → Cloud？**
A: Cloud 提供数据迁移工具，一键导入 Self-Hosted 的配置和历史记录。

**Q: 代码全部开源，如何盈利？**
A: 参考 GitLab（旧策略）、Supabase、Appwrite 等成功案例——开源赢得信任和用户，托管服务赚取收入。

---

## ✅ 实施调整步骤

### 已完成（需要回滚）
- ❌ CE/EE Feature Flag 系统（edition-001 ~ edition-070）
- ❌ 后端 `requireFeature` 路由保护
- ❌ 前端 `FeatureGate` 条件渲染
- ❌ `.env.ce.example` / `.env.ee.example`
- ❌ `docker-compose.ce.yml` / `docker-compose.ee.yml`

### 待执行（恢复开源）
1. **简化 `edition.ts`**（移除功能分级）
2. **移除后端 `requireFeature`**（保留 CLOUD_ONLY 功能的检查）
3. **简化前端**（移除 FeatureGate，保留 Cloud 专属功能的判断）
4. **合并配置文件**（单一 `.env.example` 和 `docker-compose.yml`）
5. **更新文档**（README、LICENSING）
6. **运行测试**（验证功能完整性）
