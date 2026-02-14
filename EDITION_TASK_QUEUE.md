# 版本划分 (CE/EE) 任务队列

> 将 ServerPilot 划分为开源本地版（CE）和云端全功能版（EE）
> 参考文档: EDITION_MATRIX.md

**最后更新**: 2026-02-15 07:34:56

## 📊 统计

- **总任务数**: 72
- **待完成** (pending): 1
- **进行中** (in_progress): 1
- **已完成** (completed): 70
- **失败** (failed): 0

## 📋 任务列表

(AI 将自动在此添加版本划分任务)
### [completed] CommandPalette 添加 Edition 感知 — CE 模式下过滤 EE 专属导航命令 ✅

**ID**: edition-055
**优先级**: P2
**阶段**: 阶段4-UI简化
**模块路径**: packages/dashboard/src/components/common/
**任务描述**: `CommandPalette.tsx` 当前列出所有导航项（包括 Servers、Team、Webhooks 等 EE 功能），CE 用户通过快捷键打开后看到不可用的选项。需要使用 `useFeatures()` 过滤 EE 专属命令，与 Sidebar 的过滤逻辑保持一致。
**实现要点**:
  - 在 `CommandPalette.tsx` 中引入 `useFeatures()` hook
  - 为命令列表项添加可选 `featureKey?: FeatureKey` 字段（与 Sidebar navItems 一致）
  - 渲染时用 `features[item.featureKey]` 过滤不可见命令
  - 在 `CommandPalette.test.tsx` 中增加 CE 模式过滤测试
**验收标准**: CE 模式下 CommandPalette 不显示 EE 专属导航命令；EE 模式显示全部命令；有测试覆盖
**依赖任务**: 无
**创建时间**: 2026-02-15
**完成时间**: 2026-02-15 05:36:36

---

### [completed] Header 组件 CE 模式下隐藏密码修改弹窗中的邮箱修改 — 单用户无需修改邮箱 ✅

**ID**: edition-056
**优先级**: P3
**阶段**: 阶段4-UI简化
**模块路径**: packages/dashboard/src/components/layout/
**任务描述**: `Header.tsx` 中的 `PasswordChangeDialog` 在 CE 单用户模式下可能包含邮箱修改选项。CE 预置 admin 账户不需要修改邮箱，应简化弹窗仅保留密码修改。需检查 `PasswordChangeDialog.tsx` 是否有 edition 感知。
**实现要点**:
  - 检查 `PasswordChangeDialog.tsx` 是否包含邮箱修改字段
  - 如有，使用 `useEdition()` 在 CE 模式下隐藏邮箱修改
  - 在 `Header.test.tsx` 中补充 CE 模式渲染测试
**验收标准**: CE 模式下密码弹窗仅含密码字段；EE 模式完整功能不变
**依赖任务**: 无
**创建时间**: 2026-02-15
**完成时间**: 2026-02-15 05:41:33

---

### [completed] chat-export 路由 CE 模式限制 — 单会话导出仍可用但隐藏批量导出 ✅

**ID**: edition-057
**优先级**: P2
**阶段**: 阶段2-后端保护
**模块路径**: packages/server/src/api/routes/
**任务描述**: `chat-export.ts` 的会话导出功能在 CE 模式下应仍可用（单会话导出），但需要验证是否存在批量导出或跨服务器导出逻辑。如有，需要在 CE 模式下限制仅导出当前活跃会话。当前缺少 `chat-export-edition.test.ts` 测试覆盖。
**实现要点**:
  - 检查 `chat-export.ts` 是否有批量/跨服务器导出端点
  - CE 模式下限制仅可导出当前活跃会话
  - 创建 `chat-export-edition.test.ts` 验证 CE/EE 两种模式行为
**验收标准**: CE 模式下单会话导出正常工作；批量导出（如有）受限；有 edition 测试覆盖
**依赖任务**: 无
**创建时间**: 2026-02-15
**完成时间**: 2026-02-15 05:47:22

---

### [completed] doc-sources 路由验证 CE 可用性 — 知识库管理属于 CE 核心功能 ✅

**ID**: edition-058
**优先级**: P2
**阶段**: 阶段2-后端保护
**模块路径**: packages/server/src/api/routes/
**任务描述**: `doc-sources.ts` 路由管理知识库文档源的 CRUD。知识库是 CE 核心功能，但 doc-sources 可能有高级功能（如远程 GitHub 抓取需要 token）在 CE 模式下应有合理降级。当前缺少 edition 行为验证。
**实现要点**:
  - 确认 doc-sources 所有端点在 CE 模式下可正常工作
  - 验证无 `requireFeature` 阻挡（CE 功能不应被阻挡）
  - 创建简单的 edition 行为验证测试
**验收标准**: CE 模式下知识库文档源管理功能完全可用；有验证性测试
**依赖任务**: 无
**创建时间**: 2026-02-15
**完成时间**: 2026-02-15 05:53:19

---

### [completed] operations 路由验证 CE 可用性 — 操作历史属于 CE 核心功能 ✅

**ID**: edition-059
**优先级**: P2
**阶段**: 阶段2-后端保护
**模块路径**: packages/server/src/api/routes/
**任务描述**: `operations.ts` 路由管理操作历史记录。操作历史是 CE 核心功能，但可能包含跨服务器查询逻辑。需确认 CE 模式下操作列表仅展示本地服务器操作，无需 `multiServer` 门控。
**实现要点**:
  - 检查 operations 查询是否有跨服务器逻辑
  - 确认 CE 单服务器模式下查询结果正确（仅本地服务器）
  - 在现有 operations 测试中补充 CE 模式验证用例
**验收标准**: CE 模式下操作历史仅展示本地服务器记录；查询性能不受影响
**依赖任务**: 无
**创建时间**: 2026-02-15
**完成时间**: 2026-02-15 05:59:37

---

### [completed] tasks 路由验证 CE 可用性 — 任务管理属于 CE 核心功能 ✅

**ID**: edition-060
**优先级**: P2
**阶段**: 阶段2-后端保护
**模块路径**: packages/server/src/api/routes/
**任务描述**: `tasks.ts` 路由管理任务 CRUD 和执行。任务管理是 CE 核心功能，但任务可能引用多个服务器。需确认 CE 模式下任务创建限制为本地服务器，无需跨服务器任务调度。
**实现要点**:
  - 检查 tasks 创建是否允许指定非本地 serverId
  - CE 模式下创建任务时自动绑定本地服务器（忽略 serverId 参数）
  - 在现有 tasks 测试中补充 CE 模式验证用例
**验收标准**: CE 模式下任务管理绑定本地服务器；EE 模式支持多服务器任务
**依赖任务**: 无
**创建时间**: 2026-02-15
**完成时间**: 2026-02-15 06:09:59

---

### [completed] CE 启动引导流程优化 — 首次运行时展示欢迎向导 ✅

**ID**: edition-061
**优先级**: P3
**阶段**: 阶段4-UI简化
**模块路径**: packages/dashboard/src/pages/
**任务描述**: CE 新用户首次使用默认凭据登录后直接进入 Chat 页面，但可能不了解 Agent 安装流程和基本功能。应在首次登录时检测是否有已连接的服务器，如无则显示简单引导提示（安装 Agent 命令）。
**实现要点**:
  - 在 Chat 页面检测本地服务器状态（已有 CE 自动导航逻辑基础上）
  - 无服务器时展示引导卡片：显示 Agent 安装命令和连接说明
  - 有服务器但 Agent 离线时展示重连提示
  - 使用 localStorage 标记已完成引导，不重复展示
**验收标准**: CE 首次用户看到清晰的 Agent 安装引导；已连接后不再显示；EE 模式不受影响
**依赖任务**: 无
**创建时间**: 2026-02-15
**完成时间**: 2026-02-15 06:21:05

---

### [completed] CE 模式 API 客户端错误处理增强 — FEATURE_DISABLED 后自动隐藏 UI 入口 ✅

**ID**: edition-062
**优先级**: P3
**阶段**: 阶段3-前端系统
**模块路径**: packages/dashboard/src/api/
**任务描述**: 当前 CE 模式下访问 EE API 返回 403 `FEATURE_DISABLED` 时，toast 显示升级提示。但如果用户通过书签或浏览器历史直接访问 EE 路由（绕过 FeatureGate），API 错误可能导致困惑。应在 `apiRequest` 中捕获 `FEATURE_DISABLED` 错误码后自动重定向到 `/chat`。
**实现要点**:
  - 在 `client.ts` 的错误处理逻辑中检测 `FEATURE_DISABLED` 错误码
  - 触发 toast 升级提示的同时，调用 `navigate('/chat')` 重定向（避免白屏）
  - 通过事件总线或全局 store 通知路由层执行重定向
  - 在 `client.test.ts` 中增加 FEATURE_DISABLED 处理测试
**验收标准**: CE 模式下 API 403 FEATURE_DISABLED 自动重定向回 /chat 并显示升级提示
**依赖任务**: 无
**创建时间**: 2026-02-15
**完成时间**: 2026-02-15 06:26:43

---

### [completed] Skill 触发器 Webhook 类型 CE 限制验证 — 确保 trigger-manager 一致性 ✅

**ID**: edition-063
**优先级**: P2
**阶段**: 阶段2-后端保护
**模块路径**: packages/server/src/core/skill/
**任务描述**: `trigger-manager.ts` 管理 Skill 的自动触发（包括 webhook-event 类型触发器）。CE 模式下 webhook 功能禁用，但已安装的 skill 如果注册了 webhook-event 触发器会怎样？需确认 CE 模式下 webhook-event 触发器自动禁用或忽略。
**实现要点**:
  - 检查 `trigger-manager.ts` 的 `subscribeToDispatcher()` 是否在 CE 模式下被调用
  - 确认 `index.ts` 中已有 `if (FEATURES.webhooks)` 守卫（已实现）
  - 验证 CE 模式下安装含 webhook-trigger 的 skill 时的行为
  - 在 `trigger-manager.test.ts` 中补充 CE 模式测试
**验收标准**: CE 模式下 webhook-event 触发器不会尝试注册；skill 其他触发器（cron/manual）正常工作
**依赖任务**: 无
**创建时间**: 2026-02-15
**完成时间**: 2026-02-15 06:36:43

---

### [completed] 全量测试执行与回归修复 — 验证所有 CE/EE 改造后测试绿色 ✅

