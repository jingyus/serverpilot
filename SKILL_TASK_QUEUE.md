# Skill 插件系统开发任务队列

> 此队列专注于 Skill 插件系统的设计与实现
> AI 自动扫描 → 发现缺失 → 设计实现 → 验证

**最后更新**: 2026-02-13 10:26:21

## 📊 统计

- **总任务数**: 67
- **待完成** (pending): 6
- **进行中** (in_progress): 0
- **已完成** (completed): 61
- **失败** (failed): 0

## 📋 任务列表

### [completed] DB Schema + Migration + SkillRepository 数据层 ✅
### [completed] SkillEngine 拆分 — engine.ts 已达 800 行硬限制需重构 ✅

**ID**: skill-090
**优先级**: P0
**模块路径**: packages/server/src/core/skill/
**当前状态**: engine.ts 已达 798 行，触及 800 行硬限制，无任何增长空间。文件承担了生命周期管理、执行编排、查询、模板变量构建、清理调度等职责。
**实现方案**: 
1. 提取查询方法 (`listInstalled`, `listAvailable`, `getSkill`, `getStats`) 到新文件 `engine-queries.ts` (~70 行)
2. 提取模板变量构建 (`buildServerVars`, `buildSkillVars`) 到新文件 `engine-template-vars.ts` (~50 行)
3. 提取清理逻辑 (`cleanupOldExecutions`, `cleanupPendingConfirmations`, 定时器管理) 到新文件 `engine-cleanup.ts` (~40 行)
4. engine.ts 通过 import 委托调用，保留单例接口不变
5. 现有测试不需要修改（公共 API 不变）
**验收标准**: 
- engine.ts 降至 ≤640 行，预留增长空间
- 3 个新文件均 ≤200 行
- 所有现有 engine 相关测试继续通过
- 公共 API (`getSkillEngine()` 等) 不变
**影响范围**: packages/server/src/core/skill/engine.ts (拆分), 新建 engine-queries.ts, engine-template-vars.ts, engine-cleanup.ts
**创建时间**: 2026-02-13
**完成时间**: 2026-02-13 09:43:01

---

### [completed] Cron 触发熔断机制 — 防止失败 Skill 无限重试 ✅

**ID**: skill-091
**优先级**: P0
**模块路径**: packages/server/src/core/skill/
**当前状态**: trigger-manager.ts 对 cron 触发的 Skill 无失败跟踪。一个持续失败的 Skill 会每个 poll 周期 (60s) 不断重试，无退避、无熔断、无自动禁用。
**实现方案**: 
1. 在 `trigger-manager.ts` 添加 `failureCounters: Map<string, { consecutive: number; lastFailure: Date }>` 
2. 每次 cron 执行失败时递增 `consecutive`；成功时重置为 0
3. 当 `consecutive >= MAX_CONSECUTIVE_FAILURES` (默认 5) 时:
   - 调用 `getSkillRepository().updateStatus(skillId, 'error')` 自动暂停
   - 记录 warn 日志："Skill auto-paused after N consecutive failures"
   - 触发 `skill.auto_paused` webhook 事件通知用户
4. 添加 `resetFailureCounter(skillId)` 方法供手动恢复时调用
5. engine.ts 在 `updateStatus('enabled')` 时调用 `resetFailureCounter()`
**验收标准**: 
- 连续失败 5 次的 cron skill 自动进入 error 状态
- 成功执行后计数器归零
- 手动恢复后计数器归零
- 测试覆盖: ≥8 个测试用例
**影响范围**: packages/server/src/core/skill/trigger-manager.ts, packages/server/src/core/skill/trigger-manager.test.ts (或新建 trigger-manager-circuit-breaker.test.ts)
**创建时间**: 2026-02-13
**完成时间**: 2026-02-13 09:49:25

---

### [completed] skill-repository.ts 拆分 — InMemory 实现移至独立文件 ✅

**ID**: skill-092
**优先级**: P1
**模块路径**: packages/server/src/db/repositories/
**当前状态**: skill-repository.ts 已达 740 行 (92% 容量)，包含 Interface + DrizzleSkillRepository + InMemorySkillRepository + Stats 计算 + 单例管理。随功能增长将超 800 行限制。
**实现方案**: 
1. 提取 `InMemorySkillRepository` 类到 `skill-repository-memory.ts` (~220 行)
2. 提取 `computeStats()` 共享逻辑到 `skill-repository-stats.ts` (~70 行)
3. skill-repository.ts 只保留: Interface + DrizzleSkillRepository + 单例管理 (~450 行)
4. 更新所有 test 文件的 import 路径 (InMemory 从新文件导入)
**验收标准**: 
- skill-repository.ts 降至 ≤500 行
- InMemorySkillRepository 可独立导入
- 所有 repository 测试继续通过
**影响范围**: packages/server/src/db/repositories/skill-repository.ts (拆分), 新建 skill-repository-memory.ts, skill-repository-stats.ts
**创建时间**: 2026-02-13
**完成时间**: 2026-02-13 09:54:55

---

### [completed] Skill Dry-Run 预览模式 — 不实际执行命令的模拟运行 ✅

**ID**: skill-093
**优先级**: P1
**模块路径**: packages/server/src/core/skill/
**当前状态**: Skill 执行后立即调用 AI 自主循环并向 Agent 发送真实命令。无法在不产生副作用的情况下预览 Skill 的执行计划。当前唯一安全机制是 `requires_confirmation: true` 阻止自动触发。
**实现方案**: 
1. 在 `types.ts` 的 `SkillRunParams` 添加 `dryRun?: boolean` 字段
2. 在 `runner.ts` 的 `SkillRunner.run()` 中:
   - dryRun=true 时修改 system prompt，要求 AI "输出你计划执行的命令列表，但不要调用工具"
   - 设置 `max_steps: 0` 或从 tool_definitions 中移除 shell/write_file
3. 在 `runner-executor.ts` 中增加保底: dryRun 模式下所有副作用工具返回 `"[DRY RUN] Would execute: ..."`
4. engine.ts `execute()` 方法传递 dryRun 到 runner
5. API 路由 `POST /skills/:id/execute` 支持 `{ dryRun: true }` 参数
6. 执行记录的 triggerType 设为 `'dry-run'`
**验收标准**: 
- Dry-run 执行不产生任何副作用
- AI 返回计划执行的命令列表
- 执行记录中标记为 dry-run
- 测试覆盖: ≥10 个测试用例
**影响范围**: packages/server/src/core/skill/types.ts, runner.ts, runner-executor.ts, engine.ts (各改 <20 行)
**创建时间**: 2026-02-13
**完成时间**: 2026-02-13 10:16:01

---

### [completed] Skill Dry-Run API 端点 + Dashboard 支持 ✅

**ID**: skill-094
**优先级**: P1
**模块路径**: packages/server/src/api/routes/
**当前状态**: 后端 dry-run 功能实现后 (依赖 skill-093)，需要在 API 和 Dashboard 暴露此功能。
**实现方案**: 
1. `api/routes/skills.ts` 的 `POST /:id/execute` 端点解析 body 中 `dryRun: boolean` 字段
2. 将 dryRun 参数传递给 `engine.execute()`
3. 响应中标记 `{ dryRun: true }` 以便前端区分
**验收标准**: 
- API 支持 `POST /skills/:id/execute { dryRun: true }`
- 返回 dry-run 结果而非真实执行结果
- RBAC 权限与普通执行相同 (`skill:execute`)
- 测试覆盖: ≥5 个 API 测试
**影响范围**: packages/server/src/api/routes/skills.ts (改 <30 行)
**创建时间**: 2026-02-13
**完成时间**: 2026-02-13 10:26:21

---

### [pending] Dashboard Dry-Run UI — ExecuteDialog 添加预览按钮

**ID**: skill-095
**优先级**: P1
**模块路径**: packages/dashboard/src/components/skill/
**当前状态**: 依赖 skill-094 API 端点就绪后，Dashboard 需要暴露 dry-run 操作入口。
**实现方案**: 
1. `stores/skills.ts` 添加 `dryRunSkill(id: string, inputs?: Record<string, unknown>)` 方法
2. `components/skill/ExecuteDialog.tsx` 在"Execute"按钮旁添加"Preview"按钮
3. 点击 Preview → 调用 `dryRunSkill()` → 展示模拟结果 (命令列表，不执行)
4. 模拟结果复用 `ExecutionDetail.tsx` 展示，标注 `[DRY RUN]` 标签
**验收标准**: 
- ExecuteDialog 显示 "Preview" 按钮
- 点击 Preview 调用 dry-run API 并展示结果
- UI 明确标注结果为模拟 (非真实执行)
- 测试覆盖: ≥4 个组件测试
**影响范围**: packages/dashboard/src/stores/skills.ts, components/skill/ExecuteDialog.tsx (各改 <30 行)
**创建时间**: 2026-02-13
**完成时间**: -

---

### [pending] Skill 健康检查 — 定期验证已安装 Skill 完整性

**ID**: skill-096
**优先级**: P1
**模块路径**: packages/server/src/core/skill/
**当前状态**: 已安装 Skill 的验证仅在执行时触发 (on-demand)。如果 Skill 目录被删除、manifest 损坏或依赖缺失，直到下次执行才会发现。Cron Skill 可能静默失败。
**实现方案**: 
1. 在 engine.ts (拆分后) 添加 `healthCheck(): Promise<HealthCheckResult[]>` 方法:
   - 遍历所有 enabled skills
   - 检查 skillPath 目录是否存在
   - 尝试 loadSkillFromDir() 验证 manifest
   - 对比 DB 中 version 与磁盘 manifest version
   - 返回每个 skill 的健康状态: healthy / degraded / broken
2. 在 engine `start()` 中添加定期健康检查 (每 6 小时)
3. broken skill 自动标记为 `error` 状态 + warn 日志
4. API: `GET /api/v1/skills/health` 返回健康报告
**验收标准**: 
- 健康检查检测目录缺失、manifest 损坏、版本不匹配
- broken skill 自动降级到 error 状态
- 日志记录所有健康状态变化
- 测试覆盖: ≥10 个测试用例
**影响范围**: packages/server/src/core/skill/engine.ts (拆分后文件), 新建 engine-health.test.ts
**创建时间**: 2026-02-13
**完成时间**: -

---

### [pending] Skill 健康检查 API 端点

**ID**: skill-097
**优先级**: P1
**模块路径**: packages/server/src/api/routes/
**当前状态**: 依赖 skill-096 健康检查核心逻辑完成后，需暴露 REST API 端点。
**实现方案**: 
1. `api/routes/skills.ts` 添加 `GET /skills/health` 端点
2. 权限: `skill:manage` (admin/owner only)
3. 调用 `getSkillEngine().healthCheck()` 返回结果
4. 包含每个 skill 的: name, status, lastCheck, issues[]
**验收标准**: 
- GET /skills/health 返回所有已安装 skill 的健康状态
- 仅 admin/owner 可访问
- 测试覆盖: ≥4 个 API 测试
**影响范围**: packages/server/src/api/routes/skills.ts (增加 <30 行)
**创建时间**: 2026-02-13
**完成时间**: -

---

### [pending] Skill 导出为可分发归档包

**ID**: skill-098
**优先级**: P2
**模块路径**: packages/server/src/core/skill/
**当前状态**: Skill 安装仅支持 Git URL 和本地目录。无法将已安装的 Skill 打包为可分发的归档文件 (.tar.gz)，阻碍 Skill 在非 Git 环境中的分享。
**实现方案**: 
1. 新建 `core/skill/skill-archive.ts` (~150 行):
   - `exportSkill(skillId: string): Promise<{ filename: string; buffer: Buffer }>` 
   - 读取 skill 目录 → 验证 manifest → tar.gz 打包 (使用 Node.js `zlib` + `tar` 或内置 API)
   - 排除: .git/, node_modules/, *.test.*, .DS_Store
   - 文件名格式: `{name}-{version}.tar.gz`
2. `importSkill(buffer: Buffer, userId: string): Promise<InstalledSkill>`
   - 解压到临时目录 → 验证 manifest → 移动到 `skills/community/{name}/` → 调用 engine.install()
3. 对应测试文件 `skill-archive.test.ts`
**验收标准**: 
- 可导出 skill 为 .tar.gz
- 可从 .tar.gz 导入安装 skill
- 导入时验证 manifest schema
- 测试覆盖: ≥8 个测试用例
**影响范围**: 新建 packages/server/src/core/skill/skill-archive.ts, skill-archive.test.ts
**创建时间**: 2026-02-13
**完成时间**: -

---

### [pending] Skill 导出/导入 API 端点

**ID**: skill-099
**优先级**: P2
**模块路径**: packages/server/src/api/routes/
**当前状态**: 依赖 skill-098 归档功能完成后，需暴露 REST API。
**实现方案**: 
1. `api/routes/skills.ts` 添加:
   - `GET /skills/:id/export` → 返回 .tar.gz 文件 (Content-Type: application/gzip)
   - `POST /skills/import` → 接受 multipart/form-data 上传 → 调用 importSkill()
2. 权限: `skill:manage` (admin/owner only)
3. 文件大小限制: 10MB
**验收标准**: 
- 可通过 API 下载 skill 归档
- 可通过 API 上传归档安装 skill
- 测试覆盖: ≥6 个 API 测试
**影响范围**: packages/server/src/api/routes/skills.ts (增加 <50 行)
**创建时间**: 2026-02-13
**完成时间**: -

---

### [pending] Dashboard Skill 导出/导入 UI

**ID**: skill-100
**优先级**: P2
**模块路径**: packages/dashboard/src/
**当前状态**: 依赖 skill-099 API 就绪后，Dashboard 需要导出/导入操作入口。
**实现方案**: 
1. `stores/skills.ts` 添加 `exportSkill(id: string)` (blob download) 和 `importSkill(file: File)` 方法
2. `components/skill/SkillCard.tsx` 在操作菜单添加 "Export" 按钮
3. `pages/Skills.tsx` 的 "Installed" tab 添加 "Import Skill" 按钮 (文件上传)
4. 导入成功后自动刷新列表
**验收标准**: 
- SkillCard 可导出 Skill
- Skills 页面可上传导入 Skill
- 错误提示 (文件过大、格式错误) 正确显示
- 测试覆盖: ≥6 个测试用例
**影响范围**: packages/dashboard/src/stores/skills.ts, components/skill/SkillCard.tsx, pages/Skills.tsx (各改 <30 行)
**创建时间**: 2026-02-13
**完成时间**: -

# 无新增任务

所有 Skill 模块开发任务已完成 (56/56)。

## 扫描结果摘要

### ✅ P0 — 引擎核心 (全部完成)
- SkillEngine: `core/skill/engine.ts` — 单例服务 + 生命周期管理
- SkillLoader: `core/skill/loader.ts` — YAML 解析 + skill-schema 验证
- SkillRunner: `core/skill/runner.ts` — 完整 Agentic Loop + timeout + max_steps
- DB Schema: 4 表 (installed_skills, skill_executions, skill_execution_logs, skill_store) + 3 migrations
- SkillRepository: Drizzle + InMemory 双实现, 完整 CRUD + 状态管理 + 分析统计

### ✅ P1 — AI 执行层 (全部完成)
- SkillRunner: 6 种工具 (shell, read_file, write_file, notify, http, store)
- 安全集成: classifyCommand() 风险检查 + risk_level_max 约束 (runner-executor.ts)
- 审计集成: 所有命令记录到 audit_log
- 超时 & 步数限制: AbortController + max_steps 循环检查
- 用户确认: engine-confirmation.ts 高风险操作确认流程

### ✅ P2 — 触发系统 (全部完成)
- TriggerManager: `core/skill/trigger-manager.ts` — 统一触发调度
- Cron 触发: cron-parser v5.5.0, 60s 轮询
- Event 触发: WebhookDispatcher 事件桥接, 8 种事件类型
- Threshold 触发: MetricsBus 阈值监听, 6 种指标 + 6 种比较运算符
- 防抖: 5 分钟 per skill+server 去重

