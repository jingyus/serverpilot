### [pending] Dashboard Skill 升级按钮 + 取消按钮 UI

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
**完成时间**: -

---
