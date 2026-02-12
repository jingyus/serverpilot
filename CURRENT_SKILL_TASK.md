### [pending] Skill 执行历史增强 — 执行详情页 + 重新执行

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
**完成时间**: -