### ✅ P3 — API & Dashboard (全部完成)
- REST API: 16 个端点 (CRUD + execute + stream + analytics + upgrade + cancel)
- RBAC: skill:view (member), skill:execute (member), skill:manage (admin+owner)
- Dashboard: Skills.tsx 页面 (3 tab: Installed/Available/Analytics)
- 9 个 UI 组件: SkillCard, ExecuteDialog, ExecutionStream, ConfirmationBanner 等
- Sidebar 导航: Puzzle 图标, 位于 Webhooks 和 Team 之间
- Zustand Store: 完整状态管理 + SSE 流式推送

### ✅ P4 — 高级功能 (全部完成)
- Git 安装: git-installer.ts — Git URL 安装 + 升级保留配置
- 批量执行: batch-executor.ts — 多服务器并行执行
- SSE 事件流: skill-event-bus.ts — 实时执行进度推送
- 输出解析: output-parser.ts — AI 结构化输出提取
- 执行取消: AbortSignal 支持

### 测试覆盖
- 26 个测试文件, 300+ 测试用例
- 2 个集成测试文件 (1,319 行)
- 所有 Dashboard 组件均有对应 .test.tsx

### 仅存的次要问题 (非 Skill 模块)
- SKILL_TASK_QUEUE.md 末尾"后续任务预告"段落过时 (列出的 7 个任务已全部完成)
- packages/shared/src/protocol/version.ts 未提交 git (与 Skill 模块无关)

### [completed] Skill 版本升级 — engine.ts 添加 upgrade() 方法保留配置和执行历史 ✅

**ID**: skill-072
**优先级**: P0
**模块路径**: packages/server/src/core/skill/
**当前状态**: 升级 Skill 需要手动卸载再重新安装，卸载会级联删除执行历史和配置。`engine.ts` 无 `upgrade()` 方法，`git-installer.ts` 检测到目标目录存在时直接抛错。
**实现方案**: 
1. 在 `engine.ts` 添加 `upgrade(skillId: string, userId: string): Promise<InstalledSkill>` 方法:
   - 读取当前 skill 的 source/skillPath/config
   - 如果 source 是 git: 备份旧目录 → git clone 新版本到临时目录 → 验证 manifest → 替换旧目录 → 还原 config
   - 如果 source 是 local: 重新加载 skillPath 的 manifest → 更新 DB version/displayName
   - 保留 installed_skills 记录（更新 version, updatedAt），不删除 skill_executions
   - 暂停触发器 → 升级 → 重新注册触发器
2. 在 `git-installer.ts` 添加 `upgradeFromGitUrl(existingPath, gitUrl)` — clone 到临时目录 → 校验 → 原子替换
3. 对应测试: upgrade 成功保留配置、upgrade 失败回滚、version 变更验证
**验收标准**: 
- `engine.upgrade()` 方法可用，保留执行历史和用户配置
- Git 来源的 skill 支持原子升级（失败回滚）
- Local 来源的 skill 支持热加载新 manifest
- 测试覆盖: ≥12 个测试用例
**影响范围**: packages/server/src/core/skill/engine.ts, packages/server/src/core/skill/git-installer.ts, packages/server/src/core/skill/engine.test.ts (或新建 engine-upgrade.test.ts)
**创建时间**: 2026-02-13
**完成时间**: 2026-02-13 08:00:59

---

### [completed] Skill 升级 REST API + RBAC 权限 ✅

**ID**: skill-073
**优先级**: P0
**模块路径**: packages/server/src/api/routes/
**当前状态**: 无 `PUT /api/v1/skills/:id/upgrade` 端点，前端无法触发升级操作。
**实现方案**: 
1. 在 `skills.ts` 添加 `PUT /skills/:id/upgrade` 端点:
   - 中间件链: requireAuth → resolveRole → requirePermission('skill:manage')
   - 调用 `getSkillEngine().upgrade(id, userId)`
   - 返回更新后的 InstalledSkill
2. 添加对应路由测试: 权限检查、升级成功、升级失败(skill 不存在/非 git 来源)
**验收标准**: 
- `PUT /skills/:id/upgrade` 端点可用
- RBAC 权限检查通过 (skill:manage)
- 测试覆盖: ≥6 个测试用例
**影响范围**: packages/server/src/api/routes/skills.ts, packages/server/src/api/routes/skills.test.ts
**创建时间**: 2026-02-13
**完成时间**: 2026-02-13 08:05:12

---

### [completed] Skill 执行取消 — 运行中的执行可被用户中止 ✅

**ID**: skill-074
**优先级**: P0
**模块路径**: packages/server/src/core/skill/
**当前状态**: `runner.ts` 的 AbortController 仅用于超时，无法从外部取消。`engine.ts` 不跟踪运行中的执行实例。用户无法停止失控或长时间运行的 Skill。
**实现方案**: 
1. 在 `engine.ts` 添加 `private runningExecutions: Map<string, AbortController>`:
   - `executeSingle()` 开始时创建 AbortController 并存入 Map
   - 将 AbortController.signal 传递给 `runner.run()`
   - 执行完成/失败时从 Map 中移除
2. 在 `runner.ts` 的 `run()` 方法接受外部 `signal?: AbortSignal` 参数:
   - 与内部 timeout AbortController 合并 (使用 `AbortSignal.any()`)
   - 在 AI 调用循环和工具执行前检查 signal
3. 在 `engine.ts` 添加 `cancel(executionId: string): Promise<void>`:
   - 从 Map 中获取 AbortController → abort()
   - 更新 DB status 为 'cancelled'
   - 发布 SSE 'error' 事件
4. 对应测试
**验收标准**: 
- `engine.cancel(executionId)` 可中止运行中的执行
- 被取消的执行 DB 状态标记为 'cancelled'
- SSE 推送取消事件到前端
- 测试覆盖: ≥8 个测试用例
**影响范围**: packages/server/src/core/skill/engine.ts, packages/server/src/core/skill/runner.ts, packages/server/src/core/skill/engine.test.ts (或新建 engine-cancel.test.ts)
**创建时间**: 2026-02-13
**完成时间**: 2026-02-13 08:12:38

---

### [completed] Skill 执行取消 REST API 端点 ✅

**ID**: skill-075
**优先级**: P0
**模块路径**: packages/server/src/api/routes/
**当前状态**: 无 `POST /api/v1/skills/executions/:eid/cancel` 端点。
**实现方案**: 
1. 在 `skills.ts` 添加 `POST /skills/executions/:eid/cancel` 端点:
   - 中间件链: requireAuth → resolveRole → requirePermission('skill:execute')
   - 调用 `getSkillEngine().cancel(eid)`
   - 返回 `{ success: true }`
2. 添加对应路由测试: 权限检查、取消成功、取消失败(不存在/已完成)
**验收标准**: 
- `POST /skills/executions/:eid/cancel` 端点可用
- 非运行中的执行返回 400/404
- 测试覆盖: ≥5 个测试用例
**影响范围**: packages/server/src/api/routes/skills.ts, packages/server/src/api/routes/skills.test.ts
**创建时间**: 2026-02-13
**完成时间**: 2026-02-13 08:17:13

---

### [completed] Skill 执行历史自动清理 — 保留策略 + 定时清理 ✅

**ID**: skill-076
**优先级**: P1
**模块路径**: packages/server/src/core/skill/
**当前状态**: `skill_executions` 表记录无限增长，无清理机制。仅 pending confirmation 有 30 分钟 TTL。
**实现方案**: 
1. 在 `skill-repository.ts` 的 `SkillRepository` 接口添加:
   - `deleteExecutionsBefore(cutoff: Date): Promise<number>` — 按时间删除旧记录
   - `countExecutions(skillId?: string): Promise<number>` — 统计记录数
2. 在 `engine.ts` 的 `start()` 中启动清理定时器 (每 24 小时执行一次):
   - 默认保留策略: 保留最近 90 天的执行记录
   - 使用 `setInterval().unref()` 不阻塞进程退出
3. Drizzle + InMemory 两种实现
4. 对应测试
**验收标准**: 
- 超过 90 天的执行记录被自动清理
- 清理不影响运行中的执行
- 日志记录清理数量
- 测试覆盖: ≥8 个测试用例
**影响范围**: packages/server/src/db/repositories/skill-repository.ts, packages/server/src/core/skill/engine.ts, packages/server/src/db/repositories/skill-repository.test.ts
**创建时间**: 2026-02-13
**完成时间**: 2026-02-13 08:25:26

---

### [completed] Skill KV Store 总量限制 — 防止单个 Skill 占满数据库 ✅

**ID**: skill-077
**优先级**: P1
**模块路径**: packages/server/src/core/skill/
**当前状态**: `store.ts` 仅有单值 1MB 限制，无每 Skill 键数量或总存储量上限。一个 Skill 可以创建无限键值对填满数据库。
**实现方案**: 
1. 在 `store.ts` 添加常量:
   - `MAX_KEYS_PER_SKILL = 1000` — 每个 Skill 最多 1000 个键
   - `MAX_TOTAL_SIZE_PER_SKILL = 50 * 1024 * 1024` (50MB) — 每个 Skill 总存储上限
2. 在 `set()` 方法中:
   - 调用 `countKeys(skillId)` 检查键数量
   - 如果是新键且已达上限 → 抛出 `SkillStoreQuotaError`
3. Drizzle 实现: `SELECT COUNT(*) FROM skill_store WHERE skill_id = ?`
4. InMemory 实现: Map.size 检查
5. 对应测试
**验收标准**: 
- 超过 1000 键时 set() 抛出错误
- 更新已有键不受键数限制影响
- 测试覆盖: ≥6 个测试用例
**影响范围**: packages/server/src/core/skill/store.ts, packages/server/src/core/skill/store.test.ts
**创建时间**: 2026-02-13
**完成时间**: 2026-02-13 08:29:41

---

### [completed] Dashboard Skill 升级按钮 + 取消按钮 UI ✅

**ID**: skill-078
**优先级**: P1
**模块路径**: packages/dashboard/src/
**当前状态**: Dashboard 无升级和取消执行的 UI 入口。前端 `stores/skills.ts` 无 `upgradeSkill()` 和 `cancelExecution()` 方法。
**实现方案**: 
1. 在 `stores/skills.ts` 添加:
   - `upgradeSkill(id: string): Promise<void>` — PUT `/api/v1/skills/${id}/upgrade`
   - `cancelExecution(eid: string): Promise<void>` — POST `/api/v1/skills/executions/${eid}/cancel`
2. 在 `components/skill/SkillCard.tsx` 添加升级按钮 (仅 git source 的 skill 显示)
3. 在 `components/skill/ExecutionStream.tsx` 添加取消按钮 (仅 status=running 时显示)
4. 在 `types/skill.ts` 添加 `cancelled` 到 `SkillExecutionStatus` 枚举
5. 对应测试
**验收标准**: 
- Git 来源的 Skill 卡片显示「升级」按钮
- 运行中的执行流显示「取消」按钮
- 取消后 UI 立即更新状态
- 测试覆盖: ≥6 个测试用例
**影响范围**: packages/dashboard/src/stores/skills.ts, packages/dashboard/src/components/skill/SkillCard.tsx, packages/dashboard/src/components/skill/ExecutionStream.tsx, packages/dashboard/src/types/skill.ts
**创建时间**: 2026-02-13
**完成时间**: 2026-02-13 08:37:16

---

### [completed] Skill 执行日志持久化 — 步骤级别日志写入 DB ✅

**ID**: skill-079
**优先级**: P1
**模块路径**: packages/server/src/
**当前状态**: SSE 事件（step/log/error）仅通过内存 EventEmitter 传输，不持久化。断连后无法回看历史执行的详细步骤日志。虽然 `result.toolResults[]` 保存了工具调用记录，但 AI 的中间推理文本和 log 类事件丢失。
**实现方案**: 
1. 在 `db/schema.ts` 添加 `skill_execution_logs` 表:
   - `id`, `executionId`, `eventType` (step|log|error), `data` (JSON), `createdAt`
2. 创建 migration `0012_skill_execution_logs.sql`
3. 在 `skill-repository.ts` 添加 `appendLog(executionId, eventType, data)` 和 `getLogs(executionId)` 方法
4. 在 `skill-event-bus.ts` 的 `publish()` 中，对每个事件同时写入 DB (异步，不阻塞 SSE)
5. 在 API `GET /skills/:id/executions/:eid` 响应中包含 logs 数组
6. 对应测试
**验收标准**: 
- 所有 SSE 事件同时写入 `skill_execution_logs` 表
- 执行详情 API 返回完整日志列表
- DB 写入异步执行，不影响 SSE 延迟
- 测试覆盖: ≥10 个测试用例
**影响范围**: packages/server/src/db/schema.ts, packages/server/src/core/skill/skill-event-bus.ts, packages/server/src/db/repositories/skill-repository.ts
**创建时间**: 2026-02-13
**完成时间**: 2026-02-13 08:59:31

---

### [completed] Skill 执行日志持久化 — DB Migration ✅

**ID**: skill-080
**优先级**: P1
**模块路径**: packages/server/src/db/
**当前状态**: `skill_execution_logs` 表尚未创建，需要 migration 文件。
**实现方案**: 
1. 创建 `migrations/0012_skill_execution_logs.sql`:

### [completed] engine.test.ts 拆分 — 1689 行远超 800 行硬限制 ✅

**ID**: skill-068
**优先级**: P0
**模块路径**: packages/server/src/core/skill/
**当前状态**: `engine.test.ts` 1689 行，是 800 行硬限制的 2.1 倍。包含 14 个 describe 块，覆盖 lifecycle、install、uninstall、configure、updateStatus、execute、webhook dispatch、chain context、template variable injection、queries、singleton、listAvailable、full lifecycle、batch execution。
**实现方案**: 
1. 创建 `engine-execute.test.ts` — 提取 `SkillEngine.execute` (L513-719) + `SkillEngine batch execution` (L1381-end) + `SkillEngine template variable injection` (L918-1101) ≈ 600 行
2. 创建 `engine-webhook.test.ts` — 提取 `SkillEngine webhook dispatch` (L720-831) + `SkillEngine chain context` (L832-917) ≈ 200 行
3. 创建 `engine-queries.test.ts` — 提取 `SkillEngine queries` (L1102-1227) + `SkillEngine singleton` (L1228-1270) + `SkillEngine.listAvailable` (L1271-1312) + `SkillEngine full lifecycle` (L1313-1380) ≈ 400 行
4. 原 `engine.test.ts` 保留 lifecycle + install + uninstall + configure + updateStatus ≈ 500 行
5. 共享 mock 和 helpers 提取到 `engine-test-utils.ts`（如果需要避免重复）
**验收标准**: 
- `engine.test.ts` ≤ 550 行
- 3 个新测试文件各 ≤ 650 行
- 所有 414 个 skill 测试仍通过
- `pnpm vitest run packages/server/src/core/skill/engine` 无失败
**影响范围**: packages/server/src/core/skill/engine.test.ts, packages/server/src/core/skill/engine-execute.test.ts (新), packages/server/src/core/skill/engine-webhook.test.ts (新), packages/server/src/core/skill/engine-queries.test.ts (新)
**创建时间**: (自动填充)
**完成时间**: 2026-02-13 05:56:05

---

### [completed] runner.test.ts 拆分 — 1240 行超出 800 行硬限制 ✅

**ID**: skill-069
**优先级**: P0
**模块路径**: packages/server/src/core/skill/
**当前状态**: `runner.test.ts` 1240 行，超出硬限制 55%。包含 3 个顶层 describe: `parseTimeout` (L174)、`buildToolDefinitions` (L203)、`SkillRunner` (L244)。其中 `SkillRunner` 块占约 1000 行，是主要的 AI agentic loop 测试。
**实现方案**: 
1. 将 `parseTimeout` 和 `buildToolDefinitions` 测试已经在 `runner-tools.test.ts` (225 行) 中有独立覆盖 — 从 `runner.test.ts` 中删除这两个 describe 块（约 70 行），避免重复
2. 将 `SkillRunner` 按场景拆分: 创建 `runner-agentic-loop.test.ts` — 提取 AI 循环多步骤、超时、max_steps、SSE 事件发布等测试（约 500 行）
3. 原 `runner.test.ts` 保留基础运行、单步执行、安全拒绝、错误处理（约 650 行）
**验收标准**: 
- `runner.test.ts` ≤ 700 行
- `runner-agentic-loop.test.ts` ≤ 600 行
- 无重复测试（删除与 runner-tools.test.ts 重叠的用例）
- 所有测试仍通过
**影响范围**: packages/server/src/core/skill/runner.test.ts, packages/server/src/core/skill/runner-agentic-loop.test.ts (新)
**创建时间**: (自动填充)
**完成时间**: 2026-02-13 06:07:48

