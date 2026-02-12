### [pending] Agent 版本检查实现 — requires.agent 字段被跳过

**ID**: skill-076
**优先级**: P2
**模块路径**: packages/server/src/core/skill/loader.ts
**当前状态**: 功能缺失 — `loader.ts` line 267-268 显示 `requires.agent` 被 `logger.debug('Agent version check deferred')` 跳过，永远不执行版本比较。SKILL_SPEC.md 定义了 `requires.agent: ">=1.0.0"` 语义版本约束，但 Agent 协议尚未标准化版本号格式。
**实现方案**: 
1. 在 Agent 认证时，要求 Agent 报告版本号（已有 `device.info` 或 `env.report` 中可能包含版本）
2. 在 `loader.ts` 的 `checkRequirements()` 中，通过 Server 的已连接 Agent 信息获取版本
3. 使用 SemVer 比较库（`semver` npm 包或手写简单比较）验证 `requires.agent` 约束
4. 如果 Agent 未报告版本，降级为警告（不阻断执行），而非静默跳过
5. 添加测试: 版本匹配通过、版本不匹配拒绝、无版本信息降级警告
**验收标准**: 
- `requires.agent` 约束被实际检查（非静默跳过）
- 版本不满足时返回明确的 `missing` 错误信息
- Agent 无版本时降级为 warning 而非 error
- 测试 ≥ 5 个新增
**影响范围**: packages/server/src/core/skill/loader.ts, packages/server/src/core/skill/loader.test.ts
**创建时间**: (自动填充)
**完成时间**: -

---
