### [pending] SkillRepository.findAllEnabled() — 启动时加载已启用 Skill 的触发器

**ID**: skill-013
**优先级**: P0
**模块路径**: packages/server/src/db/repositories/skill-repository.ts
**当前状态**: 功能缺失 — `TriggerManager.findAllEnabledSkills()` (trigger-manager.ts:408-414) 使用 duck-typing 检测 `repo['findAllEnabled']`，但 `SkillRepository` 接口和两个实现类 (`DrizzleSkillRepository`, `InMemorySkillRepository`) 都没有定义 `findAllEnabled()` 方法。导致服务器重启后，已启用 Skill 的 cron/event/threshold 触发器不会被重新注册，只能通过手动重新启用来恢复
**实现方案**:

1. **SkillRepository 接口** — 新增方法签名:
   - `findAllEnabled(): Promise<InstalledSkill[]>` — 返回所有 `status === 'enabled'` 的 Skill (跨用户)
2. **DrizzleSkillRepository** — 实现:
   - `SELECT * FROM installed_skills WHERE status = 'enabled' ORDER BY created_at DESC`
   - 使用 Drizzle: `db.select().from(installedSkills).where(eq(installedSkills.status, 'enabled')).all()`
3. **InMemorySkillRepository** — 实现:
   - `this.skills.filter(s => s.status === 'enabled')`
4. **TriggerManager** — 移除 duck-typing hack (trigger-manager.ts:408-414):
   - 直接调用 `this.repo.findAllEnabled()` (接口类型保证方法存在)
5. **测试**:
   - DrizzleSkillRepository: 测试 findAllEnabled 只返回 enabled 状态
   - InMemorySkillRepository: 同上
   - TriggerManager: 测试 start() 时从 DB 加载已启用的 Skill 并注册触发器

**验收标准**:
- 服务器重启后，所有 `status=enabled` 的 Skill 的触发器被自动恢复
- `TriggerManager.start()` 不再使用 duck-typing 检测
- 测试 ≥ 6 个新增

**影响范围**:
- `packages/server/src/db/repositories/skill-repository.ts` (修改 — 接口 + 两个实现)
- `packages/server/src/core/skill/trigger-manager.ts` (修改 — 移除 duck-typing)
- `packages/server/src/core/skill/trigger-manager.test.ts` (修改 — 新增 startup 加载测试)
- `packages/server/src/db/repositories/skill-repository.test.ts` (如存在则修改)

**创建时间**: (自动填充)
**完成时间**: -

---
