# ServerPilot 任务队列 - 新一轮

> 基于 2026-02-11 项目状态全面分析自动生成
> 前一轮 30 个任务已完成 29 个（Phase 1-3 基本完成）
> Phase 3 大部分已在 TASK_QUEUE.md 中完成，但 TODO.md 未同步

---

## 📊 统计信息

- **总任务数**: 10
- **待完成** (pending): 10
- **进行中** (in_progress): 0
- **已完成** (completed): 0

---

## 📋 任务列表

### [pending] 共享安全规则提取到 @aiinstaller/shared 包

**ID**: task-024
**优先级**: P0
**模块路径**: packages/shared/src/security/, packages/agent/src/security/
**任务描述**: 当前命令分级规则（532+ 条规则、43+ 危险参数、55+ 保护路径）仅在 Agent 端实现（`packages/agent/src/security/command-classifier.ts` + `command-rules.ts`），Server 端完全没有安全校验。为实现"五层纵深防御"的 Server 端第一道防线，需要先将安全规则提取为可共享的模块：
1. 在 `packages/shared/src/security/` 下创建：
   - `risk-levels.ts` — RiskLevel 枚举（GREEN/YELLOW/RED/CRITICAL/FORBIDDEN）及类型定义
   - `command-rules.ts` — 命令分级规则数据（从 Agent 的 command-rules.ts 提取纯数据）
   - `param-rules.ts` — 危险参数黑名单和保护路径列表（从 Agent 的 param-auditor.ts 提取）
   - `classify.ts` — 纯函数版命令分级逻辑（不依赖 Node.js API、不依赖 Zod）
2. 修改 Agent 的 `command-classifier.ts` 从 shared 导入规则数据，保留 Agent 特有的自定义规则加载逻辑（`loadCustomRulesFromFile`）
3. 确保 Agent 现有的 899 个安全测试全部通过（回归验证）
4. 导出安全规则供 Server 端使用（task-020 依赖本任务）
**产品需求**: 开发标准 - "shared 模块提供共享类型和规则"；安全架构 - "Server 和 Agent 安全规则一致性"
**验收标准**:
- [ ] `packages/shared/src/security/` 目录存在，包含 risk-levels.ts、command-rules.ts、param-rules.ts、classify.ts
- [ ] 规则数据为 single source of truth（Agent 和 Server 使用同一份）
- [ ] shared 安全规则不引入 Zod 或其他重量级依赖（Agent 使用 protocol-lite 不能引入 Zod）
- [ ] Agent 现有 899 个安全测试全部通过（零回归）
- [ ] TypeScript 编译通过（Server NodeNext + Dashboard Bundler 两种 moduleResolution）
- [ ] shared 包的 exports 正确暴露安全模块
**创建时间**: 2026-02-11 22:30:00
**完成时间**: -

---

### [pending] Server 端命令安全校验层 — 双端防御闭环

**ID**: task-020
**优先级**: P0
**模块路径**: packages/server/src/core/security/
**任务描述**: 当前命令分级仅在 Agent 端实现，Server 端在下发命令前没有任何安全检查，完全信任 AI 生成的命令。产品方案要求"五层纵深防御"，Server 作为"大脑"应该在下发命令前进行第一道安全检查。需要：
1. 创建 `packages/server/src/core/security/command-validator.ts` — 使用 shared 包的分级函数（task-024），对 AI 生成的命令进行风险评估。FORBIDDEN 级命令直接拒绝不下发
2. 创建 `packages/server/src/core/security/audit-logger.ts` — 集中式安全审计日志，记录所有命令的分级结果、是否需要用户确认、实际执行结果
3. 在 `routes/chat.ts` 的 `/chat/:serverId/execute` 端点中集成 Server 端校验：取得 AI 生成的命令 → Server 校验风险等级 → 标记需要用户确认的步骤 → 通过后下发 Agent
4. 添加 `GET /api/v1/audit-log` API 端点供 Dashboard 查询审计日志
5. 添加审计日志的数据库表（audit_logs）和 Repository
**产品需求**: 安全架构 - "五层纵深防御"第一层需要在 Server 端实现，不能仅依赖 Agent
**验收标准**:
- [ ] `packages/server/src/core/security/` 目录存在，包含 command-validator.ts 和 audit-logger.ts
- [ ] Server 在下发命令前对命令进行风险分级（GREEN 自动执行，YELLOW+ 需要确认标记）
- [ ] FORBIDDEN 级命令在 Server 端直接拒绝，不下发到 Agent
- [ ] 审计日志记录每次命令的分级结果、用户确认状态、执行结果
- [ ] `GET /api/v1/audit-log` 支持按服务器 ID、时间范围、风险等级筛选
- [ ] 单元测试覆盖率 ≥ 95%（安全模块标准）
**创建时间**: 2026-02-11 22:30:00
**完成时间**: -