---

### [completed] trigger-manager.test.ts 拆分 — 1175 行超出 800 行硬限制 ✅

**ID**: skill-070
**优先级**: P0
**模块路径**: packages/server/src/core/skill/
**当前状态**: `trigger-manager.test.ts` 1175 行，超出硬限制 47%。包含 11 个 describe 块: lifecycle、cron triggers、event triggers、threshold triggers、debounce、register/unregister、singleton、error handling、chain triggers、startup loading、subscribeToDispatcher。
**实现方案**: 
1. 创建 `trigger-manager-triggers.test.ts` — 提取 `cron triggers` (L164-235) + `event triggers` (L236-344) + `threshold triggers` (L345-469) ≈ 400 行
2. 创建 `trigger-manager-advanced.test.ts` — 提取 `chain triggers` (L693-874) + `startup loading` (L875-1008) + `subscribeToDispatcher` (L1009-end) ≈ 400 行
3. 原 `trigger-manager.test.ts` 保留 lifecycle + debounce + register/unregister + singleton + error handling ≈ 400 行
**验收标准**: 
- 3 个文件各 ≤ 500 行
- 所有触发器相关测试仍通过
- `pnpm vitest run packages/server/src/core/skill/trigger-manager` 全部绿色
**影响范围**: packages/server/src/core/skill/trigger-manager.test.ts, packages/server/src/core/skill/trigger-manager-triggers.test.ts (新), packages/server/src/core/skill/trigger-manager-advanced.test.ts (新)
**创建时间**: (自动填充)
**完成时间**: 2026-02-13 06:16:28

---

### [completed] skill-integration.test.ts 拆分 — 1083 行超出 800 行硬限制 ✅

**ID**: skill-071
**优先级**: P0
**模块路径**: packages/server/src/core/skill/
**当前状态**: `skill-integration.test.ts` 1083 行，超出硬限制 35%。包含 8 个 describe 块: full lifecycle、SSE event streaming、TriggerManager integration、RBAC skill permission enforcement、error recovery、multi-step execution、chain depth/cycle detection、status transition validation。
**实现方案**: 
1. 创建 `skill-integration-advanced.test.ts` — 提取 `RBAC skill permission enforcement` (L672-814) + `error recovery` (L815-908) + `multi-step execution` (L909-1004) + `chain depth/cycle detection` (L1005-1054) + `status transition validation` (L1055-end) ≈ 450 行
2. 原 `skill-integration.test.ts` 保留 `full lifecycle` + `SSE event streaming` + `TriggerManager integration` ≈ 650 行
**验收标准**: 
- `skill-integration.test.ts` ≤ 700 行
- `skill-integration-advanced.test.ts` ≤ 500 行
- 所有集成测试通过
**影响范围**: packages/server/src/core/skill/skill-integration.test.ts, packages/server/src/core/skill/skill-integration-advanced.test.ts (新)
**创建时间**: (自动填充)
**完成时间**: 2026-02-13 06:20:41

---

### [completed] skills.test.ts (routes) 拆分 — 1031 行超出 800 行硬限制 ✅

**ID**: skill-072
**优先级**: P0
**模块路径**: packages/server/src/api/routes/
**当前状态**: `skills.test.ts` 1031 行，超出硬限制 29%。包含 14 个 describe 块覆盖所有 REST 端点: GET /skills、GET /skills/available、POST /skills/install、DELETE /:id、PUT /:id/config、PUT /:id/status、POST /:id/execute、GET /:id/executions、GET /:id/executions/:eid、RBAC integration、GET /pending-confirmations、POST /confirm、POST /reject、GET /stream。
**实现方案**: 
1. 创建 `skills-confirmation.test.ts` — 提取 `GET /pending-confirmations` (L806) + `POST /confirm` (L843) + `POST /reject` (L915) + `GET /stream` (L966) ≈ 250 行
2. 创建 `skills-rbac.test.ts` — 提取 `RBAC integration` (L704-805) ≈ 120 行，加入更多角色细分测试
3. 原 `skills.test.ts` 保留 CRUD + execute + executions 查询 ≈ 700 行
**验收标准**: 
- `skills.test.ts` ≤ 750 行
- 2 个新测试文件各 ≤ 400 行
- 所有 61 个路由测试仍通过
**影响范围**: packages/server/src/api/routes/skills.test.ts, packages/server/src/api/routes/skills-confirmation.test.ts (新), packages/server/src/api/routes/skills-rbac.test.ts (新)
**创建时间**: (自动填充)
**完成时间**: 2026-02-13 06:24:44

---

### [completed] runner-executor.test.ts 拆分 — 847 行超出 800 行硬限制 ✅

**ID**: skill-073
**优先级**: P0
**模块路径**: packages/server/src/core/skill/
**当前状态**: `runner-executor.test.ts` 847 行，略超 800 行硬限制。包含 8 个 describe 块: executeShell (196 行)、executeReadFile、executeWriteFile、executeNotify、executeHttp (111 行)、executeStore (129 行)、auditShell、executeTool dispatch。
**实现方案**: 
1. 创建 `runner-executor-network.test.ts` — 提取 `executeNotify` (L504-560) + `executeHttp` (L561-671) + `executeStore` (L672-800) ≈ 300 行
2. 原 `runner-executor.test.ts` 保留 `executeShell` + `executeReadFile` + `executeWriteFile` + `auditShell` + `executeTool dispatch` ≈ 550 行
**验收标准**: 
- `runner-executor.test.ts` ≤ 600 行
- `runner-executor-network.test.ts` ≤ 400 行
- 所有执行器测试通过
**影响范围**: packages/server/src/core/skill/runner-executor.test.ts, packages/server/src/core/skill/runner-executor-network.test.ts (新)
**创建时间**: (自动填充)
**完成时间**: 2026-02-13 06:28:36

---

### [completed] Dashboard Skill 组件测试补全 — AvailableSkillCard / ConfirmationBanner / ExecuteDialog ✅

**ID**: skill-074
**优先级**: P1
**模块路径**: packages/dashboard/src/components/skill/
**当前状态**: 8 个 Skill 组件中仅 5 个有测试 (SkillCard, SkillConfigModal, ExecutionHistory, ExecutionStream, ExecutionDetail)。`AvailableSkillCard.tsx` (76 行)、`ConfirmationBanner.tsx` (77 行)、`ExecuteDialog.tsx` (111 行) 共 264 行无测试覆盖。Dashboard 组件测试覆盖率 5/8 = 62.5%，低于 70% 标准。
**实现方案**: 
1. 创建 `AvailableSkillCard.test.tsx` — 测试: 名称/描述渲染、标签显示、安装按钮点击回调、loading 状态（约 5 个用例）
2. 创建 `ConfirmationBanner.test.tsx` — 测试: 待确认列表渲染、确认按钮回调、拒绝按钮回调、空列表不渲染（约 5 个用例）
3. 创建 `ExecuteDialog.test.tsx` — 测试: 服务器选择下拉、执行按钮回调、ExecutionStream 子组件挂载、关闭回调（约 5 个用例）
**验收标准**: 
- 3 个新测试文件共约 15 个测试用例
- 所有组件的核心交互被覆盖
- 使用 @testing-library/react + vitest 标准模式
- Skill 组件测试覆盖率达到 8/8 = 100%
**影响范围**: packages/dashboard/src/components/skill/AvailableSkillCard.test.tsx (新), packages/dashboard/src/components/skill/ConfirmationBanner.test.tsx (新), packages/dashboard/src/components/skill/ExecuteDialog.test.tsx (新)
**创建时间**: (自动填充)
**完成时间**: 2026-02-13 06:32:48

---

### [completed] run_as 执行身份约束实现 — SKILL_SPEC 已定义但后端完全未使用 ✅

**ID**: skill-075
**优先级**: P1
**模块路径**: packages/server/src/core/skill/runner-executor.ts
**当前状态**: 功能缺失 — `SKILL_SPEC.md` (line 157) 定义 `run_as: string` 约束，`shared/src/skill-schema.ts` (line 123) 已在 Zod schema 中验证此字段。但整个 `core/skill/` 目录中无任何 `run_as` 或 `runAs` 引用。当 Skill 声明 `run_as: root` 时，命令仍以 Agent 默认用户身份执行，不符合规范。
**实现方案**: 
1. 在 `runner-executor.ts` 的 `executeShell()` 方法中，当 `constraints.run_as` 有值时，将命令包装为 `sudo -u <run_as> -- <command>`（Linux）或相应的身份切换命令
2. 安全约束: `run_as` 为 `root` 时，自动将风险级别提升一级（yellow → red），需记入审计日志
3. 在 `runner.ts` 的 `run()` 方法中，从 manifest.constraints 读取 `run_as` 并传递给工具执行器
4. 在 `types.ts` 的 `SkillRunParams` 或工具执行上下文中添加 `runAs?: string` 字段
5. 测试: executeShell 有 run_as 时包装 sudo、run_as=root 风险提升、审计日志记录 run_as 信息
**验收标准**: 
- `run_as` 约束被读取并传递到命令执行层
- 命令被正确包装为身份切换形式
- `run_as: root` 触发风险等级提升
- 审计日志记录实际执行身份
- 测试 ≥ 6 个新增
**影响范围**: packages/server/src/core/skill/runner-executor.ts, packages/server/src/core/skill/runner.ts, packages/server/src/core/skill/types.ts, packages/server/src/core/skill/runner-executor.test.ts
**创建时间**: (自动填充)
**完成时间**: 2026-02-13 06:39:52

---

### [completed] Agent 版本检查实现 — requires.agent 字段被跳过 ✅

**ID**: skill-076
**优先级**: P2
**模块路径**: packages/server/src/core/skill/loader.ts
**当前状态**: 功能缺失 — `loader.ts` line 267-268 显示 `requires.agent` 被 `logger.debug('Agent version check deferred')` 跳过，永远不执行版本比较。SKILL_SPEC.md 定义了 `requires.agent: ">=1.0.0"` 语义版本约束，但 Agent 协议尚未标准化版本号格式。
**实现方案**: 
1. 在 Agent 认证时，要求 Agent 报告版本号（已有 `device.info` 或 `env.report` 中可能包含版本）
2. 在 `loader.ts` 的 `checkRequirements()` 中，通过 Server 的已连接 Agent 信息获取版本
3. 使用 SemVer 比较库（`semver` npm 包或手写简单比较）验证 `requires.agent` 约束
4. 如果 Agent 未报告版本，降级为警告（不阻断执行），而非静默跳过
5. 添加测试: 版本匹配通过、版本不匹配拒绝、无版本信息降级警告
**验收标准**: 
- `requires.agent` 约束被实际检查（非静默跳过）
- 版本不满足时返回明确的 `missing` 错误信息
- Agent 无版本时降级为 warning 而非 error
- 测试 ≥ 5 个新增
**影响范围**: packages/server/src/core/skill/loader.ts, packages/server/src/core/skill/loader.test.ts
**创建时间**: (自动填充)
**完成时间**: 2026-02-13 06:47:57

---

### [completed] Server 标签系统 — 支持 server_scope: 'tagged' 真正按标签筛选 ✅

**ID**: skill-077
**优先级**: P2
**模块路径**: packages/server/src/db/schema.ts, packages/server/src/core/skill/batch-executor.ts
**当前状态**: 功能缺失 — `batch-executor.ts` 在 `server_scope: 'tagged'` 时优雅降级到单服务器执行（产生 warning），但实际的标签筛选功能从未实现。`servers` 表无 `tags` 列，Dashboard 无标签管理 UI。
**实现方案**: 
1. 在 `db/schema.ts` 的 `servers` 表添加 `tags: text('tags')` 列（JSON string array）
2. 创建 migration `0012_server_tags.sql`
3. 在 `ServerRepository` 添加 `findByTags(userId, tags[])` 方法
4. 在 `batch-executor.ts` 中，scope='tagged' 时调用 `findByTags()` 替代降级逻辑
5. Skill manifest 的 `constraints.server_scope` 为 `'tagged'` 时，需要配合 `constraints.server_tags: string[]` 字段
6. 更新 `shared/src/skill-schema.ts` 添加 `server_tags` 约束字段
7. Dashboard: Server 详情页添加标签编辑 UI
8. 测试: findByTags 查询、batch-executor tagged 筛选、schema 验证
**验收标准**: 
- servers 表支持 tags 字段
- `server_scope: 'tagged'` 按标签真正筛选服务器
- Dashboard 可以给服务器添加/删除标签
- 至少 10 个新测试
**影响范围**: packages/server/src/db/schema.ts, packages/server/src/db/migrations/0012_server_tags.sql (新), packages/server/src/db/repositories/server-repository.ts, packages/server/src/core/skill/batch-executor.ts, packages/shared/src/skill-schema.ts, packages/dashboard/src/pages/ServerDetail.tsx
**创建时间**: (自动填充)
**完成时间**: 2026-02-13 07:36:10

---

### [completed] Skill 执行分析 Dashboard — 成功率、耗时趋势、热门 Skill 统计 ✅

**ID**: skill-078
**优先级**: P2
**模块路径**: packages/server/src/api/routes/skills.ts, packages/dashboard/src/pages/Skills.tsx
**当前状态**: 功能缺失 — 当前 Dashboard Skills 页面只有 "Installed" 和 "Available" 两个 tab，没有执行统计视图。`skill_executions` 表已有完整的执行记录（status、duration、stepsExecuted），但无聚合查询 API 和可视化展示。
**实现方案**: 
1. 新增 API: `GET /api/v1/skills/stats` — 返回聚合统计:
   - 总执行次数、成功率、平均耗时
   - 按 Skill 分组的执行次数排名 (top 5)
   - 按日期分组的执行趋势 (最近 30 天)
   - 按触发类型分组的分布 (manual/cron/event/threshold)
2. `SkillRepository` 添加 `getStats(userId, dateRange?)` 聚合方法
3. Dashboard: 在 Skills 页面添加第三个 tab "Analytics"，展示统计图表
4. 使用简单的 CSS 进度条或文本统计（不引入重量级图表库）
**验收标准**: 
- `/api/v1/skills/stats` 返回结构化统计数据
- Dashboard 展示执行成功率、平均耗时、Top Skills
- RBAC: `skill:view` 权限即可查看统计
- 测试 ≥ 8 个（API 3 + repo 3 + dashboard 2）
**影响范围**: packages/server/src/api/routes/skills.ts, packages/server/src/db/repositories/skill-repository.ts, packages/dashboard/src/pages/Skills.tsx, packages/dashboard/src/stores/skills.ts, packages/dashboard/src/types/skill.ts
**创建时间**: (自动填充)
**完成时间**: 2026-02-13 07:40:22

### [completed] Webhook 事件集成 — skill.completed/skill.failed 分发到 WebhookDispatcher ✅

