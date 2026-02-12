### [pending] Dashboard Skill 组件测试补全 — AvailableSkillCard / ConfirmationBanner / ExecuteDialog

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
**完成时间**: -

---
