### [pending] Prompt 模板变量注入缺失 — engine.ts 未传递 server/skill 上下文

**ID**: skill-025
**优先级**: P0
**模块路径**: packages/server/src/core/skill/engine.ts
**当前状态**: 功能缺失 — `engine.ts:314` 调用 `resolvePromptTemplate(manifest.prompt, { input, now })` 仅传递了 `input` 和 `now` 两个变量命名空间。但 `loader.ts` 的 `resolveVariable()` 支持 4 个命名空间: `input`, `server`, `skill`, `env`。SKILL_SPEC.md 明确列出 `{{server.name}}`, `{{server.os}}`, `{{server.ip}}`, `{{skill.last_run}}`, `{{skill.last_result}}` 为可用变量。当前所有使用这些变量的 Skill prompt 将无法正确解析（变量原样保留）
**实现方案**:
1. **engine.ts execute() 方法** — 补充 `server` 和 `skill` 变量:
   - 通过 `getServerRepository().findById(serverId)` 获取 server 信息 (name, os, hostname/ip)
   - 通过 `this.repo.listExecutions(skillId, 1)` 获取上次执行记录 → `skill.last_run` (completedAt) + `skill.last_result` (result summary)
   - 传递完整 TemplateVars: `{ input, server: { name, os, ip }, skill: { last_run, last_result }, now }`
2. **可选 — env 变量**: 根据 skill manifest 的 `requires` 或配置决定是否传入 env (当前可跳过，低优先)
3. **测试**:
   - engine.test.ts 新增: 验证 resolvedPrompt 包含 server.name 替换
   - engine.test.ts 新增: 验证 skill.last_run 从上次执行记录获取
   - engine.test.ts 新增: 无上次执行时 skill.last_run 为空字符串或 "N/A"
**验收标准**:
- `resolvePromptTemplate` 接收完整 4 命名空间变量
- 官方 Skill 的 `{{server.os}}` 等模板变量能正确替换
- 测试 ≥ 4 个新增
**影响范围**:
- `packages/server/src/core/skill/engine.ts` (修改 — execute 方法)
- `packages/server/src/core/skill/engine.test.ts` (修改 — 新增变量注入测试)
**创建时间**: (自动填充)
**完成时间**: -

---