**ID**: edition-064
**优先级**: P0
**阶段**: 阶段1-基础设施
**模块路径**: /
**任务描述**: 运行完整测试套件（server + dashboard + E2E + docker），修复任何因 edition 改造引入的回归。这是发布前的最终验证步骤。前一轮 edition-016 已标记完成但 CURRENT_EDITION_TASK.md 仍显示 pending，需重新执行确认。
**实现要点**:
  - 先运行 `pnpm --filter @aiinstaller/shared build` 确保 shared 包最新
  - 运行 `pnpm test` 检查所有 server/root 测试
  - 运行 `pnpm --filter @aiinstaller/dashboard test` 检查 dashboard 测试
  - 运行 `pnpm typecheck` 确保类型安全
  - 运行 `pnpm lint` 确保代码规范
  - 记录失败测试数量和修复过程
**验收标准**: 所有测试通过，无回归；`pnpm test && pnpm --filter @aiinstaller/dashboard test && pnpm typecheck && pnpm lint` 全部成功
**依赖任务**: edition-055 ~ edition-063
**创建时间**: 2026-02-15
**完成时间**: 2026-02-15 06:45:20

---

### [completed] CE 模式 Security Headers 验证 — 确认 CSP 策略不阻断 CE 功能 ✅

**ID**: edition-065
**优先级**: P2
**阶段**: 阶段2-后端保护
**模块路径**: packages/server/src/api/middleware/
**任务描述**: `security-headers.ts` 设置 CSP、HSTS 等安全头。EE 云端模式可能需要更严格的 CSP（如限制 iframe 嵌入），而 CE 本地部署可能需要更宽松的策略（允许 localhost 访问）。需验证当前 CSP 在 CE 模式下不会阻断正常功能。
**实现要点**:
  - 检查 `security-headers.ts` 当前 CSP 策略
  - CE 模式下确保 `connect-src` 允许 localhost 和本地 IP 段
  - EE 模式下可收紧 CSP 策略
  - 在现有测试中补充 CE 模式 CSP 验证
**验收标准**: CE 模式下所有页面功能不被 CSP 阻断；EE 模式安全策略适当收紧
**依赖任务**: 无
**创建时间**: 2026-02-15
**完成时间**: 2026-02-15 06:51:26

---

### [completed] CI/CD 双模式构建矩阵 — test.yml 增加 EDITION=ce/ee 测试矩阵 ✅

**ID**: edition-066
**优先级**: P1
**阶段**: 阶段5-配置文档
**模块路径**: .github/workflows/
**任务描述**: 当前 CI 测试工作流默认以 CE 模式运行。需要在测试矩阵中添加 `EDITION=ee` 环境变量维度，确保 EE 模式下的测试也在 CI 中验证。防止 EE 功能在合并后出现回归。
**实现要点**:
  - 在 `.github/workflows/test.yml` 的 test job matrix 中添加 `edition: [ce, ee]`
  - 设置 `env: EDITION: ${{ matrix.edition }}` 传递给测试进程
  - 确保 edition-specific 测试（如 `*-edition.test.ts`）在对应模式下运行
  - 更新 `tests/ci-config.test.ts` 验证新矩阵维度
**验收标准**: CI 在 CE 和 EE 两种模式下都运行测试；EE 测试不因缺少 OAuth 等凭据而失败
**依赖任务**: 无
**创建时间**: 2026-02-15
**完成时间**: 2026-02-15 06:56:43

---

### [completed] Docker 镜像 CE/EE 分开构建 — docker-publish.yml 支持 EDITION build-arg ✅

**ID**: edition-067
**优先级**: P1
**阶段**: 阶段5-配置文档
**模块路径**: .github/workflows/
**任务描述**: 当前 Docker 发布工作流可能只构建一种镜像。需要支持分别构建 CE 和 EE 镜像：CE 镜像推送到公开 registry，EE 镜像推送到私有 registry。确保 `--build-arg EDITION=ce/ee` 正确传递。
**实现要点**:
  - 修改 `docker-publish.yml` 添加 matrix 或多 step 构建
  - CE: `aiinstaller/server:latest` (公开), EE: `aiinstaller/server-ee:latest` (私有)
  - Dashboard 同理：`aiinstaller/dashboard:latest` vs `aiinstaller/dashboard-ee:latest`
  - 确保 Dockerfile 中 `ARG EDITION` → `ENV EDITION` 链路完整
  - 添加镜像 labels（版本、edition、构建时间）
**验收标准**: CI 可分别构建推送 CE 和 EE Docker 镜像；镜像 label 正确标注 edition
**依赖任务**: 无
**创建时间**: 2026-02-15
**完成时间**: 2026-02-15 07:04:53

---

### [completed] CE 数据库 Schema 瘦身验证 — 确认 EE 表在 CE 模式下不创建不必要索引 ✅

**ID**: edition-068
**优先级**: P2
**阶段**: 阶段2-后端保护
**模块路径**: packages/server/src/db/
**任务描述**: CE 模式下 webhook、invitation、oauth_accounts 等 EE 专属表仍会被 `createTables()` 创建。虽然不影响功能，但增加了 SQLite 数据库大小和 VACUUM 耗时。应评估是否在 CE 模式下跳过创建 EE 专属表和索引。
**实现要点**:
  - 列出所有 EE 专属表：webhooks、webhook_deliveries、invitations、oauth_accounts
  - 在 `createTables()` 中根据 `FEATURES` 条件跳过 EE 表创建
  - 确保 CE → EE 升级时缺失表自动创建（migration 兼容）
  - 测试 CE 模式下数据库只包含必要表
**验收标准**: CE 模式下数据库不包含 EE 专属表；升级到 EE 后自动补建缺失表；有测试验证
**依赖任务**: 无
**创建时间**: 2026-02-15
**完成时间**: 2026-02-15 07:16:31

---

### [completed] CE → EE 平滑升级 E2E 验证 — 修改环境变量后功能自动解锁 ✅

**ID**: edition-069
**优先级**: P1
**阶段**: 阶段5-配置文档
**模块路径**: tests/
**任务描述**: EDITION_MATRIX.md 承诺 CE → EE 升级只需修改 `EDITION=ee`。需要 E2E 测试验证：先以 CE 模式启动并创建数据（用户、会话、操作记录），然后切换到 EE 模式，验证所有数据保留且 EE 功能可用。
**实现要点**:
  - 创建 `tests/e2e-ce-to-ee-upgrade.test.ts`
  - 步骤1：EDITION=ce 启动服务器，创建用户数据
  - 步骤2：关闭服务器，切换 EDITION=ee 重启
  - 步骤3：验证原有数据可读、EE 功能解锁、EE 专属表自动创建
  - 步骤4：验证新增服务器、创建团队等 EE 功能可用
  - 测试需要真实数据库（SQLite 文件在两次启动间保留）
**验收标准**: CE → EE 升级后所有原有数据完整、EE 功能可用、无数据迁移需求
**依赖任务**: edition-068
**创建时间**: 2026-02-15
**完成时间**: 2026-02-15 07:25:39

---

### [completed] agent 路由验证 CE 一致性 — Agent 注册和心跳在 CE 模式下正常工作 ✅

**ID**: edition-070
**优先级**: P2
**阶段**: 阶段2-后端保护
**模块路径**: packages/server/src/api/routes/
**任务描述**: `agent.ts` 路由处理 Agent 相关 API（如状态查询、能力上报）。CE 模式下仅一个 Agent，需确认这些端点在单 Agent 场景下正常工作，不会因为缺少多 Agent 支持而报错。
**实现要点**:
  - 检查 `agent.ts` 端点是否依赖多服务器/多 Agent 假设
  - CE 模式下 Agent 状态查询应只返回本地 Agent
  - 确认 WebSocket handler 中的 CE 单服务器限制（handlers.ts）与 REST API 一致
  - 在现有 agent 测试中补充 CE 模式验证
**验收标准**: CE 模式下 Agent API 端点返回正确的单 Agent 数据；无多 Agent 相关错误
**依赖任务**: 无
**创建时间**: 2026-02-15
**完成时间**: 2026-02-15 07:34:22

---

### [in_progress] 创建 LICENSE 分离策略文件 — CE MIT + EE Commercial 声明

**ID**: edition-071
**优先级**: P3
**阶段**: 阶段5-配置文档
**模块路径**: /
**任务描述**: EDITION_MATRIX.md 提到 CE 使用 MIT License、EE 使用 Commercial License。当前仓库使用 AGPL-3.0。需要确定最终 License 策略并创建对应文件，确保开源代码的法律合规性。
**实现要点**:
  - 决定最终策略：全 AGPL（如 GitLab），或 CE MIT + EE Commercial
  - 如果采用 GitLab 模式：根目录 AGPL，CE 功能文件头标 MIT
  - 创建 LICENSE-CE 和 LICENSE-EE 文件（如需要）
  - 更新所有源文件头部版权声明保持一致
  - 更新 README 的 License 章节
**验收标准**: License 策略明确、文件齐全、源文件头部声明一致
**依赖任务**: 无
**创建时间**: 2026-02-15
**完成时间**: -

---

### [pending] 性能基准测试 — CE 模式启动时间和内存占用验证

**ID**: edition-072
**优先级**: P3
**阶段**: 阶段5-配置文档
**模块路径**: tests/
**任务描述**: CE 模式跳过了 webhook dispatcher、alert evaluator、rate limiting 等服务初始化。需要验证这些优化是否真正减少了启动时间和内存占用。建立基准测试数据作为未来优化参考。
**实现要点**:
  - 创建 `tests/performance-ce-baseline.test.ts`
  - 测量 CE 模式启动到 `Server listening` 的时间（应 < 2s）
  - 测量 CE 稳定状态内存占用（应 < 100MB RSS）
  - 对比 EE 模式同指标
  - 将基准值记录到测试中作为断言阈值
**验收标准**: CE 启动时间和内存占用优于 EE 模式；基准值作为测试断言防止退化
**依赖任务**: 无
**创建时间**: 2026-02-15
**完成时间**: -

### [completed] 创建 CE 会话数量限制中间件 — chat-sessions.ts 未应用 multiSession 功能门控 ✅