---

### [pending] Dashboard 告警管理页面与实时通知

**ID**: task-021
**优先级**: P0
**模块路径**: packages/dashboard/src/pages/Alerts.tsx, packages/dashboard/src/stores/alert-rules.ts
**任务描述**: Server 端已有完整的告警规则引擎（`core/alert/alert-evaluator.ts`、`api/routes/alert-rules.ts` 路由），Dashboard 的 `dashboard.ts` store 只处理告警事件展示，缺少告警规则 CRUD 管理页面。需要：
1. 创建 `pages/Alerts.tsx` — 告警管理页面，包含：
   - 告警规则列表（CPU/内存/磁盘阈值配置）
   - 规则创建/编辑/删除表单（选择服务器、指标类型、阈值、通知方式）
   - 告警历史记录表（触发时间、触发值、恢复时间）
   - 告警状态标记（触发中 🔴 / 已恢复 🟢）
2. 创建 `stores/alert-rules.ts` — Zustand store 管理告警规则 CRUD 和告警历史查询
3. 在 Sidebar 添加 Alerts 导航入口（Bell 图标）
4. Header 右上角告警角标 — 通过 WebSocket 推送告警事件，显示未处理告警计数
5. 编写组件测试和 store 测试
**产品需求**: Phase 2 - "告警规则（阈值配置 + 邮件通知）"；MVP Dashboard - 基本监控
**验收标准**:
- [ ] Dashboard 有 `/alerts` 页面，可查看告警规则列表
- [ ] 可创建/编辑/删除告警规则（选择服务器、指标、阈值、通知方式）
- [ ] 可查看告警触发历史记录
- [ ] Header 显示未处理告警角标计数
- [ ] 路由配置正确（Sidebar 导航 + React Router）
- [ ] 组件测试覆盖率 ≥ 70%（UI 模块标准）
**创建时间**: 2026-02-11 22:30:00
**完成时间**: -

---

### [pending] Dashboard 对话增强 — 执行进度实时展示与紧急制动

**ID**: task-023
**优先级**: P0
**模块路径**: packages/dashboard/src/pages/Chat.tsx, packages/dashboard/src/components/chat/
**任务描述**: 当前对话界面已有 PlanPreview 组件（确认/拒绝按钮、风险标记），但需要验证和增强执行过程的实时体验：
1. 验证当前 Chat.tsx 中 `/execute` API 调用后的 SSE 处理是否正确展示执行进度（当前步骤高亮、stdout/stderr 实时滚动显示）
2. 验证 ExecutionLog 组件是否支持多步骤进度展示（步骤 1/N 完成 → 步骤 2/N 执行中...）
3. 添加"停止执行"按钮 — 在执行过程中用户可以点击中断，调用 Server 的 kill switch API 停止 Agent 执行
4. 优化长输出的滚动体验 — 自动滚动到底部、支持手动滚动查看历史输出
5. 添加执行完成后的总结区域 — 显示成功/失败步骤数、总耗时、建议下一步操作
6. 编写交互集成测试
**产品需求**: 安全架构 - "紧急制动 Kill Switch"的 Dashboard 入口；AI 对话引擎 - "实时执行反馈"
**验收标准**:
- [ ] 执行过程中每个步骤的 stdout/stderr 实时显示在 Chat 界面
- [ ] 步骤进度指示器正确显示（如 "Step 2/5: Installing nginx..."）
- [ ] "停止执行"按钮在执行过程中可见，点击后中断执行
- [ ] 长输出自动滚动到底部
- [ ] 执行完成后显示总结信息
- [ ] 组件测试覆盖停止/滚动/总结交互
**创建时间**: 2026-02-11 22:30:00
**完成时间**: -

