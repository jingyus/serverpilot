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