**ID**: edition-001
**优先级**: P1
**阶段**: 阶段2-后端保护
**模块路径**: packages/server/src/api/routes/
**任务描述**: `chat-sessions.ts` 中的会话 CRUD 路由（列表、删除、重命名）未应用 multiSession 功能门控。CE 模式下用户不应能列出/删除多个会话。虽然 `chat.ts` 中已做了单会话复用，但 `chat-sessions.ts` 的 `GET /:serverId/sessions`、`DELETE /:serverId/sessions/:id`、`PATCH /:serverId/sessions/:id/rename` 仍然暴露给 CE 用户。
**实现要点**:
  - 在 `chat-sessions.ts` 的列表路由中，CE 模式下限制仅返回当前活跃会话
  - 在删除路由中，CE 模式下禁止删除唯一会话（返回 403）
  - 使用 `FEATURES.multiSession` 进行判断
**验收标准**: CE 模式下 `GET /sessions` 仅返回一个会话，`DELETE` 当唯一会话时返回 403，`chat-session-ce-limit.test.ts` 已覆盖这些场景
**依赖任务**: 无
**创建时间**: 2026-02-15
**完成时间**: 2026-02-15 03:25:00

---

### [completed] Chat 页面 CE 模式隐藏多会话 UI — SessionSidebar "新建会话" 按钮与会话搜索 ✅

**ID**: edition-002
**优先级**: P2
**阶段**: 阶段4-UI简化
**模块路径**: packages/dashboard/src/pages/
**任务描述**: `Chat.tsx` 页面在 CE 模式下仍展示 SessionSidebar（包含搜索、新建会话、会话列表）。CE 模式下应完全隐藏会话侧边栏或至少隐藏 "新建会话" 按钮和搜索框。当前 `SessionSidebar.tsx` 已有 `features.multiSession` 条件隐藏按钮，但 `Chat.tsx` 本身未隐藏整个 sidebar 区域。
**实现要点**:
  - 在 `Chat.tsx` 中根据 `isCE` 控制 SessionSidebar 的渲染
  - CE 模式下不渲染 sidebar toggle 按钮 (`mobile-sidebar-toggle`)
  - CE 模式下不显示 `ServerSelector`（仅一台服务器）
**验收标准**: CE 模式下 Chat 页面仅展示对话区域，无会话列表/切换/新建按钮，Chat.test.tsx 有对应测试
**依赖任务**: 无
**创建时间**: 2026-02-15
**完成时间**: 2026-02-15 03:29:45

---

### [completed] Login 页面 CE 模式隐藏注册和 OAuth — 简化为仅密码登录 ✅

**ID**: edition-003
**优先级**: P2
**阶段**: 阶段4-UI简化
**模块路径**: packages/dashboard/src/pages/
**任务描述**: `Login.tsx` 已通过 `features.oauthLogin` 隐藏 GitHub OAuth 按钮，但 CE 模式下单用户场景应同时简化注册流程。CE 模式为预置 admin 账户，不应允许注册新用户。当前 Login 页面仍展示 "注册" tab。
**实现要点**:
  - CE 模式下隐藏 "注册" tab，仅显示 "登录" 表单
  - 添加 CE 提示文案："使用管理员账户登录（默认: admin@serverpilot.local / admin123）"
  - 在 `Login.test.tsx` 中增加 CE 模式测试
**验收标准**: CE 模式下 Login 页面无注册 tab、无 OAuth 按钮，有默认凭据提示，有测试覆盖
**依赖任务**: 无
**创建时间**: 2026-02-15
**完成时间**: 2026-02-15 03:36:41

---

### [completed] Server 端 CE 注册路由限制 — 禁止注册新用户 ✅

**ID**: edition-004
**优先级**: P1
**阶段**: 阶段2-后端保护
**模块路径**: packages/server/src/api/routes/
**任务描述**: CE 模式为单用户场景，`POST /api/v1/auth/register` 应在 CE 模式下禁止注册新用户（仅允许预置 admin 登录）。当前注册路由未做 edition 检查。
**实现要点**:
  - 在 `auth.ts` 的 register 路由中加入 CE 模式检查
  - CE 模式下返回 403 `{ error: { code: 'FEATURE_DISABLED', message: 'Registration is disabled in Community Edition' } }`
  - 保留 login 路由不受影响
**验收标准**: CE 模式下 POST /auth/register 返回 403，EE 模式正常注册，有单元测试覆盖
**依赖任务**: 无
**创建时间**: 2026-02-15
**完成时间**: 2026-02-15 03:49:18

---

### [completed] Skills 路由添加 edition 感知 — 限制 CE 模式 skill 数量 ✅

**ID**: edition-005
**优先级**: P2
**阶段**: 阶段2-后端保护
**模块路径**: packages/server/src/api/routes/
**任务描述**: `skills.ts` 和 `skills-execution.ts` 目前无 edition 检查。CE 模式下 skill 功能应可用但可限制 skill 数量（如最多 5 个）或限制某些高级 skill 类型（如 webhook-triggered skills 需要 EE）。
**实现要点**:
  - 在 `skills.ts` 安装路由中添加 CE 模式 skill 数量限制（最多 5 个）
  - webhook-trigger 类型 skill 需要 `FEATURES.webhooks`
  - 在 `skills-execution.ts` 中保留执行功能（CE 核心功能）
**验收标准**: CE 模式下安装超过 5 个 skill 返回 403，webhook-trigger skill 安装返回 403，有对应测试
**依赖任务**: 无
**创建时间**: 2026-02-15
**完成时间**: 2026-02-15 04:09:44

---

### [completed] Settings 页面 CE 进一步简化 — 隐藏 AI Provider 切换和高级设置 ✅

**ID**: edition-006
**优先级**: P3
**阶段**: 阶段4-UI简化
**模块路径**: packages/dashboard/src/pages/
**任务描述**: `Settings.tsx` 已通过 `features.alerts` 隐藏 Preferences tab。但 CE 模式下还应简化 AI Provider 选项（CE 仅支持单个 provider，不需要运行时切换面板），并隐藏与多服务器相关的设置项。
**实现要点**:
  - CE 模式下隐藏 AI Provider 切换卡片（保留仅显示当前 provider 信息）
  - 隐藏 "Health Check" 按钮（CE 简化运维）
  - 在 `Settings.test.tsx` 中增加 CE 模式渲染测试
**验收标准**: CE 模式下 Settings 页面仅显示基础设置（密码修改、语言、主题），无 Provider 切换、无 Health Check，有测试覆盖
**依赖任务**: 无
**创建时间**: 2026-02-15
**完成时间**: 2026-02-15 04:16:21

---

### [completed] 共享包 edition 类型增加 CE 限制常量 — 统一限制定义 ✅

**ID**: edition-007
**优先级**: P1
**阶段**: 阶段1-基础设施
**模块路径**: packages/shared/src/
**任务描述**: CE 模式下的各种限制（如单服务器、单会话、最大 skill 数量等）分散在各个模块中硬编码。应在 `shared/src/edition.ts` 中统一定义 CE 限制常量，作为单一数据源。
**实现要点**:
  - 在 `shared/src/edition.ts` 中添加 `CE_LIMITS` 常量对象
  - 包含: `maxServers: 1`, `maxSessions: 1`, `maxSkills: 5`, `maxUsers: 1`
  - 添加 `EE_LIMITS` 常量（无限制或高阈值）
  - 在 `shared/src/edition.test.ts` 中添加对应测试
**验收标准**: `CE_LIMITS` 和 `EE_LIMITS` 定义在 shared 包中，server 和 dashboard 可导入使用，有测试覆盖
**依赖任务**: 无
**创建时间**: 2026-02-15
**完成时间**: 2026-02-15 04:23:20

---

### [completed] 补全 chat-sessions.ts 的 CE 限制测试 — 验证单会话行为 ✅

**ID**: edition-008
**优先级**: P1
**阶段**: 阶段2-后端保护
**模块路径**: packages/server/src/api/routes/
**任务描述**: `chat-session-ce-limit.test.ts` 已存在但需要验证是否覆盖了 `chat-sessions.ts` 路由（列表/删除/重命名）在 CE 模式下的行为，而不仅是 `chat.ts` 的消息发送路由。
**实现要点**:
  - 检查 `chat-session-ce-limit.test.ts` 是否覆盖 GET/DELETE/PATCH sessions 路由
  - 补充缺失的测试用例
  - 确保 mock `FEATURES.multiSession = false` 的场景完整
**验收标准**: 测试覆盖 CE 模式下所有 session CRUD 操作的行为，所有测试通过
**依赖任务**: edition-001
**创建时间**: 2026-02-15
**完成时间**: 2026-02-15 04:28:17

---

### [completed] 前端 Notifications 页面 CE 适配 — 隐藏 EE 通知类型 ✅

**ID**: edition-009
**优先级**: P3
**阶段**: 阶段4-UI简化
**模块路径**: packages/dashboard/src/pages/
**任务描述**: `Notifications.tsx` 展示告警和 webhook 相关通知，CE 模式下这些通知来源不存在。应在 CE 模式下简化通知页面，仅展示系统通知和对话通知。
**实现要点**:
  - 在 `Notifications.tsx` 中使用 `useFeatures()` 过滤 EE 通知类型
  - 隐藏告警、webhook 相关的通知分类 tab
  - 调整空状态提示文案
**验收标准**: CE 模式下 Notifications 页面无 alert/webhook 分类，仅展示系统和对话通知，`Notifications.test.tsx` 覆盖
**依赖任务**: 无
**创建时间**: 2026-02-15
**完成时间**: 2026-02-15 04:34:02

---

### [completed] 补全 Docker 构建参数支持 — EDITION build-arg 传递到运行时 ✅

**ID**: edition-010
**优先级**: P2
**阶段**: 阶段5-配置文档
**模块路径**: /
**任务描述**: `EDITION_MATRIX.md` 中定义了 Docker 构建命令使用 `--build-arg EDITION=ce/ee`，但当前 Dockerfile 可能未将 build-arg 转换为运行时环境变量。需要验证并修复 Dockerfile 中的 ARG → ENV 链路。
**实现要点**:
  - 检查现有 Dockerfile 是否有 `ARG EDITION` 和 `ENV EDITION=${EDITION}`
  - 如果缺失，添加 ARG → ENV 转换
  - 确保 `docker-compose.ce.yml` 和 `docker-compose.ee.yml` 的 environment 变量覆盖 build-arg
  - 更新 `build-binary.ts` 脚本支持 edition 参数
**验收标准**: `docker build --build-arg EDITION=ce` 正确传递到运行时，`docker-compose-ce.test.ts` 和 `docker-compose-ee.test.ts` 验证通过
**依赖任务**: 无
**创建时间**: 2026-02-15
**完成时间**: 2026-02-15 04:42:02