---

### [pending] 本地开发 `pnpm dev` 一键启动验证与开发环境脚本

**ID**: task-022
**优先级**: P1
**模块路径**: scripts/dev-setup.sh, packages/dashboard/vite.config.ts
**任务描述**: CONTRIBUTING.md 引导新开发者 `pnpm install && pnpm dev` 启动项目，但实际开发体验需要端到端验证：
1. 验证 `pnpm dev:server` 能正确启动（tsx watch 模式 + SQLite 自动初始化 + 端口 3000）
2. 验证 `pnpm dev:dashboard` 的 Vite proxy 正确代理 `/api/*` → Server:3000 和 `/ws` → ws://Server:3000
3. 验证 `pnpm dev` 并行启动三端是否有时序问题（Server 需先于 Dashboard 启动，否则 proxy 目标不可达）
4. 创建 `scripts/dev-setup.sh` — 首次开发环境搭建脚本：检查 Node.js ≥ 22、检查 pnpm ≥ 9、pnpm install、创建 .env.local（从 .env.example 复制）、提示配置 AI Provider
5. 验证 shared 包修改后 Server/Dashboard 能正确热更新（monorepo workspace 协议）
6. 修复发现的任何启动问题
**产品需求**: 开发标准 4.2 - 开发命令；CONTRIBUTING.md - 开发环境搭建
**验收标准**:
- [ ] `pnpm install && pnpm dev` 在全新 clone 后能成功启动三端服务
- [ ] Dashboard 通过 Vite proxy 正确访问 Server API（无 CORS 问题）
- [ ] WebSocket 连接通过 Vite proxy 正常工作
- [ ] `scripts/dev-setup.sh` 可在 macOS 和 Ubuntu 上运行
- [ ] 脚本有友好的错误提示（如 Node.js 版本过低时给出升级提示）
**创建时间**: 2026-02-11 22:30:00
**完成时间**: -

---

### [pending] Dashboard 监控图表实时刷新与时间范围选择器完善

**ID**: task-025
**优先级**: P1
**模块路径**: packages/dashboard/src/components/monitor/, packages/dashboard/src/stores/server-detail.ts
**任务描述**: 监控图表组件（MonitoringSection + MetricsChart）已使用 Recharts 实现 CPU/内存/磁盘/网络四类图表，Server 端 Metrics API 已就绪。需要验证端到端数据流并增强实时体验：
1. 验证 server-detail.ts store 的 `fetchMetrics()` 是否正确调用 `/api/v1/metrics` 或 `/api/v1/metrics/aggregated` 端点
2. 添加自动刷新机制 — 默认每 60 秒轮询最新 Metrics（可配置刷新间隔）
3. 验证时间范围选择器（1h/24h/7d）切换后是否正确请求不同粒度的聚合数据
4. 处理空数据场景：Agent 离线时图表区域显示"Agent 离线，暂无数据"提示而非空白
5. 处理新服务器场景：服务器刚添加尚未上报数据时显示"等待首次数据上报"
6. 性能优化：大量数据点时图表渲染不卡顿（考虑数据采样或虚拟化）
**产品需求**: MVP Dashboard - "基本监控"；Phase 2 - "基本监控图表（CPU/内存/磁盘曲线）"
**验收标准**:
- [ ] ServerDetail 页面正确显示 CPU/内存/磁盘/网络四类图表
- [ ] 图表数据每 60 秒自动刷新（页面可见时）
- [ ] 时间范围选择器切换 1h/24h/7d 后图表数据正确更新
- [ ] Agent 离线时显示友好的空状态提示
- [ ] 组件测试覆盖数据加载、空状态、自动刷新逻辑
**创建时间**: 2026-02-11 22:30:00
**完成时间**: -

---

### [pending] 自定义 OpenAI 兼容接口支持（OneAPI / LiteLLM / Azure）