**ID**: skill-060
**优先级**: P0
**模块路径**: packages/server/src/core/skill/engine.ts, packages/server/src/db/schema.ts
**当前状态**: 功能缺失 — SkillEngine 执行完成后仅通过 `emitTriggerEvent()` 通知 TriggerManager 做链式触发，未调用 `getWebhookDispatcher().dispatch()` 分发到外部 Webhook 订阅者。同时 `WebhookEventType` 联合类型不包含 `skill.completed` 和 `skill.failed`。
**实现方案**: 
1. 在 `packages/server/src/db/schema.ts` 的 `WebhookEventType` 联合类型中添加 `'skill.completed' | 'skill.failed'`
2. 在 `engine.ts` 的 `execute()` 方法中，成功/失败后调用 `getWebhookDispatcher().dispatch({ type, userId, data })` — 放在 `emitTriggerEvent()` 之后
3. 在 `executeConfirmed()` 方法中同样添加 webhook 分发
4. 对应更新 `engine.test.ts` — mock `getWebhookDispatcher()` 并验证 dispatch 被调用
5. 更新 `skills.test.ts` 路由测试中的 webhook 相关断言
**验收标准**: 
- Skill 执行成功时发出 `skill.completed` webhook 事件
- Skill 执行失败时发出 `skill.failed` webhook 事件  
- 用户可以在 Webhook 配置页面订阅这两个事件类型
- `engine.test.ts` 中有至少 2 个测试验证 webhook dispatch
**影响范围**: packages/server/src/db/schema.ts, packages/server/src/core/skill/engine.ts, packages/server/src/core/skill/engine.test.ts
**创建时间**: (自动填充)
**完成时间**: 2026-02-13 05:01:36

---

### [completed] engine.ts 文件拆分 — 提取 Confirmation Flow 到独立模块 ✅

**ID**: skill-061
**优先级**: P0
**模块路径**: packages/server/src/core/skill/
**当前状态**: `engine.ts` 793 行，逼近 800 行硬限制。Confirmation Flow（createPendingConfirmation, confirmExecution, rejectExecution, listPendingConfirmations, expirePendingConfirmations, executeConfirmed）占约 100 行，可独立为模块。
**实现方案**: 
1. 创建 `packages/server/src/core/skill/engine-confirmation.ts`（约 120 行）
2. 将 `createPendingConfirmation`, `confirmExecution`, `rejectExecution`, `listPendingConfirmations`, `expirePendingConfirmations`, `executeConfirmed` 方法提取为独立类 `SkillConfirmationManager`
3. `SkillConfirmationManager` 接收 `SkillRepository` 和 `execute` 回调作为依赖注入
4. `engine.ts` 中组合 `SkillConfirmationManager` 实例，委托调用
5. 对应测试拆分到 `engine-confirmation.test.ts`
6. 目标：`engine.ts` 降至 650 行以下
**验收标准**: 
- `engine.ts` ≤ 650 行
- `engine-confirmation.ts` ≤ 200 行
- 所有现有 engine 测试通过不变
- Confirmation 相关测试迁移到独立测试文件
**影响范围**: packages/server/src/core/skill/engine.ts, packages/server/src/core/skill/engine-confirmation.ts (新), packages/server/src/core/skill/engine-confirmation.test.ts (新)
**创建时间**: (自动填充)
**完成时间**: 2026-02-13 05:15:14

---

### [completed] Pending Confirmation 过期自动清理定时器 ✅

**ID**: skill-062
**优先级**: P1
**模块路径**: packages/server/src/core/skill/engine.ts, packages/server/src/index.ts
**当前状态**: `expirePendingConfirmations()` 方法已实现但从未被定时调用。Pending confirmation 会无限积累，不会自动过期清理。
**实现方案**: 
1. 在 `SkillEngine.start()` 方法中添加 `setInterval` 定时器，每 10 分钟调用 `this.expirePendingConfirmations()`
2. 定时器句柄保存为 `private confirmationCleanupTimer: NodeJS.Timeout | null`
3. `stop()` 方法中 `clearInterval(this.confirmationCleanupTimer)`
4. 定时器使用 `.unref()` 避免阻止进程退出
5. 添加日志记录过期清理的数量
6. 添加对应测试 — 验证定时器启停和清理调用
**验收标准**: 
- `start()` 启动后自动每 10 分钟清理过期 pending confirmations
- `stop()` 正确清除定时器
- 清理结果有日志输出
- 至少 2 个测试验证定时器行为
**影响范围**: packages/server/src/core/skill/engine.ts, packages/server/src/core/skill/engine.test.ts
**创建时间**: (自动填充)
**完成时间**: 2026-02-13 05:17:46

---

### [completed] server_scope: 'tagged' 优雅降级替代硬错误 ✅

**ID**: skill-063
**优先级**: P1
**模块路径**: packages/server/src/core/skill/batch-executor.ts
**当前状态**: `batch-executor.ts` 第 59-62 行 `server_scope: 'tagged'` 时直接 `throw new Error()`，导致整个 Skill 执行失败。应改为优雅降级到单服务器模式。
**实现方案**: 
1. 将 `throw new Error(...)` 替换为 `logger.warn(...)` 日志警告
2. 当 scope 为 `tagged` 时，回退到 `params.serverId` 单服务器执行
3. 在返回的 `BatchExecutionResult` 中添加 `warnings?: string[]` 字段，记录降级信息
4. 更新 `types.ts` 中 `BatchExecutionResult` 类型定义
5. 创建 `batch-executor.test.ts` 测试文件，覆盖 scope='all'、scope='tagged' 降级、空服务器列表、部分失败等场景
**验收标准**: 
- `server_scope: 'tagged'` 不再抛出异常
- 降级时产生 warning 日志 + 返回 warnings 数组
- 回退到 `params.serverId` 单服务器执行并成功完成
- `batch-executor.test.ts` 至少 8 个测试用例
**影响范围**: packages/server/src/core/skill/batch-executor.ts, packages/server/src/core/skill/types.ts, packages/server/src/core/skill/batch-executor.test.ts (新)
**创建时间**: (自动填充)
**完成时间**: 2026-02-13 05:23:17

---

### [completed] RBAC 权限修正 — skill:execute 应包含 member 角色 ✅

**ID**: skill-064
**优先级**: P1
**模块路径**: packages/shared/src/rbac.ts
**当前状态**: 开发规范定义 `skill:execute` 应授予 member+admin+owner，但实际代码中 `skill:execute` 仅在 `ADMIN_PERMISSIONS` 数组中（第 150 行），member 角色只有 `skill:view`。这意味着普通成员无法手动执行 Skill。
**实现方案**: 
1. 在 `packages/shared/src/rbac.ts` 的 `MEMBER_PERMISSIONS` 数组中添加 `'skill:execute'`（在 `'skill:view'` 之后）
2. 从 `ADMIN_PERMISSIONS` 中移除 `'skill:execute'`（因为 admin 已继承 member 权限）
3. 更新 `packages/shared/src/rbac.test.ts` — 添加显式测试验证 member 拥有 skill:execute
4. 重新构建 shared 包 (`pnpm --filter @aiinstaller/shared build`)
5. 验证 routes 测试中 member 用户可以执行 skill
**验收标准**: 
- member 角色拥有 `skill:view` + `skill:execute` 权限
- admin 角色拥有 `skill:view` + `skill:execute` + `skill:manage` 权限
- owner 继承所有权限
- rbac 测试验证三个角色的 skill 权限分配
**影响范围**: packages/shared/src/rbac.ts, packages/shared/src/rbac.test.ts
**创建时间**: (自动填充)
**完成时间**: 2026-02-13 05:27:19

---

### [completed] Skills.tsx 页面组件拆分 — 降至 500 行以下 ✅

**ID**: skill-065
**优先级**: P1
**模块路径**: packages/dashboard/src/pages/Skills.tsx, packages/dashboard/src/components/skill/
**当前状态**: `Skills.tsx` 693 行，超过 500 行软限制。页面内嵌了 `ExecuteDialog`、`ConfirmationBanner`、`AvailableSkillCard` 等内联组件定义，应提取到独立文件。
**实现方案**: 
1. 提取 `ExecuteDialog` 组件到 `components/skill/ExecuteDialog.tsx`（约 80 行）
2. 提取 `ConfirmationBanner` 组件到 `components/skill/ConfirmationBanner.tsx`（约 50 行）
3. 提取 `AvailableSkillCard` 组件到 `components/skill/AvailableSkillCard.tsx`（约 60 行）
4. `Skills.tsx` 仅保留页面级布局和 tab 切换逻辑
5. 目标：`Skills.tsx` ≤ 450 行
**验收标准**: 
- `Skills.tsx` ≤ 450 行
- 各提取组件 ≤ 150 行
- `Skills.test.tsx` 所有现有测试通过
- 无视觉回归（组件行为不变）
**影响范围**: packages/dashboard/src/pages/Skills.tsx, packages/dashboard/src/components/skill/ (3 个新文件)
**创建时间**: (自动填充)
**完成时间**: 2026-02-13 05:30:38

---

### [completed] Dashboard Skill 组件测试补全 — SkillCard / SkillConfigModal / ExecutionHistory / ExecutionStream ✅

**ID**: skill-066
**优先级**: P2
**模块路径**: packages/dashboard/src/components/skill/
**当前状态**: 6 个 Skill 组件中仅 `ExecutionDetail` 有测试文件。`SkillCard`（129 行）、`SkillConfigModal`（228 行）、`ExecutionHistory`（146 行）、`ExecutionStream`（166 行）均无测试。Dashboard 组件测试覆盖率低于 70% 标准。
**实现方案**: 
1. 创建 `SkillCard.test.tsx` — 测试状态 toggle、配置按钮、执行按钮、卸载确认（约 8 个用例）
2. 创建 `SkillConfigModal.test.tsx` — 测试各输入类型渲染（string/number/boolean/enum/string[]）、表单提交、校验（约 10 个用例）
3. 创建 `ExecutionHistory.test.tsx` — 测试列表渲染、状态 badge、时间格式、空状态（约 6 个用例）
4. 创建 `ExecutionStream.test.tsx` — 测试 SSE 连接、事件渲染、完成/错误状态（约 6 个用例）
**验收标准**: 
- 4 个新测试文件共约 30 个测试用例
- 所有组件的核心交互和渲染路径被覆盖
- 使用 @testing-library/react 标准模式
- UI 测试覆盖率达到 70%+
**影响范围**: packages/dashboard/src/components/skill/ (4 个新测试文件)
**创建时间**: (自动填充)
**完成时间**: 2026-02-13 05:37:09

---

### [completed] batch-executor.ts 单元测试 ✅

**ID**: skill-067
**优先级**: P2
**模块路径**: packages/server/src/core/skill/batch-executor.test.ts (新)
**当前状态**: `batch-executor.ts`（144 行）是唯一没有对应测试文件的核心 Skill 模块。`skill-integration.test.ts` 可能有部分覆盖，但无独立的单元测试。
**实现方案**: 
1. 创建 `batch-executor.test.ts`
2. mock `getServerRepository()` 返回不同数量的服务器
3. 测试用例：
   - scope='all' 正常执行 3 台服务器
   - scope='all' 空服务器列表返回空结果
   - 部分服务器失败不影响其余服务器
   - 单台服务器异常被正确 catch 并记录
   - successCount/failureCount 计数正确
   - batchId 唯一性
4. 使用 vi.fn() mock `executeSingleFn` 回调
**验收标准**: 
- 至少 8 个测试用例
- 覆盖成功、失败、部分失败、空列表所有路径
- mock 模式与 skill-integration.test.ts 一致
**影响范围**: packages/server/src/core/skill/batch-executor.test.ts (新)
**创建时间**: (自动填充)
**完成时间**: 2026-02-13 05:39:01

### [completed] runner-tools.test.ts — 工具定义构建 & 安全工具函数单元测试 ✅

**ID**: skill-023
**优先级**: P0
**模块路径**: packages/server/src/core/skill/
**当前状态**: 文件不存在 — `runner-tools.ts` (222 行) 包含 `parseTimeout()`、`exceedsRiskLimit()`、`buildToolDefinitions()` 三个关键导出函数，均无任何测试覆盖。`exceedsRiskLimit` 是安全核心函数（决定命令是否被拒绝），按项目标准安全模块需 95%+ 覆盖率
**实现方案**:
创建 `runner-tools.test.ts`，覆盖以下场景:
1. **parseTimeout** (~8 tests):
   - 正常解析: "30s"→30000, "5m"→300000, "1h"→3600000
   - 边界值: "0s"→0, "999h"
   - 错误格式: "5x", "abc", "", "5", "m5" → 抛出 Error
2. **exceedsRiskLimit** (~8 tests):
   - green/yellow/red/critical/forbidden 之间的所有组合比较
   - 边界: 相同级别不超限, forbidden 永远超限
3. **buildToolDefinitions** (~8 tests):
   - 单工具: ['shell'] → 只有 shell 定义
   - 多工具: ['shell', 'read_file', 'store'] → 3 个定义
   - 全工具: 6 种工具全部声明 → 6 个完整定义
   - 验证每个工具定义的 name、input_schema 字段完整性
**验收标准**:
- 测试 ≥ 22 个，覆盖所有导出函数
- `pnpm vitest run packages/server/src/core/skill/runner-tools.test.ts` 全部通过
**影响范围**:
- `packages/server/src/core/skill/runner-tools.test.ts` (新建)
**创建时间**: (自动填充)
**完成时间**: 2026-02-13 03:15:46

---

### [completed] runner-executor.test.ts — 6 种工具执行器单元测试 + 安全审计验证 ✅

**ID**: skill-024
**优先级**: P0
**模块路径**: packages/server/src/core/skill/
**当前状态**: 文件不存在 — `runner-executor.ts` (414 行) 实现了 `executeShell`、`executeReadFile`、`executeWriteFile`、`executeNotify`、`executeHttp`、`executeStore` 六个工具执行方法，以及 `auditShell` 审计辅助函数。这些是 Skill 命令执行的最终出口，涉及安全分级 (`classifyCommand`)、审计日志 (`getAuditLogger`)、Agent 通信 (`getTaskExecutor`)，完全无测试覆盖
**实现方案**:
创建 `runner-executor.test.ts`，Mock 外部依赖 (TaskExecutor, AuditLogger, WebhookDispatcher, SkillKVStore, Agent):
1. **executeShell** (~10 tests):
   - 正常执行: command → classifyCommand → 安全通过 → Agent 执行 → 返回 stdout
   - 安全拒绝: red 命令 + yellow max → isError=true + blocked 消息
   - forbidden 命令永远拒绝
   - 审计日志: 每次 shell 调用都记录到 auditLogger
   - Agent 未连接: 返回错误信息
2. **executeReadFile** (~3 tests): 路径正常/Agent 错误/空文件
3. **executeWriteFile** (~3 tests): 写入成功/Agent 错误/空内容
4. **executeNotify** (~3 tests): 正常分发/dispatcher 异常/缺少参数
5. **executeHttp** (~4 tests): GET/POST 成功, 超时, 非 200 响应
6. **executeStore** (~4 tests): get/set/delete/list 操作
7. **auditShell** (~2 tests): 记录格式正确, 包含 skillId/serverId/command
**验收标准**:
- 测试 ≥ 28 个，覆盖所有 6 种执行器 + 审计函数
- 安全相关测试验证 `classifyCommand()` 与 `exceedsRiskLimit()` 的联动
- `pnpm vitest run packages/server/src/core/skill/runner-executor.test.ts` 全部通过
**影响范围**:
- `packages/server/src/core/skill/runner-executor.test.ts` (新建)
**创建时间**: (自动填充)
**完成时间**: 2026-02-13 03:18:48

---

### [completed] Prompt 模板变量注入缺失 — engine.ts 未传递 server/skill 上下文 ✅

**ID**: skill-025
**优先级**: P0
**模块路径**: packages/server/src/core/skill/engine.ts
**当前状态**: 功能缺失 — `engine.ts:314` 调用 `resolvePromptTemplate(manifest.prompt, { input, now })` 仅传递了 `input` 和 `now` 两个变量命名空间。但 `loader.ts` 的 `resolveVariable()` 支持 4 个命名空间: `input`, `server`, `skill`, `env`。SKILL_SPEC.md 明确列出 `{{server.name}}`, `{{server.os}}`, `{{server.ip}}`, `{{skill.last_run}}`, `{{skill.last_result}}` 为可用变量。当前所有使用这些变量的 Skill prompt 将无法正确解析（变量原样保留）
**实现方案**:
1. **engine.ts execute() 方法** — 补充 `server` 和 `skill` 变量:
   - 通过 `getServerRepository().findById(serverId)` 获取 server 信息 (name, os, hostname/ip)
   - 通过 `this.repo.listExecutions(skillId, 1)` 获取上次执行记录 → `skill.last_run` (completedAt) + `skill.last_result` (result summary)
   - 传递完整 TemplateVars: `{ input, server: { name, os, ip }, skill: { last_run, last_result }, now }`