---

### [completed] CE 模式 Dashboard 默认路由优化 — 跳过服务器选择直接进入 Chat ✅

**ID**: edition-011
**优先级**: P2
**阶段**: 阶段4-UI简化
**模块路径**: packages/dashboard/src/
**任务描述**: `App.tsx` 已设置 CE 默认路由为 `/chat`，但 Chat 页面仍需要 `serverId` 参数。CE 模式下应自动使用本地服务器 ID，无需用户手动选择。当前 `Chat.tsx` 已有 CE 自动导航逻辑（line 93-97），但需要确保首次加载无服务器时也有优雅降级。
**实现要点**:
  - 确认 `Chat.tsx` 的 CE 自动导航逻辑覆盖所有边界情况（无服务器、服务器加载中）
  - CE 模式下 Chat 页面加载时显示 "连接本地服务器…" 加载状态
  - 确保 `/chat` 不带 serverId 时 CE 自动重定向到 `/chat/:localServerId`
**验收标准**: CE 用户访问 `/chat` 自动跳转到本地服务器对话，无需手动选择，Chat.test.tsx 有对应测试
**依赖任务**: 无
**创建时间**: 2026-02-15
**完成时间**: 2026-02-15 04:50:27

---

### [completed] E2E 测试扩展 — CE 完整用户旅程覆盖 ✅

**ID**: edition-012
**优先级**: P1
**阶段**: 阶段2-后端保护
**模块路径**: tests/
**任务描述**: `tests/e2e-ce-edition.test.ts` 已存在但需要验证其覆盖完整性。应确保覆盖以下 CE 用户旅程：登录 → 单服务器 → 单会话对话 → 命令执行 → 错误诊断 → 知识库搜索 → 设置修改。
**实现要点**:
  - 检查现有 `e2e-ce-edition.test.ts` 覆盖的场景
  - 补充缺失场景：CE 注册被拒、CE 会话限制、CE 服务器限制、EE 路由 403
  - 添加 CE → EE 升级路径测试（切换 EDITION 后功能解锁）
**验收标准**: E2E 测试覆盖 CE 全部核心功能和所有 EE 功能门控，测试全部通过
**依赖任务**: edition-001, edition-004
**创建时间**: 2026-02-15
**完成时间**: 2026-02-15 04:58:33

---

### [completed] 系统信息 API 增加 CE 限制信息 — GET /system/edition 返回 limits ✅

**ID**: edition-013
**优先级**: P2
**阶段**: 阶段2-后端保护
**模块路径**: packages/server/src/api/routes/
**任务描述**: `GET /api/v1/system/edition` 当前返回 `{ edition, features, version }`。应增加 `limits` 字段，返回 CE 模式下的资源限制（maxServers, maxSessions 等），便于前端展示升级提示。
**实现要点**:
  - 在 `system.ts` 的 `/edition` 响应中添加 `limits` 字段
  - 从 `shared/src/edition.ts` 导入 `CE_LIMITS` / `EE_LIMITS`
  - 更新 `system.test.ts` 验证新字段
  - 更新 `dashboard/src/stores/system.ts` 解析 limits 字段
**验收标准**: `/system/edition` 返回 limits 信息，前端 system store 能读取 limits，有测试覆盖
**依赖任务**: edition-007
**创建时间**: 2026-02-15
**完成时间**: 2026-02-15 05:06:29

---

### [completed] 前端升级引导组件增强 — CE 用户看到功能受限时展示升级路径 ✅

**ID**: edition-014
**优先级**: P3
**阶段**: 阶段4-UI简化
**模块路径**: packages/dashboard/src/components/common/
**任务描述**: `FeatureGate.tsx` 已实现基础升级卡片，但体验较简陋。应增强升级引导：在 Sidebar 底部显示 "升级到 EE" 常驻提示（CE 模式下），在被阻止的功能页面显示更具体的功能说明。
**实现要点**:
  - 在 `FeatureGate.tsx` 中增加 feature 到描述的映射（如 multiServer → "管理多台服务器"）
  - 在 `Sidebar.tsx` CE 模式下底部增加升级 CTA（当前已有 CE badge）
  - 使用 i18n 支持中英文升级提示
**验收标准**: CE 模式下被阻止功能页面显示具体说明，Sidebar 底部有明确升级引导，有测试覆盖
**依赖任务**: 无
**创建时间**: 2026-02-15
**完成时间**: 2026-02-15 05:14:17

---

### [completed] 补全 README 中 CE 快速上手指南 — 一键启动说明 ✅

**ID**: edition-015
**优先级**: P3
**阶段**: 阶段5-配置文档
**模块路径**: /
**任务描述**: `README.md` 已有版本对比表和基础启动说明。需要补充 CE 版本的 "5 分钟快速上手" 专门章节，包含：环境要求、一键 Docker 启动、默认凭据、首次使用流程。
**实现要点**:
  - 添加 "Quick Start (CE)" 章节
  - 包含 `docker-compose -f docker-compose.ce.yml up -d` 一键启动
  - 说明默认 admin 凭据
  - 添加首次使用截图描述（登录 → 对话 → 命令执行）
  - 添加 CE → EE 升级一句话说明
**验收标准**: README 有独立 CE 快速上手章节，新用户 5 分钟内可启动并使用
**依赖任务**: 无
**创建时间**: 2026-02-15
**完成时间**: 2026-02-15 05:18:54

---

### [completed] 运行全量测试并修复 CE/EE 相关测试回归 — 确保测试绿色 ✅

**ID**: edition-016
**优先级**: P0
**阶段**: 阶段1-基础设施
**模块路径**: /
**任务描述**: 在所有 edition 相关修改完成后，需要运行全量测试套件（server + dashboard + E2E），修复任何因 edition 改造引入的测试回归。确保 CE 和 EE 模式下测试均通过。
**实现要点**:
  - 运行 `pnpm test` 检查所有 server 测试
  - 运行 `pnpm --filter @aiinstaller/dashboard test` 检查所有 dashboard 测试
  - 检查 edition mock 是否影响非 edition 测试（`vi.mock` 泄漏问题）
  - 修复任何 import 路径变化导致的编译错误
**验收标准**: `pnpm test` 和 `pnpm --filter @aiinstaller/dashboard test` 全部通过，无回归
**依赖任务**: edition-001 ~ edition-015
**创建时间**: 2026-02-15
**完成时间**: 2026-02-15 05:25:31

### [completed] Settings 页面主题切换从 alerts Tab 中解耦 — CE 用户无法切换主题 ✅

**ID**: edition-001
**优先级**: P0
**阶段**: 阶段4-UI简化
**模块路径**: packages/dashboard/src/pages/Settings.tsx
**任务描述**: 当前主题选择器（深色/浅色/系统）被放在 `features.alerts` 条件渲染的 "preferences" Tab 内（第473-601行），导致 CE 版本用户完全无法切换主题。主题切换是 CE 的基础功能（EDITION_MATRIX.md 明确标注 ✅ 主题切换），必须从 EE-only 的 alerts Tab 中分离出来。
**实现要点**:
  - 将 Theme Card（第566-600行）从 `features.alerts` 条件块中移出
  - 方案A：将 Theme 放到 "account" Tab 的底部（与 Profile、Password 并列）
  - 方案B：新增一个独立的 "appearance" Tab（始终显示），包含 Theme + Language 设置
  - 保留 notifications 相关设置在 `features.alerts` 条件内（它们确实是 EE 功能）
  - 更新 Settings.test.tsx 验证 CE 模式下主题选择器可见
**验收标准**: CE 模式下用户能看到并使用主题切换功能；EE 模式下行为不变
**依赖任务**: 无
**创建时间**: 2026-02-15
**完成时间**: 2026-02-15 01:08:36

---

### [completed] README 添加 CE / EE 版本对比表格与双版本启动说明 ✅

**ID**: edition-002
**优先级**: P1
**阶段**: 阶段5-配置文档
**模块路径**: README.md
**任务描述**: README.md 目前没有 CE/EE 版本对比表格，用户无法直观了解两个版本的功能差异。需要在 "功能特性" 之后添加版本对比表格，并更新快速开始部分说明 CE/EE 两种部署方式。参考 EDITION_MATRIX.md 中定义的功能矩阵。
**实现要点**:
  - 在 "功能特性" 章节后添加 "## 版本对比" 子章节
  - 表格包含：功能名称 | Community (CE) | Cloud (EE) 三列
  - 列出所有功能项（AI 对话 ✅/✅、多服务器 ❌/✅ 等），与 EDITION_MATRIX.md 一致
  - 在 "快速开始" 章节区分 CE 部署（`docker-compose.ce.yml`）和 EE 部署（`docker-compose.ee.yml`）
  - 添加 CE → EE 升级说明（修改环境变量即可）
**验收标准**: README 包含清晰的功能对比表格；CE 和 EE 各有独立的启动命令示例
**依赖任务**: 无
**创建时间**: 2026-02-15
**完成时间**: 2026-02-15 01:12:50

---

### [completed] CE 单服务器模式自动选择 — Chat 页面无需手动选服务器 ✅

**ID**: edition-003
**优先级**: P1
**阶段**: 阶段3-前端系统
**模块路径**: packages/dashboard/src/pages/Chat.tsx
**任务描述**: CE 模式下只有一台本机服务器，但当前 Chat 页面仍需用户从服务器列表中选择目标服务器。CE 用户应该打开 Chat 页面后自动绑定到唯一的本机服务器，无需任何选择步骤。
**实现要点**:
  - 在 Chat.tsx 中检测 `isCE` 模式（通过 `useEdition()` hook）
  - CE 模式：自动调用 API 获取服务器列表 → 取第一台（唯一的）→ 自动设为 activeServerId
  - 隐藏 ChatHeader 中的服务器选择下拉框（CE 模式下不需要）
  - 如果 CE 模式下没有服务器，显示引导提示让用户先安装 Agent
  - EE 模式行为保持不变
**验收标准**: CE 用户打开 /chat 页面后自动进入对话（无服务器选择步骤）；EE 用户行为不受影响
**依赖任务**: 无
**创建时间**: 2026-02-15
**完成时间**: 2026-02-15 01:25:38

---

### [completed] CE 单服务器数量限制 — 后端拒绝创建第二台服务器 ✅

**ID**: edition-004
**优先级**: P1
**阶段**: 阶段2-后端保护
**模块路径**: packages/server/src/api/routes/servers.ts
**任务描述**: 虽然 CE 模式下 `requireFeature('multiServer')` 阻止了服务器列表/创建 API，但 Agent 首次连接时会自动注册服务器（绕过 REST API）。需要在 Agent 注册逻辑中增加 CE 服务器数量上限检查（最多 1 台），防止 CE 用户连接多个 Agent。
**实现要点**:
  - 在 WebSocket handler 中 Agent 注册/认证成功后，检查 `FEATURES.multiServer`
  - 如果是 CE 模式，查询当前用户已有服务器数量
  - 如果已有 1 台服务器且新 Agent 的 deviceId 不同，拒绝连接并发送错误消息
  - 允许同一台服务器的 Agent 重连（deviceId 匹配）
  - 添加明确的错误消息提示用户升级到 EE
**验收标准**: CE 模式下最多允许 1 台服务器的 Agent 连接；同一服务器重连不受限制；EE 无限制
**依赖任务**: 无
**创建时间**: 2026-02-15
**完成时间**: 2026-02-15 01:37:15

---

### [completed] CE 单会话限制 — 限制 Chat 会话数量为 1 个活跃会话 ✅

**ID**: edition-005
**优先级**: P2
**阶段**: 阶段2-后端保护
**模块路径**: packages/server/src/api/routes/chat-sessions.ts
**任务描述**: EDITION_MATRIX.md 定义 CE 版本只支持"单个对话会话"。当前 chat-sessions.ts 的会话创建 API 没有限制会话数量。需要在 CE 模式下限制每个用户每台服务器最多 1 个活跃会话。
**实现要点**:
  - 在 chat-sessions.ts 的会话创建逻辑中导入 `FEATURES` 检查 `multiServer`（或新增 `multiSession` 特性）
  - CE 模式下，创建新会话前检查已有会话数量
  - 如果已有 1 个会话，返回该会话（复用）而非创建新会话
  - 或者允许创建但自动归档旧会话（保留历史）
  - Dashboard 侧：CE 模式下 SessionSidebar 隐藏 "新建会话" 按钮
**验收标准**: CE 模式下用户只能有 1 个活跃对话会话；EE 用户无限制
**依赖任务**: 无
**创建时间**: 2026-02-15
**完成时间**: 2026-02-15 02:03:11

---

### [completed] Dashboard CE 模式升级提示组件 — 用户触达功能边界时显示升级引导 ✅

**ID**: edition-006
**优先级**: P2
**阶段**: 阶段3-前端系统
**模块路径**: packages/dashboard/src/components/common/
**任务描述**: 当 CE 用户尝试访问 EE 功能（如通过直接 URL 访问 /servers、/team 等）时，当前只会被路由重定向到 /chat。缺少友好的升级提示，用户不知道该功能存在但需要升级。需要创建一个 `FeatureGate` 组件，当功能不可用时显示升级说明。
**实现要点**:
  - 创建 `FeatureGate` 组件，接收 `feature: FeatureKey` 和 `children` props
  - 如果 feature 启用：渲染 children
  - 如果 feature 禁用：显示升级卡片（功能名称、简要描述、升级 CTA 按钮）
  - 在 App.tsx 中为 EE-only 路由使用 `<FeatureGate>` 包裹而非直接条件移除路由
  - 支持 i18n（中英文升级提示）
**验收标准**: CE 用户访问 EE 路由时看到友好的升级提示而非 404 或空白页
**依赖任务**: 无
**创建时间**: 2026-02-15
**完成时间**: 2026-02-15 02:10:19

---

### [completed] multiTenant 功能与 requireTenant 中间件联动 — CE 跳过租户检查 ✅

**ID**: edition-007
**优先级**: P1
**阶段**: 阶段2-后端保护
**模块路径**: packages/server/src/api/middleware/tenant.ts
**任务描述**: `requireTenant` 中间件目前仅在 team 路由上使用，但没有检查 `FEATURES.multiTenant`。CE 模式下不应有租户概念，`requireTenant` 应在 CE/非Cloud 模式下成为 pass-through（设置默认 tenantId 或跳过）。当前实现中 tenant.ts 有自动配置默认租户的逻辑，需要验证 CE 模式下是否正常工作。
**实现要点**:
  - 在 requireTenant 中间件头部检查 `FEATURES.multiTenant`
  - 如果 multiTenant 禁用：直接设置 tenantId 为 null 或 'default' 并 `await next()`
  - 避免 CE 模式下不必要的数据库查询（查找 tenant_id）
  - 确保 team 路由已有 `requireFeature('teamCollaboration')` 在 `requireTenant` 之前
  - 添加测试验证 CE 模式下中间件 pass-through 行为
**验收标准**: CE 模式下 requireTenant 不做实际租户查询；EE 模式行为不变
**依赖任务**: 无
**创建时间**: 2026-02-15
**完成时间**: 2026-02-15 02:15:37

---

### [completed] Admin 路由 Edition 保护 — 数据库维护功能 CE 可用性确认 ✅

**ID**: edition-008
**优先级**: P2
**阶段**: 阶段2-后端保护
**模块路径**: packages/server/src/api/routes/admin.ts
**任务描述**: `/api/v1/admin/db/vacuum` 和 `/api/v1/admin/db/status` 路由当前没有 Edition 检查。需要确认这些 DB 维护功能在 CE 模式下的可用性策略：CE 使用 SQLite 同样需要 VACUUM，所以这些应该是 CE 可用的。但需要验证并添加 edition 测试覆盖。
**实现要点**:
  - 确认 admin 路由在 CE 模式下应该可用（SQLite 也需要维护）
  - 创建 `admin-edition.test.ts` 测试文件
  - 验证 CE 模式下 `/admin/db/vacuum` 和 `/admin/db/status` 返回 200
  - 验证 EE 模式下同样返回 200
  - 确认 owner-only 权限约束在两种模式下都生效
**验收标准**: Admin 路由在 CE/EE 两种模式下都正常工作；有明确的 edition 测试覆盖
**依赖任务**: 无
**创建时间**: 2026-02-15
**完成时间**: 2026-02-15 02:20:14

---

### [completed] Sidebar CE 模式下显示 Edition 标识 — 用户知晓当前版本 ✅

**ID**: edition-009
**优先级**: P3
**阶段**: 阶段4-UI简化
**模块路径**: packages/dashboard/src/components/layout/Sidebar.tsx
**任务描述**: CE 用户应能在 UI 上明确看到当前运行的是 Community Edition，同时在 Sidebar 底部提供升级到 EE 的入口。这有助于品牌认知和升级转化。
**实现要点**:
  - 在 Sidebar 底部（Settings 下方）添加 Edition 标识
  - CE 模式：显示 "Community Edition" 文字 + "Upgrade to Cloud" 链接
  - EE 模式：显示 "Enterprise Edition" 文字（无升级链接）
  - 使用 `useEdition()` hook 获取当前版本
  - 升级链接指向 serverpilot.io（与 API client 中 FEATURE_DISABLED 消息一致）
  - 样式：小字灰色，不喧宾夺主
**验收标准**: Sidebar 底部可见当前版本标识；CE 模式有升级链接；EE 模式无升级链接
**依赖任务**: 无
**创建时间**: 2026-02-15
**完成时间**: 2026-02-15 02:25:22

---

### [completed] CE 模式下 OAuth 登录入口隐藏 — Login 页面条件渲染 ✅

**ID**: edition-010
**优先级**: P2
**阶段**: 阶段4-UI简化
**模块路径**: packages/dashboard/src/pages/Login.tsx
**任务描述**: CE 模式不支持 GitHub OAuth 登录（`features.oauthLogin = false`），但 Login 页面可能仍显示 "Login with GitHub" 按钮。需要在 Login 页面使用 `useFeatures()` 隐藏 OAuth 登录选项。
**实现要点**:
  - 在 Login.tsx 中引入 `useFeatures()` hook
  - 用 `features.oauthLogin` 条件渲染 GitHub OAuth 按钮
  - CE 模式下仅显示用户名/密码登录表单
  - EE 模式下同时显示密码登录和 OAuth 登录
  - 添加 Login.test.tsx 测试验证两种模式的渲染差异
**验收标准**: CE 模式登录页不显示 OAuth 按钮；EE 模式显示所有登录方式
**依赖任务**: 无
**创建时间**: 2026-02-15
**完成时间**: 2026-02-15 02:30:17

---

### [completed] E2E 测试覆盖 CE 用户完整旅程 — 从登录到 AI 对话 ✅

**ID**: edition-011
**优先级**: P2
**阶段**: 阶段5-配置文档
**模块路径**: tests/
**任务描述**: 当前 edition 测试主要是单元测试（路由级别 403/200 验证）。缺少 CE 模式下的 E2E 用户旅程测试：登录 → 自动跳转 /chat → 选择服务器 → 发送消息 → 收到响应。需要验证 CE 模式下完整流程可用。
**实现要点**:
  - 创建 `tests/e2e-ce-edition.test.ts`
  - 设置 `EDITION=ce` 环境变量
  - 测试用例：登录后重定向到 /chat（不是 /dashboard）
  - 测试用例：访问 /servers 返回 403 FEATURE_DISABLED
  - 测试用例：访问 /team 返回 403 FEATURE_DISABLED
  - 测试用例：/system/edition 返回 CE features（3 个 true）
  - 测试用例：正常发送 chat 消息成功
**验收标准**: CE E2E 测试全部通过；覆盖核心用户旅程和 EE 功能阻断
**依赖任务**: 无
**创建时间**: 2026-02-15
**完成时间**: 2026-02-15 02:49:01

---

### [completed] Docker Compose CE 配置优化 — 添加健康检查与 init-db 初始化 ✅

**ID**: edition-012
**优先级**: P3
**阶段**: 阶段5-配置文档
**模块路径**: docker-compose.ce.yml
**任务描述**: 当前 `docker-compose.ce.yml` 是基础版本，需要增强生产可用性：添加容器健康检查、数据卷持久化验证、环境变量默认值、init-db 初始化步骤。确保用户 `docker compose -f docker-compose.ce.yml up -d` 后开箱即用。
**实现要点**:
  - 添加 healthcheck（HTTP GET /api/v1/health）
  - 确保 data 目录 bind mount 正确（SQLite 持久化）
  - 添加 restart: unless-stopped
  - 环境变量添加合理默认值（EDITION=ce, CLOUD_MODE=false）
  - 添加 labels 标注版本信息
  - 更新 `tests/docker-compose-ce.test.ts` 验证新增配置
