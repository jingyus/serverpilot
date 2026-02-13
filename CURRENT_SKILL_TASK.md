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
