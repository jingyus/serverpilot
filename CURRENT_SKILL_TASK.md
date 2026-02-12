### [pending] Dashboard Skill 组件测试补全 — SkillCard / SkillConfigModal / ExecutionHistory / ExecutionStream

**ID**: skill-066
**优先级**: P2
**模块路径**: packages/dashboard/src/components/skill/
**当前状态**: 6 个 Skill 组件中仅 `ExecutionDetail` 有测试文件。`SkillCard`（129 行）、`SkillConfigModal`（228 行）、`ExecutionHistory`（146 行）、`ExecutionStream`（166 行）均无测试。Dashboard 组件测试覆盖率低于 70% 标准。
**实现方案**: 
1. 创建 `SkillCard.test.tsx` — 测试状态 toggle、配置按钮、执行按钮、卸载确认（约 8 个用例）
2. 创建 `SkillConfigModal.test.tsx` — 测试各输入类型渲染（string/number/boolean/enum/string[]）、表单提交、校验（约 10 个用例）
3. 创建 `ExecutionHistory.test.tsx` — 测试列表渲染、状态 badge、时间格式、空状态（约 6 个用例）
4. 创建 `ExecutionStream.test.tsx` — 测试 SSE 连接、事件渲染、完成/错误状态（约 6 个用例）
**验收标准**: 
- 4 个新测试文件共约 30 个测试用例
- 所有组件的核心交互和渲染路径被覆盖
- 使用 @testing-library/react 标准模式
- UI 测试覆盖率达到 70%+
**影响范围**: packages/dashboard/src/components/skill/ (4 个新测试文件)
**创建时间**: (自动填充)
**完成时间**: -

---
