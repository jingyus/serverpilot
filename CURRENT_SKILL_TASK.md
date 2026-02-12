### [pending] SkillEngine 核心引擎 — 单例编排 + 手动执行流程

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
**完成时间**: -

---