**验收标准**: `docker compose -f docker-compose.ce.yml up -d` 可直接启动并通过健康检查
**依赖任务**: 无
**创建时间**: 2026-02-15
**完成时间**: 2026-02-15 02:54:56

---

### [completed] CE 模式 Notifications 页面简化 — 移除 EE 专属通知类型 ✅

**ID**: edition-013
**优先级**: P3
**阶段**: 阶段4-UI简化
**模块路径**: packages/dashboard/src/pages/Notifications.tsx
**任务描述**: Notifications 页面在 CE 模式下可能显示与 EE 功能相关的通知类型（如 webhook 事件、团队邀请、告警触发等）。需要在 CE 模式下过滤掉 EE 专属的通知类型，只显示与 CE 功能相关的通知。
**实现要点**:
  - 在 Notifications.tsx 中引入 `useFeatures()` hook
  - 定义 EE-only 通知类型列表（webhook, alert, team-invite 等）
  - CE 模式下过滤掉 EE-only 类型的通知
  - 通知过滤器/类型选择器中也隐藏 EE-only 选项
  - 添加 Notifications.test.tsx 测试验证过滤逻辑
**验收标准**: CE 模式下 Notifications 页面不显示 EE 专属通知类型
**依赖任务**: 无
**创建时间**: 2026-02-15
**完成时间**: 2026-02-15 03:02:42

---

### [completed] shared 包 Edition 工具函数 — isCEFeature / isEEFeature 分类辅助 ✅

**ID**: edition-014
**优先级**: P3
**阶段**: 阶段1-基础设施
**模块路径**: packages/shared/src/edition.ts
**任务描述**: `shared/src/edition.ts` 目前只定义了类型。增加分类常量 `CE_FEATURES` 和 `EE_FEATURES` 数组，方便前后端统一判断某个 feature 属于哪个 edition。当前 server 和 dashboard 各自硬编码 feature 列表，容易不一致。
**实现要点**:
  - 在 `shared/src/edition.ts` 中添加 `CE_FEATURES: FeatureKey[]` 常量（chat, commandExecution, knowledgeBase）
  - 添加 `EE_FEATURES: FeatureKey[]` 常量（multiServer, teamCollaboration 等）
  - 添加 `CLOUD_FEATURES: FeatureKey[]` 常量（multiTenant, billing）
  - 添加 `isCEFeature(key)` / `isEEFeature(key)` 辅助函数
  - 更新 `shared/src/utils/token.test.ts` 或新建 `shared/src/edition.test.ts` 测试
  - 后续 server/dashboard 可引用这些常量替代硬编码
**验收标准**: shared 包导出 Feature 分类常量和辅助函数；通过测试验证分类正确
**依赖任务**: 无
**创建时间**: 2026-02-15
**完成时间**: 2026-02-15 03:14:46

### [completed] 创建 Edition 配置模块 — 定义 CE/EE 版本常量和 Feature Flags ✅

**ID**: edition-001
**优先级**: P0
**阶段**: 阶段1-基础设施
**模块路径**: packages/server/src/config/
**任务描述**: 创建 `packages/server/src/config/edition.ts`，定义 EDITION 和 FEATURES 常量，根据环境变量 `EDITION` 和 `CLOUD_MODE` 动态决定哪些功能可用。同时创建 `FeatureKey` 类型供中间件和路由使用。
**实现要点**:
  - 新建 `packages/server/src/config/edition.ts`，导出 `EDITION` 对象（isCE, isEE, isCloud）和 `FEATURES` 对象
  - FEATURES 包含：chat(always true), commandExecution(always true), knowledgeBase(always true), multiServer, teamCollaboration, webhooks, alerts, metricsMonitoring, auditExport, oauthLogin, rateLimiting, multiTenant, billing
  - 导出 `FeatureKey` 类型（FEATURES 的键名联合类型）
  - 导出 `isFeatureEnabled(key: FeatureKey): boolean` 辅助函数
  - 默认 EDITION=ce（未设置时视为 CE）
**验收标准**: `EDITION.isCE` 在无环境变量时返回 true；`FEATURES.multiServer` 在 CE 模式下返回 false，EE 模式下返回 true；类型安全，FeatureKey 限制合法功能名
**依赖任务**: 无
**创建时间**: 2026-02-14
**完成时间**: 2026-02-14 21:40:25

---

### [completed] 创建 Edition API 端点 — GET /api/v1/system/edition ✅

**ID**: edition-002
**优先级**: P0
**阶段**: 阶段1-基础设施
**模块路径**: packages/server/src/api/routes/
**任务描述**: 创建 `packages/server/src/api/routes/system.ts`，提供 `GET /api/v1/system/edition` 公开端点（无需认证），返回当前 edition 和 features 信息。前端在启动时调用此接口获取功能可用性。在 `routes/index.ts` 中注册新路由。
**实现要点**:
  - 新建 `packages/server/src/api/routes/system.ts`，导出 `systemRoute`
  - `GET /edition` 返回 `{ edition: 'ce'|'ee', features: Record<FeatureKey, boolean>, version: SERVER_VERSION }`
  - 此端点无需 requireAuth（公开信息）
  - 在 `routes/index.ts` 中 `v1.route('/system', systemRoute)` 注册
  - 编写单元测试验证 CE/EE 两种模式下的返回值
**验收标准**: `GET /api/v1/system/edition` 返回正确的 edition 和 features 对象；无需认证即可访问；测试覆盖两种模式
**依赖任务**: edition-001
**创建时间**: 2026-02-14
**完成时间**: 2026-02-14 21:48:48

---

### [completed] 创建 requireFeature 中间件 — 后端路由的 Feature 守卫 ✅

**ID**: edition-003
**优先级**: P0
**阶段**: 阶段1-基础设施
**模块路径**: packages/server/src/api/middleware/
**任务描述**: 创建 `packages/server/src/api/middleware/require-feature.ts`，提供 `requireFeature(feature: FeatureKey)` 中间件工厂函数。当请求的功能未启用时，返回 HTTP 403 和明确的错误消息（告知这是 EE 功能）。
**实现要点**:
  - 新建 `require-feature.ts`，导出 `requireFeature(feature: FeatureKey)` 返回 Hono MiddlewareHandler
  - 功能未启用时返回 `{ error: { code: 'FEATURE_DISABLED', message: 'This feature requires Enterprise Edition', feature } }` 和 403 状态码
  - 支持传入单个或多个 feature（任一启用即通过）
  - 编写单元测试：CE 模式下 EE 功能被拒绝；EE 模式下所有功能通过
**验收标准**: CE 模式访问 EE 路由返回 403 FEATURE_DISABLED；EE 模式正常通过；测试覆盖边界情况
**依赖任务**: edition-001
**创建时间**: 2026-02-14
**完成时间**: 2026-02-14 21:57:14

---

### [completed] 为 loadConfig 添加 edition 字段 — 入口文件读取 EDITION 环境变量 ✅

**ID**: edition-004
**优先级**: P0
**阶段**: 阶段1-基础设施
**模块路径**: packages/server/src/
**任务描述**: 在 `packages/server/src/index.ts` 的 `ServerConfig` 接口和 `loadConfig()` 函数中添加 `edition` 字段，并在 `startServer()` 中根据 edition 跳过 EE-only 服务的初始化（如 webhook dispatcher、alert evaluator、rate limiting、GitHub OAuth 等）。
**实现要点**:
  - `ServerConfig` 添加 `edition: 'ce' | 'ee'` 字段
  - `loadConfig()` 读取 `process.env.EDITION`，默认 `'ce'`
  - `startServer()` 中用 `FEATURES.xxx` 条件守卫 EE 服务的 start 调用：webhookDispatcher、alertEvaluator、metricsCleanupScheduler、GitHub OAuth init、rateLimitMiddleware
  - CE 模式下跳过的服务记录 info 日志："Skipping {service} (CE edition)"
**验收标准**: CE 模式下服务器正常启动，不初始化 EE 服务；EE 模式行为不变；启动日志中可见跳过的服务名
**依赖任务**: edition-001
**创建时间**: 2026-02-14
**完成时间**: 2026-02-14 22:06:38

---

### [completed] 保护多服务器管理路由 — servers 路由添加 requireFeature('multiServer') ✅

**ID**: edition-005
**优先级**: P1
**阶段**: 阶段2-后端保护
**模块路径**: packages/server/src/api/routes/
**任务描述**: 在 `packages/server/src/api/routes/servers.ts` 中为多服务器管理相关端点（列表、创建、删除、分组）添加 `requireFeature('multiServer')` 中间件。CE 模式下只保留对本地服务器的基本读取能力。
**实现要点**:
  - 在 servers.ts 的路由注册处，在 POST（创建）、DELETE（删除）以及 GET /（列表）路由前添加 `requireFeature('multiServer')`
  - CE 模式下保留 `GET /:id`（读取单个服务器详情，用于本地服务器）
  - CE 模式下保留 `GET /:id/profile`（用于 AI 对话上下文注入）
  - 在 `routes/index.ts` 中不需要修改（路由级别控制，不是整体移除）
**验收标准**: CE 模式下 POST /servers 返回 403 FEATURE_DISABLED；GET /servers/:id 仍可访问；EE 模式所有端点正常
**依赖任务**: edition-003
**创建时间**: 2026-02-14
**完成时间**: 2026-02-14 22:42:06

---

### [completed] 保护团队协作路由 — team 和 members 路由添加 requireFeature('teamCollaboration') ✅

**ID**: edition-006
**优先级**: P1
**阶段**: 阶段2-后端保护
**模块路径**: packages/server/src/api/routes/
**任务描述**: 在 `team.ts` 和 `members.ts` 路由文件中为所有端点添加 `requireFeature('teamCollaboration')` 中间件。CE 模式下团队邀请、成员管理功能完全不可用。
**实现要点**:
  - `team.ts`：在路由组最外层添加 `teamRoute.use('*', requireFeature('teamCollaboration'))`
  - `members.ts`：在路由组最外层添加 `membersRoute.use('*', requireFeature('teamCollaboration'))`
  - 编写测试验证 CE 模式下 POST /team/invite 返回 403
