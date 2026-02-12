### [pending] Output Schema 验证 — AI 输出结构化校验

**ID**: skill-028
**优先级**: P1
**模块路径**: packages/server/src/core/skill/runner.ts
**当前状态**: 功能缺失 — SKILL_SPEC.md (line 210-220) 定义了 `outputs` 字段允许 Skill 声明结构化输出格式。`@aiinstaller/shared/skill-schema.ts` 已定义 `SkillOutput` Zod schema (name, type, description)。但 `runner.ts` 收集 AI 原始文本输出后直接返回 `output: string`，未尝试解析 AI 输出为结构化数据，也未校验是否满足 manifest 声明的 outputs
**实现方案**:
1. **runner.ts** — run() 方法最后阶段新增 output 解析:
