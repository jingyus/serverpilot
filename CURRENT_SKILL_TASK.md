### [pending] Skill manifest_inputs 持久化 — 安装时保存输入定义到 DB

**ID**: skill-021
**优先级**: P3
**模块路径**: packages/server/src/db/schema.ts + packages/server/src/core/skill/engine.ts
**当前状态**: 功能缺失 — `installed_skills` 表没有存储 manifest 中的 `inputs[]` 定义。每次需要 inputs 信息时必须从磁盘加载 `skill.yaml` 并解析。如果 Skill 目录被删除或损坏，inputs 信息丢失。Dashboard 配置 Modal 无法获取正确的输入类型定义 (依赖 skill-019)
**实现方案**:

1. **DB Schema** — `installed_skills` 表新增列:
   - `manifest_inputs TEXT` — JSON 序列化的 `SkillManifest.inputs[]`
   - 或重用 `config` 列的 `_manifest` 子键 (不推荐，混淆用户配置和元数据)
2. **Migration** — `0011_skill_manifest_inputs.sql`:
   - `ALTER TABLE installed_skills ADD COLUMN manifest_inputs TEXT`
3. **engine.ts** — `install()` 方法:
   - 解析 manifest 后，将 `manifest.inputs` JSON 序列化保存到 `manifest_inputs` 列
4. **SkillRepository** — 更新 `install()` 输入类型:
   - `InstallSkillInput` 新增 `manifestInputs?: unknown[]`
5. **API 返回** — GET /skills 的响应中包含 `manifestInputs` 字段

**验收标准**:
- 安装 Skill 后 DB 持久化了 inputs 定义
- API 返回 InstalledSkill 包含 manifestInputs
- 即使磁盘 skill.yaml 损坏，仍可从 DB 获取 inputs 定义
- Migration 平滑执行 (nullable 列)

**影响范围**:
- `packages/server/src/db/schema.ts` (修改)
- `packages/server/src/db/migrations/0011_skill_manifest_inputs.sql` (新建)
- `packages/server/src/db/connection.ts` (修改 — createTables)
- `packages/server/src/db/repositories/skill-repository.ts` (修改)
- `packages/server/src/core/skill/engine.ts` (修改)
- `packages/server/src/core/skill/types.ts` (修改 — InstalledSkill 新增字段)

**创建时间**: (自动填充)
**完成时间**: -

---