**验收标准**: CE 模式下所有 /team/* 和 /members/* 端点返回 403；EE 模式行为不变
**依赖任务**: edition-003
**创建时间**: 2026-02-14
**完成时间**: 2026-02-14 22:47:43

---

### [completed] 保护 Webhook 路由 — webhooks 路由添加 requireFeature('webhooks') ✅

**ID**: edition-007
**优先级**: P1
**阶段**: 阶段2-后端保护
**模块路径**: packages/server/src/api/routes/
**任务描述**: 在 `webhooks.ts` 路由文件中为所有端点添加 `requireFeature('webhooks')` 中间件。
**实现要点**:
  - `webhooks.ts`：在路由组最外层添加 `webhooksRoute.use('*', requireFeature('webhooks'))`
  - 编写测试验证 CE 模式下 POST /webhooks 返回 403
**验收标准**: CE 模式下所有 /webhooks/* 端点返回 403；EE 模式行为不变
**依赖任务**: edition-003
**创建时间**: 2026-02-14
**完成时间**: 2026-02-14 22:53:58

---

### [completed] 保护告警和指标路由 — alerts 和 metrics 路由添加 requireFeature ✅

**ID**: edition-008
**优先级**: P1
**阶段**: 阶段2-后端保护
**模块路径**: packages/server/src/api/routes/
**任务描述**: 在 `alerts.ts`、`alert-rules.ts` 路由文件中添加 `requireFeature('alerts')`，在 `metrics.ts` 中添加 `requireFeature('metricsMonitoring')` 中间件。
**实现要点**:
  - `alerts.ts`：添加 `alerts.use('*', requireFeature('alerts'))`
  - `alert-rules.ts`：添加 `alertRules.use('*', requireFeature('alerts'))`
  - `metrics.ts`：添加 `metricsRoutes.use('*', requireFeature('metricsMonitoring'))`
  - 编写测试验证 CE 模式下这些端点返回 403
**验收标准**: CE 模式下 /alerts/*、/alert-rules/*、/metrics/* 返回 403；EE 模式行为不变
**依赖任务**: edition-003
**创建时间**: 2026-02-14
**完成时间**: 2026-02-14 23:03:06

---

### [completed] 保护审计导出和 OAuth 路由 — audit-log 和 auth-github 添加 requireFeature ✅

**ID**: edition-009
**优先级**: P1
**阶段**: 阶段2-后端保护
**模块路径**: packages/server/src/api/routes/
**任务描述**: 在 `audit-log.ts` 的导出端点添加 `requireFeature('auditExport')`（保留基础查询），在 `auth-github.ts` 添加 `requireFeature('oauthLogin')` 中间件。
**实现要点**:
  - `audit-log.ts`：仅在 `/export` 路由上添加 `requireFeature('auditExport')`（基础审计日志查询 CE 也需要）
  - `auth-github.ts`：在路由组最外层添加 `authGitHub.use('*', requireFeature('oauthLogin'))`
  - 编写测试验证 CE 模式下 GET /audit-log/export 返回 403 但 GET /audit-log 正常
**验收标准**: CE 模式下审计导出返回 403 但查询正常；OAuth 登录返回 403；EE 模式行为不变
**依赖任务**: edition-003
**创建时间**: 2026-02-14
**完成时间**: 2026-02-14 23:09:00

---

### [completed] CE 模式下条件跳过 Rate Limiting 中间件 ✅

**ID**: edition-010
**优先级**: P1
**阶段**: 阶段2-后端保护
**模块路径**: packages/server/src/api/middleware/
**任务描述**: 修改 `createRateLimitMiddleware()` 或 `routes/index.ts` 中的挂载逻辑，使 CE 模式下不启用 Rate Limiting。CE 本地版单用户场景不需要限流。
**实现要点**:
  - 在 `routes/index.ts` 中，用 `FEATURES.rateLimiting` 条件守卫 rate-limit 中间件的挂载
  - `if (FEATURES.rateLimiting) { app.use('/api/v1/*', createRateLimitMiddleware()); }`
  - 或在 `rate-limit.ts` 中 `createRateLimitMiddleware()` 内部检查 FEATURES.rateLimiting，若 false 则返回 passthrough 中间件
  - 编写测试验证 CE 模式下不返回 X-RateLimit-* 响应头
**验收标准**: CE 模式下无 Rate Limiting 头；EE 模式行为不变；不影响现有测试
**依赖任务**: edition-001
**创建时间**: 2026-02-14
**完成时间**: 2026-02-14 23:14:35

---

### [completed] 创建前端 System Store — 获取并缓存 Edition 信息 ✅

**ID**: edition-011
**优先级**: P1
**阶段**: 阶段3-前端系统
**模块路径**: packages/dashboard/src/stores/
**任务描述**: 创建 `packages/dashboard/src/stores/system.ts` Zustand store，在应用启动时调用 `GET /api/v1/system/edition` 获取 edition 和 features 信息。提供 `isFeatureEnabled(key)` 方法供组件使用。
**实现要点**:
  - 新建 `stores/system.ts`，定义 `SystemState`：edition, features, isLoading, error
  - `fetchEdition()` 方法调用 `apiRequest('/system/edition')` 并缓存结果
  - 导出 `useSystemStore` 和 `useIsFeatureEnabled(key: string): boolean` selector
  - 首次加载时 features 默认为空对象（所有功能禁用），防止闪烁
  - 编写单元测试验证 store 行为
**验收标准**: Store 正确获取并缓存 edition 信息；`useIsFeatureEnabled('multiServer')` 在 CE 模式下返回 false；网络错误时优雅降级
**依赖任务**: edition-002
**创建时间**: 2026-02-14
**完成时间**: 2026-02-14 23:20:08

---

### [completed] 创建 useFeatures Hook — 前端 Feature 判断便捷 Hook ✅

**ID**: edition-012
**优先级**: P1
**阶段**: 阶段3-前端系统
**模块路径**: packages/dashboard/src/hooks/
**任务描述**: 创建 `packages/dashboard/src/hooks/useFeatures.ts`，提供 `useFeatures()` hook 返回所有 feature 的布尔值，以及 `useEdition()` 返回当前版本类型。基于 system store 的 selector。
**实现要点**:
  - 新建 `hooks/useFeatures.ts`
  - `useFeatures()` 返回 `{ multiServer: boolean, teamCollaboration: boolean, webhooks: boolean, ... }`
  - `useEdition()` 返回 `{ isCE: boolean, isEE: boolean, edition: 'ce'|'ee' }`
  - 从 `useSystemStore` 提取 features 对象，浅比较优化避免不必要重渲染
  - 编写单元测试验证各模式下的返回值
**验收标准**: Hook 在 CE 模式返回正确的 false 值；EE 模式返回 true；浅比较优化生效
**依赖任务**: edition-011
**创建时间**: 2026-02-14
**完成时间**: 2026-02-14 23:26:01

---

### [completed] 应用启动时获取 Edition 信息 — App.tsx 初始化 System Store ✅

**ID**: edition-013
**优先级**: P1
**阶段**: 阶段3-前端系统
**模块路径**: packages/dashboard/src/
**任务描述**: 修改 `packages/dashboard/src/App.tsx`，在应用启动时调用 `systemStore.fetchEdition()`，确保 edition 信息在路由渲染前就绑定。CE 模式下默认导航从 `/dashboard` 改为 `/chat`。
**实现要点**:
  - 在 App 组件顶部（或 MainLayout 中）添加 `useEffect` 调用 `fetchEdition()`
  - CE 模式下：`<Route index element={<Navigate to="/chat" replace />} />`（不显示 Dashboard）
  - 使用 `useEdition()` hook 判断模式
  - Edition 加载期间可显示全屏 loading spinner 避免路由闪烁
  - 编写测试验证 CE 模式重定向到 /chat
**验收标准**: CE 模式下首页直接导航到 /chat；EE 模式下导航到 /dashboard；加载过程中不闪烁
**依赖任务**: edition-012
**创建时间**: 2026-02-14
**完成时间**: 2026-02-14 23:36:19

---

### [completed] 侧边栏条件渲染 — CE 模式下隐藏 EE 功能导航项 ✅

**ID**: edition-014
**优先级**: P2
**阶段**: 阶段4-UI简化
**模块路径**: packages/dashboard/src/components/layout/
**任务描述**: 修改 `Sidebar.tsx`，使用 `useFeatures()` hook 根据 feature flag 条件显示/隐藏导航项。CE 模式下隐藏：Servers、Alerts、Webhooks、Team、Audit Log、Dashboard 等 EE 专属页面入口。
**实现要点**:
  - 在 `navItems` 数组中添加可选 `featureKey?: FeatureKey` 字段
  - Servers → `multiServer`，Alerts → `alerts`，Webhooks → `webhooks`，Team → `teamCollaboration`，Audit Log → `auditExport`（基础查询 CE 可用，但导航中隐藏简化 UI），Dashboard → `multiServer`
  - 渲染时用 `features[item.featureKey]` 过滤不可见项
  - CE 模式下侧边栏只显示：Chat、Knowledge、Tasks、Operations、Notifications、Skills、Settings
**验收标准**: CE 模式下侧边栏只显示 CE 功能入口；EE 模式显示全部导航项；无视觉闪烁
**依赖任务**: edition-012
**创建时间**: 2026-02-14
**完成时间**: 2026-02-14 23:41:47

---

### [completed] 路由保护 — CE 模式下移除 EE 专属页面路由 ✅

**ID**: edition-015
**优先级**: P2
**阶段**: 阶段4-UI简化
**模块路径**: packages/dashboard/src/
**任务描述**: 修改 `App.tsx` 路由配置，CE 模式下不注册 EE 专属页面路由（servers、alerts、webhooks、team、audit-log、dashboard），防止用户通过 URL 直接访问。
**实现要点**:
  - 使用 `useFeatures()` 在 Routes 内条件渲染 EE 路由
  - `{features.multiServer && <Route path="servers" ... />}`
  - `{features.multiServer && <Route path="dashboard" ... />}`
  - `{features.teamCollaboration && <Route path="team" ... />}`
  - `{features.webhooks && <Route path="webhooks" ... />}`
  - `{features.alerts && <Route path="alerts" ... />}`
  - EE 路由未注册时，访问这些 URL 会落入 `<Route path="*" element={<NotFound />} />`
**验收标准**: CE 模式下直接访问 /servers 显示 404；EE 模式下所有路由正常；测试覆盖
**依赖任务**: edition-012
**创建时间**: 2026-02-14
**完成时间**: 2026-02-14 23:49:47

---

### [completed] 设置页面简化 — CE 模式下隐藏通知偏好 Tab ✅

**ID**: edition-016
**优先级**: P2
**阶段**: 阶段4-UI简化
**模块路径**: packages/dashboard/src/pages/
**任务描述**: 修改 `Settings.tsx`，CE 模式下隐藏 "Preferences"（通知偏好）Tab，因为 CE 没有邮件通知和告警功能。保留 AI、Account、Knowledge 三个 Tab。
**实现要点**:
  - 使用 `useFeatures()` 获取 features
  - 条件渲染 Preferences TabsTrigger 和 TabsContent：`{features.alerts && <TabsTrigger value="preferences">...`
  - CE 模式下默认 Tab 仍然是 "ai"（无影响）
  - 编写测试验证 CE 模式下 Preferences Tab 不存在
**验收标准**: CE 模式下 Settings 页面只显示 3 个 Tab（AI、Account、Knowledge）；EE 模式显示全部 4 个 Tab
**依赖任务**: edition-012
**创建时间**: 2026-02-14
**完成时间**: 2026-02-15 00:04:43

---

### [completed] 前端 API 客户端 Edition 错误处理 — 识别 FEATURE_DISABLED 错误码 ✅

**ID**: edition-017
**优先级**: P2
**阶段**: 阶段4-UI简化
**模块路径**: packages/dashboard/src/api/
**任务描述**: 修改 `client.ts`，在 `ERROR_MESSAGES` 中添加 `FEATURE_DISABLED` 错误码的用户友好提示，引导用户了解 CE/EE 差异。
**实现要点**:
  - 在 `ERROR_MESSAGES` 对象中添加 `FEATURE_DISABLED: 'This feature is available in Enterprise Edition. Visit serverpilot.io for details.'`
  - 考虑在 i18n 中添加对应翻译键
  - 无需修改 apiRequest 逻辑（已有通用错误处理）
**验收标准**: CE 模式下访问 EE API 时，toast 显示友好的升级提示而非通用错误信息
**依赖任务**: edition-003
**创建时间**: 2026-02-14
**完成时间**: 2026-02-15 00:09:18

---

### [completed] 创建 CE 版本环境变量示例文件 — .env.ce.example ✅

**ID**: edition-018
**优先级**: P3
**阶段**: 阶段5-配置文档
**模块路径**: /
**任务描述**: 创建 `.env.ce.example` 文件，包含 CE 版本启动所需的最小环境变量集。移除 EE 专属配置（OAuth、Rate Limiting、多租户等）。
**实现要点**:
  - `EDITION=ce`
  - `CLOUD_MODE=false`
  - `SERVER_PORT=3000`
  - `AI_PROVIDER=claude` + `ANTHROPIC_API_KEY=`
  - `DATABASE_PATH=./data/serverpilot.db`
  - 不包含：`GITHUB_OAUTH_*`、`DB_TYPE=postgres`、Rate Limiting 相关
  - 添加注释说明每个变量的用途
**验收标准**: 用户复制 `.env.ce.example` 为 `.env` 后，只需填入 AI API Key 即可启动 CE 版本
**依赖任务**: edition-001
**创建时间**: 2026-02-14
**完成时间**: 2026-02-15 00:14:01

---

### [completed] 创建 EE 版本环境变量示例文件 — .env.ee.example ✅

**ID**: edition-019
**优先级**: P3
**阶段**: 阶段5-配置文档
**模块路径**: /
**任务描述**: 创建 `.env.ee.example` 文件，包含 EE 版本的完整环境变量集，包括 PostgreSQL、OAuth、Rate Limiting 等。
**实现要点**:
  - `EDITION=ee`
  - `CLOUD_MODE=true`
  - `DB_TYPE=postgres` + `DATABASE_URL=`
  - `GITHUB_OAUTH_CLIENT_ID=` + `GITHUB_OAUTH_CLIENT_SECRET=`
  - Rate Limiting、SMTP、Redis 等高级配置
  - 添加详细注释分区说明
**验收标准**: 文件清晰列出所有 EE 功能所需的环境变量；分区注释便于理解
**依赖任务**: edition-001
**创建时间**: 2026-02-14
**完成时间**: 2026-02-15 00:18:36

---

### [completed] 创建 CE 版 Docker Compose — docker-compose.ce.yml ✅

**ID**: edition-020
**优先级**: P3
**阶段**: 阶段5-配置文档
**模块路径**: /
**任务描述**: 创建 `docker-compose.ce.yml`，定义 CE 版本的最简 Docker 部署配置。单个容器运行 Server + Agent + Dashboard，SQLite 数据库。
**实现要点**:
  - 单个 `serverpilot` 服务，环境变量 `EDITION=ce`
  - 挂载 `./data:/app/data` 持久化 SQLite 数据
  - 端口映射 `3000:3000`
  - 不包含 PostgreSQL、Redis 等外部依赖
  - 添加 healthcheck 配置
**验收标准**: `docker-compose -f docker-compose.ce.yml up` 可一键启动 CE 版本；数据持久化正常
**依赖任务**: edition-001
**创建时间**: 2026-02-14
**完成时间**: 2026-02-15 00:24:13

---

### [completed] 创建 EE 版 Docker Compose — docker-compose.ee.yml ✅

**ID**: edition-021
**优先级**: P3
**阶段**: 阶段5-配置文档
**模块路径**: /
**任务描述**: 创建 `docker-compose.ee.yml`，定义 EE 版本的完整 Docker 部署配置。包含 PostgreSQL、Redis 等依赖服务。
**实现要点**:
  - `serverpilot-server` 服务 + `serverpilot-dashboard` 服务
  - `postgres` 服务（PostgreSQL 16）
  - `redis` 服务（用于会话管理）
  - 环境变量 `EDITION=ee`, `CLOUD_MODE=true`, `DB_TYPE=postgres`
  - Docker network、volume 配置
  - 健康检查和依赖关系
**验收标准**: `docker-compose -f docker-compose.ee.yml up` 可启动完整 EE 环境；服务依赖正确等待
**依赖任务**: edition-001
**创建时间**: 2026-02-14
**完成时间**: 2026-02-15 00:30:21

---

### [completed] Edition 基础设施单元测试 — 覆盖 edition.ts 和 require-feature 中间件 ✅

**ID**: edition-022
**优先级**: P1
**阶段**: 阶段1-基础设施
**模块路径**: packages/server/src/
**任务描述**: 为 edition 配置模块和 requireFeature 中间件编写全面的单元测试，覆盖 CE/EE 两种模式下的行为差异。
**实现要点**:
  - `config/edition.test.ts`：测试 EDITION 和 FEATURES 在不同环境变量下的值
  - `middleware/require-feature.test.ts`：测试中间件在 CE/EE 模式下的请求拦截行为
  - `routes/system.test.ts`：测试 GET /system/edition 的返回值
  - 使用 `vi.stubEnv()` 模拟不同环境变量
  - 覆盖边界情况：EDITION 未设置、EDITION 无效值、CLOUD_MODE 与 EDITION 组合
**验收标准**: 测试覆盖率 > 95%；CE/EE 两种模式均有充分测试；边界情况覆盖
**依赖任务**: edition-001, edition-002, edition-003
**创建时间**: 2026-02-14
**完成时间**: 2026-02-15 00:40:06

---

### [completed] 前端 Edition 系统单元测试 — 覆盖 system store 和 useFeatures hook ✅

**ID**: edition-023
**优先级**: P2
**阶段**: 阶段3-前端系统
**模块路径**: packages/dashboard/src/
**任务描述**: 为前端 system store 和 useFeatures hook 编写单元测试，验证 CE/EE 模式下 UI 行为的正确性。
**实现要点**:
  - `stores/system.test.ts`：测试 fetchEdition 成功/失败、isFeatureEnabled
  - `hooks/useFeatures.test.ts`：测试 hook 在不同 edition 下的返回值
  - Mock `apiRequest` 返回不同的 edition 响应
  - 测试 Sidebar 组件在 CE 模式下的导航项过滤
  - 测试 App.tsx 在 CE 模式下的路由重定向
**验收标准**: 前端测试覆盖率 > 90%；store、hook、组件三层均有测试
**依赖任务**: edition-011, edition-012, edition-014
**创建时间**: 2026-02-14
**完成时间**: 2026-02-15 00:51:20

---

### [completed] 在 shared 包中导出 Edition 类型 — 前后端共享 FeatureKey 类型 ✅

**ID**: edition-024
**优先级**: P1
**阶段**: 阶段1-基础设施
**模块路径**: packages/shared/src/
**任务描述**: 在 `@aiinstaller/shared` 中定义并导出 `EditionType`、`FeatureKey`、`EditionInfo` 类型，确保前后端对 edition 和 features 的类型定义一致。
**实现要点**:
  - 新建 `packages/shared/src/edition.ts`
  - 导出 `EditionType = 'ce' | 'ee'`
  - 导出 `FeatureKey` 类型（所有 feature flag 名的联合类型）
  - 导出 `EditionInfo` 接口 `{ edition: EditionType, features: Record<FeatureKey, boolean>, version: string }`
  - 导出 `FEATURE_KEYS` 常量数组（方便遍历）
  - 在 `shared/src/index.ts` 中 re-export
  - 重新构建 shared 包
**验收标准**: Server 和 Dashboard 都能从 @aiinstaller/shared 导入 edition 类型；类型安全一致
**依赖任务**: 无
**创建时间**: 2026-02-14
**完成时间**: 2026-02-15 00:58:04


---

## 使用说明

任务状态: `[pending]` → `[in_progress]` → `[completed]` / `[failed]`

## 参考架构

### 后端 Feature Flag 系统
```typescript
// packages/server/src/config/edition.ts
export const EDITION = {
  isCE: process.env.EDITION === 'ce',
  isEE: process.env.EDITION === 'ee',
} as const;

export const FEATURES = {
  multiServer: EDITION.isEE,
  teamCollaboration: EDITION.isEE,
  webhooks: EDITION.isEE,
  // ...
} as const;
```

### 前端条件渲染
```typescript
// Dashboard
const { features } = useFeatures();

{features.multiServer && <NavItem to="/servers" />}
```

### 路由保护
```typescript
// Middleware
const requireFeature = (feature: keyof typeof FEATURES) => {
  return async (c: Context, next: Next) => {
    if (!FEATURES[feature]) {
      return c.json({ error: 'Feature not available in this edition' }, 403);
    }
    await next();
  };
};
```