2. **可选 — env 变量**: 根据 skill manifest 的 `requires` 或配置决定是否传入 env (当前可跳过，低优先)
3. **测试**:
   - engine.test.ts 新增: 验证 resolvedPrompt 包含 server.name 替换
   - engine.test.ts 新增: 验证 skill.last_run 从上次执行记录获取
   - engine.test.ts 新增: 无上次执行时 skill.last_run 为空字符串或 "N/A"
**验收标准**:
- `resolvePromptTemplate` 接收完整 4 命名空间变量
- 官方 Skill 的 `{{server.os}}` 等模板变量能正确替换
- 测试 ≥ 4 个新增
**影响范围**:
- `packages/server/src/core/skill/engine.ts` (修改 — execute 方法)
- `packages/server/src/core/skill/engine.test.ts` (修改 — 新增变量注入测试)
**创建时间**: (自动填充)
**完成时间**: 2026-02-13 03:26:49

---

### [completed] requires_confirmation 执行确认流 — SSE 暂停/确认/恢复机制 ✅

**ID**: skill-026
**优先级**: P1
**模块路径**: packages/server/src/core/skill/
**当前状态**: 功能缺失 — SKILL_SPEC.md (line 147-150) 定义了 `requires_confirmation: boolean` 约束，建议 `risk_level_max >= red` 时设为 true。当前 engine.ts execute() 完全忽略此字段，直接进入 AI 循环执行。schema 已在 `@aiinstaller/shared` 中定义并验证，但后端和前端均无确认流实现
**实现方案**:
1. **engine.ts** — execute() 方法检测 `manifest.constraints.requires_confirmation`:
   - 如果为 true 且 triggerType !== 'manual'（cron/event/threshold 自动触发）: 创建 execution 记录但状态设为 `pending_confirmation`，通过 SkillEventBus 发送 `confirmation_required` 事件，等待确认
   - 如果为 true 且 triggerType === 'manual': 立即执行（手动触发已经是用户主动行为）
2. **新增 execution 状态**: `pending_confirmation` 加入 SkillExecutionStatus 枚举 (schema.ts + types)
3. **新增 API**: `POST /api/v1/skills/executions/:eid/confirm` — 确认执行，将 pending_confirmation → running
4. **新增 API**: `POST /api/v1/skills/executions/:eid/reject` — 拒绝执行，将 pending_confirmation → cancelled
5. **SkillEventBus** — 新增 `SkillConfirmationEvent` 类型
6. **Dashboard** — 待确认执行列表 + 确认/拒绝按钮 + SSE 实时通知
7. **测试**: engine 确认流 + API 端点 + Dashboard 交互
**验收标准**:
- `requires_confirmation: true` 的 Skill 自动触发时暂停等待确认
- Dashboard 显示待确认执行，用户可确认或拒绝
- 手动触发不受影响（直接执行）
- 过期未确认的执行自动取消 (可选: 30min TTL)
- 测试 ≥ 12 个
**影响范围**:
- `packages/server/src/db/schema.ts` (修改 — 新增 pending_confirmation 状态)
- `packages/server/src/core/skill/engine.ts` (修改 — 确认流逻辑)
- `packages/server/src/core/skill/skill-event-bus.ts` (修改 — 新增事件类型)
- `packages/server/src/api/routes/skills.ts` (修改 — 新增 confirm/reject 端点)
- `packages/dashboard/src/pages/Skills.tsx` (修改 — 确认 UI)
- `packages/dashboard/src/stores/skills.ts` (修改 — confirm/reject actions)
**创建时间**: (自动填充)
**完成时间**: 2026-02-13 04:16:36

---

### [completed] server_scope: 'all' / 'tagged' — 多服务器批量执行 ✅

**ID**: skill-027
**优先级**: P1
**模块路径**: packages/server/src/core/skill/engine.ts
**当前状态**: 功能缺失 — SKILL_SPEC.md (line 152-155) 定义了 `server_scope` 约束: "single" (默认), "all" (用户所有服务器), "tagged" (匹配 tag)。当前 engine.ts execute() 始终只在单个 serverId 上执行，忽略 `manifest.constraints.server_scope` 字段。TriggerManager 自动触发时也只对单个 server 执行
**实现方案**:
1. **engine.ts** — execute() 方法根据 `server_scope` 分发:
   - `'single'`: 当前逻辑不变，使用传入的 serverId
   - `'all'`: 通过 `getServerRepository().findByUser(userId)` 获取所有服务器，逐一执行 (串行，避免 Agent 并发冲突)
   - `'tagged'`: 需要 server tags 功能支持（当前 servers 表无 tags 字段，可先跳过或返回错误）
2. **执行结果聚合**: 多服务器执行返回 `SkillExecutionResult[]` 数组或包含 `perServer` 字段的聚合结果
3. **execution 记录**: 每个服务器一条 execution 记录，共享同一个 `batchId`
4. **SSE**: 按 server 分段推送进度
5. **测试**:
   - engine.test.ts: scope='all' 对 3 台 server 各执行一次
   - engine.test.ts: scope='all' 部分 server 失败不影响其余
   - engine.test.ts: scope='single' 行为不变
**验收标准**:
- `server_scope: 'all'` 的 Skill 在用户所有 enabled 服务器上依次执行
- 每台服务器的执行结果独立记录
- 单台失败不阻塞其余服务器
- 测试 ≥ 8 个
**影响范围**:
- `packages/server/src/core/skill/engine.ts` (修改 — 多服务器分发)
- `packages/server/src/core/skill/types.ts` (修改 — batchId / 聚合结果类型)
- `packages/server/src/core/skill/engine.test.ts` (修改 — 多服务器测试)
- `packages/server/src/db/repositories/skill-repository.ts` (可能修改 — batchId 字段)
**创建时间**: (自动填充)
**完成时间**: 2026-02-13 04:32:08

---

### [completed] Output Schema 验证 — AI 输出结构化校验 ✅

**ID**: skill-028
**优先级**: P1
**模块路径**: packages/server/src/core/skill/runner.ts
**当前状态**: 功能缺失 — SKILL_SPEC.md (line 210-220) 定义了 `outputs` 字段允许 Skill 声明结构化输出格式。`@aiinstaller/shared/skill-schema.ts` 已定义 `SkillOutput` Zod schema (name, type, description)。但 `runner.ts` 收集 AI 原始文本输出后直接返回 `output: string`，未尝试解析 AI 输出为结构化数据，也未校验是否满足 manifest 声明的 outputs
**实现方案**:
1. **runner.ts** — run() 方法最后阶段新增 output 解析:

### [completed] SkillRepository.findAllEnabled() — 启动时加载已启用 Skill 的触发器 ✅

**ID**: skill-013
**优先级**: P0
**模块路径**: packages/server/src/db/repositories/skill-repository.ts
**当前状态**: 功能缺失 — `TriggerManager.findAllEnabledSkills()` (trigger-manager.ts:408-414) 使用 duck-typing 检测 `repo['findAllEnabled']`，但 `SkillRepository` 接口和两个实现类 (`DrizzleSkillRepository`, `InMemorySkillRepository`) 都没有定义 `findAllEnabled()` 方法。导致服务器重启后，已启用 Skill 的 cron/event/threshold 触发器不会被重新注册，只能通过手动重新启用来恢复
**实现方案**:

1. **SkillRepository 接口** — 新增方法签名:
   - `findAllEnabled(): Promise<InstalledSkill[]>` — 返回所有 `status === 'enabled'` 的 Skill (跨用户)
2. **DrizzleSkillRepository** — 实现:
   - `SELECT * FROM installed_skills WHERE status = 'enabled' ORDER BY created_at DESC`
   - 使用 Drizzle: `db.select().from(installedSkills).where(eq(installedSkills.status, 'enabled')).all()`
3. **InMemorySkillRepository** — 实现:
   - `this.skills.filter(s => s.status === 'enabled')`
4. **TriggerManager** — 移除 duck-typing hack (trigger-manager.ts:408-414):
   - 直接调用 `this.repo.findAllEnabled()` (接口类型保证方法存在)
5. **测试**:
   - DrizzleSkillRepository: 测试 findAllEnabled 只返回 enabled 状态
   - InMemorySkillRepository: 同上
   - TriggerManager: 测试 start() 时从 DB 加载已启用的 Skill 并注册触发器

**验收标准**:
- 服务器重启后，所有 `status=enabled` 的 Skill 的触发器被自动恢复
- `TriggerManager.start()` 不再使用 duck-typing 检测
- 测试 ≥ 6 个新增

**影响范围**:
- `packages/server/src/db/repositories/skill-repository.ts` (修改 — 接口 + 两个实现)
- `packages/server/src/core/skill/trigger-manager.ts` (修改 — 移除 duck-typing)
- `packages/server/src/core/skill/trigger-manager.test.ts` (修改 — 新增 startup 加载测试)
- `packages/server/src/db/repositories/skill-repository.test.ts` (如存在则修改)

**创建时间**: (自动填充)
**完成时间**: 2026-02-13 01:55:03

---

### [completed] Store 工具定义缺少 `list` action — AI 无法使用 KV 列表功能 ✅

**ID**: skill-014
**优先级**: P0
**模块路径**: packages/server/src/core/skill/runner-tools.ts
**当前状态**: 功能缺失 — `buildToolDefinitions()` 中 `store` 工具的 `action` enum 为 `['get', 'set', 'delete']` (runner-tools.ts:203)，但 `runner.ts:645-648` 的 `executeStore()` 实现了 `list` action。AI 不知道 `list` 操作存在，因此永远不会调用它。规范文档 (SKILL_SPEC.md) 要求 store 工具支持 get/set/delete/list 四种操作
**实现方案**:

1. **runner-tools.ts** — 修改 `buildToolDefinitions()` 中 store 工具:
   - `action.enum`: `['get', 'set', 'delete']` → `['get', 'set', 'delete', 'list']`
   - 更新 `action.description`: 说明 `list` 返回该 Skill 所有键值对
   - `list` 操作不需要 `key` 参数，但 `key` 仍标记为 required — 需改为 optional 或允许 `list` 忽略 `key`
   - 最佳方案: 将 `required` 改为 `['action']`，`key` 和 `value` 都变为 optional；在 runner.ts 中对 `get`/`set`/`delete` 做参数存在性检查
2. **runner.ts** — 在 `executeStore()` 中增加 `key` 缺失检查:
   - `get`/`delete`: 如果 `key` 为空字符串或 undefined → 返回错误
   - `list`: 忽略 `key` 参数 (已实现)
3. **测试**:
   - runner-tools.test.ts (如存在): 验证 store 工具定义包含 `list`
   - runner.test.ts: 新增 `list` 操作测试

**验收标准**:
- AI 可以成功调用 `store` 工具的 `list` action
- `key` 对 `list` 操作不再是必填
- `get`/`set`/`delete` 仍要求 `key`
- 测试覆盖所有 4 种 store 操作

**影响范围**:
- `packages/server/src/core/skill/runner-tools.ts` (修改 — enum + required)
- `packages/server/src/core/skill/runner.ts` (修改 — 参数校验)
- `packages/server/src/core/skill/runner.test.ts` (修改 — 新增 list 测试)

**创建时间**: (自动填充)
**完成时间**: 2026-02-13 02:02:58

---

### [completed] Dashboard Skill 执行按钮无功能 — onExecute 为空回调 ✅

**ID**: skill-015
**优先级**: P1
**模块路径**: packages/dashboard/src/pages/Skills.tsx
**当前状态**: 功能缺失 — `Skills.tsx:148` 中 `onExecute={() => {}}` 传递空回调，点击 SkillCard 的执行按钮 (⚡ Zap icon) 无任何效果。缺少服务器选择器和执行触发流程。Store 中已有 `executeSkill(id, serverId, config)` 方法和 `startExecutionStream(executionId)` 方法，但页面未集成
**实现方案**:

1. **Skills.tsx** — 添加执行流程:
   - 新增 `executeTarget` state: `useState<InstalledSkill | null>(null)`
   - 点击执行 → `setExecuteTarget(skill)` → 打开执行 Dialog
   - 执行 Dialog 内容:
     - 服务器选择器: 下拉列表从 servers store 获取在线服务器
     - "执行" 确认按钮 → `executeSkill(skill.id, selectedServerId)` → 获取 executionId
     - 执行后展示 `ExecutionStream` 组件 (实时进度)
   - 替换 `onExecute={() => {}}` 为 `onExecute={setExecuteTarget}`
2. **i18n** — en.json + zh.json 新增:
   - `skills.executeSkill`: "Execute Skill" / "执行技能"
   - `skills.selectServer`: "Select a server" / "选择服务器"
   - `skills.noServers`: "No servers available" / "无可用服务器"
   - `skills.executing`: "Executing..." / "执行中..."
3. **测试**:
   - Skills.test.tsx: 新增执行按钮点击 → Dialog 打开 → 服务器选择 → 触发执行

**验收标准**:
- 点击执行按钮弹出 Dialog，包含服务器选择器
- 选择服务器后点击确认，触发 `executeSkill()` API 调用
- 执行中显示实时 SSE 进度流 (`ExecutionStream` 组件)
- 执行完成后可查看结果
- 测试 ≥ 3 个新增

**影响范围**:
- `packages/dashboard/src/pages/Skills.tsx` (修改 — 执行流程)
- `packages/dashboard/src/pages/Skills.test.tsx` (修改 — 新增测试)
- `packages/dashboard/src/i18n/locales/en.json` (修改 — 新增 keys)
- `packages/dashboard/src/i18n/locales/zh.json` (修改 — 新增 keys)

**创建时间**: (自动填充)
**完成时间**: 2026-02-13 02:10:34

---

### [completed] configureSkill store 盲写 status='configured' — 覆盖已启用/暂停状态 ✅

**ID**: skill-016
**优先级**: P1
**模块路径**: packages/dashboard/src/stores/skills.ts
**当前状态**: Bug — `skills.ts:113` 在 `configureSkill` 成功后强制将 status 设为 `'configured'`，即使 Skill 原本是 `'enabled'` 或 `'paused'` 状态。服务端 `engine.ts:196-198` 只在 `status === 'installed'` 时才自动转为 configured，其他状态保持不变。前端乐观更新与服务端行为不一致，导致 UI 显示错误状态
**实现方案**:

1. **stores/skills.ts** — 修改 `configureSkill`:
   - 移除盲写 `status: 'configured' as SkillStatus` 逻辑
   - 改为: 只在 `s.status === 'installed'` 时将 status 更新为 `'configured'`
   - 其他状态保持原样: `s.id === id ? { ...s, config, ...(s.status === 'installed' ? { status: 'configured' as SkillStatus } : {}) } : s`
2. **测试**:
   - skills.test.ts: 新增测试 — configureSkill 对 enabled/paused 状态的 Skill 不改变 status

**验收标准**:
- 配置已启用的 Skill 后，UI 仍显示 "Enabled" 而非 "Configured"
- 配置已安装 (installed) 的 Skill 后，UI 正确显示 "Configured"
- 测试 ≥ 2 个新增

**影响范围**:
- `packages/dashboard/src/stores/skills.ts` (修改 — 条件状态更新)
- `packages/dashboard/src/stores/skills.test.ts` (修改 — 新增测试)

**创建时间**: (自动填充)
**完成时间**: 2026-02-13 02:12:26

---

### [completed] runner.ts 超 500 行限制 — 提取工具执行方法到独立模块 ✅

**ID**: skill-017
**优先级**: P2
**模块路径**: packages/server/src/core/skill/runner.ts
**当前状态**: 需要改进 — `runner.ts` 当前 677 行，超过项目标准的 500 行软限制。文件包含 SkillRunner 核心循环 + 6 种工具执行方法 (shell/read_file/write_file/notify/http/store) + 审计方法 + helper 方法。工具执行逻辑可独立提取
**实现方案**:

