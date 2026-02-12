### [pending] Skill 输入定义从 Manifest 获取 — 替代 config key 推断

**ID**: skill-019
**优先级**: P2
**模块路径**: packages/dashboard/src/pages/Skills.tsx + packages/server/src/api/routes/skills.ts
**当前状态**: 功能缺失 — `Skills.tsx:426-441` 中 `getSkillInputs()` 从 skill.config 的 key 推断输入类型，无法获取 manifest 中定义的真实 `inputs[]` (名称、类型、描述、默认值、required、enum options)。例如一个 enum 类型的 input 会被误推断为 string。API 端的 GET /skills 和 GET /skills/:id 只返回 DB 数据，不包含 manifest 中的 inputs 定义
**实现方案**:

1. **Server API** — GET /skills 响应中附带 manifest inputs:
   - `engine.listInstalled()` 返回结果时，对每个 skill 尝试加载 manifest 并提取 `inputs[]`
   - 或新增专用端点 `GET /skills/:id/manifest` 返回 manifest 的 inputs + triggers + tools
   - 推荐方案: 在 install 时将 manifest 的 inputs JSON 保存到 `installed_skills.config` 的 `_inputs` 字段，或新增 `manifest_inputs` 列
2. **Dashboard** — `getSkillInputs()` 优先使用 manifest inputs:
   - API 返回的 skill 包含 `inputs?: SkillInputDef[]` 字段
   - 配置 Modal 使用 manifest inputs 生成表单 (支持 enum 下拉、boolean 开关、数字输入等)
   - 回退: 无 inputs 时仍用 config key 推断 (向后兼容)
3. **types/skill.ts** — InstalledSkill 类型新增 `inputs?: SkillInputDef[]`

**验收标准**:
- 配置 Modal 能正确渲染 enum 类型为下拉选择器
- 配置 Modal 能显示 input 的 description 和 default 值
- 配置 Modal 对 required input 做必填验证
- 测试 ≥ 5 个

**影响范围**:
- `packages/server/src/api/routes/skills.ts` (修改 — 返回 inputs)
- `packages/server/src/core/skill/engine.ts` (修改 — 查询时附带 manifest inputs)
- `packages/dashboard/src/pages/Skills.tsx` (修改 — 使用 manifest inputs)
- `packages/dashboard/src/types/skill.ts` (修改 — InstalledSkill 新增字段)

**创建时间**: (自动填充)
**完成时间**: -

---