**ID**: task-027
**优先级**: P1
**模块路径**: packages/server/src/ai/providers/custom-openai.ts, packages/dashboard/src/pages/Settings.tsx
**任务描述**: 当前 OpenAI Provider 已支持自定义 baseURL，但用户在 Dashboard 上无法方便地配置自定义 OpenAI 兼容端点。很多国内用户使用 OneAPI、LiteLLM、Azure OpenAI、Cloudflare Workers AI 等 OpenAI 兼容中转接口。需要：
1. 创建 `custom-openai.ts` Provider — 基于 OpenAI SDK，明确接受用户自定义的 baseURL、API Key、模型名称三个配置项
2. 在 `provider-factory.ts` 注册 `custom-openai` 类型
3. Dashboard Settings 页面添加"自定义 OpenAI 兼容"选项卡：
   - Base URL 输入框（如 `https://api.oneapi.com/v1`）
   - API Key 输入框
   - 模型名称输入框（如 `gpt-4o`, `deepseek-chat`）
4. 数据库 `UserSettingsAIProvider.provider` 枚举添加 `custom-openai`，增加 `baseUrl` 和 `modelName` 字段
5. 添加"测试连接"按钮（调用 `/v1/models` API 验证配置正确性）
6. 编写单元测试
**产品需求**: Phase 3 - "更多 AI Provider - 自定义 OpenAI 兼容接口"
**验收标准**:
- [ ] Settings 页面可选择"自定义 OpenAI 兼容"Provider
- [ ] 可配置 Base URL、API Key、模型名称
- [ ] "测试连接"按钮验证配置是否正确
- [ ] 保存后 Chat 功能使用自定义 Provider 正常对话
- [ ] 单元测试覆盖 custom-openai Provider 的创建、chat、streaming
**创建时间**: 2026-02-11 22:30:00
**完成时间**: -

---

### [pending] TODO.md 状态同步 — Phase 3 进度更新

**ID**: task-026
**优先级**: P1
**模块路径**: docs/TODO.md
**任务描述**: `docs/TODO.md` 的 Phase 3 所有 10 个任务仍标记为 `⬜ 待开发`，但实际已在 TASK_QUEUE.md 中完成了其中 7 个：
- ✅ README 完善（task-010）
- ✅ 安装指南（docs/deployment.md, task-009/task-013）
- ✅ 贡献指南 CONTRIBUTING.md（task-006）
- ✅ 安全白皮书 SECURITY.md + ARCHITECTURE.md（task-015）
- ✅ CI/CD 流水线 GitHub Actions（task-007/task-017）
- ✅ Docker Hub / GHCR 发布（task-019）
- ✅ 一键安装脚本 install.sh（task-018）
- ⬜ 更多 AI Provider（→ task-027 待实现）
- ✅ 知识库贡献指南（包含在 CONTRIBUTING.md 中）
- ⬜ Product Hunt 发布（非代码任务，标记为 📋 规划中）

需要：
1. 更新 TODO.md Phase 1/2 进度条为 100%
2. 更新 Phase 3 的 7 个已完成任务为 `✅ 完成`
3. 标注 Phase 3 剩余 2 个未完成项
4. 更新 Phase 3 进度条为 80%
5. 确保 TASK_QUEUE.md 和 TODO.md 状态一致
**产品需求**: 开发标准 10.1 - "TODO.md 任务清单"需要保持准确
**验收标准**:
- [ ] TODO.md Phase 1 进度条 = 100%、Phase 2 = 100%、Phase 3 ≥ 80%
- [ ] 已完成任务正确标记为 ✅
- [ ] Phase 3 剩余项清晰标注
- [ ] 最后更新时间正确
**创建时间**: 2026-02-11 22:30:00
**完成时间**: -

---

### [pending] Dashboard 审计日志页面 — 操作可追溯

**ID**: task-028
**优先级**: P1
**模块路径**: packages/dashboard/src/pages/AuditLog.tsx, packages/dashboard/src/stores/audit.ts
**任务描述**: task-020 在 Server 端实现审计日志后，需要在 Dashboard 提供可视化查询界面，让用户能追溯所有运维操作记录。这是"五层纵深防御"第五层（审计与可追溯）的 UI 入口。需要：
1. 创建 `pages/AuditLog.tsx` — 审计日志页面：
   - 时间线视图：按时间倒序展示操作记录
   - 筛选器：按服务器、时间范围、风险等级、操作结果筛选
   - 每条记录显示：时间、命令、风险等级颜色、用户确认状态、执行结果（成功/失败）、操作耗时
   - 命令详情展开：显示完整 stdout/stderr 输出
