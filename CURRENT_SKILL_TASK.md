### [pending] Dashboard — Skills 管理页面 + UI 组件

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
**完成时间**: -

---
