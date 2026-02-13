### [pending] SkillRunner AI 提供者不可用时的优雅降级

**ID**: skill-107
**优先级**: P2
**模块路径**: packages/server/src/core/skill/
**当前状态**: `runner.ts` 构造函数在 AI 提供者不可用时直接 `throw new Error()`，导致 Skill 模块完全不可用。Skill 列表查看、配置管理、执行历史等功能不依赖 AI 提供者，不应受影响。`SkillRunner` 仅在实际执行 `run()` 时才需要提供者。
**实现方案**: 
1. 将 `SkillRunner` 构造函数中的提供者检查延迟到 `run()` 方法调用时
2. 构造函数改为: `this.provider = provider ?? null;`
3. `run()` 方法开头: `if (!this.provider) { this.provider = getActiveProvider(); }` + 检查
4. 如果仍无提供者: 返回明确的 `SkillRunResult` 错误 (status: 'failed', errors: ['No AI provider...'])
5. 不再在构造函数抛异常，让 engine 可以正常启动和响应查询
**验收标准**: 
- AI 提供者不可用时，Skill 列表/配置/历史 API 正常工作
- AI 提供者不可用时，执行返回明确错误而非未捕获异常
- 提供者恢复后，执行自动恢复
- ≥3 个测试用例
**影响范围**: packages/server/src/core/skill/runner.ts, packages/server/src/core/skill/runner.test.ts
**创建时间**: 2026-02-13
**完成时间**: -
