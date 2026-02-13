### [pending] Dashboard Skills.tsx 拆分 — 从 576 行降至 ≤500 行

**ID**: skill-106
**优先级**: P2
**模块路径**: packages/dashboard/src/pages/
**当前状态**: `Skills.tsx` 当前 576 行，超过 500 行软限制。包含 3 个 Tab 面板（已安装、可用、分析）的完整逻辑、Git URL 安装表单、确认横幅集成等，职责过重。
**实现方案**: 
1. 提取 "Available Skills" Tab 面板逻辑 (Git URL 安装表单 + 可用 Skill 列表) 到 `components/skill/AvailableTab.tsx` (~120 行)
2. 提取 "Installed Skills" Tab 面板逻辑 (Skill 卡片列表 + 执行历史弹窗) 到 `components/skill/InstalledTab.tsx` (~120 行)
3. Skills.tsx 只保留: Tab 切换、确认横幅、导入按钮、布局框架 (~340 行)
**验收标准**: 
- Skills.tsx ≤ 500 行
- 每个新组件 ≤ 200 行
- 所有 Skills.test.tsx 测试继续通过
- UI 行为不变
**影响范围**: packages/dashboard/src/pages/Skills.tsx (拆分), 新建 AvailableTab.tsx, InstalledTab.tsx
**创建时间**: 2026-02-13
**完成时间**: -

---
