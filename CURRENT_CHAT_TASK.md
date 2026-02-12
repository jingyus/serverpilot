### [pending] AgenticConfirmBar 组件质量低于其他 Chat 组件 — 缺测试、缺 testid、风格不一致

**ID**: chat-015
**优先级**: P2
**模块路径**: packages/dashboard/src/components/chat/AgenticConfirmBar.tsx
**发现的问题**: 
1. 无测试文件 — 其他所有 Chat 组件（ChatMessage、MessageInput、PlanPreview、ExecutionLog、MarkdownRenderer）都有对应 `.test.tsx`，唯独 `AgenticConfirmBar` 没有
2. 无 `data-testid` 属性 — `StepConfirmBar` 有 `data-testid="step-confirm-bar"`、`step-allow-btn` 等，`AgenticConfirmBar` 一个都没有
3. 使用原生 `<button>` 而非项目通用 `<Button>` 组件（其他组件均使用 `@/components/ui/button`）
4. 使用字符串拼接 `${colorClass}` 而非 `cn()` 工具函数（AgenticConfirmBar.tsx:28）
5. 使用 HTML 实体 `&#9888;` 而非 Lucide 图标（其他组件均使用 lucide-react 图标）
**改进方案**: 
1. 创建 `AgenticConfirmBar.test.tsx`，覆盖渲染、Allow 点击、Reject 点击、不同风险等级样式
2. 添加 `data-testid="agentic-confirm-bar"`、`agentic-allow-btn`、`agentic-reject-btn`
3. 替换原生 `<button>` 为 `<Button>` 组件
4. 使用 `cn()` 替换字符串拼接
5. 使用 `AlertTriangle` 图标替换 `&#9888;`
**验收标准**: 
- `AgenticConfirmBar.test.tsx` 至少 8 个测试用例
- 所有 `data-testid` 与 StepConfirmBar 命名风格一致
- 视觉风格与其他 Chat 组件统一
**影响范围**: packages/dashboard/src/components/chat/AgenticConfirmBar.tsx, packages/dashboard/src/components/chat/AgenticConfirmBar.test.tsx (新)
**创建时间**: (自动填充)
**完成时间**: -

---