1. **新建 `runner-executor.ts`** (~250 行):
   - 提取 6 个 `execute*` 方法 + `auditShell` 方法为独立类 `SkillToolExecutor`:
     - `executeShell()`, `executeReadFile()`, `executeWriteFile()`, `executeNotify()`, `executeHttp()`, `executeStore()`
     - `auditShell()` 辅助方法
   - 构造参数: 接收所需依赖 (taskExecutor, auditLogger, webhookDispatcher 等)
   - 导出 `SkillToolExecutor` 类
2. **修改 `runner.ts`** (~350 行):
   - 移除工具执行方法，改为实例化 `SkillToolExecutor` 并调用
   - 保留核心 agentic loop 逻辑
3. **测试**:
   - 现有 runner.test.ts 无需大改 (接口不变)
   - 可选: 新增 runner-executor.test.ts 对工具执行方法做独立单元测试

**验收标准**:
- `runner.ts` 降至 ≤ 500 行
- `runner-executor.ts` ≤ 300 行
- 所有现有 runner.test.ts 测试继续通过
- 无行为变化，纯重构

**影响范围**:
- `packages/server/src/core/skill/runner.ts` (修改 — 拆分)
- `packages/server/src/core/skill/runner-executor.ts` (新建)
- `packages/server/src/core/skill/runner.test.ts` (可能微调 import)

**创建时间**: (自动填充)
**完成时间**: 2026-02-13 02:17:07

---

### [completed] Skill 执行 E2E 集成测试 — 覆盖完整生命周期 ✅

**ID**: skill-018
**优先级**: P2
**模块路径**: tests/ 或 packages/server/src/core/skill/
**当前状态**: 功能缺失 — 现有测试全部为单元测试 (mock AI provider、mock executor)。缺少验证完整 install → configure → enable → manual execute → verify execution result 的集成测试。特别是以下集成点未被测试覆盖:
  - SkillEngine + SkillRunner + TriggerManager 协同
  - RBAC 权限在 skill 路由上的端到端验证
  - SSE 事件流从 SkillRunner → SkillEventBus → SSE endpoint 的完整链路
**实现方案**:

1. **skill-integration.test.ts** (~300 行):
   - 使用 InMemory repositories + Mock AI Provider
   - 测试完整生命周期:
     - 安装 → 验证 DB 持久化
     - 配置 → 验证状态自动转换 (installed → configured)
     - 启用 → 验证 TriggerManager 注册触发器
     - 手动执行 → Mock AI 返回 tool_use → 验证工具调用链
     - 暂停 → 验证 TriggerManager 注销触发器
     - 卸载 → 验证 DB 清理 + 关联执行记录级联删除
   - 测试 SSE 事件流:
     - 启动执行 → 订阅 SkillEventBus → 验证 step/log/completed 事件序列
   - 测试 RBAC 端到端:
     - member 角色只能 view，不能 manage/execute
     - admin 角色可以 manage + execute
   - 测试错误恢复:
     - Skill manifest 损坏 → 执行失败 → status 设为 error
     - 执行超时 → 正确记录 timeout 状态

**验收标准**:
- 完整的 install→configure→enable→execute→result 链路覆盖
- SSE 事件流验证
- RBAC 权限验证
- 测试 ≥ 15 个

**影响范围**:
- `packages/server/src/core/skill/skill-integration.test.ts` (新建)

**创建时间**: (自动填充)
**完成时间**: 2026-02-13 02:28:39

---

### [completed] Skill 输入定义从 Manifest 获取 — 替代 config key 推断 ✅

**ID**: skill-019
**优先级**: P2
**模块路径**: packages/dashboard/src/pages/Skills.tsx + packages/server/src/api/routes/skills.ts
**当前状态**: 功能缺失 — `Skills.tsx:426-441` 中 `getSkillInputs()` 从 skill.config 的 key 推断输入类型，无法获取 manifest 中定义的真实 `inputs[]` (名称、类型、描述、默认值、required、enum options)。例如一个 enum 类型的 input 会被误推断为 string。API 端的 GET /skills 和 GET /skills/:id 只返回 DB 数据，不包含 manifest 中的 inputs 定义
**实现方案**:

1. **Server API** — GET /skills 响应中附带 manifest inputs:
   - `engine.listInstalled()` 返回结果时，对每个 skill 尝试加载 manifest 并提取 `inputs[]`
   - 或新增专用端点 `GET /skills/:id/manifest` 返回 manifest 的 inputs + triggers + tools
   - 推荐方案: 在 install 时将 manifest 的 inputs JSON 保存到 `installed_skills.config` 的 `_inputs` 字段，或新增 `manifest_inputs` 列
2. **Dashboard** — `getSkillInputs()` 优先使用 manifest inputs:
   - API 返回的 skill 包含 `inputs?: SkillInputDef[]` 字段
   - 配置 Modal 使用 manifest inputs 生成表单 (支持 enum 下拉、boolean 开关、数字输入等)
   - 回退: 无 inputs 时仍用 config key 推断 (向后兼容)
3. **types/skill.ts** — InstalledSkill 类型新增 `inputs?: SkillInputDef[]`

**验收标准**:
- 配置 Modal 能正确渲染 enum 类型为下拉选择器
- 配置 Modal 能显示 input 的 description 和 default 值
- 配置 Modal 对 required input 做必填验证
- 测试 ≥ 5 个

**影响范围**:
- `packages/server/src/api/routes/skills.ts` (修改 — 返回 inputs)
- `packages/server/src/core/skill/engine.ts` (修改 — 查询时附带 manifest inputs)
- `packages/dashboard/src/pages/Skills.tsx` (修改 — 使用 manifest inputs)
- `packages/dashboard/src/types/skill.ts` (修改 — InstalledSkill 新增字段)

**创建时间**: (自动填充)
**完成时间**: 2026-02-13 02:35:47

---

### [completed] Webhook 事件集成 — 系统事件自动触发 Skill ✅

**ID**: skill-020
**优先级**: P2
**模块路径**: packages/server/src/core/skill/trigger-manager.ts + packages/server/src/core/webhook/dispatcher.ts
**当前状态**: 功能缺失 — TriggerManager 的 event trigger 注册了事件类型 (如 `alert.triggered`, `server.offline`)，但 `handleEvent()` 方法仅被 SkillEngine 在 `skill.completed`/`skill.failed` 时调用。WebhookDispatcher 分发 5 种系统事件 (`task.completed`, `alert.triggered`, `server.offline`, `operation.failed`, `agent.disconnected`) 时不通知 TriggerManager。系统事件无法触发 Skill 执行
**实现方案**:

1. **集成方式** (低耦合):
   - 在 `index.ts` 的 `startServer()` 中注册事件桥接:
     - `getWebhookDispatcher().onDispatch((event) => getTriggerManager().handleEvent(event.type, event.data))`
   - 或在 TriggerManager.start() 中订阅 WebhookDispatcher 的 EventEmitter
   - 推荐方案: WebhookDispatcher 已有 `dispatch()` 方法 → 在 dispatch 成功后 emit 一个本地事件 → TriggerManager 订阅
2. **WebhookDispatcher** — 新增 EventEmitter 或回调:
   - 在 `dispatch()` 方法末尾发布事件: `this.emitter.emit('dispatched', { type, data })`
   - 或添加 `onDispatch(callback)` 注册方法
3. **TriggerManager** — 在 `start()` 中订阅 dispatcher 事件
4. **测试**:
   - WebhookDispatcher dispatch → TriggerManager handleEvent 被调用
   - `alert.triggered` 事件 → 匹配 event trigger 的 Skill 被执行
   - 不匹配的事件类型不触发

**验收标准**:
- `alert.triggered` 等系统事件能自动触发配置了对应 event trigger 的 Skill
- WebhookDispatcher 无需知道 SkillEngine/TriggerManager 的存在 (反转依赖)
- 测试 ≥ 6 个

**影响范围**:
- `packages/server/src/core/webhook/dispatcher.ts` (修改 — 新增事件发射)
- `packages/server/src/core/skill/trigger-manager.ts` (修改 — 订阅 dispatcher)
- `packages/server/src/index.ts` (修改 — 注册桥接)
- 测试文件 (新增/修改)

**创建时间**: (自动填充)
**完成时间**: 2026-02-13 02:43:07

---

### [completed] Skill manifest_inputs 持久化 — 安装时保存输入定义到 DB ✅

**ID**: skill-021
**优先级**: P3
**模块路径**: packages/server/src/db/schema.ts + packages/server/src/core/skill/engine.ts
**当前状态**: 功能缺失 — `installed_skills` 表没有存储 manifest 中的 `inputs[]` 定义。每次需要 inputs 信息时必须从磁盘加载 `skill.yaml` 并解析。如果 Skill 目录被删除或损坏，inputs 信息丢失。Dashboard 配置 Modal 无法获取正确的输入类型定义 (依赖 skill-019)
**实现方案**:

1. **DB Schema** — `installed_skills` 表新增列:
   - `manifest_inputs TEXT` — JSON 序列化的 `SkillManifest.inputs[]`
   - 或重用 `config` 列的 `_manifest` 子键 (不推荐，混淆用户配置和元数据)
2. **Migration** — `0011_skill_manifest_inputs.sql`:
   - `ALTER TABLE installed_skills ADD COLUMN manifest_inputs TEXT`
3. **engine.ts** — `install()` 方法:
   - 解析 manifest 后，将 `manifest.inputs` JSON 序列化保存到 `manifest_inputs` 列
4. **SkillRepository** — 更新 `install()` 输入类型:
   - `InstallSkillInput` 新增 `manifestInputs?: unknown[]`
5. **API 返回** — GET /skills 的响应中包含 `manifestInputs` 字段

**验收标准**:
- 安装 Skill 后 DB 持久化了 inputs 定义
- API 返回 InstalledSkill 包含 manifestInputs
- 即使磁盘 skill.yaml 损坏，仍可从 DB 获取 inputs 定义
- Migration 平滑执行 (nullable 列)

**影响范围**:
- `packages/server/src/db/schema.ts` (修改)
- `packages/server/src/db/migrations/0011_skill_manifest_inputs.sql` (新建)
- `packages/server/src/db/connection.ts` (修改 — createTables)
- `packages/server/src/db/repositories/skill-repository.ts` (修改)
- `packages/server/src/core/skill/engine.ts` (修改)
- `packages/server/src/core/skill/types.ts` (修改 — InstalledSkill 新增字段)

**创建时间**: (自动填充)
**完成时间**: 2026-02-13 02:54:50

---

### [completed] Skill 执行历史增强 — 执行详情页 + 重新执行 ✅

**ID**: skill-022
**优先级**: P3
**模块路径**: packages/dashboard/src/components/skill/
**当前状态**: 功能缺失 — `ExecutionHistory.tsx` 只显示执行列表 (时间、状态、步数、耗时)，无法展开查看单条执行的详细结果 (AI 输出、工具调用记录、错误信息)。API 已有 `GET /skills/:id/executions/:eid` 返回执行详情，但 Dashboard 未调用。也无法从历史中重新执行 Skill
**实现方案**:

1. **ExecutionDetail.tsx** (~150 行):
   - 执行详情展示: AI 输出文本、工具调用列表 (名称、输入、结果、耗时)、错误列表
   - 工具调用折叠/展开
   - "重新执行" 按钮 → 使用相同的 skillId + serverId 触发新执行
2. **ExecutionHistory.tsx** — 修改:
   - 点击执行记录行 → 展开/切换到 ExecutionDetail 视图
   - 或使用 Dialog 展示详情
3. **stores/skills.ts** — 新增:
   - `fetchExecutionDetail(skillId, executionId)` → `GET /skills/:id/executions/:eid`
   - `selectedExecution: SkillExecution | null` state
4. **i18n** — 新增 keys: executionDetail, reExecute, toolCalls, aiOutput, errors
5. **测试**: ≥ 4 个 (详情加载、重新执行、错误处理)

**验收标准**:
- 点击历史记录可查看执行详情 (AI 输出 + 工具调用记录)
- 详情页有"重新执行"按钮
- 测试 ≥ 4 个

**影响范围**:
- `packages/dashboard/src/components/skill/ExecutionDetail.tsx` (新建)
- `packages/dashboard/src/components/skill/ExecutionHistory.tsx` (修改)
- `packages/dashboard/src/stores/skills.ts` (修改)
- `packages/dashboard/src/i18n/locales/en.json` (修改)
- `packages/dashboard/src/i18n/locales/zh.json` (修改)

**创建时间**: (自动填充)
**完成时间**: 2026-02-13 03:03:59

### [completed] Skill KV Store — 每个 Skill 的持久化存储 API ✅

**ID**: skill-007
**优先级**: P2
**模块路径**: packages/server/src/core/skill/
**当前状态**: 文件不存在 — `runner.ts:570-574` 中 `store` 工具调用返回占位错误 `"KV store not yet implemented (skill-007)"`；`skill_store` 表已在 schema.ts 中定义并有迁移
**实现方案**:

1. **store.ts** (~120 行):
   - `SkillKVStore` 类: 封装对 `skill_store` 表的 CRUD 操作
   - 方法: `get(skillId, key): Promise<string | null>`, `set(skillId, key, value): Promise<void>`, `delete(skillId, key): Promise<void>`, `list(skillId): Promise<Record<string, string>>`
   - 值大小限制: 单个 value ≤ 1MB (规范要求)
   - 通过 `getSkillRepository()` 或直接使用 Drizzle 查询 `skillStore` 表
   - 单例: `getSkillKVStore()` / `setSkillKVStore()` / `_resetSkillKVStore()`
2. **更新 runner.ts** — `handleStoreTool()` 方法:
   - 替换占位逻辑，改为调用 `getSkillKVStore()` 执行真实 get/set/delete/list 操作
   - action: `get` → 读取, `set` → 写入, `delete` → 删除, `list` → 列出所有 key
3. **store.test.ts** (~150 行):
   - 测试 get/set/delete/list 基本 CRUD 操作
   - 测试 value 大小超限拒绝 (>1MB)
   - 测试 key 不存在返回 null
   - 测试多个 skill 之间的数据隔离
   - 测试 InMemory 实现 (用于 runner 测试)

**验收标准**:
- `store` 工具能在 runner.ts 中正常执行 get/set/delete/list 4 种操作
- 数据持久化到 SQLite `skill_store` 表
- 单值 ≤ 1MB 限制生效
- 不同 skillId 之间数据隔离
- 测试 ≥ 12 个

**影响范围**:
- `packages/server/src/core/skill/store.ts` (新建)
- `packages/server/src/core/skill/store.test.ts` (新建)
- `packages/server/src/core/skill/runner.ts` (修改 — 接入真实 KV store)

**创建时间**: (自动填充)
**完成时间**: 2026-02-12 23:52:54

---

### [completed] TriggerManager — Cron/Event/Threshold 触发调度 ✅

**ID**: skill-006
**优先级**: P2
**模块路径**: packages/server/src/core/skill/
**当前状态**: 文件不存在 — `engine.ts:80-85` 中 `start()` 方法为空壳 (注释 "TriggerManager — deferred to future task")；当前仅支持手动执行
**实现方案**:

1. **trigger-manager.ts** (~350 行):
   - `TriggerManager` 类: 管理所有已启用 Skill 的自动触发器
   - **Cron 触发**: 使用 `node-cron` 库 (需新增依赖)
     - `registerCron(skillId, cronExpression, serverId)` — 注册 cron 定时任务
     - `unregisterCron(skillId)` — 停止并移除 cron 任务
     - cron 回调: `SkillEngine.execute(skillId, serverId, userId, 'cron')`
   - **Event 触发**: 订阅 WebhookDispatcher 事件
     - `registerEvent(skillId, eventTypes: string[])` — 监听 task.completed / alert.triggered / server.offline 等事件
     - 事件匹配时调用 `SkillEngine.execute()` with `triggerType='event'`
     - 通过 EventEmitter 或直接在 webhook dispatch 流程中注入 hook
   - **Threshold 触发**: 监听 MetricsBus 指标
     - `registerThreshold(skillId, metric, operator, value)` — 注册阈值监控
     - 订阅 `getMetricsBus()` 事件，当 cpu.usage > 90 等条件满足时触发
     - 防抖: 同一 Skill 同一 server 至少间隔 5 分钟才能再次触发
   - 生命周期:
     - `start()` — 从 DB 读取所有 enabled 的 Skill，注册各类触发器
     - `stop()` — 清除所有 cron 任务、取消事件订阅、停止阈值监控
     - `registerSkill(skill, manifest)` — 安装/启用时调用
     - `unregisterSkill(skillId)` — 卸载/暂停时调用
