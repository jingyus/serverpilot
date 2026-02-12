### [pending] Dashboard Skill 执行按钮无功能 — onExecute 为空回调

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
**完成时间**: -

---