2. 创建 `stores/audit.ts` — Zustand store 调用 `GET /api/v1/audit-log` API
3. 在 Sidebar 添加 Audit Log 导航入口（Shield 图标）
4. 支持导出 CSV/JSON 格式（合规需求）
5. 编写组件测试
**产品需求**: 安全架构 - "第五层：审计与可追溯（完整日志）"；Phase 2 - "操作历史记录 — 全量日志可追溯"
**验收标准**:
- [ ] Dashboard 有 `/audit-log` 页面
- [ ] 时间线展示所有命令执行记录，包含风险等级颜色
- [ ] 支持按服务器、时间范围、风险等级筛选
- [ ] 支持 CSV 导出
- [ ] 组件测试覆盖率 ≥ 70%
**创建时间**: 2026-02-11 22:30:00
**完成时间**: -

---

### [pending] 端到端部署冒烟测试 — Docker Compose 全链路验证

**ID**: task-029
**优先级**: P2
**模块路径**: tests/e2e/, scripts/smoke-test.sh
**任务描述**: 当前有静态的 Docker Compose 配置测试和部署验证脚本，但缺少真正启动容器后的全链路冒烟测试。需要验证 `docker compose up` 后整个系统的核心流程可用：
1. 增强 `scripts/smoke-test.sh` — 在 Docker 容器启动后执行：
   - 健康检查：Server `/health` 和 Dashboard `/` 可达
   - 认证流程：注册用户 → 登录获取 Token
   - 服务器管理：创建服务器 → 获取安装命令
   - API 代理：通过 Dashboard Nginx 代理正确访问 `/api/v1/*`
   - WebSocket：通过 Nginx 代理建立 `/ws` 连接
   - AI Provider：调用 `/settings/ai-provider/health` 检查 AI 可用性
2. 在 CI/CD 的 E2E 流水线中添加 Docker 冒烟测试步骤
3. 编写 `tests/smoke/docker-smoke.test.ts` — 程序化的冒烟测试，可在 CI 中运行
**产品需求**: 测试标准 - "确保核心功能闭环可用"；部署方式 - "docker compose up 一键自部署"
**验收标准**:
- [ ] `scripts/smoke-test.sh` 在 `docker compose up -d` 后能自动验证核心功能
- [ ] 脚本输出清晰的 PASS/FAIL 结果
- [ ] CI 中 Docker 冒烟测试通过
- [ ] 测试执行时间 < 2 分钟（不含 Docker 构建时间）
**创建时间**: 2026-02-11 22:30:00
**完成时间**: -

---

## 依赖关系

```
task-024 (共享安全规则) ──→ task-020 (Server 端安全校验) ──→ task-028 (审计日志 UI)
                                                          ↘ task-023 (对话增强，依赖风险等级数据)

以下任务可并行执行：
├── task-021 (告警页面) — 独立
├── task-022 (开发环境) — 独立
├── task-025 (监控图表) — 独立
├── task-026 (TODO 同步) — 独立，优先级低
├── task-027 (自定义 Provider) — 独立
└── task-029 (Docker 冒烟测试) — 独立
```

## 建议执行顺序

### 第一批（P0 关键链路）
1. **task-024** → **task-020** → **task-023**（安全校验链路，有依赖关系）
2. **task-021**（告警页面，独立可并行）

### 第二批（P1 体验增强）
3. **task-025**（监控图表实时刷新）
4. **task-027**（自定义 Provider）
5. **task-022**（开发环境验证）

### 第三批（P1/P2 收尾）
6. **task-028**（审计日志 UI，依赖 task-020）
7. **task-026**（TODO 同步）
8. **task-029**（Docker 冒烟测试）

---

## 使用说明

### 任务状态
- `[pending]` - 待执行
- `[in_progress]` - 执行中
- `[completed]` - 已完成
- `[failed]` - 失败（需要人工介入）

### 优先级说明
- **P0**: 阻塞 MVP 发布或存在安全风险，必须优先完成
- **P1**: 重要功能增强，影响用户体验和产品完整度
- **P2**: 锦上添花，可在后续迭代中完成

---

**最后更新**: 2026-02-11 22:30:00