2. **更新 engine.ts**:
   - `start()` → 创建 TriggerManager 实例并调用 `triggerManager.start()`
   - `stop()` → 调用 `triggerManager.stop()`
   - `install()` → 若已 enabled 则 `triggerManager.registerSkill()`
   - `updateStatus('enabled')` → `triggerManager.registerSkill()`
   - `updateStatus('paused')` / `uninstall()` → `triggerManager.unregisterSkill()`
3. **trigger-manager.test.ts** (~300 行):
   - Cron: 注册 → 触发 → 执行回调验证
   - Event: 事件发布 → 匹配 → 触发执行验证
   - Threshold: 指标超限 → 触发 + 防抖逻辑验证
   - 生命周期: start 加载已有 Skill / stop 清理所有资源
   - 注册/反注册: Skill 状态变更正确更新触发器
4. **安装依赖**: `pnpm --filter @aiinstaller/server add node-cron && pnpm --filter @aiinstaller/server add -D @types/node-cron`

**验收标准**:
- Cron 表达式 (如 `0 8 * * *`) 能定时触发 Skill 执行
- Event 触发 (如 `alert.triggered`) 能自动执行对应 Skill
- Threshold 触发 (如 `cpu.usage > 90`) 能通过 MetricsBus 感知并触发
- 防抖机制防止同一 Skill 频繁触发 (≥5 分钟间隔)
- engine.ts 的 start/stop/install/updateStatus 正确集成 TriggerManager
- 测试 ≥ 20 个

**影响范围**:
- `packages/server/src/core/skill/trigger-manager.ts` (新建)
- `packages/server/src/core/skill/trigger-manager.test.ts` (新建)
- `packages/server/src/core/skill/engine.ts` (修改 — 集成 TriggerManager)
- `packages/server/package.json` (新增 node-cron 依赖)

**创建时间**: (自动填充)
**完成时间**: 2026-02-13 00:06:54

---

### [completed] Dashboard — 前端类型 + Zustand Store + API 集成 ✅

**ID**: skill-008
**优先级**: P3
**模块路径**: packages/dashboard/src/
**当前状态**: 全部不存在 — `pages/Skills.tsx`, `stores/skills.ts`, `types/skill.ts` 均未创建；`App.tsx` 和侧边栏无 Skill 相关路由或导航项
**实现方案**:

1. **types/skill.ts** (~60 行):
   - `InstalledSkill`: id, userId, name, displayName, version, source, status, config, createdAt, updatedAt
   - `SkillExecution`: id, skillId, serverId, triggerType, status, startedAt, completedAt, result, stepsExecuted, duration
   - `AvailableSkill`: name, displayName, version, description, author, tags, source, installed
   - `SkillConfig`: Record<string, unknown>
   - `SkillStatus`: 'installed' | 'configured' | 'enabled' | 'paused' | 'error'
2. **stores/skills.ts** (~180 行):
   - Zustand store: `useSkillStore`
   - 状态: `skills: InstalledSkill[]`, `available: AvailableSkill[]`, `executions: SkillExecution[]`, `loading: boolean`, `error: string | null`
   - Actions:
     - `fetchSkills()` → `GET /api/v1/skills`
     - `fetchAvailable()` → `GET /api/v1/skills/available`
     - `installSkill(name, source)` → `POST /api/v1/skills/install`
     - `uninstallSkill(id)` → `DELETE /api/v1/skills/:id`
     - `configureSkill(id, config)` → `PUT /api/v1/skills/:id/config`
     - `updateStatus(id, status)` → `PUT /api/v1/skills/:id/status`
     - `executeSkill(id, serverId)` → `POST /api/v1/skills/:id/execute`
     - `fetchExecutions(id)` → `GET /api/v1/skills/:id/executions`
   - 使用 `apiRequest()` 统一 HTTP 调用 (自动 401 刷新)
3. **更新 App.tsx** — 添加 `/skills` 路由
4. **更新 Sidebar** — 添加 Skills 导航项 (Puzzle 图标，位于 Webhooks 和 Settings 之间)
5. **stores/skills.test.ts** (~120 行):
   - Mock `apiRequest`，测试所有 8 个 actions 的成功/失败路径
   - 测试 loading 状态变化
   - 测试 error 处理
   - 测试 ≥ 10 个

**验收标准**:
- TypeScript 类型完整覆盖 API 响应结构
- Store 所有 actions 调用正确的 API 端点
- 侧边栏出现 Skills 导航项，点击跳转 `/skills`
- `pnpm --filter @aiinstaller/dashboard build` 无类型错误
- 测试 ≥ 10 个

**影响范围**:
- `packages/dashboard/src/types/skill.ts` (新建)
- `packages/dashboard/src/stores/skills.ts` (新建)
- `packages/dashboard/src/stores/skills.test.ts` (新建)
- `packages/dashboard/src/App.tsx` (修改 — 添加路由)
- `packages/dashboard/src/components/Sidebar.tsx` 或类似 (修改 — 添加导航)

**创建时间**: (自动填充)
**完成时间**: 2026-02-13 00:13:58

---

### [completed] Dashboard — Skills 管理页面 + UI 组件 ✅

**ID**: skill-009
**优先级**: P3
**模块路径**: packages/dashboard/src/pages/ + packages/dashboard/src/components/skill/
**当前状态**: 全部不存在 — 依赖 skill-008 (类型 + Store) 完成后开发
**实现方案**:

1. **pages/Skills.tsx** (~250 行):
   - 顶部: 标题 + "安装 Skill" 按钮
   - Tab 切换: "已安装" / "可用" (marketplace)
   - 已安装 Tab: SkillCard 列表 (显示名称、版本、状态、操作按钮)
   - 可用 Tab: AvailableSkillCard 列表 (显示名称、描述、标签、安装按钮)
   - 空状态: 无 Skill 时引导用户安装
2. **components/skill/SkillCard.tsx** (~120 行):
   - 卡片展示: icon + 名称 + 版本 + source badge + status badge
   - 操作: 启用/暂停 toggle, 配置按钮, 执行按钮, 卸载按钮
   - 状态颜色: enabled=绿, paused=灰, error=红, installed/configured=蓝
3. **components/skill/SkillConfigModal.tsx** (~150 行):
   - Modal 弹窗: 展示 Skill 的 inputs 字段
   - 动态表单生成: 根据 input.type (string/number/boolean/select/string[]) 渲染对应控件
   - 必填/可选标记、默认值填充
   - 提交 → `configureSkill(id, config)`
4. **components/skill/ExecutionHistory.tsx** (~100 行):
   - 执行历史列表: 时间、触发类型、状态、耗时、步数
   - 状态 badge: success=绿, failed=红, running=蓝 动画, timeout=黄
   - 点击展开查看执行详情 (result JSON)
5. **pages/Skills.test.tsx** (~150 行):
   - 渲染测试: 已安装列表、可用列表、空状态
   - 交互测试: 安装/卸载/启用/暂停按钮点击
   - Modal 测试: 配置表单提交
   - 测试 ≥ 12 个

**验收标准**:
- Skills 页面展示已安装 Skill 列表和可用 Skill marketplace
- 能完成安装 → 配置 → 启用 → 执行 → 查看历史的完整 UI 流程
- 配置 Modal 能根据 Skill 的 inputs 定义动态生成表单
- 响应式布局 (移动端友好)
- Tailwind CSS 风格一致
- 测试 ≥ 12 个

**影响范围**:
- `packages/dashboard/src/pages/Skills.tsx` (新建)
- `packages/dashboard/src/pages/Skills.test.tsx` (新建)
- `packages/dashboard/src/components/skill/SkillCard.tsx` (新建)
- `packages/dashboard/src/components/skill/SkillConfigModal.tsx` (新建)
- `packages/dashboard/src/components/skill/ExecutionHistory.tsx` (新建)

**创建时间**: (自动填充)
**完成时间**: 2026-02-13 00:23:27

---

### [completed] SSE 推送 — Skill 执行实时进度流 ✅

**ID**: skill-010
**优先级**: P3
**模块路径**: packages/server/src/core/skill/ + packages/server/src/api/routes/ + packages/dashboard/src/
**当前状态**: 不存在 — Skill 执行目前是同步等待返回最终结果，无中间进度推送。已有 MetricsBus SSE 可参考
**实现方案**:

1. **core/skill/skill-event-bus.ts** (~60 行):
   - `SkillEventBus` — EventEmitter 封装，发布 Skill 执行进度事件
   - 事件类型: `step` (工具调用进度), `log` (AI 思考日志), `completed` (执行完成), `error` (错误)
   - 单例: `getSkillEventBus()` / `_resetSkillEventBus()`
   - 频道: `skill:${executionId}` — 每次执行一个独立事件流
2. **更新 runner.ts** — 在 agentic loop 的关键节点发布事件:
   - 工具调用前: `emit('step', { tool, input })` — 通知前端 "正在执行 shell: ls -la"
   - 工具调用后: `emit('step', { tool, result, success })` — 通知结果
   - AI 思考: `emit('log', { text })` — AI 的文本输出
   - 完成/超时: `emit('completed', { result })` 或 `emit('error', { message })`
3. **api/routes/skills.ts** — 新增 SSE 端点:
   - `GET /api/v1/skills/:id/executions/:eid/stream` — SSE 连接
   - 订阅 `SkillEventBus` 对应 executionId 的事件
   - 中间件: requireAuth + requirePermission('skill:view')
4. **Dashboard 集成**:
   - `api/sse.ts` 新增 `createSkillExecutionSSE(executionId)` 方法
   - `stores/skills.ts` 新增 `streamExecution(executionId)` 方法
   - `components/skill/ExecutionStream.tsx` (~100 行) — 实时进度 UI:
     - 步骤列表: 每步显示工具名、输入、结果、状态图标
     - AI 思考文本实时追加
     - 完成/失败状态自动切换
5. **测试**:
   - `skill-event-bus.test.ts` (~50 行): emit/subscribe/unsubscribe
   - SSE 端点测试 (整合到 skills.test.ts): 连接 → 收到事件 → 断开

**验收标准**:
- 手动执行 Skill 后，前端实时显示每一步工具调用的进度
- SSE 连接自动重连 (参考 MetricsSSE 的 exponential backoff)
- 执行完成后 SSE 自动关闭
- 事件总线不泄漏 (执行完成后清理 listener)
- 测试 ≥ 8 个

**影响范围**:
- `packages/server/src/core/skill/skill-event-bus.ts` (新建)
- `packages/server/src/core/skill/skill-event-bus.test.ts` (新建)
- `packages/server/src/core/skill/runner.ts` (修改 — 接入事件发布)
- `packages/server/src/api/routes/skills.ts` (修改 — 新增 SSE 端点)
- `packages/dashboard/src/api/sse.ts` (修改 — 新增 Skill SSE)
- `packages/dashboard/src/stores/skills.ts` (修改 — 新增 stream 方法)
- `packages/dashboard/src/components/skill/ExecutionStream.tsx` (新建)

**创建时间**: (自动填充)
**完成时间**: 2026-02-13 00:33:10

---

### [completed] 社区 Skill 安装 — 从 Git URL 克隆 + 安全扫描 ✅

**ID**: skill-011
**优先级**: P4
**模块路径**: packages/server/src/core/skill/
**当前状态**: 不存在 — 当前仅支持从本地目录安装 (`engine.ts:install()` 接受 `skillDir` 参数为本地路径)；`POST /api/v1/skills/install` 只接收 `{ name, source }`，无 Git URL 字段
**实现方案**:

1. **core/skill/git-installer.ts** (~120 行):
   - `installFromGitUrl(url: string, targetDir: string): Promise<string>` — 执行 `git clone --depth 1` 到 `skills/community/<name>/`
   - URL 验证: 仅允许 `https://` 协议 (拒绝 `git://`, `ssh://`)
   - 目录命名: 从 URL 提取仓库名 (如 `https://github.com/user/my-skill.git` → `skills/community/my-skill/`)
   - 克隆后验证: 检查 `skill.yaml` 是否存在 + Schema 验证
   - 失败回滚: 克隆失败或验证失败则删除目录
2. **安全扫描** (~50 行，集成到 git-installer.ts 或单独文件):
   - 检查 skill.yaml 中是否有 `risk_level_max: critical` 或 `forbidden` — 警告用户
   - 扫描 prompt 长度 (异常大的 prompt 可能是注入尝试)
   - 不执行任何从 Git 仓库引入的可执行文件
3. **更新 api/routes/skills.ts**:
   - `POST /api/v1/skills/install` 扩展 body: `{ name, source, gitUrl? }`
   - 当 `gitUrl` 存在时: 调用 `installFromGitUrl()` → 再调用 `engine.install()`
   - 权限: `skill:manage` (仅 admin/owner 可安装社区 Skill)
4. **git-installer.test.ts** (~100 行):
   - Mock `child_process.exec` (不实际 git clone)
   - 测试: 有效 URL 解析、无效 URL 拒绝、协议限制 (ssh 拒绝)
   - 测试: 克隆后验证成功/失败
   - 测试: 失败回滚清理目录

**验收标准**:
- 能通过 API 传入 Git HTTPS URL 安装社区 Skill
- 仅允许 HTTPS 协议 (拒绝 SSH/Git 协议)
- 克隆后自动验证 skill.yaml 合规性
- 失败时自动清理目录 (无残留)
- 测试 ≥ 8 个

**影响范围**:
- `packages/server/src/core/skill/git-installer.ts` (新建)
- `packages/server/src/core/skill/git-installer.test.ts` (新建)
- `packages/server/src/api/routes/skills.ts` (修改 — 扩展 install 端点)
- `packages/server/src/api/routes/schemas.ts` (修改 — 扩展 InstallSkillBody)

**创建时间**: (自动填充)
**完成时间**: 2026-02-13 00:42:09

---

### [completed] Skill 链式触发 — skill.completed 事件驱动下游 Skill ✅

**ID**: skill-012
**优先级**: P4
**模块路径**: packages/server/src/core/skill/
**当前状态**: 不存在 — `engine.ts` 执行完成后不发布任何事件；`trigger-manager.ts` 不存在 (依赖 skill-006)；Skill 的 trigger 类型定义中 `event` 支持 `skill.completed` 但无实现
**实现方案**:

1. **更新 engine.ts** — 执行成功后发布 `skill.completed` 事件:
   - 在 `execute()` 方法成功路径末尾: `getSkillEventBus().emit('skill.completed', { skillId, skillName, serverId, executionId, result })`
   - 失败时发布 `skill.failed` 事件
2. **更新 trigger-manager.ts** — 订阅 `skill.completed` 事件:
   - 在 `registerEvent()` 中: 当 eventTypes 包含 `skill.completed` 时注册监听
   - 事件匹配: 检查 trigger 配置中的 filter 条件 (如 `source_skill: log-auditor`)
   - 触发: 调用 `SkillEngine.execute()` with `triggerType='event'`
   - 防循环: 检测 A → B → A 的循环链并拒绝 (深度限制 ≤ 5 级)
3. **更新 shared/skill-schema.ts** — event trigger 添加 `source_skill` 过滤字段:
   - `EventTriggerSchema` 扩展: `filter?: { source_skill?: string }` — 仅当指定 Skill 完成时触发
4. **测试** (~100 行):
   - Skill A 完成 → 触发 Skill B 执行
   - 过滤: source_skill 不匹配时不触发
   - 循环检测: A → B → A 被拦截
   - 深度限制: 链长度 > 5 被拒绝

