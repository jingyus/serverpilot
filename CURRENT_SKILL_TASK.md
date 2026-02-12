### [pending] configureSkill store 盲写 status='configured' — 覆盖已启用/暂停状态

**ID**: skill-016
**优先级**: P1
**模块路径**: packages/dashboard/src/stores/skills.ts
**当前状态**: Bug — `skills.ts:113` 在 `configureSkill` 成功后强制将 status 设为 `'configured'`，即使 Skill 原本是 `'enabled'` 或 `'paused'` 状态。服务端 `engine.ts:196-198` 只在 `status === 'installed'` 时才自动转为 configured，其他状态保持不变。前端乐观更新与服务端行为不一致，导致 UI 显示错误状态
**实现方案**:

1. **stores/skills.ts** — 修改 `configureSkill`:
   - 移除盲写 `status: 'configured' as SkillStatus` 逻辑
   - 改为: 只在 `s.status === 'installed'` 时将 status 更新为 `'configured'`
   - 其他状态保持原样: `s.id === id ? { ...s, config, ...(s.status === 'installed' ? { status: 'configured' as SkillStatus } : {}) } : s`
2. **测试**:
   - skills.test.ts: 新增测试 — configureSkill 对 enabled/paused 状态的 Skill 不改变 status

**验收标准**:
- 配置已启用的 Skill 后，UI 仍显示 "Enabled" 而非 "Configured"
- 配置已安装 (installed) 的 Skill 后，UI 正确显示 "Configured"
- 测试 ≥ 2 个新增

**影响范围**:
- `packages/dashboard/src/stores/skills.ts` (修改 — 条件状态更新)
- `packages/dashboard/src/stores/skills.test.ts` (修改 — 新增测试)

**创建时间**: (自动填充)
**完成时间**: -

---
