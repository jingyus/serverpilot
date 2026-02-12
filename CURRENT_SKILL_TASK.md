### [pending] Skills.tsx 页面组件拆分 — 降至 500 行以下

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
**完成时间**: -

---