**验收标准**:
- Skill A 执行成功后自动触发配置了 `event: skill.completed` 的 Skill B
- 支持 `source_skill` 过滤 (只响应特定 Skill 的完成事件)
- 循环链检测防止无限触发
- 链深度 ≤ 5 级
- 测试 ≥ 6 个

**影响范围**:
- `packages/server/src/core/skill/engine.ts` (修改 — 发布事件)
- `packages/server/src/core/skill/trigger-manager.ts` (修改 — 订阅 skill.completed)
- `packages/shared/src/skill-schema.ts` (修改 — 扩展 EventTriggerSchema)
- `packages/server/src/core/skill/trigger-manager.test.ts` (修改 — 链式触发测试)

**创建时间**: (自动填充)
**完成时间**: 2026-02-13 01:43:29


**ID**: skill-001
**优先级**: P0
**模块路径**: packages/server/src/db/
**当前状态**: 文件不存在 — `schema.ts` 中无任何 skill 相关表定义；`migrations/` 中无 skill migration (当前最新 0009)；`repositories/skill-repository.ts` 不存在
**实现方案**:

1. **schema.ts** — 新增 3 张表：
   - `installedSkills`: id, userId, tenantId, name, displayName, version, source('official'|'community'|'local'), skillPath, status('installed'|'configured'|'enabled'|'paused'|'error'), config(JSON), createdAt, updatedAt
   - `skillExecutions`: id, skillId, serverId, userId, triggerType('manual'|'cron'|'event'|'threshold'), status('running'|'success'|'failed'|'timeout'), startedAt, completedAt, result(JSON), stepsExecuted, duration
   - `skillStore`: id, skillId, key, value, updatedAt (unique on skillId+key)
2. **migrations/0010_skills.sql** — DDL 创建 3 张表 + 索引
3. **repositories/skill-repository.ts** — 实现 `SkillRepository` 接口:
   - 接口: `findAll(userId)`, `findById(id)`, `install(input)`, `updateStatus(id, status)`, `updateConfig(id, config)`, `uninstall(id)`, `findByName(userId, name)`
   - `DrizzleSkillRepository` — SQLite 实现
   - `InMemorySkillRepository` — 测试实现
   - 单例: `getSkillRepository()` / `setSkillRepository()` / `_resetSkillRepository()`
4. **repositories/skill-execution-repository.ts** — 执行记录 CRUD:
   - `create()`, `findBySkillId(skillId, limit)`, `findById(id)`, `updateStatus(id, status, result)`
   - Drizzle + InMemory 双实现，单例模式
5. **更新 `createTables()`** — 确保 skill 表在 seed 时自动建表

**验收标准**:
- `pnpm --filter @aiinstaller/server build` 无类型错误
- Repository 单元测试 ≥ 20 个 (两种实现各覆盖所有 CRUD 方法)
- InMemory 实现可用于后续引擎测试

**影响范围**:
- `packages/server/src/db/schema.ts` (修改 — 新增表)
- `packages/server/src/db/migrations/0010_skills.sql` (新建)
- `packages/server/src/db/repositories/skill-repository.ts` (新建)
- `packages/server/src/db/repositories/skill-execution-repository.ts` (新建)
- `packages/server/src/db/schema.ts` → `createTables()` (更新)

**创建时间**: 2026-02-12
**完成时间**: 2026-02-12 22:04:30

---

### [completed] SkillLoader — YAML 解析 + Schema 验证 + 变量模板引擎 ✅

**ID**: skill-002
**优先级**: P0
**模块路径**: packages/server/src/core/skill/
**当前状态**: `core/skill/` 目录不存在 — 整个引擎为空白状态
**实现方案**:

1. **创建 `core/skill/` 目录**
2. **loader.ts** (~200 行):
   - `loadSkillFromDir(dirPath: string): Promise<SkillManifest>` — 读取 `skill.yaml`，YAML 解析，调用 shared 的 `validateSkillManifest()` 验证
   - `scanSkillDirectories(basePaths: string[]): Promise<ScannedSkill[]>` — 扫描 `skills/official/` 和自定义目录，返回所有可用 Skill
   - `resolvePromptTemplate(prompt: string, vars: TemplateVars): string` — 替换 `{{input.*}}`, `{{server.*}}`, `{{env.*}}` 变量
   - `checkRequirements(requires: SkillManifest['requires'], serverProfile?: ServerProfile): RequirementCheckResult` — OS/命令/Agent 版本检查
   - 使用 `js-yaml` 库解析 YAML（需添加依赖: `pnpm --filter @aiinstaller/server add js-yaml && pnpm --filter @aiinstaller/server add -D @types/js-yaml`）
3. **loader.test.ts** (~200 行):
   - 测试: 有效 YAML 解析 (使用 official 的 3 个 Skill)、无效 YAML 拒绝、缺少 kind/version 拒绝
   - 测试: 模板变量替换 (正常替换、未定义变量保留、嵌套变量)
   - 测试: 需求检查 (OS 匹配/不匹配、命令依赖)
   - 测试: 目录扫描 (空目录、多个 Skill、无效 Skill 跳过)

**验收标准**:
- 能成功加载 `skills/official/` 下的 3 个官方 Skill
- 模板变量 `{{input.backup_dir}}` 被正确替换为用户配置值
- 无效 YAML / 不合规 Schema 抛出明确错误消息
- 测试 ≥ 15 个

**影响范围**:
- `packages/server/src/core/skill/loader.ts` (新建)
- `packages/server/src/core/skill/loader.test.ts` (新建)
- `packages/server/package.json` (新增 js-yaml 依赖)

**创建时间**: 2026-02-12
**完成时间**: 2026-02-12 22:27:15

---

### [completed] SkillEngine 核心引擎 — 单例编排 + 手动执行流程 ✅

**ID**: skill-003
**优先级**: P0
**模块路径**: packages/server/src/core/skill/
**当前状态**: 不存在 — 依赖 skill-001 (Repository) 和 skill-002 (Loader) 完成
**实现方案**:

1. **types.ts** (~80 行) — 引擎内部类型:
   - `SkillExecutionResult`: status, stepsExecuted, duration, result (JSON), errors
   - `AvailableSkill`: manifest + source + installed (boolean)
   - `SkillRunParams`: skillId, serverId, userId, triggerType, config
   - `InstalledSkillWithManifest`: InstalledSkill + parsed SkillManifest
2. **engine.ts** (~300 行):
   - `SkillEngine` 类: 单例模式 (`getSkillEngine()` / `setSkillEngine()` / `_resetSkillEngine()`)
   - 构造参数: `InstallServer` 引用 (用于获取 TaskExecutor 等服务)
   - `install(userId, skillDir, source): Promise<InstalledSkill>` — 加载 → 验证 → 持久化到 DB
   - `uninstall(skillId): Promise<void>` — 停止触发器 → 删除 DB 记录
   - `configure(skillId, config): Promise<void>` — 更新用户配置 (inputs 值)
   - `updateStatus(skillId, status): Promise<void>` — enabled/paused/error 切换
   - `execute(skillId, serverId, userId, triggerType): Promise<SkillExecutionResult>` — 核心执行:
     - 从 DB 加载 InstalledSkill → 用 Loader 解析 YAML → 检查需求
     - 解析模板变量 (注入 config + server info)
     - 创建执行记录 (status=running)
     - **Phase 1 (本任务)**: 记录 prompt 到结果 (AI Runner 在 skill-005 接入)
     - 更新执行记录 (status=success/failed)
   - `listInstalled(userId): Promise<InstalledSkill[]>` — 列表查询
   - `listAvailable(): Promise<AvailableSkill[]>` — 扫描所有可安装 Skill
   - `getExecutions(skillId, limit): Promise<SkillExecution[]>` — 执行历史
   - `start()` / `stop()` — 生命周期 (TriggerManager 留给后续任务)
3. **engine.test.ts** (~250 行):
   - 使用 InMemory repositories + 临时 Skill 目录 (含有效 skill.yaml)
   - 测试: 安装流程 (成功、重复安装拒绝、无效 Skill 拒绝)
   - 测试: 卸载 (成功、不存在报错)
   - 测试: 配置更新、状态切换
   - 测试: 执行 (手动触发成功、Skill 未启用拒绝)
   - 测试: 列表查询、执行历史

**验收标准**:
- 完整的安装→配置→执行→卸载生命周期
- 单例模式正确 (get/set/_reset)
- 手动执行能走通完整流程 (不含 AI，留给 skill-005)
- 测试 ≥ 20 个

**影响范围**:
- `packages/server/src/core/skill/engine.ts` (新建)
- `packages/server/src/core/skill/engine.test.ts` (新建)
- `packages/server/src/core/skill/types.ts` (新建)

**创建时间**: 2026-02-12
**完成时间**: 2026-02-12 23:16:16

---

### [completed] RBAC 权限 + REST API 路由 + 服务注册 ✅

**ID**: skill-004
**优先级**: P0
**模块路径**: packages/shared/src/rbac.ts + packages/server/src/api/routes/
**当前状态**: `rbac.ts` 中无任何 skill 权限 (当前 32 权限，0 个 skill:*)；`api/routes/skills.ts` 不存在；`index.ts` 和 `routes/index.ts` 中无 skill 引用
**实现方案**:

1. **shared/src/rbac.ts** — 新增 3 个权限:
   - `'skill:view'` → MEMBER_PERMISSIONS (查看列表和历史)
   - `'skill:execute'` → ADMIN_PERMISSIONS (手动执行, admin+owner)
   - `'skill:manage'` → ADMIN_PERMISSIONS (安装/卸载/配置, admin+owner)
   - 更新 PERMISSIONS 数组 (保持按模块分组)
2. **rebuild shared**: `pnpm --filter @aiinstaller/shared build`
3. **api/routes/skills.ts** (~300 行):
   - `GET /` — 列出已安装 Skills (requirePermission('skill:view'))
   - `POST /install` — 安装 Skill (requirePermission('skill:manage'))
   - `DELETE /:id` — 卸载 (requirePermission('skill:manage'))
   - `PUT /:id/config` — 配置 inputs (requirePermission('skill:manage'))
   - `PUT /:id/status` — 启用/暂停 (requirePermission('skill:manage'))
   - `POST /:id/execute` — 手动执行 (requirePermission('skill:execute'))，接收 `{ serverId }` body
   - `GET /:id/executions` — 执行历史 (requirePermission('skill:view'))
   - `GET /:id/executions/:eid` — 执行详情 (requirePermission('skill:view'))
   - `GET /available` — 可安装列表 (requirePermission('skill:view'))
   - 所有写入端点使用 Zod 验证请求体
   - 全链路中间件: requireAuth → resolveRole → requirePermission
4. **api/routes/index.ts** — 挂载 `v1.route('/skills', skills)`
5. **index.ts** — 在 `createServer()` 中初始化 `getSkillEngine(server)`；在 `startServer()` 中调用 `getSkillEngine().start()`
6. **api/routes/skills.test.ts** (~300 行):
   - 使用 InMemory repositories + mock auth
   - 测试所有 9 个端点: 正常响应 + 输入验证
   - 测试 RBAC: member 只能 view，不能 manage/execute
   - 测试错误: 404 skillId, 400 缺参数

**验收标准**:
- 所有 9 个 API 端点返回正确状态码和格式
- RBAC 权限正确隔离 (member/admin/owner)
- `pnpm --filter @aiinstaller/shared build` + `pnpm typecheck` 全部通过
- 测试 ≥ 25 个 (路由 + RBAC)

**影响范围**:
- `packages/shared/src/rbac.ts` (修改 — 新增 3 权限)
- `packages/server/src/api/routes/skills.ts` (新建)
- `packages/server/src/api/routes/skills.test.ts` (新建)
- `packages/server/src/api/routes/index.ts` (修改 — 挂载路由)
- `packages/server/src/api/routes/schemas.ts` (修改 — 新增请求体 Zod schemas)
- `packages/server/src/index.ts` (修改 — SkillEngine 初始化 + 启动)

**创建时间**: 2026-02-12
**完成时间**: 2026-02-12 23:20:20

---

### [completed] SkillRunner — AI 自主执行层 + 安全约束 + 审计集成 ✅

**ID**: skill-005
**优先级**: P1
**模块路径**: packages/server/src/core/skill/
**当前状态**: 不存在 — 依赖 skill-003 (SkillEngine) 完成后接入。参考 `ai/agentic-chat.ts` 中的 tool_use 自主循环模式
**实现方案**:

1. **runner.ts** (~350 行):
   - `SkillRunner` 类 — 单次 Skill 执行的 AI 循环:
     - `run(params: SkillRunParams): Promise<SkillRunResult>` — 核心方法
     - 构建 AI messages: system prompt (Skill 专用) + skill prompt (从 YAML 解析后注入变量) + trigger context
     - Tool 定义 (根据 skill.yaml 的 `tools` 字段动态生成):
       - `shell`: 执行命令 → `getTaskExecutor().execute()` 发送到 Agent
       - `read_file`: 读取服务器文件
       - `write_file`: 写入服务器文件
       - `notify`: 发送通知 → `getWebhookDispatcher().dispatch()` 事件
       - `http`: HTTP 请求 (受限域名)
       - `store`: KV 存储读写
     - Agentic loop (参考 `agentic-chat.ts`):
       - AI 返回 tool_use → 安全检查 → 执行工具 → 返回结果 → 再次调用 AI
       - 终止: AI 返回 end_turn / 达到 max_steps / 超时
     - **安全集成**:
       - `shell` 工具: `classifyCommand()` 风险分级 → 对比 `constraints.risk_level_max` → 超限拒绝
       - `risk_level === 'forbidden'` → 永远拒绝
       - 所有 shell 命令通过 `getAuditLogger().log()` 记录
     - **超时 & 步数**:
       - `parseTimeout(timeout: string): number` — "30s"→30000, "5m"→300000, "1h"→3600000
       - `constraints.max_steps` 计数器 (每个 tool_use +1)
       - `setTimeout` 全局超时保护
2. **runner.test.ts** (~250 行):
   - Mock AIProvider 返回预设 tool_use 响应
   - 测试: 单步 shell 执行 → 成功结果
   - 测试: 多步循环 (read_file → shell → notify)
   - 测试: 安全拒绝 (red 命令 + yellow max → 拒绝)
   - 测试: 超时终止 (1s timeout → timeout 状态)
   - 测试: 步数限制 (max_steps=2 → 第 3 步停止)
   - 测试: 审计日志记录验证
3. **更新 engine.ts** — `execute()` 方法接入 SkillRunner:
   - 替换 Phase 1 的占位逻辑为真实 AI 执行
   - 传递 constraints, tools, resolved prompt 到 runner

**验收标准**:
- AI 自主循环能执行 3+ 步的多步 Skill (mock AI)
- `classifyCommand()` 安全检查正确拦截超限命令
- 超时和步数限制正确终止循环
- 所有 shell 执行记录到 audit_log
- 测试 ≥ 18 个

**影响范围**:
- `packages/server/src/core/skill/runner.ts` (新建)
- `packages/server/src/core/skill/runner.test.ts` (新建)
- `packages/server/src/core/skill/engine.ts` (修改 — 接入 runner)

**创建时间**: 2026-02-12
**完成时间**: 2026-02-12 23:40:45

---

## 🔮 后续任务预告 (当前批次完成后生成)

| ID | 优先级 | 标题 | 依赖 |
|----|--------|------|------|
| skill-006 | P2 | TriggerManager — Cron/Event/Threshold 触发调度 | skill-005 |
| skill-007 | P2 | Skill KV Store — 每个 Skill 的持久化存储 API | skill-001 |
| skill-008 | P3 | Dashboard — 前端类型 + Zustand Store + API 集成 | skill-004 |
| skill-009 | P3 | Dashboard — Skills 管理页面 + UI 组件 | skill-008 |
| skill-010 | P3 | SSE 推送 — Skill 执行实时进度流 | skill-005 |
| skill-011 | P4 | 社区 Skill 安装 — 从 Git URL 安装 | skill-003 |
| skill-012 | P4 | Skill 链式触发 — skill.completed 事件驱动 | skill-006 |

---

## 使用说明

任务状态: `[pending]` → `[in_progress]` → `[completed]` / `[failed]`
